import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

type PendingExternalMessageRow = {
  id?: string | null;
  message_id?: string | null;

  conversation_id?: string | null;
  lead_id?: string | null;
  content?: string | null;
  message_type?: string | null;
  media_url?: string | null;
  metadata?: Json | null;

  lead_phone?: string | null;
  lead_phone_number?: string | null;
  customer_phone?: string | null;
  customer_phone_number?: string | null;
  phone?: string | null;
  phone_number?: string | null;
  whatsapp?: string | null;
  lead_whatsapp?: string | null;
  customer_whatsapp?: string | null;
  wa_id?: string | null;
  mobile?: string | null;
  mobile_phone?: string | null;
  lead_mobile?: string | null;
};

type PendingExternalMessage = {
  id: string;
  conversationId: string | null;
  leadId: string | null;
  phone: string;
  content: string;
  messageType: "text" | "image";
  mediaUrl: string | null;
  metadata: Record<string, unknown>;
};

type WhatsappIntegrationRow = {
  id?: string;
  provider?: string | null;
  access_token?: string | null;
  phone_number_id?: string | null;
  metadata?: Json | null;
};

type WhatsappIntegration = {
  accessToken: string;
  phoneNumberId: string;
};

type MarkSentResult = {
  ok?: boolean;
  success?: boolean;
  error?: string | null;
};

export type ProcessWhatsappPendingMessagesInput = {
  organizationId: string;
  storeId: string;
  limit?: number;
};

