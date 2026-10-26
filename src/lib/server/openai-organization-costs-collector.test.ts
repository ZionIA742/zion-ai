import assert from "node:assert/strict";
import test from "node:test";
import {
  collectOpenAiOrganizationCosts,
  OpenAiOrganizationCostsCollectorError,
} from "./openai-organization-costs-collector";

const baseRequest = { startTime: 1761955200, endTime: 1764720000 };

function page(data: unknown[], hasMore = false, nextPage: string | null = null) {
  return { object: "page", data, has_more: hasMore, next_page: nextPage };
}

function bucket(start = 1761955200, end = 1762041600, results: unknown[] = []) {
  return { object: "bucket", start_time: start, end_time: end, results };
}

function result(value = 0.06, extra: Record<string, unknown> = {}) {
  return { object: "organization.costs.result", amount: { value, currency: "usd" }, ...extra };
}

function mockFetch(responses: Array<{ status?: number; body?: unknown; reject?: boolean }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    calls,
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error("unexpected fetch");
      if (next.reject) throw new Error("network unavailable");
      return { ok: (next.status || 200) >= 200 && (next.status || 200) < 300, status: next.status || 200, json: async () => next.body };
    },
  };
}

async function expectCode(run: () => Promise<unknown>, code: string, retryable: boolean) {
  await assert.rejects(run, (error: unknown) => error instanceof OpenAiOrganizationCostsCollectorError && error.code === code && error.retryable === retryable);
}

test("collects daily official costs with half-open period and no estimated costs", async () => {
  const mock = mockFetch([{ body: page([bucket(undefined, undefined, [result(0.000123)])]) }]);
  const collection = await collectOpenAiOrganizationCosts(baseRequest, { adminKey: "admin-key", collectionId: "collection-1", fetch: mock.fetch });
  assert.equal(collection.status, "available");
  assert.equal(collection.records.length, 1);
  assert.equal(collection.records[0].amountValue, 0.000123);
  assert.equal(collection.records[0].amountValueDecimal, "0.000123");
  assert.equal(collection.records[0].source, "openai_organization_costs");
  assert.equal(collection.records[0].collectionId, "collection-1");
  assert.equal(collection.records[0].providerPeriodTimezone, "UTC");
  assert.equal(collection.records[0].financialCompetence, null);
  assert.equal(collection.period.endTime, 1764720000);
  const query = new URL(mock.calls[0].url).searchParams;
  assert.equal(query.get("start_time"), "1761955200");
  assert.equal(query.get("end_time"), "1764720000");
  assert.equal(query.get("bucket_width"), "1d");
  assert.deepEqual(mock.calls[0].init.headers, { Authorization: "Bearer admin-key", Accept: "application/json" });
});

test("paginates and preserves project, line item, quantity, and source dimensions", async () => {
  const mock = mockFetch([
    { body: page([bucket(undefined, undefined, [result(1.2, { project_id: "proj_a", line_item: "completions", quantity: 1200, quantity_unit: "tokens" })])], true, "cursor-2") },
    { body: page([bucket(1762041600, 1762128000, [result(2.34, { project_id: "proj_b", line_item: "images", api_source: "agents_api" })])]) },
  ]);
  const collection = await collectOpenAiOrganizationCosts({ ...baseRequest, groupBy: ["project_id", "line_item", "api_source"], projectIds: ["proj_a"], apiKeyIds: ["key_a"], lineItems: ["completions"], limit: 180 }, { adminKey: "admin-key", collectionId: "collection-2", fetch: mock.fetch });
  assert.equal(collection.pages, 2);
  assert.equal(collection.records[0].projectId, "proj_a");
  assert.equal(collection.records[0].lineItem, "completions");
  assert.equal(collection.records[0].quantity, 1200);
  assert.equal(collection.records[1].projectId, "proj_b");
  assert.equal(collection.records[1].apiSource, "agents_api");
  assert.equal(new URL(mock.calls[1].url).searchParams.get("page"), "cursor-2");
  assert.equal(new URL(mock.calls[0].url).searchParams.get("line_items"), "completions");
  assert.equal(new URL(mock.calls[0].url).searchParams.get("project_ids"), "proj_a");
  assert.equal(new URL(mock.calls[0].url).searchParams.get("api_key_ids"), "key_a");
  assert.equal(new URL(mock.calls[0].url).searchParams.get("limit"), "180");
});

test("represents an acknowledged empty page as confirmed_empty, not zero spend", async () => {
  const mock = mockFetch([{ body: page([]) }]);
  const collection = await collectOpenAiOrganizationCosts(baseRequest, { adminKey: "admin-key", fetch: mock.fetch });
  assert.equal(collection.status, "confirmed_empty");
  assert.deepEqual(collection.records, []);
});

test("rejects an official result without amount instead of recording zero", async () => {
  const mock = mockFetch([{ body: page([bucket(undefined, undefined, [{ object: "organization.costs.result", project_id: null }])]) }]);
  await expectCode(() => collectOpenAiOrganizationCosts(baseRequest, { adminKey: "admin-key", fetch: mock.fetch }), "OPENAI_COSTS_RESPONSE_INVALID", false);
});

