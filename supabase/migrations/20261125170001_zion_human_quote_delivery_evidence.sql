-- ZION: Independent human quote delivery evidence.
-- Provider acceptance is separate from actual delivery.
-- No transport, CRM transition or message mutation.

CREATE FUNCTION public.parse_human_quote_delivery_event_internal(
    p_payload jsonb,
    p_external_message_id text,
    p_phone_number_id text,
    p_destination_phone text,
    p_attempt_started_at timestamptz,
    p_received_at timestamptz
)
RETURNS TABLE (
    status_value text,
    status_at timestamptz
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE
    v_status text;
    v_timestamp text;
    v_seconds bigint;
BEGIN

    IF p_payload IS NULL
       OR p_external_message_id IS NULL
       OR p_external_message_id = ''
       OR p_phone_number_id IS NULL
       OR p_phone_number_id !~ '^[0-9]{1,128}$'
       OR p_destination_phone IS NULL
       OR p_destination_phone !~ '^[+][0-9]{8,15}$'
       OR p_attempt_started_at IS NULL
       OR p_received_at IS NULL
    THEN
        RETURN;
    END IF;

    IF p_payload->>'source'
           IS DISTINCT FROM 'meta_whatsapp_webhook'
       OR p_payload->>'event_kind'
           IS DISTINCT FROM 'status'
       OR p_payload->>'phone_number_id'
           IS DISTINCT FROM p_phone_number_id
       OR p_payload#>>'{status,id}'
           IS DISTINCT FROM p_external_message_id
       OR p_payload#>>'{status,recipient_id}'
           IS DISTINCT FROM substring(p_destination_phone FROM 2)
    THEN
        RETURN;
    END IF;

    v_status := p_payload#>>'{status,status}';

    IF v_status IS NULL
       OR v_status NOT IN (
           'sent','delivered','read','failed'
       )
    THEN
        RETURN;
    END IF;

    v_timestamp := p_payload#>>'{status,timestamp}';

    IF v_timestamp IS NULL
       OR v_timestamp !~ '^[0-9]{1,10}$'
    THEN
        RETURN;
    END IF;

    v_seconds := v_timestamp::bigint;

    IF v_seconds <
        floor(extract(epoch FROM p_attempt_started_at))

       OR v_seconds >
        floor(extract(epoch FROM p_received_at))
    THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        v_status,
        to_timestamp(v_seconds::double precision);

END;
$function$;

ALTER FUNCTION public.parse_human_quote_delivery_event_internal(
    jsonb,text,text,text,timestamptz,timestamptz
)
OWNER TO postgres;

REVOKE ALL PRIVILEGES
ON FUNCTION public.parse_human_quote_delivery_event_internal(
    jsonb,text,text,text,timestamptz,timestamptz
)
FROM PUBLIC, anon, authenticated, service_role;


CREATE FUNCTION public.read_human_quote_delivery_evidence_by_system(
    p_organization_id uuid,
    p_store_id uuid,
    p_actor_user_id uuid,
    p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $function$
DECLARE

    v_op public.human_quote_send_operations%ROWTYPE;

    v_sent_at timestamptz;
    v_delivered_at timestamptz;
    v_read_at timestamptz;
    v_failed_at timestamptz;

    v_count bigint;
    v_status text;

BEGIN

    SELECT o.*
    INTO v_op

    FROM public.human_quote_send_operations o

    WHERE o.organization_id = p_organization_id
      AND o.store_id = p_store_id
      AND o.actor_user_id = p_actor_user_id
      AND o.operation_id = p_operation_id

      AND EXISTS (

          SELECT 1
          FROM public.memberships m

          WHERE m.organization_id = o.organization_id
            AND m.user_id = p_actor_user_id
            AND m.is_active IS TRUE

      );

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'HUMAN_QUOTE_DELIVERY_OPERATION_NOT_FOUND';
    END IF;

    IF v_op.status <> 'accepted'
       OR v_op.external_message_id IS NULL
       OR v_op.provider_accepted_at IS NULL
       OR v_op.attempt_started_at IS NULL
       OR v_op.transport_phone_number_id IS NULL
    THEN

        RETURN jsonb_build_object(
            'outcome','not_eligible',
            'operation_id',v_op.operation_id,
            'operation_status',v_op.status,
            'delivery_status',NULL,
            'reason','PROVIDER_ACCEPTANCE_REQUIRED'
        );

    END IF;

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
          AND i.payload->>'source' = 'meta_whatsapp_webhook'
          AND i.payload->>'event_kind' = 'status'
          AND i.payload#>>'{status,id}' = v_op.external_message_id
          AND i.payload->>'phone_number_id' = v_op.transport_phone_number_id

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
        v_sent_at,
        v_delivered_at,
        v_read_at,
        v_failed_at,
        v_count

    FROM evidence;

    v_status := CASE

        WHEN v_read_at IS NOT NULL
            THEN 'read'

        WHEN v_delivered_at IS NOT NULL
            THEN 'delivered'

        WHEN v_failed_at IS NOT NULL
            THEN 'delivery_failed'

        WHEN v_sent_at IS NOT NULL
            THEN 'sent'

        ELSE 'accepted'

    END;

    RETURN jsonb_build_object(

        'outcome','resolved',
        'operation_id',v_op.operation_id,
        'operation_status',v_op.status,
        'delivery_status',v_status,

        'provider_accepted_at',v_op.provider_accepted_at,

        'sent_at',v_sent_at,
        'delivered_at',v_delivered_at,
        'read_at',v_read_at,
        'failed_at',v_failed_at,

        'evidence_count',v_count

    );

END;
$function$;

ALTER FUNCTION public.read_human_quote_delivery_evidence_by_system(
    uuid,uuid,uuid,uuid
)
OWNER TO postgres;

REVOKE ALL PRIVILEGES
ON FUNCTION public.read_human_quote_delivery_evidence_by_system(
    uuid,uuid,uuid,uuid
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.read_human_quote_delivery_evidence_by_system(
    uuid,uuid,uuid,uuid
)
TO service_role;

COMMENT ON FUNCTION public.read_human_quote_delivery_evidence_by_system(
    uuid,uuid,uuid,uuid
)
IS 'Read-only reconciliation of accepted human quote delivery with stored, scoped Meta status evidence. Never sends or changes CRM state.';
