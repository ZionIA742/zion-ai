-- ZION | P9.9.3 C.5
-- Autoriza somente o ACK operacional de documento recebido no guard central.
-- O ACK permanece sem oportunidade comercial: a origem documental exata e o
-- escopo tenant/conversa são a autoridade desta mensagem.

BEGIN;

DO $patch$
DECLARE
  v_ack_definition text;
  v_ack_patched text;
  v_definition text;
  v_patched text;
  v_ack_signature constant text :=
    'public.enqueue_received_contract_document_ack_by_system(uuid,uuid,uuid,uuid,text)';
  v_signature constant text :=
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)';
BEGIN
  SELECT pg_get_functiondef(v_ack_signature::regprocedure)
    INTO v_ack_definition;

  IF v_ack_definition IS NULL THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'P9_9_3_C5_RECEIVED_DOCUMENT_ACK_RPC_NOT_FOUND';
  END IF;

  v_ack_patched := replace(
    v_ack_definition,
    $$'outbound_origin', 'received_contract_document_ack',
          'source_message_id'$$,
    $$'outbound_origin', 'received_contract_document_ack',
          'outbound_kind', 'received_contract_document_ack',
          'source_message_id'$$
  );

  IF v_ack_patched = v_ack_definition
     OR position('outbound_kind' in v_ack_patched) = 0 THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'P9_9_3_C5_RECEIVED_DOCUMENT_ACK_RPC_PATCH_NOT_APPLIED';
  END IF;

  EXECUTE v_ack_patched;

  SELECT pg_get_functiondef(v_signature::regprocedure)
    INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'P9_9_3_C5_EXTERNAL_SEND_GUARD_NOT_FOUND';
  END IF;

  v_patched := replace(
    v_definition,
    $$'stop_contact_ack',
      'canonical_followup'$$,
    $$'stop_contact_ack',
      'canonical_followup',
      'received_contract_document_ack'$$
  );

  v_patched := replace(
    v_patched,
    $$  /*
   * Serialize every recognized Sales AI outbound against its exact commercial
   * opportunity. The opt-out writer locks this same opportunity.
   */$$,
    $$  /*
   * C.5: an operational document ACK is authorized by its exact inbound
   * document source, not by a commercial opportunity.
   */
  if v_block_reason is null
     and v_message.sender = 'ai'
     and v_initial_outbound_kind = 'received_contract_document_ack' then
    if v_outbound_origin is distinct from 'received_contract_document_ack' then
      v_block_reason := 'received_document_ack_origin_mismatch';
    end if;

    begin
      v_source_message_id :=
        nullif(v_message.metadata ->> 'source_message_id', '')::uuid;
    exception
      when invalid_text_representation then
        v_block_reason := 'invalid_received_document_ack_source';
    end;

    if v_block_reason is null and v_source_message_id is null then
      v_block_reason := 'received_document_ack_source_required';
    end if;

    if v_block_reason is null then
      select source_row.*
        into v_source_message
        from public.messages source_row
       where source_row.id = v_source_message_id
         and source_row.organization_id = p_organization_id
         and source_row.store_id = p_store_id
         and source_row.conversation_id = v_message.conversation_id
         and source_row.sender = 'user'
         and source_row.direction = 'incoming'
         and source_row.message_type = 'document'
         and source_row.deleted_at is null
       for share;

      if not found then
        v_block_reason := 'received_document_ack_source_scope_mismatch';
      end if;
    end if;
  end if;

  /*
   * Serialize every recognized Sales AI outbound against its exact commercial
   * opportunity. The opt-out writer locks this same opportunity.
   */$$
  );

  v_patched := replace(
    v_patched,
    $$  if v_block_reason is null
     and v_message.sender = 'ai' then
    begin
      v_initial_opportunity_id :=$$,
    $$  if v_block_reason is null
     and v_message.sender = 'ai'
     and v_initial_outbound_kind <> 'received_contract_document_ack' then
    begin
      v_initial_opportunity_id :=$$
  );

  v_patched := replace(
    v_patched,
    $$  /*
   * At the final controlled boundary, Sales AI external transport must still
   * belong to a proven real Meta WhatsApp conversation.
   */$$,
    $$  if v_block_reason is null
     and v_message.sender = 'ai'
     and v_outbound_kind = 'received_contract_document_ack' then
    begin
      v_source_message_id :=
        nullif(v_message.metadata ->> 'source_message_id', '')::uuid;
    exception
      when invalid_text_representation then
        v_block_reason := 'invalid_received_document_ack_source';
    end;

    if v_block_reason is null
       and v_source_message_id is null then
      v_block_reason := 'received_document_ack_source_required';
    elsif v_block_reason is null
       and v_source_message_id is distinct from v_source_message.id then
      v_block_reason := 'received_document_ack_source_changed_during_gate';
    end if;
  end if;

  /*
   * At the final controlled boundary, Sales AI external transport must still
   * belong to a proven real Meta WhatsApp conversation.
   */$$
  );

  v_patched := replace(
    v_patched,
    $$  if v_block_reason is null
     and v_message.sender = 'ai' then
    begin
      v_opportunity_id :=$$,
    $$  if v_block_reason is null
     and v_message.sender = 'ai'
     and v_outbound_kind <> 'received_contract_document_ack' then
    begin
      v_opportunity_id :=$$
  );

  IF v_patched = v_definition
     OR position('received_contract_document_ack' in v_patched) = 0
     OR position('received_document_ack_source_scope_mismatch' in v_patched) = 0
     OR position('received_document_ack_origin_mismatch' in v_patched) = 0 THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'P9_9_3_C5_EXTERNAL_SEND_GUARD_PATCH_NOT_APPLIED';
  END IF;

  EXECUTE v_patched;
END;
$patch$;

COMMIT;
