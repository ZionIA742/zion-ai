import test from "node:test";
import assert from "node:assert/strict";

import {
  createOpenAiCostCutoverRunner,
  type CutoverExecutionOptions,
} from "./zion-admin-openai-cost-cutover-runner";

import {
  planOpenAiCostCutoverBridge,
} from "./zion-admin-openai-cost-cutover-planner";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import type {
  OpenAiCostClaimResult,
} from "./zion-admin-openai-cost-claimed-operations";

const NOW = new Date("2026-11-05T12:15:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const TOKEN = "22222222-2222-4222-8222-222222222222";

const REQUEST = new Request(
  "https://example.test/internal-cutover",
  { method: "GET" },
);

const cutover = planOpenAiCostCutoverBridge(NOW);
assert.equal(cutover.status, "ready");

if (cutover.status !== "ready") {
  throw new Error("CUTOVER_PLAN_UNAVAILABLE");
}

const contract = buildOpenAiCostQueryContract(
  cutover.bridge.costsRequest,
);

function claimed(
  overrides: {
    operationId?: string;
    attemptCount?: number;
    alterPeriod?: boolean;
  } = {},
): OpenAiCostClaimResult {
  const claimContract = buildOpenAiCostQueryContract(
    cutover.bridge.costsRequest,
  );

  if (overrides.alterPeriod) {
    claimContract.periodEnd =
      "2026-11-06T00:00:00.000Z";
  }

  return {
    outcome: "claimed",
    claimedCount: 1,
    operations: [{
      operationId: overrides.operationId ?? ID,
      operationKey: cutover.bridge.operationKey,
      claimedBy: "zion-admin-financial-cron-worker",
      claimToken: TOKEN,
      claimExpiresAt: "2026-11-05T12:30:00.000Z",
      attemptCount: overrides.attemptCount ?? 1,
      maxAttempts: 3,
      contract: claimContract,
    }],
  };
}

function setup(
  config: {
    authorized?: boolean;
    enabled?: boolean;
    date?: string;
    inventoryState?: string;
    inventoryBlocked?: boolean;
    preparedInvalid?: boolean;
    claimInvalid?: boolean;
    claimThrows?: boolean;
    emptyClaim?: boolean;
    forgedSuccess?: boolean;
    failureRecorded?: boolean;
    preparedNextAttemptAt?: string;
    afterPreparationNow?: string;
  } = {},
) {
  const calls = {
    auth: 0,
    inspect: 0,
    prepare: 0,
    claim: 0,
    batch: 0,
  };

  let clockReads = 0;

  const options: CutoverExecutionOptions = {
    now: () => {
      clockReads++;

      return clockReads === 1 ||
        !config.afterPreparationNow
        ? NOW
        : new Date(config.afterPreparationNow);
    },
    enabled: () => config.enabled !== false,
    configuredDateUtc: () =>
      config.date ?? "2026-11-05",

    authorize: () => {
      calls.auth++;

      return config.authorized === false
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

      if (config.inventoryBlocked) {
        return {
          status: "blocked",
          reason: "source_unavailable",
        };
      }

      if (config.inventoryState) {
        return {
          status: "existing",
          operationId: ID,
          operationKey: cutover.bridge.operationKey,
          state: config.inventoryState as "pending",
        };
      }

      return { status: "absent" };
    },

    prepare: async () => {
      calls.prepare++;

      return {
        outcome: "created",
        operationId: config.preparedInvalid
          ? OTHER
          : ID,
        operationKey: config.preparedInvalid
          ? "wrong-key"
          : cutover.bridge.operationKey,
        state: "pending",
        attemptCount: 0,
        maxAttempts: 3,
        nextAttemptAt: config.preparedNextAttemptAt ?? NOW.toISOString(),
        snapshotCollectionId: null,
        contract,
      };
    },

    targetedClaim: async () => {
      calls.claim++;

      if (config.claimThrows) {
        throw new Error("CLAIM_TRANSPORT_UNCERTAIN");
      }

      if (config.emptyClaim) {
        return {
          outcome: "claimed",
          claimedCount: 0,
          operations: [],
        };
      }

      return claimed({
        alterPeriod: config.claimInvalid,
      });
    },

    batchRunner: async (request, dependencies) => {
      calls.batch++;

      if (config.forgedSuccess) {
        return {
          outcome: "processed_batch",
          claimedCount: 1,
          confirmedCount: 1,
          failureRecordedCount: 0,
          needsReviewCount: 0,
          operations: [{
            outcome: "confirmed",
            operationId: ID,
            operationKey: cutover.bridge.operationKey,
            snapshotCollectionId: ID,
            snapshotOutcome: "inserted",
          }],
        };
      }

      const result = await dependencies.claim(request);

      if (result.claimedCount === 0) {
        return {
          outcome: "processed_batch",
          claimedCount: 0,
          confirmedCount: 0,
          failureRecordedCount: 0,
          needsReviewCount: 0,
          operations: [],
        };
      }

      if (config.failureRecorded) {
        return {
          outcome: "processed_batch",
          claimedCount: 1,
          confirmedCount: 0,
          failureRecordedCount: 1,
          needsReviewCount: 0,
          operations: [{
            outcome: "failure_recorded",
            operationId: ID,
            operationKey: cutover.bridge.operationKey,
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
          operationKey: cutover.bridge.operationKey,
          snapshotCollectionId: ID,
          snapshotOutcome: "inserted",
        }],
      };
    },
  };

  return {
    runner: createOpenAiCostCutoverRunner(options),
    calls,
  };
}

test("construction performs no financial IO", () => {
  const h = setup();

  assert.deepEqual(h.calls, {
    auth: 0,
    inspect: 0,
    prepare: 0,
    claim: 0,
    batch: 0,
  });
});

test("unauthorized cron cannot read inventory", async () => {
  const h = setup({ authorized: false });

  assert.equal(
    (await h.runner(REQUEST)).status,
    "blocked",
  );

  assert.equal(h.calls.inspect, 0);
});

test("disabled bridge cannot read inventory", async () => {
  const h = setup({ enabled: false });

  assert.equal(
    (await h.runner(REQUEST)).status,
    "blocked",
  );

  assert.equal(h.calls.inspect, 0);
});

test("wrong cutover date blocks all financial IO", async () => {
  const h = setup({ date: "2026-11-06" });

  assert.equal(
    (await h.runner(REQUEST)).status,
    "blocked",
  );

  assert.equal(h.calls.inspect, 0);
});

test("invalid inventory blocks preparation", async () => {
  const h = setup({ inventoryBlocked: true });

  assert.equal(
    (await h.runner(REQUEST)).status,
    "blocked",
  );

  assert.equal(h.calls.prepare, 0);
});

test("confirmed bridge is never recollected", async () => {
  const h = setup({ inventoryState: "confirmed" });

  assert.deepEqual(await h.runner(REQUEST), {
    status: "skipped",
    reason: "already_confirmed",
  });

  assert.equal(h.calls.prepare, 0);
  assert.equal(h.calls.claim, 0);
});

test("existing failed bridge requires review", async () => {
  const h = setup({
    inventoryState: "retryable_failed",
  });

  assert.equal(
    (await h.runner(REQUEST)).status,
    "blocked",
  );

  assert.equal(h.calls.claim, 0);
});

test("existing pending bridge is claimable", async () => {
  const h = setup({ inventoryState: "pending" });

  assert.deepEqual(await h.runner(REQUEST), {
    status: "confirmed",
    dateUtc: "2026-11-03",
  });

  assert.equal(h.calls.prepare, 0);
  assert.equal(h.calls.claim, 1);
});

test("absent bridge is prepared and confirmed", async () => {
  const h = setup();

  assert.deepEqual(await h.runner(REQUEST), {
    status: "confirmed",
    dateUtc: "2026-11-03",
  });

  assert.equal(h.calls.prepare, 1);
  assert.equal(h.calls.claim, 1);
});

test("wrong prepared identity never reaches claim", async () => {
  const h = setup({ preparedInvalid: true });

  assert.equal(
    (await h.runner(REQUEST)).status,
    "needs_review",
  );

  assert.equal(h.calls.claim, 0);
});

test("altered claimed period is blocked", async () => {
  const h = setup({ claimInvalid: true });

  assert.equal(
    (await h.runner(REQUEST)).status,
    "needs_review",
  );
});

test("claim transport uncertainty is not retried", async () => {
  const h = setup({ claimThrows: true });

  assert.equal(
    (await h.runner(REQUEST)).status,
    "needs_review",
  );

  assert.equal(h.calls.claim, 1);
});

test("empty concurrent claim is skipped", async () => {
  const h = setup({ emptyClaim: true });

  assert.deepEqual(await h.runner(REQUEST), {
    status: "skipped",
    reason: "claim_empty",
  });
});

test("recorded financial failure is not success", async () => {
  const h = setup({ failureRecorded: true });

  assert.equal(
    (await h.runner(REQUEST)).status,
    "needs_review",
  );
});

test("forged success without claim is rejected", async () => {
  const h = setup({ forgedSuccess: true });

  assert.equal(
    (await h.runner(REQUEST)).status,
    "needs_review",
  );

  assert.equal(h.calls.claim, 0);
});
test("fresh clock permits an operation prepared after initial time", async () => {
  const h = setup({
    preparedNextAttemptAt:
      "2026-11-05T12:15:01.000Z",
    afterPreparationNow:
      "2026-11-05T12:15:03.000Z",
  });

  assert.deepEqual(await h.runner(REQUEST), {
    status: "confirmed",
    dateUtc: "2026-11-03",
  });

  assert.equal(h.calls.prepare, 1);
  assert.equal(h.calls.claim, 1);
});

test("future database retry time remains blocked", async () => {
  const h = setup({
    preparedNextAttemptAt:
      "2026-11-05T12:15:10.000Z",
    afterPreparationNow:
      "2026-11-05T12:15:03.000Z",
  });

  assert.deepEqual(await h.runner(REQUEST), {
    status: "skipped",
    reason: "not_due",
  });

  assert.equal(h.calls.claim, 0);
});

test("UTC rollover after preparation prevents claim", async () => {
  const h = setup({
    preparedNextAttemptAt:
      "2026-11-05T12:15:01.000Z",
    afterPreparationNow:
      "2026-11-06T00:00:00.000Z",
  });

  assert.deepEqual(await h.runner(REQUEST), {
    status: "needs_review",
    reason: "cutover_date_elapsed",
  });

  assert.equal(h.calls.claim, 0);
});