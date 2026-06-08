import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAndSaveAiSalesReply } from "@/lib/server/generate-and-save-ai-sales-reply";

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

type InboxRow = {
  id: string;
  organization_id: string;
  store_id: string;
  provider: string | null;
  external_event_id: string;
  payload: Json;
  received_at: string | null;
  processed_at: string | null;
  processing_error: string | null;
};

type LeadRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
  name: string | null;
  phone: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ConversationRow = {
  id: string;
  organization_id: string;
  lead_id: string;
  status: string | null;
  is_human_active?: boolean | null;
  last_message_at: string | null;
  created_at: string | null;
};

type ConversationAiWindowStateRow = {
  conversation_id: string;
  next_resume_at: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  lead_id: string | null;
  store_id: string | null;
  external_message_id: string | null;
};

type MetaTextPayload = {
  body?: unknown;
};

type MetaMessagePayload = {
  id?: unknown;
  from?: unknown;
  type?: unknown;
  text?: MetaTextPayload | null;
};

type StoredInboxPayload = {
  source?: unknown;
  event_kind?: unknown;
  phone_number_id?: unknown;
  whatsapp_business_account_id?: unknown;
  display_phone_number?: unknown;
  message?: MetaMessagePayload | null;
  raw_payload?: {
    entry?: Array<{
      changes?: Array<{
        value?: {
          contacts?: Array<{
            profile?: {
              name?: unknown;
            } | null;
          }>;
        };
      }>;
    }>;
  } | null;
};

type InsertMessageResult = {
  id?: string | null;
  conversation_id?: string | null;
  lead_id?: string | null;
  store_id?: string | null;
};

export type ProcessWhatsappInboxInput = {
  organizationId: string;
  storeId: string;
  limit?: number;
};

type ProcessorStatus = "succeeded" | "failed" | "skipped";
type ProcessorAiStatus =
  | "called"
  | "skipped_human_active"
  | "skipped_ai_paused"
  | "skipped_not_text"
  | "skipped_duplicate"
  | "failed";

type ProcessorResultItem = {
  inbox_id: string;
  external_event_id: string;
  status: ProcessorStatus;
  message_id?: string | null;
  lead_id?: string | null;
  conversation_id?: string | null;
  detail?: string;
  ai_status?: ProcessorAiStatus;
  ai_message_id?: string | null;
  ai_error?: string | null;
};

export type ProcessWhatsappInboxResult = {
  ok: true;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: ProcessorResultItem[];
};

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL nao esta definido.");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY nao esta definido.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizePhone(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength);
}

function safeProcessingError(value: unknown): string {
  const text =
    value instanceof Error ? value.message : String(value || "processing_failed");
  return truncateText(text.trim() || "processing_failed", 1000);
}

function safeAiError(value: unknown): string {
  return truncateText(safeProcessingError(value), 300);
}

function isDuplicateError(error: { code?: string | null; message?: string | null }) {
  const code = String(error.code || "").trim();
  const message = String(error.message || "").toLowerCase();

  return code === "23505" || message.includes("duplicate key");
}

function isFutureIso(value: string | null | undefined): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return parsed > Date.now();
}

function extractContactName(payload: StoredInboxPayload): string | null {
  const rawEntries = payload.raw_payload?.entry;
  if (!Array.isArray(rawEntries)) return null;

  for (const entry of rawEntries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const contacts = Array.isArray(change?.value?.contacts)
        ? change.value.contacts
        : [];
      for (const contact of contacts) {
        const name = asTrimmedString(contact?.profile?.name);
        if (name) return name;
      }
    }
  }

  return null;
}

