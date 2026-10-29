import test from "node:test";
import assert from "node:assert/strict";

import type {
  OpenAiCostClaimResult,
} from "./zion-admin-openai-cost-claimed-operations";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import {
  DAILY_OPENAI_COST_CRON_ACTOR,
} from "./zion-admin-openai-cost-daily-claim-validator";

import {
  createDailyOpenAiCostClaimAdapter,
} from "./zion-admin-openai-cost-daily-claim-adapter";

const NOW = new Date("2026-10-29T14:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const TOKEN = "22222222-2222-4222-8222-222222222222";

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

assert.equal(plan.status, "prepare");

function claim(): OpenAiCostClaimResult {
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
}

function setup(options: {
  state?: string;
  operationId?: string;
  operationKey?: string;
  claimResult?: OpenAiCostClaimResult;
  clock?: () => Date;
  failClaim?: boolean;
} = {}) {
  let inspected = 0;
  let claimed = 0;

  const adapter = createDailyOpenAiCostClaimAdapter(ID, {
    now: options.clock ?? (() => NOW),

    inspect: async (identity) => {
      inspected++;
      assert.equal(identity, plan.queryIdentity);

      return {
        status: "existing" as const,
        operationId: options.operationId ?? ID,
        operationKey: options.operationKey ?? plan.operationKey,
        state: (options.state ?? "pending") as "pending",
      };
    },

    targetedClaim: async (request) => {
      claimed++;
      assert.equal(request.operationId, ID);
      assert.equal(
        request.claimedBy,
        DAILY_OPENAI_COST_CRON_ACTOR,
      );

      if (options.failClaim) {
        throw new Error("UNCERTAIN_CLAIM_TRANSPORT");
      }

      return options.claimResult ?? claim();
    },
  });

  return {
    adapter,
    calls: () => ({ inspected, claimed }),
  };
}

const request = {
  limit: 1,
  claimedBy: DAILY_OPENAI_COST_CRON_ACTOR,
};

test("construction performs no inventory or claim IO", () => {
  const h = setup();
  assert.deepEqual(h.calls(), { inspected: 0, claimed: 0 });
});

test("matching pending operation passes both validations", async () => {
  const h = setup();
  const result = await h.adapter(request);

  assert.equal(result.claimedCount, 1);
  assert.deepEqual(h.calls(), { inspected: 1, claimed: 1 });
});

test("wrong worker is denied before inventory", async () => {
  const h = setup();

  await assert.rejects(
    h.adapter({ limit: 1, claimedBy: "human-worker" }),
  );

  assert.deepEqual(h.calls(), { inspected: 0, claimed: 0 });
});

test("batch claim limit is denied", async () => {
  const h = setup();

  await assert.rejects(
    h.adapter({ ...request, limit: 2 }),
  );

  assert.deepEqual(h.calls(), { inspected: 0, claimed: 0 });
});

test("operation ID mismatch blocks claim", async () => {
  const h = setup({ operationId: OTHER });

  await assert.rejects(h.adapter(request));

  assert.deepEqual(h.calls(), { inspected: 1, claimed: 0 });
});

test("operation key mismatch blocks claim", async () => {
  const h = setup({ operationKey: "wrong-key" });

  await assert.rejects(h.adapter(request));

  assert.equal(h.calls().claimed, 0);
});

test("retryable operation cannot be automatically claimed", async () => {
  const h = setup({ state: "retryable_failed" });

  await assert.rejects(h.adapter(request));

  assert.equal(h.calls().claimed, 0);
});

test("confirmed operation cannot be automatically claimed", async () => {
  const h = setup({ state: "confirmed" });

  await assert.rejects(h.adapter(request));

  assert.equal(h.calls().claimed, 0);
});

test("wrong claimed operation is rejected before collection", async () => {
  const result = claim();
  result.operations[0].operationId = OTHER;

  const h = setup({ claimResult: result });

  await assert.rejects(h.adapter(request));

  assert.equal(h.calls().claimed, 1);
});

test("previous attempt is rejected after claim", async () => {
  const result = claim();
  result.operations[0].attemptCount = 2;

  const h = setup({ claimResult: result });

  await assert.rejects(h.adapter(request));

  assert.equal(h.calls().claimed, 1);
});

test("wrong contract is rejected after claim", async () => {
  const result = claim();
  result.operations[0].contract.periodEnd =
    "2026-10-29T00:00:00.000Z";

  const h = setup({ claimResult: result });

  await assert.rejects(h.adapter(request));

  assert.equal(h.calls().claimed, 1);
});

test("empty concurrent claim returns no work", async () => {
  const result: OpenAiCostClaimResult = {
    outcome: "claimed",
    claimedCount: 0,
    operations: [],
  };

  const h = setup({ claimResult: result });

  assert.equal(
    (await h.adapter(request)).claimedCount,
    0,
  );
});

test("transport uncertainty is not retried", async () => {
  const h = setup({ failClaim: true });

  await assert.rejects(h.adapter(request));

  assert.deepEqual(h.calls(), { inspected: 1, claimed: 1 });
});

test("UTC date rollover blocks execution after claim", async () => {
  let reads = 0;

  const h = setup({
    clock: () => {
      reads++;
      return reads === 1
        ? NOW
        : new Date("2026-10-30T00:00:00.000Z");
    },
  });

  await assert.rejects(h.adapter(request));

  assert.equal(h.calls().claimed, 1);
});