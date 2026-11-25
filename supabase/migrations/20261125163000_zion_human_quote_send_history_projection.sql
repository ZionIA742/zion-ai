ALTER TABLE public.human_quote_send_operations
    ADD COLUMN history_projection jsonb,

    ADD CONSTRAINT hqso_history_projection_chk
    CHECK (
        history_projection IS NULL
        OR (
            status = 'accepted'
            AND recipient_kind = 'lead'
            AND jsonb_typeof(history_projection) = 'object'
            AND nullif(history_projection->>'reason','') IS NOT NULL
            AND (
                (
                    history_projection->>'outcome' = 'recorded'
                    AND coalesce(
                        history_projection->>'message_id',''
                    ) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                )
                OR (
                    history_projection->>'outcome' = 'skipped'
                    AND NOT (history_projection ? 'message_id')
                )
            ) IS TRUE
        )
    );


CREATE FUNCTION public.project_human_quote_send_history_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_actor_user_id uuid,
    p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE
    v_op public.human_quote_send_operations%ROWTYPE;
    v_message public.messages%ROWTYPE;
    v_conversation_id uuid;
    v_inbound_id uuid;
    v_key text;
    v_result jsonb;
    v_metadata jsonb;
    v_previous_insert_setting text;
BEGIN

    SELECT o.*
    INTO v_op
    FROM public.human_quote_send_operations o
    WHERE o.organization_id = p_organization_id
      AND o.store_id = p_store_id
      AND o.actor_user_id = p_actor_user_id
      AND o.operation_id = p_operation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_HISTORY_OPERATION_NOT_FOUND';
    END IF;

    IF v_op.status <> 'accepted'
       OR v_op.external_message_id IS NULL
       OR v_op.provider_accepted_at IS NULL
    THEN
        RETURN jsonb_build_object(
            'outcome','not_eligible',
            'reason','PROVIDER_ACCEPTANCE_REQUIRED'
        );
    END IF;

    IF v_op.recipient_kind <> 'lead' THEN
        RETURN jsonb_build_object(
            'outcome','not_eligible',
            'reason','LEAD_RECIPIENT_REQUIRED'
        );
    END IF;

    IF v_op.history_projection IS NOT NULL THEN
        RETURN v_op.history_projection;
    END IF;

    IF v_op.history_binding IS NULL THEN

        v_result := jsonb_build_object(
            'outcome','skipped',
            'reason','PRE_SEND_BINDING_UNAVAILABLE'
        );

    ELSIF v_op.history_binding->>'outcome' = 'skipped' THEN

        v_result := jsonb_build_object(
            'outcome','skipped',
            'reason',v_op.history_binding->>'reason'
        );

    ELSIF v_op.history_binding->>'outcome' = 'bound' THEN

        v_conversation_id :=
            (v_op.history_binding->>'conversation_id')::uuid;

        v_inbound_id :=
            (v_op.history_binding->>'inbound_message_id')::uuid;

        v_key := 'human_quote_history:' || v_op.operation_key;

        PERFORM public.private_acquire_sales_contract_conversation_xact_lock(
            v_conversation_id
        );

        PERFORM 1
        FROM public.conversations c
        JOIN public.leads l
          ON l.id = c.lead_id
         AND l.organization_id = v_op.organization_id
         AND l.store_id = v_op.store_id
        WHERE c.id = v_conversation_id
          AND c.organization_id = v_op.organization_id
          AND c.lead_id = v_op.recipient_lead_id
        FOR UPDATE OF c,l;

        IF NOT FOUND THEN

            v_result := jsonb_build_object(
                'outcome','skipped',
                'reason','BOUND_CONVERSATION_UNAVAILABLE'
            );

        ELSE

            PERFORM 1
            FROM public.messages m
            WHERE m.id = v_inbound_id
              AND m.organization_id = v_op.organization_id
              AND m.store_id = v_op.store_id
              AND m.lead_id = v_op.recipient_lead_id
              AND m.conversation_id = v_conversation_id
              AND m.sender = 'user'
              AND m.direction = 'incoming'
              AND m.deleted_at IS NULL
              AND m.external_message_id IS NOT NULL
              AND m.metadata->>'source' = 'meta_whatsapp_webhook'
              AND m.metadata->>'channel' = 'whatsapp'
              AND m.metadata->>'external_channel' = 'whatsapp'
              AND m.metadata->>'provider' = 'meta'
              AND m.metadata->>'phone_number_id' =
                  v_op.history_binding->>'phone_number_id'
              AND regexp_replace(
                  coalesce(m.metadata->>'whatsapp_from',''),
                  '[^0-9]','','g'
              ) = substring(v_op.destination_phone FROM 2)
              AND m.created_at <= v_op.attempt_started_at
            FOR SHARE;

            IF NOT FOUND THEN

                v_result := jsonb_build_object(
                    'outcome','skipped',
                    'reason','BOUND_EVIDENCE_UNAVAILABLE'
                );

            ELSE

                -- A collision is not permission to overwrite
                -- a message received from coexistence.

                IF EXISTS (
                    SELECT 1
                    FROM public.messages m
                    WHERE m.external_message_id =
                          v_op.external_message_id
                       OR (
                           m.organization_id = v_op.organization_id
                           AND m.store_id = v_op.store_id
                           AND m.outbound_idempotency_key = v_key
                       )
                ) THEN
                    RAISE EXCEPTION
                        'HUMAN_QUOTE_HISTORY_IDENTITY_COLLISION';
                END IF;

                v_metadata := jsonb_build_object(
                    'source','human_quote_send_history',
                    'outbound_origin','human_quote_send_history',
                    'outbound_idempotency_key',v_key,
                    'channel','whatsapp',
                    'external_channel','whatsapp',
                    'provider','meta',
                    'phone_number_id',
                        v_op.history_binding->>'phone_number_id',
                    'send_external',false,
                    'attachment_kind','file',
                    'file_kind','sales_quote_pdf',
                    'private',true,
                    'generated_by','human',
                    'organization_id',v_op.organization_id,
                    'store_id',v_op.store_id,
                    'quote_id',v_op.quote_id,
                    'quote_version_id',v_op.quote_version_id,
                    'sales_quote_id',v_op.quote_id,
                    'sales_quote_version_id',v_op.quote_version_id,
                    'store_file_id',v_op.store_file_id,
                    'storage_bucket',v_op.storage_bucket,
                    'storage_path',v_op.storage_path,
                    'original_file_name',v_op.original_filename,
                    'mime_type',v_op.mime_type,
                    'size_bytes',v_op.size_bytes,
                    'sent_by_user_id',v_op.actor_user_id,
                    'human_quote_send_operation_key',v_op.operation_key,
                    'provider_accepted_at',v_op.provider_accepted_at
                );

                v_previous_insert_setting :=
                    current_setting('app.insert_via_function',true);

                SELECT *
                INTO v_message
                FROM public.insert_message(
                    v_conversation_id,
                    'human',
                    'outgoing',
                    'document',
                    'Segue o orçamento.',
                    v_op.external_message_id,
                    v_op.storage_path,
                    v_metadata
                );

                PERFORM set_config(
                    'app.insert_via_function',
                    coalesce(v_previous_insert_setting,''),
                    true
                );

                IF v_message.id IS NULL
                   OR v_message.organization_id
                        IS DISTINCT FROM v_op.organization_id
                   OR v_message.store_id
                        IS DISTINCT FROM v_op.store_id
                   OR v_message.lead_id
                        IS DISTINCT FROM v_op.recipient_lead_id
                   OR v_message.conversation_id
                        IS DISTINCT FROM v_conversation_id
                   OR v_message.external_message_id
                        IS DISTINCT FROM v_op.external_message_id
                THEN
                    RAISE EXCEPTION
                        'HUMAN_QUOTE_HISTORY_MESSAGE_SCOPE_INVALID';
                END IF;

                UPDATE public.messages m
                SET
                    created_at = v_op.provider_accepted_at,
                    outbound_idempotency_key = v_key,
                    outbound_delivery_state = 'sent',
                    outbound_attempt_started_at =
                        v_op.attempt_started_at,
                    outbound_provider_accepted_at =
                        v_op.provider_accepted_at
                WHERE m.id = v_message.id
                  AND m.organization_id = v_op.organization_id
                  AND m.store_id = v_op.store_id
                  AND m.conversation_id = v_conversation_id
                  AND m.external_message_id = v_op.external_message_id
                  AND m.deleted_at IS NULL
                RETURNING m.* INTO v_message;

                IF NOT FOUND THEN
                    RAISE EXCEPTION
                        'HUMAN_QUOTE_HISTORY_FINALIZATION_LOST';
                END IF;

                v_result := jsonb_build_object(
                    'outcome','recorded',
                    'reason','ACCEPTED_DOCUMENT_RECORDED',
                    'message_id',v_message.id,
                    'conversation_id',v_conversation_id
                );

            END IF;

        END IF;

    ELSE

        RAISE EXCEPTION
            'HUMAN_QUOTE_HISTORY_BINDING_INVALID';

    END IF;

    UPDATE public.human_quote_send_operations o
    SET history_projection = v_result
    WHERE o.organization_id = v_op.organization_id
      AND o.store_id = v_op.store_id
      AND o.actor_user_id = v_op.actor_user_id
      AND o.operation_id = v_op.operation_id
      AND o.history_projection IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_HISTORY_PROJECTION_LOST';
    END IF;

    RETURN v_result;

END;
$function$;


ALTER FUNCTION public.project_human_quote_send_history_by_system(
    uuid,uuid,uuid,uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.project_human_quote_send_history_by_system(
    uuid,uuid,uuid,uuid
) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.project_human_quote_send_history_by_system(
    uuid,uuid,uuid,uuid
) TO service_role;
