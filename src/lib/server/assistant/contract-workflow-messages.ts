import type { ContractWorkflowDecisionResult, ContractWorkflowDecisionTrigger } from "@/lib/server/sales-contracts/contract-workflow-decision";

const CONTRACT_WORKFLOW_SOURCE = "assistant_pre_contract_workflow_v1";
const CONTRACT_WORKFLOW_NOTIFICATION_TYPE = "important_alert";

type AssistantContractWorkflowAction =
  | {
      id: "generate_contract";
      label: string;
      kind: "generate_contract";
      requires_confirmation: true;
    }
  | {
      id: "not_closed_yet";
      label: string;
      kind: "not_closed_yet";
    }
  | {
      id: "adjust_quote";
      label: string;
      kind: "adjust_quote";
    }
  | {
      id: "remind_later";
      label: string;
      kind: "remind_later";
    };

export type PushAssistantContractWorkflowDecisionMessageInput = {
  supabase: any;
  organizationId: string;
  storeId: string;
  leadId?: string | null;
  conversationId?: string | null;
  quoteId: string;
  quoteNumber?: string | null;
  customerName?: string | null;
  trigger: ContractWorkflowDecisionTrigger;
  decision: ContractWorkflowDecisionResult;
  summary?: string | null;
  sourceOverride?: string | null;
  availableActionsOverride?: AssistantContractWorkflowAction[] | null;
};

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeTriggerLabel(trigger: ContractWorkflowDecisionTrigger) {
  if (trigger === "customer_requested_contract") return "Cliente pediu contrato";
  if (trigger === "customer_accepted_quote") return "Cliente sinalizou aceite do orcamento";
  if (trigger === "post_visit_human_confirmed") return "Confirmacao humana apos visita";
  if (trigger === "crm_closing_stage") return "Possivel fechamento no CRM";
  if (trigger === "human_explicit_request") return "Pedido humano explicito";
  if (trigger === "system_suggestion") return "Sugestao interna";
  return "Sinal operacional";
}

function buildDefaultAvailableActions(): AssistantContractWorkflowAction[] {
  return [
    {
      id: "generate_contract",
      label: "Gerar contrato",
      kind: "generate_contract",
      requires_confirmation: true,
    },
    {
      id: "not_closed_yet",
      label: "Ainda nao fechou",
      kind: "not_closed_yet",
    },
    {
      id: "adjust_quote",
      label: "Ajustar orcamento",
      kind: "adjust_quote",
    },
    {
      id: "remind_later",
      label: "Me lembrar depois",
      kind: "remind_later",
    },
  ];
}

function buildContractWorkflowContent(
  input: PushAssistantContractWorkflowDecisionMessageInput
) {
  const summary = cleanText(input.summary);
  const lines = [
    "Possivel fechamento identificado.",
    "",
    `Cliente: ${cleanText(input.customerName) || "Nao informado"}`,
    `Orcamento: ${cleanText(input.quoteNumber) || cleanText(input.quoteId) || "Nao informado"}`,
    `Origem do sinal: ${normalizeTriggerLabel(input.trigger)}`,
    "",
    "Antes de gerar contrato, confirme a proxima acao.",
  ];

  if (input.decision.needsHumanConfirmation) {
    lines.push("", "Esse caso precisa de confirmacao humana antes de gerar contrato.");
  }

  if (summary) {
    lines.push("", summary);
  }

  return lines.join("\n");
}

function buildContractWorkflowMetadata(
  input: PushAssistantContractWorkflowDecisionMessageInput
) {
  const source = cleanText(input.sourceOverride) || CONTRACT_WORKFLOW_SOURCE;
  return {
    kind: "contract_workflow_decision",
    organization_id: input.organizationId,
    store_id: input.storeId,
    lead_id: cleanText(input.leadId),
    conversation_id: cleanText(input.conversationId),
    quote_id: cleanText(input.quoteId),
    quote_number: cleanText(input.quoteNumber),
    customer_name: cleanText(input.customerName),
    trigger: input.trigger,
    source,
    decision: {
      allowed: input.decision.allowed,
      needs_human_confirmation: input.decision.needsHumanConfirmation,
      reason_code: input.decision.reasonCode,
      reason_message: input.decision.reasonMessage,
      missing_requirements: input.decision.missingRequirements,
      warnings: input.decision.warnings,
      recommended_next_action: input.decision.recommendedNextAction,
    },
    available_actions:
      input.availableActionsOverride && input.availableActionsOverride.length > 0
        ? input.availableActionsOverride
        : buildDefaultAvailableActions(),
  };
}

