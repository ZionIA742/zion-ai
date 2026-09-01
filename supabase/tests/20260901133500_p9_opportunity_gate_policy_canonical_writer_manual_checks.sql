begin;

set transaction isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_gp_writer_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_gp_writer_ctx (
  singleton boolean primary key default true check (singleton),
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b_same_org uuid not null,
  store_c_other_org uuid not null,
  user_a uuid not null,
  user_b uuid not null,
  user_inactive_a uuid not null
) on commit preserve rows;

insert into pg_temp._p9_gp_writer_ctx (
  org_a,
  org_b,
  store_a,
  store_b_same_org,
  store_c_other_org,
  user_a,
  user_b,
  user_inactive_a
)
values (
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

create or replace function pg_temp._p9_gp_writer_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_gp_writer_results(
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

create or replace function pg_temp._p9_gp_writer_exec_json_sql(
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
      pg_catalog.jsonb_build_object(
        'sub', coalesce(p_user_id::text, ''),
        'role', p_role
      )::text,
      true
    );
    execute pg_catalog.format('set local role %I', p_role);
  end if;

  begin
    execute pg_catalog.format('select to_jsonb(result_row) from (%s) result_row', p_sql)
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

-- Executes statements that cannot legally be wrapped as a SELECT subquery
-- (for example direct INSERT/UPDATE/DELETE privilege checks).
create or replace function pg_temp._p9_gp_writer_exec_statement_sql(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  returned_sqlstate text,
  message_text text,
  constraint_name text
)
language plpgsql
as $function$
declare
  v_state text;
  v_message text;
  v_constraint text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query
    select false, null::text,
      'runner statement helper must start as postgres'::text, null::text;
    return;
  end if;

  if p_role not in ('postgres', 'service_role', 'authenticated', 'anon') then
    return query
    select false, 'P0001'::text,
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
    execute p_sql;

    if p_role <> 'postgres' then
      execute 'reset role';
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '', true);
    end if;

    return query
    select true, null::text, null::text, null::text;
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
      select false, v_state, v_message, v_constraint;
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
    select false, sqlstate::text,
      ('runner statement helper error: ' || sqlerrm)::text, null::text;
end;
$function$;

create or replace function pg_temp._p9_gp_writer_rules_v1()
returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'rule_key', ' default_quote_required ',
      'rule_priority', 10,
      'item_kind', ' COMMERCIAL_GATE ',
      'item_key', ' QUOTE ',
      'match_mode', ' ALWAYS ',
      'applicability_state', ' REQUIRED ',
      'reason_code', ' DEFAULT_COMMERCIAL_DOCUMENT '
    ),
    pg_catalog.jsonb_build_object(
      'rule_key', 'pool_measurements_required',
      'rule_priority', 20,
      'item_kind', 'technical_requirement',
      'item_key', 'measurements_confirmation',
      'match_mode', 'component',
      'component_kind', 'pool',
      'applicability_state', 'required',
      'reason_code', 'pool_requires_measurements',
      'metadata', pg_catalog.jsonb_build_object('source', 'runner')
    ),
    pg_catalog.jsonb_build_object(
      'rule_key', 'installation_fulfillment_required',
      'rule_priority', 30,
      'item_kind', 'commercial_gate',
      'item_key', 'fulfillment',
      'match_mode', 'execution',
      'execution_kind', 'installation',
      'applicability_state', 'required',
      'reason_code', 'installation_included'
    ),
    pg_catalog.jsonb_build_object(
      'rule_key', 'pool_installation_visit_optional',
      'rule_priority', 40,
      'item_kind', 'commercial_gate',
      'item_key', 'technical_visit',
      'match_mode', 'component_and_execution',
      'component_kind', 'pool',
      'execution_kind', 'installation',
      'applicability_state', 'optional',
      'reason_code', 'pool_installation_visit_optional'
    )
  );
$function$;

