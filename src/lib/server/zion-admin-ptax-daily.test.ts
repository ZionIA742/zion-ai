import assert from "node:assert/strict";
import test from "node:test";
import {
  convertOfficialUsdToBrl,
  loadDailyPtaxRates,
  DailyPtaxError,
  type PtaxFetcher,
} from "./zion-admin-ptax-daily";

function mock(rows: unknown[]): PtaxFetcher {
  return async () => ({
    ok: true,
    json: async () => ({ value: rows }),
  });
}

test("converts official USD without binary floating-point rounding", () => {
  assert.equal(convertOfficialUsdToBrl("0.1642352", "5.25"), "0.86");
  assert.equal(convertOfficialUsdToBrl("0.001", "5"), "0.01");
  assert.equal(convertOfficialUsdToBrl("0", "5.25"), "0.00");
});

test("rejects invalid financial decimals", () => {
  assert.throws(() => convertOfficialUsdToBrl("-1", "5"));
  assert.throws(() => convertOfficialUsdToBrl("1", "0"));
  assert.throws(() => convertOfficialUsdToBrl("NaN", "5"));
});

test("uses same-day PTAX on a business day", async () => {
  const result = await loadDailyPtaxRates(
    "2026-10-27",
    "2026-10-27",
    mock([{
      dataHoraCotacao: "2026-10-27 13:10:00",
      cotacaoVenda: 5.25,
    }])
  );

  assert.deepEqual(result.daily[0], {
    date: "2026-10-27",
    quotationDate: "2026-10-27",
    rate: "5.25",
    status: "same_day",
  });
});

test("uses previous available quote for weekends", async () => {
  const result = await loadDailyPtaxRates(
    "2026-10-24",
    "2026-10-25",
    mock([{
      dataHoraCotacao: "2026-10-23 13:10:00",
      cotacaoVenda: 5.2,
    }])
  );

  assert.equal(result.daily[0].quotationDate, "2026-10-23");
  assert.equal(result.daily[1].quotationDate, "2026-10-23");
  assert.equal(result.daily[1].status, "previous_available");
});

test("does not invent a rate when no quotation exists", async () => {
  const result = await loadDailyPtaxRates(
    "2026-10-27",
    "2026-10-27",
    mock([])
  );

  assert.equal(result.daily[0].rate, null);
  assert.equal(result.daily[0].status, "unavailable");
});

test("rejects inverted and excessive date ranges", async () => {
  await assert.rejects(
    loadDailyPtaxRates("2026-10-28", "2026-10-27", mock([])),
    DailyPtaxError
  );

  await assert.rejects(
    loadDailyPtaxRates("2025-01-01", "2026-10-27", mock([])),
    DailyPtaxError
  );
});

test("rejects invalid or unavailable BCB responses", async () => {
  const failing: PtaxFetcher = async () => ({
    ok: false,
    json: async () => null,
  });

  await assert.rejects(
    loadDailyPtaxRates("2026-10-27", "2026-10-27", failing),
    DailyPtaxError
  );
});
