import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QUOTE_APPROVAL_REQUEST_RPC,
  requestQuoteSendApprovalBySystem,
} from "./quote-approval-request";

test("sends the exact canonical approval RPC contract", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const reportSnapshot = {
    quote_id: "quote-1",
    quote_version_id: "version-2",
    quote_version_number: "2",
    quote_number: "ORC-1",
    subtotal_cents: 1000,
    total_cents: 1000,
    currency: "BRL",
    quote_pdf_store_file_id: "file-2",
  };

  const result = await requestQuoteSendApprovalBySystem({
    supabase: {
      async rpc(name, args) {
        calls.push({ name, args });
        return {
          data: { request_id: "request-1", status: "pending_dispatch", created: true },
          error: null,
        };
      },
    },
    organizationId: "org-1",
    storeId: "store-1",
    responsibleId: "responsible-1",
    commercialOpportunityId: "opportunity-1",
    expectedLifecycleCycle: 1,
    quoteId: "quote-1",
    quoteVersionId: "version-2",
    reportSnapshot,
  });

  assert.deepEqual(result, {
    requestId: "request-1",
    status: "pending_dispatch",
    created: true,
  });
  assert.equal(calls[0]?.name, QUOTE_APPROVAL_REQUEST_RPC);
  assert.deepEqual(calls[0]?.args, {
    p_organization_id: "org-1",
    p_store_id: "store-1",
    p_responsible_id: "responsible-1",
    p_commercial_opportunity_id: "opportunity-1",
    p_expected_lifecycle_cycle: 1,
    p_quote_id: "quote-1",
    p_quote_version_id: "version-2",
    p_report_snapshot: reportSnapshot,
  });
});

test("preserves an idempotent replay returned by the canonical RPC", async () => {
  const result = await requestQuoteSendApprovalBySystem({
    supabase: {
      async rpc() {
        return {
          data: [{ request_id: "request-1", status: "awaiting_responsible", created: false }],
          error: null,
        };
      },
    },
    organizationId: "org-1",
    storeId: "store-1",
    responsibleId: "responsible-1",
    commercialOpportunityId: "opportunity-1",
    expectedLifecycleCycle: 1,
    quoteId: "quote-1",
    quoteVersionId: "version-2",
    reportSnapshot: { quote_id: "quote-1" },
  });

  assert.deepEqual(result, {
    requestId: "request-1",
    status: "awaiting_responsible",
    created: false,
  });
});

test("fails closed on an approval RPC error or malformed result", async () => {
  await assert.rejects(
    requestQuoteSendApprovalBySystem({
      supabase: { async rpc() { return { data: null, error: { message: "writer failed" } }; } },
      organizationId: "org-1",
      storeId: "store-1",
      responsibleId: "responsible-1",
      commercialOpportunityId: "opportunity-1",
      expectedLifecycleCycle: 1,
      quoteId: "quote-1",
      quoteVersionId: "version-2",
      reportSnapshot: { quote_id: "quote-1" },
    }),
    /P9_QUOTE_APPROVAL_REQUEST_RPC_FAILED/,
  );

  await assert.rejects(
    requestQuoteSendApprovalBySystem({
      supabase: { async rpc() { return { data: { request_id: "request-1", status: "rejected", created: true }, error: null }; } },
      organizationId: "org-1",
      storeId: "store-1",
      responsibleId: "responsible-1",
      commercialOpportunityId: "opportunity-1",
      expectedLifecycleCycle: 1,
      quoteId: "quote-1",
      quoteVersionId: "version-2",
      reportSnapshot: { quote_id: "quote-1" },
    }),
    /P9_QUOTE_APPROVAL_REQUEST_RPC_RETURN_INVALID/,
  );
});