function extractMessageText(payload: StoredInboxPayload) {
  const message = isRecord(payload.message) ? payload.message : null;
  const messageId = asTrimmedString(message?.id);
  const fromPhoneRaw = asTrimmedString(message?.from);
  const rawMessageType = asTrimmedString(message?.type);
  const textNode = isRecord(message?.text) ? message?.text : null;
  const textBody = asTrimmedString(textNode?.body);
  const phoneNumberId = asTrimmedString(payload.phone_number_id);
  const contactName = extractContactName(payload);

  return {
    messageId,
    fromPhoneRaw,
    fromPhoneNormalized: fromPhoneRaw ? normalizePhone(fromPhoneRaw) : null,
    rawMessageType,
    textBody,
    phoneNumberId,
    whatsappBusinessAccountId: asTrimmedString(payload.whatsapp_business_account_id),
    displayPhoneNumber: asTrimmedString(payload.display_phone_number),
    contactName,
  };
}

async function listPendingInboxRows(
  supabase: SupabaseClient,
  organizationId: string,
  storeId: string,
  limit: number,
) {
  const { data, error } = await supabase
    .from("channel_whatsapp_inbox")
    .select(
      "id, organization_id, store_id, provider, external_event_id, payload, received_at, processed_at, processing_error",
    )
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .is("processed_at", null)
    .is("processing_error", null)
    .contains("payload", {
      source: "meta_whatsapp_webhook",
      event_kind: "message",
    })
    .order("received_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Falha ao carregar inbox pendente: ${error.message}`);
  }

  return (data || []) as InboxRow[];
}

async function markInboxProcessed(
  supabase: SupabaseClient,
  inboxId: string,
) {
  const { error } = await supabase
    .from("channel_whatsapp_inbox")
    .update({
      processed_at: new Date().toISOString(),
      processing_error: null,
    })
    .eq("id", inboxId);

  if (error) {
    throw new Error(`Falha ao marcar inbox como processado: ${error.message}`);
  }
}

async function markInboxError(
  supabase: SupabaseClient,
  inboxId: string,
  errorText: string,
) {
  const { error } = await supabase
    .from("channel_whatsapp_inbox")
    .update({
      processing_error: safeProcessingError(errorText),
    })
    .eq("id", inboxId);

  if (error) {
    throw new Error(`Falha ao marcar erro no inbox: ${error.message}`);
  }
}

async function findExistingMessageByExternalId(
  supabase: SupabaseClient,
  externalMessageId: string,
) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, lead_id, store_id, external_message_id")
    .eq("external_message_id", externalMessageId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao buscar message por external_message_id: ${error.message}`);
  }

  return (data as MessageRow | null) ?? null;
}

async function findLeadByPhone(
  supabase: SupabaseClient,
  organizationId: string,
  storeId: string,
  phone: string,
) {
  const { data, error } = await supabase
    .from("leads")
    .select("id, organization_id, store_id, name, phone, created_at, updated_at")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("phone", phone)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(1);

  if (error) {
    throw new Error(`Falha ao buscar lead por telefone: ${error.message}`);
  }

  return ((data || [])[0] as LeadRow | undefined) || null;
}

async function createLead(
  supabase: SupabaseClient,
  organizationId: string,
  storeId: string,
  phone: string,
  contactName: string | null,
) {
  const { data, error } = await supabase
    .from("leads")
    .insert({
      organization_id: organizationId,
      store_id: storeId,
      phone,
      name: contactName || "Cliente WhatsApp",
    })
    .select("id, organization_id, store_id, name, phone, created_at, updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao criar lead: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error("Lead criada sem id retornado.");
  }

  return data as LeadRow;
}

async function findOrCreateLead(
  supabase: SupabaseClient,
  organizationId: string,
  storeId: string,
  phone: string,
  contactName: string | null,
) {
  const existing = await findLeadByPhone(supabase, organizationId, storeId, phone);
  if (existing) {
    return existing;
  }

  return createLead(supabase, organizationId, storeId, phone, contactName);
}

async function findConversation(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
  activeOnly: boolean,
) {
  let query = supabase
    .from("conversations")
    .select("id, organization_id, lead_id, status, is_human_active, last_message_at, created_at")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (activeOnly) {
    query = query.eq("status", "active");
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Falha ao buscar conversa: ${error.message}`);
  }

  return ((data || [])[0] as ConversationRow | undefined) || null;
}

