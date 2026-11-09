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