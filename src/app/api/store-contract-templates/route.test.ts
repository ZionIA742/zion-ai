import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  StoreContractTemplateAccessError,
  resolveStoreContractTemplateScopeForAuthorizedStoreScope,
} from "@/lib/server/store-contract-templates/template-management";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreContractTemplatesGetHandler } from "./route";

type TestCase = { name: string; run: () => Promise<void> | void };
type Row = Record<string, unknown>;

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
    template: { id: "template-1" },
    activeVersion: { id: "version-1" },
    versions: [{ id: "version-1" }],
    extractedRules: [{ id: "rule-1" }],
  };
}

function request(query = "storeId=store-1") {
  return new Request(`https://example.test/api/store-contract-templates?${query}`);
}

function createStoreQuery(data: Row | null, error: Row | null = null) {
  const calls: Row[] = [];
  const query = {
    select(selection: string) {
      calls.push({ method: "select", selection });
      return query;
    },
    eq(column: string, value: string) {
      calls.push({ method: "eq", column, value });
      return query;
    },
    async maybeSingle() {
      return { data, error };
    },
  };
  return { calls, client: { from: () => query } };
}

const tests: TestCase[] = [
  {
    name: "denied canonical access is returned before template work",
    run: async () => {
      let listCalls = 0;
      let requirement = "";
      const response = await createStoreContractTemplatesGetHandler({
        resolveAccess: async (args) => {
          requirement = args.requirement;
          return denied();
        },
        listTemplate: async () => {
          listCalls += 1;
          return result() as never;
        },
      })(request());
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, "STORE_API_UNAUTHENTICATED");
      assert.equal(requirement, "active_or_onboarding");
      assert.equal(listCalls, 0);
    },
  },
  {
    name: "missing storeId fails closed without list",
    run: async () => {
      let listCalls = 0;
      const response = await createStoreContractTemplatesGetHandler({
        resolveAccess: async () => granted(),
        listTemplate: async () => {
          listCalls += 1;
          return result() as never;
        },
      })(request(""));
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.error, "INVALID_STORE_ID");
      assert.equal(listCalls, 0);
    },
  },
  {
    name: "foreign query scope is rejected before list",
    run: async () => {
      for (const [query, code] of [
        ["storeId=store-foreign", "STORE_FORBIDDEN"],
        ["storeId=store-1&organizationId=org-foreign", "ORGANIZATION_STORE_MISMATCH"],
      ] as const) {
        let listCalls = 0;
        const response = await createStoreContractTemplatesGetHandler({
          resolveAccess: async () => granted(),
          listTemplate: async () => {
            listCalls += 1;
            return result() as never;
          },
        })(request(query));
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error, code);
        assert.equal(listCalls, 0);
      }
    },
  },
  {
    name: "omitted organization assertion is accepted and canonical args are used",
    run: async () => {
      let received: unknown;
      const response = await createStoreContractTemplatesGetHandler({
        resolveAccess: async () => granted(),
        listTemplate: async (args) => {
          received = args;
          return result() as never;
        },
      })(request());
      assert.equal(response.status, 200);
      assert.deepEqual(received, {
        organizationId: "org-1",
        storeId: "store-1",
        sessionUserId: "user-1",
      });
      const body = await response.json();
      assert.deepEqual(body, {
        ok: true,
        store: result().store,
        template: result().template,
        activeVersion: result().activeVersion,
        versions: result().versions,
        extractedRules: result().extractedRules,
      });
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "template domain errors preserve status and code",
    run: async () => {
      const response = await createStoreContractTemplatesGetHandler({
        resolveAccess: async () => granted(),
        listTemplate: async () => {
          throw new StoreContractTemplateAccessError(409, "TEMPLATE_BUSY", "busy");
        },
      })(request());
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.equal(body.error, "TEMPLATE_BUSY");
      assert.equal(body.message, "busy");
    },
  },
  {
    name: "authorized scope validates before service client and loads exact store scope",
    run: async () => {
      let createCalls = 0;
      const query = createStoreQuery({
        id: "store-1",
        organization_id: "org-1",
        name: "Loja",
        created_at: "2026-01-01",
      });
      const scope = await resolveStoreContractTemplateScopeForAuthorizedStoreScope(
        { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
        {
          createServiceSupabaseClient: () => {
            createCalls += 1;
            return query.client as never;
          },
        },
      );
      assert.equal(createCalls, 1);
      assert.equal(scope.userId, "user-1");
      assert.equal(scope.organizationId, "org-1");
      assert.equal(scope.store.id, "store-1");
      assert.deepEqual(query.calls.filter((call) => call.method === "eq"), [
        { method: "eq", column: "id", value: "store-1" },
        { method: "eq", column: "organization_id", value: "org-1" },
      ]);

      let invalidCreateCalls = 0;
      await assert.rejects(
        () =>
          resolveStoreContractTemplateScopeForAuthorizedStoreScope(
            { organizationId: "", storeId: "store-1", sessionUserId: "user-1" },
            {
              createServiceSupabaseClient: () => {
                invalidCreateCalls += 1;
                return query.client as never;
              },
            },
          ),
        (error: unknown) =>
          error instanceof StoreContractTemplateAccessError &&
          error.status === 500 &&
          error.code === "INVALID_AUTHORIZED_TEMPLATE_SCOPE",
      );
      assert.equal(invalidCreateCalls, 0);
    },
  },
  {
    name: "missing, foreign, and mismatched stores fail closed",
    run: async () => {
      for (const data of [
        null,
        { id: "store-foreign", organization_id: "org-1" },
        { id: "store-1", organization_id: "org-foreign" },
      ]) {
        const query = createStoreQuery(data);
        await assert.rejects(
          () =>
            resolveStoreContractTemplateScopeForAuthorizedStoreScope(
              { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
              { createServiceSupabaseClient: () => query.client as never },
            ),
          (error: unknown) =>
            error instanceof StoreContractTemplateAccessError &&
            error.status === 403 &&
            error.code === "STORE_FORBIDDEN",
        );
      }
    },
  },
  {
    name: "legacy authority remains and new resolver has no auth or membership calls",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/store-contract-templates/template-management.ts"),
        "utf8",
      );
      assert.match(source, /authenticateTemplateRequest/);
      assert.match(source, /resolveAuthorizedStoreTemplateScope/);
      assert.match(source, /listStoreContractTemplate/);
      const start = source.indexOf("resolveStoreContractTemplateScopeForAuthorizedStoreScope");
      const end = source.indexOf("async function loadStoreContractTemplate", start);
      const scopedResolver = source.slice(start, end);
      assert.doesNotMatch(scopedResolver, /authenticateTemplateRequest|createSupabaseServerClient|auth\.getUser|\.from\("memberships"\)/);
      assert.match(scopedResolver, /\.from\("stores"\)/);
    },
  },
];

void (async () => {
  let passed = 0;
  for (const test of tests) {
    await test.run();
    passed += 1;
  }
  console.log(`store-contract-templates-route: ${passed}/${tests.length} tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
