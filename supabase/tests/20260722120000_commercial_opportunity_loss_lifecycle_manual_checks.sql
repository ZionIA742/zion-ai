-- ZION / Pilar 9 / Bloco 4 / Etapa 4.24
-- Runner autocontido da fundacao de perda e reabertura da commercial_opportunity.
--
-- Contratos reais aplicados:
-- - usuarios de fixture sao criados diretamente em auth.users;
-- - organizations e memberships necessarias sao criadas explicitamente pelo runner;
-- - user_c e criado deliberadamente sem membership;
-- - tudo permanece dentro da transacao encerrada por rollback;
-- - mensagens modernas sao criadas exclusivamente via public.insert_message(...);
-- - snapshots validos exercitam captured, pending_context e no_active_session;
-- - legacy_unknown nao e fabricado aqui porque nao ha caminho legitimo de criacao moderna no runner.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

drop table if exists pg_temp._p9_424_results;
drop table if exists pg_temp._p9_424_ctx;

create temp table pg_temp._p9_424_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null,
  returned_sqlstate text null,
  constraint_name text null
) on commit preserve rows;

create temp table pg_temp._p9_424_ctx (
  singleton boolean primary key default true check (singleton),
  run_id uuid not null default gen_random_uuid(),
  org_a uuid null,
  org_b uuid null,
  org_c uuid null,
  store_a uuid not null,
  store_a_alt uuid not null,
  store_b uuid not null,
  user_a uuid not null,
  user_b uuid not null,
  user_c uuid not null,
  lead_primary uuid not null,
  lead_secondary uuid not null,
  lead_b uuid not null,
  conv_primary uuid not null,
  conv_secondary uuid not null,
  conv_pending uuid not null,
  conv_no_session uuid not null,
  conv_system uuid not null,
  conv_b uuid not null,
  customer_a uuid not null,
  customer_a2 uuid not null,
  customer_b uuid not null,
  opp_main uuid not null,
  opp_other uuid not null,
  opp_contact uuid not null,
  opp_system uuid not null,
  opp_secondary uuid not null,
  opp_pending uuid not null,
  opp_no_session uuid not null,
  opp_b uuid not null,
  session_primary uuid not null,
  session_secondary uuid not null,
  session_pending uuid not null,
  session_system uuid not null,
  session_b uuid not null,
  lead_link_primary uuid null,
  lead_link_secondary_old uuid null,
  lead_link_secondary_new uuid null,
  lead_link_b uuid null,
  ctx_primary uuid null,
  ctx_secondary_old uuid null,
  ctx_secondary_new uuid null,
  ctx_system uuid null,
  ctx_b uuid null,
  primary_message_id uuid null,
  history_message_id uuid null,
  secondary_captured_message_id uuid null,
  pending_message_id uuid null,
  no_session_message_id uuid null,
  system_message_id uuid null,
  org_b_message_id uuid null
) on commit preserve rows;

