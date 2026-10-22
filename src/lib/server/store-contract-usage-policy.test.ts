import { strict as assert } from "node:assert";
import {
  normalizeStoreContractUsagePolicy,
  readStoreContractUsagePolicyBySystem,
} from "./store-contract-usage-policy";

const complete = {
  enabled: "Sim",
  applicability_mode: "depende",
  applicability_cases: ["instalacao", "alto_valor"],
  high_value_amount: "50000",
  formats: ["digital", "fisico"],
  signed_before: ["agendar_instalacao"],
  buyer_data_fields_configured: true,
  buyer_data_fields: ["full_name", "cpf", "other"],
  buyer_data_other: "Número do cadastro municipal",
  notes: "Observacao da loja",
};

assert.equal(normalizeStoreContractUsagePolicy(complete).state, "enabled");
assert.deepEqual(normalizeStoreContractUsagePolicy(complete).formats, ["digital", "fisico"]);
assert.deepEqual(normalizeStoreContractUsagePolicy(complete).signedBefore, ["agendar_instalacao"]);
assert.equal(normalizeStoreContractUsagePolicy(complete).buyerDataFieldsConfigured, true);
assert.deepEqual(normalizeStoreContractUsagePolicy(complete).buyerDataFields, ["full_name", "cpf", "other"]);
assert.equal(normalizeStoreContractUsagePolicy(complete).buyerDataOther, "Número do cadastro municipal");
assert.equal(normalizeStoreContractUsagePolicy({ ...complete, buyer_data_fields_configured: true, buyer_data_fields: [] }).buyerDataFieldsConfigured, true);
assert.deepEqual(normalizeStoreContractUsagePolicy({ ...complete, buyer_data_fields_configured: true, buyer_data_fields: [] }).buyerDataFields, []);
assert.equal(normalizeStoreContractUsagePolicy({ ...complete, buyer_data_fields: ["other"], buyer_data_other: "x".repeat(600) }).state, "incomplete");
assert.equal(normalizeStoreContractUsagePolicy({ ...complete, buyer_data_fields: ["cpf"], buyer_data_other: "" }).buyerDataOther, null);
assert.equal(normalizeStoreContractUsagePolicy({ ...complete, buyer_data_fields_configured: true, buyer_data_fields: ["invalid"] }).state, "incomplete");
assert.equal(normalizeStoreContractUsagePolicy({ ...complete, buyer_data_fields_configured: true, buyer_data_fields: ["other"], buyer_data_other: "" }).state, "incomplete");
assert.equal(normalizeStoreContractUsagePolicy({ ...complete, buyer_data_fields_configured: undefined, buyer_data_fields: undefined, buyer_data_other: undefined }).buyerDataFieldsConfigured, false);
assert.deepEqual(normalizeStoreContractUsagePolicy({ ...complete, buyer_data_fields_configured: undefined, buyer_data_fields: undefined, buyer_data_other: undefined }).buyerDataFields, []);
assert.equal(normalizeStoreContractUsagePolicy({ enabled: "Nao" }).state, "disabled");
assert.equal(normalizeStoreContractUsagePolicy({ enabled: "Sim" }).state, "incomplete");
assert.equal(normalizeStoreContractUsagePolicy({ enabled: "Sim", applicability_mode: "sempre", formats: ["digital"], signed_before: ["outro"] }).state, "incomplete");
assert.equal(normalizeStoreContractUsagePolicy(null).state, "unconfigured");

const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
const result = await readStoreContractUsagePolicyBySystem({
  supabase: {
    async rpc(name, params) {
      calls.push({ name, params });
      return { data: { contract_usage_policy: complete }, error: null };
    },
  },
  organizationId: "org-1",
  storeId: "store-1",
});

assert.equal(result.ok, true);
assert.deepEqual(calls, [{
  name: "read_store_settings_experience_policies_scoped",
  params: { p_organization_id: "org-1", p_store_id: "store-1" },
}]);
console.log("store-contract-usage-policy: PASS");
