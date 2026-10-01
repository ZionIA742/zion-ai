begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:customer-geography-region-materializer-v6:manual-checks:v1',
    0
  )
);

-- ============================================================================
-- ZION / P9 / Customer Geography Region Materializer v6
--
-- ROLLBACK ONLY.
-- Focus: deterministic customer/store geography evaluation for technical_visit.
-- This runner deliberately does not treat service_regions, location_text or
-- customer_address_text as coverage authority.
-- ============================================================================

create temporary table p9_r6_results (
  scenario_number integer not null,
  scenario_name text not null,
  status text not null,
  detail text not null
) on commit drop;

create temporary table p9_r6_context (
  organization_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  user_id uuid not null,
  opportunity_id uuid not null
) on commit drop;

create or replace function pg_temp.p9_r6_assert(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $function$
begin
  if not coalesce(p_condition, false) then
    raise exception using errcode = 'P0001', message = p_message;
  end if;
end;
$function$;

create or replace function pg_temp.p9_r6_policy(
  p_required text[],
  p_optional text[]
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'required_situations', to_jsonb(coalesce(p_required, '{}'::text[])),
    'required_other', null,
    'optional_situations', to_jsonb(coalesce(p_optional, '{}'::text[])),
    'optional_other', null,
    'team_mode', 'dono_loja',
    'team_rule', null,
    'requires_appointment', true,
    'duration_mode', '60',
    'duration_minutes', 60,
    'duration_rule', null,
    'preconfirm_items', '["endereco"]'::jsonb,
    'preconfirm_other', null,
    'notes', null
  );
$function$;

create or replace function pg_temp.p9_r6_set_region(
  p_primary_mode text,
  p_outside_consultation boolean,
  p_store_city text,
  p_store_state text,
  p_regions_text text default 'runner free text intentionally non-authoritative'
)
returns void
language plpgsql
as $function$
declare
  v_context pg_temp.p9_r6_context%rowtype;
begin
  select * into v_context from pg_temp.p9_r6_context limit 1;

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_context.user_id::text, true);

  perform public.upsert_store_strategy_region_configuration_scoped(
    p_organization_id => v_context.organization_id,
    p_store_id => v_context.store_id,
    p_service_regions => p_regions_text,
    p_service_region_modes => case
      when p_outside_consultation then
        array[p_primary_mode, 'sob_consulta']::text[]
      else
        array[p_primary_mode]::text[]
    end,
    p_service_region_primary_mode => p_primary_mode,
    p_service_region_outside_consultation => p_outside_consultation,
    p_service_region_notes => 'p9 region v6 rollback-only runner'
  );

  execute 'reset role';

  -- The region-specific writer intentionally does not own store city/state.
  -- This rollback-only fixture sets those existing Strategy fields directly so
  -- every scenario has deterministic store geography.
  update public.store_strategy_settings
  set
    city = p_store_city,
    state = p_store_state
  where organization_id = v_context.organization_id
    and store_id = v_context.store_id;
end;
$function$;

create or replace function pg_temp.p9_r6_set_technical_policy(
  p_offered boolean
)
returns void
language plpgsql
as $function$
declare
  v_context pg_temp.p9_r6_context%rowtype;
begin
  select * into v_context from pg_temp.p9_r6_context limit 1;

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_context.user_id::text, true);

  perform public.upsert_store_operation_technical_visit_configuration_scoped(
    p_organization_id => v_context.organization_id,
    p_store_id => v_context.store_id,
    p_offers_technical_visit => p_offered,
    p_technical_visit_policy => case
      when p_offered then pg_temp.p9_r6_policy(
        array['toda_venda_piscina']::text[],
        '{}'::text[]
      )
      else null
    end,
    p_technical_visit_pricing_mode => case
      when p_offered then 'free'
      else null
    end,
    p_technical_visit_fixed_fee_cents => null,
    p_technical_visit_case_by_case_rule => null,
    p_technical_visit_fee_deductible_from_purchase => null
  );

  execute 'reset role';
end;
$function$;

create or replace function pg_temp.p9_r6_write_gate_policy()
returns uuid
language plpgsql
as $function$
declare
  v_context pg_temp.p9_r6_context%rowtype;
  v_rules jsonb;
  v_result record;
