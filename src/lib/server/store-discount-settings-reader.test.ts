import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  readStoreDiscountSettingsBySystem,
  type StoreDiscountSettingsReaderClient,
} from "./store-discount-settings-reader.js";

const POLICY = {
  organization_id: "org-1",
  store_id: "store-1",
  default_discount_percent: 5,
  max_discount_percent: 10,
  allow_ask_above_max_discount: true,
  discount_autonomy_mode: "within_policy_autonomous",
  discount_special_rules: "context only",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

function createClient(args: {
  row: typeof POLICY | null;
  error?: { message: string } | null;
  calls: Array<{ table: string; columns: string; filters: Record<string, unknown> }>;
}): StoreDiscountSettingsReaderClient {
  return {
    from(table) {
      const filters: Record<string, unknown> = {};
      const query = {
        select(columns: string) {
          args.calls.push({ table, columns, filters });
          return query;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return query;
        },
        async maybeSingle() {
          const matches =
            args.row &&
            args.row.organization_id === filters.organization_id &&
            args.row.store_id === filters.store_id;
          return {
            data: matches ? args.row : null,
            error: args.error ?? null,
          };
        },
      };
      return query;
    },
  } as StoreDiscountSettingsReaderClient;
}

test("reads only the policy scoped to the requested organization and store", async () => {
  const calls: Array<{ table: string; columns: string; filters: Record<string, unknown> }> = [];
  const result = await readStoreDiscountSettingsBySystem({
    supabase: createClient({ row: POLICY, calls }),
    organizationId: "org-1",
    storeId: "store-1",
  });

  assert.deepEqual(result.data, POLICY);
  assert.equal(result.error, null);
  assert.deepEqual(calls, [
    {
      table: "store_discount_settings",
      columns:
        "organization_id, store_id, default_discount_percent, max_discount_percent, allow_ask_above_max_discount, discount_autonomy_mode, discount_special_rules, created_at, updated_at",
      filters: { organization_id: "org-1", store_id: "store-1" },
    },
  ]);
});

test("does not use a policy from another store or organization", async () => {
  for (const scope of [
    { organizationId: "org-1", storeId: "store-2" },
    { organizationId: "org-2", storeId: "store-1" },
  ]) {
    const calls: Array<{ table: string; columns: string; filters: Record<string, unknown> }> = [];
    const result = await readStoreDiscountSettingsBySystem({
      supabase: createClient({ row: POLICY, calls }),
      ...scope,
    });

    assert.equal(result.data, null);
    assert.equal(result.error, null);
  }
});

test("preserves absent rows and reader errors", async () => {
  const calls: Array<{ table: string; columns: string; filters: Record<string, unknown> }> = [];
  const absent = await readStoreDiscountSettingsBySystem({
    supabase: createClient({ row: null, calls }),
    organizationId: "org-1",
    storeId: "store-1",
  });
  assert.equal(absent.data, null);
  assert.equal(absent.error, null);

  const error = await readStoreDiscountSettingsBySystem({
    supabase: createClient({
      row: null,
      error: { message: "settings read failed" },
      calls,
    }),
    organizationId: "org-1",
    storeId: "store-1",
  });
  assert.equal(error.data, null);
  assert.deepEqual(error.error, { message: "settings read failed" });
});

test("generate-ai-sales-reply consumes the extracted reader", () => {
  const source = readFileSync(
    "src/lib/server/generate-ai-sales-reply.ts",
    "utf8",
  );
  assert.equal(source.includes("readStoreDiscountSettingsBySystem"), true);
  assert.equal(source.includes('.from("store_discount_settings")'), false);
});
