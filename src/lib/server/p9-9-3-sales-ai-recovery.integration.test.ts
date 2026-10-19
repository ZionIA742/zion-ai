import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  loadCanonicalCommercialOpportunityStage,
  normalizeCommercialMessageIntentDecisionForStage,
  resolveCommercialMessageIntentSemantically,
  type GenerateAiSalesReplyResult,
  writeCanonicalCommercialMessageIntentResolutionBySystem,
} from "./generate-ai-sales-reply";
import {
  generateAndSaveAiSalesReply,
  materializeSalesAiReplySet,
} from "./generate-and-save-ai-sales-reply";
import {
  bootstrapCommercialContextBeforeInsert,
  processWhatsappInbox,
} from "./whatsapp-inbox-processor";
import { createProcessWhatsappPendingMessages } from "./whatsapp-external-sender";

const scope = {
  organizationId: "org-edgar",
  storeId: "store-edgar",
  conversationId: "conversation-edgar",
  leadId: "lead-edgar",
  customerId: "customer-edgar",
  opportunityId: "opportunity-edgar",
  anchorMessageId: "inbound-edgar-1",
};

function createPipelineSupabase(stage: string) {
  const rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const materializedRow = {
    response_set_id: "response-set-edgar",
    text_message_id: "outbound-edgar-1",
    document_message_ids: [],
    request_fingerprint: "fingerprint-edgar",
    materialization_state: "confirmed",
  };

  const client = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        maybeSingle: async () =>
          table === "commercial_opportunities"
            ? { data: { id: scope.opportunityId, stage }, error: null }
            : table === "conversations"
              ? { data: { id: scope.conversationId, organization_id: scope.organizationId, lead_id: scope.leadId, is_human_active: false, leads: { organization_id: scope.organizationId, store_id: scope.storeId } }, error: null }
              : table === "stores"
                ? { data: { id: scope.storeId, organization_id: scope.organizationId }, error: null }
                : { data: null, error: null },
        update: () => query,
        upsert: () => query,
        like: () => query,
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: [], error: null })),
      };
      return query;
    },
    rpc: async (name: string, payload: Record<string, unknown>) => {
      rpcCalls.push({ name, payload });
      if (name === "write_commercial_message_intent_resolution_by_system") {
        const decisionKind = String(payload.p_decision_kind);
        return {
          data: [{
            decision_kind: decisionKind,
            resolved_opportunity_id: payload.p_resolved_opportunity_id,
            related_opportunity_id: payload.p_related_opportunity_id,
            relation_type: decisionKind === "repurchase" ? "repurchase_of" : decisionKind === "addendum" ? "addendum_to" : null,
            replayed: false,
          }],
          error: null,
        };
      }
      if (name === "materialize_sales_ai_reply_set_by_system") {
        return { data: [materializedRow], error: null };
      }
      throw new Error(`unexpected integration RPC ${name}`);
    },
  };

  return { client, rpcCalls, materializedRow };
}

