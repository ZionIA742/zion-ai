import { strict as assert } from "node:assert";
import {
  createProcessWhatsappPendingMessages,
  isRetryableWhatsappHttpStatus,
} from "./whatsapp-external-sender";

type TestCase = { name: string; run: () => Promise<void> | void };

type MessageOverrides = Partial<Record<string, unknown>>;

function createMessage(overrides?: MessageOverrides) {
  return {
    id: "message-1",
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    leadId: "lead-1",
    phone: "5511999999999",
    content: "Segue o orcamento",
    rawMessageType: "text",
    messageType: "text",
    mediaUrl: null,
    metadata: {
      external_channel: "whatsapp",
      send_external: true,
      outbound_origin: "sales_quote_send",
      commercial_opportunity_id: "opp-1",
      sales_quote_id: "quote-1",
      sales_quote_version_id: "version-1",
    },
    externalMessageId: null,
    outboundDeliveryState: "pending",
    outboundIdempotencyKey:
      "sales_quote_send:org-1:store-1:opp-1:quote-1:version-1",
    outboundClaimedAt: null,
    outboundAttemptStartedAt: null,
    outboundProviderAcceptedAt: null,
    outboundCommercialFinalizedAt: null,
    outboundCommercialErrorText: null,
    ...overrides,
  };
}

function createHarness(overrides?: {
  pending?: Array<Record<string, unknown>>;
  claimResults?: boolean[];
  prepareImpl?: () => Promise<Record<string, unknown>>;
  sendImpl?: () => Promise<string>;
  markSentImpl?: () => Promise<void>;
  finalizeImpl?: () => Promise<{
    commercialOpportunityId: string;
    salesQuoteId: string;
    salesQuoteVersionId: string;
  } | null>;
  reconcileResults?: Array<{ messageId: string; detail: string }>;
  integrationImpl?: () => Promise<{ accessToken: string; phoneNumberId: string }>;
}) {
  const calls = {
    integration: 0,
    claim: [] as string[],
    release: [] as Array<{ messageId: string; org: string; store: string; errorText: string | null }>,
    attemptStarted: [] as string[],
    retryable: [] as Array<{ messageId: string; errorText: string }>,
    failed: [] as Array<{ messageId: string; errorText: string }>,
    uncertain: [] as Array<{
      messageId: string;
      errorText: string;
      providerMessageId: string | null;
    }>,
    markSent: [] as Array<{ messageId: string; externalMessageId: string }>,
    commercialPending: [] as Array<{ messageId: string; errorText: string }>,
    prepared: [] as string[],
    send: [] as string[],
    finalize: [] as string[],
    reconcile: 0,
  };
  const claimQueue = [...(overrides?.claimResults ?? [true])];
  const pending = overrides?.pending ?? [createMessage()];

  const process = createProcessWhatsappPendingMessages({
    createSupabaseAdmin: () => ({}) as never,
    getWhatsappIntegration: async () => {
      calls.integration += 1;
      if (overrides?.integrationImpl) return overrides.integrationImpl();
      return { accessToken: "token", phoneNumberId: "phone-number-id" };
    },
    getPendingExternalMessages: async () => pending as never,
    claimMessageForExternalSend: async (_supabase, message) => {
      calls.claim.push(message.id);
      return claimQueue.shift() ?? true;
    },
    releaseClaimedMessage: async (_supabase, message, errorText) => {
      calls.release.push({
        messageId: message.id,
        org: message.organizationId,
        store: message.storeId,
        errorText,
      });
    },
    markMessageAttemptStarted: async (_supabase, message) => {
      calls.attemptStarted.push(message.id);
    },
    markMessageRetryableFailure: async (_supabase, message, errorText) => {
      calls.retryable.push({ messageId: message.id, errorText });
    },
    markMessageFailed: async (_supabase, message, errorText) => {
      calls.failed.push({ messageId: message.id, errorText });
    },
    markMessageUncertain: async (_supabase, message, errorText, providerMessageId) => {
      calls.uncertain.push({
        messageId: message.id,
        errorText,
        providerMessageId: providerMessageId ?? null,
      });
    },
    markMessageExternalSent: async (_supabase, message, externalMessageId) => {
      calls.markSent.push({ messageId: message.id, externalMessageId });
      if (overrides?.markSentImpl) await overrides.markSentImpl();
    },
    markMessageCommercialFinalizationPending: async (_supabase, message, errorText) => {
      calls.commercialPending.push({ messageId: message.id, errorText });
    },
    preparePendingMessageForSend: async (_supabase, message) => {
      calls.prepared.push(message.id);
      if (overrides?.prepareImpl) return (await overrides.prepareImpl()) as never;
      return { mode: "text" as const, to: "5511999999999", body: "Segue o orcamento" };
    },
    sendSinglePendingMessage: async () => {
      calls.send.push("send");
      if (overrides?.sendImpl) return overrides.sendImpl();
      return "wamid-1";
    },
    finalizeQuoteSendMessageIfNeeded: async (_supabase, message) => {
      calls.finalize.push(message.id);
      if (overrides?.finalizeImpl) return overrides.finalizeImpl();
      return {
        commercialOpportunityId: "opp-1",
        salesQuoteId: "quote-1",
        salesQuoteVersionId: "version-1",
      };
    },
    reconcileSentQuoteSendMessages: async () => {
      calls.reconcile += 1;
      return overrides?.reconcileResults ?? [];
    },
  });
  return { calls, process };
}

