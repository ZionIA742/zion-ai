begin;

set transaction isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_qfw_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_qfw_ctx (
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

insert into pg_temp._p9_qfw_ctx (
  org_a,
  org_b,
  store_a,
  store_b_same_org,
  store_c_other_org,
  user_a,
  user_b,
  user_inactive_a,
  customer_a,
  customer_b,
  opp_a,
  opp_peer,
  opp_other_org
)
values (
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

create or replace function pg_temp._p9_qfw_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_qfw_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_scenario_number,
    p_scenario_name,
    p_status,
    coalesce(p_detail, '<null>')
  )
  on conflict (scenario_number) do update
  set
    scenario_name = excluded.scenario_name,
    status = excluded.status,
    detail = excluded.detail;
end;
$function$;

create or replace function pg_temp._p9_qfw_exec_json_sql(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_json jsonb,
  returned_sqlstate text,
  message_text text,
  constraint_name text
)
language plpgsql
as $function$
declare
  v_value jsonb;
  v_state text;
  v_message text;
  v_constraint text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query
    select false, null::jsonb, null::text,
      'runner helper must start as postgres'::text, null::text;
    return;
  end if;

  if p_role not in ('postgres', 'service_role', 'authenticated', 'anon') then
    return query
    select false, null::jsonb, 'P0001'::text,
      'unsupported role'::text, null::text;
    return;
  end if;

  if p_role <> 'postgres' then
    perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
    perform set_config('request.jwt.claim.role', p_role, true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', coalesce(p_user_id::text, ''),
        'role', p_role
      )::text,
      true
    );
    execute format('set local role %I', p_role);
  end if;

  begin
    execute format('select to_jsonb(result_row) from (%s) result_row', p_sql)
      into v_value;

    if p_role <> 'postgres' then
      execute 'reset role';
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '', true);
    end if;

    return query
    select true, v_value, null::text, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;

      if p_role <> 'postgres' then
        execute 'reset role';
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);
      end if;

      return query
      select false, null::jsonb, v_state, v_message, v_constraint;
  end;
exception
  when others then
    begin
      execute 'reset role';
    exception when others then null;
    end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    return query
    select false, null::jsonb, sqlstate::text,
      ('runner helper error: ' || sqlerrm)::text, null::text;
end;
$function$;

-- --------------------------------------------------------------------------
-- Fixtures. Everything is rolled back at the end.
-- --------------------------------------------------------------------------
do $fixtures$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;

  insert into public.organizations (id, name, subscription_status)
  values
    (ctx.org_a, 'P9 QFact Writer Runner Org A', 'active'),
    (ctx.org_b, 'P9 QFact Writer Runner Org B', 'active');

  insert into public.stores (id, organization_id, name)
  values
    (ctx.store_a, ctx.org_a, 'P9 QFact Writer Runner Store A'),
    (ctx.store_b_same_org, ctx.org_a, 'P9 QFact Writer Runner Store B'),
    (ctx.store_c_other_org, ctx.org_b, 'P9 QFact Writer Runner Store C');

  insert into auth.users (id)
  values
    (ctx.user_a),
    (ctx.user_b),
    (ctx.user_inactive_a);

  insert into public.memberships (organization_id, user_id, role, is_active)
  values
    (ctx.org_a, ctx.user_a, 'owner'::public.app_role, true),
    (ctx.org_b, ctx.user_b, 'owner'::public.app_role, true),
    (ctx.org_a, ctx.user_inactive_a, 'owner'::public.app_role, false);

  insert into public.customers (id, organization_id, display_name)
  values
    (ctx.customer_a, ctx.org_a, 'Cliente Writer A'),
    (ctx.customer_b, ctx.org_b, 'Cliente Writer B');

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage
  )
  values
    (ctx.opp_a, ctx.org_a, ctx.store_a, ctx.customer_a, 'novo_lead'),
    (ctx.opp_peer, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_other_org, ctx.org_b, ctx.store_c_other_org, ctx.customer_b, 'novo_lead');
end;
$fixtures$;

