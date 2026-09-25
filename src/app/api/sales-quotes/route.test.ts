import { strict as assert } from "node:assert";
import Module from "node:module";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type Row = Record<string, unknown>;
type RpcCall = {
  fn: string;
  payload: Record<string, unknown>;
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

function createFixtureSupabase(args?: {
  currentProposalRows?: Row[];
  currentProposalError?: { message: string };
}) {
  const rpcCalls: RpcCall[] = [];
  const tables: Record<string, Row[]> = {
    leads: [
      { id: "lead-a", organization_id: "org-1", store_id: "store-1" },
      { id: "lead-b", organization_id: "org-1", store_id: "store-1" },
    ],
    stores: [{ id: "store-1", organization_id: "org-1" }],
    commercial_opportunities: [
      { id: "opp-1", organization_id: "org-1", store_id: "store-1", origin_lead_id: "lead-a" },
      { id: "opp-2", organization_id: "org-1", store_id: "store-1", origin_lead_id: "lead-a" },
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
        quote_number: "Q1",
        title: "Quote 1",
        status: "approved",
        total_cents: 1000,
        current_version_id: "version-internal-v2",
        created_at: "2026-09-12T10:00:00.000Z",
      },
      {
        id: "quote-2",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-a",
        commercial_opportunity_id: "opp-2",
        quote_number: "Q2",
        title: "Quote 2",
        status: "approved",
        total_cents: 2000,
        current_version_id: null,
        created_at: "2026-09-12T11:00:00.000Z",
      },
      {
        id: "quote-store-mismatch",
        organization_id: "org-1",
        store_id: "store-2",
        lead_id: "lead-a",
        commercial_opportunity_id: "opp-store-mismatch",
        quote_number: "Q-STORE",
        title: "Quote Store Mismatch",
        status: "approved",
        total_cents: 3000,
        current_version_id: null,
        created_at: "2026-09-12T12:00:00.000Z",
      },
    ],
    sales_quote_versions: [],
  };

  function buildDefaultCurrentProposalRows(commercialOpportunityId: unknown): Row[] {
    const opportunityId = String(commercialOpportunityId || "").trim();
    const quoteId = opportunityId === "opp-2" ? "quote-2" : "quote-1";

    return [
      {
        organization_id: "org-1",
        store_id: "store-1",
        commercial_opportunity_id: opportunityId || "opp-1",
        proposal_state: "available",
        current_quote_id: quoteId,
        current_quote_version_id:
          opportunityId === "opp-2" ? "version-presented-v2" : "version-presented-v1",
        reason_code: "current_proposal_available",
      },
    ];
  }

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
    rpcCalls,
    from(table: string) {
      return createQueryBuilder(table);
    },
    async rpc(fn: string, payload: Record<string, unknown>) {
      rpcCalls.push({ fn, payload });

      if (fn !== "read_current_commercial_proposal_by_system") {
        throw new Error(`Unexpected rpc: ${fn}`);
      }

      if (args?.currentProposalError) {
        return { data: null, error: args.currentProposalError };
      }

      return {
        data: args && "currentProposalRows" in args
          ? args.currentProposalRows
          : buildDefaultCurrentProposalRows(payload.p_commercial_opportunity_id),
        error: null,
      };
    },
  };
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function requestQuotes(args: {
  leadId: string;
  commercialOpportunityId: string;
  currentProposalRows?: Row[];
  currentProposalError?: { message: string };
}) {
  const { createSalesQuotesListGetHandler } = await routeModulePromise;
  const fixtureOptions: Parameters<typeof createFixtureSupabase>[0] = {};
  if ("currentProposalRows" in args) {
    fixtureOptions.currentProposalRows = args.currentProposalRows;
  }
  if ("currentProposalError" in args) {
    fixtureOptions.currentProposalError = args.currentProposalError;
  }
  const supabase = createFixtureSupabase(fixtureOptions);
  const handler = createSalesQuotesListGetHandler({
    authenticateQuoteRequest: async () =>
      ({
        supabase,
        organizationIds: ["org-1"],
      }) as never,
  });
  const params = new URLSearchParams({
    leadId: args.leadId,
    commercialOpportunityId: args.commercialOpportunityId,
  });
  const response = await handler(new Request(`https://example.test/api/sales-quotes?${params}`));
  return { response, body: await parseBody(response), supabase };
}

