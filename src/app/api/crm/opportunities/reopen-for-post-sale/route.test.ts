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

type QueryCall = {
  table: string;
  columns: string;
  filters: Array<{ column: string; value: unknown }>;
};

type QueryResponse = {
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

function createSupabaseMock(args?: {
  opportunity?: QueryResponse;
  rpcResult?: { data: unknown; error: { message: string } | null };
}) {
  const queryCalls: QueryCall[] = [];
  const rpcCalls: RpcCall[] = [];

  return {
    queryCalls,
    rpcCalls,
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

              return args?.opportunity ?? { data: null, error: null };
            },
          };
        },
      };
    },
    async rpc(fn: string, rpcArgs: Record<string, unknown>) {
      rpcCalls.push({ fn, args: rpcArgs });
      return args?.rpcResult ?? {
        data: [
          {
            commercial_opportunity_id: "opportunity-a",
            stage: "pos_venda",
            lifecycle_cycle: 3,
            lifecycle_event_id: "event-1",
            event_type: "post_sale_reopen",
            reason_code: "post_sale_reopen_writer_required",
            stage_changed_at: "2026-08-12T12:00:00.000Z",
            updated_at: "2026-08-12T12:00:00.000Z",
          },
        ],
        error: null,
      };
    },
  };
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "denied access preserves wrapper response and does not read the body",
    run: async () => {
      const { createReopenForPostSalePostHandler } = await loadRouteModule();
      const requestReads = { reads: 0 };
      let resolveCount = 0;

      const response = await createReopenForPostSalePostHandler({
        resolveAccess: async () => {
          resolveCount += 1;
          return createDeniedAccess(409, "store_missing_membership");
        },
      })(
        createJsonRequest(() => {
          throw new Error("body must not be read");
        }, requestReads),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.ok, false);
      assert.equal(body.status, "store_missing_membership");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(requestReads.reads, 0);
      assert.equal(resolveCount, 1);
    },
  },
  {
    name: "explicitly selected concluded opportunity A is reopened without deriving active opportunity B",
    run: async () => {
      const { createReopenForPostSalePostHandler } = await loadRouteModule();
      const requestReads = { reads: 0 };
      const supabase = createSupabaseMock({
        opportunity: {
          data: {
            id: "opportunity-a",
            organization_id: "access-org",
            store_id: "access-store",
            stage: "concluido_sem_mais_acoes",
            lifecycle_cycle: 3,
          },
          error: null,
        },
      });

      const response = await createReopenForPostSalePostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            organizationId: "access-org",
            storeId: "access-store",
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            organizationId: "body-org",
            storeId: "body-store",
            commercialOpportunityId: "opportunity-a",
            expectedStage: "concluido_sem_mais_acoes",
            expectedLifecycleCycle: 3,
            ignoredOtherOpportunityId: "opportunity-b",
          }),
          requestReads,
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.commercialOpportunityId, "opportunity-a");
      assert.equal(
        body.idempotencyKey,
        "crm_reopen_post_sale_opportunity:opportunity-a:3:concluido_sem_mais_acoes",
      );
      assert.equal(requestReads.reads, 1);
      assert.equal(supabase.queryCalls.length, 1);
      assert.deepEqual(supabase.queryCalls[0], {
        table: "commercial_opportunities",
        columns: "id, organization_id, store_id, stage, lifecycle_cycle",
        filters: [
          { column: "id", value: "opportunity-a" },
          { column: "organization_id", value: "access-org" },
          { column: "store_id", value: "access-store" },
        ],
      });
      assert.equal(supabase.rpcCalls.length, 1);
      assert.deepEqual(supabase.rpcCalls[0], {
        fn: "reopen_commercial_opportunity_for_post_sale_by_user",
        args: {
          p_request_organization_id: "access-org",
          p_store_id: "access-store",
          p_commercial_opportunity_id: "opportunity-a",
          p_idempotency_key:
            "crm_reopen_post_sale_opportunity:opportunity-a:3:concluido_sem_mais_acoes",
          p_reason_details: null,
          p_evidence_type: "crm_manual_action",
          p_evidence_message_id: null,
          p_evidence_summary:
            "Reabertura manual confirmada para a opportunity opportunity-a no CRM.",
          p_source: "manual_post_sale_reopen",
        },
      });
    },
  },
  {
    name: "missing explicit opportunity id returns 400 and never calls the writer",
    run: async () => {
      const { createReopenForPostSalePostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock();

      const response = await createReopenForPostSalePostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            organizationId: "body-org",
            storeId: "body-store",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 400);
      assert.equal(body.error, "MISSING_COMMERCIAL_OPPORTUNITY_ID");
      assert.equal(supabase.queryCalls.length, 0);
      assert.equal(supabase.rpcCalls.length, 0);
    },
  },
  {
    name: "missing snapshot fields returns 400 and never calls the writer",
    run: async () => {
      const { createReopenForPostSalePostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        opportunity: {
          data: {
            id: "opportunity-a",
            organization_id: "access-org",
            store_id: "access-store",
            stage: "concluido_sem_mais_acoes",
            lifecycle_cycle: 3,
          },
          error: null,
        },
      });

      const response = await createReopenForPostSalePostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            commercialOpportunityId: "opportunity-a",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 400);
      assert.equal(body.error, "MISSING_OPERATION_SNAPSHOT");
      assert.equal(supabase.rpcCalls.length, 0);
    },
  },
  {
    name: "real non-concluded stage is rejected before rpc even if browser claims concluida",
    run: async () => {
      const { createReopenForPostSalePostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        opportunity: {
          data: {
            id: "opportunity-a",
            organization_id: "access-org",
            store_id: "access-store",
            stage: "orcamento",
            lifecycle_cycle: 3,
          },
          error: null,
        },
      });

      const response = await createReopenForPostSalePostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            commercialOpportunityId: "opportunity-a",
            expectedStage: "concluido_sem_mais_acoes",
            expectedLifecycleCycle: 3,
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(
        body.error,
        "COMMERCIAL_OPPORTUNITY_POST_SALE_REOPEN_NOT_AVAILABLE",
      );
      assert.equal(supabase.rpcCalls.length, 0);
    },
  },
  {
    name: "scope mismatch stays blocked before rpc fallback logic",
    run: async () => {
      const { createReopenForPostSalePostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        opportunity: {
          data: null,
          error: null,
        },
      });

      const response = await createReopenForPostSalePostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            commercialOpportunityId: "cross-tenant-opportunity",
            expectedStage: "concluido_sem_mais_acoes",
            expectedLifecycleCycle: 3,
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 404);
      assert.equal(body.error, "COMMERCIAL_OPPORTUNITY_NOT_FOUND");
      assert.equal(supabase.rpcCalls.length, 0);
    },
  },
  {
    name: "retry of the same logical submission keeps the original snapshot key",
    run: async () => {
      assert.equal(
        "crm_reopen_post_sale_opportunity:opportunity-a:3:concluido_sem_mais_acoes",
        "crm_reopen_post_sale_opportunity:opportunity-a:3:concluido_sem_mais_acoes",
      );
      assert.notEqual(
        "crm_reopen_post_sale_opportunity:opportunity-a:3:concluido_sem_mais_acoes",
        "crm_reopen_post_sale_opportunity:opportunity-a:4:concluido_sem_mais_acoes",
      );
    },
  },
  {
    name: "post-sale reopen with stale replay after success returns controlled 409",
    run: async () => {
      const { createReopenForPostSalePostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        opportunity: {
          data: {
            id: "opportunity-a",
            organization_id: "access-org",
            store_id: "access-store",
            stage: "pos_venda",
            lifecycle_cycle: 3,
          },
          error: null,
        },
        rpcResult: {
          data: null,
          error: {
            message: "ZION_IDEMPOTENT_STAGE_TRANSITION_OBSOLETE",
          },
        },
      });

      const response = await createReopenForPostSalePostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            commercialOpportunityId: "opportunity-a",
            expectedStage: "concluido_sem_mais_acoes",
            expectedLifecycleCycle: 3,
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "POST_SALE_REOPEN_STATE_OUTDATED");
      assert.equal(supabase.rpcCalls.length, 1);
      assert.equal(
        supabase.rpcCalls[0]?.args.p_idempotency_key,
        "crm_reopen_post_sale_opportunity:opportunity-a:3:concluido_sem_mais_acoes",
      );
    },
  },
  {
    name: "production route uses resolveStoreApiAccess and only the user post-sale reopen writer",
    run: async () => {
      const source = readFileSync(
        join(
          process.cwd(),
          "src/app/api/crm/opportunities/reopen-for-post-sale/route.ts",
        ),
        "utf8",
      );

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes('requirement: "active"'), true);
      assert.equal(
        source.includes('"reopen_commercial_opportunity_for_post_sale_by_user"'),
        true,
      );
      assert.equal(
        source.includes("reopen_commercial_opportunity_for_post_sale_by_system"),
        false,
      );
      assert.equal(source.includes("service_role"), false);
      assert.equal(source.includes('.update({ stage:'), false);
      assert.equal(source.includes(".order("), false);
      assert.equal(source.includes("expectedStage"), true);
      assert.equal(source.includes("expectedLifecycleCycle"), true);
    },
  },
];

async function run() {
  const failures: string[] = [];

  for (const test of tests) {
    try {
      await test.run();
      process.stdout.write(`ok - ${test.name}\n`);
    } catch (error) {
      failures.push(
        `not ok - ${test.name}\n${error instanceof Error ? error.stack || error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exit(1);
  }

  process.stdout.write(`1..${tests.length}\n`);
}

void run();
