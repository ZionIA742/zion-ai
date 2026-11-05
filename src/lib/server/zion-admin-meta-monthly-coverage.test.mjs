import test from "node:test";
import assert from "node:assert/strict";
import {
  assessMetaMonthlyCoverage,
} from "./zion-admin-meta-monthly-coverage.ts";

const account = (id, kind = "amount_record", amount = 125) => ({
  billingAccountId: id,
  month: "2026-10-01",
  kind,
  amountBrlCents: amount,
});

const base = () => ({
  month: "2026-10-01",
  census: {
    complete: true,
    billingAccountIds: ["pma-a", "pma-b"],
  },
  records: [
    account("pma-a"),
    account("pma-b", "not_applicable_record", null),
  ],
});

const checkBlocked = (input, code) => {
  const result = assessMetaMonthlyCoverage(input);
  assert.equal(result.status, "unknown");
  assert.equal(result.candidateBrlCents, null);
  assert.ok(result.blockers.includes(code));
};

test("01 - cobertura valida gera apenas candidata", () => {
  const result = assessMetaMonthlyCoverage(base());
  assert.equal(result.status, "candidate_complete");
  assert.equal(result.candidateBrlCents, 125);
  assert.equal(result.candidateNotApplicable, false);
  assert.equal(result.expectedAccounts, 2);
  assert.equal(result.coveredAccounts, 2);
});

test("02 - todos nao aplicaveis continuam candidatos", () => {
  const input = base();
  input.records = [
    account("pma-a", "not_applicable_record", null),
    account("pma-b", "not_applicable_record", null),
  ];
  const result = assessMetaMonthlyCoverage(input);
  assert.equal(result.status, "candidate_complete");
  assert.equal(result.candidateNotApplicable, true);
  assert.equal(result.candidateBrlCents, null);
});

test("03 - custo zero registrado nao vira nao aplicavel", () => {
  const input = base();
  input.records = [
    account("pma-a", "amount_record", 0),
    account("pma-b", "amount_record", 0),
  ];
  const result = assessMetaMonthlyCoverage(input);
  assert.equal(result.candidateBrlCents, 0);
  assert.equal(result.candidateNotApplicable, false);
});

test("04 - censo desconhecido bloqueia", () => {
  const input = base();
  input.census.complete = false;
  checkBlocked(input, "account_census_unverified");
});

test("05 - censo vazio nao comprova isencao", () => {
  const input = base();
  input.census.billingAccountIds = [];
  input.records = [];
  checkBlocked(input, "empty_account_census_requires_proof");
});

test("06 - conta esperada ausente bloqueia", () => {
  const input = base();
  input.records.pop();
  checkBlocked(input, "missing_billing_account");
});

test("07 - registro de conta inesperada bloqueia", () => {
  const input = base();
  input.records.push(account("pma-c"));
  checkBlocked(input, "unexpected_billing_account");
});

test("08 - duplicidade de registro bloqueia", () => {
  const input = base();
  input.records.push(account("pma-a"));
  checkBlocked(input, "duplicate_account_record");
});

test("09 - duplicidade no censo bloqueia", () => {
  const input = base();
  input.census.billingAccountIds.push("pma-a");
  checkBlocked(input, "duplicate_billing_account");
});

test("10 - competencia divergente bloqueia", () => {
  const input = base();
  input.records[0].month = "2026-09-01";
  checkBlocked(input, "record_month_mismatch");
});

test("11 - valor negativo bloqueia", () => {
  const input = base();
  input.records[0].amountBrlCents = -1;
  checkBlocked(input, "invalid_amount_record");
});

test("12 - valor fracionario bloqueia", () => {
  const input = base();
  input.records[0].amountBrlCents = 1.5;
  checkBlocked(input, "invalid_amount_record");
});

test("13 - nao aplicavel nao aceita valor", () => {
  const input = base();
  input.records[1].amountBrlCents = 0;
  checkBlocked(input, "invalid_not_applicable_record");
});

test("14 - soma acima do limite seguro bloqueia", () => {
  const input = base();
  input.records = [
    account("pma-a", "amount_record", Number.MAX_SAFE_INTEGER),
    account("pma-b", "amount_record", 1),
  ];
  checkBlocked(input, "amount_overflow");
});

test("15 - competencia invalida bloqueia", () => {
  const input = base();
  input.month = "2026-13-01";
  checkBlocked(input, "invalid_month");
});

test("16 - identificador malformado bloqueia", () => {
  const input = base();
  input.census.billingAccountIds[0] = "";
  checkBlocked(input, "invalid_billing_account");
});

test("17 - fonte parcial nunca vira autoridade", () => {
  const input = base();
  input.records[0].amountBrlCents = null;
  checkBlocked(input, "invalid_amount_record");
});

test("18 - resultado nao tem autorizacao de fechamento", () => {
  const result = assessMetaMonthlyCoverage(base());
  assert.equal("eligible" in result, false);
  assert.equal("authorityKey" in result, false);
  assert.equal("verifiedAmount" in result, false);
});