import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAiOfficialCostsGetHandler,
  dynamic,
  runtime,
} from "./route";
import type { OfficialCostClient, OfficialCostReport } from "@/lib/server/zion-admin-openai-official-cost-report";

const OP = "11111111-1111-4111-8111-111111111111";
const SNAP = "22222222-2222-4222-8222-222222222222";
const URL = "https://zion.example/api/zion-admin/costs/openai-official";
const period = { start: "2026-10-27T00:00:00.000Z", end: "2026-10-28T00:00:00.000Z" };

function access(ok: boolean) {
  if (!ok) {
    return {
      ok: false as const,
      httpStatus: 403 as const,
      payload: { ok: false as const, error: "DENIED", message: "denied", status: "cross_domain_forbidden" as const, reasonCode: "zion_admin_capability_denied" as const },
      resolution: {} as never,
    };
  }
  return { ok: true as const, supabase: {} as never, sessionUserId: "admin-1", resolution: {} as never };
}

function clientFor(
  data: Record<string, unknown[]>,
  observe?: (table: string, op: string, column: string, value: string) => void,
): OfficialCostClient {
  return {
    from<T>(table: string) {
      let selected = (data[table] ?? []) as Record<string, unknown>[];
      const query = {
        lt(column: string, value: string) {
          observe?.(table, "lt", column, value);
          selected = selected.filter((row) =>
            Date.parse(String(row[column])) < Date.parse(value)
          );
          return query;
        },
        gt(column: string, value: string) {
          observe?.(table, "gt", column, value);
          selected = selected.filter((row) =>
            Date.parse(String(row[column])) > Date.parse(value)
          );
          return query;
        },
        order(column: string, options: { ascending: boolean }) {
          selected = selected.slice().sort((a, b) =>
            String(a[column]).localeCompare(String(b[column])) *
            (options.ascending ? 1 : -1)
          );
          return query;
        },
        async range(from: number, to: number) {
          return {
            data: selected.slice(from, to + 1) as T[],
            error: null,
          };
        },
      };
      return {
        select(columns: string) { void columns; return query; },
      };
    },
  };
}

function rows(lineCount = 4) {
  const lines = Array.from({ length: lineCount }, (_, index) => ({
    id: `line-${index}`,
    collection_id: SNAP,
    period_start: period.start,
    period_end: period.end,
    currency: "USD",
    amount_decimal_text: index < 4 ? ["0.1", "0.04", "0.02", "0.0042352"][index] : "0.0001",
  }));
  return {
    zion_admin_openai_cost_collection_operations: [{ id: OP, operation_key: "key", provider: "openai", source: "openai_organization_costs", query_identity: "query-27", period_start: period.start, period_end: period.end, state: "confirmed", snapshot_collection_id: SNAP, supersedes_operation_id: null, confirmed_at: period.end }],
    zion_admin_provider_cost_collections: [{ id: SNAP, collection_key: "snapshot-27", provider: "openai", source: "openai_organization_costs", query_identity: "query-27", period_start: period.start, period_end: period.end, provider_timezone: "UTC", status: "available", result_count: lineCount, collected_at: period.end }],
    zion_admin_provider_cost_lines: lines,
  };
}

function handler(data: Record<string, unknown[]>, authorized = true) {
  return createOpenAiOfficialCostsGetHandler({
    resolveAccess: async () => access(authorized) as never,
    createServiceClient: () => clientFor(data),
  });
}

async function read(data: Record<string, unknown[]>, query = "?from=2026-10-27&to=2026-10-27", authorized = true) {
  return handler(data, authorized)(new Request(`${URL}${query}`));
}

test("route is Node and dynamic", () => {
  assert.equal(runtime, "nodejs");
  assert.equal(dynamic, "force-dynamic");
});

test("denies non-authorized administration before reading the ledger", async () => {
  const response = await read({}, "?from=2026-10-27&to=2026-10-27", false);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rejects invalid, inverted and excessive periods", async () => {
  const cases = ["?from=bad&to=2026-10-27", "?from=2026-10-28&to=2026-10-27", "?from=2026-01-01&to=2027-01-02"];
  for (const query of cases) {
    const response = await handler({})(new Request(`${URL}${query}`));
    assert.equal(response.status, 400);
  }
});

test("returns four official USD lines with exact decimal total", async () => {
  const response = await read(rows());
  assert.equal(response.status, 200);
  const body = await response.json() as OfficialCostReport & { ok: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.totalUsd, "0.1642352");
  assert.equal(body.totalFinancialLines, 4);
  assert.deepEqual(body.collectedDays, ["2026-10-27"]);
  assert.equal(body.daily[0].status, "available");
  assert.deepEqual(body.metadata.snapshotIds, [SNAP]);
});

test("distinguishes no collection and confirmed empty snapshot", async () => {
  const absent = await read({});
  assert.equal((await absent.json()).daily[0].status, "not_collected");
  const empty = rows(0);
  empty.zion_admin_provider_cost_collections[0].status = "confirmed_empty";
  const response = await read(empty);
  const body = await response.json();
  assert.equal(body.totalUsd, "0");
  assert.equal(body.daily[0].status, "confirmed_empty");
});

