-- ZION | Pilar 9 | Bloco 9 | Etapa 9.3-B
-- Ativacao controlada da selecao externa de PDFs contratuais.
-- ATENCAO: A EXECUCAO DESTA MIGRATION HABILITA O ENVIO EXTERNO DE CONTRATOS.
-- SOMENTE SALVAR NO REPOSITORIO AGORA. NAO EXECUTAR NO SUPABASE SEM VALIDACAO.
-- Mantem demais origens e invariantes da fila; 'uncertain' nao e selecionado.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $preflight$
DECLARE
  v_selector oid := to_regprocedure('public.get_pending_external_messages_v2(uuid,uuid,integer,integer)');
  v_materializer oid := to_regprocedure('public.materialize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)');
  v_gate oid := to_regprocedure('public.validate_or_start_sales_contract_send_by_system(uuid,uuid,uuid)');
  v_finalizer oid := to_regprocedure('public.finalize_sales_contract_send_by_system(uuid,uuid,uuid,uuid,uuid,text,text)');
BEGIN
  IF v_selector IS NULL OR
     pg_catalog.md5(pg_catalog.pg_get_functiondef(v_selector)) IS DISTINCT FROM '8207fc2b9cbbaafde6552654c4f863d8' THEN
    RAISE EXCEPTION 'P9_SELECTOR_CURRENT_VERSION_DIVERGENT';
  END IF;
  IF v_materializer IS NULL OR v_gate IS NULL OR v_finalizer IS NULL OR
     pg_catalog.md5(pg_catalog.pg_get_functiondef(v_materializer)) IS DISTINCT FROM '8b236586cf6816b824a9778dd218f4d9' OR
     pg_catalog.md5(pg_catalog.pg_get_functiondef(v_gate)) IS DISTINCT FROM '15cad4d9bd0ea0516363513a1d1749ce' OR
     pg_catalog.md5(pg_catalog.pg_get_functiondef(v_finalizer)) IS DISTINCT FROM '57e3fe3b4f8c0be76526b5ef9b6a7d2e' THEN
    RAISE EXCEPTION 'P9_SELECTOR_CANONICAL_RPCS_NOT_VALIDATED';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_materializer, 'EXECUTE') OR
     NOT pg_catalog.has_function_privilege('service_role', v_gate, 'EXECUTE') OR
     NOT pg_catalog.has_function_privilege('service_role', v_finalizer, 'EXECUTE') OR
     pg_catalog.has_function_privilege('authenticated', v_gate, 'EXECUTE') OR
     pg_catalog.has_function_privilege('anon', v_gate, 'EXECUTE') THEN
    RAISE EXCEPTION 'P9_SELECTOR_CANONICAL_RPC_PERMISSIONS_CHANGED';
  END IF;
  -- Nao habilitar caso ja existam tentativas que dependam de reconciliacao.
  IF EXISTS (SELECT 1 FROM public.p9_sales_contract_send_barriers) OR
     EXISTS (
       SELECT 1 FROM public.messages
       WHERE metadata ->> 'outbound_origin' = 'sales_contract_send'
         AND deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'P9_SELECTOR_EXISTING_CONTRACT_ATTEMPTS_REQUIRE_REVIEW';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.get_pending_external_messages_v2(p_organization_id uuid, p_store_id uuid, p_limit integer DEFAULT 50, p_processing_lease_seconds integer DEFAULT 600)
 RETURNS TABLE(message_id uuid, organization_id uuid, store_id uuid, conversation_id uuid, lead_id uuid, lead_phone text, message_type text, content text, media_url text, metadata jsonb, created_at timestamp with time zone, external_message_id text, outbound_delivery_state text, outbound_idempotency_key text, outbound_claimed_at timestamp with time zone, outbound_attempt_started_at timestamp with time zone, outbound_provider_accepted_at timestamp with time zone, outbound_commercial_finalized_at timestamp with time zone, outbound_commercial_error_text text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp', 'public'
AS $function$
  select
    message_row.id as message_id,
    message_row.organization_id,
    message_row.store_id,
    message_row.conversation_id,
    conversation_row.lead_id,
    lead_row.phone as lead_phone,
    message_row.message_type,
    message_row.content,
    message_row.media_url,
    coalesce(message_row.metadata, '{}'::jsonb) as metadata,
    message_row.created_at,
    message_row.external_message_id,
    message_row.outbound_delivery_state,
    message_row.outbound_idempotency_key,
    message_row.outbound_claimed_at,
    message_row.outbound_attempt_started_at,
    message_row.outbound_provider_accepted_at,
    message_row.outbound_commercial_finalized_at,
    message_row.outbound_commercial_error_text
  from public.messages as message_row
  join public.conversations as conversation_row
    on conversation_row.id = message_row.conversation_id
   and conversation_row.organization_id = message_row.organization_id
  join public.leads as lead_row
    on lead_row.id = conversation_row.lead_id
   and lead_row.organization_id = message_row.organization_id
   and lead_row.store_id = message_row.store_id
  where message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
    and (
      (
        message_row.sender = 'ai'
        and coalesce(message_row.metadata ->> 'outbound_origin', '') <> 'sales_contract_send'
        and message_row.message_type in ('text', 'image', 'document')
      )
      or (
        message_row.sender = 'human'
        and coalesce(message_row.metadata ->> 'outbound_origin', '') in (
          'crm_manual_text',
          'crm_manual_image',
          'crm_manual_document'
        )
        and message_row.message_type in ('text', 'image', 'document')
      )
      or (
        message_row.sender = 'human'
        and coalesce(message_row.metadata ->> 'outbound_origin', '') = 'sales_quote_send'
        and message_row.message_type in ('text', 'image', 'document')
      )
      or (
        message_row.sender = 'human'
        and coalesce(message_row.metadata ->> 'outbound_origin', '') = 'sales_contract_send'
        and message_row.message_type = 'document'
        and coalesce(message_row.metadata ->> 'file_kind', '') = 'sales_contract_pdf'
        and coalesce(message_row.metadata ->> 'source', '') = 'sales_contract_send_route'
      )
      or (
        message_row.sender = 'human'
        and coalesce(message_row.metadata ->> 'outbound_origin', '') = 'crm_manual_audio'
        and message_row.message_type = 'audio'
      )
      or (
        message_row.sender = 'human'
        and coalesce(message_row.metadata ->> 'outbound_origin', '') = 'crm_manual_video'
        and message_row.message_type = 'video'
      )
    )
    and message_row.direction = 'outgoing'
    and message_row.external_message_id is null
    and message_row.deleted_at is null
    and coalesce(message_row.metadata ->> 'send_external', 'false') = 'true'
    and coalesce(message_row.metadata ->> 'external_channel', '') = 'whatsapp'
    and (
      coalesce(message_row.outbound_delivery_state, 'pending') = 'pending'
      or (
        message_row.outbound_delivery_state = 'processing'
        and message_row.outbound_attempt_started_at is null
        and message_row.outbound_claimed_at is not null
        and message_row.outbound_claimed_at < (
          clock_timestamp()
          - make_interval(
              secs => greatest(coalesce(p_processing_lease_seconds, 600), 1)
            )
        )
      )
    )
  order by
    coalesce(message_row.outbound_claimed_at, message_row.created_at) asc,
    message_row.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$function$;

-- Contrato habilitado somente na ramificacao humana documental especifica.
DO $postflight$
DECLARE
  v_selector oid := to_regprocedure('public.get_pending_external_messages_v2(uuid,uuid,integer,integer)');
  v_body text := pg_catalog.pg_get_functiondef(v_selector);
BEGIN
  IF v_selector IS NULL OR
     pg_catalog.strpos(v_body, '''sales_contract_send''') = 0 OR
     pg_catalog.strpos(v_body, '''sales_contract_pdf''') = 0 OR
     pg_catalog.strpos(v_body, '''sales_contract_send_route''') = 0 OR
     pg_catalog.strpos(v_body, '<> ''sales_contract_send''') = 0 OR
     pg_catalog.strpos(v_body, '''sales_quote_send''') = 0 OR
     pg_catalog.strpos(v_body, '''crm_manual_text''') = 0 OR
     pg_catalog.strpos(v_body, '''crm_manual_audio''') = 0 OR
     pg_catalog.strpos(v_body, '''crm_manual_video''') = 0 OR
     pg_catalog.strpos(pg_catalog.lower(v_body), 'outbound_attempt_started_at is null') = 0 THEN
    RAISE EXCEPTION 'P9_SELECTOR_POSTCONDITION_FAILED';
  END IF;
END;
$postflight$;

COMMIT;

SELECT
  'PASS' AS resultado,
  'SELECTOR_CONTRATO_HABILITADO' AS correcao,
  pg_catalog.md5(pg_catalog.pg_get_functiondef(
    'public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'::pg_catalog.regprocedure
  )) AS hash_seletor,
  'ATIVO_APOS_EXECUCAO' AS envio_externo;
