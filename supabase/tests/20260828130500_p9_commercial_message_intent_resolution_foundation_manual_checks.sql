-- CORRIGIDO V4: resultado final consolidado em uma unica linha para o Supabase SQL Editor.
begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_cmir_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_cmir_ctx (
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
  customer_b_same_org uuid not null,
  customer_other_org uuid not null,
  lead_a uuid not null,
  lead_other_same_store uuid not null,
  lead_b_same_org uuid not null,
  lead_other_org uuid not null,
  conv_captured_a uuid not null,
  conv_pending_a uuid not null,
  conv_no_session_a uuid not null,
  conv_store_b uuid not null,
  conv_other_org uuid not null,
  session_captured_a uuid not null,
  session_pending_a uuid not null,
  session_store_b uuid not null,
  session_other_org uuid not null,
  lead_link_a uuid not null,
  lead_link_other_same_store uuid not null,
  lead_link_store_b uuid not null,
  lead_link_other_org uuid not null,
  opp_prev_a uuid not null,
  opp_resolved_a uuid not null,
  opp_related_a uuid not null,
  opp_other_customer_same_store uuid not null,
  opp_store_b uuid not null,
  opp_other_org uuid not null,
  context_link_a uuid null,
  message_captured_a uuid null,
  message_pending_a uuid null,
  message_no_session_a uuid null,
  message_store_b uuid null,
  message_other_org uuid null,
  seed_event_a uuid null,
  seed_event_b uuid null,
  branch_event_b uuid null,
  baseline_opp_count bigint null,
  baseline_message_count bigint null,
  baseline_context_count bigint null
) on commit preserve rows;

