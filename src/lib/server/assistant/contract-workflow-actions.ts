import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  authenticateQuoteRequest,
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";
import { executeAssistantContractGeneration } from "@/lib/server/assistant/contract-generation-intent";

export type AssistantContractWorkflowAction = "generate_contract";

type ContractWorkflowMessageRow = {
  id: string;
  organization_id: string;
  store_id: string;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  metadata?: Record<string, unknown> | null;
};

type ExecuteAssistantContractWorkflowActionArgs = {
  request: Request;
  action: AssistantContractWorkflowAction;
  messageId: string;
};

type ExecuteAssistantContractWorkflowActionResult = {
  ok: boolean;
  status: number;
  action: AssistantContractWorkflowAction;
  messageId: string;
  message: string;
  error?: string;
};

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function ensureAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      ok: false as const,
      status: 401,
      error: "UNAUTHORIZED",
      message: error?.message || "Usuario nao autenticado.",
    };
  }

  return {
    ok: true as const,
    userId: user.id,
  };
}

async function loadAuthorizedContractWorkflowMessage(messageId: string) {
  const auth = await authenticateQuoteRequest();
  const safeMessageId = String(messageId || "").trim();

  if (!safeMessageId) {
    throw new QuoteAccessError(400, "INVALID_MESSAGE_ID", "Message ID nao informado.");
  }

  const { data, error } = await auth.supabase
    .from("store_assistant_messages")
    .select("id, organization_id, store_id, related_lead_id, related_conversation_id, metadata")
    .eq("id", safeMessageId)
    .in("organization_id", auth.organizationIds)
    .maybeSingle<ContractWorkflowMessageRow>();

  if (error) {
    throw new QuoteAccessError(
      500,
      "LOAD_ASSISTANT_MESSAGE_FAILED",
      `Falha ao carregar mensagem da assistente: ${error.message}`
    );
  }

  if (!data) {
    throw new QuoteAccessError(
      404,
      "ASSISTANT_MESSAGE_NOT_FOUND",
      "Nao encontrei esse card da assistente."
    );
  }

  return {
    ...auth,
    message: data,
  };
}

function readContractWorkflowMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!isRecord(metadata)) return null;
  if (cleanText(metadata.kind) !== "contract_workflow_decision") return null;
  return metadata;
}

async function pushAssistantActionResultMessage(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  leadId?: string | null;
  conversationId?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await args.supabase.rpc("assistant_push_system_message", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_content: args.content,
    p_message_type: "text",
    p_related_lead_id: cleanText(args.leadId),
    p_related_conversation_id: cleanText(args.conversationId),
    p_related_appointment_id: null,
    p_metadata: args.metadata || {
      source: "assistant_contract_workflow_action_v1",
    },
  });

  if (error) {
    throw new Error(
      `Falha ao registrar resposta da assistente para contract_workflow_action: ${error.message}`
    );
  }
}

