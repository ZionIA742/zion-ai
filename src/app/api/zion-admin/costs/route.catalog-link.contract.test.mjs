import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(
  "src/app/api/zion-admin/costs/route.ts",
  "utf8",
);

const ui = readFileSync(
  "src/app/zion-admin/ZionAdminCostsSection.tsx",
  "utf8",
);

test("financial API reads the canonical catalog link", () => {
  assert.match(
    api,
    /\.select\("id,idempotency_key,catalog_item_id,name,category,/,
  );
  assert.match(
    api,
    /catalog_item_id: string \| null;/,
  );
});

test("UI accepts catalog links and historical unlinked records", () => {
  assert.match(
    ui,
    /type VariableExpense = \{[^\n]*catalog_item_id: string \| null;/,
  );
});

test("financial failures remain unavailable rather than zero", () => {
  assert.match(
    api,
    /variableExpensesResult\.error \? "unavailable"/,
  );
  assert.match(
    api,
    /variableExpenses: variableExpensesResult\.error \? null/,
  );
});

test("existing financial mutation remains unchanged", () => {
  assert.match(api, /zion_admin_mutate_variable_expense/);
  assert.match(api, /p_actor_id: access\.sessionUserId/);
});