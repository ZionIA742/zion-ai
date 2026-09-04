import { strict as assert } from "node:assert";
import { processDueAiRunQueue } from "./process-ai-run-queue";

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

function createQueueSupabase(
  rows: Array<Record<string, unknown>>,
  conversation?: Record<string, unknown> | null,
) {
  const updates: Array<{
    payload: Record<string, unknown>;
    eq: Array<{ column: string; value: unknown }>;
    is: Array<{ column: string; value: unknown }>;
  }> = [];
  const windowUpdates: Array<{
    payload: Record<string, unknown>;
    eq: Array<{ column: string; value: unknown }>;
  }> = [];
  const selects: Array<{
    eq: Array<{ column: string; value: unknown }>;
    is: Array<{ column: string; value: unknown }>;
    lte: Array<{ column: string; value: unknown }>;
    order: Array<{ column: string; options: Record<string, unknown> }>;
    limit: number | null;
  }> = [];

  return {
    updates,
    windowUpdates,
    selects,
    supabase: {
      from(table: string) {
        if (table === "conversations") {
          return {
            select(_selection: string) {
              return this;
            },
            eq(_column: string, _value: unknown) {
              return this;
            },
            async maybeSingle() {
              return {
                data:
                  conversation === undefined
                    ? {
                        id: "conv-1",
                        status: "active",
                        is_human_active: false,
                      }
                    : conversation,
                error: null,
              };
            },
          };
        }

        if (table === "conversation_ai_window_state") {
          const state = {
            payload: {} as Record<string, unknown>,
            eq: [] as Array<{ column: string; value: unknown }>,
          };

          const builder = {
            update(payload: Record<string, unknown>) {
              state.payload = payload;
              return builder;
            },
            eq(column: string, value: unknown) {
              state.eq.push({ column, value });
              return builder;
            },
            then<TResult1 = { error: null }, TResult2 = never>(
              onfulfilled?:
                | ((value: { error: null }) => TResult1 | PromiseLike<TResult1>)
                | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              windowUpdates.push(state);
              return Promise.resolve({ error: null }).then(onfulfilled, onrejected);
            },
          };

          return builder;
        }

        assert.equal(table, "ai_run_queue");
        const state = {
          payload: {} as Record<string, unknown>,
          eq: [] as Array<{ column: string; value: unknown }>,
          is: [] as Array<{ column: string; value: unknown }>,
          lte: [] as Array<{ column: string; value: unknown }>,
          order: [] as Array<{ column: string; options: Record<string, unknown> }>,
          limit: null as number | null,
        };

        return {
          select(_selection: string) {
            return this;
          },
          update(payload: Record<string, unknown>) {
            state.payload = payload;
            return this;
          },
          eq(column: string, value: unknown) {
            state.eq.push({ column, value });
            return this;
          },
          is(column: string, value: unknown) {
            state.is.push({ column, value });
            return this;
          },
          lte(column: string, value: unknown) {
            state.lte.push({ column, value });
            return this;
          },
          order(column: string, options: Record<string, unknown>) {
            state.order.push({ column, options });
            return this;
          },
          async limit(value: number) {
            state.limit = value;
            selects.push(state);
            return { data: rows, error: null };
          },
          then<TResult1 = { error: null }, TResult2 = never>(
            onfulfilled?:
              | ((value: { error: null }) => TResult1 | PromiseLike<TResult1>)
              | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) {
            updates.push(state);
            return Promise.resolve({ error: null }).then(onfulfilled, onrejected);
          },
        };
      },
    },
  };
}

function queueRow(overrides?: Record<string, unknown>) {
  return {
    id: "queue-1",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: "conv-1",
    lead_id: "lead-1",
    queue_key: "resume:conv-1:sales_ai_after_hours:202609040800",
    input: {
      type: "resume_sales_conversation",
      reason: "sales_ai_after_hours_policy",
      resumeAt: "2020-01-01T00:00:00.000Z",
      anchorMessageId: "msg-customer-1",
    },
    ...overrides,
  };
}

