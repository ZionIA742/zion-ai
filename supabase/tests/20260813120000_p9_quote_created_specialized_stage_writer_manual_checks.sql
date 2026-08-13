begin;

create temp table pg_temp._p9_24_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create function pg_temp._p9_24_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_24_results (
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

create or replace function pg_temp._p9_24_exec_json_sql(
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

create temp table pg_temp._p9_24_ctx (
  run_id uuid not null,
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b uuid not null,
  customer_a uuid not null,
  customer_b uuid not null,
  opp_novo_lead uuid not null,
  opp_qualificacao uuid not null,
  opp_orcamento uuid not null,
  opp_visita uuid not null,
  opp_negociacao uuid not null,
  opp_fechamento uuid not null,
  opp_instalacao uuid not null,
  opp_pos_venda uuid not null,
  opp_perdido uuid not null,
  opp_concluido uuid not null,
  opp_retry uuid not null,
  opp_race uuid not null,
  opp_other_same_scope uuid not null,
  opp_other_tenant uuid not null,
  quote_novo_lead uuid not null,
  quote_qualificacao uuid not null,
  quote_orcamento uuid not null,
  quote_visita uuid not null,
  quote_negociacao uuid not null,
  quote_fechamento uuid not null,
  quote_instalacao uuid not null,
  quote_pos_venda uuid not null,
  quote_perdido uuid not null,
  quote_concluido uuid not null,
  quote_retry uuid not null,
  quote_race uuid not null,
  quote_other_same_scope uuid not null,
  quote_other_tenant uuid not null,
  quote_null_opportunity uuid not null
);

do $setup$
declare
  v_run_id uuid := gen_random_uuid();
  v_lead_perdido uuid := gen_random_uuid();
  v_conversation_perdido uuid := gen_random_uuid();
  v_loss_message_id uuid;
  v_link jsonb;
  v_message jsonb;
begin
  insert into pg_temp._p9_24_ctx (
    run_id,
    org_a,
    org_b,
    store_a,
    store_b,
    customer_a,
    customer_b,
    opp_novo_lead,
    opp_qualificacao,
    opp_orcamento,
    opp_visita,
    opp_negociacao,
    opp_fechamento,
    opp_instalacao,
    opp_pos_venda,
    opp_perdido,
    opp_concluido,
    opp_retry,
    opp_race,
    opp_other_same_scope,
    opp_other_tenant,
    quote_novo_lead,
    quote_qualificacao,
    quote_orcamento,
    quote_visita,
    quote_negociacao,
    quote_fechamento,
    quote_instalacao,
    quote_pos_venda,
    quote_perdido,
    quote_concluido,
    quote_retry,
    quote_race,
    quote_other_same_scope,
    quote_other_tenant,
    quote_null_opportunity
  )
  values (
    v_run_id,
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

  insert into public.organizations (id, name)
  select ctx.org_a, 'Runner P9.24 Org A ' || ctx.run_id::text
  from pg_temp._p9_24_ctx ctx
  union all
  select ctx.org_b, 'Runner P9.24 Org B ' || ctx.run_id::text
  from pg_temp._p9_24_ctx ctx;

  insert into public.stores (id, organization_id, name, created_at)
  select ctx.store_a, ctx.org_a, 'Runner P9.24 Store A ' || ctx.run_id::text, now()
  from pg_temp._p9_24_ctx ctx
  union all
  select ctx.store_b, ctx.org_b, 'Runner P9.24 Store B ' || ctx.run_id::text, now()
  from pg_temp._p9_24_ctx ctx;

  insert into public.customers (id, organization_id, display_name, normalized_name)
  select ctx.customer_a, ctx.org_a, 'Runner P9.24 Customer A', 'runner-p9-24-customer-a'
  from pg_temp._p9_24_ctx ctx
  union all
  select ctx.customer_b, ctx.org_b, 'Runner P9.24 Customer B', 'runner-p9-24-customer-b'
  from pg_temp._p9_24_ctx ctx;

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  select ctx.org_a, ctx.store_a, ctx.customer_a
  from pg_temp._p9_24_ctx ctx
  union all
  select ctx.org_b, ctx.store_b, ctx.customer_b
  from pg_temp._p9_24_ctx ctx;

  insert into public.leads (
    id,
    organization_id,
    store_id,
    state,
    created_at,
    updated_at
  )
  select
    v_lead_perdido,
    ctx.org_a,
    ctx.store_a,
    'qualificacao',
    now(),
    now()
  from pg_temp._p9_24_ctx ctx;

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
  select
    v_conversation_perdido,
    ctx.org_a,
    v_lead_perdido,
    'qualificacao',
    false,
    null,
    '{}'::jsonb,
    now()
  from pg_temp._p9_24_ctx ctx;

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    origin_lead_id,
    primary_conversation_id,
    stage
  )
  select ctx.opp_novo_lead, ctx.org_a, ctx.store_a, ctx.customer_a, null::uuid, null::uuid, 'novo_lead' from pg_temp._p9_24_ctx ctx
  union all
  select ctx.opp_qualificacao, ctx.org_a, ctx.store_a, ctx.customer_a, null::uuid, null::uuid, 'qualificacao' from pg_temp._p9_24_ctx ctx
  union all
  select ctx.opp_orcamento, ctx.org_a, ctx.store_a, ctx.customer_a, null::uuid, null::uuid, 'orcamento' from pg_temp._p9_24_ctx ctx
  union all
  select ctx.opp_visita, ctx.org_a, ctx.store_a, ctx.customer_a, null::uuid, null::uuid, 'visita_tecnica' from pg_temp._p9_24_ctx ctx
  union all
  select ctx.opp_negociacao, ctx.org_a, ctx.store_a, ctx.customer_a, null::uuid, null::uuid, 'negociacao' from pg_temp._p9_24_ctx ctx
  union all
  select ctx.opp_fechamento, ctx.org_a, ctx.store_a, ctx.customer_a, null::uuid, null::uuid, 'fechamento_pagamento' from pg_temp._p9_24_ctx ctx
  union all
  select ctx.opp_instalacao, ctx.org_a, ctx.store_a, ctx.customer_a, null::uuid, null::uuid, 'instalacao_entrega' from pg_temp._p9_24_ctx ctx
  union all
  select ctx.opp_pos_venda, ctx.org_a, ctx.store_a, ctx.customer_a, null::uuid, null::uuid, 'pos_venda' from pg_temp._p9_24_ctx ctx
  union all
  select ctx.opp_perdido, ctx.org_a, ctx.store_a, ctx.customer_a, v_lead_perdido, v_conversation_perdido, 'qualificacao' from pg_temp._p9_24_ctx ctx
  union all
  select ctx.opp_concluido, ctx.org_a, ctx.store_a, ctx.customer_a, null::uuid, null::uuid, 'concluido_sem_mais_acoes' from pg_temp._p9_24_ctx ctx
  union all
  select ctx.opp_retry, ctx.org_a, ctx.store_a, ctx.customer_a, null::uuid, null::uuid, 'qualificacao' from pg_temp._p9_24_ctx ctx
  union all
  select ctx.opp_race, ctx.org_a, ctx.store_a, ctx.customer_a, null::uuid, null::uuid, 'qualificacao' from pg_temp._p9_24_ctx ctx
  union all
  select ctx.opp_other_same_scope, ctx.org_a, ctx.store_a, ctx.customer_a, null::uuid, null::uuid, 'qualificacao' from pg_temp._p9_24_ctx ctx
  union all
  select ctx.opp_other_tenant, ctx.org_b, ctx.store_b, ctx.customer_b, null::uuid, null::uuid, 'qualificacao' from pg_temp._p9_24_ctx ctx;

  insert into public.sales_quotes (
    id,
    organization_id,
    store_id,
    conversation_id,
    lead_id,
    quote_number,
    title,
    status,
    customer_name,
    customer_phone,
    customer_notes,
    internal_notes,
    subtotal_cents,
    discount_cents,
    total_cents,
    current_version_id,
    metadata,
    commercial_opportunity_id
  )
  select ctx.quote_novo_lead, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_novo_lead::text, '-', ''), 'Quote novo_lead', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'novo_lead'), ctx.opp_novo_lead from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_qualificacao, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_qualificacao::text, '-', ''), 'Quote qualificacao', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'qualificacao'), ctx.opp_qualificacao from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_orcamento, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_orcamento::text, '-', ''), 'Quote orcamento', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'orcamento'), ctx.opp_orcamento from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_visita, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_visita::text, '-', ''), 'Quote visita', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'visita'), ctx.opp_visita from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_negociacao, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_negociacao::text, '-', ''), 'Quote negociacao', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'negociacao'), ctx.opp_negociacao from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_fechamento, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_fechamento::text, '-', ''), 'Quote fechamento', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'fechamento'), ctx.opp_fechamento from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_instalacao, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_instalacao::text, '-', ''), 'Quote instalacao', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'instalacao'), ctx.opp_instalacao from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_pos_venda, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_pos_venda::text, '-', ''), 'Quote pos_venda', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'pos_venda'), ctx.opp_pos_venda from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_perdido, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_perdido::text, '-', ''), 'Quote perdido', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'perdido'), ctx.opp_perdido from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_concluido, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_concluido::text, '-', ''), 'Quote concluido', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'concluido'), ctx.opp_concluido from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_retry, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_retry::text, '-', ''), 'Quote retry', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'retry'), ctx.opp_retry from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_race, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_race::text, '-', ''), 'Quote race', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'race'), ctx.opp_race from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_other_same_scope, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_other_same_scope::text, '-', ''), 'Quote other same scope', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'other_same_scope'), ctx.opp_other_same_scope from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_other_tenant, ctx.org_b, ctx.store_b, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_other_tenant::text, '-', ''), 'Quote other tenant', 'draft', 'Runner B', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'other_tenant'), ctx.opp_other_tenant from pg_temp._p9_24_ctx ctx
  union all
  select ctx.quote_null_opportunity, ctx.org_a, ctx.store_a, null::uuid, null::uuid, 'Q-' || replace(ctx.quote_null_opportunity::text, '-', ''), 'Quote null opportunity', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null::uuid, jsonb_build_object('runner', 'p9.24', 'case', 'null_opportunity'), null::uuid from pg_temp._p9_24_ctx ctx;

  select row_to_json(public.link_lead_to_customer(
    ctx.org_a,
    ctx.store_a,
    v_lead_perdido,
    ctx.customer_a,
    'system',
    'system',
    null,
    null,
    'runner perdido lead/customer link',
    'runner:' || ctx.run_id::text || ':lead-perdido',
    ctx.run_id,
    jsonb_build_object('runner', 'p9.24', 'fixture', 'lead_link_perdido'),
    null
  ))
  into v_link
  from pg_temp._p9_24_ctx ctx;

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
  into v_message;

  v_loss_message_id := (v_message ->> 'id')::uuid;

  if v_link is null or v_loss_message_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'runner setup failed: perdido loss fixture prerequisites are null';
  end if;

  perform *
  from public.mark_commercial_opportunity_lost_by_system(
    (select ctx.org_a from pg_temp._p9_24_ctx ctx),
    (select ctx.store_a from pg_temp._p9_24_ctx ctx),
    (select ctx.opp_perdido from pg_temp._p9_24_ctx ctx),
    'runner-p924-perdido-setup-loss',
    'explicit_refusal',
    v_loss_message_id,
    'runner perdido setup evidence',
    'system',
    'runner_quote_created_setup'
  );
