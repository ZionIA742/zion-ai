begin;

create temp table pg_temp._p9_23_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create function pg_temp._p9_23_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_23_results (
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

create or replace function pg_temp._p9_23_exec_json_sql(
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

create or replace function pg_temp._p9_23_exec_stmt_sql(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  returned_sqlstate text,
  message_text text,
  constraint_name text
)
language plpgsql
as $function$
declare
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
    execute p_sql;
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
    v_state,
    v_message,
    v_constraint;
end;
$function$;

create temp table pg_temp._p9_23_ctx (
  run_id uuid not null,
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b uuid not null,
  user_a uuid not null,
  user_b uuid not null,
  user_c uuid not null,
  customer_a uuid not null,
  customer_b uuid not null,
  opp_transition_ok uuid not null,
  opp_transition_forbidden uuid not null,
  opp_transition_specialized uuid not null,
  opp_transition_missing_evidence uuid not null,
  opp_scope_mismatch uuid not null,
  opp_idempotent uuid not null,
  opp_idempotent_reuse uuid not null,
  opp_audit_transition uuid not null,
  opp_conclusion_ok uuid not null,
  opp_conclusion_forbidden uuid not null,
  opp_post_sale_ok uuid not null,
  opp_new_intent_block uuid not null,
  opp_lifecycle_normal uuid not null,
  opp_lifecycle_conclusion uuid not null,
  opp_lifecycle_post_sale uuid not null,
  opp_old_loss uuid not null,
  opp_direct_update uuid not null,
  opp_unauthorized uuid not null,
  opp_system_auth uuid not null,
  opp_system_transition_ok uuid not null,
  opp_system_conclusion_ok uuid not null,
  opp_system_post_sale_ok uuid not null
);

do $setup$
declare
  v_run_id uuid := gen_random_uuid();
begin
  insert into pg_temp._p9_23_ctx (
    run_id,
    org_a,
    org_b,
    store_a,
    store_b,
    user_a,
    user_b,
    user_c,
    customer_a,
    customer_b,
    opp_transition_ok,
    opp_transition_forbidden,
    opp_transition_specialized,
    opp_transition_missing_evidence,
    opp_scope_mismatch,
    opp_idempotent,
    opp_idempotent_reuse,
    opp_audit_transition,
    opp_conclusion_ok,
    opp_conclusion_forbidden,
    opp_post_sale_ok,
    opp_new_intent_block,
    opp_lifecycle_normal,
    opp_lifecycle_conclusion,
    opp_lifecycle_post_sale,
    opp_old_loss,
    opp_direct_update,
    opp_unauthorized,
    opp_system_auth,
    opp_system_transition_ok,
    opp_system_conclusion_ok,
    opp_system_post_sale_ok
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
    gen_random_uuid()
  );

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
  select
    x.user_id,
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    x.email_value,
    '',
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('runner', true, 'key', x.user_key),
    now(),
    now(),
    '',
    '',
    '',
    '',
    false,
    false
  from (
    select
      ctx.user_a as user_id,
      'runner-p923-user-a-' || ctx.run_id::text || '@example.test' as email_value,
      'user_a'::text as user_key
    from pg_temp._p9_23_ctx ctx
    union all
    select
      ctx.user_b,
      'runner-p923-user-b-' || ctx.run_id::text || '@example.test',
      'user_b'::text
    from pg_temp._p9_23_ctx ctx
    union all
    select
      ctx.user_c,
      'runner-p923-user-c-' || ctx.run_id::text || '@example.test',
      'user_c'::text
    from pg_temp._p9_23_ctx ctx
  ) x;

  insert into public.organizations (id, name)
  select
    ctx.org_a,
    'Runner P9 Org A ' || ctx.run_id::text
  from pg_temp._p9_23_ctx ctx
  union all
  select
    ctx.org_b,
    'Runner P9 Org B ' || ctx.run_id::text
  from pg_temp._p9_23_ctx ctx;

  insert into public.memberships (organization_id, user_id, role)
  select ctx.org_a, ctx.user_a, 'owner'::public.app_role
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.org_b, ctx.user_b, 'owner'::public.app_role
  from pg_temp._p9_23_ctx ctx;

  insert into public.stores (id, organization_id, name, created_at)
  select ctx.store_a, ctx.org_a, 'Runner P9 Store A ' || ctx.run_id::text, now()
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.store_b, ctx.org_b, 'Runner P9 Store B ' || ctx.run_id::text, now()
  from pg_temp._p9_23_ctx ctx;

  insert into public.customers (id, organization_id, display_name, normalized_name)
  select ctx.customer_a, ctx.org_a, 'Runner Customer A', 'runner customer a'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.customer_b, ctx.org_b, 'Runner Customer B', 'runner customer b'
  from pg_temp._p9_23_ctx ctx;

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  select ctx.org_a, ctx.store_a, ctx.customer_a
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.org_b, ctx.store_b, ctx.customer_b
  from pg_temp._p9_23_ctx ctx;

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage
  )
  select ctx.opp_transition_ok, ctx.org_a, ctx.store_a, ctx.customer_a, 'novo_lead'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_transition_forbidden, ctx.org_a, ctx.store_a, ctx.customer_a, 'novo_lead'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_transition_specialized, ctx.org_a, ctx.store_a, ctx.customer_a, 'negociacao'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_transition_missing_evidence, ctx.org_a, ctx.store_a, ctx.customer_a, 'novo_lead'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_scope_mismatch, ctx.org_a, ctx.store_a, ctx.customer_a, 'novo_lead'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_idempotent, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_idempotent_reuse, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_audit_transition, ctx.org_a, ctx.store_a, ctx.customer_a, 'orcamento'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_conclusion_ok, ctx.org_a, ctx.store_a, ctx.customer_a, 'negociacao'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_conclusion_forbidden, ctx.org_a, ctx.store_a, ctx.customer_a, 'concluido_sem_mais_acoes'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_post_sale_ok, ctx.org_a, ctx.store_a, ctx.customer_a, 'concluido_sem_mais_acoes'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_new_intent_block, ctx.org_a, ctx.store_a, ctx.customer_a, 'concluido_sem_mais_acoes'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_lifecycle_normal, ctx.org_a, ctx.store_a, ctx.customer_a, 'novo_lead'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_lifecycle_conclusion, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_lifecycle_post_sale, ctx.org_a, ctx.store_a, ctx.customer_a, 'concluido_sem_mais_acoes'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_old_loss, ctx.org_a, ctx.store_a, ctx.customer_a, 'novo_lead'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_direct_update, ctx.org_a, ctx.store_a, ctx.customer_a, 'novo_lead'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_unauthorized, ctx.org_a, ctx.store_a, ctx.customer_a, 'novo_lead'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_system_auth, ctx.org_a, ctx.store_a, ctx.customer_a, 'novo_lead'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_system_transition_ok, ctx.org_a, ctx.store_a, ctx.customer_a, 'qualificacao'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_system_conclusion_ok, ctx.org_a, ctx.store_a, ctx.customer_a, 'negociacao'
  from pg_temp._p9_23_ctx ctx
  union all
  select ctx.opp_system_post_sale_ok, ctx.org_a, ctx.store_a, ctx.customer_a, 'concluido_sem_mais_acoes'
  from pg_temp._p9_23_ctx ctx;
end;
$setup$;

do $scenarios$
declare
  v pg_temp._p9_23_ctx;
  v_exec_json record;
  v_exec_stmt record;
  v_json jsonb;
  v_count integer;
  v_count_after integer;
  v_cycle_before integer;
  v_cycle_after integer;
  v_event record;
  v_trigger_definition text;
begin
  select * into v from pg_temp._p9_23_ctx;

  if not found then
    perform pg_temp._p9_23_record(
      0,
      'runner context fixture missing',
      'HARNESS_ERROR',
      'pg_temp._p9_23_ctx should contain exactly one context row'
    );
    return;
  end if;

  begin
    select count(*)
    into v_count
    from unnest(array[
      pg_catalog.to_regprocedure('public.transition_commercial_opportunity_stage_by_user(uuid,uuid,uuid,text,text,text,text,uuid,text,text)'),
      pg_catalog.to_regprocedure('public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)'),
      pg_catalog.to_regprocedure('public.conclude_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)'),
      pg_catalog.to_regprocedure('public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'),
      pg_catalog.to_regprocedure('public.reopen_commercial_opportunity_for_post_sale_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)'),
      pg_catalog.to_regprocedure('public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'),
      pg_catalog.to_regprocedure('public.apply_commercial_opportunity_stage_transition_internal(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid)')
    ]) as proc_oid
    where proc_oid is not null;

    v_trigger_definition := pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure('public.enforce_commercial_opportunity_loss_stage_transition()')
    );

    if v_count = 7
       and not has_function_privilege(
         'authenticated',
         'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
         'EXECUTE'
       )
       and has_function_privilege(
         'service_role',
         'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
         'EXECUTE'
       )
       and has_function_privilege(
         'authenticated',
         'public.transition_commercial_opportunity_stage_by_user(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
         'EXECUTE'
       )
       and not has_function_privilege(
         'service_role',
         'public.transition_commercial_opportunity_stage_by_user(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
         'EXECUTE'
       )
       and v_trigger_definition ilike '%post_sale_reopen%'
       and v_trigger_definition ilike '%conclusion%'
       and exists (
         select 1
         from pg_catalog.pg_constraint constraint_row
         where constraint_row.conname = 'commercial_opportunity_lifecycle_events_stage_transition_shape_check'
       )
       and exists (
         select 1
         from pg_catalog.pg_constraint constraint_row
         where constraint_row.conname = 'commercial_opportunity_lifecycle_events_conclusion_shape_check'
       )
       and exists (
         select 1
         from pg_catalog.pg_constraint constraint_row
         where constraint_row.conname = 'commercial_opportunity_lifecycle_events_post_sale_reopen_shape_check'
       ) then
      perform pg_temp._p9_23_record(
        1,
        'objetos constraints e acl esperados',
        'PASS',
        'writers publicos, funcao interna, shape checks e ACL minima encontrados'
      );
    else
      perform pg_temp._p9_23_record(
        1,
        'objetos constraints e acl esperados',
        'SUT_FAIL',
        format('writer_count=%s trigger_has_extensions=%s', v_count, (v_trigger_definition ilike '%post_sale_reopen%')::text)
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(
        1,
        'objetos constraints e acl esperados',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_transition_ok,
        'runner-p923-stage-ok',
        'qualificacao',
        'interesse comercial confirmado',
        'operator_note',
        'evidencia minima para transicao normal',
        'manual_stage_transition'
      )
    );

    if v_exec_json.operation_succeeded
       and v_exec_json.value_json->>'stage' = 'qualificacao'
       and v_exec_json.value_json->>'event_type' = 'stage_transition'
       and v_exec_json.value_json->>'reason_code' = 'commercial_interest_required' then
      perform pg_temp._p9_23_record(2, 'transicao normal permitida pela matriz', 'PASS', 'novo_lead -> qualificacao executado via writer normal');
    else
      perform pg_temp._p9_23_record(
        2,
        'transicao normal permitida pela matriz',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'unexpected null result')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(2, 'transicao normal permitida pela matriz', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_transition_forbidden,
        'runner-p923-stage-forbidden',
        'instalacao_entrega',
        'tentativa proibida',
        'operator_note',
        'nao deveria passar',
        'manual_stage_transition'
      )
    );

    if not v_exec_json.operation_succeeded
       and v_exec_json.message_text = 'ZION_STAGE_TRANSITION_FORBIDDEN' then
      perform pg_temp._p9_23_record(3, 'transicao normal proibida', 'PASS', 'writer normal rejeitou rota fora da matriz');
    else
      perform pg_temp._p9_23_record(
        3,
        'transicao normal proibida',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'forbidden transition unexpectedly succeeded')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(3, 'transicao normal proibida', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_transition_specialized,
        'runner-p923-stage-specialized',
        'concluido_sem_mais_acoes',
        'tentativa de conclusao pelo writer normal',
        'operator_note',
        'rota especializada deve ser bloqueada',
        'manual_stage_transition'
      )
    );

    if not v_exec_json.operation_succeeded
       and v_exec_json.message_text = 'ZION_SPECIALIZED_STAGE_WRITER_REQUIRED' then
      perform pg_temp._p9_23_record(4, 'writer normal rejeita rota especializada', 'PASS', 'rota de conclusao exigiu writer especializado');
    else
      perform pg_temp._p9_23_record(
        4,
        'writer normal rejeita rota especializada',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'specialized route unexpectedly accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(4, 'writer normal rejeita rota especializada', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_transition_missing_evidence,
        'runner-p923-stage-no-evidence',
        'qualificacao',
        'sem evidencia minima',
        '',
        'resumo existe mas tipo nao',
        'manual_stage_transition'
      )
    );

    if not v_exec_json.operation_succeeded
       and v_exec_json.message_text = 'ZION_STAGE_TRANSITION_ARGUMENTS_REQUIRED' then
      perform pg_temp._p9_23_record(5, 'evidencia ausente e rejeitada', 'PASS', 'evidence_type vazio foi rejeitado');
    else
      perform pg_temp._p9_23_record(
        5,
        'evidencia ausente e rejeitada',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'missing evidence unexpectedly accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(5, 'evidencia ausente e rejeitada', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_b, v.opp_scope_mismatch,
        'runner-p923-scope-mismatch',
        'qualificacao',
        'escopo incoerente',
        'operator_note',
        'deve falhar por store scope',
        'manual_stage_transition'
      )
    );

    if not v_exec_json.operation_succeeded
       and v_exec_json.message_text = 'commercial opportunity scope mismatch' then
      perform pg_temp._p9_23_record(6, 'escopo organizacao loja oportunidade incoerente', 'PASS', 'writer rejeitou combinacao de escopo incorreta');
    else
      perform pg_temp._p9_23_record(
        6,
        'escopo organizacao loja oportunidade incoerente',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'scope mismatch unexpectedly accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(6, 'escopo organizacao loja oportunidade incoerente', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_idempotent,
        'runner-p923-idempotent',
        'orcamento',
        'primeira tentativa idempotente',
        'operator_note',
        'mesma carga precisa fazer replay',
        'manual_stage_transition'
      )
    );

    select replay_row.value_json
    into v_json
    from (
      select result_row.value_json
      from pg_temp._p9_23_exec_json_sql(
        'authenticated',
        v.user_a,
        format(
          $sql$
            select *
            from public.transition_commercial_opportunity_stage_by_user(
              %L::uuid,
              %L::uuid,
              %L::uuid,
              %L,
              %L,
              %L,
              %L,
              null::uuid,
              %L,
              %L
            )
          $sql$,
          v.org_a, v.store_a, v.opp_idempotent,
          'runner-p923-idempotent',
          'orcamento',
          'primeira tentativa idempotente',
          'operator_note',
          'mesma carga precisa fazer replay',
          'manual_stage_transition'
        )
      ) result_row
    ) replay_row;

    select count(*)
    into v_count
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.commercial_opportunity_id = v.opp_idempotent
      and lifecycle_event.idempotency_key = 'runner-p923-idempotent';

    if v_exec_json.operation_succeeded
       and v_json->>'lifecycle_event_id' = v_exec_json.value_json->>'lifecycle_event_id'
       and v_count = 1 then
      perform pg_temp._p9_23_record(7, 'replay idempotente nao duplica evento', 'PASS', 'mesma chave e mesmo payload retornaram o mesmo evento sem duplicar');
    else
      perform pg_temp._p9_23_record(
        7,
        'replay idempotente nao duplica evento',
        'SUT_FAIL',
        format('count=%s first=%s second=%s', v_count, coalesce(v_exec_json.value_json::text, 'null'), coalesce(v_json::text, 'null'))
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(7, 'replay idempotente nao duplica evento', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    perform *
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_idempotent_reuse,
        'runner-p923-reused-key',
        'orcamento',
        'payload original',
        'operator_note',
        'primeiro payload',
        'manual_stage_transition'
      )
    );

    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_idempotent_reuse,
        'runner-p923-reused-key',
        'orcamento',
        'payload divergente',
        'operator_note',
        'segundo payload divergente',
        'manual_stage_transition'
      )
    );

    if not v_exec_json.operation_succeeded
       and v_exec_json.message_text = 'ZION_IDEMPOTENCY_KEY_REUSED' then
      perform pg_temp._p9_23_record(8, 'reutilizacao da chave com payload diferente e rejeitada', 'PASS', 'mesma chave com payload diferente falhou como esperado');
    else
      perform pg_temp._p9_23_record(
        8,
        'reutilizacao da chave com payload diferente e rejeitada',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'idempotency reuse was not rejected')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(8, 'reutilizacao da chave com payload diferente e rejeitada', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    perform *
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_audit_transition,
        'runner-p923-audit-transition',
        'negociacao',
        'cliente pediu revisao comercial',
        'operator_note',
        'aprovado para mover ao proximo estagio',
        'manual_stage_transition'
      )
    );

    select *
    into v_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.commercial_opportunity_id = v.opp_audit_transition
      and lifecycle_event.idempotency_key = 'runner-p923-audit-transition'
    limit 1;

    if v_event.event_type = 'stage_transition'
       and v_event.previous_stage = 'orcamento'
       and v_event.new_stage = 'negociacao'
       and v_event.reason_code = 'concrete_quote_objection_required'
       and v_event.evidence_type = 'operator_note'
       and v_event.evidence_summary = 'aprovado para mover ao proximo estagio'
       and v_event.actor_type = 'human'
       and v_event.actor_user_id = v.user_a
       and v_event.source = 'manual_stage_transition' then
      perform pg_temp._p9_23_record(9, 'auditoria stage_transition contem previous new reason evidence actor e source', 'PASS', 'evento append-only registrou o contrato esperado');
    else
      perform pg_temp._p9_23_record(
        9,
        'auditoria stage_transition contem previous new reason evidence actor e source',
        'SUT_FAIL',
        coalesce(row_to_json(v_event)::text, 'stage_transition event not found')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(9, 'auditoria stage_transition contem previous new reason evidence actor e source', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.conclude_commercial_opportunity_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_conclusion_ok,
        'runner-p923-conclusion-ok',
        'nada mais pendente para esta oportunidade',
        'operator_note',
        'evidencia minima para concluir',
        'manual_conclusion'
      )
    );

    if v_exec_json.operation_succeeded
       and v_exec_json.value_json->>'stage' = 'concluido_sem_mais_acoes'
       and v_exec_json.value_json->>'event_type' = 'conclusion'
       and v_exec_json.value_json->>'reason_code' = 'conclusion_writer_required' then
      select replay_row.value_json
      into v_json
      from (
        select result_row.value_json
        from pg_temp._p9_23_exec_json_sql(
          'authenticated',
          v.user_a,
          format(
            $sql$
              select *
              from public.conclude_commercial_opportunity_by_user(
                %L::uuid,
                %L::uuid,
                %L::uuid,
                %L,
                %L,
                %L,
                null::uuid,
                %L,
                %L
              )
            $sql$,
            v.org_a, v.store_a, v.opp_conclusion_ok,
            'runner-p923-conclusion-ok',
            'nada mais pendente para esta oportunidade',
            'operator_note',
            'evidencia minima para concluir',
            'manual_conclusion'
          )
        ) result_row
      ) replay_row;

      select count(*)
      into v_count
      from public.commercial_opportunity_lifecycle_events lifecycle_event
      where lifecycle_event.commercial_opportunity_id = v.opp_conclusion_ok
        and lifecycle_event.idempotency_key = 'runner-p923-conclusion-ok';
    end if;

    if v_exec_json.operation_succeeded
       and v_exec_json.value_json->>'stage' = 'concluido_sem_mais_acoes'
       and v_exec_json.value_json->>'event_type' = 'conclusion'
       and v_exec_json.value_json->>'reason_code' = 'conclusion_writer_required'
       and v_json->>'lifecycle_event_id' = v_exec_json.value_json->>'lifecycle_event_id'
       and v_count = 1 then
      perform pg_temp._p9_23_record(10, 'conclusao valida', 'PASS', 'writer especializado concluiu a oportunidade');
    else
      perform pg_temp._p9_23_record(
        10,
        'conclusao valida',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'valid conclusion did not succeed')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(10, 'conclusao valida', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.commercial_opportunity_id = v.opp_conclusion_ok
      and lifecycle_event.idempotency_key = 'runner-p923-conclusion-ok'
    limit 1;

    if v_event.event_type = 'conclusion'
       and v_event.new_stage = 'concluido_sem_mais_acoes'
       and v_event.reason_code = 'conclusion_writer_required' then
      perform pg_temp._p9_23_record(11, 'conclusao auditada como conclusion', 'PASS', 'evento de conclusao foi persistido corretamente');
    else
      perform pg_temp._p9_23_record(
        11,
        'conclusao auditada como conclusion',
        'SUT_FAIL',
        coalesce(row_to_json(v_event)::text, 'conclusion event not found')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(11, 'conclusao auditada como conclusion', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.conclude_commercial_opportunity_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_conclusion_forbidden,
        'runner-p923-conclusion-forbidden',
        'mesmo estagio nao pode concluir de novo',
        'operator_note',
        'deve falhar por rota proibida',
        'manual_conclusion'
      )
    );

    if not v_exec_json.operation_succeeded
       and v_exec_json.message_text = 'ZION_STAGE_TRANSITION_FORBIDDEN' then
      perform pg_temp._p9_23_record(12, 'conclusao nao ocorre por rota proibida', 'PASS', 'writer de conclusao rejeitou a rota proibida');
    else
      perform pg_temp._p9_23_record(
        12,
        'conclusao nao ocorre por rota proibida',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'forbidden conclusion unexpectedly accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(12, 'conclusao nao ocorre por rota proibida', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.reopen_commercial_opportunity_for_post_sale_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_post_sale_ok,
        'runner-p923-post-sale-ok',
        'cliente acionou atendimento de pos-venda',
        'operator_note',
        'retorno legitimo para pos-venda',
        'manual_post_sale_reopen'
      )
    );

    if v_exec_json.operation_succeeded
       and v_exec_json.value_json->>'stage' = 'pos_venda'
       and v_exec_json.value_json->>'event_type' = 'post_sale_reopen'
       and v_exec_json.value_json->>'reason_code' = 'post_sale_reopen_writer_required' then
      select replay_row.value_json
      into v_json
      from (
        select result_row.value_json
        from pg_temp._p9_23_exec_json_sql(
          'authenticated',
          v.user_a,
          format(
            $sql$
              select *
              from public.reopen_commercial_opportunity_for_post_sale_by_user(
                %L::uuid,
                %L::uuid,
                %L::uuid,
                %L,
                %L,
                %L,
                null::uuid,
                %L,
                %L
              )
            $sql$,
            v.org_a, v.store_a, v.opp_post_sale_ok,
            'runner-p923-post-sale-ok',
            'cliente acionou atendimento de pos-venda',
            'operator_note',
            'retorno legitimo para pos-venda',
            'manual_post_sale_reopen'
          )
        ) result_row
      ) replay_row;

      select count(*)
      into v_count
      from public.commercial_opportunity_lifecycle_events lifecycle_event
      where lifecycle_event.commercial_opportunity_id = v.opp_post_sale_ok
        and lifecycle_event.idempotency_key = 'runner-p923-post-sale-ok';
    end if;

    if v_exec_json.operation_succeeded
       and v_exec_json.value_json->>'stage' = 'pos_venda'
       and v_exec_json.value_json->>'event_type' = 'post_sale_reopen'
       and v_exec_json.value_json->>'reason_code' = 'post_sale_reopen_writer_required'
       and v_json->>'lifecycle_event_id' = v_exec_json.value_json->>'lifecycle_event_id'
       and v_count = 1 then
      perform pg_temp._p9_23_record(13, 'concluido_sem_mais_acoes para pos_venda valido', 'PASS', 'writer especializado de pos-venda executou a rota permitida');
    else
      perform pg_temp._p9_23_record(
        13,
        'concluido_sem_mais_acoes para pos_venda valido',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'valid post-sale reopen did not succeed')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(13, 'concluido_sem_mais_acoes para pos_venda valido', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.commercial_opportunity_id = v.opp_post_sale_ok
      and lifecycle_event.idempotency_key = 'runner-p923-post-sale-ok'
    limit 1;

    if v_event.event_type = 'post_sale_reopen'
       and v_event.previous_stage = 'concluido_sem_mais_acoes'
       and v_event.new_stage = 'pos_venda'
       and v_event.reason_code = 'post_sale_reopen_writer_required' then
      perform pg_temp._p9_23_record(14, 'pos_venda auditado como post_sale_reopen', 'PASS', 'evento de pos-venda foi persistido corretamente');
    else
      perform pg_temp._p9_23_record(
        14,
        'pos_venda auditado como post_sale_reopen',
        'SUT_FAIL',
        coalesce(row_to_json(v_event)::text, 'post_sale_reopen event not found')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(14, 'pos_venda auditado como post_sale_reopen', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_new_intent_block,
        'runner-p923-new-intent',
        'qualificacao',
        'nova compra deve virar nova oportunidade',
        'operator_note',
        'transicao direta deve ser bloqueada',
        'manual_stage_transition'
      )
    );

    if not v_exec_json.operation_succeeded
       and v_exec_json.message_text = 'ZION_STAGE_TRANSITION_FORBIDDEN' then
      perform pg_temp._p9_23_record(15, 'pos_venda nao serve para nova intencao comercial', 'PASS', 'matriz bloqueou concluido_sem_mais_acoes -> qualificacao');
    else
      perform pg_temp._p9_23_record(
        15,
        'pos_venda nao serve para nova intencao comercial',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'new commercial intent bypass unexpectedly accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(15, 'pos_venda nao serve para nova intencao comercial', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_c,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_unauthorized,
        'runner-p923-unauthorized',
        'qualificacao',
        'usuario sem membership',
        'operator_note',
        'deve falhar',
        'manual_stage_transition'
      )
    );

    if not v_exec_json.operation_succeeded
       and v_exec_json.message_text = 'commercial opportunity stage transition by user is not authorized' then
      perform pg_temp._p9_23_record(16, 'writer user rejeita ator sem autorizacao', 'PASS', 'membership ausente bloqueou a operacao');
    else
      perform pg_temp._p9_23_record(
        16,
        'writer user rejeita ator sem autorizacao',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'unauthorized actor unexpectedly accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(16, 'writer user rejeita ator sem autorizacao', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_system_auth,
        'runner-p923-system-auth',
        'qualificacao',
        'authenticated nao pode usar writer de sistema',
        'operator_note',
        'deve falhar',
        'system_stage_transition'
      )
    );

    if not v_exec_json.operation_succeeded
       and v_exec_json.returned_sqlstate = '42501' then
      perform pg_temp._p9_23_record(17, 'writer system rejeita papel inadequado', 'PASS', 'authenticated nao conseguiu usar o writer de sistema');
    else
      perform pg_temp._p9_23_record(
        17,
        'writer system rejeita papel inadequado',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'system writer unexpectedly accepted authenticated caller')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(17, 'writer system rejeita papel inadequado', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select lifecycle_cycle into v_cycle_before from public.commercial_opportunities where id = v.opp_lifecycle_normal;
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.transition_commercial_opportunity_stage_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_lifecycle_normal,
        'runner-p923-cycle-normal',
        'qualificacao',
        'ciclo deve permanecer',
        'operator_note',
        'transicao normal sem alterar ciclo',
        'manual_stage_transition'
      )
    );
    select lifecycle_cycle into v_cycle_after from public.commercial_opportunities where id = v.opp_lifecycle_normal;

    if v_exec_json.operation_succeeded
       and v_cycle_before = v_cycle_after then
      select lifecycle_cycle into v_cycle_before from public.commercial_opportunities where id = v.opp_lifecycle_conclusion;
      select *
      into v_exec_json
      from pg_temp._p9_23_exec_json_sql(
        'authenticated',
        v.user_a,
        format(
          $sql$
            select *
            from public.conclude_commercial_opportunity_by_user(
              %L::uuid,
              %L::uuid,
              %L::uuid,
              %L,
              %L,
              %L,
              null::uuid,
              %L,
              %L
            )
          $sql$,
          v.org_a, v.store_a, v.opp_lifecycle_conclusion,
          'runner-p923-cycle-conclusion',
          'ciclo deve permanecer',
          'operator_note',
          'conclusao sem alterar ciclo',
          'manual_conclusion'
        )
      );
      select lifecycle_cycle into v_cycle_after from public.commercial_opportunities where id = v.opp_lifecycle_conclusion;
    end if;

    if v_exec_json.operation_succeeded
       and v_cycle_before = v_cycle_after then
      select lifecycle_cycle into v_cycle_before from public.commercial_opportunities where id = v.opp_lifecycle_post_sale;
      select *
      into v_exec_json
      from pg_temp._p9_23_exec_json_sql(
        'authenticated',
        v.user_a,
        format(
          $sql$
            select *
            from public.reopen_commercial_opportunity_for_post_sale_by_user(
              %L::uuid,
              %L::uuid,
              %L::uuid,
              %L,
              %L,
              %L,
              null::uuid,
              %L,
              %L
            )
          $sql$,
          v.org_a, v.store_a, v.opp_lifecycle_post_sale,
          'runner-p923-cycle-post-sale',
          'ciclo deve permanecer',
          'operator_note',
          'pos-venda sem alterar ciclo',
          'manual_post_sale_reopen'
        )
      );
      select lifecycle_cycle into v_cycle_after from public.commercial_opportunities where id = v.opp_lifecycle_post_sale;
    end if;

    if v_exec_json.operation_succeeded
       and v_cycle_before = v_cycle_after then
      perform pg_temp._p9_23_record(18, 'lifecycle_cycle nao muda nas tres operacoes novas', 'PASS', 'transicao normal conclusao e pos-venda preservaram o ciclo');
    else
      perform pg_temp._p9_23_record(18, 'lifecycle_cycle nao muda nas tres operacoes novas', 'SUT_FAIL', 'alguma das novas operacoes alterou lifecycle_cycle');
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(18, 'lifecycle_cycle nao muda nas tres operacoes novas', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.mark_commercial_opportunity_lost_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            null,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_old_loss,
        'runner-p923-old-loss',
        'explicit_refusal',
        'evidencia sintetica para perda',
        'manual_user_loss'
      )
    );

    if v_exec_json.operation_succeeded
       and v_exec_json.value_json->>'stage' = 'perdido' then
      perform pg_temp._p9_23_record(19, 'protecao antiga de marked_lost continua funcionando', 'PASS', 'writer legado de perda continuou funcional');
    else
      perform pg_temp._p9_23_record(
        19,
        'protecao antiga de marked_lost continua funcionando',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'legacy loss writer did not succeed')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(19, 'protecao antiga de marked_lost continua funcionando', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_json
    from pg_temp._p9_23_exec_json_sql(
      'authenticated',
      v.user_a,
      format(
        $sql$
          select *
          from public.reopen_commercial_opportunity_by_user(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_old_loss,
        'runner-p923-old-reopen',
        'pos_venda',
        'reabertura legada apos perda',
        'manual_reopen'
      )
    );

    if v_exec_json.operation_succeeded
       and v_exec_json.value_json->>'stage' = 'pos_venda'
       and (v_exec_json.value_json->>'lifecycle_cycle')::integer = 2 then
      perform pg_temp._p9_23_record(20, 'protecao antiga de reopened continua funcionando', 'PASS', 'writer legado de reabertura continuou funcional');
    else
      perform pg_temp._p9_23_record(
        20,
        'protecao antiga de reopened continua funcionando',
        'SUT_FAIL',
        coalesce(v_exec_json.message_text, v_exec_json.value_json::text, 'legacy reopen writer did not succeed')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(20, 'protecao antiga de reopened continua funcionando', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select *
    into v_exec_stmt
    from pg_temp._p9_23_exec_stmt_sql(
      null,
      null,
      format(
        'update public.commercial_opportunities set stage = %L where id = %L::uuid',
        'qualificacao',
        v.opp_direct_update
      )
    );

    if not v_exec_stmt.operation_succeeded
       and v_exec_stmt.message_text = 'ZION_DIRECT_STAGE_TRANSITION_FORBIDDEN' then
      perform pg_temp._p9_23_record(21, 'update direto de stage sem evento canonico continua bloqueado', 'PASS', 'trigger bloqueou update direto sem evento');
    else
      perform pg_temp._p9_23_record(
        21,
        'update direto de stage sem evento canonico continua bloqueado',
        'SUT_FAIL',
        coalesce(v_exec_stmt.message_text, 'direct update unexpectedly succeeded')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(21, 'update direto de stage sem evento canonico continua bloqueado', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    select
      (
        (select count(*) from auth.users user_row where user_row.id in (v.user_a, v.user_b, v.user_c)) +
        (select count(*) from public.organizations organization_row where organization_row.id in (v.org_a, v.org_b)) +
        (select count(*) from public.stores store_row where store_row.id in (v.store_a, v.store_b)) +
        (select count(*) from public.customers customer_row where customer_row.id in (v.customer_a, v.customer_b)) +
        (
          select count(*)
          from public.commercial_opportunities opportunity_row
          where opportunity_row.id in (
            v.opp_transition_ok,
            v.opp_transition_forbidden,
            v.opp_transition_specialized,
            v.opp_transition_missing_evidence,
            v.opp_scope_mismatch,
            v.opp_idempotent,
            v.opp_idempotent_reuse,
            v.opp_audit_transition,
            v.opp_conclusion_ok,
            v.opp_conclusion_forbidden,
            v.opp_post_sale_ok,
            v.opp_new_intent_block,
            v.opp_lifecycle_normal,
            v.opp_lifecycle_conclusion,
            v.opp_lifecycle_post_sale,
            v.opp_old_loss,
            v.opp_direct_update,
            v.opp_unauthorized,
            v.opp_system_auth,
            v.opp_system_transition_ok,
            v.opp_system_conclusion_ok,
            v.opp_system_post_sale_ok
          )
        )
      )
    into v_count_after;

    if v_count_after = 31 then
      perform pg_temp._p9_23_record(
        22,
        'fixtures sinteticas estao contidas na transacao de rollback',
        'PASS',
        'fixtures sinteticas identificadas dentro da transacao atual; o descarte depende do ROLLBACK final e da ausencia de COMMIT'
      );
    else
      perform pg_temp._p9_23_record(
        22,
        'fixtures sinteticas estao contidas na transacao de rollback',
        'SUT_FAIL',
        format('fixture_signature_count=%s expected=31', v_count_after)
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(22, 'fixtures sinteticas estao contidas na transacao de rollback', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    perform *
    from pg_temp._p9_23_exec_json_sql(
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
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_system_transition_ok,
        'runner-p923-system-transition-ok',
        'orcamento',
        'service role executou transicao normal',
        'system_note',
        'auditoria de transicao por service_role',
        'system_stage_transition'
      )
    );

    select *
    into v_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.commercial_opportunity_id = v.opp_system_transition_ok
      and lifecycle_event.idempotency_key = 'runner-p923-system-transition-ok'
    limit 1;

    if v_event.event_type = 'stage_transition'
       and v_event.new_stage = 'orcamento'
       and v_event.actor_type = 'system'
       and v_event.actor_user_id is null
       and v_event.reason_code = 'explicit_quote_intent_required' then
      perform pg_temp._p9_23_record(23, 'transition_commercial_opportunity_stage_by_system funciona como service_role', 'PASS', 'writer by_system de transicao normal executou com auditoria correta');
    else
      perform pg_temp._p9_23_record(
        23,
        'transition_commercial_opportunity_stage_by_system funciona como service_role',
        'SUT_FAIL',
        coalesce(row_to_json(v_event)::text, 'system transition event not found')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(23, 'transition_commercial_opportunity_stage_by_system funciona como service_role', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    perform *
    from pg_temp._p9_23_exec_json_sql(
      'service_role',
      null,
      format(
        $sql$
          select *
          from public.conclude_commercial_opportunity_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_system_conclusion_ok,
        'runner-p923-system-conclusion-ok',
        'service role concluiu oportunidade',
        'system_note',
        'auditoria de conclusao por service_role',
        'system_conclusion'
      )
    );

    select *
    into v_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.commercial_opportunity_id = v.opp_system_conclusion_ok
      and lifecycle_event.idempotency_key = 'runner-p923-system-conclusion-ok'
    limit 1;

    if v_event.event_type = 'conclusion'
       and v_event.new_stage = 'concluido_sem_mais_acoes'
       and v_event.actor_type = 'system'
       and v_event.actor_user_id is null
       and v_event.reason_code = 'conclusion_writer_required' then
      perform pg_temp._p9_23_record(24, 'conclude_commercial_opportunity_by_system funciona como service_role', 'PASS', 'writer by_system de conclusao executou com auditoria correta');
    else
      perform pg_temp._p9_23_record(
        24,
        'conclude_commercial_opportunity_by_system funciona como service_role',
        'SUT_FAIL',
        coalesce(row_to_json(v_event)::text, 'system conclusion event not found')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(24, 'conclude_commercial_opportunity_by_system funciona como service_role', 'HARNESS_ERROR', sqlerrm);
  end;

  begin
    perform *
    from pg_temp._p9_23_exec_json_sql(
      'service_role',
      null,
      format(
        $sql$
          select *
          from public.reopen_commercial_opportunity_for_post_sale_by_system(
            %L::uuid,
            %L::uuid,
            %L::uuid,
            %L,
            %L,
            %L,
            null::uuid,
            %L,
            %L
          )
        $sql$,
        v.org_a, v.store_a, v.opp_system_post_sale_ok,
        'runner-p923-system-post-sale-ok',
        'service role reabriu para pos-venda',
        'system_note',
        'auditoria de pos-venda por service_role',
        'system_post_sale_reopen'
      )
    );

    select *
    into v_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.commercial_opportunity_id = v.opp_system_post_sale_ok
      and lifecycle_event.idempotency_key = 'runner-p923-system-post-sale-ok'
    limit 1;

    if v_event.event_type = 'post_sale_reopen'
       and v_event.new_stage = 'pos_venda'
       and v_event.actor_type = 'system'
       and v_event.actor_user_id is null
       and v_event.reason_code = 'post_sale_reopen_writer_required' then
      perform pg_temp._p9_23_record(25, 'reopen_commercial_opportunity_for_post_sale_by_system funciona como service_role', 'PASS', 'writer by_system de pos-venda executou com auditoria correta');
    else
      perform pg_temp._p9_23_record(
        25,
        'reopen_commercial_opportunity_for_post_sale_by_system funciona como service_role',
        'SUT_FAIL',
        coalesce(row_to_json(v_event)::text, 'system post-sale event not found')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_23_record(25, 'reopen_commercial_opportunity_for_post_sale_by_system funciona como service_role', 'HARNESS_ERROR', sqlerrm);
  end;
end;
$scenarios$;

with scenario_summary as (
  select
    count(*) as total_scenarios,
    count(*) filter (where status = 'PASS') as passed_scenarios,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'scenario_number', scenario_number,
          'scenario_name', scenario_name,
          'status', status,
          'details', details
        )
        order by scenario_number
      ) filter (where status <> 'PASS'),
      '[]'::jsonb
    ) as failed_scenarios
  from pg_temp._p9_23_results
)
select
  case
    when scenario_summary.total_scenarios <> 25 then 'AINDA_NAO_APROVADA'
    when scenario_summary.passed_scenarios <> 25 then 'AINDA_NAO_APROVADA'
    else 'APROVADA'
  end as final_status,
  scenario_summary.passed_scenarios,
  scenario_summary.total_scenarios,
  scenario_summary.failed_scenarios
from scenario_summary;

rollback;
