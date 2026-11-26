-- ZION-ADM | Verified operational recovery reader.
-- No operational writes, retries or historical backfill.

BEGIN;

CREATE FUNCTION public.list_zion_admin_diagnostics_recovery_by_system(
    p_limit integer DEFAULT 30,
    p_offset integer DEFAULT 0,
    p_store_id uuid DEFAULT NULL,
    p_source text DEFAULT NULL
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
    last_failure_older_than_30_days boolean,
    registered_component text,
    evidence_origin text,
    evidence_execution_type text,
    evidence_provider text,
    evidence_model text,
    evidence_run_status text,
    evidence_latency_ms bigint,
    scope text,
    source_system text,
    source_family text,
    component text,
    category text,
    backend_route text,
    backend_method text,
    backend_kind text,
    backend_http_status integer,
    backend_error_name text,
    backend_reported_error_code text,
    backend_source_file text,
    backend_source_line integer,
    backend_source_column integer,
    operational_attempt_count bigint,
    resolved_at timestamptz,
    browser_page text,
    browser_kind text,
    browser_error_name text,
    browser_asset text,
    browser_line integer,
    browser_column integer,
    operational_recovery jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
BEGIN

    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION
            'ZION_RECOVERY_READER_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY

    SELECT
        r.*,
        CASE
            WHEN r.source_family = 'operational'
            THEN evidence.payload
            ELSE NULL
        END

    FROM public.list_zion_admin_diagnostics_unified_v2_by_system(
        p_limit => p_limit,
        p_offset => p_offset,
        p_store_id => p_store_id,
        p_source => p_source
    ) r

    LEFT JOIN LATERAL (

        WITH failures AS MATERIALIZED (

            SELECT
                f.id,
                f.failure_code,
                f.captured_at

            FROM
                public.zion_admin_diagnostic_operational_failure_events f

            JOIN
                public.zion_admin_diagnostic_operational_capture_activation a
              ON a.singleton IS TRUE
             AND f.captured_at >= a.activated_at

            WHERE r.source_family = 'operational'
              AND r.scope = 'store'
              AND f.source_system = r.source_system
              AND f.source_record_id = CASE
                    WHEN r.source_record_id ~*
                        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN r.source_record_id::uuid
                    ELSE NULL
                  END
              AND f.organization_id = r.organization_id
              AND f.store_id = r.store_id

        ),

        recoveries AS MATERIALIZED (

            SELECT
                f.id,
                f.failure_code,
                f.captured_at,
                x.processed_at,
                x.evidence_kind

            FROM failures f

            JOIN
                public.zion_admin_diagnostic_operational_recovery_events x
              ON x.failure_event_id = f.id

            WHERE x.processed_at > f.captured_at

        ),

        latest AS (

            SELECT x.*
            FROM recoveries x
            ORDER BY x.processed_at DESC, x.id DESC
            LIMIT 1

        ),

        coverage AS (

            SELECT
                count(*) AS failure_count,
                max(f.captured_at) AS latest_failure,

                count(*) FILTER (
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM recoveries x
                        WHERE x.failure_code = f.failure_code
                          AND x.captured_at >= f.captured_at
                    )
                ) AS unresolved_count

            FROM failures f

        ),

        recent_events AS (

            SELECT
                'failure'::text AS kind,
                f.captured_at AS event_at,
                f.failure_code AS code

            FROM failures f

            UNION ALL

            SELECT
                'recovery'::text,
                x.processed_at,
                x.evidence_kind

            FROM recoveries x

        ),

        limited_events AS (

            SELECT e.*
            FROM recent_events e
            ORDER BY
                e.event_at DESC,
                e.kind,
                e.code
            LIMIT 20

        ),

        proof AS (

            SELECT
                (
                    c.failure_count > 0
                    AND c.unresolved_count = 0
                    AND r.incident_status = 'resolved'
                    AND l.processed_at IS NOT NULL
                    AND r.resolved_at = l.processed_at
                    AND l.processed_at > c.latest_failure
                ) IS TRUE AS confirmed,

                c.latest_failure,
                l.processed_at,
                l.evidence_kind

            FROM coverage c
            LEFT JOIN latest l ON TRUE

        )

        SELECT pg_catalog.jsonb_build_object(
            'confirmed', p.confirmed,
            'last_failure_at', p.latest_failure,

            'recovered_at',
                CASE WHEN p.confirmed
                     THEN p.processed_at END,

            'evidence_kind',
                CASE WHEN p.confirmed
                     THEN p.evidence_kind END,

            'events',
                COALESCE(
                    (
                        SELECT pg_catalog.jsonb_agg(
                            pg_catalog.jsonb_build_object(
                                'kind', e.kind,
                                'at', e.event_at,
                                'code', e.code
                            )
                            ORDER BY
                                e.event_at DESC,
                                e.kind,
                                e.code
                        )
                        FROM limited_events e
                    ),
                    '[]'::jsonb
                )
        ) AS payload

        FROM proof p

    ) evidence
      ON r.source_family = 'operational'

    ORDER BY
        r.last_seen_at DESC,
        r.incident_id;

END;
$function$;

ALTER FUNCTION public.list_zion_admin_diagnostics_recovery_by_system(
    integer, integer, uuid, text
)
OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_zion_admin_diagnostics_recovery_by_system(
    integer, integer, uuid, text
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.list_zion_admin_diagnostics_recovery_by_system(
    integer, integer, uuid, text
)
TO service_role;

COMMIT;