function getContractWorkflowNotificationDescriptor(metadata: Record<string, unknown>) {
  const quoteNumber = cleanText(metadata.quote_number) || cleanText(metadata.quote_id) || "sem numero";
  const customerName = cleanText(metadata.customer_name) || "Cliente sem nome";
  const decision = metadata.decision as Record<string, unknown> | null;
  const reasonMessage = cleanText(decision?.reason_message);

  return {
    title: `Possivel contrato para ${quoteNumber}`,
    body:
      reasonMessage ||
      `Ha um possivel fechamento para ${customerName}. Confirme a proxima acao antes de gerar contrato.`,
    priority: "high" as const,
  };
}

async function getOrCreateAssistantPrimaryThread(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
}) {
  const { data: existingThread, error: findError } = await args.supabase
    .from("store_assistant_threads")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("thread_type", "primary")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) {
    throw new Error(`Falha ao buscar thread principal da assistente: ${findError.message}`);
  }

  const existingThreadId = cleanText(existingThread?.id);
  if (existingThreadId) return existingThreadId;

  const { data: createdThread, error: createError } = await args.supabase
    .from("store_assistant_threads")
    .insert({
      organization_id: args.organizationId,
      store_id: args.storeId,
      thread_type: "primary",
      status: "active",
      title: "Assistente operacional",
      created_by: "system",
    })
    .select("id")
    .maybeSingle();

  if (createError || !createdThread?.id) {
    throw new Error(
      createError?.message || "Nao consegui criar a thread principal da assistente."
    );
  }

  return String(createdThread.id);
}

