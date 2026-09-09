-- P9 5.2 - Package B temporal queue guard behavioral runner.
-- Based on the runner and deployed SQL definitions supplied on 2026-09-09.
-- No production function is redefined. All writes use disposable fixture IDs.
-- Run the whole file. Success ends with ROLLBACK; an assertion error aborts it.
-- Cases 1/2 share one org so a future queue must not block stale work;
-- cases 5/6/7 share exhaustion/reactivation/terminal lifecycle, with explicit gates.
-- Case 6 proves activation of a new cycle, not delivery of that cycle.
-- next_action_at=2099 is intentional proof that future follow-up must stay pending.
-- A failed-but-finalized stale run is surfaced in case 4, not relabeled succeeded.

begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_followup_bridge_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (
    status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')
  ),
  detail text not null
) on commit preserve rows;


create temp table pg_temp._p9_followup_bridge_matrix (
  scenario_number integer primary key,
  scenario_name text not null
) on commit preserve rows;

insert into pg_temp._p9_followup_bridge_matrix (
  scenario_number,
  scenario_name
)
values
  (1, 'followup futuro permanece pendente sem run mensagem ou tentativa'),
  (2, 'fila futura nao bloqueia followup stale por resposta do cliente'),
  (3, 'followup devido envia e registra tentativa do sistema'),
  (4, 'replay da mesma fila nao duplica mensagem nem tentativa'),
  (5, 'esgotamento reconcilia fila sem marcar oportunidade como perdida'),
  (6, 'novo ciclo apos esgotamento reativa followup sem loss ou reopen'),
  (7, 'oportunidade terminal impede envio e resolve followup pendente');

create temp table pg_temp._p9_followup_bridge_ctx (
  singleton boolean primary key default true check (singleton),

  run_id uuid not null,

  org_a uuid not null,
  org_b uuid not null,

  store_a uuid not null,
  store_a2 uuid not null,
  store_b uuid not null,

  user_a uuid not null,
  user_b uuid not null,

  customer_a uuid not null,
  customer_b uuid not null,

  lead_main uuid not null,
  lead_ambiguous uuid not null,
  lead_b uuid not null,

  conversation_main uuid not null,
  conversation_ambiguous uuid not null,
  conversation_b uuid not null,

  opportunity_main uuid not null,
  opportunity_ambiguous_a uuid not null,
  opportunity_ambiguous_b uuid not null,
  opportunity_b uuid not null,

  next_action_at timestamptz not null
) on commit preserve rows;

insert into pg_temp._p9_followup_bridge_ctx (
  run_id,

  org_a,
  org_b,

  store_a,
  store_a2,
  store_b,

  user_a,
  user_b,

  customer_a,
  customer_b,

  lead_main,
  lead_ambiguous,
  lead_b,

  conversation_main,
  conversation_ambiguous,
  conversation_b,

  opportunity_main,
  opportunity_ambiguous_a,
  opportunity_ambiguous_b,
  opportunity_b,

  next_action_at
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

  '2099-01-01 12:00:00+00'::timestamptz
);