export type ProcessWhatsappPendingMessagesResult = {
  ok: boolean;
  processed: number;
  sent: number;
  failed: number;
  results: Array<{
    messageId: string;
    status: "sent" | "failed" | "skipped";
    detail: string;
    whatsappMessageId?: string | null;
  }>;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WHATSAPP_GRAPH_API_VERSION =
  process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";

function getSupabaseAdmin(): SupabaseClient {
  if (!SUPABASE_URL) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL não está definido");
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não está definido");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "sim"].includes(normalized)) return true;
  if (["false", "0", "no", "nao", "não"].includes(normalized)) return false;
  return null;
}

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

function extractPhone(row: PendingExternalMessageRow): string | null {
  const candidates = [
    row.lead_phone,
    row.lead_phone_number,
    row.customer_phone,
    row.customer_phone_number,
    row.phone,
    row.phone_number,
    row.whatsapp,
    row.lead_whatsapp,
    row.customer_whatsapp,
    row.wa_id,
    row.mobile,
    row.mobile_phone,
    row.lead_mobile,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") continue;

    const normalized = normalizePhone(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeMetadata(
  value: Json | null | undefined,
): Record<string, unknown> {
  if (isRecord(value)) return value;
  return {};
}

function extractMessageId(row: PendingExternalMessageRow): string | null {
  const rawId = row.id ?? row.message_id ?? null;

  if (!rawId || typeof rawId !== "string") {
    return null;
  }

  const trimmed = rawId.trim();
  return trimmed || null;
}

function shouldSkipExternalSend(metadata: Record<string, unknown>): string | null {
  const internalOnly = coerceBoolean(metadata.internal_only);
  if (internalOnly === true) {
    return "Mensagem marcada como interna e não deve sair no WhatsApp.";
  }

  const sendExternal = coerceBoolean(metadata.send_external);
  if (sendExternal === false) {
    return "Mensagem marcada para não enviar externamente.";
  }

  return null;
}

function normalizePendingMessage(
  row: PendingExternalMessageRow,
): PendingExternalMessage {
  const messageId = extractMessageId(row);
  const phone = extractPhone(row);

  if (!messageId) {
    throw new Error(
      `Mensagem pendente sem id. Campos recebidos: ${Object.keys(row).join(", ")}`,
    );
  }

  if (!phone) {
    throw new Error(
      `Mensagem ${messageId} sem telefone do lead. Campos recebidos: ${Object.keys(row).join(", ")}`,
    );
  }

  const rawType = String(row.message_type || "text").toLowerCase();

  const messageType: "text" | "image" =
    rawType === "image" ? "image" : "text";

  const content = String(row.content || "").trim();
  const mediaUrl = row.media_url?.trim() || null;
  const metadata = normalizeMetadata(row.metadata);

  if (messageType === "text" && !content) {
    throw new Error(`Mensagem ${messageId} do tipo text sem conteúdo`);
  }

  if (messageType === "image") {
    if (!mediaUrl) {
      throw new Error(`Mensagem ${messageId} do tipo image sem media_url`);
    }

    if (!content) {
      throw new Error(`Mensagem ${messageId} do tipo image sem legenda/conteúdo`);
    }
  }

  return {
    id: messageId,
    conversationId: row.conversation_id ?? null,
    leadId: row.lead_id ?? null,
    phone,
    content,
    messageType,
    mediaUrl,
    metadata,
  };
}

async function getWhatsappIntegration(
  supabase: SupabaseClient,
  organizationId: string,
  storeId: string,
): Promise<WhatsappIntegration> {
  const { data, error } = await supabase.rpc("get_whatsapp_integration", {
    p_organization_id: organizationId,
    p_store_id: storeId,
  });

  if (error) {
    throw new Error(`Erro ao buscar integração WhatsApp: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const integration = row as WhatsappIntegrationRow | null | undefined;

  const accessToken = integration?.access_token?.trim() || "";
  const phoneNumberId = integration?.phone_number_id?.trim() || "";

  if (!accessToken) {
    throw new Error("Integração WhatsApp sem access_token");
  }

  if (!phoneNumberId) {
    throw new Error("Integração WhatsApp sem phone_number_id");
  }

  return {
    accessToken,
    phoneNumberId,
  };
}

async function getPendingExternalMessages(
  supabase: SupabaseClient,
  organizationId: string,
  storeId: string,
): Promise<PendingExternalMessage[]> {
  const { data, error } = await supabase.rpc("get_pending_external_messages", {
    p_organization_id: organizationId,
    p_store_id: storeId,
  });

  if (error) {
    throw new Error(`Erro ao buscar mensagens pendentes: ${error.message}`);
  }

  const rows = Array.isArray(data) ? (data as PendingExternalMessageRow[]) : [];

  return rows.map(normalizePendingMessage);
}

async function markMessageExternalSent(
  supabase: SupabaseClient,
  messageId: string,
  externalMessageId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("mark_message_external_sent", {
    p_message_id: messageId,
    p_external_message_id: externalMessageId,
  });

  if (error) {
    throw new Error(
      `Erro ao marcar message ${messageId} como enviada externamente: ${error.message}`,
    );
  }

  const result = Array.isArray(data)
    ? data[0]
    : (data as MarkSentResult | null);

  if (result && result.ok === false) {
    throw new Error(
      result.error || `Falha ao marcar message ${messageId} como enviada`,
    );
  }

  if (result && result.success === false) {
    throw new Error(
      result.error || `Falha ao marcar message ${messageId} como enviada`,
    );
  }
}

type WhatsAppSendResponse = {
  messaging_product?: string;
  contacts?: Array<{
    input?: string;
    wa_id?: string;
  }>;
  messages?: Array<{
    id?: string;
    message_status?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_data?: unknown;
    fbtrace_id?: string;
  };
};

async function sendWhatsappTextMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  body: string;
}): Promise<string> {
  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${params.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: params.to,
        type: "text",
        text: {
          preview_url: false,
          body: params.body,
        },
      }),
    },
  );

  const payload = (await response.json()) as WhatsAppSendResponse;

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        `Falha HTTP ${response.status} ao enviar texto para WhatsApp`,
    );
  }

  const messageId = payload?.messages?.[0]?.id;

  if (!messageId) {
    throw new Error("Resposta do WhatsApp sem messages[0].id no envio de texto");
  }

  return messageId;
}

async function sendWhatsappImageMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  imageUrl: string;
  caption: string;
}): Promise<string> {
  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${params.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: params.to,
        type: "image",
        image: {
          link: params.imageUrl,
          caption: params.caption,
        },
      }),
    },
  );

  const payload = (await response.json()) as WhatsAppSendResponse;

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        `Falha HTTP ${response.status} ao enviar imagem para WhatsApp`,
    );
  }

  const messageId = payload?.messages?.[0]?.id;

  if (!messageId) {
    throw new Error("Resposta do WhatsApp sem messages[0].id no envio de imagem");
  }

  return messageId;
}

async function sendSinglePendingMessage(
  integration: WhatsappIntegration,
  message: PendingExternalMessage,
): Promise<string> {
  if (message.messageType === "image") {
    return sendWhatsappImageMessage({
      accessToken: integration.accessToken,
      phoneNumberId: integration.phoneNumberId,
      to: message.phone,
      imageUrl: message.mediaUrl || "",
      caption: message.content,
    });
  }

  return sendWhatsappTextMessage({
    accessToken: integration.accessToken,
    phoneNumberId: integration.phoneNumberId,
    to: message.phone,
    body: message.content,
  });
}

export async function processWhatsappPendingMessages(
  input: ProcessWhatsappPendingMessagesInput,
): Promise<ProcessWhatsappPendingMessagesResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const supabase = getSupabaseAdmin();

  const integration = await getWhatsappIntegration(
    supabase,
    input.organizationId,
    input.storeId,
  );

  const pending = await getPendingExternalMessages(
    supabase,
    input.organizationId,
    input.storeId,
  );

  const selected = pending.slice(0, limit);

  const results: ProcessWhatsappPendingMessagesResult["results"] = [];
  let sent = 0;
  let failed = 0;

  for (const message of selected) {
    const skipReason = shouldSkipExternalSend(message.metadata);

    if (skipReason) {
      results.push({
        messageId: message.id,
        status: "skipped",
        detail: skipReason,
      });
      continue;
    }

    try {
      const whatsappMessageId = await sendSinglePendingMessage(
        integration,
        message,
      );

      await markMessageExternalSent(supabase, message.id, whatsappMessageId);

      sent += 1;
      results.push({
        messageId: message.id,
        status: "sent",
        detail: `Enviado com sucesso como ${message.messageType}`,
        whatsappMessageId,
      });
    } catch (error) {
      failed += 1;

      const detail =
        error instanceof Error ? error.message : "Erro desconhecido no envio";

      results.push({
        messageId: message.id,
        status: "failed",
        detail,
      });
    }
  }

  return {
    ok: true,
    processed: selected.length,
    sent,
    failed,
    results,
  };
}
