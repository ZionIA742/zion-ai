import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMonthlyFinalCloseEligibility,
} from "./zion-admin-monthly-final-close-eligibility.ts";

function base() {
  return {
    month: "2026-10-01",
    preclosure: {
      month: "2026-10-01",
      revision: 1,
      pendingSources: [],
    },
    fixed: {
      availability: "available",
      brlCents: 33233,
    },
    manual: {
      availability: "available",
      brlCents: 5000,
      usdCents: 0,
    },
    openAi: {
      availability: "complete",
      confirmedDays: 31,
      officialUsd: "2.50",
    },
    ptax: {
      availability: "complete",
      estimatedBrlCents: 1350,
    },
    meta: {
      status: "verified_not_applicable",
      brlCents: null,
      authorityKey: "trusted-system-fixture",
    },
  };
}

test("fontes completas podem ser elegiveis", () => {
  const result = evaluateMonthlyFinalCloseEligibility(base());
  assert.equal(result.eligible, true);
  assert.deepEqual(result.blockers, []);
});

test("Meta desconhecida bloqueia fechamento", () => {
  const input = base();
  input.meta.status = "unknown";
  input.meta.authorityKey = null;
  const result = evaluateMonthlyFinalCloseEligibility(input);
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes("meta_unverified"));
});

test("Meta nao aplicavel exige autoridade tecnica", () => {
  const input = base();
  input.meta.authorityKey = null;
  assert.equal(
    evaluateMonthlyFinalCloseEligibility(input).eligible,
    false,
  );
});

test("Meta confirmada com valor financeiro e aceita", () => {
  const input = base();
  input.meta.status = "verified_amount";
  input.meta.brlCents = 120;
  assert.equal(
    evaluateMonthlyFinalCloseEligibility(input).eligible,
    true,
  );
});

test("USD manual sem regra cambial bloqueia", () => {
  const input = base();
  input.manual.usdCents = 300;
  const result = evaluateMonthlyFinalCloseEligibility(input);
  assert.ok(result.blockers.includes("manual_usd_conversion_undefined"));
});

test("OpenAI com dias faltantes bloqueia", () => {
  const input = base();
  input.openAi.confirmedDays = 30;
  assert.equal(
    evaluateMonthlyFinalCloseEligibility(input).eligible,
    false,
  );
});

test("PTAX ausente bloqueia USD positivo", () => {
  const input = base();
  input.ptax.availability = "unavailable";
  input.ptax.estimatedBrlCents = null;
  assert.ok(
    evaluateMonthlyFinalCloseEligibility(input).blockers.includes(
      "ptax_incomplete",
    ),
  );
});

test("USD zero confirmado dispensa PTAX", () => {
  const input = base();
  input.openAi.officialUsd = "0.00";
  input.ptax.availability = "unavailable";
  input.ptax.estimatedBrlCents = null;
  assert.equal(
    evaluateMonthlyFinalCloseEligibility(input).eligible,
    true,
  );
});

test("pre-fechamento com pendencias bloqueia", () => {
  const input = base();
  input.preclosure.pendingSources = ["meta_financial_authority"];
  assert.ok(
    evaluateMonthlyFinalCloseEligibility(input).blockers.includes(
      "pending_preclosure_sources",
    ),
  );
});

test("revisao invalida bloqueia", () => {
  const input = base();
  input.preclosure.revision = 0;
  assert.equal(
    evaluateMonthlyFinalCloseEligibility(input).eligible,
    false,
  );
});

test("despesa fixa desconhecida nao vira zero", () => {
  const input = base();
  input.fixed.availability = "unavailable";
  input.fixed.brlCents = null;
  assert.ok(
    evaluateMonthlyFinalCloseEligibility(input).blockers.includes(
      "fixed_costs_unavailable",
    ),
  );
});

test("resultado puro e deterministico", () => {
  const input = base();
  const first = evaluateMonthlyFinalCloseEligibility(input);
  const second = evaluateMonthlyFinalCloseEligibility(input);
  assert.deepEqual(first, second);
});