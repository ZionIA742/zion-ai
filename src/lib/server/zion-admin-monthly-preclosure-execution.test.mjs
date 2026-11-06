import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const executionSource = readFileSync(
  new URL("./zion-admin-monthly-preclosure-execution.ts", import.meta.url),
  "utf8",
);

const preparationSource = readFileSync(
  new URL("./zion-admin-monthly-preclosure-preparation.ts", import.meta.url),
  "utf8",
);

function compile(source, dependencies = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const exports = {};

  vm.runInNewContext(compiled, {
    exports,
    require: (id) => {
      if (!(id in dependencies)) {
        if (id === "@/lib/server/zion-admin-ptax-evidence-reconcile") {
            return {
              reconcilePersistedPtaxCollection: async () => {
                throw new Error("UNEXPECTED_PTAX_RECONCILIATION_IN_LEGACY_TEST");
              },
            };
          }
          if (id === "@/lib/server/zion-admin-ptax-evidence-persist") {
            return {
              collectAndPersistValidatedPtax: async () => {
                throw new Error("UNEXPECTED_PTAX_COLLECTION_IN_LEGACY_TEST");
              },
            };
          }
          throw new Error(`Unexpected dependency: ${id}`);
      }

      return dependencies[id];
    },
  });

  return exports;
}

const preparation = compile(preparationSource);

function sources({
  fixed = 0,
  manualBrl = 0,
  manualUsd = 0,
  complete = false,
} = {}) {
  return {
    fixed: {
      availability: "available",
      amountBrlCents: fixed,
    },
    manual: {
      availability: "available",
      amountBrlCents: manualBrl,
      amountUsdCents: manualUsd,
    },
    openAi: {
      availability: complete ? "complete" : "partial",
      confirmedDays: complete ? 31 : 4,
      totalUsd: complete ? "0" : null,
    },
  };
}

function setup({
  at = "2026-10-31T23:15:00.000Z",
  financialSources = sources(),
  readFails = false,
  writeFails = false,
  writer = null,
} = {}) {
  const calls = [];

  const db = {
    async rpc(name, args) {
      calls.push({ type: "rpc", name, args });

      if (writeFails) {
        return { data: null, error: { message: "RPC_FAILED" } };
      }

      return {
        data: writer ?? {
          ok: true,
          status: "created",
          month: "2026-10-01",
          revision: 1,
        },
        error: null,
      };
    },
  };

  const dependencies = {
    "@/lib/server/zion-account-provisioning": {
      createServiceSupabaseClient: () => db,
    },
    "@/lib/server/zion-admin-monthly-preclosure-source-reader": {
      async readMonthlyPreclosureSources(month) {
        calls.push({ type: "read", month });

        if (readFails) {
          throw new Error("SOURCE_UNAVAILABLE");
        }

        return financialSources;
      },
    },
    "@/lib/server/zion-admin-monthly-preclosure-preparation":
      preparation,
  };

  const execution = compile(executionSource, dependencies);

  const run = execution.createMonthlyPreclosureExecutionRunner({
    now: () => new Date(at),
  });

  return { run, calls };
}

test("nao executa antes do ultimo dia do mes", async () => {
  const { run, calls } = setup({
    at: "2026-10-30T23:15:00.000Z",
  });

  const result = await run();

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "not_due");
  assert.equal(calls.length, 0);
});

test("nao executa antes das 20h em Sao Paulo", async () => {
  const { run, calls } = setup({
    at: "2026-10-31T22:59:00.000Z",
  });

  assert.equal((await run()).status, "skipped");
  assert.equal(calls.length, 0);
});

test("liga leitor, preparador e writer no horario correto", async () => {
  const { run, calls } = setup({
    financialSources: sources({
      fixed: 1200,
      manualBrl: 300,
      manualUsd: 125,
    }),
  });

  const result = await run();

  assert.equal(result.status, "created");
  assert.equal(result.month, "2026-10-01");
  assert.equal(result.revision, 1);

  assert.equal(calls[0].type, "read");
  assert.equal(calls[0].month, "2026-10-01");

  assert.equal(calls[1].type, "rpc");
  assert.equal(
    calls[1].name,
    "zion_admin_register_monthly_preclosure_by_system",
  );

  assert.equal(calls[1].args.p_month, "2026-10-01");
  assert.equal(
    calls[1].args.p_source_snapshot.fixed.registeredBrlCents,
    1200,
  );
  assert.equal(
    calls[1].args.p_source_snapshot.manual.registeredUsdCents,
    125,
  );

  assert.deepEqual(
    Array.from(calls[1].args.p_pending_sources),
    ["openai_official", "meta_financial_authority"],
  );

  assert.equal(
    calls[1].args.p_reason,
    "automatic_month_end_preclosure",
  );
});