create or replace function pg_temp._p9_gp_writer_rules_v2()
returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'rule_key', 'default_quote_required',
      'rule_priority', 10,
      'item_kind', 'commercial_gate',
      'item_key', 'quote',
      'match_mode', 'always',
      'applicability_state', 'required',
      'reason_code', 'default_commercial_document'
    ),
    pg_catalog.jsonb_build_object(
      'rule_key', 'pool_measurements_required',
      'rule_priority', 20,
      'item_kind', 'technical_requirement',
      'item_key', 'measurements_confirmation',
      'match_mode', 'component',
      'component_kind', 'pool',
      'applicability_state', 'required',
      'reason_code', 'pool_requires_measurements'
    ),
    pg_catalog.jsonb_build_object(
      'rule_key', 'installation_fulfillment_required',
      'rule_priority', 30,
      'item_kind', 'commercial_gate',
      'item_key', 'fulfillment',
      'match_mode', 'execution',
      'execution_kind', 'installation',
      'applicability_state', 'required',
      'reason_code', 'installation_included'
    ),
    pg_catalog.jsonb_build_object(
      'rule_key', 'pool_installation_visit_required',
      'rule_priority', 50,
      'item_kind', 'commercial_gate',
      'item_key', 'technical_visit',
      'match_mode', 'component_and_execution',
      'component_kind', 'pool',
      'execution_kind', 'installation',
      'applicability_state', 'required',
      'reason_code', 'pool_installation_visit_required'
    )
  );
$function$;

-- ============================================================================
-- Fixtures. Everything is rolled back.
-- ============================================================================

do $fixtures$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;

  insert into public.organizations (id, name, subscription_status)
  values
    (ctx.org_a, 'P9 Gate Policy Writer Runner Org A', 'active'),
    (ctx.org_b, 'P9 Gate Policy Writer Runner Org B', 'active');

  insert into public.stores (id, organization_id, name)
  values
    (ctx.store_a, ctx.org_a, 'P9 Gate Policy Writer Store A'),
    (ctx.store_b_same_org, ctx.org_a, 'P9 Gate Policy Writer Store B'),
    (ctx.store_c_other_org, ctx.org_b, 'P9 Gate Policy Writer Store C');

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
end;
$fixtures$;

-- 1 ------------------------------------------------------------------------
do $scenario$
declare
  v_internal oid;
  v_user oid;
  v_internal_def text;
  v_ok boolean;
