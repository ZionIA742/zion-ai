import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueReceivedContractDocumentConfirmation } from "./received-contract-document-confirmation";

export const RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC =
  "confirm_received_contract_document_by_system" as const;

export type ReceivedContractDocumentDecision = "confirmed" | "rejected";
export type ReceivedContractDocumentDecisionChannel =
  | "whatsapp"
  | "assistant";

export type ReceivedContractDocumentDecisionContext = {
  organizationId: string;
  storeId: string;
  conversationId: string;
  notificationId: string;
  contractId: string;
  contractVersionId: string;
  evidenceSourceMessageId: string;
  decisionMessageId: string;
  channel: ReceivedContractDocumentDecisionChannel;
};

export type ReceivedContractDocumentDecisionResult = {
  outcome: "decided" | "replayed";
  decision: ReceivedContractDocumentDecision;
  notificationId: string;
  contractId: string;
  contractVersionId: string;
  evidenceSourceMessageId: string;
};

export type ReceivedContractDocumentDecisionHandled = {
  kind: "received_contract_document_decision";
  responseText: string;
  result: ReceivedContractDocumentDecisionResult;
};

export type ReceivedContractDocumentDecisionBlocked = {
  kind: "received_contract_document_decision_blocked";
  responseText: string;
  result: {
    outcome: "blocked";
    decision: ReceivedContractDocumentDecision;
    reason: "correlation_missing_or_ambiguous";
  };
};

const RECEIVED_CONTRACT_DOCUMENT_NOTIFICATION_SOURCE =
  "received_contract_document_evidence_v1";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: unknown): string {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, " ")
    .trim();
}

/**
 * Resolves only an explicit, standalone SIM/NAO. Any explanation or other
 * phrase stays in the normal assistant flow and cannot mutate a contract.
 */
export function resolveReceivedContractDocumentDecision(
  value: unknown,
): ReceivedContractDocumentDecision | null {
  const normalized = normalize(value);
  if (normalized === "sim") return "confirmed";
  if (normalized === "nao") return "rejected";
  return null;
}

export function protectUnpersistedContractCompletion(args: {
  input: unknown;
  assistantText: string;
}): string {
  if (!resolveReceivedContractDocumentDecision(args.input)) return args.assistantText;

  const normalized = normalize(args.assistantText);
  const mentionsContract = normalized.includes("contrato");
  const claimsCompletion =
    /(concluid|finalizad|complet|assinad|aprovad|tudo certo)/u.test(normalized);
  const explicitlyPending =
    /(nao consegui|nao foi possivel|nao posso confirmar|pendente|aguardando|continua pendente)/u.test(normalized);

  if (!mentionsContract || !claimsCompletion || explicitlyPending) {
    return args.assistantText;
  }

  return "Recebi sua resposta, mas não consegui confirmar com segurança a conclusão do contrato. O contrato permanece pendente de conferência.";
}

function oneRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return value.length === 1 && value[0] && typeof value[0] === "object"
      ? value[0] as Record<string, unknown>
      : null;
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function requiredContext(context: ReceivedContractDocumentDecisionContext) {
  const values = [
    context.organizationId,
    context.storeId,
    context.conversationId,
    context.notificationId,
    context.contractId,
    context.contractVersionId,
    context.evidenceSourceMessageId,
    context.decisionMessageId,
    context.channel,
  ];
  if (values.some((value) => !clean(value))) {
    throw new Error("RECEIVED_CONTRACT_DOCUMENT_DECISION_CONTEXT_INVALID");
  }
}

function toRpcDecisionChannel(
  channel: ReceivedContractDocumentDecisionChannel,
): "whatsapp_assistant" | "assistant_chat" {
  if (channel === "whatsapp") return "whatsapp_assistant";
  if (channel === "assistant") return "assistant_chat";
  throw new Error("RECEIVED_CONTRACT_DOCUMENT_DECISION_CHANNEL_INVALID");
}

/**
 * The database RPC is the only mutation authority. This adapter deliberately
 * does not update contract, version, signature, stage, or business-event rows.
 */
