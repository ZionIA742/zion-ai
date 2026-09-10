-- P9 / Block 5 / Stage 5.3
-- Canonical opt-out system writer + race-safe SEND + legacy fail-closed.
--
-- This runner:
-- - creates only disposable fixtures;
-- - never redefines public production functions;
-- - executes inside BEGIN/ROLLBACK;
-- - does not depend on existing DEV customers/leads/opportunities;
-- - does not send HTTP/WhatsApp externally;
-- - validates opt-out independently from Lost.

begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;


-- ============================================================================
-- Result matrix
-- ============================================================================

create temp table pg_temp._p9_53_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (
    status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')
  ),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_53_matrix (
  scenario_number integer primary key,
  scenario_name text not null
) on commit preserve rows;

insert into pg_temp._p9_53_matrix (
  scenario_number,
  scenario_name
)
values
  (
    1,
    'system opt-out converte ciclo active em opted_out sem Lost'
  ),
  (
    2,
    'replay da mesma operation_key nao duplica ciclo nem evento'
  ),
  (
    3,
    'operation_key conflitante falha fechada'
  ),
  (
    4,
    'source message conversation tenant e store errados falham fechados'
  ),
  (
    5,
    'system opt-out sem ciclo active cria somente um ciclo opted_out'
  ),
  (
    6,
    'novo operation_key apos opted_out nao cria segundo ciclo'
  ),
  (
    7,
    'reativacao humana apos opted_out permanece bloqueada'
  ),
  (
    8,
    'executor diante de ciclo opted_out nao envia nem registra tentativa'
  ),
  (
    9,
    'legacy followup offer handler falha fechado sem mensagem'
  ),
  (
    10,
    'legacy followup visit handler falha fechado sem mensagem'
  ),
  (
    11,
    'ai_sales_action_apply_real falha fechado para followup'
  ),
  (
    12,
    'ai_sales_action_dispatch_real falha fechado para followup'
  ),
  (
    13,
    'executor possui ordem race-safe conversation lock incoming recheck send'
  ),
  (
    14,
    'writer system possui ACL e autoridade exata sem mutacao Lost'
  ),
  (
    15,
    'caminhos real nao-followup permanecem estruturalmente preservados'
  );


-- ============================================================================
-- Fixture context
-- ============================================================================

create temp table pg_temp._p9_53_ctx (
  singleton boolean primary key default true check (singleton),

  run_id uuid not null,

  organization_id uuid not null,
  store_id uuid not null,
  other_store_id uuid not null,
  user_id uuid not null,

  customer_a uuid not null,
  customer_b uuid not null,

  lead_a uuid not null,
  lead_b uuid not null,

  lead_link_a uuid not null,
  lead_link_b uuid not null,

  conversation_a uuid not null,
  conversation_b uuid not null,

  session_a uuid not null,
  session_b uuid not null,

  context_a uuid not null,
  context_b uuid not null,

  opportunity_a uuid not null,
  opportunity_b uuid not null,

  message_a uuid null,
  message_b uuid null,

  followup_a uuid null,
  followup_a_cycle integer null,

  followup_b uuid null,
  followup_b_cycle integer null
) on commit preserve rows;

insert into pg_temp._p9_53_ctx (
  run_id,

  organization_id,
  store_id,
  other_store_id,
  user_id,

  customer_a,
  customer_b,

  lead_a,
  lead_b,

  lead_link_a,
  lead_link_b,

  conversation_a,
  conversation_b,

  session_a,
  session_b,

  context_a,
  context_b,

  opportunity_a,
  opportunity_b
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
  gen_random_uuid()
);


-- ============================================================================
-- Result helper
-- ============================================================================

