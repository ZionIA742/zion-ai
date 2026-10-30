import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMetaStoreOptions,
  formatMetaPricingDisplay,
  readMetaEvidenceForStore,
} from "./zion-admin-meta-cost-presentation";

const storeId = "54fb81f4-92e5-463a-af6c-fc1544ea4b04";
const integration = {
  store_id: storeId,
  whatsapp_business_account_id: "1234567890",
  display_phone_number: "+55 (11) 99999-1234",
  access_token: "secret-must-never-appear",
};

test("lists eligible stores with masked identifying metadata only", () => {
  const options = buildMetaStoreOptions([integration]);
  assert.equal(options.length, 1);
  assert.equal(options[0].status, "ready");
  assert.match(options[0].label, /1234/);
  assert.doesNotMatch(JSON.stringify(options), /secret|1234567890|99999/);
});

test("marks duplicate store integrations as ambiguous", () => {
  assert.equal(buildMetaStoreOptions([integration, integration])[0].status, "ambiguous");
});

test("does not offer pricing for incomplete credentials", () => {
  assert.equal(buildMetaStoreOptions([{ ...integration, access_token: null }])[0].status, "incomplete");
});

test("formats approximate cost in actual WABA currency", () => {
  const result = formatMetaPricingDisplay({ ok: true, amountStatus: "approximate", approximateCost: 3.25, currency: "BRL", totalVolume: 8 });
  assert.equal(result.state, "approximate");
  assert.match(result.monetary, /R\$/);
  assert.equal(result.volume, "8");
});

test("allows zero only for explicitly priced zero charge", () => {
  const result = formatMetaPricingDisplay({ ok: true, amountStatus: "approximate", approximateCost: 0, currency: "USD", totalVolume: 3 });
  assert.equal(result.state, "approximate");
  assert.match(result.monetary, /0/);
});

test("provider HTTP 200 without analytics never becomes zero billing", () => {
  const result = formatMetaPricingDisplay({ ok: false, code: "META_PRICING_INVALID_RESPONSE" });
  assert.equal(result.state, "unavailable");
  assert.equal(result.monetary, "Dados financeiros indisponíveis");
});

test("no data is not a confirmed zero charge", () => {
  const result = formatMetaPricingDisplay({ ok: true, amountStatus: "no_data", approximateCost: null, totalVolume: 0 });
  assert.equal(result.state, "no_data");
  assert.notEqual(result.monetary, "R$ 0,00");
});

test("unknown currency and incomplete cost remain unavailable", () => {
  const result = formatMetaPricingDisplay({ ok: true, amountStatus: "cost_unavailable", approximateCost: null, currency: "USD", totalVolume: 7 });
  assert.equal(result.state, "unavailable");
  assert.equal(result.volume, "7");
});

test("evidence counts are scoped to the selected store", () => {
  const result = readMetaEvidenceForStore({ ok: true, stores: {
    [storeId]: { delivered: 2, billableEvidence: 1, freeEvidence: 0, unknownPricing: 1 },
    other: { delivered: 20, billableEvidence: 10, freeEvidence: 5, unknownPricing: 5 },
  } }, storeId);
  assert.deepEqual(result, { delivered: 2, billableEvidence: 1, freeEvidence: 0, unknownPricing: 1 });
});

test("missing evidence store means zero local records, not zero Meta billing", () => {
  const result = readMetaEvidenceForStore({ ok: true, stores: {} }, storeId);
  assert.equal(result?.delivered, 0);
  assert.equal(readMetaEvidenceForStore({ ok: false }, storeId), null);
});
