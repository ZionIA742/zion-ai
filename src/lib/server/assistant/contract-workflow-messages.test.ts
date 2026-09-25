import { strict as assert } from "node:assert";
import { pushAssistantContractWorkflowDecisionMessage } from "./contract-workflow-messages";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type RpcCall = {
  fn: string;
  payload: Record<string, unknown>;
};

function createDecision() {
  return {
    allowed: false,
    needsHumanConfirmation: true,
    reasonCode: "CUSTOMER_SIGNAL_REQUIRES_HUMAN_CONFIRMATION",
    reasonMessage: "Cliente pediu contrato.",
    missingRequirements: [],
    warnings: [],
    recommendedNextAction: "confirm_before_contract",
  };
}

function createSupabaseMock(args?: {
  existingWorkflowKeys?: Set<string>;
}) {
  const containsCalls: Array<Record<string, unknown>> = [];
  const rpcCalls: RpcCall[] = [];
  const existingWorkflowKeys = args?.existingWorkflowKeys ?? new Set<string>();

  function workflowKey(metadata: Record<string, unknown>) {
    return [
      metadata.quote_id,
      metadata.quote_version_id,
      metadata.trigger,
      metadata.source,
    ].join(":");
  }

  function thenable(result: { data?: unknown; error: unknown }) {
    return {
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve(result).then(resolve, reject);
      },
    };
  }

  return {
    containsCalls,
    rpcCalls,
    supabase: {
      from(table: string) {
        if (table === "store_assistant_threads") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return this;
            },
            update() {
              return {
                eq() {
                  return thenable({ error: null });
                },
              };
            },
            async maybeSingle() {
              return { data: { id: "thread-1" }, error: null };
            },
          };
        }

        if (table === "store_assistant_messages") {
          let lastContains: Record<string, unknown> | null = null;
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            contains(_column: string, value: Record<string, unknown>) {
              lastContains = value;
              containsCalls.push(value);
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return this;
            },
            async maybeSingle() {
              if (lastContains?.kind === "contract_workflow_decision") {
                return {
                  data: existingWorkflowKeys.has(workflowKey(lastContains))
                    ? { id: `message-${lastContains.quote_version_id}` }
                    : null,
                  error: null,
                };
              }
              if (lastContains?.kind === "customer_context_report") {
                return { data: { id: "customer-report-existing" }, error: null };
              }
              return { data: null, error: null };
            },
          };
        }

        if (
          table === "leads" ||
          table === "sales_quotes" ||
          table === "sales_contracts" ||
          table === "messages" ||
          table === "appointments" ||
          table === "conversation_sessions" ||
          table === "commercial_session_context_links" ||
          table === "commercial_opportunities"
        ) {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            or() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return this;
            },
            maybeSingle: async () => ({ data: null, error: null }),
            then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
              return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            },
          };
        }

        if (table === "store_assistant_notification_queue") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return thenable({ data: [], error: null });
            },
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
      async rpc(fn: string, payload: Record<string, unknown>) {
        rpcCalls.push({ fn, payload });
        return { data: null, error: null };
      },
    },
  };
}

async function pushCard(
  supabase: any,
  quoteVersionId: string,
  quoteId = "quote-1",
) {
  return pushAssistantContractWorkflowDecisionMessage({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    leadId: "lead-1",
    conversationId: "conv-1",
    quoteId,
    quoteVersionId,
    quoteNumber: "ORC-1",
    customerName: "Cliente",
    trigger: "customer_requested_contract",
    decision: createDecision(),
    sourceOverride: "sales_ai_customer_signal_v1",
  });
}

const tests: TestCase[] = [
  {
    name: "contract workflow metadata and notification are version-bound",
    run: async () => {
      const mock = createSupabaseMock();
      const result = await pushCard(mock.supabase, "version-v1");

      assert.equal(result.created, true);
      assert.equal(result.deduped, false);

      const workflowPush = mock.rpcCalls.find(
        (call) => call.fn === "assistant_push_system_message",
      );
      const metadata = workflowPush?.payload.p_metadata as Record<string, unknown>;
      assert.equal(metadata.quote_id, "quote-1");
      assert.equal(metadata.quote_version_id, "version-v1");

      const notification = mock.rpcCalls.find(
        (call) => call.fn === "assistant_enqueue_internal_notification",
      );
      const context = notification?.payload.p_context as Record<string, unknown>;
      assert.equal(context.quote_id, "quote-1");
      assert.equal(context.quote_version_id, "version-v1");
      assert.equal(
        String(notification?.payload.p_event_key || "").includes("version-v1"),
        true,
      );
    },
  },
  {
    name: "same quote and version dedupes but different version creates a new card",
    run: async () => {
      const existingWorkflowKeys = new Set([
        [
          "quote-1",
          "version-v1",
          "customer_requested_contract",
          "sales_ai_customer_signal_v1",
        ].join(":"),
      ]);
      const mock = createSupabaseMock({ existingWorkflowKeys });

      const sameVersion = await pushCard(mock.supabase, "version-v1");
      const differentVersion = await pushCard(mock.supabase, "version-v2");

      assert.equal(sameVersion.deduped, true);
      assert.equal(differentVersion.created, true);
      assert.equal(
        mock.containsCalls.some(
          (metadata) =>
            metadata.kind === "contract_workflow_decision" &&
            metadata.quote_id === "quote-1" &&
            metadata.quote_version_id === "version-v1",
        ),
        true,
      );
      assert.equal(
        mock.containsCalls.some(
          (metadata) =>
            metadata.kind === "contract_workflow_decision" &&
            metadata.quote_id === "quote-1" &&
            metadata.quote_version_id === "version-v2",
        ),
        true,
      );
    },
  },
  {
    name: "missing quoteVersionId fails before creating workflow side effects",
    run: async () => {
      const mock = createSupabaseMock();

      await assert.rejects(
        () => pushCard(mock.supabase, ""),
        /QUOTE_VERSION_REFERENCE_MISSING/,
      );
      assert.deepEqual(mock.rpcCalls, []);
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
