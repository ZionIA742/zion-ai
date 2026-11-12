const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const helper = fs.readFileSync(
  "src/lib/server/zion-admin-financial-history.ts",
  "utf8",
);

const route = fs.readFileSync(
  "src/app/api/zion-admin/financial-history/route.ts",
  "utf8",
);

const js = ts.transpileModule(helper, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const mod = { exports: {} };

vm.runInNewContext(js, {
  module: mod,
  exports: mod.exports,
});

const build = mod.exports.buildMonthlyFinancialHistory;
const month = "2026-11-01";

function fixture() {
  return {
    months: [month],
    preclosures: [{
      month,
      revision: 2,
      pending_sources: ["meta_financial_authority"],
      source_snapshot: {
        schema_version: 1,
        financial_status: "preliminary",
        sources: {
          month,
          fixed: {
            status: "registered",
            registeredBrlCents: 30000,
          },
          manual: {
            status: "registered",
            registeredBrlCents: 200,
          },
          openai: {
            knownBrlCents: 10,
            ptaxEvidence: { collectionKey: "ptax-1" },
          },
          manualRevenue: {
            status: "confirmed",
            amountBrlCents: 0,
            revision: 1,
          },
          meta: { status: "financial_authority_unknown" },
        },
      },
    }],
    preclosureAudits: [{ month, revision: 2 }],
    revenues: [{
      month,
      amount_brl_cents: 0,
      revision: 1,
      updated_at: "2026-11-09T12:00:00Z",
    }],
    revenueAudits: [{
      month,
      revision: 1,
      amount_brl_cents: 0,
    }],
  };
}

test("zero confirmado resulta em saldo parcial negativo", () => {
  const result = build(fixture())[0];
  assert.equal(result.revenue.status, "confirmed");
  assert.equal(result.revenue.amountBrlCents, 0);
  assert.equal(result.costs.knownSubtotalBrlCents, 30210);
  assert.equal(result.result.netBrlCents, -30210);
  assert.equal(result.result.definitive, false);
});

test("receita ausente nunca se transforma em zero", () => {
  const data = fixture();
  data.revenues = [];
  data.revenueAudits = [];
  const result = build(data)[0];
  assert.equal(result.revenue.status, "not_reported");
  assert.equal(result.revenue.amountBrlCents, null);
  assert.equal(result.result.netBrlCents, null);
});

test("mes sem pre-fechamento nao inventa despesas", () => {
  const data = fixture();
  data.preclosures = [];
  data.preclosureAudits = [];
  const result = build(data)[0];
  assert.equal(result.preclosure.status, "not_generated");
  assert.equal(result.costs.knownSubtotalBrlCents, null);
  assert.equal(result.result.netBrlCents, null);
});

test("snapshot antigo e diferente da receita atual", () => {
  const data = fixture();
  delete data.preclosures[0].source_snapshot.sources.manualRevenue;
  data.revenues[0].amount_brl_cents = 10000;
  data.revenueAudits[0].amount_brl_cents = 10000;
  const result = build(data)[0];
  assert.equal(result.snapshotRevenue.status, "legacy_not_recorded");
  assert.equal(result.revenue.amountBrlCents, 10000);
  assert.equal(result.result.netBrlCents, -20210);
});

test("revisao divergente do pre-fechamento bloqueia leitura", () => {
  const data = fixture();
  data.preclosureAudits = [{ month, revision: 1 }];
  assert.throws(() => build(data), /AUDIT_MISMATCH/);
});

test("auditoria divergente da receita bloqueia leitura", () => {
  const data = fixture();
  data.revenueAudits[0].amount_brl_cents = 100;
  assert.throws(() => build(data), /AUDIT_MISMATCH/);
});

test("custo invalido nao vira zero", () => {
  const data = fixture();
  data.preclosures[0].source_snapshot.sources.fixed.registeredBrlCents = -1;
  assert.throws(() => build(data), /INVALID_AMOUNT/);
});

test("mantem pendencia Meta e nunca confirma fechamento", () => {
  const result = build(fixture())[0];
  assert.ok(result.preclosure.pendingSources.includes(
    "meta_financial_authority",
  ));
  assert.equal(result.costs.complete, false);
  assert.equal(result.result.definitive, false);
});

test("API exige permissao administrativa e usa apenas leituras", () => {
  assert.match(route, /resolveZionAdminApiAccess/);
  assert.match(route, /manage_accounts/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});

test("API preserva indisponibilidade e usa 12 competencias", () => {
  assert.match(route, /length: 12/);
  assert.match(route, /America\/Sao_Paulo/);
  assert.match(route, /FINANCIAL_HISTORY_READ_FAILED/);
  assert.match(route, /}, 503\)/);
});

