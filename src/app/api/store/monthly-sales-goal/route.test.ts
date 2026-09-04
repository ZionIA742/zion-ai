import { strict as assert } from "node:assert";
import Module from "node:module";
import { join } from "node:path";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

type ResolveFilenameHook = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) => string;
type ModuleWithResolveFilename = typeof Module & { _resolveFilename: ResolveFilenameHook };
const projectSrcPath = join(process.cwd(), "src");
const moduleWithResolveFilename = Module as ModuleWithResolveFilename;
const originalResolveFilename = moduleWithResolveFilename._resolveFilename;

moduleWithResolveFilename._resolveFilename = function resolveFilenamePatched(
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(
      this,
      join(projectSrcPath, request.slice(2)),
      parent,
      isMain,
      options,
    );
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

type TestCase = { name: string; run: () => Promise<void> | void };

function createDeniedAccess(): StoreApiAccessDenied {
  return {
    ok: false,
    resolution: {
      domain: "anonymous",
      status: "anonymous",
      sessionUserId: null,
      safeHtmlDestination: "/login",
      apiDecision: "deny_401",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      reasonCode: "anonymous",
      message: "Login required.",
    },
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

function createGrantedAccess(supabase: unknown): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: supabase as StoreApiAccessGranted["supabase"],
    resolution: {
      domain: "store_area",
      status: "store_ready_active",
      sessionUserId: "user-1",
      safeHtmlDestination: "/crm",
      apiDecision: "allow",
      organizationResolution: "single",
      storeResolution: "single",
      organizationId: "server-org",
      storeId: "server-store",
      commercialAccess: "allowed",
      reasonCode: "ready_active",
      message: "Conta pronta.",
    },
    sessionUserId: "user-1",
    organizationId: "server-org",
    storeId: "server-store",
  };
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "GET returns denied access before reading canonical table",
    run: async () => {
      const { createStoreMonthlySalesGoalGetHandler } = await import("./route");
      const handler = createStoreMonthlySalesGoalGetHandler({
        resolveAccess: async () => createDeniedAccess(),
      });

      const response = await handler(new Request("https://example.test/api/store/monthly-sales-goal"));
      const body = await parseBody(response);

      assert.equal(response.status, 401);
      assert.equal(body.error, "STORE_API_UNAUTHENTICATED");
    },
  },
  {
    name: "GET scopes canonical read with server organization and store ids",
    run: async () => {
      const { createStoreMonthlySalesGoalGetHandler } = await import("./route");
      const filters: Array<{ column: string; value: unknown }> = [];
      const supabase = {
        from(table: string) {
          assert.equal(table, "store_monthly_sales_goals");
          const builder = {
            select() { return builder; },
            eq(column: string, value: unknown) {
              filters.push({ column, value });
              return builder;
            },
            async maybeSingle() {
              return {
                data: {
                  organization_id: "server-org",
                  store_id: "server-store",
                  monthly_goal_enabled: true,
                  monthly_goal_amount_cents: 300000,
                },
                error: null,
              };
            },
          };
          return builder;
        },
      };
      const handler = createStoreMonthlySalesGoalGetHandler({
        resolveAccess: async () => createGrantedAccess(supabase),
      });

      const response = await handler(
        new Request("https://example.test/api/store/monthly-sales-goal?organizationId=attacker"),
      );
      const body = await parseBody(response);
      const goal = body.goal as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(goal.enabled, true);
      assert.equal(goal.amountCents, 300000);
      assert.deepEqual(filters, [
        { column: "organization_id", value: "server-org" },
        { column: "store_id", value: "server-store" },
      ]);
    },
  },
  {
    name: "POST validates enabled amount before canonical writer",
    run: async () => {
      const { createStoreMonthlySalesGoalPostHandler } = await import("./route");
      let rpcCalls = 0;
      const supabase = {
        rpc() {
          rpcCalls += 1;
          throw new Error("must not call rpc");
        },
      };
      const handler = createStoreMonthlySalesGoalPostHandler({
        resolveAccess: async () => createGrantedAccess(supabase),
      });

      const response = await handler(
        new Request("https://example.test/api/store/monthly-sales-goal", {
          method: "POST",
          body: JSON.stringify({ enabled: true, amountCents: 0 }),
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "STORE_MONTHLY_SALES_GOAL_INVALID");
      assert.equal(rpcCalls, 0);
    },
  },
  {
    name: "POST sends canonical server scope to RPC",
    run: async () => {
      const { createStoreMonthlySalesGoalPostHandler } = await import("./route");
      let rpcPayload: Record<string, unknown> | null = null;
      const supabase = {
        async rpc(fn: string, payload: Record<string, unknown>) {
          assert.equal(fn, "upsert_store_monthly_sales_goal_scoped");
          rpcPayload = payload;
          return {
            data: [{
              organization_id: "server-org",
              store_id: "server-store",
              monthly_goal_enabled: true,
              monthly_goal_amount_cents: 450000,
            }],
            error: null,
          };
        },
      };
      const handler = createStoreMonthlySalesGoalPostHandler({
        resolveAccess: async () => createGrantedAccess(supabase),
      });

      const response = await handler(
        new Request("https://example.test/api/store/monthly-sales-goal", {
          method: "POST",
          body: JSON.stringify({
            organizationId: "attacker-org",
            storeId: "attacker-store",
            enabled: true,
            amountCents: 450000,
          }),
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.deepEqual(rpcPayload, {
        p_organization_id: "server-org",
        p_store_id: "server-store",
        p_monthly_goal_enabled: true,
        p_monthly_goal_amount_cents: 450000,
      });
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`store/monthly-sales-goal route: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
