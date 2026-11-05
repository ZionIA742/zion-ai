import assert from "node:assert/strict";
import test from "node:test";

import {
  createZionAdminCostsGetHandler,
  type ZionAdminCostsGetHandlerDeps,
} from "./route";

const URL = "https://zion.example/api/zion-admin/costs";
const TODAY = "2026-11-30";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type TestBody = {
  months: Array<Record<string, unknown>>;
  totals: Record<string, unknown>;
  dataAvailability: Record<string, unknown>;
  historicalClosures: Row[];
  [key: string]: unknown;
};

function authorized(ok = true) {
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

function queryFor(table: string, source: Row[], calls: string[], fail: boolean) {
  let selected = source.slice();
  const query = {
    select(_columns: string, options?: { count?: string; head?: boolean }) {
      if (options?.head) return query;
      return query;
    },
    eq(column: string, value: unknown) {
      calls.push(`${table}.eq.${column}`);
      selected = selected.filter((row) => row[column] === value);
      return query;
    },
    is(column: string, value: unknown) {
      calls.push(`${table}.is.${column}`);
      selected = selected.filter((row) => value === null ? row[column] == null : row[column] === value);
      return query;
    },
    gte(column: string, value: string) {
      selected = selected.filter((row) => String(row[column]) >= value);
      return query;
    },
    lt(column: string, value: string) {
      selected = selected.filter((row) => String(row[column]) < value);
      return query;
    },
    order(column: string, options: { ascending: boolean }) {
      selected.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (options.ascending ? 1 : -1));
      return query;
    },
    range(from: number, to: number) {
      return Promise.resolve({ data: selected.slice(from, to + 1), error: null });
    },
    then(resolve: (value: { data: Row[] | null; error: null; count?: number }) => unknown) {
      return Promise.resolve(resolve(fail
        ? { data: null, error: { message: "simulated failure" } as never }
        : { data: selected, error: null, count: table === "messages" || table === "store_assistant_messages" ? selected.length : undefined }));
    },
  };
  return query;
}

function client(tables: Tables, calls: string[], failTables: string[] = []) {
  return {
    from(table: string) {
      return queryFor(table, tables[table] ?? [], calls, failTables.includes(table));
    },
  } as never;
}

function baseTables(overrides: Tables = {}): Tables {
  return {
    zion_admin_fixed_cost_versions: [
      { item_id: "plus", effective_month: "2026-11-01", name: "Plus", amount_cents: 10400, frequency: "monthly", enabled: true },
      { item_id: "vercel", effective_month: "2026-11-01", name: "Vercel", amount_cents: 10000, frequency: "monthly", enabled: true },
      { item_id: "supabase", effective_month: "2026-11-01", name: "Supabase", amount_cents: 12500, frequency: "monthly", enabled: true },
      { item_id: "domain", effective_month: "2026-11-01", name: "Domain", amount_cents: 4000, frequency: "annual", enabled: true },
    ],
    zion_admin_fixed_cost_items: [
      { id: "plus", starts_on: "2026-11-23" }, { id: "vercel", starts_on: "2026-11-23" },
      { id: "supabase", starts_on: "2026-11-23" }, { id: "domain", starts_on: "2026-11-23" },
    ],
    zion_admin_monthly_closures: [],
    ai_runs: [],
    messages: [],
    store_assistant_messages: [],
    zion_admin_variable_expenses: [],
    ...overrides,
  };
}

function report(days: Row[]) {
  return { availability: "complete", daily: days } as never;
}

function harness(tables: Tables, options: { ok?: boolean; official?: Row[]; rates?: Row[]; calls?: string[]; failTables?: string[]; officialError?: boolean } = {}) {
  const calls = options.calls ?? [];
  const official = options.official ?? [];
  const rates = options.rates ?? [];
  const deps: ZionAdminCostsGetHandlerDeps = {
    resolveAccess: async () => authorized(options.ok !== false) as never,
    createServiceClient: () => client(tables, calls, options.failTables),
    today: () => TODAY,
    buildOfficialReport: async () => {
      if (options.officialError) throw new Error("simulated official source failure");
      return report(official);
    },
    loadPtax: async () => ({ source: "bcb_ptax_venda", daily: rates } as never),
  };
  return { get: createZionAdminCostsGetHandler(deps), calls };
}

