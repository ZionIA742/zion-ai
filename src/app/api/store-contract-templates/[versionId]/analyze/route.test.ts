import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  StoreContractTemplateAccessError,
  analyzeStoreContractTemplateVersionForAuthorizedStoreScope,
} from "@/lib/server/store-contract-templates/template-management";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreContractTemplateAnalyzePostHandler } from "./route";

function granted(): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as StoreApiAccessGranted["supabase"],
    resolution: {} as StoreApiAccessGranted["resolution"],
    sessionUserId: "session-user-1",
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

function analyzedResult() {
  return {
    store: { id: "store-1", organization_id: "org-1", name: "Loja" },
    template: { id: "template-1" },
    activeVersion: null,
    versions: [{ id: "version-1", status: "awaiting_review" }],
    extractedRules: [],
    analyzedVersion: { id: "version-1", status: "awaiting_review" },
  };
}

test("analyze denial runs before JSON, params, or domain", async () => {
  let jsonCalls = 0;
  let paramsCalls = 0;
  let analyzeCalls = 0;
  const response = await createStoreContractTemplateAnalyzePostHandler({
    resolveAccess: async () => denied(),
    analyzeTemplate: async () => {
      analyzeCalls += 1;
      return analyzedResult() as never;
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
  assert.equal(analyzeCalls, 0);
});

test("analyze rejects missing and foreign store assertions before the domain", async () => {
  let analyzeCalls = 0;
  const handler = createStoreContractTemplateAnalyzePostHandler({
    resolveAccess: async () => granted(),
    analyzeTemplate: async () => {
      analyzeCalls += 1;
      return analyzedResult() as never;
    },
  });

  const missing = await handler(request({}), context());
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error, "INVALID_STORE_ID");

  const foreign = await handler(request({ storeId: "store-foreign" }), context());
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).error, "STORE_FORBIDDEN");
  assert.equal(analyzeCalls, 0);
});

test("foreign organization assertion is rejected while omitted organization is accepted", async () => {
  const forwarded: Array<Record<string, unknown>> = [];
  const handler = createStoreContractTemplateAnalyzePostHandler({
    resolveAccess: async () => granted(),
    analyzeTemplate: async (...args) => {
      forwarded.push({ scope: args[0], versionId: args[1] });
      return analyzedResult() as never;
    },
  });

  const foreign = await handler(
    request({ storeId: "store-1", organizationId: "org-foreign" }),
    context(),
  );
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).error, "ORGANIZATION_STORE_MISMATCH");

  const accepted = await handler(request({ storeId: "store-1" }), context("version-url-1"));
  assert.equal(accepted.status, 200);
  assert.deepEqual(forwarded, [
    {
      scope: {
        organizationId: "org-1",
        storeId: "store-1",
        sessionUserId: "session-user-1",
      },
      versionId: "version-url-1",
    },
  ]);
});

test("analyze preserves complete response and no-store cache policy", async () => {
  const response = await createStoreContractTemplateAnalyzePostHandler({
    resolveAccess: async () => granted(),
    analyzeTemplate: async () => analyzedResult() as never,
  })(request({ storeId: "store-1" }), context());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, ...analyzedResult() });
});

test("analyze propagates domain concurrency conflicts", async () => {
  const response = await createStoreContractTemplateAnalyzePostHandler({
    resolveAccess: async () => granted(),
    analyzeTemplate: async () => {
      throw new StoreContractTemplateAccessError(
        409,
        "TEMPLATE_VERSION_ANALYSIS_CONFLICT",
        "concurrent analysis",
      );
    },
  })(request({ storeId: "store-1" }), context());

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "TEMPLATE_VERSION_ANALYSIS_CONFLICT");
});

