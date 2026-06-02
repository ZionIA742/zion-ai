const DOCUMENT_REVIEW_SOURCE = "assistant_document_workflow_v1";
const DOCUMENT_REVIEW_PROMPT =
  "Esse documento pode ser enviado ou precisa ser editado? Caso precise ser editado, me diga o que precisa que eu edito.";
const DOCUMENT_REVIEW_NOTIFICATION_TYPE = "important_alert";

type AssistantDocumentReviewAction =
  | {
      id: "review";
      label: string;
      kind: "open_document";
    }
  | {
      id: "approve_and_send";
      label: string;
      kind: "approve_and_send";
      requires_confirmation: true;
    }
  | {
      id: "confirm_store_signature";
      label: string;
      kind: "confirm_store_signature";
      requires_confirmation: true;
    };

type PushAssistantDocumentReviewMessageInput = {
  supabase: any;
  organizationId: string;
  storeId: string;
  documentType: "quote" | "contract";
  documentId: string;
  documentVersionId: string;
  documentNumber: string | null;
  documentStatus: string | null;
  relatedQuoteId?: string | null;
  relatedContractId?: string | null;
  relatedLeadId?: string | null;
  relatedConversationId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  originalFileName?: string | null;
  fileKind?: string | null;
  mimeType?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  contentOverride?: string | null;
  assistantPromptOverride?: string | null;
  availableActionsOverride?: AssistantDocumentReviewAction[] | null;
  sourceOverride?: string | null;
};

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeDocumentStatusLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "pending_review") return "Aguardando revisao";
  if (normalized === "approved") return "Aprovado";
  if (normalized === "sent" || normalized === "sent_to_customer") return "Enviado";
  if (normalized === "customer_signed") return "Aguardando confirmacao da loja";
  if (normalized === "completed") return "Concluido";
  if (normalized === "cancelled") return "Cancelado";
  if (normalized === "expired") return "Expirado";
  if (normalized === "failed") return "Falhou";
  return cleanText(value) || "Aguardando revisao";
}

function getDefaultAssistantPrompt(input: PushAssistantDocumentReviewMessageInput) {
  const status = String(input.documentStatus || "").trim().toLowerCase();

  if (status === "customer_signed") {
    return "O cliente aceitou este contrato. Revise o documento se necessario e confirme pela loja para concluir o processo.";
  }

  if (status === "completed") {
    return "Documento concluido. Voce ainda pode revisar o arquivo se precisar.";
  }

  if (status === "sent" || status === "sent_to_customer") {
    return "Documento enviado ao cliente. Voce ainda pode revisar o arquivo se precisar.";
  }

  if (status === "failed") {
    return "Houve uma falha neste documento. Revise o caso antes de seguir.";
  }

  if (status === "cancelled") {
    return "Documento cancelado. Voce ainda pode revisar o arquivo se precisar.";
  }

  if (status === "expired") {
    return "Documento expirado. Revise o caso antes de seguir.";
  }

  if (status === "approved") {
    return "Documento aprovado. Revise o arquivo e siga com o envio quando estiver tudo certo.";
  }

  return DOCUMENT_REVIEW_PROMPT;
}

function buildDocumentReviewContent(input: PushAssistantDocumentReviewMessageInput) {
  if (cleanText(input.contentOverride)) {
    return String(input.contentOverride).trim();
  }

  const documentLabel =
    input.documentType === "contract" ? "Contrato pronto para revisao." : "Orcamento pronto para revisao.";
  const customerLine = `Cliente: ${cleanText(input.customerName) || "Nao informado"}`;
  const documentLine = `Documento: ${cleanText(input.documentNumber) || cleanText(input.documentId) || "Nao informado"}`;
  const statusLine = `Status atual: ${normalizeDocumentStatusLabel(input.documentStatus)}`;
  const closingLine =
    input.documentType === "contract"
      ? "Esse contrato precisa ser revisado pelo responsavel antes de ser enviado ao cliente."
      : "Esse orcamento precisa ser revisado pelo responsavel antes de ser enviado ao cliente.";

  return [documentLabel, "", customerLine, documentLine, statusLine, "", closingLine].join("\n");
}

