import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  "src/app/zion-admin/ZionAdminOpenAiOfficialCosts.tsx",
  "utf8"
);

const parent = readFileSync(
  "src/app/zion-admin/ZionAdminCostsSection.tsx",
  "utf8"
);

test("renders official cost section independently", () => {
  assert.ok(parent.includes("ZionAdminOpenAiOfficialCosts"));
  assert.ok(component.includes("OpenAI — Custos oficiais"));
  assert.ok(component.includes("/api/zion-admin/costs/openai-official?"));
});

test("uses read-only authenticated API requests", () => {
  assert.ok(component.includes('method: "GET"'));
  assert.ok(component.includes('credentials: "same-origin"'));
  assert.ok(component.includes('cache: "no-store"'));
});

test("does not present partial coverage as a complete total", () => {
  assert.ok(component.includes('report?.availability === "complete"'));
  assert.ok(component.includes('"Incompleto"'));
  assert.ok(component.includes("report.missingDays.length"));
});

test("preserves exact decimal text and lists individual days", () => {
  assert.ok(component.includes('value.replace(".", ",")'));
  assert.ok(component.includes("report.daily.slice().reverse().map"));
  assert.ok(component.includes('day.status === "confirmed_empty"'));
});

test("does not merge official and estimated costs", () => {
  assert.ok(component.includes("Não são somados novamente"));
  assert.ok(!component.includes("data.totals.totalCents"));
  assert.ok(!component.includes("data.totals.aiCostUsd"));
});

test("limits current month to closed UTC days", () => {
  assert.ok(component.includes("lastClosedUtcDay()"));
  assert.ok(component.includes("monthEndUtc(month)"));
});

test("shows daily USD, PTAX quotation date and estimated BRL", () => {
  assert.ok(component.includes("PTAX venda (data)"));
  assert.ok(component.includes("BRL estimado"));
  assert.ok(component.includes("formatPtax(day)"));
  assert.ok(component.includes("formatDayBrl(day)"));
  assert.ok(component.includes("ptaxQuotationDate"));
});

test("does not create a monthly BRL total for partial coverage", () => {
  assert.ok(component.includes("const officialBrlTotal = complete"));
  assert.ok(component.includes("report?.fx?.totalBrlEstimated"));
  assert.ok(component.includes('formatOfficialBrl(day.estimatedBrl)'));
  assert.ok(component.includes('if (value == null) return "Indisponível"'));
});

test("keeps BRL estimated and separate from card charges", () => {
  assert.ok(component.includes("BRL estimado pela PTAX"));
  assert.ok(component.includes("não valor cobrado pelo cartão"));
  assert.ok(component.includes("Não representa cobrança efetiva"));
});
