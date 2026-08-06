import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GET,
  createStoreWhatsappStatusGetHandler,
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
  filters: Array<{ op: string; column: string; value: unknown }>;
  orders: Array<{ column: string; options: Record<string, unknown> | undefined }>;
  limit: number | null;
};

type QueryResult = {
  data?: unknown;
  error: { message: string } | null;
  count?: number | null;
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

function createPrivilegedClientMock(
  responses?: Partial<Record<string, QueryResult | QueryResult[]>>,
) {
  const calls: QueryCall[] = [];

  function takeResponse(table: string, fallback: QueryResult) {
    const response = responses?.[table];
    if (Array.isArray(response)) {
      return response.shift() ?? fallback;
    }

    return response ?? fallback;
  }

  const client = {
    calls,
    from(table: string) {
      const call: QueryCall = {
        table,
        columns: "",
        filters: [],
        orders: [],
        limit: null,
      };

      const builder = {
        async execute() {
          calls.push({
            table: call.table,
            columns: call.columns,
            filters: [...call.filters],
            orders: [...call.orders],
            limit: call.limit,
          });

          return takeResponse(table, { data: [], error: null, count: null });
        },
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push({ op: "eq", column, value });
          return builder;
        },
        is(column: string, value: unknown) {
          call.filters.push({ op: "is", column, value });
          return builder;
        },
        not(column: string, op: string, value: unknown) {
          call.filters.push({ op: `not:${op}`, column, value });
          return builder;
        },
        contains(column: string, value: unknown) {
          call.filters.push({ op: "contains", column, value });
          return builder;
        },
        order(column: string, options?: Record<string, unknown>) {
          call.orders.push({ column, options });
          return builder;
        },
        async maybeSingle() {
          const response = await builder.execute();
          return {
            data: response.data ?? null,
            error: response.error,
            count: response.count ?? null,
          };
        },
        limit(value: number) {
          call.limit = value;
          return builder;
        },
        then(onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) {
          return builder.execute().then(onFulfilled, onRejected);
        },
      };

      return builder;
    },
  };

  return client;
}

function buildRequest(url: string) {
  return new Request(url);
}

const tests: TestCase[] = [
  {
    name: "valid account reads whatsapp status only from canonical tenant scope",
    run: async () => {
      const client = createPrivilegedClientMock({
        external_integrations: {
          data: [
            {
              provider: "whatsapp",
              status: "active",
              is_active: true,
              display_phone_number: "+55 11 99999-0000",
              phone_number_id: "phone-1",
              whatsapp_business_account_id: "waba-1",
            },
          ],
          error: null,
          count: null,
        },
        channel_whatsapp_inbox: [
          { data: { received_at: "2026-08-06T12:00:00Z" }, error: null },
          { data: [], error: null, count: 2 },
          {
            data: {
              processing_error:
                "  erro muito grande ".repeat(30),
              received_at: "2026-08-06T11:00:00Z",
            },
            error: null,
          },
        ],
        messages: [
          { data: { created_at: "2026-08-06T12:30:00Z" }, error: null },
          { data: [], error: null, count: 3 },
          {
            data: [
              {
                delivered_at: "2026-08-06T12:31:00Z",
                read_at: null,
                metadata: { whatsapp_status: "delivered" },
              },
              {
                delivered_at: null,
                read_at: "2026-08-06T12:32:00Z",
                metadata: { whatsapp_last_status: "read" },
              },
            ],
            error: null,
            count: null,
          },
        ],
      });
      let resolveCount = 0;
      let clientCreateCount = 0;
      const handler = createStoreWhatsappStatusGetHandler({
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
          "https://example.test/api/store/whatsapp/status?organizationId=query-org&storeId=query-store",
        ),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(resolveCount, 1);
      assert.equal(clientCreateCount, 1);
      assert.equal(body.ok, true);
      assert.equal(body.connected, true);
      assert.equal(body.lastInboundAt, "2026-08-06T12:00:00Z");
      assert.equal(body.lastOutboundAt, "2026-08-06T12:30:00Z");
      assert.equal(typeof body.pendingInboxCount, "number");
      assert.equal(typeof body.pendingOutboundCount, "number");
      assert.equal(
        body.lastSafeError === null || typeof body.lastSafeError === "string",
        true,
      );
      if (typeof body.lastSafeError === "string") {
        assert.equal(String(body.lastSafeError).length <= 220, true);
      }
      assert.deepEqual(body.recentDeliveryStatus, {
        sentCount: 2,
        deliveredCount: 2,
        readCount: 1,
      });

      const scopedCalls = client.calls.filter(
        (call) =>
          ["external_integrations", "channel_whatsapp_inbox", "messages"].includes(call.table),
      );
      assert.equal(scopedCalls.length > 0, true);
      for (const call of scopedCalls) {
        const orgFilters = call.filters.filter((item) => item.column === "organization_id");
        const storeFilters = call.filters.filter((item) => item.column === "store_id");
        assert.equal(orgFilters.length > 0, true, `${call.table} should scope organization`);
        assert.equal(storeFilters.length > 0, true, `${call.table} should scope store`);
        assert.equal(orgFilters.every((item) => item.value === "access-org"), true);
        assert.equal(storeFilters.every((item) => item.value === "access-store"), true);
      }
    },
  },
  {
    name: "anonymous and fail-closed wrapper statuses are preserved without tenant selection from query",
    run: async () => {
      for (const denied of [
        createDeniedAccess(401, "anonymous", "anonymous"),
        createDeniedAccess(409, "store_missing_membership", "missing_membership"),
        createDeniedAccess(409, "store_multi_org_unsupported", "multi_org_unsupported"),
        createDeniedAccess(409, "store_missing_store", "missing_store"),
        createDeniedAccess(409, "store_multi_store_unsupported", "multi_store_unsupported"),
      ]) {
        let clientCreateCount = 0;
        const handler = createStoreWhatsappStatusGetHandler({
          resolveAccess: async () => denied,
          createPrivilegedClient: () => {
            clientCreateCount += 1;
            throw new Error("client should not be created");
          },
        });

        const response = await handler(
          buildRequest(
            "https://example.test/api/store/whatsapp/status?organizationId=query-org&storeId=query-store",
          ),
        );
        const body = (await response.json()) as Record<string, unknown>;

        assert.equal(response.status, denied.httpStatus);
        assert.equal(body.status, denied.payload.status);
        assert.equal(body.reasonCode, denied.payload.reasonCode);
        assert.equal(body.message, denied.payload.message);
        assert.equal(clientCreateCount, 0);
      }
    },
  },
  {
    name: "source uses canonical wrapper and never reads query tenant ids",
    run: () => {
      const source = readFileSync(join(__dirname, "route.ts"), "utf8");

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes("createStoreApiDeniedResponse"), true);
      assert.equal(source.includes('requirement: "active"'), true);
      assert.equal(source.includes('searchParams.get("storeId")'), false);
      assert.equal(source.includes('searchParams.get("organizationId")'), false);
      assert.equal(source.includes("createSupabaseServerClient"), false);
      assert.equal(source.includes("auth.getUser"), false);
      assert.equal(source.includes("getSession"), false);
    },
  },
  {
    name: "module exports the handler factory result",
    run: () => {
      assert.equal(typeof GET, "function");
    },
  },
];

void (async () => {
  let passed = 0;

  for (const test of tests) {
    await test.run();
    passed += 1;
  }

  console.log(`store-whatsapp-status-route: ${passed}/${tests.length} tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
