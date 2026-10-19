import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCommercialActionEvidenceByStore,
} from "./commercial-action-evidence";
import { classifyCommercialActionEvidence } from "./commercial-action-classification";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "action-1",
  store_id: "store-a",
  processed_at: null,
  processing_error: null,
  next_action: "follow_up",
  action_key: "action-key-1",
  ...overrides,
});

function classify(
  rows: readonly unknown[],
  availability: "available" | "partial" | "unavailable" = "available",
  storeIds: ReadonlySet<string> = new Set(["store-a"]),
) {
  const summary = buildCommercialActionEvidenceByStore({ rows, storeIds, availability }).get("store-a");
  assert.ok(summary);
  return classifyCommercialActionEvidence(summary);
}

function codes(result: ReturnType<typeof classify>) {
  return result.occurrences.map((item) => item.code);
}

test("classifies an isolated persisted processing error", () => {
  const result = classify([row({ processing_error: "private error" })]);
  assert.deepEqual(codes(result), ["processing_error_recorded"]);
  assert.equal(result.complete, true);
  assert.equal(JSON.stringify(result).includes("private error"), false);
});

test("classifies an isolated pending action without inferring delay or approval", () => {
  const result = classify([row()]);
  assert.deepEqual(codes(result), ["pending_unconfirmed"]);
  assert.equal(JSON.stringify(result).includes("stale"), false);
  assert.equal(JSON.stringify(result).includes("approval"), false);
});

test("classifies recorded processing without inferring commercial success or delivery", () => {
  const result = classify([row({ processed_at: "2026-10-19T12:00:00.000Z" })]);
  assert.deepEqual(codes(result), ["processed_recorded"]);
  assert.equal(JSON.stringify(result).includes("delivered"), false);
  assert.equal(JSON.stringify(result).includes("success"), false);
});

test("classifies an isolated invalid record as unknown evidence", () => {
  const result = classify([row({ processed_at: "not-a-date" })]);
  assert.deepEqual(codes(result), ["invalid"]);
  assert.equal(result.complete, false);
});

test("classifies an available empty source without asserting AI health", () => {
  const result = classify([]);
  assert.deepEqual(codes(result), ["no_actions_observed"]);
  assert.equal(result.complete, true);
  assert.equal(result.observedCounts.pendingUnconfirmed, 0);
});

test("marks a partial source while preserving observed valid evidence", () => {
  const result = classify([row({ processing_error: "error" })], "partial");
  assert.deepEqual(codes(result), ["processing_error_recorded", "source_partial"]);
  assert.equal(result.occurrences[0]?.confirmed, true);
  assert.equal(result.complete, false);
});

test("marks an unavailable source without confirming absence", () => {
  const result = classify([], "unavailable");
  assert.deepEqual(codes(result), ["source_unavailable"]);
  assert.equal(result.complete, false);
  assert.equal(result.confirmedCounts, null);
});

test("keeps a confirmed error visible beside invalid evidence", () => {
  const result = classify([
    row({ id: "error", processing_error: "error" }),
    row({ id: "invalid", processed_at: "bad" }),
  ]);
  assert.deepEqual(codes(result), ["processing_error_recorded", "invalid"]);
  assert.equal(result.observedCounts.processingErrors, 1);
  assert.equal(result.complete, false);
});

test("classification is independent of record order", () => {
  const rows = [
    row({ id: "error", processing_error: "error" }),
    row({ id: "pending" }),
    row({ id: "processed", processed_at: "2026-10-19T12:00:00.000Z" }),
    row({ id: "invalid", processed_at: "bad" }),
  ];
  assert.deepEqual(
    classify(rows).occurrences,
    classify([...rows].reverse()).occurrences,
  );
});

test("keeps error and pending classifications distinct", () => {
  const result = classify([
    row({ id: "error", processing_error: "error" }),
    row({ id: "pending" }),
  ]);
  assert.deepEqual(codes(result), ["processing_error_recorded", "pending_unconfirmed"]);
});

test("keeps processed and pending classifications distinct", () => {
  const result = classify([
    row({ id: "processed", processed_at: "2026-10-19T12:00:00.000Z" }),
    row({ id: "pending" }),
  ]);
  assert.deepEqual(codes(result), ["pending_unconfirmed", "processed_recorded"]);
});

test("preserves a valid error when the source is partial", () => {
  const result = classify([row({ processing_error: "error" })], "partial");
  assert.equal(result.observedCounts.processingErrors, 1);
  assert.deepEqual(result.confirmedCounts, null);
});

test("does not mix independent stores", () => {
  const map = buildCommercialActionEvidenceByStore({
    rows: [
      row({ id: "a", store_id: "store-a", processing_error: "error" }),
      row({ id: "b", store_id: "store-b" }),
      row({ id: "orphan", store_id: "store-unknown", processing_error: "error" }),
    ],
    storeIds: new Set(["store-a", "store-b"]),
    availability: "available",
  });
  const storeA = classifyCommercialActionEvidence(map.get("store-a")!);
  const storeB = classifyCommercialActionEvidence(map.get("store-b")!);
  assert.deepEqual(codes(storeA), ["processing_error_recorded"]);
  assert.deepEqual(codes(storeB), ["pending_unconfirmed"]);
});

test("discards an unknown store without assigning it to a valid store", () => {
  const result = classify([row({ store_id: "store-unknown", processing_error: "error" })]);
  assert.deepEqual(codes(result), ["no_actions_observed"]);
});

test("does not assign a missing store identifier", () => {
  const result = classify([row({ store_id: null })]);
  assert.deepEqual(codes(result), ["no_actions_observed"]);
});

test("does not expose action identifiers or sensitive data", () => {
  const result = classify([row({
    processing_error: "token=secret customer=Maria prompt=private",
    next_action: "approve_contract",
    action_key: "private-action-key",
  })]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("Maria"), false);
  assert.equal(serialized.includes("approve_contract"), false);
  assert.equal(serialized.includes("private-action-key"), false);
});

test("does not classify an error as definitive failure", () => {
  const result = classify([row({ processing_error: "error" })]);
  assert.equal(codes(result).includes("failed_final"), false);
  assert.equal(codes(result).includes("processing_error_recorded"), true);
});

test("preserves the 7.6-A evidence counts and confirmed counts", () => {
  const result = classify([
    row({ id: "error", processing_error: "error" }),
    row({ id: "pending" }),
  ]);
  assert.deepEqual(result.observedCounts, {
    processedRecorded: 0,
    processingErrors: 1,
    pendingUnconfirmed: 1,
    invalid: 0,
  });
  assert.deepEqual(result.confirmedCounts, result.observedCounts);
});

console.log("zion-admin-commercial-action-classification: 18 tests passed");
