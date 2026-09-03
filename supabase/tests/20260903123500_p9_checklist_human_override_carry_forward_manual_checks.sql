begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:checklist-human-override-carry-forward:manual-checks:v1', 0)
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.5
-- Manual checks: mature Human Override Carry-forward.
--
-- ROLLBACK ONLY. This runner temporarily advances Gate Policy, Settings,
-- Profile, Checklist versions and human override audit on one real fixture, then
-- rolls everything back. Any failed invariant aborts with SUT_FAIL/FIXTURE_FAIL.
-- ============================================================================

do $preflight$
declare
  v_basis_helper oid := pg_catalog.to_regprocedure(
    'public.p9_opportunity_checklist_system_basis_fingerprint_internal(text,text,text,text,jsonb)'
  );
  v_merge_helper oid := pg_catalog.to_regprocedure(
    'public.p9_opportunity_checklist_apply_human_override_internal(jsonb,jsonb)'
  );
  v_materializer oid := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)'
  );
  v_writer oid := pg_catalog.to_regprocedure(
    'public.override_commercial_opportunity_checklist_item_by_user(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)'
  );
begin
  if v_basis_helper is null or v_merge_helper is null or v_materializer is null or v_writer is null then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: carry-forward migration is not installed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute_row
    where attribute_row.attrelid = 'public.commercial_opportunity_checklist_override_events'::regclass
      and attribute_row.attname = 'system_baseline_checklist_version_id'
      and not attribute_row.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute attribute_row
    where attribute_row.attrelid = 'public.commercial_opportunity_checklist_override_events'::regclass
      and attribute_row.attname = 'system_baseline_applicability_state'
      and not attribute_row.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute attribute_row
    where attribute_row.attrelid = 'public.commercial_opportunity_checklist_override_events'::regclass
      and attribute_row.attname = 'system_baseline_basis_fingerprint'
      and not attribute_row.attisdropped
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SUT_FAIL: explicit system baseline columns are missing';
  end if;

  if pg_catalog.has_function_privilege('anon', v_basis_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_basis_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_basis_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_merge_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_merge_helper, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_merge_helper, 'EXECUTE') then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: internal carry-forward helper leaked EXECUTE';
  end if;

  if pg_catalog.has_function_privilege('anon', v_materializer, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_materializer, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_materializer, 'EXECUTE') then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: materializer grants mismatch';
  end if;

  if pg_catalog.has_function_privilege('anon', v_writer, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_writer, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_writer, 'EXECUTE') then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: human override writer grants mismatch';
  end if;

  if pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_checklist_override_events', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_checklist_override_events', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.commercial_opportunity_checklist_items', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.commercial_opportunity_checklist_items', 'INSERT') then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: direct checklist mutation privilege leaked';
  end if;
end;
$preflight$;

do $helper_behavior$
declare
  v_basis_a jsonb;
  v_basis_b jsonb;
  v_fp_a text;
  v_fp_b text;
  v_system_item jsonb;
  v_current_item jsonb;
  v_result jsonb;
