import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261114080000_p9_ai_materialization_human_takeover_fence.sql",
  ),
  "utf8",
);

test("10.4-D materializes only after the conversation lock and second lease lock", () => {
  const conversationLock = migration.indexOf("for update;");
  const leaseLock = migration.indexOf("conversation_human_takeover_leases lease_row");
  const guard = migration.indexOf("P9_10_4_D_AI_BLOCKED_BY_HUMAN_TAKEOVER");

  assert.notEqual(conversationLock, -1);
  assert.notEqual(leaseLock, -1);
  assert.notEqual(guard, -1);
  assert.ok(conversationLock < leaseLock);
  assert.ok(leaseLock < guard);
  assert.match(migration, /v_conversation\.is_human_active/);
  assert.match(migration, /v_hard_hold/);
});

test("10.4-D preserves the external sender as a second fence", () => {
  assert.match(migration, /external-send gate remains the last provider-side fence/i);
  assert.match(migration, /materialize_sales_ai_reply_set_by_system/);
  assert.doesNotMatch(migration, /release_human_takeover_lease_by_system/);
  assert.doesNotMatch(migration, /hard_hold\s*:=\s*false/);
});

test("10.4-D keeps the production security contract", () => {
  assert.match(migration, /alter function public\.materialize_sales_ai_reply_set_by_system/);
  assert.match(migration, /P9_10_4_D_MATERIALIZER_DRIFT/);
  assert.match(migration, /P9_10_4_D_MATERIALIZER_POSTCONDITION_FAILED/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path TO pg_catalog, pg_temp, public/);
});
