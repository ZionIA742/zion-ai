import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createDashboardMetricsGetHandler,
  type DashboardMetricsRouteDeps,
} from "./route";
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
  filters: Array<{ op: "eq" | "gte" | "lte" | "in"; column: string; value: unknown }>;
  orders: Array<{ column: string; options: Record<string, unknown> | undefined }>;
  limit: number | null;
};

type QueryResult = {
  data: unknown[];
  error: { message: string } | null;
};

function createDeniedAccess(
  overrides?: Partial<StoreApiAccessDenied>,
): StoreApiAccessDenied {
  return {
    ok: false,
    resolution: {
      domain: "store_area",
      status: "store_missing_membership",
      sessionUserId: null,
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      reasonCode: "missing_membership",
      message: "Conta nao pode acessar esta API.",
    },
    httpStatus: 409,
    payload: {
      ok: false,
      error: "STORE_API_ACCESS_DENIED",
      message: "Sua conta nao pode acessar esta API da loja.",
      status: "store_missing_membership",
      reasonCode: "missing_membership",
    },
    ...overrides,
  };
}

function createGrantedAccess(): StoreApiAccessGranted {
  return {
    ok: true as const,
    supabase: { kind: "server-client" } as never,
    resolution: {
      domain: "store_area" as const,
      status: "store_ready_active" as const,
      sessionUserId: "user-1",
      safeHtmlDestination: "/crm",
      apiDecision: "allow" as const,
      organizationResolution: "single" as const,
      storeResolution: "single" as const,
      organizationId: "server-org",
      storeId: "server-store",
      commercialAccess: "allowed" as const,
      reasonCode: "ready_active" as const,
      message: "Conta pronta.",
    },
    sessionUserId: "user-1",
    organizationId: "server-org",
    storeId: "server-store",
  };
}

function createPrivilegedClientMock(
  calls: QueryCall[],
  responses?: Partial<Record<string, QueryResult | QueryResult[]>>,
) {
  return {
    from(table: string) {
      const call: QueryCall = {
        table,
        columns: "",
        filters: [],
        orders: [],
        limit: null,
      };

      return {
        select(columns: string) {
          call.columns = columns;

          const builder = {
            eq(column: string, value: unknown) {
              call.filters.push({ op: "eq", column, value });
              return builder;
            },
            gte(column: string, value: unknown) {
              call.filters.push({ op: "gte", column, value });
              return builder;
            },
            lte(column: string, value: unknown) {
              call.filters.push({ op: "lte", column, value });
              return builder;
            },
            in(column: string, value: readonly unknown[]) {
              call.filters.push({ op: "in", column, value: [...value] });
              return builder;
            },
            order(
              column: string,
              options?: Record<string, unknown>,
            ) {
              call.orders.push({ column, options });
              return builder;
            },
            async limit(value: number) {
              call.limit = value;
              calls.push(call);

              const response = responses?.[table];
              if (Array.isArray(response)) {
                return response.shift() ?? { data: [], error: null };
              }

              return response ?? { data: [], error: null };
            },
          };

          return builder;
        },
      };
    },
  };
}

