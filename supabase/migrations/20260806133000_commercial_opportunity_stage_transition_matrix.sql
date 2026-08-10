-- Pilar 9 - Bloco 2 - Etapa 2.2
-- Matriz canonica de transicoes comerciais.
-- Escopo: somente contrato deterministico de decisao; sem alterar writers existentes.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b2:e2.2:commercial-opportunity-stage-transition-matrix:v2',
    0
  )
);

do $preflight$
declare
  v_existing_signature oid;
  v_homonymous_count integer;
  v_stage_count integer;
  v_distinct_stage_count integer;
begin
  if pg_catalog.to_regprocedure('public.normalize_commercial_opportunity_stage(text)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.normalize_commercial_opportunity_stage(text) is required';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunities') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunities is required';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles role_row
    where role_row.rolname = 'anon'
  ) or not exists (
    select 1
    from pg_catalog.pg_roles role_row
    where role_row.rolname = 'authenticated'
  ) or not exists (
    select 1
    from pg_catalog.pg_roles role_row
    where role_row.rolname = 'service_role'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required Supabase roles are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunities'::pg_catalog.regclass
      and constraint_row.contype = 'c'
      and constraint_row.conname = 'commercial_opportunities_stage_check'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%novo_lead%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%qualificacao%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%orcamento%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%visita_tecnica%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%negociacao%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%fechamento_pagamento%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%instalacao_entrega%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%pos_venda%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%perdido%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%concluido_sem_mais_acoes%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial_opportunities.stage canonical contract mismatch';
  end if;

  select count(*)
  into v_homonymous_count
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname = 'resolve_commercial_opportunity_stage_transition';

  if v_homonymous_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: unexpected homonymous function already exists';
  end if;

  v_existing_signature := pg_catalog.to_regprocedure(
    'public.resolve_commercial_opportunity_stage_transition(text,text)'
  );

  if v_existing_signature is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: target signature already exists';
  end if;

  select count(*), count(distinct normalized.stage)
  into v_stage_count, v_distinct_stage_count
  from (
    select public.normalize_commercial_opportunity_stage(raw.stage) as stage
    from (
      values
        ('novo_lead'),
        ('qualificacao'),
        ('orcamento'),
        ('visita_tecnica'),
        ('negociacao'),
        ('fechamento_pagamento'),
        ('instalacao_entrega'),
        ('pos_venda'),
        ('perdido'),
        ('concluido_sem_mais_acoes')
    ) as raw(stage)
  ) as normalized;

  if v_stage_count <> 10 or v_distinct_stage_count <> 10 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: normalize_commercial_opportunity_stage canonical set mismatch';
  end if;
end;
$preflight$;

create function public.resolve_commercial_opportunity_stage_transition(
  p_from_stage text,
  p_to_stage text
)
returns table (
  from_stage text,
  to_stage text,
  decision text,
  is_permitted boolean,
  requires_specialized_writer boolean,
  reason_code text
)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_from_stage text;
  v_to_stage text;
  v_reason_code text;
begin
  begin
    v_from_stage := public.normalize_commercial_opportunity_stage(p_from_stage);
  exception
    when sqlstate '22023' then
      raise exception using
        errcode = '22023',
        message = 'ZION_COMMERCIAL_STAGE_UNKNOWN';
  end;

  begin
    v_to_stage := public.normalize_commercial_opportunity_stage(p_to_stage);
  exception
    when sqlstate '22023' then
      raise exception using
        errcode = '22023',
        message = 'ZION_COMMERCIAL_STAGE_UNKNOWN';
  end;

  if v_from_stage is null or v_to_stage is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_COMMERCIAL_STAGE_REQUIRED';
  end if;

  if v_from_stage = v_to_stage then
    return query
    select
      v_from_stage,
      v_to_stage,
      'forbidden'::text,
      false,
      false,
      'noop_same_stage'::text;
    return;
  end if;

  if v_from_stage in (
       'novo_lead',
       'qualificacao',
       'orcamento',
       'visita_tecnica',
       'negociacao',
       'fechamento_pagamento',
       'instalacao_entrega',
       'pos_venda'
     )
     and v_to_stage = 'perdido' then
    return query
    select
      v_from_stage,
      v_to_stage,
      'conditional'::text,
      false,
      true,
      'loss_writer_required'::text;
    return;
  end if;

  if v_from_stage = 'perdido'
     and v_to_stage in (
       'novo_lead',
       'qualificacao',
       'orcamento',
       'visita_tecnica',
       'negociacao',
       'fechamento_pagamento',
       'instalacao_entrega',
       'pos_venda'
     ) then
    return query
    select
      v_from_stage,
      v_to_stage,
      'conditional'::text,
      false,
      true,
      'reopen_writer_required'::text;
    return;
  end if;

  if v_from_stage in (
       'novo_lead',
       'qualificacao',
       'orcamento',
       'visita_tecnica',
       'negociacao',
       'fechamento_pagamento',
       'instalacao_entrega',
       'pos_venda'
     )
     and v_to_stage = 'concluido_sem_mais_acoes' then
    return query
    select
      v_from_stage,
      v_to_stage,
      'conditional'::text,
      false,
      true,
      'conclusion_writer_required'::text;
    return;
  end if;

  if v_from_stage = 'concluido_sem_mais_acoes'
     and v_to_stage = 'pos_venda' then
    return query
    select
      v_from_stage,
      v_to_stage,
      'conditional'::text,
      false,
      true,
      'post_sale_reopen_writer_required'::text;
    return;
  end if;

  if (
       v_from_stage = 'concluido_sem_mais_acoes'
       and v_to_stage in ('qualificacao', 'orcamento')
     ) or (
       v_from_stage = 'pos_venda'
       and v_to_stage in ('qualificacao', 'orcamento')
     ) then
    return query
    select
      v_from_stage,
      v_to_stage,
      'forbidden'::text,
      false,
      false,
      'new_commercial_intent_requires_new_opportunity'::text;
    return;
  end if;

  v_reason_code := case
    when v_from_stage = 'novo_lead' and v_to_stage = 'qualificacao' then 'commercial_interest_required'
    when v_from_stage = 'novo_lead' and v_to_stage = 'orcamento' then 'explicit_quote_intent_required'
    when v_from_stage = 'novo_lead' and v_to_stage = 'visita_tecnica' then 'visit_eligibility_required'
    when v_from_stage = 'qualificacao' and v_to_stage = 'orcamento' then 'explicit_quote_intent_required'
    when v_from_stage = 'qualificacao' and v_to_stage = 'visita_tecnica' then 'visit_eligibility_required'
    when v_from_stage = 'qualificacao' and v_to_stage = 'negociacao' then 'concrete_offer_required'
    when v_from_stage = 'orcamento' and v_to_stage = 'visita_tecnica' then 'visit_required_or_eligible'
    when v_from_stage = 'orcamento' and v_to_stage = 'negociacao' then 'concrete_quote_objection_required'
    when v_from_stage = 'orcamento' and v_to_stage = 'fechamento_pagamento' then 'accepted_current_quote_required'
    when v_from_stage = 'visita_tecnica' and v_to_stage = 'qualificacao' then 'visit_result_missing_commercial_choices'
    when v_from_stage = 'visita_tecnica' and v_to_stage = 'orcamento' then 'visit_viable_quote_ready'
    when v_from_stage = 'visita_tecnica' and v_to_stage = 'negociacao' then 'visit_viable_concrete_offer_required'
    when v_from_stage = 'negociacao' and v_to_stage = 'visita_tecnica' then 'mandatory_visit_pending'
    when v_from_stage = 'negociacao' and v_to_stage = 'orcamento' then 'quote_revision_required'
    when v_from_stage = 'negociacao' and v_to_stage = 'fechamento_pagamento' then 'accepted_negotiated_condition_required'
    when v_from_stage = 'fechamento_pagamento' and v_to_stage = 'orcamento' then 'quote_gate_revalidation_required'
    when v_from_stage = 'fechamento_pagamento' and v_to_stage = 'visita_tecnica' then 'mandatory_visit_pending'
    when v_from_stage = 'fechamento_pagamento' and v_to_stage = 'negociacao' then 'renegotiation_required'
    when v_from_stage = 'fechamento_pagamento' and v_to_stage = 'instalacao_entrega' then 'execution_release_gates_required'
    when v_from_stage = 'fechamento_pagamento' and v_to_stage = 'pos_venda' then 'simple_sale_completion_required'
    when v_from_stage = 'instalacao_entrega' and v_to_stage = 'pos_venda' then 'execution_completed_without_pending'
    else null
  end;

  if v_reason_code is not null then
    return query
    select
      v_from_stage,
      v_to_stage,
      'conditional'::text,
      false,
      false,
      v_reason_code;
    return;
  end if;

  return query
  select
    v_from_stage,
    v_to_stage,
    'forbidden'::text,
    false,
    false,
    'transition_not_allowed'::text;
end;
$function$;

alter function public.resolve_commercial_opportunity_stage_transition(text, text)
  owner to postgres;

comment on function public.resolve_commercial_opportunity_stage_transition(text, text) is
  'Resolve deterministicamente a matriz canonica de transicoes entre estagios comerciais por allowlist explicita, preservando writers especializados para perda, reabertura, conclusao e pos-venda.';

revoke all on function public.resolve_commercial_opportunity_stage_transition(text, text)
  from public, anon, authenticated, service_role;

do $postconditions$
declare
  v_signature constant text := 'public.resolve_commercial_opportunity_stage_transition(text,text)';
  v_function_oid oid := pg_catalog.to_regprocedure(v_signature);
  v_expected_comment constant text := 'Resolve deterministicamente a matriz canonica de transicoes entre estagios comerciais por allowlist explicita, preservando writers especializados para perda, reabertura, conclusao e pos-venda.';
begin
  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: function signature missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.oid = v_function_oid
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: function namespace must be public';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_roles owner_row
      on owner_row.oid = proc_row.proowner
    where proc_row.oid = v_function_oid
      and owner_row.rolname = 'postgres'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: function owner must be postgres';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_function_oid
      and proc_row.provolatile = 'v'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: function volatility must be volatile';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_function_oid
      and not proc_row.prosecdef
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: function must be security invoker';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_function_oid
      and proc_row.proretset
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: function must return a set';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_function_oid
      and proc_row.prorettype = 'pg_catalog.record'::pg_catalog.regtype
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: function return type must be record';
  end if;

  if exists (
    with expected_column(ordinality, column_name, type_name) as (
      values
        (1, 'from_stage', 'text'),
        (2, 'to_stage', 'text'),
        (3, 'decision', 'text'),
        (4, 'is_permitted', 'boolean'),
        (5, 'requires_specialized_writer', 'boolean'),
        (6, 'reason_code', 'text')
    ),
    actual_column as (
      select
        row_number() over (order by arg_index.ordinality) as ordinality,
        proc_row.proargnames[arg_index.ordinality] as column_name,
        proc_row.proallargtypes[arg_index.ordinality]::pg_catalog.regtype::text as type_name
      from pg_catalog.pg_proc proc_row
      cross join lateral pg_catalog.generate_subscripts(proc_row.proallargtypes, 1) as arg_index(ordinality)
      where proc_row.oid = v_function_oid
        and proc_row.proargmodes[arg_index.ordinality] in ('o', 'b', 't')
    )
    select 1
    from expected_column
    full join actual_column
      using (ordinality, column_name, type_name)
    where expected_column.ordinality is null
       or actual_column.ordinality is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: function return columns must be from_stage text, to_stage text, decision text, is_permitted boolean, requires_specialized_writer boolean, reason_code text';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    cross join lateral pg_catalog.unnest(
      coalesce(proc_row.proconfig, array[]::text[])
    ) as config_row(setting_text)
    where proc_row.oid = v_function_oid
      and config_row.setting_text = 'search_path=pg_catalog, pg_temp, public'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: function search_path must include pg_catalog, pg_temp, public';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_function_oid
      and pg_catalog.obj_description(proc_row.oid, 'pg_proc') = v_expected_comment
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: function comment mismatch';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        proc_row.proacl,
        pg_catalog.acldefault('f', proc_row.proowner)
      )
    ) as acl_row
    left join pg_catalog.pg_roles role_row
      on role_row.oid = acl_row.grantee
    where proc_row.oid = v_function_oid
      and acl_row.privilege_type = 'EXECUTE'
      and (
        acl_row.grantee = 0
        or role_row.rolname in ('anon', 'authenticated', 'service_role')
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: execute grants must be absent for public-facing roles';
  end if;

  if exists (
    with expected_transition (
      from_stage,
      to_stage,
      decision,
      is_permitted,
      requires_specialized_writer,
      reason_code
    ) as (
      values
        ('novo_lead', 'qualificacao', 'conditional', false, false, 'commercial_interest_required'),
        ('novo_lead', 'instalacao_entrega', 'forbidden', false, false, 'transition_not_allowed'),
        ('qualificacao', 'perdido', 'conditional', false, true, 'loss_writer_required'),
        ('perdido', 'negociacao', 'conditional', false, true, 'reopen_writer_required'),
        ('negociacao', 'concluido_sem_mais_acoes', 'conditional', false, true, 'conclusion_writer_required'),
        ('concluido_sem_mais_acoes', 'pos_venda', 'conditional', false, true, 'post_sale_reopen_writer_required'),
        ('concluido_sem_mais_acoes', 'qualificacao', 'forbidden', false, false, 'new_commercial_intent_requires_new_opportunity'),
        ('pos_venda', 'orcamento', 'forbidden', false, false, 'new_commercial_intent_requires_new_opportunity'),
        ('negociacao', 'orcamento', 'conditional', false, false, 'quote_revision_required'),
        ('visita_tecnica', 'qualificacao', 'conditional', false, false, 'visit_result_missing_commercial_choices'),
        ('visita_tecnica', 'orcamento', 'conditional', false, false, 'visit_viable_quote_ready'),
        ('visita_tecnica', 'negociacao', 'conditional', false, false, 'visit_viable_concrete_offer_required')
    ),
    actual_transition as (
      select
        expected_transition.from_stage,
        expected_transition.to_stage,
        decision_row.decision,
        decision_row.is_permitted,
        decision_row.requires_specialized_writer,
        decision_row.reason_code
      from expected_transition
      cross join lateral public.resolve_commercial_opportunity_stage_transition(
        expected_transition.from_stage,
        expected_transition.to_stage
      ) as decision_row
    )
    select 1
    from expected_transition
    full join actual_transition using (
      from_stage,
      to_stage,
      decision,
      is_permitted,
      requires_specialized_writer,
      reason_code
    )
    where expected_transition.from_stage is null
       or actual_transition.from_stage is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: critical transition matrix decisions mismatch';
  end if;
end;
$postconditions$;

commit;
