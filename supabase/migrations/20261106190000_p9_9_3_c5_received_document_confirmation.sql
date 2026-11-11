-- ZION | P9.9.3-C.5
-- Materializa a mensagem ao cliente somente depois da decisao SIM persistida.
-- Nao chama Meta; o sender e o guard central continuam sendo a autoridade de envio.

BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_received_contract_document_confirmation_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_notification_id uuid,
  p_contract_id uuid,
  p_contract_version_id uuid,
  p_evidence_source_message_id uuid,
  p_customer_name text DEFAULT NULL
)
RETURNS TABLE (
  message_id uuid,
  outbound_idempotency_key text,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_key text;
  v_source public.messages;
  v_existing public.messages;
  v_inserted public.messages;
  v_event public.store_business_events;
  v_contract public.sales_contracts;
  v_version public.sales_contract_versions;
  v_name text := nullif(pg_catalog.btrim(coalesce(p_customer_name, '')), '');
BEGIN
  IF public.zion_resolve_request_role_internal() IS DISTINCT FROM 'service_role'
     OR p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_conversation_id IS NULL
     OR p_notification_id IS NULL
     OR p_contract_id IS NULL
     OR p_contract_version_id IS NULL
     OR p_evidence_source_message_id IS NULL THEN
    RAISE EXCEPTION USING
      errcode = '42501',
      message = 'P9_9_3_C5_CONFIRMATION_NOT_AUTHORIZED_OR_INVALID';
  END IF;

  SELECT message_row.*
    INTO v_source
    FROM public.messages message_row
   WHERE message_row.id = p_evidence_source_message_id
     AND message_row.organization_id = p_organization_id
     AND message_row.store_id = p_store_id
     AND message_row.conversation_id = p_conversation_id
     AND message_row.direction = 'incoming'
     AND message_row.sender = 'user'
     AND message_row.message_type = 'document'
     AND message_row.deleted_at IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = 'P9_9_3_C5_CONFIRMATION_SOURCE_SCOPE_INVALID';
  END IF;

  SELECT event_row.*
    INTO v_event
    FROM public.store_business_events event_row
   WHERE event_row.organization_id = p_organization_id
     AND event_row.store_id = p_store_id
     AND event_row.conversation_id = p_conversation_id
     AND event_row.event_key = 'contrato_conferencia_documental'
     AND event_row.event_payload ->> 'schema' = 'received_contract_document_decision_v1'
     AND event_row.event_payload ->> 'notification_id' = p_notification_id::text
     AND event_row.event_payload ->> 'decision' = 'confirmed'
     AND event_row.event_payload ->> 'contract_id' = p_contract_id::text
     AND event_row.event_payload ->> 'contract_version_id' = p_contract_version_id::text
     AND event_row.event_payload ->> 'evidence_source_message_id' = p_evidence_source_message_id::text
   LIMIT 1
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = 'P9_9_3_C5_CONFIRMATION_DECISION_NOT_PERSISTED';
  END IF;

  SELECT contract_row.*
    INTO v_contract
    FROM public.sales_contracts contract_row
   WHERE contract_row.id = p_contract_id
     AND contract_row.organization_id = p_organization_id
     AND contract_row.store_id = p_store_id
     AND contract_row.conversation_id = p_conversation_id
   FOR SHARE;
  IF NOT FOUND OR v_contract.status <> 'completed'
     OR v_contract.current_version_id IS DISTINCT FROM p_contract_version_id THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = 'P9_9_3_C5_CONFIRMATION_CONTRACT_NOT_COMPLETED';
  END IF;

  SELECT version_row.*
    INTO v_version
    FROM public.sales_contract_versions version_row
   WHERE version_row.id = p_contract_version_id
     AND version_row.contract_id = p_contract_id
     AND version_row.organization_id = p_organization_id
     AND version_row.store_id = p_store_id
   FOR SHARE;
  IF NOT FOUND OR v_version.status <> 'completed' THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = 'P9_9_3_C5_CONFIRMATION_VERSION_NOT_COMPLETED';
  END IF;

  v_key := 'received_contract_document_confirmation:' || v_event.id::text;

  SELECT message_row.*
    INTO v_existing
    FROM public.messages message_row
   WHERE message_row.organization_id = p_organization_id
     AND message_row.store_id = p_store_id
     AND message_row.conversation_id = p_conversation_id
     AND message_row.outbound_idempotency_key = v_key
   FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_key, 'replayed'::text;
    RETURN;
  END IF;

  BEGIN
    SELECT *
      INTO v_inserted
      FROM public.insert_message(
        p_conversation_id,
        'ai',
        'outgoing',
        'text',
        CASE
          WHEN v_name IS NULL THEN 'Está tudo certo com seu contrato'
          ELSE v_name || ', está tudo certo com seu contrato'
        END,
        NULL,
        NULL,
        pg_catalog.jsonb_build_object(
          'source', 'received_contract_document_confirmation',
          'channel', 'whatsapp',
          'external_channel', 'whatsapp',
          'send_external', true,
          'outbound_origin', 'received_contract_document_confirmation',
          'outbound_kind', 'received_contract_document_confirmation',
          'source_message_id', p_evidence_source_message_id,
          'organization_id', p_organization_id,
          'store_id', p_store_id,
          'contract_id', p_contract_id,
          'contract_version_id', p_contract_version_id,
          'confirmation_event_id', v_event.id,
          'outbound_idempotency_key', v_key
        )
      );

    UPDATE public.messages
       SET outbound_idempotency_key = v_key,
           outbound_delivery_state = 'pending'
     WHERE id = v_inserted.id
       AND organization_id = p_organization_id
       AND store_id = p_store_id
       AND conversation_id = p_conversation_id
       AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        errcode = '23514',
        message = 'P9_9_3_C5_CONFIRMATION_INSERT_SCOPE_INVALID';
    END IF;
  EXCEPTION WHEN unique_violation THEN
    SELECT message_row.*
      INTO v_existing
      FROM public.messages message_row
     WHERE message_row.organization_id = p_organization_id
       AND message_row.store_id = p_store_id
       AND message_row.conversation_id = p_conversation_id
       AND message_row.outbound_idempotency_key = v_key
     FOR UPDATE;
    IF FOUND THEN
      RETURN QUERY SELECT v_existing.id, v_key, 'replayed'::text;
      RETURN;
    END IF;
    RAISE;
  END;

  RETURN QUERY SELECT v_inserted.id, v_key, 'queued'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_received_contract_document_confirmation_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_received_contract_document_confirmation_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text
) TO service_role;

