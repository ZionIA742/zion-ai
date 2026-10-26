import assert from "node:assert/strict";
import test from "node:test";

import type {
  OpenAiOfficialCostRecord,
  OpenAiOrganizationCostsCollection,
} from "./openai-organization-costs-collector";

import type {
  ClaimedOpenAiCostOperation,
} from "./zion-admin-openai-cost-claimed-operations";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import {
  buildClaimedOpenAiCostFinalizePayload,
  finalizeClaimedOpenAiCostCollection,
  OPENAI_COST_FINALIZE_RPC,
  OpenAiCostFinalizeError,
} from "./zion-admin-openai-cost-operation-finalizer";

import type {
  OpenAiCostFinalizeRpc,
} from "./zion-admin-openai-cost-operation-finalizer";

import {
  OpenAiProviderCostWriterError,
} from "./zion-admin-openai-provider-cost-writer";

const ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT = "33333333-3333-4333-8333-333333333333";

const NOW = new Date("2026-10-26T18:00:00Z");
const EXPIRES = "2026-10-26T18:10:00Z";

const contract = buildOpenAiCostQueryContract({
  startTime: 1792886400,
  endTime: 1793059200,
  groupBy: ["project_id", "line_item"],
  projectIds: ["proj-a"],
  limit: 180,
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

function emptyCollection(): OpenAiOrganizationCostsCollection {
  return {
    source: "openai_organization_costs",
    provider: "openai",
    status: "confirmed_empty",
    collectionId: ID,
    queryIdentity: contract.queryIdentity,
    period: {
      startTime: contract.costsRequest.startTime,
      endTime: contract.costsRequest.endTime,
      bucketWidth: "1d",
      providerPeriodTimezone: "UTC",
      financialCompetence: null,
    },
    groupBy: [...(contract.costsRequest.groupBy ?? [])],
    pages: 1,
    records: [],
  };
}

function costRecord(): OpenAiOfficialCostRecord {
  return {
    source: "openai_organization_costs",
    provider: "openai",
    bucketWidth: "1d",
    periodStartUnixSeconds: 1792886400,
    periodEndUnixSeconds: 1792972800,
    periodStartIso: "2026-10-25T00:00:00.000Z",
    periodEndIso: "2026-10-26T00:00:00.000Z",
    providerPeriodTimezone: "UTC",
    financialCompetence: null,
    amountCurrency: "usd",
    amountValue: 0.000001,
    amountValueDecimal: "0.000001",
    projectId: "proj-a",
    userId: null,
    lineItem: "responses",
    apiKeyId: null,
    apiSource: "agents_api",
    quantity: 12.5,
    quantityUnit: "tokens",
    providerBucketObject: "bucket",
    providerResultObject: "organization.costs.result",
    providerPage: 1,
    providerResultIndex: 0,
    providerLineIdentity: "line:one",
    providerVersionFingerprint: "line:one:v1",
    collectionId: ID,
    queryIdentity: contract.queryIdentity,
  };
}

function availableCollection(): OpenAiOrganizationCostsCollection {
  return {
    ...emptyCollection(),
    status: "available",
    records: [costRecord()],
  };
}

function confirmation(
  changes: Record<string, unknown> = {},
) {
  return {
    outcome: "confirmed",
    operation_id: ID,
    operation_key: "costs:2026-10-25",
    snapshot_collection_id: SNAPSHOT,
    snapshot_outcome: "inserted",
    confirmed_at: "2026-10-26T18:01:00Z",
    ...changes,
  };
}

function rejected(
  action: () => Promise<unknown>,
  code: string,
) {
  return assert.rejects(
    action,
    (error: unknown) =>
      error instanceof OpenAiCostFinalizeError &&
      error.code === code,
  );
}

test("canonical payload matches claimed SQL query exactly", () => {
  const payload = buildClaimedOpenAiCostFinalizePayload(
    operation(),
    emptyCollection(),
    NOW,
  );

  assert.equal(payload.p_operation_id, ID);
  assert.equal(payload.p_claim_token, TOKEN);
  assert.equal(
    payload.p_collection.collection_key,
    `openai_organization_costs:v1:${ID}`,
  );
  assert.deepEqual(
    payload.p_collection.query_parameters,
    contract.queryParameters,
  );
  assert.equal(
    payload.p_collection.query_parameters.start_time,
    contract.costsRequest.startTime,
  );
  assert.equal(
    payload.p_collection.query_parameters.end_time,
    contract.costsRequest.endTime,
  );
  assert.deepEqual(
    payload.p_collection.query_parameters.project_ids,
    ["proj-a"],
  );
  assert.equal(payload.p_collection.status, "confirmed_empty");
  assert.deepEqual(payload.p_lines, []);
  assert.equal(Object.keys(payload.p_collection).length, 12);
});

test("empty collection confirms only after finalizer response", async () => {
  let calls = 0;

  const rpc: OpenAiCostFinalizeRpc = async (name, payload) => {
    calls++;
    assert.equal(name, OPENAI_COST_FINALIZE_RPC);
    assert.equal(payload.p_operation_id, ID);
    assert.equal(payload.p_claim_token, TOKEN);
    assert.deepEqual(
      payload.p_collection.query_parameters,
      contract.queryParameters,
    );

    return { data: confirmation(), error: null };
  };

  const result = await finalizeClaimedOpenAiCostCollection(
    operation(),
    emptyCollection(),
    { rpc, now: () => NOW },
  );

  assert.equal(calls, 1);
  assert.equal(result.outcome, "confirmed");
  assert.equal(result.snapshotCollectionId, SNAPSHOT);
});

test("available collection preserves decimal monetary lines", async () => {
  const result = await finalizeClaimedOpenAiCostCollection(
    operation(),
    availableCollection(),
    {
      now: () => NOW,
      rpc: async (_name, payload) => {
        assert.equal(payload.p_collection.status, "available");
        assert.equal(payload.p_collection.result_count, 1);
        assert.equal(payload.p_lines.length, 1);
        assert.equal(
          payload.p_lines[0].amount_decimal_text,
          "0.000001",
        );
        assert.equal(payload.p_lines[0].currency, "USD");
        assert.equal(Object.keys(payload.p_lines[0]).length, 18);

        return {
          data: confirmation({ snapshot_outcome: "replayed" }),
          error: null,
        };
      },
    },
  );

  assert.equal(result.snapshotOutcome, "replayed");
});

test("collection must reuse claimed operation UUID", () => {
  const changed = {
    ...emptyCollection(),
    collectionId: SNAPSHOT,
  };

  assert.throws(
    () => buildClaimedOpenAiCostFinalizePayload(
      operation(),
      changed,
      NOW,
    ),
    OpenAiCostFinalizeError,
  );
});

test("different query identity and filters fail closed", () => {
  const changedQuery = buildOpenAiCostQueryContract({
    ...contract.costsRequest,
    projectIds: ["proj-other"],
  });

  for (const changed of [
    {
      ...emptyCollection(),
      queryIdentity: changedQuery.queryIdentity,
    },
    {
      ...emptyCollection(),
      groupBy: ["line_item"] as Array<"line_item">,
    },
  ]) {
    assert.throws(
      () => buildClaimedOpenAiCostFinalizePayload(
        operation(),
        changed,
        NOW,
      ),
      OpenAiCostFinalizeError,
    );
  }
});

test("altered period and claimed contract are rejected", () => {
  const changedPeriod = {
    ...emptyCollection(),
    period: {
      ...emptyCollection().period,
      endTime: 1793145600,
    },
  };

  assert.throws(
    () => buildClaimedOpenAiCostFinalizePayload(
      operation(),
      changedPeriod,
      NOW,
    ),
    OpenAiCostFinalizeError,
  );

  assert.throws(
    () => buildClaimedOpenAiCostFinalizePayload(
      operation({
        contract: {
          ...contract,
          periodStart: "2026-10-24T00:00:00.000Z",
        },
      }),
      emptyCollection(),
      NOW,
    ),
    OpenAiCostFinalizeError,
  );
});

test("expired claim never calls finalization RPC", async () => {
  let calls = 0;

  await rejected(
    () => finalizeClaimedOpenAiCostCollection(
      operation({
        claimExpiresAt: "2026-10-26T17:00:00Z",
      }),
      emptyCollection(),
      {
        now: () => NOW,
        rpc: async () => {
          calls++;
          return { data: confirmation(), error: null };
        },
      },
    ),
    "OPENAI_COST_FINALIZE_LEASE_EXPIRED",
  );

  assert.equal(calls, 0);
});

test("malformed financial records never reach finalizer", () => {
  const changed = {
    ...availableCollection(),
    records: [{
      ...costRecord(),
      amountValueDecimal: "1.00",
    }],
  };

  assert.throws(
    () => buildClaimedOpenAiCostFinalizePayload(
      operation(),
      changed,
      NOW,
    ),
    OpenAiProviderCostWriterError,
  );
});

test("RPC error and transport exception remain unconfirmed", async () => {
  let calls = 0;

  await rejected(
    () => finalizeClaimedOpenAiCostCollection(
      operation(),
      emptyCollection(),
      {
        now: () => NOW,
        rpc: async () => {
          calls++;
          return {
            data: null,
            error: { code: "PGRST500" },
          };
        },
      },
    ),
    "OPENAI_COST_FINALIZE_UNCONFIRMED",
  );

  await rejected(
    () => finalizeClaimedOpenAiCostCollection(
      operation(),
      emptyCollection(),
      {
        now: () => NOW,
        rpc: async () => {
          calls++;
          throw new Error("transport");
        },
      },
    ),
    "OPENAI_COST_FINALIZE_UNCONFIRMED",
  );

  assert.equal(calls, 2);
});

test("malformed confirmation cannot become financial success", async () => {
  for (const changed of [
    { operation_id: SNAPSHOT },
    { operation_key: "another-operation" },
    { snapshot_collection_id: "invalid" },
    { snapshot_outcome: "unknown" },
    { outcome: "pending" },
    { confirmed_at: null },
  ]) {
    await rejected(
      () => finalizeClaimedOpenAiCostCollection(
        operation(),
        emptyCollection(),
        {
          now: () => NOW,
          rpc: async () => ({
            data: confirmation(changed),
            error: null,
          }),
        },
      ),
      "OPENAI_COST_FINALIZE_UNCONFIRMED",
    );
  }
});

test("bad claim token and invalid clock never call RPC", async () => {
  let calls = 0;

  const rpc: OpenAiCostFinalizeRpc = async () => {
    calls++;
    return { data: confirmation(), error: null };
  };

  await rejected(
    () => finalizeClaimedOpenAiCostCollection(
      operation({ claimToken: "invalid" }),
      emptyCollection(),
      { rpc, now: () => NOW },
    ),
    "OPENAI_COST_FINALIZE_INPUT_INVALID",
  );

  await rejected(
    () => finalizeClaimedOpenAiCostCollection(
      operation(),
      emptyCollection(),
      {
        rpc,
        now: () => new Date("invalid"),
      },
    ),
    "OPENAI_COST_FINALIZE_INPUT_INVALID",
  );

  assert.equal(calls, 0);
});
