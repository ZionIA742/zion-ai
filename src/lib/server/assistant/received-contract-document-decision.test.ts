import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import {
  decideReceivedContractDocument,
  RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC,
  resolveReceivedContractDocumentDecision,
  tryHandleReceivedContractDocumentDecision,
} from "./received-contract-document-decision";

const context = {
  organizationId: "org-1",
  storeId: "store-1",
  conversationId: "conversation-1",
  notificationId: "notification-1",
  contractId: "contract-1",
  contractVersionId: "version-1",
  evidenceSourceMessageId: "message-1",
  decisionMessageId: "decision-1",
  channel: "assistant" as const,
};

test("aceita somente SIM/NAO standalone e preserva acentuacao", () => {
  assert.equal(resolveReceivedContractDocumentDecision("SIM"), "confirmed");
  assert.equal(resolveReceivedContractDocumentDecision("não"), "rejected");
  assert.equal(resolveReceivedContractDocumentDecision("sim, pode"), null);
  assert.equal(resolveReceivedContractDocumentDecision("assinei"), null);
  assert.equal(resolveReceivedContractDocumentDecision(""), null);
});

test("envia identidade exata para a autoridade e aceita replay valido", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await decideReceivedContractDocument({
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          data: {
            outcome: "replayed",
            decision: "confirmed",
            notification_id: context.notificationId,
            contract_id: context.contractId,
            contract_version_id: context.contractVersionId,
            evidence_source_message_id: context.evidenceSourceMessageId,
          },
          error: null,
        };
      },
    } as never,
    decision: "confirmed",
    context,
  });
  assert.equal(result.outcome, "replayed");
  assert.equal(calls[0]?.name, RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC);
  assert.deepEqual(Object.keys(calls[0]?.args || {}).sort(), [
    "p_channel",
    "p_contract_id",
    "p_contract_version_id",
    "p_decision",
    "p_decision_message_id",
    "p_evidence_source_message_id",
    "p_notification_id",
    "p_organization_id",
    "p_store_id",
  ]);
  assert.equal("p_conversation_id" in (calls[0]?.args || {}), false);
  assert.equal(calls[0]?.args.p_contract_version_id, context.contractVersionId);
  assert.equal(calls[0]?.args.p_evidence_source_message_id, context.evidenceSourceMessageId);
  assert.equal(calls[0]?.args.p_channel, "assistant_chat");
});

test("falha fechado para retorno vazio, cardinalidade ou identidade divergente", async () => {
  for (const data of [null, [], [{ outcome: "decided" }, { outcome: "decided" }], {
    outcome: "decided",
    decision: "confirmed",
    notification_id: context.notificationId,
    contract_id: "other-contract",
    contract_version_id: context.contractVersionId,
    evidence_source_message_id: context.evidenceSourceMessageId,
  }]) {
    await assert.rejects(
      decideReceivedContractDocument({
        supabase: { rpc: async () => ({ data, error: null }) } as never,
        decision: "confirmed",
        context,
      }),
      /RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC_RETURN_INVALID/,
    );
  }
});

test("nao transforma erro da autoridade em decisao", async () => {
  await assert.rejects(
    decideReceivedContractDocument({
      supabase: {
        rpc: async () => ({ data: null, error: { message: "rpc unavailable" } }),
      } as never,
      decision: "rejected",
      context,
    }),
    /RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC_FAILED:rpc unavailable/,
  );
});

test("nao executa com contexto incompleto", async () => {
  await assert.rejects(
    decideReceivedContractDocument({
      supabase: { rpc: async () => ({ data: null, error: null }) } as never,
      decision: "confirmed",
      context: { ...context, contractVersionId: "" },
    }),
    /RECEIVED_CONTRACT_DOCUMENT_DECISION_CONTEXT_INVALID/,
  );
});

