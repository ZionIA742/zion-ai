import assert from "node:assert/strict";
import test from "node:test";

import {
  createProtectedOpenAiCostTargetedRunner,
  type OpenAiCostProtectedTargetedRunnerOptions,
} from "./zion-admin-openai-cost-protected-targeted-runner";

import {
  OPENAI_COST_TARGETED_CLAIM_RPC,
} from "./zion-admin-openai-cost-targeted-claim";

import {
  OPENAI_COST_ASSERT_RPC,
} from "./zion-admin-openai-cost-claimed-operations";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import type {
  ZionAdminApiAccessResult,
} from "./zion-admin-api-access";

import type {
  OpenAiCostBatchResult,
} from "./zion-admin-openai-cost-batch-coordinator";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = "55555555-5555-4555-8555-555555555555";
const ACTOR = "zion-admin-financial-worker";
const NOW = new Date("2026-10-27T15:00:00Z");
const EXPIRES = "2026-10-27T15:10:00Z";

const contract = buildOpenAiCostQueryContract({
  startTime: 1792886400,
  endTime: 1792972800,
  groupBy: ["line_item"],
  projectIds: ["proj-a"],
  limit: 10,
});

function access(
  changes: {
    ok?: boolean;
    capability?: boolean;
    user?: string;
  } = {},
): ZionAdminApiAccessResult {
  const user = changes.user ?? USER;

  return {
    ok: changes.ok ?? true,
    sessionUserId: user,
    resolution: {
      domain: "zion_admin",
      status: "zion_admin_allowed",
      sessionUserId: user,
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
  id = ID,
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
        operationId: id,
        operationKey: "costs:2026-10-25",
        snapshotCollectionId: id,
        snapshotOutcome: "inserted" as const,
      }
    : outcome === "failure_recorded"
      ? {
          outcome: "failure_recorded" as const,
          operationId: id,
          operationKey: "costs:2026-10-25",
          state: "retryable_failed" as const,
          retryScheduled: true,
        }
      : {
          outcome: "needs_review" as const,
          operationId: id,
          operationKey: "costs:2026-10-25",
          phase: "finalization" as const,
          errorCode: "OPENAI_COST_FINALIZATION_UNCONFIRMED",
        };

  return {
    outcome: "processed_batch",
    claimedCount: 1,
    confirmedCount: outcome === "confirmed" ? 1 : 0,
    failureRecordedCount:
      outcome === "failure_recorded" ? 1 : 0,
    needsReviewCount:
      outcome === "needs_review" ? 1 : 0,
    operations: [item],
  };
}

function harness(
  overrides: OpenAiCostProtectedTargetedRunnerOptions = {},
) {
  const calls: string[] = [];

  const run = createProtectedOpenAiCostTargetedRunner({
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

    ...overrides,
  });

  return { run, calls };
}

test("construction has no authorization or financial IO", () => {
  let calls = 0;

  const run = createProtectedOpenAiCostTargetedRunner({
    resolveAccess: async () => {
      calls++;
      return access();
    },
    batchRunner: async () => {
      calls++;
      return batch();
    },
  });

  assert.equal(typeof run, "function");
  assert.equal(calls, 0);
});

test("invalid target ID is rejected before access", async () => {
  const h = harness();
  const result = await h.run("invalid");

  assert.equal(result.ok, false);
  assert.equal(result.status, "input_invalid");
  assert.deepEqual(h.calls, []);
});

test("feature disabled blocks access and execution", async () => {
  const h = harness({
    isFeatureEnabled: () => false,
  });

  const result = await h.run(ID);

  assert.equal(result.status, "disabled");
  assert.deepEqual(h.calls, []);
});

test("execution disabled blocks access and execution", async () => {
  const h = harness({
    isExecutionEnabled: () => false,
  });

  const result = await h.run(ID);

  assert.equal(result.status, "disabled");
  assert.deepEqual(h.calls, []);
});

test("denied administrative access blocks execution", async () => {
  const h = harness({
    resolveAccess: async () => access({ ok: false }),
  });

  const result = await h.run(ID);

  assert.equal(result.status, "access_denied");
  assert.equal(h.calls.includes("batch"), false);
});

test("missing manage_accounts capability blocks execution", async () => {
  const h = harness({
    resolveAccess: async () => access({ capability: false }),
  });

  const result = await h.run(ID);

  assert.equal(result.status, "access_denied");
  assert.equal(h.calls.includes("batch"), false);
});

test("non-allowlisted user cannot execute", async () => {
  const h = harness({
    resolveAccess: async () => access({ user: OTHER_USER }),
  });

  const result = await h.run(ID);

  assert.equal(result.status, "identity_not_allowlisted");
  assert.equal(h.calls.includes("batch"), false);
});

test("authorized execution uses limit one and fixed actor", async () => {
  const h = harness();
  const result = await h.run(ID);

  assert.equal(result.ok, true);
  assert.equal(result.status, "confirmed");
  assert.deepEqual(h.calls, ["access", "batch"]);
});

test("different processed ID cannot be confirmed", async () => {
  const h = harness({
    batchRunner: async () => batch("confirmed", OTHER_ID),
  });

  const result = await h.run(ID);

  assert.equal(result.ok, false);
  assert.equal(result.status, "execution_unconfirmed");
});

test("recorded collection failure is not success", async () => {
  const h = harness({
    batchRunner: async () => batch("failure_recorded"),
  });

  const result = await h.run(ID);

  assert.equal(result.ok, false);
  assert.equal(result.status, "failures_recorded");
});

test("uncertain finalization requires review", async () => {
  const h = harness({
    batchRunner: async () => batch("needs_review"),
  });

  const result = await h.run(ID);

  assert.equal(result.ok, false);
  assert.equal(result.status, "requires_review");
});

test("empty targeted claim uses only targeted RPC", async () => {
  const names: string[] = [];

  const run = createProtectedOpenAiCostTargetedRunner({
    isFeatureEnabled: () => true,
    isExecutionEnabled: () => true,
    getAllowlist: () => USER,
    resolveAccess: async () => access(),

    adapterOptions: {
      now: () => NOW,
      claimDependencies: {
        rpc: async (name, parameters) => {
          names.push(name);
          assert.equal(name, OPENAI_COST_TARGETED_CLAIM_RPC);
          assert.deepEqual(parameters, {
            p_operation_id: ID,
            p_claimed_by: ACTOR,
          });

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

  const result = await run(ID);

  assert.equal(result.ok, true);
  assert.equal(result.status, "no_work");
  assert.deepEqual(names, [OPENAI_COST_TARGETED_CLAIM_RPC]);
});

test("targeted claim verifies assertion before processing", async () => {
  const calls: string[] = [];

  const run = createProtectedOpenAiCostTargetedRunner({
    isFeatureEnabled: () => true,
    isExecutionEnabled: () => true,
    getAllowlist: () => USER,
    resolveAccess: async () => access(),

    adapterOptions: {
      now: () => NOW,
      claimDependencies: {
        rpc: async (name, params) => {
          calls.push(name);

          if (name === OPENAI_COST_TARGETED_CLAIM_RPC) {
            assert.equal(params.p_operation_id, ID);

            return {
              data: {
                outcome: "claimed",
                claimed_count: 1,
                lease_minutes: 15,
                operations: [{
                  operation_id: ID,
                  operation_key: "costs:2026-10-25",
                  query_identity: contract.queryIdentity,
                  query_parameters: contract.queryParameters,
                  period_start: contract.periodStart,
                  period_end: contract.periodEnd,
                  state: "processing",
                  attempt_count: 1,
                  max_attempts: 3,
                  claim_token: TOKEN,
                  claim_expires_at: EXPIRES,
                  claimed_by: ACTOR,
                }],
              },
              error: null,
            };
          }

          assert.equal(name, OPENAI_COST_ASSERT_RPC);
          assert.equal(params.p_operation_id, ID);
          assert.equal(params.p_claim_token, TOKEN);

          return {
            data: {
              outcome: "valid",
              operation_id: ID,
              operation_key: "costs:2026-10-25",
              state: "processing",
              attempt_count: 1,
              claim_expires_at: EXPIRES,
              claimed_by: ACTOR,
            },
            error: null,
          };
        },
      },
    },

    batchRunner: async (request, adapters) => {
      const claim = await adapters.claim(request);

      assert.equal(claim.claimedCount, 1);
      assert.equal(claim.operations[0].operationId, ID);

      return batch();
    },
  });

  const result = await run(ID);

  assert.equal(result.status, "confirmed");
  assert.deepEqual(calls, [
    OPENAI_COST_TARGETED_CLAIM_RPC,
    OPENAI_COST_ASSERT_RPC,
  ]);
});

test("ambiguous claim never retries automatically", async () => {
  let calls = 0;

  const run = createProtectedOpenAiCostTargetedRunner({
    isFeatureEnabled: () => true,
    isExecutionEnabled: () => true,
    getAllowlist: () => USER,
    resolveAccess: async () => access(),

    adapterOptions: {
      now: () => NOW,
      claimDependencies: {
        rpc: async (name) => {
          assert.equal(name, OPENAI_COST_TARGETED_CLAIM_RPC);
          calls++;
          throw new Error("Connection lost");
        },
      },
    },
  });

  const result = await run(ID);

  assert.equal(result.ok, false);
  assert.equal(result.status, "execution_unconfirmed");
  assert.equal(calls, 1);
});
