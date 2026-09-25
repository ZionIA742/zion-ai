import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  executeAssistantContractGeneration,
  handleAssistantContractGenerationRequest,
} from "./contract-generation-intent";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createSalesContractsSupabaseMock() {
  return {
    from(table: string) {
      assert.equal(table, "sales_contracts");
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
    },
  };
}

function createQuoteScope() {
  return {
    organizationId: "org-1",
    store: { id: "store-1" },
    quote: {
      id: "quote-1",
      quote_number: "ORC-1",
      organization_id: "org-1",
      store_id: "store-1",
      lead_id: "lead-1",
      conversation_id: "conversation-1",
      status: "sent",
      total_cents: 120000,
      current_version_id: "version-internal-v2",
    },
  };
}

function createTextIntentSupabaseMock(args?: {
  quoteRow?: Record<string, unknown> | null;
  proposalRows?: Array<Record<string, unknown>>;
}) {
  const rpcCalls: Array<{ fn: string; payload: Record<string, unknown> }> = [];
  const quoteSelects: string[] = [];
  const quoteFilters: Array<Array<{ column: string; value: unknown }>> = [];
  const quoteRow =
    "quoteRow" in (args || {})
      ? args?.quoteRow
      : {
          id: "quote-1",
          quote_number: "ORC-123",
          commercial_opportunity_id: "opp-1",
          current_version_id: "version-internal-v2",
        };
  const proposalRows =
    args?.proposalRows ?? [
      {
        organization_id: "org-1",
        store_id: "store-1",
        commercial_opportunity_id: "opp-1",
        proposal_state: "available",
        current_quote_id: "quote-1",
        current_quote_version_id: "version-presented-v1",
      },
    ];

  return {
    rpcCalls,
    quoteSelects,
    quoteFilters,
    supabase: {
      from(table: string) {
        assert.equal(table, "sales_quotes");
        const filters: Array<{ column: string; value: unknown }> = [];
        return {
          select(selection: string) {
            quoteSelects.push(selection);
            return this;
          },
          eq(column: string, value: unknown) {
            filters.push({ column, value });
            return this;
          },
          async maybeSingle() {
            quoteFilters.push(filters.slice());
            if (!quoteRow) {
              return { data: null, error: null };
            }

            const idFilter = filters.find((filter) => filter.column === "id");
            const numberFilter = filters.find((filter) => filter.column === "quote_number");
            const matchesId = !idFilter || idFilter.value === quoteRow.id;
            const matchesNumber =
              !numberFilter ||
              numberFilter.value === quoteRow.quote_number ||
              numberFilter.value === "ORC123";

            return {
              data: matchesId && matchesNumber ? quoteRow : null,
              error: null,
            };
          },
        };
      },
      async rpc(fn: string, payload: Record<string, unknown>) {
        rpcCalls.push({ fn, payload });
        assert.equal(fn, "read_current_commercial_proposal_by_system");
        return {
          data: proposalRows,
          error: null,
        };
      },
    },
  };
}