const accumulate = mod.exports.buildAccumulatedFinancialHistory;

function monthForAccumulation(
  value,
  revenueValue,
  fixedValue = 30000,
  hasPreclosure = true,
) {
  const data = fixture();

  data.months = [value];
  data.preclosures[0].month = value;
  data.preclosures[0].source_snapshot.sources.month = value;
  data.preclosures[0].source_snapshot.sources.fixed.registeredBrlCents =
    fixedValue;

  data.preclosureAudits[0].month = value;
  data.revenues[0].month = value;
  data.revenues[0].amount_brl_cents = revenueValue ?? 0;
  data.revenueAudits[0].month = value;
  data.revenueAudits[0].amount_brl_cents = revenueValue ?? 0;

  if (revenueValue === null) {
    data.revenues = [];
    data.revenueAudits = [];
  }

  if (!hasPreclosure) {
    data.preclosures = [];
    data.preclosureAudits = [];
  }

  return build(data)[0];
}

test("acumulado soma meses e aceita receita zero confirmada", () => {
  const nov = monthForAccumulation("2026-11-01", 0, 30000);
  const oct = monthForAccumulation("2026-10-01", 25000, 10000);

  const summary = accumulate([nov, oct]);

  assert.equal(summary.status, "partial");
  assert.equal(summary.definitive, false);
  assert.equal(summary.revenueBrlCents, 25000);
  assert.equal(summary.knownCostsBrlCents, 40420);
  assert.equal(summary.netBrlCents, -15420);
  assert.equal(summary.evaluatedMonths, 2);

  assert.deepEqual(
    Array.from(summary.includedMonths),
    ["2026-11-01", "2026-10-01"],
  );
});

test("acumulado identifica meses sem dados suficientes", () => {
  const nov = monthForAccumulation("2026-11-01", 0);
  const oct = monthForAccumulation("2026-10-01", null);
  const sep = monthForAccumulation(
    "2026-09-01", 20000, 30000, false,
  );

  const summary = accumulate([nov, oct, sep]);

  assert.deepEqual(
    Array.from(summary.includedMonths),
    ["2026-11-01"],
  );

  assert.deepEqual(
    Array.from(summary.excludedMonths),
    ["2026-10-01", "2026-09-01"],
  );

  assert.equal(summary.revenueBrlCents, 0);
  assert.equal(summary.knownCostsBrlCents, 30210);
  assert.equal(summary.netBrlCents, -30210);
  assert.equal(summary.definitive, false);
});

test("sem meses comparaveis nao presume saldo zero", () => {
  const oct = monthForAccumulation("2026-10-01", null);
  const summary = accumulate([oct]);

  assert.equal(summary.status, "unavailable");
  assert.equal(summary.revenueBrlCents, null);
  assert.equal(summary.knownCostsBrlCents, null);
  assert.equal(summary.netBrlCents, null);
});

test("acumulado bloqueia overflow e meses duplicados", () => {
  const oct = monthForAccumulation(
    "2026-10-01", 0, 5000000000000000,
  );
  const nov = monthForAccumulation(
    "2026-11-01", 0, 5000000000000000,
  );

  assert.throws(
    () => accumulate([oct, nov]),
    /ACCUMULATED_OVERFLOW/,
  );

  assert.throws(
    () => accumulate([oct, oct]),
    /ACCUMULATED_INVALID_MONTHS/,
  );
});

test("acumulado rejeita classificacao definitiva inesperada", () => {
  const nov = monthForAccumulation("2026-11-01", 0);
  nov.result.definitive = true;

  assert.throws(
    () => accumulate([nov]),
    /ACCUMULATED_UNEXPECTED_FINALIZED/,
  );
});
