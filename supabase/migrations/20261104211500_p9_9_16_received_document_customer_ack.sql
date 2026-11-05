-- ZION | P9.9.16 C.4/C.5
-- Durable, idempotent acknowledgement for a received contract document.
-- The function only materializes a normal outbound message. It never calls Meta.

BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_received_contract_document_ack_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_source_message_id uuid,
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
  v_existing public.messages;
  v_source public.messages;
  v_inserted public.messages;
  v_name text := nullif(pg_catalog.btrim(coalesce(p_customer_name, '')), '');
BEGIN
  IF public.zion_resolve_request_role_internal() IS DISTINCT FROM 'service_role'
     OR p_organization_id IS NULL
     OR p_store_id IS NULL
     OR p_conversation_id IS NULL
     OR p_source_message_id IS NULL THEN
    RAISE EXCEPTION USING
      errcode = '42501',
      message = 'P9_9_16_RECEIVED_DOCUMENT_ACK_NOT_AUTHORIZED_OR_INVALID';
  END IF;

  SELECT message_row.*
    INTO v_source
    FROM public.messages message_row
   WHERE message_row.id = p_source_message_id
     AND message_row.organization_id = p_organization_id
     AND message_row.store_id = p_store_id
     AND message_row.conversation_id = p_conversation_id
     AND message_row.direction = 'incoming'
     AND message_row.sender = 'user'
     AND message_row.message_type = 'document'
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = 'P9_9_16_RECEIVED_DOCUMENT_ACK_SOURCE_SCOPE_INVALID';
  END IF;

  v_key := 'received_contract_document_ack:'
    || p_organization_id::text || ':'
    || p_store_id::text || ':'
    || p_source_message_id::text;

  SELECT message_row.*
    INTO v_existing
    FROM public.messages message_row
   WHERE message_row.organization_id = p_organization_id
     AND message_row.store_id = p_store_id
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
          WHEN v_name IS NULL THEN 'Recebemos seu documento.'
          ELSE 'Obrigado, ' || v_name || '. Recebemos seu documento.'
        END,
        NULL,
        NULL,
        pg_catalog.jsonb_build_object(
          'source', 'received_contract_document_ack',
          'channel', 'whatsapp',
          'external_channel', 'whatsapp',
          'send_external', true,
          'outbound_origin', 'received_contract_document_ack',
          'source_message_id', p_source_message_id,
          'organization_id', p_organization_id,
          'store_id', p_store_id,
          'outbound_idempotency_key', v_key
        )
      );

    UPDATE public.messages
       SET outbound_idempotency_key = v_key,
           outbound_delivery_state = 'pending'
     WHERE id = v_inserted.id
       AND organization_id = p_organization_id
       AND store_id = p_store_id
       AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        errcode = '23514',
        message = 'P9_9_16_RECEIVED_DOCUMENT_ACK_INSERT_SCOPE_INVALID';
    END IF;

  EXCEPTION WHEN unique_violation THEN
    SELECT message_row.*
      INTO v_existing
      FROM public.messages message_row
     WHERE message_row.organization_id = p_organization_id
       AND message_row.store_id = p_store_id
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

REVOKE ALL ON FUNCTION public.enqueue_received_contract_document_ack_by_system(
  uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_received_contract_document_ack_by_system(
  uuid, uuid, uuid, uuid, text
) TO service_role;

COMMIT;
