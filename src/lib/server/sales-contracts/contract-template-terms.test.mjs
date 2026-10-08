import assert from "node:assert/strict";
import { resolveContractTemplateTerms } from "./contract-template-terms.ts";

function createClient(overrides = {}) {
  const rows = {
    template: overrides.template === null
      ? null
      : {
      id: "template-1",
      organization_id: "org-1",
      store_id: "store-1",
      status: "active",
      active_version_id: "version-1",
      ...overrides.template,
    },
    version: {
      id: "version-1",
      template_id: "template-1",
      organization_id: "org-1",
      store_id: "store-1",
      version_number: 2,
      status: "active",
      ...overrides.version,
    },
    rules: [{
      id: "rule-1",
      template_version_id: "version-1",
      organization_id: "org-1",
      store_id: "store-1",
      rule_key: "pagamento",
      rule_group: "pagamento",
      label: "Pagamento",
      value_text: "Texto contratual autorizado.",
      review_status: "approved",
      sort_order: 1,
    }],
  };

  return {
    from(table) {
      const data = table === "store_contract_templates"
        ? rows.template
        : table === "store_contract_template_versions"
          ? rows.version
          : rows.rules;
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        in() { return builder; },
        order() { return builder; },
        maybeSingle: async () => ({ data, error: null }),
        then(resolve, reject) {
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const tests = [
  {
    name: "active same-store template and version are authorized",
    async run() {
      const result = await resolveContractTemplateTerms({
        supabase: createClient(),
        organizationId: "org-1",
        storeId: "store-1",
      });
      assert.equal(result.contractTemplateUsed, true);
      assert.equal(result.templateVersionId, "version-1");
    },
  },
  {
    name: "missing template blocks authority",
    async run() {
      const result = await resolveContractTemplateTerms({
        supabase: createClient({ template: null }),
        organizationId: "org-1",
        storeId: "store-1",
      });
      assert.equal(result.contractTemplateUsed, false);
      assert.equal(result.generatedContractTerms, null);
    },
  },
  {
    name: "cross-store template cannot authorize generation",
    async run() {
      const result = await resolveContractTemplateTerms({
        supabase: createClient({ template: { store_id: "store-other" } }),
        organizationId: "org-1",
        storeId: "store-1",
      });
      assert.equal(result.contractTemplateUsed, false);
    },
  },
  {
    name: "cross-organization active version cannot authorize generation",
    async run() {
      const result = await resolveContractTemplateTerms({
        supabase: createClient({ version: { organization_id: "org-other" } }),
        organizationId: "org-1",
        storeId: "store-1",
      });
      assert.equal(result.contractTemplateUsed, false);
      assert.equal(result.generatedContractTerms, null);
    },
  },
];

const failures = [];
for (const test of tests) {
  try {
    await test.run();
    process.stdout.write(`ok - ${test.name}\n`);
  } catch (error) {
    failures.push(`not ok - ${test.name}\n${error?.stack || error}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