async function generateContractFromWorkflowCard(
  request: Request,
  workflowMessageId: string
) {
  const messageScope = await loadAuthorizedContractWorkflowMessage(workflowMessageId);
  const messageMetadata = readContractWorkflowMetadata(messageScope.message.metadata || null);

  if (!messageMetadata) {
    return {
      ok: false as const,
      status: 409,
      error: "INVALID_CONTRACT_WORKFLOW_MESSAGE",
      message: "Esse card nao representa uma decisao valida de pre-contrato.",
    };
  }

  const messageOrganizationId = cleanText(messageScope.message.organization_id);
  const messageStoreId = cleanText(messageScope.message.store_id);

  if (!messageOrganizationId || !messageStoreId) {
    return {
      ok: false as const,
      status: 409,
      error: "INVALID_CONTRACT_WORKFLOW_SCOPE",
      message: "Esse card nao tem escopo valido de organizacao e loja.",
    };
  }

  const quoteId = cleanText(messageMetadata.quote_id);
  const quoteNumber = cleanText(messageMetadata.quote_number);

  if (!quoteId) {
    return {
      ok: false as const,
      status: 409,
      error: "QUOTE_REFERENCE_MISSING",
      message: "Nao encontrei esse orcamento. Confira o numero e tente novamente.",
    };
  }

  const quoteScope = await resolveAuthorizedExistingQuote(quoteId);

  if (
    quoteScope.organizationId !== messageOrganizationId ||
    quoteScope.store.id !== messageStoreId
  ) {
    return {
      ok: false as const,
      status: 403,
      error: "QUOTE_SCOPE_MISMATCH",
      message: "Nao encontrei esse orcamento no escopo da loja atual.",
    };
  }

  const messageLeadId =
    cleanText(messageMetadata.lead_id) || cleanText(messageScope.message.related_lead_id);
  const messageConversationId =
    cleanText(messageMetadata.conversation_id) ||
    cleanText(messageScope.message.related_conversation_id);

  if (
    messageLeadId &&
    cleanText(quoteScope.quote.lead_id) &&
    messageLeadId !== cleanText(quoteScope.quote.lead_id)
  ) {
    return {
      ok: false as const,
      status: 409,
      error: "QUOTE_LEAD_MISMATCH",
      message: "Nao consegui confirmar esse orcamento com a lead do card atual.",
    };
  }

  if (
    messageConversationId &&
    cleanText(quoteScope.quote.conversation_id) &&
    messageConversationId !== cleanText(quoteScope.quote.conversation_id)
  ) {
    return {
      ok: false as const,
      status: 409,
      error: "QUOTE_CONVERSATION_MISMATCH",
      message: "Nao consegui confirmar esse orcamento com a conversa do card atual.",
    };
  }

  const execution = await executeAssistantContractGeneration({
    request,
    supabase: messageScope.supabase,
    organizationId: messageOrganizationId,
    storeId: messageStoreId,
    quoteId,
    quoteNumber,
    source: "assistant_contract_workflow_button_v1",
  });

  await pushAssistantActionResultMessage({
    supabase: messageScope.supabase,
    organizationId: messageOrganizationId,
    storeId: messageStoreId,
    leadId: messageLeadId,
    conversationId: messageConversationId,
    content: execution.reply,
    metadata: {
      source: "assistant_contract_workflow_button_v1",
      kind: "contract_workflow_action_result",
      related_workflow_message_id: workflowMessageId,
      action: "generate_contract",
      quote_id: quoteId,
      quote_number: quoteNumber,
      contract_id: execution.contractId || null,
      result_ok: execution.ok,
      reason_code: cleanText(execution.metadata.reasonCode),
      trigger: "human_explicit_request",
    },
  });

  return {
    ok: execution.ok,
    status: execution.status,
    error: execution.ok ? undefined : cleanText(execution.metadata.reasonCode) || "CONTRACT_WORKFLOW_ACTION_FAILED",
    message: execution.reply,
  };
}

export async function executeAssistantContractWorkflowAction(
  args: ExecuteAssistantContractWorkflowActionArgs
): Promise<ExecuteAssistantContractWorkflowActionResult> {
  const auth = await ensureAuthenticatedUser();
  if (!auth.ok) {
    return {
      ok: false,
      status: auth.status,
      action: args.action,
      messageId: args.messageId,
      error: auth.error,
      message: auth.message,
    };
  }

  try {
    const result = await generateContractFromWorkflowCard(args.request, args.messageId);

    return {
      ok: result.ok,
      status: result.status,
      action: args.action,
      messageId: args.messageId,
      error: result.ok ? undefined : result.error,
      message: result.message,
    };
  } catch (error) {
    if (error instanceof QuoteAccessError) {
      return {
        ok: false,
        status: error.status,
        action: args.action,
        messageId: args.messageId,
        error: error.code,
        message: error.message,
      };
    }

    return {
      ok: false,
      status: 500,
      action: args.action,
      messageId: args.messageId,
      error: "ASSISTANT_CONTRACT_WORKFLOW_ACTION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "Nao consegui gerar o contrato agora. Tente novamente em instantes.",
    };
  }
}