-- 1 ------------------------------------------------------------------------
do $scenario$
declare
  v_ok boolean;
  v_detail text;
begin
  v_ok :=
    pg_catalog.to_regprocedure('public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)') is not null
    and pg_catalog.to_regprocedure('public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)') is not null
    and pg_catalog.to_regprocedure('public.write_commercial_opportunity_qualification_fact_by_user(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,boolean)') is not null
    and not pg_catalog.has_function_privilege('authenticated', 'public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', 'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)', 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', 'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)', 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', 'public.write_commercial_opportunity_qualification_fact_by_user(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,boolean)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.write_commercial_opportunity_qualification_fact_by_user(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,boolean)', 'EXECUTE');

  v_detail := format('contracts_and_grants=%s', v_ok);
  perform pg_temp._p9_qfw_record(1, 'contratos e grants dos writers sao minimos e separados', case when v_ok then 'PASS' else 'SUT_FAIL' end, v_detail);
exception when others then
  perform pg_temp._p9_qfw_record(1, 'contratos e grants dos writers sao minimos e separados', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 2 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql(
    'authenticated', ctx.user_a,
    format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'auth-block','need_summary',to_jsonb('x'::text),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_qfw_record(2, 'authenticated nao executa writer de sistema', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(2, 'authenticated nao executa writer de sistema', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 3 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql(
    'service_role', null,
    format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'service-block','need_summary',to_jsonb('x'::text),null,null,false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_qfw_record(3, 'service_role nao executa writer humano', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(3, 'service_role nao executa writer humano', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 4 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql(
    'authenticated', ctx.user_inactive_a,
    format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'inactive-block','need_summary',to_jsonb('x'::text),null,null,false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_qfw_record(4, 'membership inativa nao escreve qualification fact', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(4, 'membership inativa nao escreve qualification fact', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 5 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql(
    'service_role', null,
    format($sql$select * from public.apply_commercial_opportunity_qualification_fact_internal(%L::uuid,%L::uuid,%L::uuid,'internal-block','need_summary',to_jsonb('x'::text),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_qfw_record(5, 'writer interno nao e executavel por service_role', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(5, 'writer interno nao e executavel por service_role', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 6 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql(
    'service_role', null,
    format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'source-block','need_summary',to_jsonb('x'::text),'confirmed','crm_manual',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_qfw_record(6, 'writer de sistema nao pode falsificar crm_manual', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(6, 'writer de sistema nao pode falsificar crm_manual', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 7 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql(
    'service_role', null,
    format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'assertion-block','need_summary',to_jsonb('x'::text),'confirmed','system_inference',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_qfw_record(7, 'system_inference nao pode produzir confirmed', case when not r.operation_succeeded and r.returned_sqlstate = '23514' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(7, 'system_inference nao pode produzir confirmed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 8 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql(
    'service_role', null,
    format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'incoming-block','need_summary',to_jsonb('x'::text),'confirmed','incoming_customer_message',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_qfw_record(8, 'incoming confirmado exige proveniencia real', case when not r.operation_succeeded and r.returned_sqlstate = '23514' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(8, 'incoming confirmado exige proveniencia real', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 9 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql(
    'authenticated', ctx.user_a,
    format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'manual-create','need_summary',to_jsonb('Quero uma piscina familiar'::text),null,null,false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  v_ok := r.operation_succeeded and r.value_json ->> 'current_state' = 'confirmed' and r.value_json ->> 'outcome' = 'confirmed_created';
  perform pg_temp._p9_qfw_record(9, 'writer humano cria fato confirmado canonico', case when v_ok then 'PASS' else 'SUT_FAIL' end, r.value_json::text);
exception when others then
  perform pg_temp._p9_qfw_record(9, 'writer humano cria fato confirmado canonico', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 10 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
  v_count integer;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql(
    'authenticated', ctx.user_a,
    format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'manual-create','need_summary',to_jsonb('Quero uma piscina familiar'::text),null,null,false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  select count(*) into v_count
  from public.commercial_opportunity_qualification_fact_events
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_a and fact_key = 'need_summary' and operation_key = 'manual-create';
  perform pg_temp._p9_qfw_record(10, 'replay identico e idempotente e nao duplica evento', case when r.operation_succeeded and r.value_json ->> 'outcome' = 'idempotent_replay_current' and v_count = 1 then 'PASS' else 'SUT_FAIL' end, format('result=%s count=%s', r.value_json, v_count));
exception when others then
  perform pg_temp._p9_qfw_record(10, 'replay identico e idempotente e nao duplica evento', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 11 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql(
    'authenticated', ctx.user_a,
    format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'manual-create','need_summary',to_jsonb('payload diferente'::text),null,null,false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_qfw_record(11, 'mesma operation_key com payload diferente falha fechado', case when not r.operation_succeeded and r.returned_sqlstate = '23505' and r.message_text = 'ZION_QFACT_IDEMPOTENCY_KEY_REUSED' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(11, 'mesma operation_key com payload diferente falha fechado', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 12 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
  v_before_state text;
  v_before_last_event_id uuid;
  v_before_conflict_values jsonb;
  v_after_state text;
  v_after_last_event_id uuid;
  v_after_conflict_values jsonb;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;

  -- A second confirmed value must materialize conflict per the canonical matrix.
  select * into r from pg_temp._p9_qfw_exec_json_sql(
    'authenticated', ctx.user_a,
    format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'manual-later','need_summary',to_jsonb('Quero uma piscina para a familia'::text),null,null,false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  if not r.operation_succeeded
     or r.value_json ->> 'current_state' <> 'conflict'
     or r.value_json ->> 'outcome' <> 'confirmed_conflict_created' then
    perform pg_temp._p9_qfw_record(12, 'replay antigo nao regride projecao atual', 'SUT_FAIL', coalesce(r.value_json::text, r.returned_sqlstate || ' ' || r.message_text, '<null>'));
    return;
  end if;

  select
    current_row.current_state,
    current_row.last_event_id,
    current_row.conflict_values_json
  into
    v_before_state,
    v_before_last_event_id,
    v_before_conflict_values
  from public.commercial_opportunity_qualification_facts_current current_row
  where current_row.organization_id = ctx.org_a
    and current_row.store_id = ctx.store_a
    and current_row.commercial_opportunity_id = ctx.opp_a
    and current_row.fact_key = 'need_summary';

  select * into r from pg_temp._p9_qfw_exec_json_sql(
    'authenticated', ctx.user_a,
    format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'manual-create','need_summary',to_jsonb('Quero uma piscina familiar'::text),null,null,false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );

  select
    current_row.current_state,
    current_row.last_event_id,
    current_row.conflict_values_json
  into
    v_after_state,
    v_after_last_event_id,
    v_after_conflict_values
  from public.commercial_opportunity_qualification_facts_current current_row
  where current_row.organization_id = ctx.org_a
    and current_row.store_id = ctx.store_a
    and current_row.commercial_opportunity_id = ctx.opp_a
    and current_row.fact_key = 'need_summary';

  perform pg_temp._p9_qfw_record(
    12,
    'replay antigo nao regride projecao atual',
    case
      when r.operation_succeeded
       and r.value_json ->> 'outcome' = 'idempotent_replay_stale'
       and r.value_json ->> 'current_state' = v_before_state
       and (r.value_json ->> 'current_last_event_id')::uuid is not distinct from v_before_last_event_id
       and (r.value_json -> 'conflict_values_json') is not distinct from v_before_conflict_values
       and v_after_state is not distinct from v_before_state
       and v_after_last_event_id is not distinct from v_before_last_event_id
       and v_after_conflict_values is not distinct from v_before_conflict_values
        then 'PASS'
      else 'SUT_FAIL'
    end,
    pg_catalog.jsonb_build_object(
      'replay', r.value_json,
      'before_state', v_before_state,
      'before_last_event_id', v_before_last_event_id,
      'after_state', v_after_state,
      'after_last_event_id', v_after_last_event_id
    )::text
  );
exception when others then
  perform pg_temp._p9_qfw_record(12, 'replay antigo nao regride projecao atual', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 13 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql(
    'service_role', null,
    format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'infer-budget','budget_text',to_jsonb('ate 20 mil'::text),'inferred','system_inference',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a)
  );
  perform pg_temp._p9_qfw_record(13, 'system_inference cria estado inferred', case when r.operation_succeeded and r.value_json ->> 'current_state' = 'inferred' and r.value_json ->> 'outcome' = 'inferred_created' then 'PASS' else 'SUT_FAIL' end, r.value_json::text);
exception when others then
  perform pg_temp._p9_qfw_record(13, 'system_inference cria estado inferred', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 14 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  perform * from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'infer-space-a','space_text',to_jsonb('quintal 5 x 4'::text),'inferred','system_inference',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'confirm-space-a','space_text',to_jsonb('quintal 5 x 4'::text),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(14, 'inferred A para confirmed A promove sem conflito', case when r.operation_succeeded and r.value_json ->> 'current_state' = 'confirmed' and r.value_json ->> 'outcome' = 'inferred_promoted_confirmed' then 'PASS' else 'SUT_FAIL' end, r.value_json::text);
exception when others then
  perform pg_temp._p9_qfw_record(14, 'inferred A para confirmed A promove sem conflito', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 15 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  perform * from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'infer-period-a','preferred_period_text',to_jsonb('de manha'::text),'inferred','system_inference',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'confirm-period-b','preferred_period_text',to_jsonb('a tarde'::text),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(15, 'inferred A para confirmed B aceita B sem conflito', case when r.operation_succeeded and r.value_json ->> 'current_state' = 'confirmed' and r.value_json ->> 'outcome' = 'inferred_replaced_by_confirmed' then 'PASS' else 'SUT_FAIL' end, r.value_json::text);
exception when others then
  perform pg_temp._p9_qfw_record(15, 'inferred A para confirmed B aceita B sem conflito', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 16 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  perform * from pg_temp._p9_qfw_exec_json_sql('authenticated', ctx.user_a, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'decision-confirm-a','decision_context',to_jsonb('decide com a esposa'::text),null,null,false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'decision-infer-b','decision_context',to_jsonb('decide sozinho'::text),'inferred','system_inference',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(16, 'confirmed A nao e sobrescrito por inferred B', case when r.operation_succeeded and r.value_json ->> 'current_state' = 'confirmed' and r.value_json ->> 'outcome' = 'inferred_ignored_confirmed' and r.value_json ->> 'current_value_json' = 'decide com a esposa' then 'PASS' else 'SUT_FAIL' end, r.value_json::text);
exception when others then
  perform pg_temp._p9_qfw_record(16, 'confirmed A nao e sobrescrito por inferred B', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 17 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  perform * from pg_temp._p9_qfw_exec_json_sql('authenticated', ctx.user_a, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'pref-confirm-a','customer_preferences_text',to_jsonb('quer pouca manutencao'::text),null,null,false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'pref-confirm-a2','customer_preferences_text',to_jsonb('quer pouca manutencao'::text),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(17, 'confirmed A para confirmed A reafirma sem conflito', case when r.operation_succeeded and r.value_json ->> 'current_state' = 'confirmed' and r.value_json ->> 'outcome' = 'confirmed_reaffirmed' then 'PASS' else 'SUT_FAIL' end, r.value_json::text);
exception when others then
  perform pg_temp._p9_qfw_record(17, 'confirmed A para confirmed A reafirma sem conflito', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 18 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  perform * from pg_temp._p9_qfw_exec_json_sql('authenticated', ctx.user_a, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'location-a','location_text',to_jsonb('Campinas'::text),null,null,false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'location-b','location_text',to_jsonb('Sorocaba'::text),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(18, 'confirmed A para confirmed B materializa conflict', case when r.operation_succeeded and r.value_json ->> 'current_state' = 'conflict' and jsonb_array_length(r.value_json -> 'conflict_values_json') = 2 then 'PASS' else 'SUT_FAIL' end, r.value_json::text);
exception when others then
  perform pg_temp._p9_qfw_record(18, 'confirmed A para confirmed B materializa conflict', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 19 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'location-infer-c','location_text',to_jsonb('Jundiai'::text),'inferred','system_inference',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(19, 'conflict ignora inferred e preserva candidatos', case when r.operation_succeeded and r.value_json ->> 'current_state' = 'conflict' and r.value_json ->> 'outcome' = 'inferred_ignored_conflict' and jsonb_array_length(r.value_json -> 'conflict_values_json') = 2 then 'PASS' else 'SUT_FAIL' end, r.value_json::text);
exception when others then
  perform pg_temp._p9_qfw_record(19, 'conflict ignora inferred e preserva candidatos', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 20 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'location-common-a','location_text',to_jsonb('Campinas'::text),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(20, 'conflict mais confirmed comum nao resolve silenciosamente', case when r.operation_succeeded and r.value_json ->> 'current_state' = 'conflict' and r.value_json ->> 'outcome' = 'conflict_preserved' and jsonb_array_length(r.value_json -> 'conflict_values_json') = 2 then 'PASS' else 'SUT_FAIL' end, r.value_json::text);
exception when others then
  perform pg_temp._p9_qfw_record(20, 'conflict mais confirmed comum nao resolve silenciosamente', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 21 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'location-c','location_text',to_jsonb('Jundiai'::text),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(21, 'conflict aceita terceiro confirmed sem resolver', case when r.operation_succeeded and r.value_json ->> 'current_state' = 'conflict' and jsonb_array_length(r.value_json -> 'conflict_values_json') = 3 then 'PASS' else 'SUT_FAIL' end, r.value_json::text);
exception when others then
  perform pg_temp._p9_qfw_record(21, 'conflict aceita terceiro confirmed sem resolver', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 22 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql('authenticated', ctx.user_a, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'location-resolve-b','location_text',to_jsonb('Sorocaba'::text),null,null,true)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(22, 'crm_manual resolve conflito explicitamente', case when r.operation_succeeded and r.value_json ->> 'current_state' = 'confirmed' and r.value_json ->> 'outcome' = 'conflict_resolved' and r.value_json ->> 'conflict_values_json' is null then 'PASS' else 'SUT_FAIL' end, r.value_json::text);
exception when others then
  perform pg_temp._p9_qfw_record(22, 'crm_manual resolve conflito explicitamente', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 23 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  perform * from pg_temp._p9_qfw_exec_json_sql('authenticated', ctx.user_a, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'objection-a','relevant_objection_text',to_jsonb('preco alto'::text),null,null,false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform * from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'objection-b','relevant_objection_text',to_jsonb('prazo alto'::text),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'objection-resolve-c','relevant_objection_text',to_jsonb('quer avaliar garantia'::text),'confirmed','system_correction',null,null,'sales_ai',true)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(23, 'system_correction pode resolver conflito escolhendo valor C', case when r.operation_succeeded and r.value_json ->> 'current_state' = 'confirmed' and r.value_json ->> 'current_value_json' = 'quer avaliar garantia' and r.value_json ->> 'outcome' = 'conflict_resolved' then 'PASS' else 'SUT_FAIL' end, r.value_json::text);
exception when others then
  perform pg_temp._p9_qfw_record(23, 'system_correction pode resolver conflito escolhendo valor C', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 24 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql('authenticated', ctx.user_a, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'resolve-no-conflict','installation_interest',to_jsonb(true),null,null,true)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(24, 'resolves_conflict falha quando nao existe conflict', case when not r.operation_succeeded and r.returned_sqlstate = '23514' and r.message_text = 'ZION_QFACT_NO_CONFLICT_TO_RESOLVE' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(24, 'resolves_conflict falha quando nao existe conflict', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 25 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'scope-org','payment_interest',to_jsonb(true),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_b, ctx.store_c_other_org, ctx.opp_a));
  perform pg_temp._p9_qfw_record(25, 'writer falha fechado em opportunity cross-tenant', case when not r.operation_succeeded and r.returned_sqlstate = '23514' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(25, 'writer falha fechado em opportunity cross-tenant', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 26 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'scope-store','payment_interest',to_jsonb(true),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_b_same_org, ctx.opp_a));
  perform pg_temp._p9_qfw_record(26, 'writer falha fechado em opportunity cross-store', case when not r.operation_succeeded and r.returned_sqlstate = '23514' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(26, 'writer falha fechado em opportunity cross-store', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 27 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r_a record;
  r_b record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r_a from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'shared-op','payment_interest',to_jsonb(true),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  select * into r_b from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'shared-op','payment_interest',to_jsonb(false),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_peer));
  perform pg_temp._p9_qfw_record(27, 'mesma operation_key em outra opportunity nao colide', case when r_a.operation_succeeded and r_b.operation_succeeded and r_a.value_json ->> 'commercial_opportunity_id' <> r_b.value_json ->> 'commercial_opportunity_id' then 'PASS' else 'SUT_FAIL' end, format('a=%s b=%s', r_a.value_json, r_b.value_json));
exception when others then
  perform pg_temp._p9_qfw_record(27, 'mesma operation_key em outra opportunity nao colide', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 28 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'bad-pair','technical_visit_interest',to_jsonb(true),'confirmed','system_correction',%L::uuid,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a, gen_random_uuid()));
  perform pg_temp._p9_qfw_record(28, 'source_message_id exige source_conversation_id pareado', case when not r.operation_succeeded and r.returned_sqlstate = '23514' and r.message_text = 'ZION_QFACT_PROVENANCE_PAIR_REQUIRED' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(28, 'source_message_id exige source_conversation_id pareado', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 29 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'bad-number','requested_area_m2',to_jsonb('vinte'::text),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(29, 'fact_key deriva tipo e bloqueia payload incoerente', case when not r.operation_succeeded and r.returned_sqlstate = '23514' and r.message_text = 'ZION_QFACT_VALUE_PAYLOAD_INVALID' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(29, 'fact_key deriva tipo e bloqueia payload incoerente', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 30 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'  normalized-op  ','interested_product_reference',to_jsonb('  PISCINA   Azul  '::text),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(30, 'writer normaliza texto e operation_key marginal', case when r.operation_succeeded and r.value_json ->> 'normalized_value_text' = 'piscina azul' and exists (select 1 from public.commercial_opportunity_qualification_fact_events e where e.organization_id = ctx.org_a and e.store_id = ctx.store_a and e.commercial_opportunity_id = ctx.opp_a and e.fact_key = 'interested_product_reference' and e.operation_key = 'normalized-op') then 'PASS' else 'SUT_FAIL' end, r.value_json::text);
exception when others then
  perform pg_temp._p9_qfw_record(30, 'writer normaliza texto e operation_key marginal', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 31 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'bad-created-by','technical_visit_interest',to_jsonb(true),'confirmed','system_correction',null,null,'Sales AI com espaco',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfw_record(31, 'created_by invalido e bloqueado pelo writer', case when not r.operation_succeeded and r.returned_sqlstate = '22023' and r.message_text = 'ZION_QFACT_CREATED_BY_INVALID' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfw_record(31, 'created_by invalido e bloqueado pelo writer', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 32 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql('service_role', null, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_system(%L::uuid,%L::uuid,%L::uuid,'visit-bool','technical_visit_interest',to_jsonb(true),'confirmed','system_correction',null,null,'sales_ai',false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  select exists (
    select 1
    from public.commercial_opportunity_qualification_facts_current c
    join public.commercial_opportunity_qualification_fact_events e
      on e.id = c.last_event_id
     and e.organization_id = c.organization_id
     and e.store_id = c.store_id
     and e.commercial_opportunity_id = c.commercial_opportunity_id
     and e.fact_key = c.fact_key
    where c.organization_id = ctx.org_a
      and c.store_id = ctx.store_a
      and c.commercial_opportunity_id = ctx.opp_a
      and c.fact_key = 'technical_visit_interest'
      and c.current_state = 'confirmed'
      and c.value_json = 'true'::jsonb
      and c.last_operation_key = e.operation_key
      and c.source_type = e.source_type
      and c.source_message_id is not distinct from e.source_message_id
      and c.source_conversation_id is not distinct from e.source_conversation_id
  ) into v_ok;
  perform pg_temp._p9_qfw_record(32, 'writer preserva coerencia event para current', case when r.operation_succeeded and v_ok then 'PASS' else 'SUT_FAIL' end, format('result=%s coherent=%s', r.value_json, v_ok));
exception when others then
  perform pg_temp._p9_qfw_record(32, 'writer preserva coerencia event para current', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 33 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  r record;
  v_created_by text;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select * into r from pg_temp._p9_qfw_exec_json_sql('authenticated', ctx.user_a, format($sql$select * from public.write_commercial_opportunity_qualification_fact_by_user(%L::uuid,%L::uuid,%L::uuid,'manual-created-by','installation_interest',to_jsonb(true),null,null,false)$sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  select e.created_by into v_created_by
  from public.commercial_opportunity_qualification_fact_events e
  where e.organization_id = ctx.org_a and e.store_id = ctx.store_a and e.commercial_opportunity_id = ctx.opp_a and e.fact_key = 'installation_interest' and e.operation_key = 'manual-created-by';
  perform pg_temp._p9_qfw_record(33, 'writer humano deriva created_by de auth.uid', case when r.operation_succeeded and v_created_by = ('user:' || ctx.user_a::text) then 'PASS' else 'SUT_FAIL' end, format('created_by=%s result=%s', v_created_by, r.value_json));
exception when others then
  perform pg_temp._p9_qfw_record(33, 'writer humano deriva created_by de auth.uid', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 34 -----------------------------------------------------------------------
do $scenario$
declare
  v_ok boolean;
begin
  v_ok :=
    not pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_fact_events', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_facts_current', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_facts_current', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_fact_events', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_facts_current', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_facts_current', 'UPDATE');
  perform pg_temp._p9_qfw_record(34, 'writers nao reabrem escrita direta nas tabelas', case when v_ok then 'PASS' else 'SUT_FAIL' end, format('direct_write_closed=%s', v_ok));
exception when others then
  perform pg_temp._p9_qfw_record(34, 'writers nao reabrem escrita direta nas tabelas', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 35 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfw_ctx%rowtype;
  v_orgs integer;
  v_stores integer;
  v_opps integer;
  v_events integer;
  v_current integer;
begin
  select * into ctx from pg_temp._p9_qfw_ctx;
  select count(*) into v_orgs from public.organizations where id in (ctx.org_a, ctx.org_b);
  select count(*) into v_stores from public.stores where id in (ctx.store_a, ctx.store_b_same_org, ctx.store_c_other_org);
  select count(*) into v_opps from public.commercial_opportunities where id in (ctx.opp_a, ctx.opp_peer, ctx.opp_other_org);
  select count(*) into v_events from public.commercial_opportunity_qualification_fact_events where commercial_opportunity_id in (ctx.opp_a, ctx.opp_peer, ctx.opp_other_org);
  select count(*) into v_current from public.commercial_opportunity_qualification_facts_current where commercial_opportunity_id in (ctx.opp_a, ctx.opp_peer, ctx.opp_other_org);
  perform pg_temp._p9_qfw_record(35, 'runner mantem fixtures na transacao e termina com rollback', case when v_orgs = 2 and v_stores = 3 and v_opps = 3 and v_events > 0 and v_current > 0 then 'PASS' else 'SUT_FAIL' end, format('orgs=%s stores=%s opps=%s events=%s current=%s final_statement=ROLLBACK', v_orgs, v_stores, v_opps, v_events, v_current));
exception when others then
  perform pg_temp._p9_qfw_record(35, 'runner mantem fixtures na transacao e termina com rollback', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

select scenario_number, scenario_name, status, detail
from pg_temp._p9_qfw_results
order by scenario_number;

rollback;
