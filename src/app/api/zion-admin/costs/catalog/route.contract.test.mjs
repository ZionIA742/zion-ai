import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("catalog route requires admin access for GET and POST", () => {
  assert.equal(
    (source.match(/resolveZionAdminApiAccess\(\)/g) ?? []).length,
    2,
  );
  assert.equal(
    (source.match(/capabilities\.includes\("manage_accounts"\)/g) ?? []).length,
    2,
  );
  assert.match(source, /createZionAdminApiDeniedResponse/);
  assert.match(source, /isUuid\(access\.sessionUserId\)/);
});

test("catalog mutations delegate to the audited RPC", () => {
  assert.match(source, /zion_admin_manage_variable_expense_catalog/);
  assert.match(source, /p_actor_id: access\.sessionUserId/);
  assert.match(source, /p_operation_key: operationKey/);
  assert.match(source, /p_item_id: itemId/);
  assert.match(source, /"created", "archived", "restored"/);
});

test("catalog endpoint does not mutate financial expenses", () => {
  assert.doesNotMatch(source, /amount_minor|amount_cents/);
  assert.doesNotMatch(source, /\.from\("zion_admin_variable_expenses"\)/);
  assert.match(source, /from\("zion_admin_variable_expense_catalog"\)/);
});

test("catalog errors remain non-success responses", () => {
  assert.match(source, /CATALOG_ITEM_ALREADY_EXISTS/);
  assert.match(source, /CATALOG_OPERATION_KEY_REUSED/);
  assert.match(source, /CATALOG_ITEM_NOT_FOUND/);
  assert.match(source, /Catálogo temporariamente indisponível/);
  assert.match(source, /Não foi possível confirmar a operação do catálogo/);
});