test("rejeita canal fora do contrato RPC antes de qualquer chamada", async () => {
  let rpcCalls = 0;
  await assert.rejects(
    decideReceivedContractDocument({
      supabase: {
        rpc: async () => {
          rpcCalls += 1;
          return { data: null, error: null };
        },
      } as never,
      decision: "confirmed",
      context: { ...context, channel: "whatsapp_legacy" as never },
    }),
    /RECEIVED_CONTRACT_DOCUMENT_DECISION_CHANNEL_INVALID/,
  );
  assert.equal(rpcCalls, 0);
});

function createResolverSupabase(args: {
  message?: { id: string; thread_id: string | null } | null;
  notifications?: Array<Record<string, unknown>>;
  externalNotifications?: Array<Record<string, unknown>>;
  rpcResult?: { data: unknown; error: unknown };
  confirmationRpcResult?: { data: unknown; error: unknown };
  persistedContract?: Record<string, unknown> | null;
  persistedVersion?: Record<string, unknown> | null;
  persistedEvents?: Array<Record<string, unknown>>;
}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const businessEventQueries: Array<{ contains: unknown; limit: number | undefined }> = [];
  const rows = args.message ?? null;
  const notifications = args.notifications ?? [];
  const externalNotifications = args.externalNotifications ?? [];
  const rpcResult = args.rpcResult ?? {
    data: {
      outcome: "applied",
      decision: "confirmed",
      notification_id: "notification-1",
      contract_id: "contract-1",
      contract_version_id: "version-1",
      evidence_source_message_id: "message-1",
    },
    error: null,
  };
  const confirmationRpcResult = args.confirmationRpcResult ?? {
    data: {
      message_id: "confirmation-1",
      outbound_idempotency_key: "confirmation-key",
      outcome: "queued",
    },
    error: null,
  };
  const persistedContract = args.persistedContract ?? {
    id: "contract-1",
    status: "completed",
    completed_at: "2026-11-06T16:40:00.000Z",
    current_version_id: "version-1",
    conversation_id: "conversation-1",
  };
  const persistedVersion = args.persistedVersion ?? {
    id: "version-1",
    contract_id: "contract-1",
    status: "completed",
    organization_id: "org-1",
    store_id: "store-1",
  };
  const persistedEvents = args.persistedEvents ?? [{
    id: "decision-event-1",
    conversation_id: "conversation-1",
    event_payload: {
      schema: "received_contract_document_decision_v1",
      decision: "confirmed",
      notification_id: "notification-1",
      contract_id: "contract-1",
      contract_version_id: "version-1",
      evidence_source_message_id: "message-1",
    },
  }];

  const query = (table: string) => {
    let eventPayloadFilter: unknown = undefined;
    const builder = {
      select: () => builder,
      eq: () => builder,
      contains: (column: string, value: unknown) => {
        if (table === "store_business_events" && column === "event_payload") {
          eventPayloadFilter = value;
        }
        return builder;
      },
      neq: () => builder,
      order: () => builder,
      limit: async (count?: number) => {
        if (table === "store_business_events") {
          businessEventQueries.push({ contains: eventPayloadFilter, limit: count });
        }
        const eventRows = eventPayloadFilter && typeof eventPayloadFilter === "object"
          ? persistedEvents.filter((event) => {
              const payload = event.event_payload;
              return payload && typeof payload === "object" &&
                Object.entries(eventPayloadFilter).every(([key, value]) =>
                  (payload as Record<string, unknown>)[key] === value,
                );
            })
          : persistedEvents;
        return {
          data: table === "store_assistant_notification_queue"
            ? notifications
            : table === "store_responsible_external_notifications"
              ? externalNotifications
              : table === "store_business_events"
                ? eventRows.slice(0, count ?? eventRows.length)
                : [],
          error: null,
        };
      },
      maybeSingle: async () => ({
        data: table === "store_assistant_messages"
          ? rows
          : table === "sales_contracts"
            ? persistedContract
            : table === "sales_contract_versions"
              ? persistedVersion
              : rows,
        error: null,
      }),
    };
    return builder;
  };

  return {
    calls,
    businessEventQueries,
    supabase: {
      from: (table: string) => query(table),
      rpc: async (name: string, rpcArgs: Record<string, unknown>) => {
        calls.push({ name, args: rpcArgs });
        if (name === "enqueue_received_contract_document_confirmation_by_system") {
          return confirmationRpcResult;
        }
        return rpcResult;
      },
    },
  };
}

