import { strict as assert } from "node:assert";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StoreApiAccessResult } from "@/lib/server/store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type Row = Record<string, unknown>;

function grantedAccess(supabase: unknown): StoreApiAccessResult {
  return {
    ok: true as const,
    supabase: supabase as never,
    sessionUserId: "user-1",
    organizationId: "org-1",
    storeId: "store-1",
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
      message: "Acesso ativo.",
    },
  } as const;
}

function deniedAccess(): StoreApiAccessResult {
  return {
    ok: false as const,
    httpStatus: 401,
    payload: {
      ok: false,
      error: "STORE_API_UNAUTHENTICATED",
      message: "Nao autenticado.",
      status: "anonymous" as const,
      reasonCode: "anonymous" as const,
    },
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
      message: "Nao autenticado.",
    },
  } as const;
}

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

function createFixtureSupabase() {
  const tables: Record<string, Row[]> = {
    leads: [
      { id: "lead-a", organization_id: "org-1", store_id: "store-1" },
      { id: "lead-b", organization_id: "org-1", store_id: "store-1" },
      { id: "lead-store-2", organization_id: "org-1", store_id: "store-2" },
    ],
    stores: [
      { id: "store-1", organization_id: "org-1" },
      { id: "store-2", organization_id: "org-1" },
    ],
    commercial_opportunities: [
      { id: "opp-1", organization_id: "org-1", store_id: "store-1", origin_lead_id: "lead-a" },
      { id: "opp-2", organization_id: "org-1", store_id: "store-1", origin_lead_id: "lead-a" },
      { id: "opp-manual", organization_id: "org-1", store_id: "store-1", origin_lead_id: "lead-a" },
      { id: "opp-empty", organization_id: "org-1", store_id: "store-1", origin_lead_id: "lead-a" },
      { id: "opp-store-mismatch", organization_id: "org-1", store_id: "store-2", origin_lead_id: "lead-a" },
      { id: "opp-other-lead", organization_id: "org-1", store_id: "store-1", origin_lead_id: "lead-b" },
      { id: "opp-foreign", organization_id: "org-2", store_id: "store-foreign", origin_lead_id: "lead-a" },
    ],
    sales_quotes: [
      {
        id: "quote-1",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-a",
        commercial_opportunity_id: "opp-1",
      },
      {
        id: "quote-2",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-a",
        commercial_opportunity_id: "opp-2",
      },
      {
        id: "quote-store-mismatch",
        organization_id: "org-1",
        store_id: "store-2",
        lead_id: "lead-a",
        commercial_opportunity_id: "opp-store-mismatch",
      },
    ],
    sales_contracts: [
      {
        id: "contract-1",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-a",
        quote_id: "quote-1",
        contract_number: "C1",
        status: "pending_review",
        title: "Contract 1",
        total_cents: 1000,
        current_version_id: null,
        created_at: "2026-09-12T10:00:00.000Z",
      },
      {
        id: "contract-2",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-a",
        quote_id: "quote-2",
        contract_number: "C2",
        status: "pending_review",
        title: "Contract 2",
        total_cents: 2000,
        current_version_id: null,
        created_at: "2026-09-12T11:00:00.000Z",
      },
      {
        id: "contract-manual-opp-1",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-a",
        quote_id: null,
        quote_version_id: null,
        metadata: {
          source: "responsible_text_draft",
          created_via: "create_sales_contract_manual_by_system",
          commercial_opportunity_id: "opp-1",
        },
        contract_number: "M1",
        status: "draft",
        title: "Manual Contract 1",
        total_cents: 0,
        current_version_id: null,
        created_at: "2026-09-12T12:00:00.000Z",
      },
      {
        id: "contract-manual",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-a",
        quote_id: null,
        quote_version_id: null,
        metadata: {
          source: "responsible_text_draft",
          created_via: "create_sales_contract_manual_by_system",
          commercial_opportunity_id: "opp-manual",
        },
        contract_number: "CM",
        status: "draft",
        title: "Manual Contract",
        total_cents: 0,
        current_version_id: null,
        created_at: "2026-09-12T13:00:00.000Z",
      },
      {
        id: "contract-manual-invalid",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-a",
        quote_id: null,
        quote_version_id: null,
        metadata: {
          source: "responsible_text_draft",
          created_via: "wrong_writer",
          commercial_opportunity_id: "opp-manual",
        },
        contract_number: "BAD",
        status: "draft",
        title: "Invalid Manual Contract",
        total_cents: 0,
        current_version_id: null,
        created_at: "2026-09-12T14:00:00.000Z",
      },
      {
        id: "contract-manual-wrong-opportunity",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-a",
        quote_id: null,
        quote_version_id: null,
        metadata: {
          source: "responsible_text_draft",
          created_via: "create_sales_contract_manual_by_system",
          commercial_opportunity_id: "opp-2",
        },
        contract_number: "WRONG-OPP",
        status: "draft",
        title: "Wrong Opportunity",
        total_cents: 0,
        current_version_id: null,
        created_at: "2026-09-12T15:00:00.000Z",
      },
      {
        id: "contract-store-mismatch",
        organization_id: "org-1",
        store_id: "store-2",
        lead_id: "lead-a",
        quote_id: "quote-store-mismatch",
        contract_number: "C-STORE",
        status: "pending_review",
        title: "Contract Store Mismatch",
        total_cents: 3000,
        current_version_id: null,
        created_at: "2026-09-12T12:00:00.000Z",
      },
      {
        id: "contract-store-2",
        organization_id: "org-1",
        store_id: "store-2",
        lead_id: "lead-store-2",
        quote_id: "quote-store-2",
        contract_number: "C-STORE-2",
        status: "pending_review",
        title: "Contract Store 2",
        total_cents: 4000,
        current_version_id: null,
        created_at: "2026-09-12T13:00:00.000Z",
      },
      {
        id: "contract-foreign-org",
        organization_id: "org-2",
        store_id: "store-foreign",
        lead_id: "lead-a",
        quote_id: "quote-foreign",
        contract_number: "C-FOREIGN",
        status: "pending_review",
        title: "Foreign Contract",
        total_cents: 5000,
        current_version_id: null,
        created_at: "2026-09-12T14:00:00.000Z",
      },
    ],
  };

  const queryLog: string[] = [];

  function createQueryBuilder(table: string) {
    const filters: Array<{ column: string; value: unknown }> = [];
    const inFilters: Array<{ column: string; values: unknown[] }> = [];
    let orderColumn: string | null = null;
    let orderAscending = true;

    function rows() {
      let selectedRows = [...(tables[table] ?? [])].filter((row) => {
        const eqMatches = filters.every((filter) => row[filter.column] === filter.value);
        const inMatches = inFilters.every((filter) => filter.values.includes(row[filter.column]));
        return eqMatches && inMatches;
      });

      if (orderColumn) {
        selectedRows = selectedRows.sort((left, right) => {
          const leftValue = String(left[orderColumn as string] || "");
          const rightValue = String(right[orderColumn as string] || "");
          return orderAscending
            ? leftValue.localeCompare(rightValue)
            : rightValue.localeCompare(leftValue);
        });
      }

      return selectedRows;
    }

    const builder = {
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        return builder;
      },
      in(column: string, values: unknown[]) {
        inFilters.push({ column, values });
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orderColumn = column;
        orderAscending = options?.ascending !== false;
        return builder;
      },
      async maybeSingle<T>() {
        return { data: (rows()[0] ?? null) as T | null, error: null };
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
      },
    };

    return builder;
  }

  return {
    from(table: string) {
        queryLog.push(table);
      return createQueryBuilder(table);
    },
      queryLog,
  };
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function requestContracts(args: {
  query?: Record<string, string>;
  access?: StoreApiAccessResult;
  onRequirement?: (requirement: string) => void;
  onServiceClient?: () => void;
  serviceClientError?: string;
}) {
  const { createSalesContractsListGetHandler } = await routeModulePromise;
  const supabase = createFixtureSupabase();
  const serviceSupabase = createFixtureSupabase();
  const handler = createSalesContractsListGetHandler({
    resolveAccess: async ({ requirement }) => {
      args.onRequirement?.(requirement);
      return args.access || grantedAccess(supabase);
    },
    createServiceClient: () => {
      args.onServiceClient?.();
      if (args.serviceClientError) {
        throw new Error(args.serviceClientError);
      }
      return serviceSupabase as never;
    },
  });
  const params = new URLSearchParams(args.query);
  const response = await handler(new Request(`https://example.test/api/sales-contracts?${params}`));
  return {
    response,
    body: await parseBody(response),
    queryLog: supabase.queryLog,
    serviceQueryLog: serviceSupabase.queryLog,
  };
}