end;
$setup$;

do $checks$
declare
  v pg_temp._p9_24_ctx%rowtype;
  v_exec record;
  v_event record;
  v_event_count bigint;
  v_event_count_after bigint;
  v_cycle_before integer;
  v_cycle_after integer;
  v_loss_projection_before record;
  v_loss_projection_after record;
  v_proc_oid oid;
begin
  select * into v from pg_temp._p9_24_ctx limit 1;

  begin
    v_proc_oid := pg_catalog.to_regprocedure(
      'public.advance_commercial_opportunity_to_quote_stage_by_system(uuid,uuid,uuid,uuid,text,text,text)'
    );

    if v_proc_oid is not null then
      perform pg_temp._p9_24_record(1, 'funcao especializada existe com assinatura esperada', 'PASS', 'assinatura encontrada');
    else
      perform pg_temp._p9_24_record(1, 'funcao especializada existe com assinatura esperada', 'SUT_FAIL', 'assinatura nao encontrada');
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(1, 'funcao especializada existe com assinatura esperada', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if v_proc_oid is not null
       and pg_catalog.has_function_privilege('service_role', v_proc_oid, 'EXECUTE')
       and not pg_catalog.has_function_privilege('authenticated', v_proc_oid, 'EXECUTE')
       and not pg_catalog.has_function_privilege('anon', v_proc_oid, 'EXECUTE') then
      perform pg_temp._p9_24_record(2, 'grants da funcao especializada estao corretos', 'PASS', 'apenas service_role possui execute');
    else
      perform pg_temp._p9_24_record(2, 'grants da funcao especializada estao corretos', 'SUT_FAIL', 'grants divergentes do contrato');
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(2, 'grants da funcao especializada estao corretos', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql(
      'authenticated',
      null,
      format(
        $sql$
          select *
          from public.advance_commercial_opportunity_to_quote_stage_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_novo_lead, v.quote_novo_lead,
        'runner-p924-auth-denied',
        'authenticated nao pode usar writer de sistema',
        'manual-check-auth-denied'
      )
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '42501' then
      perform pg_temp._p9_24_record(3, 'authenticated nao acessa writer de sistema', 'PASS', 'acesso negado como esperado');
    else
      perform pg_temp._p9_24_record(3, 'authenticated nao acessa writer de sistema', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'authenticated unexpectedly accepted'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(3, 'authenticated nao acessa writer de sistema', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql(
      'anon',
      null,
      format(
        $sql$
          select *
          from public.advance_commercial_opportunity_to_quote_stage_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_novo_lead, v.quote_novo_lead,
        'runner-p924-anon-denied',
        'anon nao pode usar writer de sistema',
        'manual-check-anon-denied'
      )
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '42501' then
      perform pg_temp._p9_24_record(4, 'anon nao acessa writer de sistema', 'PASS', 'acesso negado como esperado');
    else
      perform pg_temp._p9_24_record(4, 'anon nao acessa writer de sistema', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'anon unexpectedly accepted'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(4, 'anon nao acessa writer de sistema', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select lifecycle_cycle into v_cycle_before from public.commercial_opportunities where id = v.opp_novo_lead;
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql(
      'service_role',
      null,
      format(
        $sql$
          select *
          from public.advance_commercial_opportunity_to_quote_stage_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_novo_lead, v.quote_novo_lead,
        'runner-p924-novo-lead',
        'quote criada a partir de novo_lead',
        'manual-check-novo-lead'
      )
    );
    select lifecycle_cycle into v_cycle_after from public.commercial_opportunities where id = v.opp_novo_lead;
    select * into v_event
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_novo_lead
      and idempotency_key = 'runner-p924-novo-lead'
    limit 1;

    if v_exec.operation_succeeded
       and v_exec.value_json->>'commercial_opportunity_id' = v.opp_novo_lead::text
       and v_exec.value_json->>'stage' = 'orcamento'
       and v_exec.value_json->>'event_type' = 'stage_transition'
       and v_exec.value_json->>'reason_code' = 'explicit_quote_intent_required'
       and v_exec.value_json->>'lifecycle_event_id' is not null
       and (v_exec.value_json->>'stage_changed')::boolean
       and v_exec.value_json->>'outcome' = 'advanced_to_orcamento'
       and v_event.event_type = 'stage_transition'
       and v_event.actor_type = 'system'
       and v_event.actor_user_id is null
       and v_event.reason_code = 'explicit_quote_intent_required'
       and v_event.evidence_type = 'sales_quote_created'
       and v_event.evidence_summary = 'sales_quote_id=' || v.quote_novo_lead::text
       and v_cycle_before = v_cycle_after then
      perform pg_temp._p9_24_record(5, 'novo_lead avanca para orcamento com lifecycle correto', 'PASS', 'transicao aplicada sem alterar lifecycle_cycle');
    else
      perform pg_temp._p9_24_record(5, 'novo_lead avanca para orcamento com lifecycle correto', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'novo_lead transition failed'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(5, 'novo_lead avanca para orcamento com lifecycle correto', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select lifecycle_cycle into v_cycle_before from public.commercial_opportunities where id = v.opp_qualificacao;
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql(
      'service_role',
      null,
      format(
        $sql$
          select *
          from public.advance_commercial_opportunity_to_quote_stage_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_qualificacao, v.quote_qualificacao,
        'runner-p924-qualificacao',
        'quote criada a partir de qualificacao',
        'manual-check-qualificacao'
      )
    );
    select lifecycle_cycle into v_cycle_after from public.commercial_opportunities where id = v.opp_qualificacao;
    select * into v_event
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_qualificacao
      and idempotency_key = 'runner-p924-qualificacao'
    limit 1;

    if v_exec.operation_succeeded
       and v_exec.value_json->>'commercial_opportunity_id' = v.opp_qualificacao::text
       and v_exec.value_json->>'stage' = 'orcamento'
       and v_exec.value_json->>'event_type' = 'stage_transition'
       and (v_exec.value_json->>'stage_changed')::boolean
       and v_exec.value_json->>'reason_code' = 'explicit_quote_intent_required'
       and v_exec.value_json->>'lifecycle_event_id' is not null
       and v_exec.value_json->>'outcome' = 'advanced_to_orcamento'
       and v_event.evidence_summary = 'sales_quote_id=' || v.quote_qualificacao::text
       and v_cycle_before = v_cycle_after then
      perform pg_temp._p9_24_record(6, 'qualificacao avanca para orcamento', 'PASS', 'transicao aplicada como quote-created');
    else
      perform pg_temp._p9_24_record(6, 'qualificacao avanca para orcamento', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'qualificacao transition failed'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(6, 'qualificacao avanca para orcamento', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_orcamento;

    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql(
      'service_role',
      null,
      format(
        $sql$
          select *
          from public.advance_commercial_opportunity_to_quote_stage_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            null,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_orcamento, v.quote_orcamento,
        'runner-p924-orcamento',
        'manual-check-orcamento'
      )
    );

    if v_exec.operation_succeeded
       and v_exec.value_json->>'stage' = 'orcamento'
       and not (v_exec.value_json->>'stage_changed')::boolean
       and v_exec.value_json->>'outcome' = 'already_in_quote_stage'
       and v_exec.value_json->>'lifecycle_event_id' is null
       and (select count(*) from public.commercial_opportunity_lifecycle_events where commercial_opportunity_id = v.opp_orcamento) = v_event_count then
      perform pg_temp._p9_24_record(7, 'orcamento retorna no-op sem lifecycle ficticio', 'PASS', 'nenhuma nova auditoria criada');
    else
      perform pg_temp._p9_24_record(7, 'orcamento retorna no-op sem lifecycle ficticio', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'orcamento noop failed'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(7, 'orcamento retorna no-op sem lifecycle ficticio', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_negociacao;
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql(
      'service_role',
      null,
      format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,null,%L)$sql$,
        v.org_a, v.store_a, v.opp_negociacao, v.quote_negociacao, 'runner-p924-negociacao', 'manual-check-negociacao'
      )
    );
    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_negociacao;

    if v_exec.operation_succeeded
       and v_exec.value_json->>'stage' = 'negociacao'
       and not (v_exec.value_json->>'stage_changed')::boolean
       and v_exec.value_json->>'outcome' = 'stage_not_eligible_for_quote_projection'
       and v_exec.value_json->>'lifecycle_event_id' is null
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_24_record(8, 'negociacao retorna skip sem regressao', 'PASS', 'stage posterior preservado');
    else
      perform pg_temp._p9_24_record(8, 'negociacao retorna skip sem regressao', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'negociacao skip failed'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(8, 'negociacao retorna skip sem regressao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_visita;
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,null,%L)$sql$,
      v.org_a, v.store_a, v.opp_visita, v.quote_visita, 'runner-p924-visita', 'manual-check-visita'));
    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_visita;
    if v_exec.operation_succeeded
       and v_exec.value_json->>'stage' = 'visita_tecnica'
       and not (v_exec.value_json->>'stage_changed')::boolean
       and v_exec.value_json->>'outcome' = 'stage_not_eligible_for_quote_projection'
       and v_exec.value_json->>'lifecycle_event_id' is null
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_24_record(9, 'visita_tecnica retorna skip', 'PASS', 'sem regressao para orcamento');
    else
      perform pg_temp._p9_24_record(9, 'visita_tecnica retorna skip', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'visita skip failed'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(9, 'visita_tecnica retorna skip', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_fechamento;
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,null,%L)$sql$,
      v.org_a, v.store_a, v.opp_fechamento, v.quote_fechamento, 'runner-p924-fechamento', 'manual-check-fechamento'));
    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_fechamento;
    if v_exec.operation_succeeded
       and v_exec.value_json->>'stage' = 'fechamento_pagamento'
       and not (v_exec.value_json->>'stage_changed')::boolean
       and v_exec.value_json->>'outcome' = 'stage_not_eligible_for_quote_projection'
       and v_exec.value_json->>'lifecycle_event_id' is null
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_24_record(10, 'fechamento_pagamento retorna skip', 'PASS', 'sem regressao para orcamento');
    else
      perform pg_temp._p9_24_record(10, 'fechamento_pagamento retorna skip', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'fechamento skip failed'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(10, 'fechamento_pagamento retorna skip', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_instalacao;
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,null,%L)$sql$,
      v.org_a, v.store_a, v.opp_instalacao, v.quote_instalacao, 'runner-p924-instalacao', 'manual-check-instalacao'));
    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_instalacao;
    if v_exec.operation_succeeded
       and v_exec.value_json->>'stage' = 'instalacao_entrega'
       and not (v_exec.value_json->>'stage_changed')::boolean
       and v_exec.value_json->>'outcome' = 'stage_not_eligible_for_quote_projection'
       and v_exec.value_json->>'lifecycle_event_id' is null
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_24_record(11, 'instalacao_entrega retorna skip', 'PASS', 'sem regressao para orcamento');
    else
      perform pg_temp._p9_24_record(11, 'instalacao_entrega retorna skip', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'instalacao skip failed'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(11, 'instalacao_entrega retorna skip', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_pos_venda;
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,null,%L)$sql$,
      v.org_a, v.store_a, v.opp_pos_venda, v.quote_pos_venda, 'runner-p924-pos-venda', 'manual-check-pos-venda'));
    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_pos_venda;
    if v_exec.operation_succeeded
       and v_exec.value_json->>'stage' = 'pos_venda'
       and not (v_exec.value_json->>'stage_changed')::boolean
       and v_exec.value_json->>'outcome' = 'stage_not_eligible_for_quote_projection'
       and v_exec.value_json->>'lifecycle_event_id' is null
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_24_record(12, 'pos_venda retorna skip', 'PASS', 'sem regressao para orcamento');
    else
      perform pg_temp._p9_24_record(12, 'pos_venda retorna skip', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'pos_venda skip failed'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(12, 'pos_venda retorna skip', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_perdido;
    select
      opportunity_row.current_loss_event_id,
      opportunity_row.lost_at,
      opportunity_row.lost_reason_code
    into v_loss_projection_before
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v.opp_perdido;
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,null,%L)$sql$,
      v.org_a, v.store_a, v.opp_perdido, v.quote_perdido, 'runner-p924-perdido', 'manual-check-perdido'));
    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_perdido;
    select
      opportunity_row.current_loss_event_id,
      opportunity_row.lost_at,
      opportunity_row.lost_reason_code
    into v_loss_projection_after
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v.opp_perdido;
    if v_exec.operation_succeeded
       and v_exec.value_json->>'stage' = 'perdido'
       and not (v_exec.value_json->>'stage_changed')::boolean
       and v_exec.value_json->>'outcome' = 'stage_not_eligible_for_quote_projection'
       and v_exec.value_json->>'lifecycle_event_id' is null
       and v_loss_projection_before.current_loss_event_id is not null
       and v_loss_projection_before.lost_at is not null
       and v_loss_projection_before.lost_reason_code = 'explicit_refusal'
       and v_loss_projection_after.current_loss_event_id = v_loss_projection_before.current_loss_event_id
       and v_loss_projection_after.lost_at = v_loss_projection_before.lost_at
       and v_loss_projection_after.lost_reason_code = v_loss_projection_before.lost_reason_code
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_24_record(13, 'perdido retorna skip', 'PASS', 'sem regressao para orcamento');
    else
      perform pg_temp._p9_24_record(13, 'perdido retorna skip', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'perdido skip failed'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(13, 'perdido retorna skip', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_concluido;
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,null,%L)$sql$,
      v.org_a, v.store_a, v.opp_concluido, v.quote_concluido, 'runner-p924-concluido', 'manual-check-concluido'));
    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_concluido;
    if v_exec.operation_succeeded
       and v_exec.value_json->>'stage' = 'concluido_sem_mais_acoes'
       and not (v_exec.value_json->>'stage_changed')::boolean
       and v_exec.value_json->>'outcome' = 'stage_not_eligible_for_quote_projection'
       and v_exec.value_json->>'lifecycle_event_id' is null
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_24_record(14, 'concluido_sem_mais_acoes retorna skip', 'PASS', 'sem regressao para orcamento');
    else
      perform pg_temp._p9_24_record(14, 'concluido_sem_mais_acoes retorna skip', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'concluido skip failed'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(14, 'concluido_sem_mais_acoes retorna skip', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,null,%L)$sql$,
      v.org_a, v.store_a, v.opp_novo_lead, v.quote_other_same_scope, 'runner-p924-wrong-opp', 'manual-check-wrong-opp'));
    if not v_exec.operation_succeeded and v_exec.message_text = 'sales quote opportunity mismatch' then
      perform pg_temp._p9_24_record(15, 'quote de outra opportunity e rejeitada', 'PASS', 'fail-closed por opportunity mismatch');
    else
      perform pg_temp._p9_24_record(15, 'quote de outra opportunity e rejeitada', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'wrong-opportunity quote unexpectedly accepted'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(15, 'quote de outra opportunity e rejeitada', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_other_same_scope;
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,null,%L)$sql$,
      v.org_a, v.store_a, v.opp_other_same_scope, gen_random_uuid(), 'runner-p924-quote-missing', 'manual-check-quote-missing'));
    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_other_same_scope;
    if not v_exec.operation_succeeded
       and v_exec.message_text = 'sales quote not found'
       and (select stage from public.commercial_opportunities where id = v.opp_other_same_scope) = 'qualificacao'
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_24_record(16, 'sales quote inexistente e rejeitada sem lifecycle', 'PASS', 'quote ausente nao altera stage nem cria lifecycle');
    else
      perform pg_temp._p9_24_record(16, 'sales quote inexistente e rejeitada sem lifecycle', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'missing sales quote unexpectedly accepted'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(16, 'sales quote inexistente e rejeitada sem lifecycle', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,null,%L)$sql$,
      v.org_a, v.store_a, v.opp_novo_lead, v.quote_other_tenant, 'runner-p924-other-tenant', 'manual-check-other-tenant'));
    if not v_exec.operation_succeeded and v_exec.message_text = 'sales quote scope mismatch' then
      perform pg_temp._p9_24_record(17, 'quote de outro tenant e rejeitada', 'PASS', 'fail-closed por scope mismatch');
    else
      perform pg_temp._p9_24_record(17, 'quote de outro tenant e rejeitada', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'other-tenant quote unexpectedly accepted'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(17, 'quote de outro tenant e rejeitada', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,null,%L)$sql$,
      v.org_a, v.store_a, v.opp_novo_lead, v.quote_null_opportunity, 'runner-p924-null-opp-quote', 'manual-check-null-opp-quote'));
    if not v_exec.operation_succeeded and v_exec.message_text = 'sales quote is not linked to a commercial opportunity' then
      perform pg_temp._p9_24_record(18, 'quote sem commercial_opportunity_id e rejeitada', 'PASS', 'fail-closed por quote sem oportunidade explicita');
    else
      perform pg_temp._p9_24_record(18, 'quote sem commercial_opportunity_id e rejeitada', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'null-opportunity quote unexpectedly accepted'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(18, 'quote sem commercial_opportunity_id e rejeitada', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,null,%L)$sql$,
      v.org_a, v.store_a, gen_random_uuid(), v.quote_novo_lead, 'runner-p924-opp-missing', 'manual-check-opp-missing'));
    if not v_exec.operation_succeeded and v_exec.message_text = 'commercial opportunity not found' then
      perform pg_temp._p9_24_record(19, 'commercial opportunity inexistente e rejeitada', 'PASS', 'fail-closed por oportunidade ausente');
    else
      perform pg_temp._p9_24_record(19, 'commercial opportunity inexistente e rejeitada', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'missing opportunity unexpectedly accepted'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(19, 'commercial opportunity inexistente e rejeitada', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,null,%L)$sql$,
      v.org_b, v.store_b, v.opp_novo_lead, v.quote_novo_lead, 'runner-p924-scope-mismatch', 'manual-check-scope-mismatch'));
    if not v_exec.operation_succeeded and v_exec.message_text = 'commercial opportunity scope mismatch' then
      perform pg_temp._p9_24_record(20, 'commercial opportunity scope mismatch e rejeitado', 'PASS', 'fail-closed por org/store divergentes');
    else
      perform pg_temp._p9_24_record(20, 'commercial opportunity scope mismatch e rejeitado', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'scope mismatch unexpectedly accepted'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(20, 'commercial opportunity scope mismatch e rejeitado', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select lifecycle_cycle into v_cycle_before from public.commercial_opportunities where id = v.opp_retry;
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)$sql$,
      v.org_a, v.store_a, v.opp_retry, v.quote_retry, 'runner-p924-retry', 'primeira projeção', 'manual-check-retry'));
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)$sql$,
      v.org_a, v.store_a, v.opp_retry, v.quote_retry, 'runner-p924-retry', 'primeira projeção', 'manual-check-retry'));
    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_retry
      and idempotency_key = 'runner-p924-retry';
    select lifecycle_cycle into v_cycle_after from public.commercial_opportunities where id = v.opp_retry;

    if v_exec.operation_succeeded
       and v_exec.value_json->>'stage' = 'orcamento'
       and not (v_exec.value_json->>'stage_changed')::boolean
       and v_exec.value_json->>'outcome' = 'idempotent_replay'
       and v_event_count = 1
       and v_cycle_before = v_cycle_after then
      perform pg_temp._p9_24_record(21, 'retry da mesma quote nao duplica lifecycle', 'PASS', 'um unico evento mantido com replay idempotente');
    else
      perform pg_temp._p9_24_record(21, 'retry da mesma quote nao duplica lifecycle', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'idempotent replay failed'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(21, 'retry da mesma quote nao duplica lifecycle', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_retry
      and idempotency_key = 'runner-p924-retry';
    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql('service_role', null, format($sql$select * from public.advance_commercial_opportunity_to_quote_stage_by_system(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)$sql$,
      v.org_a, v.store_a, v.opp_retry, v.quote_retry, 'runner-p924-retry', 'payload incompatível com o primeiro uso', 'manual-check-retry-reused-different-source'));
    select count(*) into v_event_count_after
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_retry
      and idempotency_key = 'runner-p924-retry';

    if not v_exec.operation_succeeded
       and v_exec.message_text = 'ZION_IDEMPOTENCY_KEY_REUSED'
       and (select stage from public.commercial_opportunities where id = v.opp_retry) = 'orcamento'
       and v_event_count_after = v_event_count then
      perform pg_temp._p9_24_record(22, 'reuso incompatível da mesma idempotency key e rejeitado', 'PASS', 'nao cria segundo lifecycle nem reprojeta stage');
    else
      perform pg_temp._p9_24_record(22, 'reuso incompatível da mesma idempotency key e rejeitado', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'incompatible idempotency reuse unexpectedly accepted'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(22, 'reuso incompatível da mesma idempotency key e rejeitado', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    perform *
    from pg_temp._p9_24_exec_json_sql(
      'service_role',
      null,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            'negociacao',
            %L,
            'sales_quote_created',
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_race,
        'runner-p924-race-pre-move',
        'outro processo avancou antes do lock do writer especializado',
        'sales_quote_id=' || v.quote_race::text,
        'manual-check-race-pre-move'
      )
    );

    select *
    into v_exec
    from pg_temp._p9_24_exec_json_sql(
      'service_role',
      null,
      format(
        $sql$
          select *
          from public.advance_commercial_opportunity_to_quote_stage_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_race, v.quote_race,
        'runner-p924-race-specialized',
        'quote criada apos stage ja ter sido avancado',
        'manual-check-race-specialized'
      )
    );

    select count(*) into v_event_count
    from public.commercial_opportunity_lifecycle_events
    where commercial_opportunity_id = v.opp_race
      and idempotency_key = 'runner-p924-race-specialized';

    if v_exec.operation_succeeded
       and v_exec.value_json->>'stage' = 'negociacao'
       and not (v_exec.value_json->>'stage_changed')::boolean
       and v_exec.value_json->>'outcome' = 'stage_not_eligible_for_quote_projection'
       and v_exec.value_json->>'lifecycle_event_id' is null
       and v_event_count = 0 then
      perform pg_temp._p9_24_record(23, 'race qualificacao para negociacao antes do lock nao regressa', 'PASS', 'nenhum evento de regressao para orcamento foi criado');
    else
      perform pg_temp._p9_24_record(23, 'race qualificacao para negociacao antes do lock nao regressa', 'SUT_FAIL', coalesce(v_exec.message_text, v_exec.value_json::text, 'race scenario regressed unexpectedly'));
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(23, 'race qualificacao para negociacao antes do lock nao regressa', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if not exists (
      select 1
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = v_proc_oid
        and lower(pg_catalog.pg_get_functiondef(proc_row.oid)) like '%for update%'
    ) then
      perform pg_temp._p9_24_record(24, 'definicao contem for update', 'SUT_FAIL', 'FOR UPDATE nao encontrado na definicao');
    else
      perform pg_temp._p9_24_record(24, 'definicao contem for update', 'PASS', 'lock atomico presente na funcao');
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(24, 'definicao contem for update', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if exists (
      select 1
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = v_proc_oid
        and lower(pg_catalog.pg_get_functiondef(proc_row.oid)) like '%transition_commercial_opportunity_stage_by_system%'
    ) then
      perform pg_temp._p9_24_record(25, 'writer especializado nao depende do writer generico publico', 'SUT_FAIL', 'encontrada chamada ao writer generico publico');
    else
      perform pg_temp._p9_24_record(25, 'writer especializado nao depende do writer generico publico', 'PASS', 'usa contrato proprio e internal canônico');
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(25, 'writer especializado nao depende do writer generico publico', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    if (
      (select count(*) from public.organizations where id in (v.org_a, v.org_b)) = 2
      and (select count(*) from public.stores where id in (v.store_a, v.store_b)) = 2
      and (select count(*) from public.customers where id in (v.customer_a, v.customer_b)) = 2
      and (
        select count(*)
        from public.commercial_opportunities
        where id in (
          v.opp_novo_lead, v.opp_qualificacao, v.opp_orcamento, v.opp_visita,
          v.opp_negociacao, v.opp_fechamento, v.opp_instalacao, v.opp_pos_venda,
          v.opp_perdido, v.opp_concluido, v.opp_retry, v.opp_race,
          v.opp_other_same_scope, v.opp_other_tenant
        )
      ) = 14
    ) then
      perform pg_temp._p9_24_record(26, 'fixtures sinteticas permanecem contidas na transacao', 'PASS', 'descarte depende de rollback ou do abort transacional do gate final');
    else
      perform pg_temp._p9_24_record(26, 'fixtures sinteticas permanecem contidas na transacao', 'SUT_FAIL', 'assinatura das fixtures divergente');
    end if;
  exception
    when others then
      perform pg_temp._p9_24_record(26, 'fixtures sinteticas permanecem contidas na transacao', 'HARNESS_ERROR', sqlerrm);
  end;
end;
$checks$;

select *
from pg_temp._p9_24_results
order by scenario_number;

do $gate$
declare
  v_total_count integer;
  v_non_pass_count integer;
begin
  select count(*)
  into v_total_count
  from pg_temp._p9_24_results;

  if v_total_count <> 26 then
    raise exception using
      errcode = 'P0001',
      message = format('manual check failed: expected 26 scenarios but found %s', v_total_count);
  end if;

  select count(*)
  into v_non_pass_count
  from pg_temp._p9_24_results
  where status <> 'PASS';

  if v_non_pass_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = format('manual check failed: %s scenario(s) did not pass', v_non_pass_count);
  end if;
end;
$gate$;

rollback;
