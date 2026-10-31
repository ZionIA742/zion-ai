import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const readerSource = readFileSync(
  new URL("./zion-admin-monthly-preclosure-source-reader.ts", import.meta.url),
  "utf8",
);

const costSource = readFileSync(
  new URL("./zion-admin-costs.ts", import.meta.url),
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
        throw new Error(`Unexpected dependency: ${id}`);
      }

      return dependencies[id];
    },
  });

  return exports;
}

const costs = compile(costSource);

const dates = Array.from(
  { length: 31 },
  (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`,
);

function makeOfficial(complete = false) {
  return {
    source: "openai_organization_costs",
    period: {
      from: "2026-10-01",
      to: "2026-10-31",
      timezone: "UTC",
    },
    availability: complete ? "complete" : "partial",
    totalUsd: complete ? "0" : null,
    daily: dates.map((date, index) => ({
      date,
      status:
        complete || index < 4
          ? "confirmed_empty"
          : "not_collected",
      totalUsd: complete || index < 4 ? "0" : null,
    })),
  };
}

function setup({
  fixedVersions = [],
  fixedItems = [],
  manual = [],
  official = makeOfficial(),
  failures = [],
} = {}) {
  const tables = {
    zion_admin_fixed_cost_versions: fixedVersions,
    zion_admin_fixed_cost_items: fixedItems,
    zion_admin_variable_expenses: manual,
  };

  const calls = [];

  const db = {
    from(table) {
      calls.push(table);

      if (!(table in tables)) {
        throw new Error(`UNEXPECTED_TABLE:${table}`);
      }

      const filters = [];

      const query = {
        select() {
          return query;
        },
        eq(field, value) {
          filters.push([field, value]);
          return query;
        },
        order() {
          return query;
        },
        async range(start, end) {
          if (failures.includes(table)) {
            return {
              data: null,
              error: { message: "QUERY_FAILED" },
            };
          }

          const rows = tables[table].filter((row) =>
            filters.every(([field, value]) => row[field] === value),
          );

          return {
            data: rows.slice(start, end + 1),
            error: null,
          };
        },
      };

      return query;
    },
  };

  const dependencies = {
    "@/lib/server/zion-account-provisioning": {
      createServiceSupabaseClient: () => db,
    },
    "@/lib/server/zion-admin-costs": costs,
    "@/lib/server/zion-admin-openai-official-cost-report": {
      async buildOfficialOpenAiCostReport(_, from, to) {
        calls.push(`official:${from}:${to}`);

        if (failures.includes("openai")) {
          throw new Error("SOURCE_UNAVAILABLE");
        }

        return official;
      },
    },
  };

  return {
    read: compile(readerSource, dependencies)
      .readMonthlyPreclosureSources,
    calls,
  };
}

function fixed(amount = 1200) {
  return [{
    item_id: "f1",
    effective_month: "2026-10-01",
    name: "Hospedagem",
    amount_cents: amount,
    frequency: "monthly",
    enabled: true,
  }];
}

test("fontes vazias consultadas sao zero conhecido; OpenAI parcial fica pendente", async () => {
  const { read, calls } = setup();
  const result = await read("2026-10-01");

  assert.equal(result.fixed.availability, "available");
  assert.equal(result.fixed.amountBrlCents, 0);
  assert.equal(result.manual.amountBrlCents, 0);
  assert.equal(result.manual.amountUsdCents, 0);
  assert.equal(result.openAi.availability, "partial");
  assert.equal(result.openAi.confirmedDays, 4);
  assert.equal(result.openAi.totalUsd, null);
  assert.ok(
    calls.includes("official:2026-10-01:2026-10-31"),
  );
});

test("fixo ainda nao iniciado nao e contabilizado", async () => {
  const { read } = setup({
    fixedVersions: fixed(),
    fixedItems: [{
      id: "f1",
      starts_on: "2026-11-23",
    }],
  });

  assert.equal(
    (await read("2026-10-01")).fixed.amountBrlCents,
    0,
  );
});

test("fixo iniciado usa a regra mensal existente", async () => {
  const { read } = setup({
    fixedVersions: fixed(),
    fixedItems: [{
      id: "f1",
      starts_on: "2026-10-14",
    }],
  });

  assert.equal(
    (await read("2026-10-01")).fixed.amountBrlCents,
    1200,
  );
});

test("manual considera somente ativos e separa moedas", async () => {
  const { read } = setup({
    manual: [
      {
        id: "a",
        competence_month: "2026-10-01",
        status: "active",
        currency: "BRL",
        amount_minor: "2500",
      },
      {
        id: "b",
        competence_month: "2026-10-01",
        status: "active",
        currency: "USD",
        amount_minor: 125,
      },
      {
        id: "c",
        competence_month: "2026-10-01",
        status: "cancelled",
        currency: "BRL",
        amount_minor: 5000,
      },
      {
        id: "d",
        competence_month: "2026-09-01",
        status: "active",
        currency: "BRL",
        amount_minor: 9000,
      },
    ],
  });

  const result = await read("2026-10-01");

  assert.equal(result.manual.amountBrlCents, 2500);
  assert.equal(result.manual.amountUsdCents, 125);
});

test("falha manual nao vira zero", async () => {
  const { read } = setup({
    failures: ["zion_admin_variable_expenses"],
  });

  const result = await read("2026-10-01");

  assert.equal(result.manual.availability, "unavailable");
  assert.equal(result.manual.amountBrlCents, null);
  assert.equal(result.manual.amountUsdCents, null);
});

test("OpenAI completa com zero oficial preserva zero", async () => {
  const { read } = setup({
    official: makeOfficial(true),
  });

  const result = await read("2026-10-01");

  assert.equal(result.openAi.availability, "complete");
  assert.equal(result.openAi.confirmedDays, 31);
  assert.equal(result.openAi.totalUsd, "0");
});

test("falha OpenAI preserva as demais fontes", async () => {
  const { read } = setup({
    failures: ["openai"],
  });

  const result = await read("2026-10-01");

  assert.equal(result.openAi.availability, "unavailable");
  assert.equal(result.openAi.totalUsd, null);
  assert.equal(result.fixed.amountBrlCents, 0);
});

test("mes invalido nao consulta o banco", async () => {
  const { read, calls } = setup();

  await assert.rejects(
    () => read("2026-13-01"),
    /INVALID_PRECLOSURE_MONTH/,
  );

  assert.equal(calls.length, 0);
});

test("leitor nao coleta nem grava", () => {
  assert.doesNotMatch(readerSource, /fetch\s*\(/);
  assert.doesNotMatch(readerSource, /\.rpc\s*\(/);
  assert.doesNotMatch(readerSource, /\.insert\s*\(/);
  assert.doesNotMatch(readerSource, /\.upsert\s*\(/);
  assert.doesNotMatch(readerSource, /\/api\/cron\//);
});