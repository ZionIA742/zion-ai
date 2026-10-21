import { strict as assert } from "node:assert";
import { executeAssistantContractWorkflowAction } from "./contract-workflow-actions";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createMessageScope(metadata?: Record<string, unknown>) {
  const sessionSupabase = { marker: "authenticated-session", rpc: async () => ({ data: [], error: null }) };
  return {
    supabase: { marker: "supabase", rpc: async () => ({ data: [], error: null }) },
    sessionSupabase,
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
        trigger: "customer_accepted_quote",
        commercial_opportunity_id: "opportunity-1",
        lifecycle_cycle: 1,
        source_message_id: "customer-message-1",
        available_actions: [
          { id: "confirm_customer_acceptance" },
        ],
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
      current_version_id: "version-card-v1",
    },
  };
}

async function runAcceptanceAction(options: {
  metadata?: Record<string, unknown>;
  quote?: Record<string, unknown>;
  rpcData?: unknown;
  rpcError?: { code?: string; message?: string } | null;
  authenticated?: boolean;
}) {
  const calls = { service: 0, session: 0 };
  const base = createMessageScope(options.metadata);
  const result = await executeAssistantContractWorkflowAction(
    {
      request: new Request("https://app.test/api/assistant/action"),
      action: "confirm_customer_acceptance",
      messageId: "workflow-message-1",
    },
    {
      ensureAuthenticatedUser: async () =>
        options.authenticated === false
          ? { ok: false as const, status: 401, error: "UNAUTHORIZED", message: "unauthorized" }
          : { ok: true as const, userId: "user-1" },
      loadAuthorizedContractWorkflowMessage: async () => ({
        ...base,
        supabase: {
          rpc: async () => {
            calls.service += 1;
            throw new Error("service client must not execute acceptance RPC");
          },
        },
        sessionSupabase: {
          rpc: async (_name: string, args: Record<string, unknown>) => {
            calls.session += 1;
            return {
              data: options.rpcData ?? [{ outcome: "accepted" }],
              error: options.rpcError ?? null,
              args,
            };
          },
        },
      }),
      resolveAuthorizedExistingQuote: async () => ({
        ...createQuoteScope(),
        ...(options.quote ? { quote: { ...createQuoteScope().quote, ...options.quote } } : {}),
      }),
      pushAssistantActionResultMessage: async () => undefined,
    } as unknown as Parameters<typeof executeAssistantContractWorkflowAction>[1],
  );

  return { result, calls };
}

