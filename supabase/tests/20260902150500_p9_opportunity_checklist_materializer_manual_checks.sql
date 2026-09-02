begin;

set local lock_timeout = '5s';
set local statement_timeout = '240s';
set local idle_in_transaction_session_timeout = '240s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:opportunity-checklist-materializer:manual-checks:v1', 0)
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.5
-- Manual checks for Commercial Opportunity Checklist Materializer v1.
--
-- This runner is rollback-only. It temporarily advances Profile/Policy/Settings
-- and Checklist current pointers inside this transaction and then rolls all of
-- it back. Any failed invariant raises and aborts the runner.
-- ============================================================================

do $preflight$
declare
  v_materializer oid := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)'
  );
  v_helper oid := pg_catalog.to_regprocedure(
    'public.p9_opportunity_checklist_merge_candidate_internal(jsonb,integer,text,text,jsonb)'
  );
begin
  if v_materializer is null or v_helper is null then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: checklist materializer migration is not installed';
  end if;

  if pg_catalog.has_function_privilege('anon', v_materializer, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_materializer, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_materializer, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: materializer grants mismatch';
  end if;

  if pg_catalog.has_function_privilege('anon', v_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_helper, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: internal candidate reducer leaked EXECUTE';
  end if;

  if pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_checklist_versions', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_checklist_items', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_checklist_current', 'INSERT') then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: service_role gained direct checklist INSERT';
  end if;
end;
$preflight$;

do $behavior$
declare
  v_org_id uuid;
  v_store_id uuid;
  v_opp_id uuid;
  v_user_id uuid;
  v_other_opp_id uuid := gen_random_uuid();

  v_policy_rules jsonb;
  v_policy_rules_and jsonb;
  v_policy_write record;
  v_profile_write record;
  v_result record;
  v_replay record;
  v_unchanged record;
  v_current_before uuid;
  v_current_after uuid;
  v_version_count_before integer;
  v_version_count_after integer;
  v_item_state text;
  v_checklist_state text;

  v_current public.commercial_opportunity_checklist_current%rowtype;
  v_current_version public.commercial_opportunity_checklist_versions%rowtype;
  v_non_owned public.commercial_opportunity_checklist_versions%rowtype;
  v_human public.commercial_opportunity_checklist_versions%rowtype;
  v_human_version_number integer;
begin
  -- Pick one real store/opportunity fixture that already has the P19-A Settings
  -- required by this materializer and no existing checklist current. The runner
  -- never commits changes to this fixture.
  select
    opportunity_row.organization_id,
    opportunity_row.store_id,
    opportunity_row.id
  into v_org_id, v_store_id, v_opp_id
  from public.commercial_opportunities opportunity_row
  where exists (
      select 1
      from public.store_operation_settings operation_row
      where operation_row.organization_id = opportunity_row.organization_id
        and operation_row.store_id = opportunity_row.store_id
    )
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = opportunity_row.organization_id
        and membership_row.is_active is true
    )
    and not exists (
      select 1
      from public.commercial_opportunity_checklist_current checklist_current
      where checklist_current.organization_id = opportunity_row.organization_id
        and checklist_current.store_id = opportunity_row.store_id
        and checklist_current.commercial_opportunity_id = opportunity_row.id
    )
  order by opportunity_row.organization_id, opportunity_row.store_id, opportunity_row.id
  limit 1;

  if v_opp_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: no opportunity with operation Settings, active membership and empty checklist current';
  end if;

  select membership_row.user_id
  into v_user_id
  from public.memberships membership_row
  where membership_row.organization_id = v_org_id
    and membership_row.is_active is true
    and exists (
      select 1 from auth.users user_row where user_row.id = membership_row.user_id
    )
  order by membership_row.user_id
  limit 1;

  if v_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: no active auth-backed member for human authority scenario';
  end if;

  -- Authenticated runtime must be denied even with a valid tenant/user context.
  begin
    execute 'set local role authenticated';
    perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
    perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);

    perform 1
    from public.materialize_commercial_opportunity_checklist_by_system(
      v_org_id,
      v_store_id,
      v_opp_id,
      'runner:unauthorized:authenticated'
    );

    execute 'reset role';
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: authenticated role executed checklist system materializer';
  exception
    when sqlstate '42501' then
      execute 'reset role';
  end;

  -- Establish deterministic baseline Settings.
  update public.store_operation_settings
  set
    offers_installation = true,
    offers_technical_visit = true
  where organization_id = v_org_id
    and store_id = v_store_id;

  if exists (
    select 1
    from public.store_contract_settings contract_row
    where contract_row.organization_id = v_org_id
      and contract_row.store_id = v_store_id
  ) then
    update public.store_contract_settings
    set contract_enabled = true
    where organization_id = v_org_id
      and store_id = v_store_id;
  else
    insert into public.store_contract_settings (
      organization_id,
      store_id,
      contract_enabled
    )
    values (
      v_org_id,
      v_store_id,
      true
    );
  end if;

  -- Baseline policy mirrors the frozen v1 behavior needed by the scenarios.
  v_policy_rules := pg_catalog.jsonb_build_array(
    jsonb_build_object('rule_key','contract.always.needs_resolution','rule_priority',10,'item_kind','commercial_gate','item_key','contract','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','needs_resolution','reason_code','contract_applicability_not_configured','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','fulfillment.installation.required','rule_priority',70,'item_kind','commercial_gate','item_key','fulfillment','match_mode','execution','component_kind',null,'execution_kind','installation','applicability_state','required','reason_code','installation_requires_fulfillment','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','fulfillment.default.needs_resolution','rule_priority',10,'item_kind','commercial_gate','item_key','fulfillment','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','needs_resolution','reason_code','fulfillment_kind_must_be_resolved','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','negotiation.always.optional','rule_priority',10,'item_kind','commercial_gate','item_key','negotiation','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','optional','reason_code','negotiation_only_when_material','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','payment.always.required','rule_priority',10,'item_kind','commercial_gate','item_key','payment','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','required','reason_code','commercial_sale_requires_payment_resolution','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','post_sale.always.required','rule_priority',10,'item_kind','commercial_gate','item_key','post_sale','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','required','reason_code','commercial_opportunity_requires_post_sale','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','qualification.always.required','rule_priority',10,'item_kind','commercial_gate','item_key','qualification','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','required','reason_code','commercial_opportunity_requires_qualification','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','quote.custom.required','rule_priority',60,'item_kind','commercial_gate','item_key','quote','match_mode','component','component_kind','custom','execution_kind',null,'applicability_state','required','reason_code','custom_sale_requires_quote','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','quote.pool.required','rule_priority',60,'item_kind','commercial_gate','item_key','quote','match_mode','component','component_kind','pool','execution_kind',null,'applicability_state','required','reason_code','pool_sale_requires_quote','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','quote.service.needs_resolution','rule_priority',50,'item_kind','commercial_gate','item_key','quote','match_mode','component','component_kind','service','execution_kind',null,'applicability_state','needs_resolution','reason_code','service_quote_requirement_unresolved','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','quote.catalog_item.optional','rule_priority',40,'item_kind','commercial_gate','item_key','quote','match_mode','component','component_kind','catalog_item','execution_kind',null,'applicability_state','optional','reason_code','catalog_item_quote_optional','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','quote.default.optional','rule_priority',10,'item_kind','commercial_gate','item_key','quote','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','optional','reason_code','quote_optional_by_default','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','technical_visit.installation.needs_resolution','rule_priority',70,'item_kind','commercial_gate','item_key','technical_visit','match_mode','execution','component_kind',null,'execution_kind','installation','applicability_state','needs_resolution','reason_code','installation_visit_requirement_unresolved','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','technical_visit.default.not_applicable','rule_priority',10,'item_kind','commercial_gate','item_key','technical_visit','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','not_applicable','reason_code','technical_visit_not_required_by_default','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','address.installation.required','rule_priority',70,'item_kind','technical_requirement','item_key','address_confirmation','match_mode','execution','component_kind',null,'execution_kind','installation','applicability_state','required','reason_code','installation_requires_address_confirmation','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','address.default.not_applicable','rule_priority',10,'item_kind','technical_requirement','item_key','address_confirmation','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','not_applicable','reason_code','address_confirmation_not_required_by_default','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','compatibility.catalog_item.needs_resolution','rule_priority',50,'item_kind','technical_requirement','item_key','compatibility_confirmation','match_mode','component','component_kind','catalog_item','execution_kind',null,'applicability_state','needs_resolution','reason_code','catalog_item_compatibility_requirement_unresolved','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','compatibility.default.not_applicable','rule_priority',10,'item_kind','technical_requirement','item_key','compatibility_confirmation','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','not_applicable','reason_code','compatibility_not_required_by_default','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','measurements.installation.required','rule_priority',70,'item_kind','technical_requirement','item_key','measurements_confirmation','match_mode','execution','component_kind',null,'execution_kind','installation','applicability_state','required','reason_code','installation_requires_measurements_confirmation','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','measurements.pool.required','rule_priority',60,'item_kind','technical_requirement','item_key','measurements_confirmation','match_mode','component','component_kind','pool','execution_kind',null,'applicability_state','required','reason_code','pool_requires_measurements_confirmation','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','measurements.default.not_applicable','rule_priority',10,'item_kind','technical_requirement','item_key','measurements_confirmation','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','not_applicable','reason_code','measurements_not_required_by_default','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','site_assessment.installation.needs_resolution','rule_priority',70,'item_kind','technical_requirement','item_key','site_assessment','match_mode','execution','component_kind',null,'execution_kind','installation','applicability_state','needs_resolution','reason_code','installation_site_assessment_requirement_unresolved','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','site_assessment.default.not_applicable','rule_priority',10,'item_kind','technical_requirement','item_key','site_assessment','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','not_applicable','reason_code','site_assessment_not_required_by_default','metadata','{}'::jsonb)
  );

  select *
  into v_policy_write
  from public.write_store_opportunity_gate_policy_internal(
    v_org_id,
    v_store_id,
    'p9:3.5:checklist-runner:policy:baseline',
    repeat('1', 64),
    v_policy_rules,
    'system',
    null,
    'manual_check_runner',
    'checklist_materializer_runner_policy',
    'p9_checklist_runner',
    '{"runner":true}'::jsonb
  );

  if not coalesce(v_policy_write.changed, false) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: baseline runner policy was not created';
  end if;

  -- Profile: installation evidence unresolved. This must propagate
  -- needs_resolution to installation-dependent checklist items.
  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  select *
  into v_profile_write
  from public.write_commercial_opportunity_profile_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'p9:3.5:checklist-runner:profile:unresolved',
    repeat('2', 64),
    'needs_clarification',
    '[]'::jsonb,
    '[{"execution_kind":"installation","intent_state":"unresolved","reason_code":"runner_unresolved_installation","metadata":{}}]'::jsonb,
    'manual_check_runner',
    'checklist_materializer_runner_profile',
    'p9_checklist_runner',
    '{"runner":true}'::jsonb
  );

  select *
  into v_result
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'runner:event:unresolved'
  );

  if not coalesce(v_result.changed, false)
     or v_result.checklist_state <> 'needs_resolution' then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: unresolved installation did not create needs_resolution checklist';
  end if;

  foreach v_item_state in array array['fulfillment','technical_visit','address_confirmation','measurements_confirmation','site_assessment'] loop
    if not exists (
      select 1
      from public.commercial_opportunity_checklist_items item_row
      where item_row.checklist_version_id = v_result.current_checklist_version_id
        and item_row.item_key = v_item_state
        and item_row.applicability_state = 'needs_resolution'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'SUT_FAIL: unresolved installation dependency did not stay needs_resolution: ' || v_item_state;
    end if;
  end loop;

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result.current_checklist_version_id
      and item_row.item_key = 'payment'
      and item_row.applicability_state = 'required'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: payment applicability mixed with readiness or disappeared';
  end if;

  -- Same event: exact idempotent replay, no new version.
  select pg_catalog.count(*)::integer
  into v_version_count_before
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.organization_id = v_org_id
    and version_row.store_id = v_store_id
    and version_row.commercial_opportunity_id = v_opp_id;

  select *
  into v_replay
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'runner:event:unresolved'
  );

  select pg_catalog.count(*)::integer
  into v_version_count_after
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.organization_id = v_org_id
    and version_row.store_id = v_store_id
    and version_row.commercial_opportunity_id = v_opp_id;

  if not coalesce(v_replay.replayed, false)
     or v_replay.outcome <> 'idempotent_replay_current'
     or v_version_count_after <> v_version_count_before then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: current event replay is not idempotent';
  end if;

  -- Different event, same exact authorities/payload: unchanged, no new version.
  select *
  into v_unchanged
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'runner:event:unchanged'
  );

  if v_unchanged.outcome <> 'checklist_unchanged'
     or coalesce(v_unchanged.changed, true)
     or coalesce(v_unchanged.replayed, true) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: semantically unchanged checklist created a new version';
  end if;

  execute 'reset role';

  -- Technical visit capability false is authoritative and makes only that gate
  -- not applicable, even while installation remains unresolved.
  update public.store_operation_settings
  set offers_technical_visit = false
  where organization_id = v_org_id and store_id = v_store_id;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  select * into v_result
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:event:visit-disabled'
  );

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result.current_checklist_version_id
      and item_row.item_key = 'technical_visit'
      and item_row.applicability_state = 'not_applicable'
      and item_row.reason_code = 'store_does_not_offer_technical_visit'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: offers_technical_visit=false did not override technical_visit';
  end if;

  execute 'reset role';

  -- Included installation + offers_installation=false is conflict. Keep visit
  -- not_applicable because the store independently does not offer visits.
  update public.store_operation_settings
  set offers_installation = false, offers_technical_visit = false
  where organization_id = v_org_id and store_id = v_store_id;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  select *
  into v_profile_write
  from public.write_commercial_opportunity_profile_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'p9:3.5:checklist-runner:profile:installation-included',
    repeat('3', 64),
    'resolved',
    '[{"component_key":"runner_custom","component_kind":"custom","component_state":"resolved","pool_id":null,"catalog_item_id":null,"reference_text":"runner custom item","metadata":{}}]'::jsonb,
    '[{"execution_kind":"installation","intent_state":"included","reason_code":"runner_installation_included","metadata":{}}]'::jsonb,
    'manual_check_runner',
    'checklist_materializer_runner_profile',
    'p9_checklist_runner',
    '{"runner":true}'::jsonb
  );

  select * into v_result
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:event:installation-conflict'
  );

  if v_result.checklist_state <> 'conflict' then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: included installation + offers_installation=false did not conflict';
  end if;

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result.current_checklist_version_id
      and item_row.item_key = 'fulfillment'
      and item_row.applicability_state = 'conflict'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: installation capability conflict did not reach fulfillment';
  end if;

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result.current_checklist_version_id
      and item_row.item_key = 'technical_visit'
      and item_row.applicability_state = 'not_applicable'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: visit-disabled authority did not remain not_applicable';
  end if;

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result.current_checklist_version_id
      and item_row.item_key = 'quote'
      and item_row.applicability_state = 'required'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: custom component did not require quote';
  end if;

  execute 'reset role';

  -- Capability restored: included installation drives required technical inputs;
  -- technical visit remains needs_resolution by policy.
  update public.store_operation_settings
  set offers_installation = true, offers_technical_visit = true
  where organization_id = v_org_id and store_id = v_store_id;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  select * into v_result
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:event:installation-valid'
  );

  foreach v_item_state in array array['fulfillment','address_confirmation','measurements_confirmation'] loop
    if not exists (
      select 1 from public.commercial_opportunity_checklist_items item_row
      where item_row.checklist_version_id = v_result.current_checklist_version_id
        and item_row.item_key = v_item_state
        and item_row.applicability_state = 'required'
    ) then
      raise exception using errcode = 'P0001', message = 'SUT_FAIL: included installation did not require dependent item: ' || v_item_state;
    end if;
  end loop;

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result.current_checklist_version_id
      and item_row.item_key = 'technical_visit'
      and item_row.applicability_state = 'needs_resolution'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: installation technical visit did not remain needs_resolution';
  end if;

  execute 'reset role';

  -- Contract disabled is not_applicable; readiness remains separate.
  update public.store_contract_settings
  set contract_enabled = false
  where organization_id = v_org_id and store_id = v_store_id;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  select * into v_result
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:event:contract-disabled'
  );

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result.current_checklist_version_id
      and item_row.item_key = 'contract'
      and item_row.applicability_state = 'not_applicable'
      and item_row.reason_code = 'contract_disabled_for_store'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: contract_enabled=false did not make contract not_applicable';
  end if;

  execute 'reset role';

  -- Restore contract and prove a partial pool still structurally matches pool
  -- applicability without pretending the component itself is fully resolved.
  update public.store_contract_settings
  set contract_enabled = true
  where organization_id = v_org_id and store_id = v_store_id;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  select * into v_profile_write
  from public.write_commercial_opportunity_profile_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'p9:3.5:checklist-runner:profile:pool-partial',
    repeat('4', 64),
    'needs_clarification',
    '[{"component_key":"runner_pool","component_kind":"pool","component_state":"partial","pool_id":null,"catalog_item_id":null,"reference_text":"runner pool","metadata":{}}]'::jsonb,
    '[]'::jsonb,
    'manual_check_runner',
    'checklist_materializer_runner_profile',
    'p9_checklist_runner',
    '{"runner":true}'::jsonb
  );

  select * into v_result
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:event:pool-partial'
  );

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result.current_checklist_version_id
      and item_row.item_key = 'quote'
      and item_row.applicability_state = 'required'
  ) or not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result.current_checklist_version_id
      and item_row.item_key = 'measurements_confirmation'
      and item_row.applicability_state = 'required'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: partial pool did not structurally apply pool rules';
  end if;

  -- Catalog-item structural match.
  select * into v_profile_write
  from public.write_commercial_opportunity_profile_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'p9:3.5:checklist-runner:profile:catalog-partial',
    repeat('5', 64),
    'needs_clarification',
    '[{"component_key":"runner_catalog","component_kind":"catalog_item","component_state":"partial","pool_id":null,"catalog_item_id":null,"reference_text":"runner catalog item","metadata":{}}]'::jsonb,
    '[]'::jsonb,
    'manual_check_runner',
    'checklist_materializer_runner_profile',
    'p9_checklist_runner',
    '{"runner":true}'::jsonb
  );

  select * into v_result
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:event:catalog-partial'
  );

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result.current_checklist_version_id
      and item_row.item_key = 'quote'
      and item_row.applicability_state = 'optional'
  ) or not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result.current_checklist_version_id
      and item_row.item_key = 'compatibility_confirmation'
      and item_row.applicability_state = 'needs_resolution'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: catalog-item structural rules mismatch';
  end if;

  execute 'reset role';

  -- New temporary policy proves two generic invariants:
  -- 1) equal-priority incompatible outcomes -> conflict;
  -- 2) component_and_execution is a true AND and does not leak component
  --    conflict when execution is definitively excluded.
  v_policy_rules_and := pg_catalog.jsonb_build_array(
    jsonb_build_object('rule_key','and_gate.default.optional','rule_priority',10,'item_kind','commercial_gate','item_key','and_gate','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','optional','reason_code','and_gate_default_optional','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','and_gate.custom_install.required','rule_priority',100,'item_kind','commercial_gate','item_key','and_gate','match_mode','component_and_execution','component_kind','custom','execution_kind','installation','applicability_state','required','reason_code','custom_install_and_gate_required','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','tie_gate.required','rule_priority',50,'item_kind','commercial_gate','item_key','tie_gate','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','required','reason_code','tie_required','metadata','{}'::jsonb),
    jsonb_build_object('rule_key','tie_gate.optional','rule_priority',50,'item_kind','commercial_gate','item_key','tie_gate','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','optional','reason_code','tie_optional','metadata','{}'::jsonb)
  );

  select * into v_policy_write
  from public.write_store_opportunity_gate_policy_internal(
    v_org_id,
    v_store_id,
    'p9:3.5:checklist-runner:policy:and-tie',
    repeat('6', 64),
    v_policy_rules_and,
    'system',
    null,
    'manual_check_runner',
    'checklist_materializer_runner_policy',
    'p9_checklist_runner',
    '{"runner":true}'::jsonb
  );

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  select * into v_profile_write
  from public.write_commercial_opportunity_profile_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'p9:3.5:checklist-runner:profile:and-no-leak',
    repeat('7', 64),
    'conflict',
    '[{"component_key":"runner_custom_conflict","component_kind":"custom","component_state":"conflict","pool_id":null,"catalog_item_id":null,"reference_text":"runner custom conflict","metadata":{}}]'::jsonb,
    '[{"execution_kind":"installation","intent_state":"excluded","reason_code":"runner_installation_excluded","metadata":{}}]'::jsonb,
    'manual_check_runner',
    'checklist_materializer_runner_profile',
    'p9_checklist_runner',
    '{"runner":true}'::jsonb
  );

  select * into v_result
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:event:and-tie'
  );

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result.current_checklist_version_id
      and item_row.item_key = 'and_gate'
      and item_row.applicability_state = 'optional'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: component_and_execution leaked conflict through a false AND side';
  end if;

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_result.current_checklist_version_id
      and item_row.item_key = 'tie_gate'
      and item_row.applicability_state = 'conflict'
      and item_row.reason_code = 'equal_priority_applicability_conflict'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: equal-priority incompatible outcomes did not conflict';
  end if;

  -- Replay an old event after Policy/Profile changes. It must return the old
  -- version as stale and never move current backwards.
  select current_checklist_version_id
  into v_current_before
  from public.commercial_opportunity_checklist_current
  where organization_id = v_org_id
    and store_id = v_store_id
    and commercial_opportunity_id = v_opp_id;

  select * into v_replay
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:event:unresolved'
  );

  select current_checklist_version_id
  into v_current_after
  from public.commercial_opportunity_checklist_current
  where organization_id = v_org_id
    and store_id = v_store_id
    and commercial_opportunity_id = v_opp_id;

  if v_replay.outcome <> 'idempotent_replay_stale'
     or v_current_after is distinct from v_current_before then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: stale event replay regressed or reinterpreted current';
  end if;

  execute 'reset role';

  -- Simulate a stronger non-owned system checklist authority as a direct child.
  select current_row.*
  into v_current
  from public.commercial_opportunity_checklist_current current_row
  where current_row.organization_id = v_org_id
    and current_row.store_id = v_store_id
    and current_row.commercial_opportunity_id = v_opp_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: checklist current missing before external-authority fixture';
  end if;

  select version_row.*
  into v_current_version
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = v_current.current_checklist_version_id
    and version_row.organization_id = v_current.organization_id
    and version_row.store_id = v_current.store_id
    and version_row.commercial_opportunity_id = v_current.commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: checklist current version missing before external-authority fixture';
  end if;

  insert into public.commercial_opportunity_checklist_versions (
    organization_id, store_id, commercial_opportunity_id,
    version_number, previous_checklist_version_id,
    profile_version_id, gate_policy_version_id, checklist_state,
    settings_snapshot, settings_fingerprint,
    operation_key, request_fingerprint,
    actor_type, actor_user_id, source_type, reason_code, created_by, metadata
  )
  values (
    v_org_id, v_store_id, v_opp_id,
    v_current_version.version_number + 1, v_current_version.id,
    v_current_version.profile_version_id, v_current_version.gate_policy_version_id,
    v_current_version.checklist_state,
    v_current_version.settings_snapshot, v_current_version.settings_fingerprint,
    'p9:3.5:checklist-runner:external-system', repeat('8',64),
    'system', null, 'external_checklist_authority',
    'external_checklist_authority_test', 'p9_runner_external', '{"runner":true}'::jsonb
  )
  returning * into v_non_owned;

  insert into public.commercial_opportunity_checklist_items (
    organization_id, store_id, commercial_opportunity_id, checklist_version_id,
    item_key, item_kind, applicability_state, reason_code, decision_basis, metadata
  )
  select
    organization_id, store_id, commercial_opportunity_id, v_non_owned.id,
    item_key, item_kind, applicability_state, reason_code, decision_basis, metadata
  from public.commercial_opportunity_checklist_items
  where checklist_version_id = v_current_version.id;

  update public.commercial_opportunity_checklist_current
  set
    current_checklist_version_id = v_non_owned.id,
    last_operation_key = v_non_owned.operation_key
  where organization_id = v_org_id
    and store_id = v_store_id
    and commercial_opportunity_id = v_opp_id;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  select * into v_result
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:event:preserve-external'
  );

  if not coalesce(v_result.preserved, false)
     or v_result.outcome <> 'preserved_non_materializer_authority'
     or v_result.current_checklist_version_id is distinct from v_non_owned.id then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: non-owned system checklist authority was overwritten';
  end if;

  execute 'reset role';

  -- Option A: a human current checklist always wins. Create a human child and
  -- prove a new automatic event preserves it exactly.
  v_human_version_number := v_non_owned.version_number + 1;

  insert into public.commercial_opportunity_checklist_versions (
    organization_id, store_id, commercial_opportunity_id,
    version_number, previous_checklist_version_id,
    profile_version_id, gate_policy_version_id, checklist_state,
    settings_snapshot, settings_fingerprint,
    operation_key, request_fingerprint,
    actor_type, actor_user_id, source_type, reason_code, created_by, metadata
  )
  values (
    v_org_id, v_store_id, v_opp_id,
    v_human_version_number, v_non_owned.id,
    v_non_owned.profile_version_id, v_non_owned.gate_policy_version_id,
    v_non_owned.checklist_state,
    v_non_owned.settings_snapshot, v_non_owned.settings_fingerprint,
    'p9:3.5:checklist-runner:human-authority', repeat('9',64),
    'human', v_user_id, 'crm_manual',
    'human_checklist_authority_test', 'user:' || v_user_id::text, '{"runner":true}'::jsonb
  )
  returning * into v_human;

  insert into public.commercial_opportunity_checklist_items (
    organization_id, store_id, commercial_opportunity_id, checklist_version_id,
    item_key, item_kind, applicability_state, reason_code, decision_basis, metadata
  )
  select
    organization_id, store_id, commercial_opportunity_id, v_human.id,
    item_key, item_kind, applicability_state, reason_code, decision_basis, metadata
  from public.commercial_opportunity_checklist_items
  where checklist_version_id = v_non_owned.id;

  update public.commercial_opportunity_checklist_current
  set
    current_checklist_version_id = v_human.id,
    last_operation_key = v_human.operation_key
  where organization_id = v_org_id
    and store_id = v_store_id
    and commercial_opportunity_id = v_opp_id;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  select * into v_result
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:event:preserve-human'
  );

  if not coalesce(v_result.preserved, false)
     or v_result.outcome <> 'preserved_human_authority'
     or v_result.current_checklist_version_id is distinct from v_human.id then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: human checklist authority was overwritten';
  end if;

  -- Exact tenant/opportunity scope remains fail-closed.
  begin
    perform 1
    from public.materialize_commercial_opportunity_checklist_by_system(
      v_org_id, v_store_id, v_other_opp_id, 'runner:event:wrong-opportunity'
    );

    raise exception using errcode = 'P0001', message = 'SUT_FAIL: wrong opportunity scope was accepted';
  exception
    when sqlstate '23503' then
      null;
  end;

  execute 'reset role';
