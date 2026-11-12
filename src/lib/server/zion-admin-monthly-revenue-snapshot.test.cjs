const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(
  "src/lib/server/zion-admin-monthly-preclosure-execution.ts",
  "utf8"
);

const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const mod = { exports: {} };

vm.runInNewContext(js, {
  exports: mod.exports,
  module: mod,
  require: () => ({}),
  Date,
  Intl,
  console,
});

const apply = mod.exports.withManualRevenueOnPreclosure;

function input() {
  return {
    month: "2026-11-01",
    sourceSnapshot: {
      month: "2026-11-01",
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
      meta: {
        status: "financial_authority_unknown",
        billedBrlCents: null,
      },
    },
    pendingSources: ["meta_financial_authority"],
    reason: "automatic_month_end_preclosure",
  };
}

test("zero confirmado produz resultado parcial negativo", () => {
  const output = apply(input(), {
    amountBrlCents: 0,
    revision: 1,
    updatedAt: "2026-11-09T12:00:00Z",
  });

  assert.equal(output.sourceSnapshot.manualRevenue.status, "confirmed");
  assert.equal(output.sourceSnapshot.manualRevenue.amountBrlCents, 0);
  assert.equal(output.sourceSnapshot.financialResult.knownExpensesBrlCents, 30210);
  assert.equal(output.sourceSnapshot.financialResult.resultBrlCents, -30210);
  assert.equal(output.sourceSnapshot.financialResult.definitive, false);
});

test("receita ausente permanece desconhecida", () => {
  const output = apply(input(), null);
  assert.equal(output.sourceSnapshot.manualRevenue.status, "not_reported");
  assert.equal(output.sourceSnapshot.manualRevenue.amountBrlCents, null);
  assert.equal(output.sourceSnapshot.financialResult.resultBrlCents, null);
  assert.ok(output.pendingSources.includes("manual_revenue"));
});

test("receita positiva preserva pendencia da Meta", () => {
  const output = apply(input(), {
    amountBrlCents: 50000,
    revision: 2,
    updatedAt: null,
  });
  assert.equal(output.sourceSnapshot.financialResult.resultBrlCents, 19790);
  assert.ok(output.pendingSources.includes("meta_financial_authority"));
  assert.equal(output.sourceSnapshot.financialResult.status, "partial");
});

test("evidencia PTAX existente permanece intacta", () => {
  const original = input();
  const output = apply(original, {
    amountBrlCents: 0,
    revision: 1,
    updatedAt: null,
  });

  assert.equal(
    output.sourceSnapshot.openai.ptaxEvidence.collectionKey,
    "ptax-1"
  );
  assert.equal(original.sourceSnapshot.manualRevenue, undefined);
});

test("nao cria resultado sem custos conhecidos", () => {
  const value = input();
  value.sourceSnapshot.fixed = { status: "not_verified" };
  value.sourceSnapshot.manual = { status: "not_verified" };
  value.sourceSnapshot.openai = { knownBrlCents: null };

  const output = apply(value, {
    amountBrlCents: 0,
    revision: 1,
    updatedAt: null,
  });

  assert.equal(output.sourceSnapshot.financialResult.resultBrlCents, null);
});

test("rejeita evidencias invalidas", () => {
  assert.throws(() => apply(input(), {
    amountBrlCents: -1,
    revision: 1,
    updatedAt: null,
  }));
  assert.throws(() => apply(input(), {
    amountBrlCents: 0,
    revision: 0,
    updatedAt: null,
  }));
});

test("executor usa auditoria antes do writer protegido", () => {
  assert.match(source, /zion_admin_monthly_manual_revenue_audit/);
  assert.match(source, /MANUAL_REVENUE_AUDIT_MISMATCH/);
  assert.match(source, /registerInDatabase\(enriched\)/);
  assert.match(
    source,
    /overrides\.register\s*\?\?\s*registerWithManualRevenue/
  );
});