-- ZION | Pilar 9 | Bloco 9 | 9.3-B
-- Instala apenas a RPC canonica de MATERIALIZACAO do envio de contrato.
-- NAO atualiza get_pending_external_messages_v2, nao instala gate pre-Meta
-- ou finalizacao, nao aciona a Meta, nao cria mensagens na instalacao.
-- A RPC permanece fail-closed para contratos legados ou proposta nao vigente.
-- CUIDADO: a migration antiga 20261008133000 NAO DEVE sobrescrever esta.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $preflight$
DECLARE
  v_activation oid := to_regprocedure('public.p9_activate_sales_contract_send_barrier_internal(uuid,uuid,uuid,uuid,uuid,uuid,text)');
  v_release oid := to_regprocedure('public.p9_release_sales_contract_send_barrier_finalized_internal(uuid,uuid,uuid,uuid,text)');
BEGIN
  IF to_regprocedure('public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'P9_MATERIALIZATION_RPC_ALREADY_EXISTS_REVIEW_REQUIRED';
  END IF;
  IF v_activation IS NULL OR v_release IS NULL OR
     pg_catalog.md5(pg_catalog.pg_get_functiondef(v_activation)) IS DISTINCT FROM 'c11747791670ba1893b66bca9e36e20d' OR
     pg_catalog.md5(pg_catalog.pg_get_functiondef(v_release)) IS DISTINCT FROM '7569448037c2673fa6998f6cfb3d375e' THEN
    RAISE EXCEPTION 'P9_MATERIALIZATION_BARRIER_VERSIONS_CHANGED';
  END IF;
  IF to_regprocedure('public.p9_assert_contract_send_domain_writable_internal(uuid,uuid,uuid)') IS NULL OR
     to_regprocedure('public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)') IS NULL OR
     to_regprocedure('public.insert_message(uuid,text,text,text,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'P9_MATERIALIZATION_REQUIRED_AUTHORITY_MISSING';
  END IF;
  IF pg_catalog.to_regclass('public.p9_sales_contract_send_barriers') IS NULL OR
     pg_catalog.to_regclass('public.sales_contracts') IS NULL OR
     pg_catalog.to_regclass('public.sales_contract_versions') IS NULL OR
     pg_catalog.to_regclass('public.sales_quotes') IS NULL OR
     pg_catalog.to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'P9_MATERIALIZATION_REQUIRED_RELATION_MISSING';
  END IF;
  IF EXISTS (SELECT 1 FROM public.p9_sales_contract_send_barriers) OR
     EXISTS (SELECT 1 FROM public.messages WHERE metadata ->> 'outbound_origin' = 'sales_contract_send' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'P9_MATERIALIZATION_EXISTING_ATTEMPTS_REQUIRE_REVIEW';
  END IF;
  -- A selecao externa precisa permanecer desabilitada nesta instalacao isolada.
  IF to_regprocedure('public.get_pending_external_messages_v2(uuid,uuid,integer,integer)') IS NULL OR
     pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'::regprocedure
     ), 'sales_contract_send') > 0 THEN
    RAISE EXCEPTION 'P9_MATERIALIZATION_EXTERNAL_SELECTOR_NOT_DISABLED';
  END IF;
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(
       'public.p9_guard_sales_contract_send_message()'::regprocedure
     )) IS DISTINCT FROM 'c49a129021cecc81741fcd2591b1cd04' THEN
    RAISE EXCEPTION 'P9_MATERIALIZATION_MESSAGE_GUARD_CHANGED';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.materialize_sales_contract_send_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_contract_id uuid,
  p_contract_version_id uuid,
  p_conversation_id uuid,
  p_message_content text,
  p_message_metadata jsonb,
  p_idempotency_key text,
  p_source text,
  p_actor_user_id uuid
)
RETURNS TABLE (
  message_id uuid,
  outbound_idempotency_key text,
  outbound_delivery_state text,
  sales_contract_id uuid,
  sales_contract_version_id uuid,
  external_message_id text,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public
SET row_security = off
AS $function$
DECLARE
  v_role text := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    NULLIF(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''),
    NULLIF(auth.jwt() ->> 'role', '')
  );
  c public.sales_contracts%ROWTYPE;
  v public.sales_contract_versions%ROWTYPE;
  m public.messages%ROWTYPE;
  v_opportunity_id uuid;
  v_preliminary_quote_id uuid;
  v_key text := NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '');
  v_expected_key text;
  v_guard_state text;
  v_metadata jsonb;
  v_bucket text;
  v_path text;
  v_filename text;
  v_mime text;
