begin;

set transaction isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_qfr_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_qfr_ctx (
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
  opp_full uuid not null,
  opp_empty uuid not null,
  opp_conflict uuid not null,
  opp_peer uuid not null,
  opp_other_org uuid not null
) on commit preserve rows;

insert into pg_temp._p9_qfr_ctx (
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
  opp_full,
  opp_empty,
  opp_conflict,
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
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

create or replace function pg_temp._p9_qfr_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_qfr_results (
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

create or replace function pg_temp._p9_qfr_exec_json_sql(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_json jsonb,
  returned_sqlstate text,
  message_text text
)
language plpgsql
as $function$
declare
  v_value jsonb;
  v_state text;
  v_message text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query
    select false, null::jsonb, null::text,
      'runner helper must start as postgres'::text;
    return;
  end if;

  if p_role not in ('postgres', 'service_role', 'authenticated', 'anon') then
    return query
    select false, null::jsonb, 'P0001'::text, 'unsupported role'::text;
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
    select true, v_value, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;

      if p_role <> 'postgres' then
        execute 'reset role';
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claims', '', true);
      end if;

      return query
      select false, null::jsonb, v_state, v_message;
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
      ('runner helper error: ' || sqlerrm)::text;
end;
$function$;

-- --------------------------------------------------------------------------
-- Preconditions for this runner.
-- --------------------------------------------------------------------------
do $runner_preflight$
begin
  if pg_catalog.to_regprocedure(
       'public.write_commercial_opportunity_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'qualification fact reader/writer prerequisites are missing';
  end if;
end;
$runner_preflight$;

-- --------------------------------------------------------------------------
-- Fixtures. Everything is rolled back at the end.
-- --------------------------------------------------------------------------
do $fixtures$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;

  insert into public.organizations (id, name, subscription_status)
  values
    (ctx.org_a, 'P9 QFact Reader Runner Org A', 'active'),
    (ctx.org_b, 'P9 QFact Reader Runner Org B', 'active');

  insert into public.stores (id, organization_id, name)
  values
    (ctx.store_a, ctx.org_a, 'P9 QFact Reader Runner Store A'),
    (ctx.store_b_same_org, ctx.org_a, 'P9 QFact Reader Runner Store B'),
    (ctx.store_c_other_org, ctx.org_b, 'P9 QFact Reader Runner Store C');

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
    (ctx.customer_a, ctx.org_a, 'Cliente Reader A'),
    (ctx.customer_b, ctx.org_b, 'Cliente Reader B');

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage
  )
  values
    (ctx.opp_full, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_empty, ctx.org_a, ctx.store_a, ctx.customer_a, 'novo_lead'),
    (ctx.opp_conflict, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_peer, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_other_org, ctx.org_b, ctx.store_c_other_org, ctx.customer_b, 'novo_lead');

  -- Full opportunity: five default conversational groups satisfied plus one
  -- optional fact. All writes go through the canonical writer.
  perform * from public.write_commercial_opportunity_qualification_fact_by_system(
    ctx.org_a, ctx.store_a, ctx.opp_full,
    'reader-full-need', 'need_summary', to_jsonb('Piscina para uso familiar'::text),
    'confirmed', 'system_correction', null, null, 'reader_runner', false
  );

  perform * from public.write_commercial_opportunity_qualification_fact_by_system(
    ctx.org_a, ctx.store_a, ctx.opp_full,
    'reader-full-space', 'space_text', to_jsonb('quintal 5 x 4'::text),
    'inferred', 'system_inference', null, null, 'reader_runner', false
  );

  perform * from public.write_commercial_opportunity_qualification_fact_by_system(
    ctx.org_a, ctx.store_a, ctx.opp_full,
    'reader-full-location', 'location_text', to_jsonb('Campinas'::text),
    'confirmed', 'system_correction', null, null, 'reader_runner', false
  );

  perform * from public.write_commercial_opportunity_qualification_fact_by_system(
    ctx.org_a, ctx.store_a, ctx.opp_full,
    'reader-full-installation', 'installation_interest', 'true'::jsonb,
    'confirmed', 'system_correction', null, null, 'reader_runner', false
  );

  perform * from public.write_commercial_opportunity_qualification_fact_by_system(
    ctx.org_a, ctx.store_a, ctx.opp_full,
    'reader-full-payment', 'payment_interest', 'true'::jsonb,
    'confirmed', 'system_correction', null, null, 'reader_runner', false
  );

  perform * from public.write_commercial_opportunity_qualification_fact_by_system(
    ctx.org_a, ctx.store_a, ctx.opp_full,
    'reader-full-budget', 'budget_text', to_jsonb('ate 20 mil'::text),
    'confirmed', 'system_correction', null, null, 'reader_runner', false
  );

  -- Conflict opportunity: need is known, location is conflicting.
  perform * from public.write_commercial_opportunity_qualification_fact_by_system(
    ctx.org_a, ctx.store_a, ctx.opp_conflict,
    'reader-conflict-need', 'need_summary', to_jsonb('Piscina para lazer'::text),
    'confirmed', 'system_correction', null, null, 'reader_runner', false
  );

  perform * from public.write_commercial_opportunity_qualification_fact_by_system(
    ctx.org_a, ctx.store_a, ctx.opp_conflict,
    'reader-conflict-location-a', 'location_text', to_jsonb('Campinas'::text),
    'confirmed', 'system_correction', null, null, 'reader_runner', false
  );

  perform * from public.write_commercial_opportunity_qualification_fact_by_system(
    ctx.org_a, ctx.store_a, ctx.opp_conflict,
    'reader-conflict-location-b', 'location_text', to_jsonb('Sorocaba'::text),
    'confirmed', 'system_correction', null, null, 'reader_runner', false
  );

  -- Peer opportunity in the same org/store/customer proves opportunity-level isolation.
  perform * from public.write_commercial_opportunity_qualification_fact_by_system(
    ctx.org_a, ctx.store_a, ctx.opp_peer,
    'reader-peer-payment', 'payment_interest', 'false'::jsonb,
    'confirmed', 'system_correction', null, null, 'reader_runner', false
  );
end;
$fixtures$;

-- 1 ------------------------------------------------------------------------
do $scenario$
declare
  v_ok boolean;
begin
  v_ok :=
    pg_catalog.to_regprocedure('public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)') is not null
    and pg_catalog.to_regprocedure('public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)') is not null
    and pg_catalog.to_regprocedure('public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid)') is not null
    and not pg_catalog.has_function_privilege('authenticated', 'public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', 'public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)', 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', 'public.read_commercial_opportunity_qualification_facts_by_system(uuid,uuid,uuid)', 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', 'public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.read_commercial_opportunity_qualification_facts_by_user(uuid,uuid,uuid)', 'EXECUTE');

  perform pg_temp._p9_qfr_record(1, 'contratos e grants dos readers sao minimos e separados', case when v_ok then 'PASS' else 'SUT_FAIL' end, format('contracts_and_grants=%s', v_ok));
exception when others then
  perform pg_temp._p9_qfr_record(1, 'contratos e grants dos readers sao minimos e separados', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 2 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from pg_temp._p9_qfr_exec_json_sql(
    'authenticated', ctx.user_a,
    format($sql$select * from public.read_commercial_opportunity_qualification_facts_by_system(%L::uuid,%L::uuid,%L::uuid)$sql$, ctx.org_a, ctx.store_a, ctx.opp_full)
  );
  perform pg_temp._p9_qfr_record(2, 'authenticated nao executa reader de sistema', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfr_record(2, 'authenticated nao executa reader de sistema', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 3 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from pg_temp._p9_qfr_exec_json_sql(
    'service_role', null,
    format($sql$select * from public.read_commercial_opportunity_qualification_facts_by_user(%L::uuid,%L::uuid,%L::uuid)$sql$, ctx.org_a, ctx.store_a, ctx.opp_full)
  );
  perform pg_temp._p9_qfr_record(3, 'service_role nao executa reader humano', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfr_record(3, 'service_role nao executa reader humano', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 4 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from pg_temp._p9_qfr_exec_json_sql(
    'authenticated', ctx.user_inactive_a,
    format($sql$select * from public.read_commercial_opportunity_qualification_facts_by_user(%L::uuid,%L::uuid,%L::uuid)$sql$, ctx.org_a, ctx.store_a, ctx.opp_full)
  );
  perform pg_temp._p9_qfr_record(4, 'membership inativa nao le qualification facts', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfr_record(4, 'membership inativa nao le qualification facts', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 5 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from pg_temp._p9_qfr_exec_json_sql(
    'service_role', null,
    format($sql$select * from public.read_commercial_opportunity_qualification_facts_internal(%L::uuid,%L::uuid,%L::uuid)$sql$, ctx.org_a, ctx.store_a, ctx.opp_full)
  );
  perform pg_temp._p9_qfr_record(5, 'reader interno nao e executavel por service_role', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfr_record(5, 'reader interno nao e executavel por service_role', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 6 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from pg_temp._p9_qfr_exec_json_sql(
    'service_role', null,
    format($sql$select * from public.read_commercial_opportunity_qualification_facts_by_system(null,%L::uuid,%L::uuid)$sql$, ctx.store_a, ctx.opp_full)
  );
  perform pg_temp._p9_qfr_record(6, 'reader exige organization store e opportunity explicitos', case when not r.operation_succeeded and r.returned_sqlstate = '22023' and r.message_text = 'ZION_QFACT_READER_ARGUMENTS_REQUIRED' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfr_record(6, 'reader exige organization store e opportunity explicitos', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 7 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from pg_temp._p9_qfr_exec_json_sql(
    'service_role', null,
    format($sql$select * from public.read_commercial_opportunity_qualification_facts_by_system(%L::uuid,%L::uuid,%L::uuid)$sql$, ctx.org_b, ctx.store_c_other_org, ctx.opp_full)
  );
  perform pg_temp._p9_qfr_record(7, 'reader falha fechado em opportunity cross-tenant', case when not r.operation_succeeded and r.returned_sqlstate = '23514' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfr_record(7, 'reader falha fechado em opportunity cross-tenant', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 8 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from pg_temp._p9_qfr_exec_json_sql(
    'service_role', null,
    format($sql$select * from public.read_commercial_opportunity_qualification_facts_by_system(%L::uuid,%L::uuid,%L::uuid)$sql$, ctx.org_a, ctx.store_b_same_org, ctx.opp_full)
  );
  perform pg_temp._p9_qfr_record(8, 'reader falha fechado em opportunity cross-store', case when not r.operation_succeeded and r.returned_sqlstate = '23514' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfr_record(8, 'reader falha fechado em opportunity cross-store', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 9 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
  v_unknown uuid := gen_random_uuid();
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from pg_temp._p9_qfr_exec_json_sql(
    'service_role', null,
    format($sql$select * from public.read_commercial_opportunity_qualification_facts_by_system(%L::uuid,%L::uuid,%L::uuid)$sql$, ctx.org_a, ctx.store_a, v_unknown)
  );
  perform pg_temp._p9_qfr_record(9, 'reader nao inventa opportunity inexistente', case when not r.operation_succeeded and r.returned_sqlstate = '23503' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfr_record(9, 'reader nao inventa opportunity inexistente', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 10 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_empty);
  v_ok := jsonb_array_length(r.known_facts) = 0
    and jsonb_array_length(r.conflicts) = 0
    and jsonb_array_length(r.missing_fact_groups) = 5
    and r.known_fact_count = 0
    and r.missing_group_count = 5
    and r.conflict_count = 0
    and r.can_ask_next_question;
  perform pg_temp._p9_qfr_record(10, 'opportunity sem fatos retorna cinco gaps centrais sem inventar fatos', case when v_ok then 'PASS' else 'SUT_FAIL' end, to_jsonb(r)::text);
exception when others then
  perform pg_temp._p9_qfr_record(10, 'opportunity sem fatos retorna cinco gaps centrais sem inventar fatos', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 11 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_full);
  v_ok := r.known_fact_count = 6
    and jsonb_array_length(r.known_facts) = 6
    and r.known_facts -> 0 ->> 'factKey' = 'need_summary'
    and r.known_facts -> 1 ->> 'factKey' = 'space_text'
    and r.known_facts -> 2 ->> 'factKey' = 'location_text'
    and r.known_facts -> 3 ->> 'factKey' = 'budget_text'
    and r.known_facts -> 4 ->> 'factKey' = 'installation_interest'
    and r.known_facts -> 5 ->> 'factKey' = 'payment_interest';
  perform pg_temp._p9_qfr_record(11, 'knownFacts retorna fatos da opportunity em ordem canonica estavel', case when v_ok then 'PASS' else 'SUT_FAIL' end, to_jsonb(r)::text);
exception when others then
  perform pg_temp._p9_qfr_record(11, 'knownFacts retorna fatos da opportunity em ordem canonica estavel', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 12 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_full);
  v_ok := r.missing_group_count = 0
    and jsonb_array_length(r.missing_fact_groups) = 0
    and r.conflict_count = 0
    and not r.can_ask_next_question;
  perform pg_temp._p9_qfr_record(12, 'cinco grupos centrais satisfeitos eliminam perguntas obrigatorias do reader', case when v_ok then 'PASS' else 'SUT_FAIL' end, to_jsonb(r)::text);
exception when others then
  perform pg_temp._p9_qfr_record(12, 'cinco grupos centrais satisfeitos eliminam perguntas obrigatorias do reader', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 13 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
  fact jsonb;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_full);
  select value into fact
  from jsonb_array_elements(r.known_facts)
  where value ->> 'factKey' = 'space_text';
  v_ok := fact ->> 'state' = 'inferred'
    and fact ->> 'valueKind' = 'text'
    and fact ->> 'normalizedValueText' = 'quintal 5 x 4'
    and fact ->> 'sourceType' = 'system_inference';
  perform pg_temp._p9_qfr_record(13, 'reader preserva fato inferred sem promove-lo para confirmed', case when v_ok then 'PASS' else 'SUT_FAIL' end, coalesce(fact::text, '<missing>'));
exception when others then
  perform pg_temp._p9_qfr_record(13, 'reader preserva fato inferred sem promove-lo para confirmed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 14 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
  v_budget_known boolean;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_full);
  select exists (
    select 1 from jsonb_array_elements(r.known_facts) item
    where item ->> 'factKey' = 'budget_text'
  ) into v_budget_known;
  v_ok := v_budget_known and r.missing_group_count = 0;
  perform pg_temp._p9_qfr_record(14, 'fato opcional aparece em knownFacts sem virar gap obrigatorio', case when v_ok then 'PASS' else 'SUT_FAIL' end, to_jsonb(r)::text);
exception when others then
  perform pg_temp._p9_qfr_record(14, 'fato opcional aparece em knownFacts sem virar gap obrigatorio', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 15 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_full);
  v_ok := (r.provenance_summary ->> 'knownFactCount')::integer = 6
    and (r.provenance_summary ->> 'confirmedCount')::integer = 5
    and (r.provenance_summary ->> 'inferredCount')::integer = 1
    and (r.provenance_summary ->> 'conflictCount')::integer = 0
    and (r.provenance_summary ->> 'messageBackedCount')::integer = 0
    and (r.provenance_summary -> 'sourceCounts' ->> 'system_correction')::integer = 5
    and (r.provenance_summary -> 'sourceCounts' ->> 'system_inference')::integer = 1;
  perform pg_temp._p9_qfr_record(15, 'provenanceSummary agrega estado e fonte sem perder proveniencia nos fatos', case when v_ok then 'PASS' else 'SUT_FAIL' end, r.provenance_summary::text);
exception when others then
  perform pg_temp._p9_qfr_record(15, 'provenanceSummary agrega estado e fonte sem perder proveniencia nos fatos', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 16 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
  v_location_known boolean;
  v_location_conflict boolean;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_conflict);
  select exists (
    select 1 from jsonb_array_elements(r.known_facts) item
    where item ->> 'factKey' = 'location_text'
  ) into v_location_known;
  select exists (
    select 1 from jsonb_array_elements(r.conflicts) item
    where item ->> 'factKey' = 'location_text'
      and jsonb_array_length(item -> 'candidates') = 2
  ) into v_location_conflict;
  v_ok := not v_location_known and v_location_conflict and r.conflict_count = 1;
  perform pg_temp._p9_qfr_record(16, 'fato em conflito sai de knownFacts e aparece em conflicts', case when v_ok then 'PASS' else 'SUT_FAIL' end, to_jsonb(r)::text);
exception when others then
  perform pg_temp._p9_qfr_record(16, 'fato em conflito sai de knownFacts e aparece em conflicts', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 17 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_conflict);
  v_ok := exists (
    select 1
    from jsonb_array_elements(r.missing_fact_groups) item
    where item ->> 'groupKey' = 'location'
      and item ->> 'status' = 'conflict'
  );
  perform pg_temp._p9_qfr_record(17, 'grupo com fato conflitante e gap de resolucao e nao fato conhecido', case when v_ok then 'PASS' else 'SUT_FAIL' end, r.missing_fact_groups::text);
exception when others then
  perform pg_temp._p9_qfr_record(17, 'grupo com fato conflitante e gap de resolucao e nao fato conhecido', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 18 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_conflict);
  v_ok := r.can_ask_next_question and r.conflict_count = 1 and r.missing_group_count = 4;
  perform pg_temp._p9_qfr_record(18, 'conflito ou gap mantem canAskNextQuestion verdadeiro', case when v_ok then 'PASS' else 'SUT_FAIL' end, to_jsonb(r)::text);
exception when others then
  perform pg_temp._p9_qfr_record(18, 'conflito ou gap mantem canAskNextQuestion verdadeiro', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 19 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r_user record;
  r_system record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r_user from pg_temp._p9_qfr_exec_json_sql(
    'authenticated', ctx.user_a,
    format($sql$select * from public.read_commercial_opportunity_qualification_facts_by_user(%L::uuid,%L::uuid,%L::uuid)$sql$, ctx.org_a, ctx.store_a, ctx.opp_full)
  );
  select * into r_system from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_full);
  v_ok := r_user.operation_succeeded
    and (r_user.value_json -> 'known_facts') = r_system.known_facts
    and (r_user.value_json -> 'missing_fact_groups') = r_system.missing_fact_groups
    and (r_user.value_json -> 'conflicts') = r_system.conflicts;
  perform pg_temp._p9_qfr_record(19, 'reader humano ativo ve o mesmo snapshot canonico do reader de sistema', case when v_ok then 'PASS' else 'SUT_FAIL' end, coalesce(r_user.value_json::text, r_user.returned_sqlstate || ' ' || r_user.message_text));
exception when others then
  perform pg_temp._p9_qfr_record(19, 'reader humano ativo ve o mesmo snapshot canonico do reader de sistema', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 20 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_peer);
  v_ok := r.known_fact_count = 1
    and r.known_facts -> 0 ->> 'factKey' = 'payment_interest'
    and r.known_facts -> 0 -> 'value' = 'false'::jsonb
    and not exists (
      select 1 from jsonb_array_elements(r.known_facts) item
      where item ->> 'factKey' = 'need_summary'
    );
  perform pg_temp._p9_qfr_record(20, 'mesmo customer e store nao mistura fatos entre opportunities', case when v_ok then 'PASS' else 'SUT_FAIL' end, to_jsonb(r)::text);
exception when others then
  perform pg_temp._p9_qfr_record(20, 'mesmo customer e store nao mistura fatos entre opportunities', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 21 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r from pg_temp._p9_qfr_exec_json_sql(
    'authenticated', ctx.user_b,
    format($sql$select * from public.read_commercial_opportunity_qualification_facts_by_user(%L::uuid,%L::uuid,%L::uuid)$sql$, ctx.org_a, ctx.store_a, ctx.opp_full)
  );
  perform pg_temp._p9_qfr_record(21, 'membership de outro tenant nao autoriza leitura', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_qfr_record(21, 'membership de outro tenant nao autoriza leitura', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 22 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  r1 record;
  r2 record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into r1 from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_full);
  select * into r2 from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_full);
  v_ok := to_jsonb(r1) = to_jsonb(r2);
  perform pg_temp._p9_qfr_record(22, 'reader repetido e deterministico e nao altera snapshot', case when v_ok then 'PASS' else 'SUT_FAIL' end, jsonb_build_object('first', to_jsonb(r1), 'second', to_jsonb(r2))::text);
exception when others then
  perform pg_temp._p9_qfr_record(22, 'reader repetido e deterministico e nao altera snapshot', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 23 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  full_row record;
  peer_row record;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select * into full_row from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_full);
  select * into peer_row from public.read_commercial_opportunity_qualification_facts_by_system(ctx.org_a, ctx.store_a, ctx.opp_peer);
  v_ok := full_row.commercial_opportunity_id = ctx.opp_full
    and peer_row.commercial_opportunity_id = ctx.opp_peer
    and full_row.known_facts <> peer_row.known_facts;
  perform pg_temp._p9_qfr_record(23, 'reader ancora resultado na opportunity explicita sem latest ou first', case when v_ok then 'PASS' else 'SUT_FAIL' end, jsonb_build_object('full', to_jsonb(full_row), 'peer', to_jsonb(peer_row))::text);
exception when others then
  perform pg_temp._p9_qfr_record(23, 'reader ancora resultado na opportunity explicita sem latest ou first', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 24 -----------------------------------------------------------------------
do $scenario$
declare
  v_ok boolean;
begin
  v_ok :=
    not pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_fact_events', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_fact_events', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_fact_events', 'DELETE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_facts_current', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_facts_current', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_facts_current', 'DELETE')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_fact_events', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_fact_events', 'UPDATE')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_fact_events', 'DELETE')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_facts_current', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_facts_current', 'UPDATE')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_facts_current', 'DELETE');
  perform pg_temp._p9_qfr_record(24, 'reader nao reabre escrita direta nas tabelas', case when v_ok then 'PASS' else 'SUT_FAIL' end, format('direct_write_closed=%s', v_ok));
exception when others then
  perform pg_temp._p9_qfr_record(24, 'reader nao reabre escrita direta nas tabelas', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 25 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_qfr_ctx%rowtype;
  v_orgs integer;
  v_stores integer;
  v_opps integer;
  v_events integer;
  v_current integer;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_qfr_ctx;
  select count(*) into v_orgs from public.organizations where id in (ctx.org_a, ctx.org_b);
  select count(*) into v_stores from public.stores where id in (ctx.store_a, ctx.store_b_same_org, ctx.store_c_other_org);
  select count(*) into v_opps from public.commercial_opportunities where id in (ctx.opp_full, ctx.opp_empty, ctx.opp_conflict, ctx.opp_peer, ctx.opp_other_org);
  select count(*) into v_events from public.commercial_opportunity_qualification_fact_events where organization_id in (ctx.org_a, ctx.org_b);
  select count(*) into v_current from public.commercial_opportunity_qualification_facts_current where organization_id in (ctx.org_a, ctx.org_b);
  v_ok := v_orgs = 2 and v_stores = 3 and v_opps = 5 and v_events = 10 and v_current = 9;
  perform pg_temp._p9_qfr_record(25, 'runner mantem fixtures na transacao e termina com rollback', case when v_ok then 'PASS' else 'SUT_FAIL' end, format('orgs=%s stores=%s opps=%s events=%s current=%s final_statement=ROLLBACK', v_orgs, v_stores, v_opps, v_events, v_current));
exception when others then
  perform pg_temp._p9_qfr_record(25, 'runner mantem fixtures na transacao e termina com rollback', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

select
  scenario_number,
  scenario_name,
  status,
  detail
from pg_temp._p9_qfr_results
order by scenario_number;

rollback;
