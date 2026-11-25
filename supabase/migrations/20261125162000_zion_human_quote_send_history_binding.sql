ALTER TABLE public.human_quote_send_operations

    ADD COLUMN history_binding jsonb,

    ADD CONSTRAINT hqso_history_binding_chk

    CHECK (
        history_binding IS NULL

        OR (
            recipient_kind = 'lead'

            AND jsonb_typeof(history_binding) = 'object'

            AND coalesce(
                history_binding->>'phone_number_id',''
            ) ~ '^[0-9]+$'

            AND nullif(
                history_binding->>'reason',''
            ) IS NOT NULL

            AND (
                (
                    history_binding->>'outcome' = 'bound'

                    AND coalesce(
                        history_binding->>'conversation_id',''
                    ) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

                    AND coalesce(
                        history_binding->>'inbound_message_id',''
                    ) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                )

                OR (
                    history_binding->>'outcome' = 'skipped'

                    AND NOT (
                        history_binding ? 'conversation_id'
                    )

                    AND NOT (
                        history_binding ? 'inbound_message_id'
                    )
                )
            ) IS TRUE
        )
    );


CREATE FUNCTION public.bind_human_quote_send_history_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_actor_user_id uuid,
    p_operation_id uuid,
    p_phone_number_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE

    v_op public.human_quote_send_operations%ROWTYPE;

    v_candidates uuid[];

    v_conversation_id uuid;

    v_message_id uuid;

    v_integration_count bigint;

    v_result jsonb;