async function findExistingContractWorkflowMessage(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  quoteId: string;
  trigger: ContractWorkflowDecisionTrigger;
  source?: string | null;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_messages")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .contains("metadata", {
      kind: "contract_workflow_decision",
      quote_id: args.quoteId,
      trigger: args.trigger,
      source: cleanText(args.source) || CONTRACT_WORKFLOW_SOURCE,
    })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Falha ao verificar duplicidade de mensagem contract_workflow_decision: ${error.message}`
    );
  }

  return cleanText(data?.id);
}

async function updateAssistantThreadPreview(args: {
  supabase: any;
  threadId: string;
  previewText: string;
}) {
  const now = new Date().toISOString();
  const preview =
    args.previewText.length > 180
      ? `${args.previewText.slice(0, 177).trimEnd()}...`
      : args.previewText;

  const { error } = await args.supabase
    .from("store_assistant_threads")
    .update({
      last_message_at: now,
      last_message_preview: preview,
      updated_at: now,
    })
    .eq("id", args.threadId);

  if (error) {
    throw new Error(`Falha ao atualizar resumo da thread da assistente: ${error.message}`);
  }
}

async function findExistingContractWorkflowNotification(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  notificationType: string;
  relatedLeadId?: string | null;
  relatedConversationId?: string | null;
  eventKey: string;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_notification_queue")
    .select("id, context")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("notification_type", args.notificationType)
    .eq("related_lead_id", args.relatedLeadId || null)
    .eq("related_conversation_id", args.relatedConversationId || null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(
      `Falha ao verificar duplicidade de notificacao contract_workflow_decision: ${error.message}`
    );
  }

  return ((data || []) as Array<{ id?: string | null; context?: Record<string, unknown> | null }>).find(
    (row) => cleanText(row.context?.event_key) === args.eventKey
  );
}

async function enqueueContractWorkflowNotification(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  metadata: Record<string, unknown>;
  relatedLeadId?: string | null;
  relatedConversationId?: string | null;
}) {
  const descriptor = getContractWorkflowNotificationDescriptor(args.metadata);
  const eventKey = [
    "assistant_contract_workflow_decision",
    cleanText(args.metadata.source) || CONTRACT_WORKFLOW_SOURCE,
    cleanText(args.metadata.quote_id) || "unknown",
    cleanText(args.metadata.trigger) || "unknown",
  ].join(":");

  try {
    const existing = await findExistingContractWorkflowNotification({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      notificationType: CONTRACT_WORKFLOW_NOTIFICATION_TYPE,
      relatedLeadId: args.relatedLeadId,
      relatedConversationId: args.relatedConversationId,
      eventKey,
    });

    if (existing?.id) {
      return {
        created: false,
        reason: "notification_already_exists",
      };
    }

    const context = {
      source: cleanText(args.metadata.source) || CONTRACT_WORKFLOW_SOURCE,
      event_key: eventKey,
      kind: cleanText(args.metadata.kind) || "contract_workflow_decision",
      quote_id: cleanText(args.metadata.quote_id),
      quote_number: cleanText(args.metadata.quote_number),
      customer_name: cleanText(args.metadata.customer_name),
      trigger: cleanText(args.metadata.trigger),
      decision: args.metadata.decision || null,
    };

    const { error } = await args.supabase.rpc("assistant_enqueue_internal_notification", {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_notification_type: CONTRACT_WORKFLOW_NOTIFICATION_TYPE,
      p_title: descriptor.title,
      p_body: descriptor.body,
      p_priority: descriptor.priority,
      p_context: context,
      p_related_lead_id: args.relatedLeadId || null,
      p_related_conversation_id: args.relatedConversationId || null,
      p_related_appointment_id: null,
      p_event_key: eventKey,
    });

    if (error) {
      console.warn(
        "[assistant_contract_workflow] assistant_enqueue_internal_notification error:",
        error
      );
      return {
        created: false,
        reason: "notification_rpc_failed",
      };
    }

    return {
      created: true,
      reason: "notification_created",
    };
  } catch (error) {
    console.warn(
      "[assistant_contract_workflow] assistant_enqueue_internal_notification exception:",
      error
    );
    return {
      created: false,
      reason: "notification_exception",
    };
  }
}

export async function pushAssistantContractWorkflowDecisionMessage(
  input: PushAssistantContractWorkflowDecisionMessageInput
) {
  const source = cleanText(input.sourceOverride) || CONTRACT_WORKFLOW_SOURCE;
  const threadId = await getOrCreateAssistantPrimaryThread({
    supabase: input.supabase,
    organizationId: input.organizationId,
    storeId: input.storeId,
  });

  const existingMessageId = await findExistingContractWorkflowMessage({
    supabase: input.supabase,
    organizationId: input.organizationId,
    storeId: input.storeId,
    quoteId: input.quoteId,
    trigger: input.trigger,
    source,
  });

  if (existingMessageId) {
    return {
      ok: true as const,
      deduped: true,
      created: false,
      threadId,
      messageId: existingMessageId,
    };
  }

  const content = buildContractWorkflowContent(input);
  const metadata = buildContractWorkflowMetadata(input);

  const { error } = await input.supabase.rpc("assistant_push_system_message", {
    p_organization_id: input.organizationId,
    p_store_id: input.storeId,
    p_content: content,
    p_message_type: "text",
    p_related_lead_id: cleanText(input.leadId),
    p_related_conversation_id: cleanText(input.conversationId),
    p_related_appointment_id: null,
    p_metadata: metadata,
  });

  if (error) {
    throw new Error(
      `Falha ao criar mensagem contract_workflow_decision da assistente: ${error.message}`
    );
  }

  await updateAssistantThreadPreview({
    supabase: input.supabase,
    threadId,
    previewText: content,
  });

  await enqueueContractWorkflowNotification({
    supabase: input.supabase,
    organizationId: input.organizationId,
    storeId: input.storeId,
    metadata,
    relatedLeadId: cleanText(input.leadId),
    relatedConversationId: cleanText(input.conversationId),
  });

  return {
    ok: true as const,
    deduped: false,
    created: true,
    threadId,
    messageId: null,
  };
}
