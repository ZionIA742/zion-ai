"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(
  __dirname,
  "human-quote-edit-provenance.ts",
);

const source = fs.readFileSync(sourcePath, "utf8");

const compiled = ts.transpileModule(source, {
  fileName: sourcePath,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const loaded = new Module(sourcePath, module);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(compiled, sourcePath);

const {
  assertHumanQuoteEditProvenance,
  HumanQuoteEditProvenanceError,
} = loaded.exports;

const userId = "11111111-2222-4333-8444-555555555555";

function humanMetadata() {
  return {
    created_via: "api_sales_quotes_create",
    creation_actor_kind: "user",
    creation_actor_user_id: userId,
  };
}

function reject(metadata) {
  assert.throws(
    () => assertHumanQuoteEditProvenance({ metadata }),
    (error) =>
      error instanceof HumanQuoteEditProvenanceError &&
      error.status === 403 &&
      error.code === "HUMAN_QUOTE_EDIT_PROVENANCE_REQUIRED",
  );
}

test("aceita procedencia humana completa", () => {
  assert.deepEqual(
    assertHumanQuoteEditProvenance({
      metadata: humanMetadata(),
    }),
    { creationActorUserId: userId },
  );
});

test("permite orcamento humano sem oportunidade ou conversa", () => {
  const quote = {
    commercial_opportunity_id: null,
    conversation_id: null,
    lead_id: null,
    metadata: humanMetadata(),
  };

  assert.equal(
    assertHumanQuoteEditProvenance(quote).creationActorUserId,
    userId,
  );
});

test("permite orcamento humano com oportunidade", () => {
  const quote = {
    commercial_opportunity_id: "opportunity-test",
    metadata: humanMetadata(),
  };

  assert.equal(
    assertHumanQuoteEditProvenance(quote).creationActorUserId,
    userId,
  );
});

test("rejeita metadata ausente", () => {
  reject(null);
});

test("rejeita orcamento antigo com apenas created_via", () => {
  reject({ created_via: "api_sales_quotes_create" });
});

test("rejeita ausencia da identidade do criador", () => {
  const metadata = humanMetadata();
  delete metadata.creation_actor_user_id;
  reject(metadata);
});

test("rejeita identidade de usuario invalida", () => {
  reject({
    ...humanMetadata(),
    creation_actor_user_id: "usuario-falso",
  });
});

test("rejeita ator de sistema", () => {
  reject({
    ...humanMetadata(),
    creation_actor_kind: "system",
  });
});

test("rejeita origem de criacao diferente", () => {
  reject({
    ...humanMetadata(),
    created_via: "ai_quote_writer",
  });
});

test("rejeita campo de identidade com tipo incorreto", () => {
  reject({
    ...humanMetadata(),
    creation_actor_user_id: 123,
  });
});
