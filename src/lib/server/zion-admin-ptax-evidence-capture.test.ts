import assert from "node:assert/strict";
import test from "node:test";

import {
  captureValidatedPtaxCollection,
} from "./zion-admin-ptax-evidence-capture";

import {
  DailyPtaxError,
  type PtaxFetcher,
} from "./zion-admin-ptax-daily";

const FROM = "2026-10-27";
const TO = "2026-10-27";

function clockPair(first: string, second: string) {
  const values = [first, second];
  let index = 0;

  return () => new Date(values[Math.min(index++, 1)]);
}

test("captures validated JSON using exactly one PTAX request", async () => {
  const rows = [{
    dataHoraCotacao: "2026-10-27 13:10:00",
    cotacaoVenda: 5.25,
  }];

  const urls: string[] = [];

  const fetcher: PtaxFetcher = async (url, options) => {
    urls.push(url);
    assert.equal(options.cache, "no-store");

    return {
      ok: true,
      json: async () => ({ value: rows }),
    };
  };

  const result = await captureValidatedPtaxCollection(
    FROM,
    TO,
    fetcher,
    clockPair(
      "2026-10-27T12:00:00.000Z",
      "2026-10-27T12:00:01.000Z",
    ),
  );

  assert.equal(urls.length, 1);

  assert.equal(
    result.report.daily[0].rate,
    "5.25",
  );

  assert.equal(
    result.evidence.source,
    "bcb_ptax_venda",
  );

  assert.equal(result.evidence.requestedFrom, FROM);
  assert.equal(result.evidence.requestedTo, TO);
  assert.equal(result.evidence.endpointUrl, urls[0]);
  assert.equal(result.evidence.resultCount, 1);

  assert.ok(
    result.evidence.endpointUrl.startsWith(
      "https://olinda.bcb.gov.br/olinda/servico/PTAX/",
    ),
  );

  assert.deepEqual(
    result.evidence.responsePayload,
    { value: rows },
  );

  assert.equal(
    result.evidence.requestStartedAt,
    "2026-10-27T12:00:00.000Z",
  );

  assert.equal(
    result.evidence.requestFinishedAt,
    "2026-10-27T12:00:01.000Z",
  );
});

test("does not expose evidence after invalid PTAX response", async () => {
  const fetcher: PtaxFetcher = async () => ({
    ok: true,
    json: async () => ({
      value: [{
        cotacaoVenda: -1,
        dataHoraCotacao: "2026-10-27 13:10:00",
      }],
    }),
  });

  await assert.rejects(
    captureValidatedPtaxCollection(FROM, TO, fetcher),
    DailyPtaxError,
  );
});

test("rejects unsuccessful HTTP responses", async () => {
  const fetcher: PtaxFetcher = async () => ({
    ok: false,
    json: async () => ({ value: [] }),
  });

  await assert.rejects(
    captureValidatedPtaxCollection(FROM, TO, fetcher),
    DailyPtaxError,
  );
});

test("does not call provider when dates are invalid", async () => {
  let called = false;

  const fetcher: PtaxFetcher = async () => {
    called = true;
    return {
      ok: true,
      json: async () => ({ value: [] }),
    };
  };

  await assert.rejects(
    captureValidatedPtaxCollection(
      "2026-10-28",
      "2026-10-27",
      fetcher,
    ),
    DailyPtaxError,
  );

  assert.equal(called, false);
});

test("rejects reversed evidence timestamps", async () => {
  const fetcher: PtaxFetcher = async () => ({
    ok: true,
    json: async () => ({ value: [] }),
  });

  await assert.rejects(
    captureValidatedPtaxCollection(
      FROM,
      TO,
      fetcher,
      clockPair(
        "2026-10-27T12:00:02.000Z",
        "2026-10-27T12:00:01.000Z",
      ),
    ),
    DailyPtaxError,
  );
});