BEGIN;

-- ZION-ADM | 2.11-C.6-D
-- Detalhamento de documentos Meta por conta financeira.
-- Nao autentica fornecedores nem libera fechamento.
-- Nenhum papel de aplicacao recebe escrita.

DO $check$
BEGIN
  IF to_regclass(
    'public.zion_admin_monthly_final_evidence'
  ) IS NULL OR to_regclass(
    'public.zion_admin_financial_evidence_uploads'
  ) IS NULL THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_LINES_FOUNDATION_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.zion_admin_monthly_final_evidence
    WHERE source = 'meta_invoice'
  ) THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_LINES_PRIOR_EVIDENCE_AUDIT';
  END IF;
END;
$check$;

CREATE TABLE public.zion_admin_meta_billing_account_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  meta_evidence_id bigint NOT NULL
    REFERENCES public.zion_admin_monthly_final_evidence(id)
    ON DELETE RESTRICT,

  month date NOT NULL
    CHECK (EXTRACT(DAY FROM month) = 1),

  preclosure_revision integer NOT NULL
    CHECK (preclosure_revision > 0),

  financial_account_type text NOT NULL
    CHECK (
      financial_account_type IN (
        'messaging_account',
        'business_portfolio'
      )
    ),

  financial_account_id text NOT NULL
    CHECK (
      financial_account_id ~ '^[A-Za-z0-9:_-]{1,128}$'
    ),

  document_upload_id bigint NOT NULL
    REFERENCES public.zion_admin_financial_evidence_uploads(id)
    ON DELETE RESTRICT,

  document_reference text NOT NULL
    CHECK (
      length(btrim(document_reference)) BETWEEN 3 AND 512
      AND document_reference = btrim(document_reference)
      AND document_reference !~ '[[:cntrl:]]'
    ),

  record_kind text NOT NULL
    CHECK (
      record_kind IN (
        'amount_record',
        'not_applicable_record'
      )
    ),

  amount_brl_cents bigint NOT NULL
    CHECK (
      amount_brl_cents BETWEEN 0 AND 100000000000
    ),

  review_fingerprint_sha256 text NOT NULL
    CHECK (
      review_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
    ),

  reviewed_by_user_id uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE RESTRICT,

  recorded_at timestamptz NOT NULL
    DEFAULT clock_timestamp(),

  CONSTRAINT zamabl_not_applicable_zero
    CHECK (
      record_kind <> 'not_applicable_record'
      OR amount_brl_cents = 0
    ),

  CONSTRAINT zamabl_document_unique
    UNIQUE (
      month,
      preclosure_revision,
      financial_account_type,
      financial_account_id,
      document_reference
    )
);

CREATE INDEX zamabl_evidence_lookup
ON public.zion_admin_meta_billing_account_lines (
  meta_evidence_id
);

-- Cada linha precisa pertencer ao mesmo mes,
-- revisao e origem dos documentos registrados.
CREATE FUNCTION public.zion_admin_meta_billing_line_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_evidence public.zion_admin_monthly_final_evidence%ROWTYPE;
  v_upload public.zion_admin_financial_evidence_uploads%ROWTYPE;
BEGIN
  SELECT * INTO v_evidence
  FROM public.zion_admin_monthly_final_evidence
  WHERE id = NEW.meta_evidence_id
  FOR SHARE;

  IF NOT FOUND
    OR v_evidence.source IS DISTINCT FROM 'meta_invoice'
    OR v_evidence.month IS DISTINCT FROM NEW.month
    OR v_evidence.preclosure_revision IS DISTINCT FROM
      NEW.preclosure_revision
    OR v_evidence.meta_review_fingerprint_sha256 IS DISTINCT FROM
      NEW.review_fingerprint_sha256
    OR v_evidence.verified_by_user_id IS DISTINCT FROM
      NEW.reviewed_by_user_id
  THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_LINE_EVIDENCE_MISMATCH';
  END IF;

  SELECT * INTO v_upload
  FROM public.zion_admin_financial_evidence_uploads
  WHERE id = NEW.document_upload_id
  FOR SHARE;

  IF NOT FOUND
    OR v_upload.source IS DISTINCT FROM 'meta_invoice'
    OR v_upload.month IS DISTINCT FROM NEW.month
    OR v_upload.preclosure_revision IS DISTINCT FROM
      NEW.preclosure_revision
    OR v_upload.storage_bucket IS DISTINCT FROM
      'zion-admin-financial-evidence'
    OR v_upload.document_sha256 IS NULL
    OR v_upload.document_sha256 !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_LINE_UPLOAD_MISMATCH';
  END IF;

  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER zamabl_validate_insert