const tests: TestCase[] = [
  {
    name: "lead with two opportunities only receives opp-1 quotes",
    run: async () => {
      const { response, body } = await requestQuotes({
        leadId: "lead-a",
        commercialOpportunityId: "opp-1",
      });
      const quotes = body.quotes as Array<Record<string, unknown>>;
      const currentProposal = body.currentCommercialProposal as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.deepEqual(quotes.map((quote) => quote.quote_number), ["Q1"]);
      assert.equal(quotes[0]?.current_version_id, "version-internal-v2");
      assert.equal(currentProposal.current_quote_id, "quote-1");
      assert.equal(currentProposal.current_quote_version_id, "version-presented-v1");
    },
  },
  {
    name: "current commercial proposal rpc uses authorized opportunity scope",
    run: async () => {
      const { response, supabase } = await requestQuotes({
        leadId: "lead-a",
        commercialOpportunityId: "opp-1",
      });

      assert.equal(response.status, 200);
      assert.deepEqual(supabase.rpcCalls, [
        {
          fn: "read_current_commercial_proposal_by_system",
          payload: {
            p_organization_id: "org-1",
            p_store_id: "store-1",
            p_commercial_opportunity_id: "opp-1",
          },
        },
      ]);
    },
  },
  {
    name: "needs resolution current proposal is preserved without quote fallback",
    run: async () => {
      const { response, body } = await requestQuotes({
        leadId: "lead-a",
        commercialOpportunityId: "opp-1",
        currentProposalRows: [
          {
            organization_id: "org-1",
            store_id: "store-1",
            commercial_opportunity_id: "opp-1",
            proposal_state: "needs_resolution",
            current_quote_id: null,
            current_quote_version_id: null,
            reason_code: "current_proposal_needs_resolution",
          },
        ],
      });
      const currentProposal = body.currentCommercialProposal as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(currentProposal.proposal_state, "needs_resolution");
      assert.equal(currentProposal.current_quote_id, null);
      assert.equal(currentProposal.current_quote_version_id, null);
    },
  },
  {
    name: "current commercial proposal rpc error fails closed",
    run: async () => {
      const { response, body } = await requestQuotes({
        leadId: "lead-a",
        commercialOpportunityId: "opp-1",
        currentProposalError: { message: "rpc failed" },
      });

      assert.equal(response.status, 500);
      assert.equal(body.error, "LOAD_CURRENT_COMMERCIAL_PROPOSAL_FAILED");
    },
  },
  {
    name: "current commercial proposal scope mismatch fails closed",
    run: async () => {
      const { response, body } = await requestQuotes({
        leadId: "lead-a",
        commercialOpportunityId: "opp-1",
        currentProposalRows: [
          {
            organization_id: "org-2",
            store_id: "store-1",
            commercial_opportunity_id: "opp-1",
            proposal_state: "available",
            current_quote_id: "quote-1",
            current_quote_version_id: "version-presented-v1",
          },
        ],
      });

      assert.equal(response.status, 409);
      assert.equal(body.error, "CURRENT_COMMERCIAL_PROPOSAL_SCOPE_INVALID");
    },
  },
  {
    name: "available current proposal without version fails closed without quote fallback",
    run: async () => {
      const { response, body } = await requestQuotes({
        leadId: "lead-a",
        commercialOpportunityId: "opp-1",
        currentProposalRows: [
          {
            organization_id: "org-1",
            store_id: "store-1",
            commercial_opportunity_id: "opp-1",
            proposal_state: "available",
            current_quote_id: "quote-1",
            current_quote_version_id: null,
            reason_code: "current_proposal_available",
          },
        ],
      });

      assert.equal(response.status, 409);
      assert.equal(body.error, "CURRENT_COMMERCIAL_PROPOSAL_MALFORMED");
      assert.equal(Array.isArray(body.quotes), false);
    },
  },
  {
    name: "lead with two opportunities only receives opp-2 quotes",
    run: async () => {
      const { response, body } = await requestQuotes({
        leadId: "lead-a",
        commercialOpportunityId: "opp-2",
      });
      const quotes = body.quotes as Array<Record<string, unknown>>;

      assert.equal(response.status, 200);
      assert.deepEqual(quotes.map((quote) => quote.quote_number), ["Q2"]);
    },
  },
  {
    name: "foreign opportunity fails closed",
    run: async () => {
      const { response, body } = await requestQuotes({
        leadId: "lead-a",
        commercialOpportunityId: "opp-foreign",
      });

      assert.equal(response.status, 403);
      assert.equal(body.error, "COMMERCIAL_OPPORTUNITY_NOT_FOUND_OR_FORBIDDEN");
    },
  },
  {
    name: "same organization and store opportunity from another lead fails closed",
    run: async () => {
      const { response, body } = await requestQuotes({
        leadId: "lead-a",
        commercialOpportunityId: "opp-other-lead",
      });

      assert.equal(response.status, 403);
      assert.equal(body.error, "COMMERCIAL_OPPORTUNITY_NOT_FOUND_OR_FORBIDDEN");
    },
  },
  {
    name: "same organization and lead opportunity from another store fails closed",
    run: async () => {
      const { response, body } = await requestQuotes({
        leadId: "lead-a",
        commercialOpportunityId: "opp-store-mismatch",
      });

      assert.equal(response.status, 403);
      assert.equal(body.error, "COMMERCIAL_OPPORTUNITY_NOT_FOUND_OR_FORBIDDEN");
      assert.equal(Array.isArray(body.quotes), false);
    },
  },
];

for (const test of tests) {
  await test.run();
  console.log(`ok - ${test.name}`);
}
