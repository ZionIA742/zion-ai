import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20261104150000_p19a_4_5_4_reactive_opt_out_gate.sql",
  "utf8",
);

test("P19-A 4.5.4 usa definição instalada e aborta diante de drift", () => {
  assert.match(migration, /pg_get_functiondef\(p\.oid\)/);
  assert.match(migration, /P19A_4_5_4_INSTALLED_FUNCTION_DRIFT/);
  assert.match(migration, /P19A_4_5_4_UNEXPECTED_REACTIVE_FRAGMENT_COUNT/);
  assert.match(migration, /P19A_4_5_4_SECURITY_ATTRIBUTES_CHANGED/);
  assert.match(migration, /P19A_4_5_4_POSTCHECK_FAILED/);
});

test("P19-A 4.5.4 remove apenas o bloque reativo e preserva as autoridades", () => {
  assert.match(migration, /v_outbound_kind = 'stop_contact_ack'/);
  assert.match(migration, /stop_contact_ack_without_exact_opt_out_source/);
  assert.match(migration, /v_outbound_kind = ''canonical_followup''/);
  assert.match(migration, /v_block_reason := ''commercial_opportunity_opted_out'';/);
  assert.match(migration, /v_before\.proowner IS DISTINCT FROM v_after\.proowner/);
  assert.match(migration, /v_before\.proacl IS DISTINCT FROM v_after\.proacl/);
  assert.match(migration, /v_before\.proconfig IS DISTINCT FROM v_after\.proconfig/);
  assert.match(migration, /v_before\.prosecdef IS DISTINCT FROM v_after\.prosecdef/);
});

console.log("p19a-4-5-4-opt-out-gate: PASS");
