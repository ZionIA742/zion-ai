begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:technical-visit-p19a-applicability:manual-checks:v3', 0)
);

-- ============================================================================
-- P9 / Bloco 7 / Etapa 7.1
-- Manual checks: technical_visit applicability comes from P19-A Settings.
--
-- ROLLBACK ONLY. This runner creates an isolated opportunity fixture inside the
-- transaction, calls materialize_commercial_opportunity_checklist_by_system,
-- and validates persisted current/items/decision_basis/fingerprints.
-- ============================================================================

create temporary table p9_71_results (
  scenario_number integer not null,
  scenario_name text not null,
  status text not null,
  detail text not null
) on commit drop;

create temporary table p9_71_context (
  organization_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  user_id uuid not null,
  opportunity_id uuid not null
) on commit drop;

create or replace function pg_temp.p9_71_assert(
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

create or replace function pg_temp.p9_71_policy(
  p_required text[],
  p_optional text[],
  p_required_other text default null,
  p_optional_other text default null
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'required_situations', to_jsonb(coalesce(p_required, '{}'::text[])),
    'required_other', p_required_other,
    'optional_situations', to_jsonb(coalesce(p_optional, '{}'::text[])),
    'optional_other', p_optional_other,
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

create or replace function pg_temp.p9_71_set_region(
  p_configured boolean,
  p_sob_consulta boolean default false,
  p_regions text default 'Sao Paulo'
)
returns void
language plpgsql
as $function$
declare
  v_context pg_temp.p9_71_context%rowtype;
begin
  select * into v_context from pg_temp.p9_71_context limit 1;

  if p_configured then
    -- Region is a human-owned P19-A authority. Exercise its canonical authenticated
    -- writer with an actual active organization member selected by this runner.
    execute 'set local role authenticated';
    perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
    perform pg_catalog.set_config('request.jwt.claim.sub', v_context.user_id::text, true);

    perform public.upsert_store_strategy_region_configuration_scoped(
      p_organization_id => v_context.organization_id,
      p_store_id => v_context.store_id,
      p_service_regions => p_regions,
      p_service_region_modes => case
        when p_sob_consulta then
          array['somente_cidade_loja', 'sob_consulta']::text[]
        else
          array['somente_cidade_loja']::text[]
      end,
      p_service_region_primary_mode => 'somente_cidade_loja',
      p_service_region_outside_consultation => p_sob_consulta,
      p_service_region_notes => 'p9 7.1 rollback-only runner'
    );

    execute 'reset role';
  else
    -- There is no public "unconfigure" action. This rollback-only fixture clears
    -- only the explicit marker so unrelated Strategy authority stays untouched.
    update public.store_strategy_settings
    set service_region_configured_at = null
    where organization_id = v_context.organization_id
      and store_id = v_context.store_id;
  end if;
end;
$function$;

create or replace function pg_temp.p9_71_set_technical_policy(
  p_configured boolean,
  p_policy jsonb,
  p_legacy_mirror boolean
)
returns void
language plpgsql
as $function$
declare
  v_context pg_temp.p9_71_context%rowtype;
  v_expected_mirror boolean;
begin
  select * into v_context from pg_temp.p9_71_context limit 1;

  if not p_configured then
    -- There is no public "never configured" action. This rollback-only fixture
    -- clears only technical-visit authority fields and preserves installation.
    update public.store_operation_execution_policies
    set
      technical_visit_policy = null,
      technical_visit_configured_at = null,
      updated_at = pg_catalog.timezone('utc', pg_catalog.now())
    where organization_id = v_context.organization_id
      and store_id = v_context.store_id;
    return;
  end if;

  v_expected_mirror := p_policy is not null;

  -- Exercise the canonical human-owned writer with an active organization member.
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_context.user_id::text, true);

  perform public.upsert_store_operation_technical_visit_configuration_scoped(
    p_organization_id => v_context.organization_id,
    p_store_id => v_context.store_id,
    p_offers_technical_visit => v_expected_mirror,
    p_technical_visit_policy => p_policy,
    p_technical_visit_pricing_mode => case
      when v_expected_mirror then 'free'
      else null
    end,
    p_technical_visit_fixed_fee_cents => null,
    p_technical_visit_case_by_case_rule => null,
    p_technical_visit_fee_deductible_from_purchase => null
  );

  execute 'reset role';

  if p_legacy_mirror is distinct from v_expected_mirror then
    -- Deliberate rollback-only fault injection. The canonical writer keeps the
    -- legacy mirror aligned, so only a direct update can test divergence.
    update public.store_operation_settings
    set offers_technical_visit = p_legacy_mirror
    where organization_id = v_context.organization_id
      and store_id = v_context.store_id;
  end if;
end;
$function$;

create or replace function pg_temp.p9_71_write_gate_policy(
  p_include_technical_visit boolean,
  p_technical_priority integer default 9999
)
returns uuid
language plpgsql
as $function$
declare
  v_context pg_temp.p9_71_context%rowtype;
  v_rules jsonb;
  v_result record;
begin
  select * into v_context from pg_temp.p9_71_context limit 1;

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

  if p_include_technical_visit then
    v_rules := v_rules || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'rule_key', 'technical_visit.legacy.high_priority',
        'rule_priority', p_technical_priority,
        'item_kind', 'commercial_gate',
        'item_key', 'technical_visit',
        'match_mode', 'always',
        'component_kind', null,
        'execution_kind', null,
        'applicability_state', 'required',
        'reason_code', 'legacy_gate_policy_must_not_win',
        'metadata', '{}'::jsonb
      )
    );
  end if;

  select *
  into v_result
  from public.write_store_opportunity_gate_policy_internal(
    v_context.organization_id,
    v_context.store_id,
    'p9:7.1:runner:gate:' || pg_catalog.clock_timestamp()::text,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_rules::text, 'UTF8'), 'sha256'), 'hex'),
    v_rules,
    'system',
    null,
    'manual_check_runner',
    'p9_technical_visit_p19a_runner_policy',
    'p9_technical_visit_p19a_runner',
    '{"runner":true}'::jsonb
  );

  return v_result.policy_version_id;
