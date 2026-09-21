import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260911190000_p9_followup_inbox_reader_v3_opportunity_stage.sql"
);

const manualCheckPath = path.join(
  process.cwd(),
  "supabase",
  "tests",
  "20260911190500_p9_followup_inbox_reader_v3_opportunity_stage_manual_checks.sql"
);

const inboxPath = path.join(process.cwd(), "src", "app", "(app)", "inbox", "page.tsx");

const migration = fs.readFileSync(migrationPath, "utf8");
const manualCheck = fs.readFileSync(manualCheckPath, "utf8");
const inbox = fs.readFileSync(inboxPath, "utf8");

assert.equal(
  migration.includes(
    "create function public.panel_list_followup_opportunity_candidates_scoped_v3"
  ),
  true
);
assert.equal(migration.includes("conversation_status text"), true);
assert.equal(migration.includes("opportunity_stage text"), true);
assert.equal(migration.includes("opportunity_row.stage as opportunity_stage"), true);
assert.equal(migration.includes("join public.commercial_opportunities opportunity_row"), true);
assert.equal(migration.includes("opportunity_row.id = candidate.commercial_opportunity_id"), true);
assert.equal(migration.includes("opportunity_row.organization_id = p_organization_id"), true);
assert.equal(
  migration.includes("public.panel_list_followup_opportunity_candidates_scoped_v2"),
  true
);
assert.equal(migration.includes("p_limit"), true);
assert.equal(migration.includes("p_offset"), true);
assert.equal(migration.includes("total_count bigint"), true);
assert.equal(migration.includes("ready_count bigint"), true);
assert.equal(migration.includes("waiting_count bigint"), true);
assert.equal(migration.includes("blocked_count bigint"), true);

assert.equal(inbox.includes('"panel_list_followup_opportunity_candidates_scoped_v3"'), false);
assert.equal(inbox.includes('"panel_list_followup_opportunity_candidates_scoped_v4"'), true);
assert.equal(inbox.includes("opportunity_stage: string | null;"), true);
assert.equal(inbox.includes('row.opportunity_stage || "etapa não informada"'), true);
assert.equal(inbox.includes('row.conversation_status || "status não informado"'), false);
assert.equal(inbox.includes("conversationId: row.conversation_id"), true);
assert.equal(inbox.includes("opportunityId: row.commercial_opportunity_id"), true);
assert.equal(inbox.includes('"panel_enqueue_followup_opportunity_scoped"'), true);
assert.equal(inbox.includes("function followupPriority"), false);
assert.equal(inbox.includes("buildGoogleMapsDirectionsUrl"), true);

assert.equal(manualCheck.includes("rollback;"), true);
assert.equal(manualCheck.includes("p9_followup_inbox_reader_v3_contract"), true);
assert.equal(manualCheck.includes("p9_followup_inbox_reader_v3_stage_source"), true);
assert.equal(
  manualCheck.includes("p9_followup_inbox_reader_v3_conversation_status_separate"),
  true
);

console.log("ok - follow-up reader v3 opportunity stage contract");