const identifiedNotification = {
  id: "notification-1",
  thread_id: "thread-1",
  status: "pending",
  context: {
    source: "received_contract_document_evidence_v1",
    received_identification_status: "identified",
    related_contract_id: "contract-1",
    document_version_id: "version-1",
    received_evidence_source_message_id: "message-1",
    customer_name: "Regina",
    related_conversation_id: "conversation-1",
  },
};

const identifiedNotificationWithConversation = {
  ...identifiedNotification,
  context: {
    ...identifiedNotification.context,
    related_conversation_id: "conversation-1",
  },
};

test("SIM confirmado enfileira uma unica mensagem depois da decisao persistida", async () => {
  const harness = createResolverSupabase({
    message: { id: "decision-confirmation-1", thread_id: "thread-1" },
    notifications: [identifiedNotificationWithConversation],
  });
  const result = await tryHandleReceivedContractDocumentDecision({
    supabase: harness.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    decisionMessageId: "decision-confirmation-1",
    content: "SIM",
    channel: "assistant",
  });

  assert.equal(result?.result.decision, "confirmed");
  assert.deepEqual(
    harness.calls.map((call) => call.name),
    [
      "confirm_received_contract_document_by_system",
      "enqueue_received_contract_document_confirmation_by_system",
    ],
  );
});

test("nao responde conclusao quando a RPC retorna sucesso sem estado persistido", async () => {
  const harness = createResolverSupabase({
    message: { id: "decision-false-success", thread_id: "thread-1" },
    notifications: [identifiedNotificationWithConversation],
    persistedContract: {
      id: "contract-1",
      status: "sent_to_customer",
      completed_at: null,
      current_version_id: "version-1",
      conversation_id: "conversation-1",
    },
    persistedVersion: {
      id: "version-1",
      contract_id: "contract-1",
      status: "sent",
      organization_id: "org-1",
      store_id: "store-1",
    },
    persistedEvents: [],
  });

  await assert.rejects(
    tryHandleReceivedContractDocumentDecision({
      supabase: harness.supabase,
      organizationId: "org-1",
      storeId: "store-1",
      decisionMessageId: "decision-false-success",
      content: "SIM",
      channel: "assistant",
    }),
    /RECEIVED_CONTRACT_DOCUMENT_DECISION_NOT_PERSISTED/,
  );
  assert.deepEqual(
    harness.calls.map((call) => call.name),
    ["confirm_received_contract_document_by_system"],
  );
});

test("aceita confirmacao legitima apos mais de 20 eventos na conversa", async () => {
  const targetEvent = {
    id: "decision-event-21",
    conversation_id: "conversation-1",
    event_payload: {
      schema: "received_contract_document_decision_v1",
      decision: "confirmed",
      notification_id: "notification-1",
      contract_id: "contract-1",
      contract_version_id: "version-1",
      evidence_source_message_id: "message-1",
    },
  };
  const harness = createResolverSupabase({
    message: { id: "decision-after-20-events", thread_id: "thread-1" },
    notifications: [identifiedNotificationWithConversation],
    persistedEvents: [
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `noise-event-${index + 1}`,
        conversation_id: "conversation-1",
        event_payload: {
          schema: "received_contract_document_decision_v1",
          decision: "confirmed",
          notification_id: `other-notification-${index + 1}`,
          contract_id: "contract-1",
          contract_version_id: "version-1",
          evidence_source_message_id: "message-1",
        },
      })),
      targetEvent,
    ],
  });

  const result = await tryHandleReceivedContractDocumentDecision({
    supabase: harness.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    decisionMessageId: "decision-after-20-events",
    content: "SIM",
    channel: "assistant",
  });

  assert.equal(result?.result.decision, "confirmed");
  assert.equal(harness.businessEventQueries[0]?.limit, 1);
  assert.deepEqual(harness.businessEventQueries[0]?.contains, {
    schema: "received_contract_document_decision_v1",
    decision: "confirmed",
    notification_id: "notification-1",
    contract_id: "contract-1",
    contract_version_id: "version-1",
    evidence_source_message_id: "message-1",
  });
});

