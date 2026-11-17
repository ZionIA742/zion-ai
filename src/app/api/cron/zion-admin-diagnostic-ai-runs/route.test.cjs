"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");

Module._extensions[".ts"] = function (mod, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  mod._compile(compiled.outputText, filename);
};

const {
  createDiagnosticAiRunCronGetHandler,
} = require("./route.ts");

const SECRET = "Z".repeat(40);
const URL = "https://example.invalid/api/cron/zion-admin-diagnostic-ai-runs";

const inactive = {
  status: "inactive",
  batchLimit: 20,
  discovered: 0,
  selected: 0,
  registered: 0,
  retryScheduled: 0,
  needsReview: 0,
  noLongerEligible: 0,
};

const processed = {
  ...inactive,
  status: "processed",
  discovered: 2,
  selected: 2,
  registered: 2,
};

function makeRequest({
  method = "GET",
  token = SECRET,
  url = URL,
} = {}) {
  return new Request(url, {
    method,
    headers: token
      ? { authorization: `Bearer ${token}` }
      : {},
  });
}

function handler(overrides = {}) {
  return createDiagnosticAiRunCronGetHandler({
    getSecret: () => SECRET,
    isAutoEnabled: () => true,
    runCapture: async () => inactive,
    ...overrides,
  });
}

test("rejeita metodo POST", async () => {
  const response = await handler()(makeRequest({ method: "POST" }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
});

test("rejeita requisicao sem autenticacao", async () => {
  const response = await handler()(makeRequest({ token: null }));
  assert.equal(response.status, 401);
});

test("rejeita Bearer incorreto", async () => {
  const response = await handler()(makeRequest({ token: "invalid" }));
  assert.equal(response.status, 401);
});

test("rejeita query params", async () => {
  const response = await handler()(
    makeRequest({ url: `${URL}?limit=25` }),
  );
  assert.equal(response.status, 401);
});

test("rejeita segredo insuficiente", async () => {
  const response = await handler({
    getSecret: () => "short",
  })(makeRequest());

  assert.equal(response.status, 401);
});

test("flag desligada retorna disabled sem RPC", async () => {
  let calls = 0;
  const response = await handler({
    isAutoEnabled: () => false,
    runCapture: async () => {
      calls++;
      return processed;
    },
  })(makeRequest());

  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "disabled");
  assert.equal(calls, 0);
});

test("captura inativa responde sem erro", async () => {
  const response = await handler({
    runCapture: async (options) => {
      assert.equal(options.batchLimit, 20);
      return inactive;
    },
  })(makeRequest());

  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "inactive");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("captura ativa retorna contagens", async () => {
  const response = await handler({
    runCapture: async () => processed,
  })(makeRequest());

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "processed");
  assert.equal(body.registered, 2);
});

test("falha da RPC retorna 503 sem vazar detalhes", async () => {
  const response = await handler({
    runCapture: async () => {
      throw new Error("PRIVATE_DATABASE_ERROR_CONTENT");
    },
  })(makeRequest());

  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error, "DIAGNOSTIC_CRON_UNAVAILABLE");
  assert.equal(
    JSON.stringify(body).includes("PRIVATE_DATABASE_ERROR_CONTENT"),
    false,
  );
});

test("falha ao consultar a flag bloqueia execucao", async () => {
  let calls = 0;
  const response = await handler({
    isAutoEnabled: () => {
      throw new Error("PRIVATE_ENV_ERROR");
    },
    runCapture: async () => {
      calls++;
      return processed;
    },
  })(makeRequest());

  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});