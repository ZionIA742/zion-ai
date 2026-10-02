import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(__dirname, "QuoteCatalogPrefillPicker.tsx"),
  "utf8",
);

assert.equal(
  source.includes('itemType === "pool_installation"'),
  true,
  "pool mode must have its own catalog branch",
);

assert.equal(
  source.includes('.from("pools")'),
  true,
  "pool mode must read pools",
);

assert.equal(
  source.includes('itemType === "service"'),
  true,
  "service mode must have its own branch",
);

assert.equal(
  source.includes(
    "buildQuoteTechnicalServicePrefillItems",
  ),
  true,
  "service mode must derive options from canonical policy",
);

assert.equal(
  source.includes('.from("store_catalog_items")'),
  true,
  "custom mode must read general catalog items",
);

assert.equal(
  source.includes(
    "price_cents,price_status,currency,is_active,metadata",
  ),
  true,
  "general catalog query must read category metadata",
);

assert.equal(
  source.includes('item.category === "quimicos"'),
  true,
);

assert.equal(
  source.includes('item.category === "acessorios"'),
  true,
);

assert.equal(
  source.includes('item.category === "outros"'),
  true,
);

assert.equal(
  source.includes("catalog_item_id"),
  false,
  "picker must not create catalog lineage",
);

assert.equal(
  source.includes("pool_id"),
  false,
  "picker must not create pool lineage",
);

assert.equal(
  source.includes("profile_component_id"),
  false,
  "picker must not create profile lineage",
);

console.log(
  "ok - quote catalog picker type-aware contract",
);
