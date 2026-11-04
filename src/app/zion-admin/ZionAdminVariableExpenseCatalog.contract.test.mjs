import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("./ZionAdminVariableExpenseCatalog.tsx", import.meta.url),
  "utf8",
);
const parent = readFileSync(
  new URL("./ZionAdminCostsSection.tsx", import.meta.url),
  "utf8",
);

test("monthly catalog is read independently of daily filters", () => {
  assert.match(component, /new URLSearchParams\(\{ month \}\)/);
  assert.match(component, /\/api\/zion-admin\/costs\/catalog\?/);
  assert.match(parent, /ZionAdminVariableExpenseCatalog month=/);
  assert.match(parent, /anchor\.slice\(0, 7\)/);
});

test("only active expenses with canonical IDs are summed", () => {
  assert.match(component, /expense\.status === "cancelled"/);
  assert.match(component, /items\.get\(expense\.catalog_item_id\)/);
  assert.match(component, /item\.totalMinor \+ amount/);
  assert.match(component, /Number\.isSafeInteger\(updated\)/);
});

test("missing values are derived, not persisted", () => {
  assert.match(component, /totalMinor: 0/);
  assert.match(component, /money\(item\.totalMinor, item\.currency\)/);
  assert.doesNotMatch(component, /"\/api\/zion-admin\/costs"\s*,/);
  assert.doesNotMatch(component, /method:\s*"(?:PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(component, /\.insert\(|\.update\(|\.upsert\(/);
});

test("failures and historical unlinked expenses are explicit", () => {
  assert.match(component, /CATALOG_RESPONSE_INCOMPLETE/);
  assert.match(component, /Nenhum valor foi presumido/);
  assert.match(component, /unlinkedActive\+\+/);
  assert.match(component, /Arquivado/);
});

test("monthly values refresh after a successful financial mutation", () => {
  assert.match(
    parent,
    /setCatalogRefreshKey\(\(value\)=>value\+1\)/,
  );
  assert.match(parent, /refreshKey=\{catalogRefreshKey\}/);
  assert.match(component, /refreshKey: number/);
  assert.match(component, /\[month, refreshKey, catalogRevision\]/);
});

test("previous month values are hidden during a refresh", () => {
  assert.match(
    component,
    /load\?\.month === month && load\.refreshKey === refreshKey/,
  );
  assert.match(
    component,
    /setLoad\(\{ month, refreshKey, catalogRevision, status: "ready", snapshot \}\)/,
  );
  assert.match(
    component,
    /setLoad\(\{ month, refreshKey, catalogRevision, status: "error" \}\)/,
  );
});

test("catalog registration uses the authorized catalog endpoint", () => {
  assert.match(component, /async function submitCatalogItem/);
  assert.match(component, /method: "POST"/);
  assert.match(component, /action: "created"/);
  assert.match(component, /operationKey: catalogOperationKey\.current/);
  assert.match(component, /"\/api\/zion-admin\/costs\/catalog"/);
});

test("registration never creates financial expenses", () => {
  assert.doesNotMatch(
    component,
    /zion_admin_mutate_variable_expense|add_variable/,
  );
  assert.match(
    component,
    /Nenhuma despesa financeira foi lançada/,
  );
});

test("catalog retry key survives failures and resets after edits", () => {
  assert.match(
    component,
    /if \(!catalogOperationKey\.current\)/,
  );
  assert.match(
    component,
    /catalogOperationKey\.current = null/,
  );
  assert.match(component, /setCatalogSaving\(false\)/);
});

test("successful registration refreshes monthly data safely", () => {
  assert.match(
    component,
    /setCatalogRevision\(\(value\) => value \+ 1\)/,
  );
  assert.match(
    component,
    /\[month, refreshKey, catalogRevision\]/,
  );
  assert.match(
    component,
    /load\.catalogRevision === catalogRevision/,
  );
});