end;
$function$;

create or replace function pg_temp.p9_71_write_profile(
  p_pool_state text default null,
  p_installation_state text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $function$
declare
  v_context pg_temp.p9_71_context%rowtype;
  v_components jsonb := '[]'::jsonb;
  v_intents jsonb := '[]'::jsonb;
  v_payload text;
  v_profile_state text;
  v_result record;
begin
  select * into v_context from pg_temp.p9_71_context limit 1;

  if p_pool_state is not null then
    if p_pool_state not in ('partial', 'conflict') then
      raise exception using
        errcode = '22023',
        message = 'FIXTURE_FAIL: pool state must be partial or conflict in this runner';
    end if;

    v_components := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'component_key', 'runner_pool',
        'component_kind', 'pool',
        'component_state', p_pool_state,
        'pool_id', null,
        'catalog_item_id', null,
        'reference_text', 'runner pool',
        'metadata', coalesce(p_metadata, '{}'::jsonb)
      )
    );
  end if;

  if p_installation_state is not null then
    v_intents := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'execution_kind', 'installation',
        'intent_state', p_installation_state,
        'reason_code', 'runner_installation_' || p_installation_state,
        'metadata', coalesce(p_metadata, '{}'::jsonb)
      )
    );
  end if;

  v_profile_state := case
    when p_pool_state = 'conflict'
      or p_installation_state = 'conflict'
      then 'conflict'
    else 'needs_clarification'
  end;

  v_payload :=
    v_components::text || ':' ||
    v_intents::text || ':' ||
    v_profile_state || ':' ||
    coalesce(p_metadata, '{}'::jsonb)::text;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  select *
  into v_result
  from public.write_commercial_opportunity_profile_by_system(
    v_context.organization_id,
    v_context.store_id,
    v_context.opportunity_id,
    'p9:7.1:runner:profile:' || pg_catalog.clock_timestamp()::text,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_payload, 'UTF8'), 'sha256'),
      'hex'
    ),
    v_profile_state,
    v_components,
    v_intents,
    'manual_check_runner',
    'p9_technical_visit_p19a_runner_profile',
    'p9_technical_visit_p19a_runner',
    '{"runner":true}'::jsonb
  );

  execute 'reset role';
  return v_result.profile_version_id;
