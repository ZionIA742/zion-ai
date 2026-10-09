import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createAnalyzeStoreContractTemplateVersion,
  StoreContractTemplateAccessError,
} from "./template-management";

const scope = {
  userId: "user-1",
  organizationId: "org-1",
  store: { id: "store-1", organization_id: "org-1", name: "Loja", created_at: "now" },
};

function createHarness(initialStatus: string = "uploaded", forcedUpdateError: string | null = null) {
  const version: Record<string, unknown> = {
    id: "version-1",
    template_id: "template-1",
    organization_id: "org-1",
    store_id: "store-1",
    version_number: 1,
    status: initialStatus,
    store_file_id: "file-1",
    storage_bucket: "zion-store-files",
    storage_path: "contracts/base.pdf",
    original_filename: "base.pdf",
    mime_type: "application/pdf",
    size_bytes: 10,
    raw_extracted_text: null,
    analysis_summary: null,
    approved_at: null,
    approved_by: null,
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    metadata: { existing: true },
    created_at: "now",
    updated_at: "now",
  };
  const template = {
    id: "template-1",
    organization_id: "org-1",
    store_id: "store-1",
    status: "draft",
    active_version_id: null,
    created_at: "now",
    updated_at: "now",
  };
  const updates: Array<{ payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  let versionReads = 0;
  let downloads = 0;

  function builder(table: string, mode: "read" | "update", payload?: Record<string, unknown>) {
    let currentMode = mode;
    let currentPayload = payload;
    const filters: Record<string, unknown> = {};
    const chain = {
      select() { return chain; },
      update(nextPayload: Record<string, unknown>) {
        currentMode = "update";
        currentPayload = nextPayload;
        return chain;
      },
      eq(column: string, value: unknown) { filters[column] = value; return chain; },
      in() { return chain; },
      order() { return chain; },
      async maybeSingle() {
        if (currentMode === "update") {
          updates.push({ payload: currentPayload || {}, filters: { ...filters } });
          if (forcedUpdateError) return { data: null, error: { message: forcedUpdateError } };
          if (filters.status !== version.status) return { data: null, error: null };
          Object.assign(version, currentPayload);
          return { data: { ...version }, error: null };
        }
        if (table === "store_contract_template_versions") {
          versionReads += 1;
          return {
            data: { ...version, status: versionReads <= 2 ? initialStatus : version.status },
            error: null,
          };
        }
        if (table === "store_contract_templates") return { data: template, error: null };
        return { data: null, error: null };
      },
      then(resolve: (value: unknown) => unknown) {
        if (table === "store_contract_template_versions") return Promise.resolve(resolve({ data: [{ ...version }], error: null }));
        if (table === "store_contract_template_extracted_rules") return Promise.resolve(resolve({ data: [], error: null }));
        return Promise.resolve(resolve({ data: [], error: null }));
      },
    };
    return chain;
  }

  const supabase = {
    from(table: string) {
      return builder(table, "read");
    },
    storage: {
      from() {
        return {
          async download() {
            downloads += 1;
            return {
              data: { async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; } },
              error: null,
            };
          },
        };
      },
    },
  };

  return {
    version,
    updates,
    get downloads() { return downloads; },
    supabase,
    analyze: createAnalyzeStoreContractTemplateVersion({
      resolveScope: (async () => ({ ...scope, supabase })) as never,
    }),
  };
}

function args() {
  return { versionId: "version-1", storeId: "store-1", organizationId: "org-1" };
}

test("claim uses status CAS and preserves tenant filters", async () => {
  const harness = createHarness("failed");
  const analyze = createAnalyzeStoreContractTemplateVersion({
    resolveScope: (async () => ({ ...scope, supabase: harness.supabase })) as never,
    extractText: async () => ({ text: "texto", summary: "resumo" }),
  });
  const result = await analyze(args());
  assert.equal(result.analyzedVersion?.status, "awaiting_review");
  assert.deepEqual(harness.updates[0]?.filters, {
    id: "version-1",
    organization_id: "org-1",
    store_id: "store-1",
    status: "failed",
  });
  assert.equal(harness.updates[0]?.payload.status, "analyzing");
  assert.equal(harness.updates[1]?.filters.status, "analyzing");
  assert.equal(harness.version.metadata && (harness.version.metadata as Record<string, unknown>).existing, true);
});

test("uploaded versions claim successfully before any storage work", async () => {
  const harness = createHarness("uploaded");
  const analyze = createAnalyzeStoreContractTemplateVersion({
    resolveScope: (async () => ({ ...scope, supabase: harness.supabase })) as never,
    extractText: async () => ({ text: "texto", summary: "resumo" }),
  });
  await analyze(args());
  assert.equal(harness.updates[0]?.filters.status, "uploaded");
  assert.equal(harness.updates[0]?.payload.status, "analyzing");
  assert.equal(harness.downloads, 1);
});

test("a claim with no updated row returns the analysis conflict", async () => {
  const harness = createHarness("uploaded");
  harness.version.status = "analyzing";
  await assert.rejects(harness.analyze(args()), (error: unknown) => {
    return error instanceof StoreContractTemplateAccessError &&
      error.status === 409 &&
      error.code === "TEMPLATE_VERSION_ANALYSIS_CONFLICT";
  });
  assert.equal(harness.downloads, 0);
});

