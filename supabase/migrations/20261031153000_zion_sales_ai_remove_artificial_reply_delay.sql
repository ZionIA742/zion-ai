BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $zion_remove_delay$
DECLARE
    v_function_oid oid;
    v_security_definer boolean;
    v_original text;
    v_updated text;
    v_after text;
    v_start_marker text :=
        '    if v_last_ai_at is not null and v_last_cust_at > v_last_ai_at then';
    v_end_marker text :=
        E'    end if;\r\n\r\n    insert into public.conversation_ai_window_state (';
    v_start integer;
    v_finish integer;
    v_removed text;
BEGIN
    SELECT p.oid, p.prosecdef
      INTO v_function_oid, v_security_definer
    FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure(
        'public.can_ai_reply_now(uuid,uuid,uuid)'
    );

    IF v_function_oid IS NULL THEN
        RAISE EXCEPTION
            'ZION_CAN_AI_REPLY_NOW_NOT_FOUND';
    END IF;

    IF v_security_definer IS DISTINCT FROM true THEN
        RAISE EXCEPTION
            'ZION_SECURITY_DEFINER_UNEXPECTED';
    END IF;

    v_original := pg_get_functiondef(v_function_oid);

    IF position('apply_customer_pause_window' in v_original) = 0
       OR position('can_ai_reply_subscription_guard' in v_original) = 0
       OR position('next_day_window' in v_original) = 0
       OR position('v_existing_resume_at' in v_original) = 0
       OR position('SECURITY DEFINER' in v_original) = 0
    THEN
        RAISE EXCEPTION
            'ZION_ORIGINAL_GUARDS_UNEXPECTED';
    END IF;

    v_start := position(v_start_marker in v_original);
    v_finish := position(v_end_marker in v_original);

    IF v_start = 0 OR v_finish <= v_start THEN
        RAISE EXCEPTION
            'ZION_DELAY_BLOCK_NOT_FOUND';
    END IF;

    IF position(
        v_start_marker IN substring(
            v_original FROM v_start + length(v_start_marker)
        )
    ) > 0
    OR position(
        v_end_marker IN substring(
            v_original FROM v_finish + length(v_end_marker)
        )
    ) > 0 THEN
        RAISE EXCEPTION
            'ZION_DELAY_BLOCK_AMBIGUOUS';
    END IF;

    v_removed := substring(
        v_original
        FROM v_start
        FOR v_finish - v_start + length('    end if;')
    );

    IF position('''fast_lead_delay''' in v_removed) = 0
       OR position('''normal_reply_delay''' in v_removed) = 0
       OR position('v_fast_delay_min_seconds' in v_removed) = 0
       OR position('v_fast_delay_max_seconds' in v_removed) = 0
       OR position('v_normal_delay_min_seconds' in v_removed) = 0
       OR position('v_normal_delay_max_seconds' in v_removed) = 0
       OR position('return false;' in v_removed) = 0
    THEN
        RAISE EXCEPTION
            'ZION_DELAY_BLOCK_CONTENT_UNEXPECTED';
    END IF;

    v_updated :=
        substring(v_original FROM 1 FOR v_start - 1)
        ||
        substring(
            v_original
            FROM v_finish + length('    end if;')
        );

    IF position('''fast_lead_delay''' in v_updated) > 0
       OR position('''normal_reply_delay''' in v_updated) > 0
    THEN
        RAISE EXCEPTION
            'ZION_DELAY_REMAINS_IN_NEW_FUNCTION';
    END IF;

    EXECUTE v_updated;

    v_after := pg_get_functiondef(v_function_oid);

    IF position('''fast_lead_delay''' in v_after) > 0
       OR position('''normal_reply_delay''' in v_after) > 0
       OR position('apply_customer_pause_window' in v_after) = 0
       OR position('can_ai_reply_subscription_guard' in v_after) = 0
       OR position('next_day_window' in v_after) = 0
       OR position('v_existing_resume_at' in v_after) = 0
    THEN
        RAISE EXCEPTION
            'ZION_POST_CHANGE_VALIDATION_FAILED';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc
        WHERE oid = v_function_oid
          AND prosecdef = true
    ) THEN
        RAISE EXCEPTION
            'ZION_SECURITY_DEFINER_NOT_PRESERVED';
    END IF;
END;
$zion_remove_delay$;

COMMIT;