import { strict as assert } from "node:assert";
import Module from "node:module";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
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
const contractAuthModulePromise = import("@/lib/server/sales-contracts/contract-auth");

async function loadRouteModule() {
  return routeModulePromise;
}

async function createContractAccessError(status: number, code: string, message: string) {
  const { ContractAccessError } = await contractAuthModulePromise;
  return new ContractAccessError(status, code, message);
}

function createSupabaseMock(args?: {
  existingContracts?: Array<Record<string, unknown>>;
  insertError?: { message: string } | null;
}) {
  const existingFilters: Array<{ column: string; value: unknown }> = [];
  const inserts: Array<Record<string, unknown>> = [];

  return {
    existingFilters,
    inserts,
    from(table: string) {
      if (table !== "sales_contracts") {
        throw new Error(`Unexpected table ${table}`);
      }

      return {
        select() {
          const builder = {
            eq(column: string, value: unknown) {
              existingFilters.push({ column, value });
              return builder;
            },
            then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
              return Promise.resolve({
                data: args?.existingContracts ?? [],
                error: null,
              }).then(resolve, reject);
            },
          };
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          inserts.push(payload);
          return {
            select() {
              return {
                maybeSingle: async () => ({
                  data: args?.insertError
                    ? null
                    : {
                        id: "contract-1",
                        contract_number: "CTR-20260903-TEST",
                        status: "pending_review",
                      },
                  error: args?.insertError ?? null,
                }),
              };
            },
          };
        },
      };
    },
  };
}

function createScope(overrides?: {
  commercialOpportunityId?: string | null;
  supabase?: ReturnType<typeof createSupabaseMock>;
}) {
  return {
    user: { id: "user-1" },
    userId: "user-1",
    supabase: overrides?.supabase ?? createSupabaseMock(),
    organizationId: "org-1",
    store: { id: "store-1", organization_id: "org-1", name: "Store 1" },
    conversation: { id: "conv-1" },
    lead: { id: "lead-1", name: "Cliente", phone: "5511999999999" },
    quote: {
      id: "quote-1",
      organization_id: "org-1",
      store_id: "store-1",
      commercial_opportunity_id:
        overrides?.commercialOpportunityId === undefined
          ? "opp-1"
          : overrides.commercialOpportunityId,
      conversation_id: "conv-1",
      lead_id: "lead-1",
      quote_number: "ORC-001",
      title: "Projeto",
      status: "approved",
      customer_name: "Cliente",
      customer_phone: "5511999999999",
      subtotal_cents: 10000,
      discount_cents: 0,
      total_cents: 10000,
      valid_until: "2026-09-20",
      created_at: "2026-09-03T12:00:00.000Z",
      metadata: null,
    },
    quoteVersion: { id: "version-1" },
  };
}

