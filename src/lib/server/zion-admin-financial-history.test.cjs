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