test("database errors from the CAS remain database errors", async () => {
  const harness = createHarness("uploaded", "database unavailable");
  await assert.rejects(harness.analyze(args()), /database unavailable/);
  assert.equal(harness.downloads, 0);
});

test("a second claimant loses the CAS before download or extraction", async () => {
  const harness = createHarness();
  let extractionCalls = 0;
  const analyze = createAnalyzeStoreContractTemplateVersion({
    resolveScope: (async () => ({ ...scope, supabase: harness.supabase })) as never,
    extractText: async () => {
      extractionCalls += 1;
      return { text: "texto", summary: "resumo" };
    },
  });
  const first = analyze(args());
  const second = analyze(args());
  await assert.rejects(second, (error: unknown) => {
    return error instanceof StoreContractTemplateAccessError &&
      error.status === 409 &&
      error.code === "TEMPLATE_VERSION_ANALYSIS_CONFLICT";
  });
  await first;
  assert.equal(extractionCalls, 1);
  assert.equal(harness.downloads, 1);
});

test("a delayed completion never overwrites a newer state and does not compensate with failed", async () => {
  const harness = createHarness();
  const analyze = createAnalyzeStoreContractTemplateVersion({
    resolveScope: (async () => ({ ...scope, supabase: harness.supabase })) as never,
    extractText: async () => {
      harness.version.status = "awaiting_review";
      return { text: "texto", summary: "resumo" };
    },
  });
  await assert.rejects(analyze(args()), (error: unknown) => {
    return error instanceof StoreContractTemplateAccessError &&
      error.code === "TEMPLATE_VERSION_ANALYSIS_CONFLICT";
  });
  assert.deepEqual(harness.updates.map((entry) => entry.payload.status), ["analyzing", "awaiting_review"]);
  assert.equal(harness.version.status, "awaiting_review");
});

test("a delayed extraction failure fails closed when the CAS state changed", async () => {
  const harness = createHarness();
  const latestMetadata = { existing: true, changed_by_other_processing: true };
  const analyze = createAnalyzeStoreContractTemplateVersion({
    resolveScope: (async () => ({ ...scope, supabase: harness.supabase })) as never,
    extractText: async () => {
      Object.assign(harness.version, {
        status: "awaiting_review",
        metadata: latestMetadata,
        analysis_started_by_user_id: "other-user",
        analysis_completed_by_user_id: "other-user",
      });
      throw new Error("genuine extraction failure");
    },
  });

  await assert.rejects(analyze(args()), (error: unknown) => {
    return error instanceof StoreContractTemplateAccessError &&
      error.status === 409 &&
      error.code === "TEMPLATE_VERSION_ANALYSIS_CONFLICT";
  });

  assert.equal(harness.version.status, "awaiting_review");
  assert.deepEqual(harness.version.metadata, latestMetadata);
  assert.equal(harness.version.analysis_started_by_user_id, "other-user");
  assert.equal(harness.version.analysis_completed_by_user_id, "other-user");
  assert.deepEqual(harness.updates.map((entry) => entry.payload.status), [
    "analyzing",
    "failed",
  ]);
  assert.equal(harness.updates.length, 2, "no blind retry is allowed");
  assert.equal(harness.updates[1]?.filters.status, "analyzing");
  assert.equal(harness.updates[1]?.filters.id, "version-1");
  assert.equal(harness.updates[1]?.filters.organization_id, "org-1");
  assert.equal(harness.updates[1]?.filters.store_id, "store-1");
});

test("extraction error marks failed only while analyzing", async () => {
  const harness = createHarness();
  const analyze = createAnalyzeStoreContractTemplateVersion({
    resolveScope: (async () => ({ ...scope, supabase: harness.supabase })) as never,
    extractText: async () => { throw new Error("extract failed"); },
  });
  await assert.rejects(analyze(args()), /extract failed/);
  assert.deepEqual(harness.updates.map((entry) => entry.payload.status), ["analyzing", "failed"]);
  assert.equal(harness.version.status, "failed");
});

test("rejected and non-analyzable versions remain blocked", async () => {
  for (const status of ["analyzing", "awaiting_review", "analyzed", "active"]) {
    const harness = createHarness(status);
    await assert.rejects(harness.analyze(args()), (error: unknown) => {
      return error instanceof StoreContractTemplateAccessError &&
        error.code === "TEMPLATE_VERSION_NOT_ANALYZABLE";
    });
    assert.equal(harness.downloads, 0);
    assert.equal(harness.updates.length, 0);
  }

  const rejected = createHarness("uploaded");
  rejected.version.rejected_at = "2026-10-09T12:00:00.000Z";
  await assert.rejects(rejected.analyze(args()), (error: unknown) => {
    return error instanceof StoreContractTemplateAccessError &&
      error.code === "TEMPLATE_VERSION_NOT_ANALYZABLE";
  });
  assert.equal(rejected.downloads, 0);
});
