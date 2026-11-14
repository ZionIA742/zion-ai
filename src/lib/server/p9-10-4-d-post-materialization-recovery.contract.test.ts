import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261114090000_p9_ai_post_materialization_recovery_queue.sql",
  ),
  "utf8",
);
const runtime = readFileSync(
  join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
  "utf8",
);
const authorityMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261114100000_p9_10_4_d_recovery_authority_guard.sql",
  ),
  "utf8",
);

test("post-materialization recovery is enqueued in the same materialization transaction", () => {
  const confirmed = migration.indexOf("materialization_state = 'confirmed'");
  const enqueue = migration.indexOf("sales_ai_post_materialization_recovery");
  const returnRow = migration.lastIndexOf("return query select v_set_id");

  assert.ok(confirmed >= 0);
  assert.ok(enqueue > confirmed);
  assert.ok(returnRow > enqueue);
  assert.match(migration, /on conflict \(organization_id, queue_key\) do nothing/i);
  assert.match(migration, /begin;/i);
  assert.match(migration, /commit;/i);
});

test("recovery queue preserves tenant, conversation and anchor identity", () => {
  assert.match(migration, /p_organization_id/);
  assert.match(migration, /p_store_id/);
  assert.match(migration, /p_conversation_id/);
  assert.match(migration, /p_lead_id/);
  assert.match(migration, /p_anchor_message_id/);
  assert.match(migration, /responseSetId/);
  assert.match(migration, /anchorMessageId/);
});

test("recovery migration fails closed on drift and keeps takeover fence", () => {
  assert.match(migration, /P9_10_4_D_RECOVERY_MATERIALIZER_DRIFT/);
  assert.match(migration, /P9_10_4_D_RECOVERY_QUEUE_MISSING/);
  assert.match(migration, /P9_10_4_D_AI_BLOCKED_BY_HUMAN_TAKEOVER/);
});

test("recovery revalidates human status, tenant lease and anchor before writers", () => {
  assert.match(runtime, /conversationStatus === "humano_assumiu"/);
  assert.match(runtime, /conversation_human_takeover_leases/);
  assert.match(runtime, /recoveryAnchorStillCurrent/);
  assert.match(runtime, /organization_id, store_id, conversation_id, hard_hold, released_at/);
  assert.doesNotMatch(runtime, /quotePreparationAnchorStillCurrent: true/);
  assert.doesNotMatch(runtime, /enqueueSalesAiPostMaterializationRecovery\(/);
});

test("recovery authority is tenant-scoped and transaction-locked", () => {
  assert.match(authorityMigration, /for update of c/);
  assert.match(authorityMigration, /for update;/);
  assert.match(authorityMigration, /organization_id = p_organization_id/);
  assert.match(authorityMigration, /store_id = p_store_id/);
  assert.match(authorityMigration, /humano_assumiu/);
  assert.match(authorityMigration, /hard_hold/);
});
