import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  StoreContractTemplateAccessError,
  extractStoreContractTemplateRules,
  extractStoreContractTemplateRulesForAuthorizedStoreScope,
} from "@/lib/server/store-contract-templates/template-management";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreContractTemplateExtractRulesPostHandler } from "./route";

function granted(): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as StoreApiAccessGranted["supabase"],
    resolution: {} as StoreApiAccessGranted["resolution"],
    sessionUserId: "canonical-user",
    organizationId: "org-1",
    storeId: "store-1",
  };
}

function denied(): StoreApiAccessDenied {
  return {
    ok: false,
    resolution: {} as StoreApiAccessDenied["resolution"],
    httpStatus: 401,
    payload: {
      ok: false,
      error: "STORE_API_UNAUTHENTICATED",
      message: "Faca login para acessar esta API da loja.",
      status: "anonymous",
      reasonCode: "anonymous",
    },
  };
}

function request(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

function context(versionId = "version-1") {
  return { params: Promise.resolve({ versionId }) };
}

function result() {
  return {
    store: { id: "store-1", organization_id: "org-1", name: "Loja" },
    template: { id: "template-1" },
    activeVersion: null,
    versions: [{ id: "version-1", status: "awaiting_review" }],
    extractedRules: [],
    extractedRuleCount: 0,
  };
}

type ExtractionHarnessOptions = {
  rpcError?: string;
  rpcResult?: number;
};

function extractionHarness(options: ExtractionHarnessOptions = {}) {
  const version = {
    id: "version-1",
    template_id: "template-1",
    organization_id: "org-1",
    store_id: "store-1",
    version_number: 1,
    status: "awaiting_review",
    store_file_id: "file-1",
    storage_bucket: "contracts",
    storage_path: "org-1/store-1/file-1.pdf",
    original_filename: "contrato.pdf",
    mime_type: "application/pdf",
    size_bytes: 128,
    raw_extracted_text: "A garantia contratual sera de doze meses.",
    analysis_summary: "Resumo canonico",
    approved_at: null,
    approved_by: null,
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    metadata: {},
    created_at: "2026-10-09T12:00:00.000Z",
    updated_at: "2026-10-09T12:00:00.000Z",
  };
  const template = {
    id: "template-1",
    organization_id: "org-1",
    store_id: "store-1",
    status: "active",
    active_version_id: "version-1",
    created_at: "2026-10-09T12:00:00.000Z",
    updated_at: "2026-10-09T12:00:00.000Z",
  };
  const store = { id: "store-1", organization_id: "org-1", name: "Loja" };
  let rules: Array<Record<string, unknown>> = [];
  let successfulWrites = 0;
  const rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const queries: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];

  const supabase = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      queries.push({ table, filters });
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (column: string, value: unknown) => {
        filters.push(["eq", column, value]);
        return chain;
      };
      chain.in = (column: string, value: unknown) => {
        filters.push(["in", column, value]);
        return chain;
      };
      chain.order = () => chain;
      chain.maybeSingle = async () => {
        if (table === "stores") return { data: store, error: null };
        if (table === "store_contract_template_versions") {
          return { data: version, error: null };
        }
        if (table === "store_contract_templates") {
          return { data: template, error: null };
        }
        return { data: null, error: null };
      };
      chain.then = (
        resolve: (value: { data: unknown[]; error: null }) => unknown,
      ) => {
        const data = table === "store_contract_template_extracted_rules"
          ? rules
          : table === "store_contract_template_versions"
            ? [version]
            : [];
        return Promise.resolve(resolve({ data, error: null }));
      };
      return chain;
    },
    async rpc(name: string, payload: Record<string, unknown>) {
      rpcCalls.push({ name, payload });
      if (options.rpcError) {
        return { data: null, error: { message: options.rpcError } };
      }
      successfulWrites += 1;
      if ((options.rpcResult ?? 0) > 0) {
        rules = [{
          id: "rule-1",
          template_version_id: "version-1",
          organization_id: "org-1",
          store_id: "store-1",
          rule_key: "warranty_period",
          rule_group: "warranty",
          label: "Garantia",
          value_text: "doze meses",
          value_json: {},
          source_excerpt: "A garantia contratual sera de doze meses.",
          confidence: 0.9,
          review_status: "suggested",
          sort_order: 0,
          created_at: "2026-10-09T12:00:00.000Z",
          updated_at: "2026-10-09T12:00:00.000Z",
        }];
      }
      return { data: options.rpcResult ?? 0, error: null };
    },
  };

  return {
    supabase,
    rpcCalls,
    queries,
    get rules() { return rules; },
    get successfulWrites() { return successfulWrites; },
  };
}

