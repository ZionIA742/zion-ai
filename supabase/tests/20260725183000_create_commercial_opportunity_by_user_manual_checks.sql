begin;

set local lock_timeout = '3s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

drop table if exists pg_temp._p9_13_results;
drop table if exists pg_temp._p9_13_ctx;

create temp table pg_temp._p9_13_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null,
  returned_sqlstate text null,
  constraint_name text null
) on commit preserve rows;

create temp table pg_temp._p9_13_ctx (
  singleton boolean primary key default true check (singleton),
  run_id uuid not null default gen_random_uuid(),
  org_a uuid not null default gen_random_uuid(),
  org_b uuid not null default gen_random_uuid(),
  store_a uuid not null default gen_random_uuid(),
  store_b uuid not null default gen_random_uuid(),
  user_a uuid not null default gen_random_uuid(),
  user_b uuid not null default gen_random_uuid(),
  user_c uuid not null default gen_random_uuid(),
  customer_a uuid not null default gen_random_uuid(),
  customer_a2 uuid not null default gen_random_uuid(),
  customer_a3 uuid not null default gen_random_uuid(),
  customer_b uuid not null default gen_random_uuid(),
  opp_existing_lost uuid not null default gen_random_uuid(),
  opp_existing_concluded uuid not null default gen_random_uuid(),
  opp_new_1 uuid not null default gen_random_uuid(),
  opp_new_2 uuid not null default gen_random_uuid(),
  opp_customer_other_org uuid not null default gen_random_uuid(),
  opp_store_other_org uuid not null default gen_random_uuid(),
  opp_customer_unlinked uuid not null default gen_random_uuid(),
  opp_no_membership uuid not null default gen_random_uuid(),
  opp_after_lost uuid not null default gen_random_uuid(),
  opp_after_concluded uuid not null default gen_random_uuid(),
  opp_probe uuid not null default gen_random_uuid(),
  opp_direct_insert uuid not null default gen_random_uuid(),
  opp_new_2_created_at timestamptz null,
  opp_new_2_updated_at timestamptz null
) on commit preserve rows;

insert into pg_temp._p9_13_ctx default values;

create or replace function pg_temp._p9_13_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_pass boolean,
  p_detail text,
  p_returned_sqlstate text default null,
  p_constraint_name text default null
)
returns void
language plpgsql
as $function$
declare
  v_status text := case when p_pass then 'PASS' else 'SUT_FAIL' end;
begin
  insert into pg_temp._p9_13_results (
    scenario_number,
    scenario_name,
    status,
    detail,
    returned_sqlstate,
    constraint_name
  )
  values (
    p_scenario_number,
    p_scenario_name,
    v_status,
    coalesce(p_detail, '<null>'),
    p_returned_sqlstate,
    p_constraint_name
  );
end;
$function$;

create or replace function pg_temp._p9_13_exec_value_sql(
  p_role text,
  p_user_id uuid,
  p_sql text,
  p_rollback_on_success boolean default false
)
returns table (
  operation_succeeded boolean,
  value_text text,
  returned_sqlstate text,
  message_text text,
  constraint_name text
)
language plpgsql
as $function$
declare
  v_value text;
  v_state text;
  v_message text;
  v_constraint text;
  v_operation_succeeded boolean := false;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config(
    'request.jwt.claims',
    case
      when p_user_id is null then jsonb_build_object('role', p_role)::text
      else jsonb_build_object('role', p_role, 'sub', p_user_id::text)::text
    end,
    true
  );

  begin
    execute p_sql into v_value;
    if p_rollback_on_success then
      raise exception using
        errcode = 'P913R',
        message = 'P9_13_ROLLBACK_ON_SUCCESS';
    end if;
    v_operation_succeeded := true;
  exception
    when sqlstate 'P913R' then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      if p_rollback_on_success
         and v_state = 'P913R'
         and v_message = 'P9_13_ROLLBACK_ON_SUCCESS' then
        v_operation_succeeded := true;
        v_state := null;
        v_message := null;
        v_constraint := null;
      else
        raise;
      end if;
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      v_operation_succeeded := false;
  end;

  begin
    execute 'reset role';
  exception
    when others then
      null;
  end;

  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  return query
  select
    v_operation_succeeded,
    case when v_operation_succeeded then v_value else null::text end,
    v_state,
    v_message,
    v_constraint;