test("analyze never trusts client identity fields when forwarding the session scope", async () => {
  let received: Record<string, unknown> | null = null;
  const response = await createStoreContractTemplateAnalyzePostHandler({
    resolveAccess: async () => granted(),
    analyzeTemplate: async (scope, versionId) => {
      received = { ...scope, versionId };
      return analyzedResult() as never;
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
    sessionUserId: "session-user-1",
    versionId: "version-canonical",
  });
});

test("scoped analysis uses canonical store scope, CAS, and private file data", async () => {
  const queries: Array<Record<string, unknown>> = [];
  const version = {
    id: "version-1",
    template_id: "template-1",
    organization_id: "org-1",
    store_id: "store-1",
    version_number: 1,
    status: "uploaded",
    store_file_id: "file-1",
    storage_bucket: "private-contract-templates",
    storage_path: "org-1/store-1/file-1.pdf",
    original_filename: "contrato.pdf",
    mime_type: "application/pdf",
    size_bytes: 10,
    raw_extracted_text: null,
    analysis_summary: null,
    approved_at: null,
    approved_by: null,
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    metadata: { source: "upload" },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as Record<string, unknown>;
  const template = {
    id: "template-1",
    organization_id: "org-1",
    store_id: "store-1",
    status: "draft",
    active_version_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as Record<string, unknown>;
  const store = {
    id: "store-1",
    organization_id: "org-1",
    name: "Loja 1",
    created_at: "2026-01-01T00:00:00.000Z",
  } as Record<string, unknown>;
  let extractedCalls = 0;
  let downloadCalls = 0;

  const supabase = {
    from(table: string) {
      let operation = "select";
      let payload: Record<string, unknown> = {};
      const filters: Record<string, unknown> = {};
      const chain = {
        select(selection: string) {
          queries.push({ table, operation: "select", selection });
          return chain;
        },
        update(nextPayload: Record<string, unknown>) {
          operation = "update";
          payload = nextPayload;
          queries.push({ table, operation, payload });
          return chain;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          queries.push({ table, filter: column, value });
          return chain;
        },
        in(column: string, values: unknown[]) {
          filters[column] = values;
          queries.push({ table, filter: column, value: values });
          return chain;
        },
        order() {
          return chain;
        },
        async maybeSingle() {
          if (operation === "update") {
            assert.equal(table, "store_contract_template_versions");
            assert.equal(filters.organization_id, "org-1");
            assert.equal(filters.store_id, "store-1");
            assert.equal(filters.id, "version-1");
            const expected = filters.status;
            assert.equal(version.status, expected);
            Object.assign(version, payload);
            return { data: { ...version }, error: null };
          }
          if (table === "stores") {
            return filters.id === "store-1" && filters.organization_id === "org-1"
              ? { data: { ...store }, error: null }
              : { data: null, error: null };
          }
          if (table === "store_contract_templates") {
            return { data: { ...template }, error: null };
          }
          if (table === "store_contract_template_versions") {
            return { data: { ...version }, error: null };
          }
          throw new Error(`unexpected maybeSingle table: ${table}`);
        },
        async then(resolve: (value: unknown) => unknown) {
          if (table === "store_contract_template_versions") {
            return resolve({ data: [{ ...version }], error: null });
          }
          if (table === "store_contract_template_extracted_rules") {
            return resolve({ data: [], error: null });
          }
          throw new Error(`unexpected list table: ${table}`);
        },
      };
      return chain;
    },
    storage: {
      from(bucket: string) {
        return {
          async download(path: string) {
            downloadCalls += 1;
            queries.push({ storage: bucket, path });
            assert.equal(bucket, "private-contract-templates");
            assert.equal(path, "org-1/store-1/file-1.pdf");
            return { data: new Blob(["private pdf"]), error: null };
          },
        };
      },
    },
  };

  const result = await analyzeStoreContractTemplateVersionForAuthorizedStoreScope(
    { organizationId: "org-1", storeId: "store-1", sessionUserId: "canonical-user" },
    "version-1",
    {
      createServiceSupabaseClient: () => supabase as never,
      extractText: async (args) => {
        extractedCalls += 1;
        assert.equal(args.fileName, "contrato.pdf");
        assert.equal(args.mimeType, "application/pdf");
        return { text: "Texto canônico extraído", summary: "Resumo canônico" };
      },
    },
  );

  assert.equal(extractedCalls, 1);
  assert.equal(downloadCalls, 1);
  assert.equal(version.status, "awaiting_review");
  assert.equal(version.raw_extracted_text, "Texto canônico extraído");
  assert.equal(version.analysis_summary, "Resumo canônico");
  assert.equal((version.metadata as Record<string, unknown>).analysis_started_by_user_id, "canonical-user");
  assert.equal((version.metadata as Record<string, unknown>).analysis_completed_by_user_id, "canonical-user");
  assert.equal(result.analyzedVersion?.id, "version-1");
  assert.equal(result.analyzedVersion?.status, "awaiting_review");

  const versionQueries = queries.filter((query) => query.table === "store_contract_template_versions");
  assert.equal(versionQueries.filter((query) => query.filter === "organization_id" && query.value === "org-1").length, 4);
  assert.equal(versionQueries.filter((query) => query.filter === "store_id" && query.value === "store-1").length, 4);
  assert.deepEqual(
    versionQueries.filter((query) => query.operation === "update").map((query) => query.payload),
    [
      { status: "analyzing", updated_at: version.updated_at, metadata: { source: "upload" } },
      { status: "awaiting_review", updated_at: version.updated_at, raw_extracted_text: "Texto canônico extraído", analysis_summary: "Resumo canônico", metadata: { source: "upload" } },
    ].map((expected, index) => {
      const actual = versionQueries.filter((query) => query.operation === "update")[index]?.payload as Record<string, unknown>;
      assert.equal(actual.status, expected.status);
      return actual;
    }),
  );
  assert.equal(queries.some((query) => query.table === "stores" && query.filter === "organization_id" && query.value === "org-1"), true);
  assert.equal(queries.some((query) => query.table === "store_contract_templates" && query.filter === "store_id" && query.value === "store-1"), true);
});

test("scoped analysis rejects invalid or foreign scope before version, membership, storage, or extraction", async () => {
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
    storage: { from() { calls.push("storage"); return { download: async () => ({ data: null, error: null }) }; } },
  };
  const extractText = async () => {
    calls.push("extract");
    return { text: "unexpected", summary: "unexpected" };
  };

  await assert.rejects(
    () => analyzeStoreContractTemplateVersionForAuthorizedStoreScope(
      { organizationId: "org-1", storeId: "store-foreign", sessionUserId: "canonical-user" },
      "version-1",
      { createServiceSupabaseClient: () => supabase as never, extractText },
    ),
    (error: unknown) => error instanceof StoreContractTemplateAccessError && error.status === 403 && error.code === "STORE_FORBIDDEN",
  );
  await assert.rejects(
    () => analyzeStoreContractTemplateVersionForAuthorizedStoreScope(
      { organizationId: "org-foreign", storeId: "store-1", sessionUserId: "canonical-user" },
      "version-1",
      { createServiceSupabaseClient: () => supabase as never, extractText },
    ),
    (error: unknown) => error instanceof StoreContractTemplateAccessError && error.status === 403 && error.code === "STORE_FORBIDDEN",
  );
  await assert.rejects(
    () => analyzeStoreContractTemplateVersionForAuthorizedStoreScope(
      { organizationId: "org-1", storeId: "store-1", sessionUserId: "" },
      "version-1",
      { createServiceSupabaseClient: () => supabase as never, extractText },
    ),
    (error: unknown) => error instanceof StoreContractTemplateAccessError && error.status === 500 && error.code === "INVALID_AUTHORIZED_TEMPLATE_SCOPE",
  );
  assert.deepEqual(calls, ["from:stores", "from:stores"]);
});

test("analyze handler maps scoped access denial to HTTP 403 without executing request or domain", async () => {
  let jsonCalls = 0;
  let paramsCalls = 0;
  let analyzeCalls = 0;
  const response = await createStoreContractTemplateAnalyzePostHandler({
    resolveAccess: async () => ({
      ok: false,
      resolution: {} as StoreApiAccessDenied["resolution"],
      httpStatus: 403,
      payload: {
        ok: false,
        error: "STORE_FORBIDDEN" as const,
        message: "Loja fora do escopo.",
        status: "cross_domain_forbidden",
        reasonCode: "missing_store",
      },
    }),
    analyzeTemplate: async () => {
      analyzeCalls += 1;
      return analyzedResult() as never;
    },
  })(
    { json: async () => { jsonCalls += 1; throw new Error("must not parse JSON"); } } as unknown as Request,
    { get params() { paramsCalls += 1; return Promise.resolve({ versionId: "version-1" }); } },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "STORE_FORBIDDEN",
    message: "Loja fora do escopo.",
    status: "cross_domain_forbidden",
    reasonCode: "missing_store",
  });
  assert.equal(jsonCalls, 0);
  assert.equal(paramsCalls, 0);
  assert.equal(analyzeCalls, 0);
});
