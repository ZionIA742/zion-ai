import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(__dirname, "page.tsx"),
  "utf8",
);

assert.equal(
  source.includes(
    '"read_store_operation_execution_policies_scoped"',
  ),
  true,
  "CRM must read the canonical technical services policy",
);

assert.equal(
  source.includes(
    "isQuoteTechnicalServicesPolicyAvailable",
  ),
  true,
);

assert.equal(
  source.includes(
    "disabled={!quoteServiceOptionEnabled}",
  ),
  true,
  "service option must be disabled when unavailable",
);

assert.equal(
  source.includes(
    'nextItemType === "service" &&',
  ),
  true,
  "service selection must fail closed",
);

assert.equal(
  source.includes(
    "itemType={item.itemType}",
  ),
  true,
  "picker must receive the currently selected quote item type",
);

assert.equal(
  source.includes(
    "technicalServicesPolicy={quoteTechnicalServicesPolicy}",
  ),
  true,
  "picker must receive canonical services policy",
);

const applyStart = source.indexOf(
  "function applyCatalogPrefillToQuoteItem(",
);
const applyEnd = source.indexOf(
  "function syncSelectedOpportunityInUrl(",
  applyStart,
);

assert.notEqual(applyStart, -1);
assert.notEqual(applyEnd, -1);

const applySource = source.slice(
  applyStart,
  applyEnd,
);

assert.equal(
  applySource.includes('itemType: "custom"'),
  false,
  "catalog prefill must preserve the selected item type",
);

for (const expected of [
  "name: values.name",
  "description: values.description",
  "unitPriceReais: values.unitPriceReais",
]) {
  assert.equal(
    applySource.includes(expected),
    true,
    `missing prefill behavior: ${expected}`,
  );
}

assert.equal(
  source.includes(
    "quoteHasUnavailableService",
  ),
  true,
  "generation must fail closed for stale unavailable service drafts",
);

console.log(
  "ok - CRM quote type-aware catalog integration contract",
);
