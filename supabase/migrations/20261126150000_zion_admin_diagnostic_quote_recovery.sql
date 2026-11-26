-- ZION-ADM | Quote status recovery integration.
-- Preserve existing operational reconciliation.
-- Requires the exact original function body.

BEGIN;

DO $guard$
BEGIN
    IF (
        SELECT count(*)
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n
          ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'reconcile_human_quote_status_inbox_by_system'
          AND pg_catalog.md5(
              pg_catalog.replace(
                  p.prosrc,
                  chr(13) || chr(10),
                  chr(10)
              )
          ) = '1b9498bced3183c4ce3a8f2b25b0ea87'
    ) <> 1 THEN
        RAISE EXCEPTION
            'ZION_QUOTE_RECOVERY_AUTHORITY_DIVERGED';
    END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.reconcile_human_quote_status_inbox_by_system(
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
    v_zion_diag_ids uuid[];
    v_zion_diag_row record;
    v_zion_diag_lock_timeout text;
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

    SELECT count(*), array_agg(id)
    INTO v_count, v_zion_diag_ids
    FROM changed;

    -- Record only inbox rows reconciled by this authority.
    -- Diagnostic failures must not undo reconciliation.

    IF v_count > 0 AND auth.role() = 'service_role' THEN
        BEGIN
            v_zion_diag_lock_timeout :=
                pg_catalog.current_setting('lock_timeout');

            PERFORM pg_catalog.set_config(
                'lock_timeout', '250ms', true
            );

            FOR v_zion_diag_row IN
                SELECT i.id, i.processed_at
                FROM public.channel_whatsapp_inbox i
                WHERE i.id = ANY(v_zion_diag_ids)
                  AND i.organization_id =
                      v_op.organization_id
                  AND i.store_id = v_op.store_id
                  AND i.processed_at IS NOT NULL
                  AND i.processing_error IS NULL
                ORDER BY i.id
            LOOP
                BEGIN
                    PERFORM
                        public.register_zion_admin_operational_recovery_by_system(
                            'channel_whatsapp_inbox',
                            v_zion_diag_row.id,
                            v_op.organization_id,
                            v_op.store_id,
                            v_zion_diag_row.processed_at,
                            'whatsapp_quote_status_reconciled'
                        );
                EXCEPTION WHEN OTHERS THEN
                    RAISE WARNING
                        'ZION_ADM_QUOTE_RECOVERY_CAPTURE_FAILED: %',
                        SQLSTATE;
                END;
            END LOOP;

            PERFORM pg_catalog.set_config(
                'lock_timeout',
                v_zion_diag_lock_timeout,
                true
            );

        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING
                'ZION_ADM_QUOTE_RECOVERY_BATCH_FAILED: %',
                SQLSTATE;
        END;
    END IF;

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

COMMIT;
