import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./route.ts", import.meta.url),
  "utf8",
);

test("monthly catalog query validates the competence", () => {
  assert.match(source, /GET\(request: Request\)/);
  assert.match(source, /getAll\("month"\)/);
  assert.match(source, /Competência mensal inválida/);
});

test("catalog GET remains compatible without month", () => {
  assert.match(source, /month === null/);
  assert.match(source, /createZionAdminApiJsonResponse\(\{ items \}, 200\)/);
});

test("monthly expenses are filtered by competence, not expense date", () => {
  assert.match(source, /\.eq\("competence_month", month\)/);
  assert.match(source, /monthlyExpenses\.push\(\.\.\.data\)/);
  assert.match(source, /catalog_item_id/);
});

test("monthly response preserves status and unlinked records", () => {
  assert.match(source, /amount_minor,currency,expense_date,competence_month,source,status/);
  assert.match(source, /\{ items, month, monthlyExpenses \}/);
  assert.doesNotMatch(source, /\.eq\("status", "active"\)/);
});

test("incomplete queries fail closed with pagination", () => {
  assert.match(source, /CATALOG_PAGE_SIZE = 500/);
  assert.match(source, /CATALOG_MAX_PAGES = 40/);
  assert.match(source, /!catalogComplete/);
  assert.match(source, /!expensesComplete/);
  assert.match(source, /Lançamentos mensais indisponíveis/);
});

test("GET remains restricted to the administrator", () => {
  assert.match(source, /resolveZionAdminApiAccess/);
  assert.match(source, /capabilities\.includes\("manage_accounts"\)/);
});