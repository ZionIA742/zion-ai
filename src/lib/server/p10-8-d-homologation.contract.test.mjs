import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const runner = fs.readFileSync("supabase/homologation/20261124210000_p10_8_d_audio_retention_integrated_runner.sql", "utf8");
const diagnostic = fs.readFileSync("supabase/diagnostics/20261124210000_p10_8_d_audio_retention_readonly.sql", "utf8");
const composer = fs.readFileSync("scripts/prepare-p10-8-d-audio-retention-homologation.mjs", "utf8");
const eligibilityMigration = fs.readFileSync("supabase/migrations/20261124190000_p10_8_b_audio_retention_eligibility.sql", "utf8");
const executorMigration = fs.readFileSync("supabase/migrations/20261124200000_p10_8_c_audio_retention_executor.sql", "utf8");

test("integrated runner contains both migrations and controlled rollback", () => {
  assert.match(composer, /20261124190000_p10_8_b_audio_retention_eligibility\.sql/);
  assert.match(composer, /20261124200000_p10_8_c_audio_retention_executor\.sql/);
  assert.match(runner, /set lock_timeout = '5s'/);
  assert.match(runner, /set statement_timeout = '30s'/);
  assert.match(runner, /do \$runner\$/);
  assert.match(runner, /P10_8_D_INTENTIONAL_ROLLBACK/);
  assert.match(runner, /P10D1/);
  assert.doesNotMatch(runner, /pg_input_is_valid\([^)]*::regtype/);
  assert.match(runner, /create temp table p10_8_d_results/);
  assert.match(runner, /select test_name, verdict, details/);
  assert.match(eligibilityMigration, /v_status is null or v_status not in/);
  assert.match(executorMigration, /v_outcome is null or v_outcome not in/);
  assert.match(executorMigration, /attachment_kind.*=.*'audio'/);
  assert.match(executorMigration, /not exists\s*\(\s*select 1[\s\S]*shared\.id <> m\.id/);
});

test("runner tests the retention boundary and never calls real storage", () => {
  assert.match(runner, /interval '24 hours'/);
  assert.match(runner, /invalid-timestamp/);
  assert.match(runner, /null::text/);
  assert.match(runner, /''::text/);
  assert.match(runner, /storage_simulated_failure/);
  assert.match(runner, /completed_no_relevant_facts/);
  assert.match(runner, /claim atomico/);
  assert.match(runner, /v_shared_message/);
  assert.match(runner, /objeto compartilhado foi aceito pelo claim/);
  assert.doesNotMatch(runner, /\.storage\./i);
  assert.doesNotMatch(runner, /\.remove\s*\(/i);
});

test("diagnostic is read-only and visible as result tables", () => {
  assert.match(diagnostic, /select[\s\S]*p10_8_d_objects/);
  assert.match(diagnostic, /p10_8_d_function_security/);
  assert.match(diagnostic, /p10_8_d_existing_audio_inventory/);
  assert.match(diagnostic, /p10_8_d_grants/);
  assert.match(diagnostic, /pg_input_is_valid\(input_value, 'timestamptz'\)/);
  assert.doesNotMatch(diagnostic, /pg_input_is_valid\([^)]*::regtype/);
  assert.doesNotMatch(diagnostic, /insert\s+into|update\s+|delete\s+from|create\s+|drop\s+/i);
});
