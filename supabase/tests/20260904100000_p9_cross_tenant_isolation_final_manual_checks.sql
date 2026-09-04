begin;

set transaction isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:cross-tenant-isolation-final:v1', 0)
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.6
-- Matriz final de isolamento cross-tenant.
--
-- ROLLBACK ONLY.
-- - sem alteracao de schema/grants/policies;
-- - usa somente fixtures temporarias dentro desta transacao;
-- - valida papeis, RLS/privilegios e probes reais cross-org/cross-store;
-- - nao depende de nenhuma loja real/piloto.
-- ============================================================================

create temp table pg_temp._p9_xtenant_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_xtenant_ctx (
  singleton boolean primary key default true check (singleton),
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b_same_org uuid not null,
  store_c_other_org uuid not null,
  user_a uuid not null,
  user_b uuid not null,
  user_inactive_a uuid not null,
  customer_a uuid not null,
  customer_b uuid not null,
  opp_a uuid not null,
  opp_peer uuid not null,
  opp_other_org uuid not null
) on commit preserve rows;

insert into pg_temp._p9_xtenant_ctx (
  org_a, org_b,
  store_a, store_b_same_org, store_c_other_org,
  user_a, user_b, user_inactive_a,
  customer_a, customer_b,
  opp_a, opp_peer, opp_other_org
)
values (
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
);

create or replace function pg_temp._p9_xtenant_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_xtenant_results (
    scenario_number, scenario_name, status, detail
  )
  values (
    p_scenario_number,
    p_scenario_name,
    p_status,
    coalesce(p_detail, '<null>')
  )
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      detail = excluded.detail;
end;
$function$;

create or replace function pg_temp._p9_xtenant_expect(
  p_scenario_number integer,
  p_scenario_name text,
  p_condition boolean,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  perform pg_temp._p9_xtenant_record(
    p_scenario_number,
    p_scenario_name,
    case when coalesce(p_condition, false) then 'PASS' else 'SUT_FAIL' end,
    coalesce(
      p_detail,
      case when coalesce(p_condition, false) then 'ok' else 'condition returned false' end
    )
  );
exception when others then
  perform pg_temp._p9_xtenant_record(
    p_scenario_number,
    p_scenario_name,
    'HARNESS_ERROR',
    sqlstate || ': ' || sqlerrm
  );
end;
$function$;

create or replace function pg_temp._p9_xtenant_exec(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_json jsonb,
  returned_sqlstate text,
  message_text text,
  identity_clean boolean,
  harness_error text
)
language plpgsql
as $function$
declare
  v_ok boolean := false;
  v_value jsonb := null;
  v_state text := null;
  v_message text := null;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query select false, null::jsonb, null::text, null::text, false,
      'helper caller must be postgres'::text;
    return;
  end if;

  if p_role not in ('authenticated', 'service_role', 'anon') then
    return query select false, null::jsonb, null::text, null::text, true,
      'unsupported test role'::text;
    return;
  end if;

  if p_role = 'authenticated' and p_user_id is null then
    return query select false, null::jsonb, null::text, null::text, true,
      'authenticated execution requires user id'::text;
    return;
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    case when p_user_id is null then '' else p_user_id::text end,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.role', p_role, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    case
      when p_user_id is null
        then pg_catalog.json_build_object('role', p_role)::text
      else pg_catalog.json_build_object('sub', p_user_id::text, 'role', p_role)::text
    end,
    true
  );

  execute pg_catalog.format('set local role %I', p_role);

  begin
    execute 'select coalesce(jsonb_agg(q), ''[]''::jsonb) from (' || p_sql || ') q'
      into v_value;
    v_ok := true;
  exception when others then
    get stacked diagnostics
      v_state = returned_sqlstate,
      v_message = message_text;
    v_ok := false;
  end;

  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);

  return query select
    v_ok,
    v_value,
    v_state,
    v_message,
    current_user = 'postgres'
      and session_user = 'postgres'
      and nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '') is null
      and nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '') is null
      and nullif(pg_catalog.current_setting('request.jwt.claims', true), '') is null,
    null::text;
