import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAndSaveAiSalesReply } from "@/lib/server/generate-and-save-ai-sales-reply";
import {
  downloadAndStoreWhatsappInboundMedia,
  removeWhatsappInboundStoredMedia,
} from "@/lib/server/whatsapp-inbound-media";

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

type StatusMessageRow = {
  id: string;
  organization_id: string;
  conversation_id: string;
  lead_id: string | null;
  store_id: string | null;
  external_message_id: string | null;
  delivered_at: string | null;
  read_at: string | null;
  metadata: Record<string, unknown> | null;
};

type MetaTextPayload = {
  body?: unknown;
};

type MetaImagePayload = {
  id?: unknown;
  mime_type?: unknown;
  sha256?: unknown;
  caption?: unknown;
};

type MetaAudioPayload = {
  id?: unknown;
  mime_type?: unknown;
  sha256?: unknown;
  voice?: unknown;
};

type MetaVideoPayload = {
  id?: unknown;
  mime_type?: unknown;
  sha256?: unknown;
  caption?: unknown;
};

type MetaDocumentPayload = {
  id?: unknown;
  mime_type?: unknown;
  sha256?: unknown;
  filename?: unknown;
  caption?: unknown;
};

type MetaMessagePayload = {
  id?: unknown;
  from?: unknown;
  type?: unknown;
  text?: MetaTextPayload | null;
  image?: MetaImagePayload | null;
  audio?: MetaAudioPayload | null;
  video?: MetaVideoPayload | null;
  document?: MetaDocumentPayload | null;
};

type StoredInboxPayload = {
  source?: unknown;
  event_kind?: unknown;
  phone_number_id?: unknown;
  whatsapp_business_account_id?: unknown;
  display_phone_number?: unknown;
  message?: MetaMessagePayload | null;
  status?: Record<string, unknown> | null;
  change?: Record<string, unknown> | null;
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

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
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

function extractIncomingMessage(payload: StoredInboxPayload) {
  const message = isRecord(payload.message) ? payload.message : null;
  const messageId = asTrimmedString(message?.id);
  const fromPhoneRaw = asTrimmedString(message?.from);
  const rawMessageType = asTrimmedString(message?.type);
  const textNode = isRecord(message?.text) ? message?.text : null;
  const textBody = asTrimmedString(textNode?.body);
  const imageNode = isRecord(message?.image) ? message?.image : null;
  const audioNode = isRecord(message?.audio) ? message?.audio : null;
  const videoNode = isRecord(message?.video) ? message?.video : null;
  const documentNode = isRecord(message?.document) ? message?.document : null;
  const phoneNumberId = asTrimmedString(payload.phone_number_id);
  const contactName = extractContactName(payload);

  return {
    messageId,
    fromPhoneRaw,
    fromPhoneNormalized: fromPhoneRaw ? normalizePhone(fromPhoneRaw) : null,
    rawMessageType,
    textBody,
    imageMediaId: asTrimmedString(imageNode?.id),
    imageMimeType: asTrimmedString(imageNode?.mime_type),
    imageSha256: asTrimmedString(imageNode?.sha256),
    imageCaption: asTrimmedString(imageNode?.caption),
    audioMediaId: asTrimmedString(audioNode?.id),
    audioMimeType: asTrimmedString(audioNode?.mime_type),
    audioSha256: asTrimmedString(audioNode?.sha256),
    audioVoice: asBoolean(audioNode?.voice),
    videoMediaId: asTrimmedString(videoNode?.id),
    videoMimeType: asTrimmedString(videoNode?.mime_type),
    videoSha256: asTrimmedString(videoNode?.sha256),
    videoCaption: asTrimmedString(videoNode?.caption),
    documentMediaId: asTrimmedString(documentNode?.id),
    documentMimeType: asTrimmedString(documentNode?.mime_type),
    documentSha256: asTrimmedString(documentNode?.sha256),
    documentFilename: asTrimmedString(documentNode?.filename),
    documentCaption: asTrimmedString(documentNode?.caption),
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
  const buildBaseQuery = () =>
    supabase
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
      })
      .order("received_at", { ascending: true })
      .limit(limit);

  const [{ data: messageRows, error: messageError }, { data: statusRows, error: statusError }] =
    await Promise.all([
      buildBaseQuery().contains("payload", {
        source: "meta_whatsapp_webhook",
        event_kind: "message",
      }),
      buildBaseQuery().contains("payload", {
        source: "meta_whatsapp_webhook",
        event_kind: "status",
      }),
    ]);

  if (messageError) {
    throw new Error(`Falha ao carregar inbox pendente de mensagens: ${messageError.message}`);
  }

  if (statusError) {
    throw new Error(`Falha ao carregar inbox pendente de status: ${statusError.message}`);
  }

  const rows = [...((messageRows || []) as InboxRow[]), ...((statusRows || []) as InboxRow[])]
    .sort((a, b) => {
      const left = Date.parse(a.received_at || "") || 0;
      const right = Date.parse(b.received_at || "") || 0;
      return left - right;
    })
    .slice(0, limit);

  return rows;
}

