-- ZION / P9 / 9.3-B — Canonical contract usage checklist authority.
-- ROLLBACK-ONLY focal checks on the known DEV ZION store.
-- This temporarily changes DEV Settings and materializes checklist versions
-- within one transaction; nothing persists after ROLLBACK.
-- Must run AFTER 20261009150000_p9_9_3b_contract_usage_checklist_authority.sql.
BEGIN;

DO $p9_93b_contract_runner$
DECLARE
  v_org uuid := 'b02252ce-0e73-4371-9e23-f1009e7b1698'::uuid;
  v_store uuid := '6ac8f4b1-e50f-42c0-9cae-78951d6daf7b'::uuid;
  v_opp uuid;
  v_policy jsonb;
  v_materializer oid := pg_catalog.to_regprocedure(
    'public.materialize_commercial_opportunity_checklist_by_system(uuid,uuid,uuid,text)'
  );
  v_event_prefix text := 'runner:p9:9.3b:' || pg_catalog.substr(pg_catalog.md5(gen_random_uuid()::text), 1, 20);
  v_first record;
  v_replay record;
  v_next record;
  v_item_state text;
  v_item_reason text;
  v_non_contract_baseline jsonb;
  v_non_contract_after jsonb;
  v_before_fingerprint text;
  v_after_fingerprint text;
  v_scenarios text[] := ARRAY['physical','digital','incomplete','missing','disabled_with_legacy'];
  v_scenario text;
  v_scenario_policy jsonb;
  v_candidate_state text;
  v_candidate_reason text;
  v_legacy_count integer;
  v_current_count integer;
  v_override_count integer;
