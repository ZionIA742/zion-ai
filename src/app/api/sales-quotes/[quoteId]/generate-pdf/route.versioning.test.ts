import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routeSource = readFileSync(join(__dirname, "route.ts"), "utf8");

assert.equal(
  routeSource.includes("getNextQuoteVersionNumber"),
  false,
  "generate-pdf must not pre-compute sales_quote_versions.version_number",
);
assert.match(
  routeSource,
  /versionNumber:\s*null/,
  "generate-pdf should store the PDF before the canonical DB writer assigns the version number",
);
assert.match(
  routeSource,
  /createQuoteVersion\(\{/,
  "generate-pdf should create versions through the shared canonical helper",
);
assert.match(
  routeSource,
  /recordQuoteGenerationFailure\(\{/,
  "generate-pdf failed generation should use the shared canonical helper",
);
assert.match(
  routeSource,
  /resolveSalesQuoteKindForVersion\(\{/,
  "generate-pdf must resolve canonical quote_kind server-side",
);
assert.equal(
  routeSource.indexOf("resolveSalesQuoteKindForVersion({") < routeSource.indexOf("createQuoteVersion({"),
  true,
  "generate-pdf must resolve quote_kind before creating a version",
);
assert.match(
  routeSource,
  /quoteKind,\s*\n\s*\}\);/,
  "generate-pdf must persist the resolved quote_kind through the version writer",
);

console.log("generate-pdf versioning route contracts passed");
