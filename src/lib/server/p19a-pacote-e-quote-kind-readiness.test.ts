import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260904110000_p19a_commercial_gates_and_monthly_goal.sql",
  "utf8",
);

const startMarker =
  "create or replace function public.read_quote_kind_send_readiness_scoped(";

const start = migration.indexOf(startMarker);
assert.ok(start >= 0, "quote-kind reader must exist");

const endMarker = "$function$;";
const end = migration.indexOf(endMarker, start);
assert.ok(end >= 0, "quote-kind reader must terminate");

const fn = migration.slice(start, end + endMarker.length);

assert.ok(
  !fn.includes("materialize_commercial_opportunity_checklist_by_system"),
  "quote-kind reader must not materialize checklist",
);

assert.ok(
  !fn.includes("materialize_commercial_opportunity_checklist_progress_by_system"),
  "quote-kind reader must not materialize progress",
);

assert.ok(
  fn.includes("commercial_opportunity_checklist_current") &&
    fn.includes("current_checklist_version_id"),
  "quote-kind reader must use canonical checklist current pointer",
);

assert.ok(
  fn.includes("commercial_opportunity_checklist_progress_current") &&
    fn.includes("current_progress_version_id"),
  "quote-kind reader must use canonical progress current pointer",
);

assert.ok(
  !fn.includes("order by item_row.created_at desc") &&
    !fn.includes("order by progress_row.created_at desc"),
  "quote-kind reader must not select authority by newest timestamp",
);

const serviceRoleGrant =
  /grant\s+execute\s+on\s+function\s+public\.read_quote_kind_send_readiness_scoped\s*\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*\)\s*to\s+service_role\s*;/i;

assert.ok(
  serviceRoleGrant.test(migration),
  "quote-kind reader must grant execute to service_role",
);

const authenticatedGrant =
  /grant\s+execute\s+on\s+function\s+public\.read_quote_kind_send_readiness_scoped\s*\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*\)\s*to\s+[^;]*authenticated[^;]*;/i;

assert.ok(
  !authenticatedGrant.test(migration),
  "authenticated must not directly execute internal quote-kind reader",
);

const revokeAll =
  /revoke\s+all\s+on\s+function\s+public\.read_quote_kind_send_readiness_scoped\s*\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*\)\s*from\s+[^;]*public[^;]*anon[^;]*authenticated[^;]*service_role[^;]*;/i;

assert.ok(
  revokeAll.test(migration),
  "quote-kind reader privileges must be reset before service-role grant",
);

console.log("p19a quote-kind readiness: 8 assertions passed");
