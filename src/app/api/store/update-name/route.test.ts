import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  POST,
  createUpdateStoreNamePostHandler,
} from "./route";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type UpdateCall = {
  table: string;
  values: Record<string, unknown>;
  filters: Record<string, unknown>;
  selectedColumns: string;
};

function createDeniedAccess(
  httpStatus: 401 | 403 | 409 | 503,
  status: StoreApiAccessDenied["payload"]["status"],
  reasonCode: StoreApiAccessDenied["payload"]["reasonCode"],
): StoreApiAccessDenied {
  return {
    ok: false,
    resolution: {
      domain: status === "anonymous" ? "anonymous" : "store_area",
      status,
      sessionUserId: null,
      safeHtmlDestination:
        status === "anonymous" ? "/login" : "/account/access-blocked",
      apiDecision:
        httpStatus === 401
          ? "deny_401"
          : httpStatus === 403
            ? "deny_403"
            : httpStatus === 503
              ? "deny_503"
              : "deny_409",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      reasonCode,
      message: "Mensagem interna.",
    },
    httpStatus,
    payload: {
      ok: false,
      error:
        httpStatus === 401
          ? "STORE_API_UNAUTHENTICATED"
          : httpStatus === 403
            ? "STORE_API_FORBIDDEN"
            : httpStatus === 503
              ? "STORE_API_ACCESS_UNAVAILABLE"
              : "STORE_API_ACCESS_DENIED",
      message: "Mensagem publica.",
      status,
      reasonCode,
    },
  };
}

function createGrantedAccess(
  overrides?: Partial<StoreApiAccessGranted>,
): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as StoreApiAccessGranted["supabase"],
    resolution: {
      domain: "store_area",
      status: "store_ready_active",
      sessionUserId: "user-1",
      safeHtmlDestination: "/crm",
      apiDecision: "allow",
      organizationResolution: "single",
      storeResolution: "single",
      organizationId: "access-org",
      storeId: "access-store",
      commercialAccess: "allowed",
      reasonCode: "ready_active",
      message: "Conta liberada.",
    },
    sessionUserId: "user-1",
    organizationId: "access-org",
    storeId: "access-store",
    ...overrides,
  };
}

function createJsonRequest(
  bodyFactory: () => unknown | Promise<unknown>,
  tracker: { reads: number },
) {
  return {
    json: async () => {
      tracker.reads += 1;
      return bodyFactory();
    },
  } as unknown as Request;
}

function createPrivilegedClientMock(args?: {
  updatedStore?: { id: string; organization_id: string; name: string | null } | null;
  updateError?: unknown;
}) {
  const updateCalls: UpdateCall[] = [];

  const client = {
    updateCalls,
    from(table: string) {
      return {
        update(values: Record<string, unknown>) {
          const state: UpdateCall = {
            table,
            values,
            filters: {},
            selectedColumns: "",
          };

          return {
            eq(column: string, value: unknown) {
              state.filters[column] = value;
              return this;
            },
            select(columns: string) {
              state.selectedColumns = columns;
              return this;
            },
            async maybeSingle() {
              updateCalls.push({
                table: state.table,
                values: { ...state.values },
                filters: { ...state.filters },
                selectedColumns: state.selectedColumns,
              });

              return {
                data:
                  args?.updatedStore ?? {
                    id: String(state.filters.id || ""),
                    organization_id: String(state.filters.organization_id || ""),
                    name: String(state.values.name || ""),
                  },
                error: args?.updateError ?? null,
              };
            },
          };
        },
      };
    },
  };

  return client;
}

