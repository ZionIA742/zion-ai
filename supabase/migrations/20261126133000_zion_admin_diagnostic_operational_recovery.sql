-- ZION-ADM | Operational recovery evidence foundation.
-- No automatic reprocessing, triggers or cron changes.

BEGIN;

CREATE TABLE public.zion_admin_diagnostic_operational_recovery_events (
    failure_event_id uuid PRIMARY KEY
        REFERENCES public.zion_admin_diagnostic_operational_failure_events(id)
        ON DELETE RESTRICT,

    processed_at timestamptz NOT NULL,

    evidence_kind text NOT NULL CHECK (
        evidence_kind IN (
            'whatsapp_status_applied',
            'whatsapp_quote_status_reconciled',
            'whatsapp_sales_ai_reply_persisted',
            'ai_queue_reply_persisted',
            'ai_queue_recovery_completed'
        )
    ),

    recorded_at timestamptz NOT NULL
        DEFAULT pg_catalog.clock_timestamp(),

    CONSTRAINT zador_processed_order_check
        CHECK (processed_at <= recorded_at)
);

ALTER TABLE
    public.zion_admin_diagnostic_operational_recovery_events
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE
    public.zion_admin_diagnostic_operational_recovery_events
    FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_diagnostic_operational_recovery_events
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION
public.register_zion_admin_operational_recovery_by_system(
    p_source_system text,
    p_source_record_id uuid,
    p_organization_id uuid,
    p_store_id uuid,
    p_processed_at timestamptz,
    p_evidence_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    v_failure public.zion_admin_diagnostic_operational_failure_events%ROWTYPE;

    v_processed_at timestamptz;
    v_processing_error text;
    v_activated_at timestamptz;
    v_inserted_id uuid;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_RECOVERY_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_source_record_id IS NULL
       OR p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_processed_at IS NULL
       OR NOT pg_catalog.isfinite(p_processed_at)
       OR p_processed_at > pg_catalog.clock_timestamp()
    THEN
        RAISE EXCEPTION
            'ZION_RECOVERY_INVALID_ARGUMENTS'
            USING ERRCODE = '22023';
    END IF;

    IF (
        (
            p_source_system = 'channel_whatsapp_inbox'
            AND p_evidence_kind IN (
                'whatsapp_status_applied',
                'whatsapp_quote_status_reconciled',
                'whatsapp_sales_ai_reply_persisted'
            )
        )
        OR (
            p_source_system = 'ai_run_queue'
            AND p_evidence_kind IN (
                'ai_queue_reply_persisted',
                'ai_queue_recovery_completed'
            )
        )
    ) IS NOT TRUE THEN
        RAISE EXCEPTION
            'ZION_RECOVERY_EVIDENCE_NOT_ALLOWED'
            USING ERRCODE = '22023';
    END IF;

    SELECT a.activated_at
    INTO v_activated_at
    FROM public.zion_admin_diagnostic_operational_capture_activation a
    WHERE a.singleton IS TRUE;

    IF v_activated_at IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'registered', false,
            'reason', 'capture_inactive'
        );
    END IF;

    PERFORM 1
    FROM public.stores s
    WHERE s.id = p_store_id
      AND s.organization_id = p_organization_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_RECOVERY_SCOPE_INVALID'
            USING ERRCODE = '22023';
    END IF;

    -- Normal successful operations do not generate
    -- recovery records when no prior failure exists.

    PERFORM 1
    FROM public.zion_admin_diagnostic_operational_failure_events e
    WHERE e.source_system = p_source_system
      AND e.source_record_id = p_source_record_id
      AND e.organization_id = p_organization_id
      AND e.store_id = p_store_id
      AND e.captured_at >= v_activated_at;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'registered', false,
            'reason', 'no_eligible_failure'
        );
    END IF;

    -- Read the exact finalized source record.
    -- Never change the operational queue.

    IF p_source_system = 'channel_whatsapp_inbox' THEN
        SELECT s.processed_at, s.processing_error
        INTO v_processed_at, v_processing_error
        FROM public.channel_whatsapp_inbox s
        WHERE s.id = p_source_record_id
          AND s.organization_id = p_organization_id
          AND s.store_id = p_store_id
        FOR SHARE NOWAIT;

    ELSIF p_source_system = 'ai_run_queue' THEN
        SELECT s.processed_at, s.processing_error
        INTO v_processed_at, v_processing_error
        FROM public.ai_run_queue s
        WHERE s.id = p_source_record_id
          AND s.organization_id = p_organization_id
          AND s.store_id = p_store_id
        FOR SHARE NOWAIT;
    END IF;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'registered', false,
            'reason', 'source_record_missing'
        );
    END IF;

    IF v_processed_at IS DISTINCT FROM p_processed_at
       OR v_processing_error IS NOT NULL
    THEN
        RETURN pg_catalog.jsonb_build_object(
            'registered', false,
            'reason', 'finalization_not_confirmed'
        );
    END IF;

    -- Only the latest eligible failure can be recovered.
    -- An older success must not resolve a newer failure.

    SELECT e.*
    INTO v_failure
    FROM public.zion_admin_diagnostic_operational_failure_events e
    WHERE e.source_system = p_source_system
      AND e.source_record_id = p_source_record_id
      AND e.organization_id = p_organization_id
      AND e.store_id = p_store_id
      AND e.captured_at >= v_activated_at
    ORDER BY e.captured_at DESC, e.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'registered', false,
            'reason', 'no_eligible_failure'
        );
    END IF;

    IF p_processed_at <= v_failure.captured_at THEN
        RETURN pg_catalog.jsonb_build_object(
            'registered', false,
            'reason', 'success_not_after_failure'
        );
    END IF;

    IF (
        (
            v_failure.failure_code = 'whatsapp_status_failed_final'
            AND p_evidence_kind IN (
                'whatsapp_status_applied',
                'whatsapp_quote_status_reconciled'
            )
        )
        OR (
            v_failure.failure_code = 'whatsapp_sales_ai_failed_final'
            AND p_evidence_kind =
                'whatsapp_sales_ai_reply_persisted'
        )
        OR (
            v_failure.failure_code = 'ai_run_queue_failed_final'
            AND p_evidence_kind IN (
                'ai_queue_reply_persisted',
                'ai_queue_recovery_completed'
            )
        )
    ) IS NOT TRUE THEN
        RETURN pg_catalog.jsonb_build_object(
            'registered', false,
            'reason', 'failure_evidence_mismatch'
        );
    END IF;

    -- The trusted worker supplies explicit evidence.
    -- processed_at alone does not authorize recovery.

    INSERT INTO
        public.zion_admin_diagnostic_operational_recovery_events (
            failure_event_id,
            processed_at,
            evidence_kind
        )
    VALUES (
        v_failure.id,
        p_processed_at,
        p_evidence_kind
    )
    ON CONFLICT (failure_event_id) DO NOTHING
    RETURNING failure_event_id INTO v_inserted_id;

    RETURN pg_catalog.jsonb_build_object(
        'registered', v_inserted_id IS NOT NULL,
        'reason', CASE
            WHEN v_inserted_id IS NOT NULL
                THEN 'recovery_registered'
            ELSE 'already_registered'
        END,
        'failure_event_id', v_failure.id
    );
END;
$function$;

ALTER FUNCTION
    public.register_zion_admin_operational_recovery_by_system(
        text, uuid, uuid, uuid, timestamptz, text
    )
OWNER TO postgres;

REVOKE ALL ON FUNCTION
    public.register_zion_admin_operational_recovery_by_system(
        text, uuid, uuid, uuid, timestamptz, text
    )
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.register_zion_admin_operational_recovery_by_system(
        text, uuid, uuid, uuid, timestamptz, text
    )
TO service_role;

COMMIT;
