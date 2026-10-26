import assert from "node:assert/strict";
import test from "node:test";
import type {
  OpenAiOrganizationCostsCollection,
  OpenAiOrganizationCostsRequest,
} from "./openai-organization-costs-collector";
import {
  OpenAiProviderCostOrchestratorError,
  runOpenAiProviderCostCollection,
} from "./zion-admin-openai-provider-cost-orchestrator";
import { OpenAiOrganizationCostsCollectorError } from "./openai-organization-costs-collector";
import { OpenAiProviderCostWriterError } from "./zion-admin-openai-provider-cost-writer";

const costsRequest: OpenAiOrganizationCostsRequest = {
  startTime: 1792886400,
  endTime: 1793059200,
  groupBy: ["project_id", "line_item"],
  projectIds: ["proj-pilot"],
};

function collection(overrides: Partial<OpenAiOrganizationCostsCollection> = {}): OpenAiOrganizationCostsCollection {
  const collectionId = overrides.collectionId || "collection-operation-1";
  const queryIdentity = overrides.queryIdentity || "openai_organization_costs:v1:start_time=1792886400&end_time=1793059200";
  const record = {
    source: "openai_organization_costs" as const,
    provider: "openai" as const,
    bucketWidth: "1d" as const,
    periodStartUnixSeconds: 1792886400,
    periodEndUnixSeconds: 1792972800,
    periodStartIso: "2026-10-25T00:00:00.000Z",
    periodEndIso: "2026-10-26T00:00:00.000Z",
    providerPeriodTimezone: "UTC" as const,
    financialCompetence: null,
    amountCurrency: "usd",
    amountValue: 0.000001,
    amountValueDecimal: "0.000001",
    projectId: "proj-pilot",
    userId: null,
    lineItem: "responses",
    apiKeyId: null,
    apiSource: "agents_api" as const,
    quantity: 12.5,
    quantityUnit: "tokens",
    providerBucketObject: "bucket",
    providerResultObject: "organization.costs.result",
    providerPage: 1,
    providerResultIndex: 0,
    providerLineIdentity: "line:1792886400:proj-pilot:responses",
    providerVersionFingerprint: "line:1792886400:0.000001",
    collectionId,
    queryIdentity,
  };
  return {
    source: "openai_organization_costs",
    provider: "openai",
    status: "available",
    collectionId,
    queryIdentity,
    period: { startTime: costsRequest.startTime, endTime: costsRequest.endTime, bucketWidth: "1d", providerPeriodTimezone: "UTC", financialCompetence: null },
    groupBy: [...(costsRequest.groupBy || [])],
    pages: 1,
    records: [record],
    ...overrides,
  };
}

function writeConfirmation(collectionId: string, status: "available" | "confirmed_empty", lineCount: number, outcome: "inserted" | "replayed" = "inserted") {
  return {
    confirmed: true as const,
    outcome,
    collectionId: `db-${collectionId}`,
    collectionKey: `openai_organization_costs:v1:${collectionId}`,
    status,
    lineCount,
  };
}

test("persists a complete collection only after confirmed writer result, preserving decimal and UTC", async () => {
  let receivedAmountDecimal: string | null = null;
  let receivedTimezone: string | null = null;
  let receivedCompetence: unknown = undefined;
  let receivedSerialized = "";
  const result = await runOpenAiProviderCostCollection(
    { collectionId: "collection-operation-1", costsRequest },
    {
      collector: async (_request, dependencies) => {
        assert.equal(dependencies?.collectionId, "collection-operation-1");
        return collection();
      },
      writer: async (input) => {
        receivedAmountDecimal = input.records[0]?.amountValueDecimal || null;
        receivedTimezone = input.records[0]?.providerPeriodTimezone || null;
        receivedCompetence = input.records[0]?.financialCompetence;
        receivedSerialized = JSON.stringify(input);
        return writeConfirmation(input.collectionId, input.status, input.records.length);
      },
    },
  );
  assert.equal(result.write.confirmed, true);
  assert.equal(result.recordsCollected, 1);
  assert.equal(receivedAmountDecimal, "0.000001");
  assert.equal(receivedTimezone, "UTC");
  assert.equal(receivedCompetence, null);
  assert.equal(receivedSerialized.includes("ai_runs"), false);
});

