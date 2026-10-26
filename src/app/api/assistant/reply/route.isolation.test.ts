import test from "node:test";
import assert from "node:assert/strict";

import { generateAssistantReply, type AssistantReplyTestDependencies } from "./route";

const ids = { organizationId: "org-test", storeId: "store-test" };

function isolatedDependencies(overrides: {
  supabaseClient?: unknown;
  openaiClient?: unknown;
  persistAssistantReply?: (input: unknown) => Promise<{ message?: string } | null>;
  recordAssistantAiRun?: AssistantReplyTestDependencies["recordAssistantAiRun"];
} = {}): AssistantReplyTestDependencies {
  return {
    supabaseClient: (overrides.supabaseClient || {}) as AssistantReplyTestDependencies["supabaseClient"],
    openaiClient: (overrides.openaiClient || { responses: { create: async () => ({ output_text: "resposta" }) } }) as AssistantReplyTestDependencies["openaiClient"],
    persistAssistantReply: (overrides.persistAssistantReply || (async () => null)) as AssistantReplyTestDependencies["persistAssistantReply"],
    recordAssistantAiRun: overrides.recordAssistantAiRun || (async () => undefined),
  };
}

test("assistant isolated generation rejects incomplete dependencies without env fallback", async () => {
  const result = await generateAssistantReply({
    request: new Request("http://localhost/assistant"),
    ...ids,
    testDependencies: {
      ...isolatedDependencies(),
      supabaseClient: null as never,
    } as AssistantReplyTestDependencies,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "ASSISTANT_TEST_DEPENDENCIES_INCOMPLETE");
});

test("assistant isolated generation uses the injected Supabase boundary and never reaches OpenAI on an early read failure", async () => {
  const calls: string[] = [];
  let openAiCalls = 0;
  const query = {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    contains() { return this; },
    order() { return this; },
    limit() { return this; },
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null }),
  };
  const supabaseClient = {
    from(table: string) {
      calls.push(`from:${table}`);
      return query;
    },
    rpc(name: string) {
      calls.push(`rpc:${name}`);
      return Promise.resolve({ data: null, error: null });
    },
  };
  const openaiClient = {
    responses: {
      create: async () => {
        openAiCalls += 1;
        return { output_text: "não deveria chamar" };
      },
    },
  };

  const result = await generateAssistantReply({
    request: new Request("http://localhost/assistant"),
    ...ids,
    testDependencies: isolatedDependencies({ supabaseClient, openaiClient }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "STORE_NOT_FOUND");
  assert.deepEqual(calls, ["from:stores"]);
  assert.equal(openAiCalls, 0);
});

test("assistant isolated generation uses the injected model and records persistence in memory", async () => {
  let openAiCalls = 0;
  let persistedReplies = 0;
  let recordedRuns = 0;

  type FakeQueryResult = { data: unknown; error: null };
  type FakeQuery = {
    select: () => FakeQuery;
    eq: () => FakeQuery;
    in: () => FakeQuery;
    contains: () => FakeQuery;
    order: () => FakeQuery;
    limit: () => FakeQuery;
    gte: () => FakeQuery;
    lte: () => FakeQuery;
    gt: () => FakeQuery;
    lt: () => FakeQuery;
    neq: () => FakeQuery;
    is: () => FakeQuery;
    not: () => FakeQuery;
    insert: () => FakeQuery;
    update: () => FakeQuery;
    maybeSingle: () => Promise<FakeQueryResult>;
    then: (resolve: (value: FakeQueryResult) => unknown) => unknown;
  };

  const makeQuery = (table: string): FakeQuery => {
    const result: FakeQueryResult = {
      data:
        table === "stores"
          ? { id: ids.storeId, organization_id: ids.organizationId, name: "Loja de teste" }
          : table === "store_assistant_threads"
            ? { id: "thread-test" }
            : [],
      error: null,
    };
    const query = {} as FakeQuery;
    for (const method of ["select", "eq", "in", "contains", "order", "limit", "gte", "lte", "gt", "lt", "neq", "is", "not", "insert", "update"] as const) {
      query[method] = () => query;
    }
    query.maybeSingle = async () => result;
    query.then = (resolve) => resolve(result);
    return query;
  };

  const supabaseClient = {
    from: (table: string) => makeQuery(table),
    rpc: async (name: string): Promise<FakeQueryResult> => ({
      data:
        name === "assistant_list_messages"
          ? [{ id: "message-test", sender_role: "responsible", content: "Como estao meus compromissos?", created_at: "2026-10-26T10:00:00Z" }]
          : [],
      error: null,
    }),
  } as unknown as AssistantReplyTestDependencies["supabaseClient"];
  const openaiClient = {
    responses: {
      create: async () => {
        openAiCalls += 1;
        return { output_text: "Resposta simulada segura", usage: { input_tokens: 10, output_tokens: 4 } };
      },
    },
  } as unknown as AssistantReplyTestDependencies["openaiClient"];

  const result = await generateAssistantReply({
    request: new Request("http://localhost/assistant"),
    ...ids,
    testDependencies: isolatedDependencies({
      supabaseClient,
      openaiClient,
      persistAssistantReply: async () => {
        persistedReplies += 1;
        return null;
      },
      recordAssistantAiRun: async () => {
        recordedRuns += 1;
      },
    }),
  });

  assert.deepEqual(result, { ok: true, aiText: "Resposta simulada segura" });
  assert.equal(openAiCalls, 1);
  assert.equal(persistedReplies, 1);
  assert.equal(recordedRuns, 1);
});
