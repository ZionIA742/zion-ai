import { strict as assert } from "node:assert";
import Module from "node:module";
import { join } from "node:path";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type QueryCall = {
  table: string;
  columns: string;
  filters: Array<{ column: string; value: unknown }>;
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
      reasonCode: "missing_membership",
      message: "Mensagem interna.",
    },
    httpStatus,
    payload: {
      ok: false,
      error:
        httpStatus === 401
          ? "STORE_API_UNAUTHENTICATED"
          : httpStatus === 503
            ? "STORE_API_ACCESS_UNAVAILABLE"
            : httpStatus === 403
              ? "STORE_API_FORBIDDEN"
              : "STORE_API_ACCESS_DENIED",
      message: "Mensagem publica.",
      status,
      reasonCode: "missing_membership",
    },
  };
}

function createSupabaseMock(args?: {
  opportunity?: { data: unknown; error: { message: string } | null };
}) {
  const queryCalls: QueryCall[] = [];

  return {
    queryCalls,
    from(table: string) {
      return {
        select(columns: string) {
          const filters: Array<{ column: string; value: unknown }> = [];

          return {
            eq(column: string, value: unknown) {
              filters.push({ column, value });
              return this;
            },
            async maybeSingle() {
              queryCalls.push({
                table,
                columns,
                filters: [...filters],
              });

              return args?.opportunity ?? {
                data: {
                  id: "opportunity-1",
                  organization_id: "access-org",
                  store_id: "access-store",
                },
                error: null,
              };
            },
          };
        },
      };
    },
  };
}

function createGrantedAccess(
  overrides?: Partial<StoreApiAccessGranted>,
): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: createSupabaseMock() as unknown as StoreApiAccessGranted["supabase"],
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

