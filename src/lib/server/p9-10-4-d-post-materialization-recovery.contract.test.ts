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
const transactionalFenceMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261114110000_p9_10_4_d_transactional_recovery_write_fences.sql",
  ),
  "utf8",
);
const scopedAuthorityMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261114120000_p9_10_4_d_scoped_recovery_authority.sql",
  ),
  "utf8",
);
const legacyAuthorityMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261114121000_p9_10_4_d_patch_legacy_recovery_authorities.sql",
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

test("all recovery writer tables use an in-transaction conversation-to-lease trigger", () => {
  for (const table of [
    "commercial_opportunity_cross_sell_suggestions",
    "conversation_ai_window_state",
    "store_assistant_messages",
    "store_assistant_notification_queue",
    "store_assistant_operational_tasks",
    "store_assistant_operational_task_queue",
    "ai_run_queue",
  ]) {
    assert.match(transactionalFenceMigration, new RegExp(table));
  }
  assert.match(transactionalFenceMigration, /before insert or update/);
  assert.match(transactionalFenceMigration, /for update of c/);
  assert.match(transactionalFenceMigration, /for update;/);
  assert.match(transactionalFenceMigration, /v_conversation\.is_human_active/);
  assert.match(transactionalFenceMigration, /v_conversation\.status/);
  assert.match(transactionalFenceMigration, /v_lease\.hard_hold/);
  assert.match(transactionalFenceMigration, /v_lease\.released_at/);
  assert.match(transactionalFenceMigration, /P9_10_4_D_RECOVERY_CONTEXT_STALE/);
  assert.match(transactionalFenceMigration, /commercial_opportunities/);
});

test("scoped fences do not treat a client supplied source marker as authority", () => {
  assert.match(scopedAuthorityMigration, /p19a_sales_ai_reply_sets/);
  assert.match(scopedAuthorityMigration, /materialization_state = 'confirmed'/);
  assert.match(scopedAuthorityMigration, /P9_10_4_D_RECOVERY_SET_SCOPE_MISMATCH/);
  assert.match(scopedAuthorityMigration, /P9_10_4_D_RECOVERY_CONTEXT_STALE/);
  assert.match(scopedAuthorityMigration, /if v_set_id is null then\s+return new;/s);
  assert.match(scopedAuthorityMigration, /store_assistant_threads/);
});

test("legacy CRM and quote authorization writers share the recovery authority", () => {
  assert.match(legacyAuthorityMigration, /transition_conversation_state_internal/);
  assert.match(legacyAuthorityMigration, /p9_10_4_d_assert_recovery_write_authority_for_conversation/);
  assert.match(legacyAuthorityMigration, /issue_quote_preparation_task_authorization_by_system/);
  assert.match(legacyAuthorityMigration, /p9_10_4_d_assert_recovery_set_authority/);
  assert.match(legacyAuthorityMigration, /for update/);
});
