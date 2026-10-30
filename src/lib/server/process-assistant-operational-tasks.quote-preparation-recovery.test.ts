import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  recoverAbandonedQuotePreparationTasks,
  type QuotePreparationRecoveryDeps,
} from "./process-assistant-operational-tasks";

const ids = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
  conversationId: "44444444-4444-4444-8444-444444444444",
  messageId: "55555555-5555-4555-8555-555555555555",
  leadId: "66666666-6666-4666-8666-666666666666",
  opportunityId: "77777777-7777-4777-8777-777777777777",
  profileVersionId: "88888888-8888-4888-8888-888888888888",
  authorizationId: "99999999-9999-4999-8999-999999999999",
  queueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

const now = new Date("2026-10-30T12:00:00.000Z");
const task = {
  id: ids.taskId,
  organization_id: ids.organizationId,
  store_id: ids.storeId,
  task_type: "commercial_quote_request",
  status: "open",
  created_at: "2026-10-30T11:55:00.000Z",
  related_lead_id: ids.leadId,
  related_conversation_id: ids.conversationId,
  commercial_opportunity_id: ids.opportunityId,
  task_payload: { quote_preparation: { request_message_id: ids.messageId } },
};

const identity = {
  taskId: ids.taskId,
  organizationId: ids.organizationId,
  storeId: ids.storeId,
  leadId: ids.leadId,
  conversationId: ids.conversationId,
  commercialOpportunityId: ids.opportunityId,
  requestMessageId: ids.messageId,
  profileVersionId: ids.profileVersionId,
  profileVersionNumber: 1,
};

