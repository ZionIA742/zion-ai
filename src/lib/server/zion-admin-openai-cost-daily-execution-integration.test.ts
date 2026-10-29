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

import {
  OpenAiOrganizationCostsCollectorError,
} from "./openai-organization-costs-collector";

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

const request = new Request(
  "https://example.test/api/cron/zion-admin-openai-costs",
  { method: "GET" },
);

type Mode =
  | "success"
  | "denied"
  | "not_pending"
  | "inventory_wrong_key"
  | "inventory_retryable"
  | "claim_wrong_id"
  | "claim_wrong_contract"
  | "claim_uncertain"
  | "claim_empty"
  | "claim_expired"
  | "collector_retryable"
  | "finalization_uncertain"
  | "finalization_wrong_id";

function setup(mode: Mode = "success") {
  const calls = {
    preparation: 0,
    inventory: 0,
    claim: 0,
    collection: 0,
    finalization: 0,
    failure: 0,
  };

  const runner = createDailyOpenAiCostExecutionRunner({
    now: () => NOW,

    authorize: () =>
      mode === "denied"
        ? {
            ok: false,
            status: "blocked",
            reason: "financial_execution_disabled",
          }
        : {
            ok: true,
            status: "authorized",
          },

    prepare: async () => {
      calls.preparation++;

      return {
        status: "existing" as const,
        operationId: ID,
        state: mode === "not_pending"
          ? "retryable_failed" as const
          : "pending" as const,
      };
    },

    claimAdapterOptions: {
      inspect: async (identity) => {
        calls.inventory++;

        assert.equal(identity, plan.queryIdentity);

        return {
          status: "existing" as const,
          operationId: ID,
          operationKey: mode === "inventory_wrong_key"
            ? "incorrect-key"
            : plan.operationKey,
          state: mode === "inventory_retryable"
            ? "retryable_failed" as const
            : "pending" as const,
        };
      },

      targetedClaim: async (target) => {
        calls.claim++;

        assert.equal(target.operationId, ID);
        assert.equal(
          target.claimedBy,
          DAILY_OPENAI_COST_CRON_ACTOR,
        );

        if (mode === "claim_uncertain") {
          throw new Error("CLAIM_TRANSPORT_UNCERTAIN");
        }

        if (mode === "claim_empty") {
          return {
            outcome: "claimed" as const,
            claimedCount: 0,
            operations: [],
          };
        }

        const contract = buildOpenAiCostQueryContract(
          plan.costsRequest,
        );

        if (mode === "claim_wrong_contract") {
          contract.periodEnd =
            "2026-10-29T00:00:00.000Z";
        }

        return {
          outcome: "claimed" as const,
          claimedCount: 1,
          operations: [{
            operationId: mode === "claim_wrong_id"
              ? OTHER
              : ID,
            operationKey: plan.operationKey,
            claimedBy: DAILY_OPENAI_COST_CRON_ACTOR,
            claimToken: TOKEN,
            claimExpiresAt: mode === "claim_expired"
              ? "2026-10-29T13:59:59.000Z"
              : "2026-10-29T14:15:00.000Z",
            attemptCount: 1,
            maxAttempts: 3 as const,
            contract,
          }],
        };
      },
    },

    adapterOptions: {
      collect: async (costsRequest, context) => {
        if (!context) {
          throw new Error("COLLECTION_CONTEXT_MISSING");
        }

        calls.collection++;

        assert.equal(context.collectionId, ID);

        const contract = buildOpenAiCostQueryContract(
          costsRequest,
        );

        assert.equal(
          contract.queryIdentity,
          plan.queryIdentity,
        );

        if (mode === "collector_retryable") {
          throw new OpenAiOrganizationCostsCollectorError(
            "OPENAI_COSTS_RATE_LIMITED",
            true,
          );
        }

        return {
          source: "openai_organization_costs",
          provider: "openai",
          status: "confirmed_empty",
          collectionId: context.collectionId,
          queryIdentity: contract.queryIdentity,
          period: {
            startTime: costsRequest.startTime,
            endTime: costsRequest.endTime,
            bucketWidth: "1d",
            providerPeriodTimezone: "UTC",
            financialCompetence: null,
          },
          groupBy: [...(costsRequest.groupBy ?? [])],
          pages: 1,
          records: [],
        };
      },

      finalize: async (operation, collection) => {
        calls.finalization++;

        assert.equal(operation.operationId, ID);
        assert.equal(collection.collectionId, ID);

        if (mode === "finalization_uncertain") {
          throw new Error("FINALIZATION_TRANSPORT_UNCERTAIN");
        }

        return {
          outcome: "confirmed",
          operationId:
            mode === "finalization_wrong_id"
              ? OTHER
              : operation.operationId,
          operationKey: operation.operationKey,
          snapshotCollectionId: ID,
          snapshotOutcome: "inserted",
          confirmedAt: "2026-10-29T14:01:00.000Z",
        };
      },

      recordFailure: async (failure) => {
        calls.failure++;

        assert.equal(failure.operation.operationId, ID);
        assert.equal(failure.kind, "retryable");
        assert.equal(
          failure.errorCode,
          "OPENAI_COSTS_RATE_LIMITED",
        );

        return {
          outcome: "failure_recorded",
          operationId: ID,
          operationKey: plan.operationKey,
          state: "retryable_failed",
          eventKind: "failed_retryable",
          errorCode: failure.errorCode,
          attemptCount: 1,
          maxAttempts: 3,
          retryScheduled: true,
          nextAttemptAt: "2026-10-29T14:05:00.000Z",
          retryDelayMinutes: 5,
        };
      },
    },
  });

  return { runner, calls };
}

