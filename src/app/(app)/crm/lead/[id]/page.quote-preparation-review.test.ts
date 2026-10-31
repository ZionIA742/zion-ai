import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(
  join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx"),
  "utf8",
);

test("automatic quote drafts expose a human PDF preparation action", () => {
  assert.match(source, /prepareDraftQuoteForReview/);
  assert.match(source, /normalizedStatus !== "draft"/);
  assert.match(source, /\/api\/sales-quotes\/\$\{encodeURIComponent\(safeQuoteId\)\}\/generate-pdf/);
  assert.match(source, /result\.quoteId !== safeQuoteId/);
  assert.match(source, /setQuoteActionLoadingType\("generate_pdf"\)/);
  assert.match(source, /await fetchGeneratedQuotes\(\{ silent: true \}\)/);
  assert.match(source, /quotePdfPreparationUncertainId/);
  assert.match(source, /PDF preparado e aguardando revisao humana/);
});

test("drafts are not sent or approved by the preparation action", () => {
  const actionSource = source.slice(
    source.indexOf("async function prepareDraftQuoteForReview"),
    source.indexOf("async function createContractFromQuote"),
  );

  assert.equal(actionSource.includes("/approve"), false);
  assert.equal(actionSource.includes("/send"), false);
  assert.equal(actionSource.includes("window.open"), false);
});
