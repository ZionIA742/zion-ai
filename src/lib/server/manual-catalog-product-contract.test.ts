import { strict as assert } from "node:assert";
import {
  buildManualCatalogIdempotencyKey,
  buildManualCatalogPayloadFingerprint,
  normalizeManualCatalogOperationId,
  parseManualCatalogSourceKind,
} from "./manual-catalog-product-contract";

const operationId = "550e8400-e29b-41d4-a716-446655440000";

assert.equal(normalizeManualCatalogOperationId(operationId.toUpperCase()), operationId);
assert.equal(normalizeManualCatalogOperationId("not-a-uuid"), null);
assert.equal(parseManualCatalogSourceKind("pool"), "pool");
assert.equal(parseManualCatalogSourceKind("catalog_item"), "catalog_item");
assert.equal(parseManualCatalogSourceKind("photo"), null);
assert.equal(
  buildManualCatalogIdempotencyKey(operationId),
  `crm_manual_catalog_photo:${operationId}`,
);

const input = {
  organizationId: "org-1",
  storeId: "store-1",
  conversationId: "conversation-1",
  leadId: "lead-1",
  actorUserId: "user-1",
  sourceKind: "pool" as const,
  sourceId: "pool-1",
  content: "Piscina premium",
  sendExternal: true,
};
assert.equal(buildManualCatalogPayloadFingerprint(input), buildManualCatalogPayloadFingerprint(input));
assert.notEqual(
  buildManualCatalogPayloadFingerprint(input),
  buildManualCatalogPayloadFingerprint({ ...input, sendExternal: false }),
);
console.log("manual-catalog-product-contract: PASS");
