import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261114210000_p9_10_5_d3_a_human_technical_visit_authority.sql",
  "utf8",
);

test("D.3-A extracts readiness without changing the system signature or grant", () => {
  assert.match(migration, /create or replace function public\.p9_prepare_technical_visit_readiness_internal/);
  assert.match(migration, /create or replace function public\.create_technical_visit_with_fresh_commercial_readiness_by_system/);
  assert.match(migration, /grant execute on function public\.create_technical_visit_with_fresh_commercial_readiness_by_system\([\s\S]*?\) to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.p9_prepare_technical_visit_readiness_internal[\s\S]*?to authenticated/);
});

test("D.3-A human authority uses auth.uid and active membership, not declarative actor metadata", () => {
  const block = migration.slice(migration.indexOf("create or replace function public.create_technical_visit_by_user"));
  assert.match(block, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(block, /v_request_role is distinct from 'authenticated'/);
  assert.match(block, /membership_row\.user_id = v_user_id/);
  assert.match(block, /membership_row\.is_active is true/);
  assert.doesNotMatch(block, /p_created_by_user_id/);
  assert.match(block, /'panel', v_user_id/);
});

test("D.3-A reserves operation before writing and binds the result to one appointment", () => {
  const block = migration.slice(migration.indexOf("create or replace function public.create_technical_visit_by_user"));
  assert.match(block, /p_operation_key text/);
  assert.match(migration, /unique \(organization_id, operation_key\)/);
  assert.match(block, /on conflict \(organization_id, operation_key\) do nothing/);
  assert.match(block, /for update/);
  assert.match(block, /update public\.p9_human_technical_visit_operations/);
  assert.match(block, /appointment_id = v_row\.id/);
});

test("D.3-A fingerprint uses SHA-256 hex and the same canonical value for replay", () => {
  const block = migration.slice(migration.indexOf("create or replace function public.create_technical_visit_by_user"));
  assert.match(migration, /request_fingerprint text not null/);
  assert.match(migration, /check \(length\(pg_catalog\.btrim\(request_fingerprint\)\) = 64\)/);
  assert.match(block, /v_fingerprint := pg_catalog\.encode\(/);
  assert.match(block, /extensions\.digest\(/);
  assert.match(block, /pg_catalog\.convert_to\(/);
  assert.match(block, /'sha256'/);
  assert.match(block, /'hex'/);
  assert.doesNotMatch(block, /pg_catalog\.md5\(/);
  assert.match(block, /request_fingerprint, commercial_opportunity_id/);
  assert.match(block, /v_operation\.request_fingerprint is distinct from v_fingerprint/);
  assert.match(block, /on conflict \(organization_id, operation_key\) do nothing/);
});

test("D.3-A keeps readiness, tenant and opportunity checks in the shared helper", () => {
  const helper = migration.slice(migration.indexOf("create or replace function public.p9_prepare_technical_visit_readiness_internal"));
  assert.match(helper, /opportunity_row\.organization_id = p_organization_id/);
  assert.match(helper, /opportunity_row\.store_id = p_store_id/);
  assert.match(helper, /ZION_TECHNICAL_VISIT_BOUNDARY_LEAD_MISMATCH/);
  assert.match(helper, /ZION_TECHNICAL_VISIT_BOUNDARY_CONVERSATION_MISMATCH/);
  assert.match(helper, /materialize_commercial_opportunity_checklist_by_system/);
  assert.match(helper, /read_commercial_action_readiness_scoped/);
  assert.match(helper, /check_store_appointment_availability_by_system/);
});

test("D.3-A does not touch generic appointment, assistant or evidence authorities", () => {
  assert.doesNotMatch(migration, /create or replace function public\.create_store_appointment\(/);
  assert.doesNotMatch(migration, /create or replace function public\.create_assistant_appointment_by_task_atomic/);
  assert.doesNotMatch(migration, /commercial_human_decision_evidence/);
});

process.stdout.write("p9-10-5-d3-a-human-technical-visit-authority: contract tests passed\n");
