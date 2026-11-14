import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20261115010000_p9_10_5_b_contextual_reconstruction_request.sql",
  "utf8",
);

test("10.5-B uses a durable queue isolated from ai_run_queue", () => {
  assert.match(migration, /create table if not exists public\.p9_contextual_reconstruction_requests/);
  assert.match(migration, /unique \(organization_id, store_id, conversation_id, takeover_version\)/);
  assert.doesNotMatch(migration, /insert into public\.ai_run_queue/);
});

test("manual and automatic release paths enqueue inside the SQL transaction", () => {
  assert.match(migration, /release_human_takeover_lease_by_system[\s\S]*p9_10_5_b_enqueue_contextual_reconstruction_request/);
  assert.match(migration, /panel_release_conversation_to_ai_scoped[\s\S]*p9_10_5_b_enqueue_contextual_reconstruction_request/);
});

test("claim is tenant-scoped, serialized and fail-closed for takeover or hard hold", () => {
  assert.match(migration, /request_row\.organization_id = p_organization_id/);
  assert.match(migration, /request_row\.store_id = p_store_id/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /v_lease\.hard_hold is true/);
  assert.match(migration, /v_conversation\.status = 'humano_assumiu'/);
  assert.match(migration, /coalesce\(v_conversation\.is_human_active, false\)/);
  assert.match(migration, /P9_10_5_B_CONTEXT_NO_LONGER_CURRENT/);
});

test("incremental correction keeps release origin canonical and removes direct table write authority", () => {
  const correction = fs.readFileSync("supabase/migrations/20261115020000_p9_10_5_abc_provenance_and_queue_scope.sql", "utf8");
  assert.match(correction, /add column if not exists release_origin/);
  assert.match(correction, /source = 'hybrid_human_timeout_auto_release'/);
  assert.match(correction, /else null/);
  assert.match(correction, /where organization_id = p_organization_id\s+and store_id = p_store_id\s+and status = 'claimed'/);
  assert.match(correction, /revoke all on table public\.p9_contextual_reconstruction_requests from service_role/);
  assert.match(correction, /grant select on table public\.p9_contextual_reconstruction_requests to service_role/);
  assert.doesNotMatch(correction, /release_event_key\.includes/);
});

test("replay, expiry, retry and terminal states are explicit", () => {
  assert.match(migration, /on conflict \(organization_id, store_id, conversation_id, takeover_version\)/);
  assert.match(migration, /claim_expires_at <= pg_catalog\.clock_timestamp\(\)/);
  assert.match(migration, /attempt_count >= p_max_attempts/);
  assert.match(migration, /'completed', 'retryable', 'failed_final', 'obsolete'/);
  assert.match(migration, /request_row\.claim_token = p_claim_token/);
});

test("the queue cannot authorize external effects", () => {
  assert.doesNotMatch(migration, /generate-and-save-ai-sales-reply|process-ai-run-queue|materialize_sales_ai_reply_set/i);
  assert.doesNotMatch(migration, /perform public\.(send|generate|materialize)/i);
  assert.match(migration, /separada de ai_run_queue/);
  assert.match(migration, /ai_run_queue.*<> 0/);
});

test("incremental runtime authority uses a scoped service-only resolver and lock order", () => {
  const correction = fs.readFileSync("supabase/migrations/20261115030000_p9_10_5_abc_runtime_authority_and_lock_order.sql", "utf8");
  assert.match(correction, /p9_10_5_resolve_commercial_opportunity_priority_by_system/);
  assert.match(correction, /p9_resolve_commercial_opportunity_priority_internal/);
  assert.match(correction, /grant execute on function public\.p9_10_5_resolve_commercial_opportunity_priority_by_system[\s\S]*to service_role/);
  assert.match(correction, /select conversation_row[\s\S]*for update[\s\S]*select lease_row[\s\S]*for update[\s\S]*select request_row[\s\S]*for update/);
  assert.doesNotMatch(correction, /select request_row\.\*[^;]*for update skip locked/);
});

test("claim keeps SKIP LOCKED on the conversation before lease and request locks", () => {
  const correction = fs.readFileSync("supabase/migrations/20261115030000_p9_10_5_abc_runtime_authority_and_lock_order.sql", "utf8");
  const provenanceCorrection = fs.readFileSync("supabase/migrations/20261115020000_p9_10_5_abc_provenance_and_queue_scope.sql", "utf8");
  assert.match(correction, /for update of conversation_row skip locked/);
  assert.match(provenanceCorrection, /v_release_event_key is null or v_release_origin is null/);
});

test("release provenance is tied to an exact canonical source and claim is fair per conversation", () => {
  const correction = fs.readFileSync("supabase/migrations/20261115040000_p9_10_5_abc_release_provenance_and_claim_fairness.sql", "utf8");
  assert.match(correction, /source = 'hybrid_human_timeout_auto_release'/);
  assert.match(correction, /source in \('panel_release_conversation_to_ai_scoped', 'human_release_conversation_to_ai'\)/);
  assert.match(correction, /metadata->>'origin' = 'hybrid_human_timeout_auto_release'/);
  assert.match(correction, /candidate\.conversation_id = request_row\.conversation_id/);
  assert.match(correction, /for update of conversation_row skip locked/);
  assert.match(correction, /log_row\.created_at >= v_lease\.takeover_started_at/);
  assert.match(correction, /log_row\.created_at <= v_lease\.released_at/);
});

test("commitments use the canonical opportunity conversation instead of an unproven appointment column", () => {
  const aggregator = fs.readFileSync("src/lib/server/contextual-reconstruction-aggregator.ts", "utf8");
  assert.match(aggregator, /commercial_opportunities.*primary_conversation_id/);
  assert.match(aggregator, /P9_10_5_COMMITMENT_CANONICAL_CONVERSATION_MISMATCH/);
  assert.doesNotMatch(aggregator, /store_appointments.*conversation_id/);
});

