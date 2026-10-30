import test from "node:test";
import assert from "node:assert/strict";
import { summarizeMetaPricingAnalytics } from "./zion-admin-meta-pricing";

const response = (points: unknown[], currency: unknown = "USD") => ({
  id: "1234567890", currency, pricing_analytics: { data: [{ data_points: points }] },
});
const point = (volume = 2, cost: unknown = 0.25) => ({
  pricing_category: "MARKETING", pricing_type: "REGULAR", volume, cost,
});

test("sums costs and volume in explicit WABA currency", () => {
  const result = summarizeMetaPricingAnalytics(response([point(), point(3, 0.75)]), "1234567890");
  assert.equal(result.totalVolume, 5);
  assert.equal(result.approximateCost, 1);
  assert.equal(result.currency, "USD");
  assert.equal(result.amountStatus, "approximate");
  assert.equal(result.invoiceConfirmed, false);
});

test("does not invent money if Meta omits COST", () => {
  const result = summarizeMetaPricingAnalytics(response([{ ...point(9), cost: undefined }]), "1234567890");
  assert.equal(result.totalVolume, 9);
  assert.equal(result.approximateCost, null);
  assert.equal(result.amountStatus, "cost_unavailable");
});

test("does not mistake missing currency for USD", () => {
  const result = summarizeMetaPricingAnalytics(response([point()], null), "1234567890");
  assert.equal(result.approximateCost, null);
  assert.equal(result.points[0].approximateCost, null);
  assert.equal(result.amountStatus, "currency_unavailable");
});

test("treats empty result as unavailable rather than zero bill", () => {
  const result = summarizeMetaPricingAnalytics(response([]), "1234567890");
  assert.equal(result.totalVolume, 0);
  assert.equal(result.approximateCost, null);
  assert.equal(result.amountStatus, "no_data");
});

test("accepts explicit zero cost for free messages", () => {
  const result = summarizeMetaPricingAnalytics(response([point(3, 0)]), "1234567890");
  assert.equal(result.approximateCost, 0);
  assert.equal(result.amountStatus, "approximate");
});

test("does not blend known cost with missing cost", () => {
  const result = summarizeMetaPricingAnalytics(response([point(), point(10, null)]), "1234567890");
  assert.equal(result.approximateCost, null);
});

test("blocks data from a different WABA", () => {
  assert.throws(() => summarizeMetaPricingAnalytics(response([point()]), "other"));
});

test("blocks malformed payload rather than returning zero", () => {
  assert.throws(() => summarizeMetaPricingAnalytics({ id: "1234567890" }, "1234567890"));
});

test("blocks negative or fractional volume", () => {
  assert.throws(() => summarizeMetaPricingAnalytics(response([point(-1)]), "1234567890"));
  assert.throws(() => summarizeMetaPricingAnalytics(response([point(1.5)]), "1234567890"));
});