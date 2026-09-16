import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./process-assistant-operational-tasks.ts", import.meta.url), "utf8");

function sliceBetween(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, "missing start marker: " + startMarker);
  assert.ok(end > start, "missing end marker: " + endMarker);
  return source.slice(start, end);
}

test("customer reschedule autonomy uses canonical settings authority and fails closed", () => {
  const block = sliceBetween(
    "async function readCustomerRescheduleAutonomy",
    "function appendTaskPayload",
  );

  assert.equal(block.includes("read_store_customer_reschedule_autonomy_by_system"), true);
  assert.equal(block.includes("configured: false"), true);
  assert.equal(block.includes("aiCanAcceptWithoutApproval: false"), true);
  assert.equal(block.includes("configured && row?.ai_can_accept_without_approval === true"), true);
  assert.equal(block.includes(".from(\"store_schedule_settings\")"), false);
});

test("autonomous reschedule requires customer counterproposal, canonical availability and enabled autonomy", () => {
  const block = sliceBetween(
    "const rescheduleAutonomy =",
    "const updatedPayload = appendTaskPayload(task.task_payload, {",
  );

  assert.equal(block.includes("decision.type === \"suggested_other_time\""), true);
  assert.equal(block.includes("suggestedAvailability?.available === true"), true);
  assert.equal(block.includes("rescheduleAutonomy.aiCanAcceptWithoutApproval === true"), true);
  assert.equal(block.includes("if (canAutonomouslyAcceptSuggestedTime && suggestedWindow)"), true);
});

test("autonomous reschedule writes through canonical appointment writer and confirms customer", () => {
  const block = sliceBetween(
    "const rescheduleAutonomy =",
    "const updatedPayload = appendTaskPayload(task.task_payload, {",
  );

  assert.equal(block.includes("\"update_store_appointment\""), true);
  assert.equal(block.includes("p_scheduled_start: suggestedWindow.startIso"), true);
  assert.equal(block.includes("p_scheduled_end: suggestedWindow.endIso"), true);
  assert.equal(block.includes("sendCustomerRescheduleConfirmationMessage"), true);
});

test("successful autonomous reschedule resolves task without responsible approval", () => {
  const block = sliceBetween(
    "const rescheduleAutonomy =",
    "const updatedPayload = appendTaskPayload(task.task_payload, {",
  );

  assert.equal(block.includes("needs_responsible_approval: false"), true);
  assert.equal(block.includes("status: \"resolved\""), true);
  assert.equal(block.includes("autonomous_reschedule_completed: true"), true);
  assert.equal(block.includes("action: \"appointment_rescheduled_autonomously\""), true);
  assert.equal(block.includes("AprovaÃ§Ã£o necessÃ¡ria para novo horÃ¡rio"), false);
});

test("human approval fallback remains for disabled, unconfigured or fail-closed autonomy", () => {
  assert.equal(
    source.includes("needs_responsible_approval: decision.type === \"suggested_other_time\" && Boolean(suggestedWindow)"),
    true,
  );
  assert.equal(source.includes("customer_suggested_available_time_requires_approval"), true);
  assert.equal(source.includes("AprovaÃ§Ã£o necessÃ¡ria para novo horÃ¡rio"), true);
});
