begin;

set transaction isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_qpm_guard_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_qpm_guard_ctx (
  singleton boolean primary key default true check (singleton),
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b uuid not null,
  user_a uuid not null,
  customer_a uuid not null,
  customer_b uuid not null,
  opp_main uuid not null,
  opp_human uuid not null,
  opp_foreign_source uuid not null,
  opp_foreign_creator uuid not null,
  opp_corrupt uuid not null,
  opp_other_org uuid not null
) on commit preserve rows;

insert into pg_temp._p9_qpm_guard_ctx (
  org_a, org_b, store_a, store_b, user_a, customer_a, customer_b,
  opp_main, opp_human, opp_foreign_source, opp_foreign_creator,
  opp_corrupt, opp_other_org
)
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid()
);

create or replace function pg_temp._p9_qpm_guard_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_qpm_guard_results(
    scenario_number, scenario_name, status, detail
  ) values (
    p_scenario_number, p_scenario_name, p_status, coalesce(p_detail, '<null>')
  )
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      detail = excluded.detail;
end;
$function$;

create or replace function pg_temp._p9_qpm_guard_exec_json_sql(
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
    return query select false, null::jsonb, null::text,
      'runner helper must start as postgres'::text, null::text;
    return;
  end if;

  if p_role not in ('postgres', 'service_role', 'authenticated', 'anon') then
    return query select false, null::jsonb, 'P0001'::text,
      'unsupported role'::text, null::text;
    return;
  end if;

  if p_role <> 'postgres' then
    perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
    perform set_config('request.jwt.claim.role', p_role, true);
    perform set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object(
        'sub', coalesce(p_user_id::text, ''),
        'role', p_role
      )::text,
      true
    );
    execute pg_catalog.format('set local role %I', p_role);
  end if;

  begin
    execute pg_catalog.format(
      'select to_jsonb(result_row) from (%s) result_row',
      p_sql
    ) into v_value;

    if p_role <> 'postgres' then
      execute 'reset role';
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '', true);
    end if;

    return query select true, v_value, null::text, null::text, null::text;
  exception when others then
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

    return query select false, null::jsonb, v_state, v_message, v_constraint;
  end;
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  return query select false, null::jsonb, sqlstate::text,
    ('runner helper error: ' || sqlerrm)::text, null::text;
end;
$function$;

-- Fixtures. Everything below is rolled back.
do $fixtures$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;

  insert into public.organizations (id, name, subscription_status)
  values
    (ctx.org_a, 'P9 QPM Guard Org A', 'active'),
    (ctx.org_b, 'P9 QPM Guard Org B', 'active');

  insert into public.stores (id, organization_id, name)
  values
    (ctx.store_a, ctx.org_a, 'P9 QPM Guard Store A'),
    (ctx.store_b, ctx.org_b, 'P9 QPM Guard Store B');

  insert into auth.users (id)
  values (ctx.user_a);

  insert into public.memberships (organization_id, user_id, role, is_active)
  values (ctx.org_a, ctx.user_a, 'owner'::public.app_role, true);

  insert into public.customers (id, organization_id, display_name)
  values
    (ctx.customer_a, ctx.org_a, 'P9 QPM Guard Customer A'),
    (ctx.customer_b, ctx.org_b, 'P9 QPM Guard Customer B');

  insert into public.commercial_opportunities (
    id, organization_id, store_id, customer_id, stage
  ) values
    (ctx.opp_main, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_human, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_foreign_source, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_foreign_creator, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_corrupt, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_other_org, ctx.org_b, ctx.store_b, ctx.customer_b, 'qualificacao');
end;
$fixtures$;

-- #1 exact function signature exists.
do $scenario$
declare
  ok boolean;
