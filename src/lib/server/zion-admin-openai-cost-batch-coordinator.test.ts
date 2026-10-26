import assert from "node:assert/strict";
import test from "node:test";

import {
  OpenAiOrganizationCostsCollectorError,
} from "./openai-organization-costs-collector";

import type {
  OpenAiOrganizationCostsCollection,
} from "./openai-organization-costs-collector";

import type {
  ClaimedOpenAiCostOperation,
} from "./zion-admin-openai-cost-claimed-operations";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import {
  OpenAiCostBatchError,
  runClaimedOpenAiCostBatch,
} from "./zion-admin-openai-cost-batch-coordinator";

import type {
  OpenAiCostBatchDependencies,
} from "./zion-admin-openai-cost-batch-coordinator";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const TOKEN = "33333333-3333-4333-8333-333333333333";

const NOW = new Date("2026-10-26T18:00:00Z");

const contract = buildOpenAiCostQueryContract({
  startTime: 1792886400,
  endTime: 1792972800,
  groupBy: ["line_item"],
  projectIds: ["proj-a"],
});

function operation(
  changes: Partial<ClaimedOpenAiCostOperation> = {},
): ClaimedOpenAiCostOperation {
  return {
    operationId: ID,
    operationKey: "costs:2026-10-25",
    claimToken: TOKEN,
    claimedBy: "zion-admin-financial-worker",
    claimExpiresAt: "2026-10-26T18:10:00Z",
    attemptCount: 1,
    maxAttempts: 3,
    contract,
    ...changes,
  };
}

function collection(
  id = ID,
): OpenAiOrganizationCostsCollection {
  return {
    source: "openai_organization_costs",
    provider: "openai",
    status: "confirmed_empty",
    collectionId: id,
    queryIdentity: contract.queryIdentity,
    period: {
      startTime: contract.costsRequest.startTime,
      endTime: contract.costsRequest.endTime,
      bucketWidth: "1d",
      providerPeriodTimezone: "UTC",
      financialCompetence: null,
    },
    groupBy: ["line_item"],
    pages: 1,
    records: [],
  };
}

const REQUEST = {
  limit: 2,
  claimedBy: "zion-admin-financial-worker",
};

function dependencies(
  overrides: Partial<OpenAiCostBatchDependencies> = {},
): OpenAiCostBatchDependencies {
  return {
    claim: async () => ({
      outcome: "claimed",
      claimedCount: 1,
      operations: [operation()],
    }),
    collect: async (_request, args) => collection(
      args.collectionId,
    ),
    finalize: async (item) => ({
      outcome: "confirmed",
      operationId: item.operationId,
      operationKey: item.operationKey,
      snapshotCollectionId: ID2,
      snapshotOutcome: "inserted",
      confirmedAt: "2026-10-26T18:01:00Z",
    }),
    recordFailure: async (input) => ({
      outcome: "failure_recorded",
      operationId: input.operation.operationId,
      operationKey: input.operation.operationKey,
      state: input.kind === "retryable"
        ? "retryable_failed"
        : input.kind === "permanent"
          ? "permanent_failed"
          : "uncertain",
      eventKind: input.kind === "retryable"
        ? "failed_retryable"
        : input.kind === "permanent"
          ? "failed_permanent"
          : "marked_uncertain",
      errorCode: input.errorCode,
      attemptCount: 1,
      maxAttempts: 3,
      retryScheduled: input.kind === "retryable",
      nextAttemptAt: input.kind === "retryable"
        ? "2026-10-26T18:05:00Z"
        : null,
      retryDelayMinutes: input.kind === "retryable"
        ? 5
        : null,
    }),
    now: () => NOW,
    ...overrides,
  };
}

function run(overrides: Partial<OpenAiCostBatchDependencies> = {}) {
  return runClaimedOpenAiCostBatch(
    REQUEST,
    dependencies(overrides),
  );
}

test("empty claim never invokes collector or finalizer", async () => {
  let calls = 0;
  const result = await run({
    claim: async () => ({
      outcome: "claimed",
      claimedCount: 0,
      operations: [],
    }),
    collect: async () => {
      calls++;
      return collection();
    },
    finalize: async () => {
      calls++;
      throw new Error("unexpected");
    },
  });

  assert.equal(result.claimedCount, 0);
  assert.equal(result.confirmedCount, 0);
  assert.equal(calls, 0);
});