create or replace function pg_temp._p9_followup_bridge_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_followup_bridge_results (
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

create or replace function pg_temp._p9_followup_bridge_exec(
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

    execute format('set local role %I', p_role);
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

create or replace function pg_temp._p9_followup_bridge_enqueue_sql(
  p_org uuid,
  p_store uuid,
  p_opportunity uuid,
  p_conversation uuid,
  p_followup_type text,
  p_operation_key text,
  p_cadence integer,
  p_next_action_at timestamptz
)
returns text
language sql
as $function$
  select format(
    $sql$
      select public.panel_enqueue_followup_opportunity_scoped(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L,
        %L,
        %s,
        %L::timestamptz
      )::text
    $sql$,
    p_org::text,
    p_store::text,
    p_opportunity::text,
    p_conversation::text,
    p_followup_type,
    p_operation_key,
    p_cadence,
    p_next_action_at::text
  );
$function$;

do $setup$
declare
  v pg_temp._p9_followup_bridge_ctx;

  v_lead_link_main uuid := gen_random_uuid();
  v_lead_link_ambiguous uuid := gen_random_uuid();
  v_lead_link_b uuid := gen_random_uuid();

  v_session_main uuid := gen_random_uuid();
  v_session_ambiguous uuid := gen_random_uuid();
  v_session_b uuid := gen_random_uuid();

  v_context_main uuid := gen_random_uuid();
  v_context_ambiguous uuid := gen_random_uuid();
  v_context_b uuid := gen_random_uuid();
begin
  select *
  into strict v
  from pg_temp._p9_followup_bridge_ctx;

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
      'runner-followup-bridge-a-'
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
        'key',
        'followup-bridge-a'
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
      'runner-followup-bridge-b-'
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
        'key',
        'followup-bridge-b'
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
  values
    (
      v.org_a,
      'Runner Followup Bridge Org A '
        || v.run_id::text
    ),
    (
      v.org_b,
      'Runner Followup Bridge Org B '
        || v.run_id::text
    );

  insert into public.stores (
    id,
    organization_id,
    name
  )
  values
    (
      v.store_a,
      v.org_a,
      'Runner Followup Bridge Store A '
        || v.run_id::text
    ),
    (
      v.store_a2,
      v.org_a,
      'Runner Followup Bridge Store A2 '
        || v.run_id::text
    ),
    (
      v.store_b,
      v.org_b,
      'Runner Followup Bridge Store B '
        || v.run_id::text
    );

  insert into public.memberships (
    organization_id,
    user_id,
    role
  )
  values
    (
      v.org_a,
      v.user_a,
      'owner'
    ),
    (
      v.org_b,
      v.user_b,
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
      v.org_a,
      'Runner Followup Bridge Customer A'
    ),
    (
      v.customer_b,
      v.org_b,
      'Runner Followup Bridge Customer B'
    );

  insert into public.customer_store_links (
    organization_id,
    store_id,
    customer_id
  )
  values
    (
      v.org_a,
      v.store_a,
      v.customer_a
    ),
    (
      v.org_a,
      v.store_a2,
      v.customer_a
    ),
    (
      v.org_b,
      v.store_b,
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
      v.lead_main,
      v.org_a,
      v.store_a,
      'Runner Main',
      '+5511999990001',
      'novo_lead'
    ),
    (
      v.lead_ambiguous,
      v.org_a,
      v.store_a,
      'Runner Customer Reply',
      '+5511999990002',
      'novo_lead'
    ),
    (
      v.lead_b,
      v.org_b,
      v.store_b,
      'Runner Tenant B',
      '+5511999990003',
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
      v_lead_link_main,
      v.org_a,
      v.store_a,
      v.lead_main,
      v.customer_a,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_followup_inbox_bridge'
      )
    ),
    (
      v_lead_link_ambiguous,
      v.org_a,
      v.store_a,
      v.lead_ambiguous,
      v.customer_a,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_followup_inbox_bridge'
      )
    ),
    (
      v_lead_link_b,
      v.org_b,
      v.store_b,
      v.lead_b,
      v.customer_b,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_followup_inbox_bridge'
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
      v.conversation_main,
      v.org_a,
      v.lead_main,
      'active',
      false
    ),
    (
      v.conversation_ambiguous,
      v.org_a,
      v.lead_ambiguous,
      'active',
      false
    ),
    (
      v.conversation_b,
      v.org_b,
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
      v_session_main,
      v.org_a,
      v.store_a,
      v.conversation_main,
      'active'
    ),
    (
      v_session_ambiguous,
      v.org_a,
      v.store_a,
      v.conversation_ambiguous,
      'active'
    ),
    (
      v_session_b,
      v.org_b,
      v.store_b,
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
      v.opportunity_main,
      v.org_a,
      v.store_a,
      v.customer_a,
      v.lead_main,
      v.conversation_main,
      'orcamento',
      1,
      now(),
      now()
    ),
    (
      v.opportunity_ambiguous_a,
      v.org_a,
      v.store_a,
      v.customer_a,
      v.lead_ambiguous,
      v.conversation_ambiguous,
      'orcamento',
      1,
      now(),
      now()
    ),
    (
      v.opportunity_b,
      v.org_b,
      v.store_b,
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
      v_context_main,
      v.org_a,
      v.store_a,
      v_session_main,
      v.customer_a,
      v.opportunity_main,
      v_lead_link_main,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_followup_inbox_bridge'
      )
    ),
    (
      v_context_ambiguous,
      v.org_a,
      v.store_a,
      v_session_ambiguous,
      v.customer_a,
      v.opportunity_ambiguous_a,
      v_lead_link_ambiguous,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_followup_inbox_bridge',
        'purpose',
        'isolated_customer_reply_scenario'
      )
    ),
    (
      v_context_b,
      v.org_b,
      v.store_b,
      v_session_b,
      v.customer_b,
      v.opportunity_b,
      v_lead_link_b,
      'active',
      'system',
      'system',
      jsonb_build_object(
        'fixture',
        'p9_followup_inbox_bridge'
      )
    );

  insert into public.conversation_ai_window_state (
    conversation_id,
    organization_id,
    store_id,
    waiting_next_day,
    pending_supervisor,
    last_ai_message_at,
    last_customer_message_at,
    next_resume_at,
    updated_at,
    resume_reason
  )
  values
    (
      v.conversation_main,
      v.org_a,
      v.store_a,
      false,
      false,
      pg_catalog.clock_timestamp()
        - interval '49 hours',
      pg_catalog.clock_timestamp()
        - interval '48 hours',
      null,
      pg_catalog.clock_timestamp(),
      'none'
    ),
    (
      v.conversation_ambiguous,
      v.org_a,
      v.store_a,
      false,
      false,
      pg_catalog.clock_timestamp()
        - interval '49 hours',
      pg_catalog.clock_timestamp()
        - interval '48 hours',
      null,
      pg_catalog.clock_timestamp(),
      'none'
    ),
    (
      v.conversation_b,
      v.org_b,
      v.store_b,
      false,
      false,
      pg_catalog.clock_timestamp()
        - interval '49 hours',
      pg_catalog.clock_timestamp()
        - interval '48 hours',
      null,
      pg_catalog.clock_timestamp(),
      'none'
    );
end;
$setup$;

