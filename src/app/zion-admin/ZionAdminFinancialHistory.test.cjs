/* eslint-disable @typescript-eslint/no-require-imports -- Teste Node executado como CommonJS (.cjs) */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const component = fs.readFileSync(
  "src/app/zion-admin/ZionAdminFinancialHistory.tsx", "utf8"
);

const section = fs.readFileSync(
  "src/app/zion-admin/ZionAdminCostsSection.tsx", "utf8"
);

test("historico utiliza API protegida, sem mutacoes", () => {
  assert.match(component, /\/api\/zion-admin\/financial-history/);
  assert.match(component, /credentials: "include"/);
  assert.match(component, /cache: "no-store"/);
  assert.doesNotMatch(component, /method: "POST"|method: "DELETE"/);
});

test("12 meses sao validados antes de mostrar valores", () => {
  assert.match(component, /payload\.history\.length > 12/);
  assert.match(component, /validateHistory\(payload\)/);
  assert.match(component, /Number\.isSafeInteger/);
});

test("zero confirmado e diferente de receita nao informada", () => {
  assert.match(component, /revenue\.status === "confirmed"/);
  assert.match(component, /brl\(item\.revenue\.amountBrlCents\)/);
  assert.match(component, /"Não informada"/);
});

test("resultado e identificado exclusivamente como parcial", () => {
  assert.match(component, /Resultado parcial/);
  assert.match(component, /result\.definitive !== false/);
  assert.match(component, /"Não calculável"/);
  assert.match(component, /não representam lucro ou prejuízo definitivo/);
});

test("detalhes mostram custo, revisoes e pendencias", () => {
  assert.match(component, /<details/);
  assert.match(component, /fixedRegisteredBrlCents/);
  assert.match(component, /manualRegisteredBrlCents/);
  assert.match(component, /openAiKnownBrlCents/);
  assert.match(component, /pendingSources\.map/);
  assert.match(component, /revenue\.revision/);
});

test("mudanca de receita preserva proveniencia do snapshot", () => {
  assert.match(component, /snapshotRevenue\.matchesCurrent === false/);
  assert.match(component, /snapshotRevenueLabel/);
  assert.match(component, /"legacy_not_recorded"/);
});

test("erros financeiros sao visiveis, nao convertidos em zero", () => {
  assert.match(component, /role="alert"/);
  assert.match(component, /"Não apurados"/);
  assert.match(component, /"Sem pré-fechamento"/);
  assert.match(component, /controller\.abort\(\)/);
});

test("componente esta integrado apenas ao periodo mensal", () => {
  assert.match(
    section,
    /import ZionAdminFinancialHistory from "\.\/ZionAdminFinancialHistory";/
  );
  assert.match(
    section,
    /\{data && period==="month" \? <ZionAdminFinancialHistory \/> : null\}/
  );
});
test("D13C_MONTH_FORMAT_TEST: mes em portugues sem capitalizar de", () => {
  assert.match(component, /formattedMonth\.charAt\(0\)\.toLocaleUpperCase\("pt-BR"\)/);
  assert.match(component, /formattedMonth\.slice\(1\)/);
  assert.doesNotMatch(component, /font-semibold capitalize text-white/);
});

test("D13C: meta_invoice tem rotulo legivel", () => {
  assert.match(
    component,
    /meta_invoice: "Comprovação financeira da Meta"/,
  );
});
test("D13C_FUNCTIONAL_MONTH_TEST: formatacao real do mes", () => {
  const ts = require("typescript");
  const vm = require("node:vm");

  const declaration = component.match(
    /^function monthName\(month: string\): string \{[\s\S]*?^\}/m
  );

  assert.ok(declaration, "Funcao monthName nao encontrada");

  const compiled = ts.transpileModule(
    declaration[0] + "\nmodule.exports = monthName;",
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }
  ).outputText;

  const context = {
    module: { exports: null },
    Intl,
    Date,
  };

  vm.runInNewContext(compiled, context);

  const format = context.module.exports;

  assert.equal(format("2026-10-01"), "Outubro de 2026");
  assert.equal(format("2026-11-01"), "Novembro de 2026");
  assert.equal(format("2025-12-01"), "Dezembro de 2025");
});

test("API retorna acumulado calculado pelo leitor canonico", () => {
  const api = fs.readFileSync(
    "src/app/api/zion-admin/financial-history/route.ts",
    "utf8",
  );

  assert.match(api, /buildAccumulatedFinancialHistory\(history\)/);
  assert.match(api, /\baccumulated,/);
  assert.doesNotMatch(api, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});

test("resumo parcial aparece no historico financeiro", () => {
  assert.match(component, /Resumo financeiro acumulado parcial/);
  assert.match(component, /Acumulado parcial — últimos 12 meses/);
  assert.match(component, /Saldo parcial acumulado/);
  assert.match(component, /history\.accumulated\.excludedMonths/);
  assert.match(component, /Não representa lucro ou prejuízo definitivo/);
});

test("validador independente detecta acumulado adulterado", () => {
  const ts = require("typescript");
  const vm = require("node:vm");

  const definitions = [
    /^function asObject\([\s\S]*?^\}/m,
    /^function validateAccumulated\([\s\S]*?^\}/m,
  ];

  const declarations = definitions.map((pattern) => {
    const match = component.match(pattern);
    assert.ok(match, "Validador nao encontrado");
    return match[0];
  });

  const js = ts.transpileModule(
    declarations.join("\n\n") +
      "\nmodule.exports = validateAccumulated;",
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;

  const context = { module: { exports: null } };
  vm.runInNewContext(js, context);
  const validate = context.module.exports;

  const history = [{
    month: "2026-11-01",
    revenue: {
      status: "confirmed",
      amountBrlCents: 0,
    },
    costs: {
      complete: false,
      knownSubtotalBrlCents: 250,
    },
    result: {
      status: "partial",
      definitive: false,
      netBrlCents: -250,
    },
  }];

  const payload = {
    accumulated: {
      status: "partial",
      definitive: false,
      evaluatedMonths: 1,
      includedMonths: ["2026-11-01"],
      excludedMonths: [],
      revenueBrlCents: 0,
      knownCostsBrlCents: 250,
      netBrlCents: -250,
      basis:
        "confirmed_revenues_and_latest_preclosure_known_costs",
    },
  };

  assert.equal(
    validate(payload, history).netBrlCents, -250,
  );

  const altered = structuredClone(payload);
  altered.accumulated.netBrlCents = 0;

  assert.throws(
    () => validate(altered, history),
    /nao confere/,
  );

  const missing = structuredClone(payload);
  missing.accumulated.includedMonths = [];

  assert.throws(
    () => validate(missing, history),
    /nao confere/,
  );

  const falseFinal = structuredClone(payload);
  falseFinal.accumulated.definitive = true;

  assert.throws(
    () => validate(falseFinal, history),
    /Acumulado financeiro invalido/,
  );
});
