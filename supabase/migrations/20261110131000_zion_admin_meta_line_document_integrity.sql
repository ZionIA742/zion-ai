BEGIN;

-- ZION-ADM | 2.11-C.6-H
-- Vinculacao individual de cada comprovante Meta.
--
-- O upload armazenado e o hash precisam corresponder.
-- Cada documento pode ter fingerprint independente.
-- A revisao humana ainda deve ocorrer na API segura.
-- Nenhum registro financeiro e autorizado aqui.

DO $check$
BEGIN
  IF to_regclass(
    'public.zion_admin_meta_billing_account_lines'
  ) IS NULL THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_LINE_FOUNDATION_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.zion_admin_meta_billing_account_lines
  ) THEN
    RAISE EXCEPTION
      'ZION_ADMIN_META_LINE_EXISTING_ROWS_REQUIRE_AUDIT';
  END IF;
END;
$check$;

ALTER TABLE public.zion_admin_meta_billing_account_lines
ADD COLUMN document_sha256 text NOT NULL
CHECK (document_sha256 ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION
public.zion_admin_meta_billing_line_guard()
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
    OR v_upload.document_sha256 IS DISTINCT FROM
      NEW.document_sha256
  THEN
    RAISE EXCEPTION 'ZION_ADMIN_META_LINE_UPLOAD_MISMATCH';
  END IF;

  -- O fingerprint de revisao individual permanece
  -- obrigatorio no CHECK da tabela. A verificacao
  -- independente de seu contexto pertence ao
  -- handler administrativo, antes da escrita.
  NEW.recorded_at := clock_timestamp();

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION
public.zion_admin_meta_billing_line_guard()
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;