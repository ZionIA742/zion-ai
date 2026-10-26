import assert from "node:assert/strict";
import test from "node:test";

import type {
  OpenAiCostPrepareRpc,
} from "./zion-admin-openai-cost-operation-preparer";

import {
  OPENAI_COST_PREPARE_RPC,
  OpenAiCostPrepareError,
  prepareOpenAiCostOperation,
} from "./zion-admin-openai-cost-operation-preparer";

import {
  OpenAiCostQueryContractError,
} from "./zion-admin-openai-cost-query-contract";

const ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT = "22222222-2222-4222-8222-222222222222";

const request = {
  operationKey: "zion-admin-costs-20261026",
  costsRequest: {
    startTime: 1792886400,
    endTime: 1793059200,
    groupBy: ["project_id", "line_item"] as
      Array<"project_id" | "line_item">,
    projectIds: ["proj-z", "proj-a"],
    limit: 180,
  },
};

function prepared(
  overrides: Record<string, unknown> = {},
) {
  return {
    outcome: "created",
    operation_id: ID,
    operation_key: request.operationKey,
    state: "pending",
    attempt_count: 0,
    max_attempts: 3,
    next_attempt_at: "2026-10-26T19:00:00Z",
    snapshot_collection_id: null,
    ...overrides,
  };
}

function mock(
  data: unknown = prepared(),
): OpenAiCostPrepareRpc {
  return async () => ({
    data,
    error: null,
  });
}

function assertCode(
  action: () => Promise<unknown>,
  code: string,
) {
  return assert.rejects(
    action,
    (error: unknown) =>
      error instanceof Error &&
      error.message === code,
  );
}

test("prepares canonical query without collecting costs", async () => {
  let calls = 0;

  const rpc: OpenAiCostPrepareRpc = async (name, params) => {
    calls += 1;

    assert.equal(name, OPENAI_COST_PREPARE_RPC);
    assert.equal(params.p_operation_key, request.operationKey);
    assert.equal(params.p_supersedes_operation_id, null);

    assert.equal(
      params.p_query_parameters.query_identity,
      params.p_query_identity,
    );

    assert.equal(
      params.p_query_parameters.start_time,
      request.costsRequest.startTime,
    );

    assert.equal(
      params.p_query_parameters.end_time,
      request.costsRequest.endTime,
    );

    assert.deepEqual(
      params.p_query_parameters.group_by,
      ["line_item", "project_id"],
    );

    assert.deepEqual(
      params.p_query_parameters.project_ids,
      ["proj-a", "proj-z"],
    );

    assert.equal(params.p_query_parameters.limit, 180);
    assert.equal(
      params.p_query_parameters.financial_competence,
      null,
    );

    assert.match(params.p_period_start, /Z$/);
    assert.match(params.p_period_end, /Z$/);

    return { data: prepared(), error: null };
  };

  const result = await prepareOpenAiCostOperation(
    request,
    { rpc },
  );

  assert.equal(calls, 1);
  assert.equal(result.outcome, "created");
  assert.equal(result.operationId, ID);
  assert.equal(result.state, "pending");
});

test("same stable key accepts idempotent existing operation", async () => {
  const result = await prepareOpenAiCostOperation(
    request,
    {
      rpc: mock(prepared({
        outcome: "existing",
      })),
    },
  );

  assert.equal(result.outcome, "existing");
  assert.equal(result.operationKey, request.operationKey);
  assert.equal(result.attemptCount, 0);
});

test("existing uncertain state remains uncertain", async () => {
  const result = await prepareOpenAiCostOperation(
    request,
    {
      rpc: mock(prepared({
        outcome: "existing",
        state: "uncertain",
        attempt_count: 1,
        next_attempt_at: null,
      })),
    },
  );

  assert.equal(result.state, "uncertain");
  assert.equal(result.nextAttemptAt, null);
});

test("existing confirmed operation preserves its snapshot", async () => {
  const result = await prepareOpenAiCostOperation(
    request,
    {
      rpc: mock(prepared({
        outcome: "existing",
        state: "confirmed",
        attempt_count: 1,
        next_attempt_at: null,
        snapshot_collection_id: SNAPSHOT,
      })),
    },
  );

  assert.equal(result.state, "confirmed");
  assert.equal(result.snapshotCollectionId, SNAPSHOT);
});

test("explicit supersession is passed unchanged", async () => {
  let received: string | null = null;

  await prepareOpenAiCostOperation(
    {
      ...request,
      supersedesOperationId: SNAPSHOT,
    },
    {
      rpc: async (_name, params) => {
        received = params.p_supersedes_operation_id;
        return { data: prepared(), error: null };
      },
    },
  );

  assert.equal(received, SNAPSHOT);
});

test("invalid operation keys never call RPC", async () => {
  let calls = 0;
  const rpc: OpenAiCostPrepareRpc = async () => {
    calls += 1;
    return { data: prepared(), error: null };
  };

  for (const operationKey of ["", " key", "key ", "x".repeat(1025)]) {
    await assertCode(
      () => prepareOpenAiCostOperation(
        { ...request, operationKey },
        { rpc },
      ),
      "OPENAI_COST_PREPARE_INVALID_REQUEST",
    );
  }

  assert.equal(calls, 0);
});

test("invalid supersession never calls RPC", async () => {
  let calls = 0;
  const rpc: OpenAiCostPrepareRpc = async () => {
    calls += 1;
    return { data: prepared(), error: null };
  };

  await assertCode(
    () => prepareOpenAiCostOperation(
      {
        ...request,
        supersedesOperationId: "not-a-uuid",
      },
      { rpc },
    ),
    "OPENAI_COST_PREPARE_INVALID_REQUEST",
  );

  assert.equal(calls, 0);
});

test("invalid canonical query never calls RPC", async () => {
  let calls = 0;
  const rpc: OpenAiCostPrepareRpc = async () => {
    calls += 1;
    return { data: prepared(), error: null };
  };

  await assert.rejects(
    () => prepareOpenAiCostOperation(
      {
        ...request,
        costsRequest: {
          ...request.costsRequest,
          endTime: request.costsRequest.startTime,
        },
      },
      { rpc },
    ),
    OpenAiCostQueryContractError,
  );

  assert.equal(calls, 0);
});

test("RPC reported errors fail closed", async () => {
  await assertCode(
    () => prepareOpenAiCostOperation(
      request,
      {
        rpc: async () => ({
          data: null,
          error: { code: "23505" },
        }),
      },
    ),
    "OPENAI_COST_PREPARE_RPC_FAILED",
  );
});

test("RPC transport exceptions fail closed", async () => {
  await assertCode(
    () => prepareOpenAiCostOperation(
      request,
      {
        rpc: async () => {
          throw new Error("network");
        },
      },
    ),
    "OPENAI_COST_PREPARE_RPC_FAILED",
  );
});

test("mismatched responses never confirm preparation", async () => {
  for (const value of [
    prepared({ operation_id: "invalid" }),
    prepared({ operation_key: "other-key" }),
    prepared({ state: "unknown" }),
    prepared({ max_attempts: 99 }),
    prepared({ next_attempt_at: null }),
    prepared({ outcome: "created", state: "confirmed" }),
    prepared({ state: "confirmed", snapshot_collection_id: null }),
  ]) {
    await assert.rejects(
      () => prepareOpenAiCostOperation(
        request,
        { rpc: mock(value) },
      ),
      OpenAiCostPrepareError,
    );
  }
});
