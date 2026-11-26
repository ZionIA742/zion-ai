-- ZION: Independent human quote delivery projection.
-- Preserve provider evidence separately from CRM display timestamps.
-- Never transport, enqueue, or finalize commercial effects.

CREATE FUNCTION public.merge_human_quote_history_delivery_internal(
    p_metadata jsonb,
    p_created_at timestamptz,
    p_delivered_at timestamptz,
    p_read_at timestamptz,
    p_sent_evidence timestamptz,
    p_delivered_evidence timestamptz,
    p_read_evidence timestamptz,
    p_failed_evidence timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE

    v_metadata jsonb := coalesce(p_metadata,'{}'::jsonb);

    v_delivered timestamptz := p_delivered_at;
    v_read timestamptz := p_read_at;

    v_pair record;
    v_previous timestamptz;
    v_status text;

BEGIN

    IF p_created_at IS NULL
       OR jsonb_typeof(v_metadata) <> 'object'
    THEN
        RAISE EXCEPTION 'HUMAN_QUOTE_DELIVERY_MERGE_INVALID';
    END IF;

    -- Preserve the earliest actual provider evidence.

    FOR v_pair IN

        SELECT *

        FROM (

            VALUES

            ('whatsapp_sent_at',p_sent_evidence),
            ('whatsapp_delivered_at',p_delivered_evidence),
            ('whatsapp_read_at',p_read_evidence),
            ('whatsapp_failed_at',p_failed_evidence)

        ) AS t(metadata_key,evidence_at)

    LOOP

        IF v_pair.evidence_at IS NOT NULL THEN

            v_previous := nullif(
                v_metadata->>v_pair.metadata_key,''
            )::timestamptz;

            v_metadata := jsonb_set(

                v_metadata,

                ARRAY[v_pair.metadata_key],

                to_jsonb(
                    least(v_previous,v_pair.evidence_at)
                ),

                true

            );

        END IF;

    END LOOP;

    -- CRM display timestamps must satisfy existing constraints.
    -- Original Meta timestamps remain untouched in metadata.

    IF v_delivered IS NULL

       AND (
           p_delivered_evidence IS NOT NULL
           OR p_read_evidence IS NOT NULL
       )

    THEN

        v_delivered := greatest(

            p_created_at,

            least(
                p_delivered_evidence,
                p_read_evidence
            )

        );

    END IF;

    IF v_read IS NULL
       AND p_read_evidence IS NOT NULL
    THEN

        v_read := greatest(
            p_created_at,
            v_delivered,
            p_read_evidence
        );

    END IF;

    v_status := CASE

        WHEN v_read IS NOT NULL
            THEN 'read'

        WHEN v_delivered IS NOT NULL
            THEN 'delivered'

        WHEN p_failed_evidence IS NOT NULL
          OR v_metadata->>'whatsapp_status' = 'failed'
            THEN 'failed'

        WHEN p_sent_evidence IS NOT NULL
          OR v_metadata->>'whatsapp_status' = 'sent'
            THEN 'sent'

        ELSE NULL

    END;

    IF v_status IS NOT NULL THEN

        v_metadata := jsonb_set(
            v_metadata,
            '{whatsapp_status}',
            to_jsonb(v_status),
            true
        );

    END IF;

    RETURN jsonb_build_object(

        'metadata',v_metadata,

        'delivered_at',v_delivered,

        'read_at',v_read,

        'delivery_status',v_status

    );

END;
$function$;


ALTER FUNCTION public.merge_human_quote_history_delivery_internal(
    jsonb,timestamptz,timestamptz,timestamptz,
    timestamptz,timestamptz,timestamptz,timestamptz
)
OWNER TO postgres;

REVOKE ALL ON FUNCTION public.merge_human_quote_history_delivery_internal(
    jsonb,timestamptz,timestamptz,timestamptz,
    timestamptz,timestamptz,timestamptz,timestamptz
)
FROM PUBLIC,anon,authenticated,service_role;


CREATE FUNCTION public.project_human_quote_history_delivery_by_system(

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
    v_after public.messages%ROWTYPE;

    v_conversation_id uuid;
    v_message_id uuid;

    v_sent timestamptz;
    v_delivered timestamptz;
    v_read timestamptz;
    v_failed timestamptz;

    v_count bigint;
    v_merge jsonb;

    v_metadata jsonb;

    v_display_delivered timestamptz;
    v_display_read timestamptz;

    v_outcome text := 'unchanged';

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
        RAISE EXCEPTION 'HUMAN_QUOTE_DELIVERY_PROJECTION_OPERATION_NOT_FOUND';
    END IF;

    IF v_op.status <> 'accepted'

       OR v_op.external_message_id IS NULL
       OR v_op.provider_accepted_at IS NULL
       OR v_op.attempt_started_at IS NULL
       OR v_op.transport_phone_number_id IS NULL

    THEN

        RETURN jsonb_build_object(
            'outcome','not_eligible',
            'reason','PROVIDER_ACCEPTANCE_REQUIRED'
        );

    END IF;

    IF v_op.recipient_kind <> 'lead' THEN

        RETURN jsonb_build_object(
            'outcome','not_applicable',
            'reason','LEAD_RECIPIENT_REQUIRED'
        );

    END IF;

    IF v_op.history_projection IS NULL THEN

        RETURN jsonb_build_object(
            'outcome','pending',
            'reason','HISTORY_PROJECTION_PENDING'
        );

    END IF;

    IF v_op.history_projection->>'outcome' = 'skipped' THEN

        RETURN jsonb_build_object(
            'outcome','not_applicable',
            'reason','HISTORY_PROJECTION_SKIPPED'
        );

    END IF;

    IF v_op.history_projection->>'outcome'
           IS DISTINCT FROM 'recorded'

       OR v_op.history_binding->>'outcome'
           IS DISTINCT FROM 'bound'

       OR v_op.history_binding->>'phone_number_id'
           IS DISTINCT FROM v_op.transport_phone_number_id

       OR v_op.history_projection->>'conversation_id'
           IS DISTINCT FROM
              v_op.history_binding->>'conversation_id'

    THEN

        RAISE EXCEPTION 'HUMAN_QUOTE_DELIVERY_HISTORY_BINDING_INVALID';

    END IF;

    v_conversation_id :=
        (v_op.history_projection->>'conversation_id')::uuid;

    v_message_id :=
        (v_op.history_projection->>'message_id')::uuid;

    -- Follow the existing history projection lock order.

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

        RETURN jsonb_build_object(
            'outcome','skipped',
            'reason','BOUND_CONVERSATION_UNAVAILABLE'
        );

    END IF;

    SELECT m.*
    INTO v_message

    FROM public.messages m

    WHERE m.id = v_message_id

      AND m.organization_id = v_op.organization_id
      AND m.store_id = v_op.store_id
      AND m.conversation_id = v_conversation_id
      AND m.lead_id = v_op.recipient_lead_id

      AND m.sender = 'human'
      AND m.direction = 'outgoing'
      AND m.message_type = 'document'

      AND m.deleted_at IS NULL

      AND m.external_message_id =
          v_op.external_message_id

      AND m.outbound_idempotency_key =
          'human_quote_history:' || v_op.operation_key

      AND m.outbound_delivery_state = 'sent'

      AND m.outbound_provider_accepted_at =
          v_op.provider_accepted_at

      AND m.outbound_attempt_started_at =
          v_op.attempt_started_at

      AND m.created_at = v_op.provider_accepted_at

      AND m.metadata->>'source' =
          'human_quote_send_history'

      AND m.metadata->>'outbound_origin' =
          'human_quote_send_history'

      AND m.metadata->>'human_quote_send_operation_key' =
          v_op.operation_key

      AND m.metadata->>'quote_id' = v_op.quote_id::text
      AND m.metadata->>'quote_version_id' =
          v_op.quote_version_id::text

      AND m.metadata->>'store_file_id' =
          v_op.store_file_id::text

      AND m.metadata->>'phone_number_id' =
          v_op.transport_phone_number_id

      AND m.metadata->>'channel' = 'whatsapp'

      AND m.metadata->>'provider' = 'meta'

      AND m.metadata->'send_external' = 'false'::jsonb

    FOR UPDATE;

    IF NOT FOUND THEN

        RETURN jsonb_build_object(
            'outcome','skipped',
            'reason','BOUND_HISTORY_MESSAGE_UNAVAILABLE'
        );

    END IF;

    -- Worker reconciliation is independent of the original
    -- actor's current membership. Use the canonical parser.

    WITH evidence AS (

        SELECT DISTINCT
            e.status_value,
            e.status_at

        FROM public.channel_whatsapp_inbox i

        CROSS JOIN LATERAL

            public.parse_human_quote_delivery_event_internal(

                i.payload,
                v_op.external_message_id,
                v_op.transport_phone_number_id,
                v_op.destination_phone,
                v_op.attempt_started_at,
                i.received_at

            ) e

        WHERE i.organization_id = v_op.organization_id
          AND i.store_id = v_op.store_id
          AND i.provider = 'meta'

          AND i.payload->>'source' =
              'meta_whatsapp_webhook'

          AND i.payload->>'event_kind' = 'status'

          AND i.payload#>>'{status,id}' =
              v_op.external_message_id

          AND i.payload->>'phone_number_id' =
              v_op.transport_phone_number_id

    )

    SELECT

        min(status_at) FILTER (
            WHERE status_value = 'sent'
        ),

        min(status_at) FILTER (
            WHERE status_value = 'delivered'
        ),

        min(status_at) FILTER (
            WHERE status_value = 'read'
        ),

        min(status_at) FILTER (
            WHERE status_value = 'failed'
        ),

        count(*)

    INTO
        v_sent,
        v_delivered,
        v_read,
        v_failed,
        v_count

    FROM evidence;

    IF v_count = 0 THEN

        RETURN jsonb_build_object(
            'outcome','unchanged',
            'reason','NO_DELIVERY_EVIDENCE',
            'message_id',v_message_id
        );

    END IF;

    v_merge :=
        public.merge_human_quote_history_delivery_internal(

            v_message.metadata,
            v_message.created_at,
            v_message.delivered_at,
            v_message.read_at,

            v_sent,
            v_delivered,
            v_read,
            v_failed

        );

    v_metadata := v_merge->'metadata';

    v_display_delivered :=
        (v_merge->>'delivered_at')::timestamptz;

    v_display_read :=
        (v_merge->>'read_at')::timestamptz;

    IF v_metadata IS DISTINCT FROM v_message.metadata

       OR v_display_delivered
           IS DISTINCT FROM v_message.delivered_at

       OR v_display_read
           IS DISTINCT FROM v_message.read_at

    THEN

        UPDATE public.messages m

        SET
            metadata = v_metadata,
            delivered_at = v_display_delivered,
            read_at = v_display_read

        WHERE m.id = v_message_id
          AND m.organization_id = v_op.organization_id
          AND m.store_id = v_op.store_id
          AND m.deleted_at IS NULL

        RETURNING m.* INTO v_after;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'HUMAN_QUOTE_DELIVERY_UPDATE_LOST';
        END IF;

        IF (

            to_jsonb(v_after)
            - ARRAY['metadata','delivered_at','read_at']

        ) IS DISTINCT FROM (

            to_jsonb(v_message)
            - ARRAY['metadata','delivered_at','read_at']

        )

        THEN

            RAISE EXCEPTION 'HUMAN_QUOTE_DELIVERY_UNEXPECTED_MESSAGE_MUTATION';

        END IF;

        v_outcome := 'projected';

    END IF;

    RETURN jsonb_build_object(

        'outcome',v_outcome,

        'reason','DELIVERY_EVIDENCE_RECONCILED',

        'message_id',v_message_id,

        'delivery_status',v_merge->>'delivery_status',

        'evidence_count',v_count

    );

END;
$function$;


ALTER FUNCTION public.project_human_quote_history_delivery_by_system(
    uuid,uuid,uuid,uuid
)
OWNER TO postgres;

REVOKE ALL ON FUNCTION public.project_human_quote_history_delivery_by_system(
    uuid,uuid,uuid,uuid
)
FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.project_human_quote_history_delivery_by_system(
    uuid,uuid,uuid,uuid
)
TO service_role;
