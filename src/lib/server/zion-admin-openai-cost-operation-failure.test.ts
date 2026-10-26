import assert from "node:assert/strict";
import test from "node:test";

import type {
  ClaimedOpenAiCostOperation,
} from "./zion-admin-openai-cost-claimed-operations";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import {
  OPENAI_COST_FAIL_RPC,
  OpenAiCostFailureError,
  recordClaimedOpenAiCostFailure,
} from "./zion-admin-openai-cost-operation-failure";

import type {
  OpenAiCostFailureKind,
  OpenAiCostFailureRequest,
  OpenAiCostFailureRpc,
} from "./zion-admin-openai-cost-operation-failure";

const ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "22222222-2222-4222-8222-222222222222";

const NOW = new Date("2026-10-26T18:00:00Z");
const EXPIRES = "2026-10-26T18:10:00Z";
const NEXT5 = "2026-10-26T18:05:00Z";
const NEXT15 = "2026-10-26T18:15:00Z";

const contract = buildOpenAiCostQueryContract({
  startTime: 1792886400,
  endTime: 1792972800,
  groupBy: ["project_id"],
});

function operation(
  changes: Partial<ClaimedOpenAiCostOperation> = {},
): ClaimedOpenAiCostOperation {
  return {
    operationId: ID,
    operationKey: "costs:2026-10-25",
    claimToken: TOKEN,
    claimedBy: "zion-admin-financial-worker",
    claimExpiresAt: EXPIRES,
    attemptCount: 1,
    maxAttempts: 3,
    contract,
    ...changes,
  };
}

function request(
  kind: OpenAiCostFailureKind = "retryable",
  changes: Partial<OpenAiCostFailureRequest> = {},
): OpenAiCostFailureRequest {
  return {
    operation: operation(),
    kind,
    errorCode: "OPENAI_COSTS_RATE_LIMITED",
    ...changes,
  };
}

function result(
  changes: Record<string, unknown> = {},
) {
  return {
    outcome: "failure_recorded",
    operation_id: ID,
    operation_key: "costs:2026-10-25",
    state: "retryable_failed",
    event_kind: "failed_retryable",
    error_code: "OPENAI_COSTS_RATE_LIMITED",
    attempt_count: 1,
    max_attempts: 3,
    retry_scheduled: true,
    next_attempt_at: NEXT5,
    retry_delay_minutes: 5,
    ...changes,
  };
}

function run(
  req: OpenAiCostFailureRequest,
  rpc: OpenAiCostFailureRpc,
) {
  return recordClaimedOpenAiCostFailure(req, {
    rpc,
    now: () => NOW,
  });
}

function rejects(
  action: () => Promise<unknown>,
  code: string,
) {
  return assert.rejects(
    action,
    (error: unknown) =>
      error instanceof OpenAiCostFailureError &&
      error.code === code,
  );
}

test("first recoverable failure is scheduled after five minutes", async () => {
  let calls = 0;

  const output = await run(
    request(),
    async (name, params) => {
      calls++;
      assert.equal(name, OPENAI_COST_FAIL_RPC);
      assert.deepEqual(params, {
        p_operation_id: ID,
        p_claim_token: TOKEN,
        p_failure_kind: "retryable",
        p_error_code: "OPENAI_COSTS_RATE_LIMITED",
      });

      return { data: result(), error: null };
    },
  );

  assert.equal(calls, 1);
  assert.equal(output.outcome, "failure_recorded");
  assert.equal(output.state, "retryable_failed");
  assert.equal(output.retryScheduled, true);
  assert.equal(output.retryDelayMinutes, 5);
  assert.equal(output.nextAttemptAt, NEXT5);
});

test("second recoverable failure has fifteen-minute delay", async () => {
  const output = await run(
    request("retryable", {
      operation: operation({ attemptCount: 2 }),
    }),
    async () => ({
      data: result({
        attempt_count: 2,
        next_attempt_at: NEXT15,
        retry_delay_minutes: 15,
      }),
      error: null,
    }),
  );

  assert.equal(output.attemptCount, 2);
  assert.equal(output.retryDelayMinutes, 15);
  assert.equal(output.nextAttemptAt, NEXT15);
});