end;
$function$;

create or replace function pg_temp._p9_13_exec_stmt_sql(
  p_role text,
  p_user_id uuid,
  p_sql text,
  p_rollback_on_success boolean default false
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
  v_operation_succeeded boolean := false;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config(
    'request.jwt.claims',
    case
      when p_user_id is null then jsonb_build_object('role', p_role)::text
      else jsonb_build_object('role', p_role, 'sub', p_user_id::text)::text
    end,
    true
  );

  begin
    execute p_sql;
    if p_rollback_on_success then
      raise exception using
        errcode = 'P913R',
        message = 'P9_13_ROLLBACK_ON_SUCCESS';
    end if;
    v_operation_succeeded := true;
  exception
    when sqlstate 'P913R' then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      if p_rollback_on_success
         and v_state = 'P913R'
         and v_message = 'P9_13_ROLLBACK_ON_SUCCESS' then
        v_operation_succeeded := true;
        v_state := null;
        v_message := null;
        v_constraint := null;
      else
        raise;
      end if;
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      v_operation_succeeded := false;
  end;

  begin
    execute 'reset role';
  exception
    when others then
      null;
  end;

  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  return query
  select
    v_operation_succeeded,
    v_state,
    v_message,
    v_constraint;
end;
$function$;

revoke all on function pg_temp._p9_13_record(integer, text, boolean, text, text, text) from public;
revoke all on function pg_temp._p9_13_exec_value_sql(text, uuid, text, boolean) from public;
revoke all on function pg_temp._p9_13_exec_stmt_sql(text, uuid, text, boolean) from public;

do $setup$
declare
  v pg_temp._p9_13_ctx;
begin
  select * into v from pg_temp._p9_13_ctx;

  if not found then
    perform pg_temp._p9_13_record(
      0,
      'setup fixture row missing in _p9_13_ctx',
      false,
      'runner setup expected one context row in pg_temp._p9_13_ctx before creating fixtures'
    );
    return;
  end if;

  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token,
    is_sso_user,
    is_anonymous
  )
  values
    (
      v.user_a,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'runner-p913-user-a-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('runner', true, 'key', 'user_a'),
      now(),
      now(),
      '',
      '',
      '',
      '',
      false,
      false
    ),
    (
      v.user_b,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'runner-p913-user-b-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('runner', true, 'key', 'user_b'),
      now(),
      now(),
      '',
      '',
      '',
      '',
      false,
      false
    ),
    (
      v.user_c,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'runner-p913-user-c-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('runner', true, 'key', 'user_c'),
      now(),
      now(),
      '',
      '',
      '',
      '',
      false,
      false
    );

  insert into public.organizations (id, name)
  values
    (v.org_a, 'Runner Org A ' || v.run_id::text),
    (v.org_b, 'Runner Org B ' || v.run_id::text);

  insert into public.memberships (organization_id, user_id, role)
  values
    (v.org_a, v.user_a, 'owner'),
    (v.org_b, v.user_b, 'owner');

  insert into public.stores (id, organization_id, name, created_at)
  values
    (v.store_a, v.org_a, 'Runner Store A ' || v.run_id::text, now()),
    (v.store_b, v.org_b, 'Runner Store B ' || v.run_id::text, now());

  insert into public.customers (id, organization_id, display_name, normalized_name)
  values
    (v.customer_a, v.org_a, 'Runner Customer A', 'runner customer a'),
    (v.customer_a2, v.org_a, 'Runner Customer A2', 'runner customer a2'),
    (v.customer_a3, v.org_a, 'Runner Customer A3', 'runner customer a3'),
    (v.customer_b, v.org_b, 'Runner Customer B', 'runner customer b');

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  values
    (v.org_a, v.store_a, v.customer_a),
    (v.org_a, v.store_a, v.customer_a2),
    (v.org_b, v.store_b, v.customer_b);

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage
  )
  values
    (v.opp_existing_lost, v.org_a, v.store_a, v.customer_a, 'novo_lead'),
    (v.opp_existing_concluded, v.org_a, v.store_a, v.customer_a, 'concluido_sem_mais_acoes');
end;
$setup$;

