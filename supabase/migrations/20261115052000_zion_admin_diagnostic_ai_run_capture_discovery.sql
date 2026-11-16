-- ZION-ADM | Bloco 2 | 2.3-D.9-G
-- Descoberta manual, limitada e idempotente.
-- Nao processa tentativas.
-- Nao cria cron ou trigger.
-- Nao seleciona nem armazena texto bruto de erro.

BEGIN;

CREATE FUNCTION public.discover_zion_admin_ai_run_capture_attempts_by_system(
    p_batch_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_discovered integer := 0;
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

    -- Descobrir apenas fontes com erro e ainda
    -- sem ocorrencia administrativa ou tentativa.
    --
    -- A ordem e deterministica.
    -- ON CONFLICT protege contra descobertas concorrentes.
    --
    -- A insercao do historico integra a mesma instrucao:
    -- se falhar, a descoberta tambem sera revertida.

    WITH candidates AS MATERIALIZED (
        SELECT r.id
        FROM public.ai_runs r
        WHERE NULLIF(
            pg_catalog.btrim(r.error),
            ''
        ) IS NOT NULL

          AND NOT EXISTS (
              SELECT 1
              FROM public.zion_admin_diagnostic_occurrences o
              WHERE o.occurrence_key =
                  'zion-b2:ai-run-error:' || r.id::text
          )

          AND NOT EXISTS (
              SELECT 1
              FROM public.zion_admin_diagnostic_ai_run_capture_attempts a
              WHERE a.source_run_id = r.id
          )

        ORDER BY
            r.created_at ASC NULLS FIRST,
            r.id ASC

        LIMIT p_batch_limit
    ),

    inserted AS (
        INSERT INTO
            public.zion_admin_diagnostic_ai_run_capture_attempts (
                source_run_id,
                state,
                attempt_count,
                max_attempts,
                next_attempt_at
            )
        SELECT
            c.id,
            'pending',
            0,
            3,
            pg_catalog.clock_timestamp()
        FROM candidates c

        ON CONFLICT (source_run_id) DO NOTHING

        RETURNING source_run_id
    )

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
    SELECT
        i.source_run_id,
        'discovered',
        NULL,
        'pending',
        NULL,
        0,
        'system'
    FROM inserted i;

    GET DIAGNOSTICS
        v_discovered = ROW_COUNT;

    RETURN pg_catalog.jsonb_build_object(
        'source_system', 'ai_runs',
        'batch_limit', p_batch_limit,
        'discovered', v_discovered
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.discover_zion_admin_ai_run_capture_attempts_by_system(integer)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.discover_zion_admin_ai_run_capture_attempts_by_system(integer)
TO service_role;

COMMIT;