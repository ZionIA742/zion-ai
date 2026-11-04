import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./ZionAdminVariableExpenseCatalog.tsx", import.meta.url),
  "utf8",
);

const handlerStart = source.indexOf(
  "  async function changeCatalogStatus(",
);

const handlerEnd = source.indexOf(
  "\n  return (\n",
  handlerStart,
);

const handler =
  handlerStart >= 0 && handlerEnd > handlerStart
    ? source.slice(handlerStart, handlerEnd)
    : "";

test("catalog archive and restore reuse the secure endpoint", () => {
  assert.ok(handler.length > 0);
  assert.match(handler, /"archived" \| "restored"/);
  assert.match(handler, /item\.archived_at === null/);
  assert.match(
    handler,
    /fetch\(\s*"\/api\/zion-admin\/costs\/catalog"/,
  );
  assert.match(handler, /method: "POST"/);
  assert.match(handler, /action,/);
  assert.match(handler, /id: item\.id/);
  assert.match(handler, /operationKey: operation\.key/);
});

test("archiving requires explicit human confirmation", () => {
  assert.match(handler, /action === "archived"/);
  assert.match(handler, /window\.confirm\(/);
  assert.match(handler, /histórico/);
  assert.match(handler, /reativado/);
});

test("server must confirm ID and new archival state", () => {
  assert.match(handler, /response\.ok/);
  assert.match(handler, /payload\.ok === true/);
  assert.match(handler, /payload\.item\.id === item\.id/);
  assert.match(handler, /payload\.item\.archived_at/);
  assert.match(handler, /typeof payload\.item\.archived_at === "string"/);
  assert.match(handler, /payload\.item\.archived_at === null/);
});

test("retry keeps the same operation key after an error", () => {
  assert.match(source, /catalogStateOperation = useRef/);
  assert.match(
    handler,
    /operation\.action !== action/,
  );
  assert.match(
    handler,
    /operation\.itemId !== item\.id/,
  );
  assert.match(
    handler,
    /key: `zion-admin-catalog-\$\{crypto\.randomUUID\(\)\}`/,
  );
  assert.match(
    handler,
    /catalogStateOperation\.current = null/,
  );
  assert.match(
    handler,
    /finally \{\s*setCatalogSaving\(false\)/,
  );
});

test("catalog state changes refresh from the server", () => {
  assert.match(
    handler,
    /setCatalogRevision\(\(value\) => value \+ 1\)/,
  );
  assert.match(
    source,
    /\[month, refreshKey, catalogRevision\]/,
  );
  assert.match(handler, /current\.status !== "ready"/);
});

test("buttons preserve archived rows and historical totals", () => {
  assert.match(source, /current\.snapshot\.items\.map/);
  assert.match(source, /money\(item\.totalMinor, item\.currency\)/);
  assert.match(source, /item\.archived_at \? "Arquivado" : "Ativo"/);
  assert.match(source, /onClick=\{\(\) => void changeCatalogStatus\(item\)\}/);
  assert.match(source, /item\.archived_at \? "Reativar" : "Arquivar"/);
  assert.match(source, /disabled=\{catalogSaving\}/);
});

test("status changes never create financial expenses directly", () => {
  assert.doesNotMatch(
    handler,
    /zion_admin_mutate_variable_expense|add_variable/,
  );
  assert.doesNotMatch(
    handler,
    /\/api\/zion-admin\/costs["`]/,
  );
  assert.doesNotMatch(
    handler,
    /\.insert\(|\.update\(|\.upsert\(|\.delete\(/,
  );
});

test("existing name registration remains available", () => {
  assert.match(source, /async function submitCatalogItem/);
  assert.match(source, /action: "created"/);
  assert.match(source, /\+ Cadastrar nome/);
  assert.match(source, /setCreating\(false\)/);
});