BEGIN;

-- ZION-ADM | 2.11-C.3-C
-- Writer transacional de evidencias Meta.
--
-- INTENCIONALMENTE INATIVO:
-- Nenhum GRANT EXECUTE nesta migration.
--
-- O SQL nao le bytes do Storage nem autentica faturas.
-- A futura rota devera verificar:
-- 1. Administrador autenticado e autorizado.
-- 2. Documento canonico e integridade SHA-256.
-- 3. Revisao financeira apresentada ao administrador.
-- 4. Confirmacao humana explicita dos valores na Meta.
--
-- Nao transforma vinculacoes candidatas em faturamento.
-- Nao registra cobrancas nem fecha competencias.

DO $$
BEGIN
  IF to_regclass(
    'public.zion_admin_monthly_final_evidence'
  ) IS NULL OR to_regclass(
    'public.zion_admin_financial_evidence_uploads'
  ) IS NULL THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_WRITER_FOUNDATION_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.zion_admin_monthly_final_evidence
    WHERE source = 'meta_invoice'
  ) THEN
    RAISE EXCEPTION
      'ZION_ADMIN_META_EXISTING_EVIDENCE_REQUIRES_AUDIT';
  END IF;
END;
$$;

ALTER TABLE public.zion_admin_monthly_final_evidence
ADD COLUMN meta_upload_id bigint
  REFERENCES public.zion_admin_financial_evidence_uploads(id)
  ON DELETE RESTRICT;

ALTER TABLE public.zion_admin_monthly_final_evidence
ADD COLUMN meta_operation_key uuid;

ALTER TABLE public.zion_admin_monthly_final_evidence
ADD COLUMN meta_review_fingerprint_sha256 text;

