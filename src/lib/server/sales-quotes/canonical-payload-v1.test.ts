import { strict as assert } from "node:assert";
import { canonicalizePayloadV1, sha256CanonicalPayloadV1 } from "./canonical-payload-v1";

const base = {
  protocol: "zion-sales-quote-pdf-v1",
  organizationId: "00000000-0000-4000-8000-000000000001",
  storeId: "00000000-0000-4000-8000-000000000002",
  quoteId: "00000000-0000-4000-8000-000000000003",
  quoteKind: null,
  snapshot: {
    z: "último",
    nested: { b: 2, a: "á" },
    items: [{ quantity: 1, name: "Piscina" }],
  },
};

const first = sha256CanonicalPayloadV1(base);
const second = sha256CanonicalPayloadV1({
  snapshot: { items: [{ name: "Piscina", quantity: 1 }], nested: { a: "á", b: 2 }, z: "último" },
  quoteId: base.quoteId,
  quoteKind: null,
  storeId: base.storeId,
  organizationId: base.organizationId,
  protocol: base.protocol,
});

assert.equal(first.canonicalPayload, second.canonicalPayload);
assert.equal(first.fingerprint, second.fingerprint);
assert.match(first.canonicalPayload, /último/);
assert.notEqual(first.fingerprint, sha256CanonicalPayloadV1({ ...base, snapshot: { ...base.snapshot, z: "outro" } }).fingerprint);
assert.throws(() => canonicalizePayloadV1(Number.NaN), /nao aceita numero nao finito/);
assert.throws(() => canonicalizePayloadV1(new Date() as never), /nao aceita objeto nao simples/);

console.log("canonical payload v1 tests passed");