const tests: TestCase[] = [
  {
    name: "due after-hours queue reopens the canonical sales AI flow with current conversation ids",
    run: async () => {
      const recorder = createQueueSupabase([queueRow()]);
      const calls: Array<Record<string, unknown>> = [];

      const result = await processDueAiRunQueue({
        organizationId: "org-1",
        storeId: "store-1",
        supabaseClient: recorder.supabase,
        runAiFlow: async (args) => {
          calls.push(args);
          return {
            ok: true,
            aiText: "ok",
            context: {},
            usage: null,
            persisted: true,
            messageId: "msg-ai-1",
          };
        },
      });

      assert.equal(result.succeeded, 1);
      assert.deepEqual(calls, [
        {
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          executionContext: {
            kind: "scheduled_resume",
            queueId: "queue-1",
            queueKey: "resume:conv-1:sales_ai_after_hours:202609040800",
            reason: "sales_ai_after_hours_policy",
            resumeAt: "2020-01-01T00:00:00.000Z",
            anchorMessageId: "msg-customer-1",
            styleHint: null,
          },
        },
      ]);
      assert.deepEqual(recorder.selects[0]?.eq, [
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
      ]);
      assert.deepEqual(recorder.updates[0]?.eq, [
        { column: "id", value: "queue-1" },
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
      ]);
      assert.deepEqual(recorder.updates[0]?.is, [
        { column: "processed_at", value: null },
      ]);
    },
  },
  {
    name: "takeover duplicate stale and still-blocked outcomes are marked skipped not resent",
    run: async () => {
      const errors = [
        "HUMAN_HANDOFF_ACTIVE",
        "AI_REPLY_ALREADY_EXISTS_FOR_LATEST_CUSTOMER_MESSAGE",
        "AI_REPLY_SUPERSEDED_BY_NEWER_CUSTOMER_MESSAGE",
        "SALES_AI_NOT_ALLOWED_NOW",
      ];

      for (const error of errors) {
        const recorder = createQueueSupabase([queueRow({ id: `queue-${error}` })]);
        const result = await processDueAiRunQueue({
          organizationId: "org-1",
          storeId: "store-1",
          supabaseClient: recorder.supabase,
          runAiFlow: async () => ({
            ok: false,
            error,
            message: error,
          }),
        });

        assert.equal(result.skipped, 1);
        assert.equal(result.results[0]?.detail, error);
        assert.equal(recorder.updates.length, 1);
      }
    },
  },
  {
    name: "missing scheduled resume anchor consumes matching canonical window without running sales AI",
    run: async () => {
      const recorder = createQueueSupabase([
        queueRow({
          input: {
            type: "resume_sales_conversation",
            reason: "customer_requested_tomorrow",
            resumeAt: "2020-01-01T00:00:00.000Z",
          },
        }),
      ]);
      let calls = 0;

      const result = await processDueAiRunQueue({
        organizationId: "org-1",
        storeId: "store-1",
        supabaseClient: recorder.supabase,
        runAiFlow: async () => {
          calls += 1;
          throw new Error("resume without anchor must not run");
        },
      });

      assert.equal(result.skipped, 1);
      assert.equal(result.results[0]?.detail, "resume_anchor_missing");
      assert.equal(calls, 0);
      assert.equal(recorder.updates.length, 1);
      assert.equal(
        recorder.windowUpdates.length,
        1,
        "terminal resume without anchor must consume its matching canonical window",
      );

      assert.deepEqual(recorder.windowUpdates[0]?.eq, [
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
        { column: "conversation_id", value: "conv-1" },
        { column: "resume_reason", value: "customer_requested_tomorrow" },
        { column: "next_resume_at", value: "2020-01-01T00:00:00.000Z" },
      ]);
    },
  },
  {
    name: "human takeover or terminal conversation before resume skips without calling sales AI",
    run: async () => {
      for (const conversation of [
        { id: "conv-1", status: "active", is_human_active: true },
        { id: "conv-1", status: "closed", is_human_active: false },
      ]) {
        const recorder = createQueueSupabase([queueRow()], conversation);
        let calls = 0;
        const result = await processDueAiRunQueue({
          organizationId: "org-1",
          storeId: "store-1",
          supabaseClient: recorder.supabase,
          runAiFlow: async () => {
            calls += 1;
            throw new Error("should not run");
          },
        });

        assert.equal(result.skipped, 1);
        assert.equal(calls, 0);
        assert.equal(recorder.updates.length, 1);
        assert.equal(
          recorder.windowUpdates.length,
          1,
          "terminal human/closed resume must consume its matching canonical window",
        );
        assert.deepEqual(recorder.windowUpdates[0]?.eq, [
          { column: "organization_id", value: "org-1" },
          { column: "store_id", value: "store-1" },
          { column: "conversation_id", value: "conv-1" },
          { column: "resume_reason", value: "sales_ai_after_hours_policy" },
          { column: "next_resume_at", value: "2020-01-01T00:00:00.000Z" },
        ]);
      }
    },
  },
  {
    name: "future customer requested resume waits until its resume time",
    run: async () => {
      const recorder = createQueueSupabase([
        queueRow({
          queue_key: "resume:conv-1:customer_requested_tomorrow:future",
          input: {
            type: "resume_sales_conversation",
            reason: "customer_requested_tomorrow",
            resumeAt: "2999-01-01T00:00:00.000Z",
          },
        }),
      ]);

      let calls = 0;

      const result = await processDueAiRunQueue({
        organizationId: "org-1",
        storeId: "store-1",
        supabaseClient: recorder.supabase,
        runAiFlow: async () => {
          calls += 1;
          throw new Error("future resume must not run");
        },
      });

      assert.equal(result.processed, 0);
      assert.equal(result.succeeded, 0);
      assert.equal(result.failed, 0);
      assert.equal(result.skipped, 0);
      assert.equal(calls, 0);
      assert.equal(recorder.updates.length, 0);
    },
  },
  {
    name: "due customer requested resume reopens the canonical sales AI flow",
    run: async () => {
      const recorder = createQueueSupabase([
        queueRow({
          queue_key: "resume:conv-1:customer_requested_tomorrow:202609050900",
          input: {
            type: "resume_sales_conversation",
            reason: "customer_requested_tomorrow",
            resumeAt: "2020-01-01T00:00:00.000Z",
            anchorMessageId: "msg-customer-1",
            style_hint: "Retomar de forma natural, humana e sem pressao.",
          },
        }),
      ]);
      const calls: Array<Record<string, unknown>> = [];

      const result = await processDueAiRunQueue({
        organizationId: "org-1",
        storeId: "store-1",
        supabaseClient: recorder.supabase,
        runAiFlow: async (args) => {
          calls.push(args);
          return {
            ok: true,
            aiText: "retomada ok",
            context: {},
            usage: null,
            persisted: true,
            messageId: "msg-ai-resume-1",
          };
        },
      });

      assert.equal(result.processed, 1);
      assert.equal(result.succeeded, 1);
      assert.equal(result.failed, 0);
      assert.equal(result.skipped, 0);
      assert.deepEqual(calls, [
        {
          organizationId: "org-1",
          storeId: "store-1",
          conversationId: "conv-1",
          executionContext: {
            kind: "scheduled_resume",
            queueId: "queue-1",
            queueKey: "resume:conv-1:customer_requested_tomorrow:202609050900",
            reason: "customer_requested_tomorrow",
            resumeAt: "2020-01-01T00:00:00.000Z",
            anchorMessageId: "msg-customer-1",
            styleHint: "Retomar de forma natural, humana e sem pressao.",
          },
        },
      ]);
      assert.equal(recorder.updates.length, 1);

      assert.equal(
        recorder.windowUpdates.length,
        1,
        "consumed resume must clear its matching canonical window state",
      );

      const consumedWindow = recorder.windowUpdates[0];

      assert.equal(consumedWindow?.payload.waiting_next_day, false);
      assert.equal(consumedWindow?.payload.next_resume_at, null);
      assert.equal(consumedWindow?.payload.resume_reason, "none");
      assert.equal(
        Number.isFinite(Date.parse(String(consumedWindow?.payload.updated_at || ""))),
        true,
      );

      assert.deepEqual(consumedWindow?.eq, [
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
        { column: "conversation_id", value: "conv-1" },
        { column: "resume_reason", value: "customer_requested_tomorrow" },
        { column: "next_resume_at", value: "2020-01-01T00:00:00.000Z" },
      ]);
    },
  },
];

async function main() {
  let passed = 0;

  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
    } catch (error) {
      console.error(`FAIL ${test.name}`);
      throw error;
    }
  }

  console.log(`process-ai-run-queue: ${passed}/${tests.length} tests passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
