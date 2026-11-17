-- ZION-ADM | Bloco 2 | 17-S
-- MVP: ativacao temporal explicita.
-- Nao ativa a captura automaticamente.
-- Nao instala cron ou trigger.
-- Nao armazena mensagens de erro.

BEGIN;

CREATE TABLE public.zion_admin_diagnostic_ai_run_capture_activation (
    singleton boolean PRIMARY KEY DEFAULT true
        CHECK (singleton IS TRUE),
    activated_at timestamptz,
    baseline_rows integer NOT NULL DEFAULT 0,
    baseline_errors integer NOT NULL DEFAULT 0
);

INSERT INTO public.zion_admin_diagnostic_ai_run_capture_activation (
    singleton
)
VALUES (true);

CREATE TABLE public.zion_admin_diagnostic_ai_run_capture_baseline (
    source_run_id uuid PRIMARY KEY,
    had_error boolean NOT NULL,
    captured_at timestamptz NOT NULL
        DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE public.zion_admin_diagnostic_ai_run_capture_activation
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.zion_admin_diagnostic_ai_run_capture_activation
    FORCE ROW LEVEL SECURITY;

ALTER TABLE public.zion_admin_diagnostic_ai_run_capture_baseline
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.zion_admin_diagnostic_ai_run_capture_baseline
    FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_diagnostic_ai_run_capture_activation,
    public.zion_admin_diagnostic_ai_run_capture_baseline
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.activate_zion_admin_ai_run_capture_by_system()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_cutoff timestamptz;
    v_rows integer;
    v_errors integer;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    PERFORM 1
    FROM public.zion_admin_diagnostic_ai_run_capture_activation
    WHERE singleton IS TRUE
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ZION_DIAGNOSTIC_ACTIVATION_STATE_MISSING';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.zion_admin_diagnostic_ai_run_capture_activation
        WHERE singleton IS TRUE
          AND activated_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'ZION_DIAGNOSTIC_ALREADY_ACTIVE';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.zion_admin_diagnostic_ai_run_capture_baseline
    ) THEN
        RAISE EXCEPTION 'ZION_DIAGNOSTIC_BASELINE_NOT_EMPTY';
    END IF;

    v_cutoff := pg_catalog.clock_timestamp();

    INSERT INTO public.zion_admin_diagnostic_ai_run_capture_baseline (
        source_run_id,
        had_error
    )
    SELECT
        r.id,
        NULLIF(pg_catalog.btrim(r.error), '') IS NOT NULL
    FROM public.ai_runs r;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    SELECT count(*)::integer
    INTO v_errors
    FROM public.zion_admin_diagnostic_ai_run_capture_baseline
    WHERE had_error IS TRUE;

    UPDATE public.zion_admin_diagnostic_ai_run_capture_activation
    SET
        activated_at = v_cutoff,
        baseline_rows = v_rows,
        baseline_errors = v_errors
    WHERE singleton IS TRUE;

    RETURN pg_catalog.jsonb_build_object(
        'activated', true,
        'activated_at', v_cutoff,
        'baseline_rows', v_rows,
        'baseline_errors', v_errors
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.activate_zion_admin_ai_run_capture_by_system()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.activate_zion_admin_ai_run_capture_by_system()
TO service_role;

CREATE OR REPLACE FUNCTION
public.discover_zion_admin_ai_run_capture_attempts_by_system(
    p_batch_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_cutoff timestamptz;
    v_discovered integer := 0;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_batch_limit IS NULL
       OR p_batch_limit < 1
       OR p_batch_limit > 25 THEN
        RAISE EXCEPTION 'ZION_DIAGNOSTIC_INVALID_BATCH_LIMIT'
            USING ERRCODE = '22023';
    END IF;

    SELECT activated_at
    INTO v_cutoff
    FROM public.zion_admin_diagnostic_ai_run_capture_activation
    WHERE singleton IS TRUE;

    IF v_cutoff IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'source_system', 'ai_runs',
            'batch_limit', p_batch_limit,
            'discovered', 0,
            'capture_active', false
        );
    END IF;

    WITH candidates AS MATERIALIZED (
        SELECT r.id
        FROM public.ai_runs r
        WHERE NULLIF(pg_catalog.btrim(r.error), '') IS NOT NULL

          -- Execucao existente, sem erro na ativacao.
          AND (
              EXISTS (
                  SELECT 1
                  FROM public.zion_admin_diagnostic_ai_run_capture_baseline b
                  WHERE b.source_run_id = r.id
                    AND b.had_error IS FALSE
              )

              -- Execucao nova, posterior a ativacao.
              OR (
                  r.created_at >= v_cutoff
                  AND NOT EXISTS (
                      SELECT 1
                      FROM public.zion_admin_diagnostic_ai_run_capture_baseline b
                      WHERE b.source_run_id = r.id
                  )
              )
          )

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

        ORDER BY r.created_at ASC NULLS FIRST, r.id ASC
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

    GET DIAGNOSTICS v_discovered = ROW_COUNT;

    RETURN pg_catalog.jsonb_build_object(
        'source_system', 'ai_runs',
        'batch_limit', p_batch_limit,
        'discovered', v_discovered,
        'capture_active', true
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