function getMessageMetadata(value: Record<string, unknown> | null | undefined) {
  return value && isRecord(value) ? { ...value } : {};
}

function normalizeWhatsappStatus(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();

  if (
    normalized === "sent" ||
    normalized === "delivered" ||
    normalized === "read" ||
    normalized === "failed"
  ) {
    return normalized as "sent" | "delivered" | "read" | "failed";
  }

  return null;
}

function getWhatsappStatusRank(value: string | null | undefined) {
  if (value === "sent") return 1;
  if (value === "delivered") return 2;
  if (value === "read") return 3;
  return 0;
}

function resolveWhatsappStatusTimestamp(value: unknown) {
  const rawValue = String(value || "").trim();

  if (/^\d+$/.test(rawValue)) {
    const unixSeconds = Number(rawValue);
    if (Number.isFinite(unixSeconds) && unixSeconds > 0) {
      return new Date(unixSeconds * 1000).toISOString();
    }
  }

  const parsed = Date.parse(rawValue);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }

  return new Date().toISOString();
}

function buildStatusProcessingError(statusValue: string) {
  return `invalid_status_event: ${statusValue}`;
}

function extractIncomingStatus(payload: StoredInboxPayload) {
  const statusNode = isRecord(payload.status) ? payload.status : null;
  const statusId = asTrimmedString(statusNode?.id);
  const statusValue = normalizeWhatsappStatus(statusNode?.status);
  const rawStatusValue = asTrimmedString(statusNode?.status);

  return {
    statusId,
    statusValue,
    rawStatusValue,
    statusTimestampIso: resolveWhatsappStatusTimestamp(statusNode?.timestamp),
    recipientId: asTrimmedString(statusNode?.recipient_id),
    conversation: isRecord(statusNode?.conversation) ? statusNode.conversation : null,
    pricing: isRecord(statusNode?.pricing) ? statusNode.pricing : null,
    errors: Array.isArray(statusNode?.errors)
      ? statusNode.errors
      : statusNode?.errors && isRecord(statusNode.errors)
        ? [statusNode.errors]
        : null,
    rawStatusPayload: statusNode,
  };
}