ALTER TABLE public.zion_admin_monthly_final_evidence
ADD CONSTRAINT zamfe_meta_registration_required
CHECK (
  (
    source <> 'meta_invoice'
    AND meta_upload_id IS NULL
    AND meta_operation_key IS NULL
    AND meta_review_fingerprint_sha256 IS NULL
  )
  OR
  (
    source = 'meta_invoice'
    AND meta_upload_id IS NOT NULL
    AND meta_operation_key IS NOT NULL
    AND meta_review_fingerprint_sha256 IS NOT NULL
    AND meta_review_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX zamfe_meta_operation_unique
ON public.zion_admin_monthly_final_evidence(meta_operation_key)
WHERE source = 'meta_invoice';

CREATE UNIQUE INDEX zamfe_meta_period_unique
ON public.zion_admin_monthly_final_evidence(
  month, preclosure_revision
)
WHERE source = 'meta_invoice';

CREATE INDEX zamfe_meta_period_lookup
ON public.zion_admin_monthly_final_evidence(
  month, preclosure_revision
)
WHERE source = 'meta_invoice';

CREATE FUNCTION
public.zion_admin_register_verified_meta_evidence_by_system(
  p_month date,
  p_preclosure_revision integer,
  p_upload_id bigint,
  p_status text,
  p_proof_type text,
  p_amount_brl_cents bigint,
  p_document_reference text,
  p_review_fingerprint_sha256 text,
  p_operation_key uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_upload public.zion_admin_financial_evidence_uploads%ROWTYPE;
  v_previous public.zion_admin_monthly_final_evidence%ROWTYPE;
  v_revision integer;
  v_new_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_EVIDENCE_UNAUTHORIZED';
  END IF;

  IF p_month IS NULL
    OR p_month < DATE '2020-01-01'
    OR p_month <> pg_catalog.date_trunc(
      'month', p_month::timestamp
    )::date
    OR p_preclosure_revision IS NULL
    OR p_preclosure_revision < 1
    OR p_upload_id IS NULL
    OR p_upload_id < 1
    OR p_operation_key IS NULL
    OR p_actor_id IS NULL
    OR p_review_fingerprint_sha256 IS NULL
    OR p_review_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
    OR p_document_reference IS NULL
    OR length(btrim(p_document_reference)) NOT BETWEEN 3 AND 512
    OR p_document_reference <> btrim(p_document_reference)
    OR p_document_reference ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_EVIDENCE_INVALID_INPUT';
  END IF;

  IF p_status IS NULL
    OR p_status NOT IN (
      'verified_amount',
      'verified_not_applicable'
    )
    OR p_proof_type IS NULL
    OR p_proof_type NOT IN (
      'supplier_invoice',
      'supplier_statement'
    )
    OR p_amount_brl_cents IS NULL
    OR p_amount_brl_cents < 0
    OR p_amount_brl_cents > 100000000000
  THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_EVIDENCE_INVALID_FINANCE';
  END IF;

  IF p_status = 'verified_not_applicable'
    AND (
      p_amount_brl_cents <> 0
      OR p_proof_type <> 'supplier_statement'
    )
  THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_EVIDENCE_NO_BILL_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = p_actor_id
  ) THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_EVIDENCE_ACTOR_MISSING';
  END IF;

  -- Serializacao por competencia, compativel com
  -- o bloqueio utilizado pelo preflight mensal.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('zion_admin_monthly_preclosure'),
    pg_catalog.hashtext(p_month::text)
  );

  SELECT revision INTO v_revision
  FROM public.zion_admin_monthly_preclosures
  WHERE month = p_month
  FOR UPDATE;

  IF NOT FOUND OR v_revision IS DISTINCT FROM p_preclosure_revision THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_EVIDENCE_STALE_PRECLOSURE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.zion_admin_monthly_preclosure_audit
    WHERE month = p_month
      AND revision = p_preclosure_revision
  ) THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_EVIDENCE_AUDIT_MISSING';
  END IF;

  SELECT * INTO v_previous
  FROM public.zion_admin_monthly_final_evidence
  WHERE meta_operation_key = p_operation_key;

  IF FOUND THEN
    IF v_previous.month IS DISTINCT FROM p_month
      OR v_previous.preclosure_revision IS DISTINCT FROM
        p_preclosure_revision
      OR v_previous.meta_upload_id IS DISTINCT FROM p_upload_id
      OR v_previous.meta_financial_status IS DISTINCT FROM p_status
      OR v_previous.proof_type IS DISTINCT FROM p_proof_type
      OR v_previous.amount_brl_cents IS DISTINCT FROM
        p_amount_brl_cents
      OR v_previous.document_reference IS DISTINCT FROM
        p_document_reference
      OR v_previous.meta_review_fingerprint_sha256 IS DISTINCT FROM
        p_review_fingerprint_sha256
      OR v_previous.verified_by_user_id IS DISTINCT FROM p_actor_id
    THEN
      RAISE EXCEPTION 'ZION_ADMIN_META_EVIDENCE_OPERATION_REUSED';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'outcome', 'replayed',
      'evidence_id', v_previous.id
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.zion_admin_monthly_final_evidence
    WHERE month = p_month
      AND preclosure_revision = p_preclosure_revision
      AND source = 'meta_invoice'
  ) THEN
    RAISE EXCEPTION
      'ZION_ADMIN_META_EVIDENCE_ALREADY_VERIFIED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.zion_admin_monthly_final_closures
    WHERE month = p_month
  ) OR EXISTS (
    SELECT 1
    FROM public.zion_admin_monthly_closures
    WHERE month = p_month
  ) THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_EVIDENCE_MONTH_CLOSED';
  END IF;

  SELECT * INTO v_upload
  FROM public.zion_admin_financial_evidence_uploads
  WHERE id = p_upload_id
  FOR SHARE;

  IF NOT FOUND
    OR v_upload.month IS DISTINCT FROM p_month
    OR v_upload.preclosure_revision IS DISTINCT FROM
      p_preclosure_revision
    OR v_upload.source IS DISTINCT FROM 'meta_invoice'
    OR v_upload.storage_bucket IS DISTINCT FROM
      'zion-admin-financial-evidence'
    OR v_upload.document_sha256 IS NULL
    OR v_upload.document_sha256 !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_EVIDENCE_UPLOAD_MISMATCH';
  END IF;

  -- A verificacao independente dos bytes e a confirmacao
  -- humana ainda nao podem ser realizadas pelo SQL.
  -- Por isso, esta funcao permanece sem GRANT EXECUTE.
  INSERT INTO public.zion_admin_monthly_final_evidence (
    month,
    preclosure_revision,
    source,
    proof_type,
    document_reference,
    document_sha256,
    amount_brl_cents,
    amount_usd,
    verification_method,
    verified_by_user_id,
    verified_at,
    meta_financial_status,
    meta_upload_id,
    meta_operation_key,
    meta_review_fingerprint_sha256
  )
  VALUES (
    p_month,
    p_preclosure_revision,
    'meta_invoice',
    p_proof_type,
    p_document_reference,
    v_upload.document_sha256,
    p_amount_brl_cents,
    NULL,
    'manual_document_review',
    p_actor_id,
    pg_catalog.clock_timestamp(),
    p_status,
    p_upload_id,
    p_operation_key,
    p_review_fingerprint_sha256
  )
  RETURNING id INTO v_new_id;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'outcome', 'inserted',
    'evidence_id', v_new_id
  );
END;
$function$;

-- A função nasce indisponível para a aplicação.
-- Uma migration posterior somente concederá EXECUTE
-- após a rota administrativa segura estar pronta.
REVOKE ALL ON FUNCTION
public.zion_admin_register_verified_meta_evidence_by_system(
  date,integer,bigint,text,text,bigint,text,text,uuid,uuid
)
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;