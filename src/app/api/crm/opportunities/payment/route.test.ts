import { strict as assert } from "node:assert";
import Module from "node:module";
import { join } from "node:path";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

const projectSrcPath = join(process.cwd(), "src");
type ResolveFilenameHook = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) => string;

const moduleWithResolveFilename = Module as typeof Module & {
  _resolveFilename: ResolveFilenameHook;
};

const originalResolveFilename = moduleWithResolveFilename._resolveFilename;

moduleWithResolveFilename._resolveFilename = function (
  request,
  parent,
  isMain,
  options,
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

  return originalResolveFilename.call(
    this,
    request,
    parent,
    isMain,
    options,
  );
};

const routeModulePromise = import("./route");

function denied(): StoreApiAccessDenied {
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
      reasonCode: "missing_membership",
      message: "Denied",
    },
    httpStatus: 401,
    payload: {
      ok: false,
      error: "STORE_API_UNAUTHENTICATED",
      message: "Denied",
      status: "anonymous",
      reasonCode: "missing_membership",
    },
  };
}

function createSupabaseMock() {
  const queryCalls: any[] = [];
  const rpcCalls: any[] = [];

  return {
    queryCalls,
    rpcCalls,
    from(table: string) {
      return {
        select(columns: string) {
          const filters: any[] = [];

          return {
            eq(column: string, value: unknown) {
              filters.push({ column, value });
              return this;
            },
            async maybeSingle() {
              queryCalls.push({ table, columns, filters: [...filters] });

              return {
                data: {
                  id: "opp-1",
                  organization_id: "org-1",
                  store_id: "store-1",
                  lifecycle_cycle: 3,
                },
                error: null,
              };
            },
          };
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });

      if (fn === "record_commercial_opportunity_payment_by_user") {
        return {
          data: [{
            payment_event_id: "payment-1",
            confirmed_amount_cents: 10000,
            event_count: 1,
            outcome: "recorded",
          }],
          error: null,
        };
      }

      if (fn === "set_commercial_opportunity_payment_settlement_by_user") {
        return {
          data: [{
            settlement_event_id: "settlement-1",
            settlement_state: args.p_settlement_state,
            confirmed_amount_cents: 10000,
            payment_obligation_satisfied:
              args.p_settlement_state === "satisfied",
            outcome: "recorded",
          }],
          error: null,
        };
      }

      return { data: null, error: null };
    },
  };
}