function readinessDecision(state: "ready" | "blocked" | "needs_resolution" | "conflict") {
  return {
    ok: true as const,
    decision: {
      actionKey: "send_quote" as const,
      readinessState: state,
      reasonCode: `${state}_reason`,
      blockingItems: state === "ready" ? [] : [{ item_key: "required_fact" }],
      readinessBasis: { source: "test" },
      authorityFingerprint: "fp-1",
      resolverKey: "commercial_action_readiness_v1",
      resolverVersion: 1,
    },
  };
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "denied access returns wrapper response and does not read body",
    run: async () => {
      const { createActionReadinessPostHandler } = await loadRouteModule();
      const reads = { reads: 0 };
      let serviceCreated = false;
      let refreshed = false;
      const response = await createActionReadinessPostHandler({
        resolveAccess: async () => createDeniedAccess(409, "store_missing_membership"),
        createServiceSupabaseClient: () => {
          serviceCreated = true;
          return {};
        },
        refreshActionReadiness: async () => {
          refreshed = true;
          return readinessDecision("ready");
        },
      })(
        createJsonRequest(() => {
          throw new Error("body must not be read");
        }, reads),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.status, "store_missing_membership");
      assert.equal(reads.reads, 0);
      assert.equal(serviceCreated, false);
      assert.equal(refreshed, false);
    },
  },
  {
    name: "uses access scope and ignores tenant ids from request body",
    run: async () => {
      const { createActionReadinessPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock();
      const refreshCalls: Array<Record<string, unknown>> = [];
      const serviceClient = { service: true };

      const response = await createActionReadinessPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            organizationId: "access-org",
            storeId: "access-store",
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
        createServiceSupabaseClient: () => serviceClient,
        refreshActionReadiness: async (payload) => {
          refreshCalls.push(payload as unknown as Record<string, unknown>);
          return readinessDecision("ready");
        },
      })(
        createJsonRequest(
          () => ({
            organizationId: "body-org",
            storeId: "body-store",
            commercialOpportunityId: "opportunity-1",
            actionKey: "send_quote",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.readinessState, "ready");
      assert.deepEqual(supabase.queryCalls[0], {
        table: "commercial_opportunities",
        columns: "id, organization_id, store_id",
        filters: [
          { column: "id", value: "opportunity-1" },
          { column: "organization_id", value: "access-org" },
          { column: "store_id", value: "access-store" },
        ],
      });
      assert.deepEqual(refreshCalls[0], {
        supabase: serviceClient,
        organizationId: "access-org",
        storeId: "access-store",
        commercialOpportunityId: "opportunity-1",
        actionKey: "send_quote",
      });
    },
  },
  {
    name: "missing opportunity id returns 400 before scoped lookup",
    run: async () => {
      const { createActionReadinessPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock();
      const response = await createActionReadinessPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(createJsonRequest(() => ({ actionKey: "send_quote" }), { reads: 0 }));

      const body = await parseBody(response);
      assert.equal(response.status, 400);
      assert.equal(body.error, "MISSING_COMMERCIAL_OPPORTUNITY_ID");
      assert.equal(supabase.queryCalls.length, 0);
    },
  },
  {
    name: "unknown action key returns 400 before service client and readiness refresh",
    run: async () => {
      const { createActionReadinessPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock();
      let serviceCreated = false;
      let refreshed = false;

      const response = await createActionReadinessPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
        createServiceSupabaseClient: () => {
          serviceCreated = true;
          return {};
        },
        refreshActionReadiness: async () => {
          refreshed = true;
          return readinessDecision("ready");
        },
      })(
        createJsonRequest(
          () => ({
            commercialOpportunityId: "opportunity-1",
            actionKey: "not_real",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 400);
      assert.equal(body.error, "COMMERCIAL_ACTION_KEY_INVALID");
      assert.equal(supabase.queryCalls.length, 0);
      assert.equal(serviceCreated, false);
      assert.equal(refreshed, false);
    },
  },
  {
    name: "opportunity must resolve inside current organization and store",
    run: async () => {
      const { createActionReadinessPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        opportunity: { data: null, error: null },
      });
      let refreshed = false;
      const response = await createActionReadinessPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
        refreshActionReadiness: async () => {
          refreshed = true;
          return readinessDecision("ready");
        },
      })(
        createJsonRequest(
          () => ({
            commercialOpportunityId: "other-tenant-opportunity",
            actionKey: "send_quote",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 404);
      assert.equal(body.error, "COMMERCIAL_OPPORTUNITY_NOT_FOUND");
      assert.equal(refreshed, false);
    },
  },
  {
    name: "materialization or read failure fails closed",
    run: async () => {
      const { createActionReadinessPostHandler } = await loadRouteModule();
      const response = await createActionReadinessPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createServiceSupabaseClient: () => ({}),
        refreshActionReadiness: async () => ({
          ok: false,
          error: "READINESS_READ_FAILED",
          message: "read failed",
        }),
      })(
        createJsonRequest(
          () => ({
            commercialOpportunityId: "opportunity-1",
            actionKey: "send_quote",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 503);
      assert.equal(body.error, "COMMERCIAL_ACTION_READINESS_UNAVAILABLE");
    },
  },
  {
    name: "blocked, needs_resolution and conflict stay distinct",
    run: async () => {
      const { createActionReadinessPostHandler } = await loadRouteModule();

      for (const [state, error] of [
        ["blocked", "COMMERCIAL_ACTION_BLOCKED"],
        ["needs_resolution", "COMMERCIAL_ACTION_NEEDS_RESOLUTION"],
        ["conflict", "COMMERCIAL_ACTION_CONFLICT"],
      ] as const) {
        const response = await createActionReadinessPostHandler({
          resolveAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => ({}),
          refreshActionReadiness: async () => readinessDecision(state),
        })(
          createJsonRequest(
            () => ({
              commercialOpportunityId: "opportunity-1",
              actionKey: "send_quote",
            }),
            { reads: 0 },
          ),
        );

        const body = await parseBody(response);
        assert.equal(response.status, 409);
        assert.equal(body.error, error);
        assert.equal(body.readinessState, state);
        assert.equal(body.reasonCode, `${state}_reason`);
      }
    },
  },
];

void (async () => {
  const failures: string[] = [];

  for (const testCase of tests) {
    try {
      await testCase.run();
      process.stdout.write(`ok - ${testCase.name}\n`);
    } catch (error) {
      failures.push(
        `not ok - ${testCase.name}\n${error instanceof Error ? error.stack || error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  }
})();
