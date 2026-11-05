import test from "node:test";
import assert from "node:assert/strict";

import {
  assessMetaMonthlyBinding,
} from "./zion-admin-meta-monthly-binding.ts";

const base = () => ({
  month: "2026-10-01",
  wabaCensus: {
    complete: true,
    wabaIds: ["123456789", "987654321"],
  },
  bindings: [
    {
      month: "2026-10-01",
      wabaId: "123456789",
      billingAccountId: "pma-a",
    },
    {
      month: "2026-10-01",
      wabaId: "987654321",
      billingAccountId: "pma-b",
    },
  ],
  candidateBillingAccountIds: ["pma-a", "pma-b"],
});

function blocked(input, reason) {
  const result = assessMetaMonthlyBinding(input);
  assert.equal(result.status, "unknown");
  assert.ok(result.blockers.includes(reason));
  assert.deepEqual(result.candidateBillingAccounts, []);
}

test("01 - cobertura completa produz vinculacao candidata", () => {
  const result = assessMetaMonthlyBinding(base());
  assert.equal(result.status, "candidate_bound");
  assert.equal(result.expectedWabas, 2);
  assert.equal(result.boundWabas, 2);
  assert.deepEqual(
    result.candidateBillingAccounts,
    ["pma-a", "pma-b"],
  );
});

test("02 - duas WABAs podem compartilhar conta financeira", () => {
  const input = base();
  input.bindings[1].billingAccountId = "pma-a";
  input.candidateBillingAccountIds = ["pma-a"];

  const result = assessMetaMonthlyBinding(input);
  assert.equal(result.status, "candidate_bound");
  assert.equal(result.candidateBillingAccounts.length, 1);
});

test("03 - censo WABA incompleto bloqueia", () => {
  const input = base();
  input.wabaCensus.complete = false;
  blocked(input, "waba_census_unverified");
});

test("04 - censo vazio nao comprova isencao", () => {
  const input = base();
  input.wabaCensus.wabaIds = [];
  input.bindings = [];
  input.candidateBillingAccountIds = [];
  blocked(input, "empty_waba_census_requires_proof");
});

test("05 - WABA esperada sem vinculacao bloqueia", () => {
  const input = base();
  input.bindings.pop();
  blocked(input, "missing_waba_binding");
});

test("06 - WABA desconhecida na vinculacao bloqueia", () => {
  const input = base();
  input.bindings.push({
    month: "2026-10-01",
    wabaId: "5555566666",
    billingAccountId: "pma-c",
  });
  blocked(input, "unexpected_waba_binding");
});

test("07 - vinculacao duplicada bloqueia", () => {
  const input = base();
  input.bindings.push({ ...input.bindings[0] });
  blocked(input, "duplicate_waba_binding");
});

test("08 - duplicidade no censo WABA bloqueia", () => {
  const input = base();
  input.wabaCensus.wabaIds.push("123456789");
  blocked(input, "duplicate_waba_in_census");
});

test("09 - competencia divergente bloqueia", () => {
  const input = base();
  input.bindings[0].month = "2026-09-01";
  blocked(input, "binding_month_mismatch");
});

test("10 - conta financeira malformada bloqueia", () => {
  const input = base();
  input.bindings[0].billingAccountId = "";
  blocked(input, "invalid_binding_account");
});

test("11 - WABA malformada bloqueia", () => {
  const input = base();
  input.wabaCensus.wabaIds[0] = "invalid";
  blocked(input, "invalid_waba_id");
});

test("12 - conta candidata ausente bloqueia", () => {
  const input = base();
  input.candidateBillingAccountIds.pop();
  blocked(input, "missing_candidate_billing_account");
});

test("13 - conta candidata inesperada bloqueia", () => {
  const input = base();
  input.candidateBillingAccountIds.push("pma-c");
  blocked(input, "unexpected_candidate_billing_account");
});

test("14 - duplicidade de conta candidata bloqueia", () => {
  const input = base();
  input.candidateBillingAccountIds.push("pma-a");
  blocked(input, "duplicate_candidate_account");
});

test("15 - lista candidata vazia bloqueia", () => {
  const input = base();
  input.candidateBillingAccountIds = [];
  blocked(input, "empty_candidate_account_census");
});

test("16 - mes invalido bloqueia", () => {
  const input = base();
  input.month = "2026-13-01";
  blocked(input, "invalid_month");
});

test("17 - lista de vinculacoes invalida bloqueia", () => {
  const input = base();
  input.bindings = null;
  blocked(input, "invalid_binding_collection");
});

test("18 - lista de contas candidatas invalida bloqueia", () => {
  const input = base();
  input.candidateBillingAccountIds = null;
  blocked(input, "invalid_candidate_account_collection");
});

test("19 - saida permanece somente estrutural", () => {
  const result = assessMetaMonthlyBinding(base());
  assert.equal("eligible" in result, false);
  assert.equal("authorityKey" in result, false);
  assert.equal("verifiedAmount" in result, false);
  assert.equal("verifiedNotApplicable" in result, false);
});

test("20 - ordem de entrada nao altera as contas de saida", () => {
  const input = base();
  input.bindings.reverse();
  input.candidateBillingAccountIds.reverse();
  const result = assessMetaMonthlyBinding(input);
  assert.deepEqual(
    result.candidateBillingAccounts,
    ["pma-a", "pma-b"],
  );
});