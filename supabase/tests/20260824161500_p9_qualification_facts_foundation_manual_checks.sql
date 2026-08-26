begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_qfact_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_qfact_ctx (
  singleton boolean primary key default true check (singleton),
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b_same_org uuid not null,
  store_c_other_org uuid not null,
  customer_a uuid not null,
  customer_b uuid not null,
  opp_a uuid not null,
  opp_peer uuid not null,
  opp_other_org uuid not null,
  user_a uuid not null,
  user_b uuid not null,
  user_inactive_a uuid not null,
  rls_event_a uuid null,
  rls_event_b uuid null,
  inferred_event_id uuid null,
  confirmed_event_id uuid null
) on commit preserve rows;

insert into pg_temp._p9_qfact_ctx (
  org_a,
  org_b,
  store_a,
  store_b_same_org,
  store_c_other_org,
  customer_a,
  customer_b,
  opp_a,
  opp_peer,
  opp_other_org,
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
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

create or replace function pg_temp._p9_qfact_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_qfact_results (
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

create or replace function pg_temp._p9_qfact_exec_json_sql(
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
    if p_sql ~* '^[[:space:]]*select[[:space:]]' then
      execute format('select to_jsonb(result_row) from (%s) result_row', p_sql)
        into v_value;
    elsif p_sql ~* '^[[:space:]]*(insert|update|delete)[[:space:]]' then
      execute format('with result_row as (%s) select to_jsonb(result_row) from result_row', p_sql)
        into v_value;
    else
      raise exception using
        errcode = 'P0001',
        message = 'runner helper supports only SELECT or DML with RETURNING';
    end if;

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
  ctx pg_temp._p9_qfact_ctx%rowtype;
  v_event_a uuid;
  v_event_b uuid;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;

  insert into public.organizations (id, name, subscription_status)
  values
    (ctx.org_a, 'P9 Qualification Runner Org A', 'active'),
    (ctx.org_b, 'P9 Qualification Runner Org B', 'active');

  insert into public.stores (id, organization_id, name)
  values
    (ctx.store_a, ctx.org_a, 'P9 Qualification Runner Store A'),
    (ctx.store_b_same_org, ctx.org_a, 'P9 Qualification Runner Store B'),
    (ctx.store_c_other_org, ctx.org_b, 'P9 Qualification Runner Store C');

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
    (ctx.customer_a, ctx.org_a, 'Cliente A'),
    (ctx.customer_b, ctx.org_b, 'Cliente B');

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

  insert into public.commercial_opportunity_qualification_fact_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    fact_key,
    value_json,
    normalized_value_text,
    value_kind,
    assertion_level,
    source_type,
    operation_key,
    created_by
  ) values (
    ctx.org_a,
    ctx.store_a,
    ctx.opp_a,
    'location_text',
    to_jsonb('Campinas'::text),
    'campinas',
    'text',
    'confirmed',
    'crm_manual',
    'runner-rls-event-a',
    'postgres.manual_runner'
  ) returning id into v_event_a;

  insert into public.commercial_opportunity_qualification_fact_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    fact_key,
    value_json,
    normalized_value_text,
    value_kind,
    assertion_level,
    source_type,
    operation_key,
    created_by
  ) values (
    ctx.org_b,
    ctx.store_c_other_org,
    ctx.opp_other_org,
    'location_text',
    to_jsonb('Sorocaba'::text),
    'sorocaba',
    'text',
    'confirmed',
    'crm_manual',
    'runner-rls-event-b',
    'postgres.manual_runner'
  ) returning id into v_event_b;

  insert into public.commercial_opportunity_qualification_facts_current (
    organization_id,
    store_id,
    commercial_opportunity_id,
    fact_key,
    current_state,
    value_json,
    normalized_value_text,
    value_kind,
    source_type,
    last_event_id,
    last_operation_key
  ) values
    (
      ctx.org_a,
      ctx.store_a,
      ctx.opp_a,
      'location_text',
      'confirmed',
      to_jsonb('Campinas'::text),
      'campinas',
      'text',
      'crm_manual',
      v_event_a,
      'runner-rls-event-a'
    ),
    (
      ctx.org_b,
      ctx.store_c_other_org,
      ctx.opp_other_org,
      'location_text',
      'confirmed',
      to_jsonb('Sorocaba'::text),
      'sorocaba',
      'text',
      'crm_manual',
      v_event_b,
      'runner-rls-event-b'
    );

  update pg_temp._p9_qfact_ctx
  set rls_event_a = v_event_a,
      rls_event_b = v_event_b;
end;
$fixtures$;

-- 1. Estrutura, RLS, grants e funcoes internas.
do $scenario_1$
declare
  v_events_columns_ok boolean;
  v_current_columns_ok boolean;
  v_events_rls_ok boolean;
  v_current_rls_ok boolean;
  v_auth_contract_ok boolean;
  v_anon_contract_ok boolean;
  v_service_contract_ok boolean;
  v_function_contract_ok boolean;
begin
  select count(*) = 16 into v_events_columns_ok
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'commercial_opportunity_qualification_fact_events'
    and column_name in (
      'id','organization_id','store_id','commercial_opportunity_id','fact_key',
      'value_json','normalized_value_text','value_kind','assertion_level','source_type',
      'source_message_id','source_conversation_id','operation_key','created_by',
      'resolves_conflict','created_at'
    );

  select count(*) = 15 into v_current_columns_ok
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'commercial_opportunity_qualification_facts_current'
    and column_name in (
      'organization_id','store_id','commercial_opportunity_id','fact_key','current_state',
      'value_json','normalized_value_text','value_kind','conflict_values_json','source_type',
      'source_message_id','source_conversation_id','last_event_id','last_operation_key','updated_at'
    );

  select relrowsecurity into v_events_rls_ok
  from pg_catalog.pg_class
  where oid = 'public.commercial_opportunity_qualification_fact_events'::pg_catalog.regclass;

  select relrowsecurity into v_current_rls_ok
  from pg_catalog.pg_class
  where oid = 'public.commercial_opportunity_qualification_facts_current'::pg_catalog.regclass;

  select
    pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_fact_events', 'SELECT')
    and pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_facts_current', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_fact_events', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_facts_current', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_qualification_facts_current', 'UPDATE')
  into v_auth_contract_ok;

  select
    not pg_catalog.has_table_privilege('anon', 'public.commercial_opportunity_qualification_fact_events', 'SELECT')
    and not pg_catalog.has_table_privilege('anon', 'public.commercial_opportunity_qualification_fact_events', 'INSERT')
    and not pg_catalog.has_table_privilege('anon', 'public.commercial_opportunity_qualification_facts_current', 'SELECT')
    and not pg_catalog.has_table_privilege('anon', 'public.commercial_opportunity_qualification_facts_current', 'INSERT')
  into v_anon_contract_ok;

  select
    pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_fact_events', 'SELECT')
    and pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_facts_current', 'SELECT')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_fact_events', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_facts_current', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_qualification_facts_current', 'UPDATE')
  into v_service_contract_ok;

  select
    pg_catalog.to_regprocedure('public.p9_qfact_touch_current_updated_at()') is not null
    and pg_catalog.to_regprocedure('public.p9_qfact_prevent_event_mutation()') is not null
    and pg_catalog.to_regprocedure('public.p9_qfact_validate_current_projection()') is not null
    and (
      select proc_row.proconfig
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = pg_catalog.to_regprocedure('public.p9_qfact_touch_current_updated_at()')
    ) = array['search_path=pg_catalog, pg_temp']::text[]
    and (
      select proc_row.proconfig
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = pg_catalog.to_regprocedure('public.p9_qfact_prevent_event_mutation()')
    ) = array['search_path=pg_catalog, pg_temp']::text[]
    and (
      select proc_row.proconfig
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = pg_catalog.to_regprocedure('public.p9_qfact_validate_current_projection()')
    ) = array['search_path=pg_catalog, pg_temp']::text[]
    and not pg_catalog.has_function_privilege('authenticated', 'public.p9_qfact_validate_current_projection()', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.p9_qfact_validate_current_projection()', 'EXECUTE')
  into v_function_contract_ok;

  perform pg_temp._p9_qfact_record(
    1,
    'estrutura, RLS, grants e funcoes internas estao endurecidos',
    case when v_events_columns_ok and v_current_columns_ok
      and v_events_rls_ok and v_current_rls_ok
      and v_auth_contract_ok and v_anon_contract_ok
      and v_service_contract_ok and v_function_contract_ok
      then 'PASS' else 'SUT_FAIL' end,
    format(
      'events_columns=%s current_columns=%s events_rls=%s current_rls=%s auth=%s anon=%s service=%s functions=%s',
      v_events_columns_ok, v_current_columns_ok, v_events_rls_ok, v_current_rls_ok,
      v_auth_contract_ok, v_anon_contract_ok, v_service_contract_ok, v_function_contract_ok
    )
  );
end;
$scenario_1$;

-- 2. Membership ativa ve somente o proprio tenant.
do $scenario_2$
declare
  ctx pg_temp._p9_qfact_ctx%rowtype;
  event_result record;
  current_result record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;

  select * into event_result
  from pg_temp._p9_qfact_exec_json_sql(
    'authenticated', ctx.user_a,
    format($sql$
      select
        count(*) filter (where organization_id = %L::uuid) as own_count,
        count(*) filter (where organization_id = %L::uuid) as foreign_count
      from public.commercial_opportunity_qualification_fact_events
      where id in (%L::uuid, %L::uuid)
    $sql$, ctx.org_a, ctx.org_b, ctx.rls_event_a, ctx.rls_event_b)
  );

  select * into current_result
  from pg_temp._p9_qfact_exec_json_sql(
    'authenticated', ctx.user_a,
    format($sql$
      select
        count(*) filter (where organization_id = %L::uuid) as own_count,
        count(*) filter (where organization_id = %L::uuid) as foreign_count
      from public.commercial_opportunity_qualification_facts_current
      where commercial_opportunity_id in (%L::uuid, %L::uuid)
        and fact_key = 'location_text'
    $sql$, ctx.org_a, ctx.org_b, ctx.opp_a, ctx.opp_other_org)
  );

  perform pg_temp._p9_qfact_record(
    2,
    'membership ativa le somente fatos do proprio tenant',
    case when event_result.operation_succeeded
      and current_result.operation_succeeded
      and (event_result.value_json ->> 'own_count')::integer = 1
      and (event_result.value_json ->> 'foreign_count')::integer = 0
      and (current_result.value_json ->> 'own_count')::integer = 1
      and (current_result.value_json ->> 'foreign_count')::integer = 0
      then 'PASS' else 'SUT_FAIL' end,
    format('events=%s current=%s', event_result.value_json, current_result.value_json)
  );
end;
$scenario_2$;

-- 3. Membership inativa nao concede leitura.
do $scenario_3$
declare
  ctx pg_temp._p9_qfact_ctx%rowtype;
  r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r
  from pg_temp._p9_qfact_exec_json_sql(
    'authenticated', ctx.user_inactive_a,
    format($sql$
      select count(*) as visible_count
      from public.commercial_opportunity_qualification_fact_events
      where organization_id = %L::uuid
        and id = %L::uuid
    $sql$, ctx.org_a, ctx.rls_event_a)
  );

  perform pg_temp._p9_qfact_record(
    3,
    'membership inativa nao concede leitura',
    case when r.operation_succeeded
      and (r.value_json ->> 'visible_count')::integer = 0
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.value_json::text, r.returned_sqlstate, '<null>')
  );