async function createConversation(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
) {
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      organization_id: organizationId,
      lead_id: leadId,
      status: "active",
    })
    .select("id, organization_id, lead_id, status, is_human_active, last_message_at, created_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao criar conversa: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error("Conversa criada sem id retornado.");
  }

  return data as ConversationRow;
}

async function findOrCreateConversation(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
) {
  const activeConversation = await findConversation(
    supabase,
    organizationId,
    leadId,
    true,
  );

  if (activeConversation) {
    return activeConversation;
  }

  const latestConversation = await findConversation(
    supabase,
    organizationId,
    leadId,
    false,
  );

  if (latestConversation) {
    return latestConversation;
  }

  return createConversation(supabase, organizationId, leadId);
}

async function insertIncomingMessage(args: {
  supabase: SupabaseClient;
  conversationId: string;
  inbox: InboxRow;
  messageId: string;
  textBody: string;
  fromPhone: string;
  phoneNumberId: string;
  contactName: string | null;
  rawMessageType: string;
  whatsappBusinessAccountId: string | null;
  displayPhoneNumber: string | null;
}) {
  const metadata = {
    source: "meta_whatsapp_webhook",
    external_channel: "whatsapp",
    channel: "whatsapp",
    provider: "meta",
    inbox_id: args.inbox.id,
    external_event_id: args.inbox.external_event_id,
    whatsapp_from: args.fromPhone,
    phone_number_id: args.phoneNumberId,
    whatsapp_business_account_id: args.whatsappBusinessAccountId,
    display_phone_number: args.displayPhoneNumber,
    contact_name: args.contactName,
    raw_message_type: args.rawMessageType,
  };

  const { data, error } = await args.supabase.rpc("insert_message", {
    p_conversation_id: args.conversationId,
    p_sender: "user",
    p_direction: "incoming",
    p_message_type: "text",
    p_content: args.textBody,
    p_external_message_id: args.messageId,
    p_media_url: null,
    p_metadata: metadata,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) {
    throw new Error("insert_message nao retornou message.id.");
  }

  return row as InsertMessageResult;
}

async function loadConversationAutomationState(args: {
  supabase: SupabaseClient;
  organizationId: string;
  conversationId: string;
}) {
  const { data, error } = await args.supabase
    .from("conversations")
    .select("id, organization_id, lead_id, status, is_human_active, last_message_at, created_at")
    .eq("id", args.conversationId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao consultar estado atual da conversa: ${error.message}`);
  }

  return (data as ConversationRow | null) ?? null;
}

async function loadConversationAiWindowState(args: {
  supabase: SupabaseClient;
  conversationId: string;
}) {
  const { data, error } = await args.supabase
    .from("conversation_ai_window_state")
    .select("conversation_id, next_resume_at")
    .eq("conversation_id", args.conversationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao consultar janela da IA da conversa: ${error.message}`);
  }

  return (data as ConversationAiWindowStateRow | null) ?? null;
}

