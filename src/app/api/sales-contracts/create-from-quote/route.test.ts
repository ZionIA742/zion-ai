import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
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
type RouteFactory = typeof import("./route")["createCreateContractFromQuotePostHandler"];
let routeFactory: RouteFactory | null = null;
const routeSource = readFileSync(
  join(process.cwd(), "src/app/api/sales-contracts/create-from-quote/route.ts"),
  "utf8",
);
const contractAuthSource = readFileSync(
  join(process.cwd(), "src/lib/server/sales-contracts/contract-auth.ts"),
  "utf8",
);

async function loadRouteModule() {
  await contractAuthModulePromise;
  const routeModule = await routeModulePromise;
  routeFactory = routeModule.createCreateContractFromQuotePostHandler;
  return routeModule;
}

async function createContractAccessError(status: number, code: string, message: string) {
  const { ContractAccessError } = await contractAuthModulePromise;
  return new ContractAccessError(status, code, message);
}

function createSupabaseMock(args?: {
  writerData?: unknown;
  writerError?: { message: string; details?: string | null; hint?: string | null; code?: string | null } | null;
  contractRow?: Record<string, unknown> | null;
  contractLoadError?: { message: string } | null;
}) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const contractFilters: Array<{ column: string; value: unknown }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const contractRow =
    args && "contractRow" in args
      ? args.contractRow
      : {
          id: "contract-1",
          organization_id: "org-1",
          store_id: "store-1",
          contract_number: "CTR-20260924-TEST",
          status: "pending_review",
          quote_id: "quote-1",
          quote_version_id: "version-1",
        };

  return {
    rpcCalls,
    contractFilters,
    inserts,
    async rpc(fn: string, rpcArgs: Record<string, unknown>) {
      rpcCalls.push({ fn, args: rpcArgs });
      return {
        data: args && "writerData" in args
          ? args.writerData
          : [{
              outcome: "created",
              contract_id: "contract-1",
              organization_id: "org-1",
              store_id: "store-1",
              commercial_opportunity_id: "opp-1",
              quote_id: "quote-1",
              quote_version_id: "version-1",
              acceptance_event_id: "acceptance-event-1",
              contract_number: "CTR-20260924-TEST",
              contract_status: "pending_review",
              business_event_id: "business-event-1",
              business_event_outcome: "created",
            }],
        error: args?.writerError ?? null,
      };
    },
    from(table: string) {
      if (table !== "sales_contracts") {
        throw new Error(`Unexpected table ${table}`);
      }

      return {
        select() {
          const builder = {
            eq(column: string, value: unknown) {
              contractFilters.push({ column, value });
              return builder;
            },
            maybeSingle: async () => ({
              data: args?.contractLoadError ? null : contractRow,
              error: args?.contractLoadError ?? null,
            }),
          };
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          inserts.push(payload);
          throw new Error("sales_contracts.insert must not be called by create-from-quote route");
        },
      };
    },
  };
}

function grantedAccess() {
  return {
    ok: true as const,
    supabase: {} as never,
    sessionUserId: "user-1",
    organizationId: "org-1",
    storeId: "store-1",
    resolution: {} as never,
  };
}

function createTestHandler(
  deps: Parameters<RouteFactory>[0] = {},
) {
  if (!routeFactory) throw new Error("route module not loaded");
  return routeFactory({
    resolveAccess: async () => grantedAccess(),
    ...deps,
  });
}

function createScope(overrides?: {
  commercialOpportunityId?: string | null;
  quoteVersionId?: string;
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
      current_version_id: "version-current-must-not-be-authority",
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
    quoteVersion: { id: overrides?.quoteVersionId ?? "version-1" },
  };
}