begin
  v_basis_a := pg_catalog.jsonb_build_object(
    'selected_priority', 50,
    'selected_candidates', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'candidate_key','policy:runner_a','source','gate_policy','rule_key','runner_a',
        'priority',50,'state','required','reason_code','runner_required'
      )
    )
  );
  v_basis_b := pg_catalog.jsonb_build_object(
    'selected_priority', 50,
    'selected_candidates', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'candidate_key','policy:runner_b','source','gate_policy','rule_key','runner_b',
        'priority',50,'state','required','reason_code','runner_required'
      )
    )
  );

  v_fp_a := public.p9_opportunity_checklist_system_basis_fingerprint_internal(
    'runner_gate','commercial_gate','required','runner_required',v_basis_a
  );
  v_fp_b := public.p9_opportunity_checklist_system_basis_fingerprint_internal(
    'runner_gate','commercial_gate','required','runner_required',v_basis_b
  );

  if v_fp_a = v_fp_b then
    raise exception using errcode='P0001', message='SUT_FAIL: materially different same-state bases produced the same fingerprint';
  end if;

  v_current_item := pg_catalog.jsonb_build_object(
    'item_key','runner_gate','item_kind','commercial_gate',
    'applicability_state','optional','reason_code','human_runner_exception',
    'metadata','{}'::jsonb,
    'decision_basis', v_basis_a || pg_catalog.jsonb_build_object(
      'system_applicability_state','required',
      'system_reason_code','runner_required',
      'system_basis_fingerprint',v_fp_a,
      'human_override',pg_catalog.jsonb_build_object(
        'status','active',
        'operation_key','runner:helper:human',
        'actor_user_id',gen_random_uuid(),
        'system_baseline_checklist_version_id',gen_random_uuid(),
        'system_baseline_applicability_state','required',
        'system_baseline_basis_fingerprint',v_fp_a,
        'from_applicability_state','required',
        'to_applicability_state','optional',
        'reason_code','human_runner_exception',
        'reason_text','Synthetic helper check.'
      )
    )
  );

  v_system_item := pg_catalog.jsonb_build_object(
    'item_key','runner_gate','item_kind','commercial_gate',
    'applicability_state','required','reason_code','runner_required',
    'metadata','{}'::jsonb,
    'decision_basis', v_basis_a || pg_catalog.jsonb_build_object(
      'system_applicability_state','required',
      'system_reason_code','runner_required',
      'system_basis_fingerprint',v_fp_a
    )
  );

  v_result := public.p9_opportunity_checklist_apply_human_override_internal(v_system_item,v_current_item);
  if v_result ->> 'applicability_state' <> 'optional'
     or v_result ->> '_human_merge_action' <> 'carried' then
    raise exception using errcode='P0001', message='SUT_FAIL: equivalent basis did not carry human helper state';
  end if;

  v_system_item := pg_catalog.jsonb_build_object(
    'item_key','runner_gate','item_kind','commercial_gate',
    'applicability_state','required','reason_code','runner_required',
    'metadata','{}'::jsonb,
    'decision_basis', v_basis_b || pg_catalog.jsonb_build_object(
      'system_applicability_state','required',
      'system_reason_code','runner_required',
      'system_basis_fingerprint',v_fp_b
    )
  );

  v_result := public.p9_opportunity_checklist_apply_human_override_internal(v_system_item,v_current_item);
  if v_result ->> 'applicability_state' <> 'conflict'
     or v_result ->> '_human_merge_action' <> 'revalidation_required'
     or v_result -> 'decision_basis' -> 'human_override' ->> 'status' <> 'revalidation_required' then
    raise exception using errcode='P0001', message='SUT_FAIL: same-state but materially changed basis did not revalidate fail-closed';
  end if;
end;
$helper_behavior$;

do $behavior$
declare
  v_org_id uuid;
  v_store_id uuid;
  v_opp_id uuid;
  v_user_id uuid;

  v_policy_rules_v1 jsonb;
  v_policy_rules_v2 jsonb;
  v_policy_rules_v3 jsonb;
  v_policy_write record;
  v_profile_write record;

  v_s0 record;
  v_s1 record;
  v_s2 record;
  v_s3 record;
  v_replay record;
  v_unchanged record;
  v_preserved record;
  v_h1 record;
  v_h2 record;
  v_h3 record;
  v_h4 record;
  v_h5 record;
  v_h6 record;

  v_s0_version public.commercial_opportunity_checklist_versions%rowtype;
  v_s1_version public.commercial_opportunity_checklist_versions%rowtype;
  v_s2_version public.commercial_opportunity_checklist_versions%rowtype;
  v_s3_version public.commercial_opportunity_checklist_versions%rowtype;
  v_legacy_human public.commercial_opportunity_checklist_versions%rowtype;
  v_external public.commercial_opportunity_checklist_versions%rowtype;
  v_event public.commercial_opportunity_checklist_override_events%rowtype;

  v_s0_technical_fp text;
  v_s1_technical_fp text;
  v_event_count_before integer;
  v_event_count_after integer;
  v_version_count_before integer;
  v_version_count_after integer;
