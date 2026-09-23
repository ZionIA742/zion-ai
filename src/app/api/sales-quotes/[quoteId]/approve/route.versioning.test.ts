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
  "approve writer call must use the explicit requested version id",
);
assert.match(
  routeSource,
  /p_approved_by:\s*args\.approvedBy/,
  "approve writer call must pass the human approver to the canonical writer",
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
assert.equal(
  /\.from\("sales_quotes"\)\s*\.update\(/.test(routeSource),
  false,
  "approve must not update sales_quotes directly",
);
assert.equal(
  routeSource.includes("insertQuoteConversationEvent"),
  false,
  "approve must not insert the approval event outside the canonical writer",
);
assert.match(
  routeSource,
  /readQuoteVersionIdFromBody/,
  "approve must read quoteVersionId from an explicit request body",
);
assert.equal(
  routeSource.includes("versionId: currentVersionId"),
  false,
  "approve must not fall back to current_version_id as the requested approval version",
);
assert.match(
  routeSource,
  /assertSalesQuoteVersionNotExpired\(\{/,
  "approve must preserve lazy expiration validation before invoking the writer",
);
assert.match(
  routeSource,
  /assertSalesQuoteVersionNotExpired\(\{[\s\S]*?approveQuoteVersion\(\{/,
  "approve must block expired versions before invoking the writer",
);

console.log("approve versioning route contracts passed");