end;
$scenario_3$;

-- 4. Anon nao possui leitura direta.
do $scenario_4$
declare r record;
begin
  select * into r
  from pg_temp._p9_qfact_exec_json_sql(
    'anon', null,
    'select count(*) as row_count from public.commercial_opportunity_qualification_fact_events'
  );

  perform pg_temp._p9_qfact_record(
    4,
    'anon nao possui leitura direta',
    case when not r.operation_succeeded and r.returned_sqlstate = '42501'
      then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate, '<null>') || ' ' || coalesce(r.message_text, '')
  );
end;
$scenario_4$;

-- 5. fact_key invalido.
do $scenario_5$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'invalid_fact',to_jsonb('x'::text),'x',
      'text','inferred','system_inference','runner-invalid-fact','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfact_record(5,'fact_key invalido e bloqueado',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_5$;

-- 6. value_kind invalido.
do $scenario_6$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary',to_jsonb('x'::text),'x',
      'json','inferred','system_inference','runner-invalid-kind','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfact_record(6,'value_kind fora do vocabulario e bloqueado',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_6$;

-- 7. fact_key e value_kind precisam ser coerentes.
do $scenario_7$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'requested_area_m2',to_jsonb('25'::text),'25',
      'text','confirmed','crm_manual','runner-kind-mismatch','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfact_record(7,'fact_key exige value_kind compativel',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_7$;