BEGIN

    IF p_phone_number_id IS NULL
       OR p_phone_number_id !~ '^[0-9]+$'
       OR length(p_phone_number_id) > 128
    THEN

        RAISE EXCEPTION
            'HUMAN_QUOTE_HISTORY_PROVIDER_INVALID';

    END IF;

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

    IF v_op.recipient_kind <> 'lead'
       OR v_op.recipient_lead_id IS NULL
    THEN

        RETURN jsonb_build_object(
            'outcome','not_applicable',
            'reason','LEAD_RECIPIENT_REQUIRED'
        );

    END IF;

    -- An existing binding is immutable for this operation.

    IF v_op.history_binding IS NOT NULL THEN

        IF v_op.history_binding->>'phone_number_id'
            IS DISTINCT FROM p_phone_number_id
        THEN

            RAISE EXCEPTION
                'HUMAN_QUOTE_HISTORY_PROVIDER_CHANGED';

        END IF;

        RETURN v_op.history_binding;

    END IF;

    -- Historical recovery cannot select a new conversation
    -- after transport has already started.

    IF v_op.status <> 'registered' THEN

        RETURN jsonb_build_object(
            'outcome','not_applicable',
            'reason','PRE_SEND_BINDING_REQUIRED'
        );

    END IF;

    IF NOT EXISTS (

        SELECT 1
        FROM public.memberships m

        WHERE m.organization_id = v_op.organization_id
          AND m.user_id = v_op.actor_user_id
          AND m.is_active IS TRUE

    ) THEN

        RAISE EXCEPTION
            'HUMAN_QUOTE_HISTORY_MEMBERSHIP_INVALID';

    END IF;

    SELECT count(*)
    INTO v_integration_count

    FROM public.get_active_whatsapp_integration_for_external_send_by_system(
        v_op.organization_id,
        v_op.store_id
    ) i

    WHERE i.phone_number_id = p_phone_number_id;

    IF v_integration_count <> 1 THEN

        RAISE EXCEPTION
            'HUMAN_QUOTE_HISTORY_INTEGRATION_INVALID';

    END IF;

    -- Resolve conversations using the selected lead,
    -- recipient phone and exact WhatsApp business number.

    SELECT array_agg(c.id ORDER BY c.id)
    INTO v_candidates

    FROM public.conversations c

    JOIN public.leads l
      ON l.id = c.lead_id
     AND l.organization_id = v_op.organization_id
     AND l.store_id = v_op.store_id

    WHERE c.organization_id = v_op.organization_id
      AND c.lead_id = v_op.recipient_lead_id

      AND EXISTS (

          SELECT 1
          FROM public.messages m

          WHERE m.organization_id = v_op.organization_id
            AND m.store_id = v_op.store_id
            AND m.conversation_id = c.id
            AND m.lead_id = v_op.recipient_lead_id

            AND m.sender = 'user'
            AND m.direction = 'incoming'
            AND m.deleted_at IS NULL

            AND nullif(
                btrim(m.external_message_id),''
            ) IS NOT NULL

            AND m.metadata->>'source' =
                'meta_whatsapp_webhook'

            AND m.metadata->>'channel' = 'whatsapp'

            AND m.metadata->>'external_channel' =
                'whatsapp'

            AND m.metadata->>'provider' = 'meta'

            AND m.metadata->>'phone_number_id' =
                p_phone_number_id

            AND regexp_replace(
                coalesce(m.metadata->>'whatsapp_from',''),
                '[^0-9]','','g'
            ) = substring(v_op.destination_phone FROM 2)

            AND m.created_at <= clock_timestamp()

      );

    IF coalesce(cardinality(v_candidates),0) = 0 THEN

        v_result := jsonb_build_object(
            'outcome','skipped',
            'reason','NO_PROVEN_CONVERSATION',
            'phone_number_id',p_phone_number_id
        );

    ELSIF cardinality(v_candidates) > 1 THEN

        v_result := jsonb_build_object(
            'outcome','skipped',
            'reason','AMBIGUOUS_CONVERSATION',
            'phone_number_id',p_phone_number_id
        );

    ELSE

        v_conversation_id := v_candidates[1];

        SELECT m.id
        INTO v_message_id

        FROM public.messages m

        WHERE m.organization_id = v_op.organization_id
          AND m.store_id = v_op.store_id
          AND m.conversation_id = v_conversation_id
          AND m.lead_id = v_op.recipient_lead_id

          AND m.sender = 'user'
          AND m.direction = 'incoming'
          AND m.deleted_at IS NULL

          AND nullif(
              btrim(m.external_message_id),''
          ) IS NOT NULL

          AND m.metadata->>'source' =
              'meta_whatsapp_webhook'

          AND m.metadata->>'channel' = 'whatsapp'

          AND m.metadata->>'external_channel' = 'whatsapp'

          AND m.metadata->>'provider' = 'meta'

          AND m.metadata->>'phone_number_id' =
              p_phone_number_id

          AND regexp_replace(
              coalesce(m.metadata->>'whatsapp_from',''),
              '[^0-9]','','g'
          ) = substring(v_op.destination_phone FROM 2)

          AND m.created_at <= clock_timestamp()

        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1;

        IF v_message_id IS NULL THEN

            RAISE EXCEPTION
                'HUMAN_QUOTE_HISTORY_EVIDENCE_CHANGED';

        END IF;

        v_result := jsonb_build_object(
            'outcome','bound',
            'reason','PROVEN_WHATSAPP_CONVERSATION',
            'phone_number_id',p_phone_number_id,
            'conversation_id',v_conversation_id,
            'inbound_message_id',v_message_id
        );

    END IF;

    UPDATE public.human_quote_send_operations o

    SET history_binding = v_result

    WHERE o.organization_id = v_op.organization_id
      AND o.store_id = v_op.store_id
      AND o.actor_user_id = v_op.actor_user_id
      AND o.operation_id = v_op.operation_id
      AND o.status = 'registered'
      AND o.history_binding IS NULL;

    IF NOT FOUND THEN

        RAISE EXCEPTION
            'HUMAN_QUOTE_HISTORY_BINDING_LOST';

    END IF;

    RETURN v_result;

END;
$function$;


ALTER FUNCTION public.bind_human_quote_send_history_by_system(
    uuid,uuid,uuid,uuid,text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.bind_human_quote_send_history_by_system(
    uuid,uuid,uuid,uuid,text
) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.bind_human_quote_send_history_by_system(
    uuid,uuid,uuid,uuid,text
) TO service_role;