const tests: TestCase[] = [
  {
    name: "generate contract card only guides the responsible to the CRM",
    run: async () => {
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
          pushAssistantActionResultMessage: async (args: any) => {
            resultMessages.push(args);
          },
        },
      );

      assert.equal(result.ok, false);
      assert.equal(result.status, 409);
      assert.equal(result.error, "ASSISTANT_CONTRACT_OPERATION_REQUIRES_CRM");
      assert.match(result.message, /manualmente no CRM/);
      assert.equal(resultMessages.length, 1);
      assert.equal(
        (resultMessages[0]?.metadata as Record<string, unknown>)?.quote_version_id,
        "version-card-v1",
      );
      assert.equal(
        (resultMessages[0]?.metadata as Record<string, unknown>)?.contract_id,
        null,
      );
      assert.equal(
        (resultMessages[0]?.metadata as Record<string, unknown>)?.reason_code,
        "ASSISTANT_CONTRACT_OPERATION_REQUIRES_CRM",
      );
    },
  },
  {
    name: "missing card quoteVersionId fails before quote resolution or generation",
    run: async () => {
      let quoteResolutionCount = 0;
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
          pushAssistantActionResultMessage: async () => {
            resultMessageCount += 1;
          },
        },
      );

      assert.equal(result.ok, false);
      assert.equal(result.status, 409);
      assert.equal(result.error, "QUOTE_VERSION_REFERENCE_MISSING");
      assert.equal(quoteResolutionCount, 0);
      assert.equal(resultMessageCount, 0);
    },
  },
  {
    name: "customer acceptance action calls canonical writer with card evidence",
    run: async () => {
      const rpcArgs: Array<Record<string, unknown>> = [];
      const result = await executeAssistantContractWorkflowAction(
        {
          request: new Request("https://app.test/api/assistant/action"),
          action: "confirm_customer_acceptance",
          messageId: "workflow-message-1",
        },
        {
          ensureAuthenticatedUser: async () => ({ ok: true, userId: "user-1" }),
          loadAuthorizedContractWorkflowMessage: async () => ({
            ...createMessageScope(),
            sessionSupabase: {
              rpc: async (_name: string, args: Record<string, unknown>) => {
                rpcArgs.push(args);
                return { data: [{ outcome: "accepted" }], error: null };
              },
            },
          }),
          resolveAuthorizedExistingQuote: async () => createQuoteScope(),
          pushAssistantActionResultMessage: async () => undefined,
        },
      );

      assert.equal(result.ok, true);
      assert.deepEqual(rpcArgs[0], {
        p_organization_id: "org-1",
        p_store_id: "store-1",
        p_commercial_opportunity_id: "opportunity-1",
        p_expected_lifecycle_cycle: 1,
        p_quote_id: "quote-1",
        p_quote_version_id: "version-card-v1",
        p_source_message_id: "customer-message-1",
      });
    },
  },
  {
    name: "customer acceptance action fails closed without source message evidence",
    run: async () => {
      let rpcCalls = 0;
      const result = await executeAssistantContractWorkflowAction(
        {
          request: new Request("https://app.test/api/assistant/action"),
          action: "confirm_customer_acceptance",
          messageId: "workflow-message-1",
        },
        {
          ensureAuthenticatedUser: async () => ({ ok: true, userId: "user-1" }),
          loadAuthorizedContractWorkflowMessage: async () =>
            createMessageScope({ source_message_id: null }),
          resolveAuthorizedExistingQuote: async () => createQuoteScope(),
          pushAssistantActionResultMessage: async () => undefined,
        },
      );

      rpcCalls += 0;
      assert.equal(result.ok, false);
      assert.equal(result.error, "CUSTOMER_ACCEPTANCE_EVIDENCE_INCOMPLETE");
      assert.equal(rpcCalls, 0);
    },
  },
  {
    name: "unauthenticated customer acceptance never loads the card",
    run: async () => {
      const { result, calls } = await runAcceptanceAction({ authenticated: false });
      assert.equal(result.ok, false);
      assert.equal(result.status, 401);
      assert.equal(calls.session, 0);
    },
  },
  {
    name: "customer acceptance uses authenticated session RPC and supports already accepted",
    run: async () => {
      const { result, calls } = await runAcceptanceAction({
        rpcData: [{ outcome: "already_accepted" }],
      });
      assert.equal(result.ok, true);
      assert.equal(calls.service, 0);
      assert.equal(calls.session, 1);
      assert.match(result.message, /ja estava confirmado/);
    },
  },
  {
    name: "customer acceptance rejects cross tenant card scope before RPC",
    run: async () => {
      const { result, calls } = await runAcceptanceAction({
        metadata: { organization_id: "other-org" },
      });
      assert.equal(result.ok, false);
      assert.equal(result.error, "CUSTOMER_ACCEPTANCE_SCOPE_MISMATCH");
      assert.equal(calls.session, 0);
    },
  },
  {
    name: "customer acceptance rejects stale exact version before RPC",
    run: async () => {
      const { result, calls } = await runAcceptanceAction({
        quote: { current_version_id: "version-newer" },
      });
      assert.equal(result.ok, false);
      assert.equal(result.error, "PROPOSAL_STALE");
      assert.equal(calls.session, 0);
    },
  },
  {
    name: "ambiguous acceptance RPC result fails closed without retry",
    run: async () => {
      const { result, calls } = await runAcceptanceAction({ rpcData: [] });
      assert.equal(result.ok, false);
      assert.equal(result.error, "CUSTOMER_ACCEPTANCE_RESULT_UNCERTAIN");
      assert.equal(calls.session, 1);
    },
  },
  {
    name: "acceptance RPC rejection is not converted into positive success",
    run: async () => {
      const { result, calls } = await runAcceptanceAction({
        rpcError: { message: "PROPOSAL_STALE" },
      });
      assert.equal(result.ok, false);
      assert.equal(result.error, "PROPOSAL_STALE");
      assert.equal(calls.session, 1);
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
