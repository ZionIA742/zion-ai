import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Module from "node:module";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

type RpcResult = {
  data: unknown;
  error: { message: string } | null;
};

const projectSrcPath = join(process.cwd(), "src");
type ResolveFilenameHook = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) => string;
type ModuleWithResolveFilename = typeof Module & {
  _resolveFilename: ResolveFilenameHook;
};
const moduleWithResolveFilename = Module as ModuleWithResolveFilename;
const originalResolveFilename = moduleWithResolveFilename._resolveFilename;

moduleWithResolveFilename._resolveFilename = function resolveFilenamePatched(
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) {
  if (request.startsWith("@/")) {
    const nextRequest = join(projectSrcPath, request.slice(2));
    return originalResolveFilename.call(this, nextRequest, parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const routeModulePromise = import("./route");

async function loadRouteModule() {
  return routeModulePromise;
}

function createDeniedAccess(
  httpStatus: 401 | 403 | 409 | 503,
  status: StoreApiAccessDenied["payload"]["status"],
  reasonCode: StoreApiAccessDenied["payload"]["reasonCode"],
  error = "STORE_API_ACCESS_DENIED",
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
      error,
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

function createPrivilegedClientMock(result?: RpcResult) {
  const rpcCalls: RpcCall[] = [];

  return {
    rpcCalls,
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return result ?? { data: [], error: null };
    },
  };
}

function buildRequest(query: string) {
  return new Request(`https://example.test/api/schedule?${query}`);
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "active account reads schedule only from canonical tenant scope and ignores query tenant ids",
    run: async () => {
      const { createScheduleGetHandler } = await loadRouteModule();
      let resolveCount = 0;
      let clientCreateCount = 0;
      const client = createPrivilegedClientMock({
        data: [
          {
            item_kind: "appointment",
            item_id: "item-1",
            organization_id: "access-org",
            store_id: "access-store",
            lead_id: "lead-1",
            conversation_id: "conversation-1",
            title: "Visita tecnica",
            item_type: "technical_visit",
            status: "scheduled",
            start_at: "2026-08-06T10:00:00.000Z",
            end_at: "2026-08-06T11:00:00.000Z",
            customer_name: "Cliente 1",
            customer_phone: "+5511999999999",
            address_text: "Rua A",
            notes: "Observacao",
            source: "store_appointments",
            created_by_user_id: "user-1",
            created_at: "2026-08-06T09:00:00.000Z",
            updated_at: "2026-08-06T09:30:00.000Z",
          },
        ],
        error: null,
      });
      const handler = createScheduleGetHandler({
        resolveAccess: async () => {
          resolveCount += 1;
          return createGrantedAccess();
        },
        createPrivilegedClient: () => {
          clientCreateCount += 1;
          return client as never;
        },
      });

      const response = await handler(
        buildRequest(
          "organizationId=query-org&storeId=query-store&start=2026-08-06T10:00:00.000Z&end=2026-08-06T11:00:00.000Z",
        ),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.organizationId, "access-org");
      assert.equal(body.storeId, "access-store");
      assert.equal(body.count, 1);
      assert.equal(resolveCount, 1);
      assert.equal(clientCreateCount, 1);
      assert.equal(client.rpcCalls.length, 1);
      assert.deepEqual(client.rpcCalls[0], {
        fn: "list_store_schedule_items",
        args: {
          p_organization_id: "access-org",
          p_store_id: "access-store",
          p_start_at: "2026-08-06T10:00:00.000Z",
          p_end_at: "2026-08-06T11:00:00.000Z",
        },
      });
    },
  },
  {
    name: "onboarding account receives wrapper 409 and no schedule query runs",
    run: async () => {
      const { createScheduleGetHandler } = await loadRouteModule();
      let clientCreateCount = 0;
      const client = createPrivilegedClientMock();
      const handler = createScheduleGetHandler({
        resolveAccess: async () =>
          createDeniedAccess(
            409,
            "store_ready_onboarding_required",
            "onboarding_required",
            "STORE_API_REQUIREMENT_MISMATCH",
          ),
        createPrivilegedClient: () => {
          clientCreateCount += 1;
          return client as never;
        },
      });

      const response = await handler(
        buildRequest("start=2026-08-06T10:00:00.000Z&end=2026-08-06T11:00:00.000Z"),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.ok, false);
      assert.equal(body.error, "STORE_API_REQUIREMENT_MISMATCH");
      assert.equal(body.reasonCode, "onboarding_required");
      assert.equal(clientCreateCount, 0);
      assert.equal(client.rpcCalls.length, 0);
    },
  },
  {
    name: "anonymous user stays denied and no schedule query runs",
    run: async () => {
      const { createScheduleGetHandler } = await loadRouteModule();
      let clientCreateCount = 0;
      const client = createPrivilegedClientMock();
      const handler = createScheduleGetHandler({
        resolveAccess: async () =>
          createDeniedAccess(
            401,
            "anonymous",
            "anonymous",
            "STORE_API_UNAUTHENTICATED",
          ),
        createPrivilegedClient: () => {
          clientCreateCount += 1;
          return client as never;
        },
      });

      const response = await handler(
        buildRequest("start=2026-08-06T10:00:00.000Z&end=2026-08-06T11:00:00.000Z"),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 401);
      assert.equal(body.ok, false);
      assert.equal(body.error, "STORE_API_UNAUTHENTICATED");
      assert.equal(clientCreateCount, 0);
      assert.equal(client.rpcCalls.length, 0);
    },
  },
  {
    name: "missing membership remains fail closed through wrapper contract",
    run: async () => {
      const { createScheduleGetHandler } = await loadRouteModule();
      const client = createPrivilegedClientMock();
      const handler = createScheduleGetHandler({
        resolveAccess: async () =>
          createDeniedAccess(
            409,
            "store_missing_membership",
            "missing_membership",
          ),
        createPrivilegedClient: () => client as never,
      });

      const response = await handler(
        buildRequest("start=2026-08-06T10:00:00.000Z&end=2026-08-06T11:00:00.000Z"),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.reasonCode, "missing_membership");
      assert.equal(client.rpcCalls.length, 0);
    },
  },
  {
    name: "multiple organizations or stores remain fail closed through wrapper contract",
    run: async () => {
      const { createScheduleGetHandler } = await loadRouteModule();
      const multiOrgHandler = createScheduleGetHandler({
        resolveAccess: async () =>
          createDeniedAccess(
            409,
            "store_multi_org_unsupported",
            "multi_org_unsupported",
          ),
        createPrivilegedClient: () => createPrivilegedClientMock() as never,
      });
      const multiStoreHandler = createScheduleGetHandler({
        resolveAccess: async () =>
          createDeniedAccess(
            409,
            "store_multi_store_unsupported",
            "multi_store_unsupported",
          ),
        createPrivilegedClient: () => createPrivilegedClientMock() as never,
      });

      const multiOrgResponse = await multiOrgHandler(
        buildRequest("start=2026-08-06T10:00:00.000Z&end=2026-08-06T11:00:00.000Z"),
      );
      const multiStoreResponse = await multiStoreHandler(
        buildRequest("start=2026-08-06T10:00:00.000Z&end=2026-08-06T11:00:00.000Z"),
      );
      const multiOrgBody = await parseBody(multiOrgResponse);
      const multiStoreBody = await parseBody(multiStoreResponse);

      assert.equal(multiOrgResponse.status, 409);
      assert.equal(multiOrgBody.reasonCode, "multi_org_unsupported");
      assert.equal(multiStoreResponse.status, 409);
      assert.equal(multiStoreBody.reasonCode, "multi_store_unsupported");
    },
  },
  {
    name: "route preserves schedule rpc failure behavior for active account",
    run: async () => {
      const { createScheduleGetHandler } = await loadRouteModule();
      const client = createPrivilegedClientMock({
        data: null,
        error: { message: "rpc failed" },
      });
      const handler = createScheduleGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => client as never,
      });

      const response = await handler(
        buildRequest("start=2026-08-06T10:00:00.000Z&end=2026-08-06T11:00:00.000Z"),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 500);
      assert.equal(body.error, "LOAD_SCHEDULE_FAILED");
      assert.equal(body.message, "rpc failed");
      assert.equal(client.rpcCalls.length, 1);
    },
  },
  {
    name: "production route uses resolveStoreApiAccess and ignores query tenant ids",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/app/api/schedule/route.ts"),
        "utf8",
      );

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes('requirement: "active"'), true);
      assert.equal(source.includes('url.searchParams.get("organizationId")'), false);
      assert.equal(source.includes('url.searchParams.get("storeId")'), false);
      assert.equal(source.includes("createSupabaseServerClient"), false);
      assert.equal(source.includes('.from("memberships")'), false);
      assert.equal(source.includes('.from("stores")'), false);
      assert.equal(source.includes("access.organizationId"), true);
      assert.equal(source.includes("access.storeId"), true);
    },
  },
  {
    name: "module exports a GET handler",
    run: async () => {
      const { GET } = await loadRouteModule();
      assert.equal(typeof GET, "function");
    },
  },
];

async function main() {
  let passed = 0;

  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
    } catch (error) {
      console.error(`FAIL ${test.name}`);
      throw error;
    }
  }

  console.log(`schedule-route: ${passed}/${tests.length} tests passed`);
}

void main();
