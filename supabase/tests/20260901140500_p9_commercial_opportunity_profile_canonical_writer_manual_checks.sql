begin;

set transaction isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_profile_writer_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_profile_writer_ctx (
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
  opp_other_org uuid not null,
  pool_a uuid not null,
  pool_same_org_other_store uuid not null,
  catalog_a uuid not null,
  catalog_same_org_other_store uuid not null
) on commit preserve rows;

insert into pg_temp._p9_profile_writer_ctx (
  org_a, org_b, store_a, store_b_same_org, store_c_other_org,
  user_a, user_b, user_inactive_a, customer_a, customer_b,
  opp_a, opp_peer, opp_other_org, pool_a, pool_same_org_other_store,
  catalog_a, catalog_same_org_other_store
)
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid()
);

create or replace function pg_temp._p9_profile_writer_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_profile_writer_results(
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

create or replace function pg_temp._p9_profile_writer_exec_json_sql(
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
    execute pg_catalog.format('select to_jsonb(result_row) from (%s) result_row', p_sql)
      into v_value;

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

create or replace function pg_temp._p9_profile_writer_exec_statement_sql(
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
    return query select false, null::text,
      'runner helper must start as postgres'::text, null::text;
    return;
  end if;

  if p_role not in ('postgres', 'service_role', 'authenticated', 'anon') then
    return query select false, 'P0001'::text, 'unsupported role'::text, null::text;
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

    return query select true, null::text, null::text, null::text;
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

    return query select false, v_state, v_message, v_constraint;
  end;
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  return query select false, sqlstate::text,
    ('runner helper error: ' || sqlerrm)::text, null::text;
end;
$function$;

create or replace function pg_temp._p9_profile_writer_components_resolved(p_pool_id uuid)
returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'component_key', ' primary_pool ',
      'component_kind', ' POOL ',
      'component_state', ' RESOLVED ',
      'pool_id', p_pool_id,
      'metadata', pg_catalog.jsonb_build_object('source', 'runner')
    ),
    pg_catalog.jsonb_build_object(
      'component_key', 'custom_note',
      'component_kind', 'custom',
      'component_state', 'resolved',
      'reference_text', '  Item personalizado  '
    )
  );
$function$;

create or replace function pg_temp._p9_profile_writer_components_v2(p_pool_id uuid)
returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'component_key', 'primary_pool',
      'component_kind', 'pool',
      'component_state', 'resolved',
      'pool_id', p_pool_id,
      'metadata', pg_catalog.jsonb_build_object('source', 'runner')
    )
  );
$function$;

create or replace function pg_temp._p9_profile_writer_intents_resolved()
returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'execution_kind', ' INSTALLATION ',
      'intent_state', ' INCLUDED ',
      'reason_code', ' CUSTOMER_CONFIRMED_INSTALLATION ',
      'metadata', pg_catalog.jsonb_build_object('source', 'runner')
    ),
    pg_catalog.jsonb_build_object(
      'execution_kind', 'delivery',
      'intent_state', 'excluded',
      'reason_code', 'installation_handles_delivery'
    )
  );
$function$;

