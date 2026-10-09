import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  StoreContractTemplateAccessError,
  rejectStoreContractTemplateVersionForAuthorizedStoreScope,
  resolveStoreContractTemplateScopeForAuthorizedStoreScope,
} from "@/lib/server/store-contract-templates/template-management";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreContractTemplateRejectPostHandler } from "./route";

type TestCase = { name: string; run: () => Promise<void> | void };
type Row = Record<string, unknown>;

function granted(): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as StoreApiAccessGranted["supabase"],
    resolution: {} as StoreApiAccessGranted["resolution"],
    sessionUserId: "session-user",
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
    organizationId: "org-1",
    template: { id: "template-1", status: "draft", active_version_id: null },
    activeVersion: null,
    versions: [{ id: "version-1", status: "rejected" }],
    extractedRules: [{ id: "rule-1", review_status: "approved" }],
    rejectedVersion: { id: "version-1", status: "rejected" },
  };
}

type FakeOptions = {
  version?: Row | null;
  template?: Row | null;
  updateData?: Row | null;
  updateError?: { message: string; code?: string } | null;
};

function createFakeSupabase(options: FakeOptions = {}) {
  const version = options.version === undefined
    ? {
        id: "version-1",
        template_id: "template-1",
        organization_id: "org-1",
        store_id: "store-1",
        status: "analyzed",
        rejected_at: null,
        rejected_by: null,
        rejection_reason: null,
      }
    : options.version;
  const template = options.template === undefined
    ? { id: "template-1", organization_id: "org-1", store_id: "store-1" }
    : options.template;
  const updateCalls: Array<{ payload: Row; filters: Row }> = [];
  let activeUpdate: { payload: Row; filters: Row } | null = null;

  function query(table: string) {
    const filters: Row = {};
    let updatePayload: Row | null = null;
    const chain = {
      select() { return chain; },
      update(payload: Row) {
        updatePayload = payload;
        return chain;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return chain;
      },
      in(column: string, value: unknown) {
        filters[column] = value;
        return chain;
      },
      order() { return chain; },
      async maybeSingle() {
        if (table === "stores") {
          return { data: { id: "store-1", organization_id: "org-1", name: "Loja" }, error: null };
        }
        if (table === "store_contract_template_versions") {
          if (updatePayload) {
            const matches = version &&
              filters.id === version.id &&
              filters.template_id === version.template_id &&
              filters.organization_id === version.organization_id &&
              filters.store_id === version.store_id &&
              filters.status === version.status;
            if (!matches) return { data: null, error: null };
            activeUpdate = { payload: updatePayload, filters: { ...filters } };
            if (options.updateError) return { data: null, error: options.updateError };
            Object.assign(version, updatePayload);
            return { data: options.updateData === undefined ? version : options.updateData, error: null };
          }
          const matches = version && (!filters.id || filters.id === version.id);
          return { data: matches ? version : null, error: null };
        }
        if (table === "store_contract_templates") {
          return { data: template, error: null };
        }
        return { data: null, error: null };
      },
      then(resolve: (value: unknown) => unknown) {
        if (table === "store_contract_template_versions") {
          return resolve({ data: version ? [version] : [], error: null });
        }
        if (table === "store_contract_template_extracted_rules") {
          return resolve({ data: [{ id: "rule-1", review_status: "approved" }], error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return chain;
  }

  return {
    client: { from: (table: string) => query(table) },
    updateCalls,
    getUpdate: () => activeUpdate,
    getVersion: () => version,
  };
}

const tests: TestCase[] = [
  {
    name: "access denial precedes JSON and params",
    run: async () => {
      let jsonCalls = 0;
      let paramsCalls = 0;
      let rejectCalls = 0;
      const response = await createStoreContractTemplateRejectPostHandler({
        resolveAccess: async (args) => {
          assert.equal(args.requirement, "active_or_onboarding");
          return denied();
        },
        rejectTemplate: async () => {
          rejectCalls += 1;
          return result() as never;
        },
      })({
        json: async () => { jsonCalls += 1; throw new Error("must not parse"); },
      } as unknown as Request, {
        get params() {
          paramsCalls += 1;
          return Promise.resolve({ versionId: "version-1" });
        },
      });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, "STORE_API_UNAUTHENTICATED");
      assert.equal(jsonCalls, 0);
      assert.equal(paramsCalls, 0);
      assert.equal(rejectCalls, 0);
    },
  },
  {
    name: "store and organization assertions block the helper",
    run: async () => {
      for (const [body, status, code] of [
        [{}, 400, "INVALID_STORE_ID"],
        [{ storeId: "store-foreign" }, 403, "STORE_FORBIDDEN"],
        [{ storeId: "store-1", organizationId: "org-foreign" }, 403, "ORGANIZATION_STORE_MISMATCH"],
      ] as const) {
        let calls = 0;
        const response = await createStoreContractTemplateRejectPostHandler({
          resolveAccess: async () => granted(),
          rejectTemplate: async () => { calls += 1; return result() as never; },
        })(request(body), context());
        assert.equal(response.status, status);
        assert.equal((await response.json()).error, code);
        assert.equal(calls, 0);
      }
    },
  },
  {
    name: "omitted organization is accepted and canonical IDs are forwarded",
    run: async () => {
      let receivedScope: unknown;
      let receivedVersion = "";
      let receivedReason: string | null | undefined;
      const response = await createStoreContractTemplateRejectPostHandler({
        resolveAccess: async () => granted(),
        rejectTemplate: async (scope, versionId, reason) => {
          receivedScope = scope;
          receivedVersion = versionId;
          receivedReason = reason;
          return result() as never;
        },
      })(request({ storeId: "store-1", organizationId: "org-body", rejectionReason: "  motivo  " }), context("version-url"));
      assert.equal(response.status, 403);
      assert.equal(receivedScope, undefined);

      const accepted = await createStoreContractTemplateRejectPostHandler({
        resolveAccess: async () => granted(),
        rejectTemplate: async (scope, versionId, reason) => {
          receivedScope = scope;
          receivedVersion = versionId;
          receivedReason = reason;
          return result() as never;
        },
      })(request({ storeId: "store-1", rejectionReason: "  motivo  " }), context("version-url"));
      assert.equal(accepted.status, 200);
      assert.deepEqual(receivedScope, {
        organizationId: "org-1",
        storeId: "store-1",
        sessionUserId: "session-user",
      });
      assert.equal(receivedVersion, "version-url");
      assert.equal(receivedReason, "motivo");
      assert.equal(accepted.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "omitted reason is passed as null and response is complete",
    run: async () => {
      let reason: string | null | undefined;
      const response = await createStoreContractTemplateRejectPostHandler({
        resolveAccess: async () => granted(),
        rejectTemplate: async (_scope, _versionId, receivedReason) => {
          reason = receivedReason;
          return result() as never;
        },
      })(request({ storeId: "store-1" }), context());
      assert.equal(reason, null);
      assert.deepEqual(await response.json(), {
        ok: true,
        store: result().store,
        template: result().template,
        activeVersion: result().activeVersion,
        versions: result().versions,
        extractedRules: result().extractedRules,
        rejectedVersion: result().rejectedVersion,
      });
    },
  },
  {
    name: "domain errors preserve status, code and message",
    run: async () => {
      const response = await createStoreContractTemplateRejectPostHandler({
        resolveAccess: async () => granted(),
        rejectTemplate: async () => {
          throw new StoreContractTemplateAccessError(409, "TEMPLATE_VERSION_NOT_REJECTABLE", "blocked");
        },
      })(request({ storeId: "store-1" }), context());
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        ok: false,
        error: "TEMPLATE_VERSION_NOT_REJECTABLE",
        message: "blocked",
      });
    },
  },
  {
    name: "invalid authorized scope fails before service client",
    run: async () => {
      let createCalls = 0;
      await assert.rejects(
        () => resolveStoreContractTemplateScopeForAuthorizedStoreScope(
          { organizationId: "", storeId: "store-1", sessionUserId: "user-1" },
          { createServiceSupabaseClient: () => { createCalls += 1; return {} as never; } },
        ),
        (error: unknown) => error instanceof StoreContractTemplateAccessError && error.code === "INVALID_AUTHORIZED_TEMPLATE_SCOPE",
      );
      assert.equal(createCalls, 0);
    },
  },
  {
    name: "canonical resolver rejects absent or foreign stores",
    run: async () => {
      for (const data of [null, { id: "store-foreign", organization_id: "org-1" }, { id: "store-1", organization_id: "org-foreign" }]) {
        const client = {
          from: () => ({
            select() { return this; },
            eq() { return this; },
            async maybeSingle() { return { data, error: null }; },
          }),
        };
        await assert.rejects(
          () => resolveStoreContractTemplateScopeForAuthorizedStoreScope(
            { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
            { createServiceSupabaseClient: () => client as never },
          ),
          (error: unknown) => error instanceof StoreContractTemplateAccessError && error.code === "STORE_FORBIDDEN",
        );
      }
    },
  },
  {
    name: "version, template and mutable-state guards perform no update",
    run: async () => {
      const cases: Array<{ options: FakeOptions; code: string }> = [
        { options: { version: null }, code: "TEMPLATE_VERSION_NOT_FOUND" },
        { options: { template: { id: "other-template" } }, code: "TEMPLATE_NOT_FOUND" },
        { options: { version: { id: "version-1", template_id: "template-1", status: "active", rejected_at: null } }, code: "TEMPLATE_VERSION_NOT_REJECTABLE" },
        { options: { version: { id: "version-1", template_id: "template-1", status: "analyzed", rejected_at: "2026-01-01" } }, code: "TEMPLATE_VERSION_NOT_REJECTABLE" },
      ];
      const invalidIdFake = createFakeSupabase();
      await assert.rejects(
        () => rejectStoreContractTemplateVersionForAuthorizedStoreScope(
          { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
          "",
          null,
          { createServiceSupabaseClient: () => invalidIdFake.client as never },
        ),
        (error: unknown) => error instanceof StoreContractTemplateAccessError && error.code === "INVALID_TEMPLATE_VERSION_ID",
      );
      assert.equal(invalidIdFake.getUpdate(), null);
      for (const item of cases) {
        const fake = createFakeSupabase(item.options);
        await assert.rejects(
          () => rejectStoreContractTemplateVersionForAuthorizedStoreScope(
            { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
            "version-1",
            "reason",
            { createServiceSupabaseClient: () => fake.client as never },
          ),
          (error: unknown) => error instanceof StoreContractTemplateAccessError && error.code === item.code,
        );
        assert.equal(fake.getUpdate(), null);
      }
    },
  },
  {
    name: "valid rejection performs one conditional update with canonical actor and reloads",
    run: async () => {
      const fake = createFakeSupabase();
      const output = await rejectStoreContractTemplateVersionForAuthorizedStoreScope(
        { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
        "version-1",
        "  motivo  ",
        { createServiceSupabaseClient: () => fake.client as never },
      );
      const update = fake.getUpdate();
      assert.ok(update);
      assert.equal(update.payload.status, "rejected");
      assert.equal(update.payload.rejected_by, "user-1");
      assert.equal(update.payload.rejection_reason, "motivo");
      assert.equal(update.filters.id, "version-1");
      assert.equal(update.filters.template_id, "template-1");
      assert.equal(update.filters.organization_id, "org-1");
      assert.equal(update.filters.store_id, "store-1");
      assert.equal(update.filters.status, "analyzed");
      assert.equal(output.rejectedVersion.status, "rejected");
    },
  },
  {
    name: "replay behavior preserves original values with zero update",
    run: async () => {
      const original = {
        id: "version-1", template_id: "template-1", organization_id: "org-1", store_id: "store-1",
        status: "rejected", rejected_at: "2026-01-01", rejected_by: "original-user", rejection_reason: "original",
      };
      const fake = createFakeSupabase({ version: original });
      const output = await rejectStoreContractTemplateVersionForAuthorizedStoreScope(
        { organizationId: "org-1", storeId: "store-1", sessionUserId: "new-user" },
        "version-1",
        "changed",
        { createServiceSupabaseClient: () => fake.client as never },
      );
      assert.equal(fake.getUpdate(), null);
      assert.equal(output.rejectedVersion.rejected_at, "2026-01-01");
      assert.equal(output.rejectedVersion.rejected_by, "original-user");
      assert.equal(output.rejectedVersion.rejection_reason, "original");
    },
  },
  {
    name: "P19A SQL error maps to conflict, empty CAS result maps to reject conflict, generic SQL error is preserved",
    run: async () => {
      for (const [options, code] of [
        [{ updateError: { message: "P19A_CONTRACT_VERSION_CONFLICT" } }, "TEMPLATE_VERSION_NOT_REJECTABLE"],
        [{ updateData: null }, "TEMPLATE_VERSION_REJECT_CONFLICT"],
        [{ updateError: { message: "database unavailable" } }, "GENERIC"],
      ] as const) {
        const fake = createFakeSupabase(options);
        await assert.rejects(
          () => rejectStoreContractTemplateVersionForAuthorizedStoreScope(
            { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
            "version-1",
            null,
            { createServiceSupabaseClient: () => fake.client as never },
          ),
          (error: unknown) => code === "GENERIC"
            ? error instanceof Error && error.message === "database unavailable"
            : error instanceof StoreContractTemplateAccessError && error.code === code,
        );
      }
    },
  },
  {
    name: "legacy entrypoint keeps legacy resolver and delegates to shared core",
    run: () => {
      const source = readFileSync(join(process.cwd(), "src/lib/server/store-contract-templates/template-management.ts"), "utf8");
      const start = source.indexOf("export async function rejectStoreContractTemplateVersion(args");
      const end = source.indexOf("export async function rejectStoreContractTemplateVersionForAuthorizedStoreScope", start);
      const legacy = source.slice(start, end);
      assert.match(legacy, /resolveAuthorizedStoreTemplateScope\(args\)/);
      assert.match(legacy, /rejectStoreContractTemplateVersionWithResolvedScope\(/);
      assert.doesNotMatch(legacy, /resolveStoreContractTemplateScopeForAuthorizedStoreScope\(/);
      assert.match(source, /async function rejectStoreContractTemplateVersionWithResolvedScope/);
    },
  },
];

void (async () => {
  let passed = 0;
  for (const test of tests) {
    await test.run();
    passed += 1;
  }
  console.log(`store-contract-templates-reject-route: ${passed}/${tests.length} tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
