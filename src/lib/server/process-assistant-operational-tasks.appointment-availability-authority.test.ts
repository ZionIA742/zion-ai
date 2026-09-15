import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./process-assistant-operational-tasks.ts", import.meta.url), "utf8");

function sliceBetween(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("customer-suggested reschedule uses canonical appointment availability authority", () => {
  const block = sliceBetween(
    "async function checkSuggestedRescheduleAvailability",
    "function appendTaskPayload",
  );

  assert.equal(
    block.includes('args.supabase.rpc("check_store_appointment_availability_by_system"'),
    true,
  );
  assert.equal(block.includes("p_appointment_type: args.appointmentType"), true);
  assert.equal(block.includes("p_ignore_appointment_id: args.appointmentId"), true);
  assert.equal(block.includes('.from("store_schedule_blocks")'), false);
  assert.equal(block.includes('.from("store_appointments")'), false);
});

test("customer-suggested reschedule sends current appointment type to canonical authority", () => {
  assert.equal(
    source.includes('appointmentType: appointment.appointment_type || "other"'),
    true,
  );
});

test("processor maps canonical availability reasons", () => {
  const block = sliceBetween(
    "async function checkSuggestedRescheduleAvailability",
    "function appendTaskPayload",
  );

  assert.equal(block.includes("outside_operating_window"), true);
  assert.equal(block.includes("schedule_block_conflict"), true);
  assert.equal(block.includes("global_capacity_exceeded"), true);
  assert.equal(block.includes("installation_team_capacity_exceeded"), true);
});

test("obsolete local availability helper chain is gone", () => {
  assert.equal(source.includes("function getDayKeyFromLocalParts"), false);
  assert.equal(source.includes("function getLocalPartsFromIso"), false);
  assert.equal(source.includes("function parseScheduleTimeToMinutes"), false);
  assert.equal(source.includes("function checkOperatingWindow"), false);
  assert.equal(source.includes("function loadScheduleSettingsForAvailability"), false);
});
