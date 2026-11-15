import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20261114200000_p9_10_5_d2_human_qualification_evidence.sql",
  "utf8",
);

test("D.2 extends the D.1 ledger only with scoped qualification sources", () => {
  assert.match(migration, /drop constraint p9_human_evidence_source_fk/);
  assert.match(migration, /commercial_opportunity_qualification_fact_event/);
  assert.match(migration, /decision_domain = 'commercial_facts'/);
  assert.match(migration, /p_fact_key/);
  assert.match(migration, /p_canonical_value_json/);
});

test("D.2 requires canonical authenticated human qualification evidence", () => {
  assert.match(migration, /v_user_id is null or v_user_id is distinct from p_actor_user_id/);
  assert.match(migration, /event_row\.source_type = 'crm_manual'/);
  assert.match(migration, /event_row\.assertion_level = 'confirmed'/);
  assert.match(migration, /event_row\.created_by = 'user:' \|\| p_actor_user_id::text/);
  assert.match(migration, /event_row\.value_json is not distinct from p_canonical_value_json/);
  assert.match(migration, /event_row\.operation_key = p_operation_key/);
});

test("D.2 preserves the primary fact write and isolates only auxiliary ledger failures", () => {
  const factWrite = migration.indexOf("from public.apply_commercial_opportunity_qualification_fact_internal(");
  const evidenceWrite = migration.indexOf("perform public.record_human_qualification_decision_evidence_internal(");
  assert.ok(factWrite >= 0);
  assert.ok(evidenceWrite > factWrite);
  assert.match(migration, /exception when others then/);
  assert.match(migration, /get stacked diagnostics v_ledger_sqlstate = returned_sqlstate/);
  assert.match(migration, /'42501'/);
  assert.match(migration, /'23505'/);
  assert.doesNotMatch(migration, /'P0001'/);
});

test("D.2 keeps replay idempotent and does not authorize external effects", () => {
  assert.match(migration, /where evidence_row\.organization_id = p_organization_id\n    and evidence_row\.operation_key = p_operation_key/);
  assert.match(migration, /ZION_HUMAN_EVIDENCE_IDEMPOTENCY_KEY_REUSED/);
  assert.match(migration, /v_result\.event_id, v_result\.fact_key, p_value_json/);
  assert.doesNotMatch(migration, /whatsapp|sender|generate|ai_run_queue/i);
});
