import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const runner = readFileSync(join(root, "supabase/tests/20261123160000_p9_10_7_a0_3_controlled_functional_runner.sql"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/20261123160000_p9_10_7_a0_human_response_commitments.sql"), "utf8");

test("runner is a single controlled rollback flow", () => {
  assert.match(runner, /DO \$runner\$[\s\S]*\bBEGIN\b/i);
  assert.match(runner, /P9_10_7_A0_3_INTENTIONAL_ROLLBACK/);
  assert.match(runner, /9-post-rollback/);
  assert.match(runner, /ÚNICA tabela de resultado, emitida DEPOIS da reversão/i);
  assert.match(runner, /\$runner\$;[\s\S]*select test_name, verdict, details/i);
  assert.match(runner, /not exists \(\s*select 1\s*from public\.conversation_human_response_commitments/i);
  assert.match(runner, /v_rollback_confirmed boolean := false/);
  assert.match(runner, /v_persisted = 0/);
  assert.doesNotMatch(runner, /currval\(/i);
});

test("runner uses only real eligible fixtures and blocks when unavailable", () => {
  assert.match(runner, /from public\.messages m/i);
  assert.match(runner, /join public\.conversations c/i);
  assert.match(runner, /public\.memberships/);
  assert.match(runner, /m\.sender = 'human'/i);
  assert.match(runner, /m\.direction = 'outgoing'/i);
  assert.match(runner, /sem mensagem humana elegível; nenhum dado de teste criado/);
  assert.doesNotMatch(runner, /insert into public\.|create table public\.|insert into auth\./i);
});

test("runner covers explicit confirmation, idempotency, amendment, cancel, reader, provenance and isolation", () => {
  for (const marker of [
    "1-explicit-registration", "2-idempotency", "3-deadline-amendment",
    "4-cancellation", "5-canonical-reader", "6-false-provenance", "7-cross-scope-isolation",
  ]) assert.match(runner, new RegExp(marker));
  assert.match(runner, /record_human_response_commitment_by_system/);
  assert.match(runner, /transition_human_response_commitment_by_system/);
  assert.match(runner, /read_human_response_commitments_by_system/);
  assert.match(runner, /set_config\('request\.jwt\.claim\.role', 'service_role'/i);
  assert.doesNotMatch(runner, /current_setting\(|currval\(/i);
  assert.ok(runner.indexOf("if not found then") < runner.indexOf("v_completed <> 8"));
  assert.match(runner, /is distinct from/i);
  assert.match(runner, /v_repeated_id IS DISTINCT FROM v_commitment_id/i);
});

test("runner checks installed signatures and canonical migration contract", () => {
  assert.match(runner, /to_regprocedure\('public\.record_human_response_commitment_by_system/);
  assert.match(runner, /information_schema\.columns/);
  assert.match(runner, /18 colunas e tr[eê]s RPCs presentes/i);
  assert.match(migration, /human_response_commitment_explicit_confirmation_required/);
  assert.match(migration, /conversation_human_response_commitments_one_active_uidx/);
  assert.match(migration, /foreign key \(conversation_id, organization_id\)/);
});

test("runner does not install or modify production objects", () => {
  assert.doesNotMatch(runner, /create (or replace )?function public\./i);
  assert.doesNotMatch(runner, /create table public\./i);
  assert.doesNotMatch(runner, /alter table public\./i);
  assert.doesNotMatch(runner, /grant |revoke |drop table public\./i);
  assert.doesNotMatch(runner, /fetch\(|supabase\.rpc|curl|psql/i);
});
