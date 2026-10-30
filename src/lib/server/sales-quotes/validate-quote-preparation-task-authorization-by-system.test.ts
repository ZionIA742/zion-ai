import assert from "node:assert/strict";
import test from "node:test";
import {
  validateQuotePreparationTaskAuthorizationBySystem,
  QuotePreparationTaskAuthorizationValidationError,
  type QuotePreparationTaskAuthorizationValidationSupabase,
} from "./validate-quote-preparation-task-authorization-by-system";

const identity = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
  requestMessageId: "44444444-4444-4444-8444-444444444444",
  queueId: "55555555-5555-4555-8555-555555555555",
};

const authorizationId = "66666666-6666-4666-8666-666666666666";

function rpcResult(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "authorized",
    reason: "authorization_valid",
    authorization_id: authorizationId,
    organization_id: identity.organizationId,
    store_id: identity.storeId,
    task_id: identity.taskId,
    request_message_id: identity.requestMessageId,
    queue_id: identity.queueId,
    expires_at: "2026-10-30T20:10:00.000Z",
    task_status: "ready_to_execute",
    queue_status: "processing",
    ai_can_generate_quote: true,
    ...overrides,
  };
}

function client(options: { data?: unknown; error?: { code?: string; message?: string } | null } = {}) {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const supabase: QuotePreparationTaskAuthorizationValidationSupabase & { calls: typeof calls } = {
    calls,
    async rpc(name, payload) {
      calls.push({ name, payload });
      return { data: options.data ?? rpcResult(), error: options.error ?? null };
    },
  };
  return supabase;
}

test("calls validation with all canonical identities and accepts authorized", async () => {
  const supabase = client();
  const result = await validateQuotePreparationTaskAuthorizationBySystem({ ...identity, supabase });

  assert.equal(result.outcome, "authorized");
  assert.equal(result.authorizationId, authorizationId);
  assert.deepEqual(supabase.calls, [{
    name: "validate_quote_preparation_task_authorization_by_system",
    payload: {
      p_organization_id: identity.organizationId,
      p_store_id: identity.storeId,
      p_task_id: identity.taskId,
      p_request_message_id: identity.requestMessageId,
      p_queue_id: identity.queueId,
    },
  }]);
});

test("preserves a safe blocked result without treating it as authorization", async () => {
  const supabase = client({
    data: rpcResult({ outcome: "blocked", reason: "authorization_expired" }),
  });
  const result = await validateQuotePreparationTaskAuthorizationBySystem({ ...identity, supabase });

  assert.equal(result.outcome, "blocked");
  assert.equal(result.reason, "authorization_expired");
  assert.equal(result.authorizationId, undefined);
});

test("maps RPC failure and transport uncertainty without retrying", async () => {
  const rejected = client({ data: null, error: { code: "P19A_VALIDATION_REJECTED" } });
  await assert.rejects(
    validateQuotePreparationTaskAuthorizationBySystem({ ...identity, supabase: rejected }),
    (error: unknown) => error instanceof QuotePreparationTaskAuthorizationValidationError && error.kind === "rejected",
  );

  let calls = 0;
  const uncertain: QuotePreparationTaskAuthorizationValidationSupabase = {
    async rpc() {
      calls += 1;
      throw new Error("timeout");
    },
  };
  await assert.rejects(
    validateQuotePreparationTaskAuthorizationBySystem({ ...identity, supabase: uncertain }),
    (error: unknown) => error instanceof QuotePreparationTaskAuthorizationValidationError && error.kind === "uncertain",
  );
  assert.equal(calls, 1);
});

test("fails closed on scope divergence, missing authorization proof, or false quote setting", async () => {
  for (const data of [
    rpcResult({ organization_id: "99999999-9999-4999-8999-999999999999" }),
    rpcResult({ authorization_id: undefined }),
    rpcResult({ ai_can_generate_quote: false }),
  ]) {
    await assert.rejects(
      validateQuotePreparationTaskAuthorizationBySystem({ ...identity, supabase: client({ data }) }),
      (error: unknown) => error instanceof QuotePreparationTaskAuthorizationValidationError && error.kind === "uncertain",
    );
  }
});

test("rejects invalid identities before contacting Supabase", async () => {
  const supabase = client();
  await assert.rejects(
    validateQuotePreparationTaskAuthorizationBySystem({ ...identity, queueId: "", supabase }),
    (error: unknown) => error instanceof QuotePreparationTaskAuthorizationValidationError && error.kind === "input",
  );
  assert.equal(supabase.calls.length, 0);
});