function createInboundFetch() {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  let messageReads = 0;
  let insertedPayload: Record<string, unknown> | null = null;

  const fetch = (async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body });

    if (url.includes("/rest/v1/channel_whatsapp_inbox") && method === "GET") {
      if (url.includes("status")) return new Response("[]", { status: 200 });
      return new Response(JSON.stringify([{
        id: "inbox-edgar-1",
        organization_id: scope.organizationId,
        store_id: scope.storeId,
        provider: "whatsapp",
        external_event_id: "event-edgar-1",
        payload: {
          source: "meta_whatsapp_webhook",
          event_kind: "message",
          phone_number_id: "phone-edgar",
          message: {
            id: scope.anchorMessageId,
            from: "5511999999999",
            type: "text",
            text: { body: "Quero retomar o atendimento da piscina" },
          },
        },
        received_at: "2026-10-19T12:00:00.000Z",
        processed_at: null,
        processing_error: null,
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/rest/v1/messages") && method === "GET") {
      messageReads += 1;
      return new Response(messageReads === 1 ? "[]" : JSON.stringify([{
        id: "message-edgar-1",
        conversation_id: scope.conversationId,
        lead_id: scope.leadId,
        store_id: scope.storeId,
        external_message_id: scope.anchorMessageId,
        message_type: "text",
        content: "Quero retomar o atendimento da piscina",
        metadata: insertedPayload?.p_metadata || {},
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/rest/v1/store_responsibles") && method === "GET") return new Response("[]", { status: 200 });
    if (url.includes("/rest/v1/rpc/resolve_whatsapp_inbound_thread_by_system")) return new Response(JSON.stringify([{ lead_id: scope.leadId, conversation_id: scope.conversationId, normalized_whatsapp_identity: "5511999999999", thread_state: "existing_active_thread" }]), { status: 200 });
    if (url.includes("/rest/v1/rpc/bootstrap_first_commercial_context_for_inbound_by_system")) return new Response(JSON.stringify([{ customer_id: scope.customerId, customer_channel_identity_id: "identity-edgar", customer_store_link_id: "store-link-edgar", lead_customer_link_id: "lead-link-edgar", commercial_opportunity_id: scope.opportunityId, bootstrap_state: "existing_active_commercial_context" }]), { status: 200 });
    if (url.includes("/rest/v1/rpc/insert_message")) {
      insertedPayload = JSON.parse(body) as Record<string, unknown>;
      return new Response(JSON.stringify([{ id: "message-edgar-1", conversation_id: scope.conversationId, lead_id: scope.leadId, store_id: scope.storeId, external_message_id: scope.anchorMessageId, message_type: "text", content: "Quero retomar o atendimento da piscina" }]), { status: 200 });
    }
    if (url.includes("/rest/v1/conversations") && method === "GET") return new Response(JSON.stringify([{ id: scope.conversationId, organization_id: scope.organizationId, lead_id: scope.leadId, status: "active", is_human_active: false }]), { status: 200 });
    if (url.includes("/rest/v1/conversation_ai_window_state") && method === "GET") return new Response("[]", { status: 200 });
    if (url.includes("/rest/v1/store_assistant_operational_tasks") && method === "GET") return new Response("[]", { status: 200 });
    if (url.includes("/rest/v1/channel_whatsapp_inbox") && method === "PATCH") return new Response("[]", { status: 200 });
    throw new Error(`unexpected inbound call ${method} ${url}`);
  }) as typeof globalThis.fetch;

  return { fetch, calls, get insertedPayload() { return insertedPayload; } };
}

function createSender(message: Record<string, unknown>, trace: string[]) {
  const sender = createProcessWhatsappPendingMessages({
    createSupabaseAdmin: () => ({}) as never,
    reconcileSentQuoteSendMessages: async () => [],
    reconcileSentContractSendMessages: async () => [],
    getTemplateRequiredCanonicalFollowups: async () => [],
    getPendingExternalMessages: async () => [message] as never,
    getWhatsappIntegration: async () => ({ accessToken: "token", phoneNumberId: "phone-edgar" }),
    claimMessageForExternalSend: async () => { trace.push("sender.claim"); return true; },
    releaseClaimedMessage: async () => undefined,
    validateOrCancelWhatsappExternalSend: async () => ({ ok: true, decision: "send", reason: "authorized" }),
    validateSalesContractSendBeforeExternal: async () => ({ ok: true, decision: "send", reason: "authorized" }),
    readCustomerWhatsapp24hWindow: async () => ({ ok: true, decision: "send", reason: "window_open" }),
    preparePendingMessageForSend: async () => { trace.push("sender.prepare"); return { mode: "text", to: "5511999999999", body: "Resposta comercial" }; },
    sendSinglePendingMessage: async () => { trace.push("sender.meta_accept"); return "wamid-edgar-1"; },
    markMessageExternalSent: async (_supabase, sentMessage, externalId) => { trace.push(`sender.confirm:${String(externalId)}`); void sentMessage; },
    markMessageRetryableFailure: async () => undefined,
    markMessageFailed: async () => undefined,
    markMessageUncertain: async () => undefined,
    markMessageCommercialFinalizationPending: async () => undefined,
    finalizeQuoteSendMessageIfNeeded: async () => null,
    finalizeSalesContractSendMessageIfNeeded: async () => null,
  });
  return sender;
}

test("P9 9.3-B integrated Edgar flow uses real inbound, CMIR, materialization and sender boundaries", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  const previousFetch = globalThis.fetch;
  const inbound = createInboundFetch();
  globalThis.fetch = inbound.fetch;
  const trace: string[] = [];
  const { client, rpcCalls, materializedRow } = createPipelineSupabase("qualificacao");

  try {
    const result = await processWhatsappInbox({
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      limit: 1,
      runAiFlow: async (params) => {
        trace.push("inbound.context");
        const stage = await loadCanonicalCommercialOpportunityStage({
          supabase: client,
          organizationId: params.organizationId,
          storeId: params.storeId,
          commercialOpportunityId: scope.opportunityId,
        });
        assert.equal(stage.ok, true);
        trace.push(`stage:${stage.stage}`);

        const semantic = await resolveCommercialMessageIntentSemantically({
          openai: {
            responses: {
              create: async () => ({ output_text: JSON.stringify({ decision_kind: "reopen_same_intent", reason_code: "customer_returned", evidence: ["retomar"] }) }),
            },
          },
          model: "integration-test-model",
          lastCustomerMessage: "Quero retomar o atendimento da piscina",
          recentCommercialHistory: "Venda A em andamento",
          canonicalOpportunityStage: stage.stage,
        });
        assert.equal(semantic.ok, true);
        trace.push("semantic");
        const normalized = normalizeCommercialMessageIntentDecisionForStage({ decisionKind: semantic.decisionKind, canonicalOpportunityStage: stage.stage });
        assert.equal(normalized, "continue_same_intent");
        trace.push(`normalized:${normalized}`);

        const writer = await writeCanonicalCommercialMessageIntentResolutionBySystem({
          supabase: client,
          organizationId: scope.organizationId,
          storeId: scope.storeId,
          anchorMessageId: scope.anchorMessageId,
          customerId: scope.customerId,
          leadCustomerLinkId: "lead-link-edgar",
          operationKey: `ai_sales_cmir:v1:${scope.anchorMessageId}`,
          decisionKind: normalized,
          resolvedOpportunityId: scope.opportunityId,
          relatedOpportunityId: null,
          evidence: semantic.evidence,
        });
        assert.equal(writer.ok, true);
        trace.push("cmir.writer");

        const generatedContext = {
          leadName: "Edgar",
          lastCustomerMessage: "Quero retomar o atendimento da piscina",
          storeDisplayName: "Loja Edgar",
          poolCountUsed: 0,
          resolvedStoreId: scope.storeId,
          requestedStoreId: scope.storeId,
          operationalFollowUpDecision: { kind: "none", reason: "none" } as const,
          humanHandoff: null,
          commercialHandoff: null,
          catalogPhotoAction: null,
          customerCatalogDocumentActions: [],
          resolvedCommercialOpportunityId: scope.opportunityId,
          commercialMessageIntentResolution: {
            decisionKind: normalized,
            reasonCode: "continue_same_intent",
            evidence: semantic.evidence,
            resolvedOpportunityId: scope.opportunityId,
            relatedOpportunityId: null,
          },
          responseAnchorCommercialContext: null,
          salesAiOperatingWindowContext: null,
          salesAiAppointmentContext: null,
          commercialDecisionExplanation: {
            conversationPattern: "general",
            primaryIntent: "continue_same_intent",
            responseMode: "normal",
            qualificationAskNow: false,
            qualificationTargetFactKey: null,
            qualificationReasonCode: "none",
            hasPlannedNextQuestion: false,
          },
          crossSellSuggestionsActuallyIncluded: [],
          crossSellInboundHandling: null,
        } as unknown as Extract<GenerateAiSalesReplyResult, { ok: true }>["context"];
        const generated: Extract<GenerateAiSalesReplyResult, { ok: true }> = {
          ok: true,
          aiText: "Resposta comercial de continuidade",
          anchorMessageId: scope.anchorMessageId,
          usage: { provider: "integration-test", model: "integration-test", tokensPrompt: 0, tokensCompletion: 0, totalTokens: 0, costUsd: 0, inputTokenPriceUsdPer1M: 0, outputTokenPriceUsdPer1M: 0, pricingSource: "integration-test" },
          context: generatedContext,
        };
        const saved = await generateAndSaveAiSalesReply(params, {
          createSupabaseClient: () => client as never,
          detectOpenAssistantOperationalFlow: async () => ({ blocked: false, reason: null }),
          loadConversationMessageBoundaryState: async () => ({ lastIncomingCustomerMessageId: scope.anchorMessageId, lastIncomingCustomerMessageAt: "2026-10-19T12:00:00.000Z", lastAiMessageId: null, lastAiMessageAt: null }),
          tryHandleCustomerContractAcceptance: async () => null,
          generateAiSalesReply: async () => generated,
          updateLatestRunningAiRunUsage: async () => undefined,
          materializeSalesAiReplySet,
          readSalesAiReplySetByAnchor: async () => null,
          createHumanAssistantHandoff: async () => ({ created: false, reason: "integration_disabled" }) as never,
          createCommercialAssistantHandoff: async () => ({ created: false, reason: "integration_disabled" }) as never,
          loadSalesAiOperatingWindowAuthority: async () => ({ decision: "AI_ALLOWED_AFTER_HOURS", humanAvailableNow: false, aiAllowedNow: true, humanUnavailableReason: null, timezoneName: "America/Sao_Paulo", localNow: "2026-10-19T09:00:00-03:00", isHolidayBlocked: false, holidayBlockTitle: null, nextHumanOpenPeriod: null, nextAiAllowedPeriod: null, policy: { aiAfterHoursEnabled: true, aiAfterHoursMode: "all_closed_hours", aiAfterHoursStart: null, aiAfterHoursEnd: null, aiAttendsHolidays: false } }),
        });
        assert.equal(saved.ok, true);
        assert.equal(saved.messageId, materializedRow.text_message_id);
        trace.push("generation.materialization.confirmed");
        return saved;
      },
    });

    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 0);
    assert.equal(inbound.insertedPayload?.p_conversation_id, scope.conversationId);
    assert.equal(inbound.insertedPayload?.p_content, "Quero retomar o atendimento da piscina");
    assert.deepEqual(trace, ["inbound.context", "stage:qualificacao", "semantic", "normalized:continue_same_intent", "cmir.writer", "generation.materialization.confirmed"]);
    assert.equal(rpcCalls.some((call) => call.name === "write_commercial_message_intent_resolution_by_system" && call.payload.p_decision_kind === "continue_same_intent"), true);
    assert.equal(rpcCalls.some((call) => call.name === "materialize_sales_ai_reply_set_by_system"), true);

    const outboundMessage = {
      id: materializedRow.text_message_id,
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      conversationId: scope.conversationId,
      leadId: scope.leadId,
      phone: "5511999999999",
      content: "Resposta comercial de continuidade",
      rawMessageType: "text",
      messageType: "text",
      mediaUrl: null,
      metadata: { external_channel: "whatsapp", send_external: true, outbound_origin: "sales_ai" },
      externalMessageId: null,
      outboundDeliveryState: "pending",
      outboundIdempotencyKey: "sales-ai:edgar:response-set-edgar",
      outboundClaimedAt: null,
      outboundAttemptStartedAt: null,
      outboundProviderAcceptedAt: null,
      outboundCommercialFinalizedAt: null,
      outboundCommercialErrorText: null,
    };
    const senderResult = await createSender(outboundMessage, trace)(
      { organizationId: scope.organizationId, storeId: scope.storeId, limit: 1 },
    );
    assert.equal(senderResult.sent, 1);
    assert.equal(senderResult.uncertain, 0);
    assert.equal(trace.includes("sender.confirm:wamid-edgar-1"), true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("P9 9.3-B canonical stage matrix preserves fail-closed behavior", async () => {
  for (const [stageValue, expectedOk] of [["qualificacao", true], ["perdido", true], ["concluido_sem_mais_acoes", true], ["unknown", false]] as const) {
    const stageRead = await loadCanonicalCommercialOpportunityStage({
      supabase: createPipelineSupabase(stageValue).client,
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      commercialOpportunityId: scope.opportunityId,
    });
    assert.equal(stageRead.ok, expectedOk, `stage reader result for ${stageValue}`);
  }

  for (const [stage, expected] of [["perdido", "reopen_same_intent"], ["concluido_sem_mais_acoes", "reopen_same_intent"], ["unknown", null], [null, null]] as const) {
    assert.equal(
      normalizeCommercialMessageIntentDecisionForStage({ decisionKind: "reopen_same_intent", canonicalOpportunityStage: stage }),
      expected,
      `unexpected normalization for ${String(stage)}`,
    );
  }

  const bootstrapClient = {
    rpc: async () => ({ data: [{
      customer_id: scope.customerId,
      customer_channel_identity_id: "identity-first",
      customer_store_link_id: "store-link-first",
      lead_customer_link_id: "lead-link-first",
      commercial_opportunity_id: "opportunity-first",
      bootstrap_state: "created_first_contextual_opportunity",
      commercial_opportunity_created: true,
    }], error: null }),
  };
  await assert.doesNotReject(() => bootstrapCommercialContextBeforeInsert({
    supabase: bootstrapClient as never,
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    leadId: scope.leadId,
    conversationId: scope.conversationId,
    whatsappIdentity: "5511999999999",
  }));
});

test("P9 9.3-B materialization contract rejects unconfirmed output and preserves replay", async () => {
  const baseArgs = {
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    conversationId: scope.conversationId,
    leadId: scope.leadId,
    anchorMessageId: scope.anchorMessageId,
    commercialOpportunityId: scope.opportunityId,
    aiText: "Resposta comercial",
    outboundKind: "reactive_ai_reply" as const,
    externalAuthorized: true,
    documentActions: [],
    photoAction: null,
  };
  const confirmed = {
    response_set_id: "response-set-replay",
    text_message_id: "outbound-replay",
    document_message_ids: [],
    request_fingerprint: "fingerprint-replay",
    materialization_state: "confirmed",
  };
  const clientFor = (data: unknown, error: { message: string } | null = null) => ({
    rpc: async () => ({ data, error }),
  });

  const first = await materializeSalesAiReplySet({ ...baseArgs, supabase: clientFor([confirmed]) });
  const replay = await materializeSalesAiReplySet({ ...baseArgs, supabase: clientFor([confirmed]) });
  assert.equal(first.response_set_id, replay.response_set_id);

  await assert.rejects(
    () => materializeSalesAiReplySet({ ...baseArgs, supabase: clientFor([]) }),
    /MATERIALIZATION_NOT_CONFIRMED/,
  );
  await assert.rejects(
    () => materializeSalesAiReplySet({ ...baseArgs, supabase: clientFor([confirmed, confirmed]) }),
    /MATERIALIZATION_NOT_CONFIRMED/,
  );
  await assert.rejects(
    () => materializeSalesAiReplySet({ ...baseArgs, supabase: clientFor(null, { message: "canonical rejection" }) }),
    /SALES_AI_REPLY_SET_MATERIALIZATION_FAILED/,
  );

  const concurrent = await Promise.all([
    materializeSalesAiReplySet({ ...baseArgs, supabase: clientFor([confirmed]) }),
    materializeSalesAiReplySet({ ...baseArgs, supabase: clientFor([confirmed]) }),
  ]);
  assert.deepEqual(concurrent.map((row) => row.text_message_id), ["outbound-replay", "outbound-replay"]);
  assert.equal(concurrent.every((row) => row.materialization_state === "confirmed"), true);
});
