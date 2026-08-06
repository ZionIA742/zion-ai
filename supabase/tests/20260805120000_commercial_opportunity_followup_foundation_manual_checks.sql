begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_followup_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_followup_matrix (
  scenario_number integer primary key,
  scenario_name text not null
) on commit preserve rows;

insert into pg_temp._p9_followup_matrix (
  scenario_number,
  scenario_name
)
values
  (1, 'ativacao inicial'),
  (2, 'repeticao idempotente da ativacao'),
  (3, 'retry da ativacao apos resolucao retorna snapshot original'),
  (4, 'conflito de operation_key'),
  (5, 'segunda ativacao enquanto existe ciclo ativo'),
  (6, 'registro de tentativa'),
  (7, 'repeticao idempotente da tentativa'),
  (8, 'retry da primeira tentativa apos novas tentativas retorna snapshot original'),
  (9, 'incremento correto de attempt_count'),
  (10, 'resolucao'),
  (11, 'retry idempotente de resolved retorna snapshot original'),
  (12, 'cancelamento'),
  (13, 'retry idempotente de cancelled retorna snapshot original'),
  (14, 'esgotamento pelo sistema'),
  (15, 'retry idempotente de exhausted retorna snapshot original'),
  (16, 'opt out com ciclo ativo'),
  (17, 'retry idempotente de opted_out retorna snapshot original'),
  (18, 'opt out sem ciclo ativo cria ciclo opted_out'),
  (19, 'novo ciclo depois de resolved'),
  (20, 'novo ciclo depois de cancelled'),
  (21, 'novo ciclo depois de exhausted'),
  (22, 'bloqueio de novo ciclo apos opt out'),
  (23, 'tentativa em ciclo encerrado'),
  (24, 'resolucao em ciclo encerrado'),
  (25, 'oportunidade de outra loja na mesma organizacao'),
  (26, 'oportunidade de outra organizacao'),
  (27, 'usuario sem membership'),
  (28, 'oportunidade inexistente'),
  (29, 'customer_scope_inconsistency'),
  (30, 'origin_lead_scope_inconsistency'),
  (31, 'primary_conversation_scope_inconsistency'),
  (32, 'nenhuma alteracao automatica de stage'),
  (33, 'um unico ciclo ativo por oportunidade'),
  (34, 'operation_key vazio ou espacos'),
  (35, 'operation_key acima de 200 caracteres'),
  (36, 'reason_code acima de 100 caracteres'),
  (37, 'reason_details acima de 2000 caracteres'),
  (38, 'anon sem execute'),
  (39, 'anon sem select'),
  (40, 'authenticated sem insert direto'),
  (41, 'authenticated sem update direto'),
  (42, 'authenticated sem delete direto'),
  (43, 'authenticated sem writer by_system'),
  (44, 'service_role sem writer by_user'),
  (45, 'service_role sem insert direto'),
  (46, 'service_role sem update direto'),
  (47, 'service_role sem delete direto'),
  (48, 'rls followups sem leitura cruzada entre organizacoes'),
  (49, 'update de evento bloqueado'),
  (50, 'delete de evento bloqueado'),
  (51, 'rollback automatico do subbloco do chamador'),
  (52, 'constraint exige result_snapshot'),
  (53, 'anon sem select em events'),
  (54, 'rls events sem leitura cruzada entre organizacoes'),
  (55, 'cancelamento com mesma operation_key e reason_code diferente conflita'),
  (56, 'cancelamento com mesma operation_key e reason_details diferente conflita'),
  (57, 'novo opt out com outra operation_key apos opt out registrado bloqueia'),
  (58, 'mesma operation_key em oportunidades diferentes e permitida'),
  (59, 'retry da mesma operation_key por outro usuario autorizado conflita'),
  (60, 'usuario sem membership e operation_key invalida retorna 42501');

create temp table pg_temp._p9_followup_ctx (
  singleton boolean primary key default true check (singleton),
  run_id uuid not null,
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_a2 uuid not null,
  store_b uuid not null,
  member_user_id uuid not null,
  member_user_a2_id uuid not null,
  member_user_b_id uuid not null,
  outsider_user_id uuid not null,
  customer_a uuid not null,
  customer_b uuid not null,
  customer_org_b uuid not null,
  customer_inconsistent uuid not null,
  lead_a uuid not null,
  lead_b uuid not null,
  lead_store_a2 uuid not null,
  lead_org_b uuid not null,
  lead_conversation_proof uuid not null,
  conversation_primary uuid not null,
  opp_activate_retry uuid not null,
  opp_resolve_cycle uuid not null,
  opp_cancel uuid not null,
  opp_exhaust uuid not null,
  opp_opt_out_active uuid not null,
  opp_opt_out_idle uuid not null,
  opp_same_org_other_store uuid not null,
  opp_other_org uuid not null,
  opp_rls_org_b uuid not null,
  opp_same_operation_key_peer uuid not null,
  opp_customer_inconsistent uuid not null,
  opp_origin_lead_inconsistent uuid not null,
  opp_primary_conversation_inconsistent uuid not null,
  opp_rollback uuid not null
) on commit preserve rows;

