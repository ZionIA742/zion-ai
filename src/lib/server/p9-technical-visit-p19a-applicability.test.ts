import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260929160000_p9_technical_visit_measurements_confirmation_authority.sql",
);

const runnerPath = join(
  process.cwd(),
  "supabase/tests/20260925170000_p9_technical_visit_p19a_applicability_manual_checks.sql",
);

function readMigration() {
  return readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n");
}

function readRunner() {
  return readFileSync(runnerPath, "utf8").replace(/\r\n/g, "\n");
}

function blockBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  assert.equal(start > -1, true, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.equal(end > start, true, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function technicalVisitBlock(source: string) {
  return blockBetween(
    source,
    "-- P19-A Settings authority for technical_visit applicability.",
    "-- Contract enabled means the feature exists",
  );
}

function settingsSnapshotBlock(source: string) {
  return blockBetween(
    source,
    "v_settings_snapshot := pg_catalog.jsonb_build_object(",
    "v_settings_fingerprint := pg_catalog.encode(",
  );
}

function requestPayloadBlock(source: string) {
  return blockBetween(
    source,
    "v_request_payload := pg_catalog.jsonb_build_object(",
    "v_request_fingerprint := pg_catalog.encode(",
  );
}

function technicalVisitBasisBranch(source: string) {
  return blockBetween(
    source,
    "if v_item_record.item_key = 'technical_visit' then",
    "else\n      v_system_decision_basis := pg_catalog.jsonb_build_object(",
  );
}

const tests: TestCase[] = [
  {
    name: "technical_visit is materialized directly from P19-A even without Gate Policy item",
    run: () => {
      const source = readMigration();
      const block = technicalVisitBlock(source);

      assert.equal(block.includes("store_operation_execution_policies"), true);
      assert.equal(block.includes("jsonb_set(v_item_map, '{technical_visit}'"), true);
      assert.equal(block.includes("'item_key', 'technical_visit'"), true);
      assert.equal(block.includes("'item_kind', 'commercial_gate'"), true);
      assert.equal(block.includes("Gate Policy"), true);
      assert.equal(block.includes("intentionally overwritten"), true);
    },
  },
  {
    name: "never configured policy fails closed as needs_resolution",
    run: () => {
      const block = technicalVisitBlock(readMigration());

      assert.equal(block.includes("if not v_technical_visit_policy_configured then"), true);
      assert.equal(block.includes("v_technical_visit_policy_state := 'needs_resolution';"), true);
      assert.equal(block.includes("technical_visit_policy_not_configured"), true);
    },
  },
  {
    name: "explicitly not offered policy is not_applicable unless legacy mirror conflicts",
    run: () => {
      const block = technicalVisitBlock(readMigration());

      assert.equal(block.includes("elsif v_technical_visit_policy is null then"), true);
      assert.equal(block.includes("if v_offers_technical_visit is true then"), true);
      assert.equal(block.includes("technical_visit_policy_legacy_mirror_conflict"), true);
      assert.equal(block.includes("v_technical_visit_policy_state := 'not_applicable';"), true);
      assert.equal(block.includes("store_does_not_offer_technical_visit"), true);
    },
  },
  {
    name: "legacy Gate Policy cannot replace P19-A technical_visit authority",
    run: () => {
      const source = readMigration();
      const gatePolicyLoop = blockBetween(
        source,
        "-- Evaluate policy rules deterministically.",
        "-- Settings authority: an included installation",
      );
      const block = technicalVisitBlock(source);

      assert.equal(gatePolicyLoop.includes("store_opportunity_gate_policy_rules"), true);
      assert.equal(block.includes("p19a:technical_visit_policy"), true);
      assert.equal(block.includes("v_item_map := pg_catalog.jsonb_set(v_item_map, '{technical_visit}'"), true);
      assert.equal(block.includes("priority', 0"), true);
    },
  },
  {
    name: "legacy mirror contradiction fails closed",
    run: () => {
      const block = technicalVisitBlock(readMigration());

      assert.equal(block.includes("v_offers_technical_visit is true"), true);
      assert.equal(block.includes("v_offers_technical_visit is false"), true);
      assert.equal(block.match(/technical_visit_policy_legacy_mirror_conflict/g)?.length, 2);
      assert.equal(block.includes("v_technical_visit_policy_state := 'conflict';"), true);
    },
  },
  {
    name: "offered policy with empty required and optional arrays needs resolution",
    run: () => {
      const block = technicalVisitBlock(readMigration());

      assert.equal(
        block.includes("in array v_technical_visit_required_situations"),
        true,
      );
      assert.equal(block.includes("array_length(v_technical_visit_optional_situations, 1)"), true);
      assert.equal(block.includes("technical_visit_policy_applicability_not_defined"), true);
    },
  },
  {
    name: "toda_venda_piscina recognizes only positive structural pool evidence",
    run: () => {
      const block = technicalVisitBlock(readMigration());

      assert.equal(block.includes("component_row.component_kind = 'pool'"), true);
      assert.equal(block.includes("component_row.component_state in ('resolved', 'partial')"), true);
      assert.equal(block.includes("when 'toda_venda_piscina' then"), true);
      assert.equal(block.includes("v_pool_component_state = 'positive'"), true);
      assert.equal(block.includes("technical_visit_required_for_pool_sale"), true);
      assert.equal(block.includes("technical_visit_optional_for_pool_sale"), false);
      assert.equal(block.includes("pool_absence"), false);
    },
  },
  {
    name: "absence of pool is not negative proof",
    run: () => {
      const block = technicalVisitBlock(readMigration());

      assert.equal(block.includes("else 'unknown'"), true);
      assert.equal(block.includes("technical_visit_situation_authority_missing"), true);
      assert.equal(block.includes("technical_visit_policy_no_applicable_situation"), false);
      assert.equal(block.includes("v_pool_component_state = 'unknown'") && block.includes("not_applicable"), false);
    },
  },
  {
    name: "piscina_com_instalacao requires pool and included installation",
    run: () => {
      const block = technicalVisitBlock(readMigration());

      assert.equal(block.includes("when 'piscina_com_instalacao' then"), true);
      assert.equal(block.includes("v_pool_component_state = 'positive'"), true);
      assert.equal(block.includes("v_installation_intent_state = 'included'"), true);
      assert.equal(block.includes("technical_visit_required_for_pool_with_installation"), true);
      assert.equal(block.includes("technical_visit_optional_for_pool_with_installation"), false);
    },
  },
  {
    name: "unsupported situations and free text are not executed as rules",
    run: () => {
      const block = technicalVisitBlock(readMigration());

      assert.equal(block.includes("'outro' = any(v_technical_visit_unresolved_required_situations)"), true);
      assert.equal(block.includes("'outro' = any(v_technical_visit_optional_situations)"), true);
      assert.equal(block.includes("technical_visit_free_text_situation_requires_human_resolution"), true);
      assert.equal(block.includes("technical_visit_situation_authority_missing"), true);
      assert.equal(block.includes("technical_visit_optional_situation_authority_missing"), true);
      assert.equal(block.includes("instalacao_sem_venda") && block.includes("included + absence"), false);
    },
  },
  {
    name: "technical_visit_interest and requested area absence remain non-authorities",
    run: () => {
      const block = technicalVisitBlock(readMigration());

      assert.equal(block.includes("'technical_visit_interest_used', false"), true);
      assert.equal(block.includes("'requested_area_m2_absence_used', false"), true);
      assert.equal(block.includes("technical_visit_interest=true"), false);
      assert.equal(block.includes("requested_area_m2 is null"), false);
    },
  },
  {
    name: "medidas uses explicit measurements confirmation qualification authority",
    run: () => {
      const block = technicalVisitBlock(readMigration());

      assert.equal(block.includes("measurements_confirmation_required"), true);
      assert.equal(
        block.includes("commercial_opportunity_qualification_facts_current"),
        true,
      );
      assert.equal(
        block.includes("fact_key = 'measurements_confirmation_required'"),
        true,
      );
      assert.equal(block.includes("when 'medidas' then"), true);
      assert.equal(
        block.includes("v_measurements_confirmation_fact_state = 'confirmed'"),
        true,
      );
      assert.equal(
        block.includes("v_measurements_confirmation_required is true"),
        true,
      );
      assert.equal(
        block.includes("v_measurements_confirmation_required is false"),
        true,
      );
      assert.equal(
        block.includes("v_measurements_confirmation_fact_state = 'conflict'"),
        true,
      );

      assert.equal(
        block.includes("technical_visit_required_for_measurements_confirmation"),
        true,
      );
      assert.equal(
        block.includes("technical_visit_measurements_already_confirmed"),
        true,
      );
      assert.equal(
        block.includes("technical_visit_measurements_confirmation_authority_missing"),
        true,
      );
      assert.equal(
        block.includes("technical_visit_measurements_confirmation_authority_conflict"),
        true,
      );

      assert.equal(block.includes("technical_visit_interest=true"), false);
      assert.equal(block.includes("requested_area_m2 is null"), false);
    },
  },
  {
    name: "region is fail closed for material required or optional assessment",
    run: () => {
      const block = technicalVisitBlock(readMigration());

      assert.equal(block.includes("if v_technical_visit_policy_state in ('required', 'optional') then"), true);
      assert.equal(block.includes("technical_visit_region_not_configured"), true);
      assert.equal(block.includes("technical_visit_region_under_consultation"), true);
      assert.equal(block.includes("technical_visit_region_unverified"), true);
      assert.equal(block.includes("v_technical_visit_final_state := 'needs_resolution';"), true);
      assert.equal(block.includes("customer_geography_authority"), true);
    },
  },
  {
    name: "service region uses Strategy authority without text substring matching",
    run: () => {
      const source = readMigration();
      const snapshot = settingsSnapshotBlock(source);
      const block = technicalVisitBlock(source);

      assert.equal(snapshot.includes("store_strategy_settings"), true);
      assert.equal(block.includes("service_region_modes"), true);
      assert.equal(block.includes("service_region_outside_consultation"), true);
      assert.equal(block.includes("location_text"), false);
      assert.equal(block.includes("customer_address_text"), false);
      assert.equal(block.includes(" like "), false);
      assert.equal(block.includes(" ilike "), false);
    },
  },
  {
    name: "basis excludes duration team preconfirm notes and pricing",
    run: () => {
      const source = readMigration();
      const snapshot = settingsSnapshotBlock(source);
      const block = technicalVisitBlock(source);

      for (const forbidden of [
        "duration_",
        "team_mode",
        "team_rule",
        "preconfirm_",
        "notes",
        "technical_visit_pricing",
        "deductible",
        "fixed_fee",
        "case_by_case",
      ]) {
        assert.equal(snapshot.includes(forbidden), false, `${forbidden} leaked into settings snapshot`);
        assert.equal(block.includes(forbidden), false, `${forbidden} leaked into technical_visit candidate`);
      }
    },
  },
  {
    name: "settings snapshot keeps full policy audit while technical_visit basis stays material",
    run: () => {
      const source = readMigration();
      const snapshot = settingsSnapshotBlock(source);
      const payload = requestPayloadBlock(source);
      const block = technicalVisitBlock(source);

      assert.equal(snapshot.includes("'required_situations'"), true);
      assert.equal(snapshot.includes("'required_other'"), true);
      assert.equal(snapshot.includes("'optional_situations'"), true);
      assert.equal(snapshot.includes("'optional_other'"), true);
      assert.equal(payload.includes("'settings_fingerprint', v_settings_fingerprint"), true);
      assert.equal(payload.includes("'items', v_items"), true);

      assert.equal(
        block.includes("'required_situations', to_jsonb(v_technical_visit_required_situations)"),
        false,
      );
      assert.equal(
        block.includes("'optional_situations', to_jsonb(v_technical_visit_optional_situations)"),
        false,
      );
      assert.equal(block.includes("'matched_required_situation'"), true);
      assert.equal(block.includes("'unresolved_required_situations'"), true);
      assert.equal(block.includes("'unresolved_optional_situations'"), true);
      assert.equal(block.includes("'negated_required_situations'"), true);
    },
  },
  {
    name: "technical_visit item basis excludes global profile policy and settings fingerprints",
    run: () => {
      const branch = technicalVisitBasisBranch(readMigration());

      assert.equal(branch.includes("'selected_candidates', v_item_record.entry -> 'candidates'"), true);
      assert.equal(branch.includes("'profile_version_id'"), false);
      assert.equal(branch.includes("'gate_policy_version_id'"), false);
      assert.equal(branch.includes("'settings_fingerprint'"), false);
    },
  },
  {
    name: "piscina_com_instalacao treats explicit installation exclusion as canonical negative evidence",
    run: () => {
      const block = technicalVisitBlock(readMigration());

      assert.equal(block.includes("v_installation_intent_state = 'excluded'"), true);
      assert.equal(block.includes("v_technical_visit_false_required_situations"), true);
      assert.equal(block.includes("technical_visit_required_conditions_explicitly_not_met"), true);
      assert.equal(block.includes("'negated_required_situations'"), true);
    },
  },
  {
    name: "a proven required condition is reduced before conflicting alternative required conditions",
    run: () => {
      const block = technicalVisitBlock(readMigration());
      const matchedReduction = block.indexOf(
        "array_length(v_technical_visit_matched_required_situations, 1)",
      );
      const conflictReduction = block.indexOf(
        "array_length(v_technical_visit_conflict_required_situations, 1)",
      );

      assert.equal(matchedReduction > -1, true);
      assert.equal(conflictReduction > matchedReduction, true);
      assert.equal(block.includes("Unknown/conflicting\n    -- alternative required conditions cannot erase"), true);
    },
  },
  {
    name: "region basis carries normalized coverage semantics only when region assessment is material",
    run: () => {
      const source = readMigration();
      const block = technicalVisitBlock(source);

      assert.equal(source.includes("v_service_region_modes_normalized"), true);
      assert.equal(block.includes("'state_code'"), true);
      assert.equal(block.includes("'service_regions'"), true);
      assert.equal(block.includes("'service_region_primary_mode'"), true);
      assert.equal(block.includes("'outside_consultation'"), true);
      assert.equal(block.includes("'service_region_notes'"), false);
      assert.equal(block.includes("when v_technical_visit_region_basis is null then '{}'::jsonb"), true);
    },
  },
  {
    name: "technical_visit candidate conditionally includes mirror evidence and region materiality",
    run: () => {
      const block = technicalVisitBlock(readMigration());

      assert.equal(block.includes("v_technical_visit_legacy_basis is null"), true);
      assert.equal(block.includes("v_technical_visit_evidence_basis = '{}'::jsonb"), true);
      assert.equal(block.includes("v_technical_visit_region_basis is null"), true);
      assert.equal(block.includes("'policy_inputs', v_technical_visit_policy_basis"), true);
    },
  },
  {
    name: "human carry-forward still uses item-scoped basis and existing merge helper",
    run: () => {
      const source = readMigration();

      assert.equal(source.includes("p9_opportunity_checklist_system_basis_fingerprint_internal"), true);
      assert.equal(source.includes("p9_opportunity_checklist_apply_human_override_internal"), true);
      assert.equal(source.includes("'selected_candidates', v_item_record.entry -> 'candidates'"), true);
      assert.equal(source.includes("_human_merge_action"), true);
      assert.equal(source.includes("human_carry_forward_count"), true);
      assert.equal(source.includes("human_revalidation_count"), true);
    },
  },
  {
    name: "convergence absorption and conflict revalidation remain preserved",
    run: () => {
      const source = readMigration();

      assert.equal(source.includes("human_absorbed_count"), true);
      assert.equal(source.includes("human_retired_count"), true);
      assert.equal(source.includes("revalidation_required"), true);
      assert.equal(source.includes("human_revalidation_count"), true);
    },
  },
  {
    name: "other checklist items still flow through generic Gate Policy and readiness/progress remain separate",
    run: () => {
      const source = readMigration();

      assert.equal(source.includes("from public.store_opportunity_gate_policy_rules rule_row"), true);
      assert.equal(source.includes("when 'component_and_execution' then"), true);
      assert.equal(source.includes("'definition_only', true"), true);
      assert.equal(source.includes("'readiness_progress_separate', true"), true);
      assert.equal(source.includes("materialize_commercial_opportunity_checklist_progress_by_system"), false);
      assert.equal(source.includes("p9_resolve_commercial_action_readiness_internal"), false);
    },
  },
  {
    name: "pricing policy is preserved as out of scope and no financial ledger is introduced",
    run: () => {
      const source = readMigration();

      assert.equal(source.includes("commercial_opportunity_payment_events"), false);
      assert.equal(source.includes("record_commercial_opportunity_payment"), false);
      assert.equal(source.includes("technical_visit_fee"), false);
      assert.equal(source.includes("abatimento"), false);
    },
  },
  {
    name: "behavioral runner keeps 32 rollback-only scenarios with canonical fixture shapes",
    run: () => {
      const runner = readRunner();

      assert.equal(runner.includes("expected 32 behavioral scenarios"), true);
      assert.equal(runner.includes("service_region_configured_at = null"), true);
      assert.equal(runner.includes("p_service_region_primary_mode => 'somente_cidade_loja'"), true);
      assert.equal(
        runner.includes("array['somente_cidade_loja', 'sob_consulta']::text[]"),
        true,
      );
      assert.equal(runner.includes("pool state must be partial or conflict"), true);
      assert.equal(runner.includes("p9_71_write_profile('resolved'"), false);
      assert.equal(
        runner.includes("{selected_candidates,0,legacy_mirror}"),
        true,
      );
      assert.equal(
        runner.includes("{selected_candidates,0,region_assessment}"),
        true,
      );
      assert.equal(runner.includes("v_result.changed is true"), true);
      assert.equal(runner.includes("scenario:29"), true);
      assert.equal(runner.includes("scenario:30"), true);
      assert.equal(runner.includes("scenario:31"), true);
      assert.equal(runner.includes("scenario:32"), true);
      assert.equal(runner.trimEnd().endsWith("rollback;"), true);
    },
  },
  {
    name: "materializer grants and ownership are preserved",
    run: () => {
      const source = readMigration();

      assert.equal(source.includes("security definer"), true);
      assert.equal(source.includes("set row_security = off"), true);
      assert.equal(source.includes("owner to postgres"), true);
      assert.equal(source.includes("revoke all on function public.materialize_commercial_opportunity_checklist_by_system"), true);
      assert.equal(source.includes("grant execute on function public.materialize_commercial_opportunity_checklist_by_system"), true);
      assert.equal(source.includes("to service_role"), true);
    },
  },
];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`p9 technical visit p19a applicability: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