exception when others then
  begin
    execute 'reset role';
  exception when others then
    null;
  end;

  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);

  return query select
    false,
    null::jsonb,
    null::text,
    null::text,
    current_user = 'postgres' and session_user = 'postgres',
    sqlstate || ': ' || sqlerrm;
end;
$function$;

-- --------------------------------------------------------------------------
-- Preflight: exact signatures + authority tables.
-- --------------------------------------------------------------------------
do $preflight$
declare
  v_table text;
  v_signature text;
begin
  foreach v_table in array array[
    'organizations',
    'stores',
    'memberships',
    'customers',
    'commercial_opportunities',
    'commercial_opportunity_qualification_fact_events',
    'commercial_opportunity_qualification_facts_current',
    'commercial_opportunity_profile_versions',
    'commercial_opportunity_profile_components',
    'commercial_opportunity_profile_execution_intents',
    'commercial_opportunity_profile_current',
    'store_opportunity_gate_policy_versions',
    'store_opportunity_gate_policy_rules',
    'store_opportunity_gate_policy_current',
    'commercial_opportunity_checklist_versions',
    'commercial_opportunity_checklist_items',
    'commercial_opportunity_checklist_current',
    'commercial_opportunity_checklist_override_events',
    'commercial_opportunity_checklist_progress_versions',
    'commercial_opportunity_checklist_progress_items',
    'commercial_opportunity_checklist_progress_current'
  ] loop
    if pg_catalog.to_regclass('public.' || v_table) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('FIXTURE_FAIL: public.%s is missing', v_table);
    end if;
  end loop;

  foreach v_signature in array array[
    'public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)',
    'public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)',
    'public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid)',
    'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)',
    'public.write_commercial_opportunity_qualification_fact_by_user(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,boolean)',
    'public.write_store_opportunity_gate_policy_by_user(uuid,uuid,text,text,jsonb,text,jsonb)',
    'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)',
    'public.override_commercial_opportunity_checklist_item_by_user(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)',
    'public.materialize_commercial_opportunity_checklist_progress_by_system(uuid,uuid,uuid,text)',
    'public.p9_resolve_qualification_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_quote_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_post_sale_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)',
    'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('SUT_FAIL: required function missing: %s', v_signature);
    end if;
  end loop;
end;
$preflight$;

-- --------------------------------------------------------------------------
-- Generic rollback-only tenant fixtures.
-- --------------------------------------------------------------------------
do $fixtures$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;

  insert into public.organizations (id, name, subscription_status)
  values
    (ctx.org_a, 'P9 XTenant Runner Org A', 'active'),
    (ctx.org_b, 'P9 XTenant Runner Org B', 'active');

  insert into public.stores (id, organization_id, name)
  values
    (ctx.store_a, ctx.org_a, 'P9 XTenant Runner Store A'),
    (ctx.store_b_same_org, ctx.org_a, 'P9 XTenant Runner Store B'),
    (ctx.store_c_other_org, ctx.org_b, 'P9 XTenant Runner Store C');

  insert into auth.users (id)
  values (ctx.user_a), (ctx.user_b), (ctx.user_inactive_a);

  insert into public.memberships (organization_id, user_id, role, is_active)
  values
    (ctx.org_a, ctx.user_a, 'owner'::public.app_role, true),
    (ctx.org_b, ctx.user_b, 'owner'::public.app_role, true),
    (ctx.org_a, ctx.user_inactive_a, 'owner'::public.app_role, false);

  insert into public.customers (id, organization_id, display_name)
  values
    (ctx.customer_a, ctx.org_a, 'P9 XTenant Customer A'),
    (ctx.customer_b, ctx.org_b, 'P9 XTenant Customer B');

  insert into public.commercial_opportunities (
    id, organization_id, store_id, customer_id, stage
  )
  values
    (ctx.opp_a, ctx.org_a, ctx.store_a, ctx.customer_a, 'novo_lead'),
    (ctx.opp_peer, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_other_org, ctx.org_b, ctx.store_c_other_org, ctx.customer_b, 'novo_lead');
exception when others then
  raise exception using
    errcode = 'P0001',
    message = 'FIXTURE_FAIL: could not create rollback-only tenant fixtures',
    detail = sqlstate || ': ' || sqlerrm;
end;
$fixtures$;

-- 1. Public ACL matrix.
do $s1$
declare
  v_ok boolean;
begin
  v_ok :=
    not pg_catalog.has_function_privilege('authenticated', 'public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)', 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', 'public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', 'public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)', 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', 'public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid)', 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', 'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', 'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)', 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', 'public.write_store_opportunity_gate_policy_by_user(uuid,uuid,text,text,jsonb,text,jsonb)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.write_store_opportunity_gate_policy_by_user(uuid,uuid,text,text,jsonb,text,jsonb)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.write_store_opportunity_gate_policy_by_user(uuid,uuid,text,text,jsonb,text,jsonb)', 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', 'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', 'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)', 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', 'public.override_commercial_opportunity_checklist_item_by_user(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.override_commercial_opportunity_checklist_item_by_user(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.override_commercial_opportunity_checklist_item_by_user(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', 'public.materialize_commercial_opportunity_checklist_progress_by_system(uuid,uuid,uuid,text)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', 'public.materialize_commercial_opportunity_checklist_progress_by_system(uuid,uuid,uuid,text)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.materialize_commercial_opportunity_checklist_progress_by_system(uuid,uuid,uuid,text)', 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', 'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)', 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', 'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.read_commercial_action_readiness_scoped(uuid,uuid,uuid,text)', 'EXECUTE');

  perform pg_temp._p9_xtenant_expect(1,
    'ACL separa funcoes humanas, system-only e readers scoped', v_ok);