create or replace function pg_temp._p9_52_enqueue(
  p_role text,
  p_user_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_opportunity_id uuid,
  p_conversation_id uuid,
  p_operation_key text,
  p_next_action_at timestamptz default
    '2099-01-01 12:00:00+00'::timestamptz
)
returns public.ai_sales_action_queue
language plpgsql
as $function$
declare
  v_exec record;
  v_queue public.ai_sales_action_queue;
begin
  select *
  into v_exec
  from pg_temp._p9_followup_bridge_exec(
    p_role,
    p_user_id,
    pg_temp._p9_followup_bridge_enqueue_sql(
      p_organization_id,
      p_store_id,
      p_opportunity_id,
      p_conversation_id,
      'offer',
      p_operation_key,
      60,
      p_next_action_at
    )
  );

  if coalesce(v_exec.operation_succeeded, false) = false then
    raise exception using
      errcode = 'P0001',
      message = 'P9_52_ENQUEUE_FAILED',
      detail = coalesce(v_exec.message_text, '<null>');
  end if;

  select queue_row.*
  into v_queue
  from public.ai_sales_action_queue queue_row
  where queue_row.organization_id = p_organization_id
    and queue_row.store_id = p_store_id
    and queue_row.conversation_id = p_conversation_id
    and queue_row.action_key =
      'manual_followup_opportunity:'
      || p_opportunity_id::text
      || ':'
      || p_operation_key;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'P9_52_ENQUEUE_QUEUE_NOT_CREATED',
      detail =
        'value=' || coalesce(v_exec.value_text, '<null>')
        || '; message=' || coalesce(v_exec.message_text, '<null>')
        || '; sqlstate=' || coalesce(v_exec.returned_sqlstate, '<null>');
  end if;

  return v_queue;
end;
$function$;



-- Only dispatch a known queue from this transaction's isolated fixture.
-- Never select work from an existing development organization.
create or replace function pg_temp._p9_52_process_exact_fixture_queue(
  p_queue_id uuid
)
returns jsonb
language plpgsql
as $function$
declare
  v_ctx pg_temp._p9_followup_bridge_ctx;
  v_queue public.ai_sales_action_queue;
  v_after public.ai_sales_action_queue;
  v_run public.ai_sales_action_runs;
  v_count bigint;
begin
  select * into strict v_ctx from pg_temp._p9_followup_bridge_ctx;
  select * into strict v_queue
  from public.ai_sales_action_queue where id = p_queue_id for update;

  if (
    (v_queue.organization_id = v_ctx.org_a
      and v_queue.store_id = v_ctx.store_a
      and v_queue.conversation_id in (
        v_ctx.conversation_main, v_ctx.conversation_ambiguous
      ))
    or
    (v_queue.organization_id = v_ctx.org_b
      and v_queue.store_id = v_ctx.store_b
      and v_queue.conversation_id = v_ctx.conversation_b)
  ) is not true then
    raise exception 'P9_52_WORKER_SCOPE_NOT_OWNED_BY_FIXTURE';
  end if;

  if v_queue.next_action is distinct from 'followup_offer' then
    raise exception 'P9_52_WORKER_UNEXPECTED_ACTION';
  end if;

  if v_queue.processed_at is not null
     or v_queue.processing_error is not null
     or exists (
       select 1 from public.ai_sales_action_runs
       where action_queue_id = p_queue_id
     ) then
    raise exception 'P9_52_WORKER_EXPECTED_FRESH_PENDING_QUEUE';
  end if;

  if not public.ai_sales_action_queue_ready_now(p_queue_id) then
    raise exception 'P9_52_WORKER_EXPECTED_READY_QUEUE';
  end if;

  -- Match the deployed worker selection and reject ties or earlier work.
  select count(*) into v_count
  from public.ai_sales_action_queue q
  where q.organization_id = v_queue.organization_id
    and q.processed_at is null and q.processing_error is null
    and q.enqueued_at <= v_queue.enqueued_at
    and not exists (
      select 1 from public.ai_sales_action_runs r
      where r.action_queue_id = q.id
    )
    and public.ai_sales_action_queue_ready_now(q.id);
  if v_count <> 1 then
    raise exception using
      message = 'P9_52_WORKER_SELECTION_NOT_EXACT',
      detail = format('queue=%s competing_or_equal=%s', p_queue_id, v_count);
  end if;

  perform public.process_next_ai_sales_action_queue(v_queue.organization_id);

  select * into strict v_after
  from public.ai_sales_action_queue where id = p_queue_id;
  select * into strict v_run
  from public.ai_sales_action_runs where action_queue_id = p_queue_id;

  if v_run.status not in ('succeeded', 'failed')
     or v_run.finished_at is null
     or (v_after.processed_at is null and v_after.processing_error is null)
     or v_run.output is null then
    raise exception using
      message = 'P9_52_WORKER_DID_NOT_FINALIZE_EXPECTED_QUEUE',
      detail = format('queue=%s run_status=%s error=%s output=%s',
        p_queue_id, v_run.status, v_run.error_text, v_run.output);
  end if;

  return v_run.output || jsonb_build_object(
    '_runner_worker_status', v_run.status,
    '_runner_queue_processed_at', v_after.processed_at,
    '_runner_queue_processing_error', v_after.processing_error
  );
end;
$function$;

