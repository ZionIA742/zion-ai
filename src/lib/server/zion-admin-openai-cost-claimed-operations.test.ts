import assert from "node:assert/strict";
import test from "node:test";

import {
  claimVerifiedOpenAiCostOperations,
  OPENAI_COST_ASSERT_RPC,
  OPENAI_COST_CLAIM_RPC,
  OpenAiCostClaimError,
} from "./zion-admin-openai-cost-claimed-operations";

import type {
  OpenAiCostClaimingRpc,
} from "./zion-admin-openai-cost-claimed-operations";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const TOKEN1 = "33333333-3333-4333-8333-333333333333";
const TOKEN2 = "44444444-4444-4444-8444-444444444444";

const ACTOR = "zion-admin-financial-worker";
const NOW = new Date("2026-10-26T18:00:00Z");
const EXPIRES = "2026-10-26T18:10:00Z";

const request = {
  limit: 2,
  claimedBy: ACTOR,
};

const query1 = buildOpenAiCostQueryContract({
  startTime: 1792886400,
  endTime: 1793059200,
  groupBy: ["project_id", "line_item"],
  projectIds: ["proj-a"],
});

const query2 = buildOpenAiCostQueryContract({
  startTime: 1793059200,
  endTime: 1793145600,
  groupBy: ["line_item"],
});

function operation(
  id = ID1,
  token = TOKEN1,
  query = query1,
) {
  return {
    operation_id: id,
    operation_key: `costs:${id}`,
    query_identity: query.queryIdentity,
    query_parameters: query.queryParameters,
    period_start: query.periodStart,
    period_end: query.periodEnd,
    state: "processing",
    attempt_count: 1,
    max_attempts: 3,
    claim_token: token,
    claim_expires_at: EXPIRES,
    claimed_by: ACTOR,
  };
}

function envelope(
  operations: unknown[] = [operation()],
) {
  return {
    outcome: "claimed",
    claimed_count: operations.length,
    lease_minutes: 15,
    operations,
  };
}

function assertion(
  item = operation(),
) {
  return {
    outcome: "valid",
    operation_id: item.operation_id,
    operation_key: item.operation_key,
    state: "processing",
    attempt_count: item.attempt_count,
    claim_expires_at: item.claim_expires_at,
    claimed_by: item.claimed_by,
  };
}

function mocked(
  claim: unknown = envelope(),
  assertOverride?: unknown,
): OpenAiCostClaimingRpc {
  return async (name, params) => {
    if (name === OPENAI_COST_CLAIM_RPC) {
      assert.equal(params.p_limit, request.limit);
      assert.equal(params.p_claimed_by, ACTOR);
      return { data: claim, error: null };
    }

    assert.equal(name, OPENAI_COST_ASSERT_RPC);

    const items = (claim as ReturnType<typeof envelope>).operations;
    const matching = items.find(
      (item) =>
        (item as ReturnType<typeof operation>).operation_id ===
        params.p_operation_id,
    ) as ReturnType<typeof operation> | undefined;

    assert.ok(matching);
    assert.equal(params.p_claim_token, matching.claim_token);

    return {
      data: assertOverride ?? assertion(matching),
      error: null,
    };
  };
}

function run(rpc: OpenAiCostClaimingRpc) {
  return claimVerifiedOpenAiCostOperations(
    request,
    {
      rpc,
      now: () => NOW,
    },
  );
}

function rejectsCode(
  action: () => Promise<unknown>,
  code: string,
) {
  return assert.rejects(
    action,
    (error: unknown) =>
      error instanceof OpenAiCostClaimError &&
      error.code === code,
  );
}

test("zero claimed operations return no processing work", async () => {
  let assertions = 0;

  const result = await run(async (name) => {
    if (name === OPENAI_COST_ASSERT_RPC) assertions++;
    return { data: envelope([]), error: null };
  });

  assert.equal(result.claimedCount, 0);
  assert.deepEqual(result.operations, []);
  assert.equal(assertions, 0);
});

test("one valid claim requires matching assertion", async () => {
  let claims = 0;
  let assertions = 0;

  const result = await run(async (name, params) => {
    if (name === OPENAI_COST_CLAIM_RPC) {
      claims++;
      assert.equal(params.p_limit, 2);
      return { data: envelope(), error: null };
    }

    assertions++;
    assert.equal(name, OPENAI_COST_ASSERT_RPC);
    assert.equal(params.p_operation_id, ID1);
    assert.equal(params.p_claim_token, TOKEN1);

    return {
      data: assertion(),
      error: null,
    };
  });

  assert.equal(claims, 1);
  assert.equal(assertions, 1);
  assert.equal(result.claimedCount, 1);
  assert.equal(result.operations[0].operationId, ID1);
  assert.deepEqual(
    result.operations[0].contract,
    query1,
  );
});

test("two claimed operations retain distinct parameters", async () => {
  const first = operation();
  const second = operation(ID2, TOKEN2, query2);
  const result = await run(
    mocked(envelope([first, second])),
  );

  assert.equal(result.claimedCount, 2);
  assert.equal(result.operations[0].claimToken, TOKEN1);
  assert.equal(result.operations[1].claimToken, TOKEN2);
  assert.deepEqual(result.operations[0].contract, query1);
  assert.deepEqual(result.operations[1].contract, query2);
});