async function dispatchAiSalesReplyForConversation(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  conversationId: string;
}) {
  const conversationState = await loadConversationAutomationState({
    supabase: args.supabase,
    organizationId: args.organizationId,
    conversationId: args.conversationId,
  });

  if (!conversationState?.id) {
    return {
      ai_status: "failed" as const,
      ai_error: "conversation_not_found_after_insert",
      ai_message_id: null,
    };
  }

  if (String(conversationState.status || "").trim() !== "active") {
    return {
      ai_status: "failed" as const,
      ai_error: "conversation_not_active",
      ai_message_id: null,
    };
  }

  if (conversationState.is_human_active === true) {
    return {
      ai_status: "skipped_human_active" as const,
      ai_error: null,
      ai_message_id: null,
    };
  }

  const windowState = await loadConversationAiWindowState({
    supabase: args.supabase,
    conversationId: args.conversationId,
  });

  if (isFutureIso(windowState?.next_resume_at)) {
    return {
      ai_status: "skipped_ai_paused" as const,
      ai_error: null,
      ai_message_id: null,
    };
  }

  const aiResult = await generateAndSaveAiSalesReply({
    organizationId: args.organizationId,
    storeId: args.storeId,
    conversationId: args.conversationId,
  });

  if (aiResult.ok) {
    return {
      ai_status: "called" as const,
      ai_error: null,
      ai_message_id: aiResult.messageId ?? null,
    };
  }

  if (
    aiResult.error === "HUMAN_HANDOFF_ACTIVE" ||
    aiResult.error === "HUMAN_ACTIVE"
  ) {
    return {
      ai_status: "skipped_human_active" as const,
      ai_error: null,
      ai_message_id: null,
    };
  }

  if (
    aiResult.error === "AI_REPLY_ALREADY_EXISTS_FOR_LATEST_CUSTOMER_MESSAGE" ||
    aiResult.error === "AI_REPLY_SUPERSEDED_BY_NEWER_CUSTOMER_MESSAGE"
  ) {
    return {
      ai_status: "skipped_duplicate" as const,
      ai_error: null,
      ai_message_id: null,
    };
  }

  return {
    ai_status: "failed" as const,
    ai_error: safeAiError(aiResult.message || aiResult.error || "ai_reply_failed"),
    ai_message_id: null,
  };
}

async function processSingleInboxRow(
  supabase: SupabaseClient,
  inbox: InboxRow,
): Promise<ProcessorResultItem> {
  const payload = isRecord(inbox.payload)
    ? (inbox.payload as StoredInboxPayload)
    : null;

  if (!inbox.id || !inbox.organization_id || !inbox.store_id || !payload) {
    const detail = "invalid_inbox_row";
    await markInboxError(supabase, inbox.id, detail);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "skipped",
      detail,
    };
  }

  const source = asTrimmedString(payload.source);
  const eventKind = asTrimmedString(payload.event_kind);
  if (source !== "meta_whatsapp_webhook" || eventKind !== "message") {
    const detail = "unsupported_inbox_payload";
    await markInboxError(supabase, inbox.id, detail);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "skipped",
      detail,
    };
  }

  const extracted = extractMessageText(payload);

  if (!extracted.messageId) {
    const detail = "missing_message_id";
    await markInboxError(supabase, inbox.id, detail);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "skipped",
      detail,
    };
  }

  if (!extracted.fromPhoneNormalized) {
    const detail = "missing_from";
    await markInboxError(supabase, inbox.id, detail);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "skipped",
      detail,
    };
  }

  if (!extracted.rawMessageType) {
    const detail = "missing_message_type";
    await markInboxError(supabase, inbox.id, detail);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "skipped",
      detail,
    };
  }

  if (extracted.rawMessageType !== "text") {
    const detail = `unsupported_message_type: ${extracted.rawMessageType}`;
    await markInboxError(supabase, inbox.id, detail);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "skipped",
      detail,
      ai_status: "skipped_not_text",
    };
  }

  if (!extracted.textBody) {
    const detail = "missing_text_body";
    await markInboxError(supabase, inbox.id, detail);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "skipped",
      detail,
    };
  }

  if (!extracted.phoneNumberId) {
    const detail = "missing_phone_number_id";
    await markInboxError(supabase, inbox.id, detail);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "skipped",
      detail,
    };
  }

  const existingMessage = await findExistingMessageByExternalId(
    supabase,
    extracted.messageId,
  );

  if (existingMessage?.id) {
    await markInboxProcessed(supabase, inbox.id);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "succeeded",
      detail: "duplicate_message_already_exists",
      message_id: existingMessage.id,
      lead_id: existingMessage.lead_id,
      conversation_id: existingMessage.conversation_id,
      ai_status: "skipped_duplicate",
    };
  }

  const lead = await findOrCreateLead(
    supabase,
    inbox.organization_id,
    inbox.store_id,
    extracted.fromPhoneNormalized,
    extracted.contactName,
  );

  const conversation = await findOrCreateConversation(
    supabase,
    inbox.organization_id,
    lead.id,
  );

  try {
    const inserted = await insertIncomingMessage({
      supabase,
      conversationId: conversation.id,
      inbox,
      messageId: extracted.messageId,
      textBody: extracted.textBody,
      fromPhone: extracted.fromPhoneNormalized,
      phoneNumberId: extracted.phoneNumberId,
      contactName: extracted.contactName,
      rawMessageType: extracted.rawMessageType,
      whatsappBusinessAccountId: extracted.whatsappBusinessAccountId,
      displayPhoneNumber: extracted.displayPhoneNumber,
    });

    await markInboxProcessed(supabase, inbox.id);

    let aiDispatchResult: Pick<
      ProcessorResultItem,
      "ai_status" | "ai_message_id" | "ai_error"
    > = {
      ai_status: "failed",
      ai_message_id: null,
      ai_error: "ai_dispatch_not_attempted",
    };

    try {
      aiDispatchResult = await dispatchAiSalesReplyForConversation({
        supabase,
        organizationId: inbox.organization_id,
        storeId: inbox.store_id,
        conversationId: conversation.id,
      });
    } catch (aiError) {
      aiDispatchResult = {
        ai_status: "failed",
        ai_message_id: null,
        ai_error: safeAiError(aiError),
      };
    }

    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "succeeded",
      message_id: inserted.id || null,
      lead_id: lead.id,
      conversation_id: conversation.id,
      ...aiDispatchResult,
    };
  } catch (error) {
    if (
      isDuplicateError(error as { code?: string | null; message?: string | null })
    ) {
      const duplicate = await findExistingMessageByExternalId(
        supabase,
        extracted.messageId,
      );

      await markInboxProcessed(supabase, inbox.id);

      return {
        inbox_id: inbox.id,
        external_event_id: inbox.external_event_id,
        status: "succeeded",
        detail: "duplicate_message_already_exists",
        message_id: duplicate?.id || null,
        lead_id: duplicate?.lead_id || lead.id,
        conversation_id: duplicate?.conversation_id || conversation.id,
        ai_status: "skipped_duplicate",
      };
    }

    throw error;
  }
}