BEGIN
  IF (v_role IS DISTINCT FROM 'service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'P9_CONTRACT_SEND_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_organization_id IS NULL OR p_store_id IS NULL OR p_contract_id IS NULL OR
     p_contract_version_id IS NULL OR p_conversation_id IS NULL OR p_actor_user_id IS NULL OR
     p_source IS DISTINCT FROM 'sales_contract_send_route' OR
     NULLIF(pg_catalog.btrim(COALESCE(p_message_content, '')), '') IS NULL OR
     pg_catalog.jsonb_typeof(p_message_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'P9_CONTRACT_SEND_ARGUMENTS_INVALID';
  END IF;
  v_expected_key := 'sales_contract_send:' || p_organization_id::text || ':' ||
    p_store_id::text || ':' || p_contract_id::text || ':' || p_contract_version_id::text;
  IF v_key IS DISTINCT FROM v_expected_key OR pg_catalog.length(v_key) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'P9_CONTRACT_SEND_IDEMPOTENCY_KEY_INVALID';
  END IF;
  IF p_message_metadata ->> 'sent_by_user_id' IS DISTINCT FROM p_actor_user_id::text THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_ACTOR_MISMATCH';
  END IF;

  -- Descoberta de identidade sem row lock. Revalidacao apos locks abaixo.
  SELECT q.commercial_opportunity_id, c0.quote_id
    INTO v_opportunity_id, v_preliminary_quote_id
  FROM public.sales_contracts c0
  JOIN public.sales_quotes q ON q.id = c0.quote_id
    AND q.organization_id = c0.organization_id AND q.store_id = c0.store_id
  WHERE c0.id = p_contract_id AND c0.organization_id = p_organization_id
    AND c0.store_id = p_store_id AND q.commercial_opportunity_id IS NOT NULL;
  IF NOT FOUND OR v_opportunity_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'P9_CONTRACT_SEND_CANONICAL_OPPORTUNITY_NOT_FOUND';
  END IF;

  -- Lock de dominio obrigatoriamente antes de qualquer row lock.
  PERFORM public.p9_acquire_sales_contract_send_domain_lock(
    p_organization_id, p_store_id, v_opportunity_id
  );
  -- Lock da idempotencia dentro do dominio e antes dos locks relacionais.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));

  SELECT * INTO c FROM public.sales_contracts
  WHERE id = p_contract_id AND organization_id = p_organization_id AND store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND OR c.quote_id IS DISTINCT FROM v_preliminary_quote_id OR
     c.conversation_id IS DISTINCT FROM p_conversation_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_CONTRACT_SCOPE_CHANGED';
  END IF;
  SELECT * INTO v FROM public.sales_contract_versions
  WHERE id = p_contract_version_id AND contract_id = c.id
    AND organization_id = p_organization_id AND store_id = p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'P9_CONTRACT_SEND_VERSION_NOT_FOUND';
  END IF;
  v_bucket := NULLIF(pg_catalog.btrim(COALESCE(v.storage_bucket, '')), '');
  v_path := NULLIF(pg_catalog.btrim(COALESCE(v.storage_path, '')), '');
  v_filename := NULLIF(pg_catalog.btrim(COALESCE(v.original_filename, '')), '');
  v_mime := pg_catalog.lower(NULLIF(pg_catalog.btrim(COALESCE(v.mime_type, '')), ''));
  IF v_bucket IS NULL OR v_path IS NULL OR v_filename IS NULL OR v_mime IS DISTINCT FROM 'application/pdf' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_PDF_INVALID';
  END IF;

  SELECT * INTO m FROM public.messages
  WHERE organization_id = p_organization_id AND store_id = p_store_id
    AND outbound_idempotency_key = v_key
  FOR UPDATE;
  IF FOUND THEN
    IF m.deleted_at IS NOT NULL OR m.conversation_id IS DISTINCT FROM p_conversation_id OR
       m.sender IS DISTINCT FROM 'human' OR m.direction IS DISTINCT FROM 'outgoing' OR
       m.message_type IS DISTINCT FROM 'document' OR m.media_url IS DISTINCT FROM v_path OR
       m.metadata ->> 'source' IS DISTINCT FROM 'sales_contract_send_route' OR
       m.metadata ->> 'outbound_origin' IS DISTINCT FROM 'sales_contract_send' OR
       m.metadata ->> 'outbound_idempotency_key' IS DISTINCT FROM v_key OR
       m.metadata ->> 'contract_id' IS DISTINCT FROM c.id::text OR
       m.metadata ->> 'sales_contract_id' IS DISTINCT FROM c.id::text OR
       m.metadata ->> 'sales_contract_version_id' IS DISTINCT FROM v.id::text OR
       m.metadata ->> 'organization_id' IS DISTINCT FROM p_organization_id::text OR
       m.metadata ->> 'store_id' IS DISTINCT FROM p_store_id::text OR
       m.metadata ->> 'storage_bucket' IS DISTINCT FROM v_bucket OR
       m.metadata ->> 'storage_path' IS DISTINCT FROM v_path OR
       m.metadata ->> 'original_file_name' IS DISTINCT FROM v_filename OR
       m.metadata ->> 'sent_by_user_id' IS DISTINCT FROM p_actor_user_id::text OR
       m.metadata ->> 'file_kind' IS DISTINCT FROM 'sales_contract_pdf' OR
       pg_catalog.lower(COALESCE(m.metadata ->> 'mime_type', '')) IS DISTINCT FROM 'application/pdf' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_EXISTING_MESSAGE_SCOPE_MISMATCH';
    END IF;
    RETURN QUERY SELECT m.id, v_key, COALESCE(m.outbound_delivery_state, 'pending'),
      c.id, v.id, m.external_message_id,
      CASE WHEN m.outbound_delivery_state = 'uncertain' THEN 'uncertain'
           WHEN m.external_message_id IS NOT NULL OR m.outbound_delivery_state = 'sent' THEN 'already_sent'
           WHEN m.outbound_delivery_state IN ('failed', 'template_required') THEN 'failed'
           ELSE 'already_queued' END;
    RETURN;
  END IF;

  -- A linhagem canonica toma o lock de oportunidade apos contrato e versao.
  SELECT lineage.guard_state INTO v_guard_state
  FROM public.p9_assert_sales_contract_current_proposal_lineage_internal(
    p_organization_id, p_store_id, c.id
  ) AS lineage;
  IF NOT FOUND OR v_guard_state IS DISTINCT FROM 'current' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_CURRENT_PROPOSAL_NOT_CURRENT';
  END IF;

  IF c.status IS DISTINCT FROM 'approved' OR v.status IS DISTINCT FROM 'approved' OR
     c.current_version_id IS DISTINCT FROM v.id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_NOT_APPROVED_OR_NOT_CURRENT';
  END IF;

  -- Reentrante no mesmo lock de dominio ja obtido. Nova tentativa apenas
  -- quando nao ha barreira ativa naquela oportunidade.
  PERFORM public.p9_assert_contract_send_domain_writable_internal(
    p_organization_id, p_store_id, v_opportunity_id
  );

  v_metadata := p_message_metadata || pg_catalog.jsonb_build_object(
    'source', 'sales_contract_send_route',
    'channel', 'whatsapp',
    'external_channel', 'whatsapp',
    'send_external', true,
    'outbound_origin', 'sales_contract_send',
    'outbound_idempotency_key', v_key,
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'contract_id', c.id,
    'contract_version_id', v.id,
    'sales_contract_id', c.id,
    'sales_contract_version_id', v.id,
    'quote_id', c.quote_id,
    'quote_version_id', c.quote_version_id,
    'attachment_kind', 'file',
    'file_kind', 'sales_contract_pdf',
    'storage_bucket', v_bucket,
    'storage_path', v_path,
    'mime_type', 'application/pdf',
    'original_file_name', v_filename,
    'generated_by', 'system',
    'sent_by_user_id', p_actor_user_id::text
  );

  SELECT * INTO m FROM public.insert_message(
    p_conversation_id, 'human', 'outgoing', 'document',
    p_message_content, NULL, v_path, v_metadata
  );
  IF m.id IS NULL OR m.organization_id IS DISTINCT FROM p_organization_id OR
     m.store_id IS DISTINCT FROM p_store_id OR m.conversation_id IS DISTINCT FROM p_conversation_id OR
     m.sender IS DISTINCT FROM 'human' OR m.direction IS DISTINCT FROM 'outgoing' OR
     m.message_type IS DISTINCT FROM 'document' OR m.media_url IS DISTINCT FROM v_path OR
     m.metadata ->> 'contract_id' IS DISTINCT FROM c.id::text OR
     m.metadata ->> 'outbound_origin' IS DISTINCT FROM 'sales_contract_send' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'P9_CONTRACT_SEND_INSERT_SCOPE_MISMATCH';
  END IF;

  UPDATE public.messages
     SET outbound_idempotency_key = v_key,
         outbound_delivery_state = 'pending',
         outbound_claimed_at = NULL,
         outbound_claimed_by = NULL,
         outbound_attempt_started_at = NULL,
         outbound_provider_accepted_at = NULL,
         outbound_uncertain_at = NULL,
         outbound_error_text = NULL,
         outbound_commercial_finalized_at = NULL,
         outbound_commercial_error_at = NULL,
         outbound_commercial_error_text = NULL
   WHERE id = m.id AND organization_id = p_organization_id AND store_id = p_store_id
     AND deleted_at IS NULL AND external_message_id IS NULL
   RETURNING * INTO m;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'P9_CONTRACT_SEND_OUTBOUND_STATE_NOT_APPLIED';
  END IF;

  RETURN QUERY SELECT m.id, v_key, m.outbound_delivery_state, c.id, v.id,
    m.external_message_id, 'queued'::text;
