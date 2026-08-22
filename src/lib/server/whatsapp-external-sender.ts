import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  finalizeSalesQuoteSendBySystem,
  isSalesQuoteSendMetadata,
} from "@/lib/server/sales-quotes/quote-send";

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
  organization_id?: string | null;
  store_id?: string | null;
  conversation_id?: string | null;
  lead_id?: string | null;
  content?: string | null;
  message_type?: string | null;
  media_url?: string | null;
  metadata?: Json | null;
  external_message_id?: string | null;
  outbound_delivery_state?: string | null;
  outbound_idempotency_key?: string | null;
  outbound_claimed_at?: string | null;
  outbound_attempt_started_at?: string | null;
  outbound_provider_accepted_at?: string | null;
  outbound_commercial_finalized_at?: string | null;
  outbound_commercial_error_text?: string | null;
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
  organizationId: string;
  storeId: string;
  conversationId: string | null;
  leadId: string | null;
  phone: string;
  content: string;
  rawMessageType: string;
  messageType: "text" | "image" | "document";
  mediaUrl: string | null;
  metadata: Record<string, unknown>;
  externalMessageId: string | null;
  outboundDeliveryState: string | null;
  outboundIdempotencyKey: string | null;
  outboundClaimedAt: string | null;
  outboundAttemptStartedAt: string | null;
  outboundProviderAcceptedAt: string | null;
  outboundCommercialFinalizedAt: string | null;
  outboundCommercialErrorText: string | null;
};

type MessageScope = Pick<
  PendingExternalMessage,
  "id" | "organizationId" | "storeId"
>;

type QuoteSendReconciliationRow = {
  id?: string | null;
  organization_id?: string | null;
  store_id?: string | null;
  metadata?: Json | null;
  external_message_id?: string | null;
  outbound_delivery_state?: string | null;
  outbound_provider_accepted_at?: string | null;
  outbound_commercial_finalized_at?: string | null;
};

type QuoteSendReconciliationMessage = {
  id: string;
  organizationId: string;
  storeId: string;
  metadata: Record<string, unknown>;
  externalMessageId: string | null;
  outboundDeliveryState: string | null;
  outboundProviderAcceptedAt: string | null;
  outboundCommercialFinalizedAt: string | null;
};

type WhatsappIntegrationRow = {
  access_token?: string | null;
  phone_number_id?: string | null;
};

type WhatsappIntegration = {
  accessToken: string;
  phoneNumberId: string;
};

type MarkSentResult = {
  message_id?: string | null;
  external_message_id?: string | null;
  outbound_delivery_state?: string | null;
  outbound_provider_accepted_at?: string | null;
  outcome?: string | null;
};

type QuoteSendMetadata = {
  commercial_opportunity_id?: unknown;
  sales_quote_id?: unknown;
  sales_quote_version_id?: unknown;
};

type FinalizedQuoteSendRef = {
  commercialOpportunityId: string;
  salesQuoteId: string;
  salesQuoteVersionId: string;
};

type PreparedWhatsappTransportMessage =
  | {
      mode: "text";
      to: string;
      body: string;
    }
  | {
      mode: "image";
      to: string;
      imageUrl: string;
      caption: string;
    }
  | {
      mode: "document";
      to: string;
      documentUrl: string;
      filename: string;
      caption: string;
    };

type ClaimedMessageRow = { id?: string | null };
type TransitionResultRow = { id?: string | null };

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
  retryable: number;
  uncertain: number;
  results: Array<{
    messageId: string;
    status: "sent" | "failed" | "retryable" | "uncertain" | "skipped";
    detail: string;
    whatsappMessageId?: string | null;
  }>;
};

