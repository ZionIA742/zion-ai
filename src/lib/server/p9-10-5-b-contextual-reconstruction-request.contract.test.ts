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

