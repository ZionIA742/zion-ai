import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCommercialActionEvidenceByStore } from "./commercial-action-evidence";
import { classifyCommercialActionEvidence } from "./commercial-action-classification";
import {
  buildStoreOperationalHealthInputs,
} from "./operational-health-source-adapter";
import { resolveStoreOperationalHealth } from "./operational-health-resolution";

const thresholds = {
  whatsappInboundStaleMs: 600_000,
  whatsappOutboundStaleMs: 600_000,
  aiRunQueueStaleMs: 600_000,
  assistantPendingStaleMs: 600_000,
  assistantProcessingStaleMs: 900_000,
  responsibleProcessingStaleMs: 600_000,
  firstPostAppointmentFollowupDelayMs: 600_000,
  subsequentPostAppointmentFollowupDelayMs: 1_800_000,
  maxPostAppointmentPrompts: 3,
};

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "action-1",
  store_id: "store-a",
  processed_at: null,
  processing_error: null,
  next_action: "follow_up",
  action_key: "action-key",
  ...overrides,
});

function run(rows: readonly unknown[], availability: "available" | "partial" | "unavailable" = "available") {
  const stores = new Set(["store-a", "store-b"]);
  const evidence = buildCommercialActionEvidenceByStore({ rows, storeIds: stores, availability });
  const classifications = new Map(
    Array.from(evidence.entries()).map(([storeId, summary]) => [
      storeId,
      classifyCommercialActionEvidence(summary),
    ] as const),
  );
  const inputs = buildStoreOperationalHealthInputs({
    storeIds: [...stores],
    now: new Date("2026-10-19T12:00:00.000Z"),
    thresholds,
    sources: {
      whatsappInboxRows: [],
      whatsappOutboundRows: [],
      aiRunRows: [],
      aiRunQueueRows: [],
      assistantOperationalQueueRows: [],
      responsibleNotificationRows: [],
      appointmentRows: [],
      postAppointmentFollowupRows: [],
      commercialActionClassificationsByStoreId: classifications,
    },
  });
  return new Map(
    Array.from(inputs.entries()).map(([storeId, input]) => [
      storeId,
      resolveStoreOperationalHealth(input),
    ] as const),
  );
}

test("commercial processing error remains separate from a healthy AI execution", () => {
  const result = run([row({ processing_error: "private failure" })]).get("store-a");
  assert.equal(result?.ai.state, "idle");
  assert.equal(result?.commercial.state, "broken");
  assert.deepEqual(result?.issues.map((issue) => issue.code), [
    "commercial_action_processing_error",
  ]);
});

test("pending and processed actions do not become technical warnings", () => {
  const result = run([
    row({ id: "pending" }),
    row({ id: "processed", processed_at: "2026-10-19T11:00:00.000Z" }),
  ]).get("store-a");
  assert.equal(result?.commercial.state, "healthy");
  assert.equal(result?.issues.length, 0);
});

test("empty, partial, unavailable and invalid commercial evidence fail closed", () => {
  assert.equal(run([]).get("store-a")?.commercial.state, "unknown");
  assert.equal(run([], "partial").get("store-a")?.commercial.state, "unknown");
  assert.equal(run([], "unavailable").get("store-a")?.commercial.state, "unknown");
  assert.equal(
    run([row({ processed_at: "not-a-date" })]).get("store-a")?.commercial.state,
    "unknown",
  );
});

test("confirmed error survives invalid evidence and store isolation", () => {
  const result = run([
    row({ id: "error", processing_error: "failure" }),
    row({ id: "invalid", processed_at: "not-a-date" }),
    row({ id: "other-store", store_id: "store-b" }),
  ]);
  assert.equal(result.get("store-a")?.commercial.state, "broken");
  assert.equal(result.get("store-b")?.commercial.state, "healthy");
  assert.deepEqual(result.get("store-a")?.issues.map((issue) => issue.code), [
    "commercial_action_processing_error",
    "commercial_action_invalid",
  ]);
});

console.log("zion-admin-commercial-action-operational-health: 4 tests passed");
