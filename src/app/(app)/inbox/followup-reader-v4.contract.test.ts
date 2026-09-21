import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260911200000_p9_followup_inbox_reader_v4_unique_opportunity_type.sql"
);

const manualCheckPath = path.join(
  process.cwd(),
  "supabase",
  "tests",
  "20260911200500_p9_followup_inbox_reader_v4_unique_opportunity_type_manual_checks.sql"
);

const inboxPath = path.join(process.cwd(), "src", "app", "(app)", "inbox", "page.tsx");

const migration = fs.readFileSync(migrationPath, "utf8");
const manualCheck = fs.readFileSync(manualCheckPath, "utf8");
const inbox = fs.readFileSync(inboxPath, "utf8");

assert.equal(
  migration.includes(
    "create function public.panel_list_followup_opportunity_candidates_scoped_v4"
  ),
  true
);
const createSignature = migration.slice(
  migration.indexOf("create function public.panel_list_followup_opportunity_candidates_scoped_v4"),
  migration.indexOf("returns table", migration.indexOf("create function public.panel_list_followup_opportunity_candidates_scoped_v4"))
);

assert.equal(createSignature.includes("p_followup_type"), false);
assert.equal(migration.includes("p_min_hours_since_customer integer default 24"), true);
assert.equal(migration.includes("p_limit integer default 50"), true);
assert.equal(migration.includes("p_offset integer default 0"), true);
assert.equal(migration.includes("opportunity_row.stage as opportunity_stage"), true);
assert.equal(migration.includes("when 'active' then 0"), true);
assert.equal(migration.includes("followup_row.status = 'active'"), true);
assert.equal(migration.includes("followup_row.next_action = 'followup_offer' then 'offer'"), true);
assert.equal(migration.includes("followup_row.next_action = 'followup_visit' then 'visit'"), true);
assert.equal(
  migration.includes("followup_row.next_action in ('followup_offer', 'followup_visit')"),
  true
);
assert.equal(migration.includes("else null::text"), true);
assert.equal(migration.includes("commercial_opportunity_opted_out"), true);
assert.equal(migration.includes("commercial_opportunity_followup_exhausted"), true);
assert.equal(migration.includes("consent_restored"), true);
assert.equal(migration.includes("count(*) over () as total_count"), true);
assert.equal(migration.includes("ready_count bigint"), true);
assert.equal(migration.includes("waiting_count bigint"), true);
assert.equal(migration.includes("blocked_count bigint"), true);
assert.equal(migration.includes("limit v_limit"), true);
assert.equal(migration.includes("offset v_offset"), true);
assert.equal(migration.includes("commercial_opportunity_id asc"), true);
assert.equal(migration.includes("followup_type asc"), false);
assert.equal(migration.includes("grant execute on function public.panel_list_followup_opportunity_candidates_scoped_v4"), true);

assert.equal(inbox.includes('"panel_list_followup_opportunity_candidates_scoped_v4"'), true);
assert.equal(inbox.includes('"panel_list_followup_opportunity_candidates_scoped_v3"'), false);
assert.equal(inbox.includes('const followupTypes = ["offer", "visit"] as const;'), false);
assert.equal(inbox.includes("p_followup_type: followupType"), true);
assert.equal(inbox.includes("p_followup_type: followupType,"), true);
assert.equal(inbox.includes("const followupType = selectedFollowupType ?? getFollowupWriterType(candidate);"), true);
assert.equal(inbox.includes("Buscar por nome ou telefone"), true);
assert.equal(inbox.includes("setFollowupRows([])"), false);
assert.equal(inbox.includes("setFollowupTotals(EMPTY_FOLLOWUP_TOTALS)"), false);
assert.equal(inbox.includes("opportunityId: row.commercial_opportunity_id"), true);
assert.equal(inbox.includes("panel_list_commercial_opportunity_priority_scoped"), true);
assert.equal(inbox.includes("buildGoogleMapsDirectionsUrl"), true);

assert.equal(manualCheck.includes("rollback;"), true);
assert.equal(manualCheck.includes("p9_followup_inbox_reader_v4_contract"), true);
assert.equal(manualCheck.includes("p9_followup_inbox_reader_v4_type_authority"), true);
assert.equal(manualCheck.includes("p9_followup_inbox_reader_v4_unique_pagination_totals"), true);
assert.equal(manualCheck.includes("p9_followup_inbox_reader_v4_stage_scope_states"), true);
assert.equal(manualCheck.includes("p_followup_type must not be accepted"), true);

console.log("ok - follow-up reader v4 unique opportunity type contract");