function buildDefaultAvailableActions(
  input: PushAssistantDocumentReviewMessageInput
): AssistantDocumentReviewAction[] {
  return [
    {
      id: "review",
      label: "Revisar",
      kind: "open_document",
    },
    ...(input.documentType === "contract"
      ? ([
          {
            id: "approve_and_send",
            label: "Aprovar e enviar",
            kind: "approve_and_send",
            requires_confirmation: true,
          },
        ] satisfies AssistantDocumentReviewAction[])
      : ([
          {
            id: "approve_and_send",
            label: "Aprovar e enviar",
            kind: "approve_and_send",
            requires_confirmation: true,
          },
        ] satisfies AssistantDocumentReviewAction[])),
  ];
}

function buildDocumentReviewMetadata(input: PushAssistantDocumentReviewMessageInput) {
  const source = cleanText(input.sourceOverride) || DOCUMENT_REVIEW_SOURCE;
  return {
    kind: "document_review",
    document_type: input.documentType,
    document_id: input.documentId,
    document_version_id: input.documentVersionId,
    document_number: cleanText(input.documentNumber),
    document_status: cleanText(input.documentStatus) || "pending_review",
    related_quote_id:
      input.documentType === "quote"
        ? cleanText(input.relatedQuoteId) || input.documentId
        : cleanText(input.relatedQuoteId),
    related_contract_id:
      input.documentType === "contract"
        ? cleanText(input.relatedContractId) || input.documentId
        : cleanText(input.relatedContractId),
    related_lead_id: cleanText(input.relatedLeadId),
    related_conversation_id: cleanText(input.relatedConversationId),
    customer_name: cleanText(input.customerName),
    customer_phone: cleanText(input.customerPhone),
    storage_bucket: cleanText(input.storageBucket),
    storage_path: cleanText(input.storagePath),
    file_kind: cleanText(input.fileKind),
    mime_type: cleanText(input.mimeType) || "application/pdf",
    original_file_name: cleanText(input.originalFileName),
    assistant_prompt:
      cleanText(input.assistantPromptOverride) || getDefaultAssistantPrompt(input),
    available_actions:
      input.availableActionsOverride && input.availableActionsOverride.length > 0
        ? input.availableActionsOverride
        : buildDefaultAvailableActions(input),
    source,
  };
}