begin
  select * into v_context from pg_temp.p9_r6_context limit 1;

  v_rules := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'rule_key', 'qualification.always.required',
      'rule_priority', 10,
      'item_kind', 'commercial_gate',
      'item_key', 'qualification',
      'match_mode', 'always',
      'component_kind', null,
      'execution_kind', null,
      'applicability_state', 'required',
      'reason_code', 'commercial_opportunity_requires_qualification',
      'metadata', '{}'::jsonb
    ),
    pg_catalog.jsonb_build_object(
      'rule_key', 'quote.pool.required',
      'rule_priority', 20,
      'item_kind', 'commercial_gate',
      'item_key', 'quote',
      'match_mode', 'component',
      'component_kind', 'pool',
      'execution_kind', null,
      'applicability_state', 'required',
      'reason_code', 'pool_sale_requires_quote',
      'metadata', '{}'::jsonb
    )
  );

  select *
  into v_result
  from public.write_store_opportunity_gate_policy_internal(
    v_context.organization_id,
    v_context.store_id,
    'p9:r6:runner:gate:' || pg_catalog.clock_timestamp()::text,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_rules::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    v_rules,
    'system',
    null,
    'manual_check_runner',
    'p9_region_v6_runner_policy',
    'p9_region_v6_runner',
    '{"runner":true}'::jsonb
  );

  return v_result.policy_version_id;
end;
$function$;

create or replace function pg_temp.p9_r6_write_profile()
returns uuid
language plpgsql
as $function$
declare
  v_context pg_temp.p9_r6_context%rowtype;
  v_components jsonb;
  v_payload text;
  v_result record;
begin
  select * into v_context from pg_temp.p9_r6_context limit 1;

  v_components := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'component_key', 'runner_pool',
      'component_kind', 'pool',
      'component_state', 'partial',
      'pool_id', null,
      'catalog_item_id', null,
      'reference_text', 'runner pool',
      'metadata', '{"runner":true}'::jsonb
    )
  );

  v_payload := v_components::text || ':needs_clarification';

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  select *
  into v_result
  from public.write_commercial_opportunity_profile_by_system(
    v_context.organization_id,
    v_context.store_id,
    v_context.opportunity_id,
    'p9:r6:runner:profile:' || pg_catalog.clock_timestamp()::text,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_payload, 'UTF8'), 'sha256'),
      'hex'
    ),
    'needs_clarification',
    v_components,
    '[]'::jsonb,
    'manual_check_runner',
    'p9_region_v6_runner_profile',
    'p9_region_v6_runner',
    '{"runner":true}'::jsonb
  );

  execute 'reset role';
  return v_result.profile_version_id;
end;
$function$;

create or replace function pg_temp.p9_r6_reset_geography()
returns void
language plpgsql
as $function$
declare
  v_context pg_temp.p9_r6_context%rowtype;
begin
  select * into v_context from pg_temp.p9_r6_context limit 1;

  -- Rollback-only fixture reset. Qualification fact events are canonical
  -- append-only history and must never be deleted, even by a test runner.
  -- Clearing only the materialized current projection lets the next canonical
  -- writer event establish a fresh scenario value while preserving history.
  delete from public.commercial_opportunity_qualification_facts_current current_row
  where current_row.organization_id = v_context.organization_id
    and current_row.store_id = v_context.store_id
    and current_row.commercial_opportunity_id = v_context.opportunity_id
    and current_row.fact_key in ('customer_city', 'customer_state_code');
end;
$function$;

create or replace function pg_temp.p9_r6_write_geo_fact(
  p_fact_key text,
  p_value text,
  p_assertion_level text
)
returns void
language plpgsql
as $function$
declare
  v_context pg_temp.p9_r6_context%rowtype;
  v_source_type text;
