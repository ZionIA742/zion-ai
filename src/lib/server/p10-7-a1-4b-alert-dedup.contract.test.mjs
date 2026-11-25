import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261124173000_p10_7_a1_4b_atomic_human_response_alert_dedup.sql",
  "utf8",
);
const scanner = readFileSync("src/lib/server/human-response-alert-scanner.ts", "utf8");
const enqueueRpcMigration = readFileSync(
  "supabase/migrations/20261020113000_p19a_5_9_assistant_panel_sync_contract.sql",
  "utf8",
);

test("A1.4b installs tenant-scoped atomic uniqueness only for human-response alerts", () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS/);
  assert.match(migration, /organization_id,\s*\n\s*store_id,\s*\n\s*\(context ->> 'event_key'\)/);
  assert.match(migration, /context ->> 'reason' = 'human_response_pending'/);
  assert.match(migration, /HAVING COUNT\(\*\) > 1/);
  assert.match(migration, /P10_7_A1_4B_DUPLICATE_HUMAN_RESPONSE_EVENT_KEYS_REQUIRE_REVIEW/);
  assert.doesNotMatch(migration, /DELETE\s+FROM|TRUNCATE\s+/i);
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX[\s\S]*assistant_panel_sync/);
});

test("A1.4b prevents reopening delivered human-response alerts", () => {
  assert.match(migration, /OLD\.status IN \('sent', 'delivered', 'read'\)/);
  assert.match(migration, /NEW\.status = 'pending'/);
  assert.match(migration, /RETURN OLD/);
  assert.match(migration, /BEFORE UPDATE ON public\.store_assistant_notification_queue/);
  assert.match(scanner, /status.*pending.*processing.*sent/s);
  assert.match(scanner, /p_event_key: plan\.eventKey/);
  assert.match(scanner, /error\?\.code === "23505"/);
  assert.match(scanner, /concurrent scanner may have won the partial unique index/);
});

test("A1.4b leaves the existing cron and non-human notification paths untouched", () => {
  assert.doesNotMatch(migration, /cron\.job|pg_cron|whatsapp-process-all/i);
  assert.doesNotMatch(migration, /takeover|lease|hard_hold|release/i);
  assert.match(migration, /notification_type = 'important_alert'/);
});

test("A1.4b keys the fence on the marker persisted by the enqueue RPC", () => {
  assert.match(
    enqueueRpcMigration,
    /v_context\s*:=\s*[\s\S]*jsonb_build_object\([\s\S]*'source',[\s\S]*'assistant_enqueue_internal_notification'/,
  );
  assert.match(migration, /context ->> 'reason' = 'human_response_pending'/);
  assert.doesNotMatch(
    migration,
    /context ->> 'source' = 'p10_7_a1_2_human_response_scanner'/,
  );
});