-- 8. assertion_level invalido.
do $scenario_8$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary',to_jsonb('x'::text),'x',
      'text','invalid_assertion','crm_manual','runner-invalid-assertion','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfact_record(8,'assertion_level invalido e bloqueado',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_8$;

-- 9. source_type invalido.
do $scenario_9$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary',to_jsonb('x'::text),'x',
      'text','confirmed','invalid_source','runner-invalid-source','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfact_record(9,'source_type invalido e bloqueado',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_9$;

-- 10. system_inference nunca pode ser confirmed.
do $scenario_10$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary',to_jsonb('x'::text),'x',
      'text','confirmed','system_inference','runner-inference-confirmed','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfact_record(10,'system_inference nao pode virar fato confirmado',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_10$;

-- 11. Mensagem de cliente exige message_id e conversation_id.
do $scenario_11$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'location_text',to_jsonb('Campinas'::text),'campinas',
      'text','confirmed','incoming_customer_message','runner-customer-no-source','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfact_record(11,'incoming_customer_message exige proveniencia minima',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_11$;

-- 12. source_message_id isolado sem conversation_id e bloqueado.
do $scenario_12$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,source_message_id,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary',to_jsonb('x'::text),'x',
      'text','confirmed','crm_manual',%L::uuid,'runner-message-without-conversation','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a, gen_random_uuid()));
  perform pg_temp._p9_qfact_record(12,'source_message_id nao pode existir sem source_conversation_id',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_12$;

-- 13. operation_key precisa ser canonica, sem espacos marginais.
do $scenario_13$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary',to_jsonb('x'::text),'x',
      'text','confirmed','crm_manual',' runner-whitespace-key ','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfact_record(13,'operation_key com whitespace marginal e bloqueada',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_13$;

-- 14. Texto vazio e JSON null nao sao fatos validos.
do $scenario_14$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r_blank record; r_json_null record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r_blank from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary',to_jsonb('   '::text),'   ',
      'text','confirmed','crm_manual','runner-blank-text','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));

  select * into r_json_null from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary','null'::jsonb,'x',
      'text','confirmed','crm_manual','runner-json-null','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));

  perform pg_temp._p9_qfact_record(14,'payload vazio ou JSON null e bloqueado',
    case when not r_blank.operation_succeeded and r_blank.returned_sqlstate='23514'
      and not r_json_null.operation_succeeded and r_json_null.returned_sqlstate='23514'
      then 'PASS' else 'SUT_FAIL' end,
    'blank='||coalesce(r_blank.returned_sqlstate,'<null>')||' json_null='||coalesce(r_json_null.returned_sqlstate,'<null>'));
end;
$scenario_14$;

-- 15. Tipo JSON do payload precisa combinar com value_kind.
do $scenario_15$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'installation_interest',to_jsonb('true'::text),null,
      'boolean','confirmed','crm_manual','runner-payload-type-mismatch','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));
  perform pg_temp._p9_qfact_record(15,'value_json precisa combinar com value_kind',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_15$;

-- 16. Opportunity cross-tenant e bloqueada.
do $scenario_16$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary',to_jsonb('cross tenant'::text),'cross tenant',
      'text','confirmed','crm_manual','runner-cross-tenant','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_b, ctx.store_c_other_org, ctx.opp_a));
  perform pg_temp._p9_qfact_record(16,'opportunity cross-tenant e bloqueada',
    case when not r.operation_succeeded and r.returned_sqlstate='23503' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_16$;

-- 17. Opportunity cross-store e bloqueada.
do $scenario_17$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary',to_jsonb('cross store'::text),'cross store',
      'text','confirmed','crm_manual','runner-cross-store','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_b_same_org, ctx.opp_a));
  perform pg_temp._p9_qfact_record(17,'opportunity cross-store e bloqueada',
    case when not r.operation_succeeded and r.returned_sqlstate='23503' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_17$;

-- 18. operation_key duplicada no mesmo fact/opportunity e bloqueada.
do $scenario_18$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r1 record; r2 record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r1 from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'budget_text',to_jsonb('ate 20 mil'::text),'ate 20 mil',
      'text','inferred','system_inference','runner-duplicate-operation','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));

  select * into r2 from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'budget_text',to_jsonb('ate 25 mil'::text),'ate 25 mil',
      'text','confirmed','crm_manual','runner-duplicate-operation','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));

  perform pg_temp._p9_qfact_record(18,'operation_key duplicada no mesmo fact e bloqueada',
    case when r1.operation_succeeded and not r2.operation_succeeded and r2.returned_sqlstate='23505'
      then 'PASS' else 'SUT_FAIL' end,
    'first='||coalesce(r1.operation_succeeded::text,'<null>')||' duplicate='||coalesce(r2.returned_sqlstate,'<null>'));
end;
$scenario_18$;

-- 19. Mesma operation_key em outra opportunity nao colide.
do $scenario_19$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'budget_text',to_jsonb('ate 22 mil'::text),'ate 22 mil',
      'text','inferred','system_inference','runner-duplicate-operation','postgres.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_peer));
  perform pg_temp._p9_qfact_record(19,'mesma operation_key em outra opportunity nao colide',
    case when r.operation_succeeded then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.value_json ->> 'id', r.returned_sqlstate, '<null>'));
end;
$scenario_19$;

-- 20. authenticated nao consegue escrever diretamente.
do $scenario_20$
declare ctx pg_temp._p9_qfact_ctx%rowtype; re record; rc record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into re from pg_temp._p9_qfact_exec_json_sql('authenticated', ctx.user_a, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary',to_jsonb('auth write'::text),'auth write',
      'text','confirmed','crm_manual','runner-auth-write-events','authenticated.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));

  select * into rc from pg_temp._p9_qfact_exec_json_sql('authenticated', ctx.user_a, format($sql$
    insert into public.commercial_opportunity_qualification_facts_current (
      organization_id,store_id,commercial_opportunity_id,fact_key,current_state,value_json,
      normalized_value_text,value_kind,source_type,last_event_id,last_operation_key
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary','confirmed',to_jsonb('auth current'::text),
      'auth current','text','crm_manual',%L::uuid,'runner-auth-write-current'
    ) returning fact_key
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a, gen_random_uuid()));

  perform pg_temp._p9_qfact_record(20,'authenticated nao consegue escrever diretamente',
    case when not re.operation_succeeded and re.returned_sqlstate='42501'
      and not rc.operation_succeeded and rc.returned_sqlstate='42501'
      then 'PASS' else 'SUT_FAIL' end,
    'events='||coalesce(re.returned_sqlstate,'<null>')||' current='||coalesce(rc.returned_sqlstate,'<null>'));
end;
$scenario_20$;

-- 21. service_role nao consegue escrever diretamente antes do writer canonico.
do $scenario_21$
declare ctx pg_temp._p9_qfact_ctx%rowtype; re record; rc record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into re from pg_temp._p9_qfact_exec_json_sql('service_role', null, format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary',to_jsonb('service write'::text),'service write',
      'text','confirmed','crm_manual','runner-service-write-events','service_role.manual_runner'
    ) returning id::text as id
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a));

  select * into rc from pg_temp._p9_qfact_exec_json_sql('service_role', null, format($sql$
    insert into public.commercial_opportunity_qualification_facts_current (
      organization_id,store_id,commercial_opportunity_id,fact_key,current_state,value_json,
      normalized_value_text,value_kind,source_type,last_event_id,last_operation_key
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'need_summary','confirmed',to_jsonb('service current'::text),
      'service current','text','crm_manual',%L::uuid,'runner-service-write-current'
    ) returning fact_key
  $sql$, ctx.org_a, ctx.store_a, ctx.opp_a, gen_random_uuid()));

  perform pg_temp._p9_qfact_record(21,'service_role direto permanece fechado ate existir writer canonico',
    case when not re.operation_succeeded and re.returned_sqlstate='42501'
      and not rc.operation_succeeded and rc.returned_sqlstate='42501'
      then 'PASS' else 'SUT_FAIL' end,
    'events='||coalesce(re.returned_sqlstate,'<null>')||' current='||coalesce(rc.returned_sqlstate,'<null>'));
end;
$scenario_21$;

-- 22. Evento inferred e sua projecao coerente sao validos.
do $scenario_22$
declare ctx pg_temp._p9_qfact_ctx%rowtype; v_event uuid; v_state text; v_last_event uuid;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;

  insert into public.commercial_opportunity_qualification_fact_events (
    organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
    value_kind,assertion_level,source_type,operation_key,created_by
  ) values (
    ctx.org_a,ctx.store_a,ctx.opp_a,'need_summary',
    to_jsonb('Piscina para lazer com criancas'::text),'piscina para lazer com criancas',
    'text','inferred','system_inference','runner-valid-inferred-event','postgres.manual_runner'
  ) returning id into v_event;

  insert into public.commercial_opportunity_qualification_facts_current (
    organization_id,store_id,commercial_opportunity_id,fact_key,current_state,value_json,
    normalized_value_text,value_kind,source_type,last_event_id,last_operation_key
  ) values (
    ctx.org_a,ctx.store_a,ctx.opp_a,'need_summary','inferred',
    to_jsonb('Piscina para lazer com criancas'::text),'piscina para lazer com criancas',
    'text','system_inference',v_event,'runner-valid-inferred-event'
  );

  update pg_temp._p9_qfact_ctx set inferred_event_id = v_event;

  select current_state,last_event_id into v_state,v_last_event
  from public.commercial_opportunity_qualification_facts_current
  where organization_id=ctx.org_a and store_id=ctx.store_a
    and commercial_opportunity_id=ctx.opp_a and fact_key='need_summary';

  perform pg_temp._p9_qfact_record(22,'inferred valido e projetado com coerencia',
    case when v_state='inferred' and v_last_event=v_event then 'PASS' else 'SUT_FAIL' end,
    format('event=%s state=%s',v_event,v_state));
end;
$scenario_22$;

-- 23. Evento confirmed manual e sua projecao coerente sao validos.
do $scenario_23$
declare ctx pg_temp._p9_qfact_ctx%rowtype; v_event uuid; v_state text;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;

  insert into public.commercial_opportunity_qualification_fact_events (
    organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
    value_kind,assertion_level,source_type,operation_key,created_by
  ) values (
    ctx.org_a,ctx.store_a,ctx.opp_a,'preferred_period_text',
    to_jsonb('novembro'::text),'novembro','text','confirmed','crm_manual',
    'runner-valid-confirmed-event','postgres.manual_runner'
  ) returning id into v_event;

  insert into public.commercial_opportunity_qualification_facts_current (
    organization_id,store_id,commercial_opportunity_id,fact_key,current_state,value_json,
    normalized_value_text,value_kind,source_type,last_event_id,last_operation_key
  ) values (
    ctx.org_a,ctx.store_a,ctx.opp_a,'preferred_period_text','confirmed',
    to_jsonb('novembro'::text),'novembro','text','crm_manual',v_event,
    'runner-valid-confirmed-event'
  );

  update pg_temp._p9_qfact_ctx set confirmed_event_id = v_event;

  select current_state into v_state
  from public.commercial_opportunity_qualification_facts_current
  where organization_id=ctx.org_a and store_id=ctx.store_a
    and commercial_opportunity_id=ctx.opp_a and fact_key='preferred_period_text';

  perform pg_temp._p9_qfact_record(23,'confirmed manual valido e projetado com coerencia',
    case when v_state='confirmed' then 'PASS' else 'SUT_FAIL' end,
    format('event=%s state=%s',v_event,v_state));
end;
$scenario_23$;

-- 24. current_state invalido.
do $scenario_24$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    insert into public.commercial_opportunity_qualification_facts_current (
      organization_id,store_id,commercial_opportunity_id,fact_key,current_state,value_json,
      normalized_value_text,value_kind,source_type,last_event_id,last_operation_key
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'preferred_period_text','invalid_state',to_jsonb('novembro'::text),
      'novembro','text','crm_manual',%L::uuid,'runner-valid-confirmed-event'
    ) returning fact_key
  $sql$,ctx.org_a,ctx.store_a,ctx.opp_a,ctx.confirmed_event_id));
  perform pg_temp._p9_qfact_record(24,'current_state invalido e bloqueado',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_24$;

-- 25. conflict exige array com pelo menos dois valores.
do $scenario_25$
declare ctx pg_temp._p9_qfact_ctx%rowtype; v_event uuid; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  insert into public.commercial_opportunity_qualification_fact_events (
    organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
    value_kind,assertion_level,source_type,operation_key,created_by
  ) values (
    ctx.org_a,ctx.store_a,ctx.opp_peer,'space_text',to_jsonb('5x10'::text),'5x10',
    'text','confirmed','crm_manual','runner-conflict-invalid-base','postgres.manual_runner'
  ) returning id into v_event;

  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    insert into public.commercial_opportunity_qualification_facts_current (
      organization_id,store_id,commercial_opportunity_id,fact_key,current_state,value_json,
      normalized_value_text,value_kind,conflict_values_json,source_type,last_event_id,last_operation_key
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'space_text','conflict',null,null,'text','[]'::jsonb,
      'crm_manual',%L::uuid,'runner-conflict-invalid-base'
    ) returning fact_key
  $sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,v_event));

  perform pg_temp._p9_qfact_record(25,'conflict exige payload com ao menos dois candidatos',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_25$;

-- 26. resolves_conflict exige assertion confirmed.
do $scenario_26$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by,resolves_conflict
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'location_text',to_jsonb('Jundiai'::text),'jundiai',
      'text','inferred','system_inference','runner-resolution-inferred','postgres.manual_runner',true
    ) returning id::text as id
  $sql$,ctx.org_a,ctx.store_a,ctx.opp_peer));
  perform pg_temp._p9_qfact_record(26,'resolves_conflict exige fato confirmado',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_26$;

-- 27. migration_backfill nao pode resolver conflito.
do $scenario_27$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by,resolves_conflict
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'location_text',to_jsonb('Jundiai'::text),'jundiai',
      'text','confirmed','migration_backfill','runner-resolution-backfill','postgres.manual_runner',true
    ) returning id::text as id
  $sql$,ctx.org_a,ctx.store_a,ctx.opp_peer));
  perform pg_temp._p9_qfact_record(27,'migration_backfill nao possui autoridade para resolver conflito',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_27$;

-- 28. system_inference nao pode resolver conflito.
do $scenario_28$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by,resolves_conflict
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'location_text',to_jsonb('Jundiai'::text),'jundiai',
      'text','confirmed','system_inference','runner-resolution-system-inference','postgres.manual_runner',true
    ) returning id::text as id
  $sql$,ctx.org_a,ctx.store_a,ctx.opp_peer));
  perform pg_temp._p9_qfact_record(28,'system_inference nao possui autoridade para resolver conflito',
    case when not r.operation_succeeded and r.returned_sqlstate='23514' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_28$;

-- 29. crm_manual confirmado pode resolver conflito.
do $scenario_29$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by,resolves_conflict
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'customer_preferences_text',to_jsonb('prefere azul'::text),'prefere azul',
      'text','confirmed','crm_manual','runner-resolution-crm','postgres.manual_runner',true
    ) returning id::text as id
  $sql$,ctx.org_a,ctx.store_a,ctx.opp_peer));
  perform pg_temp._p9_qfact_record(29,'crm_manual confirmado pode marcar resolucao explicita',
    case when r.operation_succeeded then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.value_json ->> 'id',r.returned_sqlstate,'<null>'));
