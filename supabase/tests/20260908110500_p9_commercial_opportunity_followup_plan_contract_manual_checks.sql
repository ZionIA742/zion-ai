begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_followup_51_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_followup_51_matrix (
  scenario_number integer primary key,
  scenario_name text not null
) on commit preserve rows;

insert into pg_temp._p9_followup_51_matrix (scenario_number, scenario_name)
values
  (1, 'criacao de plano completo'),
  (2, 'reason_code persistido'),
  (3, 'reason_details persistido'),
  (4, 'context persistido'),
  (5, 'cadence persistida'),
  (6, 'next_action persistida'),
  (7, 'next_action_at persistido'),
  (8, 'oportunidade exata'),
  (9, 'tenant isolation em leitura por rls'),
  (10, 'store mismatch fail closed'),
  (11, 'opportunity de outro tenant fail closed'),
  (12, 'cadence zero invalida'),
  (13, 'cadence negativa invalida'),
  (14, 'payload obrigatorio invalido'),
  (15, 'operation_key vazio invalido'),
  (16, 'replay idempotente'),
  (17, 'replay incompativel fail closed'),
  (18, 'apenas um active por opportunity'),
  (19, 'duas opportunities independentes com planos distintos'),
  (20, 'eventos append-only'),
  (21, 'evento contem snapshot suficiente do plano'),
  (22, 'tentativa afeta apenas o follow-up correto'),
  (23, 'resolve continua correto'),
  (24, 'cancel continua correto'),
  (25, 'sem dependencia dos rpcs legados panel'),
  (26, 'sem implementar exhaustion opt-out priority');

create temp table pg_temp._p9_followup_51_ctx (
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
  opp_main uuid not null,
  opp_peer uuid not null,
  opp_attempt uuid not null,
  opp_resolve uuid not null,
  opp_cancel uuid not null,
  opp_zero uuid not null,
  opp_negative uuid not null,
  opp_payload uuid not null,
  opp_empty_key uuid not null,
  opp_event uuid not null,
  opp_other_store uuid not null,
  opp_other_tenant uuid not null,
  next_action_at timestamptz not null
) on commit preserve rows;

insert into pg_temp._p9_followup_51_ctx (
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
  opp_main,
  opp_peer,
  opp_attempt,
  opp_resolve,
  opp_cancel,
  opp_zero,
  opp_negative,
  opp_payload,
  opp_empty_key,
  opp_event,
  opp_other_store,
  opp_other_tenant,
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
  gen_random_uuid(),
  gen_random_uuid(),
  '2099-01-01 12:00:00+00'::timestamptz
);

