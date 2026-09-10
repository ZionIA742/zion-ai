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

-- ============================================================================
-- P9 5.3 - PACKAGE FINAL
-- Static/runtime-contract checks for the final external WhatsApp SEND gate.
--
-- The 15 behavioral scenarios above remain the canonical opt-out/follow-up
-- regression battery. The checks below validate the additional external
-- transport authority introduced by 20260910134000.
-- ============================================================================

do $p9_53_final_gate_contract$
declare
  v_reader_definition text;
  v_helper_definition text;
  v_gate_definition text;
  v_executor_definition text;

  v_helper_acl text;
  v_gate_acl text;

  v_count bigint;
begin
  -- --------------------------------------------------------------------------
  -- Scenario 16
  -- Strict integration reader is canonical and helper consumes it.
  -- --------------------------------------------------------------------------

  select pg_catalog.pg_get_functiondef(proc_row.oid)
  into v_reader_definition
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname =
          'get_active_whatsapp_integration_for_external_send_by_system'
    and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
          'p_organization_id uuid, p_store_id uuid';

  if v_reader_definition is null then
    raise exception
      'SCENARIO 16 FAIL: strict WhatsApp integration reader missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname =
            'get_active_whatsapp_integration_for_external_send_by_system'
      and proc_row.prosecdef = true
      and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
            'p_organization_id uuid, p_store_id uuid'
  ) then
    raise exception
      'SCENARIO 16 FAIL: strict integration reader is not SECURITY DEFINER';
  end if;

  if pg_catalog.strpos(
       pg_catalog.lower(v_reader_definition),
       'integration_row.provider = ''whatsapp'''
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_reader_definition),
       'integration_row.is_active = true'
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_reader_definition),
       'integration_row.status = ''active'''
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_reader_definition),
       'phone_number_id'
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_reader_definition),
       'eligible_count = 1'
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_reader_definition),
       'access_token'
     ) = 0 then
    raise exception
      'SCENARIO 16 FAIL: strict integration reader contract incomplete';
  end if;

  if pg_catalog.has_function_privilege(
       'public',
       'public.get_active_whatsapp_integration_for_external_send_by_system(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.get_active_whatsapp_integration_for_external_send_by_system(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.get_active_whatsapp_integration_for_external_send_by_system(uuid,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.get_active_whatsapp_integration_for_external_send_by_system(uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception
      'SCENARIO 16 FAIL: strict integration reader ACL is not service-only';
  end if;

  select pg_catalog.pg_get_functiondef(proc_row.oid)
  into v_helper_definition
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname =
          'is_real_whatsapp_conversation_for_external_send'
    and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
          'p_organization_id uuid, p_store_id uuid, p_conversation_id uuid';

  if v_helper_definition is null then
    raise exception
      'SCENARIO 16 FAIL: strict real WhatsApp helper missing';
  end if;

  if pg_catalog.strpos(
       pg_catalog.lower(v_helper_definition),
       'get_active_whatsapp_integration_for_external_send_by_system'
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_helper_definition),
       'message_row.metadata ->> ''phone_number_id'''
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_helper_definition),
       'message_row.metadata ->> ''source'' = ''meta_whatsapp_webhook'''
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_helper_definition),
       'message_row.metadata ->> ''provider'' = ''meta'''
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_helper_definition),
       'message_row.sender = ''user'''
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_helper_definition),
       'message_row.direction = ''incoming'''
     ) = 0 then
    raise exception
      'SCENARIO 16 FAIL: helper does not consume strict reader plus proven Meta inbound';
  end if;

  if pg_catalog.has_function_privilege(
       'public',
       'public.is_real_whatsapp_conversation_for_external_send(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.is_real_whatsapp_conversation_for_external_send(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.is_real_whatsapp_conversation_for_external_send(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.is_real_whatsapp_conversation_for_external_send(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception
      'SCENARIO 16 FAIL: helper ACL is not service-only';
  end if;


  -- --------------------------------------------------------------------------
  -- Scenario 17
  -- Final gate exists, is SECURITY DEFINER and service-only.
  -- --------------------------------------------------------------------------

  select
    pg_catalog.pg_get_functiondef(proc_row.oid),
    proc_row.proacl::text
  into
    v_gate_definition,
    v_gate_acl
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname =
          'validate_or_cancel_whatsapp_external_send_by_system'
    and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
          'p_organization_id uuid, p_store_id uuid, p_message_id uuid';

  if v_gate_definition is null then
    raise exception
      'SCENARIO 17 FAIL: final external SEND gate missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname =
            'validate_or_cancel_whatsapp_external_send_by_system'
      and proc_row.prosecdef = true
      and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
            'p_organization_id uuid, p_store_id uuid, p_message_id uuid'
  ) then
    raise exception
      'SCENARIO 17 FAIL: final gate is not SECURITY DEFINER';
  end if;

  if pg_catalog.has_function_privilege(
       'public',
       'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception
      'SCENARIO 17 FAIL: final gate ACL is not service-only';
  end if;


  -- --------------------------------------------------------------------------
  -- Scenario 18
  -- Sales AI is fail-closed: explicit outbound_kind only.
  -- --------------------------------------------------------------------------

  if pg_catalog.strpos(
       v_gate_definition,
       'sales_ai_outbound_kind_required'
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       'unsupported_sales_ai_outbound_kind'
     ) = 0 then
    raise exception
      'SCENARIO 18 FAIL: Sales AI explicit outbound_kind guards missing';
  end if;

  if pg_catalog.strpos(
       v_gate_definition,
       'legacy_ai_unscoped'
     ) > 0 then
    raise exception
      'SCENARIO 18 FAIL: permissive legacy_ai_unscoped fallback exists';
  end if;

  foreach v_helper_acl in array array[
    'reactive_ai_reply',
    'stop_contact_ack',
    'canonical_followup'
  ]
  loop
    if pg_catalog.strpos(v_gate_definition, v_helper_acl) = 0 then
      raise exception
        'SCENARIO 18 FAIL: supported outbound kind % missing',
        v_helper_acl;
    end if;
  end loop;


  -- --------------------------------------------------------------------------
  -- Scenario 19
  -- Lock order: opportunity -> follow-up -> conversation -> fresh message.
  -- --------------------------------------------------------------------------

  if pg_catalog.strpos(
       v_gate_definition,
       'select opportunity_row.*'
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       'select followup_row.*'
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       'private_acquire_sales_contract_conversation_xact_lock'
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       'WHATSAPP_EXTERNAL_SEND_GATE_MESSAGE_DISAPPEARED'
     ) = 0 then
    raise exception
      'SCENARIO 19 FAIL: final gate serialization chain incomplete';
  end if;

  if not (
    pg_catalog.strpos(v_gate_definition, 'select opportunity_row.*')
      <
    pg_catalog.strpos(v_gate_definition, 'select followup_row.*')
    and
    pg_catalog.strpos(v_gate_definition, 'select followup_row.*')
      <
    pg_catalog.strpos(
      v_gate_definition,
      'private_acquire_sales_contract_conversation_xact_lock'
    )
    and
    pg_catalog.strpos(
      v_gate_definition,
      'private_acquire_sales_contract_conversation_xact_lock'
    )
      <
    pg_catalog.strpos(
      v_gate_definition,
      'WHATSAPP_EXTERNAL_SEND_GATE_MESSAGE_DISAPPEARED'
    )
  ) then
    raise exception
      'SCENARIO 19 FAIL: gate lock/fresh-read order is incorrect';
  end if;


  -- --------------------------------------------------------------------------
  -- Scenario 20
  -- Fresh authority must reject metadata/opportunity identity mutation.
  -- --------------------------------------------------------------------------

  if pg_catalog.strpos(
       v_gate_definition,
       'message_authority_metadata_changed_during_gate'
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       'sales_ai_opportunity_identity_changed_during_gate'
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       'canonical_followup_identity_changed_during_gate'
     ) = 0 then
    raise exception
      'SCENARIO 20 FAIL: fresh authority identity guards missing';
  end if;


  -- --------------------------------------------------------------------------
  -- Scenario 21
  -- Final controlled boundary rechecks real WhatsApp before attempt.
  -- --------------------------------------------------------------------------

  if pg_catalog.strpos(
       v_gate_definition,
       'is_real_whatsapp_conversation_for_external_send'
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       'real_whatsapp_authority_missing'
     ) = 0 then
    raise exception
      'SCENARIO 21 FAIL: final real WhatsApp revalidation missing';
  end if;

  if pg_catalog.strpos(
       v_gate_definition,
       'real_whatsapp_authority_missing'
     )
     >
     pg_catalog.strpos(
       v_gate_definition,
       'WHATSAPP_EXTERNAL_SEND_GATE_ATTEMPT_TRANSITION_LOST'
     ) then
    raise exception
      'SCENARIO 21 FAIL: WhatsApp authority check occurs after attempt transition';
  end if;


  -- --------------------------------------------------------------------------
  -- Scenario 22
  -- Opt-out and stop-contact ACK authority.
  -- --------------------------------------------------------------------------

  if pg_catalog.strpos(
       v_gate_definition,
       'commercial_opportunity_opted_out'
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       'stop_contact_ack_without_exact_opt_out_source'
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       'source_conversation_id'
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       'source_message_id'
     ) = 0 then
    raise exception
      'SCENARIO 22 FAIL: opt-out / exact ACK authority incomplete';
  end if;

  if pg_catalog.strpos(
       v_gate_definition,
       'superseded_by_new_customer_message'
     ) = 0 then
    raise exception
      'SCENARIO 22 FAIL: newer customer inbound guard missing';
  end if;


  -- --------------------------------------------------------------------------
  -- Scenario 23
  -- Authority block is terminal; authorized SEND becomes uncertain exactly
  -- before Node is allowed to reach the provider.
  -- --------------------------------------------------------------------------

  if pg_catalog.strpos(
       v_gate_definition,
       'outbound_delivery_state = ''failed'''
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       'WHATSAPP_EXTERNAL_SEND_GATE_BLOCK_TRANSITION_LOST'
     ) = 0 then
    raise exception
      'SCENARIO 23 FAIL: blocked message is not proven terminal';
  end if;

  if pg_catalog.strpos(
       v_gate_definition,
       'outbound_delivery_state = ''uncertain'''
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       'outbound_attempt_started_at'
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       'WHATSAPP_EXTERNAL_SEND_GATE_ATTEMPT_TRANSITION_LOST'
     ) = 0 then
    raise exception
      'SCENARIO 23 FAIL: authorized attempt transition contract missing';
  end if;

  if pg_catalog.strpos(
       v_gate_definition,
       '''decision'', ''blocked'''
     ) = 0
     or pg_catalog.strpos(
       v_gate_definition,
       '''decision'', ''send'''
     ) = 0 then
    raise exception
      'SCENARIO 23 FAIL: gate decision contract incomplete';
  end if;


  -- --------------------------------------------------------------------------
  -- Canonical follow-up external activation is intentionally deferred.
  -- Its metadata and duplicate-identity contract will be exercised by the
  -- dedicated activation migration/runner after the sender gate is deployed.
  -- --------------------------------------------------------------------------


  -- --------------------------------------------------------------------------
  -- Scenario 26  -- --------------------------------------------------------------------------
  -- Scenario 26
  -- Opt-out continues separate from Lost.
  -- This is also behaviorally exercised by scenarios 1-15 above.
  -- --------------------------------------------------------------------------

  select count(*)
  into v_count
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname =
          'opt_out_commercial_opportunity_followup_by_system';

  if v_count <> 1 then
    raise exception
      'SCENARIO 26 FAIL: canonical system opt-out writer count expected 1, got %',
      v_count;
  end if;

  if pg_catalog.strpos(
       pg_catalog.lower(v_gate_definition),
       'update public.commercial_opportunities'
     ) > 0 then
    raise exception
      'SCENARIO 26 FAIL: external gate mutates opportunity lifecycle';
  end if;

  raise notice 'P9 5.3 FINAL GATE FOUNDATION: SCENARIOS 16-23 AND 26 PASS';
end;
$p9_53_final_gate_contract$;
