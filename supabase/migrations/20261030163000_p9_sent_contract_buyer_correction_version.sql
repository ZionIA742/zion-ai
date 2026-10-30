-- ZION / Pilar 9.9.15 | Correcao de dados do comprador de contrato JA enviado.
-- Instalacao apenas: nao cria versoes, nao altera contratos e nao envia WhatsApp.
-- O responsavel autenticado e autorizado e validado pela rota server-side antes
-- de invocar a RPC com service_role. A RPC revalida escopo e estado no banco.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.sales_contracts') IS NULL
     OR pg_catalog.to_regclass('public.sales_contract_versions') IS NULL
     OR pg_catalog.to_regclass('public.p9_sales_contract_send_barriers') IS NULL
     OR pg_catalog.to_regclass('public.messages') IS NULL
     OR pg_catalog.to_regprocedure(
          'public.create_sales_contract_version_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,bigint,text,jsonb)'
        ) IS NULL
     OR pg_catalog.to_regprocedure(
          'public.p9_acquire_sales_contract_send_domain_lock(uuid,uuid,uuid)'
        ) IS NULL THEN
    RAISE EXCEPTION 'P9_BUYER_CORRECTION_DEPENDENCY_MISSING';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.create_sales_contract_buyer_correction_version_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_contract_id uuid,
  p_expected_sent_version_id uuid,
  p_human_actor_id uuid,
  p_corrected_buyer jsonb,
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
    NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    NULLIF(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
  );
  v_contract public.sales_contracts%ROWTYPE;
  v_previous public.sales_contract_versions%ROWTYPE;
  v_existing public.sales_contract_versions%ROWTYPE;
  v_written record;
  v_opportunity_id uuid;
  v_old_customer jsonb;
  v_new_customer jsonb;
  v_name text;
  v_phone text;
  v_document text;
  v_email text;
  v_address text;
  v_key text := NULLIF(pg_catalog.btrim(p_operation_key), '');
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'P9_BUYER_CORRECTION_UNAUTHORIZED';
  END IF;

  IF p_organization_id IS NULL OR p_store_id IS NULL OR p_contract_id IS NULL
     OR p_expected_sent_version_id IS NULL OR p_human_actor_id IS NULL
     OR v_key IS NULL OR pg_catalog.length(v_key) > 200
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_content_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_pdf_sha256 !~ '^[0-9a-f]{64}$'
     OR p_request_fingerprint IS NULL OR p_content_fingerprint IS NULL
     OR p_pdf_sha256 IS NULL
     OR pg_catalog.jsonb_typeof(p_corrected_buyer) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(p_contract_snapshot) IS DISTINCT FROM 'object'
     OR p_store_file_id IS NULL
     OR p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'P9_BUYER_CORRECTION_ARGUMENTS_INVALID';
  END IF;

  -- Somente as cinco propriedades do comprador; nenhuma clausula comercial.
  IF (p_corrected_buyer - ARRAY['name','phone','document','email','address']) <> '{}'::jsonb
     OR NOT (p_corrected_buyer ? 'name')
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_each(p_corrected_buyer) AS item(k,val)
       WHERE pg_catalog.jsonb_typeof(item.val) NOT IN ('string','null')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'P9_BUYER_CORRECTION_BUYER_FIELDS_INVALID';
  END IF;

  v_name := NULLIF(pg_catalog.btrim(p_corrected_buyer->>'name'), '');
  v_phone := NULLIF(pg_catalog.btrim(p_corrected_buyer->>'phone'), '');
  v_document := NULLIF(pg_catalog.btrim(p_corrected_buyer->>'document'), '');
  v_email := NULLIF(pg_catalog.btrim(p_corrected_buyer->>'email'), '');
  v_address := NULLIF(pg_catalog.btrim(p_corrected_buyer->>'address'), '');
  IF v_name IS NULL OR pg_catalog.length(v_name) > 200
     OR pg_catalog.length(COALESCE(v_phone,'')) > 50
     OR pg_catalog.length(COALESCE(v_document,'')) > 32
     OR pg_catalog.length(COALESCE(v_email,'')) > 254
     OR pg_catalog.length(COALESCE(v_address,'')) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'P9_BUYER_CORRECTION_BUYER_VALUE_INVALID';
  END IF;

  -- Identidade inicial sem lock; lock de dominio antes dos locks relacionais.
  SELECT NULLIF(c.metadata->>'commercial_opportunity_id','')::uuid
    INTO v_opportunity_id
  FROM public.sales_contracts c
  WHERE c.id = p_contract_id AND c.organization_id = p_organization_id
    AND c.store_id = p_store_id;
  IF NOT FOUND OR v_opportunity_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_BUYER_CORRECTION_CONTRACT_SCOPE_INVALID';
  END IF;
  PERFORM public.p9_acquire_sales_contract_send_domain_lock(
    p_organization_id, p_store_id, v_opportunity_id
  );

  SELECT c.* INTO v_contract FROM public.sales_contracts c
  WHERE c.id = p_contract_id AND c.organization_id = p_organization_id
    AND c.store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND OR v_contract.metadata->>'commercial_opportunity_id'
        IS DISTINCT FROM v_opportunity_id::text
     OR v_contract.metadata->>'created_via'
        IS DISTINCT FROM 'create_sales_contract_manual_by_system'
     OR v_contract.metadata->>'source' IS DISTINCT FROM 'responsible_text_draft'
     OR v_contract.quote_id IS NOT NULL OR v_contract.quote_version_id IS NOT NULL
     OR v_contract.metadata->>'commercial_amounts_authoritative' IS DISTINCT FROM 'false'
     OR v_contract.current_version_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_BUYER_CORRECTION_CONTRACT_INVALID';
  END IF;

  SELECT v.* INTO v_previous FROM public.sales_contract_versions v
  WHERE v.id = p_expected_sent_version_id
    AND v.contract_id = p_contract_id
    AND v.organization_id = p_organization_id AND v.store_id = p_store_id
  FOR SHARE;
  IF NOT FOUND OR v_previous.status IS DISTINCT FROM 'sent'
     OR v_previous.sent_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_BUYER_CORRECTION_PREVIOUS_NOT_SENT';
  END IF;

  -- Replay da mesma operacao: nao altera a aprovacao, o envio ou o contrato.
  SELECT v.* INTO v_existing FROM public.sales_contract_versions v
  WHERE v.contract_id = p_contract_id
    AND v.organization_id = p_organization_id AND v.store_id = p_store_id
    AND v.operation_key = v_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint
       OR v_existing.content_fingerprint IS DISTINCT FROM p_content_fingerprint
       OR v_existing.pdf_sha256 IS DISTINCT FROM p_pdf_sha256
       OR v_existing.contract_snapshot - 'materialized_at'
           IS DISTINCT FROM p_contract_snapshot - 'materialized_at'
       OR v_existing.contract_snapshot->'buyer_correction'->>'previous_version_id'
           IS DISTINCT FROM p_expected_sent_version_id::text
       OR v_existing.contract_snapshot->'buyer_correction'->>'actor_user_id'
           IS DISTINCT FROM p_human_actor_id::text THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'P9_BUYER_CORRECTION_REPLAY_CONFLICT';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.contract_id,
      v_existing.organization_id, v_existing.store_id,
      v_existing.version_number, v_existing.status, true;
    RETURN;
  END IF;

  -- Uma correção nova somente sobre a versão vigente já enviada.
  IF v_contract.status IS DISTINCT FROM 'sent_to_customer'
     OR v_contract.current_version_id IS DISTINCT FROM p_expected_sent_version_id
     OR v_contract.sent_at IS NULL
     OR v_contract.customer_signed_at IS NOT NULL
     OR v_contract.store_signed_at IS NOT NULL
     OR v_contract.completed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_BUYER_CORRECTION_STATUS_OR_VERSION_CHANGED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.p9_sales_contract_send_barriers b
    WHERE b.organization_id = p_organization_id AND b.store_id = p_store_id
      AND b.sales_contract_id = p_contract_id AND b.released_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_BUYER_CORRECTION_ACTIVE_SEND_BARRIER';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.p9_sales_contract_send_barriers b
    JOIN public.messages m ON m.id = b.message_id
      AND m.organization_id = b.organization_id AND m.store_id = b.store_id
    WHERE b.organization_id = p_organization_id AND b.store_id = p_store_id
      AND b.sales_contract_id = p_contract_id
      AND b.sales_contract_version_id = p_expected_sent_version_id
      AND b.released_at IS NOT NULL AND b.release_reason = 'finalized'
      AND m.outbound_delivery_state = 'sent'
      AND m.outbound_commercial_finalized_at IS NOT NULL
      AND m.outbound_provider_accepted_at IS NOT NULL
      AND NULLIF(pg_catalog.btrim(m.external_message_id), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_BUYER_CORRECTION_PRIOR_DELIVERY_NOT_FINALIZED';
  END IF;

  v_old_customer := v_previous.contract_snapshot->'renderer_input'->'customer';
  v_new_customer := p_contract_snapshot->'renderer_input'->'customer';
  IF pg_catalog.jsonb_typeof(v_old_customer) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(v_new_customer) IS DISTINCT FROM 'object'
     OR v_new_customer - ARRAY['name','phone','document','email','address']
        IS DISTINCT FROM v_old_customer - ARRAY['name','phone','document','email','address']
     OR NULLIF(pg_catalog.btrim(v_new_customer->>'name'),'') IS DISTINCT FROM v_name
     OR NULLIF(pg_catalog.btrim(v_new_customer->>'phone'),'') IS DISTINCT FROM v_phone
     OR NULLIF(pg_catalog.btrim(v_new_customer->>'document'),'') IS DISTINCT FROM v_document
     OR NULLIF(pg_catalog.btrim(v_new_customer->>'email'),'') IS DISTINCT FROM v_email
     OR NULLIF(pg_catalog.btrim(v_new_customer->>'address'),'') IS DISTINCT FROM v_address
     OR (p_contract_snapshot->'renderer_input') - 'customer'
        IS DISTINCT FROM (v_previous.contract_snapshot->'renderer_input') - 'customer'
     OR p_contract_snapshot - ARRAY['renderer_input','content_fingerprint','materialized_at','text_provenance','buyer_correction']
        IS DISTINCT FROM v_previous.contract_snapshot - ARRAY['renderer_input','content_fingerprint','materialized_at','text_provenance','buyer_correction']
     -- O PDF textual corrigido foi reconstruido a partir do texto anterior.
     -- A proveniencia original (draft/template/revisao) permanece; os hashes
     -- de TEXTO e de PDF mudam. Nao podemos exigir text_sha256 antigo:
     -- isso faria o novo PDF exibir informacoes antigas ou impedir a correcao.
     OR pg_catalog.jsonb_typeof(v_previous.contract_snapshot->'text_provenance')
          IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(p_contract_snapshot->'text_provenance')
          IS DISTINCT FROM 'object'
     OR (p_contract_snapshot->'text_provenance')
          - ARRAY['text_sha256','pdf_sha256','text_representation']
        IS DISTINCT FROM (v_previous.contract_snapshot->'text_provenance')
          - ARRAY['text_sha256','pdf_sha256','text_representation']
     OR p_contract_snapshot->'text_provenance'->>'text_representation'
          IS DISTINCT FROM 'buyer_corrected_text_utf8_exact'
     OR p_contract_snapshot->'text_provenance'->>'text_sha256'
          !~ '^[0-9a-f]{64}$'
     OR p_contract_snapshot->'text_provenance'->>'text_sha256'
          IS NULL
     OR p_contract_snapshot->'text_provenance'->>'text_sha256'
          IS NOT DISTINCT FROM v_previous.contract_snapshot->'text_provenance'->>'text_sha256'
     OR p_contract_snapshot->'text_provenance'->>'pdf_sha256'
          IS DISTINCT FROM p_pdf_sha256
     OR p_pdf_sha256 IS NOT DISTINCT FROM v_previous.pdf_sha256
     OR v_previous.contract_snapshot->'text_provenance'->>'pdf_sha256'
          IS DISTINCT FROM v_previous.pdf_sha256
     OR p_contract_snapshot->'buyer_correction'->>'previous_text_sha256'
          IS DISTINCT FROM v_previous.contract_snapshot->'text_provenance'->>'text_sha256'
     OR p_contract_snapshot->'buyer_correction'->>'corrected_text_sha256'
          IS DISTINCT FROM p_contract_snapshot->'text_provenance'->>'text_sha256'
     OR p_contract_snapshot->'buyer_correction'->>'kind' IS DISTINCT FROM 'buyer_data'
     OR p_contract_snapshot->'buyer_correction'->>'previous_version_id'
          IS DISTINCT FROM p_expected_sent_version_id::text
     OR p_contract_snapshot->'buyer_correction'->>'actor_user_id'
          IS DISTINCT FROM p_human_actor_id::text
     OR p_contract_snapshot->>'content_fingerprint' IS DISTINCT FROM p_content_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_BUYER_CORRECTION_SNAPSHOT_INVALID';
  END IF;
  IF v_name IS NOT DISTINCT FROM v_contract.customer_name
     AND v_phone IS NOT DISTINCT FROM v_contract.customer_phone
     AND v_document IS NOT DISTINCT FROM v_contract.customer_document
     AND v_email IS NOT DISTINCT FROM v_contract.customer_email
     AND v_address IS NOT DISTINCT FROM v_contract.customer_address THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_BUYER_CORRECTION_NO_CHANGE';
  END IF;

  -- Reusa writer canonico: storage, template, escopo e hashes sao revalidados.
  SELECT w.* INTO v_written FROM public.create_sales_contract_version_by_system(
    p_organization_id, p_store_id, p_contract_id,
    v_key, p_request_fingerprint, p_content_fingerprint,
    p_store_file_id, p_storage_bucket, p_storage_path,
    p_original_filename, 'application/pdf', p_size_bytes,
    p_pdf_sha256, p_contract_snapshot
  ) w;
  IF NOT FOUND OR v_written.replayed IS DISTINCT FROM false
     OR v_written.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_BUYER_CORRECTION_VERSION_NOT_CREATED';
  END IF;

  -- A nova versao fica pendente. A versao anterior permanece sent e intacta.
  UPDATE public.sales_contracts c
  SET current_version_id = v_written.id,
      status = 'pending_review',
      approved_at = NULL, approved_by = NULL,
      sent_at = NULL, sent_by = NULL,
      customer_name = v_name,
      customer_phone = v_phone,
      customer_document = v_document,
      customer_email = v_email,
      customer_address = v_address
  WHERE c.id = p_contract_id AND c.organization_id = p_organization_id
    AND c.store_id = p_store_id
    AND c.status = 'sent_to_customer'
    AND c.current_version_id = v_written.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_BUYER_CORRECTION_REVIEW_TRANSITION_LOST';
  END IF;

  RETURN QUERY SELECT v_written.id::uuid, v_written.contract_id::uuid,
    v_written.organization_id::uuid, v_written.store_id::uuid,
    v_written.version_number::integer, v_written.status::text, false;
END;
$function$;

ALTER FUNCTION public.create_sales_contract_buyer_correction_version_by_system(
  uuid,uuid,uuid,uuid,uuid,jsonb,text,text,text,uuid,text,text,text,bigint,text,jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_sales_contract_buyer_correction_version_by_system(
  uuid,uuid,uuid,uuid,uuid,jsonb,text,text,text,uuid,text,text,text,bigint,text,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_contract_buyer_correction_version_by_system(
  uuid,uuid,uuid,uuid,uuid,jsonb,text,text,text,uuid,text,text,text,bigint,text,jsonb
) TO service_role;

DO $postflight$
DECLARE
  v_oid oid := pg_catalog.to_regprocedure(
    'public.create_sales_contract_buyer_correction_version_by_system(uuid,uuid,uuid,uuid,uuid,jsonb,text,text,text,uuid,text,text,text,bigint,text,jsonb)'
  );
BEGIN
  IF v_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_oid AND p.prosecdef AND p.proowner = 'postgres'::regrole
  ) OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'P9_BUYER_CORRECTION_POSTFLIGHT_FAILED';
  END IF;
END;
$postflight$;

COMMIT;
