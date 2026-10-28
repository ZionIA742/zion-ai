import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveDailyOpenAiCostInventory,
} from "./zion-admin-openai-cost-daily-inventory-coordinator";

const NOW = new Date("2026-10-28T15:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";

test("returns a plan only after verified absence", async () => {
  let calls = 0;
  let inspected = "";

  const result = await resolveDailyOpenAiCostInventory(
    NOW,
    {
      inspect: async (identity) => {
        calls++;
        inspected = identity;
        return { status: "absent" };
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.status, "ready");

  if (result.status !== "ready") return;

  assert.equal(result.plan.dateUtc, "2026-10-26");
  assert.equal(result.plan.queryIdentity, inspected);
  assert.equal(
    result.plan.operationKey,
    "zion_admin_openai_costs_2026_10_26_utc_org_v1",
  );
});

test("preserves an existing confirmed operation", async () => {
  const result = await resolveDailyOpenAiCostInventory(
    NOW,
    {
      inspect: async () => ({
        status: "existing",
        operationId: ID,
        operationKey: "historical-key",
        state: "confirmed",
      }),
    },
  );

  assert.equal(result.status, "existing");
  if (result.status !== "existing") return;

  assert.equal(result.operationKey, "historical-key");
  assert.equal(result.state, "confirmed");
});

test("does not prepare over an uncertain operation", async () => {
  const result = await resolveDailyOpenAiCostInventory(
    NOW,
    {
      inspect: async () => ({
        status: "existing",
        operationId: ID,
        operationKey: "uncertain-key",
        state: "uncertain",
      }),
    },
  );

  assert.equal(result.status, "existing");
});

test("blocks inventory source failures", async () => {
  const result = await resolveDailyOpenAiCostInventory(
    NOW,
    {
      inspect: async () => ({
        status: "blocked",
        reason: "source_unavailable",
      }),
    },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "inventory_unavailable",
  });
});

test("blocks duplicate operations", async () => {
  const result = await resolveDailyOpenAiCostInventory(
    NOW,
    {
      inspect: async () => ({
        status: "blocked",
        reason: "multiple_operations",
      }),
    },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "multiple_operations",
  });
});

test("blocks thrown inventory errors", async () => {
  const result = await resolveDailyOpenAiCostInventory(
    NOW,
    {
      inspect: async () => {
        throw new Error("transport");
      },
    },
  );

  assert.equal(result.status, "blocked");
});

test("rejects invalid dates without inventory access", async () => {
  let called = false;

  const result = await resolveDailyOpenAiCostInventory(
    new Date("invalid"),
    {
      inspect: async () => {
        called = true;
        return { status: "absent" };
      },
    },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "invalid_plan",
  });

  assert.equal(called, false);
});

test("blocks unexpected inventory responses", async () => {
  const result = await resolveDailyOpenAiCostInventory(
    NOW,
    {
      inspect: async () => ({
        status: "unknown",
      }) as never,
    },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "inventory_invalid",
  });
});
