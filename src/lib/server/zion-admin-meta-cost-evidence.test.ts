import test from "node:test";
import assert from "node:assert/strict";

import {
  summarizeMetaCostEvidence,
  type MetaCostEvidenceRow,
} from "./zion-admin-meta-cost-evidence";

function row(
  id: string,
  pricing: unknown,
  store = "store-a",
): MetaCostEvidenceRow {
  return {
    id,
    store_id: store,
    delivered_at: "2026-10-30T12:00:00Z",
    metadata: { whatsapp_pricing: pricing },
  };
}

test("classifies delivered billable pricing evidence", () => {
  const result = summarizeMetaCostEvidence([
    row("1", {
      billable: true,
      pricing_model: "PMP",
      type: "regular",
      category: "marketing",
    }),
  ]);

  assert.equal(result.delivered, 1);
  assert.equal(result.billableEvidence, 1);
  assert.equal(result.categories.marketing, 1);
});

test("explicit nonbillable evidence is classified as free", () => {
  const result = summarizeMetaCostEvidence([
    row("1", { billable: false, category: "utility" }),
  ]);

  assert.equal(result.freeEvidence, 1);
  assert.equal(result.billableEvidence, 0);
});

test("missing pricing is unknown rather than free", () => {
  const result = summarizeMetaCostEvidence([
    row("1", null),
  ]);

  assert.equal(result.unknownPricing, 1);
  assert.equal(result.freeEvidence, 0);
});

test("missing billable marker is unknown", () => {
  const result = summarizeMetaCostEvidence([
    row("1", { category: "marketing" }),
  ]);

  assert.equal(result.unknownPricing, 1);
});

test("repeated message ID is counted only once", () => {
  const pricing = { billable: true, category: "utility" };
  const result = summarizeMetaCostEvidence([
    row("1", pricing),
    row("1", pricing),
  ]);

  assert.equal(result.delivered, 1);
  assert.equal(result.billableEvidence, 1);
});

test("messages without delivery are excluded", () => {
  const message = row("1", {
    billable: true,
    category: "marketing",
  });

  message.delivered_at = null;

  const result = summarizeMetaCostEvidence([message]);

  assert.equal(result.delivered, 0);
});

test("isolates evidence by store", () => {
  const result = summarizeMetaCostEvidence([
    row("1", { billable: true, category: "marketing" }, "a"),
    row("2", { billable: false }, "b"),
    row("3", null, "a"),
  ]);

  assert.equal(result.stores.a.delivered, 2);
  assert.equal(result.stores.a.billableEvidence, 1);
  assert.equal(result.stores.a.unknownPricing, 1);
  assert.equal(result.stores.b.freeEvidence, 1);
});

test("unknown billable category is not invented", () => {
  const result = summarizeMetaCostEvidence([
    row("1", { billable: true, category: "custom" }),
  ]);

  assert.equal(result.categories.unclassified, 1);
});

test("malformed metadata does not cause a failure", () => {
  const result = summarizeMetaCostEvidence([
    { ...row("1", null), metadata: "invalid" },
  ]);

  assert.equal(result.unknownPricing, 1);
});

test("never invents USD or BRL charges", () => {
  const result = summarizeMetaCostEvidence([
    row("1", { billable: true, category: "marketing" }),
  ]);

  assert.equal(result.usd, null);
  assert.equal(result.brl, null);
  assert.equal(result.amountStatus, "not_verified");
});