import assert from "node:assert/strict";
import test from "node:test";

import {
  createProtectedOpenAiCostPreparer,
} from "./zion-admin-openai-cost-protected-preparer";

import type {
  OpenAiCostProtectedPreparerOptions,
} from "./zion-admin-openai-cost-protected-preparer";

import type {
  ZionAdminApiAccessResult,
} from "./zion-admin-api-access";

import type {
  OpenAiCostPrepareRequest,
  OpenAiCostPrepareResult,
} from "./zion-admin-openai-cost-operation-preparer";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const OP = "33333333-3333-4333-8333-333333333333";
const SNAP = "44444444-4444-4444-8444-444444444444";

const REQUEST: OpenAiCostPrepareRequest = {
  operationKey: "zion-admin-costs:2026-10-26",
  costsRequest: {
    startTime: 1792886400,
    endTime: 1793059200,
    groupBy: ["project_id", "line_item"],
    projectIds: ["proj-a"],
    limit: 10,
  },
};

const CONTRACT = buildOpenAiCostQueryContract(
  REQUEST.costsRequest,
);

function access(
  overrides: {
    ok?: boolean;
    capability?: boolean;
    identity?: string;
    resolvedIdentity?: string;
  } = {},
): ZionAdminApiAccessResult {
  const identity = overrides.identity ?? USER;

  return {
    ok: overrides.ok ?? true,
    sessionUserId: identity,
    resolution: {
      domain: "zion_admin",
      status: "zion_admin_allowed",
      sessionUserId: overrides.resolvedIdentity ?? identity,
      capabilities: overrides.capability === false
        ? []
        : ["manage_accounts"],
    },
  } as unknown as ZionAdminApiAccessResult;
}

function prepared(
  changes: Partial<OpenAiCostPrepareResult> = {},
): OpenAiCostPrepareResult {
  return {
    outcome: "created",
    operationId: OP,
    operationKey: REQUEST.operationKey,
    state: "pending",
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: "2026-10-27T13:00:00Z",
    snapshotCollectionId: null,
    contract: CONTRACT,
    ...changes,
  };
}

function harness(
  changes: Partial<OpenAiCostProtectedPreparerOptions> = {},
) {
  const calls: string[] = [];

  const runner = createProtectedOpenAiCostPreparer({
    isCollectionEnabled: () => true,
    isPreparationEnabled: () => true,
    getAllowlist: () => USER,

    resolveAccess: async () => {
      calls.push("access");
      return access();
    },

    prepare: async (request) => {
      calls.push("prepare");
      assert.equal(request.operationKey, REQUEST.operationKey);
      return prepared();
    },

    ...changes,
  });

  return { calls, run: runner };
}

test("construction does not contact any provider or database", () => {
  let calls = 0;

  createProtectedOpenAiCostPreparer({
    resolveAccess: async () => {
      calls++;
      return access();
    },
    prepare: async () => {
      calls++;
      return prepared();
    },
  });

  assert.equal(calls, 0);
});

test("collection flag disabled blocks all operations", async () => {
  const h = harness({ isCollectionEnabled: () => false });
  const result = await h.run(REQUEST);

  assert.deepEqual(result, { ok: false, status: "disabled" });
  assert.deepEqual(h.calls, []);
});

test("preparation flag disabled blocks all operations", async () => {
  const h = harness({ isPreparationEnabled: () => false });
  const result = await h.run(REQUEST);

  assert.equal(result.status, "disabled");
  assert.deepEqual(h.calls, []);
});

test("invalid operation key is rejected before authorization", async () => {
  const h = harness();

  const result = await h.run({
    ...REQUEST,
    operationKey: " invalid ",
  });

  assert.equal(result.status, "invalid_input");
  assert.deepEqual(h.calls, []);
});

test("invalid canonical query never reaches authorization", async () => {
  const h = harness();

  const result = await h.run({
    ...REQUEST,
    costsRequest: {
      ...REQUEST.costsRequest,
      endTime: REQUEST.costsRequest.startTime,
    },
  });

  assert.equal(result.status, "invalid_input");
  assert.deepEqual(h.calls, []);
});

