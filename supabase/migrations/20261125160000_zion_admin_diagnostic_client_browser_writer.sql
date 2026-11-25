-- ZION-ADM B2: client browser reports, untrusted observations, no raw error.
BEGIN;
CREATE TABLE public.zion_admin_client_browser_quota (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    window_start timestamptz NOT NULL,
    accepted_count integer NOT NULL CHECK (accepted_count BETWEEN 1 AND 5)
);
ALTER TABLE public.zion_admin_client_browser_quota ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zion_admin_client_browser_quota FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.register_zion_admin_client_browser_failure_by_system(
 p_user_id uuid, p_scope text, p_organization_id uuid, p_store_id uuid, p_report jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
 v_page text; v_kind text; v_name text; v_asset text; v_line integer; v_column integer;
 v_now timestamptz; v_window timestamptz; v_quota integer;
 v_incident_key text; v_incident_id uuid; v_occurrence_id uuid; v_event_id uuid;
 v_new_incident boolean; v_code text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'ZION_DIAGNOSTIC_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p_user_id) THEN
   RAISE EXCEPTION 'ZION_BROWSER_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 IF p_report IS NULL OR pg_catalog.jsonb_typeof(p_report) IS DISTINCT FROM 'object' OR pg_catalog.octet_length(p_report::text)>1024 THEN
   RAISE EXCEPTION 'ZION_BROWSER_REPORT_INVALID' USING ERRCODE='22023';
 END IF;
 IF NOT (p_report ?& ARRAY['kind','page','errorName','asset','line','column']) OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_report))<>6 THEN
   RAISE EXCEPTION 'ZION_BROWSER_REPORT_INVALID' USING ERRCODE='22023';
 END IF;
 v_page := p_report->>'page'; v_kind := p_report->>'kind'; v_name := p_report->>'errorName'; v_asset := p_report->>'asset';
 IF pg_catalog.jsonb_typeof(p_report->'page') IS DISTINCT FROM 'string' OR pg_catalog.jsonb_typeof(p_report->'kind') IS DISTINCT FROM 'string'
 OR v_kind NOT IN ('uncaught_error','unhandled_rejection')
 OR v_page NOT IN ('/assistant','/configuracoes','/configuracoes/catalogo/[categoria]','/configuracoes/piscinas','/crm','/crm/lead/[id]','/crm/opportunity/[id]','/dashboard','/help','/inbox','/schedule','/zion-admin','/zion-admin/login')
 OR (v_name IS NOT NULL AND (pg_catalog.jsonb_typeof(p_report->'errorName') <> 'string' OR v_name NOT IN ('Error','TypeError','ReferenceError','RangeError','SyntaxError','URIError','EvalError','AggregateError')))
 OR (v_asset IS NOT NULL AND (pg_catalog.jsonb_typeof(p_report->'asset') <> 'string' OR v_asset !~ '^/_next/static/chunks/([0-9]{1,8}-)?[a-f0-9]{8,64}\.js$')) THEN
   RAISE EXCEPTION 'ZION_BROWSER_REPORT_INVALID' USING ERRCODE='22023';
 END IF;
 IF p_report->>'line' IS NOT NULL THEN
   IF pg_catalog.jsonb_typeof(p_report->'line') <> 'number' OR (p_report->>'line') !~ '^[0-9]{1,7}$' THEN RAISE EXCEPTION 'ZION_BROWSER_POSITION_INVALID' USING ERRCODE='22023'; END IF;
   v_line := (p_report->>'line')::integer;
   IF v_line NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'ZION_BROWSER_POSITION_INVALID' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_report->>'column' IS NOT NULL THEN
   IF pg_catalog.jsonb_typeof(p_report->'column') <> 'number' OR (p_report->>'column') !~ '^[0-9]{1,7}$' THEN RAISE EXCEPTION 'ZION_BROWSER_POSITION_INVALID' USING ERRCODE='22023'; END IF;
   v_column := (p_report->>'column')::integer;
   IF v_column NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'ZION_BROWSER_POSITION_INVALID' USING ERRCODE='22023'; END IF;
 END IF;
 IF v_asset IS NULL AND (v_line IS NOT NULL OR v_column IS NOT NULL) THEN RAISE EXCEPTION 'ZION_BROWSER_POSITION_INVALID' USING ERRCODE='22023'; END IF;
 IF v_page IN ('/zion-admin','/zion-admin/login') THEN
   IF p_scope IS DISTINCT FROM 'system' OR p_organization_id IS NOT NULL OR p_store_id IS NOT NULL OR NOT EXISTS (
     SELECT 1 FROM public.zion_internal_admins a WHERE a.user_id=p_user_id AND a.is_active IS TRUE AND a.role IN ('owner','admin','super_admin')
   ) THEN RAISE EXCEPTION 'ZION_BROWSER_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 ELSE
   IF p_scope IS DISTINCT FROM 'store' OR p_organization_id IS NULL OR p_store_id IS NULL OR NOT EXISTS (
     SELECT 1 FROM public.stores s WHERE s.id=p_store_id AND s.organization_id=p_organization_id
   ) OR NOT EXISTS (
     SELECT 1 FROM public.memberships m WHERE m.user_id=p_user_id AND m.organization_id=p_organization_id AND m.is_active IS TRUE
   ) THEN RAISE EXCEPTION 'ZION_BROWSER_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 END IF;
 v_now := pg_catalog.statement_timestamp(); v_window := pg_catalog.date_trunc('minute',v_now);
 -- Single row per user; conflicting concurrent writes are serialized by PostgreSQL.
 INSERT INTO public.zion_admin_client_browser_quota AS q(user_id,window_start,accepted_count)
 VALUES(p_user_id,v_window,1)
 ON CONFLICT(user_id) DO UPDATE SET
   window_start=GREATEST(q.window_start,EXCLUDED.window_start),
   accepted_count=CASE WHEN q.window_start<EXCLUDED.window_start THEN 1 ELSE q.accepted_count+1 END
 WHERE q.window_start<EXCLUDED.window_start OR (q.window_start=EXCLUDED.window_start AND q.accepted_count<5)
 RETURNING accepted_count INTO v_quota;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status','rate_limited'); END IF;
 v_code := CASE v_kind WHEN 'uncaught_error' THEN 'BROWSER_UNCAUGHT_ERROR' ELSE 'BROWSER_UNHANDLED_REJECTION' END;
 v_incident_key := 'zion-b2:browser:v1:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(p_scope,p_organization_id,p_store_id,v_page,v_kind,v_name,v_asset,v_line,v_column)::text,'UTF8')),'hex');
 INSERT INTO public.zion_admin_diagnostic_incidents(incident_key,scope,organization_id,store_id,component,category,severity,status,cause_confidence,title_simple,explanation_simple,impact_simple,next_action_simple,first_seen_at,last_seen_at)
 VALUES(v_incident_key,p_scope,p_organization_id,p_store_id,'browser','client_browser_failure','error','open','unknown',
 CASE v_kind WHEN 'uncaught_error' THEN 'Erro JavaScript relatado pelo navegador' ELSE 'Rejeicao de promessa relatada pelo navegador' END,
 'O navegador de uma sessao autenticada relatou uma falha nao tratada. A causa e a origem do codigo nao foram verificadas.',
 'O impacto real e a recuperacao nao foram confirmados.', 'Verificar a pagina e a localizacao compilada quando disponiveis.',v_now,v_now)
 ON CONFLICT(incident_key) DO NOTHING RETURNING id INTO v_incident_id;
 v_new_incident := FOUND;
 IF NOT v_new_incident THEN
   SELECT i.id INTO STRICT v_incident_id FROM public.zion_admin_diagnostic_incidents i
   WHERE i.incident_key=v_incident_key AND i.scope=p_scope AND i.organization_id IS NOT DISTINCT FROM p_organization_id AND i.store_id IS NOT DISTINCT FROM p_store_id AND i.component='browser' AND i.category='client_browser_failure' FOR UPDATE;
 END IF;
 v_event_id := pg_catalog.gen_random_uuid();
 INSERT INTO public.zion_admin_diagnostic_occurrences(incident_id,occurrence_key,source_system,source_record_id,error_code,sanitized_evidence,occurred_at)
 VALUES(v_incident_id,'zion-b2:browser-event:'||v_event_id::text,'client_browser',v_event_id::text,v_code,
 pg_catalog.jsonb_build_object('schema_version',1,'page',v_page,'kind',v_kind,'error_name',v_name,'asset',v_asset,'line',v_line,'column',v_column,'raw_error_stored',false,'client_reported',true),v_now)
 RETURNING id INTO v_occurrence_id;
 UPDATE public.zion_admin_diagnostic_incidents i SET first_seen_at=LEAST(i.first_seen_at,v_now),last_seen_at=GREATEST(i.last_seen_at,v_now),updated_at=pg_catalog.now() WHERE i.id=v_incident_id;
 IF v_new_incident THEN
   INSERT INTO public.zion_admin_diagnostic_history(incident_id,event_kind,actor_kind,new_status,description_simple)
   VALUES(v_incident_id,'created','system','open','Incidente criado a partir de relato do navegador; causa nao verificada.');
 END IF;
 RETURN pg_catalog.jsonb_build_object('status','registered','incident_id',v_incident_id,'occurrence_id',v_occurrence_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.register_zion_admin_client_browser_failure_by_system(uuid,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.register_zion_admin_client_browser_failure_by_system(uuid,text,uuid,uuid,jsonb) TO service_role;
COMMIT;