do $scenarios$
declare
  v pg_temp._p9_followup_bridge_ctx;

  v_queue public.ai_sales_action_queue;
  v_queue_after public.ai_sales_action_queue;
  v_queue_reply public.ai_sales_action_queue;
  v_queue_exhaust public.ai_sales_action_queue;
  v_queue_reactivated public.ai_sales_action_queue;

  v_followup public.commercial_opportunity_followups;
  v_followup_after public.commercial_opportunity_followups;
  v_customer_message public.messages;
  v_loss_evidence public.messages;

  v_result jsonb;
  v_replay_result jsonb;

  v_message_count bigint;
  v_message_count_before bigint;
  v_attempt_events bigint;
  v_attempt_before integer;
  v_lifecycle_count bigint;
  v_run_count bigint;
  v_previous_cycle integer;
  v_stage text;
  v_mode text;
  v_can_run_real boolean;
  v_err_context text;
  v_err_detail text;
begin
  select *
  into strict v
  from pg_temp._p9_followup_bridge_ctx;

  select execution_mode
  into v_mode
  from public.ai_sales_action_execution_mode();

  select can_run_real
  into v_can_run_real
  from public.ai_sales_real_execution_precheck(
    'followup_offer'
  );

  if v_mode <> 'real'
     or coalesce(v_can_run_real, false) = false then
    raise exception using
      errcode = 'P0001',
      message = 'P9_52_REAL_EXECUTION_PRECONDITION_FAILED';
  end if;


  ----------------------------------------------------------------
  -- 1. Follow-up futuro nao executa antes da hora
  ----------------------------------------------------------------
  begin
    v_queue :=
      pg_temp._p9_52_enqueue(
        'authenticated',
        v.user_a,
        v.org_a,
        v.store_a,
        v.opportunity_main,
        v.conversation_main,
        'p9-52-temporal-future-1'
      );

    select followup_row.*
    into strict v_followup
    from public.commercial_opportunity_followups followup_row
    where followup_row.id =
      (v_queue.payload ->> 'followup_id')::uuid;

    perform public.process_next_ai_sales_action_queue(
      v.org_a
    );

    v_result :=
      public.ai_sales_action_execute(
        v_queue.id
      );

    select queue_row.*
    into strict v_queue_after
    from public.ai_sales_action_queue queue_row
    where queue_row.id = v_queue.id;

    select followup_row.*
    into strict v_followup_after
    from public.commercial_opportunity_followups followup_row
    where followup_row.id = v_followup.id;

    select count(*)
    into v_run_count
    from public.ai_sales_action_runs run_row
    where run_row.action_queue_id = v_queue.id;

    select count(*)
    into v_message_count
    from public.messages message_row
    where message_row.conversation_id = v.conversation_main
      and message_row.sender = 'ai'
      and message_row.direction = 'outgoing'
      and message_row.deleted_at is null
      and message_row.metadata ->> 'action_queue_id'
            = v_queue.id::text;

    select count(*)
    into v_attempt_events
    from public.commercial_opportunity_followup_events event_row
    where event_row.organization_id = v.org_a
      and event_row.store_id = v.store_a
      and event_row.commercial_opportunity_id =
            v.opportunity_main
      and event_row.event_type = 'attempt_recorded'
      and event_row.operation_key =
            'system_attempt:' || v_queue.id::text;

    perform pg_temp._p9_followup_bridge_record(
      1,
      'followup futuro permanece pendente sem run mensagem ou tentativa',
      case
        when v_result ->> 'result' = 'followup_not_due_yet'
         and v_queue_after.processed_at is null
         and v_queue_after.processing_error is null
         and v_run_count = 0
         and v_message_count = 0
         and v_followup_after.attempt_count = 0
         and v_followup_after.last_attempt_at is null
         and v_attempt_events = 0
         and v_followup_after.next_action_at >
               pg_catalog.clock_timestamp()
          then 'PASS'
        else 'SUT_FAIL'
      end,
      format(
        'router=%s queue_processed=%s queue_error=%s runs=%s messages=%s attempts=%s attempt_events=%s next_action_at=%s',
        coalesce(v_result ->> 'result', '<null>'),
        coalesce(v_queue_after.processed_at::text, '<null>'),
        coalesce(v_queue_after.processing_error, '<null>'),
        v_run_count,
        v_message_count,
        v_followup_after.attempt_count,
        v_attempt_events,
        v_followup_after.next_action_at
      )
    );
  exception
    when others then
      get stacked diagnostics
        v_err_context = pg_exception_context,
        v_err_detail = pg_exception_detail;

      perform pg_temp._p9_followup_bridge_record(
        1,
        'followup futuro permanece pendente sem run mensagem ou tentativa',
        'HARNESS_ERROR',
        sqlerrm || E'\nDETAIL=' || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT=' || coalesce(v_err_context, '<null>')
      );
  end;


  ----------------------------------------------------------------
  -- 2. Fila futura nao bloqueia outra fila que ficou stale
  ----------------------------------------------------------------
  begin
    if not exists (
      select 1
      from pg_temp._p9_followup_bridge_results
      where scenario_number = 1
        and status = 'PASS'
    ) then
      raise exception 'P9_52_PREREQUISITE_SCENARIO_1_NOT_PASSED';
    end if;

    v_queue_reply :=
      pg_temp._p9_52_enqueue(
        'authenticated',
        v.user_a,
        v.org_a,
        v.store_a,
        v.opportunity_ambiguous_a,
        v.conversation_ambiguous,
        'p9-52-temporal-reply-1'
      );

    update public.ai_sales_action_queue queue_row
    set enqueued_at =
      pg_catalog.transaction_timestamp() - interval '1 minute'
    where queue_row.id = v_queue_reply.id
    returning *
    into strict v_queue_reply;

    select *
    into v_customer_message
    from public.insert_message(
      v.conversation_ambiguous,
      'user',
      'incoming',
      'text',
      'Runner P9 5.2: resposta do cliente antes do horario.',
      null,
      null,
      jsonb_build_object(
        'fixture',
        'p9_followup_temporal_queue_guard',
        'run_id',
        v.run_id
      )
    );

    v_result :=
      pg_temp._p9_52_process_exact_fixture_queue(
        v_queue_reply.id
      );

    select followup_row.*
    into strict v_followup_after
    from public.commercial_opportunity_followups followup_row
    where followup_row.id =
      (v_queue_reply.payload ->> 'followup_id')::uuid;

    select opportunity_row.stage
    into strict v_stage
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v.opportunity_ambiguous_a;

    select count(*)
    into v_message_count
    from public.messages message_row
    where message_row.conversation_id = v.conversation_ambiguous
      and message_row.sender = 'ai'
      and message_row.direction = 'outgoing'
      and message_row.deleted_at is null
      and message_row.metadata ->> 'followup_id'
            = v_followup_after.id::text;

    select count(*)
    into v_lifecycle_count
    from public.commercial_opportunity_lifecycle_events event_row
    where event_row.commercial_opportunity_id =
            v.opportunity_ambiguous_a
      and event_row.event_type in (
        'marked_lost',
        'reopened'
      );

    select queue_row.*
    into strict v_queue_after
    from public.ai_sales_action_queue queue_row
    where queue_row.id = v_queue.id;

    select count(*)
    into v_run_count
    from public.ai_sales_action_runs run_row
    where run_row.action_queue_id = v_queue.id;

    perform pg_temp._p9_followup_bridge_record(
      2,
      'fila futura nao bloqueia followup stale por resposta do cliente',
      case
        when v_result ->> 'result'
              = 'followup_stale_customer_replied'
         and v_result ->> '_runner_worker_status' = 'succeeded'
         and v_followup_after.status = 'resolved'
         and v_message_count = 0
         and v_stage = 'orcamento'
         and v_lifecycle_count = 0
         and v_queue_after.processed_at is null
         and v_queue_after.processing_error is null
         and v_run_count = 0
          then 'PASS'
        else 'SUT_FAIL'
      end,
      format(
        'result=%s reply_status=%s reply_outgoing=%s stage=%s lifecycle=%s future_queue_processed=%s future_runs=%s customer_message=%s',
        coalesce(v_result ->> 'result', '<null>')
          || ' worker='
          || coalesce(v_result ->> '_runner_worker_status', '<null>'),
        coalesce(v_followup_after.status, '<null>'),
        v_message_count,
        coalesce(v_stage, '<null>'),
        v_lifecycle_count,
        coalesce(v_queue_after.processed_at::text, '<null>'),
        v_run_count,
        coalesce(v_customer_message.id::text, '<null>')
      )
    );
  exception
    when others then
      get stacked diagnostics
        v_err_context = pg_exception_context,
        v_err_detail = pg_exception_detail;

      perform pg_temp._p9_followup_bridge_record(
        2,
        'fila futura nao bloqueia followup stale por resposta do cliente',
        'HARNESS_ERROR',
        sqlerrm || E'\nDETAIL=' || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT=' || coalesce(v_err_context, '<null>')
      );
  end;


  ----------------------------------------------------------------
  -- 3. A mesma fila passa a executar quando fica realmente due
  ----------------------------------------------------------------
  begin
    if not exists (
      select 1
      from pg_temp._p9_followup_bridge_results
      where scenario_number = 2
        and status = 'PASS'
    ) then
      raise exception 'P9_52_PREREQUISITE_SCENARIO_2_NOT_PASSED';
    end if;

    update public.commercial_opportunity_followups followup_row
    set
      started_at =
        pg_catalog.transaction_timestamp() - interval '2 hours',
      next_action_at =
        pg_catalog.transaction_timestamp() - interval '1 hour'
    where followup_row.id =
      (v_queue.payload ->> 'followup_id')::uuid
    returning *
    into strict v_followup;

    v_result :=
      pg_temp._p9_52_process_exact_fixture_queue(
        v_queue.id
      );

    select followup_row.*
    into strict v_followup_after
    from public.commercial_opportunity_followups followup_row
    where followup_row.id = v_followup.id;

    select count(*)
    into v_message_count
    from public.messages message_row
    where message_row.conversation_id = v.conversation_main
      and message_row.sender = 'ai'
      and message_row.direction = 'outgoing'
      and message_row.deleted_at is null
      and message_row.metadata ->> 'action_queue_id'
            = v_queue.id::text
      and message_row.metadata ->> 'commercial_opportunity_id'
            = v.opportunity_main::text
      and message_row.metadata ->> 'followup_id'
            = v_followup.id::text
      and message_row.metadata ->> 'followup_cycle'
            = v_followup.cycle::text;

    select count(*)
    into v_attempt_events
    from public.commercial_opportunity_followup_events event_row
    where event_row.organization_id = v.org_a
      and event_row.store_id = v.store_a
      and event_row.commercial_opportunity_id =
            v.opportunity_main
      and event_row.event_type = 'attempt_recorded'
      and event_row.actor_type = 'system'
      and event_row.actor_user_id is null
      and event_row.operation_key =
            'system_attempt:' || v_queue.id::text;

    perform pg_temp._p9_followup_bridge_record(
      3,
      'followup devido envia e registra tentativa do sistema',
      case
        when v_result ->> 'result' = 'message_inserted'
         and v_result ->> '_runner_worker_status' = 'succeeded'
         and v_followup_after.attempt_count = 1
         and v_followup_after.last_attempt_at is not null
         and v_message_count = 1
         and v_attempt_events = 1
          then 'PASS'
        else 'SUT_FAIL'
      end,
      format(
        'result=%s attempt_count=%s messages=%s attempt_events=%s next_action_at=%s',
        coalesce(v_result ->> 'result', '<null>')
          || ' worker='
          || coalesce(v_result ->> '_runner_worker_status', '<null>'),
        v_followup_after.attempt_count,
        v_message_count,
        v_attempt_events,
        v_followup_after.next_action_at
      )
    );
  exception
    when others then
      get stacked diagnostics
        v_err_context = pg_exception_context,
        v_err_detail = pg_exception_detail;

      perform pg_temp._p9_followup_bridge_record(
        3,
        'followup devido envia e registra tentativa do sistema',
        'HARNESS_ERROR',
        sqlerrm || E'\nDETAIL=' || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT=' || coalesce(v_err_context, '<null>')
      );
  end;


  ----------------------------------------------------------------
  -- 4. Replay da mesma fila
  ----------------------------------------------------------------
  begin
    if not exists (
      select 1
      from pg_temp._p9_followup_bridge_results
      where scenario_number = 3
        and status = 'PASS'
    ) then
      raise exception 'P9_52_PREREQUISITE_SCENARIO_3_NOT_PASSED';
    end if;

    select count(*)
    into v_message_count_before
    from public.messages message_row
    where message_row.conversation_id = v.conversation_main
      and message_row.sender = 'ai'
      and message_row.direction = 'outgoing'
      and message_row.deleted_at is null
      and message_row.metadata ->> 'action_queue_id'
            = v_queue.id::text;

    select followup_row.attempt_count
    into strict v_attempt_before
    from public.commercial_opportunity_followups followup_row
    where followup_row.id =
      (v_queue.payload ->> 'followup_id')::uuid;

    v_replay_result :=
      public.ai_sales_action_execute(
        v_queue.id
      );

    select followup_row.*
    into strict v_followup_after
    from public.commercial_opportunity_followups followup_row
    where followup_row.id =
      (v_queue.payload ->> 'followup_id')::uuid;

    select count(*)
    into v_message_count
    from public.messages message_row
    where message_row.conversation_id = v.conversation_main
      and message_row.sender = 'ai'
      and message_row.direction = 'outgoing'
      and message_row.deleted_at is null
      and message_row.metadata ->> 'action_queue_id'
            = v_queue.id::text;

    perform pg_temp._p9_followup_bridge_record(
      4,
      'replay da mesma fila nao duplica mensagem nem tentativa',
      case
        when v_message_count = v_message_count_before
         and v_followup_after.attempt_count = v_attempt_before
         and v_replay_result ->> 'result' in (
           'already_sent',
           'already_replied_after_last_customer_message'
         )
          then 'PASS'
        else 'SUT_FAIL'
      end,
      format(
        'result=%s messages_before=%s messages_after=%s attempts_before=%s attempts_after=%s',
        coalesce(v_replay_result ->> 'result', '<null>'),
        v_message_count_before,
        v_message_count,
        v_attempt_before,
        v_followup_after.attempt_count
      )
    );
  exception
    when others then
      get stacked diagnostics
        v_err_context = pg_exception_context,
        v_err_detail = pg_exception_detail;

      perform pg_temp._p9_followup_bridge_record(
        4,
        'replay da mesma fila nao duplica mensagem nem tentativa',
        'HARNESS_ERROR',
        sqlerrm || E'\nDETAIL=' || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT=' || coalesce(v_err_context, '<null>')
      );
  end;


  ----------------------------------------------------------------
  -- 5. Exhaustion reconcilia a queue e nao vira Lost
  ----------------------------------------------------------------
  begin
    v_queue_exhaust :=
      pg_temp._p9_52_enqueue(
        'authenticated',
        v.user_b,
        v.org_b,
        v.store_b,
        v.opportunity_b,
        v.conversation_b,
        'p9-52-temporal-exhaust-1'
      );

    select followup_row.*
    into strict v_followup
    from public.commercial_opportunity_followups followup_row
    where followup_row.id =
      (v_queue_exhaust.payload ->> 'followup_id')::uuid;

    v_previous_cycle := v_followup.cycle;

    perform public.exhaust_commercial_opportunity_followup_by_system(
      v.org_b,
      v.store_b,
      v.opportunity_b,
      'p9-52-temporal-exhaust-' || v.run_id::text
    );

    select queue_row.*
    into strict v_queue_after
    from public.ai_sales_action_queue queue_row
    where queue_row.id = v_queue_exhaust.id;

    select followup_row.*
    into strict v_followup_after
    from public.commercial_opportunity_followups followup_row
    where followup_row.id = v_followup.id;

    select count(*)
    into v_run_count
    from public.ai_sales_action_runs run_row
    where run_row.action_queue_id = v_queue_exhaust.id;

    select count(*)
    into v_message_count
    from public.messages message_row
    where message_row.conversation_id = v.conversation_b
      and message_row.sender = 'ai'
      and message_row.direction = 'outgoing'
      and message_row.metadata ->> 'action_queue_id'
            = v_queue_exhaust.id::text;

    select opportunity_row.stage
    into strict v_stage
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v.opportunity_b;

    select count(*)
    into v_lifecycle_count
    from public.commercial_opportunity_lifecycle_events event_row
    where event_row.commercial_opportunity_id =
            v.opportunity_b
      and event_row.event_type in (
        'marked_lost',
        'reopened'
      );

    perform pg_temp._p9_followup_bridge_record(
      5,
      'esgotamento reconcilia fila sem marcar oportunidade como perdida',
      case
        when v_followup_after.status = 'exhausted'
         and v_followup_after.exhausted_at is not null
         and v_queue_after.processed_at is not null
         and v_queue_after.processing_error is null
         and v_queue_after.payload ->> 'followup_queue_reconciled'
               = 'true'
         and v_queue_after.payload ->> 'followup_queue_reconciled_reason'
               = 'followup_cycle_exhausted'
         and v_run_count = 0
         and v_message_count = 0
         and v_stage = 'orcamento'
         and v_lifecycle_count = 0
          then 'PASS'
        else 'SUT_FAIL'
      end,
      format(
        'followup_status=%s stage=%s queue_processed=%s reconciled=%s reason=%s runs=%s outgoing=%s lifecycle_loss_reopen=%s',
        coalesce(v_followup_after.status, '<null>'),
        coalesce(v_stage, '<null>'),
        coalesce(v_queue_after.processed_at::text, '<null>'),
        coalesce(
          v_queue_after.payload ->> 'followup_queue_reconciled',
          '<null>'
        ),
        coalesce(
          v_queue_after.payload ->> 'followup_queue_reconciled_reason',
          '<null>'
        ),
        v_run_count,
        v_message_count,
        v_lifecycle_count
      )
    );
  exception
    when others then
      get stacked diagnostics
        v_err_context = pg_exception_context,
        v_err_detail = pg_exception_detail;

      perform pg_temp._p9_followup_bridge_record(
        5,
        'esgotamento reconcilia fila sem marcar oportunidade como perdida',
        'HARNESS_ERROR',
        sqlerrm || E'\nDETAIL=' || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT=' || coalesce(v_err_context, '<null>')
      );
  end;


  ----------------------------------------------------------------
  -- 6. Novo ciclo apos exhaustion
  ----------------------------------------------------------------
  begin
    if not exists (
      select 1
      from pg_temp._p9_followup_bridge_results
      where scenario_number = 5
        and status = 'PASS'
    ) then
      raise exception 'P9_52_PREREQUISITE_SCENARIO_5_NOT_PASSED';
    end if;

    v_queue_reactivated :=
      pg_temp._p9_52_enqueue(
        'authenticated',
        v.user_b,
        v.org_b,
        v.store_b,
        v.opportunity_b,
        v.conversation_b,
        'p9-52-temporal-reactivate-1'
      );

    select followup_row.*
    into strict v_followup_after
    from public.commercial_opportunity_followups followup_row
    where followup_row.id =
      (v_queue_reactivated.payload ->> 'followup_id')::uuid;

    select opportunity_row.stage
    into strict v_stage
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v.opportunity_b;

    select count(*)
    into v_lifecycle_count
    from public.commercial_opportunity_lifecycle_events event_row
    where event_row.commercial_opportunity_id =
            v.opportunity_b
      and event_row.event_type in (
        'marked_lost',
        'reopened'
      );

    select queue_row.*
    into strict v_queue_after
    from public.ai_sales_action_queue queue_row
    where queue_row.id = v_queue_reactivated.id;

    perform pg_temp._p9_followup_bridge_record(
      6,
      'novo ciclo apos esgotamento reativa followup sem loss ou reopen',
      case
        when v_followup_after.status = 'active'
         and v_followup_after.cycle = v_previous_cycle + 1
         and v_stage = 'orcamento'
         and v_lifecycle_count = 0
         and v_queue_after.processed_at is null
         and v_queue_after.processing_error is null
          then 'PASS'
        else 'SUT_FAIL'
      end,
      format(
        'status=%s previous_cycle=%s new_cycle=%s stage=%s lifecycle_loss_reopen=%s queue_processed=%s',
        coalesce(v_followup_after.status, '<null>'),
        v_previous_cycle,
        v_followup_after.cycle,
        coalesce(v_stage, '<null>'),
        v_lifecycle_count,
        coalesce(v_queue_after.processed_at::text, '<null>')
      )
    );
  exception
    when others then
      get stacked diagnostics
        v_err_context = pg_exception_context,
        v_err_detail = pg_exception_detail;

      perform pg_temp._p9_followup_bridge_record(
        6,
        'novo ciclo apos esgotamento reativa followup sem loss ou reopen',
        'HARNESS_ERROR',
        sqlerrm || E'\nDETAIL=' || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT=' || coalesce(v_err_context, '<null>')
      );
  end;


  ----------------------------------------------------------------
  -- 7. Opportunity terminal antes do SEND
  ----------------------------------------------------------------
  begin
    if not exists (
      select 1
      from pg_temp._p9_followup_bridge_results
      where scenario_number = 6
        and status = 'PASS'
    ) then
      raise exception 'P9_52_PREREQUISITE_SCENARIO_6_NOT_PASSED';
    end if;

    update public.ai_sales_action_queue
    set enqueued_at =
      pg_catalog.transaction_timestamp() - interval '1 minute'
    where id = v_queue_reactivated.id
      and organization_id = v.org_b
      and store_id = v.store_b
      and conversation_id = v.conversation_b
    returning *
    into strict v_queue_reactivated;

    select *
    into strict v_loss_evidence
    from public.insert_message(
      v.conversation_b,
      'user',
      'incoming',
      'text',
      'Nao quero prosseguir com esta compra. Minha recusa e definitiva.',
      null,
      null,
      jsonb_build_object(
        'fixture',
        'p9_followup_temporal_queue_guard',
        'run_id',
        v.run_id,
        'scenario',
        7
      )
    );

    perform public.assert_commercial_opportunity_message_evidence(
      p_organization_id => v.org_b,
      p_store_id => v.store_b,
      p_commercial_opportunity_id => v.opportunity_b,
      p_customer_id => v.customer_b,
      p_evidence_message_id => v_loss_evidence.id
    );

    perform 1
    from public.mark_commercial_opportunity_lost_by_system(
      v.org_b,
      v.store_b,
      v.opportunity_b,
      'p9-52-temporal-loss-' || v.run_id::text,
      'explicit_refusal',
      v_loss_evidence.id,
      'Cliente recusou definitivamente esta compra na mensagem vinculada.',
      'system',
      'p9_followup_temporal_queue_guard'
    );

    v_result :=
      pg_temp._p9_52_process_exact_fixture_queue(
        v_queue_reactivated.id
      );

    select followup_row.*
    into strict v_followup_after
    from public.commercial_opportunity_followups followup_row
    where followup_row.id =
      (v_queue_reactivated.payload ->> 'followup_id')::uuid;

    select opportunity_row.stage
    into strict v_stage
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v.opportunity_b;

    select count(*)
    into v_message_count
    from public.messages message_row
    where message_row.conversation_id = v.conversation_b
      and message_row.sender = 'ai'
      and message_row.direction = 'outgoing'
      and message_row.deleted_at is null
      and message_row.metadata ->> 'followup_id'
            = v_followup_after.id::text;

    perform pg_temp._p9_followup_bridge_record(
      7,
      'oportunidade terminal impede envio e resolve followup pendente',
      case
        when v_result ->> 'result'
              = 'followup_stale_opportunity_terminal'
         and v_result ->> '_runner_worker_status' = 'succeeded'
         and v_stage = 'perdido'
         and v_followup_after.status = 'resolved'
         and v_message_count = 0
          then 'PASS'
        else 'SUT_FAIL'
      end,
      format(
        'result=%s stage=%s followup_status=%s outgoing=%s',
        coalesce(v_result ->> 'result', '<null>')
          || ' worker='
          || coalesce(v_result ->> '_runner_worker_status', '<null>'),
        coalesce(v_stage, '<null>'),
        coalesce(v_followup_after.status, '<null>'),
        v_message_count
      )
    );
  exception
    when others then
      get stacked diagnostics
        v_err_context = pg_exception_context,
        v_err_detail = pg_exception_detail;

      perform pg_temp._p9_followup_bridge_record(
        7,
        'oportunidade terminal impede envio e resolve followup pendente',
        'HARNESS_ERROR',
        sqlerrm || E'\nDETAIL=' || coalesce(v_err_detail, '<null>')
        || E'\nCONTEXT=' || coalesce(v_err_context, '<null>')
      );
  end;
end;
$scenarios$;


insert into pg_temp._p9_followup_bridge_results (
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
from pg_temp._p9_followup_bridge_matrix matrix
where not exists (
  select 1
  from pg_temp._p9_followup_bridge_results result
  where result.scenario_number =
        matrix.scenario_number
);


do $assertions$
declare
  v_failed_count integer;
  v_summary text;
begin
  select count(*)
  into v_failed_count
  from pg_temp._p9_followup_bridge_results
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
    from pg_temp._p9_followup_bridge_results
    where status <> 'PASS';

    raise exception using
      errcode = 'P0001',
      message = 'P9_FOLLOWUP_52_RUNTIME_BEHAVIOR_CHECK_FAILED',
      detail = v_summary;
  end if;
end;
$assertions$;


select *
from pg_temp._p9_followup_bridge_results
order by scenario_number;

rollback;