test("nao conclui outro contrato quando a identidade persistida nao corresponde", async () => {
  const harness = createResolverSupabase({
    message: { id: "decision-other-contract", thread_id: "thread-1" },
    notifications: [{
      ...identifiedNotificationWithConversation,
      context: {
        ...identifiedNotificationWithConversation.context,
        related_contract_id: "contract-2",
        document_version_id: "version-2",
        received_evidence_source_message_id: "message-2",
      },
    }],
    rpcResult: {
      data: {
        outcome: "applied",
        decision: "confirmed",
        notification_id: "notification-1",
        contract_id: "contract-2",
        contract_version_id: "version-2",
        evidence_source_message_id: "message-2",
      },
      error: null,
    },
  });

  await assert.rejects(
    tryHandleReceivedContractDocumentDecision({
      supabase: harness.supabase,
      organizationId: "org-1",
      storeId: "store-1",
      decisionMessageId: "decision-other-contract",
      content: "SIM",
      channel: "assistant",
    }),
    /RECEIVED_CONTRACT_DOCUMENT_DECISION_NOT_PERSISTED/,
  );
  assert.deepEqual(
    harness.calls.map((call) => call.name),
    ["confirm_received_contract_document_by_system"],
  );
});

test("NAO nao enfileira mensagem ao cliente", async () => {
  const harness = createResolverSupabase({
    message: { id: "decision-confirmation-2", thread_id: "thread-1" },
    notifications: [identifiedNotificationWithConversation],
    rpcResult: {
      data: {
        outcome: "applied",
        decision: "rejected",
        notification_id: "notification-1",
        contract_id: "contract-1",
        contract_version_id: "version-1",
        evidence_source_message_id: "message-1",
      },
      error: null,
    },
  });
  const result = await tryHandleReceivedContractDocumentDecision({
    supabase: harness.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    decisionMessageId: "decision-confirmation-2",
    content: "NAO",
    channel: "assistant",
  });

  assert.equal(result?.result.decision, "rejected");
  assert.deepEqual(
    harness.calls.map((call) => call.name),
    ["confirm_received_contract_document_by_system"],
  );
});

test("falha de materializacao nao desfaz SIM ja persistido nem vira fracasso ao responsavel", async () => {
  const harness = createResolverSupabase({
    message: { id: "decision-confirmation-failure", thread_id: "thread-1" },
    notifications: [identifiedNotificationWithConversation],
    confirmationRpcResult: {
      data: null,
      error: { message: "materialization unavailable" },
    },
  });

  const result = await tryHandleReceivedContractDocumentDecision({
    supabase: harness.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    decisionMessageId: "decision-confirmation-failure",
    content: "SIM",
    channel: "assistant",
  });

  assert.equal(result?.result.decision, "confirmed");
  assert.match(result?.responseText || "", /marcado como concluido/);
});

test("nao persiste SIM sem conversa relacionada", async () => {
  let rpcCalls = 0;
  const harness = createResolverSupabase({
    message: { id: "decision-without-conversation", thread_id: "thread-1" },
    notifications: [{
      ...identifiedNotification,
      context: { ...identifiedNotification.context, related_conversation_id: "" },
    }],
  });
  const originalRpc = harness.supabase.rpc;
  harness.supabase.rpc = async (...args: Parameters<typeof originalRpc>) => {
    rpcCalls += 1;
    return originalRpc(...args);
  };

  await assert.rejects(
    tryHandleReceivedContractDocumentDecision({
      supabase: harness.supabase,
      organizationId: "org-1",
      storeId: "store-1",
      decisionMessageId: "decision-without-conversation",
      content: "SIM",
      channel: "assistant",
    }),
    /RECEIVED_CONTRACT_DOCUMENT_CONFIRMATION_CONTEXT_INVALID/,
  );
  assert.equal(rpcCalls, 0);
});

