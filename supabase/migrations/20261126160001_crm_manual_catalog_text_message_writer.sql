BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION public.finalize_manual_catalog_text_message(
    p_organization_id uuid,
    p_store_id uuid,
    p_conversation_id uuid,
    p_lead_id uuid,
    p_actor_user_id uuid,
    p_catalog_source_kind text,
    p_catalog_source_id uuid,
    p_content text,
    p_send_external boolean,
    p_outbound_idempotency_key text,
    p_payload_fingerprint text
)
RETURNS TABLE(message_id uuid, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp', 'public'
SET row_security TO 'off'
AS $$
DECLARE
    m public.messages%rowtype;
    product_name text;
    legacy_photo text;
    metadata jsonb;
    content text := btrim(p_content);
BEGIN
    IF p_actor_user_id IS NULL
       OR p_catalog_source_id IS NULL
       OR p_catalog_source_kind IS NULL
       OR p_catalog_source_kind NOT IN ('pool', 'catalog_item')
       OR nullif(content, '') IS NULL
       OR char_length(content) > 1024
       OR p_send_external IS NULL
       OR coalesce(p_outbound_idempotency_key, '') !~
          '^crm_manual_catalog_photo:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR coalesce(p_payload_fingerprint, '') !~ '^[0-9a-f]{64}$'
    THEN
        RAISE EXCEPTION 'CATALOG_INVALID_INPUT' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.conversations c
        JOIN public.leads l ON l.id = c.lead_id
        WHERE c.id = p_conversation_id
          AND c.organization_id = p_organization_id
          AND l.id = p_lead_id
          AND l.organization_id = p_organization_id
          AND l.store_id = p_store_id
    ) THEN
        RAISE EXCEPTION 'CATALOG_SCOPE_MISMATCH' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        p_organization_id::text || ':' ||
        p_store_id::text || ':' || p_outbound_idempotency_key, 0
    ));

    metadata := jsonb_build_object(
        'source', 'panel',
        'source_channel', 'panel_manual',
        'channel', CASE WHEN p_send_external THEN 'whatsapp' ELSE 'crm' END,
        'external_channel', CASE WHEN p_send_external THEN 'whatsapp' END,
        'outbound_origin', CASE WHEN p_send_external THEN 'crm_manual_text' END,
        'send_external', p_send_external,
        'whatsapp_detected_from_conversation', p_send_external,
        'sent_by', 'panel_user',
        'sent_by_user_id', p_actor_user_id,
        'auto_sent', false,
        'catalog_message_mode', 'text',
        'catalog_message_purpose', 'catalog_product_presentation',
        'catalog_source_kind', p_catalog_source_kind,
        'catalog_source_id', p_catalog_source_id,
        'catalog_text_payload_fingerprint', p_payload_fingerprint,
        'outbound_idempotency_key', p_outbound_idempotency_key,
        'human_activity_key', p_outbound_idempotency_key
    );

    SELECT x.* INTO m FROM public.messages x
    WHERE x.organization_id = p_organization_id
      AND x.store_id = p_store_id
      AND x.outbound_idempotency_key = p_outbound_idempotency_key
    FOR UPDATE;

    IF FOUND THEN
        IF m.deleted_at IS NOT NULL
           OR m.conversation_id IS DISTINCT FROM p_conversation_id
           OR m.lead_id IS DISTINCT FROM p_lead_id
           OR m.sender IS DISTINCT FROM 'human'
           OR m.direction IS DISTINCT FROM 'outgoing'
           OR m.message_type IS DISTINCT FROM 'text'
           OR m.content IS DISTINCT FROM content
           OR m.media_url IS NOT NULL
           OR NOT coalesce(m.metadata @> metadata, false)
        THEN
            RAISE EXCEPTION 'CATALOG_OPERATION_CONFLICT' USING ERRCODE = '23514';
        END IF;

        RETURN QUERY SELECT m.id, true;
        RETURN;
    END IF;

    IF p_catalog_source_kind = 'pool' THEN
        SELECT p.name, p.photo_url INTO product_name, legacy_photo
        FROM public.pools p
        WHERE p.id = p_catalog_source_id
          AND p.organization_id = p_organization_id
          AND p.store_id = p_store_id
          AND p.is_active
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'CATALOG_PRODUCT_FORBIDDEN' USING ERRCODE = '42501';
        END IF;

        PERFORM 1 FROM public.pool_photos ph
        WHERE ph.pool_id = p_catalog_source_id
          AND ph.organization_id = p_organization_id
          AND ph.store_id = p_store_id
        FOR SHARE;

        IF coalesce(btrim(legacy_photo), '') ~* '^https?://'
           OR EXISTS (
               SELECT 1 FROM public.pool_photos ph
               WHERE ph.pool_id = p_catalog_source_id
                 AND ph.organization_id = p_organization_id
                 AND ph.store_id = p_store_id
                 AND nullif(btrim(ph.storage_path), '') IS NOT NULL
           )
        THEN
            RAISE EXCEPTION 'CATALOG_PHOTO_AVAILABLE' USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT i.name INTO product_name FROM public.store_catalog_items i
        WHERE i.id = p_catalog_source_id
          AND i.organization_id = p_organization_id
          AND i.store_id = p_store_id
          AND i.is_active
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'CATALOG_PRODUCT_FORBIDDEN' USING ERRCODE = '42501';
        END IF;

        PERFORM 1 FROM public.store_catalog_item_photos ph
        WHERE ph.catalog_item_id = p_catalog_source_id
        FOR SHARE;

        IF EXISTS (
            SELECT 1 FROM public.store_catalog_item_photos ph
            WHERE ph.catalog_item_id = p_catalog_source_id
              AND nullif(btrim(ph.storage_path), '') IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'CATALOG_PHOTO_AVAILABLE' USING ERRCODE = '23514';
        END IF;
    END IF;

    metadata := metadata || jsonb_build_object('catalog_product_name', product_name);

    SELECT * INTO m FROM public.insert_message(
        p_conversation_id, 'human', 'outgoing', 'text',
        content, NULL, NULL, metadata
    );

    IF m.id IS NULL
       OR m.organization_id IS DISTINCT FROM p_organization_id
       OR m.store_id IS DISTINCT FROM p_store_id
       OR m.lead_id IS DISTINCT FROM p_lead_id
       OR m.conversation_id IS DISTINCT FROM p_conversation_id
    THEN
        RAISE EXCEPTION 'CATALOG_MESSAGE_SCOPE_MISMATCH';
    END IF;

    UPDATE public.messages x
    SET outbound_idempotency_key = p_outbound_idempotency_key,
        outbound_delivery_state = CASE WHEN p_send_external THEN 'pending' END
    WHERE x.id = m.id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CATALOG_MESSAGE_UPDATE_FAILED';
    END IF;

    RETURN QUERY SELECT m.id, false;
END;
$$;

ALTER FUNCTION public.finalize_manual_catalog_text_message(
    uuid,uuid,uuid,uuid,uuid,text,uuid,text,boolean,text,text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.finalize_manual_catalog_text_message(
    uuid,uuid,uuid,uuid,uuid,text,uuid,text,boolean,text,text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finalize_manual_catalog_text_message(
    uuid,uuid,uuid,uuid,uuid,text,uuid,text,boolean,text,text
) TO service_role;

COMMIT;