test("third recoverable failure exhausts maximum attempts", async () => {
  const output = await run(
    request("retryable", {
      operation: operation({ attemptCount: 3 }),
    }),
    async () => ({
      data: result({
        state: "permanent_failed",
        event_kind: "retry_limit_exhausted",
        attempt_count: 3,
        retry_scheduled: false,
        next_attempt_at: null,
        retry_delay_minutes: null,
      }),
      error: null,
    }),
  );

  assert.equal(output.state, "permanent_failed");
  assert.equal(output.eventKind, "retry_limit_exhausted");
  assert.equal(output.retryScheduled, false);
});

test("permanent failure never schedules retry", async () => {
  const output = await run(
    request("permanent"),
    async () => ({
      data: result({
        state: "permanent_failed",
        event_kind: "failed_permanent",
        retry_scheduled: false,
        next_attempt_at: null,
        retry_delay_minutes: null,
      }),
      error: null,
    }),
  );

  assert.equal(output.state, "permanent_failed");
  assert.equal(output.retryScheduled, false);
});

test("uncertain failure remains uncertain without retry", async () => {
  const output = await run(
    request("uncertain"),
    async () => ({
      data: result({
        state: "uncertain",
        event_kind: "marked_uncertain",
        retry_scheduled: false,
        next_attempt_at: null,
        retry_delay_minutes: null,
      }),
      error: null,
    }),
  );

  assert.equal(output.state, "uncertain");
  assert.equal(output.retryScheduled, false);
});

test("invalid technical codes never call database", async () => {
  let calls = 0;

  const rpc: OpenAiCostFailureRpc = async () => {
    calls++;
    return { data: result(), error: null };
  };

  for (const errorCode of [
    "",
    "openai_failed",
    "ERROR WITH SPACES",
    "ERROR_123_credential_value_exposed_to_someone",
    "X".repeat(65),
  ]) {
    await rejects(
      () => run(
        request("retryable", { errorCode }),
        rpc,
      ),
      "OPENAI_COST_FAILURE_REQUEST_INVALID",
    );
  }

  assert.equal(calls, 0);
});

test("invalid claims and leases never call database", async () => {
  let calls = 0;

  const rpc: OpenAiCostFailureRpc = async () => {
    calls++;
    return { data: result(), error: null };
  };

  for (const changes of [
    { claimToken: "invalid" },
    { operationId: "invalid" },
    { attemptCount: 4 },
    { maxAttempts: 4 as 3 },
    { claimedBy: "" },
  ]) {
    await rejects(
      () => run(
        request("retryable", {
          operation: operation(changes),
        }),
        rpc,
      ),
      "OPENAI_COST_FAILURE_REQUEST_INVALID",
    );
  }

  await rejects(
    () => run(
      request("retryable", {
        operation: operation({
          claimExpiresAt: "2026-10-26T17:59:59Z",
        }),
      }),
      rpc,
    ),
    "OPENAI_COST_FAILURE_LEASE_EXPIRED",
  );

  assert.equal(calls, 0);
});

test("mismatched confirmation never records success", async () => {
  for (const changes of [
    { outcome: "pending" },
    { operation_id: TOKEN },
    { operation_key: "other-key" },
    { error_code: "DIFFERENT_ERROR" },
    { state: "confirmed" },
    { event_kind: "failed_permanent" },
    { attempt_count: 2 },
    { max_attempts: 4 },
  ]) {
    await rejects(
      () => run(
        request(),
        async () => ({
          data: result(changes),
          error: null,
        }),
      ),
      "OPENAI_COST_FAILURE_RECORD_UNCONFIRMED",
    );
  }
});

test("invalid retry scheduling is rejected", async () => {
  for (const changes of [
    { retry_scheduled: false },
    { next_attempt_at: null },
    { next_attempt_at: "invalid" },
    { next_attempt_at: "2026-10-26T17:59:00Z" },
    { retry_delay_minutes: 15 },
  ]) {
    await rejects(
      () => run(
        request(),
        async () => ({
          data: result(changes),
          error: null,
        }),
      ),
      "OPENAI_COST_FAILURE_RECORD_UNCONFIRMED",
    );
  }
});

test("RPC errors and transport uncertainty do not retry", async () => {
  let calls = 0;

  await rejects(
    () => run(
      request(),
      async () => {
        calls++;
        throw new Error("transport");
      },
    ),
    "OPENAI_COST_FAILURE_RECORD_UNCONFIRMED",
  );

  assert.equal(calls, 1);

  await rejects(
    () => run(
      request(),
      async () => {
        calls++;
        return {
          data: null,
          error: { code: "PGRST500" },
        };
      },
    ),
    "OPENAI_COST_FAILURE_RECORD_UNCONFIRMED",
  );

  assert.equal(calls, 2);
});
