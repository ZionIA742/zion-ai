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
     pg_catalog.md5(pg_catalog.pg_get_functiondef(v_materializer)) IS DISTINCT FROM 'e776956f4a9f74d2b69d3c4fc056704b' OR
     pg_catalog.md5(pg_catalog.pg_get_functiondef(v_gate)) IS DISTINCT FROM 'dd01ee46e783fc6ee39d0e53db484154' OR
     pg_catalog.md5(pg_catalog.pg_get_functiondef(v_finalizer)) IS DISTINCT FROM '1604483d9b04c19d1941522f2c7e637d' THEN
    RAISE EXCEPTION 'P9_SELECTOR_CANONICAL_RPCS_NOT_VALIDATED';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_materializer, 'EXECUTE') OR
     NOT pg_catalog.has_function_privilege('service_role', v_gate, 'EXECUTE') OR
     NOT pg_catalog.has_function_privilege('service_role', v_finalizer, 'EXECUTE') OR
     pg_catalog.has_function_privilege('authenticated', v_gate, 'EXECUTE') OR
     pg_catalog.has_function_privilege('anon', v_gate, 'EXECUTE') THEN
    RAISE EXCEPTION 'P9_SELECTOR_CANONICAL_RPC_PERMISSIONS_CHANGED';
  END IF;
  -- Nenhuma barreira contratual preexistente pode estar ativa ou historica
  -- sem conciliacao explicita antes desta primeira ativacao.
  IF EXISTS (
    SELECT 1 FROM public.p9_sales_contract_send_barriers
  ) THEN
    RAISE EXCEPTION 'P9_SELECTOR_EXISTING_CONTRACT_BARRIERS';
  END IF;

  -- Permitir fila vazia ou exclusivamente a mensagem historica
  -- ja reconciliada. Qualquer outra mensagem contratual aborta.
  IF EXISTS (
    SELECT 1
    FROM public.messages AS m
    WHERE (
      COALESCE(m.metadata ->> 'outbound_origin', '') =
        'sales_contract_send'
      OR COALESCE(m.outbound_idempotency_key, '') LIKE
        'sales_contract_send:%'
    )
    AND (
      m.id =
        '81ed84bc-6b02-449b-94a6-d8ae058657b4'::uuid
      AND m.organization_id =
        'b02252ce-0e73-4371-9e23-f1009e7b1698'::uuid
      AND m.store_id =
        '6ac8f4b1-e50f-42c0-9cae-78951d6daf7b'::uuid
      AND m.outbound_idempotency_key IS NOT DISTINCT FROM
        'sales_contract_send:b02252ce-0e73-4371-9e23-f1009e7b1698:6ac8f4b1-e50f-42c0-9cae-78951d6daf7b:70cd906d-a980-4a50-b241-a044a3d9cb6c:8f7f80b3-c189-4711-af77-eda97a840cae'
      AND m.sender = 'human'
      AND m.direction = 'outgoing'
      AND m.message_type = 'document'
      AND COALESCE(m.metadata ->> 'outbound_origin', '') =
        'sales_contract_send'
      AND COALESCE(m.metadata ->> 'source', '') =
        'sales_contract_send_route'
      AND COALESCE(m.metadata ->> 'file_kind', '') =
        'sales_contract_pdf'
      AND COALESCE(m.metadata ->> 'send_external', '') = 'true'
      AND COALESCE(m.metadata ->> 'external_channel', '') =
        'whatsapp'
      AND COALESCE(m.metadata ->> 'sales_contract_id', '') =
        '70cd906d-a980-4a50-b241-a044a3d9cb6c'
      AND COALESCE(
        m.metadata ->> 'sales_contract_version_id', ''
      ) = '8f7f80b3-c189-4711-af77-eda97a840cae'
      AND m.outbound_delivery_state = 'failed'
      AND m.outbound_error_text =
        'P9_CONTRACT_SEND_OBSOLETE_VERSION_NOT_CURRENT'
      AND m.deleted_at IS NULL
      AND m.outbound_claimed_at IS NULL
      AND m.outbound_claimed_by IS NULL
      AND m.outbound_attempt_started_at IS NULL
      AND m.outbound_uncertain_at IS NULL
      AND m.outbound_provider_accepted_at IS NULL
      AND m.external_message_id IS NULL
      AND m.outbound_commercial_finalized_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.sales_contracts AS c
        JOIN public.sales_contract_versions AS current_v
          ON current_v.contract_id = c.id
         AND current_v.id = c.current_version_id
        JOIN public.sales_contract_versions AS previous_v
          ON previous_v.contract_id = c.id
         AND previous_v.id =
           '8f7f80b3-c189-4711-af77-eda97a840cae'::uuid
        WHERE c.id =
          '70cd906d-a980-4a50-b241-a044a3d9cb6c'::uuid
          AND c.organization_id = m.organization_id
          AND c.store_id = m.store_id
          AND c.status = 'pending_review'
          AND c.current_version_id =
            'b9cbd144-976a-42e1-bf0d-d97f0da06b3a'::uuid
          AND current_v.status = 'generated'
          AND previous_v.status = 'approved'
      )
    ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION
      'P9_SELECTOR_UNRECONCILED_CONTRACT_MESSAGE';
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
