import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261114220000_p9_10_5_d3_a2_human_common_appointment_authority.sql",
  ),
  "utf8",
);

const functionBlock = migration.slice(
  migration.indexOf("create or replace function public.create_common_appointment_by_user"),
);

test("D.3-A.2 exige identidade autenticada e membership ativa", () => {
  assert.match(functionBlock, /auth\.uid\(\)/);
  assert.match(functionBlock, /v_request_role is distinct from 'authenticated'/);
  assert.match(functionBlock, /membership_row\.is_active is true/);
  assert.doesNotMatch(functionBlock, /p_created_by_user_id/);
  assert.doesNotMatch(functionBlock, /grant execute[\s\S]*to service_role/);
});

test("D.3-A.2 valida tenant, loja, lead, conversa e oportunidade", () => {
  assert.match(functionBlock, /store_row\.organization_id = p_organization_id/);
  assert.match(functionBlock, /lead_row\.store_id = p_store_id/);
  assert.match(functionBlock, /conversation_row\.organization_id = p_organization_id/);
  assert.match(functionBlock, /opportunity_row\.store_id = p_store_id/);
  assert.match(functionBlock, /primary_conversation_id is null/);
  assert.match(functionBlock, /lead_row\.id is not null/);
  assert.match(functionBlock, /conversation_row\.lead_id = p_lead_id/);
  assert.match(functionBlock, /origin_lead_id is null or opportunity_row\.origin_lead_id = p_lead_id/);
});

test("D.3-A.2 não permite technical_visit nem duplica o writer comum", () => {
  assert.match(functionBlock, /p_appointment_type = 'technical_visit'/);
  assert.match(functionBlock, /create_store_appointment_with_commercial_context\(/);
  assert.doesNotMatch(migration, /create or replace function public\.create_store_appointment\(/);
  assert.doesNotMatch(migration, /create or replace function public\.create_assistant_appointment_by_task_atomic/);
});

test("D.3-A.2 usa operation_key durável e rejeita replay divergente", () => {
  assert.match(migration, /unique \(organization_id, operation_key\)/);
  assert.match(functionBlock, /on conflict \(organization_id, operation_key\) do nothing/);
  assert.match(functionBlock, /request_fingerprint is distinct from v_fingerprint/);
  assert.match(functionBlock, /ZION_HUMAN_COMMON_APPOINTMENT_OPERATION_KEY_REUSED/);
  assert.match(functionBlock, /operation_row\.appointment_id is null/);
});

test("D.3-A.2 registra proveniência append-only vinculada ao appointment", () => {
  assert.match(migration, /source_type text not null default 'panel_human'/);
  assert.match(migration, /source_version integer not null default 1/);
  assert.match(migration, /appointment_id, organization_id, store_id/);
  assert.match(migration, /foreign key \(appointment_id, organization_id, store_id\)/);
  assert.match(functionBlock, /set appointment_id = v_appointment\.id/);
  assert.match(functionBlock, /p_notes, 'panel', v_user_id, p_commercial_opportunity_id/);
});

test("D.3-A.2 falha fechado para ator declarativo, cross-tenant e operação divergente", () => {
  assert.match(functionBlock, /v_user_id uuid := auth\.uid\(\)/);
  assert.doesNotMatch(functionBlock, /actor_user_id\s*=\s*p_/);
  assert.match(functionBlock, /ZION_HUMAN_COMMON_APPOINTMENT_STORE_SCOPE_NOT_FOUND/);
  assert.match(functionBlock, /ZION_HUMAN_COMMON_APPOINTMENT_LEAD_SCOPE_NOT_FOUND/);
  assert.match(functionBlock, /ZION_HUMAN_COMMON_APPOINTMENT_CONVERSATION_SCOPE_NOT_FOUND/);
  assert.match(functionBlock, /ZION_HUMAN_COMMON_APPOINTMENT_OPPORTUNITY_SCOPE_NOT_FOUND/);
  assert.match(functionBlock, /ZION_HUMAN_COMMON_APPOINTMENT_OPERATION_KEY_REUSED/);
});

process.stdout.write("p9-10-5-d3-a2-human-common-appointment-authority: contract tests passed\n");