export async function processWhatsappInbox(
  input: ProcessWhatsappInboxInput,
): Promise<ProcessWhatsappInboxResult> {
  const organizationId = String(input.organizationId || "").trim();
  const storeId = String(input.storeId || "").trim();
  const limit = Math.max(1, Math.min(Number(input.limit ?? 10) || 10, 100));

  if (!organizationId) {
    throw new Error("organizationId e obrigatorio.");
  }

  if (!storeId) {
    throw new Error("storeId e obrigatorio.");
  }

  const supabase = getSupabaseAdmin();
  const inboxRows = await listPendingInboxRows(
    supabase,
    organizationId,
    storeId,
    limit,
  );

  const results: ProcessorResultItem[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const inbox of inboxRows) {
    try {
      const result = await processSingleInboxRow(supabase, inbox);
      results.push(result);

      if (result.status === "succeeded") succeeded += 1;
      if (result.status === "failed") failed += 1;
      if (result.status === "skipped") skipped += 1;
    } catch (error) {
      const detail = safeProcessingError(error);

      try {
        await markInboxError(supabase, inbox.id, detail);
      } catch {
        // Mantemos o erro principal como resultado e evitamos expor detalhes extras.
      }

      results.push({
        inbox_id: inbox.id,
        external_event_id: inbox.external_event_id,
        status: "failed",
        detail,
      });
      failed += 1;
    }
  }

  return {
    ok: true,
    processed: inboxRows.length,
    succeeded,
    failed,
    skipped,
    results,
  };
}
