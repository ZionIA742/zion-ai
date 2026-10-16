import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCEPTED_SALES_QUOTE_REVISION_RPC,
  CURRENT_COMMERCIAL_PROPOSAL_ACCEPTANCE_READER,
  buildAcceptedSalesQuoteRevisionInputFingerprint,
  buildAcceptedSalesQuoteRevisionOperationKey,
  createAcceptedSalesQuoteRevisionBySystem,
  resolveAcceptedSalesQuoteRevision,
} from "./accepted-sales-quote-revision";

const SCOPE = {
  organizationId: "org-1",
  storeId: "store-1",
  commercialOpportunityId: "opportunity-1",
  quoteId: "quote-1",
  quoteVersionId: "version-1",
};

function client(row: Record<string, unknown> | null, error: { message?: string } | null = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    supabase: {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return { data: row ? [row] : [], error };
      },
    },
  };
}

function acceptedRow(overrides: Record<string, unknown> = {}) {
  return {
    commercial_opportunity_id: SCOPE.commercialOpportunityId,
    lifecycle_cycle: 1,
    current_quote_id: SCOPE.quoteId,
    current_quote_version_id: SCOPE.quoteVersionId,
    acceptance_state: "accepted",
    reason_code: "current_proposal_accepted",
    acceptance_event_id: "acceptance-1",
    source_message_id: "message-1",
    accepted_at: "2026-10-16T12:00:00.000Z",
    ...overrides,
  };
}

test("resolves the exact accepted opportunity, cycle, quote, version, and event", async () => {
  const fake = client(acceptedRow());
  const result = await resolveAcceptedSalesQuoteRevision({ supabase: fake.supabase, ...SCOPE });
  assert.equal(result.kind, "accepted");
  assert.equal(fake.calls[0]?.name, CURRENT_COMMERCIAL_PROPOSAL_ACCEPTANCE_READER);
  assert.deepEqual(fake.calls[0]?.args, {
    p_organization_id: SCOPE.organizationId,
    p_store_id: SCOPE.storeId,
    p_commercial_opportunity_id: SCOPE.commercialOpportunityId,
  });
});

test("does not classify a non-accepted current proposal as post-acceptance", async () => {
  const fake = client(acceptedRow({ acceptance_state: "none", reason_code: "current_proposal_not_accepted" }));
  const result = await resolveAcceptedSalesQuoteRevision({ supabase: fake.supabase, ...SCOPE });
  assert.deepEqual(result, { kind: "not_accepted" });
});

test("fails closed on stale or contradictory acceptance lineage", async () => {
  for (const overrides of [
    { current_quote_id: "other-quote" },
    { current_quote_version_id: "other-version" },
    { commercial_opportunity_id: "other-opportunity" },
    { acceptance_event_id: null },
  ]) {
    await assert.rejects(
      resolveAcceptedSalesQuoteRevision({
        supabase: client(acceptedRow(overrides)).supabase,
        ...SCOPE,
      }),
      /POST_ACCEPTANCE_REVISION_ACCEPTANCE_SCOPE_INVALID/,
    );
  }
});

test("does not hide reader RPC failure or invalid cardinality", async () => {
  await assert.rejects(
    resolveAcceptedSalesQuoteRevision({ supabase: client(null, { message: "reader unavailable" }).supabase, ...SCOPE }),
    /Falha ao resolver aceite comercial canônico/,
  );
  await assert.rejects(
    resolveAcceptedSalesQuoteRevision({
      supabase: {
        async rpc() {
          return { data: [acceptedRow(), acceptedRow()], error: null };
        },
      },
      ...SCOPE,
    }),
    /retorno RPC inválido/,
  );
});

