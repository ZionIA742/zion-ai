"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");

// Transpilacao somente em memoria, apenas neste processo.
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
  DiagnosticAiRunCronError,
  runDiagnosticAiRunCaptureCron,
} = require("./zion-admin-diagnostic-ai-run-cron-runner.ts");

const discovery = (extra = {}) => ({
  source_system: "ai_runs",
  batch_limit: 20,
  discovered: 2,
  capture_active: true,
  ...extra,
});

const processor = (extra = {}) => ({
  source_system: "ai_runs",
  batch_limit: 20,
  selected: 2,
  registered: 1,
  retry_scheduled: 1,
  needs_review: 0,
  no_longer_eligible: 0,
  ...extra,
});

function expects(code) {
  return (error) =>
    error instanceof DiagnosticAiRunCronError &&
    error.code === code;
}

test("inativa: nao executa processador", async () => {
  const calls = [];

  const result = await runDiagnosticAiRunCaptureCron({
    rpc: async (name) => {
      calls.push(name);
      return {
        data: discovery({
          discovered: 0,
          capture_active: false,
        }),
        error: null,
      };
    },
  });

  assert.equal(result.status, "inactive");
  assert.equal(result.selected, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^discover_/);
});

test("ativa: descoberta antes de processamento", async () => {
  const calls = [];

  const result = await runDiagnosticAiRunCaptureCron({
    rpc: async (name, args) => {
      calls.push(name);
      assert.equal(args.p_batch_limit, 20);

      return {
        data: name.startsWith("discover_")
          ? discovery()
          : processor(),
        error: null,
      };
    },
  });

  assert.deepEqual(calls, [
    "discover_zion_admin_ai_run_capture_attempts_by_system",
    "process_zion_admin_ai_run_capture_attempts_by_system",
  ]);

  assert.equal(result.status, "processed");
  assert.equal(result.discovered, 2);
  assert.equal(result.selected, 2);
  assert.equal(result.registered, 1);
  assert.equal(result.retryScheduled, 1);
});

test("limites invalidos falham antes da RPC", async () => {
  let calls = 0;

  for (const batchLimit of [0, -1, 26, 1.5, NaN]) {
    await assert.rejects(
      runDiagnosticAiRunCaptureCron({
        batchLimit,
        rpc: async () => {
          calls++;
          return { data: null, error: null };
        },
      }),
      expects("INVALID_BATCH_LIMIT"),
    );
  }

  assert.equal(calls, 0);
});

test("limite 25 funciona nas duas RPCs", async () => {
  const limits = [];

  const result = await runDiagnosticAiRunCaptureCron({
    batchLimit: 25,
    rpc: async (name, args) => {
      limits.push(args.p_batch_limit);

      return {
        data: name.startsWith("discover_")
          ? discovery({
              batch_limit: 25,
              discovered: 0,
            })
          : processor({
              batch_limit: 25,
              selected: 0,
              registered: 0,
              retry_scheduled: 0,
            }),
        error: null,
      };
    },
  });

  assert.deepEqual(limits, [25, 25]);
  assert.equal(result.status, "processed");
});

test("erro da descoberta bloqueia processador", async () => {
  let calls = 0;

  await assert.rejects(
    runDiagnosticAiRunCaptureCron({
      rpc: async () => {
        calls++;
        return { data: null, error: { code: "TEST" } };
      },
    }),
    expects("DISCOVERY_RPC_FAILED"),
  );

  assert.equal(calls, 1);
});

test("resposta invalida da descoberta falha fechada", async () => {
  let calls = 0;

  await assert.rejects(
    runDiagnosticAiRunCaptureCron({
      rpc: async () => {
        calls++;
        return {
          data: discovery({
            capture_active: false,
            discovered: 1,
          }),
          error: null,
        };
      },
    }),
    expects("DISCOVERY_RESULT_INVALID"),
  );

  assert.equal(calls, 1);
});

test("erro do processador nao vira sucesso", async () => {
  await assert.rejects(
    runDiagnosticAiRunCaptureCron({
      rpc: async (name) => ({
        data: name.startsWith("discover_")
          ? discovery()
          : null,
        error: name.startsWith("process_")
          ? { code: "TEST" }
          : null,
      }),
    }),
    expects("PROCESSOR_RPC_FAILED"),
  );
});

test("totais inconsistentes sao rejeitados", async () => {
  await assert.rejects(
    runDiagnosticAiRunCaptureCron({
      rpc: async (name) => ({
        data: name.startsWith("discover_")
          ? discovery()
          : processor({ selected: 3 }),
        error: null,
      }),
    }),
    expects("PROCESSOR_RESULT_INVALID"),
  );
});

test("excecao nao vaza mensagem original", async () => {
  await assert.rejects(
    runDiagnosticAiRunCaptureCron({
      rpc: async () => {
        throw new Error("PRIVATE_ERROR_CONTENT");
      },
    }),
    (error) =>
      expects("DISCOVERY_RPC_FAILED")(error) &&
      !error.message.includes("PRIVATE_ERROR_CONTENT"),
  );
});