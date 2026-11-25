import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const repair = readFileSync(
  "supabase/repairs/20261119000000_p0_human_sovereignty_emergency_repair.sql",
  "utf8",
);

assert.match(repair, /create or replace function public\.process_stale_human_conversations/);
const functionBody = repair.slice(
  repair.indexOf("create or replace function public.process_stale_human_conversations"),
  repair.indexOf("alter function public.process_stale_human_conversations"),
);
assert.match(functionBody, /returns integer/);
assert.match(functionBody, /return 0/);
assert.doesNotMatch(functionBody, /release_human_takeover_lease_by_system/);
assert.doesNotMatch(functionBody, /transition_conversation_state/);
assert.doesNotMatch(functionBody, /conversation_human_takeover_leases/);
assert.doesNotMatch(functionBody, /insert into/i);
assert.match(repair, /revoke all on function public\.process_stale_human_conversations\(\) from public, anon, authenticated/);
assert.match(repair, /grant execute on function public\.process_stale_human_conversations\(\) to service_role/);

console.log("ok - emergency repair is an independent pending-notice-only replacement");
console.log("ok - automatic release and transition authorities are absent");
console.log("ok - cron-compatible signature and service-only ACL are preserved");