begin
  v_internal := pg_catalog.to_regprocedure(
    'public.write_store_opportunity_gate_policy_internal(uuid,uuid,text,text,jsonb,text,uuid,text,text,text,jsonb)'
  );
  v_user := pg_catalog.to_regprocedure(
    'public.write_store_opportunity_gate_policy_by_user(uuid,uuid,text,text,jsonb,text,jsonb)'
  );

  if v_internal is not null then
    select pg_catalog.pg_get_functiondef(v_internal) into v_internal_def;
  end if;

  v_ok :=
    v_internal is not null
    and v_user is not null
    and pg_catalog.to_regprocedure('public.write_store_opportunity_gate_policy_by_system(uuid,uuid,text,text,jsonb,text,jsonb)') is null
    and not pg_catalog.has_function_privilege('authenticated', 'public.write_store_opportunity_gate_policy_internal(uuid,uuid,text,text,jsonb,text,uuid,text,text,text,jsonb)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.write_store_opportunity_gate_policy_internal(uuid,uuid,text,text,jsonb,text,uuid,text,text,text,jsonb)', 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', 'public.write_store_opportunity_gate_policy_by_user(uuid,uuid,text,text,jsonb,text,jsonb)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.write_store_opportunity_gate_policy_by_user(uuid,uuid,text,text,jsonb,text,jsonb)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.write_store_opportunity_gate_policy_by_user(uuid,uuid,text,text,jsonb,text,jsonb)', 'EXECUTE')
    and v_internal_def like '%pg_advisory_xact_lock%'
    and v_internal_def like '%for update%'
    and v_internal_def not like '%max(version_number)%'
    and v_internal_def not like '%order by created_at desc%';

  perform pg_temp._p9_gp_writer_record(
    1,
    'writer contract/grants/current authority/concurrency are hardened',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.format('ok=%s', v_ok)
  );
exception when others then
  perform pg_temp._p9_gp_writer_record(1, 'writer structural contract', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 2 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  r record;
  v_rules jsonb;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  v_rules := pg_temp._p9_gp_writer_rules_v1();
  select * into r from pg_temp._p9_gp_writer_exec_json_sql(
    'authenticated',
    ctx.user_a,
    pg_catalog.format(
      $sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'policy-create-v1',%L,%L::jsonb,'initial_policy','{}'::jsonb)$sql$,
      ctx.org_a,
      ctx.store_a,
      repeat('1', 64),
      v_rules::text
    )
  );

  perform pg_temp._p9_gp_writer_record(
    2,
    'active member creates canonical policy v1',
    case
      when r.operation_succeeded
       and r.value_json ->> 'version_number' = '1'
       and r.value_json ->> 'rule_count' = '4'
       and r.value_json ->> 'changed' = 'true'
       and r.value_json ->> 'replayed' = 'false'
       and r.value_json ->> 'outcome' = 'policy_version_created'
      then 'PASS' else 'SUT_FAIL'
    end,
    coalesce(r.value_json::text, r.returned_sqlstate || ' ' || r.message_text)
  );
exception when others then
  perform pg_temp._p9_gp_writer_record(2, 'active member creates canonical policy v1', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 3 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  v_version uuid;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;

  select current_row.current_policy_version_id
  into v_version
  from public.store_opportunity_gate_policy_current current_row
  where current_row.organization_id = ctx.org_a
    and current_row.store_id = ctx.store_a;

  v_ok :=
    v_version is not null
    and exists (
      select 1
      from public.store_opportunity_gate_policy_rules rule_row
      where rule_row.policy_version_id = v_version
        and rule_row.rule_key = 'default_quote_required'
        and rule_row.item_kind = 'commercial_gate'
        and rule_row.item_key = 'quote'
        and rule_row.match_mode = 'always'
        and rule_row.applicability_state = 'required'
    )
    and exists (
      select 1
      from public.store_opportunity_gate_policy_rules rule_row
      where rule_row.policy_version_id = v_version
        and rule_row.rule_key = 'pool_measurements_required'
        and rule_row.metadata = pg_catalog.jsonb_build_object('source', 'runner')
    );

  perform pg_temp._p9_gp_writer_record(
    3,
    'writer normalizes identifiers and preserves structured metadata',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.format('version=%s ok=%s', v_version, v_ok)
  );
exception when others then
  perform pg_temp._p9_gp_writer_record(3, 'writer normalizes identifiers', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 4 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  r record;
  v_rules jsonb;
  v_versions integer;
  v_rules_count integer;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  v_rules := pg_temp._p9_gp_writer_rules_v1();

  select * into r from pg_temp._p9_gp_writer_exec_json_sql(
    'authenticated', ctx.user_a,
    pg_catalog.format(
      $sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'policy-create-v1',%L,%L::jsonb,'initial_policy','{}'::jsonb)$sql$,
      ctx.org_a, ctx.store_a, repeat('1', 64), v_rules::text
    )
  );

  select pg_catalog.count(*)::integer into v_versions
  from public.store_opportunity_gate_policy_versions
  where organization_id = ctx.org_a and store_id = ctx.store_a;

  select pg_catalog.count(*)::integer into v_rules_count
  from public.store_opportunity_gate_policy_rules
  where organization_id = ctx.org_a and store_id = ctx.store_a;

  perform pg_temp._p9_gp_writer_record(
    4,
    'identical replay is idempotent and does not duplicate history',
    case
      when r.operation_succeeded
       and r.value_json ->> 'replayed' = 'true'
       and r.value_json ->> 'changed' = 'false'
       and r.value_json ->> 'outcome' = 'idempotent_replay_current'
       and v_versions = 1
       and v_rules_count = 4
      then 'PASS' else 'SUT_FAIL'
    end,
    pg_catalog.format('result=%s versions=%s rules=%s', r.value_json, v_versions, v_rules_count)
  );
exception when others then
  perform pg_temp._p9_gp_writer_record(4, 'identical replay', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 5 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  r record;
  v_rules jsonb;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  v_rules := pg_temp._p9_gp_writer_rules_v2();

  select * into r from pg_temp._p9_gp_writer_exec_json_sql(
    'authenticated', ctx.user_a,
    pg_catalog.format(
      $sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'policy-create-v1',%L,%L::jsonb,'initial_policy','{}'::jsonb)$sql$,
      ctx.org_a, ctx.store_a, repeat('1', 64), v_rules::text
    )
  );

  perform pg_temp._p9_gp_writer_record(
    5,
    'same operation key and fingerprint with different rule payload fails closed',
    case when not r.operation_succeeded and r.returned_sqlstate = '23505' and r.message_text = 'ZION_GATE_POLICY_IDEMPOTENCY_KEY_REUSED' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text)
  );
exception when others then
  perform pg_temp._p9_gp_writer_record(5, 'same operation different payload', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 6 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  r record;
  v_rules jsonb;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  v_rules := pg_temp._p9_gp_writer_rules_v1();

  select * into r from pg_temp._p9_gp_writer_exec_json_sql(
    'authenticated', ctx.user_a,
    pg_catalog.format(
      $sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'policy-create-v1',%L,%L::jsonb,'initial_policy','{}'::jsonb)$sql$,
      ctx.org_a, ctx.store_a, repeat('2', 64), v_rules::text
    )
  );

  perform pg_temp._p9_gp_writer_record(
    6,
    'same operation key with different fingerprint fails closed',
    case when not r.operation_succeeded and r.returned_sqlstate = '23505' and r.message_text = 'ZION_GATE_POLICY_IDEMPOTENCY_KEY_REUSED' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text)
  );
