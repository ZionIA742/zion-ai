import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  StoreContractTemplateAccessError,
  approveStoreContractTemplateVersionForAuthorizedStoreScope,
  resolveStoreContractTemplateScopeForAuthorizedStoreScope,
} from "@/lib/server/store-contract-templates/template-management";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreContractTemplateApprovePostHandler } from "./route";

type TestCase = { name: string; run: () => Promise<void> | void };
type Version = Record<string, unknown>;

function granted(): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as StoreApiAccessGranted["supabase"],
    resolution: {} as StoreApiAccessGranted["resolution"],
    sessionUserId: "user-1",
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

function result() {
  return {
    store: { id: "store-1", organization_id: "org-1", name: "Loja" },
    organizationId: "org-1",
    template: { id: "template-1", status: "active", active_version_id: "version-1" },
    activeVersion: { id: "version-1", status: "active" },
    versions: [{ id: "version-1", status: "active" }],
    extractedRules: [{ id: "rule-1", review_status: "approved" }],
    approvedVersion: { id: "version-1", status: "active" },
  };
}

function request(body: unknown): Request {
  return {
    json: async () => body,
  } as unknown as Request;
}

function context(versionId = "version-1") {
  return { params: Promise.resolve({ versionId }) };
}

function createFakeSupabase(args: {
  version?: Version | null;
  template?: Version | null;
  rules?: Version[];
  activationError?: { message: string; code?: string } | null;
}) {
  const version = args.version ?? {
    id: "version-1",
    template_id: "template-1",
    organization_id: "org-1",
    store_id: "store-1",
    status: "analyzed",
    rejected_at: null,
  };
  const template = args.template ?? {
    id: "template-1",
    organization_id: "org-1",
    store_id: "store-1",
    status: "draft",
    active_version_id: null,
  };
  const rules = args.rules ?? [{ id: "rule-1", review_status: "approved" }];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let activated = false;

  function query(table: string) {
    const filters: Record<string, unknown> = {};
    const chain = {
      select() { return chain; },
      eq(column: string, value: unknown) { filters[column] = value; return chain; },
      in(column: string, value: unknown) { filters[column] = value; return chain; },
      order() { return chain; },
      limit() { return chain; },
      async maybeSingle() {
        if (table === "stores") return { data: { id: "store-1", organization_id: "org-1", name: "Loja" }, error: null };
        if (table === "store_contract_template_versions") {
          const found = version && (!filters.id || filters.id === version.id) ? version : null;
          return { data: found, error: null };
        }
        if (table === "store_contract_templates") {
          return { data: template, error: null };
        }
        return { data: null, error: null };
      },
      async then(resolve: (value: unknown) => unknown) {
        if (table === "store_contract_template_versions") {
          return resolve({ data: version ? [version] : [], error: null });
        }
        if (table === "store_contract_template_extracted_rules") {
          return resolve({ data: rules, error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return chain;
  }

  const client = {
    from(table: string) { return query(table); },
    async rpc(name: string, rpcArgs: Record<string, unknown>) {
      rpcCalls.push({ name, args: rpcArgs });
      if (args.activationError) return { data: null, error: args.activationError };
      activated = true;
      version.status = "active";
      template.status = "active";
      template.active_version_id = version.id;
      return { data: null, error: null };
    },
  };

  return {
    client,
    rpcCalls,
    getVersion: () => version,
    getTemplate: () => template,
    isActivated: () => activated,
  };
}

const tests: TestCase[] = [
  {
    name: "canonical denial precedes json and params",
    run: async () => {
      let jsonCalls = 0;
      let paramsCalls = 0;
      let approveCalls = 0;
      const response = await createStoreContractTemplateApprovePostHandler({
        resolveAccess: async (args) => {
          assert.equal(args.requirement, "active_or_onboarding");
          return denied();
        },
        approveTemplate: async () => {
          approveCalls += 1;
          return result() as never;
        },
      })({
        json: async () => {
          jsonCalls += 1;
          throw new Error("json must not run");
        },
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
      assert.equal(approveCalls, 0);
    },
  },
  {
    name: "store and organization assertions block domain helper",
    run: async () => {
      for (const [body, status, code] of [
        [{}, 400, "INVALID_STORE_ID"],
        [{ storeId: "store-foreign" }, 403, "STORE_FORBIDDEN"],
        [{ storeId: "store-1", organizationId: "org-foreign" }, 403, "ORGANIZATION_STORE_MISMATCH"],
      ] as const) {
        let approveCalls = 0;
        const response = await createStoreContractTemplateApprovePostHandler({
          resolveAccess: async () => granted(),
          approveTemplate: async () => {
            approveCalls += 1;
            return result() as never;
          },
        })(request(body), context());
        assert.equal(response.status, status);
        assert.equal((await response.json()).error, code);
        assert.equal(approveCalls, 0);
      }
    },
  },
  {
    name: "canonical IDs, actor, versionId, response and no-store are preserved",
    run: async () => {
      let received: unknown;
      let receivedVersion = "";
      const response = await createStoreContractTemplateApprovePostHandler({
        resolveAccess: async () => granted(),
        approveTemplate: async (scope, versionId) => {
          received = scope;
          receivedVersion = versionId;
          return result() as never;
        },
      })(request({ storeId: "store-1" }), context("version-from-url"));
      assert.equal(response.status, 200);
      assert.deepEqual(received, {
        organizationId: "org-1",
        storeId: "store-1",
        sessionUserId: "user-1",
      });
      assert.equal(receivedVersion, "version-from-url");
      assert.deepEqual(await response.json(), {
        ok: true,
        store: result().store,
        template: result().template,
        activeVersion: result().activeVersion,
        versions: result().versions,
        extractedRules: result().extractedRules,
        approvedVersion: result().approvedVersion,
      });
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "domain errors preserve status code and message",
    run: async () => {
      const response = await createStoreContractTemplateApprovePostHandler({
        resolveAccess: async () => granted(),
        approveTemplate: async () => {
          throw new StoreContractTemplateAccessError(409, "TEMPLATE_VERSION_NOT_APPROVABLE", "blocked");
        },
      })(request({ storeId: "store-1" }), context());
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.equal(body.error, "TEMPLATE_VERSION_NOT_APPROVABLE");
      assert.equal(body.message, "blocked");
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
    name: "canonical resolver rejects absent and foreign stores",
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
    name: "version not found calls no activation RPC",
    run: async () => {
      const fake = createFakeSupabase({ version: null });
      await assert.rejects(
        () => approveStoreContractTemplateVersionForAuthorizedStoreScope(
          { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
          "missing",
          { createServiceSupabaseClient: () => fake.client as never },
        ),
        (error: unknown) => error instanceof StoreContractTemplateAccessError && error.code === "TEMPLATE_VERSION_NOT_FOUND",
      );
      assert.equal(fake.rpcCalls.length, 0);
    },
  },
  {
    name: "template mismatch calls no activation RPC",
    run: async () => {
      const fake = createFakeSupabase({ template: { id: "other-template", status: "draft", active_version_id: null } });
      await assert.rejects(
        () => approveStoreContractTemplateVersionForAuthorizedStoreScope(
          { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
          "version-1",
          { createServiceSupabaseClient: () => fake.client as never },
        ),
        (error: unknown) => error instanceof StoreContractTemplateAccessError && error.code === "TEMPLATE_NOT_FOUND",
      );
      assert.equal(fake.rpcCalls.length, 0);
    },
  },
  {
    name: "unapprovable, rejected, no rules and pending rules call no activation RPC",
    run: async () => {
      const baseVersion = { id: "version-1", template_id: "template-1", organization_id: "org-1", store_id: "store-1" };
      const cases = [
        { version: { ...baseVersion, status: "uploaded", rejected_at: null }, rules: [{ review_status: "approved" }], code: "TEMPLATE_VERSION_NOT_APPROVABLE" },
        { version: { ...baseVersion, status: "analyzed", rejected_at: "2026-01-01" }, rules: [{ review_status: "approved" }], code: "TEMPLATE_VERSION_NOT_APPROVABLE" },
        { version: { ...baseVersion, status: "analyzed", rejected_at: null }, rules: [], code: "TEMPLATE_VERSION_HAS_NO_RULES" },
        { version: { ...baseVersion, status: "awaiting_review", rejected_at: null }, rules: [{ review_status: "pending" }], code: "TEMPLATE_VERSION_HAS_PENDING_RULES" },
      ];
      for (const item of cases) {
        const fake = createFakeSupabase({ version: item.version, rules: item.rules });
        await assert.rejects(
          () => approveStoreContractTemplateVersionForAuthorizedStoreScope(
            { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
            "version-1",
            { createServiceSupabaseClient: () => fake.client as never },
          ),
          (error: unknown) => error instanceof StoreContractTemplateAccessError && error.code === item.code,
        );
        assert.equal(fake.rpcCalls.length, 0);
      }
    },
  },
  {
    name: "valid version calls the exact activation RPC and reloads active state",
    run: async () => {
      const fake = createFakeSupabase({});
      const output = await approveStoreContractTemplateVersionForAuthorizedStoreScope(
        { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
        "version-1",
        { createServiceSupabaseClient: () => fake.client as never },
      );
      assert.equal(fake.isActivated(), true);
      assert.deepEqual(fake.rpcCalls, [{
        name: "activate_store_contract_template_version_by_system",
        args: {
          p_version_id: "version-1",
          p_organization_id: "org-1",
          p_store_id: "store-1",
          p_approved_by: "user-1",
        },
      }]);
      assert.equal(output.approvedVersion.status, "active");
    },
  },
  {
    name: "exact replay still reaches activation RPC",
    run: async () => {
      const fake = createFakeSupabase({
        version: { id: "version-1", template_id: "template-1", status: "active", rejected_at: null },
        template: { id: "template-1", status: "active", active_version_id: "version-1" },
        rules: [],
      });
      await approveStoreContractTemplateVersionForAuthorizedStoreScope(
        { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
        "version-1",
        { createServiceSupabaseClient: () => fake.client as never },
      );
      assert.equal(fake.rpcCalls.length, 1);
    },
  },
  {
    name: "P19A and unique activation errors map to conflict",
    run: async () => {
      for (const activationError of [
        { message: "P19A_CONTRACT_VERSION_CONFLICT", code: "P0001" },
        { message: "duplicate key", code: "23505" },
      ]) {
        const fake = createFakeSupabase({ activationError });
        await assert.rejects(
          () => approveStoreContractTemplateVersionForAuthorizedStoreScope(
            { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
            "version-1",
            { createServiceSupabaseClient: () => fake.client as never },
          ),
          (error: unknown) => error instanceof StoreContractTemplateAccessError && error.status === 409 && error.code === "TEMPLATE_VERSION_NOT_APPROVABLE",
        );
      }
    },
  },
  {
    name: "legacy path remains on legacy resolver and shared core",
    run: () => {
      const source = readFileSync(join(process.cwd(), "src/lib/server/store-contract-templates/template-management.ts"), "utf8");
      const start = source.indexOf("export async function approveStoreContractTemplateVersion(args");
      const end = source.indexOf("export async function approveStoreContractTemplateVersionForAuthorizedStoreScope", start);
      const legacy = source.slice(start, end);
      assert.match(legacy, /resolveAuthorizedStoreTemplateScope\(args\)/);
      assert.match(legacy, /approveStoreContractTemplateVersionWithResolvedScope\(scope, versionId\)/);
      assert.doesNotMatch(legacy, /resolveStoreContractTemplateScopeForAuthorizedStoreScope/);
      assert.match(source, /async function approveStoreContractTemplateVersionWithResolvedScope/);
    },
  },
];

void (async () => {
  let passed = 0;
  for (const test of tests) {
    await test.run();
    passed += 1;
  }
  console.log(`store-contract-templates-approve-route: ${passed}/${tests.length} tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
