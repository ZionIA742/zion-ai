import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const source = readFileSync(
  new URL(
    "./zion-admin-financial-evidence-verification-draft.ts",
    import.meta.url,
  ),
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

const assess =
  context.exports.assessFinancialProofDraft;

assert.equal(typeof assess, "function");

function draft(changes = {}) {
  return {
    source: "fixed_costs",
    proofType: "supplier_invoice",
    amountBrlCents: 1500,
    amountUsd: null,
    ...changes,
  };
}

const validCases = [
  [
    "01 - custo fixo com BRL informado",
    draft(),
  ],
  [
    "02 - despesa manual com duas moedas",
    draft({
      source: "manual_expenses",
      proofType: "expense_receipt",
      amountBrlCents: 120,
      amountUsd: "2.35",
    }),
  ],
  [
    "03 - OpenAI com zero USD informado",
    draft({
      source: "openai_invoice",
      amountBrlCents: null,
      amountUsd: "0",
    }),
  ],
  [
    "04 - Meta com zero BRL informado",
    draft({
      source: "meta_invoice",
      amountBrlCents: 0,
    }),
  ],
  [
    "05 - Meta com USD de oito casas",
    draft({
      source: "meta_invoice",
      proofType: "supplier_statement",
      amountBrlCents: null,
      amountUsd: "5.12345678",
    }),
  ],
  [
    "06 - conciliacao interna estruturalmente aceita",
    draft({
      proofType: "internal_reconciliation",
      amountBrlCents: 0,
    }),
  ],
];

for (const [name, input] of validCases) {
  test(name, () => {
    const result = assess(input);

    assert.equal(result.ok, true);
    assert.equal(result.candidate.source, input.source);
    assert.equal(
      result.candidate.proofType,
      input.proofType,
    );
    assert.equal(
      result.candidate.amountBrlCents,
      input.amountBrlCents,
    );
    assert.equal(
      result.candidate.amountUsd,
      input.amountUsd,
    );
    assert.equal(
      Object.hasOwn(result.candidate, "verified"),
      false,
    );
  });
}

const missingUsd = draft();
delete missingUsd.amountUsd;

const invalidCases = [
  [
    "07 - fonte desconhecida",
    draft({ source: "unknown" }),
    "INVALID_SOURCE",
  ],
  [
    "08 - Meta nao aceita conciliacao interna",
    draft({
      source: "meta_invoice",
      proofType: "internal_reconciliation",
    }),
    "INVALID_PROOF_TYPE",
  ],
  [
    "09 - despesa manual nao aceita fatura fornecedor",
    draft({
      source: "manual_expenses",
      proofType: "supplier_invoice",
    }),
    "INVALID_PROOF_TYPE",
  ],
  [
    "10 - valores ausentes nao sao zero",
    draft({
      amountBrlCents: null,
      amountUsd: null,
    }),
    "AMOUNT_REQUIRED",
  ],
  [
    "11 - campo de moeda obrigatorio ausente",
    missingUsd,
    "INVALID_SHAPE",
  ],
  [
    "12 - campo verified nao pode ser enviado",
    draft({ verified: true }),
    "INVALID_SHAPE",
  ],
  [
    "13 - BRL fracionario rejeitado",
    draft({ amountBrlCents: 10.5 }),
    "INVALID_BRL_AMOUNT",
  ],
  [
    "14 - BRL negativo rejeitado",
    draft({ amountBrlCents: -1 }),
    "INVALID_BRL_AMOUNT",
  ],
  [
    "15 - BRL inseguro rejeitado",
    draft({
      amountBrlCents: Number.MAX_SAFE_INTEGER + 1,
    }),
    "INVALID_BRL_AMOUNT",
  ],
  [
    "16 - USD numerico rejeitado",
    draft({
      amountBrlCents: null,
      amountUsd: 2.4,
    }),
    "INVALID_USD_AMOUNT",
  ],
  [
    "17 - USD negativo rejeitado",
    draft({
      amountBrlCents: null,
      amountUsd: "-1",
    }),
    "INVALID_USD_AMOUNT",
  ],
  [
    "18 - USD com precisao excessiva rejeitado",
    draft({
      amountBrlCents: null,
      amountUsd: "1.123456789",
    }),
    "INVALID_USD_AMOUNT",
  ],
  [
    "19 - USD com parte inteira excessiva",
    draft({
      amountBrlCents: null,
      amountUsd: "1234567890123",
    }),
    "INVALID_USD_AMOUNT",
  ],
  [
    "20 - USD com espacos nao e normalizado",
    draft({
      amountBrlCents: null,
      amountUsd: " 1.00 ",
    }),
    "INVALID_USD_AMOUNT",
  ],
  [
    "21 - entrada nula rejeitada",
    null,
    "INVALID_INPUT",
  ],
  [
    "22 - entrada em array rejeitada",
    [],
    "INVALID_INPUT",
  ],
];

for (const [name, input, expectedReason] of invalidCases) {
  test(name, () => {
    const result = assess(input);

    assert.equal(result.ok, false);
    assert.equal(result.reason, expectedReason);
    assert.equal(
      Object.hasOwn(result, "candidate"),
      false,
    );
  });
}