function createQuoteResolverSupabaseMock(overrides?: {
  quote?: Record<string, unknown> | null;
  quoteVersion?: Record<string, unknown> | null;
}) {
  const queries: Array<{ table: string; filters: Array<{ column: string; operator: string; value: unknown }> }> = [];
  const rows: Record<string, Record<string, unknown> | null> = {
    sales_quotes: {
      id: "quote-1",
      organization_id: "org-1",
      store_id: "store-1",
      commercial_opportunity_id: "opp-1",
      conversation_id: "conv-1",
      lead_id: "lead-1",
      status: "approved",
      current_version_id: "version-current-must-not-be-authority",
      ...(overrides?.quote && overrides.quote),
    },
    stores: { id: "store-1", organization_id: "org-1", name: "Store 1", created_at: "2026-10-08T00:00:00.000Z" },
    conversations: { id: "conv-1", organization_id: "org-1", lead_id: "lead-1", status: "open", is_human_active: true },
    leads: { id: "lead-1", organization_id: "org-1", store_id: "store-1", name: "Cliente", phone: "5511999999999" },
    sales_quote_versions: {
      id: "version-1",
      quote_id: "quote-1",
      organization_id: "org-1",
      store_id: "store-1",
      ...(overrides?.quoteVersion && overrides.quoteVersion),
    },
  };
  if (overrides && "quote" in overrides) rows.sales_quotes = overrides.quote ?? null;
  if (overrides && "quoteVersion" in overrides) rows.sales_quote_versions = overrides.quoteVersion ?? null;
  return {
    queries,
    from(table: string) {
      const filters: Array<{ column: string; operator: string; value: unknown }> = [];
      const builder = {
        eq(column: string, value: unknown) {
          filters.push({ column, operator: "eq", value });
          return builder;
        },
        in(column: string, value: unknown) {
          filters.push({ column, operator: "in", value });
          return builder;
        },
        maybeSingle: async () => {
          queries.push({ table, filters: [...filters] });
          return { data: rows[table] ?? null, error: null };
        },
      };
      return {
        select: () => builder,
      };
    },
  };
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "authorized-store quote resolver rejects empty scope before creating service client",
    run: async () => {
      const { resolveQuoteForContractForAuthorizedStoreScope } = await contractAuthModulePromise;
      let serviceClientCalls = 0;
      await assert.rejects(
        () => resolveQuoteForContractForAuthorizedStoreScope(
          "quote-1",
          "version-1",
          { organizationId: "", storeId: "store-1", sessionUserId: "user-1" },
          { createServiceSupabaseClient: () => { serviceClientCalls += 1; return {} as never; } },
        ),
        (error: unknown) => {
          assert.equal((error as { status: number }).status, 500);
          assert.equal((error as { code: string }).code, "INVALID_AUTHORIZED_QUOTE_CONTRACT_SCOPE");
          return true;
        },
      );
      assert.equal(serviceClientCalls, 0);
    },
  },
  {
    name: "authorized-store quote resolver uses exact quote and version tenant lineage",
    run: async () => {
      const { resolveQuoteForContractForAuthorizedStoreScope } = await contractAuthModulePromise;
      const supabase = createQuoteResolverSupabaseMock();
      const scope = await resolveQuoteForContractForAuthorizedStoreScope(
        " quote-1 ",
        " version-1 ",
        { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
        { createServiceSupabaseClient: () => supabase as never },
      );
      const quoteQuery = supabase.queries.find((query) => query.table === "sales_quotes");
      const versionQuery = supabase.queries.find((query) => query.table === "sales_quote_versions");
      assert.deepEqual(quoteQuery?.filters, [
        { column: "id", operator: "eq", value: "quote-1" },
        { column: "organization_id", operator: "eq", value: "org-1" },
        { column: "store_id", operator: "eq", value: "store-1" },
      ]);
      assert.deepEqual(versionQuery?.filters, [
        { column: "id", operator: "eq", value: "version-1" },
        { column: "quote_id", operator: "eq", value: "quote-1" },
        { column: "organization_id", operator: "eq", value: "org-1" },
        { column: "store_id", operator: "eq", value: "store-1" },
      ]);
      assert.equal(scope.quoteVersion.id, "version-1");
      assert.notEqual(scope.quoteVersion.id, scope.quote.current_version_id);
    },
  },
  {
    name: "authorized-store quote resolver does not reveal foreign quote and has no request auth path",
    run: async () => {
      const { resolveQuoteForContractForAuthorizedStoreScope } = await contractAuthModulePromise;
      const supabase = createQuoteResolverSupabaseMock({ quote: null });
      await assert.rejects(
        () => resolveQuoteForContractForAuthorizedStoreScope(
          "quote-foreign",
          "version-1",
          { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
          { createServiceSupabaseClient: () => supabase as never },
        ),
        (error: unknown) => {
          assert.equal((error as { status: number }).status, 404);
          assert.equal((error as { code: string }).code, "QUOTE_NOT_FOUND");
          return true;
        },
      );
      const start = contractAuthSource.indexOf("export async function resolveQuoteForContractForAuthorizedStoreScope");
      assert.ok(start >= 0);
      const sourceSlice = contractAuthSource.slice(start);
      assert.doesNotMatch(sourceSlice, /authenticateContractRequest/);
      assert.doesNotMatch(sourceSlice, /createSupabaseServerClient/);
      assert.doesNotMatch(sourceSlice, /auth\.getUser/);
      assert.doesNotMatch(sourceSlice, /\.from\("memberships"\)/);
    },
  },
  {
    name: "denied canonical access returns before body, resolver, rpc, and durable read",
    run: async () => {
      await loadRouteModule();
      let bodyRead = false;
      let resolverCalled = false;
      const handler = createTestHandler({
        resolveAccess: async (params) => {
          assert.deepEqual(params, { requirement: "active" });
          return {
            ok: false as const,
            httpStatus: 403 as const,
            payload: {
              ok: false,
              error: "STORE_API_FORBIDDEN",
              message: "Acesso negado.",
              status: "cross_domain_forbidden",
              reasonCode: "zion_admin_cannot_access_store_area",
            },
            resolution: {} as never,
          };
        },
        resolveQuoteForContract: async () => {
          resolverCalled = true;
          throw new Error("resolver must not run");
        },
      });
      const request = new Request("https://example.test", {
        method: "POST",
        body: "not-json",
      });
      const originalJson = request.json.bind(request);
      request.json = async () => {
        bodyRead = true;
        return originalJson();
      };
      const response = await handler(request);
      const body = await parseBody(response);
      assert.equal(response.status, 403);
      assert.equal(body.error, "STORE_API_FORBIDDEN");
      assert.equal(bodyRead, false);
      assert.equal(resolverCalled, false);
    },
  },
  {
    name: "access granted with invalid quoteId preserves canonical error",
    run: async () => {
      await loadRouteModule();
      let resolverCalled = false;
      const handler = createTestHandler({
        resolveQuoteForContract: async () => {
          resolverCalled = true;
          throw new Error("resolver must not run");
        },
      });
      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: " ", quoteVersionId: "version-1" }),
        }),
      );
      const body = await parseBody(response);
      assert.equal(response.status, 400);
      assert.equal(body.error, "INVALID_QUOTE_ID");
      assert.equal(resolverCalled, false);
    },
  },
  {
    name: "missing quoteVersionId fails before resolver",
    run: async () => {
      await loadRouteModule();
      let resolverCalled = false;
      const handler = createTestHandler({
        resolveQuoteForContract: async () => {
          resolverCalled = true;
          return createScope() as never;
        },
      });

      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: "quote-1" }),
        }),
      );
      const body = await parseBody(response);
      assert.equal(response.status, 400);
      assert.equal(body.error, "INVALID_QUOTE_VERSION_ID");
      assert.equal(resolverCalled, false);
    },
  },
  {
    name: "resolver receives explicit quote and version ids",
    run: async () => {
      await loadRouteModule();
      const supabase = createSupabaseMock();
      const resolverArgs: unknown[][] = [];
      const handler = createTestHandler({
        resolveQuoteForContract: async (...args) => {
          resolverArgs.push(args);
          return createScope({ supabase }) as never;
        },
      });

      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: " quote-1 ", quoteVersionId: " version-1 " }),
        }),
      );

      assert.equal(response.status, 200);
      assert.deepEqual(resolverArgs, [[
        "quote-1",
        "version-1",
        { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
      ]]);
    },
  },
  {
    name: "created outcome calls atomic event rpc with exact args, returns contract, and never inserts directly",
    run: async () => {
      await loadRouteModule();
      const supabase = createSupabaseMock();
      const handler = createTestHandler({
        resolveQuoteForContract: async () => createScope({ supabase }) as never,
      });

      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: "quote-1", quoteVersionId: "version-1" }),
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.deepEqual(body.contract, {
        id: "contract-1",
        organization_id: "org-1",
        store_id: "store-1",
        contract_number: "CTR-20260924-TEST",
        status: "pending_review",
        quote_id: "quote-1",
        quote_version_id: "version-1",
      });
      assert.equal(supabase.rpcCalls.length, 1);
      assert.equal(supabase.rpcCalls[0]?.fn, "create_sales_contract_with_current_acceptance_event_by_system");
      assert.deepEqual(Object.keys(supabase.rpcCalls[0]?.args ?? {}).sort(), [
        "p_actor_user_id",
        "p_commercial_opportunity_id",
        "p_contract_number",
        "p_organization_id",
        "p_quote_id",
        "p_quote_version_id",
        "p_store_id",
      ]);
      assert.deepEqual(
        {
          ...supabase.rpcCalls[0]?.args,
          p_contract_number: "DYNAMIC",
        },
        {
          p_organization_id: "org-1",
          p_store_id: "store-1",
          p_commercial_opportunity_id: "opp-1",
          p_quote_id: "quote-1",
          p_quote_version_id: "version-1",
          p_contract_number: "DYNAMIC",
          p_actor_user_id: "user-1",
        },
      );
      assert.match(String(supabase.rpcCalls[0]?.args.p_contract_number), /^CTR-\d{8}-[A-Z0-9]{4}$/);
      assert.deepEqual(supabase.contractFilters, [
        { column: "id", value: "contract-1" },
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
      ]);
      assert.equal(supabase.inserts.length, 0);
    },
  },
  {
    name: "route leaves contract_record_created to the atomic rpc only",
    run: () => {
      assert.match(routeSource, /resolveStoreApiAccess/);
      assert.match(routeSource, /requirement: "active"/);
      assert.match(routeSource, /createStoreApiDeniedResponse/);
      assert.match(routeSource, /resolveQuoteForContractForAuthorizedStoreScope/);
      assert.doesNotMatch(routeSource, /resolveAuthorizedQuoteForContract/);
      assert.match(routeSource, /create_sales_contract_with_current_acceptance_event_by_system/);
      assert.equal(routeSource.includes("registerContractBusinessEvent"), false);
      assert.equal(routeSource.includes("contrato_gerado"), false);
      assert.equal(routeSource.includes("contract_record_created"), false);
    },
  },
  {
    name: "durable contract reread rejects a foreign tenant row",
    run: async () => {
      await loadRouteModule();
      const supabase = createSupabaseMock({
        contractRow: {
          id: "contract-1",
          organization_id: "org-foreign",
          store_id: "store-foreign",
          contract_number: "CTR-FOREIGN",
        },
      });
      const handler = createTestHandler({
        resolveQuoteForContract: async () => createScope({ supabase }) as never,
      });
      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: "quote-1", quoteVersionId: "version-1" }),
        }),
      );
      const body = await parseBody(response);
      assert.equal(response.status, 403);
      assert.equal(body.error, "CONTRACT_SCOPE_MISMATCH");
    },
  },
  {
    name: "already_exists outcome returns existing contract without attempting a separate event",
    run: async () => {
      await loadRouteModule();
      const supabase = createSupabaseMock({
        writerData: [{ outcome: "already_exists", contract_id: "contract-existing" }],
        contractRow: {
          id: "contract-existing",
          organization_id: "org-1",
          store_id: "store-1",
          contract_number: "CTR-EXISTING",
          status: "pending_review",
          quote_id: "quote-1",
          quote_version_id: "version-1",
        },
      });
      const handler = createTestHandler({
        resolveQuoteForContract: async () => createScope({ supabase }) as never,
      });

      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: "quote-1", quoteVersionId: "version-1" }),
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal((body.contract as Record<string, unknown>).id, "contract-existing");
      assert.equal(supabase.inserts.length, 0);
    },
  },
  {
    name: "proposal stale writer error fails closed with canonical code",
    run: async () => {
      await loadRouteModule();
      const supabase = createSupabaseMock({
        writerError: {
          message: "ZION_CONTRACT_CREATE_PROPOSAL_STALE",
        },
      });
      const handler = createTestHandler({
        resolveQuoteForContract: async () => createScope({ supabase }) as never,
      });

      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: "quote-1", quoteVersionId: "version-1" }),
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "ZION_CONTRACT_CREATE_PROPOSAL_STALE");
      assert.equal(supabase.contractFilters.length, 0);
    },
  },
  {
    name: "requested quote version is preserved instead of current_version_id",
    run: async () => {
      await loadRouteModule();
      const supabase = createSupabaseMock();
      const handler = createTestHandler({
        resolveQuoteForContract: async () =>
          createScope({
            quoteVersionId: "version-1",
            supabase,
          }) as never,
      });

      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: "quote-1", quoteVersionId: "version-1" }),
        }),
      );

      assert.equal(response.status, 200);
      assert.equal(supabase.rpcCalls[0]?.args.p_quote_version_id, "version-1");
      assert.notEqual(supabase.rpcCalls[0]?.args.p_quote_version_id, "version-current-must-not-be-authority");
    },
  },
  {
    name: "explicit commercial opportunity id is required before rpc",
    run: async () => {
      await loadRouteModule();
      const supabase = createSupabaseMock();
      const handler = createTestHandler({
        resolveQuoteForContract: async () =>
          createScope({ commercialOpportunityId: null, supabase }) as never,
      });

      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ quoteId: "quote-1", quoteVersionId: "version-1" }),
        }),
      );
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_COMMERCIAL_OPPORTUNITY_REQUIRED_FOR_CONTRACT");
      assert.equal(supabase.rpcCalls.length, 0);
      assert.equal(supabase.inserts.length, 0);
    },
  },
  {
    name: "quote authorization status errors still short-circuit",
    run: async () => {
      await loadRouteModule();
      const handler = createTestHandler({
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
          body: JSON.stringify({ quoteId: "quote-1", quoteVersionId: "version-1" }),
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
