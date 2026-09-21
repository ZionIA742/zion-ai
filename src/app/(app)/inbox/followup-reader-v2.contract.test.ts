import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260911183000_p9_followup_inbox_reader_v2_pagination_totals.sql"
);

const manualCheckPath = path.join(
  process.cwd(),
  "supabase",
  "tests",
  "20260911183500_p9_followup_inbox_reader_v2_pagination_totals_manual_checks.sql"
);

const migration = fs.readFileSync(migrationPath, "utf8");
const manualCheck = fs.readFileSync(manualCheckPath, "utf8");

assert.equal(
  migration.includes(
    "create function public.panel_list_followup_opportunity_candidates_scoped_v2"
  ),
  true
);
assert.equal(migration.includes("p_offset integer default 0"), true);
assert.equal(migration.includes("total_count bigint"), true);
assert.equal(migration.includes("ready_count bigint"), true);
assert.equal(migration.includes("waiting_count bigint"), true);
assert.equal(migration.includes("blocked_count bigint"), true);
assert.equal(migration.includes("commercial_opportunity_followups"), true);
assert.equal(migration.includes("followup_id uuid"), true);
assert.equal(migration.includes("followup_cycle integer"), true);
assert.equal(migration.includes("followup_status text"), true);
assert.equal(migration.includes("next_action_at timestamptz"), true);
assert.equal(migration.includes("attempt_count integer"), true);
assert.equal(migration.includes("opted_out boolean"), true);
assert.equal(migration.includes("consent_restored boolean"), true);
assert.equal(migration.includes("reason_code text"), true);
assert.equal(migration.includes("context jsonb"), true);
assert.equal(migration.includes("offset v_offset"), true);
assert.equal(migration.includes("followup_type asc"), true);
assert.equal(migration.includes("panel_list_commercial_opportunity_priority_scoped"), false);
assert.equal(migration.includes("function followupPriority"), false);
assert.equal(
  migration.includes(
    "public.panel_list_followup_opportunity_candidates_scoped(uuid,uuid,text,integer,integer)"
  ),
  true
);

assert.equal(manualCheck.includes("rollback;"), true);
assert.equal(manualCheck.includes("p9_followup_inbox_reader_v2_101_candidates"), true);
assert.equal(manualCheck.includes("p9_followup_inbox_reader_v2_offset_no_overlap"), true);
assert.equal(manualCheck.includes("p9_followup_inbox_reader_v2_offer_visit_totals"), true);
assert.equal(manualCheck.includes("p9_followup_inbox_reader_v2_scope_and_states"), true);

console.log("ok - follow-up reader v2 contract");
