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
      p_conversation_id: context.conversationId,
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
  supabase: any;
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
  supabase: any;
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
  supabase: any;
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
  const ids = [...new Set((data || []).map((row: any) => clean(row.internal_notification_id)).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

export async function tryHandleReceivedContractDocumentDecision(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  decisionMessageId: string;
  content: string;
  channel: ReceivedContractDocumentDecisionChannel;
  contextMessageId?: string | null;
}): Promise<ReceivedContractDocumentDecisionHandled | null> {
  const decision = resolveReceivedContractDocumentDecision(args.content);
  if (!decision) return null;

  const message = await loadDecisionMessageScope(args);
  if (!message) return null;

  const notifications = await loadReceivedContractNotifications(args);
  let candidates = notifications.filter((notification) => {
    const context = notification.context;
    return contextText(context, "received_identification_status") === "identified" &&
      contextText(context, "related_contract_id") !== "" &&
      contextText(context, "document_version_id") !== "" &&
      contextText(context, "received_evidence_source_message_id") !== "";
  });

  const contextMessageId = clean(args.contextMessageId);
  if (args.channel === "whatsapp") {
    if (!contextMessageId) return null;
    const notificationId = await resolveWhatsappNotificationId({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      contextMessageId,
    });
    candidates = notificationId
      ? candidates.filter((notification) => clean(notification.id) === notificationId)
      : [];
  } else {
    candidates = candidates.filter((notification) =>
      clean(notification.thread_id) !== "" &&
      clean(notification.thread_id) === clean(message.thread_id),
    );
  }

  if (candidates.length !== 1) return null;
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
    try {
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
    } catch (error) {
      console.error(
        "[received-contract-document] confirmation materialization failed after decision commit",
        error instanceof Error ? error.message : "unknown_error",
      );
    }
  }
  const customerName = contextText(context, "customer_name") || "o cliente";
  return {
    kind: "received_contract_document_decision",
    responseText: decision === "confirmed"
      ? `Contrato de ${customerName} marcado como concluido.`
      : `O contrato de ${customerName} continua pendente de conferencia.`,
    result,
  };
}