function getDocumentNotificationDescriptor(metadata: Record<string, unknown>) {
  const status = String(metadata.document_status || "").trim().toLowerCase();
  const documentType = String(metadata.document_type || "").trim().toLowerCase();
  const availableActions = Array.isArray(metadata.available_actions)
    ? metadata.available_actions
    : [];
  const documentLabel = documentType === "contract" ? "Contrato" : "Orcamento";
  const documentNumber =
    cleanText(metadata.document_number) || cleanText(metadata.document_id) || "sem numero";
  const canApproveAndSend = availableActions.some((action) => {
    if (!action || typeof action !== "object") return false;
    const item = action as Record<string, unknown>;
    const id = cleanText(item.id);
    const kind = cleanText(item.kind);
    return id === "approve_and_send" || kind === "approve_and_send";
  });
  const canConfirmStoreSignature = availableActions.some((action) => {
    if (!action || typeof action !== "object") return false;
    const item = action as Record<string, unknown>;
    const id = cleanText(item.id);
    const kind = cleanText(item.kind);
    return id === "confirm_store_signature" || kind === "confirm_store_signature";
  });

  if (status === "pending_review" && canApproveAndSend) {
    return {
      title: `${documentLabel} ${documentNumber} aguardando revisao`,
      body: `${documentLabel} pronto para revisao e envio ao cliente.`,
      priority: "high" as const,
      needsHumanAction: true,
      reason: "pending_review",
    };
  }

  if (status === "customer_signed" && canConfirmStoreSignature) {
    return {
      title: `${documentLabel} ${documentNumber} aguardando confirmacao da loja`,
      body: "O cliente aceitou este contrato. Revise e confirme pela loja para concluir o processo.",
      priority: "high" as const,
      needsHumanAction: true,
      reason: "customer_signed",
    };
  }

  return null;
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

async function findExistingDocumentReviewMessage(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  documentType: "quote" | "contract";
  documentId: string;
  documentVersionId: string;
  documentStatus?: string | null;
  source?: string | null;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_messages")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .contains("metadata", {
      kind: "document_review",
      document_type: args.documentType,
      document_id: args.documentId,
      document_version_id: args.documentVersionId,
      ...(cleanText(args.documentStatus)
        ? { document_status: cleanText(args.documentStatus) }
        : {}),
      source: cleanText(args.source) || DOCUMENT_REVIEW_SOURCE,
    })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Falha ao verificar duplicidade de mensagem document_review: ${error.message}`
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

async function findExistingDocumentReviewNotification(args: {
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
      `Falha ao verificar duplicidade de notificacao document_review: ${error.message}`
    );
  }

  return ((data || []) as Array<{ id?: string | null; context?: Record<string, unknown> | null }>).find(
    (row) => cleanText(row.context?.event_key) === args.eventKey
  );
}

async function enqueueDocumentReviewNotification(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  metadata: Record<string, unknown>;
  relatedLeadId?: string | null;
  relatedConversationId?: string | null;
}) {
  const descriptor = getDocumentNotificationDescriptor(args.metadata);
  if (!descriptor?.needsHumanAction) {
    return {
      created: false,
      reason: "no_pending_human_action",
    };
  }

  const eventKey = [
    "assistant_document_review",
    cleanText(args.metadata.source) || DOCUMENT_REVIEW_SOURCE,
    cleanText(args.metadata.document_type) || "unknown",
    cleanText(args.metadata.document_id) || "unknown",
    cleanText(args.metadata.document_version_id) || "unknown",
    cleanText(args.metadata.document_status) || "unknown",
  ].join(":");

  try {
    const existing = await findExistingDocumentReviewNotification({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      notificationType: DOCUMENT_REVIEW_NOTIFICATION_TYPE,
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
      source: cleanText(args.metadata.source) || DOCUMENT_REVIEW_SOURCE,
      reason: descriptor.reason,
      event_key: eventKey,
      needs_human_action: true,
      document_type: cleanText(args.metadata.document_type),
      document_id: cleanText(args.metadata.document_id),
      document_version_id: cleanText(args.metadata.document_version_id),
      document_number: cleanText(args.metadata.document_number),
      document_status: cleanText(args.metadata.document_status),
      related_quote_id: cleanText(args.metadata.related_quote_id),
      related_contract_id: cleanText(args.metadata.related_contract_id),
    };

    const { error } = await args.supabase.rpc("assistant_enqueue_internal_notification", {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_notification_type: DOCUMENT_REVIEW_NOTIFICATION_TYPE,
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
        "[assistant_document_review] assistant_enqueue_internal_notification error:",
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
      "[assistant_document_review] assistant_enqueue_internal_notification exception:",
      error
    );
    return {
      created: false,
      reason: "notification_exception",
    };
  }
}

export async function pushAssistantDocumentReviewMessage(
  input: PushAssistantDocumentReviewMessageInput
) {
  const source = cleanText(input.sourceOverride) || DOCUMENT_REVIEW_SOURCE;
  const threadId = await getOrCreateAssistantPrimaryThread({
    supabase: input.supabase,
    organizationId: input.organizationId,
    storeId: input.storeId,
  });

  const existingMessageId = await findExistingDocumentReviewMessage({
    supabase: input.supabase,
    organizationId: input.organizationId,
    storeId: input.storeId,
    documentType: input.documentType,
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
    documentStatus: input.documentStatus,
    source,
  });

  if (existingMessageId) {
    return {
      ok: true as const,
      deduped: true,
      threadId,
      messageId: existingMessageId,
    };
  }

  const content = buildDocumentReviewContent(input);
  const metadata = buildDocumentReviewMetadata(input);

  const { error } = await input.supabase.rpc("assistant_push_system_message", {
    p_organization_id: input.organizationId,
    p_store_id: input.storeId,
    p_content: content,
    p_message_type: "text",
    p_related_lead_id: cleanText(input.relatedLeadId),
    p_related_conversation_id: cleanText(input.relatedConversationId),
    p_related_appointment_id: null,
    p_metadata: metadata,
  });

  if (error) {
    throw new Error(`Falha ao criar mensagem document_review da assistente: ${error.message}`);
  }

  await updateAssistantThreadPreview({
    supabase: input.supabase,
    threadId,
    previewText: content,
  });

  await enqueueDocumentReviewNotification({
    supabase: input.supabase,
    organizationId: input.organizationId,
    storeId: input.storeId,
    metadata,
    relatedLeadId: cleanText(input.relatedLeadId),
    relatedConversationId: cleanText(input.relatedConversationId),
  });

  return {
    ok: true as const,
    deduped: false,
    threadId,
    messageId: null,
  };
}
