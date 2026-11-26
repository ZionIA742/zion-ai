-- ZION: preserve verified independent quote status evidence
-- across provider binding changes.
-- Never trust historical raw records without verified provenance.
-- Never copy complete raw webhook payloads into another tenant.

CREATE FUNCTION public.resolve_human_quote_status_ingress_by_system(
    p_payload jsonb,
    p_received_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE
    v_op public.human_quote_send_operations%ROWTYPE;
BEGIN

    IF p_payload->'human_quote_signature_verified_v1'
           IS DISTINCT FROM 'true'::jsonb
       OR p_received_at IS NULL
       OR p_payload->>'source'
           IS DISTINCT FROM 'meta_whatsapp_webhook'
       OR p_payload->>'event_kind'
           IS DISTINCT FROM 'status'
    THEN
        RETURN jsonb_build_object(
            'outcome','rejected',
            'reason','VERIFIED_STATUS_REQUIRED'
        );
    END IF;

    SELECT o.*
    INTO v_op
    FROM public.human_quote_send_operations o
    WHERE o.external_message_id =
        p_payload#>>'{status,id}'
      AND o.status = 'accepted';

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'outcome','unmatched',
            'reason','ACCEPTED_OPERATION_NOT_FOUND'
        );
    END IF;

    IF v_op.provider_accepted_at IS NULL
       OR v_op.attempt_started_at IS NULL
       OR v_op.transport_phone_number_id IS NULL
       OR NOT EXISTS (
           SELECT 1
           FROM public.parse_human_quote_delivery_event_internal(
               p_payload,
               v_op.external_message_id,
               v_op.transport_phone_number_id,
               v_op.destination_phone,
               v_op.attempt_started_at,
               p_received_at
           )
       )
    THEN
        RETURN jsonb_build_object(
            'outcome','rejected',
            'reason','ORIGINAL_OPERATION_EVIDENCE_INVALID'
        );
    END IF;

    RETURN jsonb_build_object(
        'outcome','matched',
        'reason','ORIGINAL_ACCEPTED_OPERATION_PROVEN',
        'organization_id',v_op.organization_id,
        'store_id',v_op.store_id,
        'actor_user_id',v_op.actor_user_id,
        'operation_id',v_op.operation_id
    );

END;
$function$;

ALTER FUNCTION public.resolve_human_quote_status_ingress_by_system(
    jsonb,timestamptz
) OWNER TO postgres;

REVOKE ALL ON FUNCTION
public.resolve_human_quote_status_ingress_by_system(
    jsonb,timestamptz
) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION
public.resolve_human_quote_status_ingress_by_system(
    jsonb,timestamptz
) TO service_role;


