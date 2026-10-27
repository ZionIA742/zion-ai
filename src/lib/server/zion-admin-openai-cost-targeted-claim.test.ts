import assert from "node:assert/strict";
import test from "node:test";

import {
  claimVerifiedTargetedOpenAiCostOperation,
  OPENAI_COST_TARGETED_CLAIM_RPC,
} from "./zion-admin-openai-cost-targeted-claim";

import {
  OPENAI_COST_ASSERT_RPC,
  OpenAiCostClaimError,
} from "./zion-admin-openai-cost-claimed-operations";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import type {
  OpenAiCostClaimDependencies,
} from "./zion-admin-openai-cost-claimed-operations";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "99999999-9999-4999-8999-999999999999";
const TOKEN = "22222222-2222-4222-8222-222222222222";
const ACTOR = "zion-admin-financial-worker";

const NOW = new Date("2026-10-27T14:00:00Z");
const EXPIRES = "2026-10-27T14:10:00Z";

const contract = buildOpenAiCostQueryContract({
  startTime: 1792886400,
  endTime: 1792972800,
  groupBy: ["line_item"],
  projectIds: ["proj-a"],
  limit: 10,
});

function claimItem(id = ID) {
  return {
    operation_id: id,
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
  };
}

function envelope(
  operations: ReturnType<typeof claimItem>[],
) {
  return {
    outcome: "claimed",
    claimed_count: operations.length,
    lease_minutes: 15,
    operations,
  };
}

function assertion() {
  return {
    outcome: "valid",
    operation_id: ID,
    operation_key: "costs:2026-10-25",
    state: "processing",
    attempt_count: 1,
    claim_expires_at: EXPIRES,
    claimed_by: ACTOR,
  };
}

function dependencies(
  onRpc: NonNullable<OpenAiCostClaimDependencies["rpc"]>,
): OpenAiCostClaimDependencies {
  return {
    now: () => NOW,
    rpc: onRpc,
  };
}

async function expectCode(
  action: () => Promise<unknown>,
  code: string,
) {
  await assert.rejects(
    action,
    (error: unknown) =>
      error instanceof OpenAiCostClaimError &&
      error.code === code,
  );
}

test("targeted RPC name matches deployed function", () => {
  assert.equal(
    OPENAI_COST_TARGETED_CLAIM_RPC,
    "zion_admin_claim_openai_cost_operation_by_id_by_system",
  );
  assert.ok(
    Buffer.byteLength(OPENAI_COST_TARGETED_CLAIM_RPC, "utf8") <= 63,
  );
});

test("invalid operation ID fails before RPC", async () => {
  let calls = 0;

  await expectCode(
    () => claimVerifiedTargetedOpenAiCostOperation(
      { operationId: "invalid", claimedBy: ACTOR },
      dependencies(async () => {
        calls++;
        throw new Error("Must not execute");
      }),
    ),
    "OPENAI_COST_CLAIM_REQUEST_INVALID",
  );

  assert.equal(calls, 0);
});

test("invalid actor fails before RPC", async () => {
  let calls = 0;

  await expectCode(
    () => claimVerifiedTargetedOpenAiCostOperation(
      { operationId: ID, claimedBy: " actor " },
      dependencies(async () => {
        calls++;
        throw new Error("Must not execute");
      }),
    ),
    "OPENAI_COST_CLAIM_REQUEST_INVALID",
  );

  assert.equal(calls, 0);
});

test("zero operations does not call assertion", async () => {
  const calls: string[] = [];

  const result = await claimVerifiedTargetedOpenAiCostOperation(
    { operationId: ID, claimedBy: ACTOR },
    dependencies(async (name, params) => {
      calls.push(name);
      assert.equal(name, OPENAI_COST_TARGETED_CLAIM_RPC);
      assert.deepEqual(params, {
        p_operation_id: ID,
        p_claimed_by: ACTOR,
      });

      return { data: envelope([]), error: null };
    }),
  );

  assert.equal(result.claimedCount, 0);
  assert.deepEqual(result.operations, []);
  assert.deepEqual(calls, [OPENAI_COST_TARGETED_CLAIM_RPC]);
});

