import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const diagnostic = readFileSync(
  "supabase/diagnostics/20261124180000_p10_7_a1_4c_whatsapp_dedup_readonly.sql",
  "utf8",
);
const runner = readFileSync(
  "supabase/tests/20261124181000_p10_7_a1_4c_atomic_dedup_homologation_runner.sql",
  "utf8",
);
const diagnosticSql = diagnostic.replace(/--[^\r\n]*/g, "");

test("A1.4c diagnostic is read-only and returns visible result tables", () => {
  assert.doesNotMatch(diagnosticSql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|NOTICE)\b/i);
  assert.match(diagnostic, /SELECT[\s\S]*a1_4b_historical_duplicates/);
  assert.match(diagnostic, /a1_4b_index_compatibility/);
  assert.match(diagnostic, /a1_4b_trigger_compatibility/);
});

test("A1.4c runner separates rollback from real two-session concurrency", () => {
  assert.match(runner, /P10_7_A1_4C_INTENTIONAL_ROLLBACK/);
  assert.match(runner, /rollback_single_session/);
  assert.match(runner, /concurrency_two_sessions/);
  assert.match(runner, /duas sessoes distintas/i);
  assert.match(runner, /MANUAL_REQUIRED/);
  assert.match(runner, /SELECT test_name, verdict, details/);
});