function granted(supabase: any): StoreApiAccessGranted {
  return {
    ok: true,
    supabase,
    resolution: {
      domain: "store_area",
      status: "store_ready_active",
      sessionUserId: "user-1",
      safeHtmlDestination: "/crm",
      apiDecision: "allow",
      organizationResolution: "single",
      storeResolution: "single",
      organizationId: "org-1",
      storeId: "store-1",
      commercialAccess: "allowed",
      reasonCode: "ready_active",
      message: "Allowed",
    },
    sessionUserId: "user-1",
    organizationId: "org-1",
    storeId: "store-1",
  };
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

const tests = [
  {
    name: "history preserves real values, optional fields, reversals and settlements",
    run: async () => {
      const { mergePaymentHistory } = await routeModulePromise;
      const history = mergePaymentHistory(
        [
          {
            id: "payment-2",
            event_type: "reversal",
            amount_cents: 2500,
            payment_method: null,
            reversed_payment_event_id: "payment-1",
            source_type: "settings_action",
            reason_code: "payment_reversed",
            notes: null,
            metadata: {},
            created_at: "2026-11-10T12:00:00.000Z",
          },
          {
            id: "payment-1",
            event_type: "confirmation",
            amount_cents: 2500,
            payment_method: "pix",
            reversed_payment_event_id: null,
            source_type: "settings_action",
            reason_code: "payment_event_recorded",
            notes: "Entrada",
            metadata: { payment_kind: "entry", source: "crm_payment_action" },
            created_at: "2026-11-10T11:00:00.000Z",
          },
        ],
        [
          {
            id: "settlement-1",
            settlement_state: "satisfied",
            reason_code: "payment_settlement_recorded",
            notes: null,
            metadata: {},
            created_at: "2026-11-10T13:00:00.000Z",
          },
        ],
      );

      assert.deepEqual(
        history.map((item) => item.id),
        ["payment-1", "payment-2", "settlement-1"],
      );
      assert.equal(history[0].amountCents, 2500);
      assert.equal(history[0].paymentMethod, "pix");
      assert.equal(history[0].paymentKind, "entry");
      assert.equal(history[0].source, "crm_payment_action");
      assert.equal(history[1].eventType, "reversal");
      assert.equal(history[1].amountCents, 2500);
      assert.equal(history[1].paymentMethod, null);
      assert.equal(history[2].eventKind, "settlement");
      assert.equal(history[2].amountCents, null);
    },
  },

  {
    name: "denied access does not read POST body",
    run: async () => {
      const { createPaymentPostHandler } = await routeModulePromise;
      let reads = 0;

      const response = await createPaymentPostHandler({
        resolveAccess: async () => denied(),
      })({
        json: async () => {
          reads += 1;
          throw new Error("must not read");
        },
      } as unknown as Request);

      assert.equal(response.status, 401);
      assert.equal(reads, 0);
    },
  },

  {
    name: "confirm payment ignores body tenant ids and uses scoped opportunity",
    run: async () => {
      const { createPaymentPostHandler } = await routeModulePromise;
      const supabase = createSupabaseMock();

      const response = await createPaymentPostHandler({
        resolveAccess: async () => granted(supabase),
      })({
        json: async () => ({
          organizationId: "evil-org",
          storeId: "evil-store",
          commercialOpportunityId: "opp-1",
          expectedLifecycleCycle: 3,
          action: "confirm_payment",
          amountCents: 10000,
          paymentMethod: "pix",
          requestId: "request_12345678",
        }),
      } as Request);

      const result = await body(response);

      assert.equal(response.status, 200);
      assert.equal(result.ok, true);
      assert.equal(supabase.rpcCalls.length, 1);
      assert.equal(
        supabase.rpcCalls[0].fn,
        "record_commercial_opportunity_payment_by_user",
      );
      assert.equal(
        supabase.rpcCalls[0].args.p_organization_id,
        "org-1",
      );
      assert.equal(
        supabase.rpcCalls[0].args.p_store_id,
        "store-1",
      );
      assert.equal(
        supabase.rpcCalls[0].args.p_commercial_opportunity_id,
        "opp-1",
      );
      assert.equal(
        supabase.rpcCalls[0].args.p_expected_lifecycle_cycle,
        3,
      );
      assert.equal(
        supabase.rpcCalls[0].args.p_event_type,
        "confirmation",
      );
      assert.equal(
        supabase.rpcCalls[0].args.p_amount_cents,
        10000,
      );
    },
  },

  {
    name: "settle uses explicit human settlement writer",
    run: async () => {
      const { createPaymentPostHandler } = await routeModulePromise;
      const supabase = createSupabaseMock();

      const response = await createPaymentPostHandler({
        resolveAccess: async () => granted(supabase),
      })({
        json: async () => ({
          commercialOpportunityId: "opp-1",
          expectedLifecycleCycle: 3,
          action: "settle",
          requestId: "request_abcdefgh",
        }),
      } as Request);

      assert.equal(response.status, 200);
      assert.equal(
        supabase.rpcCalls[0].fn,
        "set_commercial_opportunity_payment_settlement_by_user",
      );
      assert.equal(
        supabase.rpcCalls[0].args.p_settlement_state,
        "satisfied",
      );
    },
  },

  {
    name: "reopen uses reopened settlement state",
    run: async () => {
      const { createPaymentPostHandler } = await routeModulePromise;
      const supabase = createSupabaseMock();

      const response = await createPaymentPostHandler({
        resolveAccess: async () => granted(supabase),
      })({
        json: async () => ({
          commercialOpportunityId: "opp-1",
          expectedLifecycleCycle: 3,
          action: "reopen",
          requestId: "request_reopen123",
        }),
      } as Request);

      assert.equal(response.status, 200);
      assert.equal(
        supabase.rpcCalls[0].args.p_settlement_state,
        "reopened",
      );
    },
  },

  {
    name: "invalid amount fails before payment writer",
    run: async () => {
      const { createPaymentPostHandler } = await routeModulePromise;
      const supabase = createSupabaseMock();

      const response = await createPaymentPostHandler({
        resolveAccess: async () => granted(supabase),
      })({
        json: async () => ({
          commercialOpportunityId: "opp-1",
          expectedLifecycleCycle: 3,
          action: "confirm_payment",
          amountCents: 0,
          requestId: "request_invalid1",
        }),
      } as Request);

      const result = await body(response);
      assert.equal(response.status, 400);
      assert.equal(result.error, "PAYMENT_AMOUNT_INVALID");
      assert.equal(supabase.rpcCalls.length, 0);
    },
  },

  {
    name: "stale lifecycle fails before payment writer",
    run: async () => {
      const { createPaymentPostHandler } = await routeModulePromise;
      const supabase = createSupabaseMock();

      const response = await createPaymentPostHandler({
        resolveAccess: async () => granted(supabase),
      })({
        json: async () => ({
          commercialOpportunityId: "opp-1",
          expectedLifecycleCycle: 2,
          action: "confirm_payment",
          amountCents: 10000,
          requestId: "request_stale123",
        }),
      } as Request);

      const result = await body(response);
      assert.equal(response.status, 409);
      assert.equal(result.error, "PAYMENT_STATE_OUTDATED");
      assert.equal(supabase.rpcCalls.length, 0);
    },
  },

  {
    name: "GET reads canonical resolver through service client",
    run: async () => {
      const { createPaymentGetHandler } = await routeModulePromise;
      const userSupabase = createSupabaseMock();
      const serviceCalls: any[] = [];

      const serviceSupabase = {
        from(table: string) {
          return {
            select(columns: string) {
              const filters: Array<{ column: string; value: unknown }> = [];
              const query = {
                eq(column: string, value: unknown) {
                  filters.push({ column, value });
                  return query;
                },
                order() {
                  serviceCalls.push({ table, columns, filters: [...filters] });
                  return Promise.resolve({ data: [], error: null });
                },
              };
              return query;
            },
          };
        },
        async rpc(fn: string, args: Record<string, unknown>) {
          serviceCalls.push({ fn, args });

          return {
            data: [{
              assessment_state: "determined",
              progress_state: "in_progress",
              resolver_key: "payment",
              resolver_version: 2,
              authority_fingerprint: "fp",
              reason_code: "payment_partially_confirmed",
              resolution_basis: {
                confirmed_amount_cents: 15000,
                event_count: 2,
                payment_obligation_satisfied: false,
                settlement_event_count: 0,
              },
            }],
            error: null,
          };
        },
      };

      const response = await createPaymentGetHandler({
        resolveAccess: async () => granted(userSupabase),
        createServiceSupabaseClient: () => serviceSupabase,
      })(
        new Request(
          "http://localhost/api/crm/opportunities/payment?commercialOpportunityId=opp-1",
        ),
      );

      const result = await body(response);

      assert.equal(response.status, 200);
      assert.equal(result.payment.progressState, "in_progress");
      assert.equal(result.payment.confirmedAmountCents, 15000);
      assert.equal(result.payment.obligationSatisfied, false);
      assert.deepEqual(result.paymentHistory, []);
      assert.equal(serviceCalls[1].table, "commercial_opportunity_payment_events");
      assert.equal(serviceCalls[2].table, "commercial_opportunity_payment_settlement_events");
      for (const call of serviceCalls.slice(1)) {
        assert.deepEqual(call.filters, [
          { column: "organization_id", value: "org-1" },
          { column: "store_id", value: "store-1" },
          { column: "commercial_opportunity_id", value: "opp-1" },
          { column: "lifecycle_cycle", value: 3 },
        ]);
      }
      assert.equal(
        serviceCalls[0].fn,
        "p9_resolve_payment_progress_internal",
      );
      assert.deepEqual(serviceCalls[0].args, {
        p_organization_id: "org-1",
        p_store_id: "store-1",
        p_commercial_opportunity_id: "opp-1",
      });
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
        `not ok - ${test.name}\n${
          error instanceof Error
            ? error.stack || error.message
            : String(error)
        }`,
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
