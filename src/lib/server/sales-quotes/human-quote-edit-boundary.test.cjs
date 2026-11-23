"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

Module._extensions[".ts"] = function (mod, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  mod._compile(compiled.outputText, filename);
};

const {
  prepareHumanQuoteEditBoundary,
  HumanQuoteEditBoundaryError,
} = require("./human-quote-edit-boundary.ts");

const actor = "11111111-2222-4333-8444-555555555555";
const version = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const timestamp = "2026-11-23T20:00:00.000Z";

function quote(overrides = {}) {
  return {
    metadata: {
      created_via: "api_sales_quotes_create",
      creation_actor_kind: "user",
      creation_actor_user_id: actor,
      validity_days: 15,
    },
    status: "draft",
    updated_at: timestamp,
    current_version_id: null,
    ...overrides,
  };
}

function prepare(current = quote(), expected = {}) {
  return prepareHumanQuoteEditBoundary({
    quote: current,
    expectedUpdatedAt: timestamp,
    expectedCurrentVersionId: null,
    ...expected,
  });
}

function reject(code, status, current, expected) {
  assert.throws(
    () => prepare(current, expected),
    (error) =>
      error instanceof HumanQuoteEditBoundaryError &&
      error.code === code &&
      error.status === status,
  );
}

test("permite edicao de rascunho humano", () => {
  const result = prepare();
  assert.equal(result.preservedStatus, "draft");
  assert.equal(result.priorPdfVersionId, null);
});

test("permite editar humano ja enviado sem alterar status", () => {
  const result = prepare(
    quote({ status: "sent", current_version_id: version }),
    { expectedCurrentVersionId: version },
  );
  assert.equal(result.preservedStatus, "sent");
  assert.equal(result.priorPdfVersionId, version);
});

test("permite humano com versao anterior", () => {
  const result = prepare(
    quote({ current_version_id: version }),
    { expectedCurrentVersionId: version },
  );
  assert.equal(result.expectedCurrentVersionId, version);
});

test("bloqueia timestamp desatualizado", () => {
  reject(
    "HUMAN_QUOTE_EDIT_STALE",
    409,
    quote(),
    { expectedUpdatedAt: "2026-11-22T20:00:00.000Z" },
  );
});

test("bloqueia troca de versao durante edicao", () => {
  reject(
    "HUMAN_QUOTE_EDIT_STALE",
    409,
    quote({ current_version_id: version }),
    {},
  );
});

test("exige precondicoes completas", () => {
  reject(
    "HUMAN_QUOTE_EDIT_PRECONDITION_REQUIRED",
    428,
    quote(),
    { expectedUpdatedAt: null },
  );
});

test("rejeita identificador de versao invalido", () => {
  reject(
    "HUMAN_QUOTE_EDIT_PRECONDITION_REQUIRED",
    428,
    quote(),
    { expectedCurrentVersionId: "invalido" },
  );
});

test("bloqueia orcamento sem procedencia comprovada", () => {
  assert.throws(
    () => prepare(
      quote({ metadata: { created_via: "api_sales_quotes_create" } }),
    ),
    (error) =>
      error.code === "HUMAN_QUOTE_EDIT_PROVENANCE_REQUIRED",
  );
});

test("preserva todos os metadados originais", () => {
  const result = prepare();
  assert.equal(result.preservedMetadata.creation_actor_user_id, actor);
  assert.equal(result.preservedMetadata.validity_days, 15);
});

test("nao altera o objeto original", () => {
  const original = quote();
  const before = JSON.stringify(original);
  const result = prepare(original);
  result.preservedMetadata.validity_days = 99;
  assert.equal(JSON.stringify(original), before);
});

test("recusa estado comercial incompleto", () => {
  reject(
    "HUMAN_QUOTE_STATE_INCOMPLETE",
    409,
    quote({ status: null }),
    {},
  );
});