const tests: TestCase[] = [
  {
    name: "contract generation posts exact quoteVersionId to create-from-quote",
    run: async () => {
      const decisions: Array<Record<string, unknown>> = [];
      const internalCalls: Array<{ path: string; body: Record<string, unknown> | null }> = [];

      const result = await executeAssistantContractGeneration({
        request: new Request("https://app.test/api/assistant"),
        supabase: createSalesContractsSupabaseMock(),
        organizationId: "org-1",
        storeId: "store-1",
        quoteId: "quote-1",
        quoteVersionId: "version-presented-v1",
        quoteNumber: "ORC-1",
        source: "assistant_contract_workflow_button_v1",
        resolveAuthorizedExistingQuote: async () => createQuoteScope(),
        evaluateContractWorkflowDecision: (args: any) => {
          decisions.push(args);
          return {
            allowed: true,
            needsHumanConfirmation: false,
            reasonCode: "HUMAN_EXPLICIT_REQUEST_ALLOWED",
            reasonMessage: "Ok",
            missingRequirements: [],
            warnings: [],
            recommendedNextAction: "generate_contract",
          };
        },
        callInternalJson: async (_request: Request, path: string, init?: RequestInit) => {
          internalCalls.push({
            path,
            body: init?.body ? JSON.parse(String(init.body)) : null,
          });

          if (path === "/api/sales-contracts/create-from-quote") {
            return {
              ok: true,
              status: 200,
              body: { ok: true, contract: { id: "contract-1" } },
            };
          }

          if (path === "/api/sales-contracts/contract-1/generate-pdf") {
            return {
              ok: true,
              status: 200,
              body: { ok: true },
            };
          }

          throw new Error(`Unexpected path ${path}`);
        },
      });

      assert.equal(result.ok, true);
      assert.equal(result.quoteVersionId, "version-presented-v1");
      assert.equal(decisions.length, 1);
      assert.equal(
        (decisions[0]?.quote as Record<string, unknown>)?.current_version_id,
        "version-presented-v1",
      );
      assert.equal(internalCalls[0]?.path, "/api/sales-contracts/create-from-quote");
      assert.deepEqual(internalCalls[0]?.body, {
        quoteId: "quote-1",
        quoteVersionId: "version-presented-v1",
      });
    },
  },
  {
    name: "missing quoteVersionId fails before quote resolution or internal calls",
    run: async () => {
      let quoteResolutionCount = 0;
      let decisionCount = 0;
      let internalCallCount = 0;

      const result = await executeAssistantContractGeneration({
        request: new Request("https://app.test/api/assistant"),
        supabase: createSalesContractsSupabaseMock(),
        organizationId: "org-1",
        storeId: "store-1",
        quoteId: "quote-1",
        quoteNumber: "ORC-1",
        source: "assistant_contract_workflow_button_v1",
        resolveAuthorizedExistingQuote: async () => {
          quoteResolutionCount += 1;
          return createQuoteScope();
        },
        evaluateContractWorkflowDecision: (() => {
          decisionCount += 1;
          return {
            allowed: true,
            needsHumanConfirmation: false,
            reasonCode: "HUMAN_EXPLICIT_REQUEST_ALLOWED",
            reasonMessage: "Ok",
            missingRequirements: [],
            warnings: [],
            recommendedNextAction: "generate_contract",
          };
        }) as any,
        callInternalJson: async () => {
          internalCallCount += 1;
          return {
            ok: true,
            status: 200,
            body: { ok: true },
          };
        },
      });

      assert.equal(result.ok, false);
      assert.equal(result.status, 409);
      assert.equal(result.metadata.reasonCode, "QUOTE_VERSION_REFERENCE_REQUIRED");
      assert.equal(result.quoteVersionId, undefined);
      assert.equal(quoteResolutionCount, 0);
      assert.equal(decisionCount, 0);
      assert.equal(internalCallCount, 0);
    },
  },
  {
    name: "text intent with explicit number uses current commercial proposal quote version",
    run: async () => {
      const mock = createTextIntentSupabaseMock();
      const executions: Array<Record<string, unknown>> = [];

      const result = await handleAssistantContractGenerationRequest({
        request: new Request("https://app.test/api/assistant"),
        supabase: mock.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        recentMessages: [],
        lastHumanMessage: "gere o contrato do orcamento ORC-123",
        executeAssistantContractGeneration: async (args: any) => {
          executions.push(args);
          return {
            ok: true,
            status: 200,
            reply: "Contrato gerado.",
            metadata: {
              reasonCode: "HUMAN_EXPLICIT_REQUEST_ALLOWED",
            },
            quoteId: args.quoteId,
            quoteVersionId: args.quoteVersionId,
            contractId: "contract-1",
          };
        },
      });

      assert.equal(result.handled, true);
      assert.equal(executions.length, 1);
      assert.equal(executions[0]?.quoteId, "quote-1");
      assert.equal(executions[0]?.quoteVersionId, "version-presented-v1");
      assert.deepEqual(mock.rpcCalls, [
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
    name: "text intent ignores sales_quotes current_version_id",
    run: async () => {
      const mock = createTextIntentSupabaseMock();
      const executions: Array<Record<string, unknown>> = [];

      await handleAssistantContractGenerationRequest({
        request: new Request("https://app.test/api/assistant"),
        supabase: mock.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        recentMessages: [],
        lastHumanMessage: "gere o contrato do orcamento ORC-123",
        executeAssistantContractGeneration: async (args: any) => {
          executions.push(args);
          return {
            ok: true,
            status: 200,
            reply: "Contrato gerado.",
            metadata: {},
          };
        },
      });

      assert.equal(executions[0]?.quoteVersionId, "version-presented-v1");
      assert.equal(
        mock.quoteSelects.some((selection) => selection.includes("current_version_id")),
        false,
      );
    },
  },
  {
    name: "text intent fails when requested quote is not current commercial proposal",
    run: async () => {
      const mock = createTextIntentSupabaseMock({
        quoteRow: {
          id: "quote-old",
          quote_number: "ORC-123",
          commercial_opportunity_id: "opp-1",
        },
        proposalRows: [
          {
            organization_id: "org-1",
            store_id: "store-1",
            commercial_opportunity_id: "opp-1",
            proposal_state: "available",
            current_quote_id: "quote-current",
            current_quote_version_id: "version-current",
          },
        ],
      });
      let executionCount = 0;

      const result = await handleAssistantContractGenerationRequest({
        request: new Request("https://app.test/api/assistant"),
        supabase: mock.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        recentMessages: [],
        lastHumanMessage: "gere o contrato do orcamento ORC-123",
        executeAssistantContractGeneration: async () => {
          executionCount += 1;
          return {
            ok: true,
            status: 200,
            reply: "Contrato gerado.",
            metadata: {},
          };
        },
      });

      assert.equal(result.handled, true);
      assert.equal(result.metadata?.reasonCode, "QUOTE_IS_NOT_CURRENT_COMMERCIAL_PROPOSAL");
      assert.equal(result.metadata?.quoteId, "quote-old");
      assert.equal(result.metadata?.commercialOpportunityId, "opp-1");
      assert.equal(result.metadata?.quoteVersionId, "version-current");
      assert.equal(executionCount, 0);
    },
  },
  {
    name: "text intent fails when current proposal is not available",
    run: async () => {
      const mock = createTextIntentSupabaseMock({
        proposalRows: [
          {
            organization_id: "org-1",
            store_id: "store-1",
            commercial_opportunity_id: "opp-1",
            proposal_state: "needs_resolution",
            current_quote_id: "quote-1",
            current_quote_version_id: "version-presented-v1",
          },
        ],
      });
      let executionCount = 0;

      const result = await handleAssistantContractGenerationRequest({
        request: new Request("https://app.test/api/assistant"),
        supabase: mock.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        recentMessages: [],
        lastHumanMessage: "gere o contrato do orcamento ORC-123",
        executeAssistantContractGeneration: async () => {
          executionCount += 1;
          return {
            ok: true,
            status: 200,
            reply: "Contrato gerado.",
            metadata: {},
          };
        },
      });

      assert.equal(result.handled, true);
      assert.equal(result.metadata?.reasonCode, "CURRENT_COMMERCIAL_PROPOSAL_UNAVAILABLE");
      assert.equal(executionCount, 0);
    },
  },
  {
    name: "text intent fails when current proposal quote version is missing",
    run: async () => {
      const mock = createTextIntentSupabaseMock({
        proposalRows: [
          {
            organization_id: "org-1",
            store_id: "store-1",
            commercial_opportunity_id: "opp-1",
            proposal_state: "available",
            current_quote_id: "quote-1",
            current_quote_version_id: null,
          },
        ],
      });
      let executionCount = 0;

      const result = await handleAssistantContractGenerationRequest({
        request: new Request("https://app.test/api/assistant"),
        supabase: mock.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        recentMessages: [],
        lastHumanMessage: "gere o contrato do orcamento ORC-123",
        executeAssistantContractGeneration: async () => {
          executionCount += 1;
          return {
            ok: true,
            status: 200,
            reply: "Contrato gerado.",
            metadata: {},
          };
        },
      });

      assert.equal(result.handled, true);
      assert.equal(
        result.metadata?.reasonCode,
        "CURRENT_COMMERCIAL_PROPOSAL_QUOTE_VERSION_REQUIRED",
      );
      assert.equal(executionCount, 0);
    },
  },
  {
    name: "text intent fails when quote has no commercial opportunity",
    run: async () => {
      const mock = createTextIntentSupabaseMock({
        quoteRow: {
          id: "quote-1",
          quote_number: "ORC-123",
          commercial_opportunity_id: null,
        },
      });
      let executionCount = 0;

      const result = await handleAssistantContractGenerationRequest({
        request: new Request("https://app.test/api/assistant"),
        supabase: mock.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        recentMessages: [],
        lastHumanMessage: "gere o contrato do orcamento ORC-123",
        executeAssistantContractGeneration: async () => {
          executionCount += 1;
          return {
            ok: true,
            status: 200,
            reply: "Contrato gerado.",
            metadata: {},
          };
        },
      });

      assert.equal(result.handled, true);
      assert.equal(
        result.metadata?.reasonCode,
        "QUOTE_COMMERCIAL_OPPORTUNITY_REQUIRED_FOR_CONTRACT",
      );
      assert.equal(mock.rpcCalls.length, 0);
      assert.equal(executionCount, 0);
    },
  },
  {
    name: "text intent recent document context uses current proposal version only",
    run: async () => {
      const mock = createTextIntentSupabaseMock({
        proposalRows: [
          {
            organization_id: "org-1",
            store_id: "store-1",
            commercial_opportunity_id: "opp-1",
            proposal_state: "available",
            current_quote_id: "quote-1",
            current_quote_version_id: "version-current-proposal",
          },
        ],
      });
      const executions: Array<Record<string, unknown>> = [];

      await handleAssistantContractGenerationRequest({
        request: new Request("https://app.test/api/assistant"),
        supabase: mock.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        recentMessages: [
          {
            metadata: {
              kind: "document_review",
              document_type: "quote",
              document_id: "quote-1",
              document_number: "ORC-123",
              document_version_id: "version-document-old",
            },
          },
        ],
        lastHumanMessage: "pode gerar o contrato desse orcamento?",
        executeAssistantContractGeneration: async (args: any) => {
          executions.push(args);
          return {
            ok: true,
            status: 200,
            reply: "Contrato gerado.",
            metadata: {},
          };
        },
      });

      assert.equal(executions.length, 1);
      assert.equal(executions[0]?.quoteId, "quote-1");
      assert.equal(executions[0]?.quoteVersionId, "version-current-proposal");
      assert.notEqual(executions[0]?.quoteVersionId, "version-document-old");
    },
  },
  {
    name: "text intent current proposal resolver has no version fallback authority",
    run: () => {
      const source = readFileSync(
        "src/lib/server/assistant/contract-generation-intent.ts",
        "utf8",
      );
      const start = source.indexOf(
        "async function resolveCurrentProposalQuoteVersionForTextContract",
      );
      const end = source.indexOf("async function callInternalJson", start);
      assert.notEqual(start, -1);
      assert.notEqual(end, -1);
      const resolverSource = source.slice(start, end);

      assert.equal(
        resolverSource.includes("read_current_commercial_proposal_by_system"),
        true,
      );
      assert.equal(resolverSource.includes("current_version_id"), false);
      assert.equal(resolverSource.includes("document_version_id"), false);
      assert.equal(/\blatest\b/i.test(resolverSource), false);
      assert.equal(/\bmax\s*\(/i.test(resolverSource), false);
      assert.equal(resolverSource.includes("version_number"), false);
      assert.equal(resolverSource.includes("created_at"), false);
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
