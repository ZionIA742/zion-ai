import assert from "node:assert/strict";
import test from "node:test";
import { processQuotePreparationQueueItem } from "./process-assistant-operational-tasks";

const ids = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
  conversationId: "44444444-4444-4444-8444-444444444444",
  messageId: "55555555-5555-4555-8555-555555555555",
  queueId: "66666666-6666-4666-8666-666666666666",
  opportunityId: "77777777-7777-4777-8777-777777777777",
  profileVersionId: "88888888-8888-4888-8888-888888888888",
};

const queue = {
  id: ids.queueId,
  organization_id: ids.organizationId,
  store_id: ids.storeId,
  task_id: ids.taskId,
  conversation_id: ids.conversationId,
  message_id: ids.messageId,
  queue_type: "quote_preparation_request",
  status: "processing",
  attempts: 1,
  payload: null,
};

const identity = {
  taskId: ids.taskId,
  organizationId: ids.organizationId,
  storeId: ids.storeId,
  leadId: "99999999-9999-4999-8999-999999999999",
  conversationId: ids.conversationId,
  commercialOpportunityId: ids.opportunityId,
  requestMessageId: ids.messageId,
  profileVersionId: ids.profileVersionId,
  profileVersionNumber: 1,
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    resolveIdentity: async () => ({ eligible: true, identity }),
    validateAuthorization: async () => ({
      outcome: "authorized",
      reason: "authorization_valid",
      organizationId: ids.organizationId,
      storeId: ids.storeId,
      taskId: ids.taskId,
      requestMessageId: ids.messageId,
      queueId: ids.queueId,
      authorizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }),
    registerOperation: async () => ({
      outcome: "created",
      identity,
      operationKey: "p19a:quote-preparation:v1:key",
      requestFingerprint: "a".repeat(64),
      registration: {
        ...identity,
        operationKey: "p19a:quote-preparation:v1:key",
        requestFingerprint: "a".repeat(64),
        operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        outcome: "created",
        status: "queued",
      },
    }),
    createDraft: async () => ({
      outcome: "created",
      operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      quoteId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }),
    ...overrides,
  } as never;
}

test("gate OFF does not resolve, authorize, register, or create", async () => {
  const previous = process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED;
  delete process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED;
  let calls = 0;
  try {
    const result = await processQuotePreparationQueueItem({
      supabase: {},
      queue,
      workerId: "test-worker",
      deps: deps({ resolveIdentity: async () => { calls += 1; return { eligible: true, identity }; } }),
    });
    assert.equal(result.reason, "quote_preparation_gate_off");
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED;
    else process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED = previous;
  }
});

test("authorized processing uses canonical identities and the authorized writer", async () => {
  process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED = "true";
  const calls: string[] = [];
  const result = await processQuotePreparationQueueItem({
    supabase: {},
    queue,
    workerId: "test-worker",
    deps: deps({
      validateAuthorization: async () => { calls.push("validate"); return { outcome: "authorized", reason: "ok", ...identity, queueId: ids.queueId, authorizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }; },
      registerOperation: async () => { calls.push("register"); return deps().registerOperation(); },
      createDraft: async () => { calls.push("create-authorized"); return deps().createDraft(); },
    }),
  });
  assert.equal(result.action, "quote_preparation_created");
  assert.deepEqual(calls, ["validate", "register", "create-authorized"]);
});

test("blocked authorization, tenant mismatch, and uncertain creation fail closed", async () => {
  process.env.P19A_QUOTE_PREPARATION_AUTHORIZATION_ENABLED = "true";
  await assert.rejects(
    processQuotePreparationQueueItem({
      supabase: {}, queue, workerId: "test-worker",
      deps: deps({ validateAuthorization: async () => ({ outcome: "blocked", reason: "revoked", ...identity, queueId: ids.queueId }) }),
    }),
    /bloqueada/,
  );

  await assert.rejects(
    processQuotePreparationQueueItem({
      supabase: {}, queue, workerId: "test-worker",
      deps: deps({ resolveIdentity: async () => ({ eligible: true, identity: { ...identity, storeId: ids.organizationId } }) }),
    }),
    /nao corresponde/,
  );

  await assert.rejects(
    processQuotePreparationQueueItem({
      supabase: {}, queue, workerId: "test-worker",
      deps: deps({ createDraft: async () => { throw Object.assign(new Error("timeout"), { kind: "uncertain", code: "TIMEOUT" }); } }),
    }),
    /timeout/,
  );
});
