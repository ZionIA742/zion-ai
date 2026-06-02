const DOCUMENT_REVIEW_SOURCE = "assistant_document_workflow_v1";
const DOCUMENT_REVIEW_PROMPT =
  "Esse documento pode ser enviado ou precisa ser editado? Caso precise ser editado, me diga o que precisa que eu edito.";

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
  return cleanText(value) || "Aguardando revisao";
}

function buildDocumentReviewContent(input: PushAssistantDocumentReviewMessageInput) {
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

function buildDocumentReviewMetadata(input: PushAssistantDocumentReviewMessageInput) {
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
    assistant_prompt: DOCUMENT_REVIEW_PROMPT,
    available_actions: [
      {
        id: "review",
        label: "Revisar",
        kind: "open_document",
      },
      {
        id: "approve_and_send",
        label: "Aprovar e enviar",
        kind: "approve_and_send",
        requires_confirmation: true,
      },
    ],
    source: DOCUMENT_REVIEW_SOURCE,
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

async function findExistingDocumentReviewMessage(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  documentType: "quote" | "contract";
  documentId: string;
  documentVersionId: string;
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
      source: DOCUMENT_REVIEW_SOURCE,
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

export async function pushAssistantDocumentReviewMessage(
  input: PushAssistantDocumentReviewMessageInput
) {
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

  return {
    ok: true as const,
    deduped: false,
    threadId,
    messageId: null,
  };
}