test("construction performs no financial IO", () => {
  const h = setup();

  assert.deepEqual(h.calls, {
    preparation: 0,
    inventory: 0,
    claim: 0,
    collection: 0,
    finalization: 0,
    failure: 0,
  });
});

test("denied authorization prevents all financial IO", async () => {
  const h = setup("denied");

  assert.equal(
    (await h.runner(request)).status,
    "blocked",
  );

  assert.equal(h.calls.preparation, 0);
  assert.equal(h.calls.inventory, 0);
  assert.equal(h.calls.claim, 0);
  assert.equal(h.calls.collection, 0);
});

test("real coordinator confirms one canonical operation", async () => {
  const h = setup();

  assert.deepEqual(await h.runner(request), {
    status: "confirmed",
    operationId: ID,
  });

  assert.deepEqual(h.calls, {
    preparation: 1,
    inventory: 1,
    claim: 1,
    collection: 1,
    finalization: 1,
    failure: 0,
  });
});

test("existing retryable operation never reaches claim", async () => {
  const h = setup("not_pending");

  assert.deepEqual(await h.runner(request), {
    status: "skipped",
    reason: "not_pending",
  });

  assert.equal(h.calls.claim, 0);
  assert.equal(h.calls.collection, 0);
});

test("wrong inventory key blocks before claim", async () => {
  const h = setup("inventory_wrong_key");

  assert.equal(
    (await h.runner(request)).status,
    "needs_review",
  );

  assert.equal(h.calls.claim, 0);
  assert.equal(h.calls.collection, 0);
});

test("retryable inventory state blocks before claim", async () => {
  const h = setup("inventory_retryable");

  assert.equal(
    (await h.runner(request)).status,
    "needs_review",
  );

  assert.equal(h.calls.claim, 0);
  assert.equal(h.calls.collection, 0);
});

test("unexpected claimed ID cannot reach collection", async () => {
  const h = setup("claim_wrong_id");

  assert.equal(
    (await h.runner(request)).status,
    "needs_review",
  );

  assert.equal(h.calls.claim, 1);
  assert.equal(h.calls.collection, 0);
});

test("tampered claim contract cannot reach collection", async () => {
  const h = setup("claim_wrong_contract");

  assert.equal(
    (await h.runner(request)).status,
    "needs_review",
  );

  assert.equal(h.calls.claim, 1);
  assert.equal(h.calls.collection, 0);
});

test("uncertain claim is not retried", async () => {
  const h = setup("claim_uncertain");

  assert.deepEqual(await h.runner(request), {
    status: "needs_review",
    reason: "execution_uncertain",
    operationId: ID,
  });

  assert.equal(h.calls.claim, 1);
  assert.equal(h.calls.collection, 0);
});

test("empty competing claim performs no collection", async () => {
  const h = setup("claim_empty");

  assert.deepEqual(await h.runner(request), {
    status: "skipped",
    reason: "claim_empty",
  });

  assert.equal(h.calls.claim, 1);
  assert.equal(h.calls.collection, 0);
});

test("expired lease blocks collection", async () => {
  const h = setup("claim_expired");

  assert.equal(
    (await h.runner(request)).status,
    "needs_review",
  );

  assert.equal(h.calls.claim, 1);
  assert.equal(h.calls.collection, 0);
});

test("retryable collection failure never confirms success", async () => {
  const h = setup("collector_retryable");

  assert.deepEqual(await h.runner(request), {
    status: "needs_review",
    reason: "outcome_unconfirmed",
    operationId: ID,
  });

  assert.equal(h.calls.claim, 1);
  assert.equal(h.calls.collection, 1);
  assert.equal(h.calls.failure, 1);
  assert.equal(h.calls.finalization, 0);
});

test("uncertain finalization never records collector failure", async () => {
  const h = setup("finalization_uncertain");

  assert.deepEqual(await h.runner(request), {
    status: "needs_review",
    reason: "outcome_unconfirmed",
    operationId: ID,
  });

  assert.equal(h.calls.collection, 1);
  assert.equal(h.calls.finalization, 1);
  assert.equal(h.calls.failure, 0);
});

test("mismatched finalization cannot confirm money", async () => {
  const h = setup("finalization_wrong_id");

  assert.equal(
    (await h.runner(request)).status,
    "needs_review",
  );

  assert.equal(h.calls.finalization, 1);
  assert.equal(h.calls.failure, 0);
});