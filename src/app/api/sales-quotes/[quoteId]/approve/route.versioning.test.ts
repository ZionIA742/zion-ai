import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routeSource = readFileSync(join(__dirname, "route.ts"), "utf8");

assert.match(
  routeSource,
  /approve_sales_quote_version_by_system/,
  "approve must use the canonical version approval writer",
);
assert.match(
  routeSource,
  /p_sales_quote_version_id:\s*args\.versionId/,
  "approve writer call must use the explicit current version id",
);
assert.match(
  routeSource,
  /p_quote_id:\s*args\.quoteId/,
  "approve writer call must stay scoped to quote_id",
);
assert.match(
  routeSource,
  /p_organization_id:\s*args\.organizationId/,
  "approve writer call must stay scoped to organization_id",
);
assert.match(
  routeSource,
  /p_store_id:\s*args\.storeId/,
  "approve writer call must stay scoped to store_id",
);
assert.equal(
  /\.from\("sales_quote_versions"\)\s*\.update\(/.test(routeSource),
  false,
  "approve must not update sales_quote_versions directly",
);
assert.match(
  routeSource,
  /assertSalesQuoteVersionNotExpired\(\{/,
  "approve must validate lazy expiration in the route before mutating sales_quotes",
);
assert.match(
  routeSource,
  /assertSalesQuoteVersionNotExpired\(\{[\s\S]*?\.from\("sales_quotes"\)[\s\S]*?\.update\(\{/,
  "approve must block expired versions before the first sales_quotes update",
);

console.log("approve versioning route contracts passed");
