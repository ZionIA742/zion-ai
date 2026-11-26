-- ZION: Reconcile premature missing-message errors
-- using proven accepted independent human quote identity.
-- Preserve administrative failure history and worker claims.

CREATE FUNCTION public.reconcile_human_quote_status_inbox_by_system(
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
    v_count bigint;
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
            'reason','SCOPED_OPERATION_NOT_FOUND',
            'reconciled_count',0
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
            'reason','PROVIDER_ACCEPTANCE_REQUIRED',
            'reconciled_count',0
        );
    END IF;

    WITH candidates AS (

        SELECT i.id

        FROM public.channel_whatsapp_inbox i

        WHERE i.organization_id = v_op.organization_id
          AND i.store_id = v_op.store_id
          AND i.provider = 'meta'
          AND i.processed_at IS NULL

          AND i.claim_token IS NULL
          AND i.claim_expires_at IS NULL
          AND i.claimed_by IS NULL

          AND i.processing_error IN (
              'status_message_not_found_by_external_message_id',
              'whatsapp_status_failed_final:status_message_not_found_by_external_message_id',
              'whatsapp_status_retryable:status_message_not_found_by_external_message_id'
          )

          AND i.payload->>'source' =
              'meta_whatsapp_webhook'

          AND i.payload->>'event_kind' = 'status'

          AND i.payload#>>'{status,id}' =
              v_op.external_message_id

          AND i.payload->>'phone_number_id' =
              v_op.transport_phone_number_id

          AND EXISTS (
              SELECT 1
              FROM public.parse_human_quote_delivery_event_internal(
                  i.payload,
                  v_op.external_message_id,
                  v_op.transport_phone_number_id,
                  v_op.destination_phone,
                  v_op.attempt_started_at,
                  i.received_at
              )
          )

        FOR UPDATE OF i SKIP LOCKED

    ),

    changed AS (

        UPDATE public.channel_whatsapp_inbox i

        SET processed_at = clock_timestamp(),
            processing_error = NULL

        FROM candidates c

        WHERE i.id = c.id
          AND i.organization_id = v_op.organization_id
          AND i.store_id = v_op.store_id
          AND i.processed_at IS NULL
          AND i.claim_token IS NULL
          AND i.claim_expires_at IS NULL
          AND i.claimed_by IS NULL

        RETURNING i.id

    )

    SELECT count(*) INTO v_count
    FROM changed;

    RETURN jsonb_build_object(
        'outcome',
            CASE WHEN v_count > 0
                THEN 'reconciled'
                ELSE 'unchanged'
            END,
        'reason','SCOPED_STATUS_RECONCILIATION',
        'reconciled_count',v_count
    );

END;
$function$;

ALTER FUNCTION public.reconcile_human_quote_status_inbox_by_system(
    uuid,uuid,uuid,uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.reconcile_human_quote_status_inbox_by_system(
    uuid,uuid,uuid,uuid
) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.reconcile_human_quote_status_inbox_by_system(
    uuid,uuid,uuid,uuid
) TO service_role;
