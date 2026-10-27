import assert from "node:assert/strict";
import test from "node:test";

import {
  createProtectedOpenAiCostBatchRunner,
  type OpenAiCostProtectedRunnerOptions,
} from "./zion-admin-openai-cost-protected-runner";

import type {
  ZionAdminApiAccessResult,
} from "./zion-admin-api-access";

import type {
  OpenAiCostBatchResult,
} from "./zion-admin-openai-cost-batch-coordinator";

import {
  OPENAI_COST_CLAIM_RPC,
} from "./zion-admin-openai-cost-claimed-operations";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const OP = "33333333-3333-4333-8333-333333333333";
const ACTOR = "zion-admin-financial-worker";

function access(
  changes: {
    ok?: boolean;
    capability?: boolean;
    user?: string;
    resolutionUser?: string;
  } = {},
): ZionAdminApiAccessResult {
  const user = changes.user ?? USER;

  return {
    ok: changes.ok ?? true,
    sessionUserId: user,
    resolution: {
      domain: "zion_admin",
      status: "zion_admin_allowed",
      sessionUserId: changes.resolutionUser ?? user,
      capabilities: changes.capability === false
        ? []
        : ["manage_accounts"],
    },
  } as unknown as ZionAdminApiAccessResult;
}

function batch(
  outcome:
    | "confirmed"
    | "no_work"
    | "failure_recorded"
    | "needs_review" = "confirmed",
): OpenAiCostBatchResult {
  if (outcome === "no_work") {
    return {
      outcome: "processed_batch",
      claimedCount: 0,
      confirmedCount: 0,
      failureRecordedCount: 0,
      needsReviewCount: 0,
      operations: [],
    };
  }

  const item = outcome === "confirmed"
    ? {
        outcome: "confirmed" as const,
        operationId: OP,
        operationKey: "cost:2026-10-26",
        snapshotCollectionId: OP,
        snapshotOutcome: "inserted" as const,
      }
    : outcome === "failure_recorded"
      ? {
          outcome: "failure_recorded" as const,
          operationId: OP,
          operationKey: "cost:2026-10-26",
          state: "retryable_failed" as const,
          retryScheduled: true,
        }
      : {
          outcome: "needs_review" as const,
          operationId: OP,
          operationKey: "cost:2026-10-26",
          phase: "finalization" as const,
          errorCode: "OPENAI_COST_FINALIZATION_UNCONFIRMED",
        };

  return {
    outcome: "processed_batch",
    claimedCount: 1,
    confirmedCount: outcome === "confirmed" ? 1 : 0,
    failureRecordedCount:
      outcome === "failure_recorded" ? 1 : 0,
    needsReviewCount: outcome === "needs_review" ? 1 : 0,
    operations: [item],
  };
}

function harness(
  changes: Partial<OpenAiCostProtectedRunnerOptions> = {},
) {
  const calls: string[] = [];

  const runner = createProtectedOpenAiCostBatchRunner({
    isFeatureEnabled: () => true,
    isExecutionEnabled: () => true,
    getAllowlist: () => USER,

    resolveAccess: async () => {
      calls.push("access");
      return access();
    },

    batchRunner: async (request, adapters) => {
      calls.push("batch");
      assert.equal(request.limit, 1);
      assert.equal(request.claimedBy, ACTOR);
      assert.equal(typeof adapters.claim, "function");
      assert.equal(typeof adapters.collect, "function");
      assert.equal(typeof adapters.finalize, "function");
      assert.equal(typeof adapters.recordFailure, "function");
      return batch();
    },

    ...changes,
  });

  return {
    calls,
    run: (limit = 1) => runner(limit),
  };
}

test("constructing the runner performs no financial I/O", () => {
  let calls = 0;

  const runner = createProtectedOpenAiCostBatchRunner({
    isFeatureEnabled: () => false,
    isExecutionEnabled: () => false,
    getAllowlist: () => USER,
    resolveAccess: async () => {
      calls++;
      return access();
    },
    adapterOptions: {
      claim: async () => {
        calls++;
        throw Error("unexpected claim");
      },
      collect: async () => {
        calls++;
        throw Error("unexpected collector");
      },
      finalize: async () => {
        calls++;
        throw Error("unexpected finalizer");
      },
      recordFailure: async () => {
        calls++;
        throw Error("unexpected failure writer");
      },
    },
  });

  assert.equal(typeof runner, "function");
  assert.equal(calls, 0);
});

test("feature disabled blocks authorization and batch", async () => {
  const h = harness({
    isFeatureEnabled: () => false,
  });

  const result = await h.run();

  assert.equal(result.status, "disabled");
  assert.deepEqual(h.calls, []);
});