BEFORE INSERT
ON public.zion_admin_meta_billing_account_lines
FOR EACH ROW
EXECUTE FUNCTION public.zion_admin_meta_billing_line_guard();

-- A soma e verificada no COMMIT, permitindo
-- inserir o total mensal e suas linhas na mesma
-- transacao, mas nunca persistir um total divergente.
CREATE FUNCTION public.zion_admin_meta_billing_total_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id bigint;
  v_evidence public.zion_admin_monthly_final_evidence%ROWTYPE;
  v_count bigint;
  v_amount_count bigint;
  v_total numeric;
BEGIN
  IF TG_TABLE_NAME = 'zion_admin_monthly_final_evidence' THEN
    IF NEW.source <> 'meta_invoice' THEN
      RETURN NULL;
    END IF;

    v_id := NEW.id;
  ELSE
    v_id := NEW.meta_evidence_id;
  END IF;

  SELECT * INTO v_evidence
  FROM public.zion_admin_monthly_final_evidence
  WHERE id = v_id;

  IF NOT FOUND OR v_evidence.source <> 'meta_invoice' THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_TOTAL_SOURCE_MISMATCH';
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (
      WHERE record_kind = 'amount_record'
    ),
    COALESCE(SUM(amount_brl_cents), 0)
  INTO
    v_count,
    v_amount_count,
    v_total
  FROM public.zion_admin_meta_billing_account_lines
  WHERE meta_evidence_id = v_id;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_TOTAL_LINES_MISSING';
  END IF;

  IF v_total IS DISTINCT FROM
    v_evidence.amount_brl_cents::numeric
  THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_TOTAL_AMOUNT_MISMATCH';
  END IF;

  IF (
    v_evidence.meta_financial_status = 'verified_not_applicable'
    AND v_amount_count <> 0
  ) OR (
    v_evidence.meta_financial_status = 'verified_amount'
    AND v_amount_count = 0
  ) THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_TOTAL_STATUS_MISMATCH';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER zamfe_meta_lines_complete
AFTER INSERT
ON public.zion_admin_monthly_final_evidence
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.zion_admin_meta_billing_total_guard();

CREATE CONSTRAINT TRIGGER zamabl_meta_total_consistent
AFTER INSERT
ON public.zion_admin_meta_billing_account_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.zion_admin_meta_billing_total_guard();

-- Historico imutavel.
CREATE FUNCTION public.zion_admin_reject_meta_billing_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'ZION_ADMIN_META_BILLING_LINE_IMMUTABLE';
END;
$function$;

CREATE TRIGGER zamabl_immutable
BEFORE UPDATE OR DELETE
ON public.zion_admin_meta_billing_account_lines
FOR EACH ROW
EXECUTE FUNCTION
  public.zion_admin_reject_meta_billing_line_mutation();

ALTER TABLE public.zion_admin_meta_billing_account_lines
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.zion_admin_meta_billing_account_lines
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
  public.zion_admin_meta_billing_account_lines
TO service_role;

REVOKE ALL ON SEQUENCE
  public.zion_admin_meta_billing_account_lines_id_seq
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.zion_admin_meta_billing_line_guard()
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.zion_admin_meta_billing_total_guard()
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.zion_admin_reject_meta_billing_line_mutation()
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;