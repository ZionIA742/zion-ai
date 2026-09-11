-- P9 / Bloco 5 / Etapa 5.4
-- Commercial opportunity priority foundation - manual checks
--
-- Rollback-only runner. Execute manually against a database where the paired
-- migration has been applied. It creates isolated fixtures and rolls back.

begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_priority_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (
    status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')
  ),
  detail text not null
) on commit preserve rows;

create or replace function pg_temp._record(
  p_number integer,
  p_name text,
  p_ok boolean,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_priority_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_number,
    p_name,
    case when p_ok then 'PASS' else 'SUT_FAIL' end,
    coalesce(p_detail, '<null>')
  )
  on conflict (scenario_number) do update
  set
    scenario_name = excluded.scenario_name,
    status = excluded.status,
    detail = excluded.detail;
end;
$function$;

create or replace function pg_temp._record_error(
  p_number integer,
  p_name text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_priority_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_number,
    p_name,
    'HARNESS_ERROR',
    coalesce(p_detail, '<null>')
  )
  on conflict (scenario_number) do update
  set
    scenario_name = excluded.scenario_name,
    status = excluded.status,
    detail = excluded.detail;
end;
$function$;

create temp table pg_temp._ctx (
  run_id uuid not null,
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b uuid not null,
  user_a uuid not null,
  user_b uuid not null,
  customer_a uuid not null,
  customer_b uuid not null,
  as_of timestamptz not null
) on commit preserve rows;

insert into pg_temp._ctx
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
  '2026-09-10 12:00:00+00'::timestamptz
);

create temp table pg_temp._opp (
  key text primary key,
  id uuid not null,
  org_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  lead_id uuid not null,
  conversation_id uuid not null,
  session_id uuid not null,
  context_id uuid not null,
  lead_link_id uuid not null,
  stage text not null,
  cycle integer not null
) on commit preserve rows;

do $setup$
declare
  c pg_temp._ctx%rowtype;
  k text;
begin
  select * into strict c from pg_temp._ctx;

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
      c.user_a,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'p9-priority-a-' || c.run_id::text || '@example.test',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"runner":true}'::jsonb,
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
      c.user_b,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'p9-priority-b-' || c.run_id::text || '@example.test',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"runner":true}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      '',
      false,
      false
    );

  insert into public.organizations (id, name, subscription_status)
  values
    (c.org_a, 'P9 Priority Org A ' || c.run_id::text, 'active'),
    (c.org_b, 'P9 Priority Org B ' || c.run_id::text, 'active');

  insert into public.stores (id, organization_id, name)
  values
    (c.store_a, c.org_a, 'P9 Priority Store A ' || c.run_id::text),
    (c.store_b, c.org_b, 'P9 Priority Store B ' || c.run_id::text);

  insert into public.memberships (organization_id, user_id, role)
  values
    (c.org_a, c.user_a, 'owner'),
    (c.org_b, c.user_b, 'owner');

  insert into public.customers (id, organization_id, display_name, normalized_name)
  values
    (c.customer_a, c.org_a, 'P9 Priority Customer A', 'p9-priority-customer-a-' || replace(c.run_id::text, '-', '')),
    (c.customer_b, c.org_b, 'P9 Priority Customer B', 'p9-priority-customer-b-' || replace(c.run_id::text, '-', ''));

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  values
    (c.org_a, c.store_a, c.customer_a),
    (c.org_b, c.store_b, c.customer_b);

  foreach k in array array[
    'base',
    'waiting',
    'waiting_task',
    'urgent_task',
    'other_task',
    'overdue_commitment',
    'old_cycle_commitment',
    'future_commitment',
    'due_followup',
    'terminal_followup',
    'quote_current',
    'quote_non_current',
    'quote_none',
    'impact_high',
    'impact_low',
    'stable_a',
    'stable_b',
    'terminal',
    'tenant_a',
    'tenant_b',
    'quote_reopen_unanchored',
    'deleted_customer_message',
    'inactive_context_message'
  ] loop
    insert into pg_temp._opp
    values (
      k,
      gen_random_uuid(),
      case when k = 'tenant_b' then c.org_b else c.org_a end,
      case when k = 'tenant_b' then c.store_b else c.store_a end,
      case when k = 'tenant_b' then c.customer_b else c.customer_a end,
      gen_random_uuid(),
      gen_random_uuid(),
      gen_random_uuid(),
      gen_random_uuid(),
      gen_random_uuid(),
      case
        when k = 'terminal' then 'qualificacao'
        when k in ('impact_high', 'impact_low') then 'orcamento'
        when k = 'future_commitment' then 'visita_tecnica'
        else 'qualificacao'
      end,
      1
    );
  end loop;

  insert into public.leads (
    id,
    organization_id,
    store_id,
    name,
    phone,
    state
  )
  select
    o.lead_id,
    o.org_id,
    o.store_id,
    'P9 Priority ' || o.key,
    '+55119988' || lpad(row_number() over (order by o.key)::text, 6, '0'),
    'novo_lead'
  from pg_temp._opp o;

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
  select
    o.lead_link_id,
    o.org_id,
    o.store_id,
    o.lead_id,
    o.customer_id,
    'active',
    'system',
    'system',
    jsonb_build_object('runner', 'p9_priority', 'case', o.key)
  from pg_temp._opp o;

  insert into public.conversations (
    id,
    organization_id,
    lead_id,
    status,
    is_human_active
  )
  select o.conversation_id, o.org_id, o.lead_id, 'active', false
  from pg_temp._opp o;

  insert into public.conversation_sessions (
    id,
    organization_id,
    store_id,
    conversation_id,
    status
  )
  select o.session_id, o.org_id, o.store_id, o.conversation_id, 'active'
  from pg_temp._opp o;

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
  select
    o.id,
    o.org_id,
    o.store_id,
    o.customer_id,
    o.lead_id,
    o.conversation_id,
    o.stage,
    o.cycle,
    c.as_of - interval '7 days',
    c.as_of - interval '7 days'
  from pg_temp._opp o;

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
  select
    o.context_id,
    o.org_id,
    o.store_id,
    o.session_id,
    o.customer_id,
    o.id,
    o.lead_link_id,
    'active',
    'system',
    'system',
    jsonb_build_object('runner', 'p9_priority', 'case', o.key)
  from pg_temp._opp o;
