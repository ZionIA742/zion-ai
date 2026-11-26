-- ZION: Identify persisted Meta status events belonging
-- to independent human quote sends.
-- Read-only. No transport or commercial effects.

CREATE FUNCTION public.identify_human_quote_status_event_by_system(

    p_organization_id uuid,
    p_store_id uuid,
    p_inbox_id uuid

)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE

    v_event public.channel_whatsapp_inbox%ROWTYPE;
    v_op public.human_quote_send_operations%ROWTYPE;
    v_external_id text;
    v_evidence record;

BEGIN

    SELECT i.*
    INTO v_event

    FROM public.channel_whatsapp_inbox i

    WHERE i.id = p_inbox_id
      AND i.organization_id = p_organization_id
      AND i.store_id = p_store_id;

    IF NOT FOUND THEN

        RETURN jsonb_build_object(
            'outcome','not_found',
            'reason','SCOPED_INBOX_EVENT_NOT_FOUND'
        );

    END IF;

    v_external_id :=
        v_event.payload#>>'{status,id}';

    IF nullif(v_external_id,'') IS NULL THEN

        RETURN jsonb_build_object(
            'outcome','unmatched',
            'reason','STATUS_ID_UNAVAILABLE'
        );

    END IF;

    SELECT o.*
    INTO v_op

    FROM public.human_quote_send_operations o

    WHERE o.organization_id = p_organization_id
      AND o.store_id = p_store_id

      AND o.external_message_id = v_external_id

      AND o.status = 'accepted'
      AND o.provider_accepted_at IS NOT NULL
      AND o.attempt_started_at IS NOT NULL
      AND o.transport_phone_number_id IS NOT NULL;

    IF NOT FOUND THEN

        RETURN jsonb_build_object(
            'outcome','unmatched',
            'reason','NO_ACCEPTED_HUMAN_QUOTE_OPERATION'
        );

    END IF;

    IF v_event.provider IS DISTINCT FROM 'meta' THEN

        RETURN jsonb_build_object(
            'outcome','rejected',
            'reason','HUMAN_QUOTE_EVENT_PROVIDER_INVALID'
        );

    END IF;

    SELECT e.*
    INTO v_evidence

    FROM public.parse_human_quote_delivery_event_internal(

        v_event.payload,
        v_op.external_message_id,
        v_op.transport_phone_number_id,
        v_op.destination_phone,
        v_op.attempt_started_at,
        v_event.received_at

    ) e;

    IF NOT FOUND THEN

        RETURN jsonb_build_object(
            'outcome','rejected',
            'reason','HUMAN_QUOTE_EVENT_EVIDENCE_INVALID'
        );

    END IF;

    -- The worker processes provider evidence independently
    -- of whether the original human actor is still active.

    RETURN jsonb_build_object(

        'outcome','matched',

        'reason','PROVEN_HUMAN_QUOTE_STATUS_EVENT',

        'operation_id',v_op.operation_id,

        'actor_user_id',v_op.actor_user_id,

        'recipient_kind',v_op.recipient_kind,

        'status_value',v_evidence.status_value,

        'status_at',v_evidence.status_at

    );

END;
$function$;

ALTER FUNCTION public.identify_human_quote_status_event_by_system(
    uuid,uuid,uuid
)
OWNER TO postgres;

REVOKE ALL PRIVILEGES
ON FUNCTION public.identify_human_quote_status_event_by_system(
    uuid,uuid,uuid
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.identify_human_quote_status_event_by_system(
    uuid,uuid,uuid
)
TO service_role;

COMMENT ON FUNCTION public.identify_human_quote_status_event_by_system(
    uuid,uuid,uuid
)
IS 'Identify persisted Meta status evidence for an accepted independent human quote send. Read-only worker authority.';
