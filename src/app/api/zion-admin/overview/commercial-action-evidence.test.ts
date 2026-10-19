import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCommercialActionEvidenceByStore,
  normalizeCommercialActionEvidence,
} from "./commercial-action-evidence";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "action-1",
  store_id: "store-a",
  processed_at: null,
  processing_error: null,
  next_action: "follow_up",
  action_key: "action-key-1",
  ...overrides,
});

test("keeps recorded processing separate from commercial success or delivery", () => {
  const result = normalizeCommercialActionEvidence(row({ processed_at: "2026-10-19T12:00:00.000Z" }));
  assert.equal(result.kind, "processed_recorded");
  assert.equal(result.hasProcessingError, false);
  assert.equal("nextAction" in result, false);
  assert.equal("payload" in result, false);
});

test("preserves a persisted processing error", () => {
  const result = normalizeCommercialActionEvidence(row({ processing_error: "private raw error" }));
  assert.equal(result.kind, "processing_error_recorded");
  assert.equal(result.hasProcessingError, true);
  assert.equal(JSON.stringify(result).includes("private raw error"), false);
});

test("represents an unprocessed action without inferring approval or delay", () => {
  const result = normalizeCommercialActionEvidence(row());
  assert.equal(result.kind, "pending_unconfirmed");
  assert.equal(JSON.stringify(result).includes("approval"), false);
  assert.equal(JSON.stringify(result).includes("stale"), false);
});

test("available empty source confirms zero observations only", () => {
  const result = buildCommercialActionEvidenceByStore({
    rows: [],
    storeIds: new Set(["store-a"]),
    availability: "available",
  }).get("store-a");
  assert.deepEqual(result?.observedCounts, {
    processedRecorded: 0,
    processingErrors: 0,
    pendingUnconfirmed: 0,
    invalid: 0,
  });
  assert.deepEqual(result?.confirmedCounts, result?.observedCounts);
});

test("available source with only valid records confirms all observed counts", () => {
  const result = buildCommercialActionEvidenceByStore({
    rows: [
      row({ id: "processed", processed_at: "2026-10-19T12:00:00.000Z" }),
      row({ id: "error", processing_error: "error" }),
      row({ id: "pending" }),
    ],
    storeIds: new Set(["store-a"]),
    availability: "available",
  }).get("store-a");
  assert.deepEqual(result?.confirmedCounts, {
    processedRecorded: 1,
    processingErrors: 1,
    pendingUnconfirmed: 1,
    invalid: 0,
  });
});

test("available source with any invalid record does not confirm the full set", () => {
  const result = buildCommercialActionEvidenceByStore({
    rows: [row({ id: "error", processing_error: "error" }), row({ id: "invalid", processed_at: "bad" })],
    storeIds: new Set(["store-a"]),
    availability: "available",
  }).get("store-a");
  assert.equal(result?.observedCounts.processingErrors, 1);
  assert.equal(result?.observedCounts.invalid, 1);
  assert.equal(result?.confirmedCounts, null);
});

test("unavailable and partial sources never expose confirmed counts", () => {
  for (const availability of ["unavailable", "partial"] as const) {
    const result = buildCommercialActionEvidenceByStore({
      rows: [row({ processing_error: "error" })],
      storeIds: new Set(["store-a"]),
      availability,
    }).get("store-a");
    assert.equal(result?.observedCounts.processingErrors, 1);
    assert.equal(result?.confirmedCounts, null);
  }
});

test("missing and invalid fields fail closed", () => {
  assert.equal(normalizeCommercialActionEvidence({}).kind, "invalid");
  assert.equal(normalizeCommercialActionEvidence(row({ processed_at: "" })).kind, "invalid");
  assert.equal(normalizeCommercialActionEvidence(row({ processing_error: 42 })).kind, "invalid");
  assert.equal(normalizeCommercialActionEvidence(row({ next_action: 42 })).kind, "invalid");
});

test("confirmed errors remain visible beside invalid records in either order", () => {
  const validError = row({ id: "error", processing_error: "error" });
  const invalid = row({ id: "invalid", processed_at: "not-a-date" });
  for (const rows of [[validError, invalid], [invalid, validError]]) {
    const result = buildCommercialActionEvidenceByStore({
      rows,
      storeIds: new Set(["store-a"]),
      availability: "available",
    }).get("store-a");
    assert.equal(result?.observedCounts.processingErrors, 1);
    assert.equal(result?.observedCounts.invalid, 1);
    assert.equal(result?.confirmedCounts, null);
  }
});

test("keeps two stores isolated and discards unknown stores without mixing", () => {
  const result = buildCommercialActionEvidenceByStore({
    rows: [
      row({ id: "a", store_id: "store-a" }),
      row({ id: "b", store_id: "store-b", processing_error: "error" }),
      row({ id: "orphan", store_id: "store-unknown" }),
    ],
    storeIds: new Set(["store-a", "store-b"]),
    availability: "available",
  });
  assert.deepEqual(result.get("store-a")?.observedCounts, {
    processedRecorded: 0,
    processingErrors: 0,
    pendingUnconfirmed: 1,
    invalid: 0,
  });
  assert.deepEqual(result.get("store-b")?.observedCounts, {
    processedRecorded: 0,
    processingErrors: 1,
    pendingUnconfirmed: 0,
    invalid: 0,
  });
  assert.equal(result.get("store-a")?.records.some((item) => item.id === "b"), false);
  assert.equal(result.get("store-a")?.records.some((item) => item.id === "orphan"), false);
  assert.equal(result.get("store-b")?.records.some((item) => item.id === "orphan"), false);
});

test("does not assign a record without a valid store to any summary", () => {
  const result = buildCommercialActionEvidenceByStore({
    rows: [row({ id: "missing-store", store_id: null })],
    storeIds: new Set(["store-a", "store-b"]),
    availability: "available",
  });
  assert.equal(result.get("store-a")?.records.length, 0);
  assert.equal(result.get("store-b")?.records.length, 0);
});

console.log("zion-admin-commercial-action-evidence: 11 tests passed");