end;
$setup$;

create or replace function pg_temp._priority(p_key text)
returns jsonb
language plpgsql
as $function$
declare
  c pg_temp._ctx%rowtype;
  o pg_temp._opp%rowtype;
  r jsonb;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict o from pg_temp._opp where key = p_key;

  select to_jsonb(priority_row)
  into r
  from public.p9_resolve_commercial_opportunity_priority_internal(
    o.org_id,
    o.store_id,
    o.id,
    c.as_of
  ) priority_row;

  return r;
end;
$function$;

create or replace function pg_temp._reader(
  p_user_id uuid,
  p_org_id uuid,
  p_store_id uuid
)
returns jsonb
language plpgsql
as $function$
declare
  r jsonb;
  v_as_of timestamptz;
begin
  select as_of into strict v_as_of from pg_temp._ctx;

  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_user_id::text)::text,
    true
  );

  execute 'set local role authenticated';

  select coalesce(jsonb_agg(to_jsonb(row_item) order by row_item.commercial_opportunity_id), '[]'::jsonb)
  into r
  from public.panel_list_commercial_opportunity_priority_scoped(
    p_org_id,
    p_store_id,
    200,
    0,
    v_as_of
  ) row_item;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  return r;
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
    raise;
end;
$function$;

create or replace function pg_temp._first_reader_id(
  p_user_id uuid,
  p_org_id uuid,
  p_store_id uuid,
  p_ids uuid[]
)
returns uuid
language plpgsql
as $function$
declare
  r uuid;
  v_as_of timestamptz;
begin
  select as_of into strict v_as_of from pg_temp._ctx;

  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_user_id::text)::text,
    true
  );

  execute 'set local role authenticated';

  select row_item.commercial_opportunity_id
  into r
  from public.panel_list_commercial_opportunity_priority_scoped(
    p_org_id,
    p_store_id,
    200,
    0,
    v_as_of
  ) row_item
  where row_item.commercial_opportunity_id = any(p_ids)
  limit 1;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  return r;
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
    raise;
end;
$function$;

-- 1. normal no signals base
do $s$
declare r jsonb;
begin
  r := pg_temp._priority('base');
  perform pg_temp._record(1, 'normal no signals base', r->>'priority_band' = 'low' and coalesce(jsonb_array_length(r->'reason_codes'), 0) = 1 and (r->'reason_codes') ? 'current_quote_unknown', r::text);