exception when others then
  perform pg_temp._p9_xtenant_record(1,
    'ACL separa funcoes humanas, system-only e readers scoped',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s1$;

-- 2. Internal Progress/Readiness resolvers remain private.
do $s2$
declare
  v_signature text;
  v_ok boolean := true;
begin
  foreach v_signature in array array[
    'public.p9_resolve_qualification_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_quote_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_post_sale_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_technical_visit_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)'
  ] loop
    v_ok := v_ok
      and not pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE');
  end loop;

  perform pg_temp._p9_xtenant_expect(2,
    'resolvers internos de Progress/Readiness continuam privados', v_ok);
exception when others then
  perform pg_temp._p9_xtenant_record(2,
    'resolvers internos de Progress/Readiness continuam privados',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s2$;

-- 3. RLS on tenant-facing authority tables.
do $s3$
declare
  v_table text;
  v_ok boolean := true;
  v_rls boolean;
begin
  foreach v_table in array array[
    'commercial_opportunity_qualification_fact_events',
    'commercial_opportunity_qualification_facts_current',
    'commercial_opportunity_profile_versions',
    'commercial_opportunity_profile_components',
    'commercial_opportunity_profile_execution_intents',
    'commercial_opportunity_profile_current',
    'store_opportunity_gate_policy_versions',
    'store_opportunity_gate_policy_rules',
    'store_opportunity_gate_policy_current',
    'commercial_opportunity_checklist_versions',
    'commercial_opportunity_checklist_items',
    'commercial_opportunity_checklist_current',
    'commercial_opportunity_checklist_override_events'
  ] loop
    select c.relrowsecurity into v_rls
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_table;
    v_ok := v_ok and coalesce(v_rls, false);
  end loop;

  perform pg_temp._p9_xtenant_expect(3,
    'RLS permanece habilitado nas autoridades tenant-facing', v_ok);
exception when others then
  perform pg_temp._p9_xtenant_record(3,
    'RLS permanece habilitado nas autoridades tenant-facing',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s3$;

-- 4. Direct mutation stays closed.
do $s4$
declare
  v_table text;
  v_role text;
  v_ok boolean := true;
begin
  foreach v_table in array array[
    'commercial_opportunity_qualification_fact_events',
    'commercial_opportunity_qualification_facts_current',
    'commercial_opportunity_profile_versions',
    'commercial_opportunity_profile_components',
    'commercial_opportunity_profile_execution_intents',
    'commercial_opportunity_profile_current',
    'store_opportunity_gate_policy_versions',
    'store_opportunity_gate_policy_rules',
    'store_opportunity_gate_policy_current',
    'commercial_opportunity_checklist_versions',
    'commercial_opportunity_checklist_items',
    'commercial_opportunity_checklist_current',
    'commercial_opportunity_checklist_override_events'
  ] loop
    foreach v_role in array array['authenticated', 'service_role'] loop
      v_ok := v_ok
        and not pg_catalog.has_table_privilege(v_role, 'public.' || v_table, 'INSERT')
        and not pg_catalog.has_table_privilege(v_role, 'public.' || v_table, 'UPDATE')
        and not pg_catalog.has_table_privilege(v_role, 'public.' || v_table, 'DELETE');
    end loop;
  end loop;

  foreach v_table in array array[
    'commercial_opportunity_checklist_progress_versions',
    'commercial_opportunity_checklist_progress_items',
    'commercial_opportunity_checklist_progress_current'
  ] loop
    v_ok := v_ok
      and not pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
      and not pg_catalog.has_table_privilege('service_role', 'public.' || v_table, 'INSERT')
      and not pg_catalog.has_table_privilege('anon', 'public.' || v_table, 'INSERT');
  end loop;

  perform pg_temp._p9_xtenant_expect(4,
    'escrita direta nas autoridades permanece fechada', v_ok);
exception when others then
  perform pg_temp._p9_xtenant_record(4,
    'escrita direta nas autoridades permanece fechada',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s4$;

-- 5/6. Seed qfact canonico em cada tenant via system writer.
do $s5_6$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;

  select * into r from pg_temp._p9_xtenant_exec(
    'service_role', null,
    pg_catalog.format($sql$
      select * from public.write_commercial_opportunity_qualification_fact_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L,
        'need_summary',pg_catalog.to_jsonb('Tenant A'::text),
        'confirmed','system_correction',null,null,'p9_cross_tenant_runner',false
      )
    $sql$, ctx.org_a, ctx.store_a, ctx.opp_a,
      'p9_36_xtenant_seed_a:' || ctx.opp_a::text)
  );
  v_ok := r.operation_succeeded and r.identity_clean and r.harness_error is null
    and pg_catalog.jsonb_array_length(coalesce(r.value_json,'[]'::jsonb)) = 1
    and (r.value_json->0->>'commercial_opportunity_id') = ctx.opp_a::text;
  perform pg_temp._p9_xtenant_expect(5,
    'system writer grava fato canonico no Tenant A', v_ok,
    pg_catalog.format('state=%s message=%s payload=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>'),
      coalesce(r.value_json::text,'<null>')));

  select * into r from pg_temp._p9_xtenant_exec(
    'service_role', null,
    pg_catalog.format($sql$
      select * from public.write_commercial_opportunity_qualification_fact_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L,
        'need_summary',pg_catalog.to_jsonb('Tenant B'::text),
        'confirmed','system_correction',null,null,'p9_cross_tenant_runner',false
      )
    $sql$, ctx.org_b, ctx.store_c_other_org, ctx.opp_other_org,
      'p9_36_xtenant_seed_b:' || ctx.opp_other_org::text)
  );
  v_ok := r.operation_succeeded and r.identity_clean and r.harness_error is null
    and pg_catalog.jsonb_array_length(coalesce(r.value_json,'[]'::jsonb)) = 1
    and (r.value_json->0->>'commercial_opportunity_id') = ctx.opp_other_org::text;
  perform pg_temp._p9_xtenant_expect(6,
    'system writer grava fato canonico no Tenant B', v_ok,
    pg_catalog.format('state=%s message=%s payload=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>'),
      coalesce(r.value_json::text,'<null>')));