-- A decisÃ£o histÃ³rica jÃ¡ persiste o contrato correto, mas o evento precisa
-- carregar tambÃ©m a conversa para que o guard possa verificar o escopo final.
DO $decision_scope_patch$
DECLARE
  v_signature constant text :=
    'public.confirm_received_contract_document_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text)';
  v_definition text;
  v_patched text;
  v_old constant text := $$    p_organization_id, p_store_id, v_c.lead_id, NULL,
    'contrato_conferencia_documental'$$;
  v_new constant text := $$    p_organization_id, p_store_id, v_c.lead_id, v_c.conversation_id,
    'contrato_conferencia_documental'$$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_signature::regprocedure)
    INTO v_definition;
  IF v_definition IS NULL THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'P9_9_3_C5_DECISION_RPC_NOT_FOUND';
  END IF;

  IF pg_catalog.strpos(v_definition, v_new) > 0
     AND pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RETURN;
  END IF;

  IF pg_catalog.strpos(v_definition, v_old) = 0
     OR pg_catalog.strpos(v_definition, v_new) > 0 THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'P9_9_3_C5_DECISION_CONVERSATION_SCOPE_PATCH_PATTERN_NOT_FOUND';
  END IF;

  v_patched := pg_catalog.replace(
    v_definition,
    v_old,
    v_new
  );

  IF v_patched = v_definition
     OR pg_catalog.strpos(v_patched, v_new) = 0 THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'P9_9_3_C5_DECISION_CONVERSATION_SCOPE_PATCH_NOT_APPLIED';
  END IF;
  EXECUTE v_patched;
END;
$decision_scope_patch$;

