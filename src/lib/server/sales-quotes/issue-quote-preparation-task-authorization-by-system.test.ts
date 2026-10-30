import assert from "node:assert/strict";
import test from "node:test";
import {
  issueQuotePreparationTaskAuthorizationBySystem,
  QuotePreparationTaskAuthorizationError,
  type QuotePreparationTaskAuthorizationSupabase,
} from "./issue-quote-preparation-task-authorization-by-system";

const identity = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
  requestMessageId: "44444444-4444-4444-8444-444444444444",
};

const authorizationId = "55555555-5555-4555-8555-555555555555";
const issuedAt = "2026-10-29T20:00:00.000Z";
const expiresAt = "2026-10-29T20:10:00.000Z";

function rpcResult(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "created",
    authorization_id: authorizationId,
    organization_id: identity.organizationId,
    store_id: identity.storeId,
    task_id: identity.taskId,
    request_message_id: identity.requestMessageId,
    issued_at: issuedAt,
    expires_at: expiresAt,
    ...overrides,
  };
}

function client(options: {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
} = {}) {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const supabase: QuotePreparationTaskAuthorizationSupabase & {
    calls: typeof calls;
  } = {
    calls,
    async rpc(name, payload) {
      calls.push({ name, payload });
      return { data: options.data ?? rpcResult(), error: options.error ?? null };
    },
  };
  return supabase;
}

test("calls the installed RPC with exactly four explicit identities", async () => {
  const supabase = client();
  const result = await issueQuotePreparationTaskAuthorizationBySystem({
    ...identity,
    supabase,
  });

  assert.equal(result.outcome, "created");
  assert.equal(result.authorizationId, authorizationId);
  assert.deepEqual(supabase.calls, [{
    name: "issue_quote_preparation_task_authorization_by_system",
    payload: {
      p_organization_id: identity.organizationId,
      p_store_id: identity.storeId,
      p_task_id: identity.taskId,
      p_request_message_id: identity.requestMessageId,
    },
  }]);
  assert.equal(Object.keys(supabase.calls[0].payload).length, 4);
});

test("preserves idempotent replay without issuing another call", async () => {
  const supabase = client({ data: rpcResult({ outcome: "idempotent_replay" }) });
  const result = await issueQuotePreparationTaskAuthorizationBySystem({
    ...identity,
    supabase,
  });

  assert.equal(result.outcome, "idempotent_replay");
  assert.equal(result.authorizationId, authorizationId);
  assert.equal(supabase.calls.length, 1);
});

test("returns an explicit expired or revoked block", async () => {
  for (const reason of ["authorization_expired", "authorization_revoked"] as const) {
    const supabase = client({
      data: rpcResult({
        outcome: "blocked",
        reason,
        ...(reason === "authorization_revoked"
          ? { revoked_at: "2026-10-29T20:05:00.000Z" }
          : {}),
      }),
    });

    const result = await issueQuotePreparationTaskAuthorizationBySystem({
      ...identity,
      supabase,
    });

    assert.equal(result.outcome, "blocked");
    assert.equal(result.reason, reason);
    assert.equal(supabase.calls.length, 1);
  }
});

test("maps RPC rejection without retrying", async () => {
  const supabase = client({
    data: null,
    error: { code: "P19A_QUOTE_PREP_AUTH_TASK_CANCELLED", message: "cancelled" },
  });

  await assert.rejects(
    issueQuotePreparationTaskAuthorizationBySystem({ ...identity, supabase }),
    (error: unknown) =>
      error instanceof QuotePreparationTaskAuthorizationError &&
      error.kind === "rejected" &&
      error.code === "P19A_QUOTE_PREP_AUTH_TASK_CANCELLED",
  );
  assert.equal(supabase.calls.length, 1);
});

test("marks transport failure uncertain and never retries", async () => {
  let calls = 0;
  const supabase: QuotePreparationTaskAuthorizationSupabase = {
    async rpc() {
      calls += 1;
      throw new Error("network timeout");
    },
  };

  await assert.rejects(
    issueQuotePreparationTaskAuthorizationBySystem({ ...identity, supabase }),
    (error: unknown) =>
      error instanceof QuotePreparationTaskAuthorizationError &&
      error.kind === "uncertain" &&
      error.code === "P19A_QUOTE_PREP_AUTH_RPC_UNCERTAIN",
  );
  assert.equal(calls, 1);
});

test("fails closed on divergent or malformed RPC results", async () => {
  for (const data of [
    rpcResult({ organization_id: "99999999-9999-4999-8999-999999999999" }),
    rpcResult({ authorization_id: "not-a-uuid" }),
    { outcome: "created" },
  ]) {
    const supabase = client({ data });
    await assert.rejects(
      issueQuotePreparationTaskAuthorizationBySystem({ ...identity, supabase }),
      (error: unknown) =>
        error instanceof QuotePreparationTaskAuthorizationError &&
        error.kind === "uncertain",
    );
    assert.equal(supabase.calls.length, 1);
  }
});

test("rejects invalid explicit identities before contacting Supabase", async () => {
  const supabase = client();
  await assert.rejects(
    issueQuotePreparationTaskAuthorizationBySystem({
      ...identity,
      requestMessageId: "",
      supabase,
    }),
    (error: unknown) =>
      error instanceof QuotePreparationTaskAuthorizationError &&
      error.kind === "input",
  );
  assert.equal(supabase.calls.length, 0);
});