async function read(get: (request: Request) => Promise<Response>, query: string) {
  const response = await get(new Request(`${URL}${query}`));
  return { status: response.status, body: await response.json() as TestBody };
}

test("GET integrado: custos fixos, OpenAI oficial, PTAX diária e isolamento operacional", async () => {
  const h = harness(baseTables({ ai_runs: [{ id: "run-1", created_at: "2026-11-25T12:00:00Z", status: "completed", cost_usd: "0.75", tokens_prompt: 10, tokens_completion: 20 }] }), {
    official: [{ date: "2026-11-25", status: "available", totalUsd: "1.00" }],
    rates: [{ date: "2026-11-25", quotationDate: "2026-11-25", rate: "5.25", status: "same_day" }],
  });
  const result = await read(h.get, "?period=month&anchor=2026-11-30");
  assert.equal(result.status, 200);
  assert.equal(result.body.months[0].fixedCents, 33233);
  assert.equal(result.body.months[0].officialOpenAiUsd, 1);
  assert.equal(result.body.totals.aiCostUsd, 0.75);
  assert.equal(result.body.totals.officialOpenAiUsd, 1);
  assert.equal(result.body.totals.variableCents, null);
  assert.equal(result.body.dataAvailability.metaFinancialEvidence, "unavailable");
  assert.ok(h.calls.includes("messages.eq.sender"));
});

test("GET integrado: início real impede accrual diário antes de 23/11", async () => {
  const h = harness(baseTables());
  const result = await read(h.get, "?period=day&anchor=2026-11-22");
  assert.equal(result.status, 200);
  assert.equal(result.body.months[0].fixedCents, 0);
  assert.equal(result.body.totals.aiCostUsd, null);
  assert.equal(result.body.totals.officialOpenAiUsd, null);
});

test("GET integrado: dois dias PTAX, arredondamento diário e USD preservado", async () => {
  const h = harness(baseTables(), {
    official: [
      { date: "2026-11-25", status: "available", totalUsd: "0.01" },
      { date: "2026-11-26", status: "available", totalUsd: "0.01" },
    ],
    rates: [
      { date: "2026-11-25", quotationDate: "2026-11-25", rate: "5.25", status: "same_day" },
      { date: "2026-11-26", quotationDate: "2026-11-26", rate: "5.35", status: "same_day" },
    ],
  });
  const result = await read(h.get, "?period=month&anchor=2026-11-30");
  assert.equal(result.body.months[0].officialOpenAiUsd, 0.02);
  assert.equal(result.body.dataAvailability.ptax, "available");
});

test("GET integrado: USD sem PTAX e fonte oficial incompleta não inventam BRL", async () => {
  const h = harness(baseTables({ zion_admin_variable_expenses: [
    { id: "usd-1", idempotency_key: "usd-1", name: "Manual USD", category: "other", description: null, amount_minor: 10, currency: "USD", expense_date: "2026-11-25", competence_month: "2026-11-01", source: "manual", status: "active", created_at: "2026-11-25", updated_at: "2026-11-25", cancelled_at: null },
  ] }), { official: [{ date: "2026-11-25", status: "available", totalUsd: "1.00" }], rates: [] });
  const result = await read(h.get, "?period=month&anchor=2026-11-30");
  assert.equal(result.body.months[0].manualUsdCents, 10);
  assert.equal(result.body.months[0].variableCents, null);
  assert.equal(result.body.months[0].totalCents, null);
  assert.equal(result.body.months[0].officialOpenAiUsd, 1);
  assert.equal(result.body.dataAvailability.ptax, "unavailable");
});

test("GET integrado: OpenAI oficial indisponível mantém o total financeiro incompleto", async () => {
  const h = harness(baseTables(), { officialError: true });
  const result = await read(h.get, "?period=month&anchor=2026-11-30");
  assert.equal(result.status, 200);
  assert.equal(result.body.dataAvailability.officialOpenAi, "unavailable");
  assert.equal(result.body.months[0].officialOpenAiUsd, null);
  assert.equal(result.body.months[0].totalCents, null);
});

