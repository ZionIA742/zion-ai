begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_followup_reader_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_followup_reader_matrix (
  scenario_number integer primary key,
  scenario_name text not null
) on commit preserve rows;

insert into pg_temp._p9_followup_reader_matrix (
  scenario_number,
  scenario_name
)
values
  (1, 'oportunidade sem ciclos retorna false'),
  (2, 'ciclo active retorna true'),
  (3, 'ciclo resolved retorna false'),
  (4, 'ciclo cancelled retorna false'),
  (5, 'ciclo exhausted retorna false'),
  (6, 'ciclo opted_out retorna false'),
  (7, 'ciclo terminal antigo e ciclo ativo novo retorna true'),
  (8, 'dois ciclos ativos simultaneos nao coexistem'),
  (9, 'followup de outra oportunidade nao contamina o card'),
  (10, 'followup de outra loja nao contamina o card'),
  (11, 'followup de outra organizacao nao contamina o card'),
  (12, 'varios ciclos nao duplicam cards'),
  (13, 'quantidade e paginacao anteriores sao preservadas'),
  (14, 'stage continua vindo apenas da oportunidade'),
  (15, 'perdidos continuam separados'),
  (16, 'concluidos continuam separados'),
  (17, 'usuario sem membership nao recebe linhas'),
  (18, 'leitura cruzada entre organizacoes continua bloqueada'),
  (19, 'anon nao executa a rpc'),
  (20, 'contrato anterior das colunas permanece igual'),
  (21, 'nova coluna e booleana e nunca nula'),
  (22, 'nenhuma tabela antiga de followup e consultada');

create temp table pg_temp._p9_followup_reader_ctx (
  singleton boolean primary key default true check (singleton),
  run_id uuid not null,
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_a2 uuid not null,
  store_b uuid not null,
  member_user_a_id uuid not null,
  member_user_b_id uuid not null,
  outsider_user_id uuid not null,
  customer_a uuid not null,
  customer_b uuid not null,
  customer_c uuid not null,
  customer_org_b uuid not null,
  lead_none uuid not null,
  lead_active uuid not null,
  lead_resolved uuid not null,
  lead_cancelled uuid not null,
  lead_exhausted uuid not null,
  lead_opted_out uuid not null,
  lead_history uuid not null,
  lead_lost uuid not null,
  lead_completed uuid not null,
  lead_store_a2 uuid not null,
  lead_org_b uuid not null,
  opp_none uuid not null,
  opp_active uuid not null,
  opp_resolved uuid not null,
  opp_cancelled uuid not null,
  opp_exhausted uuid not null,
  opp_opted_out uuid not null,
  opp_history uuid not null,
  opp_lost uuid not null,
  opp_completed uuid not null,
  opp_other_store uuid not null,
  opp_other_org uuid not null
) on commit preserve rows;

insert into pg_temp._p9_followup_reader_ctx (
  run_id,
  org_a,
  org_b,
  store_a,
  store_a2,
  store_b,
  member_user_a_id,
  member_user_b_id,
  outsider_user_id,
  customer_a,
  customer_b,
  customer_c,
  customer_org_b,
  lead_none,
  lead_active,
  lead_resolved,
  lead_cancelled,
  lead_exhausted,
  lead_opted_out,
  lead_history,
  lead_lost,
  lead_completed,
  lead_store_a2,
  lead_org_b,
  opp_none,
  opp_active,
  opp_resolved,
  opp_cancelled,
  opp_exhausted,
  opp_opted_out,
  opp_history,
  opp_lost,
  opp_completed,
  opp_other_store,
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
  gen_random_uuid(),
  gen_random_uuid()
);

create or replace function pg_temp._p9_followup_reader_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_followup_reader_results (
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

create or replace function pg_temp._p9_followup_reader_exec(
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

revoke all on function pg_temp._p9_followup_reader_record(integer, text, text, text) from public;
revoke all on function pg_temp._p9_followup_reader_exec(text, uuid, text) from public;

do $setup$
declare
  v pg_temp._p9_followup_reader_ctx;
  v_base timestamptz := '2026-08-06 12:00:00+00'::timestamptz;
  v_loss_writer_oid oid;
  v_loss_exec record;
begin
  select * into strict v from pg_temp._p9_followup_reader_ctx;

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
      v.member_user_a_id,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'runner-followup-reader-member-a-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('runner', true, 'key', 'member-a'),
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
      'runner-followup-reader-member-b-' || v.run_id::text || '@example.test',
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
    ),
    (
      v.outsider_user_id,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'runner-followup-reader-outsider-' || v.run_id::text || '@example.test',
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
    );

  insert into public.organizations (id, name)
  values
    (v.org_a, 'Runner Followup Reader Org A ' || v.run_id::text),
    (v.org_b, 'Runner Followup Reader Org B ' || v.run_id::text);

  insert into public.stores (id, organization_id, name)
  values
    (v.store_a, v.org_a, 'Runner Followup Reader Store A ' || v.run_id::text),
    (v.store_a2, v.org_a, 'Runner Followup Reader Store A2 ' || v.run_id::text),
    (v.store_b, v.org_b, 'Runner Followup Reader Store B ' || v.run_id::text);

  insert into public.memberships (organization_id, user_id, role)
  values
    (v.org_a, v.member_user_a_id, 'owner'),
    (v.org_b, v.member_user_b_id, 'owner');

  insert into public.customers (id, organization_id, display_name)
  values
    (v.customer_a, v.org_a, 'Runner Reader Customer A'),
    (v.customer_b, v.org_a, 'Runner Reader Customer B'),
    (v.customer_c, v.org_a, 'Runner Reader Customer C'),
    (v.customer_org_b, v.org_b, 'Runner Reader Customer Org B');

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  values
    (v.org_a, v.store_a, v.customer_a),
    (v.org_a, v.store_a, v.customer_b),
    (v.org_a, v.store_a, v.customer_c),
    (v.org_a, v.store_a2, v.customer_a),
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
    (v.lead_none, v.org_a, v.store_a, 'Lead None', '+55000000011', 'orcamento', v_base + interval '1 minute', v_base + interval '1 minute'),
    (v.lead_active, v.org_a, v.store_a, 'Lead Active', '+55000000012', 'orcamento', v_base + interval '2 minute', v_base + interval '2 minute'),
    (v.lead_resolved, v.org_a, v.store_a, 'Lead Resolved', '+55000000013', 'negociacao', v_base + interval '3 minute', v_base + interval '3 minute'),
    (v.lead_cancelled, v.org_a, v.store_a, 'Lead Cancelled', '+55000000014', 'visita_tecnica', v_base + interval '4 minute', v_base + interval '4 minute'),
    (v.lead_exhausted, v.org_a, v.store_a, 'Lead Exhausted', '+55000000015', 'qualificacao', v_base + interval '5 minute', v_base + interval '5 minute'),
    (v.lead_opted_out, v.org_a, v.store_a, 'Lead Opted Out', '+55000000016', 'orcamento', v_base + interval '6 minute', v_base + interval '6 minute'),
    (v.lead_history, v.org_a, v.store_a, 'Lead History', '+55000000017', 'orcamento', v_base + interval '7 minute', v_base + interval '7 minute'),
    (v.lead_lost, v.org_a, v.store_a, 'Lead Lost', '+55000000018', 'orcamento', v_base + interval '8 minute', v_base + interval '8 minute'),
    (v.lead_completed, v.org_a, v.store_a, 'Lead Completed', '+55000000019', 'pos_venda', v_base + interval '9 minute', v_base + interval '9 minute'),
    (v.lead_store_a2, v.org_a, v.store_a2, 'Lead Other Store', '+55000000020', 'orcamento', v_base + interval '10 minute', v_base + interval '10 minute'),
    (v.lead_org_b, v.org_b, v.store_b, 'Lead Other Org', '+55000000021', 'orcamento', v_base + interval '11 minute', v_base + interval '11 minute');

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    origin_lead_id,
    primary_conversation_id,
    stage,
    stage_changed_at,
    created_at,
    updated_at,
    lifecycle_cycle,
    lost_at,
    lost_reason_code,
    lost_reason_details,
    current_loss_event_id,
    last_reopened_at
  )
  values
    (v.opp_none, v.org_a, v.store_a, v.customer_a, v.lead_none, null, 'orcamento', v_base + interval '20 minute', v_base + interval '20 minute', v_base + interval '20 minute', 1, null, null, null, null, null),
    (v.opp_active, v.org_a, v.store_a, v.customer_a, v.lead_active, null, 'orcamento', v_base + interval '21 minute', v_base + interval '21 minute', v_base + interval '21 minute', 1, null, null, null, null, null),
    (v.opp_resolved, v.org_a, v.store_a, v.customer_b, v.lead_resolved, null, 'negociacao', v_base + interval '22 minute', v_base + interval '22 minute', v_base + interval '22 minute', 1, null, null, null, null, null),
    (v.opp_cancelled, v.org_a, v.store_a, v.customer_b, v.lead_cancelled, null, 'visita_tecnica', v_base + interval '23 minute', v_base + interval '23 minute', v_base + interval '23 minute', 1, null, null, null, null, null),
    (v.opp_exhausted, v.org_a, v.store_a, v.customer_c, v.lead_exhausted, null, 'qualificacao', v_base + interval '24 minute', v_base + interval '24 minute', v_base + interval '24 minute', 1, null, null, null, null, null),
    (v.opp_opted_out, v.org_a, v.store_a, v.customer_c, v.lead_opted_out, null, 'orcamento', v_base + interval '25 minute', v_base + interval '25 minute', v_base + interval '25 minute', 1, null, null, null, null, null),
    (v.opp_history, v.org_a, v.store_a, v.customer_a, v.lead_history, null, 'orcamento', v_base + interval '26 minute', v_base + interval '26 minute', v_base + interval '26 minute', 2, null, null, null, null, null),
    (v.opp_lost, v.org_a, v.store_a, v.customer_b, v.lead_lost, null, 'negociacao', v_base + interval '27 minute', v_base + interval '27 minute', v_base + interval '27 minute', 1, null, null, null, null, null),
    (v.opp_completed, v.org_a, v.store_a, v.customer_c, v.lead_completed, null, 'concluido_sem_mais_acoes', v_base + interval '28 minute', v_base + interval '28 minute', v_base + interval '28 minute', 1, null, null, null, null, null),
    (v.opp_other_store, v.org_a, v.store_a2, v.customer_a, v.lead_store_a2, null, 'orcamento', v_base + interval '29 minute', v_base + interval '29 minute', v_base + interval '29 minute', 1, null, null, null, null, null),
    (v.opp_other_org, v.org_b, v.store_b, v.customer_org_b, v.lead_org_b, null, 'orcamento', v_base + interval '30 minute', v_base + interval '30 minute', v_base + interval '30 minute', 1, null, null, null, null, null);

  insert into public.commercial_opportunity_followups (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    cycle,
    status,
    started_at,
    resolved_at,
    cancelled_at,
    exhausted_at,
    opted_out_at,
    last_attempt_at,
    attempt_count,
    created_at,
    updated_at
  )
  values
    (gen_random_uuid(), v.org_a, v.store_a, v.opp_active, 1, 'active', v_base + interval '40 minute', null, null, null, null, null, 0, v_base + interval '40 minute', v_base + interval '40 minute'),
    (gen_random_uuid(), v.org_a, v.store_a, v.opp_resolved, 1, 'resolved', v_base + interval '41 minute', v_base + interval '42 minute', null, null, null, null, 1, v_base + interval '41 minute', v_base + interval '42 minute'),
    (gen_random_uuid(), v.org_a, v.store_a, v.opp_cancelled, 1, 'cancelled', v_base + interval '43 minute', null, v_base + interval '44 minute', null, null, null, 0, v_base + interval '43 minute', v_base + interval '44 minute'),
    (gen_random_uuid(), v.org_a, v.store_a, v.opp_exhausted, 1, 'exhausted', v_base + interval '45 minute', null, null, v_base + interval '46 minute', null, v_base + interval '45 minute', 3, v_base + interval '45 minute', v_base + interval '46 minute'),
    (gen_random_uuid(), v.org_a, v.store_a, v.opp_opted_out, 1, 'opted_out', v_base + interval '47 minute', null, null, null, v_base + interval '48 minute', null, 0, v_base + interval '47 minute', v_base + interval '48 minute'),
    (gen_random_uuid(), v.org_a, v.store_a, v.opp_history, 1, 'resolved', v_base + interval '49 minute', v_base + interval '50 minute', null, null, null, null, 2, v_base + interval '49 minute', v_base + interval '50 minute'),
    (gen_random_uuid(), v.org_a, v.store_a, v.opp_history, 2, 'active', v_base + interval '51 minute', null, null, null, null, null, 0, v_base + interval '51 minute', v_base + interval '51 minute'),
    (gen_random_uuid(), v.org_a, v.store_a2, v.opp_other_store, 1, 'active', v_base + interval '52 minute', null, null, null, null, null, 0, v_base + interval '52 minute', v_base + interval '52 minute'),
    (gen_random_uuid(), v.org_b, v.store_b, v.opp_other_org, 1, 'active', v_base + interval '53 minute', null, null, null, null, null, 0, v_base + interval '53 minute', v_base + interval '53 minute');

  v_loss_writer_oid := pg_catalog.to_regprocedure(
    'public.mark_commercial_opportunity_lost_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)'
  );

  if v_loss_writer_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'runner precondition failed: canonical user loss writer signature is missing';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'mark_commercial_opportunity_lost_by_user'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'runner precondition failed: unexpected overloads for public.mark_commercial_opportunity_lost_by_user';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_loss_writer_oid
      and proc_row.pronargs = 9
      and proc_row.pronargdefaults = 4
      and proc_row.proargnames[1:9] = array[
        'p_request_organization_id',
        'p_store_id',
        'p_commercial_opportunity_id',
        'p_idempotency_key',
        'p_reason_code',
        'p_reason_details',
        'p_evidence_message_id',
        'p_evidence_summary',
        'p_source'
      ]
      and string_to_array(proc_row.proargtypes::text, ' ')::oid[] = array[
        'uuid'::pg_catalog.regtype::oid,
        'uuid'::pg_catalog.regtype::oid,
        'uuid'::pg_catalog.regtype::oid,
        'text'::pg_catalog.regtype::oid,
        'text'::pg_catalog.regtype::oid,
        'text'::pg_catalog.regtype::oid,
        'uuid'::pg_catalog.regtype::oid,
        'text'::pg_catalog.regtype::oid,
        'text'::pg_catalog.regtype::oid
      ]
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'TABLE(commercial_opportunity_id uuid, stage text, lifecycle_cycle integer, current_loss_event_id uuid, lost_at timestamp with time zone, lost_reason_code text, lost_reason_details text)'
      and pg_catalog.pg_get_expr(proc_row.proargdefaults, 0::oid) = 'NULL::text, NULL::uuid, NULL::text, ''manual_user_loss''::text'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'runner precondition failed: canonical user loss writer contract diverged';
  end if;

  select * into v_loss_exec
  from pg_temp._p9_followup_reader_exec(
    'authenticated',
    v.member_user_a_id,
    format(
      $sql$
        select
          outcome.stage
          || ':' ||
          outcome.lifecycle_cycle::text
          || ':' ||
          coalesce(outcome.current_loss_event_id::text, '<null>')
          || ':' ||
          coalesce(outcome.lost_reason_code, '<null>')
        from public.mark_commercial_opportunity_lost_by_user(
          '%s'::uuid,
          '%s'::uuid,
          '%s'::uuid,
          %L,
          'explicit_refusal',
          null::text,
          null::uuid,
          null::text,
          'runner_followup_reader_loss'
        ) outcome
      $sql$,
      v.org_a,
      v.store_a,
      v.opp_lost,
      'loss-' || v.run_id::text
    )
  );

  if not v_loss_exec.operation_succeeded
     or v_loss_exec.value_text !~ '^perdido:[0-9]+:[0-9a-f-]{36}:explicit_refusal$' then
    raise exception using
      errcode = 'P0001',
      message = 'runner precondition failed: canonical loss writer did not project opp_lost as perdido',
      detail = coalesce(v_loss_exec.value_text, coalesce(v_loss_exec.message_text, '<null>'));
  end if;

  if not exists (
    select 1
    from public.commercial_opportunities opportunity_row
    join public.commercial_opportunity_lifecycle_events lifecycle_event
      on lifecycle_event.id = opportunity_row.current_loss_event_id
    where opportunity_row.id = v.opp_lost
      and opportunity_row.organization_id = v.org_a
      and opportunity_row.store_id = v.store_a
      and opportunity_row.stage = 'perdido'
      and opportunity_row.current_loss_event_id is not null
      and opportunity_row.lost_at is not null
      and opportunity_row.lost_reason_code = 'explicit_refusal'
      and opportunity_row.lost_reason_details is null
      and lifecycle_event.organization_id = opportunity_row.organization_id
      and lifecycle_event.store_id = opportunity_row.store_id
      and lifecycle_event.commercial_opportunity_id = opportunity_row.id
      and lifecycle_event.lifecycle_cycle = opportunity_row.lifecycle_cycle
      and lifecycle_event.event_type = 'marked_lost'
      and lifecycle_event.new_stage = 'perdido'
      and lifecycle_event.reason_code = 'explicit_refusal'
      and lifecycle_event.reason_details is null
      and lifecycle_event.actor_type = 'human'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'runner precondition failed: canonical loss lifecycle projection for opp_lost is inconsistent';
  end if;
end;
$setup$;

do $scenarios$
declare
  v pg_temp._p9_followup_reader_ctx;
  v_exec record;
  v_retry record;
  v_status_ok boolean;
begin
  select * into strict v from pg_temp._p9_followup_reader_ctx;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select coalesce((select is_follow_up_active::text
          from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
          where commercial_opportunity_id = '%s'::uuid), '<missing>')$$,
        v.org_a,
        v.store_a,
        v.opp_none
      )
    );
    perform pg_temp._p9_followup_reader_record(1, 'oportunidade sem ciclos retorna false', case when v_exec.operation_succeeded and v_exec.value_text = 'false' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(1, 'oportunidade sem ciclos retorna false', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select (select is_follow_up_active::text
          from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
          where commercial_opportunity_id = '%s'::uuid)$$,
        v.org_a,
        v.store_a,
        v.opp_active
      )
    );
    perform pg_temp._p9_followup_reader_record(2, 'ciclo active retorna true', case when v_exec.operation_succeeded and v_exec.value_text = 'true' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(2, 'ciclo active retorna true', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select (select is_follow_up_active::text
          from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
          where commercial_opportunity_id = '%s'::uuid)$$,
        v.org_a,
        v.store_a,
        v.opp_resolved
      )
    );
    perform pg_temp._p9_followup_reader_record(3, 'ciclo resolved retorna false', case when v_exec.operation_succeeded and v_exec.value_text = 'false' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(3, 'ciclo resolved retorna false', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select (select is_follow_up_active::text
          from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
          where commercial_opportunity_id = '%s'::uuid)$$,
        v.org_a,
        v.store_a,
        v.opp_cancelled
      )
    );
    perform pg_temp._p9_followup_reader_record(4, 'ciclo cancelled retorna false', case when v_exec.operation_succeeded and v_exec.value_text = 'false' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(4, 'ciclo cancelled retorna false', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select (select is_follow_up_active::text
          from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
          where commercial_opportunity_id = '%s'::uuid)$$,
        v.org_a,
        v.store_a,
        v.opp_exhausted
      )
    );
    perform pg_temp._p9_followup_reader_record(5, 'ciclo exhausted retorna false', case when v_exec.operation_succeeded and v_exec.value_text = 'false' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(5, 'ciclo exhausted retorna false', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select (select is_follow_up_active::text
          from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
          where commercial_opportunity_id = '%s'::uuid)$$,
        v.org_a,
        v.store_a,
        v.opp_opted_out
      )
    );
    perform pg_temp._p9_followup_reader_record(6, 'ciclo opted_out retorna false', case when v_exec.operation_succeeded and v_exec.value_text = 'false' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(6, 'ciclo opted_out retorna false', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select (select is_follow_up_active::text
          from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
          where commercial_opportunity_id = '%s'::uuid)$$,
        v.org_a,
        v.store_a,
        v.opp_history
      )
    );
    perform pg_temp._p9_followup_reader_record(7, 'ciclo terminal antigo e ciclo ativo novo retorna true', case when v_exec.operation_succeeded and v_exec.value_text = 'true' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(7, 'ciclo terminal antigo e ciclo ativo novo retorna true', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'postgres',
      null,
      format(
        $$insert into public.commercial_opportunity_followups (
            organization_id,
            store_id,
            commercial_opportunity_id,
            cycle,
            status,
            started_at,
            attempt_count
          ) values (
            '%s'::uuid,
            '%s'::uuid,
            '%s'::uuid,
            2,
            'active',
            now(),
            0
          ) returning id::text$$,
        v.org_a,
        v.store_a,
        v.opp_active
      )
    );
    perform pg_temp._p9_followup_reader_record(8, 'dois ciclos ativos simultaneos nao coexistem', case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '23505' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.message_text, '<null>'));
  exception when others then
    perform pg_temp._p9_followup_reader_record(8, 'dois ciclos ativos simultaneos nao coexistem', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select (select is_follow_up_active::text
          from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
          where commercial_opportunity_id = '%s'::uuid)$$,
        v.org_a,
        v.store_a,
        v.opp_none
      )
    );
    perform pg_temp._p9_followup_reader_record(9, 'followup de outra oportunidade nao contamina o card', case when v_exec.operation_succeeded and v_exec.value_text = 'false' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(9, 'followup de outra oportunidade nao contamina o card', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $sql$
          with source_scope as (
            select
              count(*) filter (
                where commercial_opportunity_id = '%s'::uuid
                  and is_follow_up_active = true
              ) as source_hits
            from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
          ),
          target_scope as (
            select
              count(*) filter (
                where commercial_opportunity_id = '%s'::uuid
              ) as target_other_hits,
              count(*) filter (
                where commercial_opportunity_id = '%s'::uuid
                  and is_follow_up_active = false
              ) as target_none_hits
            from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
          )
          select
            'source=' || source_scope.source_hits::text || ':true'
            || '|target_other=' || target_scope.target_other_hits::text
            || '|target_none=' || target_scope.target_none_hits::text || ':false'
          from source_scope
          cross join target_scope
        $sql$,
        v.opp_other_store,
        v.org_a,
        v.store_a2,
        v.opp_other_store,
        v.opp_none,
        v.org_a,
        v.store_a
      )
    );
    perform pg_temp._p9_followup_reader_record(10, 'followup de outra loja nao contamina o card', case when v_exec.operation_succeeded and v_exec.value_text = 'source=1:true|target_other=0|target_none=1:false' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(10, 'followup de outra loja nao contamina o card', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped('%s',null,500,0)
         where commercial_opportunity_id = '%s'::uuid$$,
        v.org_a,
        v.opp_other_org
      )
    );
    perform pg_temp._p9_followup_reader_record(11, 'followup de outra organizacao nao contamina o card', case when v_exec.operation_succeeded and v_exec.value_text = '0' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(11, 'followup de outra organizacao nao contamina o card', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select count(*)::text
          from (
            select commercial_opportunity_id
            from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
            where commercial_opportunity_id = '%s'::uuid
          ) scoped_rows$$,
        v.org_a,
        v.store_a,
        v.opp_history
      )
    );
    perform pg_temp._p9_followup_reader_record(12, 'varios ciclos nao duplicam cards', case when v_exec.operation_succeeded and v_exec.value_text = '1' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(12, 'varios ciclos nao duplicam cards', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $sql$
          with expected_rows as (
            select
              opportunity_row.id as commercial_opportunity_id,
              opportunity_row.updated_at
            from public.commercial_opportunities opportunity_row
            where opportunity_row.organization_id = '%s'::uuid
              and opportunity_row.store_id = '%s'::uuid
            order by opportunity_row.updated_at desc, opportunity_row.id
          ),
          expected_page_0 as (
            select expected_row.commercial_opportunity_id, expected_row.updated_at
            from expected_rows expected_row
            order by
              expected_row.updated_at desc,
              expected_row.commercial_opportunity_id
            limit 2
          ),
          expected_page_1 as (
            select expected_row.commercial_opportunity_id, expected_row.updated_at
            from expected_rows expected_row
            order by
              expected_row.updated_at desc,
              expected_row.commercial_opportunity_id
            offset 2
            limit 2
          ),
          expected_page_2 as (
            select expected_row.commercial_opportunity_id, expected_row.updated_at
            from expected_rows expected_row
            order by
              expected_row.updated_at desc,
              expected_row.commercial_opportunity_id
            offset 4
          ),
          actual_page_0 as (
            select rpc_row.commercial_opportunity_id, rpc_row.updated_at
            from public.panel_list_crm_opportunity_cards_scoped('%s','%s',2,0) rpc_row
            order by rpc_row.updated_at desc, rpc_row.commercial_opportunity_id
          ),
          actual_page_1 as (
            select rpc_row.commercial_opportunity_id, rpc_row.updated_at
            from public.panel_list_crm_opportunity_cards_scoped('%s','%s',2,2) rpc_row
            order by rpc_row.updated_at desc, rpc_row.commercial_opportunity_id
          ),
          actual_page_2 as (
            select rpc_row.commercial_opportunity_id, rpc_row.updated_at
            from public.panel_list_crm_opportunity_cards_scoped('%s','%s',20,4) rpc_row
            order by rpc_row.updated_at desc, rpc_row.commercial_opportunity_id
          ),
          combined_actual as (
            select actual_row.commercial_opportunity_id, actual_row.updated_at
            from actual_page_0 actual_row
            union all
            select actual_row.commercial_opportunity_id, actual_row.updated_at
            from actual_page_1 actual_row
            union all
            select actual_row.commercial_opportunity_id, actual_row.updated_at
            from actual_page_2 actual_row
          )
          select
            'total='
            || ((select count(*) from combined_actual) = (select count(*) from expected_rows))::text
            || '|page0='
            || ((select array_agg(actual_row.commercial_opportunity_id order by actual_row.updated_at desc, actual_row.commercial_opportunity_id) from actual_page_0 actual_row)
                is not distinct from
                (select array_agg(expected_row.commercial_opportunity_id order by expected_row.updated_at desc, expected_row.commercial_opportunity_id) from expected_page_0 expected_row))::text
            || '|page1='
            || ((select array_agg(actual_row.commercial_opportunity_id order by actual_row.updated_at desc, actual_row.commercial_opportunity_id) from actual_page_1 actual_row)
                is not distinct from
                (select array_agg(expected_row.commercial_opportunity_id order by expected_row.updated_at desc, expected_row.commercial_opportunity_id) from expected_page_1 expected_row))::text
            || '|page2='
            || ((select array_agg(actual_row.commercial_opportunity_id order by actual_row.updated_at desc, actual_row.commercial_opportunity_id) from actual_page_2 actual_row)
                is not distinct from
                (select array_agg(expected_row.commercial_opportunity_id order by expected_row.updated_at desc, expected_row.commercial_opportunity_id) from expected_page_2 expected_row))::text
            || '|distinct='
            || ((select count(distinct actual_row.commercial_opportunity_id) from combined_actual actual_row) = (select count(*) from expected_rows))::text
            || '|full='
            || ((select array_agg(actual_row.commercial_opportunity_id order by actual_row.updated_at desc, actual_row.commercial_opportunity_id) from combined_actual actual_row)
                is not distinct from
                (select array_agg(expected_row.commercial_opportunity_id order by expected_row.updated_at desc, expected_row.commercial_opportunity_id) from expected_rows expected_row))::text
          $sql$,
        v.org_a,
        v.store_a,
        v.org_a,
        v.store_a,
        v.org_a,
        v.store_a,
        v.org_a,
        v.store_a
      )
    );
    perform pg_temp._p9_followup_reader_record(13, 'quantidade e paginacao anteriores sao preservadas', case when v_exec.operation_succeeded and v_exec.value_text = 'total=true|page0=true|page1=true|page2=true|distinct=true|full=true' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(13, 'quantidade e paginacao anteriores sao preservadas', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select (
            select opportunity_stage
            from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
            where commercial_opportunity_id = '%s'::uuid
          )$$,
        v.org_a,
        v.store_a,
        v.opp_resolved
      )
    );
    perform pg_temp._p9_followup_reader_record(14, 'stage continua vindo apenas da oportunidade', case when v_exec.operation_succeeded and v_exec.value_text = 'negociacao' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(14, 'stage continua vindo apenas da oportunidade', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
         where commercial_opportunity_id = '%s'::uuid
           and opportunity_stage = 'perdido'$$,
        v.org_a,
        v.store_a,
        v.opp_lost
      )
    );
    perform pg_temp._p9_followup_reader_record(15, 'perdidos continuam separados', case when v_exec.operation_succeeded and v_exec.value_text = '1' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(15, 'perdidos continuam separados', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
         where commercial_opportunity_id = '%s'::uuid
           and opportunity_stage = 'concluido_sem_mais_acoes'$$,
        v.org_a,
        v.store_a,
        v.opp_completed
      )
    );
    perform pg_temp._p9_followup_reader_record(16, 'concluidos continuam separados', case when v_exec.operation_succeeded and v_exec.value_text = '1' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(16, 'concluidos continuam separados', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.outsider_user_id,
      format(
        $$select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)$$,
        v.org_a,
        v.store_a
      )
    );
    perform pg_temp._p9_followup_reader_record(17, 'usuario sem membership nao recebe linhas', case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.message_text, '<null>'));
  exception when others then
    perform pg_temp._p9_followup_reader_record(17, 'usuario sem membership nao recebe linhas', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $$select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)$$,
        v.org_b,
        v.store_b
      )
    );
    select * into v_retry from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_b_id,
      format(
        $$select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)$$,
        v.org_b,
        v.store_b
      )
    );
    perform pg_temp._p9_followup_reader_record(18, 'leitura cruzada entre organizacoes continua bloqueada', case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501' and v_retry.operation_succeeded and v_retry.value_text = '1' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.message_text, '<null>') || ' | member_b=' || coalesce(v_retry.value_text, coalesce(v_retry.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(18, 'leitura cruzada entre organizacoes continua bloqueada', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select has_function_privilege('anon', 'public.panel_list_crm_opportunity_cards_scoped(uuid,uuid,integer,integer)', 'EXECUTE') into v_status_ok;
    perform pg_temp._p9_followup_reader_record(19, 'anon nao executa a rpc', case when not v_status_ok then 'PASS' else 'SUT_FAIL' end, 'anon nao deve ter EXECUTE na RPC canonica');
  exception when others then
    perform pg_temp._p9_followup_reader_record(19, 'anon nao executa a rpc', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    perform pg_temp._p9_followup_reader_record(
      20,
      'contrato anterior das colunas permanece igual',
      case
        when exists (
          with proc_row as (
            select *
            from pg_catalog.pg_proc
            where oid = pg_catalog.to_regprocedure(
              'public.panel_list_crm_opportunity_cards_scoped(uuid,uuid,integer,integer)'
            )
          ),
          out_args as (
            select
              array_agg(arg.arg_name order by arg.ordinality) as arg_names,
              array_agg(arg.arg_type order by arg.ordinality) as arg_types
            from proc_row
            cross join lateral (
              select
                arg_names.arg_name,
                pg_catalog.format_type(arg_types.arg_type_oid, null) as arg_type,
                arg_types.ordinality
              from unnest(proc_row.proallargtypes) with ordinality as arg_types(arg_type_oid, ordinality)
              join unnest(proc_row.proargmodes) with ordinality as arg_modes(arg_mode, ordinality)
                on arg_modes.ordinality = arg_types.ordinality
              join unnest(proc_row.proargnames) with ordinality as arg_names(arg_name, ordinality)
                on arg_names.ordinality = arg_types.ordinality
              where arg_modes.arg_mode = 't'
            ) arg
          )
          select 1
          from out_args
          where arg_names = array[
            'commercial_opportunity_id',
            'organization_id',
            'store_id',
            'customer_id',
            'lead_id',
            'conversation_id',
            'name',
            'phone',
            'effective_state',
            'opportunity_stage',
            'lead_state',
            'conversation_status',
            'is_human_active',
            'stage_changed_at',
            'lifecycle_cycle',
            'created_at',
            'updated_at',
            'is_follow_up_active'
          ]
            and arg_types = array[
              'uuid',
              'uuid',
              'uuid',
              'uuid',
              'uuid',
              'uuid',
              'text',
              'text',
              'text',
              'text',
              'text',
              'text',
              'boolean',
              'timestamp with time zone',
              'integer',
              'timestamp with time zone',
              'timestamp with time zone',
              'boolean'
            ]
        ) then 'PASS'
        else 'SUT_FAIL'
      end,
      'as 17 colunas anteriores permanecem na mesma ordem e is_follow_up_active foi anexada ao final'
    );
  exception when others then
    perform pg_temp._p9_followup_reader_record(20, 'contrato anterior das colunas permanece igual', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select * into v_exec from pg_temp._p9_followup_reader_exec(
      'authenticated',
      v.member_user_a_id,
      format(
        $sql$
          with scoped_rows as (
            select is_follow_up_active
            from public.panel_list_crm_opportunity_cards_scoped('%s','%s',500,0)
          )
          select
            (
              coalesce(bool_and(is_follow_up_active is not null), false)::text
              || ':' ||
              pg_typeof((array_agg(is_follow_up_active))[1])::text
            )
          from scoped_rows
        $sql$,
        v.org_a,
        v.store_a
      )
    );
    perform pg_temp._p9_followup_reader_record(21, 'nova coluna e booleana e nunca nula', case when v_exec.operation_succeeded and v_exec.value_text = 'true:boolean' then 'PASS' else 'SUT_FAIL' end, coalesce(v_exec.value_text, coalesce(v_exec.message_text, '<null>')));
  exception when others then
    perform pg_temp._p9_followup_reader_record(21, 'nova coluna e booleana e nunca nula', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    perform pg_temp._p9_followup_reader_record(
      22,
      'nenhuma tabela antiga de followup e consultada',
      case
        when exists (
          with definition_row as (
            select proc_row.prosrc as definition_text
            from pg_catalog.pg_proc proc_row
            where proc_row.oid = pg_catalog.to_regprocedure(
              'public.panel_list_crm_opportunity_cards_scoped(uuid,uuid,integer,integer)'
            )
          )
          select 1
          from definition_row
          where (pg_catalog.length(definition_text) - pg_catalog.length(replace(definition_text, 'public.commercial_opportunity_followups', '')))
                / pg_catalog.length('public.commercial_opportunity_followups') = 1
            and position('public.commercial_opportunity_followup_events' in definition_text) = 0
            and position('schedule_post_appointment_followups' in definition_text) = 0
            and position('create_overdue_post_appointment_followups' in definition_text) = 0
            and position('enqueue_post_appointment_followups' in definition_text) = 0
            and position('panel_enqueue_followup_scoped' in definition_text) = 0
            and position('panel_list_followup_candidates_scoped' in definition_text) = 0
            and position('process_conservative_followup_offers_scoped' in definition_text) = 0
            and position('process_conservative_followup_visits_scoped' in definition_text) = 0
            and position('run_conservative_followup_cycle_scoped' in definition_text) = 0
            and position('ai_sales_real_handler_followup_offer' in definition_text) = 0
            and position('ai_sales_real_handler_followup_visit' in definition_text) = 0
        ) then 'PASS'
        else 'SUT_FAIL'
      end,
      'a definicao referencia apenas public.commercial_opportunity_followups como fonte de follow-up ativo'
    );
  exception when others then
    perform pg_temp._p9_followup_reader_record(22, 'nenhuma tabela antiga de followup e consultada', 'HARNESS_ERROR', sqlerrm);
  end;
end;
$scenarios$;

insert into pg_temp._p9_followup_reader_results (
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
from pg_temp._p9_followup_reader_matrix matrix_row
where not exists (
  select 1
  from pg_temp._p9_followup_reader_results result_row
  where result_row.scenario_number = matrix_row.scenario_number
);

select
  scenario_number,
  scenario_name,
  status,
  detail
from pg_temp._p9_followup_reader_results
order by scenario_number;

select
  count(*) as total_scenarios,
  count(*) filter (where status = 'PASS') as total_pass,
  count(*) filter (where status = 'SUT_FAIL') as sut_fail,
  0::bigint as total_blocked,
  count(*) filter (where status = 'HARNESS_ERROR') as harness_error,
  case
    when count(*) <> (select count(*) from pg_temp._p9_followup_reader_matrix) then 'AINDA_NAO_APROVADA'
    when count(*) filter (where status = 'PASS') <> (select count(*) from pg_temp._p9_followup_reader_matrix) then 'AINDA_NAO_APROVADA'
    when count(*) filter (where status = 'SUT_FAIL') > 0 then 'AINDA_NAO_APROVADA'
    when count(*) filter (where status = 'HARNESS_ERROR') > 0 then 'AINDA_NAO_APROVADA'
    else 'APROVADA'
  end as final_status
from pg_temp._p9_followup_reader_results;

rollback;