function createReadyReadiness() {
  return {
    ok: true as const,
    decision: {
      actionKey: "create_contract" as const,
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
      actionKey: "create_contract" as const,
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
    name: "explicit commercial opportunity id is required before readiness and insert",
    run: async () => {
      const { createCreateContractFromQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock();
      let refreshed = false;
      const handler = createCreateContractFromQuotePostHandler({
        resolveQuoteForContract: async () =>
          createScope({ commercialOpportunityId: null, supabase }) as never,
        refreshActionReadiness: async () => {
          refreshed = true;
          return createReadyReadiness();
        },
      });

      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: "quote-1" }),
        }),
      );
      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_COMMERCIAL_OPPORTUNITY_REQUIRED_FOR_CONTRACT");
      assert.equal(refreshed, false);
      assert.equal(supabase.inserts.length, 0);
    },
  },
  {
    name: "ready create_contract allows insert and registers human business event",
    run: async () => {
      const { createCreateContractFromQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock();
      const readinessCalls: Array<Record<string, unknown>> = [];
      const eventCalls: Array<Record<string, unknown>> = [];
      const handler = createCreateContractFromQuotePostHandler({
        resolveQuoteForContract: async () => createScope({ supabase }) as never,
        refreshActionReadiness: async (payload) => {
          readinessCalls.push(payload as unknown as Record<string, unknown>);
          return createReadyReadiness();
        },
        registerBusinessEvent: async (payload) => {
          eventCalls.push(payload as unknown as Record<string, unknown>);
        },
      });

      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: "quote-1" }),
        }),
      );
      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.deepEqual(supabase.existingFilters, [
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
        { column: "quote_id", value: "quote-1" },
      ]);
      assert.deepEqual(readinessCalls[0], {
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        actionKey: "create_contract",
      });
      assert.equal(supabase.inserts.length, 1);
      assert.deepEqual((supabase.inserts[0]?.metadata as Record<string, unknown>).commercial_opportunity_id, "opp-1");
      assert.equal(eventCalls.length, 1);
      assert.equal(eventCalls[0]?.actorType, "human");
      assert.equal((eventCalls[0]?.eventPayload as Record<string, unknown>).commercial_opportunity_id, "opp-1");
    },
  },
  {
    name: "active existing contract blocks before readiness and insert",
    run: async () => {
      const { createCreateContractFromQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        existingContracts: [{ id: "contract-existing", status: "pending_review" }],
      });
      let refreshed = false;
      const handler = createCreateContractFromQuotePostHandler({
        resolveQuoteForContract: async () => createScope({ supabase }) as never,
        refreshActionReadiness: async () => {
          refreshed = true;
          return createReadyReadiness();
        },
      });

      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: "quote-1" }),
        }),
      );
      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_ALREADY_EXISTS");
      assert.equal(refreshed, false);
      assert.equal(supabase.inserts.length, 0);
    },
  },
  {
    name: "create_contract readiness states block before insert",
    run: async () => {
      const { createCreateContractFromQuotePostHandler } = await loadRouteModule();

      for (const [state, error] of [
        ["blocked", "COMMERCIAL_ACTION_BLOCKED"],
        ["needs_resolution", "COMMERCIAL_ACTION_NEEDS_RESOLUTION"],
        ["conflict", "COMMERCIAL_ACTION_CONFLICT"],
      ] as const) {
        const supabase = createSupabaseMock();
        const handler = createCreateContractFromQuotePostHandler({
          resolveQuoteForContract: async () => createScope({ supabase }) as never,
          refreshActionReadiness: async () => createReadiness(state),
        });

        const response = await handler(
          new Request("https://example.test", {
            method: "POST",
            body: JSON.stringify({ quoteId: "quote-1" }),
          }),
        );
        const body = await parseBody(response);
        assert.equal(response.status, 409);
        assert.equal(body.error, error);
        assert.equal(body.readinessState, state);
        assert.equal(supabase.inserts.length, 0);
      }
    },
  },
  {
    name: "create_contract readiness refresh failure fails closed before insert",
    run: async () => {
      const { createCreateContractFromQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock();
      const handler = createCreateContractFromQuotePostHandler({
        resolveQuoteForContract: async () => createScope({ supabase }) as never,
        refreshActionReadiness: async () => ({
          ok: false,
          error: "READINESS_READ_FAILED",
          message: "read failed",
        }),
      });

      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: "quote-1" }),
        }),
      );
      const body = await parseBody(response);
      assert.equal(response.status, 503);
      assert.equal(body.error, "COMMERCIAL_ACTION_READINESS_UNAVAILABLE");
      assert.equal(supabase.inserts.length, 0);
    },
  },
  {
    name: "quote authorization status errors still short-circuit",
    run: async () => {
      const { createCreateContractFromQuotePostHandler } = await loadRouteModule();
      const handler = createCreateContractFromQuotePostHandler({
        resolveQuoteForContract: async () => {
          throw await createContractAccessError(
            409,
            "QUOTE_STATUS_NOT_ALLOWED_FOR_CONTRACT",
            "Somente orcamentos approved ou sent podem originar contrato.",
          );
        },
      });

      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: "quote-1" }),
        }),
      );
      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_STATUS_NOT_ALLOWED_FOR_CONTRACT");
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
