import assert from "node:assert/strict";
import test from "node:test";

import { readStoreDiscountSettingsBySystem } from "./store-discount-settings-reader";

function client(
  rows: Record<string, unknown>,
  errors: Record<string, { message: string } | null> = {},
  calls: Array<{ table: string; column: string; value: string }> = [],
) {
  return {
    from(table: string) {
      const query = {
        eq(column: string, value: string) {
          calls.push({ table, column, value });
          return query;
        },
        maybeSingle() {
          return Promise.resolve({ data: rows[table] ?? null, error: errors[table] ?? null });
        },
      };
      return {
        select() {
          return query;
        },
      };
    },
  };
}

test("reader scopes both canonical discount tables and normalizes valid settings", async () => {
  const calls: Array<{ table: string; column: string; value: string }> = [];
  const result = await readStoreDiscountSettingsBySystem({
    supabase: client({
      store_discount_settings: {
        organization_id: "org-1",
        store_id: "store-1",
        default_discount_percent: 5,
        max_discount_percent: 10,
        allow_ask_above_max_discount: false,
        discount_autonomy_mode: "default_step_autonomous",
      },
      store_high_value_discount_settings: {
        organization_id: "org-1",
        store_id: "store-1",
        enabled: false,
        threshold_amount_cents: null,
        discount_percent: null,
      },
    }, {}, calls),
    organizationId: "org-1",
    storeId: "store-1",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column)),
    [
      { table: "store_discount_settings", column: "organization_id", value: "org-1" },
      { table: "store_discount_settings", column: "store_id", value: "store-1" },
      { table: "store_high_value_discount_settings", column: "organization_id", value: "org-1" },
      { table: "store_high_value_discount_settings", column: "store_id", value: "store-1" },
    ].sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column)),
  );
  if (result.ok) assert.equal(result.normalized?.defaultDiscountPercent, 5);
});

test("invalid settings remain present but normalized as unavailable", async () => {
  const result = await readStoreDiscountSettingsBySystem({
    supabase: client({
      store_discount_settings: {
        organization_id: "org-1",
        store_id: "store-1",
        default_discount_percent: 20,
        max_discount_percent: 10,
        allow_ask_above_max_discount: false,
        discount_autonomy_mode: "default_step_autonomous",
      },
    }),
    organizationId: "org-1",
    storeId: "store-1",
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.normalized, null);
});

test("reader fails closed on query error", async () => {
  const result = await readStoreDiscountSettingsBySystem({
    supabase: client({}, { store_discount_settings: { message: "query failed" } }),
    organizationId: "org-1",
    storeId: "store-1",
  });
  assert.deepEqual(result, { ok: false, error: "query failed" });
});
