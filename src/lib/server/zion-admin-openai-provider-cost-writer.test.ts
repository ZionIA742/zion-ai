import assert from "node:assert/strict";
import test from "node:test";
import type { OpenAiOrganizationCostsCollection } from "./openai-organization-costs-collector";
import {
  buildOpenAiProviderCostSnapshotRpcParameters,
  OPENAI_PROVIDER_COST_SNAPSHOT_RPC,
  OpenAiProviderCostWriterError,
  type OpenAiProviderCostSnapshotRpcParameters,
  writeOpenAiProviderCostSnapshot,
} from "./zion-admin-openai-provider-cost-writer";

function collection(overrides: Partial<OpenAiOrganizationCostsCollection> = {}): OpenAiOrganizationCostsCollection {
  const collectionId = overrides.collectionId || "collection-2026-10-26-a";
  const queryIdentity = overrides.queryIdentity || "openai_organization_costs:v1:start_time=1792969200&end_time=1793142000&bucket_width=1d";
  const record = {
    source: "openai_organization_costs" as const,
    provider: "openai" as const,
    bucketWidth: "1d" as const,
    periodStartUnixSeconds: 1792969200,
    periodEndUnixSeconds: 1793055600,
    periodStartIso: "2026-10-25T23:00:00.000Z",
    periodEndIso: "2026-10-26T23:00:00.000Z",
    providerPeriodTimezone: "UTC" as const,
    financialCompetence: null,
    amountCurrency: "usd",
    amountValue: 0.000001,
    amountValueDecimal: "0.000001",
    projectId: "proj_a",
    userId: null,
    lineItem: "gpt-5.2",
    apiKeyId: "key_a",
    apiSource: "agents_api" as const,
    quantity: 12.5,
    quantityUnit: "tokens",
    providerBucketObject: "bucket",
    providerResultObject: "organization.costs.result",
    providerPage: 1,
    providerResultIndex: 0,
    providerLineIdentity: "openai_organization_costs_line:v1:1792969200:1793055600:organization.costs.result:proj_a:~:gpt-5.2:key_a:agents_api",
    providerVersionFingerprint: "version:0.000001",
    collectionId,
    queryIdentity,
  };
  return {
    source: "openai_organization_costs",
    provider: "openai",
    status: "available",
    collectionId,
    queryIdentity,
    period: { startTime: 1792969200, endTime: 1793142000, bucketWidth: "1d", providerPeriodTimezone: "UTC", financialCompetence: null },
    groupBy: ["project_id", "line_item"],
    pages: 1,
    records: [record],
    ...overrides,
  };
}

function confirmation(payload: OpenAiProviderCostSnapshotRpcParameters, outcome: "inserted" | "replayed" = "inserted") {
  return {
    outcome,
    collection_id: "db-collection-id",
    collection_key: payload.p_collection.collection_key,
    status: payload.p_collection.status,
    line_count: payload.p_lines.length,
  };
}

test("builds one UTC daily collection and preserves fractional USD decimal text", () => {
  const payload = buildOpenAiProviderCostSnapshotRpcParameters(collection(), new Date("2026-10-26T12:00:00.000Z"));
  assert.equal(payload.p_collection.period_start, "2026-10-25T23:00:00.000Z");
  assert.equal(payload.p_lines[0].amount_numeric, "0.000001");
  assert.equal(payload.p_lines[0].amount_decimal_text, "0.000001");
  assert.equal(payload.p_lines[0].currency, "USD");
  assert.equal(payload.p_collection.query_parameters.financial_competence, null);
});

test("preserves an interval crossing months as UTC without assigning Sao Paulo competence", () => {
  const crossing = collection({
    period: { startTime: 1793487600, endTime: 1793660400, bucketWidth: "1d", providerPeriodTimezone: "UTC", financialCompetence: null },
  });
  crossing.records[0] = {
    ...crossing.records[0],
    periodStartUnixSeconds: 1793487600,
    periodEndUnixSeconds: 1793574000,
    periodStartIso: "2026-10-31T23:00:00.000Z",
    periodEndIso: "2026-11-01T23:00:00.000Z",
    providerLineIdentity: "crossing-month-line",
    providerVersionFingerprint: "crossing-month-version",
  };
  const payload = buildOpenAiProviderCostSnapshotRpcParameters(crossing, new Date("2026-11-03T12:00:00.000Z"));
  assert.equal(payload.p_collection.period_start, "2026-10-31T23:00:00.000Z");
  assert.equal(payload.p_collection.period_end, "2026-11-02T23:00:00.000Z");
  assert.equal(payload.p_collection.query_parameters.financial_competence, null);
});