const tests: TestCase[] = [
  {
    name: "lead with two opportunities only receives opp-1 contracts",
    run: async () => {
      const { response, body } = await requestContracts({
        query: { leadId: "lead-a", commercialOpportunityId: "opp-1" },
      });
      const contracts = body.contracts as Array<Record<string, unknown>>;

      assert.equal(response.status, 200);
      assert.deepEqual(contracts.map((contract) => contract.contract_number), ["M1", "C1"]);
    },
  },
  {
    name: "manual contract without quote is returned for the opportunity",
    run: async () => {
      const { response, body } = await requestContracts({
        query: { leadId: "lead-a", commercialOpportunityId: "opp-manual" },
      });
      const contracts = body.contracts as Array<Record<string, unknown>>;

      assert.equal(response.status, 200);
      assert.deepEqual(contracts.map((contract) => contract.contract_number), ["CM"]);
      assert.equal(contracts[0]?.id, "contract-manual");
      assert.equal(contracts[0]?.quote_id, null);
      assert.equal(contracts[0]?.quote_version_id, null);
    },
  },
  {
    name: "opportunity without quote or contract is empty",
    run: async () => {
      const { response, body } = await requestContracts({
        query: { leadId: "lead-a", commercialOpportunityId: "opp-empty" },
      });

      assert.equal(response.status, 200);
      assert.deepEqual(body.contracts, []);
    },
  },
  {
    name: "inconsistent manual provenance is excluded",
    run: async () => {
      const { body } = await requestContracts({
        query: { leadId: "lead-a", commercialOpportunityId: "opp-manual" },
      });
      const contracts = body.contracts as Array<Record<string, unknown>>;

      assert.equal(contracts.some((contract) => contract.contract_number === "BAD"), false);
      assert.equal(
        contracts.some((contract) => contract.contract_number === "WRONG-OPP"),
        false,
      );
    },
  },
  {
    name: "manual and quote contracts are both returned without duplicates",
    run: async () => {
      const { body } = await requestContracts({
        query: { leadId: "lead-a", commercialOpportunityId: "opp-1" },
      });
      const contracts = body.contracts as Array<Record<string, unknown>>;

      assert.deepEqual(contracts.map((contract) => contract.id), [
        "contract-manual-opp-1",
        "contract-1",
      ]);
      assert.equal(new Set(contracts.map((contract) => contract.id)).size, contracts.length);
    },
  },
  {
    name: "manual contract replay can be recovered by the same list identity",
    run: async () => {
      const first = await requestContracts({
        query: { leadId: "lead-a", commercialOpportunityId: "opp-manual" },
      });
      const replay = await requestContracts({
        query: { leadId: "lead-a", commercialOpportunityId: "opp-manual" },
      });
      const firstContracts = first.body.contracts as Array<Record<string, unknown>>;
      const replayContracts = replay.body.contracts as Array<Record<string, unknown>>;

      assert.equal(firstContracts[0]?.id, "contract-manual");
      assert.equal(replayContracts[0]?.id, firstContracts[0]?.id);
    },
  },
  {
    name: "lead with two opportunities only receives opp-2 contracts",
    run: async () => {
      const { response, body } = await requestContracts({
        query: { leadId: "lead-a", commercialOpportunityId: "opp-2" },
      });
      const contracts = body.contracts as Array<Record<string, unknown>>;

      assert.equal(response.status, 200);
      assert.deepEqual(contracts.map((contract) => contract.contract_number), [
        "WRONG-OPP",
        "C2",
      ]);
    },
  },
  {
    name: "foreign opportunity fails closed",
    run: async () => {
      const { response, body } = await requestContracts({
        query: { leadId: "lead-a", commercialOpportunityId: "opp-foreign" },
      });

      assert.equal(response.status, 403);
      assert.equal(body.error, "COMMERCIAL_OPPORTUNITY_NOT_FOUND_OR_FORBIDDEN");
    },
  },
  {
    name: "same organization and store opportunity from another lead fails closed",
    run: async () => {
      const { response, body } = await requestContracts({
        query: { leadId: "lead-a", commercialOpportunityId: "opp-other-lead" },
      });

      assert.equal(response.status, 403);
      assert.equal(body.error, "COMMERCIAL_OPPORTUNITY_NOT_FOUND_OR_FORBIDDEN");
    },
  },
  {
    name: "same organization and lead opportunity from another store fails closed",
    run: async () => {
      const { response, body } = await requestContracts({
        query: { leadId: "lead-a", commercialOpportunityId: "opp-store-mismatch" },
      });

      assert.equal(response.status, 403);
      assert.equal(body.error, "COMMERCIAL_OPPORTUNITY_NOT_FOUND_OR_FORBIDDEN");
      assert.equal(Array.isArray(body.contracts), false);
    },
  },
  {
    name: "denied canonical access stops before commercial queries",
    run: async () => {
      const { response, body, queryLog } = await requestContracts({
        access: deniedAccess(),
        onServiceClient: () => {
          throw new Error("service client must not be created for denied access");
        },
      });

      assert.equal(response.status, 401);
      assert.equal(body.error, "STORE_API_UNAUTHENTICATED");
      assert.deepEqual(queryLog, []);
    },
  },
  {
    name: "authorized scope is validated before the service contract query",
    run: async () => {
      const events: string[] = [];
      const { response, serviceQueryLog } = await requestContracts({
        query: { leadId: "lead-a", commercialOpportunityId: "opp-manual" },
        onRequirement: () => events.push("session-authenticated"),
        onServiceClient: () => events.push("service-client-created"),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(events, ["session-authenticated", "service-client-created"]);
      assert.deepEqual(serviceQueryLog, ["sales_contracts"]);
    },
  },
  {
    name: "service client failure returns a controlled error without partial data",
    run: async () => {
      const { response, body } = await requestContracts({
        query: { leadId: "lead-a", commercialOpportunityId: "opp-manual" },
        serviceClientError: "service client unavailable",
      });

      assert.equal(response.status, 500);
      assert.equal(body.error, "SALES_CONTRACTS_LIST_FAILED");
      assert.equal(body.contracts, undefined);
    },
  },
  {
    name: "route requests active canonical access",
    run: async () => {
      let requirement: string | undefined;
      await requestContracts({ onRequirement: (value) => { requirement = value; } });

      assert.equal(requirement, "active");
    },
  },
  {
    name: "organization query spoof is rejected before listing",
    run: async () => {
      const { response, body, queryLog } = await requestContracts({
        query: { organizationId: "org-2" },
      });

      assert.equal(response.status, 403);
      assert.equal(body.error, "FORBIDDEN_ORGANIZATION");
      assert.equal(queryLog.includes("sales_contracts"), false);
    },
  },
  {
    name: "store query spoof is rejected before listing",
    run: async () => {
      const { response, body, queryLog } = await requestContracts({
        query: { storeId: "store-2" },
      });

      assert.equal(response.status, 403);
      assert.equal(body.error, "FORBIDDEN_STORE");
      assert.equal(queryLog.includes("sales_contracts"), false);
    },
  },
  {
    name: "generic list is canonically scoped to the active store",
    run: async () => {
      const { response, body } = await requestContracts({ query: {} });
      const contracts = body.contracts as Array<Record<string, unknown>>;

      assert.equal(response.status, 200);
      assert.deepEqual(contracts.map((contract) => contract.contract_number), [
        "WRONG-OPP",
        "CM",
        "M1",
        "C2",
        "C1",
      ]);
      assert.equal(contracts.some((contract) => contract.contract_number === "C-STORE-2"), false);
      assert.equal(contracts.some((contract) => contract.contract_number === "C-FOREIGN"), false);
    },
  },
  {
    name: "same organization lead from another store fails before opportunity resolution",
    run: async () => {
      const { response, body, queryLog } = await requestContracts({
        query: { leadId: "lead-store-2", commercialOpportunityId: "opp-1" },
      });

      assert.equal(response.status, 403);
      assert.equal(body.error, "CONTRACT_OPPORTUNITY_SCOPE_MISMATCH");
      assert.deepEqual(queryLog, ["leads"]);
    },
  },
  {
    name: "source contract uses canonical active access and base tenant filters",
    run: () => {
      const source = readFileSync(join(process.cwd(), "src/app/api/sales-contracts/route.ts"), "utf8");

      assert.match(source, /resolveStoreApiAccess/);
      assert.match(source, /createStoreApiDeniedResponse/);
      assert.match(source, /requirement: "active"/);
      assert.doesNotMatch(source, /authenticateContractRequest/);
      assert.doesNotMatch(source, /organizationIds/);
      assert.match(source, /\.eq\("organization_id", access\.organizationId\)/);
      assert.match(source, /\.eq\("store_id", access\.storeId\)/);
    },
  },
];

for (const test of tests) {
  await test.run();
  console.log(`ok - ${test.name}`);
}