export async function decideReceivedContractDocument(args: {
  supabase: Pick<SupabaseClient, "rpc">;
  decision: ReceivedContractDocumentDecision;
  context: ReceivedContractDocumentDecisionContext;
}): Promise<ReceivedContractDocumentDecisionResult> {
  requiredContext(args.context);
  const context = args.context;
  const rpcChannel = toRpcDecisionChannel(context.channel);
  const { data, error } = await args.supabase.rpc(
    RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC,
    {
      p_organization_id: context.organizationId,
      p_store_id: context.storeId,
      p_notification_id: context.notificationId,
      p_contract_id: context.contractId,
      p_contract_version_id: context.contractVersionId,
      p_evidence_source_message_id: context.evidenceSourceMessageId,
      p_decision_message_id: context.decisionMessageId,
      p_channel: rpcChannel,
      p_decision: args.decision,
    },
  );
  if (error) throw new Error(`RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC_FAILED:${error.message}`);

  const row = oneRow(data);
  const rawOutcome = clean(row?.outcome);
  const outcome = rawOutcome === "applied"
    ? "decided"
    : rawOutcome === "already_recorded"
      ? "replayed"
      : rawOutcome;
  const decision = clean(row?.decision);
  const notificationId = clean(row?.notification_id);
  const contractId = clean(row?.contract_id);
  const contractVersionId = clean(row?.contract_version_id);
  const evidenceSourceMessageId = clean(row?.evidence_source_message_id);
  if (
    (outcome !== "decided" && outcome !== "replayed") ||
    decision !== args.decision ||
    notificationId !== context.notificationId ||
    contractId !== context.contractId ||
    contractVersionId !== context.contractVersionId ||
    evidenceSourceMessageId !== context.evidenceSourceMessageId
  ) {
    throw new Error("RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC_RETURN_INVALID");
  }
  return {
    outcome: outcome as "decided" | "replayed",
    decision: args.decision,
    notificationId,
    contractId,
    contractVersionId,
    evidenceSourceMessageId,
  };
}

type DecisionMessageScope = {
  id: string;
  thread_id: string | null;
};

type PendingReceivedContractNotification = {
  id: string;
  thread_id: string | null;
  status: string | null;
  context: Record<string, unknown> | null;
};

function contextText(context: Record<string, unknown> | null, key: string) {
  return clean(context?.[key]);
}

async function loadDecisionMessageScope(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  decisionMessageId: string;
}): Promise<DecisionMessageScope | null> {
  const { data, error } = await args.supabase
    .from("store_assistant_messages")
    .select("id, thread_id")
    .eq("id", args.decisionMessageId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("sender", "human")
    .eq("sender_role", "store_responsible")
    .eq("direction", "incoming")
    .maybeSingle();
  if (error) throw new Error(`RECEIVED_CONTRACT_DOCUMENT_DECISION_MESSAGE_LOOKUP_FAILED:${error.message}`);
  return data?.id ? { id: String(data.id), thread_id: data.thread_id || null } : null;
}

async function loadReceivedContractNotifications(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_notification_queue")
    .select("id, thread_id, status, context")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("notification_type", "important_alert")
    .contains("context", { source: RECEIVED_CONTRACT_DOCUMENT_NOTIFICATION_SOURCE })
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`RECEIVED_CONTRACT_DOCUMENT_NOTIFICATION_LOOKUP_FAILED:${error.message}`);
  return (data || []) as PendingReceivedContractNotification[];
}

