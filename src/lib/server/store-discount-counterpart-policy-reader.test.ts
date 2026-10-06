import assert from "node:assert/strict";
import test from "node:test";
import { readStoreDiscountCounterpartPolicyBySystem } from "./store-discount-counterpart-policy-reader";

test("counterpart reader treats absence as no authority and rejects scope mismatch", async () => {
  const absent = await readStoreDiscountCounterpartPolicyBySystem({
    supabase: { rpc: async () => ({ data: [], error: null }) },
    organizationId: "org",
    storeId: "store",
  });
  assert.deepEqual(absent, { ok: true, policy: null });
  const mismatch = await readStoreDiscountCounterpartPolicyBySystem({
    supabase: { rpc: async () => ({ data: [{ organization_id: "other", store_id: "store", enabled: false }], error: null }) },
    organizationId: "org",
    storeId: "store",
  });
  assert.equal(mismatch.ok, false);
});

test("counterpart reader rejects multiple rows, store mismatch and invalid rows", async () => {
  const row = { organization_id: "org", store_id: "store", enabled: false };
  const multiple = await readStoreDiscountCounterpartPolicyBySystem({ supabase: { rpc: async () => ({ data: [row, row], error: null }) }, organizationId: "org", storeId: "store" });
  assert.equal(multiple.ok, false);
  const storeMismatch = await readStoreDiscountCounterpartPolicyBySystem({ supabase: { rpc: async () => ({ data: [{ ...row, store_id: "other" }], error: null }) }, organizationId: "org", storeId: "store" });
  assert.equal(storeMismatch.ok, false);
  const invalid = await readStoreDiscountCounterpartPolicyBySystem({ supabase: { rpc: async () => ({ data: [{ ...row, enabled: true, higher_down_payment_enabled: true, higher_down_payment_minimum_type: "percent" }], error: null }) }, organizationId: "org", storeId: "store" });
  assert.equal(invalid.ok, false);
});