test("execution disabled blocks authorization and batch", async () => {
  const h = harness({
    isExecutionEnabled: () => false,
  });

  const result = await h.run();

  assert.equal(result.status, "disabled");
  assert.deepEqual(h.calls, []);
});

test("invalid limit cannot reach authorization or claim", async () => {
  const h = harness();

  for (const limit of [0, 11, -1, 1.5]) {
    const result = await h.run(limit);
    assert.equal(result.status, "input_invalid");
  }

  assert.deepEqual(h.calls, []);
});

test("denied session cannot start batch", async () => {
  const h = harness({
    resolveAccess: async () => access({ ok: false }),
  });

  const result = await h.run();

  assert.equal(result.status, "access_denied");
  assert.deepEqual(h.calls, []);
});

test("manage_accounts is mandatory", async () => {
  const h = harness({
    resolveAccess: async () => access({
      capability: false,
    }),
  });

  const result = await h.run();

  assert.equal(result.status, "access_denied");
  assert.deepEqual(h.calls, []);
});

test("administrative identity mismatch is denied", async () => {
  const h = harness({
    resolveAccess: async () => access({
      resolutionUser: OTHER,
    }),
  });

  const result = await h.run();

  assert.equal(result.status, "access_denied");
  assert.deepEqual(h.calls, []);
});

test("missing allowlist blocks the financial batch", async () => {
  const h = harness({
    getAllowlist: () => "",
  });

  const result = await h.run();

  assert.equal(result.status, "identity_not_allowlisted");
  assert.deepEqual(h.calls, ["access"]);
});

test("wrong allowlist blocks the financial batch", async () => {
  const h = harness({
    getAllowlist: () => OTHER,
  });

  const result = await h.run();

  assert.equal(result.status, "identity_not_allowlisted");
  assert.deepEqual(h.calls, ["access"]);
});

test("failed access resolution never opens a claim", async () => {
  const h = harness({
    resolveAccess: async () => {
      throw Error("session unavailable");
    },
  });

  const result = await h.run();

  assert.equal(result.status, "access_unavailable");
  assert.deepEqual(h.calls, []);
});

test("authorized runner supplies the server worker identity", async () => {
  const h = harness();
  const result = await h.run();

  assert.equal(result.ok, true);
  assert.equal(result.status, "confirmed");
  assert.deepEqual(h.calls, ["access", "batch"]);
});

test("empty work is not recorded as a confirmed expense", async () => {
  const h = harness({
    batchRunner: async () => batch("no_work"),
  });

  const result = await h.run();

  assert.equal(result.ok, true);
  assert.equal(result.status, "no_work");
});

test("recorded provider failures are not financial success", async () => {
  const h = harness({
    batchRunner: async () => batch("failure_recorded"),
  });

  const result = await h.run();

  assert.equal(result.ok, false);
  assert.equal(result.status, "failures_recorded");
});

test("uncertain finalization requires reconciliation", async () => {
  const h = harness({
    batchRunner: async () => batch("needs_review"),
  });

  const result = await h.run();

  assert.equal(result.ok, false);
  assert.equal(result.status, "requires_review");
});

test("batch transport ambiguity never triggers blind retry", async () => {
  let count = 0;

  const h = harness({
    batchRunner: async () => {
      count++;
      throw Error("claim committed but response lost");
    },
  });

  const result = await h.run();

  assert.equal(result.ok, false);
  assert.equal(result.status, "execution_unconfirmed");
  assert.equal(count, 1);
});

test("malformed batch totals cannot become financial success", async () => {
  const h = harness({
    batchRunner: async () => ({
      ...batch("confirmed"),
      confirmedCount: 2,
    }),
  });

  const result = await h.run();

  assert.equal(result.ok, false);
  assert.equal(result.status, "result_invalid");
});

test("real coordinator and adapters handle empty mock claim", async () => {
  const names: string[] = [];

  const runner = createProtectedOpenAiCostBatchRunner({
    isFeatureEnabled: () => true,
    isExecutionEnabled: () => true,
    getAllowlist: () => USER,
    resolveAccess: async () => access(),

    adapterOptions: {
      claimDependencies: {
        rpc: async (name, params) => {
          names.push(name);

          assert.equal(name, OPENAI_COST_CLAIM_RPC);
          assert.equal(params.p_limit, 1);
          assert.equal(params.p_claimed_by, ACTOR);

          return {
            data: {
              outcome: "claimed",
              claimed_count: 0,
              lease_minutes: 15,
              operations: [],
            },
            error: null,
          };
        },
      },
    },
  });

  const result = await runner(1);

  assert.equal(result.ok, true);
  assert.equal(result.status, "no_work");
  assert.deepEqual(names, [OPENAI_COST_CLAIM_RPC]);
});
