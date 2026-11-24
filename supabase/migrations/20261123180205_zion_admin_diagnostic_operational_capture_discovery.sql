-- ZION-ADM | Bloco 2 | Descoberta operacional
-- Requer as migrations 18-F, 18-I, 18-N e 18-R.
-- Nao executa o writer nem ativa cron.
-- Nao faz backfill de eventos anteriores a ativacao.

BEGIN;

CREATE FUNCTION public.discover_zion_admin_operational_capture_attempts_by_system(
    p_batch_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_activated_at timestamptz;
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
            'discovered', 0
        );
    END IF;

    -- Eventos anteriores a ativacao nunca entram.
    -- Eventos ja descobertos ou registrados sao ignorados.
    -- Linhas sao bloqueadas para evitar descoberta
    -- concorrente da mesma transicao.
    -- Historico e tentativa compartilham a transacao.

    WITH candidates AS MATERIALIZED (
        SELECT e.id
        FROM public.zion_admin_diagnostic_operational_failure_events e
        WHERE e.captured_at >= v_activated_at
          AND NOT EXISTS (
              SELECT 1
              FROM public.zion_admin_diagnostic_operational_capture_attempts a
              WHERE a.event_id = e.id
          )
          AND NOT EXISTS (
              SELECT 1
              FROM public.zion_admin_diagnostic_occurrences o
              WHERE o.occurrence_key =
                  'zion-b2:operational-event:' || e.id::text
          )
        ORDER BY e.captured_at ASC, e.id ASC
        LIMIT p_batch_limit
        FOR UPDATE OF e SKIP LOCKED
    ),
    inserted AS (
        INSERT INTO public.zion_admin_diagnostic_operational_capture_attempts (
            event_id
        )
        SELECT c.id
        FROM candidates c
        WHERE TRUE
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
    ),
    logged AS (
        INSERT INTO public.zion_admin_diagnostic_operational_capture_history (
            event_id,
            event_kind,
            previous_state,
            new_state,
            attempt_count_before,
            attempt_count_after,
            actor_kind
        )
        SELECT
            i.event_id,
            'discovered',
            NULL,
            'pending',
            NULL,
            0,
            'system'
        FROM inserted i
        RETURNING id
    )
    SELECT count(*)::integer
    INTO v_discovered
    FROM logged;

    RETURN pg_catalog.jsonb_build_object(
        'source_system', 'operational_failure_events',
        'status', 'active',
        'batch_limit', p_batch_limit,
        'discovered', v_discovered
    );
END;
$function$;

REVOKE ALL ON FUNCTION
    public.discover_zion_admin_operational_capture_attempts_by_system(integer)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.discover_zion_admin_operational_capture_attempts_by_system(integer)
TO service_role;

COMMIT;