test("complete collection confirms one claimed operation", async () => {
  const calls: string[] = [];

  const result = await run({
    claim: async () => {
      calls.push("claim");
      return {
        outcome: "claimed",
        claimedCount: 1,
        operations: [operation()],
      };
    },
    collect: async (request, args) => {
      calls.push("collect");
      assert.deepEqual(request, contract.costsRequest);
      assert.equal(args.collectionId, ID);
      return collection(args.collectionId);
    },
    finalize: async (item, collected) => {
      calls.push("finalize");
      assert.equal(item.claimToken, TOKEN);
      assert.equal(collected.collectionId, ID);
      return {
        outcome: "confirmed",
        operationId: ID,
        operationKey: item.operationKey,
        snapshotCollectionId: ID2,
        snapshotOutcome: "inserted",
        confirmedAt: "2026-10-26T18:01:00Z",
      };
    },
  });

  assert.deepEqual(calls, ["claim", "collect", "finalize"]);
  assert.equal(result.confirmedCount, 1);
  assert.equal(result.needsReviewCount, 0);
  assert.equal(result.operations[0].outcome, "confirmed");
});

test("available collection preserves provider result", async () => {
  const result = await run({
    collect: async (_request, args) => ({
      ...collection(args.collectionId),
      status: "available",
      records: [{
        source: "openai_organization_costs",
        provider: "openai",
        bucketWidth: "1d",
        periodStartUnixSeconds: 1792886400,
        periodEndUnixSeconds: 1792972800,
        periodStartIso: "2026-10-25T00:00:00.000Z",
        periodEndIso: "2026-10-26T00:00:00.000Z",
        providerPeriodTimezone: "UTC",
        financialCompetence: null,
        amountCurrency: "usd",
        amountValue: 0.25,
        amountValueDecimal: "0.25",
        projectId: "proj-a",
        userId: null,
        lineItem: "responses",
        apiKeyId: null,
        apiSource: "agents_api",
        quantity: null,
        quantityUnit: null,
        providerBucketObject: "bucket",
        providerResultObject: "organization.costs.result",
        providerPage: 1,
        providerResultIndex: 0,
        providerLineIdentity: "line-1",
        providerVersionFingerprint: "line-1-v1",
        collectionId: args.collectionId,
        queryIdentity: contract.queryIdentity,
      }],
    }),
    finalize: async (item, collected) => {
      assert.equal(collected.records.length, 1);
      assert.equal(collected.records[0].amountValueDecimal, "0.25");

      return {
        outcome: "confirmed",
        operationId: item.operationId,
        operationKey: item.operationKey,
        snapshotCollectionId: ID2,
        snapshotOutcome: "replayed",
        confirmedAt: "2026-10-26T18:01:00Z",
      };
    },
  });

  assert.equal(result.confirmedCount, 1);
  assert.equal(
    result.operations[0].outcome === "confirmed" &&
      result.operations[0].snapshotOutcome,
    "replayed",
  );
});

test("retryable collector error records scheduled failure", async () => {
  let failureKind = "";

  const result = await run({
    collect: async () => {
      throw new OpenAiOrganizationCostsCollectorError(
        "OPENAI_COSTS_RATE_LIMITED",
        true,
      );
    },
    recordFailure: async (request) => {
      failureKind = request.kind;
      return dependencies().recordFailure(request);
    },
  });

  assert.equal(failureKind, "retryable");
  assert.equal(result.confirmedCount, 0);
  assert.equal(result.failureRecordedCount, 1);
  assert.equal(
    result.operations[0].outcome === "failure_recorded" &&
      result.operations[0].retryScheduled,
    true,
  );
});

test("permanent collector error never schedules retry", async () => {
  let kind = "";

  const result = await run({
    collect: async () => {
      throw new OpenAiOrganizationCostsCollectorError(
        "OPENAI_COSTS_AUTHENTICATION_FAILED",
        false,
      );
    },
    recordFailure: async (request) => {
      kind = request.kind;
      return dependencies().recordFailure(request);
    },
  });

  assert.equal(kind, "permanent");
  assert.equal(result.failureRecordedCount, 1);
  assert.equal(
    result.operations[0].outcome === "failure_recorded" &&
      result.operations[0].retryScheduled,
    false,
  );
});

test("unclassified collector exception becomes uncertain", async () => {
  let captured = "";

  const result = await run({
    collect: async () => {
      throw new Error("unexpected provider response");
    },
    recordFailure: async (request) => {
      captured = `${request.kind}:${request.errorCode}`;
      return dependencies().recordFailure(request);
    },
  });

  assert.equal(
    captured,
    "uncertain:OPENAI_COST_COLLECTION_UNCLASSIFIED",
  );
  assert.equal(result.failureRecordedCount, 1);
  assert.equal(
    result.operations[0].outcome === "failure_recorded" &&
      result.operations[0].state,
    "uncertain",
  );
});