test("extract-rules authenticates before body, params, or domain", async () => {
  let jsonCalls = 0;
  let paramsCalls = 0;
  let domainCalls = 0;
  const response = await createStoreContractTemplateExtractRulesPostHandler({
    resolveAccess: async () => denied(),
    extractRules: async () => {
      domainCalls += 1;
      return result() as never;
    },
  })({
    json: async () => {
      jsonCalls += 1;
      throw new Error("must not parse JSON");
    },
  } as unknown as Request, {
    get params() {
      paramsCalls += 1;
      return Promise.resolve({ versionId: "version-1" });
    },
  });

  assert.equal(response.status, 401);
  assert.equal(jsonCalls, 0);
  assert.equal(paramsCalls, 0);
  assert.equal(domainCalls, 0);
});

test("extract-rules rejects missing and foreign store assertions before domain", async () => {
  let domainCalls = 0;
  const handler = createStoreContractTemplateExtractRulesPostHandler({
    resolveAccess: async () => granted(),
    extractRules: async () => {
      domainCalls += 1;
      return result() as never;
    },
  });

  const missingStore = await handler(request({}), context());
  assert.equal(missingStore.status, 400);
  assert.equal((await missingStore.json()).error, "INVALID_STORE_ID");

  const foreignStore = await handler(
    request({ storeId: "store-foreign" }),
    context(),
  );
  assert.equal(foreignStore.status, 403);
  assert.equal((await foreignStore.json()).error, "STORE_FORBIDDEN");
  assert.equal(domainCalls, 0);
});

test("extract-rules rejects invalid version and foreign organization assertions", async () => {
  let domainCalls = 0;
  const handler = createStoreContractTemplateExtractRulesPostHandler({
    resolveAccess: async () => granted(),
    extractRules: async () => {
      domainCalls += 1;
      return result() as never;
    },
  });

  const invalidVersion = await handler(request({ storeId: "store-1" }), context(""));
  assert.equal(invalidVersion.status, 400);
  assert.equal((await invalidVersion.json()).error, "INVALID_TEMPLATE_VERSION_ID");

  const foreignOrganization = await handler(
    request({ storeId: "store-1", organizationId: "org-foreign" }),
    context(),
  );
  assert.equal(foreignOrganization.status, 403);
  assert.equal((await foreignOrganization.json()).error, "ORGANIZATION_STORE_MISMATCH");
  assert.equal(domainCalls, 0);
});

test("extract-rules forwards only canonical scope and session actor", async () => {
  let received: Record<string, unknown> | null = null;
  const response = await createStoreContractTemplateExtractRulesPostHandler({
    resolveAccess: async () => granted(),
    extractRules: async (scope, versionId) => {
      received = { ...scope, versionId };
      return result() as never;
    },
  })(
    request({
      storeId: "store-1",
      organizationId: "org-1",
      userId: "attacker",
    }),
    context("version-canonical"),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    organizationId: "org-1",
    storeId: "store-1",
    sessionUserId: "canonical-user",
    versionId: "version-canonical",
  });
});

test("extract-rules preserves response shape and no-store cache policy", async () => {
  const response = await createStoreContractTemplateExtractRulesPostHandler({
    resolveAccess: async () => granted(),
    extractRules: async () => result() as never,
  })(request({ storeId: "store-1" }), context());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, ...result() });
});

test("extract-rules maps RPC duplicate and zero-rule errors to HTTP 409", async () => {
  for (const message of [
    "P19A_CONTRACT_RULES_ALREADY_EXTRACTED",
    "P19A_CONTRACT_RULES_ALREADY_EXTRACTED_ZERO_RULES",
  ]) {
    const response = await createStoreContractTemplateExtractRulesPostHandler({
      resolveAccess: async () => granted(),
      extractRules: async () => {
        throw new StoreContractTemplateAccessError(
          409,
          "TEMPLATE_RULE_EXTRACTION_NOT_ALLOWED",
          message,
        );
      },
    })(request({ storeId: "store-1" }), context());

    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "TEMPLATE_RULE_EXTRACTION_NOT_ALLOWED");
  }
});

test("scoped domain entrypoint validates scope before version and preserves actor", async () => {
  const calls: string[] = [];
  const supabase = {
    from(table: string) {
      calls.push(`from:${table}`);
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        async maybeSingle() { return { data: null, error: null }; },
      };
      return chain;
    },
  };

  await assert.rejects(
    () => extractStoreContractTemplateRulesForAuthorizedStoreScope(
      { organizationId: "org-foreign", storeId: "store-1", sessionUserId: "canonical-user" },
      "version-1",
      { createServiceSupabaseClient: () => supabase as never },
    ),
    (error: unknown) =>
      error instanceof StoreContractTemplateAccessError &&
      error.status === 403 &&
      error.code === "STORE_FORBIDDEN",
  );

  assert.deepEqual(calls, ["from:stores"]);
});

