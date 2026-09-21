import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLeadConversationOpportunityContext } from "../../../../lib/server/crm/lead-conversation-opportunity-context";

const routePath = join(process.cwd(), "src/app/api/crm/lead-details/[id]/route.ts");

const source = readFileSync(routePath, "utf8");

const taskSelectStart = source.indexOf('.from("store_assistant_operational_tasks")');
const taskSelectEnd = source.indexOf("const { data: commercialTasksData", taskSelectStart);
const taskBlock = source.slice(taskSelectStart, taskSelectEnd);

const appointmentSelectStart = source.indexOf('.from("store_appointments")');
const appointmentSelectEnd = source.indexOf("const { data: appointmentsData", appointmentSelectStart);
const appointmentBlock = source.slice(appointmentSelectStart, appointmentSelectEnd);

assert.equal(
  source.includes('"read_store_general_address_settings_scoped"'),
  true,
  "lead detail must read the canonical store general address settings"
);

assert.equal(
  taskBlock.includes("commercial_opportunity_id"),
  true,
  "commercial tasks must select commercial_opportunity_id"
);
assert.equal(
  taskBlock.includes('.eq("commercial_opportunity_id", selectedOpportunityId)'),
  true,
  "commercial tasks must filter by selected opportunity"
);
assert.equal(
  taskBlock.includes('.in("status", OPEN_COMMERCIAL_HANDOFF_STATUSES)'),
  true,
  "commercial tasks must only load open handoff statuses"
);
assert.equal(
  taskBlock.includes("related_lead_id.eq"),
  false,
  "commercial tasks must not fall back to lead/conversation aggregation"
);

assert.equal(
  appointmentBlock.includes("commercial_opportunity_id"),
  true,
  "appointments must select commercial_opportunity_id"
);
assert.equal(
  appointmentBlock.includes('.eq("commercial_opportunity_id", selectedOpportunityId)'),
  true,
  "appointments must filter by selected opportunity"
);
assert.equal(
  appointmentBlock.includes("conversation_id.eq"),
  false,
  "appointments must not fall back to lead/conversation aggregation"
);
assert.equal(
  source.includes("if (contextResult.selectedOpportunity?.id)"),
  true,
  "tasks and appointments must only be queried when a selected opportunity exists"
);

assert.equal(
  source.includes("storeGeneralAddress,"),
  true,
  "lead detail response must return the canonical store address row"
);
assert.equal(
  source.includes('"read_commercial_opportunity_qualification_facts_by_system"'),
  true,
  "lead detail must read canonical qualification facts through the server-only reader"
);
assert.equal(
  source.includes("p_commercial_opportunity_id: selectedOpportunityId"),
  true,
  "qualification facts must be scoped to the selected opportunity"
);
assert.equal(
  source.includes("qualificationFacts,"),
  true,
  "lead detail response must return the selected opportunity qualification facts snapshot"
);

const storeMismatch = resolveLeadConversationOpportunityContext({
  organizationId: "org-1",
  storeId: "store-1",
  leadId: "lead-a",
  requestedOpportunityId: "opp-store-mismatch",
  conversations: [],
  opportunities: [
    {
      id: "opp-store-mismatch",
      organizationId: "org-1",
      storeId: "store-2",
      leadId: "lead-a",
      conversationId: null,
      stage: "new",
      stageChangedAt: "2026-09-12T10:00:00.000Z",
      createdAt: "2026-09-12T10:00:00.000Z",
      updatedAt: "2026-09-12T10:00:00.000Z",
    },
  ],
});

assert.deepEqual(
  storeMismatch,
  {
    ok: false,
    error: "opportunity_scope_rejected",
  },
  "store mismatch opportunity must fail closed before tasks or appointments can load"
);

console.log("ok - lead detail route contract");
