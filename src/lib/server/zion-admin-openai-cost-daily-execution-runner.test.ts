import test from "node:test";
import assert from "node:assert/strict";

import {
  createDailyOpenAiCostExecutionRunner,
} from "./zion-admin-openai-cost-daily-execution-runner";

import {
  DAILY_OPENAI_COST_CRON_ACTOR,
} from "./zion-admin-openai-cost-daily-claim-validator";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import type {
  OpenAiCostBatchResult,
} from "./zion-admin-openai-cost-batch-coordinator";

const NOW = new Date("2026-10-29T14:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const plan = (() => {
  const candidate = planDailyOpenAiCostCollection({
    now: NOW,
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  if (candidate.status !== "prepare") {
    throw new Error("PLAN_UNAVAILABLE");
  }

  return candidate;
})();

const request = new Request(
  "https://example.test/api/cron/zion-admin-openai-costs",
  { method: "GET" },
);

function confirmed(
  operationId = ID,
  operationKey = plan.operationKey,
): OpenAiCostBatchResult {
  return {
    outcome: "processed_batch",
    claimedCount: 1,
    confirmedCount: 1,
    failureRecordedCount: 0,
    needsReviewCount: 0,
    operations: [{
      outcome: "confirmed",
      operationId,
      operationKey,
      snapshotCollectionId: operationId,
      snapshotOutcome: "inserted",
    }],
  };
}

function setup(options: {
  authorized?: boolean;
  preparationState?: "pending" | "confirmed" | "uncertain";
  preparedKey?: string;
  preparedId?: string;
  preparedNew?: boolean;
  batchResult?: OpenAiCostBatchResult;
  batchThrows?: boolean;
  clock?: () => Date;
} = {}) {
  let preparations = 0;
  let batches = 0;

  const runner = createDailyOpenAiCostExecutionRunner({
    now: options.clock ?? (() => NOW),

    authorize: () =>
      options.authorized === false
        ? {
            ok: false,
            status: "blocked",
            reason: "financial_execution_disabled",
          }
        : { ok: true, status: "authorized" },

    prepare: async () => {
      preparations++;

      if (options.preparedNew) {
        return {
          status: "prepared_pending" as const,
          operationId: options.preparedId ?? ID,
          operationKey:
            options.preparedKey ?? plan.operationKey,
        };
      }

      return {
        status: "existing" as const,
        operationId: options.preparedId ?? ID,
        state: options.preparationState ?? "pending",
      };
    },

    batchRunner: async (claimRequest) => {
      batches++;

      assert.equal(claimRequest.limit, 1);
      assert.equal(
        claimRequest.claimedBy,
        DAILY_OPENAI_COST_CRON_ACTOR,
      );

      if (options.batchThrows) {
        throw new Error("UNCERTAIN_BATCH");
      }

      return options.batchResult ?? confirmed();
    },
  });

  return {
    runner,
    calls: () => ({ preparations, batches }),
  };
}

test("construction performs no financial IO", () => {
  const h = setup();
  assert.deepEqual(h.calls(), {
    preparations: 0,
    batches: 0,
  });
});

test("denied authorization blocks preparation and batch", async () => {
  const h = setup({ authorized: false });

  const result = await h.runner(request);

  assert.deepEqual(result, {
    status: "blocked",
    reason: "authorization_denied",
  });

  assert.deepEqual(h.calls(), {
    preparations: 0,
    batches: 0,
  });
});

test("valid pending daily operation is confirmed", async () => {
  const h = setup();
  const result = await h.runner(request);

  assert.deepEqual(result, {
    status: "confirmed",
    operationId: ID,
  });

  assert.deepEqual(h.calls(), {
    preparations: 1,
    batches: 1,
  });
});

test("newly prepared operation uses canonical key", async () => {
  const h = setup({ preparedNew: true });

  assert.equal(
    (await h.runner(request)).status,
    "confirmed",
  );
});

test("forged prepared key is blocked before batch", async () => {
  const h = setup({
    preparedNew: true,
    preparedKey: "forged-operation",
  });

  assert.deepEqual(await h.runner(request), {
    status: "blocked",
    reason: "invalid_operation",
  });

  assert.equal(h.calls().batches, 0);
});

test("invalid prepared operation ID blocks batch", async () => {
  const h = setup({ preparedId: "not-a-uuid" });

  assert.equal(
    (await h.runner(request)).status,
    "blocked",
  );

  assert.equal(h.calls().batches, 0);
});

test("confirmed existing operation is not reprocessed", async () => {
  const h = setup({ preparationState: "confirmed" });

  assert.deepEqual(await h.runner(request), {
    status: "skipped",
    reason: "not_pending",
  });

  assert.equal(h.calls().batches, 0);
});

test("uncertain operation is never automatically retried", async () => {
  const h = setup({ preparationState: "uncertain" });

  assert.deepEqual(await h.runner(request), {
    status: "skipped",
    reason: "not_pending",
  });

  assert.equal(h.calls().batches, 0);
});

test("wrong processed operation cannot confirm money", async () => {
  const h = setup({
    batchResult: confirmed(OTHER),
  });

  assert.deepEqual(await h.runner(request), {
    status: "needs_review",
    reason: "outcome_unconfirmed",
    operationId: ID,
  });
});

test("wrong operation key cannot confirm money", async () => {
  const h = setup({
    batchResult: confirmed(ID, "wrong-key"),
  });

  assert.equal(
    (await h.runner(request)).status,
    "needs_review",
  );
});

test("batch failure never causes another execution", async () => {
  const h = setup({ batchThrows: true });

  assert.deepEqual(await h.runner(request), {
    status: "needs_review",
    reason: "execution_uncertain",
    operationId: ID,
  });

  assert.equal(h.calls().batches, 1);
});

test("empty concurrent claim is not financial success", async () => {
  const h = setup({
    batchResult: {
      outcome: "processed_batch",
      claimedCount: 0,
      confirmedCount: 0,
      failureRecordedCount: 0,
      needsReviewCount: 0,
      operations: [],
    },
  });

  assert.deepEqual(await h.runner(request), {
    status: "skipped",
    reason: "claim_empty",
  });
});

test("UTC rollover before batch prevents execution", async () => {
  let reads = 0;

  const h = setup({
    clock: () => {
      reads++;
      return reads === 1
        ? NOW
        : new Date("2026-10-30T00:00:00.000Z");
    },
  });

  assert.deepEqual(await h.runner(request), {
    status: "blocked",
    reason: "utc_day_changed",
  });

  assert.equal(h.calls().batches, 0);
});

test("real claim adapter validates identity before collection", async () => {
  let inspected = 0;
  let claims = 0;
  let collections = 0;

  const runner = createDailyOpenAiCostExecutionRunner({
    now: () => NOW,

    authorize: () => ({
      ok: true,
      status: "authorized",
    }),

    prepare: async () => ({
      status: "existing",
      operationId: ID,
      state: "pending",
    }),

    claimAdapterOptions: {
      inspect: async (identity) => {
        inspected++;
        assert.equal(identity, plan.queryIdentity);

        return {
          status: "existing",
          operationId: ID,
          operationKey: plan.operationKey,
          state: "pending",
        };
      },

      targetedClaim: async (target) => {
        claims++;
        assert.equal(target.operationId, ID);

        return {
          outcome: "claimed",
          claimedCount: 1,
          operations: [{
            operationId: ID,
            operationKey: plan.operationKey,
            claimedBy: DAILY_OPENAI_COST_CRON_ACTOR,
            claimToken: TOKEN,
            claimExpiresAt: "2026-10-29T14:15:00.000Z",
            attemptCount: 1,
            maxAttempts: 3,
            contract: buildOpenAiCostQueryContract(
              plan.costsRequest,
            ),
          }],
        };
      },
    },

    batchRunner: async (claimRequest, dependencies) => {
      const claimed = await dependencies.claim(claimRequest);

      assert.equal(claimed.claimedCount, 1);
      collections++;

      return confirmed();
    },
  });

  assert.equal(
    (await runner(request)).status,
    "confirmed",
  );

  assert.equal(inspected, 1);
  assert.equal(claims, 1);
  assert.equal(collections, 1);
});

test("invalid post-claim contract prevents collection", async () => {
  let collections = 0;

  const runner = createDailyOpenAiCostExecutionRunner({
    now: () => NOW,

    authorize: () => ({
      ok: true,
      status: "authorized",
    }),

    prepare: async () => ({
      status: "existing",
      operationId: ID,
      state: "pending",
    }),

    claimAdapterOptions: {
      inspect: async () => ({
        status: "existing",
        operationId: ID,
        operationKey: plan.operationKey,
        state: "pending",
      }),

      targetedClaim: async () => {
        const contract = buildOpenAiCostQueryContract(
          plan.costsRequest,
        );

        contract.periodEnd =
          "2026-10-29T00:00:00.000Z";

        return {
          outcome: "claimed",
          claimedCount: 1,
          operations: [{
            operationId: ID,
            operationKey: plan.operationKey,
            claimedBy: DAILY_OPENAI_COST_CRON_ACTOR,
            claimToken: TOKEN,
            claimExpiresAt: "2026-10-29T14:15:00.000Z",
            attemptCount: 1,
            maxAttempts: 3,
            contract,
          }],
        };
      },
    },

    batchRunner: async (claimRequest, dependencies) => {
      await dependencies.claim(claimRequest);
      collections++;

      return confirmed();
    },
  });

  assert.deepEqual(await runner(request), {
    status: "needs_review",
    reason: "execution_uncertain",
    operationId: ID,
  });

  assert.equal(collections, 0);
});