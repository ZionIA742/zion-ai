import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  authenticateQuoteRequest,
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";

export type AssistantContractWorkflowAction =
  | "generate_contract"
  | "confirm_customer_acceptance";

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

type ContractWorkflowActionDeps = {
  ensureAuthenticatedUser: typeof ensureAuthenticatedUser;
  loadAuthorizedContractWorkflowMessage: typeof loadAuthorizedContractWorkflowMessage;
  resolveAuthorizedExistingQuote: typeof resolveAuthorizedExistingQuote;
  pushAssistantActionResultMessage: typeof pushAssistantActionResultMessage;
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

function readAvailableActionIds(metadata: Record<string, unknown>) {
  return new Set(
    Array.isArray(metadata.available_actions)
      ? metadata.available_actions
          .map((action) => (isRecord(action) ? cleanText(action.id) : cleanText(action)))
          .filter((action): action is string => Boolean(action))
      : [],
  );
}

function mapCustomerAcceptanceRpcError(error: { code?: string | null; message?: string | null }) {
  const raw = `${error.code || ""} ${error.message || ""}`;
  const knownCodes = [
    "PROPOSAL_STALE",
    "CURRENT_PROPOSAL_CYCLE_UNANCHORED",
    "SOURCE_MESSAGE_NOT_CUSTOMER_INBOUND",
    "SOURCE_MESSAGE_PREDATES_PROPOSAL",
    "SOURCE_MESSAGE_OUT_OF_SCOPE",
    "OPPORTUNITY_OUT_OF_SCOPE",
  ];
  const reasonCode = knownCodes.find((code) => raw.includes(code));
  return reasonCode || "CUSTOMER_ACCEPTANCE_CONFIRMATION_FAILED";
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
  workflowMessageId: string,
  deps: Pick<
    ContractWorkflowActionDeps,
    | "loadAuthorizedContractWorkflowMessage"
    | "pushAssistantActionResultMessage"
    | "resolveAuthorizedExistingQuote"
  >
) {
  const messageScope = await deps.loadAuthorizedContractWorkflowMessage(workflowMessageId);
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
  const quoteVersionId = cleanText(messageMetadata.quote_version_id);
  const quoteNumber = cleanText(messageMetadata.quote_number);

  if (!quoteId) {
    return {
      ok: false as const,
      status: 409,
      error: "QUOTE_REFERENCE_MISSING",
      message: "Nao encontrei esse orcamento. Confira o numero e tente novamente.",
    };
  }

  if (!quoteVersionId) {
    return {
      ok: false as const,
      status: 409,
      error: "QUOTE_VERSION_REFERENCE_MISSING",
      message: "Nao encontrei a versao exata desse orcamento no card atual.",
    };
  }

  const quoteScope = await deps.resolveAuthorizedExistingQuote(quoteId);

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

  const guidanceMessage =
    "Posso orientar sobre o contrato, mas a criacao, o preenchimento, a geracao do PDF e o envio devem ser realizados manualmente no CRM por um responsavel autorizado.";

  await deps.pushAssistantActionResultMessage({
    supabase: messageScope.supabase,
    organizationId: messageOrganizationId,
    storeId: messageStoreId,
    leadId: messageLeadId,
    conversationId: messageConversationId,
    content: guidanceMessage,
    metadata: {
      source: "assistant_contract_workflow_button_v1",
      kind: "contract_workflow_action_result",
      related_workflow_message_id: workflowMessageId,
      action: "generate_contract",
      quote_id: quoteId,
      quote_version_id: quoteVersionId,
      quote_number: quoteNumber,
      contract_id: null,
      result_ok: false,
      reason_code: "ASSISTANT_CONTRACT_OPERATION_REQUIRES_CRM",
      trigger: "human_explicit_request",
    },
  });

  return {
    ok: false as const,
    status: 409,
    error: "ASSISTANT_CONTRACT_OPERATION_REQUIRES_CRM",
    message: guidanceMessage,
  };
}

async function confirmCustomerAcceptanceFromWorkflowCard(
  workflowMessageId: string,
  deps: Pick<
    ContractWorkflowActionDeps,
    | "loadAuthorizedContractWorkflowMessage"
    | "resolveAuthorizedExistingQuote"
    | "pushAssistantActionResultMessage"
  >,
) {
  const messageScope = await deps.loadAuthorizedContractWorkflowMessage(workflowMessageId);
  const messageMetadata = readContractWorkflowMetadata(messageScope.message.metadata || null);

  if (!messageMetadata || cleanText(messageMetadata.trigger) !== "customer_accepted_quote") {
    return {
      ok: false as const,
      status: 409,
      error: "INVALID_CUSTOMER_ACCEPTANCE_CARD",
      message: "Esse card nao representa um aceite explicito do cliente.",
    };
  }

  if (!readAvailableActionIds(messageMetadata).has("confirm_customer_acceptance")) {
    return {
      ok: false as const,
      status: 409,
      error: "CUSTOMER_ACCEPTANCE_ACTION_NOT_AUTHORIZED",
      message: "Esse card nao possui autorizacao para confirmar o aceite.",
    };
  }

  const organizationId = cleanText(messageScope.message.organization_id);
  const storeId = cleanText(messageScope.message.store_id);
  const metadataOrganizationId = cleanText(messageMetadata.organization_id);
  const metadataStoreId = cleanText(messageMetadata.store_id);
  const commercialOpportunityId = cleanText(messageMetadata.commercial_opportunity_id);
  const quoteId = cleanText(messageMetadata.quote_id);
  const quoteVersionId = cleanText(messageMetadata.quote_version_id);
  const sourceMessageId = cleanText(messageMetadata.source_message_id);
  const lifecycleCycleRaw = messageMetadata.lifecycle_cycle;
  const lifecycleCycle =
    typeof lifecycleCycleRaw === "number" && Number.isInteger(lifecycleCycleRaw)
      ? lifecycleCycleRaw
      : null;

  if (
    !organizationId ||
    !storeId ||
    !commercialOpportunityId ||
    !quoteId ||
    !quoteVersionId ||
    !sourceMessageId ||
    lifecycleCycle === null
  ) {
    return {
      ok: false as const,
      status: 409,
      error: "CUSTOMER_ACCEPTANCE_EVIDENCE_INCOMPLETE",
      message: "O card nao preserva todas as evidencias canonicas do aceite.",
    };
  }

  if (
    (metadataOrganizationId && metadataOrganizationId !== organizationId) ||
    (metadataStoreId && metadataStoreId !== storeId)
  ) {
    return {
      ok: false as const,
      status: 403,
      error: "CUSTOMER_ACCEPTANCE_SCOPE_MISMATCH",
      message: "O card nao pertence ao escopo autorizado da loja.",
    };
  }

  const quoteScope = await deps.resolveAuthorizedExistingQuote(quoteId);
  if (
    quoteScope.organizationId !== organizationId ||
    quoteScope.store.id !== storeId ||
    cleanText(quoteScope.quote.current_version_id) !== quoteVersionId
  ) {
    return {
      ok: false as const,
      status: 409,
      error: "PROPOSAL_STALE",
      message: "A versao exibida no card nao e mais a proposta vigente.",
    };
  }

  const { data, error } = await messageScope.sessionSupabase.rpc(
    "accept_current_commercial_proposal_customer_signal_by_user",
    {
      p_organization_id: organizationId,
      p_store_id: storeId,
      p_commercial_opportunity_id: commercialOpportunityId,
      p_expected_lifecycle_cycle: lifecycleCycle,
      p_quote_id: quoteId,
      p_quote_version_id: quoteVersionId,
      p_source_message_id: sourceMessageId,
    },
  );

  if (error) {
    const reasonCode = mapCustomerAcceptanceRpcError(error);
    return {
      ok: false as const,
      status: reasonCode === "PROPOSAL_STALE" ? 409 : 422,
      error: reasonCode,
      message:
        reasonCode === "PROPOSAL_STALE"
          ? "A proposta mudou antes da confirmacao; nenhuma confirmacao foi registrada."
          : "Nao foi possivel confirmar o aceite com as evidencias atuais.",
    };
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const outcome = cleanText(rows[0]?.outcome);
  if (rows.length !== 1 || (outcome !== "accepted" && outcome !== "already_accepted")) {
    return {
      ok: false as const,
      status: 502,
      error: "CUSTOMER_ACCEPTANCE_RESULT_UNCERTAIN",
      message: "A resposta da confirmacao nao foi inequivoca; nenhuma nova tentativa sera feita automaticamente.",
    };
  }

  const message =
    outcome === "already_accepted"
      ? "O aceite do cliente ja estava confirmado para esta versao."
      : "Aceite do cliente confirmado para a versao exata apresentada.";

  try {
    await deps.pushAssistantActionResultMessage({
      supabase: messageScope.supabase,
      organizationId,
      storeId,
      leadId: cleanText(messageMetadata.lead_id) || messageScope.message.related_lead_id,
      conversationId:
        cleanText(messageMetadata.conversation_id) || messageScope.message.related_conversation_id,
      content: message,
      metadata: {
        source: "assistant_customer_acceptance_confirmation_v1",
        kind: "contract_workflow_action_result",
        related_workflow_message_id: workflowMessageId,
        action: "confirm_customer_acceptance",
        quote_id: quoteId,
        quote_version_id: quoteVersionId,
        source_message_id: sourceMessageId,
        outcome,
        trigger: "human_explicit_request",
      },
    });
  } catch (resultMessageError) {
    console.warn("[assistant_customer_acceptance] resultado confirmado, mas aviso nao registrado", resultMessageError);
  }

  return { ok: true as const, status: 200, message };
}

export async function executeAssistantContractWorkflowAction(
  args: ExecuteAssistantContractWorkflowActionArgs,
  deps?: Partial<ContractWorkflowActionDeps>
): Promise<ExecuteAssistantContractWorkflowActionResult> {
  const resolvedDeps: ContractWorkflowActionDeps = {
    ensureAuthenticatedUser,
    loadAuthorizedContractWorkflowMessage,
    resolveAuthorizedExistingQuote,
    pushAssistantActionResultMessage,
    ...deps,
  };

  const auth = await resolvedDeps.ensureAuthenticatedUser();
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
    const result =
      args.action === "confirm_customer_acceptance"
        ? await confirmCustomerAcceptanceFromWorkflowCard(args.messageId, resolvedDeps)
        : await generateContractFromWorkflowCard(args.messageId, resolvedDeps);

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