test("zero oficial conhecido permanece zero e Meta pendente", async () => {
  const { run, calls } = setup({
    financialSources: sources({ complete: true }),
  });

  assert.equal((await run()).status, "created");

  const snapshot = calls[1].args.p_source_snapshot;

  assert.equal(snapshot.fixed.registeredBrlCents, 0);
  assert.equal(snapshot.manual.registeredBrlCents, 0);
  assert.equal(snapshot.openai.officialUsd, "0");
  assert.equal(snapshot.meta.billedBrlCents, null);
  assert.deepEqual(
    Array.from(calls[1].args.p_pending_sources),
    ["meta_financial_authority"],
  );
});

test("fontes desconhecidas permanecem nulas e pendentes", async () => {
  const unknown = {
    fixed: {
      availability: "unavailable",
      amountBrlCents: null,
    },
    manual: {
      availability: "unavailable",
      amountBrlCents: null,
      amountUsdCents: null,
    },
    openAi: {
      availability: "unavailable",
      confirmedDays: 0,
      totalUsd: null,
    },
  };

  const { run, calls } = setup({
    financialSources: unknown,
  });

  assert.equal((await run()).status, "created");

  const snapshot = calls[1].args.p_source_snapshot;

  assert.equal(snapshot.fixed.registeredBrlCents, null);
  assert.equal(snapshot.manual.registeredBrlCents, null);
  assert.equal(snapshot.openai.officialUsd, null);

  assert.deepEqual(
    Array.from(calls[1].args.p_pending_sources),
    [
      "fixed_costs",
      "manual_expenses",
      "openai_official",
      "meta_financial_authority",
    ],
  );
});

test("repeticao idempotente preserva o estado unchanged", async () => {
  const { run } = setup({
    writer: {
      ok: true,
      status: "unchanged",
      month: "2026-10-01",
      revision: 1,
    },
  });

  assert.equal((await run()).status, "unchanged");
});

test("revisao confirmada retorna revisao correta", async () => {
  const { run } = setup({
    writer: {
      ok: true,
      status: "revised",
      month: "2026-10-01",
      revision: 2,
    },
  });

  const result = await run();

  assert.equal(result.status, "revised");
  assert.equal(result.revision, 2);
});

test("falha de leitura nao executa o writer", async () => {
  const { run, calls } = setup({ readFails: true });

  const result = await run();

  assert.equal(result.status, "needs_review");
  assert.equal(result.reason, "source_failure");
  assert.equal(calls.length, 1);
});

test("falha do writer nao confirma pre-fechamento", async () => {
  const { run } = setup({ writeFails: true });

  const result = await run();

  assert.equal(result.status, "needs_review");
  assert.equal(result.reason, "writer_failure");
});

test("resposta divergente do writer nao e confirmada", async () => {
  const { run } = setup({
    writer: {
      ok: true,
      status: "created",
      month: "2026-09-01",
      revision: 1,
    },
  });

  const result = await run();

  assert.equal(result.status, "needs_review");
  assert.equal(result.reason, "invalid_writer_response");
});

test("integracao nao chama fornecedores nem fechamento definitivo", () => {
  assert.doesNotMatch(executionSource, /\bfetch\s*\(/);
  assert.doesNotMatch(
    executionSource,
    /zion_admin_close_cost_month/,
  );
  assert.doesNotMatch(executionSource, /\/api\/cron\//);
  assert.doesNotMatch(executionSource, /\.insert\s*\(/);
  assert.doesNotMatch(executionSource, /\.upsert\s*\(/);
});

test("data invalida bloqueia leitura e gravacao", async () => {
  const { run, calls } = setup({
    at: "data-invalida",
  });

  const result = await run();

  assert.equal(result.status, "needs_review");
  assert.equal(result.reason, "invalid_clock");
  assert.equal(result.month, null);
  assert.equal(calls.length, 0);
});
