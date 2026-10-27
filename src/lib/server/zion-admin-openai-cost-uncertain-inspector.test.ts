import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENAI_COST_INSPECT_RPC,
  OpenAiCostInspectionError,
  inspectUncertainOpenAiCostOperation,
} from "./zion-admin-openai-cost-uncertain-inspector";

import type {
  OpenAiCostInspectRpc,
} from "./zion-admin-openai-cost-uncertain-inspector";

const ID = "11111111-1111-4111-8111-111111111111";
const SNAP = "22222222-2222-4222-8222-222222222222";
const DATE = "2026-10-26T18:00:00+00:00";

function candidate(changes: Record<string, unknown> = {}) {
  return {
    snapshot_collection_id: SNAP,
    collection_key: "openai_organization_costs:v1:test",
    status: "available",
    result_count: 1,
    collected_at: DATE,
    linked_confirmed_operations: 0,
    ...changes,
  };
}

function inspection(changes: Record<string, unknown> = {}) {
  return {
    outcome: "inspection_completed",
    operation_id: ID,
    operation_key: "costs:2026-10-25",
    state: "uncertain",
    attempt_count: 1,
    max_attempts: 3,
    last_error_code: "OPENAI_COST_LEASE_EXPIRED_UNCERTAIN",
    last_error_at: DATE,
    matching_snapshot_candidates: 0,
    candidates_already_linked_to_confirmed: 0,
    candidates_returned: 0,
    candidates_truncated: false,
    candidates: [],
    resolution: "requires_manual_reconciliation",
    ownership_confirmed: false,
    financial_confirmation_performed: false,
    retry_authorized: false,
    retry_scheduled: false,
    ...changes,
  };
}

function run(
  data: unknown,
  onCall?: () => void,
) {
  const rpc: OpenAiCostInspectRpc = async (name, params) => {
    onCall?.();
    assert.equal(name, OPENAI_COST_INSPECT_RPC);
    assert.deepEqual(params, { p_operation_id: ID });
    return { data, error: null };
  };

  return inspectUncertainOpenAiCostOperation(ID, { rpc });
}

function rejectsUnconfirmed(action: () => Promise<unknown>) {
  return assert.rejects(
    action,
    (error: unknown) =>
      error instanceof OpenAiCostInspectionError &&
      error.code === "OPENAI_COST_INSPECTION_UNCONFIRMED",
  );
}

test("no candidates remains manual reconciliation", async () => {
  const output = await run(inspection());

  assert.equal(output.outcome, "inspection_completed");
  assert.equal(output.candidatesReturned, 0);
  assert.equal(output.resolution, "requires_manual_reconciliation");
  assert.equal(output.ownershipConfirmed, false);
  assert.equal(output.financialConfirmationPerformed, false);
  assert.equal(output.retryAuthorized, false);
  assert.equal(output.retryScheduled, false);
});

test("one candidate is evidence rather than ownership", async () => {
  const output = await run(inspection({
    matching_snapshot_candidates: 1,
    candidates_returned: 1,
    candidates: [candidate()],
  }));

  assert.equal(output.candidates.length, 1);
  assert.equal(output.candidates[0].snapshotCollectionId, SNAP);
  assert.equal(output.ownershipConfirmed, false);
  assert.equal(output.financialConfirmationPerformed, false);
});

test("candidate linked to confirmed operation remains inconclusive", async () => {
  const output = await run(inspection({
    matching_snapshot_candidates: 1,
    candidates_already_linked_to_confirmed: 1,
    candidates_returned: 1,
    candidates: [candidate({
      linked_confirmed_operations: 1,
    })],
  }));

  assert.equal(
    output.candidatesAlreadyLinkedToConfirmed,
    1,
  );
  assert.equal(output.retryAuthorized, false);
});

test("multiple candidates are preserved without linking", async () => {
  const second = "33333333-3333-4333-8333-333333333333";

  const output = await run(inspection({
    matching_snapshot_candidates: 2,
    candidates_returned: 2,
    candidates: [
      candidate(),
      candidate({
        snapshot_collection_id: second,
        status: "confirmed_empty",
        result_count: 0,
      }),
    ],
  }));

  assert.equal(output.candidates.length, 2);
  assert.equal(output.candidates[1].status, "confirmed_empty");
});

