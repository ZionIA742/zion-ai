import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueQuotePreparationTaskBySystem,
  QuotePreparationQueueError,
  type QuotePreparationQueueSupabase,
} from "./enqueue-quote-preparation-task-by-system";

const input = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
  conversationId: "44444444-4444-4444-8444-444444444444",
  requestMessageId: "55555555-5555-4555-8555-555555555555",
  leadId: "66666666-6666-4666-8666-666666666666",
  commercialOpportunityId: "77777777-7777-4777-8777-777777777777",
  authorizationId: "88888888-8888-4888-8888-888888888888",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    organization_id: input.organizationId,
    store_id: input.storeId,
    task_id: input.taskId,
    conversation_id: input.conversationId,
    message_id: input.requestMessageId,
    queue_type: "quote_preparation_request",
    status: "pending",
    ...overrides,
  };
}

function client(args?: { insertError?: { code?: string; message?: string } | null; replay?: unknown }) {
  const calls: Array<{ table: string; operation: string; payload?: Record<string, unknown> }> = [];
  let maybeSingleCalls = 0;
  const supabase: QuotePreparationQueueSupabase & { calls: typeof calls } = {
    calls,
    from(table: string) {
      assert.equal(table, "store_assistant_operational_task_queue");
      const builder = {
        insert(payload: Record<string, unknown>) {
          calls.push({ table, operation: "insert", payload });
          return builder;
        },
        select() {
          calls.push({ table, operation: "select" });
          return builder;
        },
        eq() {
          return builder;
        },
        async maybeSingle() {
          maybeSingleCalls += 1;
          if (maybeSingleCalls > 1 && args?.replay !== undefined) {
            return { data: args.replay, error: null };
          }
          if (args?.insertError) return { data: null, error: args.insertError };
          return { data: row(), error: args?.insertError || null };
        },
      };
      return builder;
    },
  };
  return supabase;
}

test("inserts one canonical quote preparation row", async () => {
  const supabase = client();
  const result = await enqueueQuotePreparationTaskBySystem({ ...input, supabase });

  assert.equal(result.outcome, "created");
  assert.equal(supabase.calls.length, 2);
  assert.equal(supabase.calls[0]?.payload?.queue_type, "quote_preparation_request");
  assert.equal(supabase.calls[0]?.payload?.task_id, input.taskId);
});

test("reconciles an insert conflict as an idempotent replay only for exact scope", async () => {
  const supabase = client({ insertError: { code: "23505", message: "duplicate" }, replay: row({ status: "processing" }) });
  const result = await enqueueQuotePreparationTaskBySystem({ ...input, supabase });
  assert.equal(result.outcome, "idempotent_replay");
  assert.equal(result.status, "processing");
  assert.equal(supabase.calls.length, 3);
});

test("fails closed on divergent replay and invalid identity", async () => {
  const divergent = client({ insertError: { code: "23505", message: "duplicate" }, replay: row({ store_id: input.organizationId }) });
  await assert.rejects(
    enqueueQuotePreparationTaskBySystem({ ...input, supabase: divergent }),
    (error: unknown) => error instanceof QuotePreparationQueueError && error.kind === "uncertain",
  );

  await assert.rejects(
    enqueueQuotePreparationTaskBySystem({ ...input, taskId: "not-a-uuid", supabase: client() }),
    (error: unknown) => error instanceof QuotePreparationQueueError && error.kind === "input",
  );
});