test("preserves multiple projects, billing lines and non-USD currencies", () => {
  const value = collection();
  value.records.push({ ...value.records[0], projectId: "proj_b", lineItem: "web_search", amountCurrency: "eur", amountValue: 1.234567, amountValueDecimal: "1.234567", providerResultIndex: 1, providerLineIdentity: "other-line", providerVersionFingerprint: "other-version" });
  const payload = buildOpenAiProviderCostSnapshotRpcParameters(value, new Date("2026-10-26T12:00:00.000Z"));
  assert.equal(payload.p_lines.length, 2);
  assert.deepEqual(payload.p_lines.map((line) => [line.project_id, line.line_item, line.currency, line.amount_decimal_text]), [["proj_a", "gpt-5.2", "USD", "0.000001"], ["proj_b", "web_search", "EUR", "1.234567"]]);
});

test("permits only a confirmed empty collection with no lines", () => {
  const empty = collection({ status: "confirmed_empty", records: [] });
  const payload = buildOpenAiProviderCostSnapshotRpcParameters(empty, new Date("2026-10-26T12:00:00.000Z"));
  assert.equal(payload.p_collection.result_count, 0);
  assert.deepEqual(payload.p_lines, []);
});

test("rejects incomplete, unavailable, malformed and duplicate normalized collections before RPC", async () => {
  const unavailable = collection({ status: "unavailable" as never });
  await assert.rejects(() => writeOpenAiProviderCostSnapshot(unavailable, { rpc: async () => { throw new Error("must not run"); } }), OpenAiProviderCostWriterError);
  const malformed = collection();
  malformed.records[0].amountValueDecimal = "0.00";
  assert.throws(() => buildOpenAiProviderCostSnapshotRpcParameters(malformed), OpenAiProviderCostWriterError);
  const duplicate = collection();
  duplicate.records.push({ ...duplicate.records[0] });
  assert.throws(() => buildOpenAiProviderCostSnapshotRpcParameters(duplicate), OpenAiProviderCostWriterError);
});

test("calls only the atomic snapshot RPC and reports inserted only after database confirmation", async () => {
  let received: OpenAiProviderCostSnapshotRpcParameters | undefined;
  const result = await writeOpenAiProviderCostSnapshot(collection(), {
    now: () => new Date("2026-10-26T12:00:00.000Z"),
    rpc: async (name, payload) => {
      assert.equal(name, OPENAI_PROVIDER_COST_SNAPSHOT_RPC);
      received = payload;
      return { data: confirmation(payload), error: null };
    },
  });
  assert.equal(result.confirmed, true);
  assert.equal(result.outcome, "inserted");
  assert.equal(received?.p_lines.length, 1);
  assert.equal(JSON.stringify(received).includes("ai_runs"), false);
});

test("an exact retry preserves the collection key and accepts only a replay confirmation", async () => {
  const first = collection();
  const payloadA = buildOpenAiProviderCostSnapshotRpcParameters(first, new Date("2026-10-26T12:00:00.000Z"));
  const result = await writeOpenAiProviderCostSnapshot(first, { rpc: async (_name, payload) => ({ data: confirmation(payload, "replayed"), error: null }) });
  const payloadB = buildOpenAiProviderCostSnapshotRpcParameters(first, new Date("2026-10-27T12:00:00.000Z"));
  assert.equal(result.outcome, "replayed");
  assert.equal(payloadA.p_collection.collection_key, payloadB.p_collection.collection_key);
});

test("a later re-query has a distinct immutable collection key even with the same query", () => {
  const prior = buildOpenAiProviderCostSnapshotRpcParameters(collection({ collectionId: "execution-one" }));
  const revised = collection({ collectionId: "execution-two" });
  revised.records[0].amountValue = 0.000002;
  revised.records[0].amountValueDecimal = "0.000002";
  revised.records[0].providerVersionFingerprint = "version:0.000002";
  const next = buildOpenAiProviderCostSnapshotRpcParameters(revised);
  assert.notEqual(prior.p_collection.collection_key, next.p_collection.collection_key);
  assert.notEqual(prior.p_lines[0].provider_version_fingerprint, next.p_lines[0].provider_version_fingerprint);
});

test("does not report success for RPC error, malformed response, or wrong line count", async () => {
  const input = collection();
  await assert.rejects(() => writeOpenAiProviderCostSnapshot(input, { rpc: async () => ({ data: null, error: { code: "42501" } }) }), OpenAiProviderCostWriterError);
  await assert.rejects(() => writeOpenAiProviderCostSnapshot(input, { rpc: async () => ({ data: { outcome: "inserted" }, error: null }) }), OpenAiProviderCostWriterError);
  await assert.rejects(() => writeOpenAiProviderCostSnapshot(input, { rpc: async (_name, payload) => ({ data: { ...confirmation(payload), line_count: 0 }, error: null }) }), OpenAiProviderCostWriterError);
});

test("does not report success until the RPC promise resolves", async () => {
  let resolveRpc: ((value: { data: unknown; error: null }) => void) | undefined;
  const writing = writeOpenAiProviderCostSnapshot(collection(), {
    rpc: async (_name, payload) => new Promise((resolve) => { resolveRpc = () => resolve({ data: confirmation(payload), error: null }); }),
  });
  let settled = false;
  void writing.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  resolveRpc?.({ data: null, error: null });
  const result = await writing;
  assert.equal(result.confirmed, true);
});
