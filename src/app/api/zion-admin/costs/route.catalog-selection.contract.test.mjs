import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./route.ts", import.meta.url),
  "utf8",
);

const post = source.slice(
  source.indexOf("export async function POST("),
);

test("new expenses can carry a canonical catalog ID", () => {
  assert.match(
    post,
    /const catalogItemId = variableAction === "add_variable" \? payload\.catalogItemId : null/,
  );
  assert.match(
    post,
    /catalogItemId == null \|\| isUuid\(catalogItemId\)/,
  );
  assert.match(post, /!validCatalogId/);
});

test("catalog identity is verified on the server", () => {
  assert.match(
    post,
    /\.from\("zion_admin_variable_expense_catalog"\)/,
  );
  assert.match(
    post,
    /\.select\("id,name,category,currency,archived_at"\)/,
  );
  assert.match(post, /\.eq\("id", catalogItemId\)/);
  assert.match(post, /catalogItem\.archived_at !== null/);
  assert.match(post, /catalogItem\.name !== name/);
  assert.match(post, /catalogItem\.category !== category/);
  assert.match(post, /catalogItem\.currency !== currency/);
});

test("catalog lookup fails closed on missing or stale items", () => {
  assert.match(post, /if \(catalogError\)/);
  assert.match(post, /if \(!catalogItem\)/);
  assert.match(post, /Item do catálogo não encontrado/);
  assert.match(post, /catalogItem\.archived_at !== null/);
  assert.match(
    source,
    /VARIABLE_CATALOG_ITEM_ARCHIVED\|VARIABLE_CATALOG_ITEM_MISMATCH/,
  );
});

test("financial writes still use the original audited RPC", () => {
  assert.match(
    post,
    /db\.rpc\("zion_admin_mutate_variable_expense"/,
  );
  assert.match(post, /p_actor_id: access\.sessionUserId/);
  assert.match(post, /p_expected_updated_at: expectedUpdatedAt/);
  assert.match(post, /p_operation_key: operationKey/);
  assert.doesNotMatch(
    post,
    /\.from\("zion_admin_variable_expenses"\)\s*\.(?:insert|update|upsert|delete)/,
  );
});

test("legacy edits and cancellations remain independent", () => {
  assert.match(
    post,
    /variableAction === "add_variable" && isUuid\(catalogItemId\)/,
  );
  assert.match(
    post,
    /variableAction === "edit_variable" \? "edited" : "cancelled"/,
  );
  assert.match(
    post,
    /p_reason: reason/,
  );
});