type ProcessDeps = {
  createSupabaseAdmin: () => SupabaseClient;
  getWhatsappIntegration: (
    supabase: SupabaseClient,
    organizationId: string,
    storeId: string,
  ) => Promise<WhatsappIntegration>;
  getPendingExternalMessages: (
    supabase: SupabaseClient,
    organizationId: string,
    storeId: string,
    limit: number,
  ) => Promise<PendingExternalMessage[]>;
  claimMessageForExternalSend: (
    supabase: SupabaseClient,
    message: PendingExternalMessage,
  ) => Promise<boolean>;
  releaseClaimedMessage: (
    supabase: SupabaseClient,
    message: MessageScope,
    errorText: string | null,
  ) => Promise<void>;
  markMessageAttemptStarted: (
    supabase: SupabaseClient,
    message: MessageScope,
  ) => Promise<void>;
  markMessageRetryableFailure: (
    supabase: SupabaseClient,
    message: MessageScope,
    errorText: string,
  ) => Promise<void>;
  markMessageFailed: (
    supabase: SupabaseClient,
    message: MessageScope,
    errorText: string,
  ) => Promise<void>;
  markMessageUncertain: (
    supabase: SupabaseClient,
    message: MessageScope,
    errorText: string,
    knownProviderMessageId?: string | null,
  ) => Promise<void>;
  markMessageExternalSent: (
    supabase: SupabaseClient,
    message: MessageScope,
    externalMessageId: string,
  ) => Promise<void>;
  markMessageCommercialFinalizationPending: (
    supabase: SupabaseClient,
    message: MessageScope,
    errorText: string,
  ) => Promise<void>;
  preparePendingMessageForSend: (
    supabase: SupabaseClient,
    message: PendingExternalMessage,
  ) => Promise<PreparedWhatsappTransportMessage>;
  sendSinglePendingMessage: (
    integration: WhatsappIntegration,
    preparedMessage: PreparedWhatsappTransportMessage,
  ) => Promise<string>;
  finalizeQuoteSendMessageIfNeeded: (
    supabase: SupabaseClient,
    message: {
      id: string;
      organizationId: string;
      storeId: string;
      metadata: Record<string, unknown>;
    },
  ) => Promise<FinalizedQuoteSendRef | null>;
  reconcileSentQuoteSendMessages: (
    supabase: SupabaseClient,
    organizationId: string,
    storeId: string,
    limit: number,
  ) => Promise<Array<{ messageId: string; detail: string }>>;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const META_WHATSAPP_ACCESS_TOKEN = process.env.META_WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";
const OUTBOUND_MEDIA_SIGNED_URL_EXPIRATION_SECONDS = 300;
const PROCESSING_LEASE_SECONDS = 10 * 60;

class KnownWhatsappSendFailure extends Error {
  readonly retryable: boolean;
  readonly httpStatus: number;

  constructor(message: string, args: { retryable: boolean; httpStatus: number }) {
    super(message);
    this.name = "KnownWhatsappSendFailure";
    this.retryable = args.retryable;
    this.httpStatus = args.httpStatus;
  }
}

function getSupabaseAdmin(): SupabaseClient {
  if (!SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL nao esta definido");
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY nao esta definido");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
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

function normalizeMetadata(value: Json | null | undefined): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readMetadataText(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isHttpUrl(value: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function resolveWhatsappAccessToken(integration?: WhatsappIntegrationRow | null): string {
  const integrationToken = integration?.access_token?.trim() || "";
  if (integrationToken) return integrationToken;
  const token = META_WHATSAPP_ACCESS_TOKEN?.trim() || "";
  if (!token) {
    throw new Error(
      "Integracao WhatsApp sem token de acesso configurado no banco ou em META_WHATSAPP_ACCESS_TOKEN",
    );
  }
  return token;
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
    if (normalized) return normalized;
  }
  return null;
}

function normalizePendingMessage(row: PendingExternalMessageRow): PendingExternalMessage {
  const messageId = normalizeText(row.id ?? row.message_id);
  const organizationId = normalizeText(row.organization_id);
  const storeId = normalizeText(row.store_id);
  const phone = extractPhone(row);

  if (!messageId) {
    throw new Error(`Mensagem pendente sem id. Campos recebidos: ${Object.keys(row).join(", ")}`);
  }
  if (!organizationId || !storeId) {
    throw new Error(`Mensagem ${messageId} sem escopo tenant canonico.`);
  }
  if (!phone) {
    throw new Error(
      `Mensagem ${messageId} sem telefone do lead. Campos recebidos: ${Object.keys(row).join(", ")}`,
    );
  }

  const rawType = String(row.message_type || "text").toLowerCase();
  const messageType: "text" | "image" | "document" =
    rawType === "image" ? "image" : rawType === "document" ? "document" : "text";
  const content = String(row.content || "").trim();
  const mediaUrl = row.media_url?.trim() || null;
  const metadata = normalizeMetadata(row.metadata);

  if (messageType === "text" && !content) {
    throw new Error(`Mensagem ${messageId} do tipo text sem conteudo`);
  }
  if ((messageType === "image" || messageType === "document") && (!mediaUrl || !content)) {
    throw new Error(`Mensagem ${messageId} do tipo ${messageType} sem media_url ou conteudo`);
  }

  return {
    id: messageId,
    organizationId,
    storeId,
    conversationId: normalizeText(row.conversation_id) || null,
    leadId: normalizeText(row.lead_id) || null,
    phone,
    content,
    rawMessageType: rawType,
    messageType,
    mediaUrl,
    metadata,
    externalMessageId: normalizeText(row.external_message_id) || null,
    outboundDeliveryState: normalizeText(row.outbound_delivery_state) || null,
    outboundIdempotencyKey: normalizeText(row.outbound_idempotency_key) || null,
    outboundClaimedAt: normalizeText(row.outbound_claimed_at) || null,
    outboundAttemptStartedAt: normalizeText(row.outbound_attempt_started_at) || null,
    outboundProviderAcceptedAt: normalizeText(row.outbound_provider_accepted_at) || null,
    outboundCommercialFinalizedAt: normalizeText(row.outbound_commercial_finalized_at) || null,
    outboundCommercialErrorText: normalizeText(row.outbound_commercial_error_text) || null,
  };
}

function normalizeQuoteSendReconciliationMessage(
  row: QuoteSendReconciliationRow,
): QuoteSendReconciliationMessage {
  const id = normalizeText(row.id);
  const organizationId = normalizeText(row.organization_id);
  const storeId = normalizeText(row.store_id);
  if (!id || !organizationId || !storeId) {
    throw new Error("Quote send sent sem escopo canonico suficiente para reconciliacao.");
  }

  return {
    id,
    organizationId,
    storeId,
    metadata: normalizeMetadata(row.metadata),
    externalMessageId: normalizeText(row.external_message_id) || null,
    outboundDeliveryState: normalizeText(row.outbound_delivery_state) || null,
    outboundProviderAcceptedAt: normalizeText(row.outbound_provider_accepted_at) || null,
    outboundCommercialFinalizedAt: normalizeText(row.outbound_commercial_finalized_at) || null,
  };
}

function shouldSkipExternalSend(metadata: Record<string, unknown>): string | null {
  if (coerceBoolean(metadata.internal_only) === true) {
    return "Mensagem marcada como interna e nao deve sair no WhatsApp.";
  }
  if (coerceBoolean(metadata.send_external) === false) {
    return "Mensagem marcada para nao enviar externamente.";
  }
  return null;
}

function getWhatsappEligibilityFailure(message: PendingExternalMessage): string | null {
  const skipReason = shouldSkipExternalSend(message.metadata);
  if (skipReason) return skipReason;
  if (!["text", "image", "document"].includes(message.rawMessageType)) {
    return `Tipo de mensagem nao suportado pelo sender WhatsApp: ${message.rawMessageType}`;
  }
  if (readMetadataText(message.metadata, "external_channel")?.toLowerCase() !== "whatsapp") {
    return "Mensagem sem canal externo elegivel para WhatsApp.";
  }
  if (coerceBoolean(message.metadata.send_external) !== true) {
    return "Mensagem sem confirmacao explicita para envio externo.";
  }
  if (message.outboundDeliveryState === "uncertain") {
    return "Mensagem em estado uncertain e nao pode ser reenviada cegamente.";
  }
  return null;
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
  if (error) throw new Error(`Erro ao buscar integracao WhatsApp: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  const integration = row as WhatsappIntegrationRow | null | undefined;
  const accessToken = resolveWhatsappAccessToken(integration);
  const phoneNumberId = integration?.phone_number_id?.trim() || "";
  if (!phoneNumberId) throw new Error("Integracao WhatsApp sem phone_number_id");
  return { accessToken, phoneNumberId };
}

async function getPendingExternalMessages(
  supabase: SupabaseClient,
  organizationId: string,
  storeId: string,
  limit: number,
): Promise<PendingExternalMessage[]> {
  const { data, error } = await supabase.rpc("get_pending_external_messages_v2", {
    p_organization_id: organizationId,
    p_store_id: storeId,
    p_limit: Math.max(1, Math.min(limit, 100)),
    p_processing_lease_seconds: PROCESSING_LEASE_SECONDS,
  });
  if (error) throw new Error(`Erro ao buscar mensagens pendentes: ${error.message}`);
  const rows = Array.isArray(data) ? (data as PendingExternalMessageRow[]) : [];
  return rows.map(normalizePendingMessage);
}

async function claimMessageForExternalSend(
  supabase: SupabaseClient,
  message: PendingExternalMessage,
) {
  const now = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - PROCESSING_LEASE_SECONDS * 1000).toISOString();
  const { data, error } = await supabase
    .from("messages")
    .update({
      outbound_delivery_state: "processing",
      outbound_claimed_at: now,
      outbound_claimed_by: `whatsapp-cron:${message.organizationId}:${message.storeId}`,
      outbound_error_text: null,
    })
    .eq("id", message.id)
    .eq("organization_id", message.organizationId)
    .eq("store_id", message.storeId)
    .is("deleted_at", null)
    .is("external_message_id", null)
    .or(
      `outbound_delivery_state.is.null,outbound_delivery_state.eq.pending,and(outbound_delivery_state.eq.processing,outbound_attempt_started_at.is.null,outbound_claimed_at.lt.${staleThreshold})`,
    )
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Falha ao claimar mensagem ${message.id}: ${error.message}`);
  return Boolean((data as ClaimedMessageRow | null)?.id);
}

async function releaseClaimedMessage(
  supabase: SupabaseClient,
  message: MessageScope,
  errorText: string | null,
) {
  const { data, error } = await supabase
    .from("messages")
    .update({
      outbound_delivery_state: "pending",
      outbound_claimed_at: null,
      outbound_claimed_by: null,
      outbound_error_text: errorText,
    })
    .eq("id", message.id)
    .eq("organization_id", message.organizationId)
    .eq("store_id", message.storeId)
    .eq("outbound_delivery_state", "processing")
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Falha ao liberar claim da mensagem ${message.id}: ${error.message}`);
  if (!(data as TransitionResultRow | null)?.id) {
    throw new Error(`Falha ao liberar claim da mensagem ${message.id}: transicao perdida.`);
  }
}

async function markMessageAttemptStarted(supabase: SupabaseClient, message: MessageScope) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("messages")
    .update({
      // Conservador por desenho: a partir deste commit local nao existe retry cego.
      outbound_delivery_state: "uncertain",
      outbound_attempt_started_at: now,
      outbound_uncertain_at: now,
      outbound_claimed_at: null,
      outbound_claimed_by: null,
      outbound_error_text: null,
    })
    .eq("id", message.id)
    .eq("organization_id", message.organizationId)
    .eq("store_id", message.storeId)
    .eq("outbound_delivery_state", "processing")
    .is("external_message_id", null)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(`Falha ao marcar inicio de tentativa externa da mensagem ${message.id}: ${error.message}`);
  }
  if (!(data as TransitionResultRow | null)?.id) {
    throw new Error(`Falha ao marcar inicio de tentativa externa da mensagem ${message.id}: transicao perdida.`);
  }
}

async function markMessageRetryableFailure(
  supabase: SupabaseClient,
  message: MessageScope,
  errorText: string,
) {
  const { data, error } = await supabase
    .from("messages")
    .update({
      outbound_delivery_state: "pending",
      outbound_claimed_at: null,
      outbound_claimed_by: null,
      outbound_attempt_started_at: null,
      outbound_uncertain_at: null,
      outbound_error_text: errorText,
    })
    .eq("id", message.id)
    .eq("organization_id", message.organizationId)
    .eq("store_id", message.storeId)
    .eq("outbound_delivery_state", "uncertain")
    .is("external_message_id", null)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Falha ao devolver mensagem ${message.id} para retry: ${error.message}`);
  if (!(data as TransitionResultRow | null)?.id) {
    throw new Error(`Falha ao devolver mensagem ${message.id} para retry: transicao perdida.`);
  }
}

async function markMessageFailed(
  supabase: SupabaseClient,
  message: MessageScope,
  errorText: string,
) {
  const { data, error } = await supabase
    .from("messages")
    .update({
      outbound_delivery_state: "failed",
      outbound_claimed_at: null,
      outbound_claimed_by: null,
      outbound_error_text: errorText,
    })
    .eq("id", message.id)
    .eq("organization_id", message.organizationId)
    .eq("store_id", message.storeId)
    .eq("outbound_delivery_state", "uncertain")
    .is("external_message_id", null)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Falha ao marcar falha deterministica da mensagem ${message.id}: ${error.message}`);
  if (!(data as TransitionResultRow | null)?.id) {
    throw new Error(`Falha ao marcar falha deterministica da mensagem ${message.id}: transicao perdida.`);
  }
}

async function markMessageUncertain(
  supabase: SupabaseClient,
  message: MessageScope,
  errorText: string,
  knownProviderMessageId?: string | null,
) {
  const now = new Date().toISOString();
  const providerSuffix = knownProviderMessageId
    ? `; provider_message_id_conhecido=${knownProviderMessageId}`
    : "";
  const { data, error } = await supabase
    .from("messages")
    .update({
      outbound_delivery_state: "uncertain",
      outbound_uncertain_at: now,
      outbound_claimed_at: null,
      outbound_claimed_by: null,
      outbound_error_text: `${errorText}${providerSuffix}`.slice(0, 4000),
    })
    .eq("id", message.id)
    .eq("organization_id", message.organizationId)
    .eq("store_id", message.storeId)
    .eq("outbound_delivery_state", "uncertain")
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Falha ao marcar estado incerto da mensagem ${message.id}: ${error.message}`);
  if (!(data as TransitionResultRow | null)?.id) {
    throw new Error(`Falha ao marcar estado incerto da mensagem ${message.id}: transicao perdida.`);
  }
}

async function markMessageExternalSent(
  supabase: SupabaseClient,
  message: MessageScope,
  externalMessageId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("mark_message_external_sent_v2", {
    p_organization_id: message.organizationId,
    p_store_id: message.storeId,
    p_message_id: message.id,
    p_external_message_id: externalMessageId,
  });
  if (error) {
    throw new Error(`Erro ao persistir aceite do provider da message ${message.id}: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : (data as MarkSentResult | null);
  if (
    !row ||
    normalizeText(row.message_id) !== message.id ||
    normalizeText(row.external_message_id) !== externalMessageId ||
    normalizeText(row.outbound_delivery_state) !== "sent"
  ) {
    throw new Error(`RPC de aceite do provider retornou contrato invalido para message ${message.id}`);
  }
}

async function markMessageCommercialFinalizationPending(
  supabase: SupabaseClient,
  message: MessageScope,
  errorText: string,
) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("messages")
    .update({
      outbound_commercial_error_at: now,
      outbound_commercial_error_text: errorText.slice(0, 4000),
    })
    .eq("id", message.id)
    .eq("organization_id", message.organizationId)
    .eq("store_id", message.storeId)
    .eq("outbound_delivery_state", "sent")
    .not("external_message_id", "is", null)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(`Falha ao registrar pendencia comercial da mensagem ${message.id}: ${error.message}`);
  }
  if (!(data as TransitionResultRow | null)?.id) {
    throw new Error(`Falha ao registrar pendencia comercial da mensagem ${message.id}: transicao perdida.`);
  }
}

type WhatsAppSendResponse = {
  messages?: Array<{ id?: string }>;
  error?: { message?: string };
};

export function isRetryableWhatsappHttpStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function postWhatsappMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  body: Record<string, unknown>;
  label: string;
}) {
  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${params.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params.body),
    },
  );
  const payload = (await response.json()) as WhatsAppSendResponse;
  if (!response.ok) {
    throw new KnownWhatsappSendFailure(
      payload?.error?.message || `Falha HTTP ${response.status} ao enviar ${params.label} para WhatsApp`,
      { retryable: isRetryableWhatsappHttpStatus(response.status), httpStatus: response.status },
    );
  }
  const messageId = normalizeText(payload?.messages?.[0]?.id);
  if (!messageId) throw new Error(`Resposta do WhatsApp sem messages[0].id no envio de ${params.label}`);
  return messageId;
}

async function sendWhatsappTextMessage(params: WhatsappIntegration & { to: string; body: string }) {
  return postWhatsappMessage({
    accessToken: params.accessToken,
    phoneNumberId: params.phoneNumberId,
    label: "texto",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "text",
      text: { preview_url: false, body: params.body },
    },
  });
}

async function sendWhatsappImageMessage(
  params: WhatsappIntegration & { to: string; imageUrl: string; caption: string },
) {
  return postWhatsappMessage({
    accessToken: params.accessToken,
    phoneNumberId: params.phoneNumberId,
    label: "imagem",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "image",
      image: { link: params.imageUrl, caption: params.caption },
    },
  });
}

async function sendWhatsappDocumentMessage(
  params: WhatsappIntegration & {
    to: string;
    documentUrl: string;
    filename: string;
    caption: string;
  },
) {
  return postWhatsappMessage({
    accessToken: params.accessToken,
    phoneNumberId: params.phoneNumberId,
    label: "documento",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "document",
      document: {
        link: params.documentUrl,
        filename: params.filename,
        caption: params.caption,
      },
    },
  });
}

async function resolveMediaOutboundUrl(args: {
  supabase: SupabaseClient;
  message: PendingExternalMessage;
}) {
  if (isHttpUrl(args.message.mediaUrl)) return String(args.message.mediaUrl || "").trim();
  const storageBucket = readMetadataText(args.message.metadata, "storage_bucket");
  const storagePath =
    readMetadataText(args.message.metadata, "storage_path") ||
    (args.message.mediaUrl && !isHttpUrl(args.message.mediaUrl)
      ? args.message.mediaUrl.trim()
      : null);
  if (!storageBucket || !storagePath) {
    throw new Error(`Mensagem ${args.message.id} sem storage_bucket/storage_path para midia externa`);
  }
  const { data, error } = await args.supabase.storage
    .from(storageBucket)
    .createSignedUrl(storagePath, OUTBOUND_MEDIA_SIGNED_URL_EXPIRATION_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(`Mensagem ${args.message.id} falhou ao gerar link temporario da midia`);
  }
  return data.signedUrl;
}

async function preparePendingMessageForSend(
  supabase: SupabaseClient,
  message: PendingExternalMessage,
): Promise<PreparedWhatsappTransportMessage> {
  if (message.messageType === "image") {
    return {
      mode: "image",
      to: message.phone,
      imageUrl: await resolveMediaOutboundUrl({ supabase, message }),
      caption: message.content,
    };
  }
  if (message.messageType === "document") {
    const filename =
      readMetadataText(message.metadata, "original_file_name") ||
      readMetadataText(message.metadata, "original_filename") ||
      "documento.pdf";
    const mimeType = readMetadataText(message.metadata, "mime_type");
    if (isSalesQuoteSendMetadata(message.metadata) && mimeType !== "application/pdf") {
      throw new Error(`Quote send ${message.id} nao aponta para application/pdf canonico.`);
    }
    return {
      mode: "document",
      to: message.phone,
      documentUrl: await resolveMediaOutboundUrl({ supabase, message }),
      filename,
      caption: message.content,
    };
  }
  return { mode: "text", to: message.phone, body: message.content };
}

async function sendSinglePendingMessage(
  integration: WhatsappIntegration,
  preparedMessage: PreparedWhatsappTransportMessage,
) {
  if (preparedMessage.mode === "image") {
    return sendWhatsappImageMessage({ ...integration, ...preparedMessage });
  }
  if (preparedMessage.mode === "document") {
    return sendWhatsappDocumentMessage({ ...integration, ...preparedMessage });
  }
  return sendWhatsappTextMessage({ ...integration, ...preparedMessage });
}

function extractQuoteSendMetadata(
  metadata: Record<string, unknown>,
): { commercialOpportunityId: string; salesQuoteId: string; salesQuoteVersionId: string } | null {
  if (!isSalesQuoteSendMetadata(metadata)) return null;
  const typed = metadata as QuoteSendMetadata;
  const commercialOpportunityId = normalizeText(typed.commercial_opportunity_id);
  const salesQuoteId = normalizeText(typed.sales_quote_id);
  const salesQuoteVersionId = normalizeText(typed.sales_quote_version_id);
  if (!commercialOpportunityId || !salesQuoteId || !salesQuoteVersionId) {
    throw new Error("SALES_QUOTE_SEND_METADATA_SCOPE_REQUIRED");
  }
  return { commercialOpportunityId, salesQuoteId, salesQuoteVersionId };
}

async function finalizeQuoteSendMessageIfNeeded(
  supabase: SupabaseClient,
  message: {
    id: string;
    organizationId: string;
    storeId: string;
    metadata: Record<string, unknown>;
  },
) {
  const quoteSend = extractQuoteSendMetadata(message.metadata);
  if (!quoteSend) return null;
  await finalizeSalesQuoteSendBySystem({
    supabase,
    organizationId: message.organizationId,
    storeId: message.storeId,
    commercialOpportunityId: quoteSend.commercialOpportunityId,
    salesQuoteId: quoteSend.salesQuoteId,
    salesQuoteVersionId: quoteSend.salesQuoteVersionId,
    messageId: message.id,
  });
  return quoteSend;
}

async function reconcileSentQuoteSendMessages(
  supabase: SupabaseClient,
  organizationId: string,
  storeId: string,
  limit: number,
) {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, organization_id, store_id, metadata, external_message_id, outbound_delivery_state, outbound_provider_accepted_at, outbound_commercial_finalized_at",
    )
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("outbound_delivery_state", "sent")
    .contains("metadata", { outbound_origin: "sales_quote_send" })
    .not("external_message_id", "is", null)
    .not("outbound_provider_accepted_at", "is", null)
    .is("outbound_commercial_finalized_at", null)
    .is("deleted_at", null)
    .order("outbound_provider_accepted_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw new Error(`Erro ao listar quote sends para reconciliacao: ${error.message}`);

  const rows = Array.isArray(data) ? (data as QuoteSendReconciliationRow[]) : [];
  const reconciled: Array<{ messageId: string; detail: string }> = [];
  for (const row of rows) {
    let message: QuoteSendReconciliationMessage;
    try {
      message = normalizeQuoteSendReconciliationMessage(row);
    } catch (error) {
      console.error("[whatsapp-external-sender] row invalida de reconciliacao", error);
      continue;
    }

    if (message.organizationId !== organizationId || message.storeId !== storeId) {
      console.error("[whatsapp-external-sender] row cross-tenant recusada na reconciliacao", {
        messageId: message.id,
        organizationId: message.organizationId,
        storeId: message.storeId,
      });
      continue;
    }

    try {
      const finalized = await finalizeQuoteSendMessageIfNeeded(supabase, message);
      if (!finalized) throw new Error("SALES_QUOTE_SEND_RECONCILIATION_ORIGIN_REQUIRED");
      reconciled.push({
        messageId: message.id,
        detail: "finalizacao comercial reconciliada sem novo POST externo",
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Erro desconhecido na reconciliacao";
      console.error("[whatsapp-external-sender] falha ao reconciliar quote send", {
        messageId: message.id,
        organizationId,
        storeId,
        detail,
      });
      await markMessageCommercialFinalizationPending(supabase, message, detail);
    }
  }
  return reconciled;
}

function createProcessWhatsappPendingMessages(deps?: Partial<ProcessDeps>) {
  const resolvedDeps: ProcessDeps = {
    createSupabaseAdmin: deps?.createSupabaseAdmin ?? getSupabaseAdmin,
    getWhatsappIntegration: deps?.getWhatsappIntegration ?? getWhatsappIntegration,
    getPendingExternalMessages: deps?.getPendingExternalMessages ?? getPendingExternalMessages,
    claimMessageForExternalSend: deps?.claimMessageForExternalSend ?? claimMessageForExternalSend,
    releaseClaimedMessage: deps?.releaseClaimedMessage ?? releaseClaimedMessage,
    markMessageAttemptStarted: deps?.markMessageAttemptStarted ?? markMessageAttemptStarted,
    markMessageRetryableFailure: deps?.markMessageRetryableFailure ?? markMessageRetryableFailure,
    markMessageFailed: deps?.markMessageFailed ?? markMessageFailed,
    markMessageUncertain: deps?.markMessageUncertain ?? markMessageUncertain,
    markMessageExternalSent: deps?.markMessageExternalSent ?? markMessageExternalSent,
    markMessageCommercialFinalizationPending:
      deps?.markMessageCommercialFinalizationPending ?? markMessageCommercialFinalizationPending,
    preparePendingMessageForSend: deps?.preparePendingMessageForSend ?? preparePendingMessageForSend,
    sendSinglePendingMessage: deps?.sendSinglePendingMessage ?? sendSinglePendingMessage,
    finalizeQuoteSendMessageIfNeeded:
      deps?.finalizeQuoteSendMessageIfNeeded ?? finalizeQuoteSendMessageIfNeeded,
    reconcileSentQuoteSendMessages:
      deps?.reconcileSentQuoteSendMessages ?? reconcileSentQuoteSendMessages,
  };

  return async function processWhatsappPendingMessages(
    input: ProcessWhatsappPendingMessagesInput,
  ): Promise<ProcessWhatsappPendingMessagesResult> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const supabase = resolvedDeps.createSupabaseAdmin();
    const results: ProcessWhatsappPendingMessagesResult["results"] = [];
    let sent = 0;
    let failed = 0;
    let retryable = 0;
    let uncertain = 0;

    // Reconciliation is deliberately independent of the Meta integration/token.
    try {
      const reconciled = await resolvedDeps.reconcileSentQuoteSendMessages(
        supabase,
        input.organizationId,
        input.storeId,
        limit,
      );
      for (const item of reconciled) {
        results.push({ messageId: item.messageId, status: "sent", detail: item.detail });
      }
    } catch (error) {
      console.error("[whatsapp-external-sender] falha global de reconciliacao", {
        organizationId: input.organizationId,
        storeId: input.storeId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    const pending = await resolvedDeps.getPendingExternalMessages(
      supabase,
      input.organizationId,
      input.storeId,
      limit,
    );
    const selected = pending.slice(0, limit);
    let integration: WhatsappIntegration | null = null;

    for (const message of selected) {
      if (
        message.organizationId !== input.organizationId ||
        message.storeId !== input.storeId
      ) {
        results.push({
          messageId: message.id,
          status: "skipped",
          detail: "Mensagem recusada por divergencia de organization/store no worker.",
        });
        continue;
      }

      const eligibilityFailure = getWhatsappEligibilityFailure(message);
      if (eligibilityFailure) {
        results.push({ messageId: message.id, status: "skipped", detail: eligibilityFailure });
        continue;
      }

      const claimed = await resolvedDeps.claimMessageForExternalSend(supabase, message);
      if (!claimed) {
        results.push({
          messageId: message.id,
          status: "skipped",
          detail: "Mensagem ja foi claimada por outra instancia do worker.",
        });
        continue;
      }

      let attemptStarted = false;
      let providerMessageId: string | null = null;
      try {
        const preparedMessage = await resolvedDeps.preparePendingMessageForSend(supabase, message);
        integration ??= await resolvedDeps.getWhatsappIntegration(
          supabase,
          input.organizationId,
          input.storeId,
        );

        // This persisted transition intentionally happens immediately before the POST.
        // A crash after this point is treated as uncertain, never blindly resent.
        await resolvedDeps.markMessageAttemptStarted(supabase, message);
        attemptStarted = true;

        providerMessageId = await resolvedDeps.sendSinglePendingMessage(
          integration,
          preparedMessage,
        );
        await resolvedDeps.markMessageExternalSent(supabase, message, providerMessageId);

        let detail = `Enviado com sucesso como ${message.messageType}`;
        try {
          const finalized = await resolvedDeps.finalizeQuoteSendMessageIfNeeded(supabase, message);
          if (finalized) detail = `${detail}; finalizacao comercial concluida`;
        } catch (error) {
          const finalizationDetail =
            error instanceof Error ? error.message : "Erro desconhecido na finalizacao comercial";
          console.error(
            "[whatsapp-external-sender] provider accepted, mas a finalizacao comercial falhou",
            {
              messageId: message.id,
              organizationId: message.organizationId,
              storeId: message.storeId,
              providerMessageId,
              detail: finalizationDetail,
            },
          );
          await resolvedDeps.markMessageCommercialFinalizationPending(
            supabase,
            message,
            finalizationDetail,
          );
          detail = `${detail}; finalizacao comercial pendente para reconciliacao`;
        }

        sent += 1;
        results.push({
          messageId: message.id,
          status: "sent",
          detail,
          whatsappMessageId: providerMessageId,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Erro desconhecido no envio";

        if (!attemptStarted) {
          await resolvedDeps.releaseClaimedMessage(supabase, message, detail);
          retryable += 1;
          results.push({ messageId: message.id, status: "retryable", detail });
          continue;
        }

        if (error instanceof KnownWhatsappSendFailure) {
          if (error.retryable) {
            await resolvedDeps.markMessageRetryableFailure(supabase, message, detail);
            retryable += 1;
            results.push({ messageId: message.id, status: "retryable", detail });
          } else {
            await resolvedDeps.markMessageFailed(supabase, message, detail);
            failed += 1;
            results.push({ messageId: message.id, status: "failed", detail });
          }
          continue;
        }

        if (providerMessageId) {
          console.error(
            "[whatsapp-external-sender] provider retornou id, mas a persistencia do source fact falhou",
            {
              messageId: message.id,
              organizationId: message.organizationId,
              storeId: message.storeId,
              providerMessageId,
              detail,
            },
          );
        }
        await resolvedDeps.markMessageUncertain(
          supabase,
          message,
          detail,
          providerMessageId,
        );
        uncertain += 1;
        results.push({
          messageId: message.id,
          status: "uncertain",
          detail,
          whatsappMessageId: providerMessageId,
        });
      }
    }

    return {
      ok: true,
      processed: selected.length,
      sent,
      failed,
      retryable,
      uncertain,
      results,
    };
  };
}

export const processWhatsappPendingMessages = createProcessWhatsappPendingMessages();
export { createProcessWhatsappPendingMessages };
