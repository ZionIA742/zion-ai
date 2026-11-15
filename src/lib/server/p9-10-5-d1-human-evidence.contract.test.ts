import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20261114190000_p9_10_5_d1_human_decision_evidence.sql",
  "utf8",
);

test("D.1 ledger is scoped, append-only by authority and idempotent", () => {
  assert.match(migration, /create table public\.commercial_human_decision_evidence/);
  assert.match(migration, /foreign key \(store_id, organization_id\)/);
  assert.match(migration, /foreign key \(conversation_id, organization_id\)/);
  assert.match(migration, /foreign key \(commercial_opportunity_id, organization_id, store_id\)/);
  assert.match(migration, /foreign key \(actor_user_id\) references auth\.users/);
  assert.match(migration, /foreign key \(source_id\) references public\.commercial_opportunity_lifecycle_events/);
  assert.match(migration, /unique \(organization_id, operation_key\)/);
  assert.match(migration, /unique \(source_id, decision_domain, decision_field\)/);
  assert.match(migration, /revoke all on table public\.commercial_human_decision_evidence from public, anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /grant (insert|update|delete).*commercial_human_decision_evidence/);
});

test("D.1 evidence requires authenticated actor and canonical lifecycle source", () => {
  assert.match(migration, /v_user_id is null or v_user_id is distinct from p_actor_user_id/);
  assert.match(migration, /lifecycle_event\.actor_type = 'human'/);
  assert.match(migration, /lifecycle_event\.actor_user_id = p_actor_user_id/);
  assert.match(migration, /lifecycle_event\.event_type = 'stage_transition'/);
  assert.match(migration, /p_canonical_value_json is distinct from to_jsonb\(v_event\.new_stage\)/);
});

test("D.1 writer records evidence after the canonical stage writer in one SQL function", () => {
  const internalCall = migration.indexOf("from public.apply_commercial_opportunity_stage_transition_internal(");
  const evidenceCall = migration.indexOf("perform public.record_human_stage_decision_evidence_internal(");
  assert.ok(internalCall >= 0);
  assert.ok(evidenceCall > internalCall);
  assert.match(migration, /ZION_HUMAN_EVIDENCE_IDEMPOTENCY_KEY_REUSED/);
  assert.match(migration, /return query select v_transition\.commercial_opportunity_id/);
});

test("D.1 ledger failure cannot roll back a legitimate human CRM transition", () => {
  const transitionCall = migration.indexOf("from public.apply_commercial_opportunity_stage_transition_internal(");
  const evidenceCall = migration.indexOf("perform public.record_human_stage_decision_evidence_internal(");
  const isolatedEvidenceFailure = migration.indexOf("exception when others then");
  assert.ok(transitionCall >= 0);
  assert.ok(evidenceCall > transitionCall);
  assert.ok(isolatedEvidenceFailure > evidenceCall);
  assert.match(migration, /an auxiliary ledger failure must not roll back that legitimate action/);
  assert.match(migration, /get stacked diagnostics v_ledger_sqlstate = returned_sqlstate/);
  assert.match(migration, /'42501'/);
  assert.doesNotMatch(migration, /'P0001'/);
  assert.match(migration, /if v_ledger_sqlstate in \(/);
  assert.match(migration, /end;\n  end if;\n\n  return query select v_transition/);
});

test("D.1 does not classify generic P0001 as an auxiliary ledger blocker", () => {
  const exceptionStart = migration.indexOf("exception when others then");
  const exceptionEnd = migration.indexOf("-- A canonical CRM transition is a primary human action.", exceptionStart);
  assert.ok(exceptionStart >= 0);
  assert.ok(exceptionEnd > exceptionStart);
  const auxiliaryClassification = migration.slice(exceptionStart, exceptionEnd);
  assert.doesNotMatch(auxiliaryClassification, /'P0001'/);
  assert.match(auxiliaryClassification, /'42501'/);
  assert.match(auxiliaryClassification, /'23514'/);
  assert.match(auxiliaryClassification, /'23505'/);
});

test("D.1 does not authorize automatic effects", () => {
  assert.doesNotMatch(migration, /whatsapp|sender|generate|ai_run_queue/i);
});
