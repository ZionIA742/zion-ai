import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

function sliceBetween(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("suggested-time approval uses canonical appointment availability authority", () => {
  const block = sliceBetween(
    "async function checkSuggestedTimeApprovalAvailability",
    "function formatSuggestedDateTimeForResponsible",
  );

  assert.equal(block.includes(
    'args.supabase.rpc("check_store_appointment_availability_by_system"',
  ), true);
  assert.equal(block.includes("p_appointment_type: args.appointmentType"), true);
  assert.equal(block.includes("p_ignore_appointment_id: args.appointmentId"), true);

  assert.equal(block.includes('.from("store_schedule_blocks")'), false);
  assert.equal(block.includes('.from("store_appointments")'), false);
  assert.equal(block.includes("has_store_appointment_conflict"), false);
});

test("responsible-approved reschedule sends the current appointment type to canonical availability", () => {
  const block = sliceBetween(
    "async function resolveSuggestedTimeApprovalReply",
    "function buildProfessionalAppointmentClarificationReply",
  );

  assert.equal(
    block.includes('appointmentType: appointment.appointment_type || "other"'),
    true,
  );
});

test("canonical availability failures expose the relevant capacity reasons", () => {
  const block = sliceBetween(
    "async function checkSuggestedTimeApprovalAvailability",
    "function formatSuggestedDateTimeForResponsible",
  );

  assert.equal(block.includes("outside_operating_window"), true);
  assert.equal(block.includes("schedule_block_conflict"), true);
  assert.equal(block.includes("global_capacity_exceeded"), true);
  assert.equal(block.includes("installation_team_capacity_exceeded"), true);
});

test("obsolete local operating-window availability helpers are gone", () => {
  assert.equal(source.includes("function checkOperatingWindowForSuggestedTime"), false);
  assert.equal(source.includes("function getScheduleLocalPartsFromIso"), false);
  assert.equal(source.includes("function parseScheduleHourMinute"), false);
});
