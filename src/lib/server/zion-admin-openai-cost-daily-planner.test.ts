import assert from "node:assert/strict";
import test from "node:test";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

const NOW = new Date("2026-10-28T15:00:00.000Z");

function plan(existingQueryIdentities: string[] = []) {
  return planDailyOpenAiCostCollection({
    now: NOW,
    inventoryVerified: true,
    existingQueryIdentities,
  });
}

test("plans exactly one UTC day with a two-day lag", () => {
  const result = plan();

  assert.equal(result.status, "prepare");
  if (result.status !== "prepare") return;

  assert.equal(result.dateUtc, "2026-10-26");
  assert.deepEqual(result.costsRequest.groupBy, [
    "line_item",
    "project_id",
  ]);
  assert.equal(result.costsRequest.limit, 1);
  assert.equal(
    result.costsRequest.endTime -
      result.costsRequest.startTime,
    86400,
  );
});

test("generates deterministic operation keys", () => {
  const first = plan();
  const second = plan();

  assert.deepEqual(first, second);

  if (first.status !== "prepare") return;

  assert.equal(
    first.operationKey,
    "zion_admin_openai_costs_2026_10_26_utc_org_v1",
  );
});

test("preserves the canonical financial query identity", () => {
  const result = plan();

  assert.equal(result.status, "prepare");
  if (result.status !== "prepare") return;

  assert.ok(
    result.queryIdentity.includes("limit=1"),
  );
  assert.ok(
    result.queryIdentity.includes("group_by=line_item"),
  );
  assert.ok(
    result.queryIdentity.includes("group_by=project_id"),
  );
});

test("blocks preparation without verified inventory", () => {
  const result = planDailyOpenAiCostCollection({
    now: NOW,
    inventoryVerified: false,
    existingQueryIdentities: [],
  });

  assert.deepEqual(result, {
    status: "blocked",
    reason: "inventory_unverified",
  });
});

test("skips existing identity regardless of operation key", () => {
  const first = plan();

  assert.equal(first.status, "prepare");
  if (first.status !== "prepare") return;

  const second = plan([first.queryIdentity]);

  assert.equal(second.status, "existing");
});

test("does not confuse local timezone with UTC date", () => {
  const result = planDailyOpenAiCostCollection({
    now: new Date("2026-10-28T00:30:00+03:00"),
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  assert.equal(result.status, "prepare");
  if (result.status !== "prepare") return;

  assert.equal(result.dateUtc, "2026-10-25");
});

test("rejects invalid inventory entries", () => {
  const result = planDailyOpenAiCostCollection({
    now: NOW,
    inventoryVerified: true,
    existingQueryIdentities: [""],
  });

  assert.deepEqual(result, {
    status: "blocked",
    reason: "invalid_input",
  });
});