test("matching targeted claim requires valid assertion", async () => {
  const calls: string[] = [];

  const result = await claimVerifiedTargetedOpenAiCostOperation(
    { operationId: ID, claimedBy: ACTOR },
    dependencies(async (name, params) => {
      calls.push(name);

      if (name === OPENAI_COST_TARGETED_CLAIM_RPC) {
        assert.deepEqual(params, {
          p_operation_id: ID,
          p_claimed_by: ACTOR,
        });

        return {
          data: envelope([claimItem()]),
          error: null,
        };
      }

      assert.equal(name, OPENAI_COST_ASSERT_RPC);
      assert.equal(params.p_operation_id, ID);
      assert.equal(params.p_claim_token, TOKEN);

      return { data: assertion(), error: null };
    }),
  );

  assert.equal(result.claimedCount, 1);
  assert.equal(result.operations[0].operationId, ID);
  assert.equal(
    result.operations[0].contract.queryIdentity,
    contract.queryIdentity,
  );
  assert.deepEqual(calls, [
    OPENAI_COST_TARGETED_CLAIM_RPC,
    OPENAI_COST_ASSERT_RPC,
  ]);
});

test("wrong operation is rejected before assertion", async () => {
  const calls: string[] = [];

  await expectCode(
    () => claimVerifiedTargetedOpenAiCostOperation(
      { operationId: ID, claimedBy: ACTOR },
      dependencies(async (name) => {
        calls.push(name);
        return {
          data: envelope([claimItem(OTHER_ID)]),
          error: null,
        };
      }),
    ),
    "OPENAI_COST_CLAIM_OUTCOME_UNCERTAIN",
  );

  assert.deepEqual(calls, [OPENAI_COST_TARGETED_CLAIM_RPC]);
});

test("claim RPC error is uncertain without retry", async () => {
  const calls: string[] = [];

  await expectCode(
    () => claimVerifiedTargetedOpenAiCostOperation(
      { operationId: ID, claimedBy: ACTOR },
      dependencies(async (name) => {
        calls.push(name);

        return {
          data: null,
          error: { code: "NETWORK" },
        };
      }),
    ),
    "OPENAI_COST_CLAIM_OUTCOME_UNCERTAIN",
  );

  assert.deepEqual(calls, [OPENAI_COST_TARGETED_CLAIM_RPC]);
});

test("claim transport exception is uncertain without retry", async () => {
  let calls = 0;

  await expectCode(
    () => claimVerifiedTargetedOpenAiCostOperation(
      { operationId: ID, claimedBy: ACTOR },
      dependencies(async () => {
        calls++;
        throw new Error("Connection lost");
      }),
    ),
    "OPENAI_COST_CLAIM_OUTCOME_UNCERTAIN",
  );

  assert.equal(calls, 1);
});

test("assertion rejection blocks claim consumption", async () => {
  const calls: string[] = [];

  await expectCode(
    () => claimVerifiedTargetedOpenAiCostOperation(
      { operationId: ID, claimedBy: ACTOR },
      dependencies(async (name) => {
        calls.push(name);

        if (name === OPENAI_COST_TARGETED_CLAIM_RPC) {
          return {
            data: envelope([claimItem()]),
            error: null,
          };
        }

        assert.equal(name, OPENAI_COST_ASSERT_RPC);

        return {
          data: null,
          error: { code: "CLAIM_NOT_ACTIVE" },
        };
      }),
    ),
    "OPENAI_COST_CLAIM_ASSERT_UNCONFIRMED",
  );

  assert.deepEqual(calls, [
    OPENAI_COST_TARGETED_CLAIM_RPC,
    OPENAI_COST_ASSERT_RPC,
  ]);
});

test("expired lease cannot authorize processing", async () => {
  let calls = 0;

  await expectCode(
    () => claimVerifiedTargetedOpenAiCostOperation(
      { operationId: ID, claimedBy: ACTOR },
      {
        now: () => new Date("2026-10-27T14:20:00Z"),
        rpc: async () => {
          calls++;
          return {
            data: envelope([claimItem()]),
            error: null,
          };
        },
      },
    ),
    "OPENAI_COST_CLAIM_RESPONSE_INVALID",
  );

  assert.equal(calls, 1);
});