test("scoped extraction reaches one RPC with canonical scope and filtered readers", async () => {
  const harness = extractionHarness({ rpcResult: 1 });

  const extracted = await extractStoreContractTemplateRulesForAuthorizedStoreScope(
    { organizationId: "org-1", storeId: "store-1", sessionUserId: "canonical-user" },
    "version-1",
    { createServiceSupabaseClient: () => harness.supabase as never },
  );

  assert.equal(harness.rpcCalls.length, 1);
  assert.equal(harness.rpcCalls[0]?.name, "replace_store_contract_template_rules_by_system");
  assert.deepEqual(harness.rpcCalls[0]?.payload, {
    p_version_id: "version-1",
    p_organization_id: "org-1",
    p_store_id: "store-1",
    p_rules: [
      {
        rule_key: "garantia",
        rule_group: "garantia",
        label: "Garantia",
        value_text: "garantia contratual sera de doze meses.",
        value_json: {},
        source_excerpt: "garantia contratual sera de doze meses.",
        confidence: 0.9,
        sort_order: 80,
      },
    ],
    p_actor_id: "canonical-user",
  });
  assert.equal(extracted.extractedRuleCount, 1);
  assert.ok(harness.queries.some((query) =>
    query.table === "store_contract_template_versions" &&
    query.filters.some((filter) => filter[1] === "organization_id" && filter[2] === "org-1") &&
    query.filters.some((filter) => filter[1] === "store_id" && filter[2] === "store-1") &&
    query.filters.some((filter) => filter[1] === "id" && filter[2] === "version-1")
  ));
  const ruleQuery = harness.queries.find((query) =>
    query.table === "store_contract_template_extracted_rules"
  );
  assert.ok(ruleQuery);
  assert.ok(ruleQuery.filters.some((filter) => filter[1] === "organization_id" && filter[2] === "org-1"));
  assert.ok(ruleQuery.filters.some((filter) => filter[1] === "store_id" && filter[2] === "store-1"));
  assert.deepEqual(
    ruleQuery.filters.find((filter) => filter[1] === "template_version_id")?.[2],
    ["version-1"],
  );
  assert.equal(harness.queries.some((query) =>
    query.table === "memberships" || query.table === "users"
  ), false);
});

test("scoped extraction translates the real RPC duplicate error to HTTP 409", async () => {
  const harness = extractionHarness({
    rpcError: "P19A_CONTRACT_RULES_ALREADY_EXTRACTED",
  });

  await assert.rejects(
    () => extractStoreContractTemplateRulesForAuthorizedStoreScope(
      { organizationId: "org-1", storeId: "store-1", sessionUserId: "canonical-user" },
      "version-1",
      { createServiceSupabaseClient: () => harness.supabase as never },
    ),
    (error: unknown) =>
      error instanceof StoreContractTemplateAccessError &&
      error.status === 409 &&
      error.code === "TEMPLATE_RULE_EXTRACTION_NOT_ALLOWED",
  );
  assert.equal(harness.successfulWrites, 0);
});

test("zero-rule extraction is accepted once and a later RPC rejection does not write again", async () => {
  const harness = extractionHarness({ rpcResult: 0 });
  const scope = {
    organizationId: "org-1",
    storeId: "store-1",
    sessionUserId: "canonical-user",
  };

  const first = await extractStoreContractTemplateRulesForAuthorizedStoreScope(
    scope,
    "version-1",
    { createServiceSupabaseClient: () => harness.supabase as never },
  );
  assert.equal(first.extractedRuleCount, 0);
  assert.equal(harness.successfulWrites, 1);
  assert.equal(harness.rules.length, 0);

  const secondHarness = extractionHarness({
    rpcError: "P19A_CONTRACT_RULES_ALREADY_EXTRACTED_ZERO_RULES",
  });
  await assert.rejects(
    () => extractStoreContractTemplateRulesForAuthorizedStoreScope(
      scope,
      "version-1",
      { createServiceSupabaseClient: () => secondHarness.supabase as never },
    ),
    (error: unknown) =>
      error instanceof StoreContractTemplateAccessError &&
      error.status === 409 &&
      error.code === "TEMPLATE_RULE_EXTRACTION_NOT_ALLOWED",
  );
  assert.equal(secondHarness.successfulWrites, 0);
  assert.equal(secondHarness.rpcCalls.length, 1);
});

test("legacy extraction export remains available alongside scoped entrypoint", () => {
  assert.equal(typeof extractStoreContractTemplateRules, "function");
  assert.equal(typeof extractStoreContractTemplateRulesForAuthorizedStoreScope, "function");
  const source = readFileSync(
    "src/lib/server/store-contract-templates/template-management.ts",
    "utf8",
  );
  assert.match(
    source,
    /return extractStoreContractTemplateRulesWithResolvedScope\(scope, args\.versionId\)/,
  );
});
