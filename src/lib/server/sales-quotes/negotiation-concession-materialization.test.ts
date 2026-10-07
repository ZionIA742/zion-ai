import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  distributeAuthorizedDiscount,
  resolveAuthorizedDiscount,
} from "./negotiation-concession-materialization";

const items = [
  {
    id: "item-1", quote_id: "quote-1", organization_id: "org-1", store_id: "store-1",
    name: "Pool", description: null, quantity: 1, unit_price_cents: 10000,
    discount_cents: 500, subtotal_cents: 10000, total_cents: 9500, sort_order: 1,
    profile_component_id: null, pool_id: null, catalog_item_id: null, item_type: null,
    sku: null, metadata: null, created_at: null, updated_at: null,
  },
  {
    id: "item-2", quote_id: "quote-1", organization_id: "org-1", store_id: "store-1",
    name: "Install", description: null, quantity: 1, unit_price_cents: 5000,
    discount_cents: 0, subtotal_cents: 5000, total_cents: 5000, sort_order: 2,
    profile_component_id: null, pool_id: null, catalog_item_id: null, item_type: null,
    sku: null, metadata: null, created_at: null, updated_at: null,
  },
];

const result = distributeAuthorizedDiscount({ items, discountCents: 1200 });
assert.equal(result[0].discount_cents, 1700);
assert.equal(result[0].total_cents, 8300);
assert.equal(result[1].discount_cents, 0);
assert.throws(
  () => distributeAuthorizedDiscount({ items, discountCents: 15001 }),
  /EXCEEDS_QUOTE/,
);
assert.deepEqual(
  resolveAuthorizedDiscount({
    baseTotalCents: 100000,
    previousPriceCents: 100000,
    proposedPriceCents: 90000,
    requestedDiscountCents: 10000,
  }),
  { deltaCents: 10000, targetTotalCents: 90000 },
);
assert.deepEqual(
  resolveAuthorizedDiscount({
    baseTotalCents: 90000,
    previousPriceCents: 90000,
    proposedPriceCents: 85000,
    requestedDiscountCents: 5000,
  }),
  { deltaCents: 5000, targetTotalCents: 85000 },
);
assert.throws(
  () => resolveAuthorizedDiscount({ baseTotalCents: 100000, previousPriceCents: 100000, proposedPriceCents: 90000, requestedDiscountCents: 9001 }),
  /TRANSITION_INVALID/,
);
assert.throws(
  () => resolveAuthorizedDiscount({ baseTotalCents: 100000, previousPriceCents: 100000, proposedPriceCents: 100000, requestedDiscountCents: 0 }),
  /TRANSITION_INVALID/,
);
assert.throws(
  () => distributeAuthorizedDiscount({ items, discountCents: 1.5 }),
  /DISCOUNT_INVALID/,
);

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261006190000_p9_8_5_negotiation_concession_materialization.sql"),
  "utf8",
);
const implementation = readFileSync(
  join(process.cwd(), "src/lib/server/sales-quotes/negotiation-concession-materialization.ts"),
  "utf8",
);
assert.match(migration, /reserved_concession_number integer/);
assert.match(migration, /state='superseded'/);
assert.match(migration, /reserved_concession_number=null/);
assert.match(migration, /state='materialized'/);
assert.match(migration, /materialize_sales_quote_send_by_system/);
assert.doesNotMatch(migration, /insert[^;]+approved_by\s*=/is);
assert.match(migration, /v_previous_price/);
assert.doesNotMatch(migration, /discount_semantics/);
assert.match(implementation, /materialize_commercial_negotiation_concession_target_quote_by_system/);
assert.doesNotMatch(implementation, /\.insert\(itemPayload\)/);
assert.doesNotMatch(implementation, /whatsapp-external-sender/);

console.log("negotiation-concession-materialization: PASS");