do $scenarios$
declare
  v pg_temp._p9_13_ctx;
  v_sql text;
  v_json jsonb;
  v_result record;
  v_count integer;
  v_stage text;
  v_updated_at timestamptz;
  v_created_at timestamptz;
  v_public_can_execute boolean;
  v_anon_can_execute boolean;
  v_loss_exists boolean;
  v_reopen_exists boolean;
  v_reopen_granted boolean;
  v_count_after integer;
begin
  select * into v from pg_temp._p9_13_ctx;

  if not found then
    perform pg_temp._p9_13_record(
      0,
      'scenario fixture row missing in _p9_13_ctx',
      false,
      'runner scenarios expected one context row in pg_temp._p9_13_ctx after setup'
    );
    return;
  end if;

  v_sql := format(
    $sql$
      select 1
      from public.mark_commercial_opportunity_lost_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L,
        'explicit_refusal',
        'fixture lost opportunity',
        null,
        null,
        'runner_seed_loss'
      )
      limit 1
    $sql$,
    v.org_a,
    v.store_a,
    v.opp_existing_lost,
    'runner:' || v.run_id::text || ':seed-lost'
  );

  select * into v_result
  from pg_temp._p9_13_exec_value_sql('authenticated', v.user_a, v_sql);

  if not v_result.operation_succeeded then
    raise exception using
      errcode = 'P0001',
      message = 'runner setup failed: seed loss RPC was not executable',
      detail = coalesce(v_result.message_text, '<null>');
  end if;

  v_sql := format(
    $sql$
      select row_to_json(created_row)::text
      from public.create_commercial_opportunity_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid
      ) as created_row
    $sql$,
    v.org_a,
    v.store_a,
    v.customer_a,
    v.opp_new_1
  );

  select * into v_result
  from pg_temp._p9_13_exec_value_sql('authenticated', v.user_a, v_sql);

  v_json := case when v_result.operation_succeeded then v_result.value_text::jsonb else null end;

  perform pg_temp._p9_13_record(
    1,
    'customer vinculado a store correta permite a primeira criacao',
    v_result.operation_succeeded
      and v_json ->> 'commercial_opportunity_id' = v.opp_new_1::text
      and v_json ->> 'organization_id' = v.org_a::text
      and v_json ->> 'store_id' = v.store_a::text
      and v_json ->> 'customer_id' = v.customer_a::text
      and v_json ->> 'stage' = 'novo_lead'
      and (v_json ->> 'lifecycle_cycle')::integer = 1,
    case
      when v_result.operation_succeeded then 'created=' || v_result.value_text
      else coalesce(v_result.message_text, '<null>')
    end,
    v_result.returned_sqlstate,
    v_result.constraint_name
  );

  v_sql := format(
    $sql$
      select row_to_json(created_row)::text
      from public.create_commercial_opportunity_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid
      ) as created_row
    $sql$,
    v.org_a,
    v.store_a,
    v.customer_a,
    v.opp_new_2
  );

  select * into v_result
  from pg_temp._p9_13_exec_value_sql('authenticated', v.user_a, v_sql);

  v_json := case when v_result.operation_succeeded then v_result.value_text::jsonb else null end;

  if v_result.operation_succeeded then
    select created_at, updated_at
    into v_created_at, v_updated_at
    from public.commercial_opportunities
    where id = v.opp_new_2;

    update pg_temp._p9_13_ctx
    set
      opp_new_2_created_at = v_created_at,
      opp_new_2_updated_at = v_updated_at;

    select * into v from pg_temp._p9_13_ctx;

    if not found then
      perform pg_temp._p9_13_record(
        0,
        'updated fixture row missing in _p9_13_ctx',
        false,
        'runner scenarios updated pg_temp._p9_13_ctx but could not reload the context row'
      );
      return;
    end if;
  end if;

  perform pg_temp._p9_13_record(
    2,
    'criacao de segunda oportunidade para o mesmo customer',
    v_result.operation_succeeded
      and v_json ->> 'commercial_opportunity_id' = v.opp_new_2::text
      and v_json ->> 'customer_id' = v.customer_a::text
      and v_json ->> 'stage' = 'novo_lead',
    case
      when v_result.operation_succeeded then 'created=' || v_result.value_text
      else coalesce(v_result.message_text, '<null>')
    end,
    v_result.returned_sqlstate,
    v_result.constraint_name
  );

  select pg_catalog.count(*)
  into v_count
  from public.commercial_opportunities opportunity_row
  where opportunity_row.organization_id = v.org_a
    and opportunity_row.store_id = v.store_a
    and opportunity_row.customer_id = v.customer_a
    and opportunity_row.id in (v.opp_new_1, v.opp_new_2);

  perform pg_temp._p9_13_record(
    3,
    'coexistencia de duas oportunidades do mesmo customer',
    v_count = 2,
    'count=' || v_count::text,
    null,
    null
  );

  v_sql := format(
    $sql$
      select row_to_json(created_row)::text
      from public.create_commercial_opportunity_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid
      ) as created_row
    $sql$,
    v.org_a,
    v.store_a,
    v.customer_a,
    v.opp_new_2
  );

  select * into v_result
  from pg_temp._p9_13_exec_value_sql('authenticated', v.user_a, v_sql);

  v_json := case when v_result.operation_succeeded then v_result.value_text::jsonb else null end;

  select pg_catalog.count(*), created_at, updated_at
  into v_count, v_created_at, v_updated_at
  from public.commercial_opportunities
  where id = v.opp_new_2
  group by created_at, updated_at;

  perform pg_temp._p9_13_record(
    4,
    'mesma opportunity_id e mesmo escopo e idempotente',
    v_result.operation_succeeded
      and v_json ->> 'commercial_opportunity_id' = v.opp_new_2::text
      and v_count = 1
      and v_created_at = v.opp_new_2_created_at
      and v_updated_at = v.opp_new_2_updated_at,
    case
      when v_result.operation_succeeded then
        'count=' || v_count::text || '; row=' || v_result.value_text
      else
        coalesce(v_result.message_text, '<null>')
    end,
    v_result.returned_sqlstate,
    v_result.constraint_name
  );

  v_sql := format(
    $sql$
      select row_to_json(created_row)::text
      from public.create_commercial_opportunity_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid
      ) as created_row
    $sql$,
    v.org_b,
    v.store_b,
    v.customer_b,
    v.opp_new_2
  );

  select * into v_result
  from pg_temp._p9_13_exec_value_sql('authenticated', v.user_b, v_sql);

  select pg_catalog.count(*)
  into v_count
  from public.commercial_opportunities
  where id = v.opp_new_2
    and organization_id = v.org_b;

  perform pg_temp._p9_13_record(
    5,
    'mesma opportunity_id com escopo diferente e rejeitada',
    not v_result.operation_succeeded
      and v_result.returned_sqlstate = '23514'
      and v_result.message_text = 'commercial opportunity scope mismatch',
    coalesce(v_result.message_text, '<null>') || '; created_rows=' || v_count::text,
    v_result.returned_sqlstate,
    v_result.constraint_name
  );

  v_sql := format(
    $sql$
      select row_to_json(created_row)::text
      from public.create_commercial_opportunity_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid
      ) as created_row
    $sql$,
    v.org_a,
    v.store_a,
    v.customer_b,
    v.opp_customer_other_org
  );

  select * into v_result
  from pg_temp._p9_13_exec_value_sql('authenticated', v.user_a, v_sql);

  select pg_catalog.count(*)
  into v_count
  from public.commercial_opportunities
  where id = v.opp_customer_other_org;

  perform pg_temp._p9_13_record(
    6,
    'customer de outra organizacao e rejeitado',
    not v_result.operation_succeeded
      and v_result.returned_sqlstate = '23503'
      and v_result.message_text = 'commercial opportunity customer scope not found'
      and v_count = 0,
    coalesce(v_result.message_text, '<null>') || '; created_rows=' || v_count::text,
    v_result.returned_sqlstate,
    v_result.constraint_name
  );

  v_sql := format(
    $sql$
      select row_to_json(created_row)::text
      from public.create_commercial_opportunity_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid
      ) as created_row
    $sql$,
    v.org_a,
    v.store_b,
    v.customer_a,
    v.opp_store_other_org
  );

  select * into v_result
  from pg_temp._p9_13_exec_value_sql('authenticated', v.user_a, v_sql);

  select pg_catalog.count(*)
  into v_count
  from public.commercial_opportunities
  where id = v.opp_store_other_org;

  perform pg_temp._p9_13_record(
    7,
    'store de outra organizacao e rejeitada',
    not v_result.operation_succeeded
      and v_result.returned_sqlstate = '23503'
      and v_result.message_text = 'commercial opportunity store scope not found'
      and v_count = 0,
    coalesce(v_result.message_text, '<null>') || '; created_rows=' || v_count::text,
    v_result.returned_sqlstate,
    v_result.constraint_name
  );

  v_sql := format(
    $sql$
      select row_to_json(created_row)::text
      from public.create_commercial_opportunity_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid
      ) as created_row
    $sql$,
    v.org_a,
    v.store_a,
    v.customer_a3,
    v.opp_customer_unlinked
  );

  select * into v_result
  from pg_temp._p9_13_exec_value_sql('authenticated', v.user_a, v_sql);

  select pg_catalog.count(*)
  into v_count
  from public.commercial_opportunities
  where id = v.opp_customer_unlinked;

  perform pg_temp._p9_13_record(
    8,
    'customer da mesma organizacao sem vinculo valido com a store e rejeitado',
    not v_result.operation_succeeded
      and v_result.returned_sqlstate = '23503'
      and v_result.message_text = 'commercial opportunity customer store link not found'
      and v_count = 0,
    coalesce(v_result.message_text, '<null>') || '; created_rows=' || v_count::text,
    v_result.returned_sqlstate,
    v_result.constraint_name
  );

  v_sql := format(
    $sql$
      select row_to_json(created_row)::text
      from public.create_commercial_opportunity_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid
      ) as created_row
    $sql$,
    v.org_a,
    v.store_a,
    v.customer_a,
    v.opp_no_membership
  );

  select * into v_result
  from pg_temp._p9_13_exec_value_sql('authenticated', v.user_c, v_sql);

  select pg_catalog.count(*)
  into v_count
  from public.commercial_opportunities
  where id = v.opp_no_membership;

  perform pg_temp._p9_13_record(
    9,
    'authenticated sem membership na organizacao e rejeitado',
    not v_result.operation_succeeded
      and v_result.returned_sqlstate = '42501'
      and v_result.message_text = 'commercial opportunity creation by user is not authorized'
      and v_count = 0,
    coalesce(v_result.message_text, '<null>') || '; created_rows=' || v_count::text,
    v_result.returned_sqlstate,
    v_result.constraint_name
  );

  v_sql := format(
    $sql$
      select row_to_json(created_row)::text
      from public.create_commercial_opportunity_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid
      ) as created_row
    $sql$,
    v.org_a,
    v.store_a,
    v.customer_a,
    v.opp_after_lost
  );

  select * into v_result
  from pg_temp._p9_13_exec_value_sql('authenticated', v.user_a, v_sql);

  select stage into v_stage
  from public.commercial_opportunities
  where id = v.opp_existing_lost;

  select pg_catalog.count(*)
  into v_count
  from public.commercial_opportunities
  where id in (v.opp_existing_lost, v.opp_after_lost);

  perform pg_temp._p9_13_record(
    10,
    'oportunidade perdida existente nao e reutilizada',
    v_result.operation_succeeded
      and v_stage = 'perdido'
      and v_count = 2,
    case
      when v_result.operation_succeeded then
        'lost_stage=' || coalesce(v_stage, '<null>') || '; pair_count=' || v_count::text
      else
        coalesce(v_result.message_text, '<null>')
    end,
    v_result.returned_sqlstate,
    v_result.constraint_name
  );

  v_sql := format(
    $sql$
      select row_to_json(created_row)::text
      from public.create_commercial_opportunity_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid
      ) as created_row
    $sql$,
    v.org_a,
    v.store_a,
    v.customer_a,
    v.opp_after_concluded
  );

  select * into v_result
  from pg_temp._p9_13_exec_value_sql('authenticated', v.user_a, v_sql);

  select stage into v_stage
  from public.commercial_opportunities
  where id = v.opp_existing_concluded;

  perform pg_temp._p9_13_record(
    11,
    'oportunidade concluida existente nao bloqueia uma nova',
    v_result.operation_succeeded
      and v_stage = 'concluido_sem_mais_acoes',
    case
      when v_result.operation_succeeded then
        'concluded_stage=' || coalesce(v_stage, '<null>') || '; row=' || v_result.value_text
      else
        coalesce(v_result.message_text, '<null>')
    end,
    v_result.returned_sqlstate,
    v_result.constraint_name
  );

  select created_at, updated_at, stage
  into v_created_at, v_updated_at, v_stage
  from public.commercial_opportunities
  where id = v.opp_new_2;

  perform pg_temp._p9_13_record(
    12,
    'nenhuma oportunidade anterior e modificada',
    v_created_at = v.opp_new_2_created_at
      and v_updated_at = v.opp_new_2_updated_at
      and v_stage = 'novo_lead',
    'created_at=' || coalesce(v_created_at::text, '<null>')
      || '; updated_at=' || coalesce(v_updated_at::text, '<null>')
      || '; stage=' || coalesce(v_stage, '<null>'),
    null,
    null
  );

  v_sql := format(
    $sql$
      insert into public.commercial_opportunities (
        id,
        organization_id,
        store_id,
        customer_id,
        stage
      )
      values (
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid,
        'novo_lead'
      )
    $sql$,
    v.opp_direct_insert,
    v.org_a,
    v.store_a,
    v.customer_a2
  );

  select * into v_result
  from pg_temp._p9_13_exec_stmt_sql('authenticated', v.user_a, v_sql);

  perform pg_temp._p9_13_record(
    13,
    'insert direto continua bloqueado',
    not v_result.operation_succeeded,
    coalesce(v_result.message_text, '<null>'),
    v_result.returned_sqlstate,
    v_result.constraint_name
  );

  v_public_can_execute := pg_catalog.has_function_privilege(
    'public',
    'public.create_commercial_opportunity_by_user(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure,
    'EXECUTE'
  );
  v_anon_can_execute := pg_catalog.has_function_privilege(
    'anon',
    'public.create_commercial_opportunity_by_user(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure,
    'EXECUTE'
  );

  v_sql := format(
    $sql$
      select row_to_json(created_row)::text
      from public.create_commercial_opportunity_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid
      ) as created_row
    $sql$,
    v.org_a,
    v.store_a,
    v.customer_a2,
    gen_random_uuid()
  );

  select * into v_result
  from pg_temp._p9_13_exec_value_sql('anon', null, v_sql);

  perform pg_temp._p9_13_record(
    14,
    'public e anon nao executam a funcao',
    not v_public_can_execute
      and not v_anon_can_execute
      and not v_result.operation_succeeded,
    'public=' || v_public_can_execute::text
      || '; anon=' || v_anon_can_execute::text
      || '; anon_error=' || coalesce(v_result.message_text, '<null>'),
    v_result.returned_sqlstate,
    v_result.constraint_name
  );

  v_loss_exists := pg_catalog.to_regprocedure(
    'public.mark_commercial_opportunity_lost_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)'
  ) is not null;
  v_reopen_exists := pg_catalog.to_regprocedure(
    'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)'
  ) is not null;
  v_reopen_granted := pg_catalog.has_function_privilege(
    'authenticated',
    'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)'::pg_catalog.regprocedure,
    'EXECUTE'
  );

  perform pg_temp._p9_13_record(
    15,
    'a funcao nao altera as RPCs de perda e reabertura',
    v_loss_exists and v_reopen_exists and v_reopen_granted,
    'loss_exists=' || v_loss_exists::text
      || '; reopen_exists=' || v_reopen_exists::text
      || '; reopen_granted=' || v_reopen_granted::text,
    null,
    null
  );

  v_sql := format(
    $sql$
      select row_to_json(created_row)::text
      from public.create_commercial_opportunity_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid
      ) as created_row
    $sql$,
    v.org_a,
    v.store_a,
    v.customer_a2,
    v.opp_probe
  );

  select * into v_result
  from pg_temp._p9_13_exec_value_sql('authenticated', v.user_a, v_sql, true);

  select pg_catalog.count(*)
  into v_count
  from public.commercial_opportunities
  where id = v.opp_probe;

  select pg_catalog.count(*)
  into v_count_after
  from public.commercial_opportunities
  where id = v.opp_probe;

  perform pg_temp._p9_13_record(
    16,
    'todas as fixtures podem ser revertidas por rollback',
    v_result.operation_succeeded
      and v_count = 0
      and v_count_after = 0,
    'after_helper_rollback_count=' || v_count::text
      || '; final_count=' || v_count_after::text,
    v_result.returned_sqlstate,
    v_result.constraint_name
  );
end;
$scenarios$;

table pg_temp._p9_13_results
order by scenario_number;

select
  pg_catalog.count(*) as failed_scenarios
from pg_temp._p9_13_results result_row
where result_row.status <> 'PASS';

rollback;