exception when others then
  if not exists (select 1 from pg_temp._p9_xtenant_results where scenario_number = 5) then
    perform pg_temp._p9_xtenant_record(5,
      'system writer grava fato canonico no Tenant A',
      'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
  end if;
  if not exists (select 1 from pg_temp._p9_xtenant_results where scenario_number = 6) then
    perform pg_temp._p9_xtenant_record(6,
      'system writer grava fato canonico no Tenant B',
      'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
  end if;
end;
$s5_6$;

-- 7. Active membership sees own qfacts and zero foreign qfacts.
do $s7$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  re record;
  rc record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;

  select * into re from pg_temp._p9_xtenant_exec(
    'authenticated', ctx.user_a,
    pg_catalog.format($sql$
      select
        pg_catalog.count(*) filter (where organization_id=%L::uuid and commercial_opportunity_id=%L::uuid)::integer as own_count,
        pg_catalog.count(*) filter (where organization_id=%L::uuid and commercial_opportunity_id=%L::uuid)::integer as foreign_count
      from public.commercial_opportunity_qualification_fact_events
      where commercial_opportunity_id in (%L::uuid,%L::uuid)
    $sql$, ctx.org_a, ctx.opp_a, ctx.org_b, ctx.opp_other_org, ctx.opp_a, ctx.opp_other_org)
  );

  select * into rc from pg_temp._p9_xtenant_exec(
    'authenticated', ctx.user_a,
    pg_catalog.format($sql$
      select
        pg_catalog.count(*) filter (where organization_id=%L::uuid and commercial_opportunity_id=%L::uuid)::integer as own_count,
        pg_catalog.count(*) filter (where organization_id=%L::uuid and commercial_opportunity_id=%L::uuid)::integer as foreign_count
      from public.commercial_opportunity_qualification_facts_current
      where commercial_opportunity_id in (%L::uuid,%L::uuid)
    $sql$, ctx.org_a, ctx.opp_a, ctx.org_b, ctx.opp_other_org, ctx.opp_a, ctx.opp_other_org)
  );

  v_ok := re.operation_succeeded and rc.operation_succeeded
    and re.identity_clean and rc.identity_clean
    and re.harness_error is null and rc.harness_error is null
    and coalesce((re.value_json->0->>'own_count')::integer,0) >= 1
    and coalesce((re.value_json->0->>'foreign_count')::integer,-1) = 0
    and coalesce((rc.value_json->0->>'own_count')::integer,0) >= 1
    and coalesce((rc.value_json->0->>'foreign_count')::integer,-1) = 0;

  perform pg_temp._p9_xtenant_expect(7,
    'membership ativa le apenas qfacts do proprio tenant', v_ok,
    pg_catalog.format('events=%s current=%s',
      coalesce(re.value_json::text,'<null>'), coalesce(rc.value_json::text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(7,
    'membership ativa le apenas qfacts do proprio tenant',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s7$;

-- 8. Inactive membership sees zero own qfacts.
do $s8$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'authenticated', ctx.user_inactive_a,
    pg_catalog.format($sql$
      select pg_catalog.count(*)::integer as visible_count
      from public.commercial_opportunity_qualification_facts_current
      where organization_id=%L::uuid and commercial_opportunity_id=%L::uuid
    $sql$, ctx.org_a, ctx.opp_a)
  );
  v_ok := r.operation_succeeded and r.identity_clean and r.harness_error is null
    and coalesce((r.value_json->0->>'visible_count')::integer,-1) = 0;
  perform pg_temp._p9_xtenant_expect(8,
    'membership inativa nao recebe leitura de qfacts', v_ok,
    coalesce(r.value_json::text,'<null>'));
exception when others then
  perform pg_temp._p9_xtenant_record(8,
    'membership inativa nao recebe leitura de qfacts',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s8$;

-- 9. anon cannot directly read qfacts.
do $s9$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'anon', null,
    pg_catalog.format($sql$
      select * from public.commercial_opportunity_qualification_facts_current
      where organization_id=%L::uuid and commercial_opportunity_id=%L::uuid
    $sql$, ctx.org_a, ctx.opp_a)
  );
  perform pg_temp._p9_xtenant_expect(9,
    'anon nao le diretamente qualification facts',
    not r.operation_succeeded and r.returned_sqlstate='42501'
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(9,
    'anon nao le diretamente qualification facts',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s9$;

-- 10. Human qfact reader works on exact own scope.
do $s10$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'authenticated', ctx.user_a,
    pg_catalog.format($sql$
      select * from public.read_commercial_opportunity_qualification_facts_by_user(
        %L::uuid,%L::uuid,%L::uuid
      )
    $sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_xtenant_expect(10,
    'reader humano de qfacts funciona no proprio escopo exato',
    r.operation_succeeded and r.identity_clean and r.harness_error is null
      and pg_catalog.jsonb_array_length(coalesce(r.value_json,'[]'::jsonb))=1,
    pg_catalog.format('state=%s message=%s payload=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>'),
      coalesce(r.value_json::text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(10,
    'reader humano de qfacts funciona no proprio escopo exato',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s10$;

-- 11. Human qfact reader blocks foreign organization.
do $s11$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'authenticated', ctx.user_a,
    pg_catalog.format($sql$
      select * from public.read_commercial_opportunity_qualification_facts_by_user(
        %L::uuid,%L::uuid,%L::uuid
      )
    $sql$, ctx.org_b, ctx.store_c_other_org, ctx.opp_other_org)
  );
  perform pg_temp._p9_xtenant_expect(11,
    'reader humano de qfacts bloqueia tenant estrangeiro',
    not r.operation_succeeded and r.returned_sqlstate='42501'
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(11,
    'reader humano de qfacts bloqueia tenant estrangeiro',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s11$;

-- 12. Human qfact reader fails closed on same-org wrong store.
do $s12$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'authenticated', ctx.user_a,
    pg_catalog.format($sql$
      select * from public.read_commercial_opportunity_qualification_facts_by_user(
        %L::uuid,%L::uuid,%L::uuid
      )
    $sql$, ctx.org_a, ctx.store_b_same_org, ctx.opp_a)
  );
  perform pg_temp._p9_xtenant_expect(12,
    'reader humano de qfacts falha fechado em store incorreta',
    not r.operation_succeeded
      and r.returned_sqlstate = any(array['42501','23503','23514']::text[])
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(12,
    'reader humano de qfacts falha fechado em store incorreta',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s12$;

-- 13. authenticated cannot run Checklist materializer.
do $s13$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'authenticated', ctx.user_a,
    pg_catalog.format($sql$
      select * from public.materialize_commercial_opportunity_checklist_by_system(
        %L::uuid,%L::uuid,%L::uuid,'p9_36_auth_must_not_materialize'
      )
    $sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_xtenant_expect(13,
    'authenticated nao executa Checklist materializer system-only',
    not r.operation_succeeded and r.returned_sqlstate='42501'
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(13,
    'authenticated nao executa Checklist materializer system-only',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s13$;

-- 14. Checklist materializer blocks same-org wrong-store opportunity.
do $s14$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'service_role', null,
    pg_catalog.format($sql$
      select * from public.materialize_commercial_opportunity_checklist_by_system(
        %L::uuid,%L::uuid,%L::uuid,'p9_36_wrong_store'
      )
    $sql$, ctx.org_a, ctx.store_b_same_org, ctx.opp_a)
  );
  perform pg_temp._p9_xtenant_expect(14,
    'Checklist materializer bloqueia opportunity de outra store',
    not r.operation_succeeded
      and r.returned_sqlstate='23503'
      and coalesce(r.message_text,'')='ZION_CHECKLIST_OPPORTUNITY_SCOPE_INVALID'
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(14,
    'Checklist materializer bloqueia opportunity de outra store',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s14$;

-- 15. Checklist materializer blocks cross-tenant opportunity.
do $s15$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'service_role', null,
    pg_catalog.format($sql$
      select * from public.materialize_commercial_opportunity_checklist_by_system(
        %L::uuid,%L::uuid,%L::uuid,'p9_36_cross_org'
      )
    $sql$, ctx.org_a, ctx.store_a, ctx.opp_other_org)
  );
  perform pg_temp._p9_xtenant_expect(15,
    'Checklist materializer bloqueia opportunity de outro tenant',
    not r.operation_succeeded
      and r.returned_sqlstate='23503'
      and coalesce(r.message_text,'')='ZION_CHECKLIST_OPPORTUNITY_SCOPE_INVALID'
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(15,
    'Checklist materializer bloqueia opportunity de outro tenant',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s15$;

-- 16. authenticated cannot run Progress materializer.
do $s16$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'authenticated', ctx.user_a,
    pg_catalog.format($sql$
      select * from public.materialize_commercial_opportunity_checklist_progress_by_system(
        %L::uuid,%L::uuid,%L::uuid,'p9_36_auth_must_not_materialize_progress'
      )
    $sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_xtenant_expect(16,
    'authenticated nao executa Progress materializer system-only',
    not r.operation_succeeded and r.returned_sqlstate='42501'
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(16,
    'authenticated nao executa Progress materializer system-only',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s16$;

-- 17. service_role cannot use human Checklist override writer.
do $s17$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'service_role', null,
    pg_catalog.format($sql$
      select * from public.override_commercial_opportunity_checklist_item_by_user(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'p9_36_service_override_forbidden',%L,
        'qualification','commercial_gate','required',
        'cross_tenant_test','P9 3.6 role separation probe.','{}'::jsonb
      )
    $sql$, ctx.org_a, ctx.store_a, ctx.opp_a, gen_random_uuid(), repeat('a',64))
  );
  perform pg_temp._p9_xtenant_expect(17,
    'service_role nao executa writer humano de Checklist override',
    not r.operation_succeeded and r.returned_sqlstate='42501'
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(17,
    'service_role nao executa writer humano de Checklist override',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s17$;

-- 18. Active Tenant A user cannot override Tenant B checklist.
do $s18$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'authenticated', ctx.user_a,
    pg_catalog.format($sql$
      select * from public.override_commercial_opportunity_checklist_item_by_user(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'p9_36_cross_tenant_override',%L,
        'qualification','commercial_gate','required',
        'cross_tenant_test','P9 3.6 foreign tenant override probe.','{}'::jsonb
      )
    $sql$, ctx.org_b, ctx.store_c_other_org, ctx.opp_other_org,
      gen_random_uuid(), repeat('b',64))
  );
  perform pg_temp._p9_xtenant_expect(18,
    'usuario do Tenant A nao altera Checklist do Tenant B',
    not r.operation_succeeded and r.returned_sqlstate='42501'
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(18,
    'usuario do Tenant A nao altera Checklist do Tenant B',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s18$;

-- 19. Inactive membership cannot use human Checklist override.
do $s19$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'authenticated', ctx.user_inactive_a,
    pg_catalog.format($sql$
      select * from public.override_commercial_opportunity_checklist_item_by_user(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'p9_36_inactive_override',%L,
        'qualification','commercial_gate','required',
        'inactive_membership_test','P9 3.6 inactive membership probe.','{}'::jsonb
      )
    $sql$, ctx.org_a, ctx.store_a, ctx.opp_a,
      gen_random_uuid(), repeat('c',64))
  );
  perform pg_temp._p9_xtenant_expect(19,
    'membership inativa nao usa Checklist override humano',
    not r.operation_succeeded and r.returned_sqlstate='42501'
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(19,
    'membership inativa nao usa Checklist override humano',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s19$;

-- 20. anon cannot execute scoped Action Readiness.
do $s20$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'anon', null,
    pg_catalog.format($sql$
      select * from public.read_commercial_action_readiness_scoped(
        %L::uuid,%L::uuid,%L::uuid,'send_quote'
      )
    $sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_xtenant_expect(20,
    'anon nao executa scoped Action Readiness',
    not r.operation_succeeded and r.returned_sqlstate='42501'
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(20,
    'anon nao executa scoped Action Readiness',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s20$;

-- 21. Active Tenant A member cannot read Tenant B readiness.
do $s21$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'authenticated', ctx.user_a,
    pg_catalog.format($sql$
      select * from public.read_commercial_action_readiness_scoped(
        %L::uuid,%L::uuid,%L::uuid,'send_quote'
      )
    $sql$, ctx.org_b, ctx.store_c_other_org, ctx.opp_other_org)
  );
  perform pg_temp._p9_xtenant_expect(21,
    'scoped Action Readiness bloqueia tenant estrangeiro',
    not r.operation_succeeded and r.returned_sqlstate='42501'
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(21,
    'scoped Action Readiness bloqueia tenant estrangeiro',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s21$;

-- 22. Inactive membership cannot read scoped readiness.
do $s22$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'authenticated', ctx.user_inactive_a,
    pg_catalog.format($sql$
      select * from public.read_commercial_action_readiness_scoped(
        %L::uuid,%L::uuid,%L::uuid,'send_quote'
      )
    $sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_xtenant_expect(22,
    'membership inativa nao le scoped Action Readiness',
    not r.operation_succeeded and r.returned_sqlstate='42501'
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(22,
    'membership inativa nao le scoped Action Readiness',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s22$;

-- 23. service_role cannot bypass scoped reader via internal readiness resolver.
do $s23$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'service_role', null,
    pg_catalog.format($sql$
      select * from public.p9_resolve_commercial_action_readiness_internal(
        %L::uuid,%L::uuid,%L::uuid,'send_quote'
      )
    $sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_xtenant_expect(23,
    'service_role nao executa resolver interno de Action Readiness',
    not r.operation_succeeded and r.returned_sqlstate='42501'
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(23,
    'service_role nao executa resolver interno de Action Readiness',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s23$;

-- 24. Qualification system writer blocks same-org wrong-store scope.
do $s24$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'service_role', null,
    pg_catalog.format($sql$
      select * from public.write_commercial_opportunity_qualification_fact_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L,
        'need_summary',pg_catalog.to_jsonb('must not write'::text),
        'confirmed','system_correction',null,null,'p9_cross_tenant_runner',false
      )
    $sql$, ctx.org_a, ctx.store_b_same_org, ctx.opp_a,
      'p9_36_wrong_store_writer:' || ctx.opp_a::text)
  );
  perform pg_temp._p9_xtenant_expect(24,
    'qualification system writer bloqueia opportunity de outra store',
    not r.operation_succeeded
      and r.returned_sqlstate = any(array['23503','23514']::text[])
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(24,
    'qualification system writer bloqueia opportunity de outra store',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s24$;

-- 25. Qualification system writer blocks cross-tenant opportunity scope.
do $s25$
declare
  ctx pg_temp._p9_xtenant_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_xtenant_ctx where singleton is true;
  select * into r from pg_temp._p9_xtenant_exec(
    'service_role', null,
    pg_catalog.format($sql$
      select * from public.write_commercial_opportunity_qualification_fact_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L,
        'need_summary',pg_catalog.to_jsonb('must not write'::text),
        'confirmed','system_correction',null,null,'p9_cross_tenant_runner',false
      )
    $sql$, ctx.org_a, ctx.store_a, ctx.opp_other_org,
      'p9_36_cross_tenant_writer:' || ctx.opp_other_org::text)
  );
  perform pg_temp._p9_xtenant_expect(25,
    'qualification system writer bloqueia opportunity de outro tenant',
    not r.operation_succeeded
      and r.returned_sqlstate = any(array['23503','23514']::text[])
      and r.identity_clean and r.harness_error is null,
    pg_catalog.format('state=%s message=%s',
      coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>')));
exception when others then
  perform pg_temp._p9_xtenant_record(25,
    'qualification system writer bloqueia opportunity de outro tenant',
    'HARNESS_ERROR', sqlstate || ': ' || sqlerrm);
end;
$s25$;

-- --------------------------------------------------------------------------
-- Final hard gate. Any non-PASS aborts the runner; a successful run rolls back
-- every fixture after emitting the PASS notice.
-- --------------------------------------------------------------------------
do $final_gate$
declare
  v_total integer;
  v_pass integer;
  v_bad text;
begin
  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where status='PASS')::integer
  into v_total, v_pass
  from pg_temp._p9_xtenant_results;

  if v_total is distinct from 25 then
    raise exception using
      errcode='P0001',
      message='P9_CROSS_TENANT_ISOLATION_FINAL_RUNNER_INCOMPLETE',
      detail=pg_catalog.format('expected 25 scenarios, got %s', coalesce(v_total,0));
  end if;

  select pg_catalog.string_agg(
    pg_catalog.format('#%s %s [%s] %s',
      scenario_number, scenario_name, status, detail),
    E'\n' order by scenario_number
  )
  into v_bad
  from pg_temp._p9_xtenant_results
  where status <> 'PASS';

  if v_bad is not null then
    raise exception using
      errcode='P0001',
      message='P9_CROSS_TENANT_ISOLATION_FINAL_RUNNER_FAILED',
      detail=v_bad;
  end if;

  raise notice 'P9 3.6 cross-tenant isolation final: %/% scenarios PASS',
    v_pass, v_total;
end;
$final_gate$;

rollback;
