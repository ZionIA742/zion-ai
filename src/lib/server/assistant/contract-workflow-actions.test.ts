import { strict as assert } from "node:assert";
import { executeAssistantContractWorkflowAction } from "./contract-workflow-actions";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createMessageScope(metadata?: Record<string, unknown>) {
  return {
    supabase: { marker: "supabase" },
    organizationId: "org-1",
    organizationIds: ["org-1"],
    store: { id: "store-1" },
    message: {
      id: "workflow-message-1",
      organization_id: "org-1",
      store_id: "store-1",
      related_lead_id: "lead-1",
      related_conversation_id: "conversation-1",
      metadata: {
        kind: "contract_workflow_decision",
        quote_id: "quote-1",
        quote_version_id: "version-card-v1",
        quote_number: "ORC-1",
        lead_id: "lead-1",
        conversation_id: "conversation-1",
        ...metadata,
      },
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

const tests: TestCase[] = [
  {
    name: "generate contract action forwards exact card quoteVersionId",
    run: async () => {
      const generationArgs: Array<Record<string, unknown>> = [];
      const resultMessages: Array<Record<string, unknown>> = [];

      const result = await executeAssistantContractWorkflowAction(
        {
          request: new Request("https://app.test/api/assistant/action"),
          action: "generate_contract",
          messageId: "workflow-message-1",
        },
        {
          ensureAuthenticatedUser: async () => ({ ok: true, userId: "user-1" }),
          loadAuthorizedContractWorkflowMessage: async () => createMessageScope(),
          resolveAuthorizedExistingQuote: async () => createQuoteScope(),
          executeAssistantContractGeneration: async (args: any) => {
            generationArgs.push(args);
            return {
              ok: true,
              status: 200,
              reply: "Contrato gerado para revisao.",
              metadata: {
                reasonCode: "HUMAN_EXPLICIT_REQUEST_ALLOWED",
              },
              quoteId: "quote-1",
              quoteVersionId: args.quoteVersionId,
              contractId: "contract-1",
            };
          },
          pushAssistantActionResultMessage: async (args: any) => {
            resultMessages.push(args);
          },
        },
      );

      assert.equal(result.ok, true);
      assert.equal(generationArgs.length, 1);
      assert.equal(generationArgs[0]?.quoteId, "quote-1");
      assert.equal(generationArgs[0]?.quoteVersionId, "version-card-v1");
      assert.equal(generationArgs[0]?.source, "assistant_contract_workflow_button_v1");
      assert.equal(resultMessages.length, 1);
      assert.equal(
        (resultMessages[0]?.metadata as Record<string, unknown>)?.quote_version_id,
        "version-card-v1",
      );
    },
  },
  {
    name: "missing card quoteVersionId fails before quote resolution or generation",
    run: async () => {
      let quoteResolutionCount = 0;
      let generationCount = 0;
      let resultMessageCount = 0;

      const result = await executeAssistantContractWorkflowAction(
        {
          request: new Request("https://app.test/api/assistant/action"),
          action: "generate_contract",
          messageId: "workflow-message-1",
        },
        {
          ensureAuthenticatedUser: async () => ({ ok: true, userId: "user-1" }),
          loadAuthorizedContractWorkflowMessage: async () =>
            createMessageScope({ quote_version_id: null }),
          resolveAuthorizedExistingQuote: async () => {
            quoteResolutionCount += 1;
            return createQuoteScope();
          },
          executeAssistantContractGeneration: async () => {
            generationCount += 1;
            return {
              ok: true,
              status: 200,
              reply: "Contrato gerado.",
              metadata: {},
            };
          },
          pushAssistantActionResultMessage: async () => {
            resultMessageCount += 1;
          },
        },
      );

      assert.equal(result.ok, false);
      assert.equal(result.status, 409);
      assert.equal(result.error, "QUOTE_VERSION_REFERENCE_MISSING");
      assert.equal(quoteResolutionCount, 0);
      assert.equal(generationCount, 0);
      assert.equal(resultMessageCount, 0);
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
