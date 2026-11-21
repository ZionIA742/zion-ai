"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");

Module._extensions[".ts"] = function (mod, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  mod._compile(result.outputText, filename);
};

const {
  resolveAccountAccessMiddlewarePolicy: resolve
} = require("./account-access-middleware-policy.ts");

const path = "/api/cron/zion-admin-diagnostic-ai-runs";
const next = { action: "next", destination: null };
const blocked = {
  action: "redirect",
  destination: "/login",
  preserveRedirectTo: true
};

test("cron diagnostico: anonimo chega a rota", () => {
  assert.deepEqual(resolve(path, "anonymous"), next);
});

test("cron diagnostico: auth indisponivel nao redireciona", () => {
  assert.deepEqual(resolve(path, "unavailable"), next);
});

test("cron diagnostico: autenticado continua permitido", () => {
  assert.deepEqual(resolve(path, "authenticated"), next);
});

test("cron diagnostico: barra final normalizada", () => {
  assert.deepEqual(resolve(path + "/", "anonymous"), next);
});

test("cron diagnostico: subcaminho nao fica publico", () => {
  assert.deepEqual(resolve(path + "/extra", "anonymous"), blocked);
});

test("cron diagnostico: caminho semelhante nao fica publico", () => {
  assert.deepEqual(resolve(path + "-other", "anonymous"), blocked);
});

test("crons financeiros existentes permanecem acessiveis", () => {
  assert.deepEqual(
    resolve("/api/cron/zion-admin-openai-costs", "anonymous"), next
  );
  assert.deepEqual(
    resolve("/api/cron/zion-admin-monthly-preclosure", "anonymous"), next
  );
});

test("APIs internas continuam protegidas", () => {
  assert.deepEqual(
    resolve("/api/internal/ai-sales-reply", "anonymous"), blocked
  );
});