begin
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
      from public.store_opportunity_gate_policy_current policy_current
      where policy_current.organization_id = opportunity_row.organization_id
        and policy_current.store_id = opportunity_row.store_id
    )
    and exists (
      select 1
      from public.memberships membership_row
      join auth.users user_row on user_row.id = membership_row.user_id
      where membership_row.organization_id = opportunity_row.organization_id
        and membership_row.is_active is true
    )
    and not exists (
      select 1
      from public.commercial_opportunity_profile_versions profile_version
      where profile_version.organization_id = opportunity_row.organization_id
        and profile_version.store_id = opportunity_row.store_id
        and profile_version.commercial_opportunity_id = opportunity_row.id
    )
    and not exists (
      select 1
      from public.commercial_opportunity_checklist_versions checklist_version
      where checklist_version.organization_id = opportunity_row.organization_id
        and checklist_version.store_id = opportunity_row.store_id
        and checklist_version.commercial_opportunity_id = opportunity_row.id
    )
  order by opportunity_row.organization_id, opportunity_row.store_id, opportunity_row.id
  limit 1;

  if v_opp_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_FAIL: no opportunity with Settings, Gate Policy, active auth member, and empty Profile/Checklist history';
  end if;

  select membership_row.user_id
  into v_user_id
  from public.memberships membership_row
  join auth.users user_row on user_row.id = membership_row.user_id
  where membership_row.organization_id = v_org_id
    and membership_row.is_active is true
  order by membership_row.user_id
  limit 1;

  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'FIXTURE_FAIL: active auth-backed member missing';
  end if;

  update public.store_operation_settings
  set offers_installation = true,
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
      organization_id, store_id, contract_enabled
    ) values (
      v_org_id, v_store_id, true
    );
  end if;

  v_policy_rules_v1 := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('rule_key','contract.always.needs_resolution','rule_priority',10,'item_kind','commercial_gate','item_key','contract','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','needs_resolution','reason_code','contract_applicability_not_configured','metadata','{}'::jsonb),
    pg_catalog.jsonb_build_object('rule_key','technical_visit.installation.needs_resolution','rule_priority',70,'item_kind','commercial_gate','item_key','technical_visit','match_mode','execution','component_kind',null,'execution_kind','installation','applicability_state','needs_resolution','reason_code','installation_visit_requirement_unresolved','metadata','{}'::jsonb),
    pg_catalog.jsonb_build_object('rule_key','technical_visit.default.not_applicable','rule_priority',10,'item_kind','commercial_gate','item_key','technical_visit','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','not_applicable','reason_code','technical_visit_not_required_by_default','metadata','{}'::jsonb),
    pg_catalog.jsonb_build_object('rule_key','quote.custom.required','rule_priority',60,'item_kind','commercial_gate','item_key','quote','match_mode','component','component_kind','custom','execution_kind',null,'applicability_state','required','reason_code','custom_sale_requires_quote','metadata','{}'::jsonb),
    pg_catalog.jsonb_build_object('rule_key','quote.default.optional','rule_priority',10,'item_kind','commercial_gate','item_key','quote','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','optional','reason_code','quote_optional_by_default','metadata','{}'::jsonb),
    pg_catalog.jsonb_build_object('rule_key','payment.always.required','rule_priority',10,'item_kind','commercial_gate','item_key','payment','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','required','reason_code','commercial_sale_requires_payment_resolution','metadata','{}'::jsonb)
  );

  select * into v_policy_write
  from public.write_store_opportunity_gate_policy_internal(
    v_org_id,
    v_store_id,
    'p9:3.5:carry-forward-runner:policy:v1',
    repeat('1', 64),
    v_policy_rules_v1,
    'system',
    null,
    'manual_check_runner',
    'checklist_carry_forward_runner_policy_v1',
    'p9_checklist_runner',
    '{"runner":true,"policy":"v1"}'::jsonb
  );

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  select * into v_profile_write
  from public.write_commercial_opportunity_profile_by_system(
    v_org_id,
    v_store_id,
    v_opp_id,
    'p9:3.5:carry-forward-runner:profile',
    repeat('2', 64),
    'resolved',
    '[{"component_key":"runner_custom","component_kind":"custom","component_state":"resolved","pool_id":null,"catalog_item_id":null,"reference_text":"runner custom item","metadata":{}}]'::jsonb,
    '[{"execution_kind":"installation","intent_state":"included","reason_code":"runner_installation_included","metadata":{}}]'::jsonb,
    'manual_check_runner',
    'checklist_carry_forward_runner_profile',
    'p9_checklist_runner',
    '{"runner":true}'::jsonb
  );

  select * into v_s0
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:carry-forward:s0'
  );

  execute 'reset role';

  if not coalesce(v_s0.changed, false)
     or v_s0.outcome <> 'checklist_version_created'
     or v_s0.actor_type <> 'system'
     or v_s0.created_by <> 'p9_checklist_materializer_v2'
     or v_s0.checklist_state <> 'needs_resolution' then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: S0 materialization contract mismatch';
  end if;

  select version_row.* into v_s0_version
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = v_s0.current_checklist_version_id;

  select item_row.decision_basis ->> 'system_basis_fingerprint'
  into v_s0_technical_fp
  from public.commercial_opportunity_checklist_items item_row
  where item_row.checklist_version_id = v_s0_version.id
    and item_row.item_key = 'technical_visit'
    and item_row.item_kind = 'commercial_gate';

  if v_s0_technical_fp is null
     or pg_catalog.length(v_s0_technical_fp) <> 64
     or not exists (
       select 1
       from public.commercial_opportunity_checklist_items item_row
       where item_row.checklist_version_id = v_s0_version.id
         and item_row.item_key = 'technical_visit'
         and item_row.applicability_state = 'needs_resolution'
         and item_row.decision_basis ->> 'system_applicability_state' = 'needs_resolution'
         and not (item_row.decision_basis ? 'human_override')
     )
     or not exists (
       select 1
       from public.commercial_opportunity_checklist_items item_row
       where item_row.checklist_version_id = v_s0_version.id
         and item_row.item_key = 'quote'
         and item_row.applicability_state = 'required'
         and pg_catalog.length(item_row.decision_basis ->> 'system_basis_fingerprint') = 64
     )
     or not exists (
       select 1
       from public.commercial_opportunity_checklist_items item_row
       where item_row.checklist_version_id = v_s0_version.id
         and item_row.item_key = 'payment'
         and item_row.applicability_state = 'required'
         and pg_catalog.length(item_row.decision_basis ->> 'system_basis_fingerprint') = 64
     ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: S0 item-scoped system basis was not materialized';
  end if;

  -- Four human-only children. All must keep S0 as the true system baseline.
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);

  select * into v_h1
  from public.override_commercial_opportunity_checklist_item_by_user(
    v_org_id, v_store_id, v_opp_id, v_s0_version.id,
    'p9:3.5:carry-forward-runner:h1', repeat('a',64),
    'technical_visit','commercial_gate','not_applicable',
    'human_visit_exception_one','Human made technical visit not applicable for this opportunity.',
    '{"runner":true,"step":"h1"}'::jsonb
  );

  select * into v_h2
  from public.override_commercial_opportunity_checklist_item_by_user(
    v_org_id, v_store_id, v_opp_id, v_h1.result_checklist_version_id,
    'p9:3.5:carry-forward-runner:h2', repeat('b',64),
    'quote','commercial_gate','optional',
    'human_quote_exception','Human made quote optional for this opportunity.',
    '{"runner":true,"step":"h2"}'::jsonb
  );

  select * into v_h3
  from public.override_commercial_opportunity_checklist_item_by_user(
    v_org_id, v_store_id, v_opp_id, v_h2.result_checklist_version_id,
    'p9:3.5:carry-forward-runner:h3', repeat('c',64),
    'payment','commercial_gate','optional',
    'human_payment_exception','Human made payment gate optional for this opportunity.',
    '{"runner":true,"step":"h3"}'::jsonb
  );

  select * into v_h4
  from public.override_commercial_opportunity_checklist_item_by_user(
    v_org_id, v_store_id, v_opp_id, v_h3.result_checklist_version_id,
    'p9:3.5:carry-forward-runner:h4', repeat('d',64),
    'technical_visit','commercial_gate','optional',
    'human_visit_exception_two','Human revised the technical visit exception to optional.',
    '{"runner":true,"step":"h4"}'::jsonb
  );

  execute 'reset role';

  if not coalesce(v_h1.changed,false) or not coalesce(v_h2.changed,false)
     or not coalesce(v_h3.changed,false) or not coalesce(v_h4.changed,false) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: human override chain was not created';
  end if;

  for v_event in
    select event_row.*
    from public.commercial_opportunity_checklist_override_events event_row
    where event_row.organization_id = v_org_id
      and event_row.store_id = v_store_id
      and event_row.commercial_opportunity_id = v_opp_id
      and event_row.operation_key in (
        'p9:3.5:carry-forward-runner:h1',
        'p9:3.5:carry-forward-runner:h2',
        'p9:3.5:carry-forward-runner:h3',
        'p9:3.5:carry-forward-runner:h4'
      )
    order by event_row.operation_key
  loop
    if v_event.system_baseline_checklist_version_id is distinct from v_s0_version.id
       or v_event.system_baseline_basis_fingerprint is null
       or pg_catalog.length(v_event.system_baseline_basis_fingerprint) <> 64 then
      raise exception using errcode = 'P0001', message = 'SUT_FAIL: human-only chain lost true S0 system baseline';
    end if;
  end loop;

  select event_row.* into v_event
  from public.commercial_opportunity_checklist_override_events event_row
  where event_row.operation_key = 'p9:3.5:carry-forward-runner:h4'
    and event_row.organization_id = v_org_id
    and event_row.store_id = v_store_id
    and event_row.commercial_opportunity_id = v_opp_id;

  if not found
     or v_event.system_baseline_applicability_state <> 'needs_resolution'
     or v_event.system_baseline_basis_fingerprint is distinct from v_s0_technical_fp then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: repeated same-item override changed its system baseline';
  end if;

  -- Irrelevant-to-these-items Settings change: global settings fingerprint moves,
  -- but technical_visit/quote/payment item basis stays equivalent and all human
  -- exceptions must carry forward.
  update public.store_contract_settings
  set contract_enabled = false
  where organization_id = v_org_id and store_id = v_store_id;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  select * into v_s1
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:carry-forward:s1-irrelevant-settings'
  );

  execute 'reset role';

  if not coalesce(v_s1.changed,false)
     or v_s1.outcome <> 'checklist_version_created_with_human_merge'
     or v_s1.actor_type <> 'system'
     or v_s1.settings_fingerprint = v_s0.settings_fingerprint then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: irrelevant Settings rematerialization did not create S1 human merge';
  end if;

  select version_row.* into v_s1_version
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = v_s1.current_checklist_version_id;

  select item_row.decision_basis ->> 'system_basis_fingerprint'
  into v_s1_technical_fp
  from public.commercial_opportunity_checklist_items item_row
  where item_row.checklist_version_id = v_s1_version.id
    and item_row.item_key = 'technical_visit'
    and item_row.item_kind = 'commercial_gate';

  if v_s1_technical_fp is distinct from v_s0_technical_fp then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: irrelevant contract setting changed technical_visit system basis fingerprint';
  end if;

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_s1_version.id
      and item_row.item_key = 'technical_visit'
      and item_row.applicability_state = 'optional'
      and item_row.reason_code = 'human_visit_exception_two'
      and item_row.decision_basis ->> 'system_applicability_state' = 'needs_resolution'
      and item_row.decision_basis -> 'human_override' ->> 'status' = 'active'
      and item_row.decision_basis -> 'human_override' ->> 'system_baseline_checklist_version_id' = v_s0_version.id::text
  ) or not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_s1_version.id
      and item_row.item_key = 'quote'
      and item_row.applicability_state = 'optional'
      and item_row.decision_basis ->> 'system_applicability_state' = 'required'
      and item_row.decision_basis -> 'human_override' ->> 'status' = 'active'
  ) or not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_s1_version.id
      and item_row.item_key = 'payment'
      and item_row.applicability_state = 'optional'
      and item_row.decision_basis ->> 'system_applicability_state' = 'required'
      and item_row.decision_basis -> 'human_override' ->> 'status' = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: equivalent item basis did not carry human authority';
  end if;

  if coalesce((v_s1_version.metadata ->> 'human_carry_forward_count')::integer,0) <> 3
     or coalesce((v_s1_version.metadata ->> 'human_revalidation_count')::integer,0) <> 0
     or coalesce((v_s1_version.metadata ->> 'human_absorbed_count')::integer,0) <> 0 then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: S1 human merge counts mismatch';
  end if;

  -- A fresh human decision after a real system materialization must anchor to
  -- S1, even though the effective item still carries an older S0 exception.
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);

  select * into v_h5
  from public.override_commercial_opportunity_checklist_item_by_user(
    v_org_id, v_store_id, v_opp_id, v_s1_version.id,
    'p9:3.5:carry-forward-runner:h5', repeat('e',64),
    'technical_visit','commercial_gate','required',
    'human_visit_fresh_decision','Human made a fresh technical visit decision after S1.',
    '{"runner":true,"step":"h5"}'::jsonb
  );

  execute 'reset role';

  select event_row.* into v_event
  from public.commercial_opportunity_checklist_override_events event_row
  where event_row.operation_key = 'p9:3.5:carry-forward-runner:h5'
    and event_row.organization_id = v_org_id
    and event_row.store_id = v_store_id
    and event_row.commercial_opportunity_id = v_opp_id;

  if not found
     or v_event.system_baseline_checklist_version_id is distinct from v_s1_version.id
     or v_event.system_baseline_applicability_state <> 'needs_resolution'
     or v_event.system_baseline_basis_fingerprint is distinct from v_s1_technical_fp then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: fresh human decision did not re-anchor to S1 pure system baseline';
  end if;

  -- V2 policy: technical_visit converges to the human required decision;
  -- quote becomes a concrete different authority; payment becomes inconclusive.
  v_policy_rules_v2 := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('rule_key','contract.always.needs_resolution','rule_priority',10,'item_kind','commercial_gate','item_key','contract','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','needs_resolution','reason_code','contract_applicability_not_configured','metadata','{}'::jsonb),
    pg_catalog.jsonb_build_object('rule_key','technical_visit.installation.required','rule_priority',70,'item_kind','commercial_gate','item_key','technical_visit','match_mode','execution','component_kind',null,'execution_kind','installation','applicability_state','required','reason_code','installation_visit_now_required','metadata','{}'::jsonb),
    pg_catalog.jsonb_build_object('rule_key','technical_visit.default.not_applicable','rule_priority',10,'item_kind','commercial_gate','item_key','technical_visit','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','not_applicable','reason_code','technical_visit_not_required_by_default','metadata','{}'::jsonb),
    pg_catalog.jsonb_build_object('rule_key','quote.custom.not_applicable','rule_priority',60,'item_kind','commercial_gate','item_key','quote','match_mode','component','component_kind','custom','execution_kind',null,'applicability_state','not_applicable','reason_code','custom_quote_now_not_applicable','metadata','{}'::jsonb),
    pg_catalog.jsonb_build_object('rule_key','quote.default.optional','rule_priority',10,'item_kind','commercial_gate','item_key','quote','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','optional','reason_code','quote_optional_by_default','metadata','{}'::jsonb),
    pg_catalog.jsonb_build_object('rule_key','payment.always.needs_resolution','rule_priority',10,'item_kind','commercial_gate','item_key','payment','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','needs_resolution','reason_code','payment_applicability_needs_resolution','metadata','{}'::jsonb)
  );

  select * into v_policy_write
  from public.write_store_opportunity_gate_policy_internal(
    v_org_id,
    v_store_id,
    'p9:3.5:carry-forward-runner:policy:v2',
    repeat('3',64),
    v_policy_rules_v2,
    'system', null, 'manual_check_runner',
    'checklist_carry_forward_runner_policy_v2','p9_checklist_runner',
    '{"runner":true,"policy":"v2"}'::jsonb
  );

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  select * into v_s2
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:carry-forward:s2-basis-change'
  );

  execute 'reset role';

  if not coalesce(v_s2.changed,false)
     or v_s2.outcome <> 'checklist_version_created_with_human_merge'
     or v_s2.checklist_state <> 'conflict' then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: S2 basis-change merge contract mismatch';
  end if;

  select version_row.* into v_s2_version
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = v_s2.current_checklist_version_id;

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_s2_version.id
      and item_row.item_key = 'technical_visit'
      and item_row.applicability_state = 'required'
      and item_row.reason_code = 'installation_visit_now_required'
      and not (item_row.decision_basis ? 'human_override')
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: system convergence did not absorb technical_visit human override';
  end if;

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_s2_version.id
      and item_row.item_key = 'quote'
      and item_row.applicability_state = 'conflict'
      and item_row.reason_code = 'human_override_basis_changed_conflict'
      and item_row.decision_basis ->> 'system_applicability_state' = 'not_applicable'
      and item_row.decision_basis -> 'human_override' ->> 'status' = 'revalidation_required'
      and item_row.decision_basis -> 'human_override' ->> 'to_applicability_state' = 'optional'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: concrete changed quote authority did not conflict';
  end if;

  if not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id = v_s2_version.id
      and item_row.item_key = 'payment'
      and item_row.applicability_state = 'needs_resolution'
      and item_row.reason_code = 'human_override_revalidation_required'
      and item_row.decision_basis ->> 'system_applicability_state' = 'needs_resolution'
      and item_row.decision_basis -> 'human_override' ->> 'status' = 'revalidation_required'
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: inconclusive changed payment authority did not stay needs_resolution';
  end if;

  if coalesce((v_s2_version.metadata ->> 'human_absorbed_count')::integer,0) <> 1
     or coalesce((v_s2_version.metadata ->> 'human_revalidation_count')::integer,0) <> 2 then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: S2 absorption/revalidation counts mismatch';
  end if;

  -- Same event is an exact replay; a different event with the same effective
  -- authorities/items is checklist_unchanged.
  select pg_catalog.count(*)::integer into v_version_count_before
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.organization_id=v_org_id and version_row.store_id=v_store_id
    and version_row.commercial_opportunity_id=v_opp_id;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  select * into v_replay
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:carry-forward:s2-basis-change'
  );

  select * into v_unchanged
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:carry-forward:s2-unchanged'
  );

  execute 'reset role';

  select pg_catalog.count(*)::integer into v_version_count_after
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.organization_id=v_org_id and version_row.store_id=v_store_id
    and version_row.commercial_opportunity_id=v_opp_id;

  if not coalesce(v_replay.replayed,false)
     or v_replay.outcome <> 'idempotent_replay_current'
     or v_replay.current_checklist_version_id is distinct from v_s2_version.id
     or v_unchanged.outcome <> 'checklist_unchanged'
     or coalesce(v_unchanged.changed,true)
     or v_version_count_after <> v_version_count_before then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: S2 replay/unchanged semantics mismatch';
  end if;

  -- Human resolves the quote conflict. Because base is S2 system-owned, the
  -- fresh decision must anchor to S2 pure quote=not_applicable, not old S0.
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);

  select * into v_h6
  from public.override_commercial_opportunity_checklist_item_by_user(
    v_org_id, v_store_id, v_opp_id, v_s2_version.id,
    'p9:3.5:carry-forward-runner:h6', repeat('f',64),
    'quote','commercial_gate','required',
    'human_quote_revalidation','Human revalidated quote after the system basis changed.',
    '{"runner":true,"step":"h6"}'::jsonb
  );

  execute 'reset role';

  select event_row.* into v_event
  from public.commercial_opportunity_checklist_override_events event_row
  where event_row.operation_key = 'p9:3.5:carry-forward-runner:h6'
    and event_row.organization_id=v_org_id and event_row.store_id=v_store_id
    and event_row.commercial_opportunity_id=v_opp_id;

  if not found
     or v_event.system_baseline_checklist_version_id is distinct from v_s2_version.id
     or v_event.system_baseline_applicability_state <> 'not_applicable' then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: conflict revalidation did not create a fresh S2 system baseline';
  end if;

  -- V3 policy retypes quote and removes payment. Neither old override may be
  -- resurrected: identity is item_key+item_kind and absent items stay absent.
  v_policy_rules_v3 := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('rule_key','contract.always.needs_resolution','rule_priority',10,'item_kind','commercial_gate','item_key','contract','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','needs_resolution','reason_code','contract_applicability_not_configured','metadata','{}'::jsonb),
    pg_catalog.jsonb_build_object('rule_key','technical_visit.installation.required','rule_priority',70,'item_kind','commercial_gate','item_key','technical_visit','match_mode','execution','component_kind',null,'execution_kind','installation','applicability_state','required','reason_code','installation_visit_now_required','metadata','{}'::jsonb),
    pg_catalog.jsonb_build_object('rule_key','technical_visit.default.not_applicable','rule_priority',10,'item_kind','commercial_gate','item_key','technical_visit','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','not_applicable','reason_code','technical_visit_not_required_by_default','metadata','{}'::jsonb),
    pg_catalog.jsonb_build_object('rule_key','quote.retyped.required','rule_priority',10,'item_kind','technical_requirement','item_key','quote','match_mode','always','component_kind',null,'execution_kind',null,'applicability_state','required','reason_code','retyped_quote_requirement','metadata','{}'::jsonb)
  );

  select * into v_policy_write
  from public.write_store_opportunity_gate_policy_internal(
    v_org_id,
    v_store_id,
    'p9:3.5:carry-forward-runner:policy:v3',
    repeat('4',64),
    v_policy_rules_v3,
    'system', null, 'manual_check_runner',
    'checklist_carry_forward_runner_policy_v3','p9_checklist_runner',
    '{"runner":true,"policy":"v3"}'::jsonb
  );

  select pg_catalog.count(*)::integer into v_event_count_before
  from public.commercial_opportunity_checklist_override_events event_row
  where event_row.organization_id=v_org_id and event_row.store_id=v_store_id
    and event_row.commercial_opportunity_id=v_opp_id;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  select * into v_s3
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id, v_store_id, v_opp_id, 'runner:carry-forward:s3-retire-retype'
  );

  execute 'reset role';

  select version_row.* into v_s3_version
  from public.commercial_opportunity_checklist_versions version_row
  where version_row.id = v_s3.current_checklist_version_id;

  select pg_catalog.count(*)::integer into v_event_count_after
  from public.commercial_opportunity_checklist_override_events event_row
  where event_row.organization_id=v_org_id and event_row.store_id=v_store_id
    and event_row.commercial_opportunity_id=v_opp_id;

  if not coalesce(v_s3.changed,false)
     or v_s3.outcome <> 'checklist_version_created_with_human_merge'
     or coalesce((v_s3_version.metadata ->> 'human_retired_count')::integer,0) <> 2
     or v_event_count_after <> v_event_count_before then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: removed/retyped override retirement contract mismatch';
  end if;

  if exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id=v_s3_version.id
      and item_row.item_key='payment'
  ) or not exists (
    select 1 from public.commercial_opportunity_checklist_items item_row
    where item_row.checklist_version_id=v_s3_version.id
      and item_row.item_key='quote'
      and item_row.item_kind='technical_requirement'
      and item_row.applicability_state='required'
      and not (item_row.decision_basis ? 'human_override')
  ) then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: removed/retyped item was resurrected by old human authority';
  end if;

  -- Legacy pre-v2 style human child without explicit override baseline is kept
  -- fail-closed rather than guessed/reinterpreted.
  insert into public.commercial_opportunity_checklist_versions (
    organization_id, store_id, commercial_opportunity_id,
    version_number, previous_checklist_version_id,
    profile_version_id, gate_policy_version_id, checklist_state,
    settings_snapshot, settings_fingerprint,
    operation_key, request_fingerprint,
    actor_type, actor_user_id, source_type, reason_code, created_by, metadata
  ) values (
    v_org_id, v_store_id, v_opp_id,
    v_s3_version.version_number + 1, v_s3_version.id,
    v_s3_version.profile_version_id, v_s3_version.gate_policy_version_id,
    v_s3_version.checklist_state,
    v_s3_version.settings_snapshot, v_s3_version.settings_fingerprint,
    'p9:3.5:carry-forward-runner:legacy-human', repeat('8',64),
    'human', v_user_id, 'crm_manual',
    'legacy_human_authority_test','user:' || v_user_id::text,
    '{"runner":true,"legacy":true}'::jsonb
  ) returning * into v_legacy_human;

  insert into public.commercial_opportunity_checklist_items (
    organization_id,store_id,commercial_opportunity_id,checklist_version_id,
    item_key,item_kind,applicability_state,reason_code,decision_basis,metadata
  )
  select organization_id,store_id,commercial_opportunity_id,v_legacy_human.id,
         item_key,item_kind,applicability_state,reason_code,
         decision_basis - 'human_override',metadata
  from public.commercial_opportunity_checklist_items
  where checklist_version_id=v_s3_version.id;

  update public.commercial_opportunity_checklist_current
  set current_checklist_version_id=v_legacy_human.id,
      last_operation_key=v_legacy_human.operation_key
  where organization_id=v_org_id and store_id=v_store_id
    and commercial_opportunity_id=v_opp_id;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  select * into v_preserved
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id,v_store_id,v_opp_id,'runner:carry-forward:preserve-legacy-human'
  );

  execute 'reset role';

  if not coalesce(v_preserved.preserved,false)
     or v_preserved.outcome <> 'preserved_legacy_human_authority'
     or v_preserved.current_checklist_version_id is distinct from v_legacy_human.id then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: legacy human authority was not preserved fail-closed';
  end if;

  -- Stronger/non-owned system authority remains preserved exactly.
  insert into public.commercial_opportunity_checklist_versions (
    organization_id, store_id, commercial_opportunity_id,
    version_number, previous_checklist_version_id,
    profile_version_id, gate_policy_version_id, checklist_state,
    settings_snapshot, settings_fingerprint,
    operation_key, request_fingerprint,
    actor_type, actor_user_id, source_type, reason_code, created_by, metadata
  ) values (
    v_org_id,v_store_id,v_opp_id,
    v_legacy_human.version_number + 1,v_legacy_human.id,
    v_legacy_human.profile_version_id,v_legacy_human.gate_policy_version_id,
    v_legacy_human.checklist_state,
    v_legacy_human.settings_snapshot,v_legacy_human.settings_fingerprint,
    'p9:3.5:carry-forward-runner:external-system',repeat('9',64),
    'system',null,'external_checklist_authority',
    'external_checklist_authority_test','p9_runner_external','{"runner":true}'::jsonb
  ) returning * into v_external;

  insert into public.commercial_opportunity_checklist_items (
    organization_id,store_id,commercial_opportunity_id,checklist_version_id,
    item_key,item_kind,applicability_state,reason_code,decision_basis,metadata
  )
  select organization_id,store_id,commercial_opportunity_id,v_external.id,
         item_key,item_kind,applicability_state,reason_code,decision_basis,metadata
  from public.commercial_opportunity_checklist_items
  where checklist_version_id=v_legacy_human.id;

  update public.commercial_opportunity_checklist_current
  set current_checklist_version_id=v_external.id,
      last_operation_key=v_external.operation_key
  where organization_id=v_org_id and store_id=v_store_id
    and commercial_opportunity_id=v_opp_id;

  execute 'set local role service_role';
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  select * into v_preserved
  from public.materialize_commercial_opportunity_checklist_by_system(
    v_org_id,v_store_id,v_opp_id,'runner:carry-forward:preserve-external'
  );

  execute 'reset role';

  if not coalesce(v_preserved.preserved,false)
     or v_preserved.outcome <> 'preserved_non_materializer_authority'
     or v_preserved.current_checklist_version_id is distinct from v_external.id then
    raise exception using errcode = 'P0001', message = 'SUT_FAIL: non-materializer authority was overwritten';
  end if;