insert into pg_temp._p9_followup_ctx (
  run_id,
  org_a,
  org_b,
  store_a,
  store_a2,
  store_b,
  member_user_id,
  member_user_a2_id,
  member_user_b_id,
  outsider_user_id,
  customer_a,
  customer_b,
  customer_org_b,
  customer_inconsistent,
  lead_a,
  lead_b,
  lead_store_a2,
  lead_org_b,
  lead_conversation_proof,
  conversation_primary,
  opp_activate_retry,
  opp_resolve_cycle,
  opp_cancel,
  opp_exhaust,
  opp_opt_out_active,
  opp_opt_out_idle,
  opp_same_org_other_store,
  opp_other_org,
  opp_rls_org_b,
  opp_same_operation_key_peer,
  opp_customer_inconsistent,
  opp_origin_lead_inconsistent,
  opp_primary_conversation_inconsistent,
  opp_rollback
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
  gen_random_uuid()
);

create or replace function pg_temp._p9_followup_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_followup_results (
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

create or replace function pg_temp._p9_followup_exec(
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
  if p_role not in ('postgres', 'service_role', 'authenticated', 'anon') then
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

revoke all on function pg_temp._p9_followup_record(integer, text, text, text) from public;
revoke all on function pg_temp._p9_followup_exec(text, uuid, text) from public;

do $setup$
declare
  v pg_temp._p9_followup_ctx;
begin
  select * into strict v from pg_temp._p9_followup_ctx;

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
      v.member_user_id,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'runner-followup-member-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('runner', true, 'key', 'member'),
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
      v.outsider_user_id,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'runner-followup-outsider-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('runner', true, 'key', 'outsider'),
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
      v.member_user_a2_id,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'runner-followup-member-a2-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('runner', true, 'key', 'member-a2'),
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
      v.member_user_b_id,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'runner-followup-member-b-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('runner', true, 'key', 'member-b'),
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
    (v.org_a, 'Runner Followup Org A ' || v.run_id::text),
    (v.org_b, 'Runner Followup Org B ' || v.run_id::text);

  insert into public.stores (id, organization_id, name)
  values
    (v.store_a, v.org_a, 'Runner Followup Store A ' || v.run_id::text),
    (v.store_a2, v.org_a, 'Runner Followup Store A2 ' || v.run_id::text),
    (v.store_b, v.org_b, 'Runner Followup Store B ' || v.run_id::text);

  insert into public.memberships (organization_id, user_id, role)
  values
    (v.org_a, v.member_user_id, 'owner'),
    (v.org_a, v.member_user_a2_id, 'owner'),
    (v.org_b, v.member_user_b_id, 'owner');

  insert into public.customers (id, organization_id, display_name)
  values
    (v.customer_a, v.org_a, 'Runner Customer A'),
    (v.customer_b, v.org_a, 'Runner Customer B'),
    (v.customer_org_b, v.org_b, 'Runner Customer B Org'),
    (v.customer_inconsistent, v.org_a, 'Runner Customer Inconsistent');

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  values
    (v.org_a, v.store_a, v.customer_a),
    (v.org_a, v.store_a, v.customer_b),
    (v.org_a, v.store_a2, v.customer_b),
    (v.org_b, v.store_b, v.customer_org_b);

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
    (v.lead_a, v.org_a, v.store_a, 'Lead A', '+55000000001', 'orcamento', now(), now()),
    (v.lead_b, v.org_a, v.store_a, 'Lead B', '+55000000002', 'orcamento', now(), now()),
    (v.lead_store_a2, v.org_a, v.store_a2, 'Lead Store A2', '+55000000003', 'orcamento', now(), now()),
    (v.lead_org_b, v.org_b, v.store_b, 'Lead Org B', '+55000000004', 'orcamento', now(), now()),
    (v.lead_conversation_proof, v.org_a, v.store_a, 'Lead Conversation Proof', '+55000000005', 'orcamento', now(), now());

  insert into public.conversations (
    id,
    organization_id,
    lead_id,
    status,
    is_human_active,
    created_at
  )
  values
    (v.conversation_primary, v.org_a, v.lead_conversation_proof, 'open', false, now());

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
    (v.opp_activate_retry, v.org_a, v.store_a, v.customer_a, v.lead_a, null, 'orcamento', 1, now(), now()),
    (v.opp_resolve_cycle, v.org_a, v.store_a, v.customer_a, v.lead_a, null, 'orcamento', 1, now(), now()),
    (v.opp_cancel, v.org_a, v.store_a, v.customer_a, v.lead_a, null, 'orcamento', 1, now(), now()),
    (v.opp_exhaust, v.org_a, v.store_a, v.customer_a, v.lead_a, null, 'orcamento', 1, now(), now()),
    (v.opp_opt_out_active, v.org_a, v.store_a, v.customer_b, v.lead_b, null, 'orcamento', 1, now(), now()),
    (v.opp_opt_out_idle, v.org_a, v.store_a, v.customer_b, v.lead_b, null, 'orcamento', 1, now(), now()),
    (v.opp_same_org_other_store, v.org_a, v.store_a2, v.customer_b, v.lead_store_a2, null, 'orcamento', 1, now(), now()),
    (v.opp_other_org, v.org_b, v.store_b, v.customer_org_b, v.lead_org_b, null, 'orcamento', 1, now(), now()),
    (v.opp_rls_org_b, v.org_b, v.store_b, v.customer_org_b, v.lead_org_b, null, 'orcamento', 1, now(), now()),
    (v.opp_same_operation_key_peer, v.org_a, v.store_a, v.customer_a, v.lead_a, null, 'orcamento', 1, now(), now()),
    (v.opp_customer_inconsistent, v.org_a, v.store_a, v.customer_inconsistent, v.lead_a, null, 'orcamento', 1, now(), now()),
    (v.opp_origin_lead_inconsistent, v.org_a, v.store_a, v.customer_a, gen_random_uuid(), null, 'orcamento', 1, now(), now()),
    (v.opp_primary_conversation_inconsistent, v.org_a, v.store_a, v.customer_a, v.lead_conversation_proof, v.conversation_primary, 'orcamento', 1, now(), now()),
    (v.opp_rollback, v.org_a, v.store_a, v.customer_a, v.lead_a, null, 'orcamento', 1, now(), now());
end;
$setup$;

do $scenarios$
declare
  v pg_temp._p9_followup_ctx;
  v_exec record;
  v_retry record;
  v_status_ok boolean;
  v_before_followups bigint;
  v_after_followups bigint;
  v_before_events bigint;
  v_after_events bigint;
  v_event_id uuid;
begin
  select * into strict v from pg_temp._p9_followup_ctx;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-optout-active-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_opt_out_active
      )
    );
    if not v_exec.operation_succeeded then
      raise exception using
        errcode = 'P0001',
        message = coalesce(v_exec.message_text, 'opt out active setup failed');
    end if;
    if not exists (
      select 1
      from public.commercial_opportunity_followups followup_row
      where followup_row.organization_id = v.org_a
        and followup_row.store_id = v.store_a
        and followup_row.commercial_opportunity_id = v.opp_opt_out_active
        and followup_row.status = 'active'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'opt out active setup did not produce an active cycle';
    end if;
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-resolve-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_activate_retry
      )
    );
    perform pg_temp._p9_followup_record(
      1,
      'ativacao inicial',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'status') = 'active' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(1, 'ativacao inicial', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-resolve-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_activate_retry
      )
    );
    perform pg_temp._p9_followup_record(
      2,
      'repeticao idempotente da ativacao',
      case
        when v_exec.operation_succeeded
         and (v_exec.value_text::jsonb ->> 'cycle') = '1'
         and (v_exec.value_text::jsonb ->> 'status') = 'active'
          then 'PASS'
        else 'SUT_FAIL'
      end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(2, 'repeticao idempotente da ativacao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.resolve_commercial_opportunity_followup_by_user('%s','%s','%s','resolve-activate-retry-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_activate_retry
      )
    );
    if not v_exec.operation_succeeded then
      raise exception using
        errcode = 'P0001',
        message = coalesce(v_exec.message_text, 'activation retry setup failed');
    end if;
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-resolve-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_activate_retry
      )
    );
    perform pg_temp._p9_followup_record(
      3,
      'retry da ativacao apos resolucao retorna snapshot original',
      case
        when v_exec.operation_succeeded
         and (v_exec.value_text::jsonb ->> 'status') = 'active'
         and (v_exec.value_text::jsonb ->> 'resolved_at') is null
         and (v_exec.value_text::jsonb ->> 'cycle') = '1'
          then 'PASS'
        else 'SUT_FAIL'
      end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(3, 'retry da ativacao apos resolucao retorna snapshot original', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.record_commercial_opportunity_followup_attempt_by_user('%s','%s','%s','activate-resolve-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_activate_retry
      )
    );
    perform pg_temp._p9_followup_record(
      4,
      'conflito de operation_key',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(4, 'conflito de operation_key', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-cancel-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_cancel
      )
    );
    if not v_exec.operation_succeeded then
      raise exception using
        errcode = 'P0001',
        message = coalesce(v_exec.message_text, 'cancel setup failed');
    end if;
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-cancel-2'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_cancel
      )
    );
    perform pg_temp._p9_followup_record(
      5,
      'segunda ativacao enquanto existe ciclo ativo',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_ALREADY_ACTIVE' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(5, 'segunda ativacao enquanto existe ciclo ativo', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-exhaust-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_exhaust
      )
    );
    if not v_exec.operation_succeeded then
      raise exception using
        errcode = 'P0001',
        message = coalesce(v_exec.message_text, 'exhaust setup failed');
    end if;
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.record_commercial_opportunity_followup_attempt_by_user('%s','%s','%s','attempt-exhaust-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_exhaust
      )
    );
    perform pg_temp._p9_followup_record(
      6,
      'registro de tentativa',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'attempt_count') = '1' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(6, 'registro de tentativa', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.record_commercial_opportunity_followup_attempt_by_user('%s','%s','%s','attempt-exhaust-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_exhaust
      )
    );
    perform pg_temp._p9_followup_record(
      7,
      'repeticao idempotente da tentativa',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'attempt_count') = '1' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(7, 'repeticao idempotente da tentativa', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.record_commercial_opportunity_followup_attempt_by_user('%s','%s','%s','attempt-exhaust-2'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_exhaust
      )
    );
    if not v_exec.operation_succeeded then
      raise exception using
        errcode = 'P0001',
        message = coalesce(v_exec.message_text, 'second attempt setup failed');
    end if;
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.record_commercial_opportunity_followup_attempt_by_user('%s','%s','%s','attempt-exhaust-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_exhaust
      )
    );
    perform pg_temp._p9_followup_record(
      8,
      'retry da primeira tentativa apos novas tentativas retorna snapshot original',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'attempt_count') = '1' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(8, 'retry da primeira tentativa apos novas tentativas retorna snapshot original', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    perform pg_temp._p9_followup_record(
      9,
      'incremento correto de attempt_count',
      case
        when (select attempt_count from public.commercial_opportunity_followups where commercial_opportunity_id = v.opp_exhaust and status = 'active') = 2
          then 'PASS'
        else 'SUT_FAIL'
      end,
      'attempt_count do ciclo ativo de opp_exhaust deve ser 2'
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(9, 'incremento correto de attempt_count', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-resolve-cycle-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_resolve_cycle
      )
    );
    if not v_exec.operation_succeeded then
      raise exception using
        errcode = 'P0001',
        message = coalesce(v_exec.message_text, 'resolve setup failed');
    end if;
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.resolve_commercial_opportunity_followup_by_user('%s','%s','%s','resolve-cycle-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_resolve_cycle
      )
    );
    perform pg_temp._p9_followup_record(
      10,
      'resolucao',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'status') = 'resolved' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(10, 'resolucao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.resolve_commercial_opportunity_followup_by_user('%s','%s','%s','resolve-cycle-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_resolve_cycle
      )
    );
    perform pg_temp._p9_followup_record(
      11,
      'retry idempotente de resolved retorna snapshot original',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'status') = 'resolved' and (v_exec.value_text::jsonb ->> 'cycle') = '1' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(11, 'retry idempotente de resolved retorna snapshot original', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.cancel_commercial_opportunity_followup_by_user('%s','%s','%s','cancel-1','manual_cancel',null))::text$$,
        v.org_a,
        v.store_a,
        v.opp_cancel
      )
    );
    perform pg_temp._p9_followup_record(
      12,
      'cancelamento',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'status') = 'cancelled' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(12, 'cancelamento', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.cancel_commercial_opportunity_followup_by_user('%s','%s','%s','cancel-1','manual_cancel',null))::text$$,
        v.org_a,
        v.store_a,
        v.opp_cancel
      )
    );
    perform pg_temp._p9_followup_record(
      13,
      'retry idempotente de cancelled retorna snapshot original',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'status') = 'cancelled' and (v_exec.value_text::jsonb ->> 'cycle') = '1' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(13, 'retry idempotente de cancelled retorna snapshot original', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'service_role',
      null,
      format(
        $$select row_to_json(public.exhaust_commercial_opportunity_followup_by_system('%s','%s','%s','exhaust-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_exhaust
      )
    );
    perform pg_temp._p9_followup_record(
      14,
      'esgotamento pelo sistema',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'status') = 'exhausted' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(14, 'esgotamento pelo sistema', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'service_role',
      null,
      format(
        $$select row_to_json(public.exhaust_commercial_opportunity_followup_by_system('%s','%s','%s','exhaust-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_exhaust
      )
    );
    perform pg_temp._p9_followup_record(
      15,
      'retry idempotente de exhausted retorna snapshot original',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'status') = 'exhausted' and (v_exec.value_text::jsonb ->> 'cycle') = '1' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(15, 'retry idempotente de exhausted retorna snapshot original', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.opt_out_commercial_opportunity_followup_by_user('%s','%s','%s','optout-active-1','customer_opt_out','Cliente pediu parada'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_opt_out_active
      )
    );
    perform pg_temp._p9_followup_record(
      16,
      'opt out com ciclo ativo',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'status') = 'opted_out' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(16, 'opt out com ciclo ativo', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.opt_out_commercial_opportunity_followup_by_user('%s','%s','%s','optout-active-1','customer_opt_out','Cliente pediu parada'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_opt_out_active
      )
    );
    perform pg_temp._p9_followup_record(
      17,
      'retry idempotente de opted_out retorna snapshot original',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'status') = 'opted_out' and (v_exec.value_text::jsonb ->> 'cycle') = '1' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(17, 'retry idempotente de opted_out retorna snapshot original', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.opt_out_commercial_opportunity_followup_by_user('%s','%s','%s','optout-idle-1','customer_opt_out','Idle opt out'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_opt_out_idle
      )
    );
    perform pg_temp._p9_followup_record(
      18,
      'opt out sem ciclo ativo cria ciclo opted_out',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'status') = 'opted_out' and (v_exec.value_text::jsonb ->> 'cycle') = '1' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(18, 'opt out sem ciclo ativo cria ciclo opted_out', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-resolve-cycle-2'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_resolve_cycle
      )
    );
    perform pg_temp._p9_followup_record(
      19,
      'novo ciclo depois de resolved',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'cycle') = '2' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(19, 'novo ciclo depois de resolved', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-cancel-3'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_cancel
      )
    );
    perform pg_temp._p9_followup_record(
      20,
      'novo ciclo depois de cancelled',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'cycle') = '2' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(20, 'novo ciclo depois de cancelled', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-exhaust-3'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_exhaust
      )
    );
    perform pg_temp._p9_followup_record(
      21,
      'novo ciclo depois de exhausted',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'cycle') = '2' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(21, 'novo ciclo depois de exhausted', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-optout-idle-2'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_opt_out_idle
      )
    );
    perform pg_temp._p9_followup_record(
      22,
      'bloqueio de novo ciclo apos opt out',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_OPT_OUT_LOCKED' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(22, 'bloqueio de novo ciclo apos opt out', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.record_commercial_opportunity_followup_attempt_by_user('%s','%s','%s','attempt-cancel-closed'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_opt_out_active
      )
    );
    perform pg_temp._p9_followup_record(
      23,
      'tentativa em ciclo encerrado',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_REQUIRES_ACTIVE_CYCLE' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(23, 'tentativa em ciclo encerrado', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.resolve_commercial_opportunity_followup_by_user('%s','%s','%s','resolve-optout-closed'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_opt_out_active
      )
    );
    perform pg_temp._p9_followup_record(
      24,
      'resolucao em ciclo encerrado',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_REQUIRES_ACTIVE_CYCLE' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(24, 'resolucao em ciclo encerrado', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','wrong-store'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_same_org_other_store
      )
    );
    perform pg_temp._p9_followup_record(
      25,
      'oportunidade de outra loja na mesma organizacao',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'commercial opportunity not found' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(25, 'oportunidade de outra loja na mesma organizacao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','wrong-org'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_other_org
      )
    );
    perform pg_temp._p9_followup_record(
      26,
      'oportunidade de outra organizacao',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'commercial opportunity not found' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(26, 'oportunidade de outra organizacao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.outsider_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','outsider'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_activate_retry
      )
    );
    perform pg_temp._p9_followup_record(
      27,
      'usuario sem membership',
      case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(27, 'usuario sem membership', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','missing-opp'))::text$$,
        v.org_a,
        v.store_a,
        gen_random_uuid()
      )
    );
    perform pg_temp._p9_followup_record(
      28,
      'oportunidade inexistente',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'commercial opportunity not found' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(28, 'oportunidade inexistente', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','customer-inconsistent'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_customer_inconsistent
      )
    );
    perform pg_temp._p9_followup_record(
      29,
      'customer_scope_inconsistency',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'customer_scope_inconsistency' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(29, 'customer_scope_inconsistency', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','lead-inconsistent'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_origin_lead_inconsistent
      )
    );
    perform pg_temp._p9_followup_record(
      30,
      'origin_lead_scope_inconsistency',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'origin_lead_scope_inconsistency' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(30, 'origin_lead_scope_inconsistency', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','conversation-inconsistent'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_primary_conversation_inconsistent
      )
    );
    perform pg_temp._p9_followup_record(
      31,
      'primary_conversation_scope_inconsistency',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'primary_conversation_scope_inconsistency' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(31, 'primary_conversation_scope_inconsistency', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select check_row.v_status_ok
    into v_status_ok
    from (
      select bool_and(stage = 'orcamento') as v_status_ok
      from public.commercial_opportunities
      where id in (
        v.opp_activate_retry,
        v.opp_resolve_cycle,
        v.opp_cancel,
        v.opp_exhaust,
        v.opp_opt_out_active,
        v.opp_opt_out_idle,
        v.opp_rls_org_b,
        v.opp_rollback
      )
    ) check_row;
    perform pg_temp._p9_followup_record(32, 'nenhuma alteracao automatica de stage', case when v_status_ok then 'PASS' else 'SUT_FAIL' end, 'todas as oportunidades de fixture devem permanecer em orcamento');
  exception
    when others then
      perform pg_temp._p9_followup_record(32, 'nenhuma alteracao automatica de stage', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    perform pg_temp._p9_followup_record(
      33,
      'um unico ciclo ativo por oportunidade',
      case
        when not exists (
          select 1
          from public.commercial_opportunity_followups
          group by organization_id, store_id, commercial_opportunity_id
          having count(*) filter (where status = 'active') > 1
        ) then 'PASS'
        else 'SUT_FAIL'
      end,
      'nenhuma oportunidade pode ter mais de um ciclo active'
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(33, 'um unico ciclo ativo por oportunidade', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','   '))::text$$,
        v.org_a,
        v.store_a,
        v.opp_activate_retry
      )
    );
    perform pg_temp._p9_followup_record(34, 'operation_key vazio ou espacos', case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_OPERATION_KEY_REQUIRED' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.message_text, '<null>'));
  exception
    when others then
      perform pg_temp._p9_followup_record(34, 'operation_key vazio ou espacos', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','%s'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_activate_retry,
        repeat('x', 201)
      )
    );
    perform pg_temp._p9_followup_record(35, 'operation_key acima de 200 caracteres', case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_OPERATION_KEY_TOO_LONG' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.message_text, '<null>'));
  exception
    when others then
      perform pg_temp._p9_followup_record(35, 'operation_key acima de 200 caracteres', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.cancel_commercial_opportunity_followup_by_user('%s','%s','%s','cancel-too-long','%s',null))::text$$,
        v.org_a,
        v.store_a,
        v.opp_activate_retry,
        repeat('r', 101)
      )
    );
    perform pg_temp._p9_followup_record(36, 'reason_code acima de 100 caracteres', case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_REASON_CODE_TOO_LONG' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.message_text, '<null>'));
  exception
    when others then
      perform pg_temp._p9_followup_record(36, 'reason_code acima de 100 caracteres', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.cancel_commercial_opportunity_followup_by_user('%s','%s','%s','cancel-details-too-long','manual_cancel','%s'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_activate_retry,
        repeat('d', 2001)
      )
    );
    perform pg_temp._p9_followup_record(37, 'reason_details acima de 2000 caracteres', case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_REASON_DETAILS_TOO_LONG' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.message_text, '<null>'));
  exception
    when others then
      perform pg_temp._p9_followup_record(37, 'reason_details acima de 2000 caracteres', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select has_function_privilege('anon', 'public.activate_commercial_opportunity_followup_by_user(uuid,uuid,uuid,text)', 'EXECUTE') into v_status_ok;
    perform pg_temp._p9_followup_record(38, 'anon sem execute', case when not v_status_ok then 'PASS' else 'SUT_FAIL' end, 'anon nao deve ter EXECUTE nos writers by_user');
  exception
    when others then
      perform pg_temp._p9_followup_record(38, 'anon sem execute', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select has_table_privilege('anon', 'public.commercial_opportunity_followups', 'SELECT') into v_status_ok;
    perform pg_temp._p9_followup_record(39, 'anon sem select', case when not v_status_ok then 'PASS' else 'SUT_FAIL' end, 'anon nao deve ter SELECT nas tabelas de followup');
  exception
    when others then
      perform pg_temp._p9_followup_record(39, 'anon sem select', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select
      not has_table_privilege('authenticated', 'public.commercial_opportunity_followups', 'INSERT')
      and not has_table_privilege('authenticated', 'public.commercial_opportunity_followup_events', 'INSERT')
    into v_status_ok;
    perform pg_temp._p9_followup_record(40, 'authenticated sem insert direto', case when v_status_ok then 'PASS' else 'SUT_FAIL' end, 'authenticated nao deve ter INSERT direto em followups nem em events');
  exception
    when others then
      perform pg_temp._p9_followup_record(40, 'authenticated sem insert direto', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select
      not has_table_privilege('authenticated', 'public.commercial_opportunity_followups', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.commercial_opportunity_followup_events', 'UPDATE')
    into v_status_ok;
    perform pg_temp._p9_followup_record(41, 'authenticated sem update direto', case when v_status_ok then 'PASS' else 'SUT_FAIL' end, 'authenticated nao deve ter UPDATE direto em followups nem em events');
  exception
    when others then
      perform pg_temp._p9_followup_record(41, 'authenticated sem update direto', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select
      not has_table_privilege('authenticated', 'public.commercial_opportunity_followups', 'DELETE')
      and not has_table_privilege('authenticated', 'public.commercial_opportunity_followup_events', 'DELETE')
    into v_status_ok;
    perform pg_temp._p9_followup_record(42, 'authenticated sem delete direto', case when v_status_ok then 'PASS' else 'SUT_FAIL' end, 'authenticated nao deve ter DELETE direto em followups nem em events');
  exception
    when others then
      perform pg_temp._p9_followup_record(42, 'authenticated sem delete direto', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.exhaust_commercial_opportunity_followup_by_system('%s','%s','%s','forbidden-by-user'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_activate_retry
      )
    );
    perform pg_temp._p9_followup_record(43, 'authenticated sem writer by_system', case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.message_text, '<null>'));
  exception
    when others then
      perform pg_temp._p9_followup_record(43, 'authenticated sem writer by_system', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'service_role',
      null,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','forbidden-by-system'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_activate_retry
      )
    );
    perform pg_temp._p9_followup_record(44, 'service_role sem writer by_user', case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.message_text, '<null>'));
  exception
    when others then
      perform pg_temp._p9_followup_record(44, 'service_role sem writer by_user', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select
      not has_table_privilege('service_role', 'public.commercial_opportunity_followups', 'INSERT')
      and not has_table_privilege('service_role', 'public.commercial_opportunity_followup_events', 'INSERT')
    into v_status_ok;
    perform pg_temp._p9_followup_record(45, 'service_role sem insert direto', case when v_status_ok then 'PASS' else 'SUT_FAIL' end, 'service_role nao deve ter INSERT direto em followups nem em events');
  exception
    when others then
      perform pg_temp._p9_followup_record(45, 'service_role sem insert direto', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select
      not has_table_privilege('service_role', 'public.commercial_opportunity_followups', 'UPDATE')
      and not has_table_privilege('service_role', 'public.commercial_opportunity_followup_events', 'UPDATE')
    into v_status_ok;
    perform pg_temp._p9_followup_record(46, 'service_role sem update direto', case when v_status_ok then 'PASS' else 'SUT_FAIL' end, 'service_role nao deve ter UPDATE direto em followups nem em events');
  exception
    when others then
      perform pg_temp._p9_followup_record(46, 'service_role sem update direto', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select
      not has_table_privilege('service_role', 'public.commercial_opportunity_followups', 'DELETE')
      and not has_table_privilege('service_role', 'public.commercial_opportunity_followup_events', 'DELETE')
    into v_status_ok;
    perform pg_temp._p9_followup_record(47, 'service_role sem delete direto', case when v_status_ok then 'PASS' else 'SUT_FAIL' end, 'service_role nao deve ter DELETE direto em followups nem em events');
  exception
    when others then
      perform pg_temp._p9_followup_record(47, 'service_role sem delete direto', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_b_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','rls-org-b-activate-1'))::text$$,
        v.org_b,
        v.store_b,
        v.opp_rls_org_b
      )
    );
    if not v_exec.operation_succeeded then
      raise exception using
        errcode = 'P0001',
        message = coalesce(v_exec.message_text, 'rls org b setup failed');
    end if;
    select * into v_retry from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select count(*)::text from public.commercial_opportunity_followups where organization_id = '%s'::uuid$$,
        v.org_b
      )
    );
    perform pg_temp._p9_followup_record(
      48,
      'rls followups sem leitura cruzada entre organizacoes',
      case
        when exists (
          select 1
          from public.commercial_opportunity_followups followup_row
          where followup_row.organization_id = v.org_b
            and followup_row.store_id = v.store_b
            and followup_row.commercial_opportunity_id = v.opp_rls_org_b
        )
         and v_retry.operation_succeeded
         and coalesce(v_retry.value_text, 'x') = '0'
          then 'PASS'
        else 'SUT_FAIL'
      end,
      coalesce(v_retry.value_text, coalesce(v_retry.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(48, 'rls followups sem leitura cruzada entre organizacoes', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'postgres',
      null,
      format(
        $$select id::text
          from public.commercial_opportunity_followup_events
         where commercial_opportunity_id = '%s'::uuid
           and operation_key = 'cancel-1'$$,
        v.opp_cancel
      )
    );
    if not v_exec.operation_succeeded or v_exec.value_text is null then
      raise exception using errcode = 'P0001', message = coalesce(v_exec.message_text, 'missing append-only event for update test');
    end if;
    v_event_id := v_exec.value_text::uuid;

    select * into v_exec from pg_temp._p9_followup_exec(
      'postgres',
      null,
      format(
        $$update public.commercial_opportunity_followup_events set reason_code = 'forbidden' where id = '%s'::uuid returning id::text$$,
        v_event_id
      )
    );
    perform pg_temp._p9_followup_record(49, 'update de evento bloqueado', case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_EVENTS_APPEND_ONLY' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.message_text, '<null>'));
  exception
    when others then
      perform pg_temp._p9_followup_record(49, 'update de evento bloqueado', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'postgres',
      null,
      format(
        $$select id::text
          from public.commercial_opportunity_followup_events
         where commercial_opportunity_id = '%s'::uuid
           and operation_key = 'cancel-1'$$,
        v.opp_cancel
      )
    );
    if not v_exec.operation_succeeded or v_exec.value_text is null then
      raise exception using errcode = 'P0001', message = coalesce(v_exec.message_text, 'missing append-only event for delete test');
    end if;
    v_event_id := v_exec.value_text::uuid;

    select * into v_exec from pg_temp._p9_followup_exec(
      'postgres',
      null,
      format(
        $$delete from public.commercial_opportunity_followup_events where id = '%s'::uuid returning id::text$$,
        v_event_id
      )
    );
    perform pg_temp._p9_followup_record(50, 'delete de evento bloqueado', case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_EVENTS_APPEND_ONLY' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.message_text, '<null>'));
  exception
    when others then
      perform pg_temp._p9_followup_record(50, 'delete de evento bloqueado', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*) into v_before_followups
    from public.commercial_opportunity_followups
    where commercial_opportunity_id = v.opp_rollback;

    select count(*) into v_before_events
    from public.commercial_opportunity_followup_events
    where commercial_opportunity_id = v.opp_rollback;

    begin
      select * into v_exec from pg_temp._p9_followup_exec(
        'authenticated',
        v.member_user_id,
        format(
          $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','caller-rollback-sentinel'))::text$$,
          v.org_a,
          v.store_a,
          v.opp_rollback
        )
      );
      if not v_exec.operation_succeeded then
        raise exception using errcode = 'P0001', message = coalesce(v_exec.message_text, 'rollback setup failed');
      end if;
      raise exception using errcode = 'P0001', message = 'FOLLOWUP_RUNNER_SENTINEL';
    exception
      when sqlstate 'P0001' then
        if sqlerrm <> 'FOLLOWUP_RUNNER_SENTINEL' then
          raise;
        end if;
    end;

    select count(*) into v_after_followups
    from public.commercial_opportunity_followups
    where commercial_opportunity_id = v.opp_rollback;

    select count(*) into v_after_events
    from public.commercial_opportunity_followup_events
    where commercial_opportunity_id = v.opp_rollback;

    perform pg_temp._p9_followup_record(
      51,
      'rollback automatico do subbloco do chamador',
      case when v_before_followups = v_after_followups and v_before_events = v_after_events then 'PASS' else 'SUT_FAIL' end,
      format(
        'followups_before=%s followups_after=%s events_before=%s events_after=%s',
        v_before_followups,
        v_after_followups,
        v_before_events,
        v_after_events
      )
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(51, 'rollback automatico do subbloco do chamador', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'postgres',
      null,
      format(
        $$insert into public.commercial_opportunity_followup_events (
            organization_id,
            store_id,
            commercial_opportunity_id,
            followup_id,
            cycle,
            event_type,
            operation_key,
            actor_type,
            actor_user_id,
            reason_code,
            reason_details,
            metadata
          )
          select
            followup_row.organization_id,
            followup_row.store_id,
            followup_row.commercial_opportunity_id,
            followup_row.id,
            followup_row.cycle,
            'cancelled',
            'missing-snapshot-probe',
            'system',
            null,
            null,
            null,
            '{}'::jsonb
          from public.commercial_opportunity_followups followup_row
          where followup_row.organization_id = '%s'::uuid
            and followup_row.store_id = '%s'::uuid
            and followup_row.commercial_opportunity_id = '%s'::uuid
            and followup_row.status = 'cancelled'
          returning id::text$$,
        v.org_a,
        v.store_a,
        v.opp_cancel
      )
    );
    perform pg_temp._p9_followup_record(
      52,
      'constraint exige result_snapshot',
      case
        when not v_exec.operation_succeeded
         and v_exec.returned_sqlstate = '23514'
         and v_exec.constraint_name = 'commercial_opportunity_followup_events_metadata_object_check'
          then 'PASS'
        else 'SUT_FAIL'
      end,
      coalesce(v_exec.message_text, coalesce(v_exec.constraint_name, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(52, 'constraint exige result_snapshot', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select has_table_privilege('anon', 'public.commercial_opportunity_followup_events', 'SELECT') into v_status_ok;
    perform pg_temp._p9_followup_record(53, 'anon sem select em events', case when not v_status_ok then 'PASS' else 'SUT_FAIL' end, 'anon nao deve ter SELECT na tabela de events');
  exception
    when others then
      perform pg_temp._p9_followup_record(53, 'anon sem select em events', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_retry from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select count(*)::text
          from public.commercial_opportunity_followup_events
         where organization_id = '%s'::uuid$$,
        v.org_b
      )
    );
    perform pg_temp._p9_followup_record(
      54,
      'rls events sem leitura cruzada entre organizacoes',
      case
        when exists (
          select 1
          from public.commercial_opportunity_followup_events event_row
          where event_row.organization_id = v.org_b
            and event_row.store_id = v.store_b
            and event_row.commercial_opportunity_id = v.opp_rls_org_b
            and event_row.operation_key = 'rls-org-b-activate-1'
        )
         and v_retry.operation_succeeded
         and coalesce(v_retry.value_text, 'x') = '0'
          then 'PASS'
        else 'SUT_FAIL'
      end,
      coalesce(v_retry.value_text, coalesce(v_retry.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(54, 'rls events sem leitura cruzada entre organizacoes', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.cancel_commercial_opportunity_followup_by_user('%s','%s','%s','cancel-1','other_reason',null))::text$$,
        v.org_a,
        v.store_a,
        v.opp_cancel
      )
    );
    perform pg_temp._p9_followup_record(
      55,
      'cancelamento com mesma operation_key e reason_code diferente conflita',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(55, 'cancelamento com mesma operation_key e reason_code diferente conflita', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.cancel_commercial_opportunity_followup_by_user('%s','%s','%s','cancel-1','manual_cancel','motivo divergente'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_cancel
      )
    );
    perform pg_temp._p9_followup_record(
      56,
      'cancelamento com mesma operation_key e reason_details diferente conflita',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(56, 'cancelamento com mesma operation_key e reason_details diferente conflita', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.opt_out_commercial_opportunity_followup_by_user('%s','%s','%s','optout-active-2','customer_opt_out','segunda tentativa'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_opt_out_active
      )
    );
    perform pg_temp._p9_followup_record(
      57,
      'novo opt out com outra operation_key apos opt out registrado bloqueia',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_OPT_OUT_ALREADY_REGISTERED' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(57, 'novo opt out com outra operation_key apos opt out registrado bloqueia', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-resolve-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_same_operation_key_peer
      )
    );
    perform pg_temp._p9_followup_record(
      58,
      'mesma operation_key em oportunidades diferentes e permitida',
      case when v_exec.operation_succeeded and (v_exec.value_text::jsonb ->> 'status') = 'active' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>'))
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(58, 'mesma operation_key em oportunidades diferentes e permitida', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.member_user_a2_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','activate-resolve-1'))::text$$,
        v.org_a,
        v.store_a,
        v.opp_activate_retry
      )
    );
    perform pg_temp._p9_followup_record(
      59,
      'retry da mesma operation_key por outro usuario autorizado conflita',
      case when not v_exec.operation_succeeded and v_exec.message_text = 'ZION_FOLLOWUP_OPERATION_KEY_CONFLICT' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(59, 'retry da mesma operation_key por outro usuario autorizado conflita', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_exec(
      'authenticated',
      v.outsider_user_id,
      format(
        $$select row_to_json(public.activate_commercial_opportunity_followup_by_user('%s','%s','%s','   '))::text$$,
        v.org_a,
        v.store_a,
        v.opp_same_operation_key_peer
      )
    );
    perform pg_temp._p9_followup_record(
      60,
      'usuario sem membership e operation_key invalida retorna 42501',
      case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end,
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when others then
      perform pg_temp._p9_followup_record(60, 'usuario sem membership e operation_key invalida retorna 42501', 'HARNESS_ERROR', sqlerrm);
  end;
end;
$scenarios$;

insert into pg_temp._p9_followup_results (
  scenario_number,
  scenario_name,
  status,
  detail
)
select
  matrix_row.scenario_number,
  matrix_row.scenario_name,
  'HARNESS_ERROR',
  'scenario was not recorded by the runner'
from pg_temp._p9_followup_matrix matrix_row
where not exists (
  select 1
  from pg_temp._p9_followup_results result_row
  where result_row.scenario_number = matrix_row.scenario_number
);

select
  scenario_number,
  scenario_name,
  status,
  detail
from pg_temp._p9_followup_results
order by scenario_number;

select
  count(*) as total_scenarios,
  count(*) filter (where status = 'PASS') as total_pass,
  count(*) filter (where status = 'SUT_FAIL') as sut_fail,
  0::bigint as total_blocked,
  count(*) filter (where status = 'HARNESS_ERROR') as harness_error,
  case
    when count(*) <> (select count(*) from pg_temp._p9_followup_matrix) then 'AINDA_NAO_APROVADA'
    when count(*) filter (where status = 'PASS') <> (select count(*) from pg_temp._p9_followup_matrix) then 'AINDA_NAO_APROVADA'
    when count(*) filter (where status = 'SUT_FAIL') > 0 then 'AINDA_NAO_APROVADA'
    when count(*) filter (where status = 'HARNESS_ERROR') > 0 then 'AINDA_NAO_APROVADA'
    else 'APROVADA'
  end as final_status
from pg_temp._p9_followup_results;

rollback;