begin
  ok := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_profile_from_qualification_by_system(uuid,uuid,uuid,text,text)'
  ) is not null;
  perform pg_temp._p9_qpm_guard_record(
    1, 'qualification profile materializer signature exists',
    case when ok then 'PASS' else 'SUT_FAIL' end, ok::text
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(1, 'qualification profile materializer signature exists', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #2 grants are service-role-only.
do $scenario$
declare
  v_function oid;
  ok boolean;
begin
  v_function := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_profile_from_qualification_by_system(uuid,uuid,uuid,text,text)'
  );
  ok := not pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE');
  perform pg_temp._p9_qpm_guard_record(
    2, 'materializer grants are service-role-only',
    case when ok then 'PASS' else 'SUT_FAIL' end, ok::text
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(2, 'materializer grants are service-role-only', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #3 absent installation evidence creates conservative v1.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'event-absent-1','absent'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_main);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);

  if r.operation_succeeded
     and (r.value_json ->> 'version_number')::integer = 1
     and (r.value_json ->> 'component_count')::integer = 0
     and (r.value_json ->> 'execution_intent_count')::integer = 0
     and r.value_json ->> 'profile_state' = 'needs_clarification'
     and (r.value_json ->> 'changed')::boolean
     and not (r.value_json ->> 'preserved')::boolean
     and r.value_json ->> 'outcome' = 'profile_version_created'
     and r.value_json ->> 'request_fingerprint' = '219f52b4ee0651477b4ec2a677683227e745aaf0cbdf01cfae55581cc9519252' then
    perform pg_temp._p9_qpm_guard_record(3, 'absent evidence creates conservative v1', 'PASS', r.value_json::text);
  else
    perform pg_temp._p9_qpm_guard_record(3, 'absent evidence creates conservative v1', 'SUT_FAIL', coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
  end if;
exception when others then
  perform pg_temp._p9_qpm_guard_record(3, 'absent evidence creates conservative v1', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #4 v1 persists owned authority and no invented component/intent.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  v_current uuid;
  ok boolean;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  select current_profile_version_id into v_current
  from public.commercial_opportunity_profile_current
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_main;

  select exists (
    select 1
    from public.commercial_opportunity_profile_versions version_row
    where version_row.id = v_current
      and version_row.actor_type = 'system'
      and version_row.actor_user_id is null
      and version_row.source_type = 'qualification_materializer'
      and version_row.reason_code = 'profile_materialized_from_qualification'
      and version_row.created_by = 'sales_ai_profile_materializer_v1'
      and version_row.metadata = pg_catalog.jsonb_build_object(
        'authority', 'canonical_qualification_facts',
        'materializer_version', 1,
        'structural_component_resolution', 'unavailable_in_runtime_v1'
      )
  )
  and not exists (
    select 1 from public.commercial_opportunity_profile_components where profile_version_id = v_current
  )
  and not exists (
    select 1 from public.commercial_opportunity_profile_execution_intents where profile_version_id = v_current
  )
  into ok;

  perform pg_temp._p9_qpm_guard_record(
    4, 'v1 authority and empty structural shape are canonical',
    case when ok then 'PASS' else 'SUT_FAIL' end, ok::text
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(4, 'v1 authority and empty structural shape are canonical', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #5 known installation interest creates unresolved installation, never included.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
  v_current uuid;
  ok boolean;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'event-known-1','known'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_main);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);

  select current_profile_version_id into v_current
  from public.commercial_opportunity_profile_current
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_main;

  select r.operation_succeeded
    and (r.value_json ->> 'version_number')::integer = 2
    and (r.value_json ->> 'execution_intent_count')::integer = 1
    and r.value_json ->> 'profile_state' = 'needs_clarification'
    and exists (
      select 1
      from public.commercial_opportunity_profile_execution_intents intent_row
      where intent_row.profile_version_id = v_current
        and intent_row.execution_kind = 'installation'
        and intent_row.intent_state = 'unresolved'
        and intent_row.reason_code = 'qualification_installation_interest_is_evidence_only'
    )
    and not exists (
      select 1
      from public.commercial_opportunity_profile_execution_intents intent_row
      where intent_row.profile_version_id = v_current
        and intent_row.intent_state in ('included', 'excluded')
    )
  into ok;

  perform pg_temp._p9_qpm_guard_record(
    5, 'known installation interest remains unresolved evidence',
    case when ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text)
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(5, 'known installation interest remains unresolved evidence', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #6 same semantic output with a new event key is a no-op.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
  v_before integer;
  v_after integer;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  select count(*)::integer into v_before
  from public.commercial_opportunity_profile_versions
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_main;

  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'event-known-2','known'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_main);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);

  select count(*)::integer into v_after
  from public.commercial_opportunity_profile_versions
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_main;

  perform pg_temp._p9_qpm_guard_record(
    6, 'same semantic output does not create another profile version',
    case when r.operation_succeeded
      and v_before = v_after
      and not (r.value_json ->> 'changed')::boolean
      and not (r.value_json ->> 'replayed')::boolean
      and not (r.value_json ->> 'preserved')::boolean
      and r.value_json ->> 'outcome' = 'qualification_profile_unchanged'
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text)
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(6, 'same semantic output does not create another profile version', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #7 installation conflict creates conflict v3.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
  v_current uuid;
  ok boolean;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'event-conflict-1','conflict'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_main);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);

  select current_profile_version_id into v_current
  from public.commercial_opportunity_profile_current
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_main;

  select r.operation_succeeded
    and (r.value_json ->> 'version_number')::integer = 3
    and r.value_json ->> 'profile_state' = 'conflict'
    and exists (
      select 1
      from public.commercial_opportunity_profile_execution_intents intent_row
      where intent_row.profile_version_id = v_current
        and intent_row.execution_kind = 'installation'
        and intent_row.intent_state = 'conflict'
        and intent_row.reason_code = 'qualification_installation_interest_conflict'
    )
  into ok;

  perform pg_temp._p9_qpm_guard_record(
    7, 'installation evidence conflict creates conflict profile',
    case when ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text)
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(7, 'installation evidence conflict creates conflict profile', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #8 stale replay of the old known event never regresses current conflict.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
  v_before uuid;
  v_after uuid;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  select current_profile_version_id into v_before
  from public.commercial_opportunity_profile_current
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_main;

  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'event-known-1','known'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_main);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);

  select current_profile_version_id into v_after
  from public.commercial_opportunity_profile_current
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_main;

  perform pg_temp._p9_qpm_guard_record(
    8, 'stale event replay does not regress current',
    case when r.operation_succeeded
      and v_before = v_after
      and (r.value_json ->> 'replayed')::boolean
      and not (r.value_json ->> 'changed')::boolean
      and r.value_json ->> 'outcome' = 'idempotent_replay_stale'
      and r.value_json ->> 'profile_state' = 'conflict'
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text)
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(8, 'stale event replay does not regress current', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #9 known evidence can legitimately recur after conflict with a new event.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'event-known-3','known'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_main);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);

  perform pg_temp._p9_qpm_guard_record(
    9, 'known evidence can recur after conflict with new event',
    case when r.operation_succeeded
      and (r.value_json ->> 'version_number')::integer = 4
      and (r.value_json ->> 'changed')::boolean
      and r.value_json ->> 'profile_state' = 'needs_clarification'
      and r.value_json ->> 'outcome' = 'profile_version_created'
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text)
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(9, 'known evidence can recur after conflict with new event', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #10 qualification materializer never creates sale components.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  ok boolean;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  select not exists (
    select 1
    from public.commercial_opportunity_profile_components component_row
    where component_row.organization_id = ctx.org_a
      and component_row.store_id = ctx.store_a
      and component_row.commercial_opportunity_id = ctx.opp_main
  ) into ok;

  perform pg_temp._p9_qpm_guard_record(
    10, 'qualification materializer never invents sale components',
    case when ok then 'PASS' else 'SUT_FAIL' end, ok::text
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(10, 'qualification materializer never invents sale components', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #11 authenticated cannot invoke the system materializer.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'auth-denied','known'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_main);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('authenticated', ctx.user_a, q);

  perform pg_temp._p9_qpm_guard_record(
    11, 'authenticated cannot invoke system materializer',
    case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<success>')
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(11, 'authenticated cannot invoke system materializer', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #12 anon cannot invoke the system materializer.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'anon-denied','known'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_main);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('anon', null, q);

  perform pg_temp._p9_qpm_guard_record(
    12, 'anon cannot invoke system materializer',
    case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<success>')
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(12, 'anon cannot invoke system materializer', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #13 wrong organization/store/opportunity scope fails closed.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'wrong-scope','known'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_other_org);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);

  perform pg_temp._p9_qpm_guard_record(
    13, 'wrong opportunity scope fails closed',
    case when not r.operation_succeeded
      and r.returned_sqlstate = '23503'
      and pg_catalog.strpos(coalesce(r.message_text, ''), 'OPPORTUNITY_SCOPE_INVALID') > 0
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<success>')
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(13, 'wrong opportunity scope fails closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #14 unknown installation evidence state is rejected.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'bad-state','included'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_main);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);

  perform pg_temp._p9_qpm_guard_record(
    14, 'unknown evidence state rejected',
    case when not r.operation_succeeded
      and r.returned_sqlstate = '22023'
      and pg_catalog.strpos(coalesce(r.message_text, ''), 'INSTALLATION_EVIDENCE_STATE_INVALID') > 0
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<success>')
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(14, 'unknown evidence state rejected', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #15 empty event key is rejected.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'   ','known'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_main);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);

  perform pg_temp._p9_qpm_guard_record(
    15, 'empty materialization event key rejected',
    case when not r.operation_succeeded
      and r.returned_sqlstate = '22023'
      and pg_catalog.strpos(coalesce(r.message_text, ''), 'EVENT_KEY_INVALID') > 0
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<success>')
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(15, 'empty materialization event key rejected', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #16 human current profile is preserved atomically.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
  v_before uuid;
  v_after uuid;
  v_history_before integer;
  v_history_after integer;
  v_components jsonb;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;

  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'human-base','absent'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_human);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);
  if not r.operation_succeeded then
    raise exception 'human-base fixture failed: % %', r.returned_sqlstate, r.message_text;
  end if;

  v_components := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'component_key', 'human_custom',
      'component_kind', 'custom',
      'component_state', 'resolved',
      'reference_text', 'Human confirmed commercial component'
    )
  );

  q := pg_catalog.format($sql$
    select * from public.write_commercial_opportunity_profile_by_user(
      %L::uuid,%L::uuid,%L::uuid,'human-authority-v2',%L,'resolved',%L::jsonb,'[]'::jsonb,
      'human_profile_authority','{}'::jsonb
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_human, repeat('a', 64), v_components::text);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('authenticated', ctx.user_a, q);
  if not r.operation_succeeded then
    raise exception 'human-authority fixture failed: % %', r.returned_sqlstate, r.message_text;
  end if;

  select current_profile_version_id into v_before
  from public.commercial_opportunity_profile_current
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_human;
  select count(*)::integer into v_history_before
  from public.commercial_opportunity_profile_versions
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_human;

  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'after-human','conflict'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_human);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);

  select current_profile_version_id into v_after
  from public.commercial_opportunity_profile_current
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_human;
  select count(*)::integer into v_history_after
  from public.commercial_opportunity_profile_versions
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_human;

  perform pg_temp._p9_qpm_guard_record(
    16, 'human current authority is preserved',
    case when r.operation_succeeded
      and v_before = v_after
      and v_history_before = v_history_after
      and (r.value_json ->> 'preserved')::boolean
      and not (r.value_json ->> 'changed')::boolean
      and r.value_json ->> 'outcome' = 'preserved_human_authority'
      and r.value_json ->> 'actor_type' = 'human'
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text)
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(16, 'human current authority is preserved', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #17 non-qualification system source is preserved.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
  v_before uuid;
  v_after uuid;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;

  q := pg_catalog.format($sql$
    select * from public.write_commercial_opportunity_profile_by_system(
      %L::uuid,%L::uuid,%L::uuid,'foreign-source-v1',%L,'needs_clarification','[]'::jsonb,'[]'::jsonb,
      'system_correction','system_profile_authority','sales_ai_other_materializer','{}'::jsonb
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_foreign_source, repeat('b', 64));
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);
  if not r.operation_succeeded then
    raise exception 'foreign-source fixture failed: % %', r.returned_sqlstate, r.message_text;
  end if;

  select current_profile_version_id into v_before
  from public.commercial_opportunity_profile_current
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_foreign_source;

  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'after-foreign-source','known'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_foreign_source);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);

  select current_profile_version_id into v_after
  from public.commercial_opportunity_profile_current
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_foreign_source;

  perform pg_temp._p9_qpm_guard_record(
    17, 'non-qualification system source is preserved',
    case when r.operation_succeeded
      and v_before = v_after
      and (r.value_json ->> 'preserved')::boolean
      and r.value_json ->> 'outcome' = 'preserved_non_qualification_authority'
      and r.value_json ->> 'source_type' = 'system_correction'
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text)
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(17, 'non-qualification system source is preserved', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #18 same source_type but a different materializer owner is preserved.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
  v_before uuid;
  v_after uuid;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;

  q := pg_catalog.format($sql$
    select * from public.write_commercial_opportunity_profile_by_system(
      %L::uuid,%L::uuid,%L::uuid,'foreign-creator-v1',%L,'needs_clarification','[]'::jsonb,'[]'::jsonb,
      'qualification_materializer','older_or_other_materializer','sales_ai_profile_materializer_v0','{}'::jsonb
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_foreign_creator, repeat('c', 64));
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);
  if not r.operation_succeeded then
    raise exception 'foreign-creator fixture failed: % %', r.returned_sqlstate, r.message_text;
  end if;

  select current_profile_version_id into v_before
  from public.commercial_opportunity_profile_current
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_foreign_creator;

  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'after-foreign-creator','known'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_foreign_creator);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);

  select current_profile_version_id into v_after
  from public.commercial_opportunity_profile_current
  where organization_id = ctx.org_a and store_id = ctx.store_a and commercial_opportunity_id = ctx.opp_foreign_creator;

  perform pg_temp._p9_qpm_guard_record(
    18, 'different qualification materializer owner is preserved',
    case when r.operation_succeeded
      and v_before = v_after
      and (r.value_json ->> 'preserved')::boolean
      and r.value_json ->> 'outcome' = 'preserved_non_qualification_authority'
      and r.value_json ->> 'created_by' = 'sales_ai_profile_materializer_v0'
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text)
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(18, 'different qualification materializer owner is preserved', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #19 same semantic fingerprint with divergent owned payload fails closed.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  r record;
  q text;
  v_metadata jsonb := pg_catalog.jsonb_build_object(
    'authority', 'canonical_qualification_facts',
    'materializer_version', 1,
    'structural_component_resolution', 'unavailable_in_runtime_v1'
  );
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;

  q := pg_catalog.format($sql$
    select * from public.write_commercial_opportunity_profile_by_system(
      %L::uuid,%L::uuid,%L::uuid,'corrupt-known-v1',
      '2ca56a55473f94934f0a4a74981f59bcd665d83b0ef9565e87a4bfb8dc1ec779',
      'needs_clarification','[]'::jsonb,'[]'::jsonb,
      'qualification_materializer','profile_materialized_from_qualification',
      'sales_ai_profile_materializer_v1',%L::jsonb
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_corrupt, v_metadata::text);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);
  if not r.operation_succeeded then
    raise exception 'corrupt-owned fixture failed: % %', r.returned_sqlstate, r.message_text;
  end if;

  q := pg_catalog.format($sql$
    select * from public.materialize_commercial_opportunity_profile_from_qualification_by_system(
      %L::uuid,%L::uuid,%L::uuid,'detect-corrupt','known'
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_corrupt);
  select * into r from pg_temp._p9_qpm_guard_exec_json_sql('service_role', null, q);

  perform pg_temp._p9_qpm_guard_record(
    19, 'same fingerprint with divergent owned payload fails closed',
    case when not r.operation_succeeded
      and r.returned_sqlstate = 'P0001'
      and pg_catalog.strpos(coalesce(r.message_text, ''), 'FINGERPRINT_PAYLOAD_MISMATCH') > 0
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, '<success>')
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(19, 'same fingerprint with divergent owned payload fails closed', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #20 fixed fingerprint vocabulary is exact and lowercase SHA-256.
do $scenario$
declare
  ctx pg_temp._p9_qpm_guard_ctx%rowtype;
  ok boolean;
begin
  select * into ctx from pg_temp._p9_qpm_guard_ctx;
  select count(*) = 1
    and min(request_fingerprint) = '219f52b4ee0651477b4ec2a677683227e745aaf0cbdf01cfae55581cc9519252'
  into ok
  from public.commercial_opportunity_profile_versions
  where organization_id = ctx.org_a
    and store_id = ctx.store_a
    and commercial_opportunity_id = ctx.opp_human
    and source_type = 'qualification_materializer'
    and created_by = 'sales_ai_profile_materializer_v1';

  perform pg_temp._p9_qpm_guard_record(
    20, 'materializer fingerprint vocabulary is deterministic',
    case when ok then 'PASS' else 'SUT_FAIL' end, ok::text
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(20, 'materializer fingerprint vocabulary is deterministic', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #21 function definition has explicit precedence locking and no latest/max fallback.
do $scenario$
declare
  v_definition text;
  ok boolean;
begin
  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.materialize_commercial_opportunity_profile_from_qualification_by_system(uuid,uuid,uuid,text,text)'
    )
  ) into v_definition;

  ok := pg_catalog.strpos(v_definition, 'pg_advisory_xact_lock') > 0
    and pg_catalog.strpos(v_definition, 'for update') > 0
    and pg_catalog.strpos(v_definition, 'preserved_human_authority') > 0
    and pg_catalog.strpos(v_definition, 'preserved_non_qualification_authority') > 0
    and pg_catalog.strpos(v_definition, 'qualification_installation_interest_is_evidence_only') > 0
    and pg_catalog.strpos(v_definition, 'sales_ai_profile_materializer_v1') > 0
    and pg_catalog.strpos(v_definition, 'max(version_number)') = 0
    and pg_catalog.strpos(v_definition, 'order by created_at desc') = 0;

  perform pg_temp._p9_qpm_guard_record(
    21, 'definition preserves authority without latest max fallback',
    case when ok then 'PASS' else 'SUT_FAIL' end, ok::text
  );
exception when others then
  perform pg_temp._p9_qpm_guard_record(21, 'definition preserves authority without latest max fallback', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- Mandatory summary gate.
do $summary$
declare
  v_expected integer := 21;
  v_count integer;
  v_failures integer;
  v_detail text;
begin
  select count(*)::integer
  into v_count
  from pg_temp._p9_qpm_guard_results;

  select count(*)::integer
  into v_failures
  from pg_temp._p9_qpm_guard_results
  where status <> 'PASS';

  if v_count <> v_expected or exists (
    select 1
    from pg_catalog.generate_series(1, v_expected) scenario_number
    where not exists (
      select 1
      from pg_temp._p9_qpm_guard_results result_row
      where result_row.scenario_number = scenario_number
    )
  ) then
    select pg_catalog.string_agg(
      pg_catalog.format('#%s %s [%s] %s', scenario_number, scenario_name, status, detail),
      E'\n' order by scenario_number
    ) into v_detail
    from pg_temp._p9_qpm_guard_results;

    raise exception using
      errcode = 'P0001',
      message = 'P9_QUALIFICATION_PROFILE_MATERIALIZER_GUARD_RUNNER_INCOMPLETE',
      detail = coalesce(v_detail, '<no scenario rows>');
  end if;

  if v_failures > 0 then
    select pg_catalog.string_agg(
      pg_catalog.format('#%s %s [%s] %s', scenario_number, scenario_name, status, detail),
      E'\n' order by scenario_number
    ) into v_detail
    from pg_temp._p9_qpm_guard_results
    where status <> 'PASS';

    raise exception using
      errcode = 'P0001',
      message = 'P9_QUALIFICATION_PROFILE_MATERIALIZER_GUARD_RUNNER_FAILED',
      detail = coalesce(v_detail, '<failure detail unavailable>');
  end if;
end;
$summary$;

rollback;