create or replace function pg_temp._p9_53_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_53_results (
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


-- ============================================================================
-- Role-aware execution helper
-- ============================================================================

create or replace function pg_temp._p9_53_exec(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_text text,
  returned_sqlstate text,
  message_text text
)
language plpgsql
as $function$
declare
  v_value text;
  v_state text;
  v_message text;
  v_ok boolean := false;
begin
  if p_role not in (
    'postgres',
    'authenticated',
    'anon',
    'service_role'
  ) then
    return query
    select
      false,
      null::text,
      'P0001'::text,
      'unsupported role'::text;
    return;
  end if;

  if p_role <> 'postgres' then
    perform set_config(
      'request.jwt.claim.sub',
      coalesce(p_user_id::text, ''),
      true
    );

    perform set_config(
      'request.jwt.claim.role',
      p_role,
      true
    );

    perform set_config(
      'request.jwt.claims',
      case
        when p_user_id is null then
          jsonb_build_object(
            'role',
            p_role
          )::text
        else
          jsonb_build_object(
            'role',
            p_role,
            'sub',
            p_user_id::text
          )::text
      end,
      true
    );

    execute format(
      'set local role %I',
      p_role
    );
  end if;

  begin
    execute p_sql into v_value;
    v_ok := true;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;

      v_ok := false;
  end;

  begin
    execute 'reset role';
  exception
    when others then
      null;
  end;

  perform set_config(
    'request.jwt.claim.sub',
    '',
    true
  );

  perform set_config(
    'request.jwt.claim.role',
    '',
    true
  );

  perform set_config(
    'request.jwt.claims',
    '',
    true
  );

  return query
  select
    v_ok,
    case
      when v_ok then v_value
      else null::text
    end,
    v_state,
    v_message;
end;
$function$;


-- ============================================================================
-- Disposable canonical fixture
-- ============================================================================

do $setup$
declare
  v pg_temp._p9_53_ctx;
  v_message public.messages;
  v_exec record;
  v_result jsonb;
begin
  select *
  into strict v
  from pg_temp._p9_53_ctx;

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
  values (
    v.user_id,
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'p9-53-runner-'
      || v.run_id::text
      || '@example.test',
    '',
    now(),
    jsonb_build_object(
      'provider',
      'email',
      'providers',
      jsonb_build_array('email')
    ),
    jsonb_build_object(
      'runner',
      true,
      'p9_stage',
      '5.3'
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

  insert into public.organizations (
    id,
    name
  )
  values (
    v.organization_id,
    'P9 5.3 Runner Org ' || v.run_id::text
  );

  insert into public.stores (
    id,
    organization_id,
    name
  )
  values
    (
      v.store_id,
      v.organization_id,
      'P9 5.3 Runner Store'
    ),
    (
      v.other_store_id,
      v.organization_id,
      'P9 5.3 Runner Other Store'
    );

  insert into public.memberships (
    organization_id,
    user_id,
    role
  )
  values (
    v.organization_id,
    v.user_id,
    'owner'
  );

  insert into public.customers (
    id,
    organization_id,
    display_name
  )
  values
    (
      v.customer_a,
      v.organization_id,
      'P9 5.3 Customer A'
    ),
    (
      v.customer_b,
      v.organization_id,
      'P9 5.3 Customer B'
    );

  insert into public.customer_store_links (
    organization_id,
    store_id,
    customer_id
  )
  values
    (
      v.organization_id,
      v.store_id,
      v.customer_a
    ),
    (
      v.organization_id,
      v.store_id,
      v.customer_b
    );

  insert into public.leads (
    id,
    organization_id,
    store_id,
    name,
    phone,
    state
  )
  values
    (
      v.lead_a,
      v.organization_id,
      v.store_id,
      'P9 5.3 Lead A',
      '+5511999953001',
      'novo_lead'
    ),
    (
      v.lead_b,
      v.organization_id,
      v.store_id,
      'P9 5.3 Lead B',
      '+5511999953002',
      'novo_lead'
    );

  insert into public.lead_customer_links (
    id,
    organization_id,
    store_id,
    lead_id,
    customer_id,
    status,
    source,
    linked_by_actor_type,
    metadata
  )
  values
    (
      v.lead_link_a,
      v.organization_id,
      v.store_id,
      v.lead_a,
      v.customer_a,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_5_3'
      )
    ),
    (
      v.lead_link_b,
      v.organization_id,
      v.store_id,
      v.lead_b,
      v.customer_b,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_5_3'
      )
    );

  insert into public.conversations (
    id,
    organization_id,
    lead_id,
    status,
    is_human_active
  )
  values
    (
      v.conversation_a,
      v.organization_id,
      v.lead_a,
      'active',
      false
    ),
    (
      v.conversation_b,
      v.organization_id,
      v.lead_b,
      'active',
      false
    );

  insert into public.conversation_sessions (
    id,
    organization_id,
    store_id,
    conversation_id,
    status
  )
  values
    (
      v.session_a,
      v.organization_id,
      v.store_id,
      v.conversation_a,
      'active'
    ),
    (
      v.session_b,
      v.organization_id,
      v.store_id,
      v.conversation_b,
      'active'
    );

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    origin_lead_id,
    primary_conversation_id,
    stage,
    lifecycle_cycle,
    created_at,
    updated_at
  )
  values
    (
      v.opportunity_a,
      v.organization_id,
      v.store_id,
      v.customer_a,
      v.lead_a,
      v.conversation_a,
      'orcamento',
      1,
      now(),
      now()
    ),
    (
      v.opportunity_b,
      v.organization_id,
      v.store_id,
      v.customer_b,
      v.lead_b,
      v.conversation_b,
      'orcamento',
      1,
      now(),
      now()
    );

  insert into public.commercial_session_context_links (
    id,
    organization_id,
    store_id,
    conversation_session_id,
    customer_id,
    commercial_opportunity_id,
    lead_customer_link_id,
    status,
    source,
    linked_by_actor_type,
    metadata
  )
  values
    (
      v.context_a,
      v.organization_id,
      v.store_id,
      v.session_a,
      v.customer_a,
      v.opportunity_a,
      v.lead_link_a,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_5_3'
      )
    ),
    (
      v.context_b,
      v.organization_id,
      v.store_id,
      v.session_b,
      v.customer_b,
      v.opportunity_b,
      v.lead_link_b,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_5_3'
      )
    );

  select *
  into strict v_message
  from public.insert_message(
    v.conversation_a,
    'user',
    'incoming',
    'text',
    'Pare de mandar mensagens para mim.',
    'p9-53-a-' || v.run_id::text,
    null,
    jsonb_build_object(
      'fixture',
      'p9_5_3',
      'semantic_intent',
      'stop_contact'
    )
  );

  update pg_temp._p9_53_ctx
  set message_a = v_message.id;

  select *
  into strict v_message
  from public.insert_message(
    v.conversation_b,
    'user',
    'incoming',
    'text',
    'Nao quero receber mais mensagens.',
    'p9-53-b-' || v.run_id::text,
    null,
    jsonb_build_object(
      'fixture',
      'p9_5_3',
      'semantic_intent',
      'stop_contact'
    )
  );

  update pg_temp._p9_53_ctx
  set message_b = v_message.id;

  select *
  into strict v
  from pg_temp._p9_53_ctx;

  select *
  into strict v_exec
  from pg_temp._p9_53_exec(
    'authenticated',
    v.user_id,
    format(
      $sql$
        select row_to_json(
          public.activate_commercial_opportunity_followup_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L
          )
        )::text
      $sql$,
      v.organization_id::text,
      v.store_id::text,
      v.opportunity_a::text,
      'p953-activate-a-' || v.run_id::text
    )
  );

  if not v_exec.operation_succeeded then
    raise exception using
      errcode = 'P0001',
      message = 'P9_53_FIXTURE_FOLLOWUP_ACTIVATION_FAILED',
      detail = coalesce(v_exec.returned_sqlstate, '<null>')
        || ': '
        || coalesce(v_exec.message_text, '<null>');
  end if;

  v_result := v_exec.value_text::jsonb;

  update pg_temp._p9_53_ctx
  set
    followup_a = (v_result ->> 'id')::uuid,
    followup_a_cycle = (v_result ->> 'cycle')::integer;
end;
$setup$;


-- ============================================================================
-- Scenario 1
-- system writer: active -> opted_out; opportunity remains non-Lost
-- ============================================================================

do $scenario$
declare
  v pg_temp._p9_53_ctx;
  v_exec record;
  v_result jsonb;
  v_followup public.commercial_opportunity_followups;
  v_stage_before text;
  v_stage_after text;
  v_event_count integer;
  v_actor_type text;
  v_actor_user_count integer;
  v_source_conversation text;
  v_source_message text;
  v_err_context text;
  v_err_detail text;