begin
  select * into v_context from pg_temp.p9_r6_context limit 1;

  perform pg_temp.p9_r6_assert(
    p_fact_key in ('customer_city', 'customer_state_code'),
    'FIXTURE_FAIL: invalid geography fact key'
  );

  perform pg_temp.p9_r6_assert(
    p_assertion_level in ('confirmed', 'inferred'),
    'FIXTURE_FAIL: invalid geography assertion level'
  );

  v_source_type := case
    when p_assertion_level = 'confirmed' then 'system_correction'
    else 'system_inference'
  end;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  perform public.write_commercial_opportunity_qualification_fact_by_system(
    v_context.organization_id,
    v_context.store_id,
    v_context.opportunity_id,
    'p9:r6:qfact:' || p_fact_key || ':' || pg_catalog.clock_timestamp()::text,
    p_fact_key,
    to_jsonb(p_value),
    p_assertion_level,
    v_source_type,
    null,
    null,
    'p9_region_v6_runner',
    false
  );

  execute 'reset role';
end;
$function$;

create or replace function pg_temp.p9_r6_set_customer_geography(
  p_city text,
  p_city_assertion text,
  p_state text,
  p_state_assertion text
)
returns void
language plpgsql
as $function$
begin
  perform pg_temp.p9_r6_reset_geography();

  if p_city is not null then
    perform pg_temp.p9_r6_write_geo_fact(
      'customer_city',
      p_city,
      p_city_assertion
    );
  end if;

  if p_state is not null then
    perform pg_temp.p9_r6_write_geo_fact(
      'customer_state_code',
      p_state,
      p_state_assertion
    );
  end if;
end;
$function$;

create or replace function pg_temp.p9_r6_materialize(
  p_event_key text
)
returns table (
  current_checklist_version_id uuid,
  version_number integer,
  outcome text,
  changed boolean,
  replayed boolean
)
language plpgsql
as $function$
declare
  v_context pg_temp.p9_r6_context%rowtype;
begin
  select * into v_context from pg_temp.p9_r6_context limit 1;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  return query
  select
    result.current_checklist_version_id,
    result.version_number,
    result.outcome,
    result.changed,
    result.replayed
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_context.organization_id,
    v_context.store_id,
    v_context.opportunity_id,
    p_event_key
  ) result;

  execute 'reset role';
end;
$function$;

create or replace function pg_temp.p9_r6_technical_item(
  p_checklist_version_id uuid
)
returns public.commercial_opportunity_checklist_items
language plpgsql
as $function$
declare
  v_context pg_temp.p9_r6_context%rowtype;
  v_item public.commercial_opportunity_checklist_items%rowtype;
begin
  select * into v_context from pg_temp.p9_r6_context limit 1;

  select *
  into v_item
  from public.commercial_opportunity_checklist_items item_row
  where item_row.organization_id = v_context.organization_id
    and item_row.store_id = v_context.store_id
    and item_row.commercial_opportunity_id = v_context.opportunity_id
    and item_row.checklist_version_id = p_checklist_version_id
    and item_row.item_key = 'technical_visit';

  return v_item;
end;
$function$;

do $runner$
declare
  v_context pg_temp.p9_r6_context%rowtype;
  v_result record;
  v_item public.commercial_opportunity_checklist_items%rowtype;