end;
$scenario_29$;

-- 30. system_correction confirmado pode resolver conflito.
do $scenario_30$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,operation_key,created_by,resolves_conflict
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'decision_context',to_jsonb('decisor confirmou'::text),'decisor confirmou',
      'text','confirmed','system_correction','runner-resolution-system-correction','postgres.manual_runner',true
    ) returning id::text as id
  $sql$,ctx.org_a,ctx.store_a,ctx.opp_peer));
  perform pg_temp._p9_qfact_record(30,'system_correction confirmado pode marcar resolucao explicita',
    case when r.operation_succeeded then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.value_json ->> 'id',r.returned_sqlstate,'<null>'));
end;
$scenario_30$;

-- 31. incoming_customer_message confirmado pode resolver com proveniencia explicita.
do $scenario_31$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record; v_message uuid:=gen_random_uuid(); v_conversation uuid:=gen_random_uuid();
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    insert into public.commercial_opportunity_qualification_fact_events (
      organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
      value_kind,assertion_level,source_type,source_message_id,source_conversation_id,
      operation_key,created_by,resolves_conflict
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'relevant_objection_text',to_jsonb('cliente corrigiu a objecao'::text),
      'cliente corrigiu a objecao','text','confirmed','incoming_customer_message',%L::uuid,%L::uuid,
      'runner-resolution-customer','postgres.manual_runner',true
    ) returning id::text as id
  $sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,v_message,v_conversation));
  perform pg_temp._p9_qfact_record(31,'incoming_customer_message confirmado pode resolver com proveniencia',
    case when r.operation_succeeded then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.value_json ->> 'id',r.returned_sqlstate,'<null>'));