exception when others then
  perform pg_temp._p9_gp_writer_record(6, 'same operation different fingerprint', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 7 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  r record;
  v_rules jsonb;
  v_current uuid;
  v_previous uuid;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  v_rules := pg_temp._p9_gp_writer_rules_v2();

  select current_policy_version_id into v_previous
  from public.store_opportunity_gate_policy_current
  where organization_id = ctx.org_a and store_id = ctx.store_a;

  select * into r from pg_temp._p9_gp_writer_exec_json_sql(
    'authenticated', ctx.user_a,
    pg_catalog.format(
      $sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'policy-create-v2',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$,
      ctx.org_a, ctx.store_a, repeat('3', 64), v_rules::text
    )
  );

  select current_policy_version_id into v_current
  from public.store_opportunity_gate_policy_current
  where organization_id = ctx.org_a and store_id = ctx.store_a;

  perform pg_temp._p9_gp_writer_record(
    7,
    'second operation creates direct-child v2 and advances explicit current',
    case
      when r.operation_succeeded
       and r.value_json ->> 'version_number' = '2'
       and (r.value_json ->> 'previous_policy_version_id')::uuid = v_previous
       and (r.value_json ->> 'policy_version_id')::uuid = v_current
       and r.value_json ->> 'outcome' = 'policy_version_created'
      then 'PASS' else 'SUT_FAIL'
    end,
    pg_catalog.format('result=%s previous=%s current=%s', r.value_json, v_previous, v_current)
  );
exception when others then
  perform pg_temp._p9_gp_writer_record(7, 'second operation creates v2', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 8 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  r record;
  v_rules jsonb;
  v_current_before uuid;
  v_current_after uuid;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  v_rules := pg_temp._p9_gp_writer_rules_v1();

  select current_policy_version_id into v_current_before
  from public.store_opportunity_gate_policy_current
  where organization_id = ctx.org_a and store_id = ctx.store_a;

  select * into r from pg_temp._p9_gp_writer_exec_json_sql(
    'authenticated', ctx.user_a,
    pg_catalog.format(
      $sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'policy-create-v1',%L,%L::jsonb,'initial_policy','{}'::jsonb)$sql$,
      ctx.org_a, ctx.store_a, repeat('1', 64), v_rules::text
    )
  );

  select current_policy_version_id into v_current_after
  from public.store_opportunity_gate_policy_current
  where organization_id = ctx.org_a and store_id = ctx.store_a;

  perform pg_temp._p9_gp_writer_record(
    8,
    'stale replay returns history but never regresses explicit current',
    case
      when r.operation_succeeded
       and r.value_json ->> 'outcome' = 'idempotent_replay_stale'
       and v_current_after = v_current_before
       and (r.value_json ->> 'current_policy_version_id')::uuid = v_current_before
      then 'PASS' else 'SUT_FAIL'
    end,
    pg_catalog.format('result=%s before=%s after=%s', r.value_json, v_current_before, v_current_after)
  );
exception when others then
  perform pg_temp._p9_gp_writer_record(8, 'stale replay no regression', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 9 ------------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select * into r from pg_temp._p9_gp_writer_exec_json_sql(
    'authenticated', ctx.user_inactive_a,
    pg_catalog.format(
      $sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'inactive',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$,
      ctx.org_a, ctx.store_a, repeat('4', 64), pg_temp._p9_gp_writer_rules_v1()::text
    )
  );
  perform pg_temp._p9_gp_writer_record(9, 'inactive membership cannot write policy', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_gp_writer_record(9, 'inactive membership', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 10 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select * into r from pg_temp._p9_gp_writer_exec_json_sql(
    'authenticated', ctx.user_b,
    pg_catalog.format(
      $sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'cross-org',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$,
      ctx.org_a, ctx.store_a, repeat('5', 64), pg_temp._p9_gp_writer_rules_v1()::text
    )
  );
  perform pg_temp._p9_gp_writer_record(10, 'member from another org cannot write org A policy', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_gp_writer_record(10, 'cross org membership', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 11 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select * into r from pg_temp._p9_gp_writer_exec_json_sql(
    'service_role', null,
    pg_catalog.format(
      $sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'service-role',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$,
      ctx.org_a, ctx.store_a, repeat('6', 64), pg_temp._p9_gp_writer_rules_v1()::text
    )
  );
  perform pg_temp._p9_gp_writer_record(11, 'service_role cannot execute human policy writer', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_gp_writer_record(11, 'service role blocked', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 12 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select * into r from pg_temp._p9_gp_writer_exec_json_sql(
    'anon', null,
    pg_catalog.format(
      $sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'anon',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$,
      ctx.org_a, ctx.store_a, repeat('7', 64), pg_temp._p9_gp_writer_rules_v1()::text
    )
  );
  perform pg_temp._p9_gp_writer_record(12, 'anon cannot execute policy writer', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_gp_writer_record(12, 'anon blocked', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 13 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select * into r from pg_temp._p9_gp_writer_exec_json_sql(
    'authenticated', ctx.user_a,
    pg_catalog.format(
      $sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'wrong-store',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$,
      ctx.org_a, ctx.store_c_other_org, repeat('8', 64), pg_temp._p9_gp_writer_rules_v1()::text
    )
  );
  perform pg_temp._p9_gp_writer_record(13, 'store from another organization cannot be targeted', case when not r.operation_succeeded and r.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
exception when others then
  perform pg_temp._p9_gp_writer_record(13, 'wrong store scope', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- 14 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select * into r from pg_temp._p9_gp_writer_exec_json_sql('authenticated', ctx.user_a, pg_catalog.format($sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'not-array',%L,'{}'::jsonb,'policy_revision','{}'::jsonb)$sql$, ctx.org_a, ctx.store_b_same_org, repeat('9',64)));
  perform pg_temp._p9_gp_writer_record(14,'rules payload must be a non-empty array',case when not r.operation_succeeded and r.returned_sqlstate='22023' and r.message_text='ZION_GATE_POLICY_RULES_REQUIRED' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_gp_writer_record(14,'rules array validation','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 15 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select * into r from pg_temp._p9_gp_writer_exec_json_sql('authenticated', ctx.user_a, pg_catalog.format($sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'empty-array',%L,'[]'::jsonb,'policy_revision','{}'::jsonb)$sql$, ctx.org_a, ctx.store_b_same_org, repeat('a',64)));
  perform pg_temp._p9_gp_writer_record(15,'empty policy cannot become current',case when not r.operation_succeeded and r.returned_sqlstate='22023' and r.message_text='ZION_GATE_POLICY_RULES_REQUIRED' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_gp_writer_record(15,'empty policy','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 16 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; r record; v_rules jsonb;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  v_rules := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rule_key','x','item_kind','commercial_gate','item_key','quote','match_mode','always','applicability_state','required','reason_code','test_reason','typo_field',true));
  select * into r from pg_temp._p9_gp_writer_exec_json_sql('authenticated', ctx.user_a, pg_catalog.format($sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'unknown-field',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$, ctx.org_a,ctx.store_b_same_org,repeat('b',64),v_rules::text));
  perform pg_temp._p9_gp_writer_record(16,'unknown rule fields fail closed',case when not r.operation_succeeded and r.returned_sqlstate='22023' and r.message_text='ZION_GATE_POLICY_RULE_UNKNOWN_FIELD' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_gp_writer_record(16,'unknown field','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 17 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; r record; v_rules jsonb;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  v_rules := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rule_key','bad_shape','item_kind','commercial_gate','item_key','quote','match_mode','always','component_kind','pool','applicability_state','required','reason_code','test_reason'));
  select * into r from pg_temp._p9_gp_writer_exec_json_sql('authenticated', ctx.user_a, pg_catalog.format($sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'bad-shape',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$, ctx.org_a,ctx.store_b_same_org,repeat('c',64),v_rules::text));
  perform pg_temp._p9_gp_writer_record(17,'match_mode shape is validated before persistence',case when not r.operation_succeeded and r.returned_sqlstate='22023' and r.message_text='ZION_GATE_POLICY_RULE_MATCH_SHAPE_INVALID' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_gp_writer_record(17,'bad match shape','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 18 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; r record; v_rule jsonb; v_rules jsonb;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  v_rule := pg_catalog.jsonb_build_object('rule_key','duplicate','item_kind','commercial_gate','item_key','quote','match_mode','always','applicability_state','required','reason_code','test_reason');
  v_rules := pg_catalog.jsonb_build_array(v_rule,v_rule);
  select * into r from pg_temp._p9_gp_writer_exec_json_sql('authenticated', ctx.user_a, pg_catalog.format($sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'duplicate-key',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$, ctx.org_a,ctx.store_b_same_org,repeat('d',64),v_rules::text));
  perform pg_temp._p9_gp_writer_record(18,'duplicate rule_key is rejected deterministically',case when not r.operation_succeeded and r.returned_sqlstate='22023' and r.message_text='ZION_GATE_POLICY_DUPLICATE_RULE_KEY' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_gp_writer_record(18,'duplicate key','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 19 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; r record; v_rules jsonb;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  v_rules := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rule_key','bad_meta','item_kind','commercial_gate','item_key','quote','match_mode','always','applicability_state','required','reason_code','test_reason','metadata','not-object'));
  select * into r from pg_temp._p9_gp_writer_exec_json_sql('authenticated', ctx.user_a, pg_catalog.format($sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'bad-meta',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$,ctx.org_a,ctx.store_b_same_org,repeat('e',64),v_rules::text));
  perform pg_temp._p9_gp_writer_record(19,'rule metadata must be an object',case when not r.operation_succeeded and r.returned_sqlstate='22023' and r.message_text='ZION_GATE_POLICY_RULE_METADATA_INVALID' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_gp_writer_record(19,'rule metadata','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 20 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select * into r from pg_temp._p9_gp_writer_exec_json_sql('authenticated', ctx.user_a, pg_catalog.format($sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'bad-fingerprint','abc',%L::jsonb,'policy_revision','{}'::jsonb)$sql$,ctx.org_a,ctx.store_b_same_org,pg_temp._p9_gp_writer_rules_v1()::text));
  perform pg_temp._p9_gp_writer_record(20,'fingerprint must be lowercase 64-hex',case when not r.operation_succeeded and r.returned_sqlstate='22023' and r.message_text='ZION_GATE_POLICY_REQUEST_FINGERPRINT_INVALID' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_gp_writer_record(20,'fingerprint validation','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 21 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select * into r from pg_temp._p9_gp_writer_exec_json_sql('authenticated', ctx.user_a, pg_catalog.format($sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'   ',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$,ctx.org_a,ctx.store_b_same_org,repeat('f',64),pg_temp._p9_gp_writer_rules_v1()::text));
  perform pg_temp._p9_gp_writer_record(21,'blank operation_key is rejected',case when not r.operation_succeeded and r.returned_sqlstate='22023' and r.message_text='ZION_GATE_POLICY_OPERATION_KEY_INVALID' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_gp_writer_record(21,'operation key validation','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 22 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; r record; v_rules jsonb;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  v_rules := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rule_key','negative_priority','rule_priority',-1,'item_kind','commercial_gate','item_key','quote','match_mode','always','applicability_state','required','reason_code','test_reason'));
  select * into r from pg_temp._p9_gp_writer_exec_json_sql('authenticated', ctx.user_a, pg_catalog.format($sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'negative-priority',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$,ctx.org_a,ctx.store_b_same_org,repeat('0',64),v_rules::text));
  perform pg_temp._p9_gp_writer_record(22,'negative rule priority is rejected',case when not r.operation_succeeded and r.returned_sqlstate='22023' and r.message_text='ZION_GATE_POLICY_RULE_PRIORITY_INVALID' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_gp_writer_record(22,'priority validation','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 23 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; r record; v_rules jsonb;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  v_rules := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rule_key','conflict_not_policy','item_kind','commercial_gate','item_key','quote','match_mode','always','applicability_state','conflict','reason_code','test_reason'));
  select * into r from pg_temp._p9_gp_writer_exec_json_sql('authenticated', ctx.user_a, pg_catalog.format($sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'conflict-state',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$,ctx.org_a,ctx.store_b_same_org,repeat('1',64),v_rules::text));
  perform pg_temp._p9_gp_writer_record(23,'conflict cannot be configured as a policy rule outcome',case when not r.operation_succeeded and r.returned_sqlstate='22023' and r.message_text='ZION_GATE_POLICY_RULE_APPLICABILITY_INVALID' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_gp_writer_record(23,'conflict policy state','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 24 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  v_current uuid;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select current_policy_version_id into v_current
  from public.store_opportunity_gate_policy_current
  where organization_id=ctx.org_a and store_id=ctx.store_a;

  select exists (
    select 1
    from public.store_opportunity_gate_policy_versions version_row
    where version_row.id=v_current
      and version_row.actor_type='human'
      and version_row.actor_user_id=ctx.user_a
      and version_row.source_type='settings_ui'
      and version_row.created_by='user:'||ctx.user_a::text
      and version_row.reason_code='policy_revision'
  ) into v_ok;

  perform pg_temp._p9_gp_writer_record(24,'human provenance is canonical on the current version',case when v_ok then 'PASS' else 'SUT_FAIL' end,pg_catalog.format('current=%s ok=%s',v_current,v_ok));
exception when others then perform pg_temp._p9_gp_writer_record(24,'human provenance','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 25 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; v_ok boolean;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select exists (
    select 1
    from public.store_opportunity_gate_policy_current current_row
    join public.store_opportunity_gate_policy_versions version_row
      on version_row.id=current_row.current_policy_version_id
     and version_row.organization_id=current_row.organization_id
     and version_row.store_id=current_row.store_id
    where current_row.organization_id=ctx.org_a
      and current_row.store_id=ctx.store_a
      and current_row.last_operation_key=version_row.operation_key
      and current_row.last_operation_key='policy-create-v2'
  ) into v_ok;
  perform pg_temp._p9_gp_writer_record(25,'current projection matches current version operation key',case when v_ok then 'PASS' else 'SUT_FAIL' end,pg_catalog.format('ok=%s',v_ok));
exception when others then perform pg_temp._p9_gp_writer_record(25,'current operation projection','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 26 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select * into r from pg_temp._p9_gp_writer_exec_json_sql('service_role',null,pg_catalog.format($sql$select * from public.write_store_opportunity_gate_policy_internal(%L::uuid,%L::uuid,'internal-denied',%L,%L::jsonb,'system',null,'manual_check','manual_check_seed','p9.runner','{}'::jsonb)$sql$,ctx.org_a,ctx.store_a,repeat('2',64),pg_temp._p9_gp_writer_rules_v1()::text));
  perform pg_temp._p9_gp_writer_record(26,'internal writer is not executable by service_role',case when not r.operation_succeeded and r.returned_sqlstate='42501' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_gp_writer_record(26,'internal execute denied','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 27 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select * into r from pg_temp._p9_gp_writer_exec_statement_sql('authenticated',ctx.user_a,pg_catalog.format($sql$insert into public.store_opportunity_gate_policy_versions(organization_id,store_id,version_number,operation_key,request_fingerprint,actor_type,actor_user_id,source_type,reason_code,created_by) values(%L::uuid,%L::uuid,99,'direct-write',%L,'human',%L::uuid,'settings_ui','direct_write','user:%s') returning id$sql$,ctx.org_a,ctx.store_a,repeat('3',64),ctx.user_a,ctx.user_a));
  perform pg_temp._p9_gp_writer_record(27,'authenticated cannot bypass writer with direct table INSERT',case when not r.operation_succeeded and r.returned_sqlstate='42501' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<statement unexpectedly succeeded>'));
exception when others then perform pg_temp._p9_gp_writer_record(27,'direct table write denied','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 28 -----------------------------------------------------------------------
do $scenario$
declare ctx pg_temp._p9_gp_writer_ctx%rowtype; r record; v_orphan uuid;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  insert into public.store_opportunity_gate_policy_versions(
    organization_id,store_id,version_number,previous_policy_version_id,operation_key,request_fingerprint,actor_type,actor_user_id,source_type,reason_code,created_by
  ) values (
    ctx.org_a,ctx.store_b_same_org,1,null,'orphan-history',repeat('4',64),'system',null,'manual_check','manual_check_seed','p9.runner'
  ) returning id into v_orphan;

  select * into r from pg_temp._p9_gp_writer_exec_json_sql('authenticated',ctx.user_a,pg_catalog.format($sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'after-orphan',%L,%L::jsonb,'policy_revision','{}'::jsonb)$sql$,ctx.org_a,ctx.store_b_same_org,repeat('5',64),pg_temp._p9_gp_writer_rules_v1()::text));
  perform pg_temp._p9_gp_writer_record(28,'history without explicit current fails closed instead of using latest',case when not r.operation_succeeded and r.returned_sqlstate='P0001' and r.message_text='ZION_GATE_POLICY_CURRENT_MISSING_WITH_HISTORY' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,r.value_json::text));
exception when others then perform pg_temp._p9_gp_writer_record(28,'missing current with history','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- 29 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  r record;
  v_org_a_count integer;
  v_org_b_count integer;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;

  select * into r from pg_temp._p9_gp_writer_exec_json_sql(
    'authenticated', ctx.user_b,
    pg_catalog.format(
      $sql$select * from public.write_store_opportunity_gate_policy_by_user(%L::uuid,%L::uuid,'org-b-v1',%L,%L::jsonb,'initial_policy','{}'::jsonb)$sql$,
      ctx.org_b, ctx.store_c_other_org, repeat('6',64), pg_temp._p9_gp_writer_rules_v1()::text
    )
  );

  select pg_catalog.count(*)::integer into v_org_a_count
  from public.store_opportunity_gate_policy_current where organization_id=ctx.org_a;
  select pg_catalog.count(*)::integer into v_org_b_count
  from public.store_opportunity_gate_policy_current where organization_id=ctx.org_b;

  perform pg_temp._p9_gp_writer_record(
    29,
    'tenant-scoped writers maintain independent current policies',
    case when r.operation_succeeded and v_org_a_count=1 and v_org_b_count=1 then 'PASS' else 'SUT_FAIL' end,
    pg_catalog.format('result=%s org_a_current=%s org_b_current=%s',r.value_json,v_org_a_count,v_org_b_count)
  );
exception when others then
  perform pg_temp._p9_gp_writer_record(29,'tenant scoped current','HARNESS_ERROR',sqlstate||' '||sqlerrm);
end;
$scenario$;

-- 30 -----------------------------------------------------------------------
do $scenario$
declare
  ctx pg_temp._p9_gp_writer_ctx%rowtype;
  v_versions integer;
  v_rules integer;
  v_current integer;
  v_ok boolean;
begin
  select * into ctx from pg_temp._p9_gp_writer_ctx;
  select pg_catalog.count(*)::integer into v_versions from public.store_opportunity_gate_policy_versions where organization_id=ctx.org_a and store_id=ctx.store_a;
  select pg_catalog.count(*)::integer into v_rules from public.store_opportunity_gate_policy_rules where organization_id=ctx.org_a and store_id=ctx.store_a;
  select pg_catalog.count(*)::integer into v_current from public.store_opportunity_gate_policy_current where organization_id=ctx.org_a and store_id=ctx.store_a;
  v_ok := v_versions=2 and v_rules=8 and v_current=1;
  perform pg_temp._p9_gp_writer_record(30,'main store history remains exactly v1+v2 with one explicit current',case when v_ok then 'PASS' else 'SUT_FAIL' end,pg_catalog.format('versions=%s rules=%s current=%s',v_versions,v_rules,v_current));
exception when others then perform pg_temp._p9_gp_writer_record(30,'history cardinality','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- ============================================================================
-- Summary gate. Any missing/failed scenario raises; successful run rolls back.
-- ============================================================================

do $summary$
declare
  v_expected integer := 30;
  v_actual integer;
  v_failures integer;
  v_detail text;
begin
  select pg_catalog.count(*)::integer into v_actual
  from pg_temp._p9_gp_writer_results;

  select pg_catalog.count(*)::integer into v_failures
  from pg_temp._p9_gp_writer_results
  where status <> 'PASS';

  if v_actual <> v_expected then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'P9_GATE_POLICY_WRITER_RUNNER_INCOMPLETE expected=%s actual=%s',
        v_expected,
        v_actual
      );
  end if;

  if v_failures > 0 then
    select pg_catalog.string_agg(
      pg_catalog.format('#%s %s [%s] %s', scenario_number, scenario_name, status, detail),
      E'\n'
      order by scenario_number
    )
    into v_detail
    from pg_temp._p9_gp_writer_results
    where status <> 'PASS';

    raise exception using
      errcode = 'P0001',
      message = 'P9_GATE_POLICY_WRITER_RUNNER_FAILED',
      detail = v_detail;
  end if;
end;
$summary$;

rollback;