test("calls the installed atomic revision RPC with the exact migration contract", async () => {
  const fake = client({
    revision_id: "revision-1",
    quote_id: SCOPE.quoteId,
    source_quote_version_id: SCOPE.quoteVersionId,
    target_quote_version_id: "version-2",
    source_acceptance_event_id: "acceptance-1",
    quote_status: "pending_review",
    outcome: "created",
  });
  const operationKey = buildAcceptedSalesQuoteRevisionOperationKey("change-1");
  const revision = { items: [], quote_snapshot: {}, total_cents: 100 };

  const result = await createAcceptedSalesQuoteRevisionBySystem({
    supabase: fake.supabase,
    organizationId: SCOPE.organizationId,
    storeId: SCOPE.storeId,
    commercialOpportunityId: SCOPE.commercialOpportunityId,
    expectedLifecycleCycle: 1,
    quoteId: SCOPE.quoteId,
    sourceQuoteVersionId: SCOPE.quoteVersionId,
    sourceAcceptanceEventId: "acceptance-1",
    changeRequestId: "change-1",
    operationKey,
    revision,
  });

  assert.deepEqual(result, {
    revisionId: "revision-1",
    quoteId: SCOPE.quoteId,
    sourceQuoteVersionId: SCOPE.quoteVersionId,
    targetQuoteVersionId: "version-2",
    sourceAcceptanceEventId: "acceptance-1",
    quoteStatus: "pending_review",
    outcome: "created",
  });
  assert.equal(fake.calls[0]?.name, ACCEPTED_SALES_QUOTE_REVISION_RPC);
  assert.deepEqual(fake.calls[0]?.args, {
    p_organization_id: SCOPE.organizationId,
    p_store_id: SCOPE.storeId,
    p_commercial_opportunity_id: SCOPE.commercialOpportunityId,
    p_expected_lifecycle_cycle: 1,
    p_quote_id: SCOPE.quoteId,
    p_source_quote_version_id: SCOPE.quoteVersionId,
    p_source_acceptance_event_id: "acceptance-1",
    p_change_request_id: "change-1",
    p_operation_key: operationKey,
    p_revision: revision,
  });
});

test("fails closed on replay, status, or scope returns that do not match the RPC contract", async () => {
  for (const row of [
    { outcome: "created", quote_status: "pending_review", quote_id: "other-quote" },
    { outcome: "created", quote_status: "sent", quote_id: SCOPE.quoteId },
    { outcome: "unknown", quote_status: "pending_review", quote_id: SCOPE.quoteId },
  ]) {
    await assert.rejects(
      createAcceptedSalesQuoteRevisionBySystem({
        supabase: client({
          revision_id: "revision-1",
          quote_id: row.quote_id,
          source_quote_version_id: SCOPE.quoteVersionId,
          target_quote_version_id: "version-2",
          source_acceptance_event_id: "acceptance-1",
          quote_status: row.quote_status,
          outcome: row.outcome,
        }).supabase,
        organizationId: SCOPE.organizationId,
        storeId: SCOPE.storeId,
        commercialOpportunityId: SCOPE.commercialOpportunityId,
        expectedLifecycleCycle: 1,
        quoteId: SCOPE.quoteId,
        sourceQuoteVersionId: SCOPE.quoteVersionId,
        sourceAcceptanceEventId: "acceptance-1",
        changeRequestId: "change-1",
        operationKey: "accepted-quote-revision:change-1",
        revision: { items: [], quote_snapshot: {} },
      }),
      /POST_ACCEPTANCE_REVISION_RPC_RETURN/,
    );
  }
});

test("changes the replay binding when accepted revision content diverges", () => {
  const original = buildAcceptedSalesQuoteRevisionInputFingerprint(
    {
      title: "Piscina original",
      items: [{ name: "Instalacao", quantity: 1, unit_price_cents: 1000 }],
    },
    "change-1",
  );
  const divergent = buildAcceptedSalesQuoteRevisionInputFingerprint(
    {
      title: "Piscina divergente",
      items: [{ name: "Instalacao", quantity: 1, unit_price_cents: 1000 }],
    },
    "change-1",
  );

  assert.notEqual(original, divergent);
  assert.match(original, /^[a-f0-9]{64}$/);
});
