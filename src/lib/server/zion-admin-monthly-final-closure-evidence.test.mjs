import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("./zion-admin-monthly-final-closure-evidence.ts", import.meta.url),
  "utf8",
);

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const context = { exports: {} };
runInNewContext(compiled.outputText, context);

const { assessMonthlyFinalClosureEvidence } = context.exports;

const MONTH = "2026-10-01";

function evidence(source, changes = {}) {
  return {
    source,
    month: MONTH,
    status: "verified",
    proofType: source === "manual_expenses"
      ? "expense_receipt"
      : "supplier_invoice",
    documentReference: "COMPROVANTE-123",
    verifiedBy: "zion-admin",
    verifiedAt: "2026-10-31T12:00:00Z",
    amountBrlCents: source === "openai_invoice"
      ? null
      : 1000,
    amountUsd: source === "openai_invoice"
      ? "12.50"
      : null,
    ...changes,
  };
}

function input() {
  return {
    month: MONTH,
    preclosureRevision: 1,
    evidence: [
      evidence("fixed_costs"),
      evidence("manual_expenses"),
      evidence("openai_invoice"),
      evidence("meta_invoice"),
    ],
  };
}

function assess(data) {
  return assessMonthlyFinalClosureEvidence(data);
}

test("01 - conjunto estrutural completo", () => {
  const result = assess(input());
  assert.equal(result.structurallyComplete, true);
  assert.equal(result.missingSources.length, 0);
  assert.equal(result.invalidSources.length, 0);
});

test("02 - zero registrado com evidencia e aceito", () => {
  const data = input();

  data.evidence = data.evidence.map((item) => ({
    ...item,
    amountBrlCents: item.amountBrlCents === null ? null : 0,
    amountUsd: item.amountUsd === null ? null : "0.00",
  }));

  assert.equal(assess(data).structurallyComplete, true);
});

test("03 - fatura Meta ausente impede completude", () => {
  const data = input();
  data.evidence = data.evidence.filter(
    (item) => item.source !== "meta_invoice",
  );

  const result = assess(data);
  assert.equal(result.structurallyComplete, false);
  assert.equal(result.missingSources.includes("meta_invoice"), true);
});

test("04 - colecao ausente e rejeitada", () => {
  const data = input();
  data.evidence = null;

  const result = assess(data);
  assert.equal(result.structurallyComplete, false);
  assert.equal(
    result.invalidSources.includes("invalid_evidence_collection"),
    true,
  );
});

test("05 - fonte desconhecida e rejeitada", () => {
  const data = input();
  data.evidence.push(evidence("unknown_provider"));

  const result = assess(data);
  assert.equal(result.structurallyComplete, false);
  assert.equal(
    result.invalidSources.includes("unknown_evidence_source"),
    true,
  );
});

test("06 - comprovante duplicado e rejeitado", () => {
  const data = input();
  data.evidence.push(evidence("meta_invoice"));

  const result = assess(data);
  assert.equal(result.structurallyComplete, false);
  assert.equal(result.invalidSources.includes("meta_invoice"), true);
});

test("07 - mes invalido e rejeitado", () => {
  const data = input();
  data.month = "2026-13-01";

  const result = assess(data);
  assert.equal(result.structurallyComplete, false);
  assert.equal(result.invalidSources.includes("invalid_month"), true);
});

test("08 - revisao inexistente ou invalida e rejeitada", () => {
  const data = input();
  data.preclosureRevision = 0;

  const result = assess(data);
  assert.equal(result.structurallyComplete, false);
  assert.equal(
    result.invalidSources.includes("invalid_preclosure_revision"),
    true,
  );
});

test("09 - valor negativo e rejeitado", () => {
  const data = input();
  data.evidence[0].amountBrlCents = -1;

  const result = assess(data);
  assert.equal(result.structurallyComplete, false);
  assert.equal(result.invalidSources.includes("fixed_costs"), true);
});

test("10 - centavos fracionarios sao rejeitados", () => {
  const data = input();
  data.evidence[0].amountBrlCents = 10.5;

  const result = assess(data);
  assert.equal(result.structurallyComplete, false);
  assert.equal(result.invalidSources.includes("fixed_costs"), true);
});

test("11 - valores desconhecidos nao viram zero", () => {
  const data = input();
  data.evidence[3].amountBrlCents = null;
  data.evidence[3].amountUsd = null;

  const result = assess(data);
  assert.equal(result.structurallyComplete, false);
  assert.equal(result.invalidSources.includes("meta_invoice"), true);
});

test("12 - referencia de documento vazia e rejeitada", () => {
  const data = input();
  data.evidence[2].documentReference = "";

  const result = assess(data);
  assert.equal(result.structurallyComplete, false);
  assert.equal(result.invalidSources.includes("openai_invoice"), true);
});

test("13 - tipo de comprovante incorreto e rejeitado", () => {
  const data = input();
  data.evidence[2].proofType = "internal_reconciliation";

  const result = assess(data);
  assert.equal(result.structurallyComplete, false);
  assert.equal(result.invalidSources.includes("openai_invoice"), true);
});

test("14 - evidencia de outro mes e rejeitada", () => {
  const data = input();
  data.evidence[1].month = "2026-09-01";

  const result = assess(data);
  assert.equal(result.structurallyComplete, false);
  assert.equal(result.invalidSources.includes("manual_expenses"), true);
});