end;
$scenario_31$;

-- 32. last_operation_key precisa corresponder ao evento fonte.
do $scenario_32$
declare ctx pg_temp._p9_qfact_ctx%rowtype; v_event uuid; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  insert into public.commercial_opportunity_qualification_fact_events (
    organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
    value_kind,assertion_level,source_type,operation_key,created_by
  ) values (
    ctx.org_a,ctx.store_a,ctx.opp_peer,'payment_interest',to_jsonb(true),null,
    'boolean','confirmed','crm_manual','runner-operation-match-event','postgres.manual_runner'
  ) returning id into v_event;

  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    insert into public.commercial_opportunity_qualification_facts_current (
      organization_id,store_id,commercial_opportunity_id,fact_key,current_state,value_json,
      normalized_value_text,value_kind,source_type,last_event_id,last_operation_key
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'payment_interest','confirmed',to_jsonb(true),null,
      'boolean','crm_manual',%L::uuid,'runner-wrong-operation-key'
    ) returning fact_key
  $sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,v_event));
  perform pg_temp._p9_qfact_record(32,'current last_operation_key precisa corresponder ao evento fonte',
    case when not r.operation_succeeded and r.returned_sqlstate='P0001' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.message_text,r.returned_sqlstate,'<null>'));
end;
$scenario_32$;