end;
$function$;

create or replace function pg_temp.p9_71_materialize(
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
  v_context pg_temp.p9_71_context%rowtype;
begin
  select * into v_context from pg_temp.p9_71_context limit 1;

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

create or replace function pg_temp.p9_71_technical_item(
  p_checklist_version_id uuid
)
returns public.commercial_opportunity_checklist_items
language plpgsql
as $function$
declare
  v_context pg_temp.p9_71_context%rowtype;
  v_item public.commercial_opportunity_checklist_items%rowtype;
begin
  select * into v_context from pg_temp.p9_71_context limit 1;

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

create or replace function pg_temp.p9_71_override_technical(
  p_expected_version_id uuid,
  p_to_state text,
  p_event_key text
)
returns uuid
language plpgsql
as $function$
declare
  v_context pg_temp.p9_71_context%rowtype;
  v_result record;
begin
  select * into v_context from pg_temp.p9_71_context limit 1;

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_context.user_id::text, true);

  select *
  into v_result
  from public.override_commercial_opportunity_checklist_item_by_user(
    v_context.organization_id,
    v_context.store_id,
    v_context.opportunity_id,
    p_expected_version_id,
    p_event_key,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_event_key || ':' || p_to_state, 'UTF8'), 'sha256'), 'hex'),
    'technical_visit',
    'commercial_gate',
    p_to_state,
    'runner_human_override',
    'runner human override',
    '{"runner":true}'::jsonb
  );

  execute 'reset role';
  return v_result.result_checklist_version_id;
end;
$function$;

do $runner$
declare
  v_context pg_temp.p9_71_context%rowtype;
  v_result record;
  v_replay record;
  v_item public.commercial_opportunity_checklist_items%rowtype;
  v_item_before public.commercial_opportunity_checklist_items%rowtype;
  v_item_after public.commercial_opportunity_checklist_items%rowtype;
  v_version public.commercial_opportunity_checklist_versions%rowtype;
  v_override_version_id uuid;
  v_count_before integer;
  v_count_after integer;
