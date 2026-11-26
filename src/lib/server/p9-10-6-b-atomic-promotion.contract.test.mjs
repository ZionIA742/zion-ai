import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261126180000_p9_b11_atomic_commercial_memory_promotion.sql",
  "utf8",
);
const promotion = readFileSync(
  "src/lib/server/promote-commercial-memory-to-opportunity.ts",
  "utf8",
);

const authorityStart = migration.indexOf(
  "create or replace function public.promote_commercial_memory_fact_if_absent_by_system(",
);
const authority = migration.slice(authorityStart);

test("atomic promotion is service-only and uses the canonical fact lock", () => {
  assert.ok(authorityStart >= 0);
  assert.match(authority, /public\.lead_customer_link_request_role\(\)/);
  assert.match(authority, /pg_advisory_xact_lock\(/);
  assert.match(authority, /zion:p9:qfact:/);
  assert.match(authority, /grant execute on function public\.promote_commercial_memory_fact_if_absent_by_system[\s\S]*to service_role/);
  assert.doesNotMatch(authority, /grant execute[\s\S]*to authenticated/);
  assert.doesNotMatch(authority, /grant execute[\s\S]*to anon/);
  assert.match(authority, /v_fact_key text := nullif\(pg_catalog\.btrim\(coalesce\(p_fact_key, ''\)\), ''\)/);
  assert.match(authority, /v_fact_key[\s\S]*zion:p9:qfact:/);
});

test("empty, replay, human and conflict states return explicit ignored outcomes before writing", () => {
  assert.match(authority, /from public\.commercial_opportunity_qualification_facts_current[\s\S]*for update/);
  assert.match(authority, /ignored_existing_current/);
  assert.match(authority, /from public\.commercial_opportunity_qualification_fact_events[\s\S]*v_fact_key/);
  assert.match(authority, /ignored_existing_event/);
  assert.ok(authority.indexOf("ignored_existing_event") < authority.indexOf("write_commercial_opportunity_qualification_fact_by_system"));
  assert.ok(authority.indexOf("ignored_existing_current") < authority.indexOf("write_commercial_opportunity_qualification_fact_by_system"));
  assert.match(promotion, /promote_commercial_memory_fact_if_absent_by_system/);
  assert.match(promotion, /ignored_existing_current/);
  assert.match(promotion, /ignored_existing_event/);
  assert.match(migration, /P9_B11_CONFIRMED_TARGET_PROSRC_EQUIVALENCE_FAILED/);
  assert.match(migration, /regexp_replace\(p\.prosrc/);
  assert.doesNotMatch(migration, /do \$rebuild\$/);
  assert.doesNotMatch(migration, /execute v_internal/);
  assert.doesNotMatch(migration, /execute v_system/);
});

test("promotion preserves provenance, tenant scope, idempotency and recovery authority", () => {
  for (const marker of [
    "p_organization_id",
    "p_store_id",
    "p_commercial_opportunity_id",
    "p_operation_key",
    "p_source_message_id",
    "p_source_conversation_id",
    "p_response_set_id",
    "p_claim_token",
    "p_recovery_conversation_id",
    "p_recovery_lead_id",
  ]) {
    assert.match(authority, new RegExp(marker));
  }
  assert.match(authority, /p_source_type not in \('incoming_customer_message', 'human_message'\)/);
  assert.match(authority, /p_assertion_level is distinct from 'confirmed'/);
  assert.match(authority, /p_resolves_conflict is true/);
  assert.match(authority, /p9_10_4_d_assert_recovery_set_claim_authority/);
  assert.match(authority, /P9_B11_ATOMIC_PROMOTION_DELEGATED_RESULT_INVALID/);
});

test("promotion-first does not replace the human writer", () => {
  assert.match(authority, /write_commercial_opportunity_qualification_fact_by_system/);
  assert.doesNotMatch(authority, /write_commercial_qualification_fact_by_user_if_current/);
  assert.match(promotion, /p_source_type: sourceType/);
});

console.log("PASS P9 B11 atomic commercial-memory promotion contract");
