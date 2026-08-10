begin;

create temp table pg_temp._p9_stage_transition_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create function pg_temp._p9_stage_transition_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_stage_transition_results (
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

create temp table pg_temp._p9_expected_matrix (
  from_stage text not null,
  to_stage text not null,
  decision text not null,
  is_permitted boolean not null,
  requires_specialized_writer boolean not null,
  reason_code text not null,
  primary key (from_stage, to_stage)
);

with canonical_stage(stage_name) as (
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
),
matrix_seed as (
  select
    from_stage.stage_name as from_stage,
    to_stage.stage_name as to_stage,
    case
      when from_stage.stage_name = 'novo_lead' and to_stage.stage_name = 'qualificacao' then 'commercial_interest_required'
      when from_stage.stage_name = 'novo_lead' and to_stage.stage_name = 'orcamento' then 'explicit_quote_intent_required'
      when from_stage.stage_name = 'novo_lead' and to_stage.stage_name = 'visita_tecnica' then 'visit_eligibility_required'
      when from_stage.stage_name = 'qualificacao' and to_stage.stage_name = 'orcamento' then 'explicit_quote_intent_required'
      when from_stage.stage_name = 'qualificacao' and to_stage.stage_name = 'visita_tecnica' then 'visit_eligibility_required'
      when from_stage.stage_name = 'qualificacao' and to_stage.stage_name = 'negociacao' then 'concrete_offer_required'
      when from_stage.stage_name = 'orcamento' and to_stage.stage_name = 'visita_tecnica' then 'visit_required_or_eligible'
      when from_stage.stage_name = 'orcamento' and to_stage.stage_name = 'negociacao' then 'concrete_quote_objection_required'
      when from_stage.stage_name = 'orcamento' and to_stage.stage_name = 'fechamento_pagamento' then 'accepted_current_quote_required'
      when from_stage.stage_name = 'visita_tecnica' and to_stage.stage_name = 'qualificacao' then 'visit_result_missing_commercial_choices'
      when from_stage.stage_name = 'visita_tecnica' and to_stage.stage_name = 'orcamento' then 'visit_viable_quote_ready'
      when from_stage.stage_name = 'visita_tecnica' and to_stage.stage_name = 'negociacao' then 'visit_viable_concrete_offer_required'
      when from_stage.stage_name = 'negociacao' and to_stage.stage_name = 'visita_tecnica' then 'mandatory_visit_pending'
      when from_stage.stage_name = 'negociacao' and to_stage.stage_name = 'orcamento' then 'quote_revision_required'
      when from_stage.stage_name = 'negociacao' and to_stage.stage_name = 'fechamento_pagamento' then 'accepted_negotiated_condition_required'
      when from_stage.stage_name = 'fechamento_pagamento' and to_stage.stage_name = 'orcamento' then 'quote_gate_revalidation_required'
      when from_stage.stage_name = 'fechamento_pagamento' and to_stage.stage_name = 'visita_tecnica' then 'mandatory_visit_pending'
      when from_stage.stage_name = 'fechamento_pagamento' and to_stage.stage_name = 'negociacao' then 'renegotiation_required'
      when from_stage.stage_name = 'fechamento_pagamento' and to_stage.stage_name = 'instalacao_entrega' then 'execution_release_gates_required'
      when from_stage.stage_name = 'fechamento_pagamento' and to_stage.stage_name = 'pos_venda' then 'simple_sale_completion_required'
      when from_stage.stage_name = 'instalacao_entrega' and to_stage.stage_name = 'pos_venda' then 'execution_completed_without_pending'
      else null
    end as route_reason_code
  from canonical_stage from_stage
  cross join canonical_stage to_stage
)
insert into pg_temp._p9_expected_matrix (
  from_stage,
  to_stage,
  decision,
  is_permitted,
  requires_specialized_writer,
  reason_code
)
select
  matrix_seed.from_stage,
  matrix_seed.to_stage,
  case
    when matrix_seed.from_stage = matrix_seed.to_stage then 'forbidden'
    when matrix_seed.from_stage in (
      'novo_lead',
      'qualificacao',
      'orcamento',
      'visita_tecnica',
      'negociacao',
      'fechamento_pagamento',
      'instalacao_entrega',
      'pos_venda'
    ) and matrix_seed.to_stage = 'perdido' then 'conditional'
    when matrix_seed.from_stage = 'perdido'
      and matrix_seed.to_stage in (
        'novo_lead',
        'qualificacao',
        'orcamento',
        'visita_tecnica',
        'negociacao',
        'fechamento_pagamento',
        'instalacao_entrega',
        'pos_venda'
      ) then 'conditional'
    when matrix_seed.from_stage in (
      'novo_lead',
      'qualificacao',
      'orcamento',
      'visita_tecnica',
      'negociacao',
      'fechamento_pagamento',
      'instalacao_entrega',
      'pos_venda'
    ) and matrix_seed.to_stage = 'concluido_sem_mais_acoes' then 'conditional'
    when matrix_seed.from_stage = 'concluido_sem_mais_acoes'
      and matrix_seed.to_stage = 'pos_venda' then 'conditional'
    when (
      matrix_seed.from_stage = 'concluido_sem_mais_acoes'
      and matrix_seed.to_stage in ('qualificacao', 'orcamento')
    ) or (
      matrix_seed.from_stage = 'pos_venda'
      and matrix_seed.to_stage in ('qualificacao', 'orcamento')
    ) then 'forbidden'
    when matrix_seed.route_reason_code is not null then 'conditional'
    else 'forbidden'
  end as decision,
  false as is_permitted,
  case
    when matrix_seed.from_stage in (
      'novo_lead',
      'qualificacao',
      'orcamento',
      'visita_tecnica',
      'negociacao',
      'fechamento_pagamento',
      'instalacao_entrega',
      'pos_venda'
    ) and matrix_seed.to_stage = 'perdido' then true
    when matrix_seed.from_stage = 'perdido'
      and matrix_seed.to_stage in (
        'novo_lead',
        'qualificacao',
        'orcamento',
        'visita_tecnica',
        'negociacao',
        'fechamento_pagamento',
        'instalacao_entrega',
        'pos_venda'
      ) then true
    when matrix_seed.from_stage in (
      'novo_lead',
      'qualificacao',
      'orcamento',
      'visita_tecnica',
      'negociacao',
      'fechamento_pagamento',
      'instalacao_entrega',
      'pos_venda'
    ) and matrix_seed.to_stage = 'concluido_sem_mais_acoes' then true
    when matrix_seed.from_stage = 'concluido_sem_mais_acoes'
      and matrix_seed.to_stage = 'pos_venda' then true
    else false
  end as requires_specialized_writer,
  case
    when matrix_seed.from_stage = matrix_seed.to_stage then 'noop_same_stage'
    when matrix_seed.from_stage in (
      'novo_lead',
      'qualificacao',
      'orcamento',
      'visita_tecnica',
      'negociacao',
      'fechamento_pagamento',
      'instalacao_entrega',
      'pos_venda'
    ) and matrix_seed.to_stage = 'perdido' then 'loss_writer_required'
    when matrix_seed.from_stage = 'perdido'
      and matrix_seed.to_stage in (
        'novo_lead',
        'qualificacao',
        'orcamento',
        'visita_tecnica',
        'negociacao',
        'fechamento_pagamento',
        'instalacao_entrega',
        'pos_venda'
      ) then 'reopen_writer_required'
    when matrix_seed.from_stage in (
      'novo_lead',
      'qualificacao',
      'orcamento',
      'visita_tecnica',
      'negociacao',
      'fechamento_pagamento',
      'instalacao_entrega',
      'pos_venda'
    ) and matrix_seed.to_stage = 'concluido_sem_mais_acoes' then 'conclusion_writer_required'
    when matrix_seed.from_stage = 'concluido_sem_mais_acoes'
      and matrix_seed.to_stage = 'pos_venda' then 'post_sale_reopen_writer_required'
    when (
      matrix_seed.from_stage = 'concluido_sem_mais_acoes'
      and matrix_seed.to_stage in ('qualificacao', 'orcamento')
    ) or (
      matrix_seed.from_stage = 'pos_venda'
      and matrix_seed.to_stage in ('qualificacao', 'orcamento')
    ) then 'new_commercial_intent_requires_new_opportunity'
    when matrix_seed.route_reason_code is not null then matrix_seed.route_reason_code
    else 'transition_not_allowed'
  end as reason_code
from matrix_seed;

create temp table pg_temp._p9_actual_matrix as
with canonical_stage(stage_name) as (
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
)
select
  from_stage.stage_name as from_stage,
  to_stage.stage_name as to_stage,
  decision_row.decision,
  decision_row.is_permitted,
  decision_row.requires_specialized_writer,
  decision_row.reason_code
from canonical_stage from_stage
cross join canonical_stage to_stage
cross join lateral public.resolve_commercial_opportunity_stage_transition(
  from_stage.stage_name,
  to_stage.stage_name
) as decision_row;

create temp table pg_temp._p9_matrix_diff as
select
  coalesce(expected_row.from_stage, actual_row.from_stage) as from_stage,
  coalesce(expected_row.to_stage, actual_row.to_stage) as to_stage,
  expected_row.decision as expected_decision,
  actual_row.decision as actual_decision,
  expected_row.is_permitted as expected_is_permitted,
  actual_row.is_permitted as actual_is_permitted,
  expected_row.requires_specialized_writer as expected_requires_specialized_writer,
  actual_row.requires_specialized_writer as actual_requires_specialized_writer,
  expected_row.reason_code as expected_reason_code,
  actual_row.reason_code as actual_reason_code
from pg_temp._p9_expected_matrix expected_row
full join pg_temp._p9_actual_matrix actual_row
  on actual_row.from_stage = expected_row.from_stage
 and actual_row.to_stage = expected_row.to_stage
where expected_row.from_stage is null
   or actual_row.from_stage is null
   or expected_row.decision is distinct from actual_row.decision
   or expected_row.is_permitted is distinct from actual_row.is_permitted
   or expected_row.requires_specialized_writer is distinct from actual_row.requires_specialized_writer
   or expected_row.reason_code is distinct from actual_row.reason_code;

do $scenario_1$
declare
  v_count integer;
  v_distinct integer;
begin
  select count(*), count(distinct normalized_stage)
  into v_count, v_distinct
  from (
    select public.normalize_commercial_opportunity_stage(raw.stage) as normalized_stage
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

  perform pg_temp._p9_stage_transition_record(
    1,
    'todos os estagios canonicos sao reconhecidos',
    case when v_count = 10 and v_distinct = 10 then 'PASS' else 'SUT_FAIL' end,
    format('count=%s | distinct=%s', v_count, v_distinct)
  );
exception
  when others then
    perform pg_temp._p9_stage_transition_record(
      1,
      'todos os estagios canonicos sao reconhecidos',
      'HARNESS_ERROR',
      sqlerrm
    );
end;
$scenario_1$;

do $scenario_2$
declare
  v_case record;
  v_message text;
  v_failures text[] := array[]::text[];
begin
  create temp table pg_temp._p9_expected_errors (
    case_name text not null,
    from_input text null,
    to_input text null,
    expected_message text not null
  ) on commit drop;

  insert into pg_temp._p9_expected_errors (
    case_name,
    from_input,
    to_input,
    expected_message
  )
  values
    ('null from stage', null, 'novo_lead', 'ZION_COMMERCIAL_STAGE_REQUIRED'),
    ('null to stage', 'novo_lead', null, 'ZION_COMMERCIAL_STAGE_REQUIRED'),
    ('empty text', '', 'qualificacao', 'ZION_COMMERCIAL_STAGE_REQUIRED'),
    ('spaces only', '   ', 'qualificacao', 'ZION_COMMERCIAL_STAGE_REQUIRED'),
    ('unknown stage', 'novo_lead', 'etapa_inexistente', 'ZION_COMMERCIAL_STAGE_UNKNOWN'),
    ('follow_up', 'novo_lead', 'follow_up', 'ZION_COMMERCIAL_STAGE_UNKNOWN'),
    ('humano_assumiu', 'novo_lead', 'humano_assumiu', 'ZION_COMMERCIAL_STAGE_UNKNOWN');

  for v_case in
    select *
    from pg_temp._p9_expected_errors
    order by case_name
  loop
    begin
      perform *
      from public.resolve_commercial_opportunity_stage_transition(
        v_case.from_input,
        v_case.to_input
      );

      v_failures := array_append(
        v_failures,
        format('%s: unexpected success', v_case.case_name)
      );
    exception
      when sqlstate '22023' then
        get stacked diagnostics v_message = message_text;
        if v_message is distinct from v_case.expected_message then
          v_failures := array_append(
            v_failures,
            format(
              '%s: expected=%s actual=%s',
              v_case.case_name,
              v_case.expected_message,
              coalesce(v_message, '<null>')
            )
          );
        end if;
      when others then
        v_failures := array_append(
          v_failures,
          format('%s: unexpected sqlstate/message=%s/%s', v_case.case_name, sqlstate, sqlerrm)
        );
    end;
  end loop;

  perform pg_temp._p9_stage_transition_record(
    2,
    'entradas invalidas retornam o erro contratual',
    case when coalesce(array_length(v_failures, 1), 0) = 0 then 'PASS' else 'SUT_FAIL' end,
    case
      when coalesce(array_length(v_failures, 1), 0) = 0 then 'all invalid input cases matched expected messages'
      else array_to_string(v_failures, ' | ')
    end
  );
exception
  when others then
    perform pg_temp._p9_stage_transition_record(
      2,
      'entradas invalidas retornam o erro contratual',
      'HARNESS_ERROR',
      sqlerrm
    );
end;
$scenario_2$;

do $scenario_3$
declare
  v_expected_count integer;
  v_actual_count integer;
  v_diff_count integer;
begin
  select count(*) into v_expected_count from pg_temp._p9_expected_matrix;
  select count(*) into v_actual_count from pg_temp._p9_actual_matrix;
  select count(*) into v_diff_count from pg_temp._p9_matrix_diff;

  perform pg_temp._p9_stage_transition_record(
    3,
    'matriz completa de 100 combinacoes bate exatamente',
    case
      when v_expected_count = 100
       and v_actual_count = 100
       and v_diff_count = 0
      then 'PASS'
      else 'SUT_FAIL'
    end,
    format(
      'expected_count=%s | actual_count=%s | diff_count=%s',
      v_expected_count,
      v_actual_count,
      v_diff_count
    )
  );
exception
  when others then
    perform pg_temp._p9_stage_transition_record(
      3,
      'matriz completa de 100 combinacoes bate exatamente',
      'HARNESS_ERROR',
      sqlerrm
    );
end;
$scenario_3$;

do $scenario_4$
declare
  v_diff_count integer;
begin
  select count(*)
  into v_diff_count
  from (
    with expected_row (
      from_stage,
      to_stage,
      decision,
      is_permitted,
      requires_specialized_writer,
      reason_code
    ) as (
      values
        ('novo_lead', 'instalacao_entrega', 'forbidden', false, false, 'transition_not_allowed'),
        ('pos_venda', 'qualificacao', 'forbidden', false, false, 'new_commercial_intent_requires_new_opportunity'),
        ('pos_venda', 'orcamento', 'forbidden', false, false, 'new_commercial_intent_requires_new_opportunity'),
        ('concluido_sem_mais_acoes', 'pos_venda', 'conditional', false, true, 'post_sale_reopen_writer_required'),
        ('concluido_sem_mais_acoes', 'qualificacao', 'forbidden', false, false, 'new_commercial_intent_requires_new_opportunity'),
        ('negociacao', 'orcamento', 'conditional', false, false, 'quote_revision_required'),
        ('visita_tecnica', 'qualificacao', 'conditional', false, false, 'visit_result_missing_commercial_choices'),
        ('visita_tecnica', 'orcamento', 'conditional', false, false, 'visit_viable_quote_ready'),
        ('visita_tecnica', 'negociacao', 'conditional', false, false, 'visit_viable_concrete_offer_required')
    ),
    actual_row as (
      select actual_matrix.*
      from pg_temp._p9_actual_matrix actual_matrix
      join expected_row
        on expected_row.from_stage = actual_matrix.from_stage
       and expected_row.to_stage = actual_matrix.to_stage
    )
    select *
    from expected_row
    full join actual_row
      on actual_row.from_stage = expected_row.from_stage
     and actual_row.to_stage = expected_row.to_stage
     and actual_row.decision = expected_row.decision
     and actual_row.is_permitted = expected_row.is_permitted
     and actual_row.requires_specialized_writer = expected_row.requires_specialized_writer
     and actual_row.reason_code = expected_row.reason_code
    where expected_row.from_stage is null
       or actual_row.from_stage is null
  ) as mismatch;

  perform pg_temp._p9_stage_transition_record(
    4,
    'rotas exigidas no enunciado estao reconhecidas',
    case when v_diff_count = 0 then 'PASS' else 'SUT_FAIL' end,
    format('focused_route_diff_count=%s', v_diff_count)
  );
exception
  when others then
    perform pg_temp._p9_stage_transition_record(
      4,
      'rotas exigidas no enunciado estao reconhecidas',
      'HARNESS_ERROR',
      sqlerrm
    );
end;
$scenario_4$;

do $scenario_5$
declare
  v_first record;
  v_second record;
  v_equal boolean;
begin
  select *
  into v_first
  from public.resolve_commercial_opportunity_stage_transition('negociacao', 'orcamento');

  select *
  into v_second
  from public.resolve_commercial_opportunity_stage_transition('negociacao', 'orcamento');

  v_equal := to_jsonb(v_first) = to_jsonb(v_second);

  perform pg_temp._p9_stage_transition_record(
    5,
    'funcao responde deterministicamente para as mesmas entradas',
    case when v_equal then 'PASS' else 'SUT_FAIL' end,
    format(
      'equal=%s | first=%s | second=%s',
      v_equal,
      row_to_json(v_first)::text,
      row_to_json(v_second)::text
    )
  );
exception
  when others then
    perform pg_temp._p9_stage_transition_record(
      5,
      'funcao responde deterministicamente para as mesmas entradas',
      'HARNESS_ERROR',
      sqlerrm
    );
end;
$scenario_5$;

do $scenario_6$
declare
  v_public_touch_count integer;
begin
  select count(*)
  into v_public_touch_count
  from pg_catalog.pg_class class_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  where namespace_row.nspname = 'public'
    and class_row.relname like '_p9_stage_transition_%';

  perform pg_temp._p9_stage_transition_record(
    6,
    'runner usa apenas objetos temporarios e encerra com rollback',
    case when v_public_touch_count = 0 then 'PASS' else 'SUT_FAIL' end,
    format('public_named_artifacts=%s', v_public_touch_count)
  );
exception
  when others then
    perform pg_temp._p9_stage_transition_record(
      6,
      'runner usa apenas objetos temporarios e encerra com rollback',
      'HARNESS_ERROR',
      sqlerrm
    );
end;
$scenario_6$;

select
  result_row.scenario_number,
  result_row.scenario_name,
  result_row.status,
  result_row.details
from pg_temp._p9_stage_transition_results result_row
order by result_row.scenario_number;

select
  diff_row.from_stage,
  diff_row.to_stage,
  diff_row.expected_decision,
  diff_row.actual_decision,
  diff_row.expected_is_permitted,
  diff_row.actual_is_permitted,
  diff_row.expected_requires_specialized_writer,
  diff_row.actual_requires_specialized_writer,
  diff_row.expected_reason_code,
  diff_row.actual_reason_code
from pg_temp._p9_matrix_diff diff_row
order by diff_row.from_stage, diff_row.to_stage;

select
  actual_row.from_stage,
  actual_row.to_stage,
  actual_row.decision,
  actual_row.is_permitted,
  actual_row.requires_specialized_writer,
  actual_row.reason_code
from pg_temp._p9_actual_matrix actual_row
order by actual_row.from_stage, actual_row.to_stage;

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
  from pg_temp._p9_stage_transition_results
)
select
  case
    when scenario_summary.total_scenarios <> 6 then 'AINDA_NAO_APROVADA'
    when scenario_summary.passed_scenarios <> 6 then 'AINDA_NAO_APROVADA'
    when exists (select 1 from pg_temp._p9_matrix_diff) then 'AINDA_NAO_APROVADA'
    else 'APROVADA'
  end as final_status,
  scenario_summary.passed_scenarios,
  scenario_summary.total_scenarios,
  (select count(*) from pg_temp._p9_expected_matrix) as expected_combinations,
  (select count(*) from pg_temp._p9_actual_matrix) as actual_combinations,
  (select count(*) from pg_temp._p9_matrix_diff) as matrix_diff_count,
  scenario_summary.failed_scenarios
from scenario_summary;

rollback;
