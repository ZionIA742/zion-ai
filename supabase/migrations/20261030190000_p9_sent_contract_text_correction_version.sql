-- ZION / Pilar 9.9.15: correcao integral do texto de contrato manual enviado.
-- Nova autoridade: nao altera a RPC textual historica nem a RPC de buyer correction.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.sales_contracts') IS NULL
     OR pg_catalog.to_regclass('public.sales_contract_versions') IS NULL
     OR pg_catalog.to_regclass('public.store_files') IS NULL
     OR pg_catalog.to_regclass('public.p9_sales_contract_send_barriers') IS NULL
     OR pg_catalog.to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'P9_TEXT_CORRECTION_DEPENDENCY_MISSING';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.create_sales_contract_text_correction_version_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_contract_id uuid,
  p_expected_sent_version_id uuid,
  p_human_actor_id uuid,
  p_operation_key text,
  p_request_fingerprint text,
  p_content_fingerprint text,
  p_store_file_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_filename text,
  p_size_bytes bigint,
  p_pdf_sha256 text,
  p_contract_snapshot jsonb
)
RETURNS TABLE (
  id uuid,
  contract_id uuid,
  organization_id uuid,
  store_id uuid,
  version_number integer,
  status text,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public
SET row_security = off
AS $function$
DECLARE
  v_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
  );
  v_contract public.sales_contracts%ROWTYPE;
  v_previous public.sales_contract_versions%ROWTYPE;
  v_existing public.sales_contract_versions%ROWTYPE;
  v_version public.sales_contract_versions%ROWTYPE;
  v_opportunity_id uuid;
  v_key text := NULLIF(btrim(p_operation_key), '');
  v_next integer;
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'P9_TEXT_CORRECTION_UNAUTHORIZED';
  END IF;

  IF p_organization_id IS NULL OR p_store_id IS NULL OR p_contract_id IS NULL
     OR p_expected_sent_version_id IS NULL OR p_human_actor_id IS NULL
     OR v_key IS NULL OR length(v_key) > 200
     OR p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_content_fingerprint IS NULL OR p_content_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_pdf_sha256 IS NULL OR p_pdf_sha256 !~ '^[0-9a-f]{64}$'
     OR p_store_file_id IS NULL OR p_size_bytes IS NULL OR p_size_bytes <= 0
     OR jsonb_typeof(p_contract_snapshot) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'P9_TEXT_CORRECTION_ARGUMENTS_INVALID';
  END IF;

  SELECT c.* INTO v_contract
  FROM public.sales_contracts c
  WHERE c.id = p_contract_id
    AND c.organization_id = p_organization_id
    AND c.store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_CORRECTION_CONTRACT_SCOPE_INVALID';
  END IF;

  SELECT v.* INTO v_previous
  FROM public.sales_contract_versions v
  WHERE v.id = p_expected_sent_version_id
    AND v.contract_id = p_contract_id
    AND v.organization_id = p_organization_id
    AND v.store_id = p_store_id
  FOR SHARE;

  IF NOT FOUND OR v_previous.status IS DISTINCT FROM 'sent' OR v_previous.sent_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_CORRECTION_PREVIOUS_NOT_SENT';
  END IF;

  SELECT NULLIF(v_contract.metadata->>'commercial_opportunity_id', '')::uuid
    INTO v_opportunity_id;

  IF v_contract.status IS DISTINCT FROM 'sent_to_customer'
     OR v_contract.current_version_id IS DISTINCT FROM p_expected_sent_version_id
     OR v_contract.sent_at IS NULL
     OR v_contract.customer_signed_at IS NOT NULL
     OR v_contract.store_signed_at IS NOT NULL
     OR v_contract.completed_at IS NOT NULL
     OR v_contract.quote_id IS NOT NULL
     OR v_contract.quote_version_id IS NOT NULL
     OR v_contract.metadata->>'source' IS DISTINCT FROM 'responsible_text_draft'
     OR v_contract.metadata->>'created_via' IS DISTINCT FROM 'create_sales_contract_manual_by_system'
     OR v_contract.metadata->>'commercial_amounts_authoritative' IS DISTINCT FROM 'false'
     OR v_opportunity_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_CORRECTION_CONTRACT_NOT_ELIGIBLE';
  END IF;

  PERFORM public.p9_acquire_sales_contract_send_domain_lock(
    p_organization_id, p_store_id, v_opportunity_id
  );

  IF EXISTS (
    SELECT 1 FROM public.p9_sales_contract_send_barriers b
    WHERE b.organization_id = p_organization_id
      AND b.store_id = p_store_id
      AND b.sales_contract_id = p_contract_id
      AND b.released_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_CORRECTION_ACTIVE_SEND_BARRIER';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.p9_sales_contract_send_barriers b
    JOIN public.messages m
      ON m.id = b.message_id
     AND m.organization_id = b.organization_id
     AND m.store_id = b.store_id
    WHERE b.organization_id = p_organization_id
      AND b.store_id = p_store_id
      AND b.sales_contract_id = p_contract_id
      AND b.sales_contract_version_id = p_expected_sent_version_id
      AND b.released_at IS NOT NULL
      AND b.release_reason = 'finalized'
      AND m.outbound_delivery_state = 'sent'
      AND m.outbound_commercial_finalized_at IS NOT NULL
      AND m.outbound_provider_accepted_at IS NOT NULL
      AND NULLIF(btrim(m.external_message_id), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_CORRECTION_PRIOR_DELIVERY_NOT_FINALIZED';
  END IF;

  SELECT v.* INTO v_existing
  FROM public.sales_contract_versions v
  WHERE v.contract_id = p_contract_id
    AND v.organization_id = p_organization_id
    AND v.store_id = p_store_id
    AND v.operation_key = v_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint
       OR v_existing.content_fingerprint IS DISTINCT FROM p_content_fingerprint
       OR v_existing.pdf_sha256 IS DISTINCT FROM p_pdf_sha256
       OR v_existing.contract_snapshot - ARRAY['materialized_at']
          IS DISTINCT FROM p_contract_snapshot - ARRAY['materialized_at'] THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'P9_TEXT_CORRECTION_OPERATION_CONFLICT';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.contract_id,
      v_existing.organization_id, v_existing.store_id,
      v_existing.version_number, v_existing.status, true;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.store_files sf
    WHERE sf.id = p_store_file_id
      AND sf.organization_id = p_organization_id
      AND sf.store_id = p_store_id
      AND sf.file_kind = 'sales_contract_pdf'
      AND btrim(sf.storage_bucket) = btrim(p_storage_bucket)
      AND btrim(sf.storage_path) = btrim(p_storage_path)
      AND btrim(sf.original_filename) = btrim(p_original_filename)
      AND lower(btrim(sf.mime_type)) = 'application/pdf'
      AND sf.size_bytes = p_size_bytes
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_CORRECTION_STORE_FILE_INVALID';
  END IF;

  IF p_contract_snapshot->>'schema' IS DISTINCT FROM v_previous.contract_snapshot->>'schema'
     OR p_contract_snapshot->'identity' IS DISTINCT FROM v_previous.contract_snapshot->'identity'
     OR p_contract_snapshot->'lineage' IS DISTINCT FROM v_previous.contract_snapshot->'lineage'
     OR p_contract_snapshot->'template_authority' IS DISTINCT FROM v_previous.contract_snapshot->'template_authority'
     OR p_contract_snapshot->'renderer_input' IS DISTINCT FROM v_previous.contract_snapshot->'renderer_input'
     OR p_contract_snapshot - ARRAY['text_provenance','text_correction','content_fingerprint','materialized_at']
        IS DISTINCT FROM v_previous.contract_snapshot - ARRAY['text_provenance','content_fingerprint','materialized_at']
     OR p_contract_snapshot->>'content_fingerprint' IS DISTINCT FROM p_content_fingerprint
     OR p_contract_snapshot->'text_correction'->>'previous_version_id' IS DISTINCT FROM p_expected_sent_version_id::text
     OR p_contract_snapshot->'text_correction'->>'actor_user_id' IS DISTINCT FROM p_human_actor_id::text
     OR p_contract_snapshot->'text_correction'->>'kind' IS DISTINCT FROM 'full_text'
     OR p_contract_snapshot->'text_provenance'->>'text_representation' IS DISTINCT FROM 'manual_contract_corrected_text_utf8_exact'
     OR p_contract_snapshot->'text_provenance'->>'pdf_sha256' IS DISTINCT FROM p_pdf_sha256
     OR p_contract_snapshot->'text_provenance'->>'text_sha256' IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_CORRECTION_SNAPSHOT_INVALID';
  END IF;

  SELECT coalesce(max(v.version_number), 0) + 1 INTO v_next
  FROM public.sales_contract_versions v
  WHERE v.contract_id = p_contract_id
    AND v.organization_id = p_organization_id
    AND v.store_id = p_store_id;

  INSERT INTO public.sales_contract_versions (
    contract_id, organization_id, store_id, version_number, status,
    store_file_id, storage_bucket, storage_path, original_filename,
    mime_type, size_bytes, generated_by, generated_at, contract_snapshot,
    operation_key, request_fingerprint, content_fingerprint, pdf_sha256
  ) VALUES (
    p_contract_id, p_organization_id, p_store_id, v_next, 'generated',
    p_store_file_id, p_storage_bucket, p_storage_path, p_original_filename,
    'application/pdf', p_size_bytes, 'system', clock_timestamp(), p_contract_snapshot,
    v_key, p_request_fingerprint, p_content_fingerprint, p_pdf_sha256
  ) RETURNING * INTO v_version;

  UPDATE public.sales_contracts
  SET current_version_id = v_version.id,
      status = 'pending_review',
      approved_at = NULL,
      approved_by = NULL,
      sent_at = NULL,
      sent_by = NULL
  WHERE id = p_contract_id
    AND organization_id = p_organization_id
    AND store_id = p_store_id
    AND current_version_id = p_expected_sent_version_id
    AND status = 'sent_to_customer';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_TEXT_CORRECTION_REVIEW_TRANSITION_LOST';
  END IF;

  RETURN QUERY SELECT v_version.id, v_version.contract_id,
    v_version.organization_id, v_version.store_id,
    v_version.version_number, v_version.status, false;
END;
$function$;

ALTER FUNCTION public.create_sales_contract_text_correction_version_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, text, bigint, text, jsonb
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_sales_contract_text_correction_version_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, text, bigint, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_sales_contract_text_correction_version_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, text, bigint, text, jsonb
) TO service_role;

COMMIT;
