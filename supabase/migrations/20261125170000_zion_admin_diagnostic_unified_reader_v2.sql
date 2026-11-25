-- ZION-ADM B2: unified reader v2, adds browser reports; prior RPC unchanged.
-- Os writers sao a autoridade dos textos e caminhos sanitizados persistidos.
-- Nunca retorna JSON livre, mensagens originais, stack bruto ou payloads.
BEGIN;
CREATE FUNCTION public.list_zion_admin_diagnostics_unified_v2_by_system(
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
    browser_column integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 5000
       OR (p_source IS NOT NULL AND p_source NOT IN ('ai_runs','operational','backend_api','client_browser')) THEN
        RAISE EXCEPTION 'ZION_DIAGNOSTIC_INVALID_FILTER' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    WITH pagina AS MATERIALIZED (
        SELECT i.* FROM public.zion_admin_diagnostic_incidents i
        WHERE (p_store_id IS NULL OR i.store_id = p_store_id)
          AND (p_source IS NULL OR (CASE i.category WHEN 'ai_run_error' THEN 'ai_runs' WHEN 'operational_queue_failure' THEN 'operational' WHEN 'backend_api_failure' THEN 'backend_api' WHEN 'client_browser_failure' THEN 'client_browser' END) = p_source)
          AND EXISTS (SELECT 1 FROM public.zion_admin_diagnostic_occurrences x WHERE x.incident_id = i.id AND (
    (i.category = 'ai_run_error' AND i.scope = 'store'
      AND x.source_system = 'ai_runs')
 OR (i.category = 'operational_queue_failure' AND i.scope = 'store' AND (
       (i.component = 'whatsapp_inbox' AND x.source_system = 'channel_whatsapp_inbox' AND x.error_code IN ('WHATSAPP_SALES_AI_FAILED_FINAL','WHATSAPP_STATUS_FAILED_FINAL'))
    OR (i.component = 'sales_ai_queue' AND x.source_system = 'ai_run_queue' AND x.error_code = 'AI_RUN_QUEUE_FAILED_FINAL')
    OR (i.component = 'sales_action_queue' AND x.source_system = 'ai_sales_action_queue' AND x.error_code = 'SALES_ACTION_PROCESSING_FAILED')
 ))
 OR (i.category = 'backend_api_failure' AND i.component = 'backend'
      AND x.source_system = 'backend_api' AND x.error_code IN ('BACKEND_UNHANDLED_EXCEPTION','BACKEND_HTTP_5XX'))
 OR (i.category = 'client_browser_failure' AND i.component = 'browser' AND i.scope IN ('system','store')
      AND x.source_system = 'client_browser' AND x.error_code IN ('BROWSER_UNCAUGHT_ERROR','BROWSER_UNHANDLED_REJECTION'))
))
        ORDER BY i.last_seen_at DESC, i.id DESC
        LIMIT p_limit OFFSET p_offset
    )
    SELECT i.id, o.id, i.organization_id, i.store_id, i.status, i.severity, i.cause_confidence,
        i.title_simple, i.explanation_simple, i.impact_simple, i.next_action_simple,
        i.first_seen_at, i.last_seen_at, o.occurred_at, o.captured_at,
        CASE WHEN o.source_system = 'ai_runs' AND o.error_code IS DISTINCT FROM 'AI_RUN_ERROR_RECORDED'
             THEN 'DIAGNOSTIC_CODE_UNAVAILABLE' ELSE o.error_code END,
        CASE WHEN o.source_record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN o.source_record_id END,
        totals.n, i.last_seen_at < now() - interval '30 days',
        CASE
            WHEN o.source_system = 'ai_runs' AND i.component IN (
                'sales_ai', 'assistant_ai', 'ai_origin_unknown'
            ) THEN i.component
            ELSE CASE WHEN o.source_system = 'ai_runs' THEN 'unknown' ELSE NULL::text END
        END,
        CASE
            WHEN o.source_system = 'ai_runs' AND i.component = 'assistant_ai'
             AND o.sanitized_evidence ->> 'origin' = 'assistant_ai'
             AND o.sanitized_evidence ->> 'execution_type' = 'assistant_chat'
            THEN 'assistant_ai'
            ELSE CASE WHEN o.source_system = 'ai_runs' THEN 'unknown' ELSE NULL::text END
        END,
        CASE
            WHEN o.source_system = 'ai_runs' AND o.sanitized_evidence ->> 'execution_type' = 'assistant_chat'
             AND i.component = 'assistant_ai'
             AND o.sanitized_evidence ->> 'origin' = 'assistant_ai'
            THEN 'assistant_chat'
            ELSE NULL::text
        END,
        CASE
            WHEN o.source_system = 'ai_runs' AND o.sanitized_evidence ->> 'provider' = 'openai'
            THEN 'openai'
            ELSE NULL::text
        END,
        CASE
            WHEN o.source_system = 'ai_runs' AND o.sanitized_evidence ->> 'provider' = 'openai'
             AND o.sanitized_evidence ->> 'model' IN ('gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.1', 'gpt-5.2', 'gpt-5.3', 'gpt-5.4', 'gpt-5.5', 'gpt-5.6', 'gpt-6')
            THEN o.sanitized_evidence ->> 'model'
            ELSE NULL::text
        END,
        CASE
            WHEN o.source_system = 'ai_runs' AND o.sanitized_evidence ->> 'status' IN ('queued', 'running', 'completed', 'failed', 'error', 'success', 'cancelled')
            THEN o.sanitized_evidence ->> 'status'
            ELSE NULL::text
        END,
        CASE
            WHEN o.source_system = 'ai_runs' AND jsonb_typeof(
                o.sanitized_evidence -> 'latency_ms'
            ) = 'number'
             AND (o.sanitized_evidence ->> 'latency_ms')
                 ~ '^[0-9]{1,8}$'
            THEN CASE
                WHEN (o.sanitized_evidence ->> 'latency_ms')::bigint
                    <= 86400000
                THEN (o.sanitized_evidence ->> 'latency_ms')::bigint
                ELSE NULL::bigint
            END
            ELSE NULL::bigint
        END,
        i.scope,
        o.source_system,
        CASE i.category WHEN 'ai_run_error' THEN 'ai_runs' WHEN 'operational_queue_failure' THEN 'operational' WHEN 'backend_api_failure' THEN 'backend_api' WHEN 'client_browser_failure' THEN 'client_browser' END,
        CASE WHEN o.source_system = 'ai_runs' THEN CASE WHEN i.component IN ('sales_ai','assistant_ai','ai_origin_unknown') THEN i.component ELSE 'unknown' END ELSE i.component END,
        i.category,
        CASE WHEN o.source_system = 'backend_api' AND (o.sanitized_evidence ->> 'route') LIKE '/api/%' AND length((o.sanitized_evidence ->> 'route')) <= 200 AND translate((o.sanitized_evidence ->> 'route'), 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-/[].()', '') = '' AND position('..' in (o.sanitized_evidence ->> 'route')) = 0 THEN o.sanitized_evidence ->> 'route' END,
        CASE WHEN o.source_system = 'backend_api' AND o.sanitized_evidence ->> 'method' IN ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS') THEN o.sanitized_evidence ->> 'method' END,
        CASE WHEN o.source_system = 'backend_api' AND o.sanitized_evidence ->> 'kind' IN ('unhandled_exception','http_response') THEN o.sanitized_evidence ->> 'kind' END,
        CASE WHEN o.source_system = 'backend_api' AND o.error_code = 'BACKEND_HTTP_5XX' THEN (CASE WHEN jsonb_typeof(o.sanitized_evidence -> 'http_status') = 'number' AND (o.sanitized_evidence -> 'http_status')::text ~ '^[0-9]{1,10}$' THEN CASE WHEN (o.sanitized_evidence -> 'http_status')::text::bigint BETWEEN 500 AND 599 THEN (o.sanitized_evidence -> 'http_status')::text::bigint END END)::integer END,
        CASE WHEN o.source_system = 'backend_api' AND o.sanitized_evidence ->> 'error_name' IN ('Error','TypeError','ReferenceError','RangeError','SyntaxError','URIError','EvalError','AggregateError','AbortError','TimeoutError') THEN o.sanitized_evidence ->> 'error_name' END,
        CASE WHEN o.source_system = 'backend_api' AND o.sanitized_evidence ->> 'reported_error_code' IN ('ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','EPIPE','ERR_NETWORK','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET','08006','22023','23502','23503','23505','23514','40001','40P01','42501','42703','42883','42P01','55P03','57014','PGRST202','PGRST204','PGRST301') THEN o.sanitized_evidence ->> 'reported_error_code' END,
        CASE WHEN o.source_system = 'backend_api' AND ((o.sanitized_evidence -> 'frames' -> 0) ->> 'sourceFile') LIKE 'src/%' AND length(((o.sanitized_evidence -> 'frames' -> 0) ->> 'sourceFile')) <= 300 AND translate(((o.sanitized_evidence -> 'frames' -> 0) ->> 'sourceFile'), 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-/[].()', '') = '' AND position('..' in ((o.sanitized_evidence -> 'frames' -> 0) ->> 'sourceFile')) = 0 THEN (o.sanitized_evidence -> 'frames' -> 0) ->> 'sourceFile' END,
        CASE WHEN o.source_system = 'backend_api' AND ((o.sanitized_evidence -> 'frames' -> 0) ->> 'sourceFile') LIKE 'src/%' AND length(((o.sanitized_evidence -> 'frames' -> 0) ->> 'sourceFile')) <= 300 AND translate(((o.sanitized_evidence -> 'frames' -> 0) ->> 'sourceFile'), 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-/[].()', '') = '' AND position('..' in ((o.sanitized_evidence -> 'frames' -> 0) ->> 'sourceFile')) = 0 THEN (CASE WHEN jsonb_typeof((o.sanitized_evidence -> 'frames' -> 0) -> 'line') = 'number' AND ((o.sanitized_evidence -> 'frames' -> 0) -> 'line')::text ~ '^[0-9]{1,10}$' THEN CASE WHEN ((o.sanitized_evidence -> 'frames' -> 0) -> 'line')::text::bigint BETWEEN 1 AND 1000000 THEN ((o.sanitized_evidence -> 'frames' -> 0) -> 'line')::text::bigint END END)::integer END,
        CASE WHEN o.source_system = 'backend_api' AND ((o.sanitized_evidence -> 'frames' -> 0) ->> 'sourceFile') LIKE 'src/%' AND length(((o.sanitized_evidence -> 'frames' -> 0) ->> 'sourceFile')) <= 300 AND translate(((o.sanitized_evidence -> 'frames' -> 0) ->> 'sourceFile'), 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-/[].()', '') = '' AND position('..' in ((o.sanitized_evidence -> 'frames' -> 0) ->> 'sourceFile')) = 0 THEN (CASE WHEN jsonb_typeof((o.sanitized_evidence -> 'frames' -> 0) -> 'column') = 'number' AND ((o.sanitized_evidence -> 'frames' -> 0) -> 'column')::text ~ '^[0-9]{1,10}$' THEN CASE WHEN ((o.sanitized_evidence -> 'frames' -> 0) -> 'column')::text::bigint BETWEEN 1 AND 1000000 THEN ((o.sanitized_evidence -> 'frames' -> 0) -> 'column')::text::bigint END END)::integer END,
        CASE WHEN o.source_system IN ('channel_whatsapp_inbox','ai_run_queue','ai_sales_action_queue') THEN CASE WHEN jsonb_typeof(o.sanitized_evidence -> 'attempt_count') = 'number' AND (o.sanitized_evidence -> 'attempt_count')::text ~ '^[0-9]{1,10}$' THEN CASE WHEN (o.sanitized_evidence -> 'attempt_count')::text::bigint BETWEEN 0 AND 2147483647 THEN (o.sanitized_evidence -> 'attempt_count')::text::bigint END END END,
        i.resolved_at,
        CASE WHEN o.source_system = 'client_browser' AND o.sanitized_evidence -> 'client_reported' = 'true'::jsonb AND o.sanitized_evidence -> 'schema_version' = '1'::jsonb AND o.sanitized_evidence -> 'raw_error_stored' = 'false'::jsonb AND ((i.scope = 'system' AND o.sanitized_evidence ->> 'page' IN ('/zion-admin','/zion-admin/login')) OR (i.scope = 'store' AND o.sanitized_evidence ->> 'page' IN ('/assistant','/configuracoes','/configuracoes/catalogo/[categoria]','/configuracoes/piscinas','/crm','/crm/lead/[id]','/crm/opportunity/[id]','/dashboard','/help','/inbox','/schedule'))) THEN o.sanitized_evidence ->> 'page' END,
        CASE WHEN o.source_system = 'client_browser' AND o.sanitized_evidence -> 'client_reported' = 'true'::jsonb AND o.sanitized_evidence -> 'schema_version' = '1'::jsonb AND o.sanitized_evidence -> 'raw_error_stored' = 'false'::jsonb AND ((o.error_code = 'BROWSER_UNCAUGHT_ERROR' AND o.sanitized_evidence ->> 'kind' = 'uncaught_error') OR (o.error_code = 'BROWSER_UNHANDLED_REJECTION' AND o.sanitized_evidence ->> 'kind' = 'unhandled_rejection')) THEN o.sanitized_evidence ->> 'kind' END,
        CASE WHEN o.source_system = 'client_browser' AND o.sanitized_evidence -> 'client_reported' = 'true'::jsonb AND o.sanitized_evidence -> 'schema_version' = '1'::jsonb AND o.sanitized_evidence -> 'raw_error_stored' = 'false'::jsonb AND o.sanitized_evidence ->> 'error_name' IN ('Error','TypeError','ReferenceError','RangeError','SyntaxError','URIError','EvalError','AggregateError') THEN o.sanitized_evidence ->> 'error_name' END,
        CASE WHEN o.source_system = 'client_browser' AND o.sanitized_evidence -> 'client_reported' = 'true'::jsonb AND o.sanitized_evidence -> 'schema_version' = '1'::jsonb AND o.sanitized_evidence -> 'raw_error_stored' = 'false'::jsonb AND jsonb_typeof(o.sanitized_evidence -> 'asset') = 'string' AND (o.sanitized_evidence ->> 'asset') ~ '^/_next/static/chunks/([0-9]{1,8}-)?[a-f0-9]{8,64}\.js$' THEN o.sanitized_evidence ->> 'asset' END,
        CASE WHEN o.source_system = 'client_browser' AND o.sanitized_evidence -> 'client_reported' = 'true'::jsonb AND o.sanitized_evidence -> 'schema_version' = '1'::jsonb AND o.sanitized_evidence -> 'raw_error_stored' = 'false'::jsonb AND jsonb_typeof(o.sanitized_evidence -> 'asset') = 'string' AND (o.sanitized_evidence ->> 'asset') ~ '^/_next/static/chunks/([0-9]{1,8}-)?[a-f0-9]{8,64}\.js$' THEN CASE WHEN jsonb_typeof(o.sanitized_evidence -> 'line') = 'number' AND (o.sanitized_evidence ->> 'line') ~ '^[0-9]{1,7}$' THEN CASE WHEN (o.sanitized_evidence ->> 'line')::integer BETWEEN 1 AND 1000000 THEN (o.sanitized_evidence ->> 'line')::integer END END END,
        CASE WHEN o.source_system = 'client_browser' AND o.sanitized_evidence -> 'client_reported' = 'true'::jsonb AND o.sanitized_evidence -> 'schema_version' = '1'::jsonb AND o.sanitized_evidence -> 'raw_error_stored' = 'false'::jsonb AND jsonb_typeof(o.sanitized_evidence -> 'asset') = 'string' AND (o.sanitized_evidence ->> 'asset') ~ '^/_next/static/chunks/([0-9]{1,8}-)?[a-f0-9]{8,64}\.js$' THEN CASE WHEN jsonb_typeof(o.sanitized_evidence -> 'column') = 'number' AND (o.sanitized_evidence ->> 'column') ~ '^[0-9]{1,7}$' THEN CASE WHEN (o.sanitized_evidence ->> 'column')::integer BETWEEN 1 AND 1000000 THEN (o.sanitized_evidence ->> 'column')::integer END END END
    FROM pagina i
    JOIN LATERAL (
        SELECT x.* FROM public.zion_admin_diagnostic_occurrences x
        WHERE x.incident_id = i.id AND (
    (i.category = 'ai_run_error' AND i.scope = 'store'
      AND x.source_system = 'ai_runs')
 OR (i.category = 'operational_queue_failure' AND i.scope = 'store' AND (
       (i.component = 'whatsapp_inbox' AND x.source_system = 'channel_whatsapp_inbox' AND x.error_code IN ('WHATSAPP_SALES_AI_FAILED_FINAL','WHATSAPP_STATUS_FAILED_FINAL'))
    OR (i.component = 'sales_ai_queue' AND x.source_system = 'ai_run_queue' AND x.error_code = 'AI_RUN_QUEUE_FAILED_FINAL')
    OR (i.component = 'sales_action_queue' AND x.source_system = 'ai_sales_action_queue' AND x.error_code = 'SALES_ACTION_PROCESSING_FAILED')
 ))
 OR (i.category = 'backend_api_failure' AND i.component = 'backend'
      AND x.source_system = 'backend_api' AND x.error_code IN ('BACKEND_UNHANDLED_EXCEPTION','BACKEND_HTTP_5XX'))
 OR (i.category = 'client_browser_failure' AND i.component = 'browser' AND i.scope IN ('system','store')
      AND x.source_system = 'client_browser' AND x.error_code IN ('BROWSER_UNCAUGHT_ERROR','BROWSER_UNHANDLED_REJECTION'))
)
        ORDER BY x.occurred_at DESC, x.id DESC LIMIT 1
    ) o ON true
    CROSS JOIN LATERAL (
        SELECT count(*) AS n FROM public.zion_admin_diagnostic_occurrences x
        WHERE x.incident_id = i.id AND (
    (i.category = 'ai_run_error' AND i.scope = 'store'
      AND x.source_system = 'ai_runs')
 OR (i.category = 'operational_queue_failure' AND i.scope = 'store' AND (
       (i.component = 'whatsapp_inbox' AND x.source_system = 'channel_whatsapp_inbox' AND x.error_code IN ('WHATSAPP_SALES_AI_FAILED_FINAL','WHATSAPP_STATUS_FAILED_FINAL'))
    OR (i.component = 'sales_ai_queue' AND x.source_system = 'ai_run_queue' AND x.error_code = 'AI_RUN_QUEUE_FAILED_FINAL')
    OR (i.component = 'sales_action_queue' AND x.source_system = 'ai_sales_action_queue' AND x.error_code = 'SALES_ACTION_PROCESSING_FAILED')
 ))
 OR (i.category = 'backend_api_failure' AND i.component = 'backend'
      AND x.source_system = 'backend_api' AND x.error_code IN ('BACKEND_UNHANDLED_EXCEPTION','BACKEND_HTTP_5XX'))
 OR (i.category = 'client_browser_failure' AND i.component = 'browser' AND i.scope IN ('system','store')
      AND x.source_system = 'client_browser' AND x.error_code IN ('BROWSER_UNCAUGHT_ERROR','BROWSER_UNHANDLED_REJECTION'))
)
    ) totals
    ORDER BY i.last_seen_at DESC, i.id DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_zion_admin_diagnostics_unified_v2_by_system(integer,integer,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_zion_admin_diagnostics_unified_v2_by_system(integer,integer,uuid,text) TO service_role;
COMMIT;
