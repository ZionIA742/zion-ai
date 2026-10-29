import assert from "node:assert/strict";
import test from "node:test";
import {
  createSalesQuoteDraftBySystem,
  SalesQuoteDraftWriterError,
  type SalesQuoteDraftOperation,
} from "./create-sales-quote-draft-by-system";

const operation: SalesQuoteDraftOperation = {
  operationId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  storeId: "33333333-3333-4333-8333-333333333333",
  commercialOpportunityId: "44444444-4444-4444-8444-444444444444",
  profileVersionId: "55555555-5555-4555-8555-555555555555",
  profileVersionNumber: 3,
  creationIdempotencyKey: "p19a:quote-preparation:operation-1",
  creationRequestFingerprint: "a".repeat(64),
};

function result(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "created",
    operation_id: operation.operationId,
    quote_id: "66666666-6666-4666-8666-666666666666",
    organization_id: operation.organizationId,
    store_id: operation.storeId,
    commercial_opportunity_id: operation.commercialOpportunityId,
    profile_version_id: operation.profileVersionId,
    profile_version_number: operation.profileVersionNumber,
    quote_status: "draft",
    quote_number: "ORC-000062",
    item_count: 4,
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
      return { data: options.data ?? result(), error: options.error ?? null };
    },
  };
}

test("creates through the system writer with exact arguments", async () => {
  const supabase = client();
  const written = await createSalesQuoteDraftBySystem({
    operation,
    supabase,
  });

  assert.equal(written.outcome, "created");
  assert.equal(written.quoteNumber, "ORC-000062");
  assert.equal(supabase.calls.length, 1);
  assert.deepEqual(supabase.calls[0], {
    name: "create_sales_quote_draft_from_current_profile_by_system",
    payload: {
      p_operation_id: operation.operationId,
      p_organization_id: operation.organizationId,
      p_store_id: operation.storeId,
      p_commercial_opportunity_id: operation.commercialOpportunityId,
      p_profile_version_id: operation.profileVersionId,
      p_profile_version_number: operation.profileVersionNumber,
      p_creation_idempotency_key: operation.creationIdempotencyKey,
      p_creation_request_fingerprint: operation.creationRequestFingerprint,
    },
  });
});

test("preserves the same operation on replay", async () => {
  const supabase = client({ data: result({ outcome: "idempotent_replay" }) });
  const written = await createSalesQuoteDraftBySystem({ operation, supabase });
  assert.equal(written.outcome, "idempotent_replay");
  assert.equal(written.operationId, operation.operationId);
  assert.equal(supabase.calls.length, 1);
});

test("maps an RPC rejection without retrying or creating locally", async () => {
  const supabase = client({
    data: null,
    error: { code: "P19A_QUOTE_DRAFT_OPERATION_STATE_CONFLICT", message: "conflict" },
  });

  await assert.rejects(
    createSalesQuoteDraftBySystem({ operation, supabase }),
    (error: unknown) =>
      error instanceof SalesQuoteDraftWriterError &&
      error.kind === "rejected" &&
      error.code === "P19A_QUOTE_DRAFT_OPERATION_STATE_CONFLICT",
  );
  assert.equal(supabase.calls.length, 1);
});

test("fails closed on an incomplete RPC result", async () => {
  const supabase = client({ data: { outcome: "created" } });

  await assert.rejects(
    createSalesQuoteDraftBySystem({ operation, supabase }),
    (error: unknown) =>
      error instanceof SalesQuoteDraftWriterError &&
      error.kind === "uncertain" &&
      error.code === "P19A_QUOTE_DRAFT_RPC_RESULT_SCOPE_INVALID",
  );
});

test("marks a transport exception uncertain and never retries", async () => {
  const calls: string[] = [];
  const supabase = {
    async rpc() {
      calls.push("rpc");
      throw new Error("network timeout");
    },
  };

  await assert.rejects(
    createSalesQuoteDraftBySystem({ operation, supabase }),
    (error: unknown) =>
      error instanceof SalesQuoteDraftWriterError &&
      error.kind === "uncertain" &&
      error.code === "P19A_QUOTE_DRAFT_RPC_UNCERTAIN",
  );
  assert.deepEqual(calls, ["rpc"]);
});