function createHandlerHarness(options?: {
  accessResult?: Awaited<ReturnType<DashboardMetricsRouteDeps["resolveAccess"]>>;
  responses?: Partial<Record<string, QueryResult | QueryResult[]>>;
  events?: string[];
}) {
  let resolveCount = 0;
  let clientCreateCount = 0;
  const calls: QueryCall[] = [];

  const handler = createDashboardMetricsGetHandler({
    async resolveAccess() {
      options?.events?.push("resolve:start");
      resolveCount += 1;
      const result = options?.accessResult ?? createGrantedAccess();
      options?.events?.push(
        result.ok ? "resolve:granted" : `resolve:denied:${result.httpStatus}`,
      );
      return result;
    },
    createPrivilegedClient() {
      options?.events?.push("client:create");
      clientCreateCount += 1;
      return createPrivilegedClientMock(calls, options?.responses) as never;
    },
  });

  return {
    handler,
    calls,
    getResolveCount: () => resolveCount,
    getClientCreateCount: () => clientCreateCount,
  };
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function expectDeniedStatus(
  denied: StoreApiAccessDenied,
  expectedStatus: 401 | 403 | 409 | 503,
) {
  const harness = createHandlerHarness({ accessResult: denied });
  const response = await harness.handler(
    new Request(
      "https://example.test/api/dashboard/metrics?organizationId=client-org&storeId=client-store",
    ),
  );
  const body = await parseBody(response);

  assert.equal(response.status, expectedStatus);
  assert.equal(body.ok, false);
  assert.equal(harness.getResolveCount(), 1);
  assert.equal(harness.getClientCreateCount(), 0);
}

const tests: TestCase[] = [
  {
    name: "401 denied response is preserved and does not create service role client",
    run: async () => {
      await expectDeniedStatus(
        createDeniedAccess({
          httpStatus: 401,
          payload: {
            ok: false,
            error: "STORE_API_UNAUTHENTICATED",
            message: "Faca login para acessar esta API da loja.",
            status: "anonymous",
            reasonCode: "anonymous",
          },
          resolution: {
            ...createDeniedAccess().resolution,
            domain: "anonymous",
            status: "anonymous",
            reasonCode: "anonymous",
          },
        }),
        401,
      );
    },
  },
  {
    name: "403 denied response is preserved and does not create service role client",
    run: async () => {
      await expectDeniedStatus(
        createDeniedAccess({
          httpStatus: 403,
          payload: {
            ok: false,
            error: "STORE_API_FORBIDDEN",
            message: "Sua conta nao pode acessar esta API da loja.",
            status: "cross_domain_forbidden",
            reasonCode: "zion_admin_cannot_access_store_area",
          },
          resolution: {
            ...createDeniedAccess().resolution,
            domain: "zion_admin",
            status: "cross_domain_forbidden",
            reasonCode: "zion_admin_cannot_access_store_area",
          },
        }),
        403,
      );
    },
  },
  {
    name: "409 denied response is preserved and does not create service role client",
    run: async () => {
      await expectDeniedStatus(createDeniedAccess(), 409);
    },
  },
  {
    name: "503 denied response is preserved and does not create service role client",
    run: async () => {
      await expectDeniedStatus(
        createDeniedAccess({
          httpStatus: 503,
          payload: {
            ok: false,
            error: "STORE_API_ACCESS_UNAVAILABLE",
            message: "Nao foi possivel validar o acesso desta API da loja no momento.",
            status: "access_resolution_unavailable",
            reasonCode: "request_auth_unavailable",
          },
          resolution: {
            ...createDeniedAccess().resolution,
            domain: "unresolved",
            status: "access_resolution_unavailable",
            safeHtmlDestination: "/account/access-unavailable",
            apiDecision: "deny_503",
            reasonCode: "request_auth_unavailable",
          },
        }),
        503,
      );
    },
  },
  {
    name: "success uses server-side organization and store ids for every query",
    run: async () => {
      const harness = createHandlerHarness();
      const response = await harness.handler(
        new Request(
          "https://example.test/api/dashboard/metrics?organizationId=client-org&storeId=client-store",
        ),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.organizationId, "server-org");
      assert.equal(body.storeId, "server-store");
      assert.equal(harness.getResolveCount(), 1);
      assert.equal(harness.getClientCreateCount(), 1);
      assert.equal(harness.calls.length, 12);

      for (const call of harness.calls) {
        assert.equal(
          call.filters.some(
            (filter) =>
              filter.op === "eq" &&
              filter.column === "organization_id" &&
              filter.value === "server-org",
          ),
          true,
          `missing organization scope for ${call.table}`,
        );

        if (call.table === "conversations") {
          assert.equal(
            call.filters.some(
              (filter) =>
                filter.op === "in" &&
                filter.column === "lead_id",
            ),
            true,
            "conversations must be scoped through authorized store leads",
          );
          continue;
        }

        assert.equal(
          call.filters.some(
            (filter) =>
              filter.op === "eq" &&
              filter.column === "store_id" &&
              filter.value === "server-store",
          ),
          true,
          `missing store scope for ${call.table}`,
        );
      }
    },
  },
  {
    name: "conversations query avoids missing store_id and scopes through authorized store leads",
    run: async () => {
      const harness = createHandlerHarness({
        responses: {
          leads: {
            data: [
              {
                id: "lead-store-1",
                name: "Lead da loja",
                phone: null,
                state: "novo_lead",
                created_at: "2026-08-06T12:00:00.000Z",
                updated_at: null,
              },
            ],
            error: null,
          },
        },
      });

      await harness.handler(new Request("https://example.test/api/dashboard/metrics"));

      const conversationsCall = harness.calls.find(
        (call) => call.table === "conversations",
      );

      assert.ok(conversationsCall);
      assert.equal(conversationsCall.columns.includes("store_id"), false);
      assert.equal(
        conversationsCall.filters.some(
          (filter) => filter.op === "eq" && filter.column === "store_id",
        ),
        false,
      );
      assert.deepEqual(
        conversationsCall.filters.find(
          (filter) => filter.op === "in" && filter.column === "lead_id",
        )?.value,
        ["lead-store-1"],
      );
    },
  },
  {
    name: "monthly sales goal is read from canonical store settings scope",
    run: async () => {
      const harness = createHandlerHarness({
        responses: {
          store_monthly_sales_goals: {
            data: [
              {
                organization_id: "server-org",
                store_id: "server-store",
                monthly_goal_enabled: true,
                monthly_goal_amount_cents: 250000,
                created_at: "2026-09-01T00:00:00.000Z",
                updated_at: "2026-09-01T00:00:00.000Z",
              },
            ],
            error: null,
          },
        },
      });

      const response = await harness.handler(
        new Request(
          "https://example.test/api/dashboard/metrics?organizationId=attacker-org&storeId=attacker-store",
        ),
      );
      const body = await parseBody(response);
      const summary = body.summary as Record<string, unknown>;
      const sales = summary.sales as Record<string, unknown>;
      const monthlyGoal = sales.monthlyGoal as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(monthlyGoal.enabled, true);
      assert.equal(monthlyGoal.amountCents, 250000);
      assert.equal(monthlyGoal.configured, true);
      assert.equal(monthlyGoal.revenueKnown, false);
      assert.equal(monthlyGoal.progressPercent, null);
      assert.equal(monthlyGoal.remainingCents, null);
      assert.equal(sales.revenueMonthCents, null);

      const goalCall = harness.calls.find(
        (call) => call.table === "store_monthly_sales_goals",
      );
      assert.ok(goalCall);
      assert.equal(
        goalCall.filters.some(
          (filter) =>
            filter.op === "eq" &&
            filter.column === "organization_id" &&
            filter.value === "server-org",
        ),
        true,
      );
      assert.equal(
        goalCall.filters.some(
          (filter) =>
            filter.op === "eq" &&
            filter.column === "store_id" &&
            filter.value === "server-store",
        ),
        true,
      );
    },
  },
  {
    name: "success preserves public payload shape",
    run: async () => {
      const harness = createHandlerHarness();
      const response = await harness.handler(
        new Request("https://example.test/api/dashboard/metrics"),
      );
      const body = await parseBody(response);

      assert.deepEqual(Object.keys(body).sort(), [
        "generatedAt",
        "lists",
        "ok",
        "organizationId",
        "period",
        "storeId",
        "summary",
      ]);
    },
  },
  {
    name: "query failures return sanitized 500 payload",
    run: async () => {
      const harness = createHandlerHarness({
        responses: {
          leads: {
            data: [],
            error: { message: "relation public.leads exploded" },
          },
        },
      });
      const response = await harness.handler(
        new Request("https://example.test/api/dashboard/metrics"),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 500);
      assert.equal(body.ok, false);
      assert.equal(body.error, "LOAD_DASHBOARD_METRICS_FAILED");
      assert.equal(
        body.message,
        "Nao foi possivel carregar as metricas do dashboard no momento.",
      );
    },
  },
  {
    name: "missing privileged env returns sanitized 500 payload",
    run: async () => {
      const handler = createDashboardMetricsGetHandler({
        async resolveAccess() {
          return createGrantedAccess();
        },
        createPrivilegedClient() {
          throw new Error("SUPABASE_ENV_MISSING");
        },
      });

      const response = await handler(
        new Request("https://example.test/api/dashboard/metrics"),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 500);
      assert.equal(body.error, "DASHBOARD_METRICS_ROUTE_FAILED");
      assert.equal(
        body.message,
        "Nao foi possivel carregar as metricas do dashboard no momento.",
      );
      const serialized = JSON.stringify(body);
      assert.equal(serialized.includes("SUPABASE_ENV_MISSING"), false);
    },
  },
  {
    name: "success creates privileged client only after granted access resolution",
    run: async () => {
      const events: string[] = [];
      const harness = createHandlerHarness({ events });

      const response = await harness.handler(
        new Request("https://example.test/api/dashboard/metrics"),
      );

      assert.equal(response.status, 200);
      assert.deepEqual(events.slice(0, 3), [
        "resolve:start",
        "resolve:granted",
        "client:create",
      ]);
    },
  },
  {
    name: "denied access performs no client creation or query before authorization",
    run: async () => {
      const events: string[] = [];
      const harness = createHandlerHarness({
        accessResult: createDeniedAccess(),
        events,
      });

      const response = await harness.handler(
        new Request("https://example.test/api/dashboard/metrics"),
      );

      assert.equal(response.status, 409);
      assert.deepEqual(events, ["resolve:start", "resolve:denied:409"]);
      assert.equal(harness.getClientCreateCount(), 0);
      assert.equal(harness.calls.length, 0);
    },
  },
  {
    name: "route source keeps canonical access integration and avoids forbidden shortcuts",
    run: () => {
      const source = readFileSync(join(__dirname, "route.ts"), "utf8");

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes('resolveAccess({ requirement: "active" })'), true);
      assert.equal(source.includes("createStoreApiDeniedResponse(access)"), true);
      assert.equal(
        source.includes("export const GET = createDashboardMetricsGetHandler();"),
        true,
      );
      assert.equal(source.includes('searchParams.get("organizationId")'), false);
      assert.equal(source.includes('searchParams.get("storeId")'), false);
      assert.equal(source.includes("resolveAccessForRequest"), false);
      assert.equal(/getSession\s*\(/.test(source), false);
    },
  },
  {
    name: "dashboard consumer no longer sends ids in fetch url",
    run: () => {
      const source = readFileSync(
        join(__dirname, "../../../(app)/dashboard/page.tsx"),
        "utf8",
      );

      assert.equal(source.includes("/api/dashboard/metrics?organizationId="), false);
      assert.equal(source.includes("&storeId="), false);
      assert.equal(source.includes('fetch("/api/dashboard/metrics"'), true);
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`dashboard-metrics-route: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
