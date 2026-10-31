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
  /begin_sales_quote_pdf_generation_by_system/,
  "generate-pdf must claim a durable PDF operation before rendering",
);
assert.match(
  routeSource,
  /get_sales_quote_pdf_generation_replay_by_system/,
  "generate-pdf must resolve a materialized replay before conversation guards",
);
assert.match(
  routeSource,
  /materialize_sales_quote_pdf_generation_by_system/,
  "generate-pdf must materialize through the idempotent PDF authority",
);
assert.equal(routeSource.includes("createQuoteVersion"), false);
assert.equal(routeSource.includes("recordQuoteGenerationFailure"), false);
assert.match(routeSource, /p_canonical_payload_v1/);
assert.match(routeSource, /x-zion-quote-operation-id/);
assert.match(routeSource, /createHash\("sha256"\)/);
assert.match(
  routeSource,
  /resolveSalesQuoteKindForVersion\(\{/,
  "generate-pdf must resolve canonical quote_kind server-side",
);
assert.match(
  routeSource,
  /let replayed = false/,
  "generate-pdf must track replay independently of the final operation outcome",
);
assert.match(
  routeSource,
  /if \(lookup\.outcome === "idempotent_replay"\) \{[\s\S]*?replayed = true;[\s\S]*?replayed,\s*\n\s*\}\);/,
  "a materialized replay found before claiming must return without generation",
);
assert.match(
  routeSource,
  /if \(lookup\.outcome === "idempotent_replay"\) \{[\s\S]*?await reconcileQuoteGenerationSideEffects\([\s\S]*?operationId,[\s\S]*?\}\);/,
  "a materialized lookup replay must repair missing side effects",
);
assert.match(
  routeSource,
  /if \(operation\.outcome === "idempotent_replay"\) \{[\s\S]*?operationMaterialized = true;[\s\S]*?replayed = true;/,
  "a concurrent begin replay must be marked before side-effect reconciliation",
);
assert.match(
  routeSource,
  /await reconcileQuoteGenerationSideEffects\([\s\S]*?versionId: String\(operation\.quote_version_id\)/,
  "materialized operations must reconcile using the canonical version",
);
assert.match(
  routeSource,
  /replayed,[\s\S]*?\}\);/,
  "the response must expose the explicit replay indicator",
);
assert.equal(
  routeSource.indexOf("resolveSalesQuoteKindForVersion({") < routeSource.indexOf("begin_sales_quote_pdf_generation_by_system"),
  true,
  "generate-pdf must resolve quote_kind before claiming the operation",
);
assert.equal(
  routeSource.indexOf("const { data: lookupData") <
    routeSource.indexOf("await ensureQuoteConversationReadyForQuoteEvent"),
  true,
  "conversation readiness must not block a canonical materialized replay",
);

console.log("generate-pdf versioning route contracts passed");
