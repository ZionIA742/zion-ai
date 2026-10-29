import assert from "node:assert/strict";
import test from "node:test";
import {
  registerQuotePreparationOperationBySystem,
  QuotePreparationRegistrationError,
  type QuotePreparationRegistration,
} from "./register-quote-preparation-operation-by-system";

const registration: QuotePreparationRegistration = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  leadId: "33333333-3333-4333-8333-333333333333",
  conversationId: "44444444-4444-4444-8444-444444444444",
  commercialOpportunityId: "55555555-5555-4555-8555-555555555555",
  requestMessageId: "66666666-6666-4666-8666-666666666666",
  profileVersionId: "77777777-7777-4777-8777-777777777777",
  profileVersionNumber: 3,
  operationKey: "p19a:quote-preparation:message-1",
  requestFingerprint: "a".repeat(64),
};

const operationId = "88888888-8888-4888-8888-888888888888";

function rpcResult(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "created",
    operation_id: operationId,
    organization_id: registration.organizationId,
    store_id: registration.storeId,
    status: "queued",
    profile_version_id: registration.profileVersionId,
    request_message_id: registration.requestMessageId,
    ...overrides,
  };
}

function client(options: {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
} = {}) {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  return {
    calls,
    async rpc(name: string, payload: Record<string, unknown>) {
      calls.push({ name, payload });
      return { data: options.data ?? rpcResult(), error: options.error ?? null };
    },
  };
}

test("registers with the exact ten RPC arguments", async () => {
  const supabase = client();
  const result = await registerQuotePreparationOperationBySystem({ registration, supabase });

  assert.equal(result.outcome, "created");
  assert.equal(result.operationId, operationId);
  assert.deepEqual(supabase.calls, [{
    name: "register_quote_preparation_operation_by_system",
    payload: {
      p_organization_id: registration.organizationId,
      p_store_id: registration.storeId,
      p_lead_id: registration.leadId,
      p_conversation_id: registration.conversationId,
      p_commercial_opportunity_id: registration.commercialOpportunityId,
      p_request_message_id: registration.requestMessageId,
      p_profile_version_id: registration.profileVersionId,
      p_profile_version_number: registration.profileVersionNumber,
      p_operation_key: registration.operationKey,
      p_request_fingerprint: registration.requestFingerprint,
    },
  }]);
  assert.equal(Object.keys(supabase.calls[0].payload).length, 10);
});

test("preserves the same operation on replay", async () => {
  const supabase = client({
    data: rpcResult({ outcome: "idempotent_replay", status: "processing" }),
  });
  const result = await registerQuotePreparationOperationBySystem({ registration, supabase });

  assert.equal(result.outcome, "idempotent_replay");
  assert.equal(result.operationId, operationId);
  assert.equal(supabase.calls.length, 1);
});

test("returns an explicit active-operation block", async () => {
  const supabase = client({
    data: {
      outcome: "blocked",
      reason: "active_preparation_exists",
      operation_id: null,
      status: "blocked",
    },
  });
  const result = await registerQuotePreparationOperationBySystem({ registration, supabase });

  assert.equal(result.outcome, "blocked");
  assert.equal(result.operationId, null);
  assert.equal(result.reason, "active_preparation_exists");
  assert.equal(supabase.calls.length, 1);
});

test("maps RPC rejection without retrying or calling a writer", async () => {
  const supabase = client({
    data: null,
    error: { code: "P19A_QUOTE_PREP_REQUEST_ALREADY_REGISTERED", message: "duplicate" },
  });

  await assert.rejects(
    registerQuotePreparationOperationBySystem({ registration, supabase }),
    (error: unknown) =>
      error instanceof QuotePreparationRegistrationError &&
      error.kind === "rejected" &&
      error.code === "P19A_QUOTE_PREP_REQUEST_ALREADY_REGISTERED",
  );
  assert.equal(supabase.calls.length, 1);
});

test("marks transport failure uncertain and never retries", async () => {
  let calls = 0;
  const supabase = {
    async rpc() {
      calls += 1;
      throw new Error("network timeout");
    },
  };

  await assert.rejects(
    registerQuotePreparationOperationBySystem({ registration, supabase }),
    (error: unknown) =>
      error instanceof QuotePreparationRegistrationError &&
      error.kind === "uncertain" &&
      error.code === "P19A_QUOTE_PREP_RPC_UNCERTAIN",
  );
  assert.equal(calls, 1);
});

test("fails closed on incomplete or divergent results", async () => {
  for (const data of [
    { outcome: "created", operation_id: operationId, status: "queued" },
    rpcResult({ organization_id: "99999999-9999-4999-8999-999999999999" }),
  ]) {
    const supabase = client({ data });
    await assert.rejects(
      registerQuotePreparationOperationBySystem({ registration, supabase }),
      (error: unknown) =>
        error instanceof QuotePreparationRegistrationError && error.kind === "uncertain",
    );
    assert.equal(supabase.calls.length, 1);
  }
});

test("rejects missing identity before contacting Supabase", async () => {
  const supabase = client();
  await assert.rejects(
    registerQuotePreparationOperationBySystem({
      registration: { ...registration, requestMessageId: "" },
      supabase,
    }),
    (error: unknown) =>
      error instanceof QuotePreparationRegistrationError && error.kind === "input",
  );
  assert.equal(supabase.calls.length, 0);
});
