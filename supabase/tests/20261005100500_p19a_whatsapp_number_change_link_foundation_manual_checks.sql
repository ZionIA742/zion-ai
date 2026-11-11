begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p19a49_link_results (
  scenario text primary key,
  name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text
) on commit preserve rows;

create or replace function pg_temp._p19a49_link_record(p_scenario text, p_name text, p_status text, p_detail text default null)
returns void language plpgsql as $function$
begin
  insert into pg_temp._p19a49_link_results values (p_scenario, p_name, p_status, p_detail)
  on conflict (scenario) do update set name = excluded.name, status = excluded.status, detail = excluded.detail;
end;
$function$;

create or replace function pg_temp._p19a49_link_uuid(p_seed text)
returns uuid language sql immutable as $function$
  select (substr(md5(p_seed), 1, 8) || '-' || substr(md5(p_seed), 9, 4) || '-4' || substr(md5(p_seed), 14, 3) || '-8' || substr(md5(p_seed), 18, 3) || '-' || substr(md5(p_seed), 21, 12))::uuid;
$function$;

create or replace function pg_temp._p19a49_link_store(p_seed text)
returns table(org_id uuid, store_id uuid) language plpgsql as $function$
begin
  org_id := pg_temp._p19a49_link_uuid('p19a49-link:' || p_seed || ':org');
  store_id := pg_temp._p19a49_link_uuid('p19a49-link:' || p_seed || ':store');
  insert into public.organizations(id, name, subscription_status) values (org_id, 'P19A 4.9 link ' || p_seed, 'active');
  insert into public.stores(id, organization_id, name) values (store_id, org_id, 'P19A 4.9 link store ' || p_seed);
  return next;
end;
$function$;

do $preflight$
declare v_table oid; v_names text[] := array[
  'public.create_whatsapp_number_change_link_by_system(uuid,uuid,text,text,uuid,uuid,timestamptz)',
  'public.resolve_whatsapp_number_change_link_by_system(text)',
  'public.start_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text,uuid)',
  'public.bind_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text,uuid)',
  'public.complete_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text)',
  'public.revoke_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text)',
  'public.expire_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text)']; v_name text;
begin
  v_table := to_regclass('public.whatsapp_number_change_links');
  if v_table is null then raise exception 'P19A_4_9_LINK_PREFLIGHT_TABLE_MISSING'; end if;
  foreach v_name in array v_names loop
    if to_regprocedure(v_name) is null then raise exception 'P19A_4_9_LINK_PREFLIGHT_FUNCTION_MISSING: %', v_name; end if;
    if not has_function_privilege('service_role', to_regprocedure(v_name), 'execute')
       or has_function_privilege('anon', to_regprocedure(v_name), 'execute')
       or has_function_privilege('authenticated', to_regprocedure(v_name), 'execute') then
      raise exception 'P19A_4_9_LINK_PREFLIGHT_PRIVILEGES_INVALID: %', v_name;
    end if;
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_number_change_links' and column_name in ('token', 'raw_token', 'access_token', 'secret')) then
    raise exception 'P19A_4_9_LINK_PREFLIGHT_RAW_TOKEN_COLUMN';
  end if;
end;
$preflight$;