begin
  insert into pg_temp.p9_71_context (
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
  order by store_row.organization_id, store_row.id, customer_row.id, membership_row.user_id
  limit 1;

  perform pg_temp.p9_71_assert(
    exists (select 1 from pg_temp.p9_71_context),
    'FIXTURE_FAIL: no store/customer/active auth-backed member available'
  );

  select * into v_context from pg_temp.p9_71_context limit 1;

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

  perform pg_temp.p9_71_write_gate_policy(false);
  perform pg_temp.p9_71_write_profile();
  perform pg_temp.p9_71_set_region(false);

  -- 1. technical_visit exists even without a Gate Policy technical_visit rule.
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['medidas']::text[], '{}'::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:01');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(v_item.id is not null, 'SUT_FAIL 1: technical_visit item missing');
  insert into pg_temp.p9_71_results values (1, 'technical_visit sem Gate Policy rule', 'PASS', 'item exists');

  -- 2. Never configured policy fails closed.
  perform pg_temp.p9_71_set_technical_policy(false, null, null);
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:02');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_policy_not_configured',
    'SUT_FAIL 2: never configured did not fail closed'
  );
  insert into pg_temp.p9_71_results values (2, 'policy nunca configurada', 'PASS', 'needs_resolution');

  -- 3. Explicitly not offered is not_applicable.
  perform pg_temp.p9_71_set_technical_policy(true, null, false);
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:03');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.applicability_state = 'not_applicable'
    and v_item.reason_code = 'store_does_not_offer_technical_visit',
    'SUT_FAIL 3: explicit false was not not_applicable'
  );
  insert into pg_temp.p9_71_results values (3, 'explicitamente nao oferecida', 'PASS', 'not_applicable');

  -- 4. Legacy Gate Policy technical_visit does not win over P19-A.
  perform pg_temp.p9_71_write_gate_policy(true, 9999);
  perform pg_temp.p9_71_set_technical_policy(true, null, false);
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:04');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.applicability_state = 'not_applicable'
    and v_item.decision_basis::text not like '%legacy_gate_policy_must_not_win%',
    'SUT_FAIL 4: Gate Policy overrode P19-A'
  );
  insert into pg_temp.p9_71_results values (4, 'Gate Policy legacy nao vence P19-A', 'PASS', 'P19-A authority');

  -- 5. Real contradiction with legacy mirror is conflict.
  perform pg_temp.p9_71_write_gate_policy(false);
  perform pg_temp.p9_71_set_technical_policy(true, null, true);
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:05');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.applicability_state = 'conflict'
    and v_item.reason_code = 'technical_visit_policy_legacy_mirror_conflict'
    and v_item.decision_basis #> '{selected_candidates,0,legacy_mirror}' is not null,
    'SUT_FAIL 5: legacy mirror contradiction did not conflict'
  );
  insert into pg_temp.p9_71_results values (5, 'contradicao real com mirror legado', 'PASS', 'conflict');

  -- 6. Empty required/optional arrays need resolution.
  perform pg_temp.p9_71_set_technical_policy(true, pg_temp.p9_71_policy('{}'::text[], '{}'::text[]), true);
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:06');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_policy_applicability_not_defined',
    'SUT_FAIL 6: empty arrays did not need resolution'
  );
  insert into pg_temp.p9_71_results values (6, 'arrays vazios', 'PASS', 'needs_resolution');

  -- 7. required toda_venda_piscina + pool positive proves policy required.
  perform pg_temp.p9_71_write_profile('partial');
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['toda_venda_piscina']::text[], '{}'::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:07');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.decision_basis #>> '{selected_candidates,0,policy_assessment_state}' = 'required'
    and v_item.decision_basis #>> '{selected_candidates,0,policy_assessment_reason}' = 'technical_visit_required_for_pool_sale'
    and v_item.decision_basis #>> '{selected_candidates,0,evidence,pool_component_state}' = 'positive',
    'SUT_FAIL 7: pool positive did not prove required policy'
  );
  insert into pg_temp.p9_71_results values (7, 'required toda_venda_piscina pool positivo', 'PASS', 'policy required');

  -- 8. Missing pool is not negative proof.
  perform pg_temp.p9_71_write_profile();
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:08');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.decision_basis #>> '{selected_candidates,0,policy_assessment_state}' = 'needs_resolution'
    and v_item.reason_code <> 'technical_visit_policy_no_applicable_situation',
    'SUT_FAIL 8: missing pool was treated as negative proof'
  );
  insert into pg_temp.p9_71_results values (8, 'pool ausente nao nega', 'PASS', 'needs_resolution');

  -- 9. piscina_com_instalacao needs pool positive and installation included.
  perform pg_temp.p9_71_write_profile('partial', 'included');
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['piscina_com_instalacao']::text[], '{}'::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:09');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.decision_basis #>> '{selected_candidates,0,policy_assessment_state}' = 'required'
    and v_item.decision_basis #>> '{selected_candidates,0,evidence,installation_intent_state}' = 'included',
    'SUT_FAIL 9: pool + installation included did not prove piscina_com_instalacao'
  );
  insert into pg_temp.p9_71_results values (9, 'piscina com instalacao', 'PASS', 'policy required');

  -- 10. Installation absence does not prove instalacao_sem_venda.
  perform pg_temp.p9_71_write_profile(null, null);
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['instalacao_sem_venda']::text[], '{}'::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:10');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.decision_basis #>> '{selected_candidates,0,policy_assessment_state}' = 'needs_resolution',
    'SUT_FAIL 10: installation absence was used as predicate'
  );
  insert into pg_temp.p9_71_results values (10, 'instalacao ausente nao prova instalacao_sem_venda', 'PASS', 'needs_resolution');

  -- 11. medidas is not inferred from missing requested_area_m2.
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['medidas']::text[], '{}'::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:11');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.decision_basis #>> '{selected_candidates,0,non_authority_inputs,requested_area_m2_absence_used}' = 'false',
    'SUT_FAIL 11: requested_area_m2 absence was used as authority'
  );
  insert into pg_temp.p9_71_results values (11, 'medidas sem requested_area_m2', 'PASS', 'not inferred');

  -- 12. technical_visit_interest does not become cliente_pedir.
  perform pg_temp.p9_71_write_profile(null, null, '{"technical_visit_interest":true}'::jsonb);
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy('{}'::text[], array['cliente_pedir']::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:12');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.decision_basis #>> '{selected_candidates,0,non_authority_inputs,technical_visit_interest_used}' = 'false',
    'SUT_FAIL 12: technical_visit_interest was used as cliente_pedir'
  );
  insert into pg_temp.p9_71_results values (12, 'technical_visit_interest nao vira cliente_pedir', 'PASS', 'not authority');

  -- 13. Unsupported required situation without known match needs resolution.
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['viabilidade']::text[], '{}'::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:13');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.reason_code = 'technical_visit_situation_authority_missing',
    'SUT_FAIL 13: unsupported required did not need resolution'
  );
  insert into pg_temp.p9_71_results values (13, 'required unsupported', 'PASS', 'needs_resolution');

  -- 14. required outro does not erase a known positively proven required.
  perform pg_temp.p9_71_write_profile('partial');
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['toda_venda_piscina', 'outro']::text[], '{}'::text[], 'runner outro'),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:14');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.decision_basis #>> '{selected_candidates,0,policy_assessment_state}' = 'required',
    'SUT_FAIL 14: required outro erased proven required'
  );
  insert into pg_temp.p9_71_results values (14, 'required outro mais known positive', 'PASS', 'required wins');

  -- 15. Canonical optional vocabulary has no safe predicate in this stage.
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy('{}'::text[], array['avaliar_local']::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:15');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.reason_code = 'technical_visit_optional_situation_authority_missing',
    'SUT_FAIL 15: optional vocabulary was auto-executed'
  );
  insert into pg_temp.p9_71_results values (15, 'optional canonica sem predicate', 'PASS', 'needs_resolution');

  -- 16. Missing region blocks a proven required policy.
  perform pg_temp.p9_71_write_profile('partial');
  perform pg_temp.p9_71_set_region(false);
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['toda_venda_piscina']::text[], '{}'::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:16');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.applicability_state = 'needs_resolution'
    and v_item.reason_code = 'technical_visit_region_not_configured'
    and v_item.decision_basis #> '{selected_candidates,0,region_assessment}' is not null,
    'SUT_FAIL 16: missing region did not block required'
  );
  insert into pg_temp.p9_71_results values (16, 'regiao nao configurada bloqueia', 'PASS', 'needs_resolution');

  -- 17. sob_consulta does not authorize.
  perform pg_temp.p9_71_set_region(true, true);
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:17');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.reason_code = 'technical_visit_region_under_consultation',
    'SUT_FAIL 17: sob_consulta authorized technical visit'
  );
  insert into pg_temp.p9_71_results values (17, 'sob_consulta nao autoriza', 'PASS', 'needs_resolution');

  -- 18. Free-text coverage does not become structured customer geography.
  perform pg_temp.p9_71_set_region(true, false, 'Rua Runner, Sao Paulo');
  perform pg_temp.p9_71_write_profile('partial');
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:18');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.reason_code = 'technical_visit_region_unverified'
    and v_item.decision_basis #>> '{selected_candidates,0,region_assessment,customer_geography_authority}' = 'unavailable_structured_customer_region',
    'SUT_FAIL 18: textual region was substring matched'
  );
  insert into pg_temp.p9_71_results values (18, 'texto de cobertura nao autoriza por substring', 'PASS', 'unverified');

  -- 19. Arbitrarily high Gate Policy priority cannot win.
  perform pg_temp.p9_71_write_gate_policy(true, 1000000);
  perform pg_temp.p9_71_set_technical_policy(true, null, false);
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:19');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.applicability_state = 'not_applicable'
    and v_item.decision_basis::text not like '%legacy_gate_policy_must_not_win%',
    'SUT_FAIL 19: high priority Gate Policy won'
  );
  insert into pg_temp.p9_71_results values (19, 'Gate Policy priority alta nao vence', 'PASS', 'P19-A authority');

  -- 20. Irrelevant pool change preserves technical_visit system basis.
  perform pg_temp.p9_71_write_gate_policy(false);
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['medidas']::text[], '{}'::text[]),
    true
  );
  perform pg_temp.p9_71_write_profile();
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:20:a');
  v_item_before := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_write_profile('partial');
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:20:b');
  v_item_after := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item_before.decision_basis ->> 'system_basis_fingerprint'
      = v_item_after.decision_basis ->> 'system_basis_fingerprint',
    'SUT_FAIL 20: irrelevant pool changed technical_visit basis'
  );
  insert into pg_temp.p9_71_results values (20, 'pool irrelevante preserva basis', 'PASS', 'fingerprint stable');

  -- 21. Irrelevant region change when not offered preserves basis.
  perform pg_temp.p9_71_set_technical_policy(true, null, false);
  perform pg_temp.p9_71_set_region(false);
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:21:a');
  v_item_before := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_set_region(true, true);
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:21:b');
  v_item_after := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item_before.decision_basis ->> 'system_basis_fingerprint'
      = v_item_after.decision_basis ->> 'system_basis_fingerprint',
    'SUT_FAIL 21: irrelevant region changed not-offered basis'
  );
  insert into pg_temp.p9_71_results values (21, 'regiao irrelevante preserva basis', 'PASS', 'fingerprint stable');

  -- 22. Material required/optional policy change changes basis.
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['medidas']::text[], '{}'::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:22:a');
  v_item_before := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['viabilidade']::text[], array['cliente_pedir']::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:22:b');
  v_item_after := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item_before.decision_basis ->> 'system_basis_fingerprint'
      <> v_item_after.decision_basis ->> 'system_basis_fingerprint',
    'SUT_FAIL 22: material policy change did not change basis'
  );
  insert into pg_temp.p9_71_results values (22, 'mudanca material muda basis', 'PASS', 'fingerprint changed');


  -- 29. Explicit installation exclusion conclusively negates piscina_com_instalacao.
  perform pg_temp.p9_71_write_profile(null, 'excluded');
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['piscina_com_instalacao']::text[], '{}'::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:29');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.applicability_state = 'not_applicable'
    and v_item.reason_code = 'technical_visit_required_conditions_explicitly_not_met'
    and v_item.decision_basis #>> '{selected_candidates,0,evidence,installation_intent_state}' = 'excluded',
    'SUT_FAIL 29: installation excluded did not negate piscina_com_instalacao'
  );
  insert into pg_temp.p9_71_results values (
    29,
    'installation excluded nega piscina_com_instalacao',
    'PASS',
    'not_applicable by explicit negative'
  );

  -- 30. Any proven required condition wins over another required conflict.
  perform pg_temp.p9_71_write_profile('partial', 'conflict');
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(
      array['toda_venda_piscina', 'piscina_com_instalacao']::text[],
      '{}'::text[]
    ),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:30');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.decision_basis #>> '{selected_candidates,0,policy_assessment_state}' = 'required'
    and v_item.decision_basis #>> '{selected_candidates,0,policy_inputs,matched_required_situation}' = 'toda_venda_piscina'
    and v_item.decision_basis #>> '{selected_candidates,0,evidence,pool_component_state}' = 'positive',
    'SUT_FAIL 30: conflicting alternative erased a proven required condition'
  );
  insert into pg_temp.p9_71_results values (
    30,
    'required positivo vence required alternativo em conflict',
    'PASS',
    'toda_venda_piscina remains required'
  );

  -- 31. Irrelevant optional policy changes do not churn an already proven required basis.
  perform pg_temp.p9_71_write_profile('partial');
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['toda_venda_piscina']::text[], '{}'::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:31:a');
  v_item_before := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(
      array['toda_venda_piscina']::text[],
      array['cliente_pedir']::text[]
    ),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:31:b');
  v_item_after := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_71_assert(
    v_item_before.decision_basis ->> 'system_basis_fingerprint'
      = v_item_after.decision_basis ->> 'system_basis_fingerprint',
    'SUT_FAIL 31: irrelevant optional change churned proven required basis'
  );
  insert into pg_temp.p9_71_results values (
    31,
    'optional irrelevante preserva required basis',
    'PASS',
    'fingerprint stable'
  );

  -- 32. A material unresolved situation change must change the system basis.
  perform pg_temp.p9_71_write_profile();
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['medidas']::text[], '{}'::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:32:a');
  v_item_before := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['viabilidade']::text[], '{}'::text[]),
    true
  );
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:32:b');
  v_item_after := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);

  perform pg_temp.p9_71_assert(
    v_item_before.decision_basis ->> 'system_basis_fingerprint'
      <> v_item_after.decision_basis ->> 'system_basis_fingerprint',
    'SUT_FAIL 32: material unresolved situation change did not change basis'
  );
  insert into pg_temp.p9_71_results values (
    32,
    'situacao unresolved material muda basis',
    'PASS',
    'fingerprint changed'
  );

  -- 23. Human override is carried when material basis remains equivalent.
  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['medidas']::text[], '{}'::text[]),
    true
  );
  perform pg_temp.p9_71_write_profile();
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:23:a');
  v_override_version_id := pg_temp.p9_71_override_technical(
    v_result.current_checklist_version_id,
    'not_applicable',
    'p9:7.1:scenario:23:override'
  );
  perform pg_temp.p9_71_write_profile('partial');
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:23:b');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.applicability_state = 'not_applicable'
    and v_item.decision_basis #>> '{human_override,status}' = 'active',
    'SUT_FAIL 23: equivalent basis did not carry human override'
  );
  insert into pg_temp.p9_71_results values (23, 'human override carried', 'PASS', 'active override');

  -- 24. Convergence is absorbed when system catches up with human state.
  perform pg_temp.p9_71_set_technical_policy(true, null, false);
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:24');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  select * into v_version
  from public.commercial_opportunity_checklist_versions
  where id = v_result.current_checklist_version_id;
  perform pg_temp.p9_71_assert(
    v_item.applicability_state = 'not_applicable'
    and not (v_item.decision_basis ? 'human_override')
    and (v_version.metadata ->> 'human_absorbed_count')::integer > 0,
    'SUT_FAIL 24: convergence was not absorbed'
  );
  insert into pg_temp.p9_71_results values (24, 'convergence absorbed', 'PASS', 'human_absorbed_count > 0');

  -- 25. Material conflict requires conflict/revalidation per existing helper.
  perform pg_temp.p9_71_set_technical_policy(true, null, false);
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:25:a');
  v_override_version_id := pg_temp.p9_71_override_technical(
    v_result.current_checklist_version_id,
    'required',
    'p9:7.1:scenario:25:override'
  );
  perform pg_temp.p9_71_set_technical_policy(true, null, true);
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:25:b');
  v_item := pg_temp.p9_71_technical_item(v_result.current_checklist_version_id);
  perform pg_temp.p9_71_assert(
    v_item.applicability_state = 'conflict',
    'SUT_FAIL 25: material conflict did not require conflict/revalidation'
  );
  insert into pg_temp.p9_71_results values (25, 'mudanca material conflitante', 'PASS', 'conflict');

  -- 26. Other checklist items still flow through generic Gate Policy.
  perform pg_temp.p9_71_set_technical_policy(true, null, false);
  perform pg_temp.p9_71_write_profile('partial');
  select * into v_result from pg_temp.p9_71_materialize('p9:7.1:scenario:26');
  perform pg_temp.p9_71_assert(
    exists (
      select 1
      from public.commercial_opportunity_checklist_items item_row
      where item_row.checklist_version_id = v_result.current_checklist_version_id
        and item_row.item_key = 'quote'
        and item_row.applicability_state = 'required'
    ),
    'SUT_FAIL 26: generic Gate Policy item stopped working'
  );
  insert into pg_temp.p9_71_results values (26, 'outros itens continuam funcionando', 'PASS', 'quote required');

  -- 27. Same event key replay is idempotent after a deterministic material change.
  select pg_catalog.count(*)::integer
  into v_count_before
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.organization_id = v_context.organization_id
    and version_row.store_id = v_context.store_id
    and version_row.commercial_opportunity_id = v_context.opportunity_id;

  perform pg_temp.p9_71_set_technical_policy(
    true,
    pg_temp.p9_71_policy(array['medidas']::text[], '{}'::text[]),
    true
  );

  select * into v_result
  from pg_temp.p9_71_materialize('p9:7.1:scenario:27');

  perform pg_temp.p9_71_assert(
    v_result.changed is true,
    'SUT_FAIL 27: first call did not persist the material change'
  );

  select * into v_replay
  from pg_temp.p9_71_materialize('p9:7.1:scenario:27');

  select pg_catalog.count(*)::integer
  into v_count_after
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.organization_id = v_context.organization_id
    and version_row.store_id = v_context.store_id
    and version_row.commercial_opportunity_id = v_context.opportunity_id;

  perform pg_temp.p9_71_assert(
    v_replay.replayed is true
    and v_replay.outcome = 'idempotent_replay_current'
    and v_replay.current_checklist_version_id = v_result.current_checklist_version_id
    and v_count_after = v_count_before + 1,
    'SUT_FAIL 27: same operation key replay was not idempotent'
  );
  insert into pg_temp.p9_71_results values (
    27,
    'replay idempotente',
    'PASS',
    'material change created once; same operation key replayed'
  );

  -- 28. Current/version lineage remains correct.
  select * into v_version
  from public.commercial_opportunity_checklist_versions
  where id = v_result.current_checklist_version_id;
  perform pg_temp.p9_71_assert(
    exists (
      select 1
      from public.commercial_opportunity_checklist_current current_row
      where current_row.organization_id = v_context.organization_id
        and current_row.store_id = v_context.store_id
        and current_row.commercial_opportunity_id = v_context.opportunity_id
        and current_row.current_checklist_version_id = v_result.current_checklist_version_id
    )
    and v_version.previous_checklist_version_id is not null
    and v_version.version_number = v_result.version_number,
    'SUT_FAIL 28: current/version lineage mismatch'
  );
  insert into pg_temp.p9_71_results values (28, 'current/version lineage', 'PASS', 'current points to version');

  perform pg_temp.p9_71_assert(
    (select pg_catalog.count(*) from pg_temp.p9_71_results) = 32,
    'SUT_FAIL: expected 32 behavioral scenarios'
  );
end;
$runner$;

select *
from pg_temp.p9_71_results
order by scenario_number;

rollback;
