import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createProcessWhatsappPendingMessages,
  isRetryableWhatsappHttpStatus,
  preparePendingMessageForSend,
  sendSinglePendingMessage,
} from "./whatsapp-external-sender";

type TestCase = { name: string; run: () => Promise<void> | void };

type MessageOverrides = Partial<Record<string, unknown>>;
const senderPath = join(process.cwd(), "src/lib/server/whatsapp-external-sender.ts");

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

function createContractReconciliationRow(overrides?: MessageOverrides) {
  return {
    id: "contract-message-1",
    organization_id: "org-1",
    store_id: "store-1",
    metadata: {
      outbound_origin: "sales_contract_send",
      sales_contract_id: "contract-1",
      sales_contract_version_id: "contract-version-1",
    },
    external_message_id: "wamid-contract-1",
    outbound_delivery_state: "sent",
    outbound_provider_accepted_at: "2026-10-09T12:00:00.000Z",
    outbound_commercial_finalized_at: null,
    deleted_at: null,
    ...overrides,
  };
}

function createHarness(overrides?: {
  pending?: Array<Record<string, unknown>>;
  claimResults?: boolean[];
  prepareImpl?: () => Promise<Record<string, unknown>>;
  preflightImpl?: () => Promise<{
    ok: true;
    decision: "send" | "blocked" | "template_required";
    reason: string;
  }>;
  sendImpl?: () => Promise<string>;
  markSentImpl?: () => Promise<void>;
  gateImpl?: () => Promise<{
    ok: true;
    decision: "send" | "blocked" | "template_required";
    reason: string;
  }>;
  contractGateImpl?: () => Promise<{
    ok: true;
    decision: "send" | "blocked" | "template_required";
    reason: string;
  }>;
  finalizeImpl?: () => Promise<{
    commercialOpportunityId: string;
    salesQuoteId: string;
    salesQuoteVersionId: string;
  } | null>;
  contractFinalizeImpl?: () => Promise<{ salesContractId: string; salesContractVersionId: string } | null>;
  contractReconciliationRows?: Array<Record<string, unknown>>;
  contractReconciliationError?: string;
  contractReconciliationFinalizeError?: string;
  contractReconciliationPendingError?: string;
  reconcileResults?: Array<{ messageId: string; detail: string }>;
  integrationImpl?: () => Promise<{ accessToken: string; phoneNumberId: string }>;
  templateCandidates?: Array<{
    message: Record<string, unknown>;
    templateAction: "followup_offer" | "followup_visit";
  }>;
  templateClaimImpl?: () => Promise<{
    claimed: boolean;
    reason: string;
    templateAction: "followup_offer" | "followup_visit" | null;
  }>;
  templateGateImpl?: () => Promise<{
    ok: true;
    decision: "send" | "blocked";
    reason: string;
  }>;
  templateSendImpl?: () => Promise<string>;
}) {
  const calls = {
    integration: 0,
    preflight: [] as string[],
    gate: [] as string[],
    contractGate: [] as string[],
    order: [] as string[],
    claim: [] as string[],
    templateRead: 0,
    templateClaim: [] as Array<{ messageId: string; templateAction: string }>,
    templateRelease: [] as Array<{ messageId: string; errorText: string | null }>,
    templateGate: [] as Array<{ messageId: string; templateAction: string }>,
    templateSend: [] as Array<{ messageId: string; templateAction: string }>,
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
    contractFinalize: [] as string[],
    contractFinalizeScopes: [] as Array<{ messageId: string; organizationId: string; storeId: string }>,
    contractFinalizeRpc: [] as Array<{ name: string; payload: Record<string, unknown> }>,
    reconciliationUpdates: [] as Array<{ table: string; payload: Record<string, unknown>; operations: string[] }>,
    reconcile: 0,
    contractReconcileFrom: [] as Array<{ table: string; operations: string[] }>,
  };
  const claimQueue = [...(overrides?.claimResults ?? [true])];
  const pending = overrides?.pending ?? [createMessage()];
  let contractReconciliationRows = [...(overrides?.contractReconciliationRows ?? [])];
  let contractReconciliationFinalizeError = overrides?.contractReconciliationFinalizeError;
  const supabase = {
    from(table: string) {
      const operations: string[] = [];
      calls.contractReconcileFrom.push({ table, operations });
      let organizationId: string | null = null;
      let storeId: string | null = null;
      const query = {
        select: () => {
          operations.push("select");
          return query;
        },
        eq: (column: string, value: unknown) => {
          operations.push(`eq:${column}=${String(value)}`);
          if (column === "organization_id" && typeof value === "string") organizationId = value;
          if (column === "store_id" && typeof value === "string") storeId = value;
          return query;
        },
        contains: (column: string, value: unknown) => {
          void value;
          operations.push(`contains:${column}`);
          return query;
        },
        not: (column: string, operator: string, value: unknown) => {
          operations.push(`not:${column}:${operator}:${String(value)}`);
          return query;
        },
        is: (column: string, value: unknown) => {
          operations.push(`is:${column}:${String(value)}`);
          return query;
        },
        limit: (value: number) => {
          operations.push(`limit:${value}`);
          return query;
        },
        update: (payload: Record<string, unknown>) => {
          operations.push("update");
          calls.reconciliationUpdates.push({ table, payload, operations });
          return query;
        },
        maybeSingle: async () => overrides?.contractReconciliationPendingError
          ? { data: null, error: { message: overrides.contractReconciliationPendingError } }
          : { data: { id: "contract-message-1" }, error: null },
        then: (
          resolve: (value: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }) => unknown,
        ) => {
          if (overrides?.contractReconciliationError) {
            return Promise.resolve(resolve({
              data: null,
              error: { message: overrides.contractReconciliationError },
            }));
          }
          const rows = table === "messages"
            ? contractReconciliationRows.filter((row) =>
                row.organization_id === organizationId &&
                row.store_id === storeId &&
                row.outbound_delivery_state === "sent" &&
                row.external_message_id != null &&
                row.outbound_provider_accepted_at != null &&
                row.outbound_commercial_finalized_at == null &&
                row.deleted_at == null &&
                (row.metadata as Record<string, unknown> | null)?.outbound_origin === "sales_contract_send"
              )
            : [];
          return Promise.resolve(resolve({ data: rows, error: null }));
        },
      };
      return query;
    },
    rpc: async (name: string, payload: Record<string, unknown>) => {
      calls.contractFinalizeRpc.push({ name, payload });
      if (name === "finalize_sales_contract_send_by_system") {
        if (contractReconciliationFinalizeError) {
          return {
            data: null,
            error: { message: contractReconciliationFinalizeError },
          };
        }
        const row = contractReconciliationRows.find((candidate) => candidate.id === payload.p_message_id);
        return {
          data: {
            sales_contract_id: payload.p_contract_id,
            sales_contract_version_id: payload.p_contract_version_id,
            message_id: payload.p_message_id,
            external_message_id: row?.external_message_id ?? "wamid-contract-1",
            sent_at: "2026-10-09T12:00:00.000Z",
            conversation_event_created: false,
            outcome: "finalized",
          },
          error: null,
        };
      }
      return { data: null, error: { message: `unexpected RPC ${name}` } };
    },
  };

  const process = createProcessWhatsappPendingMessages({
    createSupabaseAdmin: () => supabase as never,
    getWhatsappIntegration: async () => {
      calls.integration += 1;
      calls.order.push("STRICT INTEGRATION");
      if (overrides?.integrationImpl) return overrides.integrationImpl();
      return { accessToken: "token", phoneNumberId: "phone-number-id" };
    },
    getPendingExternalMessages: async () => pending as never,
    getTemplateRequiredCanonicalFollowups: async () => {
      calls.templateRead += 1;
      return (overrides?.templateCandidates ?? []) as never;
    },
    claimTemplateRequiredCanonicalFollowup: async (_supabase, candidate) => {
      calls.templateClaim.push({
        messageId: candidate.message.id,
        templateAction: candidate.templateAction,
      });
      calls.order.push("TEMPLATE CLAIM");
      if (overrides?.templateClaimImpl) return overrides.templateClaimImpl() as never;
      return {
        claimed: true,
        reason: "claimed",
        templateAction: candidate.templateAction,
      };
    },
    releaseTemplateClaimedMessage: async (_supabase, message, errorText) => {
      calls.templateRelease.push({ messageId: message.id, errorText });
      calls.order.push("TEMPLATE RELEASE");
    },
    validateOrCancelWhatsappTemplateFollowupSend: async (_supabase, message, templateAction) => {
      calls.templateGate.push({ messageId: message.id, templateAction });
      calls.order.push("TEMPLATE FINAL SQL GATE");
      if (overrides?.templateGateImpl) return overrides.templateGateImpl() as never;
      return { ok: true, decision: "send" as const, reason: "authorized" as const };
    },
    sendCanonicalFollowupTemplate: async (_integration, message, templateAction) => {
      calls.templateSend.push({ messageId: message.id, templateAction });
      calls.order.push("POST META TEMPLATE");
      if (overrides?.templateSendImpl) return overrides.templateSendImpl();
      return "wamid-template-1";
    },
    claimMessageForExternalSend: async (_supabase, message) => {
      calls.claim.push(message.id);
      calls.order.push("CLAIM");
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
    validateOrCancelWhatsappExternalSend: async (_supabase, message) => {
      calls.gate.push(message.id);
      calls.order.push("FINAL SQL GATE");
      if (overrides?.gateImpl) return overrides.gateImpl() as never;
      return { ok: true, decision: "send", reason: "authorized" };
    },
    validateSalesContractSendBeforeExternal: async () => {
      calls.contractGate.push("contract");
      calls.order.push("CONTRACT ATOMIC GATE");
      if (overrides?.contractGateImpl) return overrides.contractGateImpl() as never;
      return { ok: true, decision: "send" as const, reason: "authorized" };
    },
    readCustomerWhatsapp24hWindow: async (_supabase, message) => {
      calls.preflight.push(message.id);
      calls.order.push("PREFLIGHT 24H");
      if (overrides?.preflightImpl) return overrides.preflightImpl();
      return {
        ok: true,
        decision: "send" as const,
        reason: "P19A_CUSTOMER_WHATSAPP_24H_WINDOW_OPEN",
      };
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
      calls.order.push("PREPARE");
      if (overrides?.prepareImpl) return (await overrides.prepareImpl()) as never;
      return { mode: "text" as const, to: "5511999999999", body: "Segue o orcamento" };
    },
    sendSinglePendingMessage: async () => {
      calls.send.push("send");
      calls.order.push("POST META");
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
    finalizeSalesContractSendMessageIfNeeded: async (_supabase, message) => {
      calls.contractFinalize.push(message.id);
      calls.contractFinalizeScopes.push({
        messageId: message.id,
        organizationId: message.organizationId,
        storeId: message.storeId,
      });
      if (overrides?.contractFinalizeImpl) return overrides.contractFinalizeImpl();
      return null;
    },
    reconcileSentQuoteSendMessages: async () => {
      calls.reconcile += 1;
      return overrides?.reconcileResults ?? [];
    },
  });
  return {
    calls,
    process,
    setContractReconciliationRows(rows: Array<Record<string, unknown>>) {
      contractReconciliationRows = [...rows];
    },
    setContractReconciliationFinalizeError(error: string | undefined) {
      contractReconciliationFinalizeError = error;
    },
  };
}

const tests: TestCase[] = [

  {
    name: "contract send uses one atomic contract gate instead of the generic gate",
    run: async () => {
      const message = createMessage({
        metadata: {
          external_channel: "whatsapp",
          send_external: true,
          outbound_origin: "sales_contract_send",
          sales_contract_id: "contract-1",
          sales_contract_version_id: "version-1",
        },
        messageType: "document",
        rawMessageType: "document",
        mediaUrl: "contract.pdf",
      });
      const harness = createHarness({
        pending: [message],
        prepareImpl: async () => ({
          mode: "document",
          to: "5511999999999",
          documentUrl: "https://example.test/contract.pdf",
          filename: "contract.pdf",
          caption: "Segue",
        }),
      });
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });
      assert.equal(result.sent, 1);
      assert.deepEqual(harness.calls.gate, []);
      assert.deepEqual(harness.calls.contractGate, ["contract"]);
      assert.deepEqual(harness.calls.order, [
        "CLAIM",
        "PREFLIGHT 24H",
        "PREPARE",
        "STRICT INTEGRATION",
        "CONTRACT ATOMIC GATE",
        "POST META",
      ]);
    },
  },

  {
    name: "contract send finalization runs after provider acceptance without another POST",
    run: async () => {
      const message = createMessage({
        metadata: {
          external_channel: "whatsapp",
          send_external: true,
          outbound_origin: "sales_contract_send",
          sales_contract_id: "contract-1",
          sales_contract_version_id: "version-1",
        },
        outboundIdempotencyKey: "sales_contract_send:org-1:store-1:contract-1:version-1",
        messageType: "document",
        rawMessageType: "document",
        mediaUrl: "contract.pdf",
      });
      const harness = createHarness({
        pending: [message],
        prepareImpl: async () => ({ mode: "document", to: "5511999999999", documentUrl: "https://example.test/contract.pdf", filename: "contract.pdf", caption: "Segue" }),
        finalizeImpl: async () => null,
        contractFinalizeImpl: async () => ({ salesContractId: "contract-1", salesContractVersionId: "version-1" }),
      });
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1", limit: 1 });
      assert.equal(result.sent, 1);
      assert.deepEqual(harness.calls.send, ["send"]);
      assert.deepEqual(harness.calls.contractFinalize, ["message-1"]);
    },
  },

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
      assert.deepEqual(harness.calls.order, [
        "CLAIM",
        "PREFLIGHT 24H",
        "PREPARE",
        "STRICT INTEGRATION",
        "FINAL SQL GATE",
        "POST META",
      ]);
      assert.deepEqual(harness.calls.attemptStarted, []);
      assert.deepEqual(harness.calls.markSent, [
        { messageId: "message-1", externalMessageId: "wamid-1" },
      ]);
      assert.match(String(result.results.at(-1)?.detail || ""), /finalizacao comercial concluida/);
    },
  },
  {
    name: "audio and video resolve private media and use Meta media payloads",
    run: async () => {
      const originalFetch = globalThis.fetch;
      const payloads: Array<Record<string, unknown>> = [];
      globalThis.fetch = async (_input, init) => {
        payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: `wamid-${payloads.length}` }] }),
        } as Response;
      };

      try {
        for (const messageType of ["audio", "video"] as const) {
          const message = createMessage({
            id: `message-${messageType}`,
            messageType,
            rawMessageType: messageType,
            content: messageType === "video" ? "Legenda canônica" : "Áudio manual",
            mediaUrl: `org-1/store-1/manual-attachments/conv-1/${messageType}.bin`,
            metadata: {
              external_channel: "whatsapp",
              send_external: true,
              outbound_origin: `crm_manual_${messageType}`,
              storage_bucket: "zion-store-files",
              storage_path: `org-1/store-1/manual-attachments/conv-1/${messageType}.bin`,
            },
          });
          const prepared = await preparePendingMessageForSend(
            {
              storage: {
                from: () => ({
                  createSignedUrl: async (path: string) => ({
                    data: { signedUrl: `https://signed.example/${path}` },
                    error: null,
                  }),
                }),
              },
            } as never,
            message as never,
          );

          if (messageType === "audio") {
            assert.deepEqual(prepared, {
              mode: "audio",
              to: "5511999999999",
              audioUrl: "https://signed.example/org-1/store-1/manual-attachments/conv-1/audio.bin",
            });
          } else {
            assert.deepEqual(prepared, {
              mode: "video",
              to: "5511999999999",
              videoUrl: "https://signed.example/org-1/store-1/manual-attachments/conv-1/video.bin",
              caption: "Legenda canônica",
            });
          }

          await sendSinglePendingMessage(
            { accessToken: "token", phoneNumberId: "phone-number-id" },
            prepared,
          );
        }
      } finally {
        globalThis.fetch = originalFetch;
      }

      assert.deepEqual(payloads, [
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: "5511999999999",
          type: "audio",
          audio: { link: "https://signed.example/org-1/store-1/manual-attachments/conv-1/audio.bin" },
        },
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: "5511999999999",
          type: "video",
          video: {
            link: "https://signed.example/org-1/store-1/manual-attachments/conv-1/video.bin",
            caption: "Legenda canônica",
          },
        },
      ]);
    },
  },
  {
    name: "audio uses the 24h gate before the Meta POST",
    run: async () => {
      const harness = createHarness({
        pending: [
          createMessage({
            messageType: "audio",
            rawMessageType: "audio",
            mediaUrl: "org-1/store-1/manual-attachments/conv-1/audio.mp3",
            metadata: {
              external_channel: "whatsapp",
              send_external: true,
              outbound_origin: "crm_manual_audio",
              storage_bucket: "zion-store-files",
              storage_path: "org-1/store-1/manual-attachments/conv-1/audio.mp3",
            },
          }),
        ],
        prepareImpl: async () => ({
          mode: "audio",
          to: "5511999999999",
          audioUrl: "https://signed.example/audio.mp3",
        }),
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });
      assert.equal(result.sent, 1);
      assert.deepEqual(harness.calls.order, [
        "CLAIM",
        "PREFLIGHT 24H",
        "PREPARE",
        "STRICT INTEGRATION",
        "FINAL SQL GATE",
        "POST META",
      ]);
    },
  },
  {
    name: "source uses strict WhatsApp integration reader and not legacy integration RPC",
    run: () => {
      const source = readFileSync(senderPath, "utf8");
      const readerStart = source.indexOf("async function getWhatsappIntegration(");
      const readerEnd = source.indexOf("async function getPendingExternalMessages(", readerStart);
      assert.equal(readerStart > -1, true);
      assert.equal(readerEnd > readerStart, true);
      const readerBlock = source.slice(readerStart, readerEnd);

      assert.equal(readerBlock.includes('"get_active_whatsapp_integration_for_external_send_by_system"'), true);
      assert.equal(readerBlock.includes('"get_whatsapp_integration"'), false);
      assert.equal(readerBlock.includes("rows.length !== 1"), true);
      assert.equal(readerBlock.includes("phoneNumberId"), true);
      assert.equal(readerBlock.indexOf("const phoneNumberId") > -1, true);
      assert.equal(readerBlock.indexOf("const accessToken") > readerBlock.indexOf("const phoneNumberId"), true);
    },
  },
  {
    name: "source preserves env token fallback only after strict integration row is proven",
    run: () => {
      const source = readFileSync(senderPath, "utf8");

      assert.equal(source.includes("const integrationToken = integration?.access_token?.trim() || \"\";"), true);
      assert.equal(source.includes("if (integrationToken) return integrationToken;"), true);
      assert.equal(source.includes("META_WHATSAPP_ACCESS_TOKEN?.trim()"), true);
      assert.equal(source.includes("rows.length !== 1"), true);
      assert.equal(source.includes("if (!phoneNumberId) throw new Error(\"Integracao WhatsApp sem phone_number_id\")"), true);
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
    name: "real contract reconciliation finalizes an already sent message without a new POST",
    run: async () => {
      const harness = createHarness({
        pending: [],
        contractReconciliationRows: [createContractReconciliationRow()],
        contractFinalizeImpl: async () => ({
          salesContractId: "contract-1",
          salesContractVersionId: "contract-version-1",
        }),
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.equal(harness.calls.contractReconcileFrom.length, 1);
      assert.deepEqual(harness.calls.contractFinalizeRpc, [{
        name: "finalize_sales_contract_send_by_system",
        payload: {
          p_organization_id: "org-1",
          p_store_id: "store-1",
          p_contract_id: "contract-1",
          p_contract_version_id: "contract-version-1",
          p_message_id: "contract-message-1",
          p_idempotency_key: "sales_contract_send:org-1:store-1:contract-1:contract-version-1",
          p_source: "system_sales_contract_send_reconciliation",
        },
      }]);
      assert.deepEqual(harness.calls.send, []);
      assert.equal(harness.calls.integration, 0);
      assert.equal(result.sent, 0);
      assert.equal(result.results[0]?.messageId, "contract-message-1");
      assert.match(String(result.results[0]?.detail || ""), /sem novo POST externo/);
      assert.deepEqual(harness.calls.contractReconcileFrom[0]?.operations, [
        "select",
        "eq:organization_id=org-1",
        "eq:store_id=store-1",
        "eq:outbound_delivery_state=sent",
        "contains:metadata",
        "not:external_message_id:is:null",
        "not:outbound_provider_accepted_at:is:null",
        "is:outbound_commercial_finalized_at:null",
        "is:deleted_at:null",
        "limit:20",
      ]);
    },
  },
  {
    name: "contract reconciliation read failure does not cause an external resend",
    run: async () => {
      const harness = createHarness({
        pending: [],
        contractReconciliationError: "database unavailable",
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.equal(harness.calls.contractReconcileFrom.length, 1);
      assert.deepEqual(harness.calls.contractFinalize, []);
      assert.deepEqual(harness.calls.send, []);
      assert.equal(harness.calls.integration, 0);
      assert.equal(result.sent, 0);
      assert.equal(result.processed, 0);
    },
  },
  {
    name: "contract finalization failure records reconciliation pending without a new POST",
    run: async () => {
      const harness = createHarness({
        pending: [],
        contractReconciliationRows: [createContractReconciliationRow()],
        contractReconciliationFinalizeError: "contract projection unavailable",
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.deepEqual(harness.calls.contractFinalizeRpc.map((call) => call.name), [
        "finalize_sales_contract_send_by_system",
      ]);
      assert.equal(harness.calls.reconciliationUpdates.length, 1);
      assert.equal(
        harness.calls.reconciliationUpdates[0]?.payload.outbound_commercial_error_text,
        "Nao foi possivel finalizar o envio canonico do contrato.",
      );
      assert.deepEqual(harness.calls.send, []);
      assert.equal(harness.calls.integration, 0);
      assert.equal(result.sent, 0);
    },
  },
  {
    name: "a second worker run after contract reconciliation does not create a duplicate POST",
    run: async () => {
      const harness = createHarness({
        pending: [],
        contractReconciliationRows: [createContractReconciliationRow()],
        contractReconciliationFinalizeError: "temporary finalization failure",
      });

      await harness.process({ organizationId: "org-1", storeId: "store-1" });
      assert.equal(harness.calls.reconciliationUpdates.length, 1);
      harness.setContractReconciliationFinalizeError(undefined);
      await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.deepEqual(harness.calls.contractFinalizeRpc.map((call) => call.payload.p_message_id), [
        "contract-message-1",
        "contract-message-1",
      ]);
      assert.deepEqual(harness.calls.send, []);
      assert.equal(harness.calls.integration, 0);
      assert.equal(harness.calls.contractReconcileFrom.length, 3);
      assert.equal(harness.calls.reconciliationUpdates.length, 1);
    },
  },
  {
    name: "failure recording reconciliation pending remains fail-safe without a blind resend",
    run: async () => {
      const harness = createHarness({
        pending: [],
        contractReconciliationRows: [createContractReconciliationRow()],
        contractReconciliationFinalizeError: "finalization unavailable",
        contractReconciliationPendingError: "pending marker unavailable",
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.equal(harness.calls.contractFinalizeRpc.length, 1);
      assert.equal(harness.calls.reconciliationUpdates.length, 1);
      assert.deepEqual(harness.calls.send, []);
      assert.equal(harness.calls.integration, 0);
      assert.equal(result.sent, 0);
    },
  },
  {
    name: "contract reconciliation preserves organization and store isolation",
    run: async () => {
      const harness = createHarness({
        pending: [],
        contractReconciliationRows: [
          createContractReconciliationRow({
            id: "foreign-contract-message",
            organization_id: "org-foreign",
            store_id: "store-foreign",
          }),
        ],
        contractFinalizeImpl: async () => ({
          salesContractId: "contract-foreign",
          salesContractVersionId: "contract-version-foreign",
        }),
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.deepEqual(harness.calls.contractFinalize, []);
      assert.deepEqual(harness.calls.send, []);
      assert.equal(harness.calls.integration, 0);
      assert.equal(result.sent, 0);
      assert.equal(harness.calls.contractReconcileFrom[0]?.operations.includes("eq:organization_id=org-1"), true);
      assert.equal(harness.calls.contractReconcileFrom[0]?.operations.includes("eq:store_id=store-1"), true);
    },
  },
  {
    name: "contract reconciliation excludes rows without sent state or provider evidence",
    run: async () => {
      const harness = createHarness({
        pending: [],
        contractReconciliationRows: [
          createContractReconciliationRow({
            id: "missing-external-id",
            external_message_id: null,
          }),
          createContractReconciliationRow({
            id: "not-sent",
            outbound_delivery_state: "pending",
          }),
          createContractReconciliationRow({
            id: "missing-provider-acceptance",
            outbound_provider_accepted_at: null,
          }),
        ],
        contractFinalizeImpl: async () => ({
          salesContractId: "contract-1",
          salesContractVersionId: "contract-version-1",
        }),
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.deepEqual(harness.calls.contractFinalize, []);
      assert.deepEqual(harness.calls.send, []);
      assert.equal(harness.calls.integration, 0);
      assert.equal(result.sent, 0);
      assert.equal(harness.calls.contractReconcileFrom[0]?.operations.includes("eq:outbound_delivery_state=sent"), true);
      assert.equal(harness.calls.contractReconcileFrom[0]?.operations.includes("not:external_message_id:is:null"), true);
      assert.equal(harness.calls.contractReconcileFrom[0]?.operations.includes("not:outbound_provider_accepted_at:is:null"), true);
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
      assert.deepEqual(harness.calls.attemptStarted, []);
      assert.deepEqual(harness.calls.uncertain, [
        { messageId: "message-1", errorText: "network timeout", providerMessageId: null },
      ]);
      assert.equal(result.uncertain, 1);
      assert.equal(result.results.at(-1)?.status, "uncertain");
    },
  },
  {
    name: "template_required preserves the outbound without preparing media or posting",
    run: async () => {
      const harness = createHarness({
        preflightImpl: async () => ({
          ok: true,
          decision: "template_required",
          reason: "P19A_CUSTOMER_WHATSAPP_24H_WINDOW_CLOSED",
        }),
        gateImpl: async () => ({
          ok: true,
          decision: "template_required",
          reason: "P19A_CUSTOMER_WHATSAPP_24H_WINDOW_CLOSED",
        }),
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.deepEqual(harness.calls.order, ["CLAIM", "PREFLIGHT 24H", "FINAL SQL GATE"]);
      assert.equal(harness.calls.prepared.length, 0);
      assert.equal(harness.calls.integration, 0);
      assert.equal(harness.calls.send.length, 0);
      assert.equal(harness.calls.release.length, 0);
      assert.equal(harness.calls.uncertain.length, 0);
      assert.equal(result.templateRequired, 1);
      assert.equal(result.results.at(-1)?.status, "template_required");
    },
  },
  {
    name: "gate blocked decision does not POST, release, mark attempt, or mark failed again",
    run: async () => {
      const harness = createHarness({
        preflightImpl: async () => ({
          ok: true,
          decision: "blocked",
          reason: "commercial_opportunity_opted_out",
        }),
        gateImpl: async () => ({
          ok: true,
          decision: "blocked",
          reason: "commercial_opportunity_opted_out",
        }),
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.deepEqual(harness.calls.order, [
        "CLAIM",
        "PREFLIGHT 24H",
        "FINAL SQL GATE",
      ]);
      assert.deepEqual(harness.calls.send, []);
      assert.deepEqual(harness.calls.release, []);
      assert.deepEqual(harness.calls.attemptStarted, []);
      assert.deepEqual(harness.calls.failed, []);
      assert.equal(result.failed, 1);
      assert.equal(result.results.at(-1)?.status, "failed");
      assert.equal(
        result.results.at(-1)?.detail,
        "ZION_EXTERNAL_SEND_BLOCKED:commercial_opportunity_opted_out",
      );
    },
  },
  {
    name: "technical gate failure before send releases claim as pre-attempt retryable",
    run: async () => {
      const harness = createHarness({
        gateImpl: async () => {
          throw new Error("gate rpc unavailable");
        },
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.deepEqual(harness.calls.order, [
        "CLAIM",
        "PREFLIGHT 24H",
        "PREPARE",
        "STRICT INTEGRATION",
        "FINAL SQL GATE",
      ]);
      assert.deepEqual(harness.calls.send, []);
      assert.deepEqual(harness.calls.release, [
        { messageId: "message-1", org: "org-1", store: "store-1", errorText: "gate rpc unavailable" },
      ]);
      assert.equal(result.retryable, 1);
    },
  },
  {
    name: "integration failure before final window gate does not POST and releases claim",
    run: async () => {
      const harness = createHarness({
        integrationImpl: async () => {
          throw new Error("strict integration missing");
        },
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.deepEqual(harness.calls.order, [
        "CLAIM",
        "PREFLIGHT 24H",
        "PREPARE",
        "STRICT INTEGRATION",
      ]);
      assert.deepEqual(harness.calls.gate, []);
      assert.deepEqual(harness.calls.send, []);
      assert.deepEqual(harness.calls.release, [
        { messageId: "message-1", org: "org-1", store: "store-1", errorText: "strict integration missing" },
      ]);
      assert.equal(result.retryable, 1);
    },
  },
  {
    name: "known provider failure after gate remains uncertain and is not retried blindly",
    run: async () => {
      const harness = createHarness({
        sendImpl: async () => {
          throw Object.assign(new Error("Meta 503"), {
            name: "KnownWhatsappSendFailure",
            retryable: true,
            httpStatus: 503,
          });
        },
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.deepEqual(harness.calls.order, [
        "CLAIM",
        "PREFLIGHT 24H",
        "PREPARE",
        "STRICT INTEGRATION",
        "FINAL SQL GATE",
        "POST META",
      ]);
      assert.deepEqual(harness.calls.retryable, []);
      assert.deepEqual(harness.calls.release, []);
      assert.deepEqual(harness.calls.uncertain, [
        { messageId: "message-1", errorText: "Meta 503", providerMessageId: null },
      ]);
      assert.equal(result.uncertain, 1);
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
  {
    name: "customer offer follow-up uses the canonical template path and never free-form POST",
    run: async () => {
      const message = createMessage({
        id: "template-offer-1",
        outboundDeliveryState: "template_required",
        metadata: {
          external_channel: "whatsapp",
          send_external: true,
          outbound_kind: "canonical_followup",
          outbound_origin: "canonical_followup",
        },
      });
      const harness = createHarness({
        pending: [],
        templateCandidates: [{ message, templateAction: "followup_offer" }],
      });
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });
      assert.deepEqual(harness.calls.order, [
        "TEMPLATE CLAIM",
        "STRICT INTEGRATION",
        "TEMPLATE FINAL SQL GATE",
        "POST META TEMPLATE",
      ]);
      assert.deepEqual(harness.calls.templateSend, [
        { messageId: "template-offer-1", templateAction: "followup_offer" },
      ]);
      assert.deepEqual(harness.calls.send, []);
      assert.deepEqual(harness.calls.markSent, [
        { messageId: "template-offer-1", externalMessageId: "wamid-template-1" },
      ]);
      assert.equal(result.sent, 1);
      assert.equal(result.processed, 1);
    },
  },
  {
    name: "customer visit follow-up preserves the canonical visit template action",
    run: async () => {
      const message = createMessage({
        id: "template-visit-1",
        outboundDeliveryState: "template_required",
        metadata: {
          external_channel: "whatsapp",
          send_external: true,
          outbound_kind: "canonical_followup",
          outbound_origin: "canonical_followup",
        },
      });
      const harness = createHarness({
        pending: [],
        templateCandidates: [{ message, templateAction: "followup_visit" }],
      });
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });
      assert.deepEqual(harness.calls.templateGate, [
        { messageId: "template-visit-1", templateAction: "followup_visit" },
      ]);
      assert.deepEqual(harness.calls.templateSend, [
        { messageId: "template-visit-1", templateAction: "followup_visit" },
      ]);
      assert.equal(result.sent, 1);
    },
  },
  {
    name: "template claim lost skips without POST",
    run: async () => {
      const message = createMessage({
        id: "template-claim-lost-1",
        outboundDeliveryState: "template_required",
        metadata: {
          external_channel: "whatsapp",
          send_external: true,
          outbound_kind: "canonical_followup",
          outbound_origin: "canonical_followup",
        },
      });
      const harness = createHarness({
        pending: [],
        templateCandidates: [{ message, templateAction: "followup_offer" }],
        templateClaimImpl: async () => ({
          claimed: false,
          reason: "already_claimed",
          templateAction: null,
        }),
      });
      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.deepEqual(harness.calls.templateSend, []);
      assert.deepEqual(harness.calls.templateGate, []);
      assert.equal(result.sent, 0);
      assert.equal(result.results.at(-1)?.status, "skipped");
      assert.match(String(result.results.at(-1)?.detail || ""), /already_claimed/);
    },
  },
  {
    name: "template final gate blocked prevents POST",
    run: async () => {
      const message = createMessage({
        id: "template-blocked-1",
        outboundDeliveryState: "template_required",
        metadata: {
          external_channel: "whatsapp",
          send_external: true,
          outbound_kind: "canonical_followup",
          outbound_origin: "canonical_followup",
        },
      });
      const harness = createHarness({
        pending: [],
        templateCandidates: [{ message, templateAction: "followup_offer" }],
        templateGateImpl: async () => ({
          ok: true,
          decision: "blocked",
          reason: "followup_no_longer_authorized",
        }),
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.deepEqual(harness.calls.templateSend, []);
      assert.deepEqual(harness.calls.uncertain, []);
      assert.equal(result.failed, 1);
      assert.equal(result.sent, 0);
      assert.equal(result.results.at(-1)?.status, "failed");
      assert.match(
        String(result.results.at(-1)?.detail || ""),
        /followup_no_longer_authorized/,
      );
    },
  },
  {
    name: "template pre-POST integration failure releases claim and remains retryable",
    run: async () => {
      const message = createMessage({
        id: "template-prepost-1",
        outboundDeliveryState: "template_required",
        metadata: {
          external_channel: "whatsapp",
          send_external: true,
          outbound_kind: "canonical_followup",
          outbound_origin: "canonical_followup",
        },
      });
      const harness = createHarness({
        pending: [],
        templateCandidates: [{ message, templateAction: "followup_offer" }],
        integrationImpl: async () => {
          throw new Error("integration unavailable");
        },
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.deepEqual(harness.calls.templateSend, []);
      assert.deepEqual(harness.calls.templateGate, []);
      assert.deepEqual(harness.calls.templateRelease, [
        { messageId: "template-prepost-1", errorText: "integration unavailable" },
      ]);
      assert.equal(result.retryable, 1);
      assert.equal(result.uncertain, 0);
      assert.equal(result.results.at(-1)?.status, "retryable");
    },
  },
  {
    name: "template failure after final gate becomes uncertain and is never released for blind retry",
    run: async () => {
      const message = createMessage({
        id: "template-postgate-1",
        outboundDeliveryState: "template_required",
        metadata: {
          external_channel: "whatsapp",
          send_external: true,
          outbound_kind: "canonical_followup",
          outbound_origin: "canonical_followup",
        },
      });
      const harness = createHarness({
        pending: [],
        templateCandidates: [{ message, templateAction: "followup_offer" }],
        templateSendImpl: async () => {
          throw new Error("Meta 503");
        },
      });

      const result = await harness.process({ organizationId: "org-1", storeId: "store-1" });

      assert.deepEqual(harness.calls.templateRelease, []);
      assert.deepEqual(harness.calls.uncertain, [
        { messageId: "template-postgate-1", errorText: "Meta 503", providerMessageId: null },
      ]);
      assert.equal(result.retryable, 0);
      assert.equal(result.uncertain, 1);
      assert.equal(result.results.at(-1)?.status, "uncertain");
    },
  },
  {
    name: "production sender uses the P19-A window gate before quote-aware v2",
    run: () => {
      const source = readFileSync(senderPath, "utf8");

      assert.equal(
        source.includes(
          '"validate_or_cancel_whatsapp_external_send_v3_by_system"',
        ),
        true,
        "production sender must call the P19-A window gate",
      );

      assert.equal(
        source.includes(
          '"validate_or_cancel_whatsapp_external_send_by_system"',
        ),
        false,
        "production sender must not bypass v2 by calling the legacy gate directly",
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
