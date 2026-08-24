import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GET,
  createStoreReadinessGetHandler,
} from "./route";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import type { StoreReadinessResult } from "@/lib/server/store-readiness";

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
      throw new Error("route must not read with the session client");
    },
    rpc() {
      throw new Error("route must not call RPC directly with session client");
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

function createReadinessResult(): StoreReadinessResult {
  const capabilities = [
    {
      capabilityKey: "onboarding_minimum",
      state: "not_configured",
      reasonCodes: ["onboarding_minimum_incomplete"],
      missingFields: ["store_onboarding.status"],
      blocksAccess: true,
      blocksCapability: true,
      blocksPilotGo: true,
    },
    {
      capabilityKey: "responsible_operational",
      state: "ready",
      reasonCodes: [],
      missingFields: [],
      blocksAccess: false,
      blocksCapability: false,
      blocksPilotGo: false,
    },
  ] as StoreReadinessResult["capabilities"];

  return {
    capabilities,
    capabilitiesByKey: {
      onboarding_minimum: capabilities[0],
      responsible_operational: capabilities[1],
      agenda: {
        capabilityKey: "agenda",
        state: "ready",
        reasonCodes: [],
        missingFields: [],
        blocksAccess: false,
        blocksCapability: false,
        blocksPilotGo: false,
      },
      catalog: {
        capabilityKey: "catalog",
        state: "ready",
        reasonCodes: [],
        missingFields: [],
        blocksAccess: false,
        blocksCapability: false,
        blocksPilotGo: false,
      },
      quote: {
        capabilityKey: "quote",
        state: "blocked",
        reasonCodes: ["quote_send_disabled_by_policy"],
        missingFields: ["store_quote_settings.ai_can_send_quote_to_customer"],
        blocksAccess: false,
        blocksCapability: true,
        blocksPilotGo: true,
      },
    },
  };
}

function createPrivilegedClientMock() {
  return {
    from() {
      throw new Error("test route must delegate reads to resolveStoreReadiness");
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
    name: "authorized access resolves readiness with canonical store scope from access contract",
    run: async () => {
      let accessCalls = 0;
      let privilegedClientCalls = 0;
      let readinessCalls = 0;
      const access = createGrantedAccess({
        organizationId: "canonical-org",
        storeId: "canonical-store",
      });
      const privilegedClient = createPrivilegedClientMock();
      const readiness = createReadinessResult();
      const handler = createStoreReadinessGetHandler({
        resolveAccess: async ({ requirement }) => {
          accessCalls += 1;
          assert.equal(requirement, "active_or_onboarding");
          return access;
        },
        createPrivilegedClient: () => {
          privilegedClientCalls += 1;
          return privilegedClient as never;
        },
        resolveReadiness: async ({ supabase, organizationId, storeId }) => {
          readinessCalls += 1;
          assert.notEqual(supabase, access.supabase);
          assert.equal(supabase, privilegedClient);
          assert.equal(organizationId, "canonical-org");
          assert.equal(storeId, "canonical-store");
          return readiness;
        },
      });

      const response = await handler(
        buildRequest(
          "http://localhost:3000/api/store/readiness?organization_id=attacker-org&store_id=attacker-store",
        ),
      );
      const body = await getJson(response);

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(body.ok, true);
      assert.equal(body.organization_id, "canonical-org");
      assert.equal(body.store_id, "canonical-store");
      assert.deepEqual(body.capabilities, readiness.capabilities);
      assert.deepEqual(body.capabilities_by_key, readiness.capabilitiesByKey);
      assert.equal(accessCalls, 1);
      assert.equal(privilegedClientCalls, 1);
      assert.equal(readinessCalls, 1);
    },
  },
  {
    name: "authorized response preserves readiness states reason codes and flags",
    run: async () => {
      const readiness = createReadinessResult();
      const privilegedClient = createPrivilegedClientMock();
      const handler = createStoreReadinessGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => privilegedClient as never,
        resolveReadiness: async () => readiness,
      });

      const response = await handler(buildRequest("http://localhost:3000/api/store/readiness"));
      const body = await getJson(response);
      const capabilitiesByKey = body.capabilities_by_key as Record<string, unknown>;
      const onboarding = capabilitiesByKey["onboarding_minimum"] as Record<string, unknown>;
      const quote = capabilitiesByKey["quote"] as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(onboarding.state, "not_configured");
      assert.deepEqual(onboarding.reasonCodes, ["onboarding_minimum_incomplete"]);
      assert.equal(onboarding.blocksAccess, true);
      assert.equal(onboarding.blocksCapability, true);
      assert.equal(onboarding.blocksPilotGo, true);
      assert.equal(quote.state, "blocked");
      assert.deepEqual(quote.reasonCodes, ["quote_send_disabled_by_policy"]);
      assert.equal(quote.blocksAccess, false);
      assert.equal(quote.blocksCapability, true);
      assert.equal(quote.blocksPilotGo, true);
    },
  },
  {
    name: "unauthorized access returns store api denied response before any admin read",
    run: async () => {
      let privilegedClientCalls = 0;
      let readinessCalls = 0;
      const handler = createStoreReadinessGetHandler({
        resolveAccess: async () =>
          createDeniedAccess(401, "anonymous", "anonymous"),
        createPrivilegedClient: () => {
          privilegedClientCalls += 1;
          throw new Error("should not create admin client");
        },
        resolveReadiness: async () => {
          readinessCalls += 1;
          throw new Error("should not run");
        },
      });

      const response = await handler(buildRequest("http://localhost:3000/api/store/readiness"));
      const body = await getJson(response);

      assert.equal(response.status, 401);
      assert.equal(body.ok, false);
      assert.equal(body.error, "STORE_API_UNAUTHENTICATED");
      assert.equal(body.status, "anonymous");
      assert.equal(privilegedClientCalls, 0);
      assert.equal(readinessCalls, 0);
    },
  },
  {
    name: "route uses admin client read only and surfaces safe 500 when readiness resolution fails",
    run: async () => {
      const access = createGrantedAccess();
      let privilegedClientCalls = 0;
      const privilegedClient = createPrivilegedClientMock();
      let writesAttempted = 0;
      const handler = createStoreReadinessGetHandler({
        resolveAccess: async () => access,
        createPrivilegedClient: () => {
          privilegedClientCalls += 1;
          return privilegedClient as never;
        },
        resolveReadiness: async ({ supabase }) => {
          assert.equal(supabase, privilegedClient);
          const probe = supabase as unknown as {
            insert?: () => unknown;
            update?: () => unknown;
            upsert?: () => unknown;
            delete?: () => unknown;
            rpc?: () => unknown;
          };

          for (const methodName of ["insert", "update", "upsert", "delete", "rpc"] as const) {
            if (typeof probe[methodName] === "function") {
              writesAttempted += 1;
            }
          }

          throw new Error("boom");
        },
      });

      const response = await handler(buildRequest("http://localhost:3000/api/store/readiness"));
      const body = await getJson(response);

      assert.equal(response.status, 500);
      assert.equal(body.ok, false);
      assert.equal(body.error, "STORE_READINESS_RESOLUTION_FAILED");
      assert.equal(body.message, "Nao foi possivel carregar o readiness da loja.");
      assert.equal(String(JSON.stringify(body)).includes("SUPABASE_SERVICE_ROLE_KEY"), false);
      assert.equal(privilegedClientCalls, 1);
      assert.equal(writesAttempted, 5);
    },
  },
  {
    name: "production route is read only uses service role after access and ignores arbitrary request scope inputs",
    run: async () => {
      const source = readFileSync(join(process.cwd(), "src/app/api/store/readiness/route.ts"), "utf8");

      const accessIndex = source.indexOf("const access = await resolveAccess(");
      const deniedIndex = source.indexOf("return createStoreApiDeniedResponse(access);");
      const privilegedClientIndex = source.indexOf("const privilegedClient = createClientWithPrivileges();");
      const readinessIndex = source.indexOf("const readiness = await resolveReadiness({");

      assert.equal(source.includes('resolveStoreApiAccess'), true);
      assert.equal(
        source.includes('requirement: "active_or_onboarding"'),
        true,
      );
      assert.equal(source.includes("SUPABASE_SERVICE_ROLE_KEY"), true);
      assert.equal(source.includes("persistSession: false"), true);
      assert.equal(source.includes("autoRefreshToken: false"), true);
      assert.equal(source.includes("resolveStoreReadiness"), true);
      assert.equal(source.includes("organization_id"), true);
      assert.equal(source.includes("store_id"), true);
      assert.equal(source.includes("searchParams"), false);
      assert.equal(source.includes("request.json("), false);
      assert.equal(source.includes("access.supabase"), false);
      assert.equal(source.includes("organizationId:"), true);
      assert.equal(source.includes("storeId:"), true);
      assert.equal(accessIndex >= 0, true);
      assert.equal(deniedIndex > accessIndex, true);
      assert.equal(privilegedClientIndex > deniedIndex, true);
      assert.equal(readinessIndex > privilegedClientIndex, true);
      assert.equal(source.includes(".insert("), false);
      assert.equal(source.includes(".update("), false);
      assert.equal(source.includes(".upsert("), false);
      assert.equal(source.includes(".delete("), false);
      assert.equal(source.includes(".rpc("), false);
      assert.equal(source.includes("createClient("), true);
    },
  },
  {
    name: "module GET export is available without changing existing gates",
    run: async () => {
      assert.equal(typeof GET, "function");

      const protectedSources = [
        "src/lib/server/account-access-resolver.ts",
        "src/app/api/account/ensure-setup/route-handler.ts",
        "middleware.ts",
        "src/app/(app)/layout.tsx",
        "src/app/onboarding/layout.tsx",
      ];

      for (const relativePath of protectedSources) {
        const source = readFileSync(join(process.cwd(), relativePath), "utf8");
        assert.equal(
          source.includes("store/readiness"),
          false,
          `${relativePath} must not be coupled to the readiness route`,
        );
      }
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`store/readiness route: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
