import assert from "node:assert/strict";
import test from "node:test";
import {
  assessMetaFinancialProofContract,
} from "./zion-admin-meta-financial-proof-contract.ts";

const month = "2026-11-01";
const revision = 1;

function base() {
  return {
    month,
    preclosureRevision: revision,
    source: "meta_invoice",
    uploadId: "123",
    documentSha256: "a".repeat(64),
    authorityKey: "22222222-2222-4222-8222-222222222222",
    status: "verified_amount",
    amountBrlCents: 1250,
    proofAmountBrlCents: 1250,
    proofType: "supplier_invoice",
  };
}

function assess(input) {
  return assessMetaFinancialProofContract(input, month, revision);
}

test("fatura com valores coincidentes e estruturalmente compativel", () => {
  const result = assess(base());
  assert.equal(result.structurallyCompatible, true);
  assert.deepEqual(result.blockers, []);
});

test("demonstrativo financeiro pode comprovar ausencia de cobranca", () => {
  const input = base();
  input.status = "verified_not_applicable";
  input.amountBrlCents = 0;
  input.proofAmountBrlCents = 0;
  input.proofType = "supplier_statement";
  assert.equal(assess(input).structurallyCompatible, true);
});

test("ausencia de documento nao comprova zero", () => {
  assert.equal(assess(null).structurallyCompatible, false);
});

test("fatura nao substitui demonstrativo de nao aplicabilidade", () => {
  const input = base();
  input.status = "verified_not_applicable";
  input.amountBrlCents = 0;
  input.proofAmountBrlCents = 0;
  assert.equal(assess(input).structurallyCompatible, false);
});

test("nao aplicabilidade nao aceita valor positivo", () => {
  const input = base();
  input.status = "verified_not_applicable";
  input.amountBrlCents = 0;
  input.proofType = "supplier_statement";
  assert.equal(assess(input).structurallyCompatible, false);
});

test("valor divergente bloqueia", () => {
  const input = base();
  input.proofAmountBrlCents = 1300;
  assert.equal(assess(input).structurallyCompatible, false);
});

test("competencia ou revisao divergente bloqueia", () => {
  const input = base();
  input.preclosureRevision = 2;
  assert.equal(assess(input).structurallyCompatible, false);
});

test("autoridade sem identificador canonico bloqueia", () => {
  const input = base();
  input.authorityKey = "trusted-by-browser";
  assert.equal(assess(input).structurallyCompatible, false);
});

test("estado desconhecido nao autoriza zero", () => {
  const input = base();
  input.status = "unknown";
  input.amountBrlCents = 0;
  input.proofAmountBrlCents = 0;
  assert.equal(assess(input).structurallyCompatible, false);
});
test("upload aceita bigint canonico em texto", () => {
  const input = base();
  input.uploadId = "9223372036854775807";
  assert.equal(assess(input).structurallyCompatible, true);
});

test("upload aceita numero inteiro seguro", () => {
  const input = base();
  input.uploadId = 123;
  assert.equal(assess(input).structurallyCompatible, true);
});

test("upload rejeita UUID, zero e inteiro inseguro", () => {
  const input = base();

  for (const value of [
    "11111111-1111-4111-8111-111111111111",
    "0",
    "000123",
    "9223372036854775808",
    0,
    -1,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    input.uploadId = value;
    assert.equal(
      assess(input).structurallyCompatible,
      false,
      String(value)
    );
  }
});

test("Meta nao aplicavel nao aceita BRL nulo", () => {
  const input = base();
  input.status = "verified_not_applicable";
  input.amountBrlCents = null;
  input.proofAmountBrlCents = 0;
  input.proofType = "supplier_statement";

  assert.equal(assess(input).structurallyCompatible, false);
});