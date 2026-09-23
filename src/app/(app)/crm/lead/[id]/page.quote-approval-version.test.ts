import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");

assert.match(
  pageSource,
  /JSON\.stringify\(\{\s*quoteVersionId:\s*safeVersionId\s*\}\)/,
  "CRM quote approval must send the displayed quoteVersionId explicitly",
);

assert.match(
  pageSource,
  /quote\.current_version\?\.id\s*\|\|\s*quote\.current_version_id/,
  "CRM quote approval must use the visible current_version/current_version_id authority",
);

assert.match(
  pageSource,
  /result\?\.error === "QUOTE_VERSION_STALE"[\s\S]*?fetchGeneratedQuotes\(\{ silent: true \}\)/,
  "CRM quote approval must reload quote data on stale/version conflict",
);

console.log("CRM quote approval version UI contract passed");
