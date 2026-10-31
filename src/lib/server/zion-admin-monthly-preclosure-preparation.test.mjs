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