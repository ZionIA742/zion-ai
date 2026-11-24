"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const route = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../app/api/sales-quotes/[quoteId]/route.ts",
  ),
  "utf8",
);

test("leitura disponibiliza timestamp original sem perder precisao", () => {
  assert.match(
    route,
    /updated_at:\s*scope\.quote\.updated_at\s*\?\?\s*null/,
  );
});

test("leitura preserva identificador da versao atual", () => {
  assert.match(
    route,
    /current_version_id:\s*currentVersionId\s*\|\|\s*null/,
  );
});

test("procedencia utiliza autoridade existente", () => {
  assert.match(
    route,
    /assertHumanQuoteEditProvenance\(quote\)/,
  );

  assert.match(
    route,
    /human_edit_provenance_verified:\s*hasVerifiedHumanEditProvenance\(scope\.quote\)/,
  );
});

test("procedencia ausente retorna falso sem ocultar erros inesperados", () => {
  assert.match(
    route,
    /if \(error instanceof HumanQuoteEditProvenanceError\)\s*\{\s*return false;\s*\}\s*throw error;/,
  );
});

test("nao expoe identificador do criador na resposta", () => {
  assert.doesNotMatch(
    route,
    /creation_actor_user_id\s*:/,
  );
});