test("finalization transport exception never records failure", async () => {
  let failures = 0;

  const result = await run({
    finalize: async () => {
      throw new Error("lost response after possible commit");
    },
    recordFailure: async (request) => {
      failures++;
      return dependencies().recordFailure(request);
    },
  });

  assert.equal(failures, 0);
  assert.equal(result.confirmedCount, 0);
  assert.equal(result.failureRecordedCount, 0);
  assert.equal(result.needsReviewCount, 1);
  assert.equal(
    result.operations[0].outcome === "needs_review" &&
      result.operations[0].phase,
    "finalization",
  );
});

test("mismatched finalization response cannot confirm money", async () => {
  const result = await run({
    finalize: async (item) => ({
      outcome: "confirmed",
      operationId: ID2,
      operationKey: item.operationKey,
      snapshotCollectionId: ID2,
      snapshotOutcome: "inserted",
      confirmedAt: "2026-10-26T18:01:00Z",
    }),
  });

  assert.equal(result.confirmedCount, 0);
  assert.equal(result.needsReviewCount, 1);
});

test("failure recorder exception leaves claim unconfirmed", async () => {
  const result = await run({
    collect: async () => {
      throw new OpenAiOrganizationCostsCollectorError(
        "OPENAI_COSTS_RATE_LIMITED",
        true,
      );
    },
    recordFailure: async () => {
      throw new Error("RPC transport uncertain");
    },
  });

  assert.equal(result.failureRecordedCount, 0);
  assert.equal(result.needsReviewCount, 1);
  assert.equal(
    result.operations[0].outcome === "needs_review" &&
      result.operations[0].phase,
    "collection_failure",
  );
});

test("expired lease skips collector and writer entirely", async () => {
  let calls = 0;

  const result = await run({
    claim: async () => ({
      outcome: "claimed",
      claimedCount: 1,
      operations: [operation({
        claimExpiresAt: "2026-10-26T17:59:59Z",
      })],
    }),
    collect: async () => {
      calls++;
      return collection();
    },
    finalize: async () => {
      calls++;
      throw new Error("unexpected");
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.needsReviewCount, 1);
});

test("lease expiring during collection prevents finalization", async () => {
  let ticks = 0;
  let finalizations = 0;

  const result = await run({
    now: () => {
      ticks++;
      return ticks >= 3
        ? new Date("2026-10-26T18:11:00Z")
        : NOW;
    },
    finalize: async () => {
      finalizations++;
      throw new Error("unexpected");
    },
  });

  assert.equal(finalizations, 0);
  assert.equal(result.needsReviewCount, 1);
  assert.equal(
    result.operations[0].outcome === "needs_review" &&
      result.operations[0].phase,
    "lease",
  );
});

test("batch isolates failures and continues with next claim", async () => {
  const second = operation({
    operationId: ID2,
    operationKey: "costs:second",
    claimToken: ID2,
  });
  let collected = 0;

  const result = await run({
    claim: async () => ({
      outcome: "claimed",
      claimedCount: 2,
      operations: [operation(), second],
    }),
    collect: async (_request, args) => {
      collected++;

      if (args.collectionId === ID) {
        throw new OpenAiOrganizationCostsCollectorError(
          "OPENAI_COSTS_RATE_LIMITED",
          true,
        );
      }

      return collection(args.collectionId);
    },
  });

  assert.equal(collected, 2);
  assert.equal(result.claimedCount, 2);
  assert.equal(result.failureRecordedCount, 1);
  assert.equal(result.confirmedCount, 1);
  assert.equal(result.needsReviewCount, 0);
});

test("claim uncertainty propagates without provider calls", async () => {
  let collected = 0;

  await assert.rejects(
    () => run({
      claim: async () => {
        throw new Error("unknown claim outcome");
      },
      collect: async () => {
        collected++;
        return collection();
      },
    }),
    /unknown claim outcome/,
  );

  assert.equal(collected, 0);
});

test("malformed claim batch fails before any collection", async () => {
  let collected = 0;

  await assert.rejects(
    () => run({
      claim: async () => ({
        outcome: "claimed",
        claimedCount: 2,
        operations: [operation()],
      }),
      collect: async () => {
        collected++;
        return collection();
      },
    }),
    (error: unknown) =>
      error instanceof OpenAiCostBatchError &&
      error.code === "OPENAI_COST_BATCH_CLAIM_INVALID",
  );

  assert.equal(collected, 0);
});