test("truncated candidates keep their full total distinct", async () => {
  const candidates = Array.from({ length: 20 }, (_, index) => {
    const suffix = (index + 1).toString(16).padStart(12, "0");

    return candidate({
      snapshot_collection_id:
        `33333333-3333-4333-8333-${suffix}`,
    });
  });

  const output = await run(inspection({
    matching_snapshot_candidates: 21,
    candidates_returned: 20,
    candidates_truncated: true,
    candidates,
  }));

  assert.equal(output.matchingSnapshotCandidates, 21);
  assert.equal(output.candidatesReturned, 20);
  assert.equal(output.candidatesTruncated, true);
});

test("invalid UUID cannot invoke database", async () => {
  let calls = 0;

  for (const value of ["", "invalid", ID + "x"]) {
    await assert.rejects(
      () => inspectUncertainOpenAiCostOperation(value, {
        rpc: async () => {
          calls++;
          return { data: inspection(), error: null };
        },
      }),
      (error: unknown) =>
        error instanceof OpenAiCostInspectionError &&
        error.code === "OPENAI_COST_INSPECTION_REQUEST_INVALID",
    );
  }

  assert.equal(calls, 0);
});

test("different operation identity is never accepted", async () => {
  await rejectsUnconfirmed(() => run(inspection({
    operation_id: SNAP,
  })));
});

test("state other than uncertain is rejected", async () => {
  for (const state of ["confirmed", "processing", "pending"]) {
    await rejectsUnconfirmed(() => run(inspection({
      state,
    })));
  }
});

test("unexpected fields cannot assert financial success", async () => {
  await rejectsUnconfirmed(() => run(inspection({
    financial_total_usd: 100,
  })));
});

test("inconsistent candidate totals are rejected", async () => {
  for (const changes of [
    { candidates_returned: 1 },
    { matching_snapshot_candidates: 2 },
    { candidates_truncated: true },
    { candidates_already_linked_to_confirmed: 1 },
    { matching_snapshot_candidates: -1 },
  ]) {
    await rejectsUnconfirmed(() => run(inspection(changes)));
  }
});

test("invalid candidate fields are rejected", async () => {
  for (const changes of [
    { snapshot_collection_id: "invalid" },
    { collection_key: "" },
    { status: "pending" },
    { result_count: -1 },
    { collected_at: "invalid" },
    { linked_confirmed_operations: -1 },
    { unexpected: true },
  ]) {
    await rejectsUnconfirmed(() => run(inspection({
      matching_snapshot_candidates: 1,
      candidates_returned: 1,
      candidates: [candidate(changes)],
    })));
  }
});

test("financial and retry flags must all stay false", async () => {
  for (const key of [
    "ownership_confirmed",
    "financial_confirmation_performed",
    "retry_authorized",
    "retry_scheduled",
  ]) {
    await rejectsUnconfirmed(() => run(inspection({
      [key]: true,
    })));
  }
});

test("malformed envelopes cannot become valid results", async () => {
  for (const payload of [
    null,
    [],
    "ok",
    {},
    inspection({ outcome: "confirmed" }),
    inspection({ resolution: "safe_to_retry" }),
    inspection({ candidates: null }),
  ]) {
    await rejectsUnconfirmed(() => run(payload));
  }
});

test("RPC errors and transport exceptions are unconfirmed", async () => {
  let calls = 0;

  await rejectsUnconfirmed(() =>
    inspectUncertainOpenAiCostOperation(ID, {
      rpc: async () => {
        calls++;
        throw new Error("transport");
      },
    }),
  );

  assert.equal(calls, 1);

  await rejectsUnconfirmed(() =>
    inspectUncertainOpenAiCostOperation(ID, {
      rpc: async () => {
        calls++;
        return {
          data: null,
          error: { code: "RPC_UNAVAILABLE" },
        };
      },
    }),
  );

  assert.equal(calls, 2);
});

test("one inspection always makes exactly one RPC call", async () => {
  let calls = 0;

  await run(inspection(), () => {
    calls++;
  });

  assert.equal(calls, 1);
});

test("last error metadata must be valid", async () => {
  for (const changes of [
    { last_error_code: "lowercase" },
    { last_error_at: "not-a-date" },
    { attempt_count: 4 },
    { max_attempts: 0 },
  ]) {
    await rejectsUnconfirmed(() => run(inspection(changes)));
  }
});