test("reports unavailable instead of summing duplicate or invalid coverage", async () => {
  const data = rows();
  data.zion_admin_openai_cost_collection_operations.push({ ...data.zion_admin_openai_cost_collection_operations[0], id: "33333333-3333-4333-8333-333333333333", snapshot_collection_id: "44444444-4444-4444-8444-444444444444" });
  const response = await read(data);
  assert.equal((await response.json()).availability, "unavailable");
});

test("honors supersession and does not double count", async () => {
  const data = rows();
  data.zion_admin_openai_cost_collection_operations.push({ id: "33333333-3333-4333-8333-333333333333", operation_key: "new", provider: "openai", source: "openai_organization_costs", query_identity: "query-27", period_start: period.start, period_end: period.end, state: "confirmed", snapshot_collection_id: SNAP, supersedes_operation_id: OP, confirmed_at: period.end } as never);
  const response = await read(data);
  assert.equal((await response.json()).totalUsd, "0.1642352");
});

test("loads all pages instead of silently truncating at 1000", async () => {
  const data = rows(1001);
  const response = await read(data);
  const body = await response.json();
  assert.equal(body.totalFinancialLines, 1001);
  assert.equal(body.totalUsd, "0.2639352");
});


test("pending supersession does not erase a confirmed snapshot", async () => {
  const data = rows();
  data.zion_admin_openai_cost_collection_operations.push({
    ...data.zion_admin_openai_cost_collection_operations[0],
    id: "33333333-3333-4333-8333-333333333333",
    state: "pending",
    snapshot_collection_id: null,
    supersedes_operation_id: OP,
  } as never);
  const response = await read(data);
  const body = await response.json();
  assert.equal(body.totalUsd, "0.1642352");
  assert.equal(body.daily[0].status, "available");
});

test("rejects snapshot with a different query identity", async () => {
  const data = rows();
  data.zion_admin_provider_cost_collections[0].query_identity = "different-query";
  const response = await read(data);
  const body = await response.json();
  assert.equal(body.availability, "unavailable");
  assert.equal(body.totalUsd, null);
});

test("does not attribute a multi-day collection to one day", async () => {
  const data = rows();
  data.zion_admin_openai_cost_collection_operations[0].period_start =
    "2026-10-26T00:00:00.000Z";
  data.zion_admin_provider_cost_collections[0].period_start =
    "2026-10-26T00:00:00.000Z";
  const response = await read(data);
  const body = await response.json();
  assert.equal(body.daily[0].status, "unavailable");
  assert.equal(body.totalUsd, null);
});

test("rejects financial lines outside the snapshot period", async () => {
  const data = rows();
  data.zion_admin_provider_cost_lines[0].period_start =
    "2026-10-26T00:00:00.000Z";
  const response = await read(data);
  assert.equal((await response.json()).availability, "unavailable");
});

test("treats null data without explicit error as source unavailable", async () => {
  const client: OfficialCostClient = {
    from<T>() {
      const query = {
        lt() { return query; },
        gt() { return query; },
        order() { return query; },
        async range() { return { data: null as T[] | null, error: null }; },
      };
      return { select(columns: string) { void columns; return query; } };
    },
  };
  const response = await createOpenAiOfficialCostsGetHandler({
    resolveAccess: async () => access(true) as never,
    createServiceClient: () => client,
  })(new Request(`${URL}?from=2026-10-27&to=2026-10-27`));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "SOURCE_UNAVAILABLE");
});
test("filters all financial tables by UTC period before pagination", async () => {
  const observed: string[] = [];
  const response = await createOpenAiOfficialCostsGetHandler({
    resolveAccess: async () => access(true) as never,
    createServiceClient: () => clientFor(
      rows(),
      (table, op, column, value) =>
        observed.push(`${table}:${op}:${column}:${value}`),
    ),
  })(new Request(`${URL}?from=2026-10-27&to=2026-10-27`));

  assert.equal(response.status, 200);

  for (const table of [
    "zion_admin_openai_cost_collection_operations",
    "zion_admin_provider_cost_collections",
    "zion_admin_provider_cost_lines",
  ]) {
    assert.ok(observed.includes(
      `${table}:lt:period_start:2026-10-28T00:00:00.000Z`
    ));
    assert.ok(observed.includes(
      `${table}:gt:period_end:2026-10-27T00:00:00.000Z`
    ));
  }
});
test("returns source unavailable on a read failure", async () => {
  const client: OfficialCostClient = { from() { const query = { lt() { return query; }, gt() { return query; }, order() { return query; }, async range() { return { data: null, error: new Error("unavailable") }; } }; return { select(columns: string) { void columns; return query; } }; } };
  const response = await createOpenAiOfficialCostsGetHandler({ resolveAccess: async () => access(true) as never, createServiceClient: () => client })(new Request(`${URL}?from=2026-10-27&to=2026-10-27`));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "SOURCE_UNAVAILABLE");
});