async function resolveWhatsappNotificationId(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  contextMessageId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_responsible_external_notifications")
    .select("internal_notification_id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("external_message_id", args.contextMessageId)
    .limit(2);
  if (error) throw new Error(`RECEIVED_CONTRACT_DOCUMENT_EXTERNAL_CONTEXT_LOOKUP_FAILED:${error.message}`);
  const ids = [...new Set((data || []).map((row: { internal_notification_id?: unknown }) => clean(row.internal_notification_id)).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

async function assertConfirmedDecisionPersisted(args: {
  supabase: Pick<SupabaseClient, "from">;
  organizationId: string;
  storeId: string;
  conversationId: string;
  notificationId: string;
  contractId: string;
  contractVersionId: string;
  evidenceSourceMessageId: string;
}) {
  const contractResult = await args.supabase
    .from("sales_contracts")
    .select("id, status, completed_at, current_version_id, conversation_id")
    .eq("id", args.contractId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("conversation_id", args.conversationId)
    .maybeSingle();
  if (contractResult.error) {
    throw new Error(`RECEIVED_CONTRACT_DOCUMENT_PERSISTENCE_LOOKUP_FAILED:${contractResult.error.message}`);
  }

  const versionResult = await args.supabase
    .from("sales_contract_versions")
    .select("id, contract_id, status, organization_id, store_id")
    .eq("id", args.contractVersionId)
    .eq("contract_id", args.contractId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();
  if (versionResult.error) {
    throw new Error(`RECEIVED_CONTRACT_DOCUMENT_PERSISTENCE_LOOKUP_FAILED:${versionResult.error.message}`);
  }

  const eventResult = await args.supabase
    .from("store_business_events")
    .select("id, conversation_id, event_payload")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("conversation_id", args.conversationId)
    .eq("event_key", "contrato_conferencia_documental")
    .contains("event_payload", {
      schema: "received_contract_document_decision_v1",
      decision: "confirmed",
      notification_id: args.notificationId,
      contract_id: args.contractId,
      contract_version_id: args.contractVersionId,
      evidence_source_message_id: args.evidenceSourceMessageId,
    })
    .limit(1);
  if (eventResult.error) {
    throw new Error(`RECEIVED_CONTRACT_DOCUMENT_PERSISTENCE_LOOKUP_FAILED:${eventResult.error.message}`);
  }

  const eventPersisted = (eventResult.data || []).length > 0;

  if (
    contractResult.data?.status !== "completed" ||
    !contractResult.data?.completed_at ||
    contractResult.data?.current_version_id !== args.contractVersionId ||
    versionResult.data?.status !== "completed" ||
    !eventPersisted
  ) {
    throw new Error("RECEIVED_CONTRACT_DOCUMENT_DECISION_NOT_PERSISTED");
  }
}

export async function tryHandleReceivedContractDocumentDecision(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  decisionMessageId: string;
  content: string;
  channel: ReceivedContractDocumentDecisionChannel;
  contextMessageId?: string | null;
}): Promise<ReceivedContractDocumentDecisionHandled | ReceivedContractDocumentDecisionBlocked | null> {
  const decision = resolveReceivedContractDocumentDecision(args.content);
  if (!decision) return null;

  const message = await loadDecisionMessageScope(args);
  if (!message) return null;

  const notifications = await loadReceivedContractNotifications(args);
  const isIdentifiedContractNotification = (notification: PendingReceivedContractNotification) => {
    const context = notification.context;
    return contextText(context, "received_identification_status") === "identified" &&
      contextText(context, "related_contract_id") !== "" &&
      contextText(context, "document_version_id") !== "" &&
      contextText(context, "received_evidence_source_message_id") !== "";
  };
  let candidates = notifications.filter(isIdentifiedContractNotification);
  let contractScopedNotifications: PendingReceivedContractNotification[] = [];

  const contextMessageId = clean(args.contextMessageId);
  if (args.channel === "whatsapp") {
    if (!contextMessageId) return null;
    const notificationId = await resolveWhatsappNotificationId({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      contextMessageId,
    });
    contractScopedNotifications = notificationId
      ? notifications.filter((notification) => clean(notification.id) === notificationId)
      : [];
    candidates = contractScopedNotifications.filter(isIdentifiedContractNotification);
  } else {
    contractScopedNotifications = notifications.filter((notification) =>
      clean(notification.thread_id) !== "" &&
      clean(notification.thread_id) === clean(message.thread_id),
    );
    candidates = contractScopedNotifications.filter(isIdentifiedContractNotification);
  }

  if (candidates.length !== 1) {
    if (contractScopedNotifications.length > 0) {
      return {
        kind: "received_contract_document_decision_blocked",
        responseText:
          "Recebi sua resposta, mas não consegui confirmar com segurança qual conferência documental está pendente. O contrato permanece pendente de conferência.",
        result: {
          outcome: "blocked",
          decision,
          reason: "correlation_missing_or_ambiguous",
        },
      };
    }
    return null;
  }
  const notification = candidates[0];
  const context = notification.context || {};
  const contractId = contextText(context, "related_contract_id");
  const contractVersionId = contextText(context, "document_version_id");
  const evidenceSourceMessageId = contextText(context, "received_evidence_source_message_id");
  const relatedConversationId = contextText(context, "related_conversation_id");
  if (!relatedConversationId) {
    throw new Error("RECEIVED_CONTRACT_DOCUMENT_CONFIRMATION_CONTEXT_INVALID");
  }
  const result = await decideReceivedContractDocument({
    supabase: args.supabase,
    decision,
    context: {
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: relatedConversationId,
      notificationId: clean(notification.id),
      contractId,
      contractVersionId,
      evidenceSourceMessageId,
      decisionMessageId: args.decisionMessageId,
      channel: args.channel,
    },
  });
  if (decision === "confirmed") {
    await assertConfirmedDecisionPersisted({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: relatedConversationId,
      notificationId: clean(notification.id),
      contractId,
      contractVersionId,
      evidenceSourceMessageId,
    });
    // Keep the inbox event retryable until the customer-facing outbox row is
    // durably queued. The decision RPC is idempotent, so a retry safely
    // replays the confirmation materialization after a lost/failed response.
    await enqueueReceivedContractDocumentConfirmation({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: relatedConversationId,
      notificationId: clean(notification.id),
      contractId,
      contractVersionId,
      evidenceSourceMessageId,
      customerName: contextText(context, "customer_name"),
    });
  }
  const customerName = contextText(context, "customer_name") || "o cliente";
  return {
    kind: "received_contract_document_decision",
    responseText: decision === "confirmed"
      ? `Contrato de ${customerName} marcado como concluido; confirmacao ao cliente enfileirada para envio`
      : `O contrato de ${customerName} continua pendente de conferencia`,
    result,
  };
}
