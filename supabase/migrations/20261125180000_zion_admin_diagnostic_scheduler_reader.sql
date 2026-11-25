-- ZION-ADM: read-only scheduler history, no new cron or writer.
BEGIN;
CREATE FUNCTION public.list_zion_admin_scheduler_failures_by_system(p_limit integer DEFAULT 30)
RETURNS TABLE (
    job_id bigint, run_id bigint, component text, job_active boolean,
    failed_started_at timestamptz, failed_ended_at timestamptz,
    technical_error_code text, reported_reason text,
    subsequent_success_started_at timestamptz, subsequent_success_ended_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'ZION_DIAGNOSTIC_INVALID_FILTER' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    WITH catalog(jobname, component) AS (VALUES
        ('zion_sla_alerts_5min','sla_alerts'),
        ('sla-process-violations-every-minute','sla_violations'),
        ('sla-process-risk-alerts-every-minute','sla_risk'),
        ('sla-daily-snapshot','sla_snapshot'),
        ('process_whatsapp_inbox_org_b02252ce','whatsapp_inbox'),
        ('zion_ai_processor_b02252ce','ai_processor'),
        ('process_store_campaign_queue_every_minute','campaign_queue'),
        ('zion-ai-sales-worker','sales_ai_worker'),
        ('process_ai_window_resumes_every_minute','ai_window_resumes'),
        ('zion_whatsapp_process_all_every_minute','whatsapp_process_all'),
        ('zion_assistant_panel_whatsapp_sync_every_minute','assistant_panel_sync'),
        ('zion_assistant_reports_every_minute','assistant_reports'),
        ('zion_pgcron_history_retention_7d','scheduler_history_retention'),
        ('zion_admin_openai_cost_daily','cost_daily'),
        ('zion_admin_monthly_preclosure','monthly_preclosure'),
        ('zion_admin_openai_cost_retry_0925_0950','cost_retry_morning_1'),
        ('zion_admin_openai_cost_retry_1010_1040','cost_retry_morning_2'),
        ('zion_admin_diagnostic_ai_runs_every_5_minutes','diagnostic_ai_runs'),
        ('zion-admin-diagnostic-operational','diagnostic_operational')
    ), failures AS MATERIALIZED (
        SELECT j.jobid, r.runid, c.component, j.active,
               r.start_time, r.end_time, r.return_message
        FROM cron.job j
        JOIN catalog c ON c.jobname = j.jobname
        JOIN cron.job_run_details r ON r.jobid = j.jobid
        WHERE r.status = 'failed' AND r.start_time >= now() - interval '7 days'
        ORDER BY r.start_time DESC, r.runid DESC
        LIMIT p_limit
    )
    SELECT f.jobid::bigint, f.runid::bigint, f.component, f.active,
           f.start_time, f.end_time, 'CRON_EXECUTION_FAILED'::text,
           CASE lower(btrim(f.return_message))
               WHEN 'job canceled' THEN 'scheduler_reported_cancellation'
               WHEN 'job cancelled' THEN 'scheduler_reported_cancellation'
               WHEN 'connection failed' THEN 'scheduler_reported_connection_failure'
               WHEN 'server restarted' THEN 'scheduler_reported_restart'
               ELSE 'unknown'
           END,
           s.start_time, s.end_time
    FROM failures f
    LEFT JOIN LATERAL (
        SELECT r.start_time, r.end_time
        FROM cron.job_run_details r
        WHERE r.jobid = f.jobid AND r.status = 'succeeded'
          AND r.start_time >= f.end_time AND r.start_time > f.start_time
          AND r.end_time >= r.start_time
        ORDER BY r.start_time, r.runid
        LIMIT 1
    ) s ON true
    ORDER BY f.start_time DESC, f.runid DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_zion_admin_scheduler_failures_by_system(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_zion_admin_scheduler_failures_by_system(integer) TO service_role;
COMMIT;