CREATE FUNCTION public.recover_human_quote_status_ingress_by_system(
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
    v_event record;
    v_existing public.channel_whatsapp_inbox%ROWTYPE;

    v_payload jsonb;
    v_inserted bigint;
    v_recovered bigint := 0;
    v_existing_count bigint := 0;
    v_conflicts bigint := 0;

BEGIN

    SELECT o.*
    INTO v_op
    FROM public.human_quote_send_operations o
    WHERE o.organization_id = p_organization_id
      AND o.store_id = p_store_id
      AND o.actor_user_id = p_actor_user_id
      AND o.operation_id = p_operation_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'outcome','not_found',
            'reason','SCOPED_OPERATION_NOT_FOUND'
        );
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

    FOR v_event IN

        SELECT DISTINCT ON (candidate.event_id)
            candidate.*

        FROM (

            SELECT

                w.id AS audit_id,

                w.created_at AS received_at,

                w.payload#>>'{status,id}' AS message_id,

                w.payload#>>'{status,status}' AS status_value,

                w.payload#>>'{status,timestamp}' AS status_timestamp,

                w.payload#>>'{status,recipient_id}' AS recipient_id,

                'status:' ||
                (w.payload#>>'{status,id}') || ':' ||
                (w.payload#>>'{status,status}') || ':' ||
                (w.payload#>>'{status,timestamp}') AS event_id

            FROM public.external_webhooks w

            WHERE w.provider = 'meta_whatsapp'

              AND w.created_at IS NOT NULL

              AND w.payload->'human_quote_signature_verified_v1'
                    = 'true'::jsonb

              AND w.payload->>'source' =
                    'meta_whatsapp_webhook'

              AND w.payload->>'event_kind' = 'status'

              AND w.payload#>>'{status,id}' =
                    v_op.external_message_id

              AND w.payload->>'phone_number_id' =
                    v_op.transport_phone_number_id

              AND EXISTS (

                  SELECT 1

                  FROM public.parse_human_quote_delivery_event_internal(
                      w.payload,
                      v_op.external_message_id,
                      v_op.transport_phone_number_id,
                      v_op.destination_phone,
                      v_op.attempt_started_at,
                      w.created_at
                  )
              )

        ) candidate

        ORDER BY
            candidate.event_id,
            candidate.received_at,
            candidate.audit_id

    LOOP

        -- Build a minimal, status-only envelope.
        -- Never copy raw_payload, change, contacts or messages.

        v_payload := jsonb_build_object(
            'source','meta_whatsapp_webhook',
            'event_kind','status',
            'phone_number_id',
                v_op.transport_phone_number_id,

            'human_quote_signature_verified_v1',true,
            'human_quote_recovered_from_audit',true,

            'status',jsonb_build_object(
                'id',v_event.message_id,
                'status',v_event.status_value,
                'timestamp',v_event.status_timestamp,
                'recipient_id',v_event.recipient_id
            )
        );

        INSERT INTO public.channel_whatsapp_inbox (
            organization_id,
            store_id,
            provider,
            external_event_id,
            payload,
            received_at,
            processed_at,
            processing_error
        )
        VALUES (
            v_op.organization_id,
            v_op.store_id,
            'meta',
            v_event.event_id,
            v_payload,
            v_event.received_at,
            NULL,
            NULL
        )
        ON CONFLICT (
            organization_id,
            external_event_id
        ) DO NOTHING;

        GET DIAGNOSTICS v_inserted = ROW_COUNT;

        IF v_inserted = 1 THEN

            v_recovered := v_recovered + 1;

        ELSE

            SELECT i.*
            INTO v_existing

            FROM public.channel_whatsapp_inbox i

            WHERE i.organization_id =
                v_op.organization_id

              AND i.external_event_id =
                v_event.event_id;

            IF FOUND
               AND v_existing.store_id =
                    v_op.store_id
               AND v_existing.provider = 'meta'

               AND v_existing.payload#>>'{status,id}' =
                    v_event.message_id

               AND v_existing.payload#>>'{status,status}' =
                    v_event.status_value

               AND v_existing.payload#>>'{status,timestamp}' =
                    v_event.status_timestamp

               AND EXISTS (

                   SELECT 1

                   FROM public.parse_human_quote_delivery_event_internal(
                       v_existing.payload,
                       v_op.external_message_id,
                       v_op.transport_phone_number_id,
                       v_op.destination_phone,
                       v_op.attempt_started_at,
                       v_existing.received_at
                   )
               )

            THEN

                v_existing_count :=
                    v_existing_count + 1;

            ELSE

                -- Never overwrite another event or store.
                v_conflicts := v_conflicts + 1;

            END IF;

        END IF;

    END LOOP;

    RETURN jsonb_build_object(

        'outcome',

            CASE
                WHEN v_conflicts > 0 THEN 'conflict'
                WHEN v_recovered > 0 THEN 'recovered'
                ELSE 'unchanged'
            END,

        'reason','SCOPED_STATUS_INGRESS_RECOVERY',

        'recovered_count',v_recovered,

        'existing_count',v_existing_count,

        'conflict_count',v_conflicts

    );

END;
$function$;

ALTER FUNCTION public.recover_human_quote_status_ingress_by_system(
    uuid,uuid,uuid,uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION
public.recover_human_quote_status_ingress_by_system(
    uuid,uuid,uuid,uuid
) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION
public.recover_human_quote_status_ingress_by_system(
    uuid,uuid,uuid,uuid
) TO service_role;
