import assert from "node:assert/strict";
import test from "node:test";

import {
  runDailyOpenAiCostPreparation,
} from "./zion-admin-openai-cost-daily-preparation-service";

import type {
  DailyPreparationDependencies,
} from "./zion-admin-openai-cost-daily-preparation-service";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import type {
  OpenAiCostPrepareResult,
} from "./zion-admin-openai-cost-operation-preparer";

const NOW = new Date("2026-10-28T15:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";

const request = new Request(
  "https://zionapi.com.br/api/cron/zion-admin-openai-costs",
);

const candidate = planDailyOpenAiCostCollection({
  now: NOW,
  inventoryVerified: true,
  existingQueryIdentities: [],
});

if (candidate.status !== "prepare") {
  throw new Error("INVALID_TEST_PLAN");
}

const PLAN = candidate;

function prepared(
  overrides: Partial<OpenAiCostPrepareResult> = {},
): OpenAiCostPrepareResult {
  return {
    outcome: "created",
    operationId: ID,
    operationKey: PLAN.operationKey,
    state: "pending",
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: "2026-10-28T15:00:00Z",
    snapshotCollectionId: null,
    contract: buildOpenAiCostQueryContract(
      PLAN.costsRequest,
    ),
    ...overrides,
  };
}

function defaults(): DailyPreparationDependencies {
  return {
    authorize: () => ({
      ok: true,
      status: "authorized",
    }),
    isCollectionEnabled: () => true,
    isPreparationEnabled: () => true,
    now: () => NOW,
    resolve: async () => ({
      status: "ready",
      plan: PLAN,
    }),
    prepare: async () => prepared(),
  };
}

test("prepares one pending operation after authorization", async () => {
  let calls = 0;

  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      prepare: async (input) => {
        calls++;
        assert.equal(input.operationKey, PLAN.operationKey);
        assert.equal(input.supersedesOperationId, null);
        return prepared();
      },
    },
  );

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    status: "prepared_pending",
    operationId: ID,
    operationKey: PLAN.operationKey,
  });
});

test("unauthorized request never reaches inventory", async () => {
  let called = false;

  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      authorize: () => ({
        ok: false,
        status: "unauthorized",
      }),
      resolve: async () => {
        called = true;
        throw new Error("must not run");
      },
    },
  );

  assert.equal(result.status, "blocked");
  assert.equal(called, false);
});

test("disabled collection flag prevents preparation", async () => {
  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      isCollectionEnabled: () => false,
    },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "financial_flags_disabled",
  });
});

test("disabled preparation flag prevents preparation", async () => {
  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      isPreparationEnabled: () => false,
    },
  );

  assert.equal(result.status, "blocked");
});

test("existing confirmed operation is never prepared", async () => {
  let called = false;

  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      resolve: async () => ({
        status: "existing",
        dateUtc: PLAN.dateUtc,
        operationId: ID,
        operationKey: "historical-operation",
        state: "confirmed",
      }),
      prepare: async () => {
        called = true;
        return prepared();
      },
    },
  );

  assert.equal(result.status, "existing");
  assert.equal(called, false);
});

test("existing uncertain operation blocks new preparation", async () => {
  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      resolve: async () => ({
        status: "existing",
        dateUtc: PLAN.dateUtc,
        operationId: ID,
        operationKey: "uncertain-operation",
        state: "uncertain",
      }),
    },
  );

  assert.equal(result.status, "existing");
});

test("inventory error prevents RPC invocation", async () => {
  let called = false;

  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      resolve: async () => ({
        status: "blocked",
        reason: "inventory_unavailable",
      }),
      prepare: async () => {
        called = true;
        return prepared();
      },
    },
  );

  assert.equal(result.status, "blocked");
  assert.equal(called, false);
});

test("transport failure never triggers blind retry", async () => {
  let calls = 0;

  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      prepare: async () => {
        calls++;
        throw new Error("network");
      },
    },
  );

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    status: "blocked",
    reason: "preparation_unconfirmed",
  });
});

test("idempotent existing RPC result is not treated as new", async () => {
  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      prepare: async () => prepared({
        outcome: "existing",
      }),
    },
  );

  assert.equal(result.status, "existing");
});

test("mismatched RPC operation key fails closed", async () => {
  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      prepare: async () => prepared({
        operationKey: "wrong",
      }),
    },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "preparation_unconfirmed",
  });
});

test("invalid inventory plan blocks preparation", async () => {
  let called = false;

  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      resolve: async () => ({
        status: "ready",
        plan: {
          ...PLAN,
          queryIdentity: "wrong",
        },
      }),
      prepare: async () => {
        called = true;
        return prepared();
      },
    },
  );

  assert.equal(result.status, "blocked");
  assert.equal(called, false);
});

test("created confirmed response is rejected", async () => {
  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      prepare: async () => prepared({
        state: "confirmed",
        nextAttemptAt: null,
        snapshotCollectionId: ID,
      }),
    },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "preparation_unconfirmed",
  });
});

test("blocks a forged daily operation key", async () => {
  let called = false;

  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      resolve: async () => ({
        status: "ready",
        plan: {
          ...PLAN,
          operationKey: "forged-financial-key",
        },
      }),
      prepare: async () => {
        called = true;
        return prepared();
      },
    },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "inventory_blocked",
  });
  assert.equal(called, false);
});

test("blocks malformed financial request without RPC", async () => {
  let called = false;

  const result = await runDailyOpenAiCostPreparation(
    request,
    {
      ...defaults(),
      resolve: async () => ({
        status: "ready",
        plan: {
          ...PLAN,
          costsRequest: {
            ...PLAN.costsRequest,
            startTime: Number.NaN,
          },
        },
      }),
      prepare: async () => {
        called = true;
        return prepared();
      },
    },
  );

  assert.deepEqual(result, {
    status: "blocked",
    reason: "inventory_blocked",
  });
  assert.equal(called, false);
});
