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
  notes: "Observacao da loja",
};

assert.equal(normalizeStoreContractUsagePolicy(complete).state, "enabled");
assert.deepEqual(normalizeStoreContractUsagePolicy(complete).formats, ["digital", "fisico"]);
assert.deepEqual(normalizeStoreContractUsagePolicy(complete).signedBefore, ["agendar_instalacao"]);
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
