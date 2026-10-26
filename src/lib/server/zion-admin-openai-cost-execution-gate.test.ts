import assert from "node:assert/strict";
import test from "node:test";

import type {
  ZionAdminApiAccessResult,
} from "./zion-admin-api-access";

import type {
  OpenAiCostBatchResult,
} from "./zion-admin-openai-cost-batch-coordinator";

import {
  createOpenAiCostExecutionGate,
} from "./zion-admin-openai-cost-execution-gate";

import type {
  OpenAiCostExecutionGateDeps,
} from "./zion-admin-openai-cost-execution-gate";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function access(
  options: {
    ok?: boolean;
    capability?: boolean;
    identity?: string;
    resolutionIdentity?: string;
  } = {},
): ZionAdminApiAccessResult {
  const actor = options.identity ?? USER;

  return {
    ok: options.ok ?? true,
    sessionUserId: actor,
    resolution: {
      status: "zion_admin_allowed",
      sessionUserId: options.resolutionIdentity ?? actor,
      capabilities:
        options.capability === false ? [] : ["manage_accounts"],
    },
  } as unknown as ZionAdminApiAccessResult;
}

function batch(
  outcomes: Array<
    "confirmed" | "failure_recorded" | "needs_review"
  > = ["confirmed"],
): OpenAiCostBatchResult {
  return {
    outcome: "processed_batch",
    claimedCount: outcomes.length,
    confirmedCount: outcomes.filter(
      (item) => item === "confirmed",
    ).length,
    failureRecordedCount: outcomes.filter(
      (item) => item === "failure_recorded",
    ).length,
    needsReviewCount: outcomes.filter(
      (item) => item === "needs_review",
    ).length,
    operations: outcomes.map((outcome, index) => {
      const item = {
        operationId: index === 0 ? USER : OTHER,
        operationKey: `costs:${index}`,
      };

      if (outcome === "confirmed") {
        return {
          ...item,
          outcome,
          snapshotCollectionId: USER,
          snapshotOutcome: "inserted" as const,
        };
      }

      if (outcome === "failure_recorded") {
        return {
          ...item,
          outcome,
          state: "retryable_failed" as const,
          retryScheduled: true,
        };
      }

      return {
        ...item,
        outcome,
        phase: "finalization" as const,
        errorCode: "OPENAI_COST_FINALIZATION_UNCONFIRMED",
      };
    }),
  };
}

function setup(
  changes: Partial<OpenAiCostExecutionGateDeps> = {},
) {
  const calls: string[] = [];

  const deps: OpenAiCostExecutionGateDeps = {
    isFeatureEnabled: () => true,
    isExecutionEnabled: () => true,
    getAllowlist: () => USER,
    resolveAccess: async () => {
      calls.push("access");
      return access();
    },
    execute: async (request) => {
      calls.push("execute");
      assert.equal(request.claimedBy, "zion-admin-financial-worker");
      assert.equal(request.limit, 1);
      return batch();
    },
    ...changes,
  };

  return {
    calls,
    execute: createOpenAiCostExecutionGate(deps),
  };
}

test("disabled feature performs no access lookup or execution", async () => {
  const h = setup({ isFeatureEnabled: () => false });
  const result = await h.execute(1);

  assert.equal(result.ok, false);
  assert.equal(result.status, "disabled");
  assert.deepEqual(h.calls, []);
});

test("disabled execution switch blocks all operations", async () => {
  const h = setup({ isExecutionEnabled: () => false });
  const result = await h.execute(1);

  assert.equal(result.status, "disabled");
  assert.deepEqual(h.calls, []);
});

test("invalid batch limit is rejected before access resolution", async () => {
  const h = setup();

  for (const limit of [0, 11, -1, 1.5, NaN]) {
    const result = await h.execute(limit);
    assert.equal(result.status, "input_invalid");
  }

  assert.deepEqual(h.calls, []);
});

test("anonymous or denied administrative access cannot execute", async () => {
  const h = setup({
    resolveAccess: async () => access({ ok: false }),
  });

  const result = await h.execute(1);

  assert.equal(result.status, "access_denied");
  assert.deepEqual(h.calls, []);
});

test("an admin without manage_accounts cannot execute", async () => {
  const h = setup({
    resolveAccess: async () => access({ capability: false }),
  });

  const result = await h.execute(1);

  assert.equal(result.status, "access_denied");
  assert.deepEqual(h.calls, []);
});

test("admin identity must match the access resolution", async () => {
  const h = setup({
    resolveAccess: async () => access({
      resolutionIdentity: OTHER,
    }),
  });

  const result = await h.execute(1);

  assert.equal(result.status, "access_denied");
  assert.deepEqual(h.calls, []);
});

test("missing or invalid allowlists cannot execute", async () => {
  for (const raw of [
    "",
    "invalid",
    OTHER,
    `${USER},invalid`,
    `${USER},${USER}`,
  ]) {
    const h = setup({ getAllowlist: () => raw });
    const result = await h.execute(1);

    assert.equal(result.status, "identity_not_allowlisted");
    assert.deepEqual(h.calls, ["access"]);
  }
});

test("unavailable authorization fails closed", async () => {
  const h = setup({
    resolveAccess: async () => {
      throw new Error("session lookup failed");
    },
  });

  const result = await h.execute(1);

  assert.equal(result.status, "access_unavailable");
  assert.deepEqual(h.calls, []);
});

test("successful authorized batch confirms its own counts", async () => {
  const h = setup();
  const result = await h.execute(1);

  assert.equal(result.ok, true);
  assert.equal(result.status, "confirmed");
  assert.equal(
    result.ok && result.confirmedCount,
    1,
  );
  assert.deepEqual(h.calls, ["access", "execute"]);
});

test("empty claim is no_work, never financial confirmation", async () => {
  const h = setup({ execute: async () => batch([]) });
  const result = await h.execute(1);

  assert.equal(result.ok, true);
  assert.equal(result.status, "no_work");
});

test("recorded provider failure is not financial success", async () => {
  const h = setup({
    execute: async () => batch(["failure_recorded"]),
  });

  const result = await h.execute(1);

  assert.equal(result.ok, false);
  assert.equal(result.status, "failures_recorded");
});

test("unconfirmed finalization requires review", async () => {
  const h = setup({
    execute: async () => batch(["needs_review"]),
  });

  const result = await h.execute(1);

  assert.equal(result.ok, false);
  assert.equal(result.status, "requires_review");
});

test("malformed counts never produce confirmed success", async () => {
  const h = setup({
    execute: async () => ({
      ...batch(),
      claimedCount: 2,
    }),
  });

  const result = await h.execute(1);

  assert.equal(result.ok, false);
  assert.equal(result.status, "result_invalid");
});

test("executor transport uncertainty is not retried", async () => {
  let calls = 0;

  const h = setup({
    execute: async () => {
      calls++;
      throw new Error("claim response lost");
    },
  });

  const result = await h.execute(1);

  assert.equal(result.ok, false);
  assert.equal(result.status, "execution_unconfirmed");
  assert.equal(calls, 1);
});
