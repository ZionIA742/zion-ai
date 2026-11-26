-- ZION-ADM | Explicit worker recovery bridge.
-- Original finalization remains the operational authority.
-- Diagnostic errors must not roll back finalization.

BEGIN;

CREATE FUNCTION
public.finalize_zion_admin_recovery_worker_by_system(
    p_source_system text,
    p_source_record_id uuid,
    p_organization_id uuid,
    p_store_id uuid,
    p_claim_token uuid,
    p_max_attempts integer,
    p_evidence_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    v_result jsonb;
    v_previous_lock_timeout text;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_RECOVERY_WORKER_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF (
        (
            p_source_system = 'ai_run_queue'
            AND p_evidence_kind IN (
                'ai_queue_reply_persisted',
                'ai_queue_recovery_completed'
            )
        )
        OR (
            p_source_system = 'channel_whatsapp_inbox'
            AND p_evidence_kind IN (
                'whatsapp_status_applied',
                'whatsapp_quote_status_reconciled',
                'whatsapp_sales_ai_reply_persisted'
            )
        )
    ) IS NOT TRUE THEN
        RAISE EXCEPTION
            'ZION_RECOVERY_WORKER_EVIDENCE_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF p_source_record_id IS NULL
       OR p_organization_id IS NULL
       OR p_store_id IS NULL
       OR p_claim_token IS NULL
    THEN
        RAISE EXCEPTION
            'ZION_RECOVERY_WORKER_SCOPE_REQUIRED'
            USING ERRCODE = '22023';
    END IF;

    IF p_source_system = 'ai_run_queue' THEN

        SELECT pg_catalog.to_jsonb(r)
        INTO v_result
        FROM public.finalize_ai_run_queue_task_by_system(
            p_organization_id => p_organization_id,
            p_store_id => p_store_id,
            p_queue_id => p_source_record_id,
            p_claim_token => p_claim_token,
            p_outcome => 'processed',
            p_error_text => NULL,
            p_max_attempts => p_max_attempts
        ) r;

    ELSE

        SELECT pg_catalog.to_jsonb(r)
        INTO v_result
        FROM public.finalize_whatsapp_inbox_event_by_system(
            p_organization_id => p_organization_id,
            p_store_id => p_store_id,
            p_inbox_id => p_source_record_id,
            p_claim_token => p_claim_token,
            p_outcome => 'processed',
            p_error_text => NULL,
            p_max_attempts => p_max_attempts
        ) r;

    END IF;

    -- Never manufacture a successful finalization.

    IF v_result IS NULL
       OR v_result ->> 'ok' IS DISTINCT FROM 'true'
       OR v_result ->> 'id'
            IS DISTINCT FROM p_source_record_id::text
       OR v_result ->> 'organization_id'
            IS DISTINCT FROM p_organization_id::text
       OR v_result ->> 'store_id'
            IS DISTINCT FROM p_store_id::text
       OR v_result ->> 'claim_token'
            IS DISTINCT FROM p_claim_token::text
       OR v_result ->> 'processed_at' IS NULL
       OR v_result -> 'processing_error'
            IS DISTINCT FROM 'null'::jsonb
    THEN
        RETURN v_result;
    END IF;

    -- Isolate diagnostic writes in a subtransaction.
    -- Do not run a second operational finalization.

    BEGIN

        v_previous_lock_timeout :=
            pg_catalog.current_setting('lock_timeout');

        PERFORM pg_catalog.set_config(
            'lock_timeout',
            '250ms',
            true
        );

        PERFORM
            public.register_zion_admin_operational_recovery_by_system(
                p_source_system,
                p_source_record_id,
                p_organization_id,
                p_store_id,
                (v_result ->> 'processed_at')::timestamptz,
                p_evidence_kind
            );

        PERFORM pg_catalog.set_config(
            'lock_timeout',
            v_previous_lock_timeout,
            true
        );

    EXCEPTION WHEN OTHERS THEN

        RAISE WARNING
            'ZION_ADM_RECOVERY_CAPTURE_FAILED: %',
            SQLSTATE;

    END;

    RETURN v_result;
END;
$function$;

ALTER FUNCTION
public.finalize_zion_admin_recovery_worker_by_system(
    text, uuid, uuid, uuid, uuid, integer, text
)
OWNER TO postgres;

REVOKE ALL ON FUNCTION
public.finalize_zion_admin_recovery_worker_by_system(
    text, uuid, uuid, uuid, uuid, integer, text
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.finalize_zion_admin_recovery_worker_by_system(
    text, uuid, uuid, uuid, uuid, integer, text
)
TO service_role;

COMMIT;