end;
$behavior$;

do $definition_gate$
declare
  v_materializer oid := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)'
  );
  v_writer oid := pg_catalog.to_regprocedure(
    'public.override_commercial_opportunity_checklist_item_by_user(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)'
  );
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(v_materializer) into v_definition;
  if pg_catalog.strpos(v_definition,'preserved_human_authority') > 0
     or pg_catalog.strpos(v_definition,'preserved_legacy_human_authority') = 0
     or pg_catalog.strpos(v_definition,'preserved_non_materializer_authority') = 0
     or pg_catalog.strpos(v_definition,'p9_opportunity_checklist_apply_human_override_internal') = 0
     or pg_catalog.strpos(v_definition,'human_retired_count') = 0
     or pg_catalog.strpos(v_definition,'p9_checklist_materializer_v2') = 0
     or pg_catalog.strpos(v_definition,'max(version_number)') > 0
     or pg_catalog.strpos(v_definition,'order by created_at desc') > 0 then
    raise exception using errcode='P0001', message='SUT_FAIL: materializer static carry-forward contract mismatch';
  end if;

  select pg_catalog.pg_get_functiondef(v_writer) into v_definition;
  if pg_catalog.strpos(v_definition,'system_baseline_checklist_version_id') = 0
     or pg_catalog.strpos(v_definition,'system_baseline_basis_fingerprint') = 0
     or pg_catalog.strpos(v_definition,'auth.uid()') = 0
     or pg_catalog.strpos(v_definition,'ZION_CHECKLIST_OVERRIDE_TARGET_STATE_INVALID') = 0
     or pg_catalog.strpos(v_definition,'ZION_CHECKLIST_OVERRIDE_STALE_CURRENT') = 0
     or pg_catalog.strpos(v_definition,'max(version_number)') > 0
     or pg_catalog.strpos(v_definition,'order by created_at desc') > 0 then
    raise exception using errcode='P0001', message='SUT_FAIL: human writer static baseline contract mismatch';
  end if;
end;
$definition_gate$;

rollback;
