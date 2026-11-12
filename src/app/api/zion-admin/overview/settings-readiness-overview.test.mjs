import assert from "node:assert/strict";

import { loadStoreSettingsReadiness } from "./settings-readiness-overview.ts";

const organizationId = "org-1";
const storeId = "store-1";
const marker = "2026-10-07T12:00:00.000Z";

function createClient(overrides = {}) {
  const rpcData = {
    read_store_operation_execution_policies_by_system: {
      technical_visit_configured_at: marker,
      installation_configured_at: marker,
      pool_replacement_configured_at: marker,
      delivery_configured_at: marker,
      pickup_configured_at: marker,
      technical_services_configured_at: marker,
    },
    read_store_payment_settings_by_system: {
      accepted_payment_methods: ["pix"],
      down_payment_mode: "none",
      installments_enabled: false,
    },
    read_store_channel_settings_by_system: {
      commercial_channel_name: "WhatsApp Vendas",
      commercial_receives_real_clients: false,
      commercial_is_official_sales_channel: false,
      commercial_channel_type: "whatsapp",
      commercial_entry_priority: "principal",
      commercial_human_handoff_enabled: false,
      integration_provider_name: "Meta",
    },
    read_store_strategy_settings_by_system: {
      service_region_configured_at: marker,
      brands_configuration_configured_at: marker,
      strategy_commercial_experience_configured_at: marker,
      strategy_commercial_strategy_configured_at: marker,
    },
    ...overrides.rpcData,
  };

  return {
    async rpc(name) {
      if (overrides.rpcErrors?.[name]) {
        return { data: null, error: { message: overrides.rpcErrors[name] } };
      }
      return { data: rpcData[name] ?? null, error: null };
    },
    from(table) {
      return {
        select() {
          return {
            eq() {
              return this;
            },
            async maybeSingle() {
              if (overrides.tableErrors?.[table]) {
                return { data: null, error: { message: overrides.tableErrors[table] } };
              }
              return { data: overrides.tables?.[table] ?? null, error: null };
            },
          };
        },
      };
    },
  };
}

const readyTables = {
  store_operation_settings: {
    organization_id: organizationId,
    store_id: storeId,
    offers_installation: false,
    offers_technical_visit: false,
  },
  store_commercial_ai_settings: {
    organization_id: organizationId,
    store_id: storeId,
    price_policy_configured_at: marker,
    complementary_suggestions_configured_at: marker,
    complementary_suggestions_enabled: false,
  },
  store_discount_settings: {
    organization_id: organizationId,
    store_id: storeId,
    default_discount_percent: 0,
    max_discount_percent: 0,
    allow_ask_above_max_discount: false,
    discount_autonomy_mode: "approval_required",
  },
  store_high_value_discount_settings: {
    organization_id: organizationId,
    store_id: storeId,
    enabled: false,
  },
};

const ready = await loadStoreSettingsReadiness({
  supabase: createClient({ tables: readyTables }),
  organizationId,
  storeId,
});

assert.equal(ready.overall, "ready");
assert.deepEqual(ready.families.map((family) => family.family), [
  "operation",
  "payment",
  "discount",
  "channel",
  "commercial_ai",
  "strategy",
]);
assert.equal(ready.counts.ready, 6);

const blocked = await loadStoreSettingsReadiness({
  supabase: createClient({
    tables: { ...readyTables, store_operation_settings: null },
  }),
  organizationId,
  storeId,
});
assert.equal(blocked.families.find((family) => family.family === "operation").state, "blocked");

const isolatedFailure = await loadStoreSettingsReadiness({
  supabase: createClient({
    rpcErrors: { read_store_payment_settings_by_system: "payment unavailable" },
  }),
  organizationId,
  storeId,
});
assert.equal(isolatedFailure.families.find((family) => family.family === "payment").state, "unknown");
assert.notEqual(isolatedFailure.families.find((family) => family.family === "operation").state, "unknown");

const scopeFailure = await loadStoreSettingsReadiness({
  supabase: createClient({
    tables: {
      ...readyTables,
      store_commercial_ai_settings: { ...readyTables.store_commercial_ai_settings, store_id: "other-store" },
    },
  }),
  organizationId,
  storeId,
});
assert.equal(scopeFailure.families.find((family) => family.family === "commercial_ai").state, "unknown");

console.log("zion-admin-settings-readiness-overview: 4 tests passed");
