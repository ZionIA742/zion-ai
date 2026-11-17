-- ZION-ADM | Bloco 2 | 2.3-D.9-J
-- Processador manual e independente.
-- Nenhum cron, trigger ou chamada pelas IAs.
-- Nunca persiste mensagens brutas ou stacks.
-- A operacao e seu historico integram a mesma transacao.

BEGIN;

CREATE FUNCTION public.process_zion_admin_ai_run_capture_attempts_by_system(
    p_batch_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_item record;
    v_result jsonb;
    v_attempt integer;
    v_sqlstate text;
    v_message text;
    v_code text;
    v_new_state text;
    v_event text;
    v_next timestamptz;

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
            'ZION_DIAGNOSTIC_INVALID_BATCH_LIMIT'
            USING ERRCODE = '22023';
    END IF;

    -- A tentativa permanece bloqueada ate o fim
    -- da transacao, evitando processamento concorrente.

    FOR v_item IN
        SELECT
            a.source_run_id,
            a.state,
            a.attempt_count,
            a.max_attempts
        FROM
            public.zion_admin_diagnostic_ai_run_capture_attempts a
        WHERE a.state IN ('pending', 'retryable_failed')
          AND a.next_attempt_at <=
              pg_catalog.clock_timestamp()
          AND a.attempt_count < a.max_attempts
        ORDER BY
            a.next_attempt_at ASC,
            a.created_at ASC,
            a.source_run_id ASC
        LIMIT p_batch_limit
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        v_selected := v_selected + 1;
        v_attempt := v_item.attempt_count + 1;

        -- Registrar o inicio antes de chamar o escritor.
        -- O evento e a contagem compartilham a transacao.

        UPDATE
            public.zion_admin_diagnostic_ai_run_capture_attempts
        SET
            attempt_count = v_attempt,
            updated_at = pg_catalog.clock_timestamp()
        WHERE source_run_id = v_item.source_run_id;

        INSERT INTO
            public.zion_admin_diagnostic_ai_run_capture_history (
                source_run_id,
                event_kind,
                previous_state,
                new_state,
                attempt_count_before,
                attempt_count_after,
                actor_kind
            )
        VALUES (
            v_item.source_run_id,
            'attempt_started',
            v_item.state,
            v_item.state,
            v_item.attempt_count,
            v_attempt,
            'system'
        );

        -- Subtransacao do escritor e da conclusao.
        -- Se uma dessas operacoes falhar, seus efeitos
        -- sao revertidos antes de registrar a falha.

        BEGIN
            v_result :=
                public.register_zion_admin_ai_run_error_by_system(
                    v_item.source_run_id
                );

            IF v_result->>'new_occurrence'
                IS DISTINCT FROM 'true'
               AND v_result->>'new_occurrence'
                IS DISTINCT FROM 'false' THEN
                RAISE EXCEPTION
                    'ZION_DIAGNOSTIC_WRITER_INVALID_RESULT'
                    USING ERRCODE = 'P0001';
            END IF;

            UPDATE
                public.zion_admin_diagnostic_ai_run_capture_attempts
            SET
                state = 'registered',
                next_attempt_at = NULL,
                last_sqlstate = NULL,
                last_failure_at = NULL,
                updated_at = pg_catalog.clock_timestamp()
            WHERE source_run_id = v_item.source_run_id;

            INSERT INTO
                public.zion_admin_diagnostic_ai_run_capture_history (
                    source_run_id,
                    event_kind,
                    previous_state,
                    new_state,
                    attempt_count_before,
                    attempt_count_after,
                    actor_kind
                )
            VALUES (
                v_item.source_run_id,
                'attempt_succeeded',
                v_item.state,
                'registered',
                v_attempt,
                v_attempt,
                'system'
            );

            v_registered := v_registered + 1;

        EXCEPTION WHEN OTHERS THEN

            -- A mensagem original permanece apenas
            -- em memoria para comparacao com codigos
            -- conhecidos do escritor.
            -- Nunca retornar ou persistir v_message.

            GET STACKED DIAGNOSTICS
                v_sqlstate = RETURNED_SQLSTATE,
                v_message = MESSAGE_TEXT;

            v_code :=
                CASE v_message
                    WHEN 'ZION_DIAGNOSTIC_SOURCE_NOT_FOUND'
                        THEN 'source_not_found'
                    WHEN 'ZION_DIAGNOSTIC_SOURCE_HAS_NO_ERROR'
                        THEN 'source_has_no_error'
                    WHEN 'ZION_DIAGNOSTIC_SOURCE_SCOPE_MISSING'
                        THEN 'scope_missing'
                    WHEN 'ZION_DIAGNOSTIC_SOURCE_SCOPE_INVALID'
                        THEN 'scope_invalid'
                    WHEN 'ZION_DIAGNOSTIC_SCOPE_CONFLICT'
                        THEN 'scope_conflict'
                    WHEN 'ZION_DIAGNOSTIC_INCIDENT_LOOKUP_FAILED'
                        THEN 'incident_lookup_failed'
                    WHEN 'ZION_DIAGNOSTIC_OCCURRENCE_CONFLICT'
                        THEN 'occurrence_conflict'
                    WHEN 'ZION_DIAGNOSTIC_WRITER_INVALID_RESULT'
                        THEN 'writer_invalid_result'
                    ELSE
                        CASE
                            WHEN v_sqlstate IN (
                                '40001',
                                '40P01',
                                '55P03',
                                '57014',
                                '53100',
                                '53200',
                                '53300',
                                '53400',
                                '08000',
                                '08001',
                                '08003',
                                '08006',
                                '08007'
                            )
                            THEN 'database_transient'
                            ELSE 'database_other'
                        END
                END;

            v_next := NULL;

            IF v_code IN (
                'source_not_found',
                'source_has_no_error'
            ) THEN
                v_new_state := 'no_longer_eligible';
                v_event := 'no_longer_eligible';
                v_ineligible := v_ineligible + 1;

            ELSIF v_code IN (
                'scope_missing',
                'scope_invalid',
                'scope_conflict',
                'incident_lookup_failed',
                'occurrence_conflict',
                'writer_invalid_result'
            )
            OR v_attempt >= v_item.max_attempts THEN
                v_new_state := 'needs_review';
                v_event := 'needs_review';
                v_review := v_review + 1;

            ELSE
                v_new_state := 'retryable_failed';
                v_event := 'retry_scheduled';

                v_next :=
                    pg_catalog.clock_timestamp()
                    + pg_catalog.make_interval(
                        mins =>
                            CASE
                                WHEN v_attempt = 1 THEN 5
                                ELSE 15
                            END
                    );

                v_retry := v_retry + 1;
            END IF;

            UPDATE
                public.zion_admin_diagnostic_ai_run_capture_attempts
            SET
                state = v_new_state,
                next_attempt_at = v_next,
                last_sqlstate = v_sqlstate,
                last_failure_at = pg_catalog.clock_timestamp(),
                updated_at = pg_catalog.clock_timestamp()
            WHERE source_run_id = v_item.source_run_id;

            INSERT INTO
                public.zion_admin_diagnostic_ai_run_capture_history (
                    source_run_id,
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
                v_item.source_run_id,
                v_event,
                v_item.state,
                v_new_state,
                v_attempt,
                v_attempt,
                v_sqlstate,
                v_code,
                'system'
            );
        END;
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'source_system', 'ai_runs',
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
    public.process_zion_admin_ai_run_capture_attempts_by_system(integer)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.process_zion_admin_ai_run_capture_attempts_by_system(integer)
TO service_role;

COMMIT;