const tests: TestCase[] = [
  {
    name: "valid account updates only the canonical store and ignores body tenant ids",
    run: async () => {
      const requestReads = { reads: 0 };
      let resolveCount = 0;
      let clientCreateCount = 0;
      const client = createPrivilegedClientMock();
      const handler = createUpdateStoreNamePostHandler({
        resolveAccess: async ({ requirement }) => {
          resolveCount += 1;
          assert.equal(requirement, "active_or_onboarding");
          return createGrantedAccess();
        },
        createPrivilegedClient: () => {
          clientCreateCount += 1;
          return client as never;
        },
      });

      const response = await handler(
        createJsonRequest(
          () => ({
            name: "Loja Canonica",
            storeId: "body-store",
            organizationId: "body-org",
          }),
          requestReads,
        ),
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.storeId, "access-store");
      assert.equal(body.organizationId, "access-org");
      assert.equal(body.name, "Loja Canonica");
      assert.equal(resolveCount, 1);
      assert.equal(clientCreateCount, 1);
      assert.equal(requestReads.reads, 1);
      assert.equal(client.updateCalls.length, 1);
      assert.deepEqual(client.updateCalls[0], {
        table: "stores",
        values: { name: "Loja Canonica" },
        filters: {
          id: "access-store",
          organization_id: "access-org",
        },
        selectedColumns: "id, organization_id, name",
      });
    },
  },
  {
    name: "onboarding account can update store name without becoming active",
    run: async () => {
      const client = createPrivilegedClientMock();
      const handler = createUpdateStoreNamePostHandler({
        resolveAccess: async ({ requirement }) => {
          assert.equal(requirement, "active_or_onboarding");
          return createGrantedAccess({
            resolution: {
              domain: "store_area",
              status: "store_ready_onboarding_required",
              sessionUserId: "user-1",
              safeHtmlDestination: "/onboarding",
              apiDecision: "allow",
              organizationResolution: "single",
              storeResolution: "single",
              organizationId: "onboarding-org",
              storeId: "onboarding-store",
              commercialAccess: "allowed",
              reasonCode: "onboarding_required",
              message: "Onboarding pendente.",
            },
            organizationId: "onboarding-org",
            storeId: "onboarding-store",
          });
        },
        createPrivilegedClient: () => client as never,
      });

      const response = await handler(
        createJsonRequest(() => ({ name: "Loja em Onboarding" }), {
          reads: 0,
        }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.storeId, "onboarding-store");
      assert.equal(body.organizationId, "onboarding-org");
      assert.equal(client.updateCalls.length, 1);
      assert.deepEqual(client.updateCalls[0].filters, {
        id: "onboarding-store",
        organization_id: "onboarding-org",
      });
    },
  },
  {
    name: "active account can still update store name",
    run: async () => {
      const client = createPrivilegedClientMock();
      const handler = createUpdateStoreNamePostHandler({
        resolveAccess: async ({ requirement }) => {
          assert.equal(requirement, "active_or_onboarding");
          return createGrantedAccess();
        },
        createPrivilegedClient: () => client as never,
      });

      const response = await handler(
        createJsonRequest(() => ({ name: "Loja Ativa" }), { reads: 0 }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(client.updateCalls.length, 1);
      assert.deepEqual(client.updateCalls[0].filters, {
        id: "access-store",
        organization_id: "access-org",
      });
    },
  },
  {
    name: "invalid name returns 400 without writing",
    run: async () => {
      const client = createPrivilegedClientMock();
      let clientCreateCount = 0;
      const handler = createUpdateStoreNamePostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => {
          clientCreateCount += 1;
          return client as never;
        },
      });

      const response = await handler(
        createJsonRequest(() => ({ name: "   ", storeId: "body-store" }), {
          reads: 0,
        }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 400);
      assert.equal(body.error, "INVALID_NAME");
      assert.equal(clientCreateCount, 0);
      assert.equal(client.updateCalls.length, 0);
    },
  },
  {
    name: "denied statuses are preserved without reading tenant ids or writing",
    run: async () => {
      for (const denied of [
        createDeniedAccess(401, "anonymous", "anonymous"),
        createDeniedAccess(403, "inactive_membership", "inactive_membership"),
        createDeniedAccess(403, "cross_domain_forbidden", "zion_admin_cannot_access_store_area"),
        createDeniedAccess(403, "store_commercial_blocked", "commercial_access_blocked"),
        createDeniedAccess(409, "store_missing_membership", "missing_membership"),
        createDeniedAccess(409, "store_multi_org_unsupported", "multi_org_unsupported"),
        createDeniedAccess(409, "store_missing_store", "missing_store"),
        createDeniedAccess(409, "store_multi_store_unsupported", "multi_store_unsupported"),
      ]) {
        const requestReads = { reads: 0 };
        let clientCreateCount = 0;
        const handler = createUpdateStoreNamePostHandler({
          resolveAccess: async () => denied,
          createPrivilegedClient: () => {
            clientCreateCount += 1;
            throw new Error("client should not be created");
          },
        });

        const response = await handler(
          createJsonRequest(
            () => ({
              name: "Nao deve ler",
              storeId: "body-store",
              organizationId: "body-org",
            }),
            requestReads,
          ),
        );
        const body = (await response.json()) as Record<string, unknown>;

        assert.equal(response.status, denied.httpStatus);
        assert.equal(body.status, denied.payload.status);
        assert.equal(body.reasonCode, denied.payload.reasonCode);
        assert.equal(body.message, denied.payload.message);
        assert.equal(requestReads.reads, 0);
        assert.equal(clientCreateCount, 0);
      }
    },
  },
  {
    name: "source uses canonical wrapper and never reads body tenant ids",
    run: () => {
      const source = readFileSync(join(__dirname, "route.ts"), "utf8");

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes("createStoreApiDeniedResponse"), true);
      assert.equal(source.includes('requirement: "active_or_onboarding"'), true);
      assert.equal(source.includes('requirement: "active"'), false);
      assert.equal(source.includes("body?.storeId"), false);
      assert.equal(source.includes("body?.organizationId"), false);
      assert.equal(source.includes("auth.getUser"), false);
      assert.equal(source.includes("getSession"), false);
    },
  },
  {
    name: "module exports the handler factory result",
    run: () => {
      assert.equal(typeof POST, "function");
    },
  },
];

void (async () => {
  let passed = 0;

  for (const test of tests) {
    await test.run();
    passed += 1;
  }

  console.log(`store-update-name-route: ${passed}/${tests.length} tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