END;
$function$;

ALTER FUNCTION public.materialize_sales_contract_send_by_system(
  uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.materialize_sales_contract_send_by_system(
  uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_sales_contract_send_by_system(
  uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid
) TO service_role;

DO $postconditions$
DECLARE
  v_oid oid := to_regprocedure('public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)');
BEGIN
  IF v_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid
    AND p.prosecdef AND p.proowner = 'postgres'::regrole
  ) OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'P9_CONTRACT_SEND_MATERIALIZATION_SECURITY_POSTCONDITION_FAILED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.p9_sales_contract_send_barriers) OR
     EXISTS (SELECT 1 FROM public.messages WHERE metadata ->> 'outbound_origin' = 'sales_contract_send' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'P9_CONTRACT_SEND_MATERIALIZATION_UNEXPECTED_SIDE_EFFECT';
  END IF;
  IF to_regprocedure('public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid)') IS NOT NULL OR
     to_regprocedure('public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'P9_CONTRACT_SEND_MATERIALIZATION_OTHER_RPCS_CHANGED';
  END IF;
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'::regprocedure
     ), 'sales_contract_send') > 0 THEN
    RAISE EXCEPTION 'P9_CONTRACT_SEND_MATERIALIZATION_SELECTOR_UNEXPECTEDLY_ENABLED';
  END IF;
END;
$postconditions$;
COMMIT;

SELECT 'PASS' AS resultado,
       'MATERIALIZACAO_CANONICA_INSTALADA' AS correcao,
       pg_catalog.md5(pg_catalog.pg_get_functiondef(
         'public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)'::regprocedure
       )) AS hash_funcao,
       'NAO_HABILITADO' AS envio_externo;