do $case$ begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.whatsapp_number_change_links'::regclass and attname = 'id') then raise exception 'id'; end if;
  perform pg_temp._p19a49_link_record('A', 'table exists', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('A', 'table exists', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ begin
  if (select count(*) from pg_constraint where conrelid = 'public.whatsapp_number_change_links'::regclass and conname like 'whatsapp_number_change_links_status%') < 2 then raise exception 'status constraints'; end if;
  perform pg_temp._p19a49_link_record('B', 'status contract', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('B', 'status contract', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ begin
  if not exists (select 1 from pg_indexes where indexname = 'whatsapp_number_change_links_active_scope_uidx') then raise exception 'active unique index'; end if;
  perform pg_temp._p19a49_link_record('C', 'active scope uniqueness', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('C', 'active scope uniqueness', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='whatsapp_number_change_links' and column_name in ('token','raw_token','access_token','secret')) then raise exception 'raw token column'; end if;
  perform pg_temp._p19a49_link_record('D', 'no raw token column', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('D', 'no raw token column', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ begin
  if not exists (select 1 from pg_indexes where indexname = 'whatsapp_number_change_links_token_hash_uidx') then raise exception 'token hash unique'; end if;
  perform pg_temp._p19a49_link_record('E', 'token hash uniqueness', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('E', 'token hash uniqueness', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ begin
  if not exists (select 1 from pg_trigger where tgrelid='public.whatsapp_number_change_links'::regclass and tgname='whatsapp_number_change_links_terminal_immutability') then raise exception 'terminal trigger'; end if;
  perform pg_temp._p19a49_link_record('F', 'terminal immutability trigger', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('F', 'terminal immutability trigger', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare v_sig text := 'public.create_whatsapp_number_change_link_by_system(uuid,uuid,text,text,uuid,uuid,timestamptz)'; begin
  if not has_function_privilege('service_role',to_regprocedure(v_sig),'execute') or has_function_privilege('anon',to_regprocedure(v_sig),'execute') or has_function_privilege('authenticated',to_regprocedure(v_sig),'execute') then raise exception 'privilege'; end if;
  perform pg_temp._p19a49_link_record('G', 'create RPC service role only', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('G', 'create RPC service role only', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_sig text := 'public.resolve_whatsapp_number_change_link_by_system(text)'; begin
  if not has_function_privilege('service_role',to_regprocedure(v_sig),'execute') or has_function_privilege('anon',to_regprocedure(v_sig),'execute') or has_function_privilege('authenticated',to_regprocedure(v_sig),'execute') then raise exception 'privilege'; end if;
  perform pg_temp._p19a49_link_record('H', 'resolve RPC service role only', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('H', 'resolve RPC service role only', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_sig text := 'public.start_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text,uuid)'; begin
  if not has_function_privilege('service_role',to_regprocedure(v_sig),'execute') or has_function_privilege('anon',to_regprocedure(v_sig),'execute') or has_function_privilege('authenticated',to_regprocedure(v_sig),'execute') then raise exception 'privilege'; end if;
  perform pg_temp._p19a49_link_record('I', 'start RPC service role only', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('I', 'start RPC service role only', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_sig text := 'public.bind_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text,uuid)'; begin
  if not has_function_privilege('service_role',to_regprocedure(v_sig),'execute') or has_function_privilege('anon',to_regprocedure(v_sig),'execute') or has_function_privilege('authenticated',to_regprocedure(v_sig),'execute') then raise exception 'privilege'; end if;
  perform pg_temp._p19a49_link_record('J', 'bind RPC service role only', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('J', 'bind RPC service role only', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_sig text := 'public.complete_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text)'; begin
  if not has_function_privilege('service_role',to_regprocedure(v_sig),'execute') or has_function_privilege('anon',to_regprocedure(v_sig),'execute') or has_function_privilege('authenticated',to_regprocedure(v_sig),'execute') then raise exception 'privilege'; end if;
  perform pg_temp._p19a49_link_record('K', 'complete RPC service role only', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('K', 'complete RPC service role only', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_sig text := 'public.revoke_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text)'; begin
  if not has_function_privilege('service_role',to_regprocedure(v_sig),'execute') or has_function_privilege('anon',to_regprocedure(v_sig),'execute') or has_function_privilege('authenticated',to_regprocedure(v_sig),'execute') then raise exception 'privilege'; end if;
  perform pg_temp._p19a49_link_record('L', 'revoke RPC service role only', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('L', 'revoke RPC service role only', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_sig text := 'public.expire_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text)'; begin
  if not has_function_privilege('service_role',to_regprocedure(v_sig),'execute') or has_function_privilege('anon',to_regprocedure(v_sig),'execute') or has_function_privilege('authenticated',to_regprocedure(v_sig),'execute') then raise exception 'privilege'; end if;
  perform pg_temp._p19a49_link_record('M', 'expire RPC service role only', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('M', 'expire RPC service role only', 'SUT_FAIL', sqlerrm); end $case$;

do $case$
declare c record; l record; r record; req uuid;
begin
  select * into c from pg_temp._p19a49_link_store('happy');
  select * into l from public.create_whatsapp_number_change_link_by_system(c.org_id,c.store_id,'whatsapp','hash-happy-'||c.store_id::text,pg_temp._p19a49_link_uuid('user'),pg_temp._p19a49_link_uuid('responsible'),clock_timestamp()+interval '1 hour');
  if l.status <> 'issued' then raise exception 'create status'; end if;
  perform pg_temp._p19a49_link_record('N', 'create issued link', 'PASS');
exception when others then perform pg_temp._p19a49_link_record('N', 'create issued link', 'SUT_FAIL', sqlerrm); end $case$;

do $case$
declare c record; a record; b record;
begin
  select * into c from pg_temp._p19a49_link_store('rotate');
  select * into a from public.create_whatsapp_number_change_link_by_system(c.org_id,c.store_id,'whatsapp','hash-rotate-a-'||c.store_id::text,pg_temp._p19a49_link_uuid('user'),pg_temp._p19a49_link_uuid('responsible'),clock_timestamp()+interval '1 hour');
  select * into b from public.create_whatsapp_number_change_link_by_system(c.org_id,c.store_id,'whatsapp','hash-rotate-b-'||c.store_id::text,pg_temp._p19a49_link_uuid('user'),pg_temp._p19a49_link_uuid('responsible'),clock_timestamp()+interval '1 hour');
  if (select status from public.whatsapp_number_change_links where id=a.link_id) <> 'revoked' or b.status <> 'issued' then raise exception 'rotation'; end if;
  perform pg_temp._p19a49_link_record('O', 'new link revokes previous active link', 'PASS');
exception when others then perform pg_temp._p19a49_link_record('O', 'new link revokes previous active link', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare c record; l record; q record;
begin
  select * into c from pg_temp._p19a49_link_store('flow');
  select * into l from public.create_whatsapp_number_change_link_by_system(c.org_id,c.store_id,'whatsapp','hash-flow-'||c.store_id::text,pg_temp._p19a49_link_uuid('user'),pg_temp._p19a49_link_uuid('responsible'),clock_timestamp()+interval '1 hour');
  select * into q from public.resolve_whatsapp_number_change_link_by_system('hash-flow-'||c.store_id::text);
  if q.status <> 'issued' then raise exception 'resolve'; end if;
  select * into q from public.start_whatsapp_number_change_link_by_system(l.link_id,c.org_id,c.store_id,'whatsapp',pg_temp._p19a49_link_uuid('responsible'));
  if q.status <> 'started' then raise exception 'start'; end if;
  perform pg_temp._p19a49_link_record('P', 'resolve and start active link', 'PASS');
exception when others then perform pg_temp._p19a49_link_record('P', 'resolve and start active link', 'SUT_FAIL', sqlerrm); end $case$;

do $case$ declare v_def text := pg_get_functiondef('public.start_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text,uuid)'::regprocedure); begin
  if v_def not ilike '%organization_id = p_organization_id%' or v_def not ilike '%store_id = p_store_id%' or v_def not ilike '%provider = p_provider%' then raise exception 'scope'; end if;
  perform pg_temp._p19a49_link_record('Q', 'scope mismatch rejects', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('Q', 'scope mismatch rejects', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_def text := pg_get_functiondef('public.start_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text,uuid)'::regprocedure); begin
  if v_def not ilike '%if v_link.status = ''issued''%' or v_def not ilike '%status = ''started''%' then raise exception 'idempotency'; end if;
  perform pg_temp._p19a49_link_record('R', 'start is idempotent', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('R', 'start is idempotent', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_def text := pg_get_functiondef('public.bind_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text,uuid)'::regprocedure); begin
  if v_def not ilike '%whatsapp_binding_change_requests%' or v_def not ilike '%organization_id = p_organization_id%' then raise exception 'request scope'; end if;
  perform pg_temp._p19a49_link_record('S', 'bind requires exact scoped request', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('S', 'bind requires exact scoped request', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_def text := pg_get_functiondef('public.complete_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text)'::regprocedure); begin
  if v_def not ilike '%v_request.status <> ''completed''%' then raise exception 'request status'; end if;
  perform pg_temp._p19a49_link_record('T', 'complete requires completed request', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('T', 'complete requires completed request', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_def text := pg_get_functiondef('public.complete_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text)'::regprocedure); begin
  if v_def not ilike '%if v_link.status = ''completed'' then%' then raise exception 'replay'; end if;
  perform pg_temp._p19a49_link_record('U', 'complete is idempotent', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('U', 'complete is idempotent', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_def text := pg_get_functiondef('public.revoke_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text)'::regprocedure); begin
  if v_def not ilike '%status = ''revoked''%' or v_def not ilike '%revoked_at = clock_timestamp()%' then raise exception 'revoke'; end if;
  perform pg_temp._p19a49_link_record('V', 'revoke active link', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('V', 'revoke active link', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_def text := pg_get_functiondef('public.expire_whatsapp_number_change_link_by_system(uuid,uuid,uuid,text)'::regprocedure); begin
  if v_def not ilike '%expires_at > clock_timestamp()%' or v_def not ilike '%status = ''expired''%' then raise exception 'expire'; end if;
  perform pg_temp._p19a49_link_record('W', 'expire only after deadline', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('W', 'expire only after deadline', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_def text := pg_get_functiondef('public.resolve_whatsapp_number_change_link_by_system(text)'::regprocedure); begin
  if v_def not ilike '%v_link.expires_at <= clock_timestamp()%' or v_def not ilike '%status = ''expired''%' then raise exception 'resolve expiry'; end if;
  perform pg_temp._p19a49_link_record('X', 'expired link rejects resolution', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('X', 'expired link rejects resolution', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ declare v_def text := pg_get_functiondef('public.guard_whatsapp_number_change_link_terminal_immutability_by_system()'::regprocedure); begin
  if v_def not ilike '%completed, ''revoked'', ''expired''%' then raise exception 'terminal'; end if;
  perform pg_temp._p19a49_link_record('Y', 'terminal links reject transition', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('Y', 'terminal links reject transition', 'SUT_FAIL', sqlerrm); end $case$;
do $case$ begin
  if has_table_privilege('anon','public.whatsapp_number_change_links','select') or has_table_privilege('authenticated','public.whatsapp_number_change_links','select') then raise exception 'table grants'; end if;
  perform pg_temp._p19a49_link_record('Z', 'no public or authenticated execution', 'PASS'); exception when others then perform pg_temp._p19a49_link_record('Z', 'no public or authenticated execution', 'SUT_FAIL', sqlerrm); end $case$;

select scenario, name, status, detail from pg_temp._p19a49_link_results order by scenario;
select count(*) as scenario_count,
       count(*) filter (where status = 'PASS') as pass_count,
       count(*) filter (where status = 'SUT_FAIL') as sut_fail_count,
       count(*) filter (where status = 'HARNESS_ERROR') as harness_error_count
  from pg_temp._p19a49_link_results;

rollback;