-- 33. Proveniencia da projecao precisa corresponder ao evento fonte.
do $scenario_33$
declare ctx pg_temp._p9_qfact_ctx%rowtype; v_event uuid; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  insert into public.commercial_opportunity_qualification_fact_events (
    organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
    value_kind,assertion_level,source_type,operation_key,created_by
  ) values (
    ctx.org_a,ctx.store_a,ctx.opp_peer,'installation_interest',to_jsonb(true),null,
    'boolean','confirmed','crm_manual','runner-provenance-event','postgres.manual_runner'
  ) returning id into v_event;

  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    insert into public.commercial_opportunity_qualification_facts_current (
      organization_id,store_id,commercial_opportunity_id,fact_key,current_state,value_json,
      normalized_value_text,value_kind,source_type,last_event_id,last_operation_key
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'installation_interest','confirmed',to_jsonb(true),null,
      'boolean','system_correction',%L::uuid,'runner-provenance-event'
    ) returning fact_key
  $sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,v_event));
  perform pg_temp._p9_qfact_record(33,'current preserva a proveniencia exata do ultimo evento',
    case when not r.operation_succeeded and r.returned_sqlstate='P0001' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.message_text,r.returned_sqlstate,'<null>'));
end;
$scenario_33$;

-- 34. Evento de resolucao nao pode continuar materializado como conflict.
do $scenario_34$
declare ctx pg_temp._p9_qfact_ctx%rowtype; v_event uuid; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  insert into public.commercial_opportunity_qualification_fact_events (
    organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
    value_kind,assertion_level,source_type,operation_key,created_by,resolves_conflict
  ) values (
    ctx.org_a,ctx.store_a,ctx.opp_peer,'technical_visit_interest',to_jsonb(true),null,
    'boolean','confirmed','system_correction','runner-resolved-event','postgres.manual_runner',true
  ) returning id into v_event;

  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    insert into public.commercial_opportunity_qualification_facts_current (
      organization_id,store_id,commercial_opportunity_id,fact_key,current_state,value_json,
      normalized_value_text,value_kind,conflict_values_json,source_type,last_event_id,last_operation_key
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'technical_visit_interest','conflict',null,null,'boolean',
      jsonb_build_array(jsonb_build_object('value',true),jsonb_build_object('value',false)),
      'system_correction',%L::uuid,'runner-resolved-event'
    ) returning fact_key
  $sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,v_event));

  perform pg_temp._p9_qfact_record(34,'resolucao confirmada nao pode permanecer materializada como conflict',
    case when not r.operation_succeeded and r.returned_sqlstate='P0001' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.message_text,r.returned_sqlstate,'<null>'));