insert into pg_temp._p9_cmir_ctx (
  org_a,
  org_b,
  store_a,
  store_b_same_org,
  store_c_other_org,
  user_a,
  user_b,
  user_inactive_a,
  customer_a,
  customer_b_same_org,
  customer_other_org,
  lead_a,
  lead_other_same_store,
  lead_b_same_org,
  lead_other_org,
  conv_captured_a,
  conv_pending_a,
  conv_no_session_a,
  conv_store_b,
  conv_other_org,
  session_captured_a,
  session_pending_a,
  session_store_b,
  session_other_org,
  lead_link_a,
  lead_link_other_same_store,
  lead_link_store_b,
  lead_link_other_org,
  opp_prev_a,
  opp_resolved_a,
  opp_related_a,
  opp_other_customer_same_store,
  opp_store_b,
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

create or replace function pg_temp._p9_cmir_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_cmir_results (
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

create or replace function pg_temp._p9_cmir_exec_json_sql(
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
        begin
          execute 'reset role';
        exception when others then
          null;
        end;
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
    exception when others then
      null;
    end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    return query
    select false, null::jsonb, sqlstate::text,
      ('runner helper error: ' || sqlerrm)::text, null::text;
end;
$function$;

create or replace function pg_temp._p9_cmir_event_key(
  p_seed integer
)
returns text
language sql
immutable
as $function$
  select lpad(to_hex(p_seed), 64, '0');
$function$;

create or replace function pg_temp._p9_cmir_event_insert_sql(
  p_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_anchor_message_id uuid,
  p_conversation_id uuid,
  p_conversation_session_id uuid,
  p_customer_id uuid,
  p_lead_customer_link_id uuid,
  p_previous_context_opportunity_id uuid,
  p_resolved_opportunity_id uuid,
  p_related_opportunity_id uuid,
  p_relation_type text,
  p_decision_kind text,
  p_reason_code text,
  p_operation_key text,
  p_event_key text,
  p_supersedes_event_id uuid,
  p_actor_type text,
  p_actor_user_id uuid,
  p_created_by text,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
as $function$
begin
  return format(
    $sql$
      insert into public.commercial_message_intent_resolution_events (
        id,
        organization_id,
        store_id,
        anchor_message_id,
        conversation_id,
        conversation_session_id,
        customer_id,
        lead_customer_link_id,
        previous_context_opportunity_id,
        resolved_opportunity_id,
        related_opportunity_id,
        relation_type,
        decision_kind,
        reason_code,
        operation_key,
        event_key,
        supersedes_event_id,
        actor_type,
        actor_user_id,
        created_by,
        metadata
      ) values (
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %s,
        %s,
        %s,
        %s,
        %L,
        %L,
        %L,
        %L,
        %s,
        %L,
        %s,
        %L,
        %L::jsonb
      )
      returning id
    $sql$,
    p_id,
    p_organization_id,
    p_store_id,
    p_anchor_message_id,
    p_conversation_id,
    p_conversation_session_id,
    p_customer_id,
    p_lead_customer_link_id,
    case when p_previous_context_opportunity_id is null then 'null' else format('%L::uuid', p_previous_context_opportunity_id) end,
    case when p_resolved_opportunity_id is null then 'null' else format('%L::uuid', p_resolved_opportunity_id) end,
    case when p_related_opportunity_id is null then 'null' else format('%L::uuid', p_related_opportunity_id) end,
    case when p_relation_type is null then 'null' else format('%L', p_relation_type) end,
    p_decision_kind,
    p_reason_code,
    p_operation_key,
    p_event_key,
    case when p_supersedes_event_id is null then 'null' else format('%L::uuid', p_supersedes_event_id) end,
    p_actor_type,
    case when p_actor_user_id is null then 'null' else format('%L::uuid', p_actor_user_id) end,
    p_created_by,
    coalesce(p_metadata, '{}'::jsonb)::text
  );
end;
$function$;

create or replace function pg_temp._p9_cmir_current_insert_sql(
  p_organization_id uuid,
  p_store_id uuid,
  p_anchor_message_id uuid,
  p_current_event_id uuid,
  p_last_operation_key text
)
returns text
language plpgsql
as $function$
begin
  return format(
    $sql$
      insert into public.commercial_message_intent_resolution_current (
        organization_id,
        store_id,
        anchor_message_id,
        current_event_id,
        last_operation_key
      ) values (
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L
      )
      returning current_event_id
    $sql$,
    p_organization_id,
    p_store_id,
    p_anchor_message_id,
    p_current_event_id,
    p_last_operation_key
  );
end;
$function$;

do $fixtures$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_context_row public.commercial_session_context_links;
  v_message public.messages;
  v_message_captured_a_id uuid;
  v_message_pending_a_id uuid;
  v_message_no_session_a_id uuid;
  v_message_store_b_id uuid;
  v_message_other_org_id uuid;
  v_seed_event_a uuid;
  v_seed_event_b uuid;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  insert into public.organizations (id, name, subscription_status)
  values
    (c.org_a, 'P9 CMIR Runner Org A', 'active'),
    (c.org_b, 'P9 CMIR Runner Org B', 'active');

  insert into public.stores (id, organization_id, name)
  values
    (c.store_a, c.org_a, 'P9 CMIR Runner Store A'),
    (c.store_b_same_org, c.org_a, 'P9 CMIR Runner Store B'),
    (c.store_c_other_org, c.org_b, 'P9 CMIR Runner Store C');

  insert into auth.users (id)
  values
    (c.user_a),
    (c.user_b),
    (c.user_inactive_a);

  insert into public.memberships (organization_id, user_id, role, is_active)
  values
    (c.org_a, c.user_a, 'owner'::public.app_role, true),
    (c.org_b, c.user_b, 'owner'::public.app_role, true),
    (c.org_a, c.user_inactive_a, 'owner'::public.app_role, false);

  insert into public.customers (id, organization_id, display_name, normalized_name)
  values
    (c.customer_a, c.org_a, 'Runner Customer A', 'runner customer a'),
    (c.customer_b_same_org, c.org_a, 'Runner Customer B', 'runner customer b'),
    (c.customer_other_org, c.org_b, 'Runner Customer C', 'runner customer c');

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  values
    (c.org_a, c.store_a, c.customer_a),
    (c.org_a, c.store_a, c.customer_b_same_org),
    (c.org_a, c.store_b_same_org, c.customer_a),
    (c.org_b, c.store_c_other_org, c.customer_other_org);

  insert into public.leads (
    id,
    organization_id,
    store_id,
    name,
    phone,
    state,
    created_at,
    updated_at
  )
  values
    (c.lead_a, c.org_a, c.store_a, 'Lead A', '5511990000001', 'novo_lead', now(), now()),
    (c.lead_other_same_store, c.org_a, c.store_a, 'Lead B', '5511990000002', 'novo_lead', now(), now()),
    (c.lead_b_same_org, c.org_a, c.store_b_same_org, 'Lead C', '5511990000003', 'novo_lead', now(), now()),
    (c.lead_other_org, c.org_b, c.store_c_other_org, 'Lead D', '5511990000004', 'novo_lead', now(), now());

  insert into public.conversations (
    id,
    organization_id,
    lead_id,
    status,
    is_human_active,
    created_at
  )
  values
    (c.conv_captured_a, c.org_a, c.lead_a, 'open', false, now()),
    (c.conv_pending_a, c.org_a, c.lead_a, 'open', false, now()),
    (c.conv_no_session_a, c.org_a, c.lead_a, 'open', false, now()),
    (c.conv_store_b, c.org_a, c.lead_b_same_org, 'open', false, now()),
    (c.conv_other_org, c.org_b, c.lead_other_org, 'open', false, now());

  insert into public.lead_customer_links (
    id,
    organization_id,
    store_id,
    lead_id,
    customer_id,
    status,
    source,
    linked_by_actor_type,
    linked_at,
    metadata
  )
  values
    (c.lead_link_a, c.org_a, c.store_a, c.lead_a, c.customer_a, 'active', 'manual', 'migration', now(), '{}'::jsonb),
    (c.lead_link_other_same_store, c.org_a, c.store_a, c.lead_other_same_store, c.customer_a, 'active', 'manual', 'migration', now(), '{}'::jsonb),
    (c.lead_link_store_b, c.org_a, c.store_b_same_org, c.lead_b_same_org, c.customer_a, 'active', 'manual', 'migration', now(), '{}'::jsonb),
    (c.lead_link_other_org, c.org_b, c.store_c_other_org, c.lead_other_org, c.customer_other_org, 'active', 'manual', 'migration', now(), '{}'::jsonb);

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
    (c.opp_prev_a, c.org_a, c.store_a, c.customer_a, c.lead_a, c.conv_captured_a, 'qualificacao'),
    (c.opp_resolved_a, c.org_a, c.store_a, c.customer_a, c.lead_a, c.conv_pending_a, 'novo_lead'),
    (c.opp_related_a, c.org_a, c.store_a, c.customer_a, c.lead_a, c.conv_pending_a, 'orcamento'),
    (c.opp_other_customer_same_store, c.org_a, c.store_a, c.customer_b_same_org, c.lead_a, c.conv_pending_a, 'novo_lead'),
    (c.opp_store_b, c.org_a, c.store_b_same_org, c.customer_a, c.lead_b_same_org, c.conv_store_b, 'novo_lead'),
    (c.opp_other_org, c.org_b, c.store_c_other_org, c.customer_other_org, c.lead_other_org, c.conv_other_org, 'novo_lead');

  insert into public.conversation_sessions (
    id,
    organization_id,
    store_id,
    conversation_id,
    status
  )
  values
    (c.session_captured_a, c.org_a, c.store_a, c.conv_captured_a, 'active'),
    (c.session_pending_a, c.org_a, c.store_a, c.conv_pending_a, 'active'),
    (c.session_store_b, c.org_a, c.store_b_same_org, c.conv_store_b, 'active'),
    (c.session_other_org, c.org_b, c.store_c_other_org, c.conv_other_org, 'active');

  perform set_config('request.jwt.claim.sub', c.user_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', c.user_a::text,
      'role', 'authenticated'
    )::text,
    true
  );
  execute 'set local role authenticated';

  select *
  into v_context_row
  from public.link_commercial_session_context(
    c.org_a,
    c.store_a,
    c.session_captured_a,
    c.customer_a,
    c.opp_prev_a,
    c.lead_link_a,
    'manual',
    'human',
    c.user_a,
    'runner-captured-context',
    'runner-captured-context',
    gen_random_uuid(),
    '{}'::jsonb,
    null
  );

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'service_role')::text,
    true
  );
  execute 'set local role service_role';

  select * into v_message
  from public.insert_message(
    c.conv_captured_a,
    'user',
    'incoming',
    'text',
    'runner captured message',
    'cmir-captured-' || c.conv_captured_a::text,
    null,
    '{}'::jsonb
  );
  v_message_captured_a_id := v_message.id;

  select * into v_message
  from public.insert_message(
    c.conv_pending_a,
    'user',
    'incoming',
    'text',
    'runner pending message',
    'cmir-pending-' || c.conv_pending_a::text,
    null,
    '{}'::jsonb
  );
  v_message_pending_a_id := v_message.id;

  select * into v_message
  from public.insert_message(
    c.conv_no_session_a,
    'user',
    'incoming',
    'text',
    'runner no session message',
    'cmir-nosession-' || c.conv_no_session_a::text,
    null,
    '{}'::jsonb
  );
  v_message_no_session_a_id := v_message.id;

  select * into v_message
  from public.insert_message(
    c.conv_store_b,
    'user',
    'incoming',
    'text',
    'runner store b message',
    'cmir-storeb-' || c.conv_store_b::text,
    null,
    '{}'::jsonb
  );
  v_message_store_b_id := v_message.id;

  select * into v_message
  from public.insert_message(
    c.conv_other_org,
    'user',
    'incoming',
    'text',
    'runner other org message',
    'cmir-otherorg-' || c.conv_other_org::text,
    null,
    '{}'::jsonb
  );
  v_message_other_org_id := v_message.id;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  -- O harness volta a postgres antes de escrever na tabela temporária.
  -- service_role não recebe privilégios sobre pg_temp._p9_cmir_ctx.
  update pg_temp._p9_cmir_ctx
  set
    message_captured_a = v_message_captured_a_id,
    message_pending_a = v_message_pending_a_id,
    message_no_session_a = v_message_no_session_a_id,
    message_store_b = v_message_store_b_id,
    message_other_org = v_message_other_org_id;

  select * into c from pg_temp._p9_cmir_ctx;

  execute pg_temp._p9_cmir_event_insert_sql(
    gen_random_uuid(),
    c.org_a,
    c.store_a,
    c.message_captured_a,
    c.conv_captured_a,
    c.session_captured_a,
    c.customer_a,
    c.lead_link_a,
    c.opp_prev_a,
    c.opp_prev_a,
    null,
    null,
    'continue_same_intent',
    'seed_captured_context',
    'runner-seed-a',
    pg_temp._p9_cmir_event_key(1001),
    null,
    'system_rule',
    null,
    'postgres.manual_runner'
  ) into v_seed_event_a;

  execute pg_temp._p9_cmir_current_insert_sql(
    c.org_a,
    c.store_a,
    c.message_captured_a,
    v_seed_event_a,
    'runner-seed-a'
  ) into v_dummy;

  execute pg_temp._p9_cmir_event_insert_sql(
    gen_random_uuid(),
    c.org_b,
    c.store_c_other_org,
    c.message_other_org,
    c.conv_other_org,
    c.session_other_org,
    c.customer_other_org,
    c.lead_link_other_org,
    c.opp_other_org,
    c.opp_other_org,
    null,
    null,
    'continue_same_intent',
    'seed_other_org_pending',
    'runner-seed-b',
    pg_temp._p9_cmir_event_key(1002),
    null,
    'system_rule',
    null,
    'postgres.manual_runner'
  ) into v_seed_event_b;

  execute pg_temp._p9_cmir_current_insert_sql(
    c.org_b,
    c.store_c_other_org,
    c.message_other_org,
    v_seed_event_b,
    'runner-seed-b'
  ) into v_dummy;

  update pg_temp._p9_cmir_ctx
  set
    context_link_a = v_context_row.id,
    seed_event_a = v_seed_event_a,
    seed_event_b = v_seed_event_b,
    baseline_opp_count = (
      select count(*) from public.commercial_opportunities
      where organization_id in (c.org_a, c.org_b)
    ),
    baseline_message_count = (
      select count(*) from public.messages
      where organization_id in (c.org_a, c.org_b)
    ),
    baseline_context_count = (
      select count(*) from public.commercial_session_context_links
      where organization_id in (c.org_a, c.org_b)
    );
end;
$fixtures$;

do $s1$
declare
  v_ok boolean;
begin
  select
    pg_catalog.to_regclass('public.commercial_message_intent_resolution_events') is not null
    and pg_catalog.to_regclass('public.commercial_message_intent_resolution_current') is not null
    and pg_catalog.to_regprocedure('public.p9_cmir_validate_event()') is not null
    and pg_catalog.to_regprocedure('public.p9_cmir_validate_current_projection()') is not null
    and pg_catalog.to_regprocedure('public.p9_cmir_touch_current_updated_at()') is not null
    and pg_catalog.to_regprocedure('public.p9_cmir_prevent_event_mutation()') is not null
    and exists (
      select 1
      from pg_catalog.pg_class
      where relname = 'p9_cmir_events_scope_anchor_operation_uidx'
    )
    and exists (
      select 1
      from pg_catalog.pg_class
      where relname = 'p9_cmir_events_scope_anchor_event_key_uidx'
    )
  into v_ok;

  perform pg_temp._p9_cmir_record(
    1,
    'objetos esperados existem',
    case when v_ok then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_cmir_record(1, 'objetos esperados existem', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s1$;

do $s2$
declare
  v_ok boolean;
begin
  select
    (select relrowsecurity from pg_catalog.pg_class where oid = 'public.commercial_message_intent_resolution_events'::regclass)
    and
    (select relrowsecurity from pg_catalog.pg_class where oid = 'public.commercial_message_intent_resolution_current'::regclass)
  into v_ok;

  perform pg_temp._p9_cmir_record(
    2,
    'RLS habilitado nas duas tabelas',
    case when v_ok then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_cmir_record(2, 'RLS habilitado nas duas tabelas', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s2$;

do $s3$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  r_auth record;
  r_service record;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  select * into r_auth
  from pg_temp._p9_cmir_exec_json_sql(
    'authenticated',
    c.user_a,
    pg_temp._p9_cmir_event_insert_sql(
      gen_random_uuid(),
      c.org_a,
      c.store_a,
      c.message_pending_a,
      c.conv_pending_a,
      c.session_pending_a,
      c.customer_a,
      c.lead_link_a,
      null,
      c.opp_resolved_a,
      null,
      null,
      'continue_same_intent',
      'acl_write_check',
      'runner-auth-write-blocked',
      pg_temp._p9_cmir_event_key(3),
      null,
      'system_rule',
      null,
      'postgres.manual_runner'
    )
  );

  select * into r_service
  from pg_temp._p9_cmir_exec_json_sql(
    'service_role',
    null,
    pg_temp._p9_cmir_current_insert_sql(
      c.org_a,
      c.store_a,
      c.message_pending_a,
      c.seed_event_a,
      'runner-service-write-blocked'
    )
  );

  select
    not pg_catalog.has_table_privilege('authenticated', 'public.commercial_message_intent_resolution_events', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_message_intent_resolution_events', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_message_intent_resolution_events', 'DELETE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_message_intent_resolution_current', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_message_intent_resolution_current', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.commercial_message_intent_resolution_current', 'DELETE')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_message_intent_resolution_events', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_message_intent_resolution_events', 'UPDATE')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_message_intent_resolution_events', 'DELETE')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_message_intent_resolution_current', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_message_intent_resolution_current', 'UPDATE')
    and not pg_catalog.has_table_privilege('service_role', 'public.commercial_message_intent_resolution_current', 'DELETE')
    and not pg_catalog.has_table_privilege('anon', 'public.commercial_message_intent_resolution_events', 'INSERT')
    and not pg_catalog.has_table_privilege('anon', 'public.commercial_message_intent_resolution_events', 'UPDATE')
    and not pg_catalog.has_table_privilege('anon', 'public.commercial_message_intent_resolution_events', 'DELETE')
    and not pg_catalog.has_table_privilege('anon', 'public.commercial_message_intent_resolution_current', 'INSERT')
    and not pg_catalog.has_table_privilege('anon', 'public.commercial_message_intent_resolution_current', 'UPDATE')
    and not pg_catalog.has_table_privilege('anon', 'public.commercial_message_intent_resolution_current', 'DELETE')
    and not r_auth.operation_succeeded
    and not r_service.operation_succeeded
  into v_ok;

  perform pg_temp._p9_cmir_record(
    3,
    'ACL de escrita direta permanece fechada',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r_auth.returned_sqlstate || ' ' || r_auth.message_text, '<null>')
      || ' | '
      || coalesce(r_service.returned_sqlstate || ' ' || r_service.message_text, '<null>')
  );
exception when others then
  perform pg_temp._p9_cmir_record(3, 'ACL de escrita direta permanece fechada', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s3$;

do $s4$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  r_user_a record;
  r_user_b record;
  r_inactive record;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  select * into r_user_a
  from pg_temp._p9_cmir_exec_json_sql(
    'authenticated',
    c.user_a,
    'select count(*) as visible_events from public.commercial_message_intent_resolution_events'
  );

  select * into r_user_b
  from pg_temp._p9_cmir_exec_json_sql(
    'authenticated',
    c.user_b,
    'select count(*) as visible_events from public.commercial_message_intent_resolution_events'
  );

  select * into r_inactive
  from pg_temp._p9_cmir_exec_json_sql(
    'authenticated',
    c.user_inactive_a,
    'select count(*) as visible_events from public.commercial_message_intent_resolution_events'
  );

  select
    r_user_a.operation_succeeded
    and r_user_b.operation_succeeded
    and r_inactive.operation_succeeded
    and (r_user_a.value_json ->> 'visible_events')::bigint = 1
    and (r_user_b.value_json ->> 'visible_events')::bigint = 1
    and (r_inactive.value_json ->> 'visible_events')::bigint = 0
  into v_ok;

  perform pg_temp._p9_cmir_record(
    4,
    'authenticated so le organizacao com membership ativa',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    format(
      'user_a=%s user_b=%s inactive=%s',
      r_user_a.value_json,
      r_user_b.value_json,
      r_inactive.value_json
    )
  );
exception when others then
  perform pg_temp._p9_cmir_record(4, 'authenticated so le organizacao com membership ativa', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s4$;

do $s5$
declare
  r_anon record;
  v_ok boolean;
begin
  select * into r_anon
  from pg_temp._p9_cmir_exec_json_sql(
    'anon',
    null,
    'select count(*) as visible_events from public.commercial_message_intent_resolution_events'
  );

  select
    not r_anon.operation_succeeded
    and coalesce(r_anon.returned_sqlstate, '') in ('42501', 'P0001')
  into v_ok;

  perform pg_temp._p9_cmir_record(
    5,
    'anon nao le',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(r_anon.returned_sqlstate || ' ' || r_anon.message_text, '<null>')
  );
exception when others then
  perform pg_temp._p9_cmir_record(5, 'anon nao le', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s5$;

do $s6$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_id uuid;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  execute pg_temp._p9_cmir_event_insert_sql(
    gen_random_uuid(),
    c.org_a,
    c.store_a,
    c.message_pending_a,
    c.conv_pending_a,
    c.session_pending_a,
    c.customer_a,
    c.lead_link_a,
    null,
    c.opp_resolved_a,
    null,
    null,
    'new_independent_opportunity',
    'valid_pending_new_opportunity',
    'runner-valid-event',
    pg_temp._p9_cmir_event_key(6)
    ,
    null,
    'system_rule',
    null,
    'postgres.manual_runner'
  ) into v_id;

  perform pg_temp._p9_cmir_record(
    6,
    'event valido e aceito em contexto controlado',
    case when v_id is not null then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_id::text, '<null>')
  );
exception when others then
  perform pg_temp._p9_cmir_record(6, 'event valido e aceito em contexto controlado', 'SUT_FAIL', sqlstate || ' ' || sqlerrm);
end;
$s6$;

do $s7$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  begin
    update public.commercial_message_intent_resolution_events
    set reason_code = 'mutated'
    where id = c.seed_event_a;
  exception when others then
    v_blocked := sqlstate = 'P0001';
  end;

  perform pg_temp._p9_cmir_record(
    7,
    'event UPDATE e bloqueado',
    case when v_blocked then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_cmir_record(7, 'event UPDATE e bloqueado', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s7$;

do $s8$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  begin
    delete from public.commercial_message_intent_resolution_events
    where id = c.seed_event_a;
  exception when others then
    v_blocked := sqlstate = 'P0001';
  end;

  perform pg_temp._p9_cmir_record(
    8,
    'event DELETE e bloqueado',
    case when v_blocked then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_cmir_record(8, 'event DELETE e bloqueado', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s8$;

do $s9$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_detail text;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(
      gen_random_uuid(),
      c.org_a,
      c.store_a,
      c.message_pending_a,
      c.conv_pending_a,
      c.session_pending_a,
      c.customer_a,
      c.lead_link_a,
      null,
      c.opp_resolved_a,
      null,
      null,
      'invalid_kind',
      'bad_kind',
      'runner-bad-kind',
      pg_temp._p9_cmir_event_key(9),
      null,
      'system_rule',
      null,
      'postgres.manual_runner'
    ) into v_dummy;
  exception when others then
    v_blocked := true;
    v_detail := sqlstate || ' ' || sqlerrm;
  end;

  perform pg_temp._p9_cmir_record(9, 'decision_kind fora da enum e rejeitado', case when v_blocked then 'PASS' else 'SUT_FAIL' end, v_detail);
exception when others then
  perform pg_temp._p9_cmir_record(9, 'decision_kind fora da enum e rejeitado', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s9$;

do $s10$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked_count integer := 0;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, null, null, null, 'continue_same_intent', 'shape1', 'runner-shape-1', pg_temp._p9_cmir_event_key(101), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked_count := v_blocked_count + 1; end;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, c.opp_resolved_a, c.opp_related_a, null, 'reopen_same_intent', 'shape2', 'runner-shape-2', pg_temp._p9_cmir_event_key(102), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked_count := v_blocked_count + 1; end;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, c.opp_resolved_a, c.opp_related_a, 'repurchase_of', 'new_independent_opportunity', 'shape3', 'runner-shape-3', pg_temp._p9_cmir_event_key(103), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked_count := v_blocked_count + 1; end;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, c.opp_resolved_a, null, null, 'repurchase', 'shape4', 'runner-shape-4', pg_temp._p9_cmir_event_key(104), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked_count := v_blocked_count + 1; end;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, c.opp_resolved_a, null, null, 'addendum', 'shape5', 'runner-shape-5', pg_temp._p9_cmir_event_key(105), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked_count := v_blocked_count + 1; end;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, c.opp_resolved_a, null, null, 'needs_clarification', 'shape6', 'runner-shape-6', pg_temp._p9_cmir_event_key(106), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked_count := v_blocked_count + 1; end;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, null, c.opp_related_a, null, 'structural_ambiguity', 'shape7', 'runner-shape-7', pg_temp._p9_cmir_event_key(107), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked_count := v_blocked_count + 1; end;

  perform pg_temp._p9_cmir_record(
    10,
    'shapes invalidos de cada decision_kind sao rejeitados',
    case when v_blocked_count = 7 then 'PASS' else 'SUT_FAIL' end,
    format('blocked=%s', v_blocked_count)
  );
exception when others then
  perform pg_temp._p9_cmir_record(10, 'shapes invalidos de cada decision_kind sao rejeitados', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s10$;

do $s11$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_detail text;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, c.opp_resolved_a, c.opp_related_a, 'addendum_to', 'repurchase', 'wrong_relation_repurchase', 'runner-repurchase-wrong', pg_temp._p9_cmir_event_key(11), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then
    v_blocked := true;
    v_detail := sqlstate || ' ' || sqlerrm;
  end;

  perform pg_temp._p9_cmir_record(11, 'repurchase exige repurchase_of', case when v_blocked then 'PASS' else 'SUT_FAIL' end, v_detail);
exception when others then
  perform pg_temp._p9_cmir_record(11, 'repurchase exige repurchase_of', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s11$;

do $s12$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_detail text;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, c.opp_resolved_a, c.opp_related_a, 'repurchase_of', 'addendum', 'wrong_relation_addendum', 'runner-addendum-wrong', pg_temp._p9_cmir_event_key(12), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then
    v_blocked := true;
    v_detail := sqlstate || ' ' || sqlerrm;
  end;

  perform pg_temp._p9_cmir_record(12, 'addendum exige addendum_to', case when v_blocked then 'PASS' else 'SUT_FAIL' end, v_detail);
exception when others then
  perform pg_temp._p9_cmir_record(12, 'addendum exige addendum_to', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s12$;

do $s13$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, c.opp_resolved_a, c.opp_resolved_a, 'repurchase_of', 'repurchase', 'same_resolved_related', 'runner-same-related', pg_temp._p9_cmir_event_key(13), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then
    v_blocked := true;
  end;

  perform pg_temp._p9_cmir_record(13, 'resolved == related e rejeitado', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(13, 'resolved == related e rejeitado', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s13$;

do $s14$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, c.opp_other_org, null, null, 'continue_same_intent', 'cross_org_opp', 'runner-cross-org-opp', pg_temp._p9_cmir_event_key(14), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(14, 'cross-organization opportunity e rejeitada', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(14, 'cross-organization opportunity e rejeitada', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s14$;

do $s15$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, c.opp_store_b, null, null, 'continue_same_intent', 'cross_store_opp', 'runner-cross-store-opp', pg_temp._p9_cmir_event_key(15), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(15, 'cross-store opportunity e rejeitada', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(15, 'cross-store opportunity e rejeitada', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s15$;

do $s16$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, c.opp_other_customer_same_store, null, null, 'continue_same_intent', 'cross_customer_opp', 'runner-cross-customer-opp', pg_temp._p9_cmir_event_key(16), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(16, 'cross-customer opportunity e rejeitada', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(16, 'cross-customer opportunity e rejeitada', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s16$;

do $s17$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_other_org, c.conv_captured_a, c.session_captured_a, c.customer_a, c.lead_link_a, c.opp_prev_a, c.opp_prev_a, null, null, 'continue_same_intent', 'cross_org_anchor', 'runner-cross-org-anchor', pg_temp._p9_cmir_event_key(17), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(17, 'anchor message fora da organization e rejeitada', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(17, 'anchor message fora da organization e rejeitada', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s17$;

do $s18$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_store_b, c.conv_captured_a, c.session_captured_a, c.customer_a, c.lead_link_a, c.opp_prev_a, c.opp_prev_a, null, null, 'continue_same_intent', 'cross_store_anchor', 'runner-cross-store-anchor', pg_temp._p9_cmir_event_key(18), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(18, 'anchor message fora da store e rejeitada', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(18, 'anchor message fora da store e rejeitada', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s18$;

do $s19$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_captured_a, c.conv_pending_a, c.session_captured_a, c.customer_a, c.lead_link_a, c.opp_prev_a, c.opp_prev_a, null, null, 'continue_same_intent', 'wrong_conversation', 'runner-wrong-conversation', pg_temp._p9_cmir_event_key(19), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(19, 'conversation incorreta e rejeitada', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(19, 'conversation incorreta e rejeitada', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s19$;

do $s20$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_captured_a, c.conv_captured_a, c.session_pending_a, c.customer_a, c.lead_link_a, c.opp_prev_a, c.opp_prev_a, null, null, 'continue_same_intent', 'wrong_session', 'runner-wrong-session', pg_temp._p9_cmir_event_key(20), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(20, 'conversation_session incorreta e rejeitada', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(20, 'conversation_session incorreta e rejeitada', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s20$;

do $s21$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_other_same_store, null, c.opp_resolved_a, null, null, 'continue_same_intent', 'wrong_lead_link', 'runner-wrong-lead-link', pg_temp._p9_cmir_event_key(21), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(21, 'lead_customer_link incompativel e rejeitado', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(21, 'lead_customer_link incompativel e rejeitado', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s21$;

do $s22$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_captured_a, c.conv_captured_a, c.session_captured_a, c.customer_a, c.lead_link_a, c.opp_resolved_a, c.opp_prev_a, null, null, 'continue_same_intent', 'wrong_previous_snapshot', 'runner-wrong-previous', pg_temp._p9_cmir_event_key(22), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(22, 'captured exige previous_context_opportunity_id igual ao snapshot', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(22, 'captured exige previous_context_opportunity_id igual ao snapshot', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s22$;

do $s23$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, c.opp_prev_a, c.opp_resolved_a, null, null, 'continue_same_intent', 'pending_with_previous', 'runner-pending-with-previous', pg_temp._p9_cmir_event_key(23), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(23, 'pending_context exige previous_context_opportunity_id NULL', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(23, 'pending_context exige previous_context_opportunity_id NULL', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s23$;

do $s24$
declare
  v_event_validator text;
  v_current_validator text;
  v_ok boolean;
begin
  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.p9_cmir_validate_event()')
  )
  into v_event_validator;

  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.p9_cmir_validate_current_projection()')
  )
  into v_current_validator;

  select
    v_event_validator is not null
    and v_current_validator is not null
    and pg_catalog.strpos(pg_catalog.lower(v_event_validator), 'order by') = 0
    and pg_catalog.strpos(pg_catalog.lower(v_event_validator), 'limit 1') = 0
    and pg_catalog.strpos(pg_catalog.lower(v_event_validator), 'commercial_opportunities') = 0
    and pg_catalog.strpos(pg_catalog.lower(v_current_validator), 'order by') = 0
    and pg_catalog.strpos(pg_catalog.lower(v_current_validator), 'limit 1') = 0
  into v_ok;

  perform pg_temp._p9_cmir_record(
    24,
    'foundation nao possui fallback por latest/first/most recent opportunity',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    'validators nao selecionam opportunity por recencia'
  );
exception when others then
  perform pg_temp._p9_cmir_record(
    24,
    'foundation nao possui fallback por latest/first/most recent opportunity',
    'HARNESS_ERROR',
    sqlstate || ' ' || sqlerrm
  );
end;
$s24$;

do $s25$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked_count integer := 0;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, c.opp_resolved_a, null, null, 'continue_same_intent', 'blank_op_1', '', pg_temp._p9_cmir_event_key(251), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked_count := v_blocked_count + 1; end;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, c.opp_resolved_a, null, null, 'continue_same_intent', 'blank_op_2', '  whitespace  ', pg_temp._p9_cmir_event_key(252), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked_count := v_blocked_count + 1; end;

  perform pg_temp._p9_cmir_record(25, 'operation_key vazia ou com whitespace invalido e rejeitada', case when v_blocked_count = 2 then 'PASS' else 'SUT_FAIL' end, format('blocked=%s', v_blocked_count));
exception when others then
  perform pg_temp._p9_cmir_record(25, 'operation_key vazia ou com whitespace invalido e rejeitada', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s25$;

do $s26$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, null, null, null, 'needs_clarification', 'dup_operation_first', 'runner-dup-operation', pg_temp._p9_cmir_event_key(261), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, null, null, null, 'needs_clarification', 'dup_operation_second', 'runner-dup-operation', pg_temp._p9_cmir_event_key(262), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then
    v_blocked := true;
  end;

  perform pg_temp._p9_cmir_record(26, 'slot de operation_key duplicado e protegido', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(26, 'slot de operation_key duplicado e protegido', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s26$;

do $s27$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, null, null, null, 'needs_clarification', 'invalid_event_key', 'runner-invalid-eventkey', 'not-a-sha256', null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(27, 'event_key invalido e rejeitado', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(27, 'event_key invalido e rejeitado', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s27$;

do $s28$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, null, null, null, 'needs_clarification', 'dup_event_key_first', 'runner-dup-eventkey-a', pg_temp._p9_cmir_event_key(281), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, null, null, null, 'needs_clarification', 'dup_event_key_second', 'runner-dup-eventkey-b', pg_temp._p9_cmir_event_key(281), null, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then
    v_blocked := true;
  end;

  perform pg_temp._p9_cmir_record(28, 'event_key duplicate semantic slot e protegido', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(28, 'event_key duplicate semantic slot e protegido', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s28$;

do $s29$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(gen_random_uuid(), c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, null, null, null, 'needs_clarification', 'cross_anchor_supersedes', 'runner-cross-anchor-supersedes', pg_temp._p9_cmir_event_key(29), c.seed_event_a, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(29, 'supersedes_event_id cross-anchor e rejeitado', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(29, 'supersedes_event_id cross-anchor e rejeitado', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s29$;

do $s30$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_id uuid := gen_random_uuid();
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(v_id, c.org_a, c.store_a, c.message_pending_a, c.conv_pending_a, c.session_pending_a, c.customer_a, c.lead_link_a, null, null, null, null, 'needs_clarification', 'self_supersedes', 'runner-self-supersedes', pg_temp._p9_cmir_event_key(30), v_id, 'system_rule', null, 'postgres.manual_runner') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(30, 'self-supersession e rejeitada', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(30, 'self-supersession e rejeitada', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s30$;

do $s32$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  select exists (
    select 1
    from public.commercial_message_intent_resolution_current current_row
    where current_row.organization_id = c.org_a
      and current_row.store_id = c.store_a
      and current_row.anchor_message_id = c.message_captured_a
      and current_row.current_event_id = c.seed_event_a
      and current_row.last_operation_key = 'runner-seed-a'
  ) into v_ok;

  perform pg_temp._p9_cmir_record(32, 'current projection valida aponta para evento correto', case when v_ok then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(32, 'current projection valida aponta para evento correto', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s32$;

do $s33$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_current_insert_sql(c.org_a, c.store_a, c.message_pending_a, c.seed_event_a, 'runner-current-cross-anchor') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(33, 'current cross-anchor e rejeitada', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(33, 'current cross-anchor e rejeitada', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s33$;

do $s34$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_current_insert_sql(c.org_b, c.store_c_other_org, c.message_other_org, c.seed_event_a, 'runner-current-cross-tenant') into v_dummy;
  exception when others then v_blocked := true; end;
  perform pg_temp._p9_cmir_record(34, 'current cross-tenant/store e rejeitada', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(34, 'current cross-tenant/store e rejeitada', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s34$;

do $s35$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    update public.commercial_message_intent_resolution_current
    set anchor_message_id = c.message_pending_a
    where organization_id = c.org_a
      and store_id = c.store_a
      and anchor_message_id = c.message_captured_a;
  exception when others then
    v_blocked := true;
  end;

  perform pg_temp._p9_cmir_record(35, 'identidade da current projection e imutavel', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(35, 'identidade da current projection e imutavel', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s35$;

do $s44$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(
      gen_random_uuid(),
      c.org_a,
      c.store_a,
      c.message_captured_a,
      c.conv_captured_a,
      c.session_captured_a,
      c.customer_a,
      c.lead_link_a,
      c.opp_prev_a,
      c.opp_resolved_a,
      null,
      null,
      'continue_same_intent',
      'same_intent_cannot_switch_opportunity',
      'runner-same-intent-switch',
      pg_temp._p9_cmir_event_key(44),
      c.seed_event_a,
      'system_rule',
      null,
      'postgres.manual_runner'
    ) into v_dummy;
  exception when check_violation then
    v_blocked := true;
  end;

  perform pg_temp._p9_cmir_record(
    44,
    'captured continue_same_intent deve resolver exatamente a opportunity capturada',
    case when v_blocked then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_cmir_record(
    44,
    'captured continue_same_intent deve resolver exatamente a opportunity capturada',
    'HARNESS_ERROR',
    sqlstate || ' ' || sqlerrm
  );
end;
$s44$;

do $s45$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(
      gen_random_uuid(),
      c.org_a,
      c.store_a,
      c.message_captured_a,
      c.conv_captured_a,
      c.session_captured_a,
      c.customer_a,
      c.lead_link_a,
      c.opp_prev_a,
      c.opp_prev_a,
      null,
      null,
      'new_independent_opportunity',
      'new_intent_cannot_reuse_previous_context',
      'runner-new-intent-reuse-previous',
      pg_temp._p9_cmir_event_key(45),
      c.seed_event_a,
      'system_rule',
      null,
      'postgres.manual_runner'
    ) into v_dummy;
  exception when check_violation then
    v_blocked := true;
  end;

  perform pg_temp._p9_cmir_record(
    45,
    'captured nova intent nao pode reutilizar a previous_context opportunity como resolved',
    case when v_blocked then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_cmir_record(
    45,
    'captured nova intent nao pode reutilizar a previous_context opportunity como resolved',
    'HARNESS_ERROR',
    sqlstate || ' ' || sqlerrm
  );
end;
$s45$;

do $s37$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_branch_id uuid;
  v_old_updated_at timestamptz;
  v_new_updated_at timestamptz;
  v_ok boolean;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  select updated_at
  into v_old_updated_at
  from public.commercial_message_intent_resolution_current
  where organization_id = c.org_a
    and store_id = c.store_a
    and anchor_message_id = c.message_captured_a;

  execute pg_temp._p9_cmir_event_insert_sql(
    gen_random_uuid(),
    c.org_a,
    c.store_a,
    c.message_captured_a,
    c.conv_captured_a,
    c.session_captured_a,
    c.customer_a,
    c.lead_link_a,
    c.opp_prev_a,
    c.opp_resolved_a,
    null,
    null,
    'new_independent_opportunity',
    'append_only_correction',
    'runner-append-only-correction',
    pg_temp._p9_cmir_event_key(37),
    c.seed_event_a,
    'human_correction',
    c.user_a,
    'postgres.manual_runner'
  ) into v_branch_id;

  update public.commercial_message_intent_resolution_current
  set current_event_id = v_branch_id,
      last_operation_key = 'runner-append-only-correction'
  where organization_id = c.org_a
    and store_id = c.store_a
    and anchor_message_id = c.message_captured_a;

  set constraints p9_cmir_events_superseded_not_current immediate;
  set constraints p9_cmir_events_superseded_not_current deferred;

  update pg_temp._p9_cmir_ctx
  set branch_event_b = v_branch_id;

  select updated_at
  into v_new_updated_at
  from public.commercial_message_intent_resolution_current
  where organization_id = c.org_a
    and store_id = c.store_a
    and anchor_message_id = c.message_captured_a;

  select exists (
    select 1
    from public.commercial_message_intent_resolution_events event_a
    where event_a.id = c.seed_event_a
  )
  and exists (
    select 1
    from public.commercial_message_intent_resolution_events event_b
    where event_b.id = v_branch_id
      and event_b.supersedes_event_id = c.seed_event_a
  )
  and exists (
    select 1
    from public.commercial_message_intent_resolution_current current_row
    where current_row.organization_id = c.org_a
      and current_row.store_id = c.store_a
      and current_row.anchor_message_id = c.message_captured_a
      and current_row.current_event_id = v_branch_id
      and current_row.last_operation_key = 'runner-append-only-correction'
  )
  and v_new_updated_at >= v_old_updated_at
  into v_ok;

  perform pg_temp._p9_cmir_record(37, 'correcao append-only preserva A cria B e current aponta B', case when v_ok then 'PASS' else 'SUT_FAIL' end, format('branch=%s old=%s new=%s', v_branch_id, v_old_updated_at, v_new_updated_at));
exception when others then
  perform pg_temp._p9_cmir_record(37, 'correcao append-only preserva A cria B e current aponta B', 'SUT_FAIL', sqlstate || ' ' || sqlerrm);
end;
$s37$;

do $s36$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    update public.commercial_message_intent_resolution_current
    set current_event_id = c.seed_event_a,
        last_operation_key = 'runner-seed-a'
    where organization_id = c.org_a
      and store_id = c.store_a
      and anchor_message_id = c.message_captured_a;
  exception when others then
    v_blocked := true;
  end;

  perform pg_temp._p9_cmir_record(36, 'current nao pode apontar para evento ja superseded', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(36, 'current nao pode apontar para evento ja superseded', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s36$;

do $s31$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  begin
    execute pg_temp._p9_cmir_event_insert_sql(
      gen_random_uuid(),
      c.org_a,
      c.store_a,
      c.message_captured_a,
      c.conv_captured_a,
      c.session_captured_a,
      c.customer_a,
      c.lead_link_a,
      c.opp_prev_a,
      c.opp_related_a,
      null,
      null,
      'new_independent_opportunity',
      'second_branch',
      'runner-second-branch',
      pg_temp._p9_cmir_event_key(31),
      c.seed_event_a,
      'human_correction',
      c.user_a,
      'postgres.manual_runner'
    ) into v_dummy;
  exception when others then
    v_blocked := true;
  end;

  perform pg_temp._p9_cmir_record(31, 'o mesmo evento nao pode ser superseded por duas branches concorrentes', case when v_blocked then 'PASS' else 'SUT_FAIL' end);
exception when others then
  perform pg_temp._p9_cmir_record(31, 'o mesmo evento nao pode ser superseded por duas branches concorrentes', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s31$;

do $s41$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(
      gen_random_uuid(),
      c.org_b,
      c.store_c_other_org,
      c.message_other_org,
      c.conv_other_org,
      c.session_other_org,
      c.customer_other_org,
      c.lead_link_other_org,
      c.opp_other_org,
      c.opp_other_org,
      null,
      null,
      'continue_same_intent',
      'deferred_guard_without_current_move',
      'runner-deferred-guard',
      pg_temp._p9_cmir_event_key(41),
      c.seed_event_b,
      'system_rule',
      null,
      'postgres.manual_runner'
    ) into v_dummy;

    set constraints p9_cmir_events_superseded_not_current immediate;
  exception when others then
    v_blocked := true;
  end;

  set constraints p9_cmir_events_superseded_not_current deferred;

  perform pg_temp._p9_cmir_record(
    41,
    'deferred guard rejeita supersession sem mover current na mesma transacao',
    case when v_blocked then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  begin
    set constraints p9_cmir_events_superseded_not_current deferred;
  exception when others then
    null;
  end;
  perform pg_temp._p9_cmir_record(
    41,
    'deferred guard rejeita supersession sem mover current na mesma transacao',
    'HARNESS_ERROR',
    sqlstate || ' ' || sqlerrm
  );
end;
$s41$;

do $s42$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_root_a uuid;
  v_root_b uuid;
  v_blocked boolean := false;
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  select event_row.id
  into v_root_a
  from public.commercial_message_intent_resolution_events event_row
  where event_row.organization_id = c.org_a
    and event_row.store_id = c.store_a
    and event_row.anchor_message_id = c.message_pending_a
    and event_row.operation_key = 'runner-valid-event';

  select event_row.id
  into v_root_b
  from public.commercial_message_intent_resolution_events event_row
  where event_row.organization_id = c.org_a
    and event_row.store_id = c.store_a
    and event_row.anchor_message_id = c.message_pending_a
    and event_row.operation_key = 'runner-dup-operation';

  if v_root_a is null or v_root_b is null then
    raise exception 'runner roots required for current linearity check are missing';
  end if;

  execute pg_temp._p9_cmir_current_insert_sql(
    c.org_a,
    c.store_a,
    c.message_pending_a,
    v_root_a,
    'runner-valid-event'
  ) into v_dummy;

  begin
    update public.commercial_message_intent_resolution_current
    set current_event_id = v_root_b,
        last_operation_key = 'runner-dup-operation'
    where organization_id = c.org_a
      and store_id = c.store_a
      and anchor_message_id = c.message_pending_a;
  exception when others then
    v_blocked := true;
  end;

  perform pg_temp._p9_cmir_record(
    42,
    'current nao pode saltar para evento que nao supersede diretamente o current anterior',
    case when v_blocked then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_cmir_record(
    42,
    'current nao pode saltar para evento que nao supersede diretamente o current anterior',
    'HARNESS_ERROR',
    sqlstate || ' ' || sqlerrm
  );
end;
$s42$;

do $s43$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_blocked boolean := false;
  v_fake_user uuid := gen_random_uuid();
  v_dummy record;
begin
  select * into c from pg_temp._p9_cmir_ctx;

  if c.branch_event_b is null then
    raise exception 'runner branch_event_b is required for actor FK check';
  end if;

  begin
    execute pg_temp._p9_cmir_event_insert_sql(
      gen_random_uuid(),
      c.org_a,
      c.store_a,
      c.message_captured_a,
      c.conv_captured_a,
      c.session_captured_a,
      c.customer_a,
      c.lead_link_a,
      c.opp_prev_a,
      c.opp_related_a,
      null,
      null,
      'new_independent_opportunity',
      'unknown_human_actor',
      'runner-unknown-human-actor',
      pg_temp._p9_cmir_event_key(43),
      c.branch_event_b,
      'human_correction',
      v_fake_user,
      'postgres.manual_runner'
    ) into v_dummy;
  exception when foreign_key_violation then
    v_blocked := true;
  end;

  perform pg_temp._p9_cmir_record(
    43,
    'human_correction exige actor_user_id existente em auth.users',
    case when v_blocked then 'PASS' else 'SUT_FAIL' end
  );
exception when others then
  perform pg_temp._p9_cmir_record(
    43,
    'human_correction exige actor_user_id existente em auth.users',
    'HARNESS_ERROR',
    sqlstate || ' ' || sqlerrm
  );
end;
$s43$;

do $s38$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_now bigint;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  select count(*) into v_now
  from public.commercial_opportunities
  where organization_id in (c.org_a, c.org_b);

  perform pg_temp._p9_cmir_record(38, 'nenhuma mutation ocorreu em commercial_opportunities', case when v_now = c.baseline_opp_count then 'PASS' else 'SUT_FAIL' end, format('baseline=%s now=%s', c.baseline_opp_count, v_now));
exception when others then
  perform pg_temp._p9_cmir_record(38, 'nenhuma mutation ocorreu em commercial_opportunities', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s38$;

do $s39$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_now bigint;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  select count(*) into v_now
  from public.messages
  where organization_id in (c.org_a, c.org_b);

  perform pg_temp._p9_cmir_record(39, 'nenhuma mutation ocorreu em messages', case when v_now = c.baseline_message_count then 'PASS' else 'SUT_FAIL' end, format('baseline=%s now=%s', c.baseline_message_count, v_now));
exception when others then
  perform pg_temp._p9_cmir_record(39, 'nenhuma mutation ocorreu em messages', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s39$;

do $s40$
declare
  c pg_temp._p9_cmir_ctx%rowtype;
  v_now bigint;
begin
  select * into c from pg_temp._p9_cmir_ctx;
  select count(*) into v_now
  from public.commercial_session_context_links
  where organization_id in (c.org_a, c.org_b);

  perform pg_temp._p9_cmir_record(40, 'nenhuma mutation ocorreu em commercial_session_context_links', case when v_now = c.baseline_context_count then 'PASS' else 'SUT_FAIL' end, format('baseline=%s now=%s', c.baseline_context_count, v_now));
exception when others then
  perform pg_temp._p9_cmir_record(40, 'nenhuma mutation ocorreu em commercial_session_context_links', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);
end;
$s40$;

select
  count(*) filter (where status = 'PASS') as passed,
  count(*) filter (where status = 'SUT_FAIL') as sut_failed,
  count(*) filter (where status = 'HARNESS_ERROR') as harness_errors,
  count(*) as total,
  count(*) filter (where status <> 'PASS') as failed_scenarios,
  (
    count(*) = 45
    and count(*) filter (where status = 'PASS') = 45
    and count(*) filter (where status <> 'PASS') = 0
  ) as all_45_passed
from pg_temp._p9_cmir_results;

rollback;
