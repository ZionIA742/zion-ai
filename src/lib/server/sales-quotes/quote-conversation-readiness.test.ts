import { strict as assert } from "node:assert";
import { ensureQuoteConversationReadyForQuoteEvent } from "./quote-conversation-readiness";

type TestCase = { name: string; run: () => Promise<void> | void };

function createSupabaseStateMachine(initialState: string) {
  let currentState = initialState;
  const rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];

  const supabase = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => {
          if (table === "conversation_states") {
            return {
              data: {
                conversation_id: filters.conversation_id,
                organization_id: filters.organization_id,
                state: currentState,
              },
              error: null,
            };
          }

          if (table === "conversations") {
            return {
              data: {
                id: filters.id,
                organization_id: filters.organization_id,
                lead_id: "lead-1",
              },
              error: null,
            };
          }

          throw new Error(`unexpected table ${table}`);
        },
      };

      return builder;
    },
    rpc: async (name: string, payload: Record<string, unknown>) => {
      rpcCalls.push({ name, payload });
      currentState = String(payload.p_to_state || "");
      return { data: null, error: null };
    },
  };

  return {
    supabase,
    rpcCalls,
    getCurrentState: () => currentState,
  };
}

const tests: TestCase[] = [
  {
    name: "preparacao compartilhada preserva novo_lead para qualificacao para orcamento",
    run: async () => {
      const machine = createSupabaseStateMachine("novo_lead");

      const result = await ensureQuoteConversationReadyForQuoteEvent({
        supabase: machine.supabase,
        actorUserId: "user-1",
        organizationId: "org-1",
        conversationId: "conv-1",
        leadId: "lead-1",
        source: "quote_pdf_generation",
      });

      assert.equal(result.transitioned, true);
      assert.equal(result.currentState, "orcamento");
      assert.equal(machine.getCurrentState(), "orcamento");
      assert.deepEqual(
        machine.rpcCalls.map((call) => ({
          name: call.name,
          toState: call.payload.p_to_state,
          reason: call.payload.p_reason,
          source: call.payload.p_source,
        })),
        [
          {
            name: "transition_conversation_state_by_user",
            toState: "qualificacao",
            reason: "manual_quote_pdf_prepare_qualification",
            source: "quote_pdf_generation",
          },
          {
            name: "transition_conversation_state_by_user",
            toState: "orcamento",
            reason: "manual_quote_pdf_prepare_budget",
            source: "quote_pdf_generation",
          },
        ],
      );
    },
  },
  {
    name: "preparacao compartilhada usa motivos especificos para request-change",
    run: async () => {
      const machine = createSupabaseStateMachine("novo_lead");

      const result = await ensureQuoteConversationReadyForQuoteEvent({
        supabase: machine.supabase,
        actorUserId: "user-1",
        organizationId: "org-1",
        conversationId: "conv-1",
        leadId: "lead-1",
        source: "quote_change_request",
      });

      assert.equal(result.transitioned, true);
      assert.equal(result.currentState, "orcamento");
      assert.deepEqual(
        machine.rpcCalls.map((call) => ({
          toState: call.payload.p_to_state,
          reason: call.payload.p_reason,
          source: call.payload.p_source,
        })),
        [
          {
            toState: "qualificacao",
            reason: "manual_quote_change_request_prepare_qualification",
            source: "quote_change_request",
          },
          {
            toState: "orcamento",
            reason: "manual_quote_change_request_prepare_budget",
            source: "quote_change_request",
          },
        ],
      );
    },
  },
  {
    name: "estado ja em orcamento nao cria transicao redundante",
    run: async () => {
      const machine = createSupabaseStateMachine("orcamento");

      const result = await ensureQuoteConversationReadyForQuoteEvent({
        supabase: machine.supabase,
        actorUserId: "user-1",
        organizationId: "org-1",
        conversationId: "conv-1",
        leadId: "lead-1",
        source: "quote_pdf_generation",
      });

      assert.equal(result.transitioned, false);
      assert.equal(result.currentState, "orcamento");
      assert.equal(result.skippedReason, "already_allowed");
      assert.equal(machine.rpcCalls.length, 0);
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
        `not ok - ${testCase.name}\n${
          error instanceof Error ? error.stack || error.message : String(error)
        }`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  }
})();
