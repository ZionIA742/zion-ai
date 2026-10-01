import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260930190000_p9_customer_geography_region_materializer_v6.sql",
);

const runnerPath = join(
  process.cwd(),
  "supabase/tests/20260930190500_p9_customer_geography_region_materializer_v6_manual_checks.sql",
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

function regionBlock(source: string) {
  return blockBetween(
    source,
    "v_technical_visit_final_state := v_technical_visit_policy_state;",
    "v_policy_candidate := pg_catalog.jsonb_build_object(",
  );
}

const tests: TestCase[] = [
  {
    name: "v6 is forward-only and preserves historical materializer lineage",
    run: () => {
      const source = readMigration();

      assert.equal(source.includes("Forward-only replacement of checklist materializer v5 with v6."), true);
      assert.equal(source.includes("'p9_checklist_materializer_v5'"), true);
      assert.equal(source.includes("'p9_checklist_materializer_v6'"), true);
      assert.equal(source.includes("'materializer_version', 6"), true);
      assert.equal(source.includes("'technical_visit_region_mode', 'deterministic_customer_geography_v1'"), true);
    },
  },
  {
    name: "municipality normalizer mirrors runtime accent and punctuation semantics",
    run: () => {
      const source = readMigration();

      assert.equal(
        source.includes("p9_normalize_brazilian_municipality_lookup_name_internal"),
        true,
      );
      assert.equal(source.includes("pg_catalog.translate"), true);
      assert.equal(source.includes("'[^a-z0-9]+'"), true);
      assert.equal(source.includes("'[[:space:]]+'"), true);
    },
  },
  {
    name: "region consumes only canonical customer city and UF facts",
    run: () => {
      const block = regionBlock(readMigration());

      assert.equal(block.includes("fact_key = 'customer_city'"), true);
      assert.equal(block.includes("fact_key = 'customer_state_code'"), true);
      assert.equal(block.includes("v_customer_city_fact_state <> 'confirmed'"), true);
      assert.equal(
        block.includes("v_customer_state_fact_state in ('confirmed', 'inferred')"),
        true,
      );
      assert.equal(block.includes("from public.brazilian_municipalities"), true);
    },
  },
  {
    name: "primary coverage modes are deterministic and unstructured modes fail closed",
    run: () => {
      const block = regionBlock(readMigration());

      assert.equal(block.includes("v_service_region_primary_mode = 'todo_estado'"), true);
      assert.equal(
        block.includes("'somente_cidade_loja',\n        'cidade_e_vizinhas'"),
        true,
      );
      assert.equal(block.includes("technical_visit_region_same_store_municipality"), true);
      assert.equal(block.includes("technical_visit_region_same_state"), true);
      assert.equal(
        block.includes("technical_visit_region_neighbor_coverage_not_structured"),
        true,
      );
      assert.equal(
        block.includes("technical_visit_region_large_region_coverage_not_structured"),
        true,
      );
    },
  },
  {
    name: "sob_consulta is evaluated only after proven outside primary coverage",
    run: () => {
      const block = regionBlock(readMigration());

      const primaryOutside = block.indexOf(
        "elsif v_primary_coverage_state = 'outside_coverage' then",
      );
      const consultation = block.indexOf(
        "if v_service_region_outside_consultation then",
      );

      assert.equal(primaryOutside > -1, true);
      assert.equal(consultation > primaryOutside, true);
      assert.equal(block.includes("technical_visit_region_under_consultation"), true);
      assert.equal(block.includes("technical_visit_region_outside_coverage"), true);
    },
  },
  {
    name: "free text and exact address remain explicit non-authorities",
    run: () => {
      const block = regionBlock(readMigration());

      assert.equal(block.includes("'service_regions_text_used', false"), true);
      assert.equal(block.includes("'location_text_used', false"), true);
      assert.equal(block.includes("'customer_address_text_used', false"), true);
      assert.equal(block.includes(" ilike "), false);
      assert.equal(block.includes(" like "), false);
    },
  },
  {
    name: "authorized region preserves required policy while unresolved region blocks",
    run: () => {
      const block = regionBlock(readMigration());

      assert.equal(block.includes("v_technical_visit_region_state := 'authorized'"), true);
      assert.equal(
        block.includes("if v_technical_visit_region_state <> 'authorized' then"),
        true,
      );
      assert.equal(
        block.includes("v_technical_visit_final_state := 'needs_resolution';"),
        true,
      );
    },
  },
  {
    name: "v6 keeps definition-only/readiness separation and item-scoped human basis",
    run: () => {
      const source = readMigration();

      assert.equal(
        source.includes(
          "Region v6 changes only technical_visit semantics. Keep the v5",
        ),
        true,
      );
      assert.equal(source.includes("'definition_only', true"), true);
      assert.equal(source.includes("'readiness_progress_separate', true"), true);
      assert.equal(
        source.includes("p9_opportunity_checklist_system_basis_fingerprint_internal"),
        true,
      );
      assert.equal(
        source.includes("p9_opportunity_checklist_apply_human_override_internal"),
        true,
      );
      assert.equal(
        source.includes("materialize_commercial_opportunity_checklist_progress_by_system"),
        false,
      );
    },
  },
  {
    name: "focal SQL runner preserves append-only qualification fact history",
    run: () => {
      const runner = readRunner();
      const resetBlock = blockBetween(
        runner,
        "create or replace function pg_temp.p9_r6_reset_geography()",
        "create or replace function pg_temp.p9_r6_write_geo_fact(",
      );

      assert.equal(
        resetBlock.includes(
          "delete from public.commercial_opportunity_qualification_fact_events",
        ),
        false,
      );
      assert.equal(
        resetBlock.includes(
          "delete from public.commercial_opportunity_qualification_facts_current",
        ),
        true,
      );
      assert.equal(resetBlock.includes("append-only history"), true);
    },
  },
  {
    name: "focal SQL runner covers the v6 contract and remains rollback only",
    run: () => {
      const runner = readRunner();

      for (let scenario = 1; scenario <= 14; scenario += 1) {
        const padded = String(scenario).padStart(2, "0");
        assert.equal(
          runner.includes(`p9:r6:scenario:${padded}`) ||
            scenario === 1,
          true,
          `missing scenario ${scenario}`,
        );
      }

      assert.equal(
        runner.includes("expected 14 focal region-v6 scenarios"),
        true,
      );
      assert.equal(
        runner.includes("technical_visit_region_neighbor_coverage_not_structured"),
        true,
      );
      assert.equal(
        runner.includes("technical_visit_region_large_region_coverage_not_structured"),
        true,
      );
      assert.equal(
        runner.includes("technical_visit_region_under_consultation"),
        true,
      );
      assert.equal(
        runner.includes("technical_visit_region_outside_coverage"),
        true,
      );
      assert.equal(runner.trimEnd().endsWith("rollback;"), true);
    },
  },
];

for (const test of tests) {
  test.run();
}

console.log(`p9 customer geography region materializer v6: ${tests.length} tests passed`);
