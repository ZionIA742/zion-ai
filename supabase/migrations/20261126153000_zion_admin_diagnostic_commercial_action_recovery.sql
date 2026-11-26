-- ZION-ADM | Commercial action recovery evidence.
-- Observation only. No commercial execution or retries.

BEGIN;

DO $guard$
DECLARE
    v_constraint text;
BEGIN
    SELECT c.conname
    INTO STRICT v_constraint
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid =
        'public.zion_admin_diagnostic_operational_recovery_events'
            ::pg_catalog.regclass
      AND c.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(c.oid)
          LIKE '%evidence_kind%';

    EXECUTE pg_catalog.format(
        'ALTER TABLE public.zion_admin_diagnostic_operational_recovery_events DROP CONSTRAINT %I',
        v_constraint
    );
END;
$guard$;

ALTER TABLE
    public.zion_admin_diagnostic_operational_recovery_events
ADD CONSTRAINT zion_operational_recovery_evidence_kind_check
CHECK (
    evidence_kind IN (
        'whatsapp_status_applied',
        'whatsapp_quote_status_reconciled',
        'whatsapp_sales_ai_reply_persisted',
        'ai_queue_reply_persisted',
        'ai_queue_recovery_completed',
        'sales_action_message_persisted'
    )
);

CREATE FUNCTION
public.capture_zion_admin_commercial_recovery_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    v_activation timestamptz;
    v_failure record;
    v_run_id uuid;
    v_lock_timeout text;
BEGIN

    -- A finalization without a previous failure
    -- is not a recovery.

    IF NEW.processed_at IS NULL
       OR NEW.processing_error IS NOT NULL
       OR NEW.processed_at IS NOT DISTINCT FROM OLD.processed_at
    THEN
        RETURN NEW;
    END IF;

    BEGIN

        SELECT a.activated_at
        INTO v_activation
        FROM public.zion_admin_diagnostic_operational_capture_activation a
        WHERE a.singleton IS TRUE;

        IF v_activation IS NULL THEN
            RETURN NEW;
        END IF;

        SELECT f.id, f.captured_at
        INTO v_failure
        FROM public.zion_admin_diagnostic_operational_failure_events f
        WHERE f.source_system = 'ai_sales_action_queue'
          AND f.source_record_id = NEW.id
          AND f.organization_id = NEW.organization_id
          AND f.store_id = NEW.store_id
          AND f.failure_code = 'sales_action_processing_failed'
          AND f.captured_at >= v_activation
        ORDER BY f.captured_at DESC, f.id DESC
        LIMIT 1;

        IF NOT FOUND THEN
            RETURN NEW;
        END IF;

        IF NEW.processed_at <= v_failure.captured_at THEN
            RETURN NEW;
        END IF;

        -- Only the three known message-producing
        -- real handlers are initially eligible.
        -- Safe mode, skipped actions, duplicate-only
        -- results and unproven follow-ups are excluded.

        IF NEW.next_action NOT IN (
            'qualify_lead',
            'confirm_payment',
            'confirm_sale'
        ) THEN
            RETURN NEW;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM public.stores s
            WHERE s.id = NEW.store_id
              AND s.organization_id = NEW.organization_id
        ) THEN
            RETURN NEW;
        END IF;

        -- Require a unique durable execution with
        -- explicit success and a persisted message.

        BEGIN

            SELECT r.id
            INTO STRICT v_run_id
            FROM public.ai_sales_action_runs r
            JOIN public.messages m
              ON m.id = CASE
                  WHEN (
                      r.output #>>
                      '{dispatch,details,message_id}'
                  ) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN (
                      r.output #>>
                      '{dispatch,details,message_id}'
                  )::uuid
                  ELSE NULL
              END
            WHERE r.action_queue_id = NEW.id
              AND r.organization_id = NEW.organization_id
              AND r.store_id = NEW.store_id
              AND r.conversation_id = NEW.conversation_id
              AND r.ai_run_id = NEW.ai_run_id
              AND r.next_action = NEW.next_action

              AND r.status = 'succeeded'
              AND r.error_text IS NULL
              AND r.execution_mode_snapshot = 'real'
              AND r.safe_mode_enabled_snapshot IS FALSE
              AND r.real_execution_enabled_snapshot IS TRUE

              AND r.started_at > v_failure.captured_at
              AND r.finished_at >= r.started_at
              AND r.finished_at = NEW.processed_at

              AND r.output ->> 'mode' = 'real'
              AND r.output ->> 'type' =
                  'ai_sales_action_execute'
              AND r.output ->> 'result' =
                  'message_inserted'
              AND r.output ->> 'action_queue_id' =
                  NEW.id::text
              AND r.output ->> 'ai_run_id' =
                  NEW.ai_run_id::text
              AND r.output ->> 'next_action' =
                  NEW.next_action

              AND r.output #> '{dispatch,ok}' =
                  'true'::jsonb
              AND r.output #>> '{dispatch,status}' =
                  'message_inserted'
              AND r.output #>> '{dispatch,action}' =
                  NEW.next_action

              AND m.organization_id = NEW.organization_id
              AND m.store_id = NEW.store_id
              AND m.conversation_id = NEW.conversation_id
              AND m.sender = 'ai'
              AND m.direction = 'outgoing'
              AND m.deleted_at IS NULL
              AND m.created_at >= r.started_at
              AND m.created_at > v_failure.captured_at
              AND m.created_at <= pg_catalog.clock_timestamp()

              AND m.metadata ->> 'source' =
                  'ai_sales_real_handler_' ||
                  NEW.next_action;

        EXCEPTION
            WHEN no_data_found OR too_many_rows THEN
                RETURN NEW;
        END;

        v_lock_timeout :=
            pg_catalog.current_setting('lock_timeout');

        PERFORM pg_catalog.set_config(
            'lock_timeout',
            '250ms',
            true
        );

        INSERT INTO
            public.zion_admin_diagnostic_operational_recovery_events (
                failure_event_id,
                processed_at,
                evidence_kind
            )
        VALUES (
            v_failure.id,
            NEW.processed_at,
            'sales_action_message_persisted'
        )
        ON CONFLICT (failure_event_id) DO NOTHING;

        PERFORM pg_catalog.set_config(
            'lock_timeout',
            v_lock_timeout,
            true
        );

    EXCEPTION WHEN OTHERS THEN

        -- Diagnostic failure must not undo
        -- the original commercial operation.

        RAISE WARNING
            'ZION_ADM_COMMERCIAL_RECOVERY_CAPTURE_FAILED: %',
            SQLSTATE;

    END;

    RETURN NEW;
END;
$function$;

ALTER FUNCTION
public.capture_zion_admin_commercial_recovery_internal()
OWNER TO postgres;

REVOKE ALL ON FUNCTION
public.capture_zion_admin_commercial_recovery_internal()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER zion_admin_capture_sales_action_recovery
AFTER UPDATE OF processed_at, processing_error
ON public.ai_sales_action_queue
FOR EACH ROW
WHEN (
    NEW.processed_at IS NOT NULL
    AND NEW.processing_error IS NULL
    AND OLD.processed_at IS DISTINCT FROM NEW.processed_at
)
EXECUTE FUNCTION
    public.capture_zion_admin_commercial_recovery_internal();

COMMIT;