insert into pg_temp._p9_424_ctx (
  store_a,
  store_a_alt,
  store_b,
  user_a,
  user_b,
  user_c,
  lead_primary,
  lead_secondary,
  lead_b,
  conv_primary,
  conv_secondary,
  conv_pending,
  conv_no_session,
  conv_system,
  conv_b,
  customer_a,
  customer_a2,
  customer_b,
  opp_main,
  opp_other,
  opp_contact,
  opp_system,
  opp_secondary,
  opp_pending,
  opp_no_session,
  opp_b,
  session_primary,
  session_secondary,
  session_pending,
  session_system,
  session_b
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
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

create or replace function pg_temp._p9_424_record(
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
  insert into pg_temp._p9_424_results (
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

create or replace function pg_temp._p9_424_exec_value_sql(
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
  perform set_config(
    'request.jwt.claim.sub',
    coalesce(p_user_id::text, ''),
    true
  );
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
        errcode = 'P9424',
        message = 'P9_424_ROLLBACK_ON_SUCCESS';
    end if;
    v_operation_succeeded := true;
  exception
    when sqlstate 'P9424' then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      if p_rollback_on_success
         and v_state = 'P9424'
         and v_message = 'P9_424_ROLLBACK_ON_SUCCESS' then
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

create or replace function pg_temp._p9_424_exec_stmt_sql(
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
  perform set_config(
    'request.jwt.claim.sub',
    coalesce(p_user_id::text, ''),
    true
  );
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
        errcode = 'P9424',
        message = 'P9_424_ROLLBACK_ON_SUCCESS';
    end if;
    v_operation_succeeded := true;
  exception
    when sqlstate 'P9424' then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      if p_rollback_on_success
         and v_state = 'P9424'
         and v_message = 'P9_424_ROLLBACK_ON_SUCCESS' then
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

revoke all on function pg_temp._p9_424_record(integer, text, boolean, text, text, text) from public;
revoke all on function pg_temp._p9_424_exec_value_sql(text, uuid, text, boolean) from public;
revoke all on function pg_temp._p9_424_exec_stmt_sql(text, uuid, text, boolean) from public;

do $setup$
declare
  v pg_temp._p9_424_ctx;
  v_org_a uuid;
  v_org_b uuid;
  v_org_c uuid;
  v_link jsonb;
  v_replace jsonb;
  v_ctx jsonb;
  v_msg jsonb;
begin
  select * into strict v from pg_temp._p9_424_ctx;

  v_org_a := gen_random_uuid();
  v_org_b := gen_random_uuid();
  v_org_c := gen_random_uuid();

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
      'runner-p9424-user-a-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object(
        'full_name', 'Runner User A ' || v.run_id::text,
        'org_name', 'Runner Org A ' || v.run_id::text,
        'runner', true,
        'key', 'user_a'
      ),
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
      'runner-p9424-user-b-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object(
        'full_name', 'Runner User B ' || v.run_id::text,
        'org_name', 'Runner Org B ' || v.run_id::text,
        'runner', true,
        'key', 'user_b'
      ),
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
      'runner-p9424-user-c-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object(
        'full_name', 'Runner User C ' || v.run_id::text,
        'org_name', 'Runner Org C ' || v.run_id::text,
        'runner', true,
        'key', 'user_c'
      ),
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
    (v_org_a, 'Runner Org A ' || v.run_id::text),
    (v_org_b, 'Runner Org B ' || v.run_id::text),
    (v_org_c, 'Runner Org C ' || v.run_id::text);

  insert into public.memberships (organization_id, user_id, role)
  values
    (v_org_a, v.user_a, 'owner'),
    (v_org_b, v.user_b, 'owner');

  if exists (
    select 1
    from public.memberships membership_row
    where membership_row.user_id = v.user_c
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'runner setup failed: user_c unexpectedly has a membership';
  end if;

  update pg_temp._p9_424_ctx
  set
    org_a = v_org_a,
    org_b = v_org_b,
    org_c = v_org_c;

  insert into public.stores (id, organization_id, name, created_at)
  values
    (v.store_a, v_org_a, 'Runner Store A ' || v.run_id::text, now()),
    (v.store_a_alt, v_org_a, 'Runner Store A Alt ' || v.run_id::text, now()),
    (v.store_b, v_org_b, 'Runner Store B ' || v.run_id::text, now());

  insert into public.leads (id, organization_id, store_id, state, created_at, updated_at)
  values
    (v.lead_primary, v_org_a, v.store_a, 'negociacao', now(), now()),
    (v.lead_secondary, v_org_a, v.store_a, 'negociacao', now(), now()),
    (v.lead_b, v_org_b, v.store_b, 'negociacao', now(), now());

  insert into public.conversations (
    id,
    organization_id,
    lead_id,
    status,
    is_human_active,
    last_status_reason,
    last_status_metadata,
    created_at
  )
  values
    (v.conv_primary, v_org_a, v.lead_primary, 'negociacao', false, null, '{}'::jsonb, now()),
    (v.conv_secondary, v_org_a, v.lead_secondary, 'negociacao', false, null, '{}'::jsonb, now()),
    (v.conv_pending, v_org_a, v.lead_secondary, 'negociacao', false, null, '{}'::jsonb, now()),
    (v.conv_no_session, v_org_a, v.lead_secondary, 'negociacao', false, null, '{}'::jsonb, now()),
    (v.conv_system, v_org_a, v.lead_primary, 'negociacao', false, null, '{}'::jsonb, now()),
    (v.conv_b, v_org_b, v.lead_b, 'negociacao', false, null, '{}'::jsonb, now());

  insert into public.customers (id, organization_id, display_name, normalized_name)
  values
    (v.customer_a, v_org_a, 'Runner Customer A', 'runner customer a'),
    (v.customer_a2, v_org_a, 'Runner Customer A2', 'runner customer a2'),
    (v.customer_b, v_org_b, 'Runner Customer B', 'runner customer b');

  insert into public.customer_store_links (id, organization_id, store_id, customer_id)
  values
    (gen_random_uuid(), v_org_a, v.store_a, v.customer_a),
    (gen_random_uuid(), v_org_a, v.store_a, v.customer_a2),
    (gen_random_uuid(), v_org_b, v.store_b, v.customer_b);

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    origin_lead_id,
    primary_conversation_id,
    stage
  )
  values
    (v.opp_main, v_org_a, v.store_a, v.customer_a, v.lead_primary, v.conv_primary, 'negociacao'),
    (v.opp_other, v_org_a, v.store_a, v.customer_a, v.lead_secondary, v.conv_secondary, 'negociacao'),
    (v.opp_contact, v_org_a, v.store_a, v.customer_a, v.lead_primary, v.conv_primary, 'negociacao'),
    (v.opp_system, v_org_a, v.store_a, v.customer_a, v.lead_primary, v.conv_system, 'negociacao'),
    (v.opp_secondary, v_org_a, v.store_a, v.customer_a2, v.lead_secondary, v.conv_secondary, 'negociacao'),
    (v.opp_pending, v_org_a, v.store_a, v.customer_a2, v.lead_secondary, v.conv_pending, 'negociacao'),
    (v.opp_no_session, v_org_a, v.store_a, v.customer_a2, v.lead_secondary, v.conv_no_session, 'negociacao'),
    (v.opp_b, v_org_b, v.store_b, v.customer_b, v.lead_b, v.conv_b, 'negociacao');

  insert into public.conversation_sessions (
    id,
    organization_id,
    store_id,
    conversation_id,
    status,
    started_at,
    closed_at
  )
  values
    (v.session_primary, v_org_a, v.store_a, v.conv_primary, 'active', now() - interval '20 minutes', null),
    (v.session_secondary, v_org_a, v.store_a, v.conv_secondary, 'active', now() - interval '19 minutes', null),
    (v.session_pending, v_org_a, v.store_a, v.conv_pending, 'active', now() - interval '18 minutes', null),
    (v.session_system, v_org_a, v.store_a, v.conv_system, 'active', now() - interval '17 minutes', null),
    (v.session_b, v_org_b, v.store_b, v.conv_b, 'active', now() - interval '16 minutes', null);

  select row_to_json(public.link_lead_to_customer(
    v_org_a,
    v.store_a,
    v.lead_primary,
    v.customer_a,
    'manual',
    'human',
    v.user_a,
    null,
    'runner primary lead/customer link',
    'runner:' || v.run_id::text || ':lead-primary',
    v.run_id,
    jsonb_build_object('runner', true, 'fixture', 'lead_link_primary'),
    clock_timestamp()
  )) into v_link;

  update pg_temp._p9_424_ctx
  set lead_link_primary = (v_link ->> 'id')::uuid;

  select row_to_json(public.link_lead_to_customer(
    v_org_a,
    v.store_a,
    v.lead_secondary,
    v.customer_a,
    'manual',
    'human',
    v.user_a,
    null,
    'runner secondary lead/customer link',
    'runner:' || v.run_id::text || ':lead-secondary-old',
    v.run_id,
    jsonb_build_object('runner', true, 'fixture', 'lead_link_secondary_old'),
    clock_timestamp()
  )) into v_link;

  update pg_temp._p9_424_ctx
  set lead_link_secondary_old = (v_link ->> 'id')::uuid;

  select row_to_json(public.link_lead_to_customer(
    v_org_b,
    v.store_b,
    v.lead_b,
    v.customer_b,
    'manual',
    'human',
    v.user_b,
    null,
    'runner org-b lead/customer link',
    'runner:' || v.run_id::text || ':lead-b',
    v.run_id,
    jsonb_build_object('runner', true, 'fixture', 'lead_link_b'),
    clock_timestamp()
  )) into v_link;

  update pg_temp._p9_424_ctx
  set lead_link_b = (v_link ->> 'id')::uuid;

  select row_to_json(public.link_commercial_session_context(
    v_org_a,
    v.store_a,
    v.session_primary,
    v.customer_a,
    v.opp_main,
    (select lead_link_primary from pg_temp._p9_424_ctx),
    'manual',
    'human',
    v.user_a,
    'runner primary context',
    'runner:' || v.run_id::text || ':ctx-primary',
    v.run_id,
    jsonb_build_object('runner', true, 'fixture', 'ctx_primary'),
    null
  )) into v_ctx;

  update pg_temp._p9_424_ctx
  set ctx_primary = (v_ctx ->> 'id')::uuid;

  select row_to_json(public.link_commercial_session_context(
    v_org_a,
    v.store_a,
    v.session_secondary,
    v.customer_a,
    v.opp_other,
    (select lead_link_secondary_old from pg_temp._p9_424_ctx),
    'manual',
    'human',
    v.user_a,
    'runner historical old context',
    'runner:' || v.run_id::text || ':ctx-secondary-old',
    v.run_id,
    jsonb_build_object('runner', true, 'fixture', 'ctx_secondary_old'),
    null
  )) into v_ctx;

  update pg_temp._p9_424_ctx
  set ctx_secondary_old = (v_ctx ->> 'id')::uuid;

  select row_to_json(public.link_commercial_session_context(
    v_org_a,
    v.store_a,
    v.session_system,
    v.customer_a,
    v.opp_system,
    (select lead_link_primary from pg_temp._p9_424_ctx),
    'manual',
    'human',
    v.user_a,
    'runner system context',
    'runner:' || v.run_id::text || ':ctx-system',
    v.run_id,
    jsonb_build_object('runner', true, 'fixture', 'ctx_system'),
    null
  )) into v_ctx;

  update pg_temp._p9_424_ctx
  set ctx_system = (v_ctx ->> 'id')::uuid;

  select row_to_json(public.link_commercial_session_context(
    v_org_b,
    v.store_b,
    v.session_b,
    v.customer_b,
    v.opp_b,
    (select lead_link_b from pg_temp._p9_424_ctx),
    'manual',
    'human',
    v.user_b,
    'runner org-b context',
    'runner:' || v.run_id::text || ':ctx-b',
    v.run_id,
    jsonb_build_object('runner', true, 'fixture', 'ctx_b'),
    null
  )) into v_ctx;

  update pg_temp._p9_424_ctx
  set ctx_b = (v_ctx ->> 'id')::uuid;

  select row_to_json(public.insert_message(
    v.conv_primary,
    'user',
    'incoming',
    'text',
    'runner primary captured message ' || v.run_id::text,
    null,
    null,
    jsonb_build_object('runner_run_id', v.run_id::text, 'fixture', 'primary_message')
  )) into v_msg;

  update pg_temp._p9_424_ctx
  set primary_message_id = (v_msg ->> 'id')::uuid;

  select row_to_json(public.insert_message(
    v.conv_secondary,
    'user',
    'incoming',
    'text',
    'runner historical message before replacement ' || v.run_id::text,
    null,
    null,
    jsonb_build_object('runner_run_id', v.run_id::text, 'fixture', 'history_message')
  )) into v_msg;

  update pg_temp._p9_424_ctx
  set history_message_id = (v_msg ->> 'id')::uuid;

  select row_to_json(public.insert_message(
    v.conv_pending,
    'user',
    'incoming',
    'text',
    'runner pending-context message ' || v.run_id::text,
    null,
    null,
    jsonb_build_object('runner_run_id', v.run_id::text, 'fixture', 'pending_message')
  )) into v_msg;

  update pg_temp._p9_424_ctx
  set pending_message_id = (v_msg ->> 'id')::uuid;

  select row_to_json(public.insert_message(
    v.conv_no_session,
    'user',
    'incoming',
    'text',
    'runner no-active-session message ' || v.run_id::text,
    null,
    null,
    jsonb_build_object('runner_run_id', v.run_id::text, 'fixture', 'no_session_message')
  )) into v_msg;

  update pg_temp._p9_424_ctx
  set no_session_message_id = (v_msg ->> 'id')::uuid;

  select row_to_json(public.insert_message(
    v.conv_b,
    'user',
    'incoming',
    'text',
    'runner org-b message ' || v.run_id::text,
    null,
    null,
    jsonb_build_object('runner_run_id', v.run_id::text, 'fixture', 'org_b_message')
  )) into v_msg;

  update pg_temp._p9_424_ctx
  set org_b_message_id = (v_msg ->> 'id')::uuid;

  select row_to_json(public.replace_lead_customer_link(
    (select lead_link_secondary_old from pg_temp._p9_424_ctx),
    v_org_a,
    v.store_a,
    v.customer_a2,
    'manual',
    'human',
    v.user_a,
    null,
    'runner replace secondary lead/customer link',
    'runner:' || v.run_id::text || ':lead-secondary-new',
    v.run_id,
    jsonb_build_object('runner', true, 'fixture', 'lead_link_secondary_new'),
    'runner_replace',
    'runner replace to customer_a2',
    jsonb_build_object('runner', true, 'fixture', 'lead_link_secondary_old_close'),
    null
  )) into v_replace;

  update pg_temp._p9_424_ctx
  set lead_link_secondary_new = (v_replace ->> 'id')::uuid;

  select row_to_json(public.replace_commercial_session_context_link(
    (select ctx_secondary_old from pg_temp._p9_424_ctx),
    v_org_a,
    v.store_a,
    v.customer_a2,
    v.opp_secondary,
    (select lead_link_secondary_new from pg_temp._p9_424_ctx),
    'manual',
    'human',
    v.user_a,
    'runner replace commercial context',
    'runner:' || v.run_id::text || ':ctx-secondary-new',
    v.run_id,
    jsonb_build_object('runner', true, 'fixture', 'ctx_secondary_new'),
    'runner_replace',
    'runner replace to opp_secondary',
    jsonb_build_object('runner', true, 'fixture', 'ctx_secondary_old_close'),
    null
  )) into v_replace;

  update pg_temp._p9_424_ctx
  set ctx_secondary_new = (v_replace ->> 'id')::uuid;

  select row_to_json(public.insert_message(
    v.conv_secondary,
    'user',
    'incoming',
    'text',
    'runner secondary captured message after replacement ' || v.run_id::text,
    null,
    null,
    jsonb_build_object('runner_run_id', v.run_id::text, 'fixture', 'secondary_captured_message')
  )) into v_msg;

  update pg_temp._p9_424_ctx
  set secondary_captured_message_id = (v_msg ->> 'id')::uuid;

  select row_to_json(public.insert_message(
    v.conv_system,
    'user',
    'incoming',
    'text',
    'runner system captured message ' || v.run_id::text,
    null,
    null,
    jsonb_build_object('runner_run_id', v.run_id::text, 'fixture', 'system_message')
  )) into v_msg;

  update pg_temp._p9_424_ctx
  set system_message_id = (v_msg ->> 'id')::uuid;

  if exists (
    select 1
    from pg_temp._p9_424_ctx ctx
    where ctx.lead_link_primary is null
       or ctx.lead_link_secondary_old is null
       or ctx.lead_link_secondary_new is null
       or ctx.lead_link_b is null
       or ctx.ctx_primary is null
       or ctx.ctx_secondary_old is null
       or ctx.ctx_secondary_new is null
       or ctx.ctx_system is null
       or ctx.ctx_b is null
       or ctx.primary_message_id is null
       or ctx.history_message_id is null
       or ctx.secondary_captured_message_id is null
       or ctx.pending_message_id is null
       or ctx.no_session_message_id is null
       or ctx.system_message_id is null
       or ctx.org_b_message_id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'runner setup failed: one or more generated fixture ids are null';
  end if;
end;
$setup$;

do $tests$
declare
  v pg_temp._p9_424_ctx;
  x record;
  y record;
  z record;
  v_main_loss_event_id uuid;
  v_main_loss_cycle integer;
  v_main_loss_current_event_id uuid;
  v_main_loss_created_at timestamptz;
  v_loss_a_result jsonb;
  v_reopen_b_result jsonb;
  v_reopen_b_event_id uuid;
  v_reopen_b_created_at timestamptz;
  v_loss_c_result jsonb;
  v_loss_c_event_id uuid;
  v_loss_c_cycle integer;
  v_loss_c_created_at timestamptz;
  v_history_old_snapshot text;
  v_history_new_snapshot text;
  v_primary_snapshot text;
  v_secondary_snapshot text;
  v_pending_snapshot text;
  v_no_session_snapshot text;
  v_system_snapshot text;
  v_old_ctx_status text;
  v_new_ctx_status text;
  v_old_event jsonb;
  v_new_event jsonb;
  v_loss_a_key text := 'p9-4.24-s16-user-loss';
  v_reopen_b_key text := 'p9-4.24-s47-reopen';
  v_loss_c_key text := 'p9-4.24-s53-user-loss-cycle-2';
begin
  select * into strict v from pg_temp._p9_424_ctx;

  perform pg_temp._p9_424_record(
    1,
    'tabela de eventos existe',
    to_regclass('public.commercial_opportunity_lifecycle_events') is not null,
    'commercial_opportunity_lifecycle_events deve existir'
  );

  perform pg_temp._p9_424_record(
    2,
    'colunas de projecao existem',
    (
      select count(*)
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'commercial_opportunities'
        and column_name in (
          'lifecycle_cycle',
          'lost_at',
          'lost_reason_code',
          'lost_reason_details',
          'current_loss_event_id',
          'last_reopened_at'
        )
    ) = 6,
    'commercial_opportunities deve conter 6 colunas de projecao'
  );

  perform pg_temp._p9_424_record(
    3,
    'checks estruturais de projecao existem',
    (
      select count(*)
      from pg_catalog.pg_constraint
      where conrelid = 'public.commercial_opportunities'::regclass
        and conname in (
          'commercial_opportunities_lifecycle_cycle_check',
          'commercial_opportunities_lost_reason_code_check',
          'commercial_opportunities_loss_projection_stage_check'
        )
    ) = 3,
    'checks de lifecycle_cycle e loss projection devem existir'
  );

  perform pg_temp._p9_424_record(
    4,
    'allowlist de event_type preservada',
    exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = 'public.commercial_opportunity_lifecycle_events'::regclass
        and conname = 'commercial_opportunity_lifecycle_events_event_type_check'
        and pg_get_constraintdef(oid) like '%marked_lost%'
        and pg_get_constraintdef(oid) like '%reopened%'
    ),
    'allowlist deve incluir marked_lost e reopened'
  );

  perform pg_temp._p9_424_record(
    5,
    'allowlist de actor_type preservada',
    exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = 'public.commercial_opportunity_lifecycle_events'::regclass
        and conname = 'commercial_opportunity_lifecycle_events_actor_type_check'
        and pg_get_constraintdef(oid) like '%human%'
        and pg_get_constraintdef(oid) like '%ai%'
        and pg_get_constraintdef(oid) like '%system%'
    ),
    'allowlist deve incluir human, ai e system'
  );

  perform pg_temp._p9_424_record(
    6,
    'fks historicas usam restrict',
    (
      select count(*)
      from pg_catalog.pg_constraint
      where conrelid = 'public.commercial_opportunity_lifecycle_events'::regclass
        and contype = 'f'
        and confdeltype = 'r'
    ) = 5,
    'todas as 5 FKs historicas devem usar on delete restrict'
  );

  perform pg_temp._p9_424_record(
    7,
    'organizations geradas foram resolvidas por memberships exatas',
    (
      select count(*) = 1
      from public.memberships
      where organization_id = v.org_a
        and user_id = v.user_a
        and role = 'owner'
    )
    and (
      select count(*) = 1
      from public.memberships
      where organization_id = v.org_b
        and user_id = v.user_b
        and role = 'owner'
    )
    and v.org_a is not null
    and v.org_b is not null
    and v.org_c is not null
    and v.org_a <> v.org_b
    and v.org_a <> v.org_c
    and v.org_b <> v.org_c,
    'cada user fixture deve resolver uma organization distinta pelo owner membership'
  );

  perform pg_temp._p9_424_record(
    8,
    'user sem membership ficou sem memberships',
    not exists (
      select 1
      from public.memberships
      where user_id = v.user_c
    ),
    'user_c deve permanecer sem memberships dentro do runner'
  );

  select
    concat_ws(
      '|',
      coalesce(message_row.conversation_session_id::text, ''),
      coalesce(message_row.commercial_session_context_link_id::text, ''),
      message_row.commercial_context_capture_state
    )
  into v_primary_snapshot
  from public.messages message_row
  where message_row.id = v.primary_message_id;

  perform pg_temp._p9_424_record(
    9,
    'snapshot captured primario legitimo',
    v_primary_snapshot = concat(v.session_primary::text, '|', v.ctx_primary::text, '|captured'),
    coalesce(v_primary_snapshot, '<null>')
  );

  select
    concat_ws(
      '|',
      coalesce(message_row.conversation_session_id::text, ''),
      coalesce(message_row.commercial_session_context_link_id::text, ''),
      message_row.commercial_context_capture_state
    )
  into v_pending_snapshot
  from public.messages message_row
  where message_row.id = v.pending_message_id;

  perform pg_temp._p9_424_record(
    10,
    'snapshot pending_context legitimo',
    v_pending_snapshot = concat(v.session_pending::text, '||pending_context'),
    coalesce(v_pending_snapshot, '<null>')
  );

  select
    concat_ws(
      '|',
      coalesce(message_row.conversation_session_id::text, ''),
      coalesce(message_row.commercial_session_context_link_id::text, ''),
      message_row.commercial_context_capture_state
    )
  into v_no_session_snapshot
  from public.messages message_row
  where message_row.id = v.no_session_message_id;

  perform pg_temp._p9_424_record(
    11,
    'snapshot no_active_session legitimo',
    v_no_session_snapshot = '||no_active_session',
    coalesce(v_no_session_snapshot, '<null>')
  );

  select
    concat_ws(
      '|',
      coalesce(message_row.conversation_session_id::text, ''),
      coalesce(message_row.commercial_session_context_link_id::text, ''),
      message_row.commercial_context_capture_state
    )
  into v_history_old_snapshot
  from public.messages message_row
  where message_row.id = v.history_message_id;

  select status into v_old_ctx_status
  from public.commercial_session_context_links
  where id = v.ctx_secondary_old;

  select status into v_new_ctx_status
  from public.commercial_session_context_links
  where id = v.ctx_secondary_new;

  perform pg_temp._p9_424_record(
    12,
    'mensagem historica preserva snapshot original apos replace',
    v_history_old_snapshot = concat(v.session_secondary::text, '|', v.ctx_secondary_old::text, '|captured')
    and v_old_ctx_status = 'inactive'
    and v_new_ctx_status = 'active',
    format(
      'history_snapshot=%s old_ctx=%s new_ctx=%s',
      coalesce(v_history_old_snapshot, '<null>'),
      coalesce(v_old_ctx_status, '<null>'),
      coalesce(v_new_ctx_status, '<null>')
    )
  );

  select
    concat_ws(
      '|',
      coalesce(message_row.conversation_session_id::text, ''),
      coalesce(message_row.commercial_session_context_link_id::text, ''),
      message_row.commercial_context_capture_state
    )
  into v_secondary_snapshot
  from public.messages message_row
  where message_row.id = v.secondary_captured_message_id;

  perform pg_temp._p9_424_record(
    13,
    'mensagem secundaria capturada usa link replacement',
    v_secondary_snapshot = concat(v.session_secondary::text, '|', v.ctx_secondary_new::text, '|captured'),
    coalesce(v_secondary_snapshot, '<null>')
  );

  select
    concat_ws(
      '|',
      coalesce(message_row.conversation_session_id::text, ''),
      coalesce(message_row.commercial_session_context_link_id::text, ''),
      message_row.commercial_context_capture_state
    )
  into v_system_snapshot
  from public.messages message_row
  where message_row.id = v.system_message_id;

  perform pg_temp._p9_424_record(
    14,
    'auth simulation authenticated projeta uid e role corretos',
    (
      select operation_succeeded
         and value_text = v.user_a::text || '|authenticated'
      from pg_temp._p9_424_exec_value_sql(
        'authenticated',
        v.user_a,
        'select auth.uid()::text || ''|'' || auth.role()::text'
      )
    ),
    'auth.uid() e auth.role() devem refletir authenticated'
  );

  perform pg_temp._p9_424_record(
    15,
    'auth simulation service_role projeta role correta',
    (
      select operation_succeeded
         and value_text = '|service_role'
      from pg_temp._p9_424_exec_value_sql(
        'service_role',
        null,
        'select coalesce(auth.uid()::text, '''') || ''|'' || auth.role()::text'
      )
    ),
    'auth.uid() vazio e auth.role() service_role'
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L,
          'explicit_refusal',
          null,
          %L::uuid,
          'runner valid human captured evidence',
          'runner_valid_human_loss'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_main,
      v_loss_a_key,
      v.primary_message_id
    )
  );

  perform pg_temp._p9_424_record(
    16,
    'primary conversation com captured valido aceita',
    x.operation_succeeded
    and exists (
      select 1
      from public.commercial_opportunities opp
      where opp.id = v.opp_main
        and opp.stage = 'perdido'
        and opp.current_loss_event_id is not null
    ),
    coalesce(x.value_text, x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  v_loss_a_result := x.value_text::jsonb;

  select
    opp.current_loss_event_id,
    opp.lifecycle_cycle,
    opp.current_loss_event_id
  into
    v_main_loss_event_id,
    v_main_loss_cycle,
    v_main_loss_current_event_id
  from public.commercial_opportunities opp
  where opp.id = v.opp_main;

  select
    row_to_json(evt),
    evt.created_at
  into
    v_old_event,
    v_main_loss_created_at
  from public.commercial_opportunity_lifecycle_events evt
  where evt.organization_id = v.org_a
    and evt.store_id = v.store_a
    and evt.commercial_opportunity_id = v.opp_main
    and evt.idempotency_key = v_loss_a_key
    and evt.event_type = 'marked_lost';

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L,
          'explicit_refusal',
          null,
          %L::uuid,
          'runner valid human captured evidence',
          'runner_valid_human_loss'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_main,
      v_loss_a_key,
      v.primary_message_id
    )
  );

  perform pg_temp._p9_424_record(
    17,
    'retry da mesma perda retorna resultado historico',
    x.operation_succeeded
    and x.value_text::jsonb = v_loss_a_result,
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  perform pg_temp._p9_424_record(
    18,
    'retry da mesma perda nao cria segundo evento',
    (
      select count(*) = 1
      from public.commercial_opportunity_lifecycle_events evt
      where evt.commercial_opportunity_id = v.opp_main
        and evt.event_type = 'marked_lost'
        and evt.idempotency_key = v_loss_a_key
    )
    and (
      select count(*) = 1
      from public.commercial_opportunity_lifecycle_events evt
      where evt.commercial_opportunity_id = v.opp_main
        and evt.event_type = 'marked_lost'
    ),
    'opp_main deve manter um unico evento marked_lost para a chave A'
  );

  perform pg_temp._p9_424_record(
    19,
    'retry da mesma perda preserva id ciclo e created_at historicos',
    exists (
      select 1
      from public.commercial_opportunity_lifecycle_events evt
      where evt.organization_id = v.org_a
        and evt.store_id = v.store_a
        and evt.commercial_opportunity_id = v.opp_main
        and evt.idempotency_key = v_loss_a_key
        and evt.event_type = 'marked_lost'
        and evt.id = v_main_loss_event_id
        and evt.lifecycle_cycle = v_main_loss_cycle
        and evt.created_at = v_main_loss_created_at
    ),
    'evento historico da chave A deve permanecer byte a byte no mesmo ponto'
  );

  perform pg_temp._p9_424_record(
    20,
    'retry da mesma perda preserva a projecao atual',
    (
      select opp.stage = 'perdido'
         and opp.lifecycle_cycle = v_main_loss_cycle
         and opp.current_loss_event_id = v_main_loss_current_event_id
         and opp.lost_at = v_main_loss_created_at
         and opp.lost_reason_code = 'explicit_refusal'
         and opp.lost_reason_details is null
      from public.commercial_opportunities opp
      where opp.id = v.opp_main
    ),
    'a projecao perdida da chave A deve permanecer inalterada'
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s21-contact-opt-out',
          'contact_opt_out',
          'runner contact opt out',
          %L::uuid,
          null,
          'runner_contact_opt_out'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_contact,
      v.primary_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    21,
    'contact_opt_out humano rejeitado',
    not x.operation_succeeded
    and x.returned_sqlstate = 'P0001'
    and x.message_text = 'ZION_CONTACT_OPT_OUT_ATOMIC_BLOCK_REQUIRED'
    and not exists (
      select 1
      from public.commercial_opportunity_lifecycle_events evt
      where evt.commercial_opportunity_id = v.opp_contact
    ),
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'authenticated',
    v.user_b,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s22-user-loss-wrong-org',
          'explicit_refusal',
          null,
          %L::uuid,
          'runner wrong org',
          'runner_wrong_org'
        ) as loss_row
      $sql$,
      v.org_b,
      v.store_b,
      v.opp_main,
      v.primary_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    22,
    'oportunidade de outra organizacao rejeitada',
    not x.operation_succeeded
    and x.returned_sqlstate = '23514'
    and x.message_text = 'commercial opportunity scope mismatch',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s23-user-loss-wrong-store',
          'explicit_refusal',
          null,
          %L::uuid,
          'runner wrong store',
          'runner_wrong_store'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a_alt,
      v.opp_contact,
      v.primary_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    23,
    'oportunidade de outra loja rejeitada',
    not x.operation_succeeded
    and x.returned_sqlstate = '23514'
    and x.message_text = 'commercial opportunity scope mismatch',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'authenticated',
    v.user_c,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s24-user-loss-no-membership',
          'explicit_refusal',
          null,
          %L::uuid,
          'runner no membership',
          'runner_no_membership'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_contact,
      v.primary_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    24,
    'usuario sem membership rejeitado',
    not x.operation_succeeded
    and x.returned_sqlstate = '42501'
    and x.message_text = 'commercial opportunity loss by user is not authorized',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s25-system-loss-pending-context',
          'explicit_refusal',
          %L::uuid,
          'runner pending-context evidence',
          'system',
          'runner_pending_context'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_pending,
      v.pending_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    25,
    'primary conversation com pending_context rejeita',
    not x.operation_succeeded
    and x.returned_sqlstate = '23514'
    and x.message_text = 'ZION_LOSS_EVIDENCE_CONTEXT_NOT_PROVEN',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s26-system-loss-no-active-session',
          'explicit_refusal',
          %L::uuid,
          'runner no-active-session evidence',
          'system',
          'runner_no_active_session'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_no_session,
      v.no_session_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    26,
    'primary conversation com no_active_session rejeita',
    not x.operation_succeeded
    and x.returned_sqlstate = '23514'
    and x.message_text = 'ZION_LOSS_EVIDENCE_CONTEXT_NOT_PROVEN',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s27-system-loss-out-of-scope',
          'explicit_refusal',
          %L::uuid,
          'runner out-of-scope evidence',
          'system',
          'runner_out_of_scope'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_contact,
      v.org_b_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    27,
    'mensagem de outra organizacao rejeita como out_of_scope',
    not x.operation_succeeded
    and x.returned_sqlstate = '23514'
    and x.message_text = 'ZION_LOSS_EVIDENCE_OUT_OF_SCOPE',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s28-system-loss-historical-original',
          'explicit_refusal',
          %L::uuid,
          'runner historical evidence original context',
          'system',
          'runner_historical_original'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_other,
      v.history_message_id
    )
  );

  perform pg_temp._p9_424_record(
    28,
    'mensagem historica com link substituido aceita contexto original',
    x.operation_succeeded
    and exists (
      select 1
      from public.commercial_opportunity_lifecycle_events evt
      where evt.commercial_opportunity_id = v.opp_other
        and evt.evidence_message_id = v.history_message_id
        and evt.actor_type = 'system'
    ),
    coalesce(x.value_text, x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s29-system-loss-historical-replacement',
          'explicit_refusal',
          %L::uuid,
          'runner historical evidence replacement target',
          'system',
          'runner_historical_replacement_reject'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_secondary,
      v.history_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    29,
    'mensagem historica substituida continua usando o link original',
    not x.operation_succeeded
    and x.returned_sqlstate = '23514'
    and x.message_text = 'ZION_LOSS_EVIDENCE_CONTEXT_NOT_PROVEN',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s30-system-loss-secondary-captured',
          'explicit_refusal',
          %L::uuid,
          'runner secondary captured evidence',
          'system',
          'runner_secondary_captured'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_secondary,
      v.secondary_captured_message_id
    )
  );

  perform pg_temp._p9_424_record(
    30,
    'conversa secundaria captured aceita',
    x.operation_succeeded
    and exists (
      select 1
      from public.commercial_opportunity_lifecycle_events evt
      where evt.commercial_opportunity_id = v.opp_secondary
        and evt.evidence_message_id = v.secondary_captured_message_id
    ),
    coalesce(x.value_text, x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s31-system-loss-secondary-pending-reject',
          'explicit_refusal',
          %L::uuid,
          'runner secondary without snapshot proven',
          'system',
          'runner_secondary_pending_reject'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_no_session,
      v.pending_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    31,
    'mensagem pending_context de outro fluxo nao comprova contexto',
    not x.operation_succeeded
    and x.returned_sqlstate = '23514'
    and x.message_text = 'ZION_LOSS_EVIDENCE_CONTEXT_NOT_PROVEN',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s32-system-loss-other-opportunity',
          'explicit_refusal',
          %L::uuid,
          'runner other opportunity reject',
          'system',
          'runner_other_opportunity_reject'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_contact,
      v.secondary_captured_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    32,
    'link de outra oportunidade rejeita',
    not x.operation_succeeded
    and x.returned_sqlstate = '23514'
    and x.message_text = 'ZION_LOSS_EVIDENCE_CONTEXT_NOT_PROVEN',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s33-system-loss-other-customer',
          'explicit_refusal',
          %L::uuid,
          'runner other customer reject',
          'system',
          'runner_other_customer_reject'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_pending,
      v.primary_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    33,
    'link de outro customer rejeita',
    not x.operation_succeeded
    and x.returned_sqlstate = '23514'
    and x.message_text = 'ZION_LOSS_EVIDENCE_CONTEXT_NOT_PROVEN',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s34-system-loss-valid',
          'bought_from_competitor',
          %L::uuid,
          'runner system valid loss',
          'system',
          'runner_system_valid_loss'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_system,
      v.system_message_id
    )
  );

  perform pg_temp._p9_424_record(
    34,
    'perda sistemica valida com evidencia dedicada aceita',
    x.operation_succeeded
    and exists (
      select 1
      from public.commercial_opportunity_lifecycle_events evt
      where evt.commercial_opportunity_id = v.opp_system
        and evt.evidence_message_id = v.system_message_id
        and evt.actor_type = 'system'
    ),
    coalesce(x.value_text, x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s35-system-loss-no-evidence',
          'explicit_refusal',
          null,
          'runner no evidence',
          'system',
          'runner_system_no_evidence'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_pending
    ),
    true
  );

  perform pg_temp._p9_424_record(
    35,
    'sistema sem evidence_message_id rejeitado',
    not x.operation_succeeded
    and x.returned_sqlstate = '22023'
    and x.message_text = 'commercial opportunity loss by system requires scope, evidence, idempotency_key and source',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s36-system-loss-blank-summary',
          'explicit_refusal',
          %L::uuid,
          '   ',
          'system',
          'runner_system_blank_summary'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_pending,
      v.secondary_captured_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    36,
    'sistema com evidence_summary vazia rejeitado',
    not x.operation_succeeded
    and x.returned_sqlstate = '22023'
    and x.message_text = 'commercial opportunity loss by system requires scope, evidence, idempotency_key and source',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s37-system-loss-contact-opt-out',
          'contact_opt_out',
          %L::uuid,
          'runner system contact opt out',
          'system',
          'runner_system_contact_opt_out'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_pending,
      v.secondary_captured_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    37,
    'contact_opt_out sistemico rejeitado',
    not x.operation_succeeded
    and x.returned_sqlstate = '22023'
    and x.message_text = 'ZION_SYSTEM_LOSS_REASON_FORBIDDEN',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s38-system-loss-other',
          'other',
          %L::uuid,
          'runner system other',
          'system',
          'runner_system_other'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_pending,
      v.secondary_captured_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    38,
    'sistema com other rejeitado',
    not x.operation_succeeded
    and x.returned_sqlstate = '22023'
    and x.message_text = 'ZION_SYSTEM_LOSS_REASON_FORBIDDEN',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s39-system-loss-technical',
          'confirmed_technical_infeasibility',
          %L::uuid,
          'runner system technical',
          'system',
          'runner_system_technical'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_pending,
      v.secondary_captured_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    39,
    'sistema com confirmed_technical_infeasibility rejeitado',
    not x.operation_succeeded
    and x.returned_sqlstate = '22023'
    and x.message_text = 'ZION_SYSTEM_LOSS_REASON_FORBIDDEN',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9-4.24-s40-system-loss-actor-invalid',
          'explicit_refusal',
          %L::uuid,
          'runner system actor invalid',
          'human',
          'runner_system_actor_invalid'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_pending,
      v.secondary_captured_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    40,
    'sistema com actor invalid rejeitado',
    not x.operation_succeeded
    and x.returned_sqlstate = '22023'
    and x.message_text = 'ZION_SYSTEM_LOSS_ACTOR_INVALID',
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into y
  from pg_temp._p9_424_exec_stmt_sql(
    'postgres',
    null,
    format(
      $sql$
        insert into public.commercial_opportunity_lifecycle_events (
          id,
          organization_id,
          store_id,
          commercial_opportunity_id,
          customer_id,
          lifecycle_cycle,
          event_type,
          previous_stage,
          new_stage,
          reason_code,
          reason_details,
          evidence_type,
          evidence_message_id,
          evidence_summary,
          actor_type,
          actor_user_id,
          source,
          metadata,
          idempotency_key,
          event_key
        )
        values (
          gen_random_uuid(),
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          1,
          'marked_lost',
          'negociacao',
          'perdido',
          'explicit_refusal',
          null,
          null,
          null,
          null,
          'system',
          null,
          'runner_fk_probe',
          '{}'::jsonb,
          'p9-4.24-s41-fk-probe',
          public.compute_commercial_opportunity_event_fingerprint_internal(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            1,
            'marked_lost',
            'negociacao',
            'perdido',
            'system',
            null,
            'explicit_refusal',
            null,
            'runner_fk_probe',
            null,
            null,
            null
          )
        )
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_pending,
      v.customer_a,
      v.org_a,
      v.store_a,
      v.opp_pending
    ),
    true
  );

  perform pg_temp._p9_424_record(
    41,
    'fk composta invalida rejeitada com constraint exata',
    not y.operation_succeeded
    and y.returned_sqlstate = '23503'
    and y.constraint_name = 'commercial_opportunity_lifecycle_events_opportunity_scope_fkey',
    coalesce(y.message_text, '<none>'),
    y.returned_sqlstate,
    y.constraint_name
  );

  select * into y
  from pg_temp._p9_424_exec_stmt_sql(
    'postgres',
    null,
    format(
      $sql$
        update public.commercial_opportunities
        set
          stage = 'perdido',
          lost_at = now(),
          lost_reason_code = 'explicit_refusal'
        where id = %L::uuid
      $sql$,
      v.opp_pending
    ),
    true
  );

  perform pg_temp._p9_424_record(
    42,
    'update direto para perdido rejeitado',
    not y.operation_succeeded
    and y.returned_sqlstate = '23514'
    and y.message_text = 'commercial opportunity loss projection is incomplete',
    coalesce(y.message_text, '<none>'),
    y.returned_sqlstate,
    y.constraint_name
  );

  select * into y
  from pg_temp._p9_424_exec_stmt_sql(
    'postgres',
    null,
    format(
      $sql$
        update public.commercial_opportunities
        set
          stage = 'negociacao',
          lost_at = null,
          lost_reason_code = null,
          lost_reason_details = null,
          current_loss_event_id = null
        where id = %L::uuid
      $sql$,
      v.opp_main
    ),
    true
  );

  perform pg_temp._p9_424_record(
    43,
    'update direto saindo de perdido rejeitado',
    not y.operation_succeeded
    and y.returned_sqlstate = 'P0001'
    and y.message_text = 'ZION_DIRECT_REOPEN_TRANSITION_FORBIDDEN',
    coalesce(y.message_text, '<none>'),
    y.returned_sqlstate,
    y.constraint_name
  );

  select * into y
  from pg_temp._p9_424_exec_stmt_sql(
    'postgres',
    null,
    format(
      $sql$
        update public.commercial_opportunity_lifecycle_events
        set source = 'runner_mutation_forbidden'
        where id = %L::uuid
      $sql$,
      v_main_loss_event_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    44,
    'update em lifecycle event e proibido',
    not y.operation_succeeded
    and y.returned_sqlstate = 'P0001'
    and y.message_text = 'ZION_LIFECYCLE_EVENT_UPDATE_FORBIDDEN',
    coalesce(y.message_text, '<none>'),
    y.returned_sqlstate,
    y.constraint_name
  );

  select * into y
  from pg_temp._p9_424_exec_stmt_sql(
    'postgres',
    null,
    format(
      $sql$
        delete from public.commercial_opportunity_lifecycle_events
        where id = %L::uuid
      $sql$,
      v_main_loss_event_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    45,
    'delete em lifecycle event e proibido',
    not y.operation_succeeded
    and y.returned_sqlstate = 'P0001'
    and y.message_text = 'ZION_LIFECYCLE_EVENT_DELETE_FORBIDDEN',
    coalesce(y.message_text, '<none>'),
    y.returned_sqlstate,
    y.constraint_name
  );

  select * into y
  from pg_temp._p9_424_exec_stmt_sql(
    'postgres',
    null,
    'truncate table public.commercial_opportunity_lifecycle_events cascade',
    true
  );

  perform pg_temp._p9_424_record(
    46,
    'truncate em lifecycle event e proibido',
    not y.operation_succeeded
    and y.returned_sqlstate = 'P0001'
    and y.message_text = 'ZION_LIFECYCLE_EVENT_TRUNCATE_FORBIDDEN',
    coalesce(y.message_text, '<none>'),
    y.returned_sqlstate,
    y.constraint_name
  );

  select * into z
  from pg_temp._p9_424_exec_value_sql(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select row_to_json(reopen_row)::text
        from public.reopen_commercial_opportunity_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L,
          'negociacao',
          'runner reopen main',
          'runner_reopen_main'
        ) as reopen_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_main,
      v_reopen_b_key
    )
  );

  v_reopen_b_result := z.value_text::jsonb;

  select
    evt.id,
    evt.created_at
  into
    v_reopen_b_event_id,
    v_reopen_b_created_at
  from public.commercial_opportunity_lifecycle_events evt
  where evt.organization_id = v.org_a
    and evt.store_id = v.store_a
    and evt.commercial_opportunity_id = v.opp_main
    and evt.idempotency_key = v_reopen_b_key
    and evt.event_type = 'reopened';

  perform pg_temp._p9_424_record(
    47,
    'reabertura valida incrementa lifecycle_cycle e usa created_at do evento',
    z.operation_succeeded
    and exists (
      select 1
      from public.commercial_opportunities opp
      where opp.id = v.opp_main
        and opp.stage = 'negociacao'
        and opp.lifecycle_cycle = v_main_loss_cycle + 1
        and opp.current_loss_event_id is null
        and opp.last_reopened_at = v_reopen_b_created_at
    ),
    coalesce(z.value_text, z.message_text, '<none>'),
    z.returned_sqlstate,
    z.constraint_name
  );

  select row_to_json(evt) into v_new_event
  from public.commercial_opportunity_lifecycle_events evt
  where evt.id = v_main_loss_event_id;

  perform pg_temp._p9_424_record(
    48,
    'evento marked_lost original permanece imutavel',
    v_old_event = v_new_event,
    'evento marked_lost deve permanecer byte a byte imutavel'
  );

  perform pg_temp._p9_424_record(
    49,
    'reabertura nao altera snapshots nem cadeia historica de contexto',
    (
      select concat_ws(
               '|',
               coalesce(message_row.conversation_session_id::text, ''),
               coalesce(message_row.commercial_session_context_link_id::text, ''),
               message_row.commercial_context_capture_state
             )
      from public.messages message_row
      where message_row.id = v.primary_message_id
    ) = v_primary_snapshot
    and (
      select concat_ws(
               '|',
               coalesce(message_row.conversation_session_id::text, ''),
               coalesce(message_row.commercial_session_context_link_id::text, ''),
               message_row.commercial_context_capture_state
             )
      from public.messages message_row
      where message_row.id = v.history_message_id
    ) = v_history_old_snapshot
    and (
      select status
      from public.commercial_session_context_links
      where id = v.ctx_secondary_old
    ) = 'inactive'
    and (
      select status
      from public.commercial_session_context_links
      where id = v.ctx_secondary_new
    ) = 'active',
    'reopen nao pode alterar snapshot congelado nem replacement chain'
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'authenticated',
    v.user_b,
    format(
      $sql$
        select count(*)::text
        from public.commercial_opportunity_lifecycle_events
        where organization_id = %L::uuid
      $sql$,
      v.org_a
    )
  );

  perform pg_temp._p9_424_record(
    50,
    'RLS impede user_b de ler lifecycle events da org_a',
    x.operation_succeeded
    and x.value_text = '0'
    and exists (
      select 1
      from public.commercial_opportunity_lifecycle_events evt
      where evt.organization_id = v.org_a
    )
    and exists (
      select 1
      from public.commercial_opportunities opp
      where opp.id = v.opp_b
        and opp.organization_id = v.org_b
    ),
    format('visible_rows_for_user_b_in_org_a=%s', coalesce(x.value_text, '<none>')),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L,
          'explicit_refusal',
          'runner changed payload',
          %L::uuid,
          'runner valid human captured evidence',
          'runner_valid_human_loss'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_main,
      v_loss_a_key,
      v.primary_message_id
    ),
    true
  );

  perform pg_temp._p9_424_record(
    51,
    'mesma chave A com payload diferente gera reuse sem alterar projecao',
    not x.operation_succeeded
    and x.returned_sqlstate = '23505'
    and x.message_text = 'ZION_IDEMPOTENCY_KEY_REUSED'
    and exists (
      select 1
      from public.commercial_opportunities opp
      where opp.id = v.opp_main
        and opp.stage = 'negociacao'
        and opp.lifecycle_cycle = v_main_loss_cycle + 1
        and opp.current_loss_event_id is null
        and opp.last_reopened_at = v_reopen_b_created_at
    ),
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select row_to_json(reopen_row)::text
        from public.reopen_commercial_opportunity_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L,
          'negociacao',
          'runner reopen main',
          'runner_reopen_main'
        ) as reopen_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_main,
      v_loss_a_key
    ),
    true
  );

  perform pg_temp._p9_424_record(
    52,
    'mesma chave A em outro event_type e rejeitada',
    not x.operation_succeeded
    and x.returned_sqlstate = '23505'
    and x.message_text = 'ZION_IDEMPOTENCY_KEY_REUSED'
    and not exists (
      select 1
      from public.commercial_opportunity_lifecycle_events evt
      where evt.organization_id = v.org_a
        and evt.store_id = v.store_a
        and evt.commercial_opportunity_id = v.opp_main
        and evt.idempotency_key = v_loss_a_key
        and evt.event_type = 'reopened'
    )
    and exists (
      select 1
      from public.commercial_opportunities opp
      where opp.id = v.opp_main
        and opp.stage = 'negociacao'
        and opp.lifecycle_cycle = v_main_loss_cycle + 1
        and opp.current_loss_event_id is null
        and opp.last_reopened_at = v_reopen_b_created_at
    ),
    coalesce(x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L,
          'explicit_refusal',
          null,
          %L::uuid,
          'runner valid human captured evidence cycle 2',
          'runner_valid_human_loss_cycle_2'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_main,
      v_loss_c_key,
      v.primary_message_id
    )
  );

  v_loss_c_result := x.value_text::jsonb;

  select
    evt.id,
    evt.lifecycle_cycle,
    evt.created_at
  into
    v_loss_c_event_id,
    v_loss_c_cycle,
    v_loss_c_created_at
  from public.commercial_opportunity_lifecycle_events evt
  where evt.organization_id = v.org_a
    and evt.store_id = v.store_a
    and evt.commercial_opportunity_id = v.opp_main
    and evt.idempotency_key = v_loss_c_key
    and evt.event_type = 'marked_lost';

  perform pg_temp._p9_424_record(
    53,
    'nova chave C permite nova perda legitima em novo ciclo',
    x.operation_succeeded
    and exists (
      select 1
      from public.commercial_opportunities opp
      where opp.id = v.opp_main
        and opp.stage = 'perdido'
        and opp.lifecycle_cycle = v_main_loss_cycle + 1
        and opp.current_loss_event_id = v_loss_c_event_id
        and opp.lost_at = v_loss_c_created_at
        and opp.lost_reason_code = 'explicit_refusal'
        and opp.lost_reason_details is null
    )
    and v_loss_c_cycle = v_main_loss_cycle + 1,
    coalesce(x.value_text, x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select row_to_json(reopen_row)::text
        from public.reopen_commercial_opportunity_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L,
          'negociacao',
          'runner reopen main',
          'runner_reopen_main'
        ) as reopen_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_main,
      v_reopen_b_key
    )
  );

  perform pg_temp._p9_424_record(
    54,
    'retry antigo da reabertura B retorna historico sem alterar projecao atual',
    x.operation_succeeded
    and x.value_text::jsonb = v_reopen_b_result
    and (
      select count(*)
      from public.commercial_opportunity_lifecycle_events evt
      where evt.organization_id = v.org_a
        and evt.store_id = v.store_a
        and evt.commercial_opportunity_id = v.opp_main
        and evt.idempotency_key = v_reopen_b_key
        and evt.event_type = 'reopened'
    ) = 1
    and exists (
      select 1
      from public.commercial_opportunities opp
      where opp.id = v.opp_main
        and opp.stage = 'perdido'
        and opp.lifecycle_cycle = v_main_loss_cycle + 1
        and opp.current_loss_event_id = v_loss_c_event_id
        and opp.lost_at = v_loss_c_created_at
    ),
    coalesce(x.value_text, x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  select * into x
  from pg_temp._p9_424_exec_value_sql(
    'authenticated',
    v.user_a,
    format(
      $sql$
        select row_to_json(loss_row)::text
        from public.mark_commercial_opportunity_lost_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L,
          'explicit_refusal',
          null,
          %L::uuid,
          'runner valid human captured evidence',
          'runner_valid_human_loss'
        ) as loss_row
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_main,
      v_loss_a_key,
      v.primary_message_id
    )
  );

  perform pg_temp._p9_424_record(
    55,
    'retry antigo da primeira perda A retorna historico sem mover a projecao atual',
    x.operation_succeeded
    and x.value_text::jsonb = v_loss_a_result
    and (
      select count(*)
      from public.commercial_opportunity_lifecycle_events evt
      where evt.organization_id = v.org_a
        and evt.store_id = v.store_a
        and evt.commercial_opportunity_id = v.opp_main
        and evt.idempotency_key = v_loss_a_key
        and evt.event_type = 'marked_lost'
    ) = 1
    and exists (
      select 1
      from public.commercial_opportunities opp
      where opp.id = v.opp_main
        and opp.stage = 'perdido'
        and opp.lifecycle_cycle = v_main_loss_cycle + 1
        and opp.current_loss_event_id = v_loss_c_event_id
        and opp.lost_at = v_loss_c_created_at
    ),
    coalesce(x.value_text, x.message_text, '<none>'),
    x.returned_sqlstate,
    x.constraint_name
  );

  perform pg_temp._p9_424_record(
    56,
    'assinatura antiga user loss nao existe e overload novo e unico',
    pg_catalog.to_regprocedure(
      'public.mark_commercial_opportunity_lost_by_user(uuid,uuid,uuid,text,text,uuid,text,text)'
    ) is null
    and pg_catalog.to_regprocedure(
      'public.mark_commercial_opportunity_lost_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)'
    ) is not null
    and (
      select count(*)
      from pg_catalog.pg_proc proc_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = proc_row.pronamespace
      where namespace_row.nspname = 'public'
        and proc_row.proname = 'mark_commercial_opportunity_lost_by_user'
    ) = 1,
    'apenas a assinatura nova de user loss deve existir'
  );

  perform pg_temp._p9_424_record(
    57,
    'assinatura antiga system loss nao existe e overload novo e unico',
    pg_catalog.to_regprocedure(
      'public.mark_commercial_opportunity_lost_by_system(uuid,uuid,uuid,text,uuid,text,text,text)'
    ) is null
    and pg_catalog.to_regprocedure(
      'public.mark_commercial_opportunity_lost_by_system(uuid,uuid,uuid,text,text,uuid,text,text,text)'
    ) is not null
    and (
      select count(*)
      from pg_catalog.pg_proc proc_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = proc_row.pronamespace
      where namespace_row.nspname = 'public'
        and proc_row.proname = 'mark_commercial_opportunity_lost_by_system'
    ) = 1,
    'apenas a assinatura nova de system loss deve existir'
  );

  perform pg_temp._p9_424_record(
    58,
    'assinatura antiga reopen nao existe e overload novo e unico',
    pg_catalog.to_regprocedure(
      'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text)'
    ) is null
    and pg_catalog.to_regprocedure(
      'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)'
    ) is not null
    and (
      select count(*)
      from pg_catalog.pg_proc proc_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = proc_row.pronamespace
      where namespace_row.nspname = 'public'
        and proc_row.proname = 'reopen_commercial_opportunity_by_user'
    ) = 1,
    'apenas a assinatura nova de reopen deve existir'
  );
end;
$tests$;

select
  scenario_number,
  scenario_name,
  status,
  detail,
  returned_sqlstate,
  constraint_name
from pg_temp._p9_424_results
order by scenario_number;

do $guard$
declare
  v_failure_report text;
begin
  if (select count(*) from pg_temp._p9_424_results where scenario_number between 1 and 58) <> 58 then
    raise exception using
      errcode = 'P0001',
      message = 'runner did not emit the required 58 scenarios';
  end if;

  select string_agg(
           format(
             'scenario %s | %s | %s | sqlstate=%s | constraint=%s | detail=%s',
             result_row.scenario_number,
             result_row.scenario_name,
             result_row.status,
             coalesce(result_row.returned_sqlstate, '<null>'),
             coalesce(result_row.constraint_name, '<null>'),
             left(result_row.detail, 400)
           ),
           E'\n'
           order by result_row.scenario_number
         )
  into v_failure_report
  from pg_temp._p9_424_results result_row
  where result_row.status = 'SUT_FAIL';

  if v_failure_report is not null then
    raise exception using
      errcode = 'P0001',
      message = 'commercial opportunity loss lifecycle runner detected failures:' || E'\n' || v_failure_report;
  end if;
end;
$guard$;

rollback;