test("invalid request never executes RPC", async () => {
  let calls = 0;

  const rpc: OpenAiCostClaimingRpc = async () => {
    calls++;
    return { data: envelope([]), error: null };
  };

  for (const value of [
    { limit: 0, claimedBy: ACTOR },
    { limit: 11, claimedBy: ACTOR },
    { limit: 1.5, claimedBy: ACTOR },
    { limit: 1, claimedBy: " actor" },
    { limit: 1, claimedBy: "" },
  ]) {
    await rejectsCode(
      () => claimVerifiedOpenAiCostOperations(
        value,
        { rpc, now: () => NOW },
      ),
      "OPENAI_COST_CLAIM_REQUEST_INVALID",
    );
  }

  assert.equal(calls, 0);
});

test("invalid claim envelope cannot reach assert", async () => {
  for (const bad of [
    { ...envelope(), outcome: "other" },
    { ...envelope(), claimed_count: 2 },
    { ...envelope(), lease_minutes: 30 },
    { ...envelope(), operations: "invalid" },
  ]) {
    let assertions = 0;

    await rejectsCode(
      () => run(async (name) => {
        if (name === OPENAI_COST_ASSERT_RPC) assertions++;
        return { data: bad, error: null };
      }),
      "OPENAI_COST_CLAIM_RESPONSE_INVALID",
    );

    assert.equal(assertions, 0);
  }
});

test("wrong actor and malformed token fail closed", async () => {
  for (const changed of [
    { ...operation(), claimed_by: "other-worker" },
    { ...operation(), claim_token: "invalid" },
    { ...operation(), state: "pending" },
  ]) {
    await rejectsCode(
      () => run(mocked(envelope([changed]))),
      "OPENAI_COST_CLAIM_RESPONSE_INVALID",
    );
  }
});

test("duplicate operation or claim token is rejected", async () => {
  for (const items of [
    [operation(), operation(ID1, TOKEN2)],
    [operation(), operation(ID2, TOKEN1)],
  ]) {
    await rejectsCode(
      () => run(mocked(envelope(items))),
      "OPENAI_COST_CLAIM_RESPONSE_INVALID",
    );
  }
});

test("altered stored filters cannot be reconstructed", async () => {
  const changed = {
    ...operation(),
    query_parameters: {
      ...query1.queryParameters,
      project_ids: ["unexpected"],
    },
  };

  await rejectsCode(
    () => run(mocked(envelope([changed]))),
    "OPENAI_COST_CLAIM_RESPONSE_INVALID",
  );
});

test("claimed period must equal persisted query period", async () => {
  const changed = {
    ...operation(),
    period_start: "2026-10-24T00:00:00Z",
  };

  await rejectsCode(
    () => run(mocked(envelope([changed]))),
    "OPENAI_COST_CLAIM_RESPONSE_INVALID",
  );
});

test("expired lease is never accepted", async () => {
  const changed = {
    ...operation(),
    claim_expires_at: "2026-10-26T17:59:59Z",
  };

  await rejectsCode(
    () => run(mocked(envelope([changed]))),
    "OPENAI_COST_CLAIM_RESPONSE_INVALID",
  );
});

test("assertion mismatch or rejection cannot authorize work", async () => {
  for (const changed of [
    { ...assertion(), operation_id: ID2 },
    { ...assertion(), operation_key: "other-key" },
    { ...assertion(), state: "confirmed" },
    { ...assertion(), claimed_by: "wrong-worker" },
    { ...assertion(), claim_expires_at: "2026-10-26T17:00:00Z" },
  ]) {
    await rejectsCode(
      () => run(mocked(envelope(), changed)),
      "OPENAI_COST_CLAIM_ASSERT_UNCONFIRMED",
    );
  }

  await rejectsCode(
    () => run(async (name) => {
      if (name === OPENAI_COST_CLAIM_RPC) {
        return { data: envelope(), error: null };
      }

      return {
        data: null,
        error: { code: "PGRST116" },
      };
    }),
    "OPENAI_COST_CLAIM_ASSERT_UNCONFIRMED",
  );
});

test("transport failures never trigger blind claim retry", async () => {
  let attempts = 0;

  await rejectsCode(
    () => run(async () => {
      attempts++;
      throw new Error("transport");
    }),
    "OPENAI_COST_CLAIM_OUTCOME_UNCERTAIN",
  );

  assert.equal(attempts, 1);

  await rejectsCode(
    () => run(async () => ({
      data: null,
      error: { code: "NETWORK" },
    })),
    "OPENAI_COST_CLAIM_OUTCOME_UNCERTAIN",
  );

  await rejectsCode(
    () => run(async (name) => {
      if (name === OPENAI_COST_CLAIM_RPC) {
        return { data: envelope(), error: null };
      }

      throw new Error("assert transport");
    }),
    "OPENAI_COST_CLAIM_ASSERT_UNCONFIRMED",
  );
});

test("assertion RPC matches installed PostgreSQL identifier", () => {
  assert.equal(
    OPENAI_COST_ASSERT_RPC,
    "zion_admin_assert_openai_cost_collection_operation_claim_by_sys",
  );

  assert.equal(
    Buffer.byteLength(OPENAI_COST_ASSERT_RPC, "utf8"),
    63,
  );
});
