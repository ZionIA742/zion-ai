import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENAI_COST_QUARANTINE_ACTOR,
  OPENAI_COST_QUARANTINE_RPC,
  OpenAiCostQuarantineError,
  quarantineExpiredOpenAiCostOperations,
} from "./zion-admin-openai-cost-expired-quarantine";

import type {
  OpenAiCostQuarantineRpc,
} from "./zion-admin-openai-cost-expired-quarantine";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const TIME = "2026-10-26T18:00:00+00:00";

function operation(changes: Record<string, unknown> = {}) {
  return {
    operation_id: ID,
    operation_key: "openai-cost:2026-10-25",
    previous_state: "processing",
    state: "uncertain",
    attempt_count: 1,
    previous_claimed_by: "zion-admin-financial-worker",
    previous_claim_expires_at: TIME,
    matching_snapshot_candidates: 0,
    snapshot_linked: false,
    retry_scheduled: false,
    requires_reconciliation: true,
    ...changes,
  };
}

function result(
  items: unknown[] = [],
  changes: Record<string, unknown> = {},
) {
  return {
    outcome: "quarantine_completed",
    quarantined_count: items.length,
    operations: items,
    ...changes,
  };
}

function run(
  data: unknown,
  limit = 1,
  onCall?: () => void,
) {
  const rpc: OpenAiCostQuarantineRpc = async (name, parameters) => {
    onCall?.();

    assert.equal(name, OPENAI_COST_QUARANTINE_RPC);
    assert.deepEqual(parameters, {
      p_limit: limit,
      p_actor: OPENAI_COST_QUARANTINE_ACTOR,
    });

    return { data, error: null };
  };

  return quarantineExpiredOpenAiCostOperations(limit, { rpc });
}

function rejected(
  action: () => Promise<unknown>,
) {
  return assert.rejects(
    action,
    (error: unknown) =>
      error instanceof OpenAiCostQuarantineError &&
      error.code === "OPENAI_COST_QUARANTINE_UNCONFIRMED",
  );
}

test("empty quarantine reports zero operations", async () => {
  const value = await run(result());

  assert.equal(value.outcome, "quarantine_completed");
  assert.equal(value.quarantinedCount, 0);
  assert.deepEqual(value.operations, []);
});

test("expired operation becomes uncertain only", async () => {
  const value = await run(result([operation()]));

  assert.equal(value.quarantinedCount, 1);
  assert.equal(value.operations[0].previousState, "processing");
  assert.equal(value.operations[0].state, "uncertain");
  assert.equal(value.operations[0].retryScheduled, false);
  assert.equal(value.operations[0].snapshotLinked, false);
  assert.equal(value.operations[0].requiresReconciliation, true);
});

test("candidate snapshots remain evidence only", async () => {
  const value = await run(result([
    operation({ matching_snapshot_candidates: 2 }),
  ]));

  assert.equal(
    value.operations[0].matchingSnapshotCandidates,
    2,
  );
  assert.equal(value.operations[0].snapshotLinked, false);
  assert.equal(value.operations[0].retryScheduled, false);
});

test("multiple operations preserve distinct identities", async () => {
  const value = await run(result([
    operation(),
    operation({
      operation_id: ID2,
      operation_key: "openai-cost:2026-10-26",
    }),
  ]), 2);

  assert.equal(value.quarantinedCount, 2);
  assert.equal(value.operations[1].operationId, ID2);
});

test("maximum ten operations are accepted", async () => {
  const items = Array.from({ length: 10 }, (_, i) =>
    operation({
      operation_id:
        `33333333-3333-4333-8333-${String(i + 1).padStart(12, "0")}`,
      operation_key: `cost:${i}`,
    }),
  );

  const value = await run(result(items), 10);

  assert.equal(value.quarantinedCount, 10);
});

test("invalid limits never invoke the database", async () => {
  let calls = 0;

  for (const limit of [0, 11, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(
      () => quarantineExpiredOpenAiCostOperations(limit, {
        rpc: async () => {
          calls++;
          return { data: result(), error: null };
        },
      }),
      (error: unknown) =>
        error instanceof OpenAiCostQuarantineError &&
        error.code === "OPENAI_COST_QUARANTINE_INPUT_INVALID",
    );
  }

  assert.equal(calls, 0);
});

test("response count cannot exceed requested limit", async () => {
  await rejected(() => run(result([
    operation(),
    operation({ operation_id: ID2 }),
  ]), 1));
});

test("reported count must match returned operations", async () => {
  await rejected(() => run(result(
    [operation()],
    { quarantined_count: 0 },
  )));
});

test("duplicate operation identity is rejected", async () => {
  await rejected(() => run(result([
    operation(),
    operation({ operation_key: "another-key" }),
  ]), 2));
});

test("unexpected financial confirmation fields are rejected", async () => {
  await rejected(() => run(result(
    [operation()],
    { financial_confirmation_performed: true },
  )));
});

test("operation fields must match exact SQL contract", async () => {
  for (const changes of [
    { previous_state: "pending" },
    { state: "confirmed" },
    { snapshot_linked: true },
    { retry_scheduled: true },
    { requires_reconciliation: false },
    { snapshot_collection_id: ID2 },
    { operation_id: "invalid" },
    { operation_key: "" },
  ]) {
    await rejected(() => run(result([operation(changes)])));
  }
});

test("attempts and evidence counts require valid integers", async () => {
  for (const changes of [
    { attempt_count: 0 },
    { attempt_count: -1 },
    { attempt_count: 1.5 },
    { matching_snapshot_candidates: -1 },
    { matching_snapshot_candidates: 1.2 },
  ]) {
    await rejected(() => run(result([operation(changes)])));
  }
});

test("expired claim metadata must be well formed", async () => {
  for (const changes of [
    { previous_claim_expires_at: "invalid" },
    { previous_claim_expires_at: null },
    { previous_claimed_by: "" },
    { previous_claimed_by: "x".repeat(129) },
  ]) {
    await rejected(() => run(result([operation(changes)])));
  }
});

test("nullable previous actor is preserved without inference", async () => {
  const value = await run(result([
    operation({ previous_claimed_by: null }),
  ]));

  assert.equal(value.operations[0].previousClaimedBy, null);
});

test("malformed response never confirms quarantine", async () => {
  for (const payload of [
    null,
    [],
    "ok",
    {},
    result([], { outcome: "confirmed" }),
    result([], { operations: null }),
    result([], { quarantined_count: -1 }),
  ]) {
    await rejected(() => run(payload));
  }
});

test("RPC errors remain unconfirmed", async () => {
  let calls = 0;

  await rejected(() =>
    quarantineExpiredOpenAiCostOperations(1, {
      rpc: async () => {
        calls++;

        return {
          data: null,
          error: { code: "RPC_FAILED" },
        };
      },
    }),
  );

  assert.equal(calls, 1);
});

test("transport ambiguity is never retried automatically", async () => {
  let calls = 0;

  await rejected(() =>
    quarantineExpiredOpenAiCostOperations(1, {
      rpc: async () => {
        calls++;
        throw new Error("response lost after commit");
      },
    }),
  );

  assert.equal(calls, 1);
});

test("successful adapter invocation calls exactly one RPC", async () => {
  let calls = 0;

  await run(result([operation()]), 1, () => {
    calls++;
  });

  assert.equal(calls, 1);
});
