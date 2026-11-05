import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const source = readFileSync(
  new URL("./zion-admin-monthly-preclosure-preparation.ts", import.meta.url),
  "utf8",
);

const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const moduleUrl =
  `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;

const { prepareMonthlyPreclosureSnapshot } = await import(moduleUrl);

function validSources() {
  return {
    fixed: {
      availability: "available",
      amountBrlCents: 0,
    },
    manual: {
      availability: "available",
      amountBrlCents: 0,
      amountUsdCents: 0,
    },
    openAi: {
      availability: "partial",
      confirmedDays: 4,
      totalUsd: null,
    },
  };
}

test("zero registrado permanece zero e outras fontes ficam pendentes", () => {
  const result = prepareMonthlyPreclosureSnapshot(
    "2026-10-01",
    validSources(),
  );

  assert.equal(result.sourceSnapshot.fixed.registeredBrlCents, 0);
  assert.equal(result.sourceSnapshot.manual.registeredBrlCents, 0);
  assert.equal(result.sourceSnapshot.manual.registeredUsdCents, 0);
  assert.equal(result.sourceSnapshot.openai.officialUsd, null);
  assert.equal(result.sourceSnapshot.meta.billedBrlCents, null);
  assert.deepEqual(result.pendingSources, [
    "openai_official",
    "meta_invoice",
  ]);
  assert.equal(result.readyForFinalClose, false);
});

test("fonte indisponivel nunca vira zero", () => {
  const sources = validSources();

  sources.fixed = {
    availability: "unavailable",
    amountBrlCents: null,
  };

  const result = prepareMonthlyPreclosureSnapshot(
    "2026-10-01",
    sources,
  );

  assert.equal(result.sourceSnapshot.fixed.registeredBrlCents, null);
  assert.ok(result.pendingSources.includes("fixed_costs"));
});

test("OpenAI oficialmente completa permite total zero confirmado", () => {
  const sources = validSources();

  sources.openAi = {
    availability: "complete",
    confirmedDays: 31,
    totalUsd: "0",
  };

  const result = prepareMonthlyPreclosureSnapshot(
    "2026-10-01",
    sources,
  );

  assert.equal(result.sourceSnapshot.openai.officialUsd, "0");
  assert.ok(!result.pendingSources.includes("openai_official"));
  assert.ok(result.pendingSources.includes("meta_invoice"));
  assert.equal(result.readyForFinalClose, false);
});

test("OpenAI incompleta nao produz total mensal oficial", () => {
  const sources = validSources();

  sources.openAi.totalUsd = "0.1802464";

  const result = prepareMonthlyPreclosureSnapshot(
    "2026-10-01",
    sources,
  );

  assert.equal(result.sourceSnapshot.openai.officialUsd, null);
  assert.equal(result.sourceSnapshot.openai.confirmedDays, 4);
});

test("valores financeiros inconsistentes sao rejeitados", () => {
  const sources = validSources();

  sources.fixed.amountBrlCents = null;

  assert.throws(
    () => prepareMonthlyPreclosureSnapshot("2026-10-01", sources),
    /INVALID_REGISTERED_FINANCIAL_SOURCE/,
  );
});

test("cobertura oficial completa sem todos os dias e rejeitada", () => {
  const sources = validSources();

  sources.openAi = {
    availability: "complete",
    confirmedDays: 30,
    totalUsd: "0.18",
  };

  assert.throws(
    () => prepareMonthlyPreclosureSnapshot("2026-10-01", sources),
    /INVALID_OFFICIAL_OPENAI_TOTAL/,
  );
});

test("competencia invalida e rejeitada", () => {
  assert.throws(
    () => prepareMonthlyPreclosureSnapshot(
      "2026-13-01",
      validSources(),
    ),
    /INVALID_PRECLOSURE_MONTH/,
  );
});

function completeConversion() {
  return {
    complete: true,
    confirmedDays: 31,
    expectedDays: 31,
    knownBrlCents: 101,
    totalBrlCents: 101,
    missingOfficialDays: [],
    missingPtaxDays: [],
    daily: Array.from({ length: 31 }, (_, index) => {
      const date = `2026-10-${String(index + 1).padStart(2, "0")}`;
      return {
        date,
        usd: index === 0 ? "0.20" : "0",
        brlCents: index === 0 ? 101 : 0,
        quotationDate: index === 0 ? date : null,
        rate: index === 0 ? "5.05" : null,
        operationIds: [`operation-${index}`],
        snapshotIds: [`snapshot-${index}`],
      };
    }),
  };
}

test("OpenAI positiva sem PTAX permanece pendente", () => {
  const sources = validSources();
  sources.openAi = {
    availability: "complete",
    confirmedDays: 31,
    totalUsd: "0.20",
  };

  const result = prepareMonthlyPreclosureSnapshot(
    "2026-10-01", sources,
  );

  assert.ok(result.pendingSources.includes("openai_ptax"));
  assert.ok(result.pendingSources.includes("meta_invoice"));
  assert.equal(result.sourceSnapshot.openai.estimatedBrlCents, null);
  assert.equal(result.readyForFinalClose, false);
});

test("snapshot recebe BRL diario e referencias oficiais", () => {
  const sources = validSources();
  sources.openAi = {
    availability: "complete",
    confirmedDays: 31,
    totalUsd: "0.20",
    conversion: completeConversion(),
  };

  const result = prepareMonthlyPreclosureSnapshot(
    "2026-10-01", sources,
  );

  assert.equal(result.sourceSnapshot.openai.estimatedBrlCents, 101);
  assert.equal(result.sourceSnapshot.openai.knownBrlCents, 101);
  assert.equal(result.sourceSnapshot.openai.fxStatus, "complete");
  assert.equal(
    result.sourceSnapshot.openai.dailyEvidence[0].operationIds[0],
    "operation-0",
  );
  assert.deepEqual(result.pendingSources, ["meta_invoice"]);
  assert.equal(result.readyForFinalClose, false);
});

test("conversao com cobertura divergente e rejeitada", () => {
  const sources = validSources();
  const conversion = completeConversion();
  conversion.expectedDays = 30;

  sources.openAi = {
    availability: "complete",
    confirmedDays: 31,
    totalUsd: "0.20",
    conversion,
  };

  assert.throws(
    () => prepareMonthlyPreclosureSnapshot("2026-10-01", sources),
    /INVALID_OPENAI_PTAX_CONVERSION/,
  );
});

test("snapshot nao compartilha arrays de proveniencia", () => {
  const sources = validSources();
  const conversion = completeConversion();

  sources.openAi = {
    availability: "complete",
    confirmedDays: 31,
    totalUsd: "0.20",
    conversion,
  };

  const result = prepareMonthlyPreclosureSnapshot(
    "2026-10-01", sources,
  );

  result.sourceSnapshot.openai.dailyEvidence[0].operationIds[0] =
    "alterado";

  assert.equal(
    conversion.daily[0].operationIds[0],
    "operation-0",
  );
});

test("rejeita BRL mensal divergente da soma diaria", () => {
  const sources = validSources();
  const conversion = completeConversion();

  conversion.totalBrlCents = 200;

  sources.openAi = {
    availability: "complete",
    confirmedDays: 31,
    totalUsd: "0.20",
    conversion,
  };

  assert.throws(
    () => prepareMonthlyPreclosureSnapshot("2026-10-01", sources),
    /INVALID_OPENAI_PTAX_CONVERSION/,
  );
});

test("rejeita USD diario divergente do total oficial", () => {
  const sources = validSources();
  const conversion = completeConversion();

  conversion.daily[0].usd = "0.19";

  sources.openAi = {
    availability: "complete",
    confirmedDays: 31,
    totalUsd: "0.20",
    conversion,
  };

  assert.throws(
    () => prepareMonthlyPreclosureSnapshot("2026-10-01", sources),
    /INVALID_OPENAI_PTAX_CONVERSION/,
  );
});

test("rejeita cobertura declarada diferente dos dias reais", () => {
  const sources = validSources();
  const conversion = completeConversion();

  conversion.daily[1].usd = null;
  conversion.daily[1].brlCents = null;

  sources.openAi = {
    availability: "complete",
    confirmedDays: 31,
    totalUsd: "0.20",
    conversion,
  };

  assert.throws(
    () => prepareMonthlyPreclosureSnapshot("2026-10-01", sources),
    /INVALID_OPENAI_PTAX_CONVERSION/,
  );
});
