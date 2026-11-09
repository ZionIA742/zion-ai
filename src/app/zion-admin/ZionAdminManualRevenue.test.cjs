const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const ui = readFileSync(join(__dirname, "ZionAdminManualRevenue.tsx"), "utf8");
const costs = readFileSync(join(__dirname, "ZionAdminCostsSection.tsx"), "utf8");

test("receita zero confirmada nao se confunde com ausencia de registro", () => {
  const match = ui.match(/function parseRevenueCents\(text: string\): number \| null \{([\s\S]*?)\n\}/);
  assert.ok(match);
  const parse = new Function("text", match[1]);
  assert.equal(parse("0,00"), 0);
  assert.equal(parse("0"), 0);
  assert.equal(parse("125,50"), 12550);
  assert.equal(parse("abc"), null);
  assert.equal(parse("-1"), null);
  assert.match(ui, /data\?\.confirmed \? data\.revenue : null/);
  assert.match(ui, /"Não informada"/);
});

test("escrita usa versao e chave de idempotencia", () => {
  assert.match(ui, /expectedRevision: data\.revenue\?\.revision \?\? 0/);
  assert.match(ui, /operationKey: operationKey\.current/);
  assert.match(ui, /crypto\.randomUUID\(\)/);
  assert.match(ui, /readRevenue\(month\)/);
});

test("o resultado nao transforma custos incompletos em lucro fechado", () => {
  assert.match(ui, /const partial = !costsComplete \|\| totalCostCents === null/);
  assert.match(ui, /Resultado parcial/);
  assert.match(ui, /Não representa lucro ou prejuízo fechado/);
  assert.match(ui, /data\.history\.map/);
});

test("montagem so aparece no periodo mensal e vincula a competencia", () => {
  assert.match(costs, /period==="month" \? <ZionAdminManualRevenue/);
  assert.match(costs, /month=\{`\$\{anchor\.slice\(0,7\)\}-01`\}/);
  assert.match(costs, /metaFinancialEvidence==="available"/);
});
