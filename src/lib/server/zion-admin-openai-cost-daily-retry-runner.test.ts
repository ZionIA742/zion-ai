import test from "node:test";
import assert from "node:assert/strict";

import {
  createDailyOpenAiCostRetryRunner,
  type DailyRetryRunnerOptions,
} from "./zion-admin-openai-cost-daily-retry-runner";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import type {
  OpenAiCostClaimResult,
} from "./zion-admin-openai-cost-claimed-operations";

const NOW = new Date("2026-11-05T12:20:11.000Z");
const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const TOKEN = "22222222-2222-4222-8222-222222222222";

const request = new Request(
  "https://example.test/api/cron/zion-admin-openai-costs",
  { method: "GET" },
);

const plan = planDailyOpenAiCostCollection({
  now: NOW,
  inventoryVerified: true,
  existingQueryIdentities: [],
});

assert.equal(plan.status, "prepare");
if (plan.status !== "prepare") {
  throw new Error("PLAN_UNAVAILABLE");
}

function claim(
  changes: {
    attemptCount?: number;
    operationId?: string;
    periodEnd?: string;
    queryIdentity?: string;
    queryParameters?: unknown;
  } = {},
): OpenAiCostClaimResult {
  const contract = buildOpenAiCostQueryContract(
    plan.costsRequest,
  );

  if (changes.periodEnd) {
    contract.periodEnd = changes.periodEnd;
  }

  if (changes.queryIdentity) {
    contract.queryIdentity = changes.queryIdentity;
  }

  if (changes.queryParameters) {
    contract.queryParameters =
      changes.queryParameters as typeof contract.queryParameters;
  }

  return {
    outcome: "claimed",
    claimedCount: 1,
    operations: [{
      operationId: changes.operationId ?? ID,
      operationKey: plan.operationKey,
      claimedBy: "zion-admin-financial-cron-worker",
      claimToken: TOKEN,
      claimExpiresAt: "2026-11-05T12:35:00.000Z",
      attemptCount: changes.attemptCount ?? 2,
      maxAttempts: 3,
      contract,
    }],
  };
}

function setup(
  changes: {
    authorized?: boolean;
    readerStatus?: "ready" | "skipped";
    readerId?: string;
    attemptCount?: number;
    tamperPeriod?: boolean;
    claimId?: string;
    claimThrows?: boolean;
    emptyClaim?: boolean;
    failRecorded?: boolean;
    forgedResult?: boolean;
  } = {},
) {
  const calls = {
    auth: 0,
    inspect: 0,
    claim: 0,
    batch: 0,
  };

  const options: DailyRetryRunnerOptions = {
    now: () => NOW,

    authorize: () => {
      calls.auth++;

      return changes.authorized === false
        ? {
            ok: false,
            status: "blocked",
            reason: "cron_unauthorized",
          }
        : {
            ok: true,
            status: "authorized",
          };
    },

    inspect: async () => {
      calls.inspect++;

      if (changes.readerStatus === "skipped") {
        return {
          status: "skipped",
          reason: "not_due",
        };
      }

      return {
        status: "ready",
        operationId: changes.readerId ?? ID,
        operationKey: plan.operationKey,
        queryIdentity: plan.queryIdentity,
      };
    },

    targetedClaim: async () => {
      calls.claim++;

      if (changes.claimThrows) {
        throw new Error("CLAIM_TRANSPORT_UNCERTAIN");
      }

      if (changes.emptyClaim) {
        return {
          outcome: "claimed",
          claimedCount: 0,
          operations: [],
        };
      }

      return claim({
        attemptCount: changes.attemptCount,
        operationId: changes.claimId,
        periodEnd: changes.tamperPeriod
          ? "2026-11-06T00:00:00.000Z"
          : undefined,
      });
    },

    batchRunner: async (batchRequest, dependencies) => {
      calls.batch++;

      if (changes.forgedResult) {
        return {
          outcome: "processed_batch",
          claimedCount: 1,
          confirmedCount: 1,
          failureRecordedCount: 0,
          needsReviewCount: 0,
          operations: [{
            outcome: "confirmed",
            operationId: ID,
            operationKey: plan.operationKey,
            snapshotCollectionId: ID,
            snapshotOutcome: "inserted",
          }],
        };
      }

      const claimed = await dependencies.claim(
        batchRequest,
      );

      if (claimed.claimedCount === 0) {
        return {
          outcome: "processed_batch",
          claimedCount: 0,
          confirmedCount: 0,
          failureRecordedCount: 0,
          needsReviewCount: 0,
          operations: [],
        };
      }

      if (changes.failRecorded) {
        return {
          outcome: "processed_batch",
          claimedCount: 1,
          confirmedCount: 0,
          failureRecordedCount: 1,
          needsReviewCount: 0,
          operations: [{
            outcome: "failure_recorded",
            operationId: ID,
            operationKey: plan.operationKey,
            state: "retryable_failed",
            retryScheduled: true,
          }],
        };
      }

      return {
        outcome: "processed_batch",
        claimedCount: 1,
        confirmedCount: 1,
        failureRecordedCount: 0,
        needsReviewCount: 0,
        operations: [{
          outcome: "confirmed",
          operationId: ID,
          operationKey: plan.operationKey,
          snapshotCollectionId: ID,
          snapshotOutcome: "inserted",
        }],
      };
    },
  };

  return {
    runner: createDailyOpenAiCostRetryRunner(options),
    calls,
  };
}