test("denied access never prepares an operation", async () => {
  const h = harness({
    resolveAccess: async () => access({ ok: false }),
  });

  const result = await h.run(REQUEST);

  assert.equal(result.status, "access_denied");
  assert.deepEqual(h.calls, []);
});

test("manage_accounts capability is required", async () => {
  const h = harness({
    resolveAccess: async () => access({ capability: false }),
  });

  const result = await h.run(REQUEST);

  assert.equal(result.status, "access_denied");
  assert.deepEqual(h.calls, []);
});

test("session identity mismatch is denied", async () => {
  const h = harness({
    resolveAccess: async () => access({
      resolvedIdentity: OTHER,
    }),
  });

  const result = await h.run(REQUEST);

  assert.equal(result.status, "access_denied");
  assert.deepEqual(h.calls, []);
});

test("missing allowlist blocks preparation", async () => {
  const h = harness({ getAllowlist: () => "" });
  const result = await h.run(REQUEST);

  assert.equal(result.status, "identity_not_allowlisted");
  assert.deepEqual(h.calls, ["access"]);
});

test("another user in allowlist is insufficient", async () => {
  const h = harness({ getAllowlist: () => OTHER });
  const result = await h.run(REQUEST);

  assert.equal(result.status, "identity_not_allowlisted");
  assert.deepEqual(h.calls, ["access"]);
});

test("malformed allowlist is denied", async () => {
  const h = harness({
    getAllowlist: () => `${USER},not-a-uuid`,
  });

  const result = await h.run(REQUEST);

  assert.equal(result.status, "identity_not_allowlisted");
  assert.deepEqual(h.calls, ["access"]);
});

test("authorization service error fails closed", async () => {
  const h = harness({
    resolveAccess: async () => {
      throw new Error("session unavailable");
    },
  });

  const result = await h.run(REQUEST);

  assert.equal(result.status, "access_unavailable");
  assert.deepEqual(h.calls, []);
});

test("authorized new preparation creates pending only", async () => {
  const h = harness();
  const result = await h.run(REQUEST);

  assert.equal(result.ok, true);
  assert.equal(result.status, "created_pending");
  assert.deepEqual(h.calls, ["access", "prepare"]);

  if (result.ok) {
    assert.equal(result.operationId, OP);
    assert.equal(result.state, "pending");
    assert.equal(result.claimStarted, false);
    assert.equal(result.financialConfirmed, false);
  }
});

test("idempotent existing pending remains pending", async () => {
  const h = harness({
    prepare: async () => prepared({ outcome: "existing" }),
  });

  const result = await h.run(REQUEST);

  assert.equal(result.ok, true);
  assert.equal(result.status, "existing_pending");
});

test("existing uncertain requires manual review", async () => {
  const h = harness({
    prepare: async () => prepared({
      outcome: "existing",
      state: "uncertain",
      attemptCount: 1,
      nextAttemptAt: null,
    }),
  });

  const result = await h.run(REQUEST);

  assert.equal(result.ok, false);
  assert.equal(result.status, "requires_review");
});

test("existing confirmed cannot be treated as pending", async () => {
  const h = harness({
    prepare: async () => prepared({
      outcome: "existing",
      state: "confirmed",
      attemptCount: 1,
      nextAttemptAt: null,
      snapshotCollectionId: SNAP,
    }),
  });

  const result = await h.run(REQUEST);

  assert.equal(result.ok, false);
  assert.equal(result.status, "existing_not_pending");
});

test("lost response never triggers automatic retry", async () => {
  let calls = 0;

  const h = harness({
    prepare: async () => {
      calls++;
      throw new Error("commit may already have happened");
    },
  });

  const result = await h.run(REQUEST);

  assert.equal(result.status, "preparation_unconfirmed");
  assert.equal(calls, 1);
});

test("forged result cannot imply confirmed preparation", async () => {
  const h = harness({
    prepare: async () => prepared({
      operationKey: "different-operation",
    }),
  });

  const result = await h.run(REQUEST);

  assert.equal(result.status, "preparation_unconfirmed");
});

test("created operation must be pending and have zero attempts", async () => {
  const h = harness({
    prepare: async () => prepared({
      state: "processing",
      attemptCount: 1,
      nextAttemptAt: null,
    }),
  });

  const result = await h.run(REQUEST);

  assert.equal(result.status, "preparation_unconfirmed");
});
