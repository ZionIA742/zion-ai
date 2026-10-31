import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const source = readFileSync(
  new URL("./route.ts", import.meta.url),
  "utf8",
);

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function setup({
  authorized = true,
  enabled = false,
  outcome = { status: "created", month: "2026-10-01", revision: 1 },
  authThrows = false,
  executionThrows = false,
  flagThrows = false,
  env = {},
} = {}) {
  const calls = [];
  const exports = {};

  const response = {
    json(body, options) {
      return {
        body,
        status: options.status,
        headers: options.headers,
      };
    },
  };

  vm.runInNewContext(compiled, {
    exports,
    process: { env },
    require(id) {
      if (id === "next/server") {
        return { NextResponse: response };
      }

      if (
        id ===
        "@/lib/server/zion-admin-openai-cost-cron-auth"
      ) {
        return {
          authorizeOpenAiCostCron(request) {
            calls.push({ type: "auth", request });

            if (authThrows) throw new Error("AUTH_FAILURE");

            return authorized
              ? { ok: true, status: "authorized" }
              : { ok: false, status: "blocked" };
          },
        };
      }

      if (
        id ===
        "@/lib/server/zion-admin-monthly-preclosure-execution"
      ) {
        return {
          async runMonthlyPreclosureBySystem() {
            calls.push({ type: "run" });

            if (executionThrows) {
              throw new Error("EXECUTION_FAILURE");
            }

            return outcome;
          },
        };
      }

      throw new Error(`UNEXPECTED_IMPORT:${id}`);
    },
  });

  const GET = exports.createMonthlyPreclosureCronGetHandler({
    isAutoExecutionEnabled: () => {
      calls.push({ type: "flag" });

      if (flagThrows) {
        throw new Error("FLAG_FAILURE");
      }

      return enabled;
    },
  });

  return {
    GET,
    calls,
    request: { method: "GET" },
  };
}

test("nega acesso antes de ler a flag", async () => {
  const { GET, calls, request } = setup({
    authorized: false,
    enabled: true,
  });

  const response = await GET(request);

  assert.equal(response.status, 401);
  assert.equal(response.body.error, "UNAUTHORIZED_CRON_ROUTE");
  assert.deepEqual(
    calls.map((call) => call.type),
    ["auth"],
  );
});

test("falha de autenticacao tambem nega acesso", async () => {
  const { GET, calls, request } = setup({
    authThrows: true,
    enabled: true,
  });

  const response = await GET(request);

  assert.equal(response.status, 401);
  assert.equal(calls.length, 1);
});

test("flag OFF impede leitura e gravacao", async () => {
  const { GET, calls, request } = setup();

  const response = await GET(request);

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "disabled");
  assert.deepEqual(
    calls.map((call) => call.type),
    ["auth", "flag"],
  );
});

test("flag ativada aceita pre-fechamento criado", async () => {
  const { GET, calls, request } = setup({
    enabled: true,
  });

  const response = await GET(request);

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.status, "created");
  assert.deepEqual(
    calls.map((call) => call.type),
    ["auth", "flag", "run"],
  );
});

test("revisao confirmada tem resposta segura", async () => {
  const { GET, request } = setup({
    enabled: true,
    outcome: { status: "revised", month: "2026-10-01", revision: 2 },
  });

  const response = await GET(request);

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "revised");
  assert.equal("revision" in response.body, false);
});

test("idempotencia devolve unchanged", async () => {
  const { GET, request } = setup({
    enabled: true,
    outcome: { status: "unchanged", month: "2026-10-01", revision: 1 },
  });

  const response = await GET(request);

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "unchanged");
});

test("fora do horario nao confirma fechamento", async () => {
  const { GET, request } = setup({
    enabled: true,
    outcome: {
      status: "skipped",
      month: "2026-10-01",
      reason: "not_due",
    },
  });

  const response = await GET(request);

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "skipped");
});

test("erro financeiro recebe needs_review", async () => {
  const { GET, request } = setup({
    enabled: true,
    outcome: {
      status: "needs_review",
      month: "2026-10-01",
      reason: "source_failure",
    },
  });

  const response = await GET(request);

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.status, "needs_review");
  assert.equal("reason" in response.body, false);
});

test("excecao do executor nao confirma sucesso", async () => {
  const { GET, request } = setup({
    enabled: true,
    executionThrows: true,
  });

  const response = await GET(request);

  assert.equal(response.status, 503);
  assert.equal(response.body.ok, false);
});

test("resposta inesperada falha fechada", async () => {
  const { GET, request } = setup({
    enabled: true,
    outcome: { status: "finished" },
  });

  const response = await GET(request);

  assert.equal(response.status, 503);
});

test("falha da flag nao inicia executor", async () => {
  const { GET, request, calls } = setup({
    flagThrows: true,
  });

  const response = await GET(request);

  assert.equal(response.status, 503);
  assert.deepEqual(
    calls.map((call) => call.type),
    ["auth", "flag"],
  );
});

test("metodo diferente de GET e rejeitado", async () => {
  const { GET, calls } = setup({
    enabled: true,
  });

  const response = await GET({ method: "POST" });

  assert.equal(response.status, 405);
  assert.equal(response.headers.Allow, "GET");
  assert.equal(calls.length, 0);
});

test("respostas financeiras nao sao armazenadas em cache", async () => {
  const { GET, request } = setup({
    enabled: true,
  });

  const response = await GET(request);

  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(
    response.headers["X-Content-Type-Options"],
    "nosniff",
  );
});

test("rota nao busca credenciais nem grava diretamente", () => {
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /\.rpc\s*\(/);
  assert.doesNotMatch(source, /\.insert\s*\(/);
  assert.doesNotMatch(source, /zion_admin_close_cost_month/);
  assert.doesNotMatch(source, /cron\.schedule/);
  assert.match(source, /authorizeOpenAiCostCron/);
  assert.match(source, /runMonthlyPreclosureBySystem/);
});