test("preserves a non-USD currency and leaves UTC buckets without Sao Paulo competence", async () => {
  const mock = mockFetch([{ body: page([bucket(1764460800, 1764547200, [result(0.1, { amount: { value: 0.1, currency: "eur" } })])]) }]);
  const collection = await collectOpenAiOrganizationCosts(baseRequest, { adminKey: "admin-key", collectionId: "collection-eur", fetch: mock.fetch });
  const record = collection.records[0];
  assert.equal(record.amountCurrency, "eur");
  assert.equal(record.amountValueDecimal, "0.1");
  assert.equal(record.periodStartIso, "2025-11-30T00:00:00.000Z");
  assert.equal(record.providerPeriodTimezone, "UTC");
  assert.equal(record.financialCompetence, null);
});

test("rejects missing admin credential without using OPENAI_API_KEY", async () => {
  const mock = mockFetch([]);
  await expectCode(() => collectOpenAiOrganizationCosts(baseRequest, { adminKey: "", fetch: mock.fetch }), "OPENAI_ADMIN_KEY_MISSING", false);
  assert.equal(mock.calls.length, 0);
});

test("classifies provider HTTP, temporary, malformed, and repeated-page failures", async () => {
  for (const [status, code, retryable] of [[400, "OPENAI_COSTS_HTTP_FAILED", false], [401, "OPENAI_COSTS_AUTHENTICATION_FAILED", false], [403, "OPENAI_COSTS_AUTHENTICATION_FAILED", false], [429, "OPENAI_COSTS_RATE_LIMITED", true], [503, "OPENAI_COSTS_TEMPORARILY_UNAVAILABLE", true]] as const) {
    const mock = mockFetch([{ status }]);
    await expectCode(() => collectOpenAiOrganizationCosts(baseRequest, { adminKey: "admin-key", fetch: mock.fetch }), code, retryable);
  }
  await expectCode(() => collectOpenAiOrganizationCosts(baseRequest, { adminKey: "admin-key", fetch: mockFetch([{ reject: true }]).fetch }), "OPENAI_COSTS_TEMPORARILY_UNAVAILABLE", true);
  await expectCode(() => collectOpenAiOrganizationCosts(baseRequest, { adminKey: "admin-key", fetch: mockFetch([{ body: { object: "page", data: [] } }]).fetch }), "OPENAI_COSTS_RESPONSE_INVALID", false);
  const repeated = mockFetch([{ body: page([], true, "again") }, { body: page([], true, "again") }]);
  await expectCode(() => collectOpenAiOrganizationCosts(baseRequest, { adminKey: "admin-key", fetch: repeated.fetch }), "OPENAI_COSTS_PAGINATION_REPEATED", false);
  await expectCode(
    () => collectOpenAiOrganizationCosts({ ...baseRequest, groupBy: ["project_id", "user_id"] }, { adminKey: "admin-key", fetch: mockFetch([{ status: 400 }]).fetch }),
    "OPENAI_COSTS_HTTP_FAILED",
    false,
  );
});

test("accepts a period spanning months and rejects invalid periods or unsupported grouping", async () => {
  const mock = mockFetch([{ body: page([bucket(1764460800, 1764547200, [result(9.99)])]) }]);
  const collection = await collectOpenAiOrganizationCosts({ startTime: 1761955200, endTime: 1767225600, projectIds: ["proj_a"] }, { adminKey: "admin-key", fetch: mock.fetch });
  assert.equal(collection.records[0].periodStartIso, "2025-11-30T00:00:00.000Z");
  await expectCode(() => collectOpenAiOrganizationCosts({ startTime: 2, endTime: 2 }, { adminKey: "admin-key", fetch: mockFetch([]).fetch }), "OPENAI_COSTS_REQUEST_INVALID", false);
  await expectCode(() => collectOpenAiOrganizationCosts({ ...baseRequest, groupBy: ["model" as never] }, { adminKey: "admin-key", fetch: mockFetch([]).fetch }), "OPENAI_COSTS_REQUEST_INVALID", false);
  await expectCode(() => collectOpenAiOrganizationCosts({ ...baseRequest, limit: 181 }, { adminKey: "admin-key", fetch: mockFetch([]).fetch }), "OPENAI_COSTS_REQUEST_INVALID", false);
});

test("keeps collection, query, provider line, and revision identities distinct across a re-query", async () => {
  const body = page([bucket(undefined, undefined, [result(1.25, { project_id: "proj_a", line_item: "input_tokens" })])]);
  const first = await collectOpenAiOrganizationCosts(baseRequest, { adminKey: "admin-key", collectionId: "run-1", fetch: mockFetch([{ body }]).fetch });
  const second = await collectOpenAiOrganizationCosts(baseRequest, { adminKey: "admin-key", collectionId: "run-2", fetch: mockFetch([{ body }]).fetch });
  assert.notEqual(first.collectionId, second.collectionId);
  assert.equal(first.queryIdentity, second.queryIdentity);
  assert.equal(first.records[0].providerLineIdentity, second.records[0].providerLineIdentity);
  assert.equal(first.records[0].providerVersionFingerprint, second.records[0].providerVersionFingerprint);
  assert.equal("aiRunsCost" in first, false);
});