test("construction performs no financial IO", () => {
  const h = setup();
  assert.deepEqual(h.calls, {
    auth: 0,
    inspect: 0,
    claim: 0,
    batch: 0,
  });
});

test("unauthorized cron performs no inventory IO", async () => {
  const h = setup({ authorized: false });

  const result = await h.runner(request);

  assert.equal(result.status, "blocked");
  assert.equal(h.calls.inspect, 0);
  assert.equal(h.calls.claim, 0);
});

test("not-due operation is never claimed", async () => {
  const h = setup({ readerStatus: "skipped" });

  assert.deepEqual(
    await h.runner(request),
    { status: "skipped", reason: "not_due" },
  );

  assert.equal(h.calls.claim, 0);
});

test("mismatched candidate is blocked before claim", async () => {
  const h = setup({ readerId: "invalid" });

  assert.equal(
    (await h.runner(request)).status,
    "blocked",
  );

  assert.equal(h.calls.claim, 0);
});

test("valid second attempt is accepted", async () => {
  const h = setup({ attemptCount: 2 });

  assert.deepEqual(
    await h.runner(request),
    { status: "confirmed", operationId: ID },
  );

  assert.equal(h.calls.claim, 1);
});

test("valid third attempt is accepted", async () => {
  const h = setup({ attemptCount: 3 });

  assert.equal(
    (await h.runner(request)).status,
    "confirmed",
  );

  assert.equal(h.calls.claim, 1);
});

test("first attempt cannot enter retry executor", async () => {
  const h = setup({ attemptCount: 1 });

  assert.equal(
    (await h.runner(request)).status,
    "needs_review",
  );
});

test("wrong operation ID cannot be collected", async () => {
  const h = setup({ claimId: OTHER });

  assert.equal(
    (await h.runner(request)).status,
    "needs_review",
  );
});

test("altered financial period cannot be collected", async () => {
  const h = setup({ tamperPeriod: true });

  assert.equal(
    (await h.runner(request)).status,
    "needs_review",
  );
});

test("uncertain claim is never repeated", async () => {
  const h = setup({ claimThrows: true });

  assert.equal(
    (await h.runner(request)).status,
    "needs_review",
  );

  assert.equal(h.calls.claim, 1);
});

test("empty concurrent claim is skipped", async () => {
  const h = setup({ emptyClaim: true });

  assert.deepEqual(
    await h.runner(request),
    { status: "skipped", reason: "claim_empty" },
  );
});

test("recorded temporary failure is not success", async () => {
  const h = setup({ failRecorded: true });

  assert.deepEqual(
    await h.runner(request),
    {
      status: "failure_recorded",
      operationId: ID,
      retryScheduled: true,
    },
  );
});

test("fabricated success without claim is rejected", async () => {
  const h = setup({ forgedResult: true });

  assert.equal(
    (await h.runner(request)).status,
    "needs_review",
  );

  assert.equal(h.calls.claim, 0);
});