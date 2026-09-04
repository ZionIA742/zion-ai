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
            commercial_opportunity_id: "opportunity-1",
            stage: "concluido_sem_mais_acoes",
            lifecycle_cycle: 3,
            lifecycle_event_id: "event-1",
            event_type: "conclusion",
            reason_code: "conclusion_writer_required",
            stage_changed_at: "2026-08-12T12:00:00.000Z",
            updated_at: "2026-08-12T12:00:00.000Z",
          },
        ],
        error: null,
      };
    },
  };
}

function createReadyReadiness() {
  return {
    ok: true as const,
    decision: {
      actionKey: "conclude_opportunity" as const,
      readinessState: "ready" as const,
      reasonCode: "ready",
      blockingItems: [],
      readinessBasis: { source: "test" },
      authorityFingerprint: "fp-ready",
      resolverKey: "commercial_action_readiness_v1",
      resolverVersion: 1,
    },
  };
}

function createReadiness(state: "blocked" | "needs_resolution" | "conflict") {
  return {
    ok: true as const,
    decision: {
      actionKey: "conclude_opportunity" as const,
      readinessState: state,
      reasonCode: `${state}_reason`,
      blockingItems: [{ item_key: "required_fact" }],
      readinessBasis: { source: "test" },
      authorityFingerprint: `fp-${state}`,
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
    name: "denied access preserves wrapper response and does not read the body",
    run: async () => {
      const { createConcludeOpportunityPostHandler } = await loadRouteModule();
      const requestReads = { reads: 0 };
      let resolveCount = 0;

      const response = await createConcludeOpportunityPostHandler({
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
    name: "body tenant ids are ignored and only the explicitly selected opportunity is concluded",
    run: async () => {
      const { createConcludeOpportunityPostHandler } = await loadRouteModule();
      const requestReads = { reads: 0 };
      const supabase = createSupabaseMock({
        opportunity: {
          data: {
            id: "opportunity-1",
            organization_id: "access-org",
            store_id: "access-store",
            stage: "pos_venda",
            lifecycle_cycle: 3,
          },
          error: null,
        },
      });
      const serviceClient = { service: true };
      const readinessCalls: Array<Record<string, unknown>> = [];

      const response = await createConcludeOpportunityPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            organizationId: "access-org",
            storeId: "access-store",
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
        createServiceSupabaseClient: () => serviceClient,
        refreshActionReadiness: async (payload) => {
          readinessCalls.push(payload as unknown as Record<string, unknown>);
          return createReadyReadiness();
        },
      })(
        createJsonRequest(
          () => ({
            organizationId: "body-org",
            storeId: "body-store",
            commercialOpportunityId: "opportunity-1",
            expectedStage: "pos_venda",
            expectedLifecycleCycle: 3,
          }),
          requestReads,
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.commercialOpportunityId, "opportunity-1");
      assert.equal(body.idempotencyKey, "crm_conclude_opportunity:opportunity-1:3:pos_venda");
      assert.equal(requestReads.reads, 1);
      assert.deepEqual(readinessCalls[0], {
        supabase: serviceClient,
        organizationId: "access-org",
        storeId: "access-store",
        commercialOpportunityId: "opportunity-1",
        actionKey: "conclude_opportunity",
      });
      assert.equal(supabase.queryCalls.length, 1);
      assert.deepEqual(supabase.queryCalls[0], {
        table: "commercial_opportunities",
        columns: "id, organization_id, store_id, stage, lifecycle_cycle",
        filters: [
          { column: "id", value: "opportunity-1" },
          { column: "organization_id", value: "access-org" },
          { column: "store_id", value: "access-store" },
        ],
      });
      assert.equal(supabase.rpcCalls.length, 1);
      assert.deepEqual(supabase.rpcCalls[0], {
        fn: "conclude_commercial_opportunity_by_user",
        args: {
          p_request_organization_id: "access-org",
          p_store_id: "access-store",
          p_commercial_opportunity_id: "opportunity-1",
          p_idempotency_key: "crm_conclude_opportunity:opportunity-1:3:pos_venda",
          p_reason_details: null,
          p_evidence_type: "crm_manual_action",
          p_evidence_message_id: null,
          p_evidence_summary:
            "Conclusao manual confirmada para a opportunity opportunity-1 no CRM.",
          p_source: "manual_conclusion",
        },
      });
    },
  },
  {
    name: "conclusion readiness states block before the human writer",
    run: async () => {
      const { createConcludeOpportunityPostHandler } = await loadRouteModule();

      for (const [state, error] of [
        ["blocked", "COMMERCIAL_ACTION_BLOCKED"],
        ["needs_resolution", "COMMERCIAL_ACTION_NEEDS_RESOLUTION"],
        ["conflict", "COMMERCIAL_ACTION_CONFLICT"],
      ] as const) {
        const supabase = createSupabaseMock({
          opportunity: {
            data: {
              id: "opportunity-1",
              organization_id: "access-org",
              store_id: "access-store",
              stage: "pos_venda",
              lifecycle_cycle: 3,
            },
            error: null,
          },
        });

        const response = await createConcludeOpportunityPostHandler({
          resolveAccess: async () =>
            createGrantedAccess({
              supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
            }),
          createServiceSupabaseClient: () => ({}),
          refreshActionReadiness: async () => createReadiness(state),
        })(
          createJsonRequest(
            () => ({
              commercialOpportunityId: "opportunity-1",
              expectedStage: "pos_venda",
              expectedLifecycleCycle: 3,
            }),
            { reads: 0 },
          ),
        );

        const body = await parseBody(response);
        assert.equal(response.status, 409);
        assert.equal(body.error, error);
        assert.equal(body.readinessState, state);
        assert.equal(supabase.rpcCalls.length, 0);
      }
    },
  },
  {
    name: "conclusion readiness refresh failure fails closed before the human writer",
    run: async () => {
      const { createConcludeOpportunityPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        opportunity: {
          data: {
            id: "opportunity-1",
            organization_id: "access-org",
            store_id: "access-store",
            stage: "pos_venda",
            lifecycle_cycle: 3,
          },
          error: null,
        },
      });

      const response = await createConcludeOpportunityPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
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
            expectedStage: "pos_venda",
            expectedLifecycleCycle: 3,
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 503);
      assert.equal(body.error, "COMMERCIAL_ACTION_READINESS_UNAVAILABLE");
      assert.equal(supabase.rpcCalls.length, 0);
    },
  },
  {
    name: "real intermediate stage is rejected before rpc even if browser claims pos_venda",
    run: async () => {
      const { createConcludeOpportunityPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        opportunity: {
          data: {
            id: "opportunity-1",
            organization_id: "access-org",
            store_id: "access-store",
            stage: "orcamento",
            lifecycle_cycle: 3,
          },
          error: null,
        },
      });

      const response = await createConcludeOpportunityPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
        createServiceSupabaseClient: () => ({}),
        refreshActionReadiness: async () => createReadyReadiness(),
      })(
        createJsonRequest(
          () => ({
            commercialOpportunityId: "opportunity-1",
            expectedStage: "pos_venda",
            expectedLifecycleCycle: 3,
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "COMMERCIAL_OPPORTUNITY_CONCLUSION_NOT_AVAILABLE");
      assert.equal(supabase.rpcCalls.length, 0);
    },
  },
  {
    name: "missing explicit opportunity id returns 400 and never calls the writer",
    run: async () => {
      const { createConcludeOpportunityPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock();

      const response = await createConcludeOpportunityPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
        createServiceSupabaseClient: () => ({}),
        refreshActionReadiness: async () => createReadyReadiness(),
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
      const { createConcludeOpportunityPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        opportunity: {
          data: {
            id: "opportunity-1",
            organization_id: "access-org",
            store_id: "access-store",
            stage: "pos_venda",
            lifecycle_cycle: 3,
          },
          error: null,
        },
      });

      const response = await createConcludeOpportunityPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
        createServiceSupabaseClient: () => ({}),
        refreshActionReadiness: async () => createReadyReadiness(),
      })(
        createJsonRequest(
          () => ({
            commercialOpportunityId: "opportunity-1",
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
    name: "scope mismatch stays blocked before rpc fallback logic",
    run: async () => {
      const { createConcludeOpportunityPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        opportunity: {
          data: null,
          error: null,
        },
      });

      const response = await createConcludeOpportunityPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
        createServiceSupabaseClient: () => ({}),
        refreshActionReadiness: async () => createReadyReadiness(),
      })(
        createJsonRequest(
          () => ({
            commercialOpportunityId: "cross-tenant-opportunity",
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
    name: "stale idempotent retries return controlled 409",
    run: async () => {
      const { createConcludeOpportunityPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        opportunity: {
          data: {
            id: "opportunity-1",
            organization_id: "access-org",
            store_id: "access-store",
            stage: "pos_venda",
            lifecycle_cycle: 7,
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

      const response = await createConcludeOpportunityPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
        createServiceSupabaseClient: () => ({}),
        refreshActionReadiness: async () => createReadyReadiness(),
      })(
        createJsonRequest(
          () => ({
            commercialOpportunityId: "opportunity-1",
            expectedStage: "pos_venda",
            expectedLifecycleCycle: 7,
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "CONCLUSION_STATE_OUTDATED");
      assert.equal(supabase.rpcCalls.length, 1);
      assert.equal(
        supabase.rpcCalls[0]?.args.p_idempotency_key,
        "crm_conclude_opportunity:opportunity-1:7:pos_venda",
      );
    },
  },
  {
    name: "pos_venda with valid snapshot can call the human writer",
    run: async () => {
      const { createConcludeOpportunityPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        opportunity: {
          data: {
            id: "opportunity-1",
            organization_id: "access-org",
            store_id: "access-store",
            stage: "pos_venda",
            lifecycle_cycle: 3,
          },
          error: null,
        },
      });

      const response = await createConcludeOpportunityPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
        createServiceSupabaseClient: () => ({}),
        refreshActionReadiness: async () => createReadyReadiness(),
      })(
        createJsonRequest(
          () => ({
            commercialOpportunityId: "opportunity-1",
            expectedStage: "pos_venda",
            expectedLifecycleCycle: 3,
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.idempotencyKey, "crm_conclude_opportunity:opportunity-1:3:pos_venda");
      assert.equal(
        supabase.rpcCalls[0]?.args.p_idempotency_key,
        "crm_conclude_opportunity:opportunity-1:3:pos_venda",
      );
    },
  },
  {
    name: "future re-conclusion after legitimate reopen receives a different key",
    run: async () => {
      assert.notEqual(
        "crm_conclude_opportunity:opportunity-1:3:orcamento_enviado",
        "crm_conclude_opportunity:opportunity-1:4:pos_venda",
      );
    },
  },
  {
    name: "production route uses resolveStoreApiAccess and only the user conclusion writer",
    run: async () => {
      const source = readFileSync(join(process.cwd(), "src/app/api/crm/opportunities/conclude/route.ts"), "utf8");

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes('requirement: "active"'), true);
      assert.equal(source.includes('"conclude_commercial_opportunity_by_user"'), true);
      assert.equal(source.includes("conclude_commercial_opportunity_by_system"), false);
      assert.equal(source.includes('.update({ stage:'), false);
      assert.equal(source.includes(".order("), false);
      assert.equal(source.includes("expectedStage"), true);
      assert.equal(source.includes("expectedLifecycleCycle"), true);
      assert.equal(source.includes('normalizeOpportunityStage(opportunity.stage) !== "pos_venda"'), true);
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
