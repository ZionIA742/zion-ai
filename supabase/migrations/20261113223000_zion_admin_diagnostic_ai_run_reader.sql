-- ZION-ADM | BLOCO 2 | 2.3-C.2
-- Leitura protegida dos incidentes de ai_runs.
-- Exclusiva de backend service_role.
-- A API administrativa devera validar a sessao.
-- Nao retorna erros brutos ou evidencias livres.
-- Nao cria cron nem altera incidentes.

BEGIN;

CREATE FUNCTION public.list_zion_admin_ai_run_diagnostics_by_system(
    p_limit integer DEFAULT 30,
    p_offset integer DEFAULT 0,
    p_store_id uuid DEFAULT NULL
)
RETURNS TABLE (
    incident_id uuid,
    occurrence_id uuid,
    organization_id uuid,
    store_id uuid,
    incident_status text,
    severity text,
    cause_confidence text,
    title_simple text,
    explanation_simple text,
    impact_simple text,
    next_action_simple text,
    first_seen_at timestamptz,
    last_seen_at timestamptz,
    occurred_at timestamptz,
    captured_at timestamptz,
    technical_error_code text,
    source_record_id text,
    occurrence_count bigint,
    last_failure_older_than_30_days boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_limit IS NULL
       OR p_limit < 1
       OR p_limit > 50 THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_INVALID_PAGE_LIMIT'
            USING ERRCODE = '22023';
    END IF;

    IF p_offset IS NULL
       OR p_offset < 0
       OR p_offset > 5000 THEN
        RAISE EXCEPTION
            'ZION_DIAGNOSTIC_INVALID_PAGE_OFFSET'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH pagina AS MATERIALIZED (
        SELECT i.*
        FROM public.zion_admin_diagnostic_incidents i
        WHERE i.scope = 'store'
          AND i.component = 'sales_ai'
          AND i.category = 'ai_run_error'
          AND (
              p_store_id IS NULL
              OR i.store_id = p_store_id
          )
        ORDER BY
            i.last_seen_at DESC,
            i.id DESC
        LIMIT p_limit
        OFFSET p_offset
    )
    SELECT
        i.id,
        o.id,
        i.organization_id,
        i.store_id,
        i.status,
        i.severity,
        i.cause_confidence,

        i.title_simple,
        i.explanation_simple,
        i.impact_simple,
        i.next_action_simple,

        i.first_seen_at,
        i.last_seen_at,
        o.occurred_at,
        o.captured_at,

        CASE
            WHEN o.source_system = 'ai_runs'
             AND o.error_code = 'AI_RUN_ERROR_RECORDED'
            THEN 'AI_RUN_ERROR_RECORDED'
            ELSE 'DIAGNOSTIC_CODE_UNAVAILABLE'
        END,

        CASE
            WHEN o.source_system = 'ai_runs'
             AND o.source_record_id ~*
                '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN o.source_record_id
            ELSE NULL::text
        END,

        totals.occurrence_count,

        (
            i.last_seen_at <
                now() - interval '30 days'
        )

    FROM pagina i

    LEFT JOIN LATERAL (
        SELECT
            x.id,
            x.source_system,
            x.source_record_id,
            x.error_code,
            x.occurred_at,
            x.captured_at
        FROM public.zion_admin_diagnostic_occurrences x
        WHERE x.incident_id = i.id
          AND x.source_system = 'ai_runs'
        ORDER BY
            x.occurred_at DESC,
            x.id DESC
        LIMIT 1
    ) o ON true

    CROSS JOIN LATERAL (
        SELECT COUNT(*) AS occurrence_count
        FROM public.zion_admin_diagnostic_occurrences x
        WHERE x.incident_id = i.id
          AND x.source_system = 'ai_runs'
    ) totals

    ORDER BY
        i.last_seen_at DESC,
        i.id DESC;
END;
$function$;

REVOKE ALL ON FUNCTION
    public.list_zion_admin_ai_run_diagnostics_by_system(
        integer, integer, uuid
    )
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.list_zion_admin_ai_run_diagnostics_by_system(
        integer, integer, uuid
    )
TO service_role;

COMMIT;
