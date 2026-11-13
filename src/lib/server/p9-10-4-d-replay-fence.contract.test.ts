import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261114081000_p9_ai_materialization_human_takeover_replay.sql",
  ),
  "utf8",
);

test("confirmed exact replay is evaluated before the takeover block", () => {
  const replay = migration.indexOf("v_existing.materialization_state <> 'confirmed'");
  const blocked = migration.indexOf("v_human_takeover_blocked then");

  assert.notEqual(replay, -1);
  assert.notEqual(blocked, -1);
  assert.ok(replay < blocked);
  assert.match(migration, /v_existing\.request_fingerprint <> v_fingerprint/);
  assert.match(migration, /return query select v_existing\.id/);
});

test("new, incomplete, and divergent response sets remain fail-closed", () => {
  assert.match(migration, /P19A_I8_RESPONSE_SET_PAYLOAD_MISMATCH_OR_INCOMPLETE/);
  assert.match(migration, /materialization_state <> 'confirmed'/);
  assert.match(migration, /P9_10_4_D_AI_BLOCKED_BY_HUMAN_TAKEOVER/);
  assert.match(migration, /v_human_takeover_blocked/);
});

test("the corrective patch does not add writes, release, or sender bypasses", () => {
  assert.doesNotMatch(migration, /insert into public\./i);
  assert.doesNotMatch(migration, /update public\./i);
  assert.doesNotMatch(migration, /release_human_takeover_lease_by_system/);
  assert.doesNotMatch(migration, /external provider|fetch\s*\(/i);
  assert.match(migration, /alter function public\.materialize_sales_ai_reply_set_by_system/);
});

test("the patch remains tenant-scoped and preserves the SQL security contract", () => {
  assert.match(migration, /public\.materialize_sales_ai_reply_set_by_system\(uuid,uuid,uuid/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path TO pg_catalog, pg_temp, public/);
  assert.match(migration, /P9_10_4_D_REPLAY_MATERIALIZER_DRIFT/);
  assert.match(migration, /P9_10_4_D_REPLAY_POSTCONDITION_FAILED/);
});