-- Fixtures. Everything is rolled back.
do $fixtures$
declare
  ctx pg_temp._p9_profile_writer_ctx%rowtype;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;

  insert into public.organizations (id, name, subscription_status)
  values
    (ctx.org_a, 'P9 Profile Writer Org A', 'active'),
    (ctx.org_b, 'P9 Profile Writer Org B', 'active');

  insert into public.stores (id, organization_id, name)
  values
    (ctx.store_a, ctx.org_a, 'P9 Profile Writer Store A'),
    (ctx.store_b_same_org, ctx.org_a, 'P9 Profile Writer Store B'),
    (ctx.store_c_other_org, ctx.org_b, 'P9 Profile Writer Store C');

  insert into auth.users (id)
  values (ctx.user_a), (ctx.user_b), (ctx.user_inactive_a);

  insert into public.memberships (organization_id, user_id, role, is_active)
  values
    (ctx.org_a, ctx.user_a, 'owner'::public.app_role, true),
    (ctx.org_b, ctx.user_b, 'owner'::public.app_role, true),
    (ctx.org_a, ctx.user_inactive_a, 'owner'::public.app_role, false);

  insert into public.customers (id, organization_id, display_name)
  values
    (ctx.customer_a, ctx.org_a, 'P9 Profile Writer Customer A'),
    (ctx.customer_b, ctx.org_b, 'P9 Profile Writer Customer B');

  insert into public.commercial_opportunities (
    id, organization_id, store_id, customer_id, stage
  ) values
    (ctx.opp_a, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_peer, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'),
    (ctx.opp_other_org, ctx.org_b, ctx.store_c_other_org, ctx.customer_b, 'qualificacao');

  insert into public.pools (
    id, organization_id, store_id, name, width_m, length_m, depth_m,
    shape, material, max_capacity_l, weight_kg, price, price_status,
    description, is_active, track_stock, stock_quantity, stock_status
  ) values
    (
      ctx.pool_a, ctx.org_a, ctx.store_a, 'P9 Profile Writer Pool A',
      2, 3, 1, 'retangular', 'vinil', 1000, 200, 5000, 'valid',
      'Writer fixture pool A', true, false, null, 'not_tracked'
    ),
    (
      ctx.pool_same_org_other_store, ctx.org_a, ctx.store_b_same_org,
      'P9 Profile Writer Pool B', 2, 3, 1, 'retangular', 'vinil',
      1000, 200, 5500, 'valid', 'Writer fixture pool B', true, false,
      null, 'not_tracked'
    );

  insert into public.store_catalog_items (
    id, organization_id, store_id, sku, name, description, price_cents,
    price_status, currency, is_active, track_stock, stock_quantity,
    stock_status, metadata
  ) values
    (
      ctx.catalog_a, ctx.org_a, ctx.store_a, 'P9-PROFILE-WRITER-A',
      'P9 Profile Writer Catalog A', 'Writer fixture catalog A', 1000,
      'valid', 'BRL', true, false, null, 'not_tracked', '{}'::jsonb
    ),
    (
      ctx.catalog_same_org_other_store, ctx.org_a, ctx.store_b_same_org,
      'P9-PROFILE-WRITER-B', 'P9 Profile Writer Catalog B',
      'Writer fixture catalog B', 1200, 'valid', 'BRL', true, false,
      null, 'not_tracked', '{}'::jsonb
    );
end;
$fixtures$;

-- #1 function signatures exist.
do $scenario$
declare
  ok boolean;
begin
  ok := pg_catalog.to_regprocedure('public.write_commercial_opportunity_profile_internal(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,uuid,text,text,text,jsonb)') is not null
    and pg_catalog.to_regprocedure('public.write_commercial_opportunity_profile_by_system(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,jsonb)') is not null
    and pg_catalog.to_regprocedure('public.write_commercial_opportunity_profile_by_user(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,jsonb)') is not null;
  perform pg_temp._p9_profile_writer_record(1, 'writer function signatures exist', case when ok then 'PASS' else 'SUT_FAIL' end, ok::text);
exception when others then
  perform pg_temp._p9_profile_writer_record(1, 'writer function signatures exist', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #2 grants are hardened.
do $scenario$
declare
  v_internal oid;
  v_system oid;
  v_user oid;
  ok boolean;
begin
  v_internal := pg_catalog.to_regprocedure('public.write_commercial_opportunity_profile_internal(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,uuid,text,text,text,jsonb)');
  v_system := pg_catalog.to_regprocedure('public.write_commercial_opportunity_profile_by_system(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,jsonb)');
  v_user := pg_catalog.to_regprocedure('public.write_commercial_opportunity_profile_by_user(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,jsonb)');
  ok := not pg_catalog.has_function_privilege('anon', v_internal, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', v_internal, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', v_internal, 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', v_system, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', v_system, 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', v_user, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', v_user, 'EXECUTE');
  perform pg_temp._p9_profile_writer_record(2, 'writer grants are hardened', case when ok then 'PASS' else 'SUT_FAIL' end, ok::text);
exception when others then
  perform pg_temp._p9_profile_writer_record(2, 'writer grants are hardened', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #3 service_role creates resolved v1.
do $scenario$
declare
  ctx pg_temp._p9_profile_writer_ctx%rowtype;
  r record;
  q text;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  q := pg_catalog.format($sql$
    select * from public.write_commercial_opportunity_profile_by_system(
      %L::uuid,%L::uuid,%L::uuid,'op-v1',%L,'resolved',%L::jsonb,%L::jsonb,
      'qualification_materializer','profile_materialized_by_system','sales_ai',%L::jsonb
    )
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a, repeat('1',64),
    pg_temp._p9_profile_writer_components_resolved(ctx.pool_a)::text,
    pg_temp._p9_profile_writer_intents_resolved()::text,
    '{"runner":true}');
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role', null, q);
  if r.operation_succeeded
     and (r.value_json ->> 'version_number')::integer = 1
     and (r.value_json ->> 'component_count')::integer = 2
     and (r.value_json ->> 'execution_intent_count')::integer = 2
     and (r.value_json ->> 'changed')::boolean
     and not (r.value_json ->> 'replayed')::boolean
     and r.value_json ->> 'outcome' = 'profile_version_created' then
    perform pg_temp._p9_profile_writer_record(3, 'service_role creates resolved v1', 'PASS', r.value_json::text);
  else
    perform pg_temp._p9_profile_writer_record(3, 'service_role creates resolved v1', 'SUT_FAIL', coalesce(r.returned_sqlstate || ' ' || r.message_text, r.value_json::text));
  end if;
exception when others then
  perform pg_temp._p9_profile_writer_record(3, 'service_role creates resolved v1', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #4 v1 normalized children and explicit current are correct.
do $scenario$
declare
  ctx pg_temp._p9_profile_writer_ctx%rowtype;
  v_current uuid;
  v_version uuid;
  v_components integer;
  v_intents integer;
  ok boolean;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  select current_profile_version_id into v_current
  from public.commercial_opportunity_profile_current
  where organization_id=ctx.org_a and store_id=ctx.store_a and commercial_opportunity_id=ctx.opp_a;
  select id into v_version
  from public.commercial_opportunity_profile_versions
  where organization_id=ctx.org_a and store_id=ctx.store_a and commercial_opportunity_id=ctx.opp_a and operation_key='op-v1';
  select count(*)::integer into v_components from public.commercial_opportunity_profile_components where profile_version_id=v_version;
  select count(*)::integer into v_intents from public.commercial_opportunity_profile_execution_intents where profile_version_id=v_version;
  ok := v_current=v_version and v_components=2 and v_intents=2
    and exists(select 1 from public.commercial_opportunity_profile_components where profile_version_id=v_version and component_key='primary_pool' and component_kind='pool' and component_state='resolved' and pool_id=ctx.pool_a)
    and exists(select 1 from public.commercial_opportunity_profile_components where profile_version_id=v_version and component_key='custom_note' and reference_text='Item personalizado')
    and exists(select 1 from public.commercial_opportunity_profile_execution_intents where profile_version_id=v_version and execution_kind='installation' and intent_state='included' and reason_code='customer_confirmed_installation');
  perform pg_temp._p9_profile_writer_record(4, 'v1 normalized children and explicit current', case when ok then 'PASS' else 'SUT_FAIL' end, pg_catalog.format('current=%s version=%s components=%s intents=%s',v_current,v_version,v_components,v_intents));
exception when others then
  perform pg_temp._p9_profile_writer_record(4, 'v1 normalized children and explicit current', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$scenario$;

-- #5 exact replay is idempotent current.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'op-v1',%L,'resolved',%L::jsonb,%L::jsonb,'qualification_materializer','profile_materialized_by_system','sales_ai',%L::jsonb)$sql$,
    ctx.org_a,ctx.store_a,ctx.opp_a,repeat('1',64),pg_temp._p9_profile_writer_components_resolved(ctx.pool_a)::text,pg_temp._p9_profile_writer_intents_resolved()::text,'{"runner":true}');
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(5,'exact replay is idempotent current',case when r.operation_succeeded and (r.value_json->>'replayed')::boolean and not (r.value_json->>'changed')::boolean and r.value_json->>'outcome'='idempotent_replay_current' then 'PASS' else 'SUT_FAIL' end,coalesce(r.value_json::text,r.returned_sqlstate||' '||r.message_text));
exception when others then perform pg_temp._p9_profile_writer_record(5,'exact replay is idempotent current','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #6 same operation_key with different fingerprint fails closed.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'op-v1',%L,'resolved',%L::jsonb,%L::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_a,repeat('2',64),pg_temp._p9_profile_writer_components_resolved(ctx.pool_a)::text,pg_temp._p9_profile_writer_intents_resolved()::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(6,'same operation key different fingerprint fails',case when not r.operation_succeeded and r.returned_sqlstate='23505' and pg_catalog.strpos(coalesce(r.message_text,''),'ZION_OPPORTUNITY_PROFILE_IDEMPOTENCY_KEY_REUSED')>0 then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(6,'same operation key different fingerprint fails','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #7 same key/fingerprint with different normalized payload fails closed.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'op-v1',%L,'resolved',%L::jsonb,%L::jsonb,'qualification_materializer','profile_materialized_by_system','sales_ai',%L::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_a,repeat('1',64),pg_temp._p9_profile_writer_components_v2(ctx.pool_a)::text,pg_temp._p9_profile_writer_intents_resolved()::text,'{"runner":true}');
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(7,'same key fingerprint different payload fails',case when not r.operation_succeeded and r.returned_sqlstate='23505' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(7,'same key fingerprint different payload fails','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #8 v2 creates direct lineage and advances current.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text; v1 uuid; v2 uuid; cur uuid; ok boolean;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  select id into v1 from public.commercial_opportunity_profile_versions where organization_id=ctx.org_a and store_id=ctx.store_a and commercial_opportunity_id=ctx.opp_a and operation_key='op-v1';
  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'op-v2',%L,'resolved',%L::jsonb,%L::jsonb,'system_correction','profile_corrected_by_system','sales_ai','{}'::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_a,repeat('3',64),pg_temp._p9_profile_writer_components_v2(ctx.pool_a)::text,pg_temp._p9_profile_writer_intents_resolved()::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  select id into v2 from public.commercial_opportunity_profile_versions where organization_id=ctx.org_a and store_id=ctx.store_a and commercial_opportunity_id=ctx.opp_a and operation_key='op-v2';
  select current_profile_version_id into cur from public.commercial_opportunity_profile_current where organization_id=ctx.org_a and store_id=ctx.store_a and commercial_opportunity_id=ctx.opp_a;
  ok := r.operation_succeeded and (r.value_json->>'version_number')::integer=2 and (r.value_json->>'previous_profile_version_id')::uuid=v1 and cur=v2;
  perform pg_temp._p9_profile_writer_record(8,'v2 direct lineage advances current',case when ok then 'PASS' else 'SUT_FAIL' end,coalesce(r.value_json::text,r.returned_sqlstate||' '||r.message_text));
exception when others then perform pg_temp._p9_profile_writer_record(8,'v2 direct lineage advances current','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #9 stale replay of v1 never regresses current.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text; v2 uuid; cur uuid; ok boolean;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  select id into v2 from public.commercial_opportunity_profile_versions where organization_id=ctx.org_a and store_id=ctx.store_a and commercial_opportunity_id=ctx.opp_a and operation_key='op-v2';
  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'op-v1',%L,'resolved',%L::jsonb,%L::jsonb,'qualification_materializer','profile_materialized_by_system','sales_ai',%L::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_a,repeat('1',64),pg_temp._p9_profile_writer_components_resolved(ctx.pool_a)::text,pg_temp._p9_profile_writer_intents_resolved()::text,'{"runner":true}');
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  select current_profile_version_id into cur from public.commercial_opportunity_profile_current where organization_id=ctx.org_a and store_id=ctx.store_a and commercial_opportunity_id=ctx.opp_a;
  ok := r.operation_succeeded and r.value_json->>'outcome'='idempotent_replay_stale' and cur=v2;
  perform pg_temp._p9_profile_writer_record(9,'stale replay never regresses current',case when ok then 'PASS' else 'SUT_FAIL' end,coalesce(r.value_json::text,r.returned_sqlstate||' '||r.message_text));
exception when others then perform pg_temp._p9_profile_writer_record(9,'stale replay never regresses current','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #10 active authenticated member can write peer opportunity.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'user-v1',%L,'resolved',%L::jsonb,%L::jsonb,'profile_updated_by_user','{}'::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,repeat('4',64),pg_temp._p9_profile_writer_components_v2(ctx.pool_a)::text,pg_temp._p9_profile_writer_intents_resolved()::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('authenticated',ctx.user_a,q);
  perform pg_temp._p9_profile_writer_record(10,'active authenticated member can write',case when r.operation_succeeded and (r.value_json->>'version_number')::integer=1 then 'PASS' else 'SUT_FAIL' end,coalesce(r.value_json::text,r.returned_sqlstate||' '||r.message_text));
exception when others then perform pg_temp._p9_profile_writer_record(10,'active authenticated member can write','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #11 inactive member is blocked.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'inactive',%L,'resolved',%L::jsonb,%L::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,repeat('5',64),pg_temp._p9_profile_writer_components_v2(ctx.pool_a)::text,pg_temp._p9_profile_writer_intents_resolved()::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('authenticated',ctx.user_inactive_a,q);
  perform pg_temp._p9_profile_writer_record(11,'inactive member blocked',case when not r.operation_succeeded and r.returned_sqlstate='42501' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(11,'inactive member blocked','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #12 member from another org is blocked.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'cross-org',%L,'resolved',%L::jsonb,%L::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,repeat('6',64),pg_temp._p9_profile_writer_components_v2(ctx.pool_a)::text,pg_temp._p9_profile_writer_intents_resolved()::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('authenticated',ctx.user_b,q);
  perform pg_temp._p9_profile_writer_record(12,'other-org member blocked',case when not r.operation_succeeded and r.returned_sqlstate='42501' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(12,'other-org member blocked','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #13 anon cannot call human writer.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'anon',%L,'resolved',%L::jsonb,%L::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,repeat('7',64),pg_temp._p9_profile_writer_components_v2(ctx.pool_a)::text,pg_temp._p9_profile_writer_intents_resolved()::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('anon',null,q);
  perform pg_temp._p9_profile_writer_record(13,'anon cannot call human writer',case when not r.operation_succeeded and r.returned_sqlstate='42501' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(13,'anon cannot call human writer','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #14 authenticated cannot call system writer.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'bad-system',%L,'resolved',%L::jsonb,%L::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,repeat('8',64),pg_temp._p9_profile_writer_components_v2(ctx.pool_a)::text,pg_temp._p9_profile_writer_intents_resolved()::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('authenticated',ctx.user_a,q);
  perform pg_temp._p9_profile_writer_record(14,'authenticated cannot call system writer',case when not r.operation_succeeded and r.returned_sqlstate='42501' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(14,'authenticated cannot call system writer','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #15 service_role cannot call user writer.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  q := pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_user(%L::uuid,%L::uuid,%L::uuid,'bad-user',%L,'resolved',%L::jsonb,%L::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,repeat('9',64),pg_temp._p9_profile_writer_components_v2(ctx.pool_a)::text,pg_temp._p9_profile_writer_intents_resolved()::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(15,'service_role cannot call user writer',case when not r.operation_succeeded and r.returned_sqlstate='42501' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(15,'service_role cannot call user writer','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #16 authenticated cannot bypass writer with direct INSERT.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  select * into r from pg_temp._p9_profile_writer_exec_statement_sql('authenticated',ctx.user_a,pg_catalog.format($sql$insert into public.commercial_opportunity_profile_versions(organization_id,store_id,commercial_opportunity_id,version_number,profile_state,operation_key,request_fingerprint,actor_type,actor_user_id,source_type,reason_code,created_by) values(%L::uuid,%L::uuid,%L::uuid,99,'resolved','direct-auth',%L,'human',%L::uuid,'crm_manual','direct_write','user:%s')$sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,repeat('a',64),ctx.user_a,ctx.user_a));
  perform pg_temp._p9_profile_writer_record(16,'authenticated direct table insert blocked',case when not r.operation_succeeded and r.returned_sqlstate='42501' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(16,'authenticated direct table insert blocked','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #17 service_role cannot bypass writer with direct INSERT.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  select * into r from pg_temp._p9_profile_writer_exec_statement_sql('service_role',null,pg_catalog.format($sql$insert into public.commercial_opportunity_profile_versions(organization_id,store_id,commercial_opportunity_id,version_number,profile_state,operation_key,request_fingerprint,actor_type,source_type,reason_code,created_by) values(%L::uuid,%L::uuid,%L::uuid,99,'resolved','direct-service',%L,'system','system_inference','direct_write','sales_ai')$sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,repeat('b',64)));
  perform pg_temp._p9_profile_writer_record(17,'service_role direct table insert blocked',case when not r.operation_succeeded and r.returned_sqlstate='42501' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(17,'service_role direct table insert blocked','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #18 resolved state rejects zero components.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'zero-resolved',%L,'resolved','[]'::jsonb,'[]'::jsonb)$sql$,ctx.org_b,ctx.store_c_other_org,ctx.opp_other_org,repeat('c',64));
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(18,'resolved rejects zero components',case when not r.operation_succeeded and r.returned_sqlstate='22023' and pg_catalog.strpos(coalesce(r.message_text,''),'RESOLVED_STATE_INCONSISTENT')>0 then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(18,'resolved rejects zero components','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #19 resolved state rejects partial component.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text; comps jsonb;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  comps:=jsonb_build_array(jsonb_build_object('component_key','pool','component_kind','pool','component_state','partial','reference_text','Piscina 3x4'));
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'partial-as-resolved',%L,'resolved',%L::jsonb,'[]'::jsonb)$sql$,ctx.org_b,ctx.store_c_other_org,ctx.opp_other_org,repeat('d',64),comps::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(19,'resolved rejects partial component',case when not r.operation_succeeded and r.returned_sqlstate='22023' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(19,'resolved rejects partial component','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #20 child conflict requires profile conflict.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text; comps jsonb;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  comps:=jsonb_build_array(jsonb_build_object('component_key','pool','component_kind','pool','component_state','conflict','reference_text','Modelos conflitantes'));
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'conflict-child',%L,'needs_clarification',%L::jsonb,'[]'::jsonb)$sql$,ctx.org_b,ctx.store_c_other_org,ctx.opp_other_org,repeat('e',64),comps::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(20,'child conflict requires profile conflict',case when not r.operation_succeeded and r.returned_sqlstate='22023' and pg_catalog.strpos(coalesce(r.message_text,''),'CONFLICT_STATE_REQUIRED')>0 then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(20,'child conflict requires profile conflict','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #21 conflict profile requires child conflict.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'fake-conflict',%L,'conflict',%L::jsonb,%L::jsonb)$sql$,ctx.org_b,ctx.store_c_other_org,ctx.opp_other_org,repeat('f',64),jsonb_build_array(jsonb_build_object('component_key','service','component_kind','service','component_state','resolved','reference_text','Manutencao'))::text,'[]');
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(21,'conflict profile requires child conflict',case when not r.operation_succeeded and r.returned_sqlstate='22023' and pg_catalog.strpos(coalesce(r.message_text,''),'CONFLICT_STATE_WITHOUT_CONFLICT')>0 then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(21,'conflict profile requires child conflict','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #22 needs_clarification supports structurally unresolved zero-component profile.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'unknown-profile',%L,'needs_clarification','[]'::jsonb,'[]'::jsonb,'system_inference','profile_structure_unresolved','sales_ai','{}'::jsonb)$sql$,ctx.org_b,ctx.store_c_other_org,ctx.opp_other_org,repeat('0',64));
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(22,'needs clarification accepts unresolved zero-component profile',case when r.operation_succeeded and r.value_json->>'profile_state'='needs_clarification' then 'PASS' else 'SUT_FAIL' end,coalesce(r.value_json::text,r.returned_sqlstate||' '||r.message_text));
exception when others then perform pg_temp._p9_profile_writer_record(22,'needs clarification accepts unresolved zero-component profile','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #23 needs_clarification rejects fully resolved payload.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'clarify-resolved',%L,'needs_clarification',%L::jsonb,%L::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_a,repeat('1a',32),pg_temp._p9_profile_writer_components_v2(ctx.pool_a)::text,pg_temp._p9_profile_writer_intents_resolved()::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(23,'needs clarification rejects fully resolved payload',case when not r.operation_succeeded and r.returned_sqlstate='22023' and pg_catalog.strpos(coalesce(r.message_text,''),'NEEDS_CLARIFICATION_STATE_INCONSISTENT')>0 then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(23,'needs clarification rejects fully resolved payload','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #24 pool reference from another store is rejected.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'pool-cross-store',%L,'resolved',%L::jsonb,'[]'::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_a,repeat('2a',32),jsonb_build_array(jsonb_build_object('component_key','pool','component_kind','pool','component_state','resolved','pool_id',ctx.pool_same_org_other_store))::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(24,'pool outside exact store scope rejected',case when not r.operation_succeeded and r.returned_sqlstate='23503' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(24,'pool outside exact store scope rejected','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #25 catalog item from another store is rejected.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'catalog-cross-store',%L,'resolved',%L::jsonb,'[]'::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_a,repeat('3a',32),jsonb_build_array(jsonb_build_object('component_key','item','component_kind','catalog_item','component_state','resolved','catalog_item_id',ctx.catalog_same_org_other_store))::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(25,'catalog outside exact store scope rejected',case when not r.operation_succeeded and r.returned_sqlstate='23503' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(25,'catalog outside exact store scope rejected','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #26 duplicate normalized component_key is rejected.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text; comps jsonb;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  comps:=jsonb_build_array(jsonb_build_object('component_key','ITEM','component_kind','service','component_state','resolved','reference_text','A'),jsonb_build_object('component_key',' item ','component_kind','service','component_state','resolved','reference_text','B'));
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'dup-component',%L,'resolved',%L::jsonb,'[]'::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_a,repeat('4a',32),comps::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(26,'duplicate normalized component key rejected',case when not r.operation_succeeded and r.returned_sqlstate='22023' and pg_catalog.strpos(coalesce(r.message_text,''),'DUPLICATE_COMPONENT_KEY')>0 then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(26,'duplicate normalized component key rejected','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #27 duplicate normalized execution_kind is rejected.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text; intents jsonb;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  intents:=jsonb_build_array(jsonb_build_object('execution_kind','INSTALLATION','intent_state','included'),jsonb_build_object('execution_kind',' installation ','intent_state','excluded'));
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'dup-intent',%L,'resolved',%L::jsonb,%L::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_a,repeat('5a',32),pg_temp._p9_profile_writer_components_v2(ctx.pool_a)::text,intents::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(27,'duplicate execution kind rejected',case when not r.operation_succeeded and r.returned_sqlstate='22023' and pg_catalog.strpos(coalesce(r.message_text,''),'DUPLICATE_EXECUTION_KIND')>0 then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(27,'duplicate execution kind rejected','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #28 component unknown field is rejected.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text; comps jsonb;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  comps:=jsonb_build_array(jsonb_build_object('component_key','svc','component_kind','service','component_state','resolved','reference_text','A','sale_type','legacy'));
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'unknown-component-field',%L,'resolved',%L::jsonb,'[]'::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_a,repeat('6a',32),comps::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(28,'component unknown field rejected',case when not r.operation_succeeded and r.returned_sqlstate='22023' and pg_catalog.strpos(coalesce(r.message_text,''),'COMPONENT_UNKNOWN_FIELD')>0 then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(28,'component unknown field rejected','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #29 execution intent unknown field is rejected.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text; intents jsonb;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  intents:=jsonb_build_array(jsonb_build_object('execution_kind','pickup','intent_state','included','fulfillment_status','done'));
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'unknown-intent-field',%L,'resolved',%L::jsonb,%L::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_a,repeat('7a',32),pg_temp._p9_profile_writer_components_v2(ctx.pool_a)::text,intents::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(29,'execution intent unknown field rejected',case when not r.operation_succeeded and r.returned_sqlstate='22023' and pg_catalog.strpos(coalesce(r.message_text,''),'EXECUTION_INTENT_UNKNOWN_FIELD')>0 then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(29,'execution intent unknown field rejected','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #30 non-object metadata is rejected.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'bad-meta',%L,'resolved',%L::jsonb,%L::jsonb,'qualification_materializer','profile_materialized_by_system','sales_ai','[]'::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_a,repeat('8a',32),pg_temp._p9_profile_writer_components_v2(ctx.pool_a)::text,pg_temp._p9_profile_writer_intents_resolved()::text);
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(30,'non-object metadata rejected',case when not r.operation_succeeded and r.returned_sqlstate='22023' and pg_catalog.strpos(coalesce(r.message_text,''),'METADATA_INVALID')>0 then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(30,'non-object metadata rejected','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #31 wrong opportunity scope is rejected.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_by_system(%L::uuid,%L::uuid,%L::uuid,'wrong-scope',%L,'needs_clarification','[]'::jsonb,'[]'::jsonb)$sql$,ctx.org_a,ctx.store_a,ctx.opp_other_org,repeat('9a',32));
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('service_role',null,q);
  perform pg_temp._p9_profile_writer_record(31,'wrong opportunity scope rejected',case when not r.operation_succeeded and r.returned_sqlstate='23503' then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(31,'wrong opportunity scope rejected','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #32 system writer persists actor_type=system and actor_user_id null.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; ok boolean;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  select exists(select 1 from public.commercial_opportunity_profile_versions where organization_id=ctx.org_a and store_id=ctx.store_a and commercial_opportunity_id=ctx.opp_a and operation_key='op-v2' and actor_type='system' and actor_user_id is null and created_by='sales_ai') into ok;
  perform pg_temp._p9_profile_writer_record(32,'system actor audit shape is canonical',case when ok then 'PASS' else 'SUT_FAIL' end,ok::text);
exception when others then perform pg_temp._p9_profile_writer_record(32,'system actor audit shape is canonical','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #33 human writer persists exact auth.uid actor.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; ok boolean;
begin select * into ctx from pg_temp._p9_profile_writer_ctx;
  select exists(select 1 from public.commercial_opportunity_profile_versions where organization_id=ctx.org_a and store_id=ctx.store_a and commercial_opportunity_id=ctx.opp_peer and operation_key='user-v1' and actor_type='human' and actor_user_id=ctx.user_a and source_type='crm_manual' and created_by='user:'||ctx.user_a::text) into ok;
  perform pg_temp._p9_profile_writer_record(33,'human actor audit shape is canonical',case when ok then 'PASS' else 'SUT_FAIL' end,ok::text);
exception when others then perform pg_temp._p9_profile_writer_record(33,'human actor audit shape is canonical','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #34 history without current fails closed.
do $scenario$
declare ctx pg_temp._p9_profile_writer_ctx%rowtype; r record; q text;
begin
  select * into ctx from pg_temp._p9_profile_writer_ctx;
  delete from public.commercial_opportunity_profile_current where organization_id=ctx.org_b and store_id=ctx.store_c_other_org and commercial_opportunity_id=ctx.opp_other_org;
  q:=pg_catalog.format($sql$select * from public.write_commercial_opportunity_profile_internal(%L::uuid,%L::uuid,%L::uuid,'after-current-loss',%L,'needs_clarification','[]'::jsonb,'[]'::jsonb,'system',null,'system_correction','repair_attempt','runner','{}'::jsonb)$sql$,ctx.org_b,ctx.store_c_other_org,ctx.opp_other_org,repeat('ab',32));
  select * into r from pg_temp._p9_profile_writer_exec_json_sql('postgres',null,q);
  perform pg_temp._p9_profile_writer_record(34,'history without current fails closed',case when not r.operation_succeeded and r.returned_sqlstate='P0001' and pg_catalog.strpos(coalesce(r.message_text,''),'CURRENT_MISSING_WITH_HISTORY')>0 then 'PASS' else 'SUT_FAIL' end,coalesce(r.returned_sqlstate||' '||r.message_text,'<success>'));
exception when others then perform pg_temp._p9_profile_writer_record(34,'history without current fails closed','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- #35 function definition contains explicit locking/idempotency and no latest/max fallback.
do $scenario$
declare v_def text; ok boolean;
begin
  select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.write_commercial_opportunity_profile_internal(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,uuid,text,text,text,jsonb)')) into v_def;
  ok := v_def like '%pg_advisory_xact_lock%'
    and v_def like '%for update%'
    and v_def like '%ZION_OPPORTUNITY_PROFILE_IDEMPOTENCY_KEY_REUSED%'
    and v_def not like '%max(version_number)%'
    and v_def not like '%order by created_at desc%';
  perform pg_temp._p9_profile_writer_record(35,'writer uses explicit current locking without latest max fallback',case when ok then 'PASS' else 'SUT_FAIL' end,ok::text);
exception when others then perform pg_temp._p9_profile_writer_record(35,'writer uses explicit current locking without latest max fallback','HARNESS_ERROR',sqlstate||' '||sqlerrm); end;
$scenario$;

-- Mandatory summary gate.
do $summary$
declare
  v_expected integer := 35;
  v_count integer;
  v_failures integer;
  v_detail text;
begin
  select count(*)::integer into v_count from pg_temp._p9_profile_writer_results;
  select count(*)::integer into v_failures from pg_temp._p9_profile_writer_results where status <> 'PASS';

  if v_count <> v_expected or exists (
    select 1 from generate_series(1, v_expected) n
    where not exists (select 1 from pg_temp._p9_profile_writer_results r where r.scenario_number=n)
  ) then
    raise exception using errcode='P0001', message='P9_PROFILE_WRITER_RUNNER_FAILED', detail=pg_catalog.format('mandatory scenario coverage mismatch: expected=%s got=%s',v_expected,v_count);
  end if;

  if v_failures > 0 then
    select pg_catalog.string_agg(pg_catalog.format('#%s %s [%s] %s',scenario_number,scenario_name,status,detail), E'\n' order by scenario_number)
    into v_detail
    from pg_temp._p9_profile_writer_results
    where status <> 'PASS';
    raise exception using errcode='P0001', message='P9_PROFILE_WRITER_RUNNER_FAILED', detail=v_detail;
  end if;
end;
$summary$;

rollback;
