import { strict as assert } from "node:assert";
import {
  SALES_QUOTE_SEND_FINALIZE_RPC,
  SALES_QUOTE_SEND_MATERIALIZE_RPC,
  SALES_QUOTE_SEND_OUTBOUND_ORIGIN,
  SALES_QUOTE_SEND_ROUTE_SOURCE,
  SALES_QUOTE_SEND_RECONCILIATION_SOURCE,
  SalesQuoteSendMaterializationError,
  buildSalesQuoteSendIdempotencyKey,
  buildSalesQuoteSendMessageMetadata,
  finalizeSalesQuoteSendBySystem,
  isSalesQuoteSendMetadata,
  materializeSalesQuoteSendBySystem,
} from "./quote-send";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createRpcHarness(result?: {
  data?: unknown;
  error?: { message: string } | null;
}) {
  const calls: Array<{ fn: string; payload: Record<string, unknown> }> = [];

  return {
    calls,
    supabase: {
      rpc: async (fn: string, payload: Record<string, unknown>) => {
        calls.push({ fn, payload });
        return {
          data:
            result?.data ??
            [
              {
                message_id: "message-1",
                outbound_idempotency_key:
                  "sales_quote_send:org-1:store-1:opp-1:quote-1:version-1",
                outbound_delivery_state: "pending",
                commercial_opportunity_id: "opp-1",
                sales_quote_id: "quote-1",
                sales_quote_version_id: "version-1",
                external_message_id: null,
                outcome: "queued",
              },
            ],
          error: result?.error ?? null,
        };
      },
    },
  };
}

const baseMaterializeArgs = {
  organizationId: "org-1",
  storeId: "store-1",
  commercialOpportunityId: "opp-1",
  conversationId: "conv-1",
  salesQuoteId: "quote-1",
  salesQuoteVersionId: "version-1",
  messageContent: "Segue o orcamento.",
  messageMetadata: {
    outbound_origin: SALES_QUOTE_SEND_OUTBOUND_ORIGIN,
  },
};

