import assert from "node:assert/strict";
import test from "node:test";
import { planHumanResponseAlerts } from "./human-response-alert-scanner";

const base = {
  id: "commitment-1",
  organization_id: "org-1",
  store_id: "store-1",
  conversation_id: "conversation-1",
  source_message_id: "message-1",
  due_at: "2026-11-24T10:00:00.000Z",
  status: "active",
};
const source = [{ id: "message-1", conversation_id: "conversation-1", created_at: "2026-11-24T09:00:00.000Z" }];
const authority = [{ conversation_id: "conversation-1", released_at: null }];

test("does not alert before the future A0 commitment deadline", () => {
  assert.deepEqual(planHumanResponseAlerts({ commitments: [base], sourceMessages: source, authorities: authority, existingAlerts: [], now: new Date("2026-11-24T09:20:00.000Z") }), []);
});

test("alerts at ten minutes and keeps the source clock fixed", () => {
  const plans = planHumanResponseAlerts({ commitments: [{ ...base, due_at: "2026-11-24T09:01:00.000Z" }], sourceMessages: source, authorities: authority, existingAlerts: [], now: new Date("2026-11-24T09:15:00.000Z") });
  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.thresholdMinutes, 10);
  assert.equal(plans[0]?.eventKey, "human-response:commitment-1:10");
});

test("escalates once at thirty minutes without duplicating a delivered alert", () => {
  const plans = planHumanResponseAlerts({ commitments: [{ ...base, due_at: "2026-11-24T09:01:00.000Z" }], sourceMessages: source, authorities: authority, existingAlerts: [{ status: "sent", context: { event_key: "human-response:commitment-1:10" } }], now: new Date("2026-11-24T09:31:00.000Z") });
  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.thresholdMinutes, 30);
});

test("does not alert when human-state authority is unavailable or released", () => {
  assert.deepEqual(planHumanResponseAlerts({ commitments: [base], sourceMessages: source, authorities: [], existingAlerts: [], now: new Date("2026-11-24T10:31:00.000Z") }), []);
  assert.deepEqual(planHumanResponseAlerts({ commitments: [base], sourceMessages: source, authorities: [{ conversation_id: "conversation-1", released_at: "2026-11-24T09:30:00.000Z" }], existingAlerts: [], now: new Date("2026-11-24T10:31:00.000Z") }), []);
});

test("concurrent scans derive one stable event key and a fulfilled commitment revalidates to no alert", async () => {
  const args = {
    commitments: [{ ...base, due_at: "2026-11-24T09:01:00.000Z" }],
    sourceMessages: source,
    authorities: authority,
    existingAlerts: [],
    now: new Date("2026-11-24T09:15:00.000Z"),
  };
  const [first, second] = await Promise.all([
    Promise.resolve(planHumanResponseAlerts(args)),
    Promise.resolve(planHumanResponseAlerts(args)),
  ]);
  assert.equal(first[0]?.eventKey, "human-response:commitment-1:10");
  assert.equal(second[0]?.eventKey, first[0]?.eventKey);
  assert.deepEqual(
    planHumanResponseAlerts({
      ...args,
      commitments: [{ ...args.commitments[0], status: "fulfilled" }],
    }),
    [],
  );
});
