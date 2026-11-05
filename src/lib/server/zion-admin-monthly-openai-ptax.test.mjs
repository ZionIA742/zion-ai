import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeMonthlyOpenAiPtax,
} from "./zion-admin-monthly-openai-ptax.ts";

import {
  convertOfficialUsdToBrl,
} from "./zion-admin-ptax-daily.ts";

const MONTH = "2026-11-01";

function fixtures() {
  const official = Array.from({ length: 30 }, (_, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, "0")}`,
    status: "confirmed_empty",
    totalUsd: "0",
    operationIds: [`operation-${index + 1}`],
    snapshotIds: [`snapshot-${index + 1}`],
  }));

  const rates = official.map((day) => ({
    date: day.date,
    quotationDate: null,
    rate: null,
    status: "unavailable",
  }));

  return { official, rates };
}

function calculate(input) {
  return summarizeMonthlyOpenAiPtax(
    MONTH,
    input.official,
    input.rates,
    convertOfficialUsdToBrl,
  );
}

test("zero oficial confirmado dispensa PTAX", () => {
  const result = calculate(fixtures());

  assert.equal(result.complete, true);
  assert.equal(result.confirmedDays, 30);
  assert.equal(result.totalBrlCents, 0);
});

test("converte cada dia com sua PTAX e soma centavos", () => {
  const input = fixtures();

  input.official[3].status = "available";
  input.official[3].totalUsd = "0.01";
  input.rates[3].quotationDate = "2026-11-04";
  input.rates[3].rate = "5.25";
  input.rates[3].status = "same_day";

  input.official[4].status = "available";
  input.official[4].totalUsd = "0.01";
  input.rates[4].quotationDate = "2026-11-05";
  input.rates[4].rate = "5.55";
  input.rates[4].status = "same_day";

  const result = calculate(input);

  assert.equal(result.complete, true);
  assert.equal(result.totalBrlCents, 11);
  assert.equal(result.knownBrlCents, 11);
  assert.equal(result.daily[3].operationIds[0], "operation-4");
  assert.equal(result.daily[4].snapshotIds[0], "snapshot-5");
});

test("dia OpenAI sem coleta bloqueia completude", () => {
  const input = fixtures();

  input.official[2].status = "not_collected";
  input.official[2].totalUsd = null;

  const result = calculate(input);

  assert.equal(result.complete, false);
  assert.equal(result.totalBrlCents, null);
  assert.deepEqual(result.missingOfficialDays, ["2026-11-03"]);
});

test("PTAX ausente preserva USD sem inventar BRL", () => {
  const input = fixtures();

  input.official[3].status = "available";
  input.official[3].totalUsd = "1.25";

  const result = calculate(input);

  assert.equal(result.complete, false);
  assert.equal(result.daily[3].usd, "1.25");
  assert.equal(result.daily[3].brlCents, null);
  assert.equal(result.totalBrlCents, null);
  assert.deepEqual(result.missingPtaxDays, ["2026-11-04"]);
});

test("PTAX de dia anterior aceita fallback valido", () => {
  const input = fixtures();

  input.official[6].status = "available";
  input.official[6].totalUsd = "1";
  input.rates[6].quotationDate = "2026-11-06";
  input.rates[6].rate = "5.40";
  input.rates[6].status = "previous_available";

  const result = calculate(input);

  assert.equal(result.complete, true);
  assert.equal(result.totalBrlCents, 540);
  assert.equal(result.daily[6].quotationDate, "2026-11-06");
});

test("PTAX futura nao autoriza conversao", () => {
  const input = fixtures();

  input.official[3].status = "available";
  input.official[3].totalUsd = "1";
  input.rates[3].quotationDate = "2026-11-05";
  input.rates[3].rate = "5.40";
  input.rates[3].status = "previous_available";

  const result = calculate(input);

  assert.equal(result.complete, false);
  assert.equal(result.totalBrlCents, null);
});

test("dias duplicados sao rejeitados", () => {
  const input = fixtures();
  input.official[1].date = input.official[0].date;

  assert.throws(
    () => calculate(input),
    /INVALID_DAILY_COVERAGE/,
  );
});

test("confirmed_empty nao aceita valor positivo", () => {
  const input = fixtures();
  input.official[0].totalUsd = "0.50";

  assert.throws(
    () => calculate(input),
    /INVALID_CONFIRMED_EMPTY/,
  );
});

test("conversao nao aceita valor fora da faixa segura", () => {
  const input = fixtures();
  input.official[3].status = "available";
  input.official[3].totalUsd = "1";
  input.rates[3].quotationDate = "2026-11-04";
  input.rates[3].rate = "5.25";
  input.rates[3].status = "same_day";

  assert.throws(
    () => summarizeMonthlyOpenAiPtax(
      MONTH,
      input.official,
      input.rates,
      () => "999999999999999999999.99",
    ),
    /BRL_CONVERSION_OVERFLOW/,
  );
});

test("calculo nao altera os registros originais", () => {
  const input = fixtures();
  const before = JSON.stringify(input);

  calculate(input);

  assert.equal(JSON.stringify(input), before);
});