const tests: TestCase[] = [
  {
    name: "deterministic send key uses tenant opportunity quote and version ids",
    run: () => {
      assert.equal(
        buildSalesQuoteSendIdempotencyKey({
          organizationId: "org-1",
          storeId: "store-1",
          commercialOpportunityId: "opp-1",
          salesQuoteId: "quote-1",
          salesQuoteVersionId: "version-1",
        }),
        "sales_quote_send:org-1:store-1:opp-1:quote-1:version-1",
      );
    },
  },
  {
    name: "quote send metadata becomes whatsapp eligible and preserves explicit ids",
    run: () => {
      const metadata = buildSalesQuoteSendMessageMetadata({
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        salesQuoteId: "quote-1",
        salesQuoteVersionId: "version-1",
        outboundIdempotencyKey:
          "sales_quote_send:org-1:store-1:opp-1:quote-1:version-1",
        baseMetadata: {
          quote_number: "ORC-001",
          storage_bucket: "zion-store-files",
          storage_path: "org-1/store-1/sales-quotes/quote-1/v1.pdf",
          mime_type: "application/pdf",
        },
      });

      assert.equal(metadata.outbound_origin, SALES_QUOTE_SEND_OUTBOUND_ORIGIN);
      assert.equal(metadata.source, SALES_QUOTE_SEND_ROUTE_SOURCE);
      assert.equal(metadata.external_channel, "whatsapp");
      assert.equal(metadata.send_external, true);
      assert.equal(metadata.commercial_opportunity_id, "opp-1");
      assert.equal(metadata.sales_quote_id, "quote-1");
      assert.equal(metadata.sales_quote_version_id, "version-1");
      assert.equal((metadata as Record<string, unknown>).storage_bucket, "zion-store-files");
    },
  },
  {
    name: "materialize writer uses canonical rpc payload",
    run: async () => {
      const harness = createRpcHarness();

      const row = await materializeSalesQuoteSendBySystem({
        supabase: harness.supabase,
        ...baseMaterializeArgs,
      });

      assert.equal(row.outcome, "queued");
      assert.deepEqual(harness.calls, [
        {
          fn: SALES_QUOTE_SEND_MATERIALIZE_RPC,
          payload: {
            p_organization_id: "org-1",
            p_store_id: "store-1",
            p_commercial_opportunity_id: "opp-1",
            p_conversation_id: "conv-1",
            p_sales_quote_id: "quote-1",
            p_sales_quote_version_id: "version-1",
            p_message_content: "Segue o orcamento.",
            p_message_metadata: {
              outbound_origin: SALES_QUOTE_SEND_OUTBOUND_ORIGIN,
            },
            p_idempotency_key:
              "sales_quote_send:org-1:store-1:opp-1:quote-1:version-1",
            p_source: SALES_QUOTE_SEND_ROUTE_SOURCE,
          },
        },
      ]);
    },
  },
  {
    name: "materialize accepts explicit failed outcome instead of mislabeling it already queued",
    run: async () => {
      const harness = createRpcHarness({
        data: [
          {
            message_id: "message-1",
            outbound_idempotency_key:
              "sales_quote_send:org-1:store-1:opp-1:quote-1:version-1",
            outbound_delivery_state: "failed",
            commercial_opportunity_id: "opp-1",
            sales_quote_id: "quote-1",
            sales_quote_version_id: "version-1",
            external_message_id: null,
            outcome: "failed",
          },
        ],
      });

      const row = await materializeSalesQuoteSendBySystem({
        supabase: harness.supabase,
        ...baseMaterializeArgs,
      });

      assert.equal(row.outcome, "failed");
      assert.equal(row.outbound_delivery_state, "failed");
    },
  },
  {
    name: "materialize fails closed if rpc returns another opportunity quote or version",
    run: async () => {
      const harness = createRpcHarness({
        data: [
          {
            message_id: "message-wrong",
            outbound_idempotency_key:
              "sales_quote_send:org-1:store-1:opp-2:quote-2:version-2",
            outbound_delivery_state: "pending",
            commercial_opportunity_id: "opp-2",
            sales_quote_id: "quote-2",
            sales_quote_version_id: "version-2",
            external_message_id: null,
            outcome: "queued",
          },
        ],
      });

      await assert.rejects(
        materializeSalesQuoteSendBySystem({
          supabase: harness.supabase,
          ...baseMaterializeArgs,
        }),
        (error: unknown) =>
          error instanceof SalesQuoteSendMaterializationError &&
          /fora do escopo solicitado/.test(error.message),
      );
    },
  },
  {
    name: "materialize fails closed if rpc returns wrong deterministic key",
    run: async () => {
      const harness = createRpcHarness({
        data: [
          {
            message_id: "message-1",
            outbound_idempotency_key: "arbitrary-key",
            outbound_delivery_state: "pending",
            commercial_opportunity_id: "opp-1",
            sales_quote_id: "quote-1",
            sales_quote_version_id: "version-1",
            external_message_id: null,
            outcome: "queued",
          },
        ],
      });

      await assert.rejects(
        materializeSalesQuoteSendBySystem({
          supabase: harness.supabase,
          ...baseMaterializeArgs,
        }),
        (error: unknown) => error instanceof SalesQuoteSendMaterializationError,
      );
    },
  },
  {
    name: "finalize writer uses same deterministic key and canonical source",
    run: async () => {
      const harness = createRpcHarness({
        data: [{
          sales_quote_id: "quote-1",
          sales_quote_version_id: "version-1",
          message_id: "message-1",
          external_message_id: "wamid-1",
          sent_at: "2026-08-21T18:00:00.000Z",
          conversation_event_created: true,
          current_proposal_outcome: "current_proposal_updated",
          outcome: "finalized",
        }],
      });

      await finalizeSalesQuoteSendBySystem({
        supabase: harness.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        salesQuoteId: "quote-1",
        salesQuoteVersionId: "version-1",
        messageId: "message-1",
      });

      assert.deepEqual(harness.calls, [
        {
          fn: SALES_QUOTE_SEND_FINALIZE_RPC,
          payload: {
            p_organization_id: "org-1",
            p_store_id: "store-1",
            p_commercial_opportunity_id: "opp-1",
            p_sales_quote_id: "quote-1",
            p_sales_quote_version_id: "version-1",
            p_message_id: "message-1",
            p_idempotency_key:
              "sales_quote_send:org-1:store-1:opp-1:quote-1:version-1",
            p_source: SALES_QUOTE_SEND_RECONCILIATION_SOURCE,
          },
        },
      ]);
    },
  },
  {
    name: "finalize fails closed if rpc returns another quote version or message",
    run: async () => {
      const harness = createRpcHarness({
        data: [{
          sales_quote_id: "quote-OTHER",
          sales_quote_version_id: "version-1",
          message_id: "message-1",
          external_message_id: "wamid-1",
          sent_at: "2026-08-21T18:00:00.000Z",
          conversation_event_created: false,
          current_proposal_outcome: null,
          outcome: "finalized",
        }],
      });

      await assert.rejects(
        finalizeSalesQuoteSendBySystem({
          supabase: harness.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          commercialOpportunityId: "opp-1",
          salesQuoteId: "quote-1",
          salesQuoteVersionId: "version-1",
          messageId: "message-1",
        }),
        (error: unknown) => error instanceof SalesQuoteSendMaterializationError,
      );
    },
  },
  {
    name: "origin detector matches only canonical quote send messages",
    run: () => {
      assert.equal(
        isSalesQuoteSendMetadata({
          outbound_origin: SALES_QUOTE_SEND_OUTBOUND_ORIGIN,
        }),
        true,
      );
      assert.equal(isSalesQuoteSendMetadata({ outbound_origin: "crm_manual_text" }), false);
      assert.equal(isSalesQuoteSendMetadata(null), false);
    },
  },
  {
    name: "invalid materialization row fails closed",
    run: async () => {
      const harness = createRpcHarness({
        data: [{ outcome: "broken" }],
      });

      await assert.rejects(
        materializeSalesQuoteSendBySystem({
          supabase: harness.supabase,
          ...baseMaterializeArgs,
        }),
        (error: unknown) => error instanceof SalesQuoteSendMaterializationError,
      );
    },
  },
  {
    name: "rpc error is surfaced as materialization error without leaking backend detail",
    run: async () => {
      const harness = createRpcHarness({
        data: null,
        error: { message: "backend detail" },
      });

      await assert.rejects(
        materializeSalesQuoteSendBySystem({
          supabase: harness.supabase,
          ...baseMaterializeArgs,
        }),
        (error: unknown) =>
          error instanceof SalesQuoteSendMaterializationError &&
          !error.message.includes("backend detail"),
      );
    },
  },
];

void (async () => {
  const failures: string[] = [];

  for (const testCase of tests) {
    try {
      await testCase.run();
      process.stdout.write(`ok - ${testCase.name}\n`);
    } catch (error) {
      failures.push(
        `not ok - ${testCase.name}\n${error instanceof Error ? error.stack || error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  }
})();