exception when others then perform pg_temp._record_error(1, 'normal no signals base', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 2. customer waiting raises
do $s$
declare o pg_temp._opp%rowtype; r jsonb; ignored record;
begin
  select * into strict o from pg_temp._opp where key = 'waiting';
  select * into ignored from public.insert_message(o.conversation_id, 'ai', 'outgoing', 'text', 'answer before inbound', 'p9-priority-out-' || o.id::text, null, '{}'::jsonb);
  update public.messages set created_at = (select as_of from pg_temp._ctx) - interval '2 minutes' where id = ignored.id;
  perform pg_sleep(0.01);
  select * into ignored from public.insert_message(o.conversation_id, 'user', 'incoming', 'text', 'new inbound', 'p9-priority-in-' || o.id::text, null, '{}'::jsonb);
  update public.messages set created_at = (select as_of from pg_temp._ctx) - interval '1 minute' where id = ignored.id;
  r := pg_temp._priority('waiting');
  perform pg_temp._record(2, 'customer waiting raises', r->>'priority_band' = 'high' and (r->>'has_customer_waiting')::boolean and (r->'reason_codes') ? 'customer_waiting', r::text);
exception when others then perform pg_temp._record_error(2, 'customer waiting raises', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 3. waiting_customer_response task is not customer waiting
do $s$
declare c pg_temp._ctx%rowtype; o pg_temp._opp%rowtype; r jsonb;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict o from pg_temp._opp where key = 'waiting_task';
  insert into public.store_assistant_operational_tasks (
    id, organization_id, store_id, task_type, status, priority, title,
    description, customer_name, target_start_at, timezone_name, task_payload,
    commercial_opportunity_id
  )
  values (
    gen_random_uuid(), o.org_id, o.store_id, 'commercial_followup',
    'waiting_customer_response', 'normal', 'Waiting response task',
    'Runner task', 'P9 Priority', c.as_of - interval '1 hour',
    'America/Sao_Paulo', '{}'::jsonb, o.id
  );
  r := pg_temp._priority('waiting_task');
  perform pg_temp._record(3, 'waiting_customer_response task is not customer waiting', (r->>'has_customer_waiting')::boolean is false and (r->>'has_operational_blocker')::boolean and r->>'priority_band' = 'normal', r::text);
exception when others then perform pg_temp._record_error(3, 'waiting_customer_response task is not customer waiting', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 4. urgent task same opportunity is urgent
do $s$
declare c pg_temp._ctx%rowtype; o pg_temp._opp%rowtype; r jsonb;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict o from pg_temp._opp where key = 'urgent_task';
  insert into public.store_assistant_operational_tasks (
    id, organization_id, store_id, task_type, status, priority, title,
    description, customer_name, target_start_at, timezone_name, task_payload,
    commercial_opportunity_id
  )
  values (
    gen_random_uuid(), o.org_id, o.store_id, 'commercial_quote_request',
    'open', 'urgent', 'Urgent task', 'Runner task', 'P9 Priority',
    c.as_of - interval '2 hours', 'America/Sao_Paulo', '{}'::jsonb, o.id
  );
  r := pg_temp._priority('urgent_task');
  perform pg_temp._record(4, 'urgent task same opportunity is urgent', r->>'priority_band' = 'urgent' and r->>'highest_operational_task_priority' = 'urgent' and (r->'reason_codes') ? 'operational_task_urgent', r::text);
exception when others then perform pg_temp._record_error(4, 'urgent task same opportunity is urgent', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 5. other opportunity task ignored
do $s$
declare c pg_temp._ctx%rowtype; target_o pg_temp._opp%rowtype; other_o pg_temp._opp%rowtype; r jsonb;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict target_o from pg_temp._opp where key = 'other_task';
  select * into strict other_o from pg_temp._opp where key = 'urgent_task';
  insert into public.store_assistant_operational_tasks (
    id, organization_id, store_id, task_type, status, priority, title,
    description, customer_name, target_start_at, timezone_name, task_payload,
    commercial_opportunity_id
  )
  values (
    gen_random_uuid(), target_o.org_id, target_o.store_id, 'commercial_quote_request',
    'open', 'urgent', 'Ignored task', 'Runner task', 'P9 Priority',
    c.as_of - interval '3 hours', 'America/Sao_Paulo', '{}'::jsonb, other_o.id
  );
  r := pg_temp._priority('other_task');
  perform pg_temp._record(5, 'other opportunity task ignored', (r->>'has_operational_blocker')::boolean is false and r->>'priority_band' = 'low', r::text);
exception when others then perform pg_temp._record_error(5, 'other opportunity task ignored', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 6. overdue current lifecycle commitment is urgent
do $s$
declare c pg_temp._ctx%rowtype; o pg_temp._opp%rowtype; r jsonb;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict o from pg_temp._opp where key = 'overdue_commitment';
  insert into public.store_appointments (
    id, organization_id, store_id, title, appointment_type, status,
    scheduled_start, scheduled_end, customer_name, source,
    commercial_opportunity_id, commercial_opportunity_lifecycle_cycle
  )
  values (
    gen_random_uuid(), o.org_id, o.store_id, 'Overdue visit',
    'technical_visit', 'scheduled', c.as_of - interval '1 hour',
    c.as_of, 'P9 Priority', 'system', o.id, o.cycle
  );
  r := pg_temp._priority('overdue_commitment');
  perform pg_temp._record(6, 'overdue current lifecycle commitment is urgent', r->>'priority_band' = 'urgent' and (r->>'has_overdue_commitment')::boolean and (r->'reason_codes') ? 'overdue_commitment', r::text);
exception when others then perform pg_temp._record_error(6, 'overdue current lifecycle commitment is urgent', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 7. old lifecycle commitment ignored
do $s$
declare c pg_temp._ctx%rowtype; o pg_temp._opp%rowtype; r jsonb; evidence public.messages; current_cycle integer;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict o from pg_temp._opp where key = 'old_cycle_commitment';
  insert into public.store_appointments (
    id, organization_id, store_id, title, appointment_type, status,
    scheduled_start, scheduled_end, customer_name, source,
    commercial_opportunity_id, commercial_opportunity_lifecycle_cycle
  )
  values (
    gen_random_uuid(), o.org_id, o.store_id, 'Old cycle visit',
    'technical_visit', 'scheduled', c.as_of - interval '1 hour',
    c.as_of, 'P9 Priority', 'system', o.id, o.cycle
  );

  select * into evidence
  from public.insert_message(
    o.conversation_id,
    'user',
    'incoming',
    'text',
    'loss evidence before canonical reopen',
    'p9-priority-old-cycle-loss-' || o.id::text,
    null,
    '{}'::jsonb
  );

  perform 1
  from public.mark_commercial_opportunity_lost_by_system(
    o.org_id,
    o.store_id,
    o.id,
    'p9-priority-old-cycle-loss:' || o.id::text,
    'explicit_refusal',
    evidence.id,
    'P9 5.4 historical commitment runner evidence',
    'system',
    'p9_priority_runner_old_cycle'
  );

  perform 1
  from public.reopen_commercial_opportunity_by_system(
    o.org_id,
    o.store_id,
    o.id,
    'p9-priority-old-cycle-reopen:' || o.id::text,
    'qualificacao',
    'P9 5.4 historical commitment reopen',
    'p9_priority_runner_old_cycle'
  );

  select lifecycle_cycle into strict current_cycle
  from public.commercial_opportunities
  where id = o.id;

  r := pg_temp._priority('old_cycle_commitment');
  perform pg_temp._record(7, 'old lifecycle commitment ignored', current_cycle = 2 and (r->>'has_overdue_commitment')::boolean is false and r->>'priority_band' = 'low', r::text);
exception when others then perform pg_temp._record_error(7, 'old lifecycle commitment ignored', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 8. future commitment as proximity
do $s$
declare c pg_temp._ctx%rowtype; o pg_temp._opp%rowtype; r jsonb;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict o from pg_temp._opp where key = 'future_commitment';
  insert into public.store_appointments (
    id, organization_id, store_id, title, appointment_type, status,
    scheduled_start, scheduled_end, customer_name, source,
    commercial_opportunity_id, commercial_opportunity_lifecycle_cycle
  )
  values (
    gen_random_uuid(), o.org_id, o.store_id, 'Future visit',
    'technical_visit', 'rescheduled', c.as_of + interval '2 hours',
    c.as_of + interval '3 hours', 'P9 Priority', 'system',
    o.id, o.cycle
  );
  r := pg_temp._priority('future_commitment');
  perform pg_temp._record(8, 'future commitment as proximity', r->>'priority_band' = 'normal' and r->>'next_commitment_at' is not null and (r->'reason_codes') ? 'next_commitment', r::text);
exception when others then perform pg_temp._record_error(8, 'future commitment as proximity', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 9. active due followup
do $s$
declare c pg_temp._ctx%rowtype; o pg_temp._opp%rowtype; r jsonb;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict o from pg_temp._opp where key = 'due_followup';
  insert into public.commercial_opportunity_followups (
    id, organization_id, store_id, commercial_opportunity_id, cycle,
    status, started_at, attempt_count, cadence_interval_minutes, next_action,
    next_action_at, created_at, updated_at
  )
  values (
    gen_random_uuid(), o.org_id, o.store_id, o.id, o.cycle + 1, 'active',
    c.as_of - interval '1 day', 0, 30, 'follow_up',
    c.as_of - interval '5 minutes', c.as_of - interval '1 day',
    c.as_of - interval '1 day'
  );
  r := pg_temp._priority('due_followup');
  perform pg_temp._record(9, 'active due followup', r->>'priority_band' = 'high' and (r->>'has_due_followup')::boolean and (r->>'followup_cycle')::integer = o.cycle + 1 and (r->'reason_codes') ? 'due_followup', r::text);
exception when others then perform pg_temp._record_error(9, 'active due followup', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 10. terminal/historical followup not pending
do $s$
declare
  c pg_temp._ctx%rowtype;
  o pg_temp._opp%rowtype;
  r jsonb;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict o
  from pg_temp._opp
  where key = 'terminal_followup';

  insert into public.commercial_opportunity_followups (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    cycle,
    status,
    started_at,
    attempt_count,
    resolved_at,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    o.org_id,
    o.store_id,
    o.id,
    o.cycle,
    'resolved',
    c.as_of - interval '1 day',
    0,
    c.as_of - interval '30 minutes',
    c.as_of - interval '1 day',
    c.as_of - interval '30 minutes'
  );

  r := pg_temp._priority('terminal_followup');

  perform pg_temp._record(
    10,
    'terminal/historical followup not pending',
    (r->>'has_due_followup')::boolean is false
      and r->>'followup_id' is null
      and r->>'priority_band' = 'low',
    r::text
  );
exception
  when others then
    perform pg_temp._record_error(
      10,
      'terminal/historical followup not pending',
      sqlstate || ' ' || sqlerrm
    );
end;
$s$;
-- 11. current quote canonical total
do $s$
declare c pg_temp._ctx%rowtype; o pg_temp._opp%rowtype; q uuid := gen_random_uuid(); v uuid := gen_random_uuid(); r jsonb;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict o from pg_temp._opp where key = 'quote_current';
  insert into public.sales_quotes (
    id, organization_id, store_id, commercial_opportunity_id, quote_number,
    title, status, customer_name, subtotal_cents, discount_cents, total_cents,
    current_version_id, metadata
  )
  values (q, o.org_id, o.store_id, o.id, 'QP-' || replace(q::text, '-', ''), 'Current quote', 'sent', 'P9 Priority', 12000, 0, 12000, null, '{}'::jsonb);
  insert into public.sales_quote_versions (
    id, quote_id, organization_id, store_id, version_number, status,
    storage_bucket, storage_path, original_filename, mime_type, size_bytes,
    quote_snapshot, created_at, sent_at
  )
  values (v, q, o.org_id, o.store_id, 1, 'sent', 'runner', 'quotes/current.pdf', 'current.pdf', 'application/pdf', 100, '{}'::jsonb, c.as_of, c.as_of);
  update public.sales_quotes set current_version_id = v where id = q;
  update public.commercial_opportunities set current_quote_id = q, current_quote_version_id = v where id = o.id;
  r := pg_temp._priority('quote_current');
  perform pg_temp._record(11, 'current quote canonical total', (r->>'current_quote_total_cents')::bigint = 12000 and (r->'reason_codes') ? 'current_quote_authority_valid', r::text);
exception when others then perform pg_temp._record_error(11, 'current quote canonical total', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 12. explicit current proposal survives newer internal generated version
do $s$
declare
  c pg_temp._ctx%rowtype;
  o pg_temp._opp%rowtype;
  q uuid := gen_random_uuid();
  v1 uuid := gen_random_uuid();
  v2 uuid := gen_random_uuid();
  r jsonb;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict o
  from pg_temp._opp
  where key = 'quote_non_current';

  insert into public.sales_quotes (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    quote_number,
    title,
    status,
    customer_name,
    subtotal_cents,
    discount_cents,
    total_cents,
    current_version_id,
    metadata
  )
  values (
    q,
    o.org_id,
    o.store_id,
    o.id,
    'QN-' || replace(q::text, '-', ''),
    'Explicit current proposal',
    'draft',
    'P9 Priority',
    99000,
    0,
    99000,
    null,
    '{}'::jsonb
  );

  insert into public.sales_quote_versions (
    id,
    quote_id,
    organization_id,
    store_id,
    version_number,
    status,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    quote_snapshot,
    created_at,
    sent_at
  )
  values
    (
      v1,
      q,
      o.org_id,
      o.store_id,
      1,
      'superseded',
      'runner',
      'quotes/current-proposal-v1.pdf',
      'current-proposal-v1.pdf',
      'application/pdf',
      100,
      '{}'::jsonb,
      c.as_of - interval '1 day',
      c.as_of - interval '1 day'
    ),
    (
      v2,
      q,
      o.org_id,
      o.store_id,
      2,
      'generated',
      'runner',
      'quotes/internal-generated-v2.pdf',
      'internal-generated-v2.pdf',
      'application/pdf',
      100,
      '{}'::jsonb,
      c.as_of,
      null
    );

  update public.sales_quotes
  set current_version_id = v2
  where id = q;

  update public.commercial_opportunities
  set
    current_quote_id = q,
    current_quote_version_id = v1
  where id = o.id;

  r := pg_temp._priority('quote_non_current');

  perform pg_temp._record(
    12,
    'explicit current proposal survives newer internal generated version',
    (r->>'current_quote_total_cents')::bigint = 99000
      and r->>'current_quote_id' = q::text
      and r->>'current_quote_version_id' = v1::text
      and (r->'reason_codes') ? 'current_quote_authority_valid',
    r::text
  );
exception
  when others then
    perform pg_temp._record_error(
      12,
      'explicit current proposal survives newer internal generated version',
      sqlstate || ' ' || sqlerrm
    );
end;
$s$;
-- 13. no current quote is null, not zero
do $s$
declare r jsonb;
begin
  r := pg_temp._priority('quote_none');
  perform pg_temp._record(13, 'no current quote is null not zero', r->>'current_quote_total_cents' is null and (r->'reason_codes') ? 'current_quote_unknown', r::text);
exception when others then perform pg_temp._record_error(13, 'no current quote is null not zero', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 14. same urgency ordered by canonical impact
do $s$
declare c pg_temp._ctx%rowtype; hi pg_temp._opp%rowtype; lo pg_temp._opp%rowtype; qh uuid := gen_random_uuid(); ql uuid := gen_random_uuid(); vh uuid := gen_random_uuid(); vl uuid := gen_random_uuid(); first_id uuid;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict hi from pg_temp._opp where key = 'impact_high';
  select * into strict lo from pg_temp._opp where key = 'impact_low';
  insert into public.sales_quotes (id, organization_id, store_id, commercial_opportunity_id, quote_number, title, status, customer_name, subtotal_cents, discount_cents, total_cents, current_version_id, metadata)
  values
    (qh, hi.org_id, hi.store_id, hi.id, 'QH-' || replace(qh::text, '-', ''), 'High impact', 'sent', 'P9 Priority', 50000, 0, 50000, null, '{}'::jsonb),
    (ql, lo.org_id, lo.store_id, lo.id, 'QL-' || replace(ql::text, '-', ''), 'Low impact', 'sent', 'P9 Priority', 10000, 0, 10000, null, '{}'::jsonb);
  insert into public.sales_quote_versions (id, quote_id, organization_id, store_id, version_number, status, storage_bucket, storage_path, original_filename, mime_type, size_bytes, quote_snapshot, created_at, sent_at)
  values
    (vh, qh, hi.org_id, hi.store_id, 1, 'sent', 'runner', 'quotes/high.pdf', 'high.pdf', 'application/pdf', 100, '{}'::jsonb, c.as_of, c.as_of),
    (vl, ql, lo.org_id, lo.store_id, 1, 'sent', 'runner', 'quotes/low.pdf', 'low.pdf', 'application/pdf', 100, '{}'::jsonb, c.as_of, c.as_of);
  update public.sales_quotes set current_version_id = vh where id = qh;
  update public.sales_quotes set current_version_id = vl where id = ql;
  update public.commercial_opportunities set current_quote_id = qh, current_quote_version_id = vh where id = hi.id;
  update public.commercial_opportunities set current_quote_id = ql, current_quote_version_id = vl where id = lo.id;
  first_id := pg_temp._first_reader_id(c.user_a, c.org_a, c.store_a, array[hi.id, lo.id]);
  perform pg_temp._record(14, 'same urgency ordered by canonical impact', first_id = hi.id, 'first=' || coalesce(first_id::text, '<null>'));
exception when others then perform pg_temp._record_error(14, 'same urgency ordered by canonical impact', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 15. stable tie order
do $s$
declare a pg_temp._opp%rowtype; b pg_temp._opp%rowtype; expected uuid; first_id uuid; c pg_temp._ctx%rowtype;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict a from pg_temp._opp where key = 'stable_a';
  select * into strict b from pg_temp._opp where key = 'stable_b';
  expected := least(a.id, b.id);
  first_id := pg_temp._first_reader_id(c.user_a, c.org_a, c.store_a, array[a.id, b.id]);
  perform pg_temp._record(15, 'stable tie order', first_id = expected, format('expected=%s first=%s', expected, first_id));
exception when others then perform pg_temp._record_error(15, 'stable tie order', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 16. terminal opportunity not normal active priority
do $s$
declare c pg_temp._ctx%rowtype; o pg_temp._opp%rowtype; r jsonb; reader jsonb; evidence public.messages;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict o from pg_temp._opp where key = 'terminal';
  select *
  into evidence
  from public.insert_message(
    o.conversation_id,
    'user',
    'incoming',
    'text',
    'explicit refusal for terminal priority scenario',
    'p9-priority-terminal-loss-' || o.id::text,
    null,
    '{}'::jsonb
  );

  perform 1
  from public.mark_commercial_opportunity_lost_by_system(
    o.org_id,
    o.store_id,
    o.id,
    'p9-priority-terminal-loss:' || o.id::text,
    'explicit_refusal',
    evidence.id,
    'P9 5.4 terminal priority runner evidence',
    'system',
    'p9_priority_runner_terminal'
  );

  r := pg_temp._priority('terminal');
  reader := pg_temp._reader(c.user_a, c.org_a, c.store_a);
  perform pg_temp._record(16, 'terminal opportunity not normal active priority', r->>'priority_band' = 'low' and (r->>'priority_rank')::integer = 0 and (r->'reason_codes') ? 'terminal_stage' and reader::text not like '%' || o.id::text || '%', r::text);
exception when others then perform pg_temp._record_error(16, 'terminal opportunity not normal active priority', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 17. cross-store/org isolation
do $s$
declare c pg_temp._ctx%rowtype; a pg_temp._opp%rowtype; b pg_temp._opp%rowtype; reader_a jsonb; reader_b jsonb; raises_cross_scope boolean := false;
begin
  select * into strict c from pg_temp._ctx;
  select * into strict a from pg_temp._opp where key = 'tenant_a';
  select * into strict b from pg_temp._opp where key = 'tenant_b';
  begin
    perform * from public.p9_resolve_commercial_opportunity_priority_internal(c.org_a, c.store_a, b.id, c.as_of);
  exception when foreign_key_violation then
    raises_cross_scope := true;
  end;
  reader_a := pg_temp._reader(c.user_a, c.org_a, c.store_a);
  reader_b := pg_temp._reader(c.user_b, c.org_b, c.store_b);
  perform pg_temp._record(17, 'cross-store/org isolation', raises_cross_scope and reader_a::text like '%' || a.id::text || '%' and reader_a::text not like '%' || b.id::text || '%' and reader_b::text like '%' || b.id::text || '%', format('a_has=%s b_has=%s', reader_a::text like '%' || a.id::text || '%', reader_b::text like '%' || b.id::text || '%'));
exception when others then perform pg_temp._record_error(17, 'cross-store/org isolation', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 18. ACL/security-definer contracts
do $s$
declare internal_oid oid; reader_oid oid;
begin
  internal_oid := 'public.p9_resolve_commercial_opportunity_priority_internal(uuid,uuid,uuid,timestamp with time zone)'::regprocedure;
  reader_oid := 'public.panel_list_commercial_opportunity_priority_scoped(uuid,uuid,integer,integer,timestamp with time zone)'::regprocedure;
  perform pg_temp._record(
    18,
    'ACL/security-definer contracts',
    not pg_catalog.has_function_privilege('anon', internal_oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', internal_oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', internal_oid, 'EXECUTE')
      and pg_catalog.has_function_privilege('authenticated', reader_oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', reader_oid, 'EXECUTE')
      and exists (
        select 1
        from pg_catalog.pg_proc proc
        where proc.oid = reader_oid
          and proc.prosecdef
      ),
    'internal_not_exposed; reader_security_definer'
  );
exception when others then perform pg_temp._record_error(18, 'ACL/security-definer contracts', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 19. reader uses same authority no duplicate formula
do $s$
declare def text;
begin
  select pg_catalog.lower(pg_catalog.pg_get_functiondef('public.panel_list_commercial_opportunity_priority_scoped(uuid,uuid,integer,integer,timestamp with time zone)'::regprocedure))
  into def;
  perform pg_temp._record(
    19,
    'reader uses same authority no duplicate formula',
    def like '%p9_resolve_commercial_opportunity_priority_internal%'
      and def like '%rank_critical desc%'
      and def like '%rank_attention desc%'
      and def not like '%store_assistant_operational_tasks%',
    def
  );
exception when others then perform pg_temp._record_error(19, 'reader uses same authority no duplicate formula', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 20. no Lost/stage/followup writers called
do $s$
declare internal_def text; reader_def text; stage_changes bigint;
begin
  select pg_catalog.lower(pg_catalog.pg_get_functiondef('public.p9_resolve_commercial_opportunity_priority_internal(uuid,uuid,uuid,timestamp with time zone)'::regprocedure))
  into internal_def;
  select pg_catalog.lower(pg_catalog.pg_get_functiondef('public.panel_list_commercial_opportunity_priority_scoped(uuid,uuid,integer,integer,timestamp with time zone)'::regprocedure))
  into reader_def;
  select count(*) into stage_changes
  from public.commercial_opportunities o
  join pg_temp._opp fixture on fixture.id = o.id
  where o.stage is distinct from fixture.stage
    and fixture.key <> 'terminal';
  perform pg_temp._record(
    20,
    'no Lost/stage/followup writers called',
    stage_changes = 0
      and internal_def not like '%update public.commercial_opportunities%'
      and internal_def not like '%insert into public.commercial_opportunity_followups%'
      and internal_def not like '%update public.commercial_opportunity_followups%'
      and internal_def not like '% set stage %'
      and internal_def not like '% stage = %'
      and reader_def not like '%update public.commercial_opportunities%'
      and reader_def not like '%insert into public.commercial_opportunity_followups%'
      and reader_def not like '%update public.commercial_opportunity_followups%',
    format('stage_changes=%s', stage_changes)
  );
exception when others then perform pg_temp._record_error(20, 'no Lost/stage/followup writers called', sqlstate || ' ' || sqlerrm); end;
$s$;

-- 21. reopened opportunity does not reuse unanchored old quote impact
do $s$
declare
  c pg_temp._ctx%rowtype;
  o pg_temp._opp%rowtype;
  q uuid := gen_random_uuid();
  v uuid := gen_random_uuid();
  r jsonb;
  evidence public.messages;
  current_cycle integer;
begin
  select * into strict c from pg_temp._ctx;

  select * into strict o
  from pg_temp._opp
  where key = 'quote_reopen_unanchored';

  insert into public.sales_quotes (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    quote_number,
    title,
    status,
    customer_name,
    subtotal_cents,
    discount_cents,
    total_cents,
    current_version_id,
    metadata
  )
  values (
    q,
    o.org_id,
    o.store_id,
    o.id,
    'QR-' || replace(q::text, '-', ''),
    'Old proposal before reopen',
    'sent',
    'P9 Priority',
    73000,
    0,
    73000,
    null,
    '{}'::jsonb
  );

  insert into public.sales_quote_versions (
    id,
    quote_id,
    organization_id,
    store_id,
    version_number,
    status,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    quote_snapshot,
    created_at,
    sent_at
  )
  values (
    v,
    q,
    o.org_id,
    o.store_id,
    1,
    'sent',
    'runner',
    'quotes/pre-reopen.pdf',
    'pre-reopen.pdf',
    'application/pdf',
    100,
    '{}'::jsonb,
    c.as_of - interval '2 days',
    c.as_of - interval '2 days'
  );

  update public.sales_quotes
  set current_version_id = v
  where id = q;

  update public.commercial_opportunities
  set
    current_quote_id = q,
    current_quote_version_id = v
  where id = o.id;

  select * into evidence
  from public.insert_message(
    o.conversation_id,
    'user',
    'incoming',
    'text',
    'loss evidence before quote-cycle reopen',
    'p9-priority-quote-reopen-loss-' || o.id::text,
    null,
    '{}'::jsonb
  );

  perform 1
  from public.mark_commercial_opportunity_lost_by_system(
    o.org_id,
    o.store_id,
    o.id,
    'p9-priority-quote-reopen-loss:' || o.id::text,
    'explicit_refusal',
    evidence.id,
    'P9 5.4 quote-cycle reopen evidence',
    'system',
    'p9_priority_runner_quote_reopen'
  );

  perform 1
  from public.reopen_commercial_opportunity_by_system(
    o.org_id,
    o.store_id,
    o.id,
    'p9-priority-quote-reopen:' || o.id::text,
    'orcamento',
    'P9 5.4 quote-cycle reopen',
    'p9_priority_runner_quote_reopen'
  );

  select lifecycle_cycle into strict current_cycle
  from public.commercial_opportunities
  where id = o.id;

  r := pg_temp._priority('quote_reopen_unanchored');

  perform pg_temp._record(
    21,
    'reopened opportunity ignores unanchored old quote impact',
    current_cycle = 2
      and r->>'current_quote_total_cents' is null
      and (r->'reason_codes') ? 'quote_current_proposal_cycle_unanchored',
    r::text
  );
exception
  when others then
    perform pg_temp._record_error(
      21,
      'reopened opportunity ignores unanchored old quote impact',
      sqlstate || ' ' || sqlerrm
    );
end;
$s$;

-- 22. deleted inbound message does not create customer waiting
do $s$
declare
  o pg_temp._opp%rowtype;
  outbound_message public.messages;
  inbound_message public.messages;
  r jsonb;
begin
  select * into strict o
  from pg_temp._opp
  where key = 'deleted_customer_message';

  select *
  into outbound_message
  from public.insert_message(
    o.conversation_id,
    'ai',
    'outgoing',
    'text',
    'valid outbound before deleted inbound',
    'p9-priority-deleted-out-' || o.id::text,
    null,
    '{}'::jsonb
  );

  update public.messages set created_at = (select as_of from pg_temp._ctx) - interval '2 minutes' where id = outbound_message.id;

  perform pg_sleep(0.01);

  select *
  into inbound_message
  from public.insert_message(
    o.conversation_id,
    'user',
    'incoming',
    'text',
    'deleted inbound must not create waiting',
    'p9-priority-deleted-in-' || o.id::text,
    null,
    '{}'::jsonb
  );

  update public.messages set created_at = (select as_of from pg_temp._ctx) - interval '1 minute' where id = inbound_message.id;

  update public.messages
  set deleted_at = pg_catalog.clock_timestamp()
  where id = inbound_message.id;

  r := pg_temp._priority('deleted_customer_message');

  perform pg_temp._record(
    22,
    'deleted inbound message does not create customer waiting',
    (r->>'has_customer_waiting')::boolean is false
      and r->>'last_customer_message_at' is null
      and r->>'last_outbound_message_at' is not null,
    r::text
  );
exception
  when others then
    perform pg_temp._record_error(
      22,
      'deleted inbound message does not create customer waiting',
      sqlstate || ' ' || sqlerrm
    );
end;
$s$;

-- 23. captured historical message remains attributed after context link becomes inactive
do $s$
declare
  o pg_temp._opp%rowtype;
  outbound_message public.messages;
  inbound_message public.messages;
  r jsonb;
  stored_context_id uuid;
  link_status text;
begin
  select * into strict o
  from pg_temp._opp
  where key = 'inactive_context_message';

  select *
  into outbound_message
  from public.insert_message(
    o.conversation_id,
    'ai',
    'outgoing',
    'text',
    'answer before historical customer message',
    'p9-priority-history-out-' || o.id::text,
    null,
    '{}'::jsonb
  );

  update public.messages set created_at = (select as_of from pg_temp._ctx) - interval '2 minutes' where id = outbound_message.id;

  perform pg_sleep(0.01);

  select *
  into inbound_message
  from public.insert_message(
    o.conversation_id,
    'user',
    'incoming',
    'text',
    'captured message must survive context deactivation',
    'p9-priority-history-in-' || o.id::text,
    null,
    '{}'::jsonb
  );

  update public.messages set created_at = (select as_of from pg_temp._ctx) - interval '1 minute' where id = inbound_message.id;

  stored_context_id := inbound_message.commercial_session_context_link_id;

  perform public.close_commercial_session_context_link(
    o.context_id,
    o.org_id,
    o.store_id,
    'system',
    null,
    'p9_priority_runner_history',
    'P9 5.4 runner historical context proof',
    jsonb_build_object('runner', 'p9_priority', 'scenario', 23),
    null
  );

  select status
  into strict link_status
  from public.commercial_session_context_links
  where id = o.context_id;

  r := pg_temp._priority('inactive_context_message');

  perform pg_temp._record(
    23,
    'captured historical message survives inactive context link',
    stored_context_id = o.context_id
      and link_status = 'inactive'
      and (r->>'has_customer_waiting')::boolean
      and r->>'last_customer_message_at' is not null
      and (r->'reason_codes') ? 'customer_waiting',
    r::text
  );
exception
  when others then
    perform pg_temp._record_error(
      23,
      'captured historical message survives inactive context link',
      sqlstate || ' ' || sqlerrm
    );
end;
$s$;
select
  result_row.scenario_number,
  result_row.scenario_name,
  result_row.status,
  result_row.detail,
  count(*) filter (where result_row.status = 'PASS') over () as passed,
  count(*) filter (where result_row.status = 'SUT_FAIL') over () as sut_failed,
  count(*) filter (where result_row.status = 'HARNESS_ERROR') over () as harness_errors,
  count(*) over () as total
from pg_temp._p9_priority_results result_row
order by result_row.scenario_number;

rollback;