const tests: TestCase[] = [

  {
    name: "Meta HTTP retry classification keeps transient failures retryable and terminal 4xx final",
    run: () => {
      for (const status of [408, 429, 500, 502, 503, 599]) {
        assert.equal(isRetryableWhatsappHttpStatus(status), true, `status ${status}`);
      }
      for (const status of [400, 401, 403, 404, 409, 422]) {
        assert.equal(isRetryableWhatsappHttpStatus(status), false, `status ${status}`);
      }
    },
  },
  {
    name: "happy path reconciles first, claims once, sends once and finalizes inline",
    run: async () => {
      const harness = createHarness();
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1", limit: 10 });
      assert.equal(harness.calls.reconcile, 1);
      assert.equal(result.sent, 1);
      assert.equal(result.failed, 0);
      assert.equal(result.retryable, 0);
      assert.equal(result.uncertain, 0);
      assert.equal(harness.calls.integration, 1);
      assert.deepEqual(harness.calls.markSent, [
        { messageId: "message-1", externalMessageId: "wamid-1" },
      ]);
      assert.match(String(result.results.at(-1)?.detail || ""), /finalizacao comercial concluida/);
    },
  },
  {
    name: "reconciliation does not require Meta integration when there is no outbound pending",
    run: async () => {
      const harness = createHarness({
        pending: [],
        reconcileResults: [
          { messageId: "message-sent-1", detail: "finalizacao comercial reconciliada sem novo POST externo" },
        ],
        integrationImpl: async () => {
          throw new Error("Meta indisponivel");
        },
      });
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });
      assert.equal(harness.calls.integration, 0);
      assert.equal(harness.calls.send.length, 0);
      assert.equal(result.results[0]?.messageId, "message-sent-1");
    },
  },
  {
    name: "cross-tenant row is refused before claim or Meta integration",
    run: async () => {
      const harness = createHarness({ pending: [createMessage({ storeId: "store-OTHER" })] });
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });
      assert.equal(harness.calls.claim.length, 0);
      assert.equal(harness.calls.integration, 0);
      assert.equal(harness.calls.send.length, 0);
      assert.equal(result.results.at(-1)?.status, "skipped");
      assert.match(String(result.results.at(-1)?.detail || ""), /divergencia/);
    },
  },
  {
    name: "second worker losing claim does not send a second POST",
    run: async () => {
      const harness = createHarness({ claimResults: [false] });
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });
      assert.equal(harness.calls.send.length, 0);
      assert.equal(harness.calls.integration, 0);
      assert.equal(result.results.at(-1)?.status, "skipped");
    },
  },
  {
    name: "preflight failure releases scoped claim and remains retryable without attempt",
    run: async () => {
      const harness = createHarness({
        prepareImpl: async () => {
          throw new Error("signed url unavailable");
        },
      });
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });
      assert.equal(harness.calls.attemptStarted.length, 0);
      assert.deepEqual(harness.calls.release, [
        { messageId: "message-1", org: "org-1", store: "store-1", errorText: "signed url unavailable" },
      ]);
      assert.equal(result.retryable, 1);
      assert.equal(result.results.at(-1)?.status, "retryable");
    },
  },
  {
    name: "unknown error after attempt start becomes uncertain and is never released",
    run: async () => {
      const harness = createHarness({
        sendImpl: async () => {
          throw new Error("network timeout");
        },
      });
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });
      assert.equal(harness.calls.release.length, 0);
      assert.deepEqual(harness.calls.uncertain, [
        { messageId: "message-1", errorText: "network timeout", providerMessageId: null },
      ]);
      assert.equal(result.uncertain, 1);
      assert.equal(result.results.at(-1)?.status, "uncertain");
    },
  },
  {
    name: "known provider id is preserved in uncertain handling if source-fact persistence fails",
    run: async () => {
      const harness = createHarness({
        sendImpl: async () => "wamid-known",
        markSentImpl: async () => {
          throw new Error("database write failed");
        },
      });
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });
      assert.deepEqual(harness.calls.uncertain, [
        {
          messageId: "message-1",
          errorText: "database write failed",
          providerMessageId: "wamid-known",
        },
      ]);
      assert.equal(result.results.at(-1)?.whatsappMessageId, "wamid-known");
      assert.equal(result.uncertain, 1);
    },
  },
  {
    name: "commercial finalization failure preserves sent result and records reconciliation pending",
    run: async () => {
      const harness = createHarness({
        finalizeImpl: async () => {
          throw new Error("projection failed");
        },
      });
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });
      assert.equal(result.sent, 1);
      assert.deepEqual(harness.calls.markSent, [
        { messageId: "message-1", externalMessageId: "wamid-1" },
      ]);
      assert.deepEqual(harness.calls.commercialPending, [
        { messageId: "message-1", errorText: "projection failed" },
      ]);
      assert.match(String(result.results.at(-1)?.detail || ""), /pendente para reconciliacao/);
    },
  },
  {
    name: "document messages are eligible for the processing contract",
    run: async () => {
      const harness = createHarness({
        pending: [
          createMessage({
            rawMessageType: "document",
            messageType: "document",
            mediaUrl: "org-1/store-1/sales-quotes/quote-1/v1.pdf",
            metadata: {
              external_channel: "whatsapp",
              send_external: true,
              outbound_origin: "sales_quote_send",
              commercial_opportunity_id: "opp-1",
              sales_quote_id: "quote-1",
              sales_quote_version_id: "version-1",
              storage_bucket: "zion-store-files",
              storage_path: "org-1/store-1/sales-quotes/quote-1/v1.pdf",
              mime_type: "application/pdf",
              original_file_name: "orc-001-v0001.pdf",
            },
          }),
        ],
        prepareImpl: async () => ({
          mode: "document",
          to: "5511999999999",
          documentUrl: "https://signed.example/pdf",
          filename: "orc-001-v0001.pdf",
          caption: "Segue o orcamento",
        }),
      });
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });
      assert.equal(harness.calls.send.length, 1);
      assert.equal(result.sent, 1);
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