-- Autoridade operacional especÃ­fica da confirmaÃ§Ã£o concluÃ­da. O ACK de
-- recebimento continua sendo uma classificaÃ§Ã£o distinta e nÃ£o autoriza esta
-- mensagem.
DO $guard_patch$
DECLARE
  v_signature constant text :=
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)';
  v_definition text;
  v_patched text;
  v_before text;
  v_changed boolean := false;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_signature::regprocedure)
    INTO v_definition;
  IF v_definition IS NULL THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'P9_9_3_C5_CONFIRMATION_GUARD_NOT_FOUND';
  END IF;

  IF pg_catalog.strpos(
    v_definition,
    $$      'canonical_followup',
      'received_contract_document_ack',
      'received_contract_document_confirmation'
    )$$
  ) > 0 THEN
    v_patched := v_definition;
  ELSIF pg_catalog.strpos(
    v_definition,
    $$      'canonical_followup',
      'received_contract_document_ack'
    )$$
  ) > 0 THEN
    v_patched := pg_catalog.replace(
      v_definition,
      $$      'canonical_followup',
      'received_contract_document_ack'
    )$$,
      $$      'canonical_followup',
      'received_contract_document_ack',
      'received_contract_document_confirmation'
    )$$
    );
    IF v_patched = v_definition THEN
      RAISE EXCEPTION USING errcode = 'P0001',
        message = 'P9_9_3_C5_CONFIRMATION_CLASSIFICATION_PATCH_NOT_APPLIED';
    END IF;
    v_changed := true;
  ELSE
    RAISE EXCEPTION USING errcode = 'P0001',
      message = 'P9_9_3_C5_CONFIRMATION_CLASSIFICATION_PATCH_PATTERN_NOT_FOUND';
  END IF;

  IF pg_catalog.strpos(
    v_patched,
    $$     and v_initial_outbound_kind <> 'received_contract_document_ack'
     and v_initial_outbound_kind <> 'received_contract_document_confirmation' then$$
  ) > 0 THEN
    NULL;
  ELSIF pg_catalog.strpos(
    v_patched,
    $$     and v_initial_outbound_kind <> 'received_contract_document_ack' then$$
  ) > 0 THEN
    v_before := v_patched;
    v_patched := pg_catalog.replace(
      v_patched,
      $$     and v_initial_outbound_kind <> 'received_contract_document_ack' then$$,
      $$     and v_initial_outbound_kind <> 'received_contract_document_ack'
     and v_initial_outbound_kind <> 'received_contract_document_confirmation' then$$
    );
    IF v_patched = v_before THEN
      RAISE EXCEPTION USING errcode = 'P0001',
        message = 'P9_9_3_C5_CONFIRMATION_INITIAL_OPPORTUNITY_PATCH_NOT_APPLIED';
    END IF;
    v_changed := true;
  ELSE
    RAISE EXCEPTION USING errcode = 'P0001',
      message = 'P9_9_3_C5_CONFIRMATION_INITIAL_OPPORTUNITY_PATCH_PATTERN_NOT_FOUND';
  END IF;

  IF pg_catalog.strpos(
    v_patched,
    $$     and v_outbound_kind <> 'received_contract_document_ack'
     and v_outbound_kind <> 'received_contract_document_confirmation' then$$
  ) > 0 THEN
    NULL;
  ELSIF pg_catalog.strpos(
    v_patched,
    $$     and v_outbound_kind <> 'received_contract_document_ack' then$$
  ) > 0 THEN
    v_before := v_patched;
    v_patched := pg_catalog.replace(
      v_patched,
      $$     and v_outbound_kind <> 'received_contract_document_ack' then$$,
      $$     and v_outbound_kind <> 'received_contract_document_ack'
     and v_outbound_kind <> 'received_contract_document_confirmation' then$$
    );
    IF v_patched = v_before THEN
      RAISE EXCEPTION USING errcode = 'P0001',
        message = 'P9_9_3_C5_CONFIRMATION_FINAL_OPPORTUNITY_PATCH_NOT_APPLIED';
    END IF;
    v_changed := true;
  ELSE
    RAISE EXCEPTION USING errcode = 'P0001',
      message = 'P9_9_3_C5_CONFIRMATION_FINAL_OPPORTUNITY_PATCH_PATTERN_NOT_FOUND';
  END IF;

  IF pg_catalog.strpos(
    v_patched,
    $$    if v_outbound_kind = 'received_contract_document_confirmation' then$$
  ) > 0 THEN
    NULL;
  ELSIF pg_catalog.strpos(
    v_patched,
    $$    if v_outbound_kind in ('reactive_ai_reply', 'stop_contact_ack') then$$
  ) > 0 THEN
    v_before := v_patched;
    v_patched := pg_catalog.replace(
      v_patched,
      $$    if v_outbound_kind in ('reactive_ai_reply', 'stop_contact_ack') then$$,
      $$    if v_outbound_kind = 'received_contract_document_confirmation' then
      if nullif(pg_catalog.btrim(coalesce(v_message.metadata ->> 'outbound_origin', '')), '') is distinct from 'received_contract_document_confirmation' then
        v_block_reason := 'received_contract_confirmation_origin_mismatch';
      elsif nullif(pg_catalog.btrim(coalesce(v_message.metadata ->> 'confirmation_event_id', '')), '') is null
         or nullif(pg_catalog.btrim(coalesce(v_message.metadata ->> 'source_message_id', '')), '') is null
         or nullif(pg_catalog.btrim(coalesce(v_message.metadata ->> 'contract_id', '')), '') is null
         or nullif(pg_catalog.btrim(coalesce(v_message.metadata ->> 'contract_version_id', '')), '') is null then
        v_block_reason := 'received_contract_confirmation_identity_required';
      elsif not exists (
        select 1
        from public.store_business_events event_row
        where event_row.id::text = v_message.metadata ->> 'confirmation_event_id'
          and event_row.organization_id = p_organization_id
          and event_row.store_id = p_store_id
          and event_row.conversation_id = v_message.conversation_id
          and event_row.event_key = 'contrato_conferencia_documental'
          and event_row.event_payload ->> 'schema' = 'received_contract_document_decision_v1'
          and event_row.event_payload ->> 'decision' = 'confirmed'
          and event_row.event_payload ->> 'contract_id' = v_message.metadata ->> 'contract_id'
          and event_row.event_payload ->> 'contract_version_id' = v_message.metadata ->> 'contract_version_id'
          and event_row.event_payload ->> 'evidence_source_message_id' = v_message.metadata ->> 'source_message_id'
      ) then
        v_block_reason := 'received_contract_confirmation_event_scope_mismatch';
      elsif not exists (
        select 1
        from public.sales_contracts contract_row
        where contract_row.id::text = v_message.metadata ->> 'contract_id'
          and contract_row.organization_id = p_organization_id
          and contract_row.store_id = p_store_id
          and contract_row.conversation_id = v_message.conversation_id
          and contract_row.status = 'completed'
          and contract_row.current_version_id::text = v_message.metadata ->> 'contract_version_id'
      ) then
        v_block_reason := 'received_contract_confirmation_contract_not_completed';
      elsif not exists (
        select 1
        from public.sales_contract_versions version_row
        where version_row.id::text = v_message.metadata ->> 'contract_version_id'
          and version_row.contract_id::text = v_message.metadata ->> 'contract_id'
          and version_row.organization_id = p_organization_id
          and version_row.store_id = p_store_id
          and version_row.status = 'completed'
      ) then
        v_block_reason := 'received_contract_confirmation_version_not_completed';
      elsif not exists (
        select 1
        from public.messages source_row
        where source_row.id::text = v_message.metadata ->> 'source_message_id'
          and source_row.organization_id = p_organization_id
          and source_row.store_id = p_store_id
          and source_row.conversation_id = v_message.conversation_id
          and source_row.sender = 'user'
          and source_row.direction = 'incoming'
          and source_row.message_type = 'document'
          and source_row.deleted_at is null
      ) then
        v_block_reason := 'received_contract_confirmation_source_scope_mismatch';
      end if;
    elsif v_outbound_kind in ('reactive_ai_reply', 'stop_contact_ack') then$$
    );
    IF v_patched = v_before THEN
      RAISE EXCEPTION USING errcode = 'P0001',
        message = 'P9_9_3_C5_CONFIRMATION_GUARD_PATCH_NOT_APPLIED';
    END IF;
    v_changed := true;
  ELSE
    RAISE EXCEPTION USING errcode = 'P0001',
      message = 'P9_9_3_C5_CONFIRMATION_BRANCH_ANCHOR_NOT_FOUND';
  END IF;

  IF v_patched IS NULL
     OR pg_catalog.strpos(v_patched, 'received_contract_document_confirmation') = 0
     OR pg_catalog.strpos(v_patched, 'received_contract_confirmation_origin_mismatch') = 0 THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'P9_9_3_C5_CONFIRMATION_GUARD_PATCH_NOT_APPLIED';
  END IF;
  IF v_changed THEN
    EXECUTE v_patched;
  END IF;
END;
$guard_patch$;

COMMIT;
