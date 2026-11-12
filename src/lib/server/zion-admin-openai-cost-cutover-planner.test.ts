import test from "node:test";
import assert from "node:assert/strict";

import {
  planOpenAiCostCutoverBridge,
} from "./zion-admin-openai-cost-cutover-planner";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

function ready(iso: string) {
  const result = planOpenAiCostCutoverBridge(
    new Date(iso),
  );

  assert.equal(result.status, "ready");

  if (result.status !== "ready") {
    throw new Error("CUTOVER_PLAN_UNAVAILABLE");
  }

  return result;
}

test("November fifth bridges UTC November third", () => {
  const result = ready("2026-11-05T12:15:00.000Z");

  assert.equal(result.bridge.dateUtc, "2026-11-03");
  assert.equal(result.regular.dateUtc, "2026-11-04");
});

test("November sixth bridges UTC November fourth", () => {
  const result = ready("2026-11-06T12:15:00.000Z");

  assert.equal(result.bridge.dateUtc, "2026-11-04");
  assert.equal(result.regular.dateUtc, "2026-11-05");
});

test("November seventh moves the bridge forward", () => {
  const result = ready("2026-11-07T12:15:00.000Z");

  assert.equal(result.bridge.dateUtc, "2026-11-05");
  assert.equal(result.regular.dateUtc, "2026-11-06");
});

test("bridge and regular periods are adjacent", () => {
  const result = ready("2026-11-05T12:15:00.000Z");

  assert.equal(
    result.bridge.costsRequest.endTime,
    result.regular.costsRequest.startTime,
  );

  assert.equal(
    result.bridge.costsRequest.endTime -
      result.bridge.costsRequest.startTime,
    86400,
  );

  assert.equal(
    result.regular.costsRequest.endTime -
      result.regular.costsRequest.startTime,
    86400,
  );
});

test("bridge reuses the canonical daily identity", () => {
  const now = new Date("2026-11-05T12:15:00.000Z");

  const bridge = planDailyOpenAiCostCollection({
    now: new Date(now.getTime() - 86400000),
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  const cutover = planOpenAiCostCutoverBridge(now);

  assert.equal(bridge.status, "prepare");
  assert.equal(cutover.status, "ready");

  if (
    bridge.status !== "prepare" ||
    cutover.status !== "ready"
  ) {
    return;
  }

  assert.equal(
    cutover.bridge.operationKey,
    bridge.operationKey,
  );

  assert.equal(
    cutover.bridge.queryIdentity,
    bridge.queryIdentity,
  );

  assert.deepEqual(
    cutover.bridge.costsRequest,
    bridge.costsRequest,
  );
});

test("identities differ between the two UTC days", () => {
  const result = ready("2026-11-05T12:15:00.000Z");

  assert.notEqual(
    result.bridge.operationKey,
    result.regular.operationKey,
  );

  assert.notEqual(
    result.bridge.queryIdentity,
    result.regular.queryIdentity,
  );
});

test("month transition remains UTC based", () => {
  const result = ready("2026-12-01T12:15:00.000Z");

  assert.equal(result.bridge.dateUtc, "2026-11-29");
  assert.equal(result.regular.dateUtc, "2026-11-30");
});

test("year transition remains UTC based", () => {
  const result = ready("2027-01-01T12:15:00.000Z");

  assert.equal(result.bridge.dateUtc, "2026-12-30");
  assert.equal(result.regular.dateUtc, "2026-12-31");
});

test("the UTC date does not depend on local time", () => {
  const result = ready("2026-11-05T23:59:00.000Z");

  assert.equal(result.bridge.dateUtc, "2026-11-03");
  assert.equal(result.regular.dateUtc, "2026-11-04");
});

test("invalid dates fail closed", () => {
  for (const date of [
    new Date(NaN),
    new Date(0),
    new Date(86400000),
  ]) {
    assert.equal(
      planOpenAiCostCutoverBridge(date).status,
      "blocked",
    );
  }
});

test("planning is deterministic", () => {
  const now = new Date("2026-11-05T12:15:00.000Z");

  assert.deepEqual(
    planOpenAiCostCutoverBridge(now),
    planOpenAiCostCutoverBridge(now),
  );
});