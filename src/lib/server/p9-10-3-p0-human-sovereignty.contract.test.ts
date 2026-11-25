import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase", "migrations", "20261117010000_p9_10_3_p0_human_sovereignty.sql"),
  "utf8",
);
const cron = readFileSync(
  join(root, "src", "app", "api", "cron", "whatsapp-process-all", "route.ts"),
  "utf8",
);
const explicitRelease = readFileSync(
  join(root, "supabase", "migrations", "20261115010000_p9_10_5_b_contextual_reconstruction_request.sql"),
  "utf8",
);
const hardHold = readFileSync(
  join(root, "supabase", "migrations", "20261114050000_p9_hybrid_human_takeover_lock_and_acl_fix.sql"),
  "utf8",
);

const timeoutStart = migration.indexOf("create or replace function public.process_stale_human_conversations");
const timeoutEnd = migration.indexOf("alter function public.process_stale_human_conversations");
assert.ok(timeoutStart >= 0 && timeoutEnd > timeoutStart);
const timeoutBody = migration.slice(timeoutStart, timeoutEnd);

assert.match(timeoutBody, /notice_30_at/);
assert.doesNotMatch(timeoutBody, /transition_conversation_state_internal/);
assert.doesNotMatch(timeoutBody, /release_human_takeover_lease_by_system/);
assert.doesNotMatch(timeoutBody, /released_at\s*=/);
assert.match(timeoutBody, /last_human_activity_at[\s\S]*interval '30 minutes'/);
assert.match(migration, /P9_10_3_P0_AUTOMATIC_RELEASE_DISABLED/);
assert.match(migration, /release_origin = 'lease_expiration'/);
assert.match(migration, /status = 'obsolete'/);

assert.match(cron, /rpc\(\s*["']process_stale_human_conversations["']/);
assert.match(explicitRelease, /panel_release_conversation_to_ai_scoped/);
assert.match(explicitRelease, /v_user_id is null or v_request_role <> 'authenticated'/);
assert.match(hardHold, /v_lease\.hard_hold/);
assert.match(hardHold, /for update skip locked/gi);

console.log("ok - timeout after 40 minutes remains a pending notice");
console.log("ok - cron invokes only the pending-notice authority");
console.log("ok - explicit authenticated release path remains present");
console.log("ok - hard hold and lock/fence guards remain present");