end;
$behavior$;

-- Static contract gate: do not allow future edits to reintroduce inferred
-- current selection or remove the approved authority/readiness boundaries.
do $definition_gate$
declare
  v_materializer oid := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)'
  );
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(v_materializer)
  into v_definition;

  if pg_catalog.strpos(v_definition, 'preserved_human_authority') = 0
     or pg_catalog.strpos(v_definition, 'preserved_non_materializer_authority') = 0
     or pg_catalog.strpos(v_definition, 'installation_included_but_store_does_not_offer') = 0
     or pg_catalog.strpos(v_definition, 'store_does_not_offer_technical_visit') = 0
     or pg_catalog.strpos(v_definition, 'contract_disabled_for_store') = 0
     or pg_catalog.strpos(v_definition, 'readiness_progress_separate') = 0
     or pg_catalog.strpos(v_definition, 'component_and_execution') = 0
     or pg_catalog.strpos(v_definition, 'equal_priority_applicability_conflict') = 0
     or pg_catalog.strpos(v_definition, 'idempotent_replay_stale') = 0
     or pg_catalog.strpos(v_definition, 'max(version_number)') > 0
     or pg_catalog.strpos(v_definition, 'order by created_at desc') > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: checklist materializer static authority contract mismatch';
  end if;
end;
$definition_gate$;

rollback;