end;
$scenario_34$;

-- 35. Evento confirmado nao-resolutivo pode materializar conflito coerente.
do $scenario_35$
declare ctx pg_temp._p9_qfact_ctx%rowtype; v_event uuid; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  insert into public.commercial_opportunity_qualification_fact_events (
    organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
    value_kind,assertion_level,source_type,operation_key,created_by
  ) values (
    ctx.org_a,ctx.store_a,ctx.opp_peer,'location_text',to_jsonb('Jundiai'::text),'jundiai',
    'text','confirmed','crm_manual','runner-conflict-valid-event','postgres.manual_runner'
  ) returning id into v_event;

  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    insert into public.commercial_opportunity_qualification_facts_current (
      organization_id,store_id,commercial_opportunity_id,fact_key,current_state,value_json,
      normalized_value_text,value_kind,conflict_values_json,source_type,last_event_id,last_operation_key
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'location_text','conflict',null,null,'text',
      jsonb_build_array(jsonb_build_object('value','Campinas'),jsonb_build_object('value','Jundiai')),
      'crm_manual',%L::uuid,'runner-conflict-valid-event'
    ) returning fact_key
  $sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,v_event));

  perform pg_temp._p9_qfact_record(35,'confirmed divergente nao-resolutivo pode materializar conflict',
    case when r.operation_succeeded then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.value_json ->> 'fact_key',r.returned_sqlstate,'<null>'));
end;
$scenario_35$;

-- 36. last_event precisa pertencer ao mesmo tenant/store/opportunity/fact.
do $scenario_36$
declare ctx pg_temp._p9_qfact_ctx%rowtype; r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    insert into public.commercial_opportunity_qualification_facts_current (
      organization_id,store_id,commercial_opportunity_id,fact_key,current_state,value_json,
      normalized_value_text,value_kind,source_type,last_event_id,last_operation_key
    ) values (
      %L::uuid,%L::uuid,%L::uuid,'interested_product_reference','confirmed',to_jsonb('Produto X'::text),'produto x',
      'text','crm_manual',%L::uuid,'runner-rls-event-b'
    ) returning fact_key
  $sql$,ctx.org_a,ctx.store_a,ctx.opp_peer,ctx.rls_event_b));

  perform pg_temp._p9_qfact_record(36,'last_event de outro escopo e bloqueado pela FK composta',
    case when not r.operation_succeeded and r.returned_sqlstate='23503' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.returned_sqlstate,'<null>')||' '||coalesce(r.constraint_name,'<no-constraint>'));
end;
$scenario_36$;

-- 37. Ledger de eventos permanece append-only.
do $scenario_37$
declare ctx pg_temp._p9_qfact_ctx%rowtype; ru record; rd record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;
  select * into ru from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    update public.commercial_opportunity_qualification_fact_events
    set normalized_value_text='mutated'
    where id=%L::uuid
    returning id::text as id
  $sql$,ctx.inferred_event_id));

  select * into rd from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    delete from public.commercial_opportunity_qualification_fact_events
    where id=%L::uuid
    returning id::text as id
  $sql$,ctx.confirmed_event_id));

  perform pg_temp._p9_qfact_record(37,'ledger de eventos permanece append-only',
    case when not ru.operation_succeeded and ru.returned_sqlstate='P0001'
      and not rd.operation_succeeded and rd.returned_sqlstate='P0001'
      then 'PASS' else 'SUT_FAIL' end,
    'update='||coalesce(ru.message_text,ru.returned_sqlstate,'<null>')||
      ' delete='||coalesce(rd.message_text,rd.returned_sqlstate,'<null>'));
end;
$scenario_37$;