begin
  select *
  into strict v
  from pg_temp._p9_53_ctx;

  select stage
  into strict v_stage_before
  from public.commercial_opportunities
  where id = v.opportunity_a;

  select *
  into strict v_exec
  from pg_temp._p9_53_exec(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(
          public.opt_out_commercial_opportunity_followup_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L
          )
        )::text
      $sql$,
      v.organization_id::text,
      v.store_id::text,
      v.opportunity_a::text,
      v.conversation_a::text,
      v.message_a::text,
      'p953-optout-a-' || v.run_id::text,
      'customer_stop_contact',
      'explicit stop_contact fixture'
    )
  );

  if not v_exec.operation_succeeded then
    perform pg_temp._p9_53_record(
      1,
      'system opt-out converte ciclo active em opted_out sem Lost',
      'SUT_FAIL',
      coalesce(v_exec.returned_sqlstate, '<null>')
        || ': '
        || coalesce(v_exec.message_text, '<null>')
    );
    return;
  end if;

  v_result := v_exec.value_text::jsonb;

  select *
  into strict v_followup
  from public.commercial_opportunity_followups
  where id = v.followup_a;

  select stage
  into strict v_stage_after
  from public.commercial_opportunities
  where id = v.opportunity_a;

  select
    count(*),
    max(actor_type),
    count(actor_user_id),
    max(metadata ->> 'source_conversation_id'),
    max(metadata ->> 'source_message_id')
  into
    v_event_count,
    v_actor_type,
    v_actor_user_count,
    v_source_conversation,
    v_source_message
  from public.commercial_opportunity_followup_events
  where organization_id = v.organization_id
    and store_id = v.store_id
    and commercial_opportunity_id = v.opportunity_a
    and operation_key =
      public.normalize_commercial_opportunity_followup_operation_key(
        'p953-optout-a-' || v.run_id::text
      );

  perform pg_temp._p9_53_record(
    1,
    'system opt-out converte ciclo active em opted_out sem Lost',
    case
      when (v_result ->> 'id')::uuid = v.followup_a
       and v_followup.status = 'opted_out'
       and v_followup.opted_out_at is not null
       and v_stage_before = 'orcamento'
       and v_stage_after = v_stage_before
       and v_event_count = 1
       and v_actor_type = 'system'
       and v_actor_user_count = 0
       and v_source_conversation = v.conversation_a::text
       and v_source_message = v.message_a::text
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'status=%s opted_out_at=%s stage_before=%s stage_after=%s events=%s actor=%s source_conversation=%s source_message=%s',
      coalesce(v_followup.status, '<null>'),
      coalesce(v_followup.opted_out_at::text, '<null>'),
      coalesce(v_stage_before, '<null>'),
      coalesce(v_stage_after, '<null>'),
      v_event_count,
      coalesce(v_actor_type, '<null>'),
      coalesce(v_source_conversation, '<null>'),
      coalesce(v_source_message, '<null>')
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      1,
      'system opt-out converte ciclo active em opted_out sem Lost',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 2
-- exact replay
-- ============================================================================

do $scenario$
declare
  v pg_temp._p9_53_ctx;
  v_exec record;
  v_result jsonb;
  v_cycles_before integer;
  v_cycles_after integer;
  v_events_before integer;
  v_events_after integer;
  v_err_context text;
  v_err_detail text;
begin
  select *
  into strict v
  from pg_temp._p9_53_ctx;

  select count(*)
  into v_cycles_before
  from public.commercial_opportunity_followups
  where organization_id = v.organization_id
    and store_id = v.store_id
    and commercial_opportunity_id = v.opportunity_a;

  select count(*)
  into v_events_before
  from public.commercial_opportunity_followup_events
  where organization_id = v.organization_id
    and store_id = v.store_id
    and commercial_opportunity_id = v.opportunity_a
    and operation_key =
      public.normalize_commercial_opportunity_followup_operation_key(
        'p953-optout-a-' || v.run_id::text
      );

  select *
  into strict v_exec
  from pg_temp._p9_53_exec(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(
          public.opt_out_commercial_opportunity_followup_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L
          )
        )::text
      $sql$,
      v.organization_id::text,
      v.store_id::text,
      v.opportunity_a::text,
      v.conversation_a::text,
      v.message_a::text,
      'p953-optout-a-' || v.run_id::text,
      'customer_stop_contact',
      'explicit stop_contact fixture'
    )
  );

  if v_exec.operation_succeeded then
    v_result := v_exec.value_text::jsonb;
  end if;

  select count(*)
  into v_cycles_after
  from public.commercial_opportunity_followups
  where organization_id = v.organization_id
    and store_id = v.store_id
    and commercial_opportunity_id = v.opportunity_a;

  select count(*)
  into v_events_after
  from public.commercial_opportunity_followup_events
  where organization_id = v.organization_id
    and store_id = v.store_id
    and commercial_opportunity_id = v.opportunity_a
    and operation_key =
      public.normalize_commercial_opportunity_followup_operation_key(
        'p953-optout-a-' || v.run_id::text
      );

  perform pg_temp._p9_53_record(
    2,
    'replay da mesma operation_key nao duplica ciclo nem evento',
    case
      when v_exec.operation_succeeded
       and (v_result ->> 'id')::uuid = v.followup_a
       and v_cycles_after = v_cycles_before
       and v_events_before = 1
       and v_events_after = 1
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'ok=%s cycles_before=%s cycles_after=%s events_before=%s events_after=%s result_id=%s',
      v_exec.operation_succeeded,
      v_cycles_before,
      v_cycles_after,
      v_events_before,
      v_events_after,
      coalesce(v_result ->> 'id', '<null>')
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      2,
      'replay da mesma operation_key nao duplica ciclo nem evento',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 3
-- operation key semantic conflict
-- ============================================================================

do $scenario$
declare
  v pg_temp._p9_53_ctx;
  v_exec record;
  v_err_context text;
  v_err_detail text;
begin
  select *
  into strict v
  from pg_temp._p9_53_ctx;

  select *
  into strict v_exec
  from pg_temp._p9_53_exec(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(
          public.opt_out_commercial_opportunity_followup_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L
          )
        )::text
      $sql$,
      v.organization_id::text,
      v.store_id::text,
      v.opportunity_a::text,
      v.conversation_a::text,
      v.message_a::text,
      'p953-optout-a-' || v.run_id::text,
      'customer_stop_contact',
      'DIFFERENT DETAILS MUST CONFLICT'
    )
  );

  perform pg_temp._p9_53_record(
    3,
    'operation_key conflitante falha fechada',
    case
      when not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23505'
       and v_exec.message_text =
         'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'ok=%s sqlstate=%s message=%s',
      v_exec.operation_succeeded,
      coalesce(v_exec.returned_sqlstate, '<null>'),
      coalesce(v_exec.message_text, '<null>')
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      3,
      'operation_key conflitante falha fechada',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 4
-- exact source/scope failures
-- ============================================================================

do $scenario$
declare
  v pg_temp._p9_53_ctx;
  v_wrong_message record;
  v_wrong_conversation record;
  v_wrong_store record;
  v_cycles_before integer;
  v_cycles_after integer;
  v_err_context text;
  v_err_detail text;
begin
  select *
  into strict v
  from pg_temp._p9_53_ctx;

  select count(*)
  into v_cycles_before
  from public.commercial_opportunity_followups
  where organization_id = v.organization_id
    and store_id = v.store_id
    and commercial_opportunity_id = v.opportunity_a;

  select *
  into strict v_wrong_message
  from pg_temp._p9_53_exec(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(
          public.opt_out_commercial_opportunity_followup_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L
          )
        )::text
      $sql$,
      v.organization_id::text,
      v.store_id::text,
      v.opportunity_a::text,
      v.conversation_a::text,
      v.message_b::text,
      'p953-wrong-message-' || v.run_id::text
    )
  );

  select *
  into strict v_wrong_conversation
  from pg_temp._p9_53_exec(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(
          public.opt_out_commercial_opportunity_followup_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L
          )
        )::text
      $sql$,
      v.organization_id::text,
      v.store_id::text,
      v.opportunity_a::text,
      v.conversation_b::text,
      v.message_b::text,
      'p953-wrong-conversation-' || v.run_id::text
    )
  );

  select *
  into strict v_wrong_store
  from pg_temp._p9_53_exec(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(
          public.opt_out_commercial_opportunity_followup_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L
          )
        )::text
      $sql$,
      v.organization_id::text,
      v.other_store_id::text,
      v.opportunity_a::text,
      v.conversation_a::text,
      v.message_a::text,
      'p953-wrong-store-' || v.run_id::text
    )
  );

  select count(*)
  into v_cycles_after
  from public.commercial_opportunity_followups
  where organization_id = v.organization_id
    and store_id = v.store_id
    and commercial_opportunity_id = v.opportunity_a;

  perform pg_temp._p9_53_record(
    4,
    'source message conversation tenant e store errados falham fechados',
    case
      when not v_wrong_message.operation_succeeded
       and not v_wrong_conversation.operation_succeeded
       and not v_wrong_store.operation_succeeded
       and v_cycles_after = v_cycles_before
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'wrong_message=%s/%s wrong_conversation=%s/%s wrong_store=%s/%s cycles_before=%s cycles_after=%s',
      v_wrong_message.operation_succeeded,
      coalesce(v_wrong_message.message_text, '<null>'),
      v_wrong_conversation.operation_succeeded,
      coalesce(v_wrong_conversation.message_text, '<null>'),
      v_wrong_store.operation_succeeded,
      coalesce(v_wrong_store.message_text, '<null>'),
      v_cycles_before,
      v_cycles_after
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      4,
      'source message conversation tenant e store errados falham fechados',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 5
-- no active cycle => one opted_out cycle
-- ============================================================================

do $scenario$
declare
  v pg_temp._p9_53_ctx;
  v_exec record;
  v_result jsonb;
  v_followup public.commercial_opportunity_followups;
  v_count integer;
  v_event_count integer;
  v_stage text;
  v_err_context text;
  v_err_detail text;
begin
  select *
  into strict v
  from pg_temp._p9_53_ctx;

  select *
  into strict v_exec
  from pg_temp._p9_53_exec(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(
          public.opt_out_commercial_opportunity_followup_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L
          )
        )::text
      $sql$,
      v.organization_id::text,
      v.store_id::text,
      v.opportunity_b::text,
      v.conversation_b::text,
      v.message_b::text,
      'p953-optout-b-' || v.run_id::text,
      'customer_stop_contact',
      'no active cycle'
    )
  );

  if v_exec.operation_succeeded then
    v_result := v_exec.value_text::jsonb;
  end if;

  select count(*)
  into v_count
  from public.commercial_opportunity_followups
  where organization_id = v.organization_id
    and store_id = v.store_id
    and commercial_opportunity_id = v.opportunity_b;

  if v_exec.operation_succeeded then
    select *
    into strict v_followup
    from public.commercial_opportunity_followups
    where id = (v_result ->> 'id')::uuid;

    update pg_temp._p9_53_ctx
    set
      followup_b = v_followup.id,
      followup_b_cycle = v_followup.cycle;
  end if;

  select count(*)
  into v_event_count
  from public.commercial_opportunity_followup_events
  where organization_id = v.organization_id
    and store_id = v.store_id
    and commercial_opportunity_id = v.opportunity_b
    and event_type = 'opted_out'
    and actor_type = 'system';

  select stage
  into strict v_stage
  from public.commercial_opportunities
  where id = v.opportunity_b;

  perform pg_temp._p9_53_record(
    5,
    'system opt-out sem ciclo active cria somente um ciclo opted_out',
    case
      when v_exec.operation_succeeded
       and v_count = 1
       and v_followup.status = 'opted_out'
       and v_followup.opted_out_at is not null
       and v_followup.attempt_count = 0
       and v_event_count = 1
       and v_stage = 'orcamento'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'ok=%s cycles=%s status=%s attempts=%s events=%s stage=%s',
      v_exec.operation_succeeded,
      v_count,
      coalesce(v_followup.status, '<null>'),
      coalesce(v_followup.attempt_count::text, '<null>'),
      v_event_count,
      coalesce(v_stage, '<null>')
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      5,
      'system opt-out sem ciclo active cria somente um ciclo opted_out',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 6
-- already opted out + different operation key => same cycle
-- ============================================================================

do $scenario$
declare
  v pg_temp._p9_53_ctx;
  v_exec record;
  v_result jsonb;
  v_before integer;
  v_after integer;
  v_event_count integer;
  v_err_context text;
  v_err_detail text;
begin
  select *
  into strict v
  from pg_temp._p9_53_ctx;

  select count(*)
  into v_before
  from public.commercial_opportunity_followups
  where organization_id = v.organization_id
    and store_id = v.store_id
    and commercial_opportunity_id = v.opportunity_b;

  select *
  into strict v_exec
  from pg_temp._p9_53_exec(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(
          public.opt_out_commercial_opportunity_followup_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L
          )
        )::text
      $sql$,
      v.organization_id::text,
      v.store_id::text,
      v.opportunity_b::text,
      v.conversation_b::text,
      v.message_b::text,
      'p953-optout-b-second-' || v.run_id::text,
      'customer_stop_contact',
      'second explicit signal'
    )
  );

  if v_exec.operation_succeeded then
    v_result := v_exec.value_text::jsonb;
  end if;

  select count(*)
  into v_after
  from public.commercial_opportunity_followups
  where organization_id = v.organization_id
    and store_id = v.store_id
    and commercial_opportunity_id = v.opportunity_b;

  select count(*)
  into v_event_count
  from public.commercial_opportunity_followup_events
  where organization_id = v.organization_id
    and store_id = v.store_id
    and commercial_opportunity_id = v.opportunity_b
    and operation_key =
      public.normalize_commercial_opportunity_followup_operation_key(
        'p953-optout-b-second-' || v.run_id::text
      );

  perform pg_temp._p9_53_record(
    6,
    'novo operation_key apos opted_out nao cria segundo ciclo',
    case
      when v_exec.operation_succeeded
       and v_before = 1
       and v_after = 1
       and (v_result ->> 'id')::uuid = v.followup_b
       and v_event_count = 1
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'ok=%s cycles_before=%s cycles_after=%s result_id=%s canonical_id=%s event=%s',
      v_exec.operation_succeeded,
      v_before,
      v_after,
      coalesce(v_result ->> 'id', '<null>'),
      coalesce(v.followup_b::text, '<null>'),
      v_event_count
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      6,
      'novo operation_key apos opted_out nao cria segundo ciclo',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 7
-- opted_out remains a hard follow-up activation lock
-- ============================================================================

do $scenario$
declare
  v pg_temp._p9_53_ctx;
  v_exec record;
  v_err_context text;
  v_err_detail text;
begin
  select *
  into strict v
  from pg_temp._p9_53_ctx;

  select *
  into strict v_exec
  from pg_temp._p9_53_exec(
    'authenticated',
    v.user_id,
    format(
      $sql$
        select row_to_json(
          public.activate_commercial_opportunity_followup_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L
          )
        )::text
      $sql$,
      v.organization_id::text,
      v.store_id::text,
      v.opportunity_b::text,
      'p953-reactivate-b-' || v.run_id::text
    )
  );

  perform pg_temp._p9_53_record(
    7,
    'reativacao humana apos opted_out permanece bloqueada',
    case
      when not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_exec.message_text = 'ZION_FOLLOWUP_OPT_OUT_LOCKED'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'ok=%s sqlstate=%s message=%s',
      v_exec.operation_succeeded,
      coalesce(v_exec.returned_sqlstate, '<null>'),
      coalesce(v_exec.message_text, '<null>')
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      7,
      'reativacao humana apos opted_out permanece bloqueada',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 8
-- canonical executor cannot send from opted_out cycle
-- ============================================================================

do $scenario$
declare
  v pg_temp._p9_53_ctx;
  v_ai_run_id uuid;
  v_queue_id uuid;
  v_exec record;
  v_result jsonb;
  v_outgoing integer;
  v_attempt_count integer;
  v_attempt_events integer;
  v_err_context text;
  v_err_detail text;
begin
  select *
  into strict v
  from pg_temp._p9_53_ctx;

  insert into public.ai_runs (
    organization_id,
    store_id,
    lead_id,
    conversation_id,
    status,
    input
  )
  values (
    v.organization_id,
    v.store_id,
    v.lead_b,
    v.conversation_b,
    'succeeded',
    jsonb_build_object(
      'fixture',
      'p9_5_3_executor_opted_out'
    )
  )
  returning id
  into v_ai_run_id;

  insert into public.ai_sales_action_queue (
    organization_id,
    store_id,
    conversation_id,
    ai_run_id,
    next_action,
    action_key,
    payload
  )
  values (
    v.organization_id,
    v.store_id,
    v.conversation_b,
    v_ai_run_id,
    'followup_offer',
    'p953-executor-optedout-' || v.run_id::text,
    jsonb_build_object(
      'type',
      'p9_5_3_runner',
      'organization_id',
      v.organization_id,
      'store_id',
      v.store_id,
      'conversation_id',
      v.conversation_b,
      'commercial_opportunity_id',
      v.opportunity_b,
      'followup_id',
      v.followup_b,
      'followup_cycle',
      v.followup_b_cycle,
      'followup_operation_key',
      'p953-executor-optedout-' || v.run_id::text,
      'followup_type',
      'offer',
      'next_action',
      'followup_offer'
    )
  )
  returning id
  into v_queue_id;

  select *
  into strict v_exec
  from pg_temp._p9_53_exec(
    'service_role',
    null,
    format(
      $sql$
        select public.ai_sales_execute_canonical_followup_queue(
          %L::uuid
        )::text
      $sql$,
      v_queue_id::text
    )
  );

  if v_exec.operation_succeeded then
    v_result := v_exec.value_text::jsonb;
  end if;

  select count(*)
  into v_outgoing
  from public.messages
  where conversation_id = v.conversation_b
    and sender = 'ai'
    and direction = 'outgoing'
    and deleted_at is null
    and metadata ->> 'followup_id' = v.followup_b::text;

  select attempt_count
  into strict v_attempt_count
  from public.commercial_opportunity_followups
  where id = v.followup_b;

  select count(*)
  into v_attempt_events
  from public.commercial_opportunity_followup_events
  where followup_id = v.followup_b
    and event_type = 'attempt_recorded';

  perform pg_temp._p9_53_record(
    8,
    'executor diante de ciclo opted_out nao envia nem registra tentativa',
    case
      when v_exec.operation_succeeded
       and v_result ->> 'result' =
         'followup_stale_cycle_not_active'
       and v_result ->> 'followup_status' = 'opted_out'
       and v_outgoing = 0
       and v_attempt_count = 0
       and v_attempt_events = 0
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'ok=%s result=%s followup_status=%s outgoing=%s attempt_count=%s attempt_events=%s',
      v_exec.operation_succeeded,
      coalesce(v_result ->> 'result', '<null>'),
      coalesce(v_result ->> 'followup_status', '<null>'),
      v_outgoing,
      v_attempt_count,
      v_attempt_events
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      8,
      'executor diante de ciclo opted_out nao envia nem registra tentativa',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 9
-- legacy direct offer handler
-- ============================================================================

do $scenario$
declare
  v pg_temp._p9_53_ctx;
  v_before integer;
  v_after integer;
  v_exec record;
  v_result jsonb;
  v_err_context text;
  v_err_detail text;
begin
  select *
  into strict v
  from pg_temp._p9_53_ctx;

  select count(*)
  into v_before
  from public.messages
  where conversation_id = v.conversation_a
    and sender = 'ai'
    and direction = 'outgoing'
    and deleted_at is null;

  select *
  into strict v_exec
  from pg_temp._p9_53_exec(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(handler_row)::text
        from public.ai_sales_real_handler_followup_offer(
          %L::uuid,
          %L::uuid,
          %L::uuid
        ) handler_row
      $sql$,
      v.organization_id::text,
      v.store_id::text,
      v.conversation_a::text
    )
  );

  if v_exec.operation_succeeded then
    v_result := v_exec.value_text::jsonb;
  end if;

  select count(*)
  into v_after
  from public.messages
  where conversation_id = v.conversation_a
    and sender = 'ai'
    and direction = 'outgoing'
    and deleted_at is null;

  perform pg_temp._p9_53_record(
    9,
    'legacy followup offer handler falha fechado sem mensagem',
    case
      when v_exec.operation_succeeded
       and v_result ->> 'status' =
         'canonical_followup_queue_required'
       and coalesce((v_result ->> 'ok')::boolean, true) = false
       and v_after = v_before
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'ok=%s status=%s outgoing_before=%s outgoing_after=%s',
      v_exec.operation_succeeded,
      coalesce(v_result ->> 'status', '<null>'),
      v_before,
      v_after
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      9,
      'legacy followup offer handler falha fechado sem mensagem',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 10
-- legacy direct visit handler
-- ============================================================================

do $scenario$
declare
  v pg_temp._p9_53_ctx;
  v_before integer;
  v_after integer;
  v_exec record;
  v_result jsonb;
  v_err_context text;
  v_err_detail text;
begin
  select *
  into strict v
  from pg_temp._p9_53_ctx;

  select count(*)
  into v_before
  from public.messages
  where conversation_id = v.conversation_a
    and sender = 'ai'
    and direction = 'outgoing'
    and deleted_at is null;

  select *
  into strict v_exec
  from pg_temp._p9_53_exec(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(handler_row)::text
        from public.ai_sales_real_handler_followup_visit(
          %L::uuid,
          %L::uuid,
          %L::uuid
        ) handler_row
      $sql$,
      v.organization_id::text,
      v.store_id::text,
      v.conversation_a::text
    )
  );

  if v_exec.operation_succeeded then
    v_result := v_exec.value_text::jsonb;
  end if;

  select count(*)
  into v_after
  from public.messages
  where conversation_id = v.conversation_a
    and sender = 'ai'
    and direction = 'outgoing'
    and deleted_at is null;

  perform pg_temp._p9_53_record(
    10,
    'legacy followup visit handler falha fechado sem mensagem',
    case
      when v_exec.operation_succeeded
       and v_result ->> 'status' =
         'canonical_followup_queue_required'
       and coalesce((v_result ->> 'ok')::boolean, true) = false
       and v_after = v_before
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'ok=%s status=%s outgoing_before=%s outgoing_after=%s',
      v_exec.operation_succeeded,
      coalesce(v_result ->> 'status', '<null>'),
      v_before,
      v_after
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      10,
      'legacy followup visit handler falha fechado sem mensagem',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 11
-- legacy apply_real
-- ============================================================================

do $scenario$
declare
  v pg_temp._p9_53_ctx;
  v_before integer;
  v_after integer;
  v_exec record;
  v_result jsonb;
  v_err_context text;
  v_err_detail text;
begin
  select *
  into strict v
  from pg_temp._p9_53_ctx;

  select count(*)
  into v_before
  from public.messages
  where conversation_id = v.conversation_a
    and sender = 'ai'
    and direction = 'outgoing'
    and deleted_at is null;

  select *
  into strict v_exec
  from pg_temp._p9_53_exec(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(result_row)::text
        from public.ai_sales_action_apply_real(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'followup_offer'
        ) result_row
      $sql$,
      v.organization_id::text,
      v.store_id::text,
      v.conversation_a::text
    )
  );

  if v_exec.operation_succeeded then
    v_result := v_exec.value_text::jsonb;
  end if;

  select count(*)
  into v_after
  from public.messages
  where conversation_id = v.conversation_a
    and sender = 'ai'
    and direction = 'outgoing'
    and deleted_at is null;

  perform pg_temp._p9_53_record(
    11,
    'ai_sales_action_apply_real falha fechado para followup',
    case
      when v_exec.operation_succeeded
       and v_result ->> 'status' in (
         'canonical_followup_queue_required',
         'real_execution_blocked'
       )
       and coalesce((v_result ->> 'ok')::boolean, true) = false
       and v_after = v_before
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'ok=%s status=%s outgoing_before=%s outgoing_after=%s',
      v_exec.operation_succeeded,
      coalesce(v_result ->> 'status', '<null>'),
      v_before,
      v_after
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      11,
      'ai_sales_action_apply_real falha fechado para followup',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 12
-- legacy dispatch_real
-- ============================================================================

do $scenario$
declare
  v pg_temp._p9_53_ctx;
  v_before integer;
  v_after integer;
  v_exec record;
  v_result jsonb;
  v_err_context text;
  v_err_detail text;
begin
  select *
  into strict v
  from pg_temp._p9_53_ctx;

  select count(*)
  into v_before
  from public.messages
  where conversation_id = v.conversation_a
    and sender = 'ai'
    and direction = 'outgoing'
    and deleted_at is null;

  select *
  into strict v_exec
  from pg_temp._p9_53_exec(
    'service_role',
    null,
    format(
      $sql$
        select row_to_json(result_row)::text
        from public.ai_sales_action_dispatch_real(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'followup_visit'
        ) result_row
      $sql$,
      v.organization_id::text,
      v.store_id::text,
      v.conversation_a::text
    )
  );

  if v_exec.operation_succeeded then
    v_result := v_exec.value_text::jsonb;
  end if;

  select count(*)
  into v_after
  from public.messages
  where conversation_id = v.conversation_a
    and sender = 'ai'
    and direction = 'outgoing'
    and deleted_at is null;

  perform pg_temp._p9_53_record(
    12,
    'ai_sales_action_dispatch_real falha fechado para followup',
    case
      when v_exec.operation_succeeded
       and v_result ->> 'status' =
         'canonical_followup_queue_required'
       and coalesce((v_result ->> 'ok')::boolean, true) = false
       and v_after = v_before
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'ok=%s status=%s outgoing_before=%s outgoing_after=%s',
      v_exec.operation_succeeded,
      coalesce(v_result ->> 'status', '<null>'),
      v_before,
      v_after
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      12,
      'ai_sales_action_dispatch_real falha fechado para followup',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 13
-- structural proof of race-safe ordering
-- ============================================================================

do $scenario$
declare
  v_definition text;
  v_lock_position integer;
  v_incoming_position integer;
  v_send_position integer;
  v_err_context text;
  v_err_detail text;
begin
  select pg_get_functiondef(
    'public.ai_sales_execute_canonical_followup_queue(uuid)'::regprocedure
  )
  into strict v_definition;

  v_lock_position := position(
    'private_acquire_sales_contract_conversation_xact_lock'
    in v_definition
  );

  v_incoming_position := position(
    'select pg_catalog.max(message_row.created_at)'
    in v_definition
  );

  v_send_position := position(
    'from public.insert_message('
    in v_definition
  );

  perform pg_temp._p9_53_record(
    13,
    'executor possui ordem race-safe conversation lock incoming recheck send',
    case
      when v_lock_position > 0
       and v_incoming_position > v_lock_position
       and v_send_position > v_incoming_position
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'conversation_lock=%s incoming_recheck=%s insert_message=%s',
      v_lock_position,
      v_incoming_position,
      v_send_position
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      13,
      'executor possui ordem race-safe conversation lock incoming recheck send',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 14
-- ACL + exact source identity + no Lost mutation
-- ============================================================================

do $scenario$
declare
  v_definition text;
  v_anon boolean;
  v_authenticated boolean;
  v_service_role boolean;
  v_exact_message_link boolean;
  v_lost_assignment boolean;
  v_err_context text;
  v_err_detail text;
begin
  select pg_get_functiondef(
    'public.opt_out_commercial_opportunity_followup_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)'::regprocedure
  )
  into strict v_definition;

  select has_function_privilege(
    'anon',
    'public.opt_out_commercial_opportunity_followup_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  )
  into v_anon;

  select has_function_privilege(
    'authenticated',
    'public.opt_out_commercial_opportunity_followup_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  )
  into v_authenticated;

  select has_function_privilege(
    'service_role',
    'public.opt_out_commercial_opportunity_followup_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  )
  into v_service_role;

  v_exact_message_link :=
    position(
      'commercial_session_context_link_id'
      in v_definition
    ) > 0
    and position(
      'commercial_opportunity_id'
      in v_definition
    ) > 0
    and position(
      'p_source_message_id'
      in v_definition
    ) > 0
    and position(
      'p_source_conversation_id'
      in v_definition
    ) > 0;

  v_lost_assignment :=
    lower(v_definition) ~
      'stage[[:space:]]*=[[:space:]]*''perdido''';

  perform pg_temp._p9_53_record(
    14,
    'writer system possui ACL e autoridade exata sem mutacao Lost',
    case
      when coalesce(v_anon, false) = false
       and coalesce(v_authenticated, false) = false
       and coalesce(v_service_role, false) = true
       and v_exact_message_link
       and not v_lost_assignment
        then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'anon_execute=%s authenticated_execute=%s service_role_execute=%s exact_message_link=%s lost_assignment=%s',
      v_anon,
      v_authenticated,
      v_service_role,
      v_exact_message_link,
      v_lost_assignment
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      14,
      'writer system possui ACL e autoridade exata sem mutacao Lost',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;


-- ============================================================================
-- Scenario 15
-- non-followup actions remain structurally connected to their handlers
-- ============================================================================

do $scenario$
declare
  v_apply text;
  v_dispatch text;
  v_ok boolean;
  v_err_context text;
  v_err_detail text;
begin
  select pg_get_functiondef(
    'public.ai_sales_action_apply_real(uuid,uuid,uuid,text)'::regprocedure
  )
  into strict v_apply;

  select pg_get_functiondef(
    'public.ai_sales_action_dispatch_real(uuid,uuid,uuid,text)'::regprocedure
  )
  into strict v_dispatch;

  v_ok :=
    position(
      'ai_sales_real_handler_qualify_lead'
      in v_apply
    ) > 0
    and position(
      'ai_sales_real_handler_confirm_payment'
      in v_apply
    ) > 0
    and position(
      'ai_sales_real_handler_confirm_sale'
      in v_apply
    ) > 0
    and position(
      'ai_sales_action_apply_real'
      in v_dispatch
    ) > 0;

  perform pg_temp._p9_53_record(
    15,
    'caminhos real nao-followup permanecem estruturalmente preservados',
    case
      when v_ok then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'qualify=%s confirm_payment=%s confirm_sale=%s dispatch_to_apply=%s',
      position(
        'ai_sales_real_handler_qualify_lead'
        in v_apply
      ) > 0,
      position(
        'ai_sales_real_handler_confirm_payment'
        in v_apply
      ) > 0,
      position(
        'ai_sales_real_handler_confirm_sale'
        in v_apply
      ) > 0,
      position(
        'ai_sales_action_apply_real'
        in v_dispatch
      ) > 0
    )
  );
exception
  when others then
    get stacked diagnostics
      v_err_context = pg_exception_context,
      v_err_detail = pg_exception_detail;

    perform pg_temp._p9_53_record(
      15,
      'caminhos real nao-followup permanecem estruturalmente preservados',
      'HARNESS_ERROR',
      sqlerrm
        || E'\nDETAIL='
        || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT='
        || coalesce(v_err_context, '<null>')
    );
end;
$scenario$;



-- ============================================================================
-- P9 5.3 - Consent restoration scenarios 16-20
-- ============================================================================

insert into pg_temp._p9_53_matrix (scenario_number, scenario_name)
values
  (16, 'source anterior ao opt-out nao pode restaurar consentimento'),
  (17, 're-consentimento explicito restaura contato sem Lost nem follow-up automatico'),
  (18, 'replay do re-consentimento e idempotente e nao duplica evento'),
  (19, 'apos consent_restored ativacao normal cria novo ciclo sem reopen ou Lost'),
  (20, 'writer de re-consentimento possui ACL e contratos fechados corretos');

do $consent$
declare
  v pg_temp._p9_53_ctx;
  x record;
  y record;
  m public.messages;
  f0 public.commercial_opportunity_followups;
  f1 public.commercial_opportunity_followups;
  j jsonb;
  jr jsonb;
  stage0 text;
  stage1 text;
  opkey text;
  n integer;
  n2 integer;
  owner_name text;
  secdef boolean;
  writer_def text;
  restore_def text;
  constraints_ok integer;
  column_ok boolean;
  acl_ok boolean;
  err_ctx text;
  err_detail text;
begin
  select * into strict v from pg_temp._p9_53_ctx;

  select stage into strict stage0
  from public.commercial_opportunities
  where id=v.opportunity_b and organization_id=v.organization_id and store_id=v.store_id;

  select * into strict x from pg_temp._p9_53_exec(
    'service_role',null,
    format(
      'select public.restore_commercial_opportunity_contact_consent_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)::text',
      v.organization_id::text,v.store_id::text,v.opportunity_b::text,
      v.conversation_b::text,v.message_b::text,
      'p953-consent-old-'||v.run_id::text,
      'customer_explicit_contact_consent_restored','old source must fail'
    )
  );

  select count(*) into n
  from public.commercial_opportunity_followup_events
  where organization_id=v.organization_id and store_id=v.store_id
    and commercial_opportunity_id=v.opportunity_b and event_type='consent_restored';

  select stage into strict stage1
  from public.commercial_opportunities
  where id=v.opportunity_b and organization_id=v.organization_id and store_id=v.store_id;

  perform pg_temp._p9_53_record(
    16,'source anterior ao opt-out nao pode restaurar consentimento',
    case when not x.operation_succeeded
      and x.returned_sqlstate='23514'
      and x.message_text='ZION_CONTACT_CONSENT_SOURCE_NOT_AFTER_OPT_OUT'
      and n=0 and stage1 is not distinct from stage0
      and exists (
        select 1 from public.commercial_opportunity_followups
        where organization_id=v.organization_id and store_id=v.store_id
          and commercial_opportunity_id=v.opportunity_b and status='opted_out'
      )
    then 'PASS' else 'SUT_FAIL' end,
    format('ok=%s state=%s msg=%s events=%s stage=%s',x.operation_succeeded,
      coalesce(x.returned_sqlstate,'<null>'),coalesce(x.message_text,'<null>'),n,stage1)
  );

  select * into strict f0
  from public.commercial_opportunity_followups
  where organization_id=v.organization_id and store_id=v.store_id
    and commercial_opportunity_id=v.opportunity_b and status='opted_out';

  select * into strict m
  from public.insert_message(
    v.conversation_b,'user','incoming','text','Sim, pode voltar a falar comigo.',
    null,null,jsonb_build_object('source','p9_5_3_consent_restoration_runner')
  );

  /*
   * Harness-only temporal normalization.
   * The whole runner uses one transaction, while opt-out uses clock_timestamp().
   * Make this later synthetic inbound unambiguously newer than the opt-out.
   */
  update public.messages
  set created_at = greatest(
    pg_catalog.clock_timestamp(),
    f0.opted_out_at + interval '1 millisecond'
  )
  where id = m.id
    and organization_id = v.organization_id
    and store_id = v.store_id
    and conversation_id = v.conversation_b
  returning *
  into strict m;

  opkey := 'p953-consent-restore-'||v.run_id::text;

  select * into strict x from pg_temp._p9_53_exec(
    'service_role',null,
    format(
      'select public.restore_commercial_opportunity_contact_consent_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)::text',
      v.organization_id::text,v.store_id::text,v.opportunity_b::text,
      v.conversation_b::text,m.id::text,opkey,
      'customer_explicit_contact_consent_restored','explicit reconsent'
    )
   );

  j := coalesce(x.value_text,'{}')::jsonb;

  select * into strict f1
  from public.commercial_opportunity_followups
  where id=f0.id and organization_id=v.organization_id and store_id=v.store_id
    and commercial_opportunity_id=v.opportunity_b and cycle=f0.cycle;

  select count(*) into n
  from public.commercial_opportunity_followups
  where organization_id=v.organization_id and store_id=v.store_id
    and commercial_opportunity_id=v.opportunity_b and status='active';

  select count(*) into n2
  from public.commercial_opportunity_followup_events
  where organization_id=v.organization_id and store_id=v.store_id
    and commercial_opportunity_id=v.opportunity_b and event_type='consent_restored'
    and operation_key=opkey and actor_type='system' and actor_user_id is null
    and metadata->>'source_conversation_id'=v.conversation_b::text
    and metadata->>'source_message_id'=m.id::text;

  select stage into strict stage1
  from public.commercial_opportunities
  where id=v.opportunity_b and organization_id=v.organization_id and store_id=v.store_id;

  perform pg_temp._p9_53_record(
    17,'re-consentimento explicito restaura contato sem Lost nem follow-up automatico',
    case when x.operation_succeeded and j->>'result'='consent_restored'
      and j->>'followup_id'=f0.id::text and (j->>'followup_cycle')::integer=f0.cycle
      and f1.status='consent_restored' and f1.opted_out_at is not distinct from f0.opted_out_at
      and f1.consent_restored_at is not null and f1.consent_restored_at>=f1.opted_out_at
      and n=0 and n2=1 and stage1 is not distinct from stage0 and stage1<>'perdido'
    then 'PASS' else 'SUT_FAIL' end,
    format('ok=%s sqlstate=%s message=%s result=%s status=%s active=%s events=%s stage=%s',
      x.operation_succeeded,coalesce(x.returned_sqlstate,'<null>'),coalesce(x.message_text,'<null>'),coalesce(j->>'result','<null>'),f1.status,n,n2,stage1)
  );

  select * into strict y from pg_temp._p9_53_exec(
    'service_role',null,
    format(
      'select public.restore_commercial_opportunity_contact_consent_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)::text',
      v.organization_id::text,v.store_id::text,v.opportunity_b::text,
      v.conversation_b::text,m.id::text,opkey,
      'customer_explicit_contact_consent_restored','explicit reconsent'
    )
  );

  jr := coalesce(y.value_text,'{}')::jsonb;

  select count(*) into n2
  from public.commercial_opportunity_followup_events
  where organization_id=v.organization_id and store_id=v.store_id
    and commercial_opportunity_id=v.opportunity_b and event_type='consent_restored'
    and operation_key=opkey;

  perform pg_temp._p9_53_record(
    18,'replay do re-consentimento e idempotente e nao duplica evento',
    case when y.operation_succeeded and jr->>'result'='replay'
      and jr->>'followup_id'=f0.id::text and (jr->>'followup_cycle')::integer=f0.cycle
      and n2=1 then 'PASS' else 'SUT_FAIL' end,
    format('ok=%s result=%s events=%s',y.operation_succeeded,
      coalesce(jr->>'result','<null>'),n2)
  );

  select * into strict x from pg_temp._p9_53_exec(
    'authenticated',v.user_id,
    format(
      'select row_to_json(public.activate_commercial_opportunity_followup_by_user(%L::uuid,%L::uuid,%L::uuid,%L))::text',
      v.organization_id::text,v.store_id::text,v.opportunity_b::text,
      'p953-reactivate-after-consent-'||v.run_id::text
    )
  );

  j := coalesce(x.value_text,'{}')::jsonb;

  select count(*) into n
  from public.commercial_opportunity_followups
  where organization_id=v.organization_id and store_id=v.store_id
    and commercial_opportunity_id=v.opportunity_b and status='active';

  select count(*) into n2
  from public.commercial_opportunity_followups
  where organization_id=v.organization_id and store_id=v.store_id
    and commercial_opportunity_id=v.opportunity_b and status='opted_out';

  select status into strict owner_name
  from public.commercial_opportunity_followups
  where id=f0.id and organization_id=v.organization_id and store_id=v.store_id
    and commercial_opportunity_id=v.opportunity_b and cycle=f0.cycle;

  select stage into strict stage1
  from public.commercial_opportunities
  where id=v.opportunity_b and organization_id=v.organization_id and store_id=v.store_id;

  perform pg_temp._p9_53_record(
    19,'apos consent_restored ativacao normal cria novo ciclo sem reopen ou Lost',
    case when x.operation_succeeded and j->>'status'='active'
      and (j->>'cycle')::integer=f0.cycle+1 and n=1 and n2=0
      and owner_name='consent_restored'
      and stage1 is not distinct from stage0 and stage1<>'perdido'
    then 'PASS' else 'SUT_FAIL' end,
    format('ok=%s status=%s cycle=%s old_cycle=%s active=%s opted_out=%s old_status=%s stage=%s',
      x.operation_succeeded,coalesce(j->>'status','<null>'),coalesce(j->>'cycle','<null>'),
      f0.cycle,n,n2,owner_name,stage1)
  );

  select pg_catalog.pg_get_functiondef(p.oid),r.rolname,p.prosecdef
  into strict writer_def,owner_name,secdef
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace ns on ns.oid=p.pronamespace
  join pg_catalog.pg_roles r on r.oid=p.proowner
  where ns.nspname='public'
    and p.proname='restore_commercial_opportunity_contact_consent_by_system'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)=
      'p_organization_id uuid, p_store_id uuid, p_commercial_opportunity_id uuid, p_source_conversation_id uuid, p_source_message_id uuid, p_operation_key text, p_reason_code text, p_reason_details text';

  select pg_catalog.pg_get_functiondef(
    'public.restore_commercial_opportunity_followup_snapshot(public.commercial_opportunity_followup_events)'::regprocedure
  ) into strict restore_def;

  acl_ok :=
    not pg_catalog.has_function_privilege('public',
      'public.restore_commercial_opportunity_contact_consent_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)','EXECUTE')
    and not pg_catalog.has_function_privilege('anon',
      'public.restore_commercial_opportunity_contact_consent_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)','EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated',
      'public.restore_commercial_opportunity_contact_consent_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)','EXECUTE')
    and pg_catalog.has_function_privilege('service_role',
      'public.restore_commercial_opportunity_contact_consent_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)','EXECUTE');

  select count(*) into constraints_ok
  from pg_catalog.pg_constraint c
  where c.conrelid in (
    'public.commercial_opportunity_followups'::regclass,
    'public.commercial_opportunity_followup_events'::regclass
  )
  and c.conname in (
    'commercial_opportunity_followups_status_check',
    'commercial_opportunity_followups_terminal_shape_check',
    'commercial_opportunity_followup_events_event_type_check'
  )
  and pg_catalog.pg_get_constraintdef(c.oid) ilike '%consent_restored%';

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='commercial_opportunity_followups'
      and column_name='consent_restored_at' and data_type='timestamp with time zone'
  ) into column_ok;

  perform pg_temp._p9_53_record(
    20,'writer de re-consentimento possui ACL e contratos fechados corretos',
    case when owner_name='postgres' and secdef and acl_ok and constraints_ok=3 and column_ok
      and position('update public.commercial_opportunities' in lower(writer_def))=0
      and position('when ''consent_restored'' then ''consent_restored''' in lower(restore_def))>0
      and position('source_message_id' in lower(writer_def))>0
      and position('commercial_session_context_link_id' in lower(writer_def))>0
    then 'PASS' else 'SUT_FAIL' end,
    format(
      'owner=%s secdef=%s acl=%s constraints=%s column=%s no_stage_update=%s',
      owner_name,secdef,acl_ok,constraints_ok,column_ok,
      position('update public.commercial_opportunities' in lower(writer_def))=0
    )
  );

exception
  when others then
    get stacked diagnostics err_ctx=pg_exception_context,err_detail=pg_exception_detail;
    for n in 16..20 loop
      if not exists(select 1 from pg_temp._p9_53_results where scenario_number=n) then
        perform pg_temp._p9_53_record(
          n,
          case n
            when 16 then 'source anterior ao opt-out nao pode restaurar consentimento'
            when 17 then 're-consentimento explicito restaura contato sem Lost nem follow-up automatico'
            when 18 then 'replay do re-consentimento e idempotente e nao duplica evento'
            when 19 then 'apos consent_restored ativacao normal cria novo ciclo sem reopen ou Lost'
            else 'writer de re-consentimento possui ACL e contratos fechados corretos'
          end,
          'HARNESS_ERROR',
          sqlerrm||E'\nDETAIL='||coalesce(err_detail,'<null>')||E'\nCONTEXT='||coalesce(err_ctx,'<null>')
        );
      end if;
    end loop;
end;
$consent$;


-- ============================================================================
-- Ensure every declared scenario actually ran
-- ============================================================================

insert into pg_temp._p9_53_results (
  scenario_number,
  scenario_name,
  status,
  detail
)
select
  matrix.scenario_number,
  matrix.scenario_name,
  'HARNESS_ERROR',
  'scenario did not run'
from pg_temp._p9_53_matrix matrix
where not exists (
  select 1
  from pg_temp._p9_53_results result
  where result.scenario_number =
        matrix.scenario_number
);


-- ============================================================================
-- Final assertion
-- ============================================================================

do $assertions$
declare
  v_failed_count integer;
  v_summary text;
begin
  select count(*)
  into v_failed_count
  from pg_temp._p9_53_results
  where status <> 'PASS';

  if v_failed_count > 0 then
    select string_agg(
      format(
        '#%s %s => %s (%s)',
        scenario_number,
        scenario_name,
        status,
        detail
      ),
      E'\n'
      order by scenario_number
    )
    into v_summary
    from pg_temp._p9_53_results
    where status <> 'PASS';

    raise exception using
      errcode = 'P0001',
      message = 'P9_FOLLOWUP_53_OPT_OUT_RACE_GUARD_CHECK_FAILED',
      detail = v_summary;
  end if;
end;
$assertions$;


-- ============================================================================
-- Visible result
-- ============================================================================

select *
from pg_temp._p9_53_results
order by scenario_number;

rollback;
