import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GET,
  createStorePrimaryResponsibleGetHandler,
} from "./route";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import type { LoadCanonicalStoreResponsibleResult } from "@/lib/server/store-responsibles";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
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
  const sessionSupabase = {
    from() {
      throw new Error("route must not read store_responsibles with the session client");
    },
    insert() {
      throw new Error("route must not insert");
    },
    update() {
      throw new Error("route must not update");
    },
    upsert() {
      throw new Error("route must not upsert");
    },
    delete() {
      throw new Error("route must not delete");
    },
    rpc() {
      throw new Error("route must not call rpc directly");
    },
  } as unknown as StoreApiAccessGranted["supabase"];

  return {
    ok: true,
    supabase: sessionSupabase,
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

function createPrivilegedClientMock() {
  return {
    from() {
      throw new Error("test route must delegate reads to loadResponsible");
    },
    insert() {
      throw new Error("route must not insert");
    },
    update() {
      throw new Error("route must not update");
    },
    upsert() {
      throw new Error("route must not upsert");
    },
    delete() {
      throw new Error("route must not delete");
    },
    rpc() {
      throw new Error("route must not call rpc");
    },
  };
}

function buildRequest(url: string) {
  return new Request(url);
}

async function getJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "unauthorized access returns store api denied response before any privileged read",
    run: async () => {
      let privilegedClientCalls = 0;
      let responsibleCalls = 0;
      const handler = createStorePrimaryResponsibleGetHandler({
        resolveAccess: async ({ requirement }) => {
          assert.equal(requirement, "active_or_onboarding");
          return createDeniedAccess(401, "anonymous", "anonymous");
        },
        createPrivilegedClient: () => {
          privilegedClientCalls += 1;
          throw new Error("should not create privileged client");
        },
        loadResponsible: async () => {
          responsibleCalls += 1;
          throw new Error("should not load responsible");
        },
      });

      const response = await handler(buildRequest("http://localhost:3000/api/store/primary-responsible"));
      const body = await getJson(response);

      assert.equal(response.status, 401);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(body.ok, false);
      assert.equal(body.error, "STORE_API_UNAUTHENTICATED");
      assert.equal(privilegedClientCalls, 0);
      assert.equal(responsibleCalls, 0);
    },
  },
  {
    name: "valid active_or_onboarding access loads the responsible with canonical resolved scope",
    run: async () => {
      let accessCalls = 0;
      let privilegedClientCalls = 0;
      let responsibleCalls = 0;
      const access = createGrantedAccess({
        organizationId: "canonical-org",
        storeId: "canonical-store",
      });
      const privilegedClient = createPrivilegedClientMock();
      const handler = createStorePrimaryResponsibleGetHandler({
        resolveAccess: async ({ requirement }) => {
          accessCalls += 1;
          assert.equal(requirement, "active_or_onboarding");
          return access;
        },
        createPrivilegedClient: () => {
          privilegedClientCalls += 1;
          return privilegedClient as never;
        },
        loadResponsible: async ({ supabase, organizationId, storeId }) => {
          responsibleCalls += 1;
          assert.notEqual(supabase, access.supabase);
          assert.equal(supabase, privilegedClient);
          assert.equal(organizationId, "canonical-org");
          assert.equal(storeId, "canonical-store");
          return {
            ok: true,
            responsible: {
              id: "responsible-1",
              name: "Maria",
              role: "owner",
              whatsappNumber: "5511999990000",
            },
          };
        },
      });

      const response = await handler(
        buildRequest(
          "http://localhost:3000/api/store/primary-responsible?organizationId=attacker-org&storeId=attacker-store",
        ),
      );
      const body = await getJson(response);
      const responsible = body.responsible as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(responsible.id, "responsible-1");
      assert.equal(responsible.name, "Maria");
      assert.equal(responsible.role, "owner");
      assert.equal(responsible.whatsappNumber, "5511999990000");
      assert.equal(accessCalls, 1);
      assert.equal(privilegedClientCalls, 1);
      assert.equal(responsibleCalls, 1);
    },
  },
  {
    name: "missing canonical responsible returns null without legacy fallback",
    run: async () => {
      const handler = createStorePrimaryResponsibleGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => createPrivilegedClientMock() as never,
        loadResponsible: async () => ({
          ok: false,
          reason: "responsible_primary_not_configured",
        }),
      });

      const response = await handler(
        buildRequest(
          "http://localhost:3000/api/store/primary-responsible?responsible_name=Legacy&responsible_whatsapp=11999990000",
        ),
      );
      const body = await getJson(response);

      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        ok: true,
        responsible: null,
      });
    },
  },
  {
    name: "invalid canonical responsible state fails closed instead of returning null",
    run: async () => {
      const handler = createStorePrimaryResponsibleGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => createPrivilegedClientMock() as never,
        loadResponsible: async () => ({
          ok: false,
          reason: "responsible_primary_state_invalid",
        }),
      });

      const response = await handler(buildRequest("http://localhost:3000/api/store/primary-responsible"));
      const body = await getJson(response);

      assert.equal(response.status, 500);
      assert.equal(body.ok, false);
      assert.equal(body.error, "STORE_PRIMARY_RESPONSIBLE_INVALID_STATE");
    },
  },
  {
    name: "reader errors surface as safe 500 instead of empty responsible data",
    run: async () => {
      const handler = createStorePrimaryResponsibleGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => createPrivilegedClientMock() as never,
        loadResponsible: async () => {
          throw new Error("store_responsibles exploded");
        },
      });

      const response = await handler(buildRequest("http://localhost:3000/api/store/primary-responsible"));
      const body = await getJson(response);

      assert.equal(response.status, 500);
      assert.equal(body.ok, false);
      assert.equal(body.error, "STORE_PRIMARY_RESPONSIBLE_LOAD_FAILED");
      assert.equal(
        body.message,
        "Nao foi possivel carregar o responsavel principal da loja.",
      );
      assert.equal(String(JSON.stringify(body)).includes("store_responsibles exploded"), false);
    },
  },
  {
    name: "route is read only and does not accept request tenant ids as authority",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/app/api/store/primary-responsible/route.ts"),
        "utf8",
      );

      const accessIndex = source.indexOf("const access = await resolveAccess(");
      const deniedIndex = source.indexOf("return createStoreApiDeniedResponse(access);");
      const privilegedClientIndex = source.indexOf("const privilegedClient = createClientWithPrivileges();");
      const responsibleIndex = source.indexOf("const responsibleResult = await loadResponsible({");

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes('requirement: "active_or_onboarding"'), true);
      assert.equal(source.includes("loadCanonicalActivePrimaryStoreResponsible"), true);
      assert.equal(source.includes("SUPABASE_SERVICE_ROLE_KEY"), true);
      assert.equal(source.includes("persistSession: false"), true);
      assert.equal(source.includes("autoRefreshToken: false"), true);
      assert.equal(source.includes("searchParams"), false);
      assert.equal(source.includes("request.json("), false);
      assert.equal(source.includes("access.supabase"), false);
      assert.equal(source.includes("organizationId: access.organizationId"), true);
      assert.equal(source.includes("storeId: access.storeId"), true);
      assert.equal(accessIndex >= 0, true);
      assert.equal(deniedIndex > accessIndex, true);
      assert.equal(privilegedClientIndex > deniedIndex, true);
      assert.equal(responsibleIndex > privilegedClientIndex, true);
      assert.equal(source.includes(".insert("), false);
      assert.equal(source.includes(".update("), false);
      assert.equal(source.includes(".upsert("), false);
      assert.equal(source.includes(".delete("), false);
      assert.equal(source.includes(".rpc("), false);
    },
  },
  {
    name: "module GET export is available",
    run: () => {
      assert.equal(typeof GET, "function");
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`store/primary-responsible route: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