async function findMessageByExternalIdForStatus(
  supabase: SupabaseClient,
  organizationId: string,
  externalMessageId: string,
) {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, organization_id, conversation_id, lead_id, store_id, external_message_id, delivered_at, read_at, metadata",
    )
    .eq("organization_id", organizationId)
    .eq("external_message_id", externalMessageId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Falha ao buscar message de status por external_message_id: ${error.message}`,
    );
  }

  return (data as StatusMessageRow | null) ?? null;
}

async function updateMessageWhatsappStatus(args: {
  supabase: SupabaseClient;
  organizationId: string;
  message: StatusMessageRow;
  statusValue: "sent" | "delivered" | "read" | "failed";
  statusTimestampIso: string;
  recipientId: string | null;
  conversation: Record<string, unknown> | null;
  pricing: Record<string, unknown> | null;
  errors: unknown[] | null;
  rawStatusPayload: Record<string, unknown> | null;
}) {
  const currentMetadata = getMessageMetadata(args.message.metadata);
  const currentStatus = normalizeWhatsappStatus(currentMetadata.whatsapp_status);
  const currentStatusRank = getWhatsappStatusRank(currentStatus);
  const incomingStatusRank = getWhatsappStatusRank(args.statusValue);
  const nextMetadata: Record<string, unknown> = {
    ...currentMetadata,
    whatsapp_last_status: args.statusValue,
    whatsapp_last_status_at: args.statusTimestampIso,
    whatsapp_last_status_payload: args.rawStatusPayload,
  };
  const updatePayload: Record<string, unknown> = {
    metadata: nextMetadata,
  };

  if (args.recipientId) {
    nextMetadata.whatsapp_recipient_id = args.recipientId;
  }

  if (args.conversation) {
    nextMetadata.whatsapp_conversation = args.conversation;
  }

  if (args.pricing) {
    nextMetadata.whatsapp_pricing = args.pricing;
  }

  if (args.statusValue === "sent") {
    nextMetadata.whatsapp_sent_at = args.statusTimestampIso;
    if (currentStatusRank < incomingStatusRank) {
      nextMetadata.whatsapp_status = "sent";
    }
  }

  if (args.statusValue === "delivered") {
    nextMetadata.whatsapp_delivered_at = args.statusTimestampIso;
    if (!args.message.delivered_at) {
      updatePayload.delivered_at = args.statusTimestampIso;
    }

    if (currentStatus !== "read") {
      nextMetadata.whatsapp_status = "delivered";
    }
  }

  if (args.statusValue === "read") {
    nextMetadata.whatsapp_read_at = args.statusTimestampIso;
    nextMetadata.whatsapp_status = "read";

    if (!args.message.delivered_at) {
      updatePayload.delivered_at = args.statusTimestampIso;
    }

    if (!args.message.read_at) {
      updatePayload.read_at = args.statusTimestampIso;
    }
  }

  if (args.statusValue === "failed") {
    nextMetadata.whatsapp_failed_at = args.statusTimestampIso;
    if (args.errors) {
      nextMetadata.whatsapp_status_errors = args.errors;
      nextMetadata.whatsapp_error = args.errors;
    }

    if (currentStatus !== "delivered" && currentStatus !== "read") {
      nextMetadata.whatsapp_status = "failed";
    }
  }

  const { error } = await args.supabase
    .from("messages")
    .update(updatePayload)
    .eq("id", args.message.id)
    .eq("organization_id", args.organizationId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Falha ao atualizar status WhatsApp da message: ${error.message}`);
  }
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
  messageType?: "text" | "image" | "audio" | "video";
  content?: string;
  mediaUrl?: string | null;
  metadata?: Record<string, unknown>;
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
    ...(args.metadata || {}),
  };
  const messageType = args.messageType || "text";
  const content = args.content ?? args.textBody;
  const mediaUrl = args.mediaUrl ?? null;

  const { data, error } = await args.supabase.rpc("insert_message", {
    p_conversation_id: args.conversationId,
    p_sender: "user",
    p_direction: "incoming",
    p_message_type: messageType,
    p_content: content,
    p_external_message_id: args.messageId,
    p_media_url: mediaUrl,
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

async function insertIncomingImageMessage(args: {
  supabase: SupabaseClient;
  conversationId: string;
  inbox: InboxRow;
  messageId: string;
  fromPhone: string;
  phoneNumberId: string;
  contactName: string | null;
  whatsappBusinessAccountId: string | null;
  displayPhoneNumber: string | null;
  mediaId: string;
  mimeType: string | null;
  sha256: string | null;
  caption: string | null;
  storageBucket: string;
  storagePath: string;
  originalFileName: string;
  sizeBytes: number;
}) {
  return insertIncomingMessage({
    supabase: args.supabase,
    conversationId: args.conversationId,
    inbox: args.inbox,
    messageId: args.messageId,
    textBody: args.caption || "Cliente enviou uma imagem.",
    fromPhone: args.fromPhone,
    phoneNumberId: args.phoneNumberId,
    contactName: args.contactName,
    rawMessageType: "image",
    whatsappBusinessAccountId: args.whatsappBusinessAccountId,
    displayPhoneNumber: args.displayPhoneNumber,
    messageType: "image",
    content: args.caption || "Cliente enviou uma imagem.",
    mediaUrl: args.storagePath,
    metadata: {
      media_origin: "customer",
      attachment_kind: "image",
      whatsapp_media_id: args.mediaId,
      mime_type: args.mimeType,
      sha256: args.sha256,
      caption: args.caption,
      storage_bucket: args.storageBucket,
      storage_path: args.storagePath,
      original_file_name: args.originalFileName,
      size_bytes: args.sizeBytes,
      downloaded_from_meta: true,
    },
  });
}

async function insertIncomingAudioMessage(args: {
  supabase: SupabaseClient;
  conversationId: string;
  inbox: InboxRow;
  messageId: string;
  fromPhone: string;
  phoneNumberId: string;
  contactName: string | null;
  whatsappBusinessAccountId: string | null;
  displayPhoneNumber: string | null;
  mediaId: string;
  mimeType: string | null;
  sha256: string | null;
  isVoiceMessage: boolean | null;
  storageBucket: string;
  storagePath: string;
  originalFileName: string;
  sizeBytes: number;
}) {
  return insertIncomingMessage({
    supabase: args.supabase,
    conversationId: args.conversationId,
    inbox: args.inbox,
    messageId: args.messageId,
    textBody: "Cliente enviou um audio.",
    fromPhone: args.fromPhone,
    phoneNumberId: args.phoneNumberId,
    contactName: args.contactName,
    rawMessageType: "audio",
    whatsappBusinessAccountId: args.whatsappBusinessAccountId,
    displayPhoneNumber: args.displayPhoneNumber,
    messageType: "audio",
    content: "Cliente enviou um audio.",
    mediaUrl: args.storagePath,
    metadata: {
      media_origin: "customer",
      attachment_kind: "audio",
      whatsapp_media_id: args.mediaId,
      mime_type: args.mimeType,
      sha256: args.sha256,
      storage_bucket: args.storageBucket,
      storage_path: args.storagePath,
      original_file_name: args.originalFileName,
      size_bytes: args.sizeBytes,
      downloaded_from_meta: true,
      voice: args.isVoiceMessage,
      is_voice_message: args.isVoiceMessage,
    },
  });
}

async function insertIncomingVideoMessage(args: {
  supabase: SupabaseClient;
  conversationId: string;
  inbox: InboxRow;
  messageId: string;
  fromPhone: string;
  phoneNumberId: string;
  contactName: string | null;
  whatsappBusinessAccountId: string | null;
  displayPhoneNumber: string | null;
  mediaId: string;
  mimeType: string | null;
  sha256: string | null;
  caption: string | null;
  storageBucket: string;
  storagePath: string;
  originalFileName: string;
  sizeBytes: number;
}) {
  const content = args.caption || "Cliente enviou um video.";

  return insertIncomingMessage({
    supabase: args.supabase,
    conversationId: args.conversationId,
    inbox: args.inbox,
    messageId: args.messageId,
    textBody: content,
    fromPhone: args.fromPhone,
    phoneNumberId: args.phoneNumberId,
    contactName: args.contactName,
    rawMessageType: "video",
    whatsappBusinessAccountId: args.whatsappBusinessAccountId,
    displayPhoneNumber: args.displayPhoneNumber,
    messageType: "video",
    content,
    mediaUrl: args.storagePath,
    metadata: {
      media_origin: "customer",
      attachment_kind: "video",
      whatsapp_media_id: args.mediaId,
      mime_type: args.mimeType,
      sha256: args.sha256,
      caption: args.caption,
      storage_bucket: args.storageBucket,
      storage_path: args.storagePath,
      original_file_name: args.originalFileName,
      size_bytes: args.sizeBytes,
      downloaded_from_meta: true,
    },
  });
}

async function insertIncomingDocumentMessage(args: {
  supabase: SupabaseClient;
  conversationId: string;
  inbox: InboxRow;
  messageId: string;
  fromPhone: string;
  phoneNumberId: string;
  contactName: string | null;
  whatsappBusinessAccountId: string | null;
  displayPhoneNumber: string | null;
  mediaId: string;
  mimeType: string | null;
  sha256: string | null;
  caption: string | null;
  fileName: string | null;
  storageBucket: string;
  storagePath: string;
  originalFileName: string;
  sizeBytes: number;
}) {
  const content =
    args.caption ||
    (args.fileName
      ? `Cliente enviou o arquivo ${args.fileName}.`
      : "Cliente enviou um arquivo.");

  return insertIncomingMessage({
    supabase: args.supabase,
    conversationId: args.conversationId,
    inbox: args.inbox,
    messageId: args.messageId,
    textBody: content,
    fromPhone: args.fromPhone,
    phoneNumberId: args.phoneNumberId,
    contactName: args.contactName,
    rawMessageType: "document",
    whatsappBusinessAccountId: args.whatsappBusinessAccountId,
    displayPhoneNumber: args.displayPhoneNumber,
    messageType: "text",
    content,
    mediaUrl: null,
    metadata: {
      media_origin: "customer",
      attachment_kind: "file",
      whatsapp_media_id: args.mediaId,
      mime_type: args.mimeType,
      sha256: args.sha256,
      caption: args.caption,
      storage_bucket: args.storageBucket,
      storage_path: args.storagePath,
      original_file_name: args.originalFileName,
      size_bytes: args.sizeBytes,
      downloaded_from_meta: true,
    },
  });
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

async function processStatusInboxRow(
  supabase: SupabaseClient,
  inbox: InboxRow,
  payload: StoredInboxPayload,
): Promise<ProcessorResultItem> {
  const extracted = extractIncomingStatus(payload);

  if (!extracted.statusId) {
    const detail = buildStatusProcessingError("missing_status_id");
    await markInboxError(supabase, inbox.id, detail);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "skipped",
      detail,
    };
  }

  if (!extracted.statusValue) {
    const detail = buildStatusProcessingError(
      extracted.rawStatusValue || "missing_status_value",
    );
    await markInboxError(supabase, inbox.id, detail);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "skipped",
      detail,
    };
  }

  const message = await findMessageByExternalIdForStatus(
    supabase,
    inbox.organization_id,
    extracted.statusId,
  );

  if (!message?.id) {
    const detail = "status_message_not_found_by_external_message_id";
    await markInboxError(supabase, inbox.id, detail);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "failed",
      detail,
    };
  }

  await updateMessageWhatsappStatus({
    supabase,
    organizationId: inbox.organization_id,
    message,
    statusValue: extracted.statusValue,
    statusTimestampIso: extracted.statusTimestampIso,
    recipientId: extracted.recipientId,
    conversation: extracted.conversation,
    pricing: extracted.pricing,
    errors: extracted.errors,
    rawStatusPayload: extracted.rawStatusPayload,
  });

  await markInboxProcessed(supabase, inbox.id);

  return {
    inbox_id: inbox.id,
    external_event_id: inbox.external_event_id,
    status: "succeeded",
    message_id: message.id,
    lead_id: message.lead_id,
    conversation_id: message.conversation_id,
    detail: `status_applied_${extracted.statusValue}`,
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
  if (source !== "meta_whatsapp_webhook") {
    const detail = "unsupported_inbox_payload";
    await markInboxError(supabase, inbox.id, detail);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "skipped",
      detail,
    };
  }

  if (eventKind === "status") {
    return processStatusInboxRow(supabase, inbox, payload);
  }

  if (eventKind !== "message") {
    const detail = "unsupported_inbox_payload";
    await markInboxError(supabase, inbox.id, detail);
    return {
      inbox_id: inbox.id,
      external_event_id: inbox.external_event_id,
      status: "skipped",
      detail,
    };
  }

  const extracted = extractIncomingMessage(payload);

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

  if (
    extracted.rawMessageType !== "text" &&
    extracted.rawMessageType !== "image" &&
    extracted.rawMessageType !== "audio" &&
    extracted.rawMessageType !== "video" &&
    extracted.rawMessageType !== "document"
  ) {
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

  if (extracted.rawMessageType === "text" && !extracted.textBody) {
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

  const resolvedMessageId = extracted.messageId;
  const resolvedFromPhone = extracted.fromPhoneNormalized;
  const resolvedPhoneNumberId = extracted.phoneNumberId;

  const existingMessage = await findExistingMessageByExternalId(
    supabase,
    resolvedMessageId,
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
    resolvedFromPhone,
    extracted.contactName,
  );

  const conversation = await findOrCreateConversation(
    supabase,
    inbox.organization_id,
    lead.id,
  );

  let uploadedMediaStoragePath: string | null = null;

  try {
    let inserted: InsertMessageResult;

    if (extracted.rawMessageType === "image") {
      if (!extracted.imageMediaId) {
        throw new Error("missing_image_media_id");
      }

      const storedMedia = await downloadAndStoreWhatsappInboundMedia({
        supabase,
        organizationId: inbox.organization_id,
        storeId: inbox.store_id,
        conversationId: conversation.id,
        mediaId: extracted.imageMediaId,
        mediaKind: "image",
        preferredMimeType: extracted.imageMimeType,
        fallbackBaseName: "whatsapp-image",
      });

      uploadedMediaStoragePath = storedMedia.storagePath;

      inserted = await insertIncomingImageMessage({
        supabase,
        conversationId: conversation.id,
        inbox,
        messageId: resolvedMessageId,
        fromPhone: resolvedFromPhone,
        phoneNumberId: resolvedPhoneNumberId,
        contactName: extracted.contactName,
        whatsappBusinessAccountId: extracted.whatsappBusinessAccountId,
        displayPhoneNumber: extracted.displayPhoneNumber,
        mediaId: extracted.imageMediaId,
        mimeType: storedMedia.mimeType || extracted.imageMimeType,
        sha256: extracted.imageSha256 || storedMedia.sha256,
        caption: extracted.imageCaption,
        storageBucket: storedMedia.storageBucket,
        storagePath: storedMedia.storagePath,
        originalFileName: storedMedia.originalFileName,
        sizeBytes: storedMedia.sizeBytes,
      });
    } else if (extracted.rawMessageType === "audio") {
      if (!extracted.audioMediaId) {
        throw new Error("missing_audio_media_id");
      }

      const storedMedia = await downloadAndStoreWhatsappInboundMedia({
        supabase,
        organizationId: inbox.organization_id,
        storeId: inbox.store_id,
        conversationId: conversation.id,
        mediaId: extracted.audioMediaId,
        mediaKind: "audio",
        preferredMimeType: extracted.audioMimeType,
        fallbackBaseName: "whatsapp-audio",
      });

      uploadedMediaStoragePath = storedMedia.storagePath;

      inserted = await insertIncomingAudioMessage({
        supabase,
        conversationId: conversation.id,
        inbox,
        messageId: resolvedMessageId,
        fromPhone: resolvedFromPhone,
        phoneNumberId: resolvedPhoneNumberId,
        contactName: extracted.contactName,
        whatsappBusinessAccountId: extracted.whatsappBusinessAccountId,
        displayPhoneNumber: extracted.displayPhoneNumber,
        mediaId: extracted.audioMediaId,
        mimeType: storedMedia.mimeType || extracted.audioMimeType,
        sha256: extracted.audioSha256 || storedMedia.sha256,
        isVoiceMessage: extracted.audioVoice,
        storageBucket: storedMedia.storageBucket,
        storagePath: storedMedia.storagePath,
        originalFileName: storedMedia.originalFileName,
        sizeBytes: storedMedia.sizeBytes,
      });
    } else if (extracted.rawMessageType === "video") {
      if (!extracted.videoMediaId) {
        throw new Error("missing_video_media_id");
      }

      const storedMedia = await downloadAndStoreWhatsappInboundMedia({
        supabase,
        organizationId: inbox.organization_id,
        storeId: inbox.store_id,
        conversationId: conversation.id,
        mediaId: extracted.videoMediaId,
        mediaKind: "video",
        preferredMimeType: extracted.videoMimeType,
        fallbackBaseName: "whatsapp-video",
      });

      uploadedMediaStoragePath = storedMedia.storagePath;

      inserted = await insertIncomingVideoMessage({
        supabase,
        conversationId: conversation.id,
        inbox,
        messageId: resolvedMessageId,
        fromPhone: resolvedFromPhone,
        phoneNumberId: resolvedPhoneNumberId,
        contactName: extracted.contactName,
        whatsappBusinessAccountId: extracted.whatsappBusinessAccountId,
        displayPhoneNumber: extracted.displayPhoneNumber,
        mediaId: extracted.videoMediaId,
        mimeType: storedMedia.mimeType || extracted.videoMimeType,
        sha256: extracted.videoSha256 || storedMedia.sha256,
        caption: extracted.videoCaption,
        storageBucket: storedMedia.storageBucket,
        storagePath: storedMedia.storagePath,
        originalFileName: storedMedia.originalFileName,
        sizeBytes: storedMedia.sizeBytes,
      });
    } else if (extracted.rawMessageType === "document") {
      if (!extracted.documentMediaId) {
        throw new Error("missing_document_media_id");
      }

      const storedMedia = await downloadAndStoreWhatsappInboundMedia({
        supabase,
        organizationId: inbox.organization_id,
        storeId: inbox.store_id,
        conversationId: conversation.id,
        mediaId: extracted.documentMediaId,
        mediaKind: "document",
        preferredMimeType: extracted.documentMimeType,
        preferredFileName: extracted.documentFilename,
        fallbackBaseName: "whatsapp-document",
      });

      uploadedMediaStoragePath = storedMedia.storagePath;

      inserted = await insertIncomingDocumentMessage({
        supabase,
        conversationId: conversation.id,
        inbox,
        messageId: resolvedMessageId,
        fromPhone: resolvedFromPhone,
        phoneNumberId: resolvedPhoneNumberId,
        contactName: extracted.contactName,
        whatsappBusinessAccountId: extracted.whatsappBusinessAccountId,
        displayPhoneNumber: extracted.displayPhoneNumber,
        mediaId: extracted.documentMediaId,
        mimeType: storedMedia.mimeType || extracted.documentMimeType,
        sha256: extracted.documentSha256 || storedMedia.sha256,
        caption: extracted.documentCaption,
        fileName: extracted.documentFilename || storedMedia.originalFileName,
        storageBucket: storedMedia.storageBucket,
        storagePath: storedMedia.storagePath,
        originalFileName: storedMedia.originalFileName,
        sizeBytes: storedMedia.sizeBytes,
      });
    } else {
      inserted = await insertIncomingMessage({
        supabase,
        conversationId: conversation.id,
        inbox,
        messageId: resolvedMessageId,
        textBody: extracted.textBody || "",
        fromPhone: resolvedFromPhone,
        phoneNumberId: resolvedPhoneNumberId,
        contactName: extracted.contactName,
        rawMessageType: extracted.rawMessageType,
        whatsappBusinessAccountId: extracted.whatsappBusinessAccountId,
        displayPhoneNumber: extracted.displayPhoneNumber,
      });
    }

    await markInboxProcessed(supabase, inbox.id);

    if (
      extracted.rawMessageType === "image" ||
      extracted.rawMessageType === "audio" ||
      extracted.rawMessageType === "video" ||
      extracted.rawMessageType === "document"
    ) {
      return {
        inbox_id: inbox.id,
        external_event_id: inbox.external_event_id,
        status: "succeeded",
        message_id: inserted.id || null,
        lead_id: lead.id,
        conversation_id: conversation.id,
        detail: `${extracted.rawMessageType}_saved_in_crm`,
      };
    }

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
        resolvedMessageId,
      );

      if (uploadedMediaStoragePath) {
        try {
          await removeWhatsappInboundStoredMedia({
            supabase,
            storagePath: uploadedMediaStoragePath,
          });
        } catch {
          // Mantemos o resultado principal e evitamos falhar o fluxo por cleanup.
        }
      }

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

    if (uploadedMediaStoragePath) {
      try {
        await removeWhatsappInboundStoredMedia({
          supabase,
          storagePath: uploadedMediaStoragePath,
        });
      } catch {
        // Mantemos o erro principal e evitamos mascarar o motivo da falha.
      }
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
