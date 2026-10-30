import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthorizedSalesQuoteDraftBySystem,
  AuthorizedSalesQuoteDraftError,
  type AuthorizedSalesQuoteDraftSupabase,
} from "./create-authorized-sales-quote-draft-by-system";

const operation = {
  authorizationId: "66666666-6666-4666-8666-666666666666",
  organizationId: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
  requestMessageId: "44444444-4444-4444-8444-444444444444",
  queueId: "55555555-5555-4555-8555-555555555555",
  operationId: "77777777-7777-4777-8777-777777777777",
  commercialOpportunityId: "88888888-8888-4888-8888-888888888888",
  profileVersionId: "99999999-9999-4999-8999-999999999999",
  profileVersionNumber: 2,
  creationIdempotencyKey: "p19a:quote-preparation:v1:key",
  creationRequestFingerprint: "a".repeat(64),
};

function client(data: unknown, error: { code?: string; message?: string } | null = null) {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const supabase: AuthorizedSalesQuoteDraftSupabase & { calls: typeof calls } = {
    calls,
    async rpc(name, payload) {
      calls.push({ name, payload });
      return { data, error };
    },
  };
  return supabase;
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "created",
    operation_id: operation.operationId,
    quote_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organization_id: operation.organizationId,
    store_id: operation.storeId,
    commercial_opportunity_id: operation.commercialOpportunityId,
    profile_version_id: operation.profileVersionId,
    profile_version_number: operation.profileVersionNumber,
    quote_status: "draft",
    item_count: 1,
    ...overrides,
  };
}

test("calls only the authorized 12-parameter RPC and accepts replay", async () => {
  const supabase = client(result({ outcome: "idempotent_replay" }));
  const created = await createAuthorizedSalesQuoteDraftBySystem({ operation, supabase });

  assert.equal(created.outcome, "idempotent_replay");
  assert.deepEqual(supabase.calls, [{
    name: "create_authorized_sales_quote_draft_from_current_profile_by_system",
    payload: {
      p_authorization_id: operation.authorizationId,
      p_organization_id: operation.organizationId,
      p_store_id: operation.storeId,
      p_task_id: operation.taskId,
      p_request_message_id: operation.requestMessageId,
      p_queue_id: operation.queueId,
      p_operation_id: operation.operationId,
      p_commercial_opportunity_id: operation.commercialOpportunityId,
      p_profile_version_id: operation.profileVersionId,
      p_profile_version_number: operation.profileVersionNumber,
      p_creation_idempotency_key: operation.creationIdempotencyKey,
      p_creation_request_fingerprint: operation.creationRequestFingerprint,
    },
  }]);
});

test("fails closed on RPC errors, transport uncertainty, and scope divergence", async () => {
  await assert.rejects(
    createAuthorizedSalesQuoteDraftBySystem({ operation, supabase: client(null, { code: "blocked" }) }),
    (error: unknown) => error instanceof AuthorizedSalesQuoteDraftError && error.kind === "rejected",
  );

  const uncertain: AuthorizedSalesQuoteDraftSupabase = {
    async rpc() {
      throw new Error("timeout");
    },
  };
  await assert.rejects(
    createAuthorizedSalesQuoteDraftBySystem({ operation, supabase: uncertain }),
    (error: unknown) => error instanceof AuthorizedSalesQuoteDraftError && error.kind === "uncertain",
  );

  await assert.rejects(
    createAuthorizedSalesQuoteDraftBySystem({ operation, supabase: client(result({ store_id: operation.organizationId })) }),
    (error: unknown) => error instanceof AuthorizedSalesQuoteDraftError && error.kind === "uncertain",
  );
});
