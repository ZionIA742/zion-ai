import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261126110000_p9_b11_fix_qualification_auth_role.sql",
  "utf8",
);
const diagnostic = readFileSync(
  "supabase/diagnostics/20261126110002_p9_b11_qualification_auth_context.sql",
  "utf8",
);

test("P9 B11 fixes the exact human qualification auth gates", () => {
  assert.equal(
    (migration.match(/v_request_role text := auth\.role\(\);/g) ?? []).length,
    4,
  );
  assert.match(migration, /or auth\.role\(\) is distinct from 'authenticated'/);
  assert.equal((migration.match(/request\.jwt\.claim\.role/g) ?? []).length, 0);
  assert.equal((migration.match(/auth\.uid\(\)/g) ?? []).length >= 3, true);
  assert.equal((migration.match(/security definer/g) ?? []).length, 6);
  assert.match(migration, /membership_row\.is_active is true/);
  assert.match(migration, /p_expected_last_event_id/);
  assert.match(migration, /IDEMPOTENCY_KEY_REUSED/);
  assert.match(migration, /record_human_qualification_decision_evidence_internal/);
  assert.match(migration, /record_human_stage_decision_evidence_internal/);
  assert.match(migration, /ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED/);
});

test("P9 B11 also fixes the related legacy human writer", () => {
  assert.match(migration, /create or replace function public\.write_commercial_opportunity_qualification_fact_by_user/);
  assert.match(migration, /v_request_role text := auth\.role\(\);/);
  assert.doesNotMatch(migration, /request\.jwt\.claim\.role/);
  assert.match(migration, /membership_row\.is_active is true/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /grant execute on function public\.write_commercial_opportunity_qualification_fact_by_user[\s\S]*to authenticated/);
  assert.match(migration, /p_operation_key[\s\S]*record_human_qualification_decision_evidence_internal/);
});

test("diagnostic observes modern claims without printing raw JWT claims", () => {
  assert.match(diagnostic, /auth\.role\(\)/);
  assert.match(diagnostic, /auth\.uid\(\)/);
  assert.match(diagnostic, /request\.jwt\.claims/);
  assert.doesNotMatch(diagnostic, /select\s+current_setting\('request\.jwt\.claims'/i);
  assert.match(diagnostic, /active_membership_for_auth_uid/);
  assert.match(diagnostic, /active_membership_for_expected_user/);
  assert.match(diagnostic, /rollback;/i);
});

test("migration does not alter unrelated system authorities", () => {
  assert.doesNotMatch(migration, /lead_customer_link_request_role/);
  assert.doesNotMatch(migration, /materialize_sales_ai_reply_set/);
});