test("GET integrado: falha da consulta manual é reportada sem somar despesa", async () => {
  const h = harness(baseTables(), { failTables: ["zion_admin_variable_expenses"] });
  const result = await read(h.get, "?period=month&anchor=2026-11-30");
  assert.equal(result.status, 200);
  assert.equal(result.body.dataAvailability.variableExpenses, "unavailable");
  assert.equal(result.body.variableExpenses, null);
  assert.equal(result.body.months[0].totalCents, null);
});

test("GET integrado: BRL ativo, cancelado e inválido respeitam a autoridade persistida", async () => {
  const h = harness(baseTables({ zion_admin_variable_expenses: [
    { id: "brl", idempotency_key: "brl", name: "BRL", category: "other", amount_minor: 1000, currency: "BRL", expense_date: "2026-11-25", competence_month: "2026-11-01", source: "manual", status: "active", created_at: "2026-11-25", updated_at: "2026-11-25", cancelled_at: null },
    { id: "cancel", idempotency_key: "cancel", name: "Cancelada", category: "other", amount_minor: 2000, currency: "BRL", expense_date: "2026-11-25", competence_month: "2026-11-01", source: "manual", status: "cancelled", created_at: "2026-11-25", updated_at: "2026-11-25", cancelled_at: "2026-11-26" },
    { id: "bad", idempotency_key: "bad", name: "Inválida", category: "other", amount_minor: 0, currency: "BRL", expense_date: "2026-11-25", competence_month: "2026-11-01", source: "manual", status: "active", created_at: "2026-11-25", updated_at: "2026-11-25", cancelled_at: null },
  ] }));
  const result = await read(h.get, "?period=month&anchor=2026-11-30");
  assert.equal(result.body.months[0].manualBrlCents, 1000);
  assert.equal(result.body.months[0].variableCents, null);
  assert.equal(result.body.months[0].totalCents, null);
});

test("GET integrado: fechamento congelado prevalece e não há escrita", async () => {
  const h = harness(baseTables({ zion_admin_monthly_closures: [{ month: "2026-10-01", fixed_brl_cents: 100, ai_usd: "2.00", fx_usd_brl: "5.00", variable_brl_cents: 200, total_brl_cents: 300, fixed_items: [], ai_runs: 4, closed_at: "2026-11-01" }], zion_admin_fixed_cost_versions: [] }));
  const result = await read(h.get, "?period=year&anchor=2026-11-30");
  assert.equal(result.status, 200);
  const frozen = result.body.months.find((row) => row.month === "2026-10-01");
  assert.equal(frozen.totalCents, 300);
  assert.equal(frozen.closed, true);
  assert.equal(result.body.historicalClosures[0].total_brl_cents, 300);
  assert.equal(h.calls.some((call) => call.includes("insert") || call.includes("update") || call.includes("rpc")), false);
});

test("snapshot mensal não torna consulta diária do mesmo mês financeiramente completa", async () => {
  const h = harness(baseTables({
    zion_admin_fixed_cost_versions: [],
    zion_admin_fixed_cost_items: [],
    zion_admin_monthly_closures: [{ month: "2026-10-01", fixed_brl_cents: 100, ai_usd: "2.00", fx_usd_brl: "5.00", variable_brl_cents: 200, total_brl_cents: 300, fixed_items: [], ai_runs: 4, closed_at: "2026-11-01" }],
  }));
  for (const period of ["day", "week"]) {
    const result = await read(h.get, `?period=${period}&anchor=2026-10-15`);
    assert.equal(result.status, 200);
    const row = result.body.months.find((value) => value.month === "2026-10-01");
    assert.equal(row?.closed, false);
    assert.equal(row?.costCompleteness, "incomplete");
    assert.equal(row?.totalCents, null);
    assert.equal(result.body.historicalClosures[0]?.total_brl_cents, 300);
  }
});

test("GET integrado: autorização negada bloqueia banco e fontes financeiras", async () => {
  const calls: string[] = [];
  const h = harness(baseTables(), { ok: false, calls, official: [{ date: "2026-11-25", status: "available", totalUsd: "1.00" }] });
  const result = await read(h.get, "?period=month&anchor=2026-11-30");
  assert.equal(result.status, 403);
  assert.deepEqual(calls, []);
});