-- 38. updated_at e tocado em update valido da projecao.
do $scenario_38$
declare
  ctx pg_temp._p9_qfact_ctx%rowtype;
  v_before timestamptz;
  v_after timestamptz;
  v_event uuid;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;

  select updated_at into v_before
  from public.commercial_opportunity_qualification_facts_current
  where organization_id=ctx.org_a and store_id=ctx.store_a
    and commercial_opportunity_id=ctx.opp_a and fact_key='preferred_period_text';

  perform pg_catalog.pg_sleep(0.01);

  insert into public.commercial_opportunity_qualification_fact_events (
    organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
    value_kind,assertion_level,source_type,operation_key,created_by
  ) values (
    ctx.org_a,ctx.store_a,ctx.opp_a,'preferred_period_text',
    to_jsonb('dezembro'::text),'dezembro','text','confirmed','crm_manual',
    'runner-updated-at-next-event','postgres.manual_runner'
  ) returning id into v_event;

  update public.commercial_opportunity_qualification_facts_current
  set current_state='confirmed',
      value_json=to_jsonb('dezembro'::text),
      normalized_value_text='dezembro',
      value_kind='text',
      conflict_values_json=null,
      source_type='crm_manual',
      source_message_id=null,
      source_conversation_id=null,
      last_event_id=v_event,
      last_operation_key='runner-updated-at-next-event'
  where organization_id=ctx.org_a and store_id=ctx.store_a
    and commercial_opportunity_id=ctx.opp_a and fact_key='preferred_period_text';

  select updated_at into v_after
  from public.commercial_opportunity_qualification_facts_current
  where organization_id=ctx.org_a and store_id=ctx.store_a
    and commercial_opportunity_id=ctx.opp_a and fact_key='preferred_period_text';

  perform pg_temp._p9_qfact_record(38,'updated_at avanca em atualizacao valida da projecao',
    case when v_after > v_before then 'PASS' else 'SUT_FAIL' end,
    format('before=%s after=%s',v_before,v_after));
end;
$scenario_38$;

-- 39. A identidade da linha current nao pode ser movida entre facts/opportunities.
do $scenario_39$
declare
  ctx pg_temp._p9_qfact_ctx%rowtype;
  v_event uuid;
  r record;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;

  insert into public.commercial_opportunity_qualification_fact_events (
    organization_id,store_id,commercial_opportunity_id,fact_key,value_json,normalized_value_text,
    value_kind,assertion_level,source_type,operation_key,created_by
  ) values (
    ctx.org_a,ctx.store_a,ctx.opp_a,'need_summary',
    to_jsonb('Nova necessidade confirmada'::text),'nova necessidade confirmada',
    'text','confirmed','crm_manual','runner-current-identity-event','postgres.manual_runner'
  ) returning id into v_event;

  select * into r from pg_temp._p9_qfact_exec_json_sql('postgres',null,format($sql$
    update public.commercial_opportunity_qualification_facts_current
    set fact_key='space_text',
        current_state='confirmed',
        value_json=to_jsonb('Nova necessidade confirmada'::text),
        normalized_value_text='nova necessidade confirmada',
        value_kind='text',
        source_type='crm_manual',
        source_message_id=null,
        source_conversation_id=null,
        last_event_id=%L::uuid,
        last_operation_key='runner-current-identity-event'
    where organization_id=%L::uuid
      and store_id=%L::uuid
      and commercial_opportunity_id=%L::uuid
      and fact_key='need_summary'
    returning fact_key
  $sql$,v_event,ctx.org_a,ctx.store_a,ctx.opp_a));

  perform pg_temp._p9_qfact_record(39,'identidade da projecao current e imutavel em UPDATE',
    case when not r.operation_succeeded and r.returned_sqlstate='P0001' then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.message_text,r.returned_sqlstate,'<null>'));
end;
$scenario_39$;

-- 40. Fixtures e writes do runner permanecem na transacao antes do rollback final.
do $scenario_40$
declare
  ctx pg_temp._p9_qfact_ctx%rowtype;
  v_org_count integer;
  v_store_count integer;
  v_customer_count integer;
  v_opportunity_count integer;
  v_event_count integer;
  v_current_count integer;
begin
  select * into ctx from pg_temp._p9_qfact_ctx;

  select count(*) into v_org_count
  from public.organizations where id in (ctx.org_a,ctx.org_b);
  select count(*) into v_store_count
  from public.stores where id in (ctx.store_a,ctx.store_b_same_org,ctx.store_c_other_org);
  select count(*) into v_customer_count
  from public.customers where id in (ctx.customer_a,ctx.customer_b);
  select count(*) into v_opportunity_count
  from public.commercial_opportunities where id in (ctx.opp_a,ctx.opp_peer,ctx.opp_other_org);
  select count(*) into v_event_count
  from public.commercial_opportunity_qualification_fact_events
  where commercial_opportunity_id in (ctx.opp_a,ctx.opp_peer,ctx.opp_other_org);
  select count(*) into v_current_count
  from public.commercial_opportunity_qualification_facts_current
  where commercial_opportunity_id in (ctx.opp_a,ctx.opp_peer,ctx.opp_other_org);

  perform pg_temp._p9_qfact_record(40,'runner mantem fixtures na transacao e termina com rollback',
    case when v_org_count=2 and v_store_count=3 and v_customer_count=2
      and v_opportunity_count=3 and v_event_count>=12 and v_current_count>=5
      then 'PASS' else 'SUT_FAIL' end,
    format('orgs=%s stores=%s customers=%s opps=%s events=%s current=%s final_statement=ROLLBACK',
      v_org_count,v_store_count,v_customer_count,v_opportunity_count,v_event_count,v_current_count));
end;
$scenario_40$;

select
  scenario_number,
  scenario_name,
  status,
  detail
from pg_temp._p9_qfact_results
order by scenario_number;

rollback;