begin
  insert into pg_temp.p9_r6_context (
    organization_id,
    store_id,
    customer_id,
    user_id,
    opportunity_id
  )
  select
    store_row.organization_id,
    store_row.id,
    customer_row.id,
    membership_row.user_id,
    gen_random_uuid()
  from public.stores store_row
  join public.customers customer_row
    on customer_row.organization_id = store_row.organization_id
  join public.memberships membership_row
    on membership_row.organization_id = store_row.organization_id
   and membership_row.is_active is true
  join auth.users user_row
    on user_row.id = membership_row.user_id
  order by
    store_row.organization_id,
    store_row.id,
    customer_row.id,
    membership_row.user_id
  limit 1;

  perform pg_temp.p9_r6_assert(
    exists (select 1 from pg_temp.p9_r6_context),
    'FIXTURE_FAIL: no store/customer/active auth-backed member available'
  );

  select * into v_context from pg_temp.p9_r6_context limit 1;

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage
  )
  values (
    v_context.opportunity_id,
    v_context.organization_id,
    v_context.store_id,
    v_context.customer_id,
    'qualificacao'
  );

  delete from public.store_contract_settings
  where organization_id = v_context.organization_id
    and store_id = v_context.store_id;

  insert into public.store_contract_settings (
    organization_id,
    store_id,
    contract_enabled
  )
  values (
    v_context.organization_id,
    v_context.store_id,
    true
  );

  perform pg_temp.p9_r6_write_gate_policy();
  perform pg_temp.p9_r6_write_profile();
  perform pg_temp.p9_r6_set_technical_policy(true);

  -- 1. SQL normalizer stays aligned with the TypeScript municipality contract.
  perform pg_temp.p9_r6_assert(
    public.p9_normalize_brazilian_municipality_lookup_name_internal(' Suzano ')
      = 'suzano'
    and public.p9_normalize_brazilian_municipality_lookup_name_internal(
      'São João del Rei'
    ) = 'sao joao del rei'
    and public.p9_normalize_brazilian_municipality_lookup_name_internal(
      'Pingo-d''Água'
    ) = 'pingo d agua',
    'SUT_FAIL 1: municipality normalizer diverged from runtime contract'
  );
  insert into pg_temp.p9_r6_results values (
    1,
    'normalizador municipal',
    'PASS',
    'trim/accent/punctuation contract'
  );

  -- 2. sob_consulta is only fallback: same store municipality stays authorized.
  perform pg_temp.p9_r6_set_region(
    'somente_cidade_loja',
    true,
    'Suzano',
    'SP',
    'Curitiba'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Suzano',
    'confirmed',
    'SP',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r6:scenario:02');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'required'
    and v_item.reason_code = 'technical_visit_required_for_pool_sale'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'authorized'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_reason}'
      = 'technical_visit_region_same_store_municipality'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,customer_geography,municipality_ibge_code}'
      = '3552502'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,service_regions_text_used}'
      = 'false',
    'SUT_FAIL 2: same city was not authorized before sob_consulta fallback'
  );
  insert into pg_temp.p9_r6_results values (
    2,
    'somente cidade loja mesma cidade com sob_consulta',
    'PASS',
    'authorized before fallback'
  );

  -- 3. Store/customer municipality comparison is accent/punctuation insensitive.
  perform pg_temp.p9_r6_set_region(
    'somente_cidade_loja',
    false,
    'São João del Rei',
    'MG'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Sao Joao del Rei',
    'confirmed',
    'MG',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r6:scenario:03');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'required'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'authorized',
    'SUT_FAIL 3: normalized equivalent municipality did not authorize'
  );
  insert into pg_temp.p9_r6_results values (
    3,
    'normalizacao municipal na cobertura',
    'PASS',
    'accent-insensitive IBGE identity'
  );

  -- 4. todo_estado accepts a deterministic inferred UF when city is confirmed.
  perform pg_temp.p9_r6_set_region(
    'todo_estado',
    true,
    'Suzano',
    'SP'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Campinas',
    'confirmed',
    'SP',
    'inferred'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r6:scenario:04');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'required'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'authorized'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_reason}'
      = 'technical_visit_region_same_state'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,customer_geography,state_fact_state}'
      = 'inferred',
    'SUT_FAIL 4: todo_estado did not accept canonical inferred UF'
  );
  insert into pg_temp.p9_r6_results values (
    4,
    'todo estado com UF inferida',
    'PASS',
    'same UF authorized'
  );

  -- 5. Proven outside state without consultation stays outside_coverage.
  perform pg_temp.p9_r6_set_region(
    'todo_estado',
    false,
    'Suzano',
    'SP'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Curitiba',
    'confirmed',
    'PR',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r6:scenario:05');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_outside_coverage'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'outside_coverage'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_state}'
      = 'outside_coverage',
    'SUT_FAIL 5: different state was not proven outside coverage'
  );
  insert into pg_temp.p9_r6_results values (
    5,
    'todo estado fora sem consulta',
    'PASS',
    'outside_coverage'
  );

  -- 6. Proven outside state with consultation becomes under_consultation.
  perform pg_temp.p9_r6_set_region(
    'todo_estado',
    true,
    'Suzano',
    'SP'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Curitiba',
    'confirmed',
    'PR',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r6:scenario:06');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_under_consultation'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'under_consultation'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_state}'
      = 'outside_coverage',
    'SUT_FAIL 6: sob_consulta was not applied after proven outside coverage'
  );
  insert into pg_temp.p9_r6_results values (
    6,
    'todo estado fora com consulta',
    'PASS',
    'under_consultation after outside'
  );

  -- 7. cidade_e_vizinhas always includes the store municipality itself.
  perform pg_temp.p9_r6_set_region(
    'cidade_e_vizinhas',
    false,
    'Suzano',
    'SP'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Suzano',
    'confirmed',
    'SP',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r6:scenario:07');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'required'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'authorized'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_reason}'
      = 'technical_visit_region_same_store_municipality',
    'SUT_FAIL 7: cidade_e_vizinhas did not authorize the store municipality'
  );
  insert into pg_temp.p9_r6_results values (
    7,
    'cidade e vizinhas inclui cidade da loja',
    'PASS',
    'store municipality authorized'
  );

  -- 8. Another city under cidade_e_vizinhas cannot be guessed and does not fall
  -- through to sob_consulta because outside coverage was not proven.
  perform pg_temp.p9_r6_set_region(
    'cidade_e_vizinhas',
    true,
    'Suzano',
    'SP',
    'Suzano e cidades proximas'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Mogi das Cruzes',
    'confirmed',
    'SP',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r6:scenario:08');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_neighbor_coverage_not_structured'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'needs_resolution'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_state}'
      = 'needs_resolution',
    'SUT_FAIL 8: unstructured neighbor coverage was guessed or sent to consultation'
  );
  insert into pg_temp.p9_r6_results values (
    8,
    'cidade e vizinhas sem lista estruturada',
    'PASS',
    'needs_resolution without guessing'
  );

  -- 9. grande_regiao remains unresolved until structured coverage exists.
  perform pg_temp.p9_r6_set_region(
    'grande_regiao',
    true,
    'Suzano',
    'SP',
    'Grande Sao Paulo'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'São Paulo',
    'confirmed',
    'SP',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r6:scenario:09');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_large_region_coverage_not_structured'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'needs_resolution',
    'SUT_FAIL 9: grande_regiao free text became coverage authority'
  );
  insert into pg_temp.p9_r6_results values (
    9,
    'grande regiao sem cobertura estruturada',
    'PASS',
    'needs_resolution'
  );

  -- 10. Missing customer city fails closed even when UF exists.
  perform pg_temp.p9_r6_set_region(
    'todo_estado',
    false,
    'Suzano',
    'SP'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    null,
    null,
    'SP',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r6:scenario:10');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_customer_city_missing',
    'SUT_FAIL 10: missing city did not fail closed'
  );
  insert into pg_temp.p9_r6_results values (
    10,
    'cidade do cliente ausente',
    'PASS',
    'fail closed'
  );

  -- 11. Inferred city is not sufficient regional authority.
  perform pg_temp.p9_r6_set_customer_geography(
    'Suzano',
    'inferred',
    'SP',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r6:scenario:11');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_customer_city_not_confirmed',
    'SUT_FAIL 11: inferred city was treated as confirmed regional authority'
  );
  insert into pg_temp.p9_r6_results values (
    11,
    'cidade inferida nao autoriza',
    'PASS',
    'confirmed city required'
  );

  -- 12. City/UF pair must resolve to the official local municipality reference.
  perform pg_temp.p9_r6_set_customer_geography(
    'Curitiba',
    'confirmed',
    'SP',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r6:scenario:12');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_customer_municipality_unresolved',
    'SUT_FAIL 12: invalid city/UF pair bypassed municipality reference'
  );
  insert into pg_temp.p9_r6_results values (
    12,
    'cidade e UF incompatíveis',
    'PASS',
    'IBGE pair validation'
  );

  -- 13. service_regions free text neither authorizes nor blocks exact primary logic.
  perform pg_temp.p9_r6_set_region(
    'somente_cidade_loja',
    false,
    'Suzano',
    'SP',
    'Curitiba, PR'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Suzano',
    'confirmed',
    'SP',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r6:scenario:13');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'required'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'authorized'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,service_regions_text_used}'
      = 'false'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,location_text_used}'
      = 'false'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,customer_address_text_used}'
      = 'false',
    'SUT_FAIL 13: free text leaked into coverage authority'
  );
  insert into pg_temp.p9_r6_results values (
    13,
    'texto livre nao participa da cobertura',
    'PASS',
    'structured authority only'
  );

  -- 14. Conflicting confirmed customer cities fail closed and never reach
  -- sob_consulta because primary coverage was not proven outside.
  perform pg_temp.p9_r6_set_technical_policy(true);
  perform pg_temp.p9_r6_set_region(
    'todo_estado',
    true,
    'Suzano',
    'SP'
  );
  perform pg_temp.p9_r6_reset_geography();
  perform pg_temp.p9_r6_write_geo_fact(
    'customer_city',
    'Suzano',
    'confirmed'
  );
  perform pg_temp.p9_r6_write_geo_fact(
    'customer_city',
    'Campinas',
    'confirmed'
  );
  perform pg_temp.p9_r6_write_geo_fact(
    'customer_state_code',
    'SP',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r7:scenario:14');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_customer_city_conflict'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'needs_resolution'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_reason}'
      = 'technical_visit_region_customer_city_conflict'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,customer_geography,city_fact_state}'
      = 'conflict',
    'SUT_FAIL 14: conflicting customer city did not fail closed'
  );
  insert into pg_temp.p9_r6_results values (
    14,
    'conflito de cidade do cliente',
    'PASS',
    'conflict blocks coverage and consultation fallback'
  );

  -- 15. Confirmed customer city without UF fails closed.
  perform pg_temp.p9_r6_set_region(
    'todo_estado',
    true,
    'Suzano',
    'SP'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Suzano',
    'confirmed',
    null,
    null
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r7:scenario:15');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_customer_state_missing'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'needs_resolution'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_reason}'
      = 'technical_visit_region_customer_state_missing'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,customer_geography,state_fact_state}'
      = 'missing',
    'SUT_FAIL 15: missing customer UF did not fail closed'
  );
  insert into pg_temp.p9_r6_results values (
    15,
    'UF do cliente ausente',
    'PASS',
    'confirmed city without UF fails closed'
  );

  -- 16. Conflicting confirmed customer UFs fail closed.
  perform pg_temp.p9_r6_set_region(
    'todo_estado',
    true,
    'Suzano',
    'SP'
  );
  perform pg_temp.p9_r6_reset_geography();
  perform pg_temp.p9_r6_write_geo_fact(
    'customer_city',
    'Suzano',
    'confirmed'
  );
  perform pg_temp.p9_r6_write_geo_fact(
    'customer_state_code',
    'SP',
    'confirmed'
  );
  perform pg_temp.p9_r6_write_geo_fact(
    'customer_state_code',
    'PR',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r7:scenario:16');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_customer_state_conflict'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'needs_resolution'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_reason}'
      = 'technical_visit_region_customer_state_conflict'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,customer_geography,state_fact_state}'
      = 'conflict',
    'SUT_FAIL 16: conflicting customer UF did not fail closed'
  );
  insert into pg_temp.p9_r6_results values (
    16,
    'conflito de UF do cliente',
    'PASS',
    'conflicting UF blocks coverage'
  );

  -- 17. Non-empty but structurally invalid customer UF is rejected by the
  -- regional authority instead of being treated as a valid state code.
  perform pg_temp.p9_r6_set_region(
    'todo_estado',
    true,
    'Suzano',
    'SP'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Suzano',
    'confirmed',
    'Sao Paulo',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r7:scenario:17');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_customer_state_invalid'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'needs_resolution'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_reason}'
      = 'technical_visit_region_customer_state_invalid'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,customer_geography,state_code}'
      = 'SAO PAULO',
    'SUT_FAIL 17: invalid customer UF shape was accepted'
  );
  insert into pg_temp.p9_r6_results values (
    17,
    'UF do cliente invalida',
    'PASS',
    'invalid UF shape fails closed'
  );

  -- 18. Region settings that are not canonically marked configured do not
  -- authorize coverage even when residual region values exist.
  perform pg_temp.p9_r6_set_region(
    'todo_estado',
    true,
    'Suzano',
    'SP'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Suzano',
    'confirmed',
    'SP',
    'confirmed'
  );

  update public.store_strategy_settings
  set service_region_configured_at = null
  where organization_id = v_context.organization_id
    and store_id = v_context.store_id;

  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r7:scenario:18');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_not_configured'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'needs_resolution'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,reason_code}'
      = 'technical_visit_region_not_configured'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,configured}'
      = 'false',
    'SUT_FAIL 18: unconfigured region settings authorized coverage'
  );
  insert into pg_temp.p9_r6_results values (
    18,
    'regiao nao configurada',
    'PASS',
    'configured marker is required'
  );

  -- 19. Invalid store UF fails closed.
  perform pg_temp.p9_r6_set_region(
    'todo_estado',
    true,
    'Suzano',
    'Sao Paulo'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Suzano',
    'confirmed',
    'SP',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r7:scenario:19');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_store_state_invalid'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'needs_resolution'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_reason}'
      = 'technical_visit_region_store_state_invalid'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,store_geography,state_code}'
      = 'SAO PAULO',
    'SUT_FAIL 19: invalid store UF shape was accepted'
  );
  insert into pg_temp.p9_r6_results values (
    19,
    'UF da loja invalida',
    'PASS',
    'invalid store UF fails closed'
  );

  -- 20. Municipal coverage requires a usable store city.
  perform pg_temp.p9_r6_set_region(
    'somente_cidade_loja',
    true,
    null,
    'SP'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Suzano',
    'confirmed',
    'SP',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r7:scenario:20');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_store_city_invalid'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'needs_resolution'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_reason}'
      = 'technical_visit_region_store_city_invalid',
    'SUT_FAIL 20: missing store city authorized municipal coverage'
  );
  insert into pg_temp.p9_r6_results values (
    20,
    'cidade da loja invalida',
    'PASS',
    'municipal mode requires store city'
  );

  -- 21. Store city/UF must resolve against the local official municipality
  -- reference before municipality-based coverage can be decided.
  perform pg_temp.p9_r6_set_region(
    'somente_cidade_loja',
    true,
    'Atlantida',
    'SP'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Suzano',
    'confirmed',
    'SP',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r7:scenario:21');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_store_municipality_unresolved'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'needs_resolution'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_reason}'
      = 'technical_visit_region_store_municipality_unresolved'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,store_geography,municipality_resolved}'
      = 'false',
    'SUT_FAIL 21: unresolved store municipality authorized coverage'
  );
  insert into pg_temp.p9_r6_results values (
    21,
    'municipio da loja nao resolvido',
    'PASS',
    'official municipality resolution required'
  );

  -- 22. somente_cidade_loja proves a different valid municipality outside
  -- primary coverage; without sob_consulta it remains outside_coverage.
  perform pg_temp.p9_r6_set_region(
    'somente_cidade_loja',
    false,
    'Suzano',
    'SP'
  );
  perform pg_temp.p9_r6_set_customer_geography(
    'Campinas',
    'confirmed',
    'SP',
    'confirmed'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r7:scenario:22');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_outside_coverage'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,state}'
      = 'outside_coverage'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_state}'
      = 'outside_coverage'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,primary_coverage_reason}'
      = 'technical_visit_region_different_store_municipality',
    'SUT_FAIL 22: different store municipality was not proven outside coverage'
  );
  insert into pg_temp.p9_r6_results values (
    22,
    'municipio diferente da loja',
    'PASS',
    'different municipality is outside somente_cidade_loja'
  );
  -- 23. When technical visit is not offered, geography is immaterial.
  perform pg_temp.p9_r6_set_technical_policy(false);
  perform pg_temp.p9_r6_reset_geography();
  perform pg_temp.p9_r6_set_region(
    'grande_regiao',
    true,
    'Suzano',
    'SP',
    'qualquer texto'
  );
  select * into v_result
  from pg_temp.p9_r6_materialize('p9:r7:scenario:23');
  v_item := pg_temp.p9_r6_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_r6_assert(
    v_item.applicability_state = 'not_applicable'
    and v_item.reason_code = 'store_does_not_offer_technical_visit'
    and v_item.decision_basis #> '{selected_candidates,0,region_assessment}' is null,
    'SUT_FAIL 23: irrelevant geography changed not-offered technical visit'
  );
  insert into pg_temp.p9_r6_results values (
    23,
    'regiao irrelevante quando visita nao oferecida',
    'PASS',
    'not_applicable without region assessment'
  );

  perform pg_temp.p9_r6_assert(
    (select pg_catalog.count(*) from pg_temp.p9_r6_results) = 23,
    'SUT_FAIL: expected 23 regional matrix scenarios'
  );
end;
$runner$;

select *
from pg_temp.p9_r6_results
order by scenario_number;

rollback;
