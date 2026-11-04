import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./ZionAdminCostsSection.tsx", import.meta.url),
  "utf8",
);

test("new variable expenses load the permanent catalog", () => {
  assert.match(source, /loadVariableCatalog\(requestId\)/);
  assert.match(source, /fetch\("\/api\/zion-admin\/costs\/catalog"/);
  assert.match(source, /Array\.isArray\(payload\.items\)/);
  assert.match(source, /archivedAt===null/);
  assert.match(source, /Nenhum lançamento foi autorizado/);
});

test("the new form requires explicit catalog selection", () => {
  assert.match(source, /value=\{selectedVariableCatalogId\}/);
  assert.match(source, /Selecione uma despesa cadastrada/);
  assert.match(source, /entry\.id===selectedVariableCatalogId/);
  assert.match(source, /!selectedVariableCatalogId/);
  assert.doesNotMatch(
    source,
    /onChange=\{e=>setVariableName\(e\.target\.value\)\}/,
  );
});

test("canonical name, category and currency come from selection", () => {
  assert.match(source, /setVariableName\(chosen\?\.name\|\|""\)/);
  assert.match(source, /setVariableCategory\(chosen\?\.category\|\|""\)/);
  assert.match(source, /setVariableCurrency\(chosen\?\.currency\|\|"BRL"\)/);
  assert.match(source, /chosen\.name!==variableName/);
  assert.match(source, /chosen\.category!==variableCategory/);
  assert.match(source, /chosen\.currency!==variableCurrency/);
});

test("new expenses send the selected canonical ID to the API", () => {
  assert.match(
    source,
    /catalogItemId:action==="add_variable"\?selectedVariableCatalogId:undefined/,
  );
  assert.match(source, /expectedUpdatedAt:action==="edit_variable"/);
  assert.match(source, /setCatalogRefreshKey\(\(value\)=>value\+1\)/);
});

test("historical edits and cancellations preserve their identity", () => {
  assert.match(source, /startVariableEditing\(item\)/);
  assert.match(source, /setVariableName\(item\.name\)/);
  assert.match(source, /setVariableCategory\(item\.category\)/);
  assert.match(source, /setVariableCurrency\(item\.currency\)/);
  assert.match(source, /submitVariable\("cancel_variable",item\)/);
  assert.match(source, /variableEditing==="new"\?\(/);
  assert.doesNotMatch(
    source,
    /onChange=\{e=>setVariableCategory\(e\.target\.value\)\}/,
  );
});

test("concurrent catalog reads do not replace a newer selection", () => {
  assert.match(source, /\+\+catalogRequestSequence\.current/);
  assert.match(
    source,
    /catalogRequestSequence\.current===requestId/,
  );
  assert.match(source, /setVariableCatalogItems\(null\)/);
  assert.match(source, /setVariableCatalogError\(null\)/);
});