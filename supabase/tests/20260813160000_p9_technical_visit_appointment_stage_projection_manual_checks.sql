begin;

create temp table pg_temp._p9_visit_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create function pg_temp._p9_visit_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_visit_results (
    scenario_number,
    scenario_name,
    status,
    details
  )
  values (
    p_scenario_number,
    p_scenario_name,
    p_status,
    p_details
  )
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      details = excluded.details;
end;
$function$;

create or replace function pg_temp._p9_visit_exec_json_sql(
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
  v_value_json jsonb;
  v_state text;
  v_message text;
  v_constraint text;
  v_operation_succeeded boolean := false;
begin
  if p_role is not null then
    execute format('set local role %I', p_role);
  end if;

  perform set_config('request.jwt.claim.role', coalesce(p_role, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config(
    'request.jwt.claims',
    case
      when p_role is null then '{}'::jsonb::text
      when p_user_id is null then jsonb_build_object('role', p_role)::text
      else jsonb_build_object('role', p_role, 'sub', p_user_id::text)::text
    end,
    true
  );

  begin
    execute format(
      'select to_jsonb(result_row) from (%s) as result_row',
      p_sql
    )
    into v_value_json;
    v_operation_succeeded := true;
  exception
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
    v_value_json,
    v_state,
    v_message,
    v_constraint;
end;
$function$;

create or replace function pg_temp._p9_visit_create_appointment_authenticated(
  p_user_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_title text,
  p_appointment_type text,
  p_status text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_address_text text,
  p_notes text,
  p_source text,
  p_created_by_user_id uuid,
  p_commercial_opportunity_id uuid
)
returns public.store_appointments
language plpgsql
as $function$
declare
  v_exec record;
  v_appointment public.store_appointments;
begin
  select *
  into v_exec
  from pg_temp._p9_visit_exec_json_sql(
    'authenticated',
    p_user_id,
    format(
      $sql$
        select *
        from public.create_store_appointment_with_commercial_context(
          %L::uuid,
          %L::uuid,
          %s,
          %s,
          %L,
          %L,
          %L,
          %L::timestamptz,
          %L::timestamptz,
          %s,
          %s,
          %s,
          %s,
          %L,
          %s,
          %s
        )
      $sql$,
      p_organization_id,
      p_store_id,
      case when p_lead_id is null then 'null::uuid' else format('%L::uuid', p_lead_id) end,
      case when p_conversation_id is null then 'null::uuid' else format('%L::uuid', p_conversation_id) end,
      p_title,
      p_appointment_type,
      p_status,
      p_scheduled_start,
      p_scheduled_end,
      case when p_customer_name is null then 'null::text' else format('%L::text', p_customer_name) end,
      case when p_customer_phone is null then 'null::text' else format('%L::text', p_customer_phone) end,
      case when p_address_text is null then 'null::text' else format('%L::text', p_address_text) end,
      case when p_notes is null then 'null::text' else format('%L::text', p_notes) end,
      p_source,
      case when p_created_by_user_id is null then 'null::uuid' else format('%L::uuid', p_created_by_user_id) end,
      case when p_commercial_opportunity_id is null then 'null::uuid' else format('%L::uuid', p_commercial_opportunity_id) end
    )
  );

  if not coalesce(v_exec.operation_succeeded, false) then
    raise exception using
      errcode = coalesce(v_exec.returned_sqlstate, 'P0001'),
      message = coalesce(v_exec.message_text, 'authenticated appointment wrapper failed');
  end if;

  select *
  into v_appointment
  from jsonb_populate_record(null::public.store_appointments, v_exec.value_json);

  return v_appointment;
end;
$function$;

create or replace function pg_temp._p9_visit_advance_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_appointment_id uuid,
  p_idempotency_key text,
  p_reason_details text,
  p_source text
)
returns table (
  commercial_opportunity_id uuid,
  appointment_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  stage_changed boolean,
  outcome text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
as $function$
declare
  v_exec record;
begin
  select *
  into v_exec
  from pg_temp._p9_visit_exec_json_sql(
    'service_role',
    null,
    format(
      $sql$
        select *
        from public.advance_commercial_opportunity_to_technical_visit_stage_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L,
          %L,
          %L
        )
      $sql$,
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id,
      p_appointment_id,
      p_idempotency_key,
      p_reason_details,
      p_source
    )
  );

  if not coalesce(v_exec.operation_succeeded, false) then
    raise exception using
      errcode = coalesce(v_exec.returned_sqlstate, 'P0001'),
      message = coalesce(v_exec.message_text, 'service-role technical visit writer failed');
  end if;

  return query
  select *
  from jsonb_to_record(v_exec.value_json) as result_row(
    commercial_opportunity_id uuid,
    appointment_id uuid,
    stage text,
    lifecycle_cycle integer,
    lifecycle_event_id uuid,
    event_type text,
    reason_code text,
    stage_changed boolean,
    outcome text,
    stage_changed_at timestamptz,
    updated_at timestamptz
  );
end;
$function$;

do $runner$
declare
  v_run_id uuid := gen_random_uuid();
  v_create_wrapper oid := pg_catalog.to_regprocedure(
    'public.create_store_appointment_with_commercial_context(uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid,uuid)'
  );
  v_writer_internal oid := pg_catalog.to_regprocedure(
    'public.advance_commercial_opportunity_to_technical_visit_stage_internal(uuid,uuid,uuid,uuid,text,text,text,text,uuid)'
  );
  v_writer_user oid := pg_catalog.to_regprocedure(
    'public.advance_commercial_opportunity_to_technical_visit_stage_by_user(uuid,uuid,uuid,uuid,text,text,text)'
  );
  v_writer_system oid := pg_catalog.to_regprocedure(
    'public.advance_commercial_opportunity_to_technical_visit_stage_by_system(uuid,uuid,uuid,uuid,text,text,text)'
  );
  v_create_definition text;
  v_writer_definition text;
  v_writer_internal_definition text;
  v_exec record;
  v_result record;
  v_event public.commercial_opportunity_lifecycle_events;
  v_event_qualificacao public.commercial_opportunity_lifecycle_events;
  v_event_orcamento public.commercial_opportunity_lifecycle_events;
  v_event_count bigint;
  v_event_count_after bigint;
  v_wrapper_appointment public.store_appointments;
  v_appointment_qualificacao public.store_appointments;
  v_appointment_orcamento public.store_appointments;
  v_appointment_visita public.store_appointments;
  v_appointment_negociacao public.store_appointments;
  v_appointment_fechamento public.store_appointments;
  v_appointment_instalacao public.store_appointments;
  v_appointment_pos_venda public.store_appointments;
  v_appointment_perdido public.store_appointments;
  v_appointment_concluido public.store_appointments;
  v_appointment_installation public.store_appointments;
  v_appointment_cancelled public.store_appointments;
  v_appointment_completed public.store_appointments;
  v_appointment_null_opp public.store_appointments;
  v_appointment_mismatch public.store_appointments;
  v_appointment_retry public.store_appointments;
  v_appointment_reschedule public.store_appointments;
  v_appointment_inference public.store_appointments;
  v_retry_first record;
  v_retry_second record;
  v_reschedule_first record;
  v_reschedule_second record;
  v_now timestamptz := now();
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_user_member_a uuid := gen_random_uuid();
  v_customer_a uuid := gen_random_uuid();
  v_customer_b uuid := gen_random_uuid();
  v_lead_perdido uuid := gen_random_uuid();
  v_conversation_perdido uuid := gen_random_uuid();
  v_loss_message jsonb;
  v_loss_message_id uuid;
  v_opp_novo_lead uuid := gen_random_uuid();
  v_opp_qualificacao uuid := gen_random_uuid();
  v_opp_orcamento uuid := gen_random_uuid();
  v_opp_visita uuid := gen_random_uuid();
  v_opp_negociacao uuid := gen_random_uuid();
  v_opp_fechamento uuid := gen_random_uuid();
  v_opp_instalacao uuid := gen_random_uuid();
  v_opp_pos_venda uuid := gen_random_uuid();
  v_opp_perdido uuid := gen_random_uuid();
  v_opp_concluido uuid := gen_random_uuid();
  v_opp_retry uuid := gen_random_uuid();
  v_opp_reschedule uuid := gen_random_uuid();
  v_opp_other_same_scope uuid := gen_random_uuid();
  v_opp_other_tenant uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name)
  values
    (v_org_a, 'Runner P9 Visit Org A ' || v_run_id::text),
    (v_org_b, 'Runner P9 Visit Org B ' || v_run_id::text);

  insert into public.stores (id, organization_id, name, created_at)
  values
    (v_store_a, v_org_a, 'Runner P9 Visit Store A ' || v_run_id::text, v_now),
    (v_store_b, v_org_b, 'Runner P9 Visit Store B ' || v_run_id::text, v_now);

  insert into auth.users (id)
  values (v_user_member_a);

  insert into public.memberships (organization_id, user_id, role, is_active)
  values (v_org_a, v_user_member_a, 'owner', true);

  insert into public.customers (id, organization_id, display_name, normalized_name)
  values
    (v_customer_a, v_org_a, 'Runner P9 Visit Customer A', 'runner-p9-visit-customer-a-' || replace(v_run_id::text, '-', '')),
    (v_customer_b, v_org_b, 'Runner P9 Visit Customer B', 'runner-p9-visit-customer-b-' || replace(v_run_id::text, '-', ''));

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  values
    (v_org_a, v_store_a, v_customer_a),
    (v_org_b, v_store_b, v_customer_b);

  insert into public.leads (
    id,
    organization_id,
    store_id,
    state,
    created_at,
    updated_at
  )
  values (
    v_lead_perdido,
    v_org_a,
    v_store_a,
    'qualificacao',
    v_now,
    v_now
  );

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
  values (
    v_conversation_perdido,
    v_org_a,
    v_lead_perdido,
    'qualificacao',
    false,
    null,
    '{}'::jsonb,
    v_now
  );

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
    (v_opp_novo_lead, v_org_a, v_store_a, v_customer_a, null, null, 'novo_lead'),
    (v_opp_qualificacao, v_org_a, v_store_a, v_customer_a, null, null, 'qualificacao'),
    (v_opp_orcamento, v_org_a, v_store_a, v_customer_a, null, null, 'orcamento'),
    (v_opp_visita, v_org_a, v_store_a, v_customer_a, null, null, 'visita_tecnica'),
    (v_opp_negociacao, v_org_a, v_store_a, v_customer_a, null, null, 'negociacao'),
    (v_opp_fechamento, v_org_a, v_store_a, v_customer_a, null, null, 'fechamento_pagamento'),
    (v_opp_instalacao, v_org_a, v_store_a, v_customer_a, null, null, 'instalacao_entrega'),
    (v_opp_pos_venda, v_org_a, v_store_a, v_customer_a, null, null, 'pos_venda'),
    (v_opp_perdido, v_org_a, v_store_a, v_customer_a, v_lead_perdido, v_conversation_perdido, 'qualificacao'),
    (v_opp_concluido, v_org_a, v_store_a, v_customer_a, null, null, 'negociacao'),
    (v_opp_retry, v_org_a, v_store_a, v_customer_a, null, null, 'qualificacao'),
    (v_opp_reschedule, v_org_a, v_store_a, v_customer_a, null, null, 'qualificacao'),
    (v_opp_other_same_scope, v_org_a, v_store_a, v_customer_a, null, null, 'qualificacao'),
    (v_opp_other_tenant, v_org_b, v_store_b, v_customer_b, null, null, 'qualificacao');

  perform public.link_lead_to_customer(
    v_org_a,
    v_store_a,
    v_lead_perdido,
    v_customer_a,
    'system',
    'system',
    null,
    null,
    'runner perdido lead/customer link',
    'runner:' || v_run_id::text || ':lead-perdido',
    v_run_id,
    jsonb_build_object('runner', 'p9.visit', 'fixture', 'lead_link_perdido'),
    null
  );

  select row_to_json(public.insert_message(
    v_conversation_perdido,
    'user',
    'incoming',
    'text',
    'runner perdido captured message ' || v_run_id::text,
    null,
    null,
    jsonb_build_object('runner_run_id', v_run_id::text, 'fixture', 'perdido_message')
  ))
  into v_loss_message;

  v_loss_message_id := (v_loss_message ->> 'id')::uuid;

  if v_loss_message_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'runner setup failed: perdido loss fixture prerequisites are null';
  end if;

  perform *
  from public.mark_commercial_opportunity_lost_by_system(
    v_org_a,
    v_store_a,
    v_opp_perdido,
    'runner-p9-visit-perdido-setup-loss',
    'explicit_refusal',
    v_loss_message_id,
    'runner perdido setup evidence',
    'system',
    'runner_visit_stage_setup'
  );

  perform *
  from public.conclude_commercial_opportunity_by_system(
    v_org_a,
    v_store_a,
    v_opp_concluido,
    'runner-p9-visit-concluido-setup',
    'runner concluido setup',
    'system_note',
    null::uuid,
    'runner concluido setup evidence',
    'runner_visit_stage_setup'
  );

  select lower(regexp_replace(pg_catalog.pg_get_functiondef(v_create_wrapper), '\s+', ' ', 'g'))
  into v_create_definition;

  select lower(regexp_replace(pg_catalog.pg_get_functiondef(v_writer_system), '\s+', ' ', 'g'))
  into v_writer_definition;

  begin
    if v_create_wrapper is not null
       and v_writer_user is not null
       and v_writer_system is not null then
      perform pg_temp._p9_visit_record(1, 'functions com assinaturas esperadas existem', 'PASS', 'wrapper, by_user e by_system encontrados');
    else
      perform pg_temp._p9_visit_record(1, 'functions com assinaturas esperadas existem', 'SUT_FAIL', 'assinaturas esperadas nao encontradas');
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(1, 'functions com assinaturas esperadas existem', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if v_create_wrapper is not null
       and v_writer_user is not null
       and v_writer_system is not null
       and pg_catalog.has_function_privilege('authenticated', v_create_wrapper, 'EXECUTE')
       and pg_catalog.has_function_privilege('service_role', v_create_wrapper, 'EXECUTE')
       and pg_catalog.has_function_privilege('authenticated', v_writer_user, 'EXECUTE')
       and not pg_catalog.has_function_privilege('service_role', v_writer_user, 'EXECUTE')
       and not pg_catalog.has_function_privilege('authenticated', v_writer_system, 'EXECUTE')
       and pg_catalog.has_function_privilege('service_role', v_writer_system, 'EXECUTE') then
      perform pg_temp._p9_visit_record(2, 'grants user/system corretos', 'PASS', 'wrapper auth+service_role; by_user auth; by_system service_role');
    else
      perform pg_temp._p9_visit_record(2, 'grants user/system corretos', 'SUT_FAIL', 'grants divergentes do contrato esperado');
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(2, 'grants user/system corretos', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec
    from pg_temp._p9_visit_exec_json_sql(
      'authenticated',
      null,
      format(
        $sql$
          select *
          from public.advance_commercial_opportunity_to_technical_visit_stage_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L
          )
        $sql$,
        v_org_a,
        v_store_a,
        v_opp_novo_lead,
        gen_random_uuid(),
        'runner-auth-denied',
        'authenticated nao pode chamar writer system',
        'system_technical_visit_stage_projection'
      )
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '42501' then
      perform pg_temp._p9_visit_record(3, 'authenticated nao chama writer system', 'PASS', 'acesso negado como esperado');
    else
      perform pg_temp._p9_visit_record(3, 'authenticated nao chama writer system', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'authenticated unexpectedly accepted'));
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(3, 'authenticated nao chama writer system', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_wrapper_appointment
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner wrapper novo lead',
      'technical_visit',
      'scheduled',
      v_now + interval '1 day',
      v_now + interval '1 day 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner wrapper',
      'panel',
      null,
      v_opp_novo_lead
    );

    if v_wrapper_appointment.id is not null
       and v_wrapper_appointment.commercial_opportunity_id = v_opp_novo_lead
       and v_create_definition like '%create_store_appointment(%' then
      perform pg_temp._p9_visit_record(4, 'wrapper reutiliza primitive canonica e persiste commercial_opportunity_id', 'PASS', 'appointment criado pelo wrapper e vinculo comercial persistido');
    else
      perform pg_temp._p9_visit_record(4, 'wrapper reutiliza primitive canonica e persiste commercial_opportunity_id', 'SUT_FAIL', 'wrapper nao comprovou create_store_appointment ou nao persistiu commercial_opportunity_id');
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(4, 'wrapper reutiliza primitive canonica e persiste commercial_opportunity_id', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_novo_lead;

    select *
    into v_result
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_novo_lead,
      v_wrapper_appointment.id,
      'technical_visit_stage_projection:' || v_wrapper_appointment.id::text || ':' || v_opp_novo_lead::text,
      'runner novo_lead',
      'system_technical_visit_stage_projection'
    );

    select *
    into v_event
    from public.commercial_opportunity_lifecycle_events
    where id = v_result.lifecycle_event_id;

    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_novo_lead;

    if v_result.outcome = 'advanced_to_visita_tecnica'
       and v_result.stage = 'visita_tecnica'
       and v_result.stage_changed is true
       and v_result.lifecycle_event_id is not null
       and v_event_count_after = v_event_count + 1 then
      perform pg_temp._p9_visit_record(5, 'novo_lead avanca para visita_tecnica', 'PASS', 'transicao executada com lifecycle unico');
    else
      perform pg_temp._p9_visit_record(5, 'novo_lead avanca para visita_tecnica', 'SUT_FAIL', coalesce(row_to_json(v_result)::text, 'resultado nulo'));
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(5, 'novo_lead avanca para visita_tecnica', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_qualificacao
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner qualificacao',
      'technical_visit',
      'scheduled',
      v_now + interval '2 days',
      v_now + interval '2 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner qualificacao',
      'panel',
      null,
      v_opp_qualificacao
    );

    select *
    into v_result
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_qualificacao,
      v_appointment_qualificacao.id,
      'technical_visit_stage_projection:' || v_appointment_qualificacao.id::text || ':' || v_opp_qualificacao::text,
      'runner qualificacao',
      'system_technical_visit_stage_projection'
    );

    select *
    into v_event_qualificacao
    from public.commercial_opportunity_lifecycle_events
    where id = v_result.lifecycle_event_id;

    if v_result.outcome = 'advanced_to_visita_tecnica'
       and v_result.stage = 'visita_tecnica'
       and v_result.stage_changed is true then
      perform pg_temp._p9_visit_record(6, 'qualificacao avanca para visita_tecnica', 'PASS', 'transicao executada');
    else
      perform pg_temp._p9_visit_record(6, 'qualificacao avanca para visita_tecnica', 'SUT_FAIL', coalesce(row_to_json(v_result)::text, 'resultado nulo'));
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(6, 'qualificacao avanca para visita_tecnica', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_orcamento
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner orcamento',
      'technical_visit',
      'scheduled',
      v_now + interval '3 days',
      v_now + interval '3 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner orcamento',
      'panel',
      null,
      v_opp_orcamento
    );

    select *
    into v_result
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_orcamento,
      v_appointment_orcamento.id,
      'technical_visit_stage_projection:' || v_appointment_orcamento.id::text || ':' || v_opp_orcamento::text,
      'runner orcamento',
      'system_technical_visit_stage_projection'
    );

    select *
    into v_event_orcamento
    from public.commercial_opportunity_lifecycle_events
    where id = v_result.lifecycle_event_id;

    if v_result.outcome = 'advanced_to_visita_tecnica'
       and v_result.stage = 'visita_tecnica'
       and v_result.stage_changed is true then
      perform pg_temp._p9_visit_record(7, 'orcamento avanca para visita_tecnica', 'PASS', 'transicao executada');
    else
      perform pg_temp._p9_visit_record(7, 'orcamento avanca para visita_tecnica', 'SUT_FAIL', coalesce(row_to_json(v_result)::text, 'resultado nulo'));
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(7, 'orcamento avanca para visita_tecnica', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_visita
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner visita',
      'technical_visit',
      'scheduled',
      v_now + interval '4 days',
      v_now + interval '4 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner visita',
      'panel',
      null,
      v_opp_visita
    );

    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_visita;

    select *
    into v_result
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_visita,
      v_appointment_visita.id,
      'technical_visit_stage_projection:' || v_appointment_visita.id::text || ':' || v_opp_visita::text,
      'runner visita',
      'system_technical_visit_stage_projection'
    );

    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_visita;

    if v_result.outcome = 'already_in_visit_stage'
       and v_result.stage = 'visita_tecnica'
       and v_result.stage_changed is false
       and v_result.lifecycle_event_id is null
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_visit_record(8, 'visita_tecnica retorna already_in_visit_stage sem lifecycle novo', 'PASS', 'no-op sem lifecycle adicional');
    else
      perform pg_temp._p9_visit_record(8, 'visita_tecnica retorna already_in_visit_stage sem lifecycle novo', 'SUT_FAIL', coalesce(row_to_json(v_result)::text, 'resultado nulo'));
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(8, 'visita_tecnica retorna already_in_visit_stage sem lifecycle novo', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_negociacao
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner negociacao',
      'technical_visit',
      'scheduled',
      v_now + interval '5 days',
      v_now + interval '5 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner negociacao',
      'panel',
      null,
      v_opp_negociacao
    );

    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_negociacao;

    select *
    into v_result
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_negociacao,
      v_appointment_negociacao.id,
      'technical_visit_stage_projection:' || v_appointment_negociacao.id::text || ':' || v_opp_negociacao::text,
      'runner negociacao',
      'system_technical_visit_stage_projection'
    );

    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_negociacao;

    if v_result.outcome = 'stage_not_eligible_for_automatic_visit_projection'
       and v_result.stage = 'negociacao'
       and v_result.stage_changed is false
       and v_result.lifecycle_event_id is null
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_visit_record(9, 'negociacao retorna skip sem regressao', 'PASS', 'stage posterior preservado');
    else
      perform pg_temp._p9_visit_record(9, 'negociacao retorna skip sem regressao', 'SUT_FAIL', coalesce(row_to_json(v_result)::text, 'resultado nulo'));
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(9, 'negociacao retorna skip sem regressao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_fechamento
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner fechamento',
      'technical_visit',
      'scheduled',
      v_now + interval '6 days',
      v_now + interval '6 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner fechamento',
      'panel',
      null,
      v_opp_fechamento
    );

    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_fechamento;

    select *
    into v_result
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_fechamento,
      v_appointment_fechamento.id,
      'technical_visit_stage_projection:' || v_appointment_fechamento.id::text || ':' || v_opp_fechamento::text,
      'runner fechamento',
      'system_technical_visit_stage_projection'
    );

    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_fechamento;

    if v_result.outcome = 'stage_not_eligible_for_automatic_visit_projection'
       and v_result.stage = 'fechamento_pagamento'
       and v_result.stage_changed is false
       and v_result.lifecycle_event_id is null
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_visit_record(10, 'fechamento_pagamento retorna skip sem regressao', 'PASS', 'stage posterior preservado');
    else
      perform pg_temp._p9_visit_record(10, 'fechamento_pagamento retorna skip sem regressao', 'SUT_FAIL', coalesce(row_to_json(v_result)::text, 'resultado nulo'));
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(10, 'fechamento_pagamento retorna skip sem regressao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_instalacao
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner instalacao',
      'technical_visit',
      'scheduled',
      v_now + interval '7 days',
      v_now + interval '7 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner instalacao',
      'panel',
      null,
      v_opp_instalacao
    );

    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_instalacao;

    select *
    into v_result
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_instalacao,
      v_appointment_instalacao.id,
      'technical_visit_stage_projection:' || v_appointment_instalacao.id::text || ':' || v_opp_instalacao::text,
      'runner instalacao',
      'system_technical_visit_stage_projection'
    );

    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_instalacao;

    if v_result.outcome = 'stage_not_eligible_for_automatic_visit_projection'
       and v_result.stage = 'instalacao_entrega'
       and v_result.stage_changed is false
       and v_result.lifecycle_event_id is null
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_visit_record(11, 'instalacao_entrega retorna skip sem regressao', 'PASS', 'stage posterior preservado');
    else
      perform pg_temp._p9_visit_record(11, 'instalacao_entrega retorna skip sem regressao', 'SUT_FAIL', coalesce(row_to_json(v_result)::text, 'resultado nulo'));
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(11, 'instalacao_entrega retorna skip sem regressao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_pos_venda
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner pos_venda',
      'technical_visit',
      'scheduled',
      v_now + interval '8 days',
      v_now + interval '8 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner pos_venda',
      'panel',
      null,
      v_opp_pos_venda
    );

    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_pos_venda;

    select *
    into v_result
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_pos_venda,
      v_appointment_pos_venda.id,
      'technical_visit_stage_projection:' || v_appointment_pos_venda.id::text || ':' || v_opp_pos_venda::text,
      'runner pos_venda',
      'system_technical_visit_stage_projection'
    );

    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_pos_venda;

    if v_result.outcome = 'stage_not_eligible_for_automatic_visit_projection'
       and v_result.stage = 'pos_venda'
       and v_result.stage_changed is false
       and v_result.lifecycle_event_id is null
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_visit_record(12, 'pos_venda retorna skip sem regressao', 'PASS', 'stage posterior preservado');
    else
      perform pg_temp._p9_visit_record(12, 'pos_venda retorna skip sem regressao', 'SUT_FAIL', coalesce(row_to_json(v_result)::text, 'resultado nulo'));
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(12, 'pos_venda retorna skip sem regressao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_perdido
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner perdido',
      'technical_visit',
      'scheduled',
      v_now + interval '9 days',
      v_now + interval '9 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner perdido',
      'panel',
      null,
      v_opp_perdido
    );

    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_perdido;

    select *
    into v_result
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_perdido,
      v_appointment_perdido.id,
      'technical_visit_stage_projection:' || v_appointment_perdido.id::text || ':' || v_opp_perdido::text,
      'runner perdido',
      'system_technical_visit_stage_projection'
    );

    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_perdido;

    if v_result.outcome = 'stage_not_eligible_for_automatic_visit_projection'
       and v_result.stage = 'perdido'
       and v_result.stage_changed is false
       and v_result.lifecycle_event_id is null
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_visit_record(13, 'perdido retorna skip sem regressao', 'PASS', 'stage terminal preservado');
    else
      perform pg_temp._p9_visit_record(13, 'perdido retorna skip sem regressao', 'SUT_FAIL', coalesce(row_to_json(v_result)::text, 'resultado nulo'));
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(13, 'perdido retorna skip sem regressao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_concluido
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner concluido',
      'technical_visit',
      'scheduled',
      v_now + interval '10 days',
      v_now + interval '10 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner concluido',
      'panel',
      null,
      v_opp_concluido
    );

    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_concluido;

    select *
    into v_result
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_concluido,
      v_appointment_concluido.id,
      'technical_visit_stage_projection:' || v_appointment_concluido.id::text || ':' || v_opp_concluido::text,
      'runner concluido',
      'system_technical_visit_stage_projection'
    );

    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_concluido;

    if v_result.outcome = 'stage_not_eligible_for_automatic_visit_projection'
       and v_result.stage = 'concluido_sem_mais_acoes'
       and v_result.stage_changed is false
       and v_result.lifecycle_event_id is null
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_visit_record(14, 'concluido_sem_mais_acoes retorna skip sem regressao', 'PASS', 'stage terminal preservado');
    else
      perform pg_temp._p9_visit_record(14, 'concluido_sem_mais_acoes retorna skip sem regressao', 'SUT_FAIL', coalesce(row_to_json(v_result)::text, 'resultado nulo'));
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(14, 'concluido_sem_mais_acoes retorna skip sem regressao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_installation
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner installation type',
      'installation',
      'scheduled',
      v_now + interval '11 days',
      v_now + interval '11 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner installation type',
      'panel',
      null,
      v_opp_other_same_scope
    );

    begin
      perform *
      from pg_temp._p9_visit_advance_by_system(
        v_org_a,
        v_store_a,
        v_opp_other_same_scope,
        v_appointment_installation.id,
        'technical_visit_stage_projection:' || v_appointment_installation.id::text || ':' || v_opp_other_same_scope::text,
        'runner invalid type',
        'system_technical_visit_stage_projection'
      );
      perform pg_temp._p9_visit_record(15, 'appointment type diferente de technical_visit nao projeta', 'SUT_FAIL', 'writer aceitou appointment type installation');
    exception
      when sqlstate '23514' then
        perform pg_temp._p9_visit_record(15, 'appointment type diferente de technical_visit nao projeta', 'PASS', 'writer rejeitou appointment type nao elegivel');
    end;
  exception
    when others then
      perform pg_temp._p9_visit_record(15, 'appointment type diferente de technical_visit nao projeta', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_cancelled
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner cancelled',
      'technical_visit',
      'cancelled',
      v_now + interval '12 days',
      v_now + interval '12 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner cancelled',
      'panel',
      null,
      v_opp_other_same_scope
    );

    begin
      perform *
      from pg_temp._p9_visit_advance_by_system(
        v_org_a,
        v_store_a,
        v_opp_other_same_scope,
        v_appointment_cancelled.id,
        'technical_visit_stage_projection:' || v_appointment_cancelled.id::text || ':' || v_opp_other_same_scope::text,
        'runner cancelled',
        'system_technical_visit_stage_projection'
      );
      perform pg_temp._p9_visit_record(16, 'technical_visit cancelled nao projeta', 'SUT_FAIL', 'writer aceitou technical_visit cancelled');
    exception
      when sqlstate '23514' then
        perform pg_temp._p9_visit_record(16, 'technical_visit cancelled nao projeta', 'PASS', 'writer rejeitou status cancelled');
    end;
  exception
    when others then
      perform pg_temp._p9_visit_record(16, 'technical_visit cancelled nao projeta', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_completed
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner completed',
      'technical_visit',
      'completed',
      v_now + interval '13 days',
      v_now + interval '13 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner completed',
      'panel',
      null,
      v_opp_other_same_scope
    );

    begin
      perform *
      from pg_temp._p9_visit_advance_by_system(
        v_org_a,
        v_store_a,
        v_opp_other_same_scope,
        v_appointment_completed.id,
        'technical_visit_stage_projection:' || v_appointment_completed.id::text || ':' || v_opp_other_same_scope::text,
        'runner completed',
        'system_technical_visit_stage_projection'
      );
      perform pg_temp._p9_visit_record(17, 'technical_visit completed nao projeta', 'SUT_FAIL', 'writer aceitou technical_visit completed');
    exception
      when sqlstate '23514' then
        perform pg_temp._p9_visit_record(17, 'technical_visit completed nao projeta', 'PASS', 'writer rejeitou status completed');
    end;
  exception
    when others then
      perform pg_temp._p9_visit_record(17, 'technical_visit completed nao projeta', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_null_opp
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner null opp',
      'technical_visit',
      'scheduled',
      v_now + interval '14 days',
      v_now + interval '14 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner null opp',
      'panel',
      null,
      null
    );

    begin
      perform *
      from pg_temp._p9_visit_advance_by_system(
        v_org_a,
        v_store_a,
        v_opp_other_same_scope,
        v_appointment_null_opp.id,
        'technical_visit_stage_projection:' || v_appointment_null_opp.id::text || ':' || v_opp_other_same_scope::text,
        'runner null opp',
        'system_technical_visit_stage_projection'
      );
      perform pg_temp._p9_visit_record(18, 'appointment sem commercial_opportunity_id nao projeta', 'SUT_FAIL', 'writer aceitou appointment sem commercial_opportunity_id');
    exception
      when sqlstate '23514' then
        perform pg_temp._p9_visit_record(18, 'appointment sem commercial_opportunity_id nao projeta', 'PASS', 'writer rejeitou appointment sem vinculo comercial');
    end;
  exception
    when others then
      perform pg_temp._p9_visit_record(18, 'appointment sem commercial_opportunity_id nao projeta', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_mismatch
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner mismatch',
      'technical_visit',
      'scheduled',
      v_now + interval '15 days',
      v_now + interval '15 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner mismatch',
      'panel',
      null,
      v_opp_other_same_scope
    );

    begin
      perform *
      from pg_temp._p9_visit_advance_by_system(
        v_org_a,
        v_store_a,
        v_opp_novo_lead,
        v_appointment_mismatch.id,
        'technical_visit_stage_projection:' || v_appointment_mismatch.id::text || ':' || v_opp_novo_lead::text,
        'runner mismatch',
        'system_technical_visit_stage_projection'
      );
      perform pg_temp._p9_visit_record(19, 'appointment vinculado a opportunity diferente e rejeitado', 'SUT_FAIL', 'writer aceitou appointment ligado a outra opportunity');
    exception
      when sqlstate '23514' then
        perform pg_temp._p9_visit_record(19, 'appointment vinculado a opportunity diferente e rejeitado', 'PASS', 'writer rejeitou mismatch appointment/opportunity');
    end;
  exception
    when others then
      perform pg_temp._p9_visit_record(19, 'appointment vinculado a opportunity diferente e rejeitado', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    begin
      perform *
      from pg_temp._p9_visit_advance_by_system(
        v_org_b,
        v_store_b,
        v_opp_other_tenant,
        v_appointment_mismatch.id,
        'technical_visit_stage_projection:' || v_appointment_mismatch.id::text || ':' || v_opp_other_tenant::text,
        'runner cross tenant',
        'system_technical_visit_stage_projection'
      );
      perform pg_temp._p9_visit_record(20, 'cross-tenant e cross-store sao rejeitados', 'SUT_FAIL', 'writer aceitou appointment fora do tenant/store');
    exception
      when sqlstate '23514' then
        perform pg_temp._p9_visit_record(20, 'cross-tenant e cross-store sao rejeitados', 'PASS', 'writer rejeitou mismatch de tenant/store');
    end;
  exception
    when others then
      perform pg_temp._p9_visit_record(20, 'cross-tenant e cross-store sao rejeitados', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_retry
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner retry',
      'technical_visit',
      'scheduled',
      v_now + interval '16 days',
      v_now + interval '16 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner retry',
      'panel',
      null,
      v_opp_retry
    );

    select *
    into v_retry_first
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_retry,
      v_appointment_retry.id,
      'technical_visit_stage_projection:' || v_appointment_retry.id::text || ':' || v_opp_retry::text,
      'runner retry',
      'system_technical_visit_stage_projection'
    );

    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_retry;

    select *
    into v_retry_second
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_retry,
      v_appointment_retry.id,
      'technical_visit_stage_projection:' || v_appointment_retry.id::text || ':' || v_opp_retry::text,
      'runner retry',
      'system_technical_visit_stage_projection'
    );

    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_retry;

    if v_retry_first.outcome = 'advanced_to_visita_tecnica'
       and v_retry_second.outcome = 'idempotent_replay'
       and v_retry_second.lifecycle_event_id = v_retry_first.lifecycle_event_id
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_visit_record(21, 'retry do mesmo appointment nao duplica lifecycle', 'PASS', 'replay devolveu o mesmo lifecycle_event_id sem duplicacao');
    else
      perform pg_temp._p9_visit_record(21, 'retry do mesmo appointment nao duplica lifecycle', 'SUT_FAIL', coalesce(row_to_json(v_retry_second)::text, 'resultado nulo'));
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(21, 'retry do mesmo appointment nao duplica lifecycle', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_reschedule
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner reschedule',
      'technical_visit',
      'scheduled',
      v_now + interval '17 days',
      v_now + interval '17 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner reschedule',
      'panel',
      null,
      v_opp_reschedule
    );

    select *
    into v_reschedule_first
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_reschedule,
      v_appointment_reschedule.id,
      'technical_visit_stage_projection:' || v_appointment_reschedule.id::text || ':' || v_opp_reschedule::text,
      'runner reschedule',
      'system_technical_visit_stage_projection'
    );

    update public.store_appointments
    set status = 'rescheduled',
        scheduled_start = v_now + interval '18 days',
        scheduled_end = v_now + interval '18 days 1 hour'
    where id = v_appointment_reschedule.id;

    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_reschedule;

    select *
    into v_reschedule_second
    from pg_temp._p9_visit_advance_by_system(
      v_org_a,
      v_store_a,
      v_opp_reschedule,
      v_appointment_reschedule.id,
      'technical_visit_stage_projection:' || v_appointment_reschedule.id::text || ':' || v_opp_reschedule::text,
      'runner reschedule',
      'system_technical_visit_stage_projection'
    );

    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v_opp_reschedule;

    if v_reschedule_first.outcome = 'advanced_to_visita_tecnica'
       and v_reschedule_second.outcome = 'idempotent_replay'
       and v_reschedule_second.lifecycle_event_id = v_reschedule_first.lifecycle_event_id
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_visit_record(22, 'reschedule do mesmo appointment com mesma key nao duplica lifecycle', 'PASS', 'remarcacao preservou replay idempotente');
    else
      perform pg_temp._p9_visit_record(22, 'reschedule do mesmo appointment com mesma key nao duplica lifecycle', 'SUT_FAIL', coalesce(row_to_json(v_reschedule_second)::text, 'resultado nulo'));
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(22, 'reschedule do mesmo appointment com mesma key nao duplica lifecycle', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if v_event.previous_stage = 'novo_lead'
       and v_event.new_stage = 'visita_tecnica'
       and v_event.reason_code = 'visit_eligibility_required'
       and v_event.evidence_type = 'technical_visit_scheduled'
       and v_event.evidence_summary = 'appointment_id=' || v_wrapper_appointment.id::text
       and v_event.actor_type = 'system'
       and v_event.actor_user_id is null
       and v_event.idempotency_key = 'technical_visit_stage_projection:' || v_wrapper_appointment.id::text || ':' || v_opp_novo_lead::text
       and v_event_qualificacao.previous_stage = 'qualificacao'
       and v_event_qualificacao.new_stage = 'visita_tecnica'
       and v_event_qualificacao.reason_code = 'visit_eligibility_required'
       and v_event_qualificacao.evidence_type = 'technical_visit_scheduled'
       and v_event_qualificacao.evidence_summary = 'appointment_id=' || v_appointment_qualificacao.id::text
       and v_event_qualificacao.actor_type = 'system'
       and v_event_qualificacao.actor_user_id is null
       and v_event_qualificacao.idempotency_key = 'technical_visit_stage_projection:' || v_appointment_qualificacao.id::text || ':' || v_opp_qualificacao::text then
      perform pg_temp._p9_visit_record(23, 'reason e evidence corretos para novo_lead e qualificacao', 'PASS', 'reason_code, evidence_type, evidence_summary, actor e idempotency conferem');
    else
      perform pg_temp._p9_visit_record(23, 'reason e evidence corretos para novo_lead e qualificacao', 'SUT_FAIL', 'lifecycle de novo_lead/qualificacao nao corresponde ao contrato');
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(23, 'reason e evidence corretos para novo_lead e qualificacao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if v_event_orcamento.previous_stage = 'orcamento'
       and v_event_orcamento.new_stage = 'visita_tecnica'
       and v_event_orcamento.reason_code = 'visit_required_or_eligible'
       and v_event_orcamento.evidence_type = 'technical_visit_scheduled'
       and v_event_orcamento.evidence_summary = 'appointment_id=' || v_appointment_orcamento.id::text
       and v_event_orcamento.actor_type = 'system'
       and v_event_orcamento.actor_user_id is null
       and v_event_orcamento.idempotency_key = 'technical_visit_stage_projection:' || v_appointment_orcamento.id::text || ':' || v_opp_orcamento::text then
      perform pg_temp._p9_visit_record(24, 'reason correto para orcamento', 'PASS', 'visit_required_or_eligible aplicado corretamente');
    else
      perform pg_temp._p9_visit_record(24, 'reason correto para orcamento', 'SUT_FAIL', 'lifecycle de orcamento nao corresponde ao contrato');
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(24, 'reason correto para orcamento', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if v_writer_definition not like '%mandatory_visit_pending%' then
      perform pg_temp._p9_visit_record(25, 'mandatory_visit_pending nao e usado no writer automatico', 'PASS', 'writer especializado nao reutiliza reason_code proibido');
    else
      perform pg_temp._p9_visit_record(25, 'mandatory_visit_pending nao e usado no writer automatico', 'SUT_FAIL', 'writer referencia mandatory_visit_pending');
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(25, 'mandatory_visit_pending nao e usado no writer automatico', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select lower(regexp_replace(pg_catalog.pg_get_functiondef(v_writer_internal), '\s+', ' ', 'g'))
    into v_writer_internal_definition;

    if v_writer_internal_definition like '%for update%' then
      perform pg_temp._p9_visit_record(26, 'writer contem protecao de lock for update', 'PASS', 'for update presente na opportunity lockada');
    else
      perform pg_temp._p9_visit_record(26, 'writer contem protecao de lock for update', 'SUT_FAIL', 'for update ausente do writer especializado');
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(26, 'writer contem protecao de lock for update', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_appointment_inference
    from pg_temp._p9_visit_create_appointment_authenticated(
      v_user_member_a,
      v_org_a,
      v_store_a,
      null,
      null,
      'Runner inference guard',
      'technical_visit',
      'scheduled',
      v_now + interval '19 days',
      v_now + interval '19 days 1 hour',
      'Runner A',
      null,
      'Endereco A',
      'runner inference guard',
      'panel',
      null,
      v_opp_other_same_scope
    );

    if v_appointment_inference.commercial_opportunity_id = v_opp_other_same_scope
       and v_create_definition not like '%latest%'
       and v_create_definition not like '%first%'
       and v_create_definition not like '%updated_at%'
       and v_create_definition not like '%order by%' then
      perform pg_temp._p9_visit_record(27, 'fluxo automatico nao depende de inferencia latest/first opportunity', 'PASS', 'wrapper preservou opportunity explicita mesmo com mais de uma candidate');
    else
      perform pg_temp._p9_visit_record(27, 'fluxo automatico nao depende de inferencia latest/first opportunity', 'SUT_FAIL', 'wrapper nao preservou explicitness ou contem heuristica textual proibida');
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(27, 'fluxo automatico nao depende de inferencia latest/first opportunity', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if txid_current_if_assigned() is not null then
      perform pg_temp._p9_visit_record(28, 'fixtures ficam contidas em transaction com rollback final', 'PASS', 'runner executado dentro de transaction explicita; rollback final preserva ambiente');
    else
      perform pg_temp._p9_visit_record(28, 'fixtures ficam contidas em transaction com rollback final', 'SUT_FAIL', 'transaction explicita nao detectada');
    end if;
  exception
    when others then
      perform pg_temp._p9_visit_record(28, 'fixtures ficam contidas em transaction com rollback final', 'HARNESS_ERROR', sqlerrm);
  end;
end;
$runner$;

table pg_temp._p9_visit_results
order by scenario_number;

do $gate$
declare
  v_total_count integer;
  v_failed_count integer;
  v_failed_details text;
begin
  select count(*)
  into v_total_count
  from pg_temp._p9_visit_results;

  if v_total_count <> 28 then
    raise exception using
      errcode = 'P0001',
      message = format('manual check failed: expected 28 scenarios but found %s', v_total_count);
  end if;

  select count(*)
  into v_failed_count
  from pg_temp._p9_visit_results
  where status <> 'PASS';

  if v_failed_count <> 0 then
    select string_agg(
             format(
               '[%s] %s | %s | %s',
               lpad(result_row.scenario_number::text, 2, '0'),
               result_row.scenario_name,
               result_row.status,
               coalesce(result_row.details, '<null>')
             ),
             E'\n'
             order by result_row.scenario_number
           )
    into v_failed_details
    from pg_temp._p9_visit_results result_row
    where result_row.status <> 'PASS';

    raise exception using
      errcode = 'P0001',
      message = format(
        'manual check failed: %s scenario(s) did not PASS%s%s',
        v_failed_count,
        E'\n',
        coalesce(v_failed_details, '<no failure details captured>')
      );
  end if;
end;
$gate$;

rollback;
