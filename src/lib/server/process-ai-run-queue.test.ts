import { strict as assert } from "node:assert";
import { processDueAiRunQueue } from "./process-ai-run-queue";
import { isSalesAiConversationStatusEligible } from "./conversation-ai-sales-eligibility";

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
    name: "sales AI status contract is explicit and fail closed",
    run: async () => {
      for (const status of [
        "active",
        "novo_lead",
        "qualificacao",
        "negociacao",
        "orcamento",
      ]) {
        assert.equal(isSalesAiConversationStatusEligible(status), true, status);
      }
      for (const status of [
        "open",
        "aguardando_aprovacao",
        "fechamento_pagamento",
        "pagamento_pendente_confirmacao",
        "pagamento_confirmado",
        "agendar_visita",
        "agendar_instalacao",
        "pos_venda_nps",
        "perdido",
        "paused",
        "resolved",
        "closed",
        "humano_assumiu",
        "unknown",
        "",
      ]) {
        assert.equal(isSalesAiConversationStatusEligible(status), false, status);
      }
    },
  },
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
    name: "qualificacao conversation resumes without human takeover",
    run: async () => {
      const recorder = createQueueSupabase(
        [queueRow()],
        { id: "conv-1", status: "qualificacao", is_human_active: false },
      );
      let calls = 0;
      const result = await processDueAiRunQueue({
        organizationId: "org-1",
        storeId: "store-1",
        supabaseClient: recorder.supabase,
        runAiFlow: async () => {
          calls += 1;
          return {
            ok: true,
            aiText: "ok",
            context: {},
            usage: null,
            persisted: true,
            messageId: "msg-ai-qualificacao",
          };
        },
      });

      assert.equal(result.succeeded, 1);
      assert.equal(calls, 1);
    },
  },
  {
    name: "unknown conversation status remains fail closed for scheduled resume",
    run: async () => {
      const recorder = createQueueSupabase(
        [queueRow()],
        { id: "conv-1", status: "future_unknown_status", is_human_active: false },
      );
      let calls = 0;
      const result = await processDueAiRunQueue({
        organizationId: "org-1",
        storeId: "store-1",
        supabaseClient: recorder.supabase,
        runAiFlow: async () => {
          calls += 1;
          throw new Error("unknown status must not run");
        },
      });

      assert.equal(result.skipped, 1);
      assert.equal(result.results[0]?.detail, "conversation_not_active");
      assert.equal(calls, 0);
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
            anchorMessageId: "msg-customer-1",
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
    name: "all real resume reasons are executable by the canonical consumer",
    run: async () => {
      const reasons = [
        "sales_ai_after_hours_policy",
        "fast_lead_delay",
        "normal_reply_delay",
        "next_day_window",
        "customer_requested_tomorrow",
        "customer_requested_next_week",
        "customer_requested_next_month",
        "customer_needs_internal_alignment",
        "customer_requested_later",
      ] as const;

      for (const reason of reasons) {
        const recorder = createQueueSupabase([
          queueRow({
            queue_key: `resume:conv-1:${reason}:202609050900`,
            input: {
              type: "resume_sales_conversation",
              reason,
              resumeAt: "2020-01-01T00:00:00.000Z",
              anchorMessageId: "msg-customer-1",
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
            return {
              ok: true,
              aiText: "retomada ok",
              context: {},
              usage: null,
              persisted: true,
              messageId: `msg-ai-${reason}`,
            };
          },
        });

        assert.equal(result.succeeded, 1, reason);
        assert.equal(calls, 1, reason);
      }
    },
  },
  {
    name: "normal reply delay is not processed when the canonical AI flow produced no message",
    run: async () => {
      const recorder = createQueueSupabase([
        queueRow({
          queue_key: "resume:conv-1:normal_reply_delay:202610192057",
          input: {
            type: "resume_sales_conversation",
            reason: "normal_reply_delay",
            resumeAt: "2020-01-01T00:00:00.000Z",
            anchorMessageId: "d8f13a51",
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
          return {
            ok: true,
            aiText: "",
            context: {},
            usage: null,
            persisted: true,
            messageId: null,
          };
        },
      });

      assert.equal(calls, 1);
      assert.equal(result.succeeded, 0);
      assert.equal(result.failed, 1);
      assert.equal(result.results[0]?.detail, "SALES_AI_REPLY_NOT_PERSISTED");
      assert.equal(
        recorder.updates.length,
        0,
        "a missing mandatory reply must remain retryable and must not consume the resume window",
      );
      assert.equal(recorder.windowUpdates.length, 0);
    },
  },
  {
    name: "invalid resume contract is terminalized instead of remaining invisible",
    run: async () => {
      const recorder = createQueueSupabase([
        queueRow({
          input: {
            system_event: "ai_window_resume",
            resume_mode: "normal_reply_delay",
          },
        }),
      ]);

      const result = await processDueAiRunQueue({
        organizationId: "org-1",
        storeId: "store-1",
        supabaseClient: recorder.supabase,
        runAiFlow: async () => {
          throw new Error("invalid resume must not run");
        },
      });

      assert.equal(result.skipped, 1);
      assert.equal(result.results[0]?.detail, "invalid_resume_contract");
      assert.equal(recorder.updates.length, 1);
      assert.equal(recorder.updates[0]?.payload.processing_error, "invalid_resume_contract");
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
  {
    name: "persists the safe CMIR semantic diagnostic through queue processing",
    run: async () => {
      const recorder = createQueueSupabase([queueRow()]);

      const result = await processDueAiRunQueue({
        organizationId: "org-1",
        storeId: "store-1",
        supabaseClient: recorder.supabase,
        runAiFlow: async () => ({
          ok: false,
          error: "RESOLVE_COMMERCIAL_MESSAGE_INTENT_FAILED",
          message: "secret prompt and customer@example.test",
          diagnostic: {
            authority: "resolve_commercial_message_intent_semantically" as const,
            sqlstate: null,
            constraint: null,
            reason: "SALES_AI_CMI_OPENAI_EXCEPTION",
            httpStatus: 429,
          },
        }),
      });

      const persisted = String(recorder.updates[0]?.payload.processing_error || "");
      assert.equal(result.failed, 1);
      assert.equal(
        persisted,
        "RESOLVE_COMMERCIAL_MESSAGE_INTENT_FAILED;authority=resolve_commercial_message_intent_semantically;sqlstate=unknown;constraint=unknown;reason=SALES_AI_CMI_OPENAI_EXCEPTION;http_status=429",
      );
      assert.equal(persisted.includes("customer@example.test"), false);
      assert.equal(persisted.includes("secret prompt"), false);
    },
  },
  {
    name: "persists safe CMIR RPC diagnostics without raw Supabase details",
    run: async () => {
      const recorder = createQueueSupabase([queueRow()]);
      const leaked = "phone=+5511999999999 password=top-secret";

      const result = await processDueAiRunQueue({
        organizationId: "org-1",
        storeId: "store-1",
        supabaseClient: recorder.supabase,
        runAiFlow: async () => ({
          ok: false,
          error: "WRITE_CANONICAL_INTENT_RESOLUTION_FAILED",
          message: leaked,
          diagnostic: {
            authority: "write_commercial_message_intent_resolution_by_system",
            sqlstate: "23514",
            constraint: "commercial_message_intent_resolution_shape_check",
            reason: null,
          },
        }),
      });

      const persisted = String(recorder.updates[0]?.payload.processing_error || "");
      assert.equal(result.failed, 1);
      assert.equal(
        persisted,
        "WRITE_CANONICAL_INTENT_RESOLUTION_FAILED;authority=write_commercial_message_intent_resolution_by_system;sqlstate=23514;constraint=commercial_message_intent_resolution_shape_check;reason=unknown",
      );
      assert.equal(persisted.includes(leaked), false);
      assert.equal(persisted.includes("password"), false);
    },
  },
  {
    name: "persists safe reply materialization diagnostics without raw Supabase details",
    run: async () => {
      const recorder = createQueueSupabase([queueRow()]);
      const leaked = "details=secret payload with customer phone";

      const result = await processDueAiRunQueue({
        organizationId: "org-1",
        storeId: "store-1",
        supabaseClient: recorder.supabase,
        runAiFlow: async () => ({
          ok: false,
          error: "SALES_AI_REPLY_SET_MATERIALIZATION_FAILED",
          message: leaked,
          diagnostic: {
            authority: "materialize_sales_ai_reply_set_by_system",
            sqlstate: "42501",
            constraint: "sales_ai_reply_set_scope_check",
            reason: null,
          },
        }),
      });

      const persisted = String(recorder.updates[0]?.payload.processing_error || "");
      assert.equal(result.failed, 1);
      assert.equal(
        persisted,
        "SALES_AI_REPLY_SET_MATERIALIZATION_FAILED;authority=materialize_sales_ai_reply_set_by_system;sqlstate=42501;constraint=sales_ai_reply_set_scope_check;reason=unknown",
      );
      assert.equal(persisted.includes(leaked), false);
      assert.equal(persisted.includes("customer phone"), false);
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