BEGIN
  IF v_materializer IS NULL OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(v_materializer),
       'p9_contract_usage_canonical_precedence_v1'
     ) = 0 THEN
    RAISE EXCEPTION 'P9_93B_RUNNER_MIGRATION_NOT_INSTALLED';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_materializer, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_materializer, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_materializer, 'EXECUTE') THEN
    RAISE EXCEPTION 'P9_93B_RUNNER_GRANTS_INVALID';
  END IF;
  RAISE NOTICE 'PASS 01: materializer installed and grants restricted';

  SELECT count(*) INTO v_current_count
  FROM public.commercial_opportunity_checklist_current c
  WHERE c.organization_id = v_org AND c.store_id = v_store;
  IF v_current_count = 0 THEN
    RAISE EXCEPTION 'P9_93B_FIXTURE_NO_CURRENT_CHECKLIST';
  END IF;

  SELECT p.contract_usage_policy INTO v_policy
  FROM public.store_settings_experience_policies p
  WHERE p.organization_id = v_org AND p.store_id = v_store;

  IF NOT FOUND OR v_policy ->> 'enabled' IS DISTINCT FROM 'Não'
     OR v_policy -> 'formats' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'P9_93B_FIXTURE_POLICY_CHANGED: %', v_policy;
  END IF;

  SELECT count(*) INTO v_legacy_count
  FROM public.store_contract_settings cs
  WHERE cs.organization_id = v_org AND cs.store_id = v_store;
  IF v_legacy_count <> 0 THEN
    RAISE EXCEPTION 'P9_93B_FIXTURE_LEGACY_SETTINGS_CHANGED';
  END IF;

  SELECT c.commercial_opportunity_id INTO v_opp
  FROM public.commercial_opportunity_checklist_current c
  WHERE c.organization_id = v_org AND c.store_id = v_store
  ORDER BY c.commercial_opportunity_id
  LIMIT 1;

  IF v_opp IS NULL THEN
    RAISE EXCEPTION 'P9_93B_FIXTURE_OPPORTUNITY_MISSING';
  END IF;

  -- Match the original service-only materializer invocation contract.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);

  SELECT * INTO v_first
  FROM public.materialize_commercial_opportunity_checklist_by_system(
    v_org, v_store, v_opp, v_event_prefix || ':disabled'
  );
  SELECT i.applicability_state, i.reason_code
    INTO v_item_state, v_item_reason
  FROM public.commercial_opportunity_checklist_items i
  WHERE i.checklist_version_id = v_first.current_checklist_version_id
    AND i.organization_id = v_org AND i.store_id = v_store
    AND i.commercial_opportunity_id = v_opp AND i.item_key = 'contract';
  IF NOT FOUND OR v_item_state IS DISTINCT FROM 'not_applicable'
     OR v_item_reason IS DISTINCT FROM 'contract_usage_disabled_for_store' THEN
    RAISE EXCEPTION 'P9_93B_DISABLED_NOT_APPLICABLE_FAILED: %, %', v_item_state, v_item_reason;
  END IF;
  RAISE NOTICE 'PASS 02: canonical disabled => not_applicable without legacy Settings';

  SELECT * INTO v_replay
  FROM public.materialize_commercial_opportunity_checklist_by_system(
    v_org, v_store, v_opp, v_event_prefix || ':disabled'
  );
  IF v_replay.current_checklist_version_id IS DISTINCT FROM v_first.current_checklist_version_id
     OR v_replay.replayed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'P9_93B_EVENT_REPLAY_NOT_IDEMPOTENT';
  END IF;
  RAISE NOTICE 'PASS 03: repeated event key replays original version';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'key', i.item_key,
        'kind', i.item_kind,
        'state', i.applicability_state,
        'reason', i.reason_code,
        'baseline_fingerprint', public.p9_opportunity_checklist_system_basis_fingerprint_internal(
          i.item_key, i.item_kind, i.applicability_state, i.reason_code, i.decision_basis
        )
      ) ORDER BY i.item_key
    ), '[]'::jsonb
  ) INTO v_non_contract_baseline
  FROM public.commercial_opportunity_checklist_items i
  WHERE i.checklist_version_id = v_first.current_checklist_version_id
    AND i.organization_id = v_org AND i.store_id = v_store
    AND i.commercial_opportunity_id = v_opp AND i.item_key <> 'contract';

  -- The global Settings hash must not change per-item selected-candidate
  -- fingerprints. This property prevents unrelated human override churn.
  SELECT public.p9_opportunity_checklist_system_basis_fingerprint_internal(
    i.item_key, i.item_kind, i.applicability_state, i.reason_code,
    i.decision_basis || jsonb_build_object('settings_fingerprint', 'TEST_A')
  ) INTO v_before_fingerprint
  FROM public.commercial_opportunity_checklist_items i
  WHERE i.checklist_version_id = v_first.current_checklist_version_id
    AND i.item_key <> 'contract'
  ORDER BY i.item_key LIMIT 1;
  SELECT public.p9_opportunity_checklist_system_basis_fingerprint_internal(
    i.item_key, i.item_kind, i.applicability_state, i.reason_code,
    i.decision_basis || jsonb_build_object('settings_fingerprint', 'TEST_B')
  ) INTO v_after_fingerprint
  FROM public.commercial_opportunity_checklist_items i
  WHERE i.checklist_version_id = v_first.current_checklist_version_id
    AND i.item_key <> 'contract'
  ORDER BY i.item_key LIMIT 1;
  IF v_before_fingerprint IS NULL
     OR v_before_fingerprint IS DISTINCT FROM v_after_fingerprint THEN
    RAISE EXCEPTION 'P9_93B_NON_CONTRACT_BASIS_DEPENDS_ON_GLOBAL_SETTINGS_HASH';
  END IF;
  RAISE NOTICE 'PASS 04: unrelated item-scoped baseline does not depend on global Settings hash';

  -- Create a LEGACY row only within the rollback transaction, intentionally
  -- disagreeing with the canonical policy. This must never override canonical.
  INSERT INTO public.store_contract_settings (
    id, organization_id, store_id, contract_enabled,
    requires_customer_signature, requires_store_signature,
    requires_human_approval_before_send, default_validity_days,
    allow_ai_prepare_contract, allow_ai_send_contract,
    metadata, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_store, false,
    false, false, false, 30, false, false,
    '{}'::jsonb, now(), now()
  );

  FOREACH v_scenario IN ARRAY v_scenarios LOOP
    CASE v_scenario
      WHEN 'physical' THEN
        v_scenario_policy := v_policy || jsonb_build_object('enabled', 'Sim', 'formats', jsonb_build_array('fisico'));
        v_candidate_state := 'needs_resolution';
        v_candidate_reason := 'contract_applicability_not_configured';
      WHEN 'digital' THEN
        v_scenario_policy := v_policy || jsonb_build_object('enabled', 'Sim', 'formats', jsonb_build_array('digital'));
        v_candidate_state := 'needs_resolution';
        v_candidate_reason := 'contract_applicability_not_configured';
      WHEN 'incomplete' THEN
        v_scenario_policy := v_policy || jsonb_build_object('enabled', 'Sim', 'formats', '[]'::jsonb);
        v_candidate_state := 'needs_resolution';
        v_candidate_reason := 'contract_usage_policy_not_configured';
      WHEN 'missing' THEN
        v_scenario_policy := '{}'::jsonb;
        v_candidate_state := 'needs_resolution';
        v_candidate_reason := 'contract_usage_policy_not_configured';
      WHEN 'disabled_with_legacy' THEN
        UPDATE public.store_contract_settings
          SET contract_enabled = true
        WHERE organization_id = v_org AND store_id = v_store;
        v_scenario_policy := v_policy;
        v_candidate_state := 'not_applicable';
        v_candidate_reason := 'contract_usage_disabled_for_store';
      ELSE
        RAISE EXCEPTION 'P9_93B_RUNNER_UNKNOWN_SCENARIO';
    END CASE;

    UPDATE public.store_settings_experience_policies
    SET contract_usage_policy = v_scenario_policy
    WHERE organization_id = v_org AND store_id = v_store;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'P9_93B_POLICY_UPDATE_MISSING';
    END IF;

    SELECT * INTO v_next
    FROM public.materialize_commercial_opportunity_checklist_by_system(
      v_org, v_store, v_opp, v_event_prefix || ':' || v_scenario
    );
    SELECT i.applicability_state, i.reason_code
      INTO v_item_state, v_item_reason
    FROM public.commercial_opportunity_checklist_items i
    WHERE i.checklist_version_id = v_next.current_checklist_version_id
      AND i.organization_id = v_org AND i.store_id = v_store
      AND i.commercial_opportunity_id = v_opp AND i.item_key = 'contract';

    IF NOT FOUND OR v_item_state IS DISTINCT FROM v_candidate_state
       OR v_item_reason IS DISTINCT FROM v_candidate_reason THEN
      RAISE EXCEPTION 'P9_93B_SCENARIO_FAILED: %, actual=%/%, expected=%/%',
        v_scenario, v_item_state, v_item_reason, v_candidate_state, v_candidate_reason;
    END IF;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'key', i.item_key,
          'kind', i.item_kind,
          'state', i.applicability_state,
          'reason', i.reason_code,
          'baseline_fingerprint', public.p9_opportunity_checklist_system_basis_fingerprint_internal(
            i.item_key, i.item_kind, i.applicability_state, i.reason_code, i.decision_basis
          )
        ) ORDER BY i.item_key
      ), '[]'::jsonb
    ) INTO v_non_contract_after
    FROM public.commercial_opportunity_checklist_items i
    WHERE i.checklist_version_id = v_next.current_checklist_version_id
      AND i.organization_id = v_org AND i.store_id = v_store
      AND i.commercial_opportunity_id = v_opp AND i.item_key <> 'contract';

    IF v_non_contract_after IS DISTINCT FROM v_non_contract_baseline THEN
      RAISE EXCEPTION 'P9_93B_NON_CONTRACT_REGRESSION: %', v_scenario;
    END IF;
    RAISE NOTICE 'PASS 05 (%): correct contract result, non-contract items unchanged', v_scenario;
  END LOOP;

  -- Prior live versions and overrides must survive unchanged (ROLLBACK also
  -- guarantees all runner materializations and Settings updates are discarded).
  SELECT count(*) INTO v_override_count
  FROM public.commercial_opportunity_checklist_override_events e
  WHERE e.organization_id = v_org AND e.store_id = v_store
    AND e.commercial_opportunity_id = v_opp;
  RAISE NOTICE 'INFO: existing human override events for test opportunity=%', v_override_count;
  RAISE NOTICE 'PASS 06: test scenarios finished; ROLLBACK discards all temporary writes';
END;
$p9_93b_contract_runner$;

ROLLBACK;
-- No DEV Settings, legacy row, checklist versions or pointers are committed.