create or replace function pg_temp._p9_followup_51_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_followup_51_results (
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

create or replace function pg_temp._p9_followup_51_exec(
  p_role text,
  p_user_id uuid,
  p_sql text
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
  v_ok boolean := false;
begin
  if p_role not in ('postgres', 'authenticated', 'anon', 'service_role') then
    return query
    select false, null::text, 'P0001'::text, 'unsupported role'::text, null::text;
    return;
  end if;

  if p_role <> 'postgres' then
    perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
    perform set_config('request.jwt.claim.role', p_role, true);
    perform set_config(
      'request.jwt.claims',
      case
        when p_user_id is null
          then jsonb_build_object('role', p_role)::text
        else jsonb_build_object('role', p_role, 'sub', p_user_id::text)::text
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
        v_message = message_text,
        v_constraint = constraint_name;
      v_ok := false;
  end;

  begin
    execute 'reset role';
  exception
    when others then
      null;
  end;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  return query
  select
    v_ok,
    case when v_ok then v_value else null::text end,
    v_state,
    v_message,
    v_constraint;
end;
$function$;

create or replace function pg_temp._p9_followup_51_activate_sql(
  p_org uuid,
  p_store uuid,
  p_opp uuid,
  p_operation_key text,
  p_reason_code text,
  p_reason_details text,
  p_context text,
  p_cadence text,
  p_next_action text,
  p_next_action_at timestamptz
)
returns text
language sql
as $function$
  select format(
    $sql$
      select row_to_json(public.activate_commercial_opportunity_followup_plan_by_user(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L,
        %L,
        %L,
        %L::jsonb,
        %s,
        %L,
        %L::timestamptz
      ))::text
    $sql$,
    p_org::text,
    p_store::text,
    p_opp::text,
    p_operation_key,
    p_reason_code,
    p_reason_details,
    p_context,
    p_cadence,
    p_next_action,
    p_next_action_at::text
  );
$function$;

revoke all on function pg_temp._p9_followup_51_record(integer, text, text, text) from public;
revoke all on function pg_temp._p9_followup_51_exec(text, uuid, text) from public;
revoke all on function pg_temp._p9_followup_51_activate_sql(uuid, uuid, uuid, text, text, text, text, text, text, timestamptz) from public;

do $setup$
declare
  v pg_temp._p9_followup_51_ctx;
begin
  select * into strict v from pg_temp._p9_followup_51_ctx;

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
      'runner-followup-51-a-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('runner', true, 'key', 'followup-51-a'),
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
      'runner-followup-51-b-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('runner', true, 'key', 'followup-51-b'),
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
    (v.org_a, 'Runner Followup 5.1 Org A ' || v.run_id::text),
    (v.org_b, 'Runner Followup 5.1 Org B ' || v.run_id::text);

  insert into public.stores (id, organization_id, name)
  values
    (v.store_a, v.org_a, 'Runner Followup 5.1 Store A ' || v.run_id::text),
    (v.store_a2, v.org_a, 'Runner Followup 5.1 Store A2 ' || v.run_id::text),
    (v.store_b, v.org_b, 'Runner Followup 5.1 Store B ' || v.run_id::text);

  insert into public.memberships (organization_id, user_id, role)
  values
    (v.org_a, v.user_a, 'owner'),
    (v.org_b, v.user_b, 'owner');

  insert into public.customers (id, organization_id, display_name)
  values
    (v.customer_a, v.org_a, 'Runner Followup 5.1 Customer A'),
    (v.customer_b, v.org_b, 'Runner Followup 5.1 Customer B');

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  values
    (v.org_a, v.store_a, v.customer_a),
    (v.org_a, v.store_a2, v.customer_a),
    (v.org_b, v.store_b, v.customer_b);

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
    (v.opp_main, v.org_a, v.store_a, v.customer_a, null, null, 'orcamento', 1, now(), now()),
    (v.opp_peer, v.org_a, v.store_a, v.customer_a, null, null, 'orcamento', 1, now(), now()),
    (v.opp_attempt, v.org_a, v.store_a, v.customer_a, null, null, 'orcamento', 1, now(), now()),
    (v.opp_resolve, v.org_a, v.store_a, v.customer_a, null, null, 'orcamento', 1, now(), now()),
    (v.opp_cancel, v.org_a, v.store_a, v.customer_a, null, null, 'orcamento', 1, now(), now()),
    (v.opp_zero, v.org_a, v.store_a, v.customer_a, null, null, 'orcamento', 1, now(), now()),
    (v.opp_negative, v.org_a, v.store_a, v.customer_a, null, null, 'orcamento', 1, now(), now()),
    (v.opp_payload, v.org_a, v.store_a, v.customer_a, null, null, 'orcamento', 1, now(), now()),
    (v.opp_empty_key, v.org_a, v.store_a, v.customer_a, null, null, 'orcamento', 1, now(), now()),
    (v.opp_event, v.org_a, v.store_a, v.customer_a, null, null, 'orcamento', 1, now(), now()),
    (v.opp_other_store, v.org_a, v.store_a2, v.customer_a, null, null, 'orcamento', 1, now(), now()),
    (v.opp_other_tenant, v.org_b, v.store_b, v.customer_b, null, null, 'orcamento', 1, now(), now());
end;
$setup$;

do $scenarios$
declare
  v pg_temp._p9_followup_51_ctx;
  v_exec record;
  v_retry record;
  v_followup jsonb;
  v_before bigint;
  v_after bigint;
  v_event jsonb;
  v_update_blocked boolean;
  v_delete_blocked boolean;
begin
  select * into strict v from pg_temp._p9_followup_51_ctx;

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a,
      v.store_a,
      v.opp_main,
      'plan-main-1',
      'customer_requested_return',
      'Cliente pediu retorno com detalhes de pagamento.',
      '{"source":"manual_check","customer_intent":"budget_review"}',
      '1440',
      'send_payment_conditions',
      v.next_action_at
    )
  );
  v_followup := v_exec.value_text::jsonb;

  perform pg_temp._p9_followup_51_record(
    1,
    'criacao de plano completo',
    case when v_exec.operation_succeeded and v_followup ->> 'status' = 'active' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
  );

  perform pg_temp._p9_followup_51_record(
    2,
    'reason_code persistido',
    case when v_followup ->> 'reason_code' = 'customer_requested_return' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, '<null>')
  );

  perform pg_temp._p9_followup_51_record(
    3,
    'reason_details persistido',
    case when v_followup ->> 'reason_details' = 'Cliente pediu retorno com detalhes de pagamento.' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, '<null>')
  );

  perform pg_temp._p9_followup_51_record(
    4,
    'context persistido',
    case when v_followup -> 'context' = '{"source":"manual_check","customer_intent":"budget_review"}'::jsonb then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, '<null>')
  );

  perform pg_temp._p9_followup_51_record(
    5,
    'cadence persistida',
    case when v_followup ->> 'cadence_interval_minutes' = '1440' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, '<null>')
  );

  perform pg_temp._p9_followup_51_record(
    6,
    'next_action persistida',
    case when v_followup ->> 'next_action' = 'send_payment_conditions' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, '<null>')
  );

  perform pg_temp._p9_followup_51_record(
    7,
    'next_action_at persistido',
    case when (v_followup ->> 'next_action_at')::timestamptz = v.next_action_at then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, '<null>')
  );

  perform pg_temp._p9_followup_51_record(
    8,
    'oportunidade exata',
    case
      when v_followup ->> 'organization_id' = v.org_a::text
       and v_followup ->> 'store_id' = v.store_a::text
       and v_followup ->> 'commercial_opportunity_id' = v.opp_main::text
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(v_exec.value_text, '<null>')
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_b,
    pg_temp._p9_followup_51_activate_sql(
      v.org_b,
      v.store_b,
      v.opp_other_tenant,
      'plan-org-b-1',
      'separate_tenant_followup',
      'Tenant B own plan.',
      '{"source":"manual_check","tenant":"b"}',
      '60',
      'call_customer',
      v.next_action_at
    )
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    format(
      $$select count(*)::text from public.commercial_opportunity_followups where organization_id = %L::uuid$$,
      v.org_b::text
    )
  );
  perform pg_temp._p9_followup_51_record(
    9,
    'tenant isolation em leitura por rls',
    case when v_exec.operation_succeeded and v_exec.value_text = '0' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a,
      v.store_a2,
      v.opp_main,
      'store-mismatch-1',
      'wrong_store',
      null,
      '{"source":"manual_check"}',
      '60',
      'call_customer',
      v.next_action_at
    )
  );
  perform pg_temp._p9_followup_51_record(
    10,
    'store mismatch fail closed',
    case when not v_exec.operation_succeeded and v_exec.message_text = 'commercial opportunity not found' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<null>')
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a,
      v.store_a,
      v.opp_other_tenant,
      'wrong-tenant-1',
      'wrong_tenant',
      null,
      '{"source":"manual_check"}',
      '60',
      'call_customer',
      v.next_action_at
    )
  );
  perform pg_temp._p9_followup_51_record(
    11,
    'opportunity de outro tenant fail closed',
    case when not v_exec.operation_succeeded and v_exec.message_text = 'commercial opportunity not found' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<null>')
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a, v.store_a, v.opp_zero, 'cadence-zero-1', 'invalid_cadence', null, '{"source":"manual_check"}', '0', 'call_customer', v.next_action_at
    )
  );
  perform pg_temp._p9_followup_51_record(
    12,
    'cadence zero invalida',
    case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_CADENCE_REQUIRES_POSITIVE_INTERVAL' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<null>')
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a, v.store_a, v.opp_negative, 'cadence-negative-1', 'invalid_cadence', null, '{"source":"manual_check"}', '-15', 'call_customer', v.next_action_at
    )
  );
  perform pg_temp._p9_followup_51_record(
    13,
    'cadence negativa invalida',
    case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_CADENCE_REQUIRES_POSITIVE_INTERVAL' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<null>')
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a, v.store_a, v.opp_payload, 'payload-invalid-1', null, null, '{"source":"manual_check"}', '60', 'call_customer', v.next_action_at
    )
  );
  perform pg_temp._p9_followup_51_record(
    14,
    'payload obrigatorio invalido',
    case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_REASON_CODE_REQUIRED' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<null>')
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a, v.store_a, v.opp_empty_key, '   ', 'empty_key', null, '{"source":"manual_check"}', '60', 'call_customer', v.next_action_at
    )
  );
  perform pg_temp._p9_followup_51_record(
    15,
    'operation_key vazio invalido',
    case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_OPERATION_KEY_REQUIRED' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<null>')
  );

  select * into v_retry
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a,
      v.store_a,
      v.opp_main,
      'plan-main-1',
      'customer_requested_return',
      'Cliente pediu retorno com detalhes de pagamento.',
      '{"source":"manual_check","customer_intent":"budget_review"}',
      '1440',
      'send_payment_conditions',
      v.next_action_at
    )
  );
  perform pg_temp._p9_followup_51_record(
    16,
    'replay idempotente',
    case when v_retry.operation_succeeded and (v_retry.value_text::jsonb ->> 'id') = (v_followup ->> 'id') then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_retry.value_text, coalesce(v_retry.message_text, '<null>'))
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a,
      v.store_a,
      v.opp_main,
      'plan-main-1',
      'different_reason',
      'Cliente pediu retorno com detalhes de pagamento.',
      '{"source":"manual_check","customer_intent":"budget_review"}',
      '1440',
      'send_payment_conditions',
      v.next_action_at
    )
  );
  perform pg_temp._p9_followup_51_record(
    17,
    'replay incompativel fail closed',
    case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<null>')
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a, v.store_a, v.opp_main, 'plan-main-2', 'second_active', null, '{"source":"manual_check"}', '60', 'call_customer', v.next_action_at
    )
  );
  perform pg_temp._p9_followup_51_record(
    18,
    'apenas um active por opportunity',
    case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_ALREADY_ACTIVE' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<null>')
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a, v.store_a, v.opp_peer, 'plan-peer-1', 'peer_followup', null, '{"source":"manual_check","peer":true}', '30', 'send_photo_request', v.next_action_at
    )
  );
  perform pg_temp._p9_followup_51_record(
    19,
    'duas opportunities independentes com planos distintos',
    case
      when v_exec.operation_succeeded
       and (v_exec.value_text::jsonb ->> 'commercial_opportunity_id') = v.opp_peer::text
       and (v_exec.value_text::jsonb ->> 'next_action') = 'send_photo_request'
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
  );

  select count(*)
  into v_before
  from public.commercial_opportunity_followup_events
  where organization_id = v.org_a
    and store_id = v.store_a
    and commercial_opportunity_id = v.opp_event;

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a, v.store_a, v.opp_event, 'plan-event-1', 'event_snapshot', 'Evento deve conter snapshot.', '{"source":"manual_check","event":true}', '45', 'send_followup_message', v.next_action_at
    )
  );

  select to_jsonb(event_row)
  into v_event
  from public.commercial_opportunity_followup_events event_row
  where event_row.organization_id = v.org_a
    and event_row.store_id = v.store_a
    and event_row.commercial_opportunity_id = v.opp_event
    and event_row.operation_key = 'plan-event-1';

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'postgres',
    null,
    format(
      $$update public.commercial_opportunity_followup_events
        set reason_details = %L
        where id = %L::uuid
        returning id::text$$,
      'MUTATION_SHOULD_BE_BLOCKED',
      v_event ->> 'id'
    )
  );
  v_update_blocked := not v_exec.operation_succeeded;

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'postgres',
    null,
    format(
      $$delete from public.commercial_opportunity_followup_events
        where id = %L::uuid
        returning id::text$$,
      v_event ->> 'id'
    )
  );
  v_delete_blocked := not v_exec.operation_succeeded;

  select count(*)
  into v_after
  from public.commercial_opportunity_followup_events
  where organization_id = v.org_a
    and store_id = v.store_a
    and commercial_opportunity_id = v.opp_event;

  perform pg_temp._p9_followup_51_record(
    20,
    'eventos append-only',
    case
      when v_event is not null
       and v_update_blocked
       and v_delete_blocked
       and v_after = v_before + 1
        then 'PASS'
      else 'SUT_FAIL'
    end,
    'before=' || v_before::text
      || ', after=' || v_after::text
      || ', update_blocked=' || coalesce(v_update_blocked::text, 'null')
      || ', delete_blocked=' || coalesce(v_delete_blocked::text, 'null')
  );

  perform pg_temp._p9_followup_51_record(
    21,
    'evento contem snapshot suficiente do plano',
    case
      when v_event ->> 'event_type' = 'activated'
       and v_event ->> 'reason_code' = 'event_snapshot'
       and v_event #>> '{metadata,result_snapshot,reason_code}' = 'event_snapshot'
       and v_event #> '{metadata,result_snapshot,context}' = '{"source":"manual_check","event":true}'::jsonb
       and v_event #>> '{metadata,result_snapshot,cadence_interval_minutes}' = '45'
       and v_event #>> '{metadata,result_snapshot,next_action}' = 'send_followup_message'
       and (v_event #>> '{metadata,result_snapshot,next_action_at}')::timestamptz = v.next_action_at
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(v_event::text, '<null>')
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a, v.store_a, v.opp_attempt, 'plan-attempt-1', 'attempt_scope', null, '{"source":"manual_check"}', '60', 'call_customer', v.next_action_at
    )
  );
  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    format(
      $$select row_to_json(public.record_commercial_opportunity_followup_attempt_by_user(%L::uuid,%L::uuid,%L::uuid,%L))::text$$,
      v.org_a::text,
      v.store_a::text,
      v.opp_attempt::text,
      'attempt-scope-1'
    )
  );
  perform pg_temp._p9_followup_51_record(
    22,
    'tentativa afeta apenas o follow-up correto',
    case
      when v_exec.operation_succeeded
       and (select attempt_count from public.commercial_opportunity_followups where commercial_opportunity_id = v.opp_attempt and status = 'active') = 1
       and (select attempt_count from public.commercial_opportunity_followups where commercial_opportunity_id = v.opp_main and status = 'active') = 0
        then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a, v.store_a, v.opp_resolve, 'plan-resolve-1', 'resolve_scope', null, '{"source":"manual_check"}', '60', 'call_customer', v.next_action_at
    )
  );
  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    format(
      $$select row_to_json(public.resolve_commercial_opportunity_followup_by_user(%L::uuid,%L::uuid,%L::uuid,%L))::text$$,
      v.org_a::text,
      v.store_a::text,
      v.opp_resolve::text,
      'resolve-scope-1'
    )
  );
  perform pg_temp._p9_followup_51_record(
    23,
    'resolve continua correto',
    case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'status') = 'resolved' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    pg_temp._p9_followup_51_activate_sql(
      v.org_a, v.store_a, v.opp_cancel, 'plan-cancel-1', 'cancel_scope', null, '{"source":"manual_check"}', '60', 'call_customer', v.next_action_at
    )
  );
  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'authenticated',
    v.user_a,
    format(
      $$select row_to_json(public.cancel_commercial_opportunity_followup_by_user(%L::uuid,%L::uuid,%L::uuid,%L,%L,%L))::text$$,
      v.org_a::text,
      v.store_a::text,
      v.opp_cancel::text,
      'cancel-scope-1',
      'manual_cancel',
      'Cancelamento de teste.'
    )
  );
  perform pg_temp._p9_followup_51_record(
    24,
    'cancel continua correto',
    case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'status') = 'cancelled' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'postgres',
    null,
    $$
      select (
        pg_catalog.pg_get_functiondef(
          'public.activate_commercial_opportunity_followup_plan_by_user(uuid,uuid,uuid,text,text,text,jsonb,integer,text,timestamp with time zone)'::regprocedure
        ) not like '%panel_list_followup_candidates_scoped%'
        and pg_catalog.pg_get_functiondef(
          'public.activate_commercial_opportunity_followup_plan_by_user(uuid,uuid,uuid,text,text,text,jsonb,integer,text,timestamp with time zone)'::regprocedure
        ) not like '%panel_enqueue_followup_scoped%'
      )::text
    $$
  );
  perform pg_temp._p9_followup_51_record(
    25,
    'sem dependencia dos rpcs legados panel',
    case when v_exec.operation_succeeded and v_exec.value_text = 'true' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
  );

  select * into v_exec
  from pg_temp._p9_followup_51_exec(
    'postgres',
    null,
    $$
      select (
        pg_catalog.pg_get_functiondef(
          'public.activate_commercial_opportunity_followup_plan_by_user(uuid,uuid,uuid,text,text,text,jsonb,integer,text,timestamp with time zone)'::regprocedure
        ) not like '%follow_up_exhausted%'
        and pg_catalog.pg_get_functiondef(
          'public.activate_commercial_opportunity_followup_plan_by_user(uuid,uuid,uuid,text,text,text,jsonb,integer,text,timestamp with time zone)'::regprocedure
        ) not like '%p_priority%'
        and pg_catalog.pg_get_functiondef(
          'public.activate_commercial_opportunity_followup_plan_by_user(uuid,uuid,uuid,text,text,text,jsonb,integer,text,timestamp with time zone)'::regprocedure
        ) not like '% priority %'
      )::text
    $$
  );
  perform pg_temp._p9_followup_51_record(
    26,
    'sem implementar exhaustion opt-out priority',
    case when v_exec.operation_succeeded and v_exec.value_text = 'true' then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
  );
exception
  when others then
    perform pg_temp._p9_followup_51_record(1, 'runner harness', 'HARNESS_ERROR', sqlerrm);
end;
$scenarios$;

insert into pg_temp._p9_followup_51_results (
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
from pg_temp._p9_followup_51_matrix matrix
where not exists (
  select 1
  from pg_temp._p9_followup_51_results result
  where result.scenario_number = matrix.scenario_number
);

do $assertions$
declare
  v_failed_count integer;
  v_summary text;
begin
  select count(*)
  into v_failed_count
  from pg_temp._p9_followup_51_results
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
    from pg_temp._p9_followup_51_results
    where status <> 'PASS';

    raise exception using
      errcode = 'P0001',
      message = 'P9_FOLLOWUP_51_MANUAL_CHECK_FAILED',
      detail = v_summary;
  end if;
end;
$assertions$;

select *
from pg_temp._p9_followup_51_results
order by scenario_number;

rollback;