test("integra SIM no WhatsApp com a notificacao externa exata", async () => {
  const harness = createResolverSupabase({
    message: { id: "decision-1", thread_id: "thread-1" },
    notifications: [identifiedNotification],
    externalNotifications: [{ internal_notification_id: "notification-1" }],
  });
  const result = await tryHandleReceivedContractDocumentDecision({
    supabase: harness.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    decisionMessageId: "decision-1",
    content: "SIM",
    channel: "whatsapp",
    contextMessageId: "external-1",
  });
  assert.equal(result?.result.decision, "confirmed");
  assert.equal(harness.calls[0]?.args.p_notification_id, "notification-1");
  assert.equal(harness.calls[0]?.args.p_decision_message_id, "decision-1");
  assert.equal(harness.calls[0]?.args.p_channel, "whatsapp_assistant");
});

test("integra NAO no chat interno pelo thread exato", async () => {
  const harness = createResolverSupabase({
    message: { id: "decision-2", thread_id: "thread-1" },
    notifications: [identifiedNotification],
    rpcResult: {
      data: {
        outcome: "applied",
        decision: "rejected",
        notification_id: "notification-1",
        contract_id: "contract-1",
        contract_version_id: "version-1",
        evidence_source_message_id: "message-1",
      },
      error: null,
    },
  });
  const result = await tryHandleReceivedContractDocumentDecision({
    supabase: harness.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    decisionMessageId: "decision-2",
    content: "NÃO",
    channel: "assistant",
  });
  assert.equal(result?.result.decision, "rejected");
  assert.equal(harness.calls[0]?.args.p_decision_message_id, "decision-2");
  assert.equal(harness.calls[0]?.args.p_channel, "assistant_chat");
});

test("permanece sem mutacao quando ha mais de uma notificacao candidata", async () => {
  const harness = createResolverSupabase({
    message: { id: "decision-3", thread_id: "thread-1" },
    notifications: [identifiedNotification, { ...identifiedNotification, id: "notification-2" }],
  });
  const result = await tryHandleReceivedContractDocumentDecision({
    supabase: harness.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    decisionMessageId: "decision-3",
    content: "SIM",
    channel: "assistant",
  });
  assert.equal(result, null);
  assert.equal(harness.calls.length, 0);
});

test("propaga falha da autoridade sem transformar em sucesso", async () => {
  const harness = createResolverSupabase({
    message: { id: "decision-4", thread_id: "thread-1" },
    notifications: [identifiedNotification],
    rpcResult: { data: null, error: { message: "rpc unavailable" } },
  });
  await assert.rejects(
    tryHandleReceivedContractDocumentDecision({
      supabase: harness.supabase,
      organizationId: "org-1",
      storeId: "store-1",
      decisionMessageId: "decision-4",
      content: "SIM",
      channel: "assistant",
    }),
    /RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC_FAILED:rpc unavailable/,
  );
});

test("os dois canais chamam o resolvedor antes do fluxo normal", () => {
  const whatsappSource = readFileSync(
    join(process.cwd(), "src/lib/server/whatsapp-inbox-processor.ts"),
    "utf8",
  );
  const assistantSource = readFileSync(
    join(process.cwd(), "src/app/api/assistant/reply/route.ts"),
    "utf8",
  );

  assert.match(whatsappSource, /tryHandleReceivedContractDocumentDecision/);
  assert.match(whatsappSource, /channel: "whatsapp"/);
  assert.match(assistantSource, /tryHandleReceivedContractDocumentDecision/);
  assert.match(assistantSource, /channel: "assistant"/);
  assert.ok(
    assistantSource.indexOf("const receivedContractDecision =") <
      assistantSource.indexOf("const contractGenerationResult ="),
  );
});