test("persists a confirmed empty collection, never a synthetic zero-cost record", async () => {
  let writes = 0;
  const empty = collection({ status: "confirmed_empty", records: [] });
  const result = await runOpenAiProviderCostCollection(
    { collectionId: empty.collectionId, costsRequest },
    {
      collector: async () => empty,
      writer: async (input) => {
        writes += 1;
        return writeConfirmation(input.collectionId, input.status, input.records.length);
      },
    },
  );
  assert.equal(writes, 1);
  assert.equal(result.status, "confirmed_empty");
  assert.equal(result.recordsCollected, 0);
});

test("retries reuse the operation collection id and a later re-query uses another one", async () => {
  const seenIds: string[] = [];
  const writer = async (input: OpenAiOrganizationCostsCollection) => {
    seenIds.push(input.collectionId);
    return writeConfirmation(input.collectionId, input.status, input.records.length, seenIds.length === 1 ? "inserted" : "replayed");
  };
  const collector = async (_request: OpenAiOrganizationCostsRequest, dependencies?: { collectionId?: string }) => collection({ collectionId: dependencies?.collectionId });

  const first = await runOpenAiProviderCostCollection({ collectionId: "operation-retry", costsRequest }, { collector, writer });
  const replay = await runOpenAiProviderCostCollection({ collectionId: "operation-retry", costsRequest }, { collector, writer });
  const requery = await runOpenAiProviderCostCollection({ collectionId: "operation-requery", costsRequest }, { collector, writer });
  assert.equal(first.write.outcome, "inserted");
  assert.equal(replay.write.outcome, "replayed");
  assert.equal(requery.collectionId, "operation-requery");
  assert.deepEqual(seenIds, ["operation-retry", "operation-retry", "operation-requery"]);
});

test("collector failures never call the writer", async () => {
  let writes = 0;
  await assert.rejects(
    () => runOpenAiProviderCostCollection(
      { collectionId: "operation-failed", costsRequest },
      {
        collector: async () => {
          throw new OpenAiOrganizationCostsCollectorError("OPENAI_COSTS_RATE_LIMITED", true);
        },
        writer: async () => {
          writes += 1;
          throw new Error("must not run");
        },
      },
    ),
    (error: unknown) => error instanceof OpenAiOrganizationCostsCollectorError && error.code === "OPENAI_COSTS_RATE_LIMITED",
  );
  assert.equal(writes, 0);
});

test("partial, malformed, or mismatched collection never calls the writer", async () => {
  for (const incomplete of [
    collection({ pages: 0 }),
    collection({ collectionId: "different-operation" }),
    collection({ status: "confirmed_empty", records: [] , pages: 0 }),
  ]) {
    let writes = 0;
    await assert.rejects(
      () => runOpenAiProviderCostCollection(
        { collectionId: "collection-operation-1", costsRequest },
        {
          collector: async () => incomplete,
          writer: async () => {
            writes += 1;
            throw new Error("must not run");
          },
        },
      ),
      (error: unknown) => error instanceof OpenAiProviderCostOrchestratorError && error.code === "OPENAI_PROVIDER_COST_COLLECTION_INCOMPLETE",
    );
    assert.equal(writes, 0);
  }
});

test("writer rejection never becomes a successful collection", async () => {
  await assert.rejects(
    () => runOpenAiProviderCostCollection(
      { collectionId: "operation-rpc-failure", costsRequest },
      {
        collector: async () => collection({ collectionId: "operation-rpc-failure" }),
        writer: async () => {
          throw new OpenAiProviderCostWriterError("OPENAI_PROVIDER_COST_WRITER_RPC_FAILED");
        },
      },
    ),
    (error: unknown) => error instanceof OpenAiProviderCostWriterError && error.code === "OPENAI_PROVIDER_COST_WRITER_RPC_FAILED",
  );
});
