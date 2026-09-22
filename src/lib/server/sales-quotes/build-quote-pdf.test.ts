import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatQuotePdfDate } from "./build-quote-pdf";

const source = readFileSync(join(__dirname, "build-quote-pdf.ts"), "utf8");

assert.match(
  source,
  /input\.quoteKind === "preliminary"/,
  "PDF must only show the preliminary notice for preliminary quotes",
);
assert.match(
  source,
  /ORCAMENTO PRELIMINAR/,
  "PDF must explicitly label preliminary quotes",
);
assert.match(
  source,
  /Valores e condicoes sujeitos a conclusao da visita tecnica/,
  "PDF must explain the technical-visit condition for preliminary quotes",
);

const originalTimezone = process.env.TZ;
try {
  process.env.TZ = "America/Sao_Paulo";

  assert.equal(formatQuotePdfDate("2026-09-29"), "29/09/2026");
  assert.equal(formatQuotePdfDate("2026-01-01"), "01/01/2026");
  assert.equal(formatQuotePdfDate("2026-12-31"), "31/12/2026");
  assert.equal(formatQuotePdfDate(null), "-");
  assert.equal(formatQuotePdfDate(undefined), "-");
} finally {
  if (originalTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimezone;
  }
}

assert.equal(
  source.includes("new Date(safeValue)"),
  true,
  "non date-only values can still use the existing Date fallback",
);
assert.match(
  source,
  /dateOnlyMatch[\s\S]*return `\$\{day\}\/\$\{month\}\/\$\{year\}`/,
  "date-only values must be formatted from YYYY-MM-DD components without instant conversion",
);

console.log("build-quote-pdf preliminary/date-only contracts passed");