function createSupabase(options: { tasks?: unknown[]; queues?: unknown[] } = {}) {
  const state = {
    tasks: options.tasks ?? [task],
    queues: [...(options.queues ?? [])] as Array<Record<string, unknown>>,
    calls: [] as string[],
  };

  const supabase = {
    from(table: string) {
      state.calls.push(table);
      const filters: Array<{ kind: string; column?: string; value?: unknown }> = [];
      const builder = {
        select() { return builder; },
        eq(column: string, value: unknown) { filters.push({ kind: "eq", column, value }); return builder; },
        in(column: string, value: unknown) { filters.push({ kind: "in", column, value }); return builder; },
        gte(column: string, value: unknown) { filters.push({ kind: "gte", column, value }); return builder; },
        lte(column: string, value: unknown) { filters.push({ kind: "lte", column, value }); return builder; },
        order() { return builder; },
        limit() { return builder; },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          const rows = table === "store_assistant_operational_tasks" ? state.tasks : state.queues;
          const filtered = rows.filter((row) => filters.every((filter) => {
            const actual = (row as Record<string, unknown>)[String(filter.column)];
            if (filter.kind === "eq") return actual === filter.value;
            if (filter.kind === "in") return Array.isArray(filter.value) && filter.value.includes(actual);
            if (filter.kind === "gte") return String(actual) >= String(filter.value);
            if (filter.kind === "lte") return String(actual) <= String(filter.value);
            return true;
          }));
          return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  return { supabase, state };
}

function recoveryDeps(
  state: { queues: Array<Record<string, unknown>> },
  overrides: Partial<QuotePreparationRecoveryDeps> = {},
): QuotePreparationRecoveryDeps {
  return {
    resolveIdentity: async () => ({ eligible: true as const, identity }),
    readAuthorization: async () => ({ outcome: "absent" as const }),
    issueAuthorization: async () => ({
      outcome: "created" as const,
      organizationId: ids.organizationId,
      storeId: ids.storeId,
      taskId: ids.taskId,
      requestMessageId: ids.messageId,
      authorizationId: ids.authorizationId,
      issuedAt: now.toISOString(),
      expiresAt: "2026-10-30T12:10:00.000Z",
    }),
    enqueue: async () => {
      state.queues.push({
        id: ids.queueId,
        organization_id: ids.organizationId,
        store_id: ids.storeId,
        task_id: ids.taskId,
        conversation_id: ids.conversationId,
        message_id: ids.messageId,
        queue_type: "quote_preparation_request",
        status: "pending",
      });
      return {
        outcome: "created" as const,
        queueId: ids.queueId,
        organizationId: ids.organizationId,
        storeId: ids.storeId,
        taskId: ids.taskId,
        conversationId: ids.conversationId,
        requestMessageId: ids.messageId,
        status: "pending",
      };
    },
    ...overrides,
  };
}

test("gate OFF performs no recovery query", async () => {
  const previous = process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED;
  delete process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED;
  let queried = false;
  try {
    const result = await recoverAbandonedQuotePreparationTasks({
      supabase: { from: () => { queried = true; throw new Error("must not query"); } },
      now,
    });
    assert.equal(result.reason, "quote_preparation_gate_off");
    assert.equal(queried, false);
  } finally {
    if (previous === undefined) delete process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED;
    else process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED = previous;
  }
});

test("eligible task without a queue is recovered and repeated execution is idempotent", async () => {
  process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED = "true";
  const { supabase, state } = createSupabase();
  let authorizationCalls = 0;
  const deps = recoveryDeps(state, {
    issueAuthorization: async () => {
      authorizationCalls += 1;
      return recoveryDeps(state).issueAuthorization({} as never);
    },
  });

  const first = await recoverAbandonedQuotePreparationTasks({ supabase, now, deps });
  const second = await recoverAbandonedQuotePreparationTasks({ supabase, now, deps });

  assert.equal(first.recovered, 1);
  assert.equal(first.results[0]?.reason, "queue_recovered");
  assert.equal(second.results[0]?.reason, "queue_already_exists");
  assert.equal(authorizationCalls, 1);
  assert.equal(state.queues.length, 1);
});

test("persisted valid authorization is reused without reissuing", async () => {
  process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED = "true";
  const { supabase, state } = createSupabase();
  let issueCalled = false;
  const result = await recoverAbandonedQuotePreparationTasks({
    supabase,
    now,
    deps: recoveryDeps(state, {
      readAuthorization: async () => ({ outcome: "valid" as const, authorizationId: ids.authorizationId }),
      issueAuthorization: async () => { issueCalled = true; throw new Error("must not issue"); },
    }),
  });
  assert.equal(result.recovered, 1);
  assert.equal(result.results[0]?.reason, "queue_recovered");
  assert.equal(issueCalled, false);
});

test("existing queue, divergence, and uncertain authorization fail closed", async () => {
  process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED = "true";
  const existing = {
    id: ids.queueId,
    organization_id: ids.organizationId,
    store_id: ids.storeId,
    task_id: ids.taskId,
    conversation_id: ids.conversationId,
    message_id: ids.messageId,
    queue_type: "quote_preparation_request",
    status: "failed",
  };
  const existingState = createSupabase({ queues: [existing] });
  let issueCalled = false;
  const existingResult = await recoverAbandonedQuotePreparationTasks({
    supabase: existingState.supabase,
    now,
    deps: recoveryDeps(existingState.state, {
      issueAuthorization: async () => { issueCalled = true; return recoveryDeps(existingState.state).issueAuthorization({} as never); },
    }),
  });
  assert.equal(existingResult.results[0]?.reason, "queue_exists_requires_reconciliation");
  assert.equal(issueCalled, false);

  const divergentState = createSupabase({ queues: [{ ...existing, message_id: ids.leadId }] });
  const divergent = await recoverAbandonedQuotePreparationTasks({
    supabase: divergentState.supabase,
    now,
    deps: recoveryDeps(divergentState.state),
  });
  assert.equal(divergent.results[0]?.reason, "queue_identity_divergence");

  const uncertainState = createSupabase();
  let enqueueCalled = false;
  const uncertain = await recoverAbandonedQuotePreparationTasks({
    supabase: uncertainState.supabase,
    now,
    deps: recoveryDeps(uncertainState.state, {
      issueAuthorization: async () => { throw Object.assign(new Error("timeout"), { kind: "uncertain" }); },
      enqueue: async () => { enqueueCalled = true; return recoveryDeps(uncertainState.state).enqueue({} as never); },
    }),
  });
  assert.equal(uncertain.results[0]?.reason, "authorization_uncertain");
  assert.equal(enqueueCalled, false);

  const uncertainPersistedState = createSupabase();
  let issueAfterUncertainCalled = false;
  const uncertainPersisted = await recoverAbandonedQuotePreparationTasks({
    supabase: uncertainPersistedState.supabase,
    now,
    deps: recoveryDeps(uncertainPersistedState.state, {
      readAuthorization: async () => ({ outcome: "uncertain" as const }),
      issueAuthorization: async () => { issueAfterUncertainCalled = true; throw new Error("must not retry"); },
    }),
  });
  assert.equal(uncertainPersisted.results[0]?.reason, "authorization_state_uncertain");
  assert.equal(issueAfterUncertainCalled, false);
});

test("authorization blocked, stale, resolved and cancelled tasks are not recovered", async () => {
  process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED = "true";
  const blockedState = createSupabase();
  const blocked = await recoverAbandonedQuotePreparationTasks({
    supabase: blockedState.supabase,
    now,
    deps: recoveryDeps(blockedState.state, {
      issueAuthorization: async () => ({
        ...recoveryDeps(blockedState.state).issueAuthorization({} as never),
        outcome: "blocked" as const,
        reason: "authorization_revoked" as const,
      }),
    }),
  });
  assert.equal(blocked.results[0]?.reason, "authorization_revoked");

  const stale = createSupabase({ tasks: [{ ...task, created_at: "2026-10-30T11:40:00.000Z" }] });
  const staleResult = await recoverAbandonedQuotePreparationTasks({ supabase: stale.supabase, now, deps: recoveryDeps(stale.state) });
  assert.equal(staleResult.candidates, 0);

  const resolved = createSupabase({ tasks: [{ ...task, status: "resolved" }] });
  const resolvedResult = await recoverAbandonedQuotePreparationTasks({ supabase: resolved.supabase, now, deps: recoveryDeps(resolved.state) });
  assert.equal(resolvedResult.candidates, 0);

  const cancelled = createSupabase({ tasks: [{ ...task, cancelled_at: "2026-10-30T11:59:00.000Z" }] });
  const cancelledResult = await recoverAbandonedQuotePreparationTasks({ supabase: cancelled.supabase, now, deps: recoveryDeps(cancelled.state) });
  assert.equal(cancelledResult.results[0]?.reason, "task_cancelled");
});

test("legacy worker path remains present and recovery is outside the AI reply module", () => {
  const workerSource = readFileSync(
    join(process.cwd(), "src/lib/server/process-assistant-operational-tasks.ts"),
    "utf8",
  );
  const aiReplySource = readFileSync(
    join(process.cwd(), "src/lib/server/generate-and-save-ai-sales-reply.ts"),
    "utf8",
  );
  assert.match(workerSource, /LEGACY_OPERATIONAL_TASK_QUEUE_TYPE/);
  assert.match(workerSource, /recoverAbandonedQuotePreparationTasks/);
  assert.doesNotMatch(aiReplySource, /recoverAbandonedQuotePreparationTasks/);
});
