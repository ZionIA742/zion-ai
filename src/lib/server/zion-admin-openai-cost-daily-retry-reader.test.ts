import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectDueDailyOpenAiCostRetry,
} from "./zion-admin-openai-cost-daily-retry-reader";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

const NOW = new Date("2026-11-05T12:20:11.000Z");

function fixture(
  overrides: Record<string, unknown> = {},
) {
  const plan = planDailyOpenAiCostCollection({
    now: NOW,
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  assert.equal(plan.status, "prepare");

  if (plan.status !== "prepare") {
    throw new Error("PLAN_UNAVAILABLE");
  }

  const contract = buildOpenAiCostQueryContract(
    plan.costsRequest,
  );

  return {
    id: "11111111-1111-4111-8111-111111111111",
    operation_key: plan.operationKey,
    query_identity: plan.queryIdentity,
    query_parameters: contract.queryParameters,
    provider: "openai",
    source: "openai_organization_costs",
    state: "retryable_failed",
    attempt_count: 1,
    max_attempts: 3,
    next_attempt_at: "2026-11-05T12:20:10.000Z",
    period_start: new Date(
      plan.costsRequest.startTime * 1000,
    ).toISOString(),
    period_end: new Date(
      plan.costsRequest.endTime * 1000,
    ).toISOString(),
    claim_token: null,
    claim_expires_at: null,
    snapshot_collection_id: null,
    confirmed_at: null,
    ...overrides,
  };
}

function lookup(
  rows: unknown[],
  now = NOW,
) {
  return inspectDueDailyOpenAiCostRetry(
    now,
    {
      load: async () => ({
        data: rows,
        error: null,
      }),
    },
  );
}

test("accepts due retryable operation", async () => {
  const result = await lookup([fixture()]);

  assert.equal(result.status, "ready");
});

test("accepts second due retry", async () => {
  const result = await lookup([
    fixture({ attempt_count: 2 }),
  ]);

  assert.equal(result.status, "ready");
});

test("reads only the canonical planned identity", async () => {
  const plan = planDailyOpenAiCostCollection({
    now: NOW,
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  assert.equal(plan.status, "prepare");
  if (plan.status !== "prepare") return;

  let calls = 0;

  const result = await inspectDueDailyOpenAiCostRetry(
    NOW,
    {
      load: async (identity) => {
        calls++;

        assert.equal(
          identity,
          plan.queryIdentity,
        );

        return {
          data: [fixture()],
          error: null,
        };
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.status, "ready");
});

test("empty inventory never produces work", async () => {
  assert.deepEqual(
    await lookup([]),
    { status: "skipped", reason: "not_found" },
  );
});

test("confirmed and uncertain rows are skipped", async () => {
  for (const state of [
    "confirmed",
    "uncertain",
    "permanent_failed",
    "processing",
    "pending",
  ]) {
    assert.deepEqual(
      await lookup([fixture({ state })]),
      { status: "skipped", reason: "not_retryable" },
    );
  }
});

test("future retry is not executed", async () => {
  assert.deepEqual(
    await lookup([
      fixture({
        next_attempt_at:
          "2026-11-05T12:30:00.000Z",
      }),
    ]),
    { status: "skipped", reason: "not_due" },
  );
});

test("duplicate financial identity blocks", async () => {
  const result = await lookup([
    fixture(),
    fixture({
      id: "22222222-2222-4222-8222-222222222222",
    }),
  ]);

  assert.deepEqual(result, {
    status: "blocked",
    reason: "multiple_operations",
  });
});

test("database failures block", async () => {
  const result = await inspectDueDailyOpenAiCostRetry(
    NOW,
    {
      load: async () => ({
        data: null,
        error: { message: "database unavailable" },
      }),
    },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "source_unavailable",
  });
});

test("transport failures block", async () => {
  const result = await inspectDueDailyOpenAiCostRetry(
    NOW,
    {
      load: async () => {
        throw new Error("network unavailable");
      },
    },
  );

  assert.equal(result.status, "blocked");
});

test("wrong operation identity blocks", async () => {
  for (const changes of [
    { id: "invalid" },
    { operation_key: "other" },
    { query_identity: "other" },
    { provider: "other" },
    { source: "other" },
    { state: "unexpected" },
  ]) {
    const result = await lookup([
      fixture(changes),
    ]);

    assert.equal(result.status, "blocked");
  }
});

test("financial contract tampering blocks", async () => {
  for (const changes of [
    { query_parameters: {} },
    {
      period_start:
        "2026-11-03T00:00:00.000Z",
    },
    {
      period_end:
        "2026-11-06T00:00:00.000Z",
    },
  ]) {
    const result = await lookup([
      fixture(changes),
    ]);

    assert.equal(result.status, "blocked");
  }
});

test("claimed or confirmed evidence blocks", async () => {
  for (const changes of [
    {
      claim_token:
        "22222222-2222-4222-8222-222222222222",
    },
    {
      snapshot_collection_id:
        "22222222-2222-4222-8222-222222222222",
    },
    {
      confirmed_at:
        "2026-11-05T12:20:00.000Z",
    },
  ]) {
    const result = await lookup([
      fixture(changes),
    ]);

    assert.equal(result.status, "blocked");
  }
});

test("exhausted retry blocks", async () => {
  const result = await lookup([
    fixture({ attempt_count: 3 }),
  ]);

  assert.equal(result.status, "blocked");
});

test("previous UTC period cannot be resumed", async () => {
  const result = await lookup(
    [fixture()],
    new Date("2026-11-06T12:20:11.000Z"),
  );

  assert.equal(result.status, "blocked");
});

test("invalid clock blocks before lookup", async () => {
  let calls = 0;

  const result = await inspectDueDailyOpenAiCostRetry(
    new Date(NaN),
    {
      load: async () => {
        calls++;
        return { data: [], error: null };
      },
    },
  );

  assert.equal(result.status, "blocked");
  assert.equal(calls, 0);
});