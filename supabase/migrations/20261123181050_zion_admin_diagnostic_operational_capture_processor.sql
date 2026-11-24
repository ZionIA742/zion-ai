-- ZION-ADM | Bloco 2 | Processador operacional
-- Depende de baseline, eventos, writer, tentativas e descoberta.
-- Nao ativa cron, nao altera filas operacionais.
-- Nunca persiste mensagens de erro ou stacks brutos.

BEGIN;

CREATE FUNCTION public.process_zion_admin_operational_capture_attempts_by_system(
    p_batch_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_activated_at timestamptz;
    v_item record;
    v_result jsonb;

    v_attempt integer;
    v_sqlstate text;
    v_message text;
    v_code text;

    v_new_state text;
    v_event_kind text;
    v_next_attempt_at timestamptz;

    v_selected integer := 0;
    v_registered integer := 0;
    v_retry integer := 0;
    v_review integer := 0;
    v_ineligible integer := 0;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_batch_limit IS NULL
       OR p_batch_limit < 1
       OR p_batch_limit > 25 THEN
        RAISE EXCEPTION
            'ZION_OPERATIONAL_INVALID_BATCH_LIMIT'
            USING ERRCODE = '22023';
    END IF;

    SELECT a.activated_at
    INTO v_activated_at
    FROM public.zion_admin_diagnostic_operational_capture_activation a
    WHERE a.singleton IS TRUE;

    IF v_activated_at IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'source_system', 'operational_failure_events',
            'status', 'inactive',
            'batch_limit', p_batch_limit,
            'selected', 0,
            'registered', 0,
            'retry_scheduled', 0,
            'needs_review', 0,
            'no_longer_eligible', 0
        );
    END IF;

    FOR v_item IN
        SELECT
            a.event_id,
            a.state,
            a.attempt_count,
            a.max_attempts
        FROM public.zion_admin_diagnostic_operational_capture_attempts a
        INNER JOIN public.zion_admin_diagnostic_operational_failure_events e
            ON e.id = a.event_id
        WHERE a.state IN ('pending', 'retryable_failed')
          AND a.next_attempt_at <= pg_catalog.clock_timestamp()
          AND a.attempt_count < a.max_attempts
        ORDER BY
            a.next_attempt_at ASC,
            a.created_at ASC,
            a.event_id ASC
        LIMIT p_batch_limit
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        v_selected := v_selected + 1;
        v_attempt := v_item.attempt_count + 1;

        -- Registrar a tentativa antes do writer.
        -- Estes registros compartilham a transacao.

        UPDATE public.zion_admin_diagnostic_operational_capture_attempts
        SET
            attempt_count = v_attempt,
            updated_at = pg_catalog.clock_timestamp()
        WHERE event_id = v_item.event_id;

        INSERT INTO public.zion_admin_diagnostic_operational_capture_history (
            event_id,
            event_kind,
            previous_state,
            new_state,
            attempt_count_before,
            attempt_count_after,
            actor_kind
        )
        VALUES (
            v_item.event_id,
            'attempt_started',
            v_item.state,
            v_item.state,
            v_item.attempt_count,
            v_attempt,
            'system'
        );

        -- Bloco de excecao isolado:
        -- se o writer falhar, seus efeitos parciais
        -- sao revertidos antes de agendar retentativa.

        BEGIN
            v_result :=
                public.register_zion_admin_operational_failure_event_by_system(
                    v_item.event_id
                );

            IF v_result IS NULL
               OR pg_catalog.jsonb_typeof(
                    v_result -> 'new_incident'
               ) IS DISTINCT FROM 'boolean'
               OR pg_catalog.jsonb_typeof(
                    v_result -> 'new_occurrence'
               ) IS DISTINCT FROM 'boolean'
               OR (v_result ->> 'incident_id') IS NULL
            THEN
                RAISE EXCEPTION
                    'ZION_OPERATIONAL_WRITER_INVALID_RESULT'
                    USING ERRCODE = 'P0001';
            END IF;

            UPDATE public.zion_admin_diagnostic_operational_capture_attempts
            SET
                state = 'registered',
                next_attempt_at = NULL,
                last_sqlstate = NULL,
                last_failure_code = NULL,
                last_failure_at = NULL,
                updated_at = pg_catalog.clock_timestamp()
            WHERE event_id = v_item.event_id;

            INSERT INTO public.zion_admin_diagnostic_operational_capture_history (
                event_id,
                event_kind,
                previous_state,
                new_state,
                attempt_count_before,
                attempt_count_after,
                actor_kind
            )
            VALUES (
                v_item.event_id,
                'attempt_succeeded',
                v_item.state,
                'registered',
                v_attempt,
                v_attempt,
                'system'
            );

            v_registered := v_registered + 1;

        EXCEPTION WHEN OTHERS THEN
            -- Nunca persistir v_message.
            -- Apenas classificar codigo conhecido
            -- e SQLSTATE, sem dados sensiveis.

            GET STACKED DIAGNOSTICS
                v_sqlstate = RETURNED_SQLSTATE,
                v_message = MESSAGE_TEXT;

            v_code :=
                CASE
                    WHEN v_message =
                        'ZION_OPERATIONAL_EVENT_NOT_ELIGIBLE'
                    THEN 'event_not_eligible'

                    WHEN v_message =
                        'ZION_OPERATIONAL_EVENT_SCOPE_INVALID'
                    THEN 'event_scope_invalid'

                    WHEN v_message =
                        'ZION_OPERATIONAL_WRITER_INVALID_RESULT'
                    THEN 'writer_invalid_result'

                    WHEN v_sqlstate = '42501'
                    THEN 'writer_authorization_failed'

                    WHEN v_sqlstate IN (
                        '40001',
                        '40P01',
                        '55P03',
                        '57014',
                        '53300',
                        '08000',
                        '08003',
                        '08006'
                    )
                    THEN 'writer_transient_failure'

                    ELSE 'writer_unexpected_failure'
                END;

            v_next_attempt_at := NULL;

            IF v_code = 'event_not_eligible' THEN
                v_new_state := 'no_longer_eligible';
                v_event_kind := 'no_longer_eligible';
                v_ineligible := v_ineligible + 1;

            ELSIF v_code IN (
                'event_scope_invalid',
                'writer_invalid_result',
                'writer_authorization_failed'
            )
            OR v_attempt >= v_item.max_attempts THEN
                v_new_state := 'needs_review';
                v_event_kind := 'needs_review';
                v_review := v_review + 1;

            ELSE
                v_new_state := 'retryable_failed';
                v_event_kind := 'retry_scheduled';
                v_retry := v_retry + 1;

                v_next_attempt_at :=
                    pg_catalog.clock_timestamp() +
                    CASE
                        WHEN v_attempt = 1
                        THEN INTERVAL '5 minutes'
                        ELSE INTERVAL '15 minutes'
                    END;
            END IF;

            UPDATE public.zion_admin_diagnostic_operational_capture_attempts
            SET
                state = v_new_state,
                next_attempt_at = v_next_attempt_at,
                last_sqlstate = v_sqlstate,
                last_failure_code = v_code,
                last_failure_at = pg_catalog.clock_timestamp(),
                updated_at = pg_catalog.clock_timestamp()
            WHERE event_id = v_item.event_id;

            INSERT INTO public.zion_admin_diagnostic_operational_capture_history (
                event_id,
                event_kind,
                previous_state,
                new_state,
                attempt_count_before,
                attempt_count_after,
                failure_sqlstate,
                failure_code,
                actor_kind
            )
            VALUES (
                v_item.event_id,
                v_event_kind,
                v_item.state,
                v_new_state,
                v_item.attempt_count,
                v_attempt,
                v_sqlstate,
                v_code,
                'system'
            );
        END;
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'source_system', 'operational_failure_events',
        'status', 'processed',
        'batch_limit', p_batch_limit,
        'selected', v_selected,
        'registered', v_registered,
        'retry_scheduled', v_retry,
        'needs_review', v_review,
        'no_longer_eligible', v_ineligible
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.process_zion_admin_operational_capture_attempts_by_system(integer)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.process_zion_admin_operational_capture_attempts_by_system(integer)
TO service_role;

COMMIT;