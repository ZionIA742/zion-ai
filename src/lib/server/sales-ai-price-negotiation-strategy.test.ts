import assert from "node:assert/strict";
import test from "node:test";

import {
  decideSalesAiPriceNegotiation,
  type PriceNegotiationStrategyInput,
} from "./sales-ai-price-negotiation-strategy";

const settings = {
  organization_id: "org-1",
  store_id: "store-1",
  default_discount_percent: 5,
  max_discount_percent: 10,
  allow_ask_above_max_discount: false,
  discount_autonomy_mode: "default_step_autonomous",
  discount_special_rules: null,
};

const base: PriceNegotiationStrategyInput = {
  productIdentified: true,
  projectIdentified: true,
  reliablePriceCents: 100_000,
  messageKind: "price_objection",
  materialPriceObjection: true,
  closeConditionedOnImprovedPrice: false,
  paymentContext: "none",
  priorConcessionState: "none",
  discountSettings: settings,
  highValueDiscountSettings: null,
};

test("10 core 8.3 strategy scenarios", () => {
  assert.equal(decideSalesAiPriceNegotiation({ ...base, messageKind: "price_question" }).kind, "full_price");
  assert.equal(decideSalesAiPriceNegotiation({ ...base, productIdentified: false }).kind, "qualify_before_discount");
  assert.equal(decideSalesAiPriceNegotiation({ ...base, materialPriceObjection: false }).kind, "full_price");
  assert.equal(decideSalesAiPriceNegotiation({ ...base, priorConcessionState: "unknown", closeConditionedOnImprovedPrice: true }).kind, "requires_human_or_special_policy");
  assert.equal(decideSalesAiPriceNegotiation({ ...base, priorConcessionState: "present" }).kind, "requires_human_or_special_policy");
  assert.equal(decideSalesAiPriceNegotiation({ ...base, discountSettings: null }).kind, "requires_human_or_special_policy");
  assert.equal(decideSalesAiPriceNegotiation({ ...base, messageKind: "counteroffer" }).kind, "requires_human_or_special_policy");
  assert.equal(decideSalesAiPriceNegotiation({ ...base, discountSettings: { ...settings, discount_autonomy_mode: "approval_required" } }).kind, "defend_value");
  assert.equal(decideSalesAiPriceNegotiation({ ...base, highValueDiscountSettings: { organization_id: "org-1", store_id: "store-1", enabled: true, threshold_amount_cents: 50_000, discount_percent: 5 } }).kind, "requires_human_or_special_policy");
  const candidate = decideSalesAiPriceNegotiation({
    ...base,
    closeConditionedOnImprovedPrice: true,
  });
  assert.equal(candidate.kind, "first_concession_candidate");
  assert.equal(candidate.shouldStartFirstConcession, true);
});

test("a price objection alone defends value and does not start a concession", () => {
  const result = decideSalesAiPriceNegotiation({
    ...base,
    messageKind: "price_objection",
    materialPriceObjection: true,
    closeConditionedOnImprovedPrice: false,
  });
  assert.equal(result.kind, "defend_value");
  assert.equal(result.shouldStartFirstConcession, false);
});

test("a conditioned close may start only the first concession candidate", () => {
  const result = decideSalesAiPriceNegotiation({
    ...base,
    messageKind: "conditioned_close",
    closeConditionedOnImprovedPrice: true,
  });
  assert.equal(result.kind, "first_concession_candidate");
  assert.equal(result.shouldStartFirstConcession, true);
});

test("generic discount without context qualifies before discount", () => {
  const result = decideSalesAiPriceNegotiation({
    ...base,
    productIdentified: false,
    projectIdentified: false,
    messageKind: "discount_question",
  });
  assert.equal(result.kind, "qualify_before_discount");
});
