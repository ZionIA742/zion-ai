"use client";

import Link from "next/link";
import { KeyboardEvent, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type Lead = {
  id: string;
  organization_id: string;
  store_id: string | null;
  name: string | null;
  phone: string | null;
  state: string;
};

type Conversation = {
  id: string;
  organization_id: string;
  lead_id: string;
  created_at: string | null;
  status: string | null;
  is_human_active: boolean | null;
  last_status_reason: string | null;
  last_status_metadata: Record<string, unknown> | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: string | null;
  last_message_sender: string | null;
};

type MessageRow = {
  id: string;
  sender: string | null;
  content: string | null;
  direction: string | null;
  message_type: string | null;
  media_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

type CommercialTaskPayload = {
  intent?: string | null;
  next_step?: string | null;
  space_text?: string | null;
  handoff_type?: string | null;
  location_text?: string | null;
  handoff_origin?: string | null;
  recommended_model?: string | null;
  requested_area_m2?: number | string | null;
  needs_human_action?: boolean | null;
  relevant_objection?: string | null;
  conversation_summary?: string | null;
  customer_preferences?: string | null;
  last_customer_message?: string | null;
  preferred_period_text?: string | null;
  ad_model_or_requested_model?: string | null;
  allow_sales_ai_while_pending?: boolean | null;
};

type CommercialTask = {
  id: string;
  task_type: string;
  status: string | null;
  priority: string | null;
  title: string | null;
  description: string | null;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  task_payload: CommercialTaskPayload | null;
  created_at: string | null;
  updated_at: string | null;
};

type Appointment = {
  id: string;
  lead_id: string | null;
  conversation_id: string | null;
  appointment_type: string | null;
  status: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  address_text: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type LeadDetailsResponse = {
  ok: boolean;
  lead?: Lead;
  conversation?: Conversation | null;
  messages?: MessageRow[];
  commercialTasks?: CommercialTask[];
  appointments?: Appointment[];
  error?: string;
  message?: string;
};

type SimulateCustomerResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  customerMessageSaved?: boolean;
  aiReplySaved?: boolean;
  conversationId?: string;
  organizationId?: string;
  storeId?: string;
  customerText?: string;
  aiText?: string;
  persisted?: boolean;
  context?: {
    lastCustomerMessage?: string;
    leadName?: string;
    poolCountUsed?: number;
    storeDisplayName?: string;
    resolvedStoreId?: string;
    requestedStoreId?: string | null;
  };
  flow?: {
    mode?: string;
    message?: string;
  };
  debug?: Record<string, unknown>;
};

type SignedMediaUrlResponse = {
  ok: boolean;
  signedUrl?: string;
  mimeType?: string | null;
  attachmentKind?: string | null;
  fileName?: string | null;
  expiresInSeconds?: number;
  error?: string;
  message?: string;
};

type CreateSalesQuoteResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  quoteId?: string;
};

type GenerateSalesQuotePdfResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  quoteId?: string;
  versionId?: string;
  status?: string;
};

type GeneratedQuoteSummary = {
  id: string;
  quote_number: string | null;
  title: string | null;
  status: string | null;
  total_cents: number | null;
  created_at: string | null;
  current_version_id: string | null;
  current_version: {
    id: string;
    status: string | null;
    original_filename: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    storage_bucket: string | null;
    storage_path: string | null;
  } | null;
};

type SalesQuoteListResponse = {
  ok: boolean;
  quotes?: GeneratedQuoteSummary[];
  error?: string;
  message?: string;
};

type SalesQuoteDetailResponse = {
  ok: boolean;
  quote?: {
    id: string;
    quote_number: string | null;
    status: string | null;
    title: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    customer_notes: string | null;
    internal_notes: string | null;
    payment_terms: string | null;
    delivery_terms: string | null;
    warranty_terms: string | null;
    valid_until: string | null;
    subtotal_cents: number | null;
    discount_cents: number | null;
    total_cents: number | null;
    current_version_id: string | null;
    lead_id: string | null;
    conversation_id: string | null;
    store_id: string;
    organization_id: string;
  };
  items?: Array<{
    id: string;
    item_type: string | null;
    name: string | null;
    description: string | null;
    quantity: number | null;
    unit_price_cents: number | null;
    discount_cents: number | null;
    total_cents: number | null;
    catalog_item_id: string | null;
    pool_model_id: string | null;
  }>;
  current_version?: {
    id: string;
    version_number: number | null;
    status: string | null;
    original_filename: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    storage_bucket: string | null;
    storage_path: string | null;
    created_at: string | null;
  } | null;
  error?: string;
  message?: string;
};

type SignedQuotePdfUrlResponse = {
  ok: boolean;
  signedUrl?: string;
  originalFilename?: string | null;
  mimeType?: string | null;
  expiresIn?: number;
  error?: string;
  message?: string;
};

type SalesQuoteActionResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  quoteId?: string;
  status?: string;
  versionId?: string;
  quoteNumber?: string | null;
  changeRequestId?: string;
};

type GeneratedContractSummary = {
  id: string;
  contract_number: string | null;
  title: string | null;
  status: string | null;
  total_cents: number | null;
  current_version_id: string | null;
  quote_id: string | null;
  quote_version_id: string | null;
  sent_at: string | null;
  customer_signed_at: string | null;
  store_signed_at: string | null;
  completed_at: string | null;
  created_at: string | null;
};

type SalesContractListResponse = {
  ok: boolean;
  contracts?: GeneratedContractSummary[];
  error?: string;
  message?: string;
};

type SalesContractActionResponse = {
  ok: boolean;
  contract?: GeneratedContractSummary | Record<string, unknown>;
  current_version?: {
    id: string;
    status: string | null;
  } | null;
  messageId?: string;
  error?: string;
  message?: string;
};

type SignedContractPdfUrlResponse = {
  ok: boolean;
  signedUrl?: string;
  originalFilename?: string | null;
  mimeType?: string | null;
  expiresIn?: number;
  error?: string;
  message?: string;
};

type SignedMediaState = {
  signedUrl: string;
  mimeType: string | null;
  attachmentKind: string | null;
  fileName: string | null;
  expiresAt: number | null;
};

type PendingCustomerAttachment = {
  file: File;
  kind: "document" | "media" | "audio";
  purpose: string;
  fileName: string;
  size: number;
  mimeType: string;
  previewUrl?: string | null;
};

type QuoteFormItem = {
  id: string;
  // TODO Bloco 3: mapear "pool_installation" para um tipo aceito pela API
  // (provavelmente "custom") ou ampliar a API para aceitar esse novo valor.
  itemType: "pool_installation" | "custom" | "service";
  name: string;
  description: string;
  quantity: string;
  unitPriceReais: string;
  discountReais: string;
};

type QuoteDraftPayload = {
  isQuoteModalOpen: boolean;
  quoteTitle: string;
  quoteCustomerNotes: string;
  quoteWarrantyTerms: string;
  quoteValidityDays: string;
  quoteItems: QuoteFormItem[];
};

type DetailTab = "summary" | "appointments" | "context" | "tasks" | "pdfs";
type GeneratedPdfTab = "quotes" | "contracts";
const VALID_DETAIL_TABS: DetailTab[] = ["summary", "appointments", "context", "tasks", "pdfs"];

function formatSender(message: MessageRow) {
  const sender = String(message.sender || "").toLowerCase();
  const direction = String(message.direction || "").toLowerCase();

  if (sender.includes("assistant") || sender.includes("ai") || sender.includes("bot")) {
    return "IA";
  }

  if (sender.includes("human") || sender.includes("agent")) {
    return "Humano";
  }

  if (sender.includes("user") && direction === "incoming") {
    return "Cliente";
  }

  if (sender.includes("user") && direction === "outgoing") {
    return "Humano";
  }

  if (direction === "outgoing") {
    return "Saida";
  }

  return "Cliente";
}

function bubbleClass(message: MessageRow) {
  const sender = String(message.sender || "").toLowerCase();
  const direction = String(message.direction || "").toLowerCase();

  if (
    sender.includes("assistant") ||
    sender.includes("ai") ||
    sender.includes("bot") ||
    sender.includes("human") ||
    sender.includes("agent") ||
    (sender.includes("user") && direction === "outgoing") ||
    direction === "outgoing"
  ) {
    return "ml-auto bg-black text-white";
  }

  return "mr-auto bg-white text-gray-900 ring-1 ring-black/10";
}

function formatDateTime(value: string | null) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data invalida";
  return date.toLocaleString("pt-BR");
}

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 KB";
  }

  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

function formatQuoteStatusLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();

  switch (normalized) {
    case "pending_review":
      return "Aguardando revisao";
    case "approved":
      return "Aprovado";
    case "sent":
      return "Enviado";
    case "changes_requested":
      return "Alteracoes solicitadas";
    case "failed":
      return "Falhou";
    case "draft":
      return "Rascunho";
    case "cancelled":
      return "Cancelado";
    case "expired":
      return "Expirado";
    default:
      return "Sem status";
  }
}

function formatContractStatusLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();

  switch (normalized) {
    case "pending_review":
      return "Aguardando revisao";
    case "approved":
      return "Aprovado";
    case "sent_to_customer":
      return "Enviado ao cliente";
    case "customer_signed":
      return "Aceito pelo cliente";
    case "completed":
      return "Concluido";
    case "cancelled":
      return "Cancelado";
    case "expired":
      return "Expirado";
    case "failed":
      return "Falhou";
    case "draft":
      return "Rascunho";
    case "sent":
      return "Enviado";
    case "store_signed":
      return "Confirmado pela loja";
    default:
      return "Sem status";
  }
}

function getQuoteSendErrorMessage(errorCode: string | null | undefined, fallback?: string | null) {
  switch (String(errorCode || "").trim().toUpperCase()) {
    case "QUOTE_SEND_DISABLED":
      return "O envio automatico de orcamento esta desativado nas configuracoes da loja.";
    case "QUOTE_REQUIRES_APPROVAL":
      return "Este orcamento precisa ser aprovado antes de ser enviado.";
    case "QUOTE_ALREADY_SENT":
    case "QUOTE_VERSION_ALREADY_SENT":
      return "Este orcamento ja foi enviado ao cliente.";
    default:
      return fallback || "Nao foi possivel enviar o orcamento ao cliente.";
  }
}

function createQuoteFormItemId() {
  return Math.random().toString(36).slice(2, 10);
}

function createEmptyQuoteFormItem(): QuoteFormItem {
  return {
    id: createQuoteFormItemId(),
    itemType: "pool_installation",
    name: "",
    description: "",
    quantity: "1",
    unitPriceReais: "",
    discountReais: "",
  };
}

function getQuoteItemTypeLabel(value: QuoteFormItem["itemType"]) {
  if (value === "pool_installation") {
    return "Piscina + instala\u00e7\u00e3o";
  }

  if (value === "service") {
    return "Servi\u00e7o";
  }

  return "Produto / item personalizado";
}

function parseQuoteMoneyValue(value: string) {
  const normalized = String(value || "").trim().replace(",", ".");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function convertReaisToCents(value: string) {
  return Math.round(parseQuoteMoneyValue(value) * 100);
}

function parseQuoteQuantityValue(value: string) {
  const normalized = String(value || "").trim().replace(",", ".");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return parsed;
}

function formatCurrencyBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatMoneyInputFromCents(cents: number | null | undefined) {
  const safeValue = typeof cents === "number" && Number.isFinite(cents) ? cents / 100 : 0;
  return safeValue.toFixed(2).replace(".", ",");
}

function convertQuoteValidUntilToDays(value: string | null | undefined) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "";
  }

  if (/^\d+$/.test(normalized)) {
    return normalized;
  }

  return "";
}

function buildGoogleMapsRouteUrl(addressText: string | null | undefined) {
  const safeAddress = String(addressText || "").trim();

  if (!safeAddress) {
    return null;
  }

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    safeAddress
  )}`;
}

function openGoogleMapsRoute(addressText: string | null | undefined) {
  const routeUrl = buildGoogleMapsRouteUrl(addressText);

  if (!routeUrl) {
    return;
  }

  window.open(routeUrl, "_blank", "noopener,noreferrer");
}


function PaperclipComposerIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.82l8.48-8.49" />
    </svg>
  );
}

function MicrophoneComposerIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
      <path d="M8 22h8" />
    </svg>
  );
}

function SendComposerIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="currentColor"
    >
      <path d="M3.4 20.4 21 12 3.4 3.6l2.05 7.05L14 12l-8.55 1.35L3.4 20.4Z" />
    </svg>
  );
}

function StopRecordingComposerIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="currentColor"
    >
      <path d="M7 7h10v10H7z" />
    </svg>
  );
}

function isCustomerLocationPhotoMessage(message: MessageRow) {
  if (String(message.message_type || "").trim().toLowerCase() !== "image") {
    return false;
  }

  const metadata =
    message.metadata && typeof message.metadata === "object"
      ? message.metadata
      : null;
  const mediaPurpose = String(metadata?.media_purpose || "")
    .trim()
    .toLowerCase();

  return mediaPurpose === "customer_location_photo";
}

function isCatalogProductPhotoMessage(message: MessageRow) {
  if (String(message.message_type || "").trim().toLowerCase() !== "image") {
    return false;
  }

  const metadata =
    message.metadata && typeof message.metadata === "object"
      ? message.metadata
      : null;
  const mediaPurpose = String(metadata?.media_purpose || "")
    .trim()
    .toLowerCase();
  const mediaUrl = String(message.media_url || "").trim();

  return (
    mediaPurpose === "catalog_product_photo" && /^https?:\/\//i.test(mediaUrl)
  );
}

function getMessageDisplayContent(message: MessageRow) {
  if (isCustomerLocationPhotoMessage(message)) {
    return "Foto do local recebida";
  }

  return message.content || "(mensagem sem conteudo textual)";
}

function getMessageSecondaryContent(message: MessageRow) {
  if (isCustomerLocationPhotoMessage(message)) {
    return "A imagem foi salva com seguranca para ajudar na recomendacao.";
  }

  return null;
}

function getMessageMetadata(message: MessageRow) {
  return message.metadata && typeof message.metadata === "object"
    ? message.metadata
    : null;
}

function getAttachmentKind(message: MessageRow) {
  const metadata = getMessageMetadata(message);
  return String(metadata?.attachment_kind || "").trim().toLowerCase();
}

function getNormalizedMessageType(message: MessageRow) {
  return String(message.message_type || "").trim().toLowerCase();
}

function isInlinePrivateMediaKind(
  value: string | null | undefined
): value is "image" | "audio" | "video" {
  return value === "image" || value === "audio" || value === "video";
}

function getInlinePrivateMediaKind(message: MessageRow) {
  if (isCatalogProductPhotoMessage(message)) {
    return null;
  }

  const attachmentKind = getAttachmentKind(message);
  if (isInlinePrivateMediaKind(attachmentKind)) {
    return attachmentKind;
  }

  const messageType = getNormalizedMessageType(message);
  const hasMediaUrl = Boolean(String(message.media_url || "").trim());

  if (hasMediaUrl && isInlinePrivateMediaKind(messageType)) {
    return messageType;
  }

  return null;
}

function getOriginalFileName(message: MessageRow) {
  const metadata = getMessageMetadata(message);
  return String(metadata?.original_file_name || "").trim();
}

function getMimeType(message: MessageRow) {
  const metadata = getMessageMetadata(message);
  return String(metadata?.mime_type || "").trim();
}

function getFriendlyMimeTypeLabel(mimeType: string | null | undefined) {
  const normalized = String(mimeType || "").trim().toLowerCase();

  if (!normalized) return "Arquivo";
  if (normalized === "application/pdf") return "Arquivo PDF";
  if (normalized.startsWith("image/")) return "Imagem";
  if (normalized.startsWith("video/")) return "Vídeo";
  if (normalized.startsWith("audio/")) return "Áudio";

  return "Arquivo";
}

function isStoredAttachmentMessage(message: MessageRow) {
  return Boolean(getAttachmentKind(message));
}

function getStoredAttachmentLabel(kind: string) {
  if (kind === "image") return "Imagem";
  if (kind === "audio") return "Audio";
  if (kind === "video") return "Video";
  if (kind === "file") return "Documento";
  return "Anexo";
}

function formatMessageTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFriendlyLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "Sem informacao";
  }

  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatLeadStage(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();

  const labels: Record<string, string> = {
    novo_lead: "Novo lead",
    qualificacao: "Qualificacao",
    orcamento: "Orcamento",
    negociacao: "Negociacao",
    fechamento_pagamento: "Fechamento / pagamento",
    pagamento_pendente_confirmacao: "Pagamento pendente",
    agendar_visita: "Agendar visita",
    agendar_instalacao: "Agendar instalacao",
    pos_venda_nps: "Pos-venda / follow-up",
    perdido: "Perdido",
    humano_assumiu: "Humano assumiu",
  };

  return labels[normalized] || formatFriendlyLabel(value);
}

function formatConversationStatus(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();

  const labels: Record<string, string> = {
    active: "Ativa",
    paused: "Pausada",
    humano_assumiu: "Humano assumiu",
    closed: "Encerrada",
    resolved: "Resolvida",
  };

  return labels[normalized] || formatFriendlyLabel(value);
}

function formatTaskTypeLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "commercial_visit_request") {
    return "Pedido de visita";
  }

  if (normalized === "commercial_quote_request") {
    return "Pedido de orcamento";
  }

  return formatFriendlyLabel(value);
}

function formatTaskStatusLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();

  const labels: Record<string, string> = {
    open: "Aberto",
    cancelled: "Cancelado",
    canceled: "Cancelado",
    resolved: "Resolvido",
    in_progress: "Em andamento",
    ready_to_execute: "Pronto para seguir",
    waiting_user_choice: "Aguardando escolha",
    waiting_customer_response: "Aguardando cliente",
    error: "Com erro",
  };

  return labels[normalized] || formatFriendlyLabel(value);
}

function formatPriorityLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();

  const labels: Record<string, string> = {
    urgent: "Urgente",
    high: "Alta",
    normal: "Normal",
    medium: "Media",
    low: "Baixa",
  };

  return labels[normalized] || formatFriendlyLabel(value);
}

function formatAppointmentTypeLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();

  const labels: Record<string, string> = {
    technical_visit: "Visita tecnica",
    site_visit: "Visita",
    installation: "Instalacao",
    maintenance: "Manutencao",
    delivery: "Entrega",
  };

  return labels[normalized] || formatFriendlyLabel(value);
}

function formatAppointmentStatusLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();

  const labels: Record<string, string> = {
    scheduled: "Agendado",
    confirmed: "Confirmado",
    pending: "Pendente",
    completed: "Concluido",
    cancelled: "Cancelado",
    canceled: "Cancelado",
    rescheduled: "Remarcado",
  };

  return labels[normalized] || formatFriendlyLabel(value);
}

function formatDirectionLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "incoming") return "Cliente";
  if (normalized === "outgoing") return "Loja";

  return formatFriendlyLabel(value);
}

function getLatestCommercialTask(tasks: CommercialTask[]) {
  return tasks.length > 0 ? tasks[0] : null;
}

function InfoCard({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help?: string | null;
}) {
  return (
    <div className="rounded-xl bg-gray-50 p-4 ring-1 ring-black/5">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 break-words font-semibold text-gray-900">{value}</div>
      {help ? <div className="mt-2 text-xs text-gray-500">{help}</div> : null}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">
      {text}
    </div>
  );
}

export default function LeadPage() {
  const params = useParams();
  const leadId = params.id as string;
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const customerAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledMessagesInitiallyRef = useRef(false);
  const hasRestoredQuoteDraftRef = useRef(false);
  const latestQuoteDraftRef = useRef<QuoteDraftPayload | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const simulatedAudioRecorderRef = useRef<MediaRecorder | null>(null);
  const simulatedAudioStreamRef = useRef<MediaStream | null>(null);
  const simulatedAudioChunksRef = useRef<BlobPart[]>([]);

  const [lead, setLead] = useState<Lead | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [commercialTasks, setCommercialTasks] = useState<CommercialTask[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [simulatedCustomerMessage, setSimulatedCustomerMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [simulatingCustomer, setSimulatingCustomer] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [uploadingCustomerAttachment, setUploadingCustomerAttachment] = useState(false);
  const [uploadingManualAttachment, setUploadingManualAttachment] = useState(false);
  const [recordingAudio, setRecordingAudio] = useState(false);
  const [recordingAudioSeconds, setRecordingAudioSeconds] = useState(0);
  const [simulatedRecordingAudio, setSimulatedRecordingAudio] = useState(false);
  const [simulatedRecordingAudioSeconds, setSimulatedRecordingAudioSeconds] = useState(0);
  const [customerAttachmentPurpose, setCustomerAttachmentPurpose] =
    useState("customer_location_photo");
  const [simulatedPendingAttachment, setSimulatedPendingAttachment] =
    useState<PendingCustomerAttachment | null>(null);
  const [manualPendingAttachment, setManualPendingAttachment] =
    useState<PendingCustomerAttachment | null>(null);
  const [activeDetailsTab, setActiveDetailsTab] = useState<DetailTab | null>(null);
  const [activeGeneratedPdfTab, setActiveGeneratedPdfTab] =
    useState<GeneratedPdfTab>("quotes");
  const [isQuoteModalOpen, setIsQuoteModalOpen] = useState(false);
  const [quoteTitle, setQuoteTitle] = useState("");
  const [quoteCustomerNotes, setQuoteCustomerNotes] = useState("");
  const [quoteWarrantyTerms, setQuoteWarrantyTerms] = useState("");
  const [quoteValidityDays, setQuoteValidityDays] = useState("");
  const [quoteItems, setQuoteItems] = useState<QuoteFormItem[]>([createEmptyQuoteFormItem()]);
  const [isGeneratingManualQuote, setIsGeneratingManualQuote] = useState(false);
  const [quoteFormError, setQuoteFormError] = useState<string | null>(null);
  const [quoteFormSuccess, setQuoteFormSuccess] = useState<string | null>(null);
  const [quoteFormMode, setQuoteFormMode] = useState<"create" | "edit">("create");
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [editingQuoteNumber, setEditingQuoteNumber] = useState<string | null>(null);
  const [editingQuoteStatus, setEditingQuoteStatus] = useState<string | null>(null);
  const [loadingQuoteForEdit, setLoadingQuoteForEdit] = useState<string | null>(null);
  const [generatedQuotes, setGeneratedQuotes] = useState<GeneratedQuoteSummary[]>([]);
  const [generatedQuotesLoading, setGeneratedQuotesLoading] = useState(false);
  const [generatedQuotesError, setGeneratedQuotesError] = useState<string | null>(null);
  const [openingGeneratedQuoteId, setOpeningGeneratedQuoteId] = useState<string | null>(null);
  const [quoteActionLoadingId, setQuoteActionLoadingId] = useState<string | null>(null);
  const [quoteActionLoadingType, setQuoteActionLoadingType] = useState<
    "approve" | "send" | null
  >(null);
  const [quoteActionError, setQuoteActionError] = useState<string | null>(null);
  const [quoteActionSuccess, setQuoteActionSuccess] = useState<string | null>(null);
  const [hasLoadedGeneratedQuotes, setHasLoadedGeneratedQuotes] = useState(false);
  const [generatedContracts, setGeneratedContracts] = useState<GeneratedContractSummary[]>([]);
  const [generatedContractsLoading, setGeneratedContractsLoading] = useState(false);
  const [generatedContractsError, setGeneratedContractsError] = useState<string | null>(null);
  const [openingGeneratedContractId, setOpeningGeneratedContractId] = useState<string | null>(null);
  const [contractActionLoadingId, setContractActionLoadingId] = useState<string | null>(null);
  const [contractActionLoadingType, setContractActionLoadingType] = useState<
    "create" | "generate_pdf" | "approve" | "send" | "customer_sign" | "store_sign" | null
  >(null);
  const [contractActionError, setContractActionError] = useState<string | null>(null);
  const [contractActionSuccess, setContractActionSuccess] = useState<string | null>(null);
  const [hasLoadedGeneratedContracts, setHasLoadedGeneratedContracts] = useState(false);
  const [imagePreviewErrors, setImagePreviewErrors] = useState<Record<string, boolean>>(
    {}
  );
  const [signedMediaByMessageId, setSignedMediaByMessageId] = useState<
    Record<string, SignedMediaState>
  >({});
  const [signedMediaErrorByMessageId, setSignedMediaErrorByMessageId] = useState<
    Record<string, string>
  >({});
  const [loadingSignedMediaByMessageId, setLoadingSignedMediaByMessageId] = useState<
    Record<string, boolean>
  >({});
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const hasConversation = Boolean(conversation);
  const isHumanActive = conversation?.is_human_active === true;
  const latestCommercialTask = getLatestCommercialTask(commercialTasks);
  const contractsByQuoteId = generatedContracts.reduce<Record<string, GeneratedContractSummary>>(
    (acc, contract) => {
      const quoteId = String(contract.quote_id || "").trim();
      if (quoteId && !acc[quoteId]) {
        acc[quoteId] = contract;
      }
      return acc;
    },
    {}
  );
  const canTakeOver =
    hasConversation && !isHumanActive && !working && !simulatingCustomer;
  const canReleaseToAI =
    hasConversation && isHumanActive && !working && !simulatingCustomer;
  const canSendMessage =
    hasConversation &&
    !working &&
    !simulatingCustomer &&
    !uploadingManualAttachment &&
    (newMessage.trim().length > 0 || manualPendingAttachment !== null);

  const canSimulateCustomerMessage =
    hasConversation &&
    !working &&
    !simulatingCustomer &&
    !simulatedRecordingAudio &&
    !uploadingCustomerAttachment &&
    (
      simulatedCustomerMessage.trim().length > 0 ||
      simulatedPendingAttachment !== null
    );

  const canSimulateCustomerAttachment =
    hasConversation &&
    !working &&
    !simulatingCustomer &&
    !simulatedRecordingAudio &&
    !uploadingCustomerAttachment;

  const quoteSubtotalReais = quoteItems.reduce((total, item) => {
    const quantity = parseQuoteQuantityValue(item.quantity);
    const unitPrice = parseQuoteMoneyValue(item.unitPriceReais);

    return total + quantity * unitPrice;
  }, 0);

  const quoteDiscountTotalReais = quoteItems.reduce((total, item) => {
    const discount = parseQuoteMoneyValue(item.discountReais);
    return total + discount;
  }, 0);

  const quoteTotalReais = Math.max(quoteSubtotalReais - quoteDiscountTotalReais, 0);
  const quoteDraftPrimaryStorageKey = lead?.id
    ? `zion:manual-quote-draft:${lead.id}`
    : null;
  const quoteDraftFallbackStorageKey = leadId
    ? `zion:manual-quote-draft:${leadId}`
    : null;
  const quoteDraftStorageKey =
    quoteDraftPrimaryStorageKey ?? quoteDraftFallbackStorageKey;
  const detailsTabStorageKey = leadId
    ? `zion:crm-lead-details-tab:${leadId}`
    : null;
  const quoteHasTitle = quoteTitle.trim().length > 0;
  const quoteHasAtLeastOneItem = quoteItems.length > 0;
  const quoteItemsAreValid = quoteItems.every((item) => {
    const hasName = item.name.trim().length > 0;
    const quantity = parseQuoteQuantityValue(item.quantity);
    const unitPrice = parseQuoteMoneyValue(item.unitPriceReais);

    return hasName && quantity > 0 && unitPrice > 0;
  });
  const canGenerateQuotePdf =
    quoteHasTitle && quoteHasAtLeastOneItem && quoteItemsAreValid;
  const isEditingQuote = quoteFormMode === "edit";
  const quoteValidationMessage = canGenerateQuotePdf
    ? null
    : "Preencha o t\u00edtulo, o nome do item, a quantidade e o pre\u00e7o para gerar o PDF.";
  const quoteDraftPayload: QuoteDraftPayload = {
    isQuoteModalOpen,
    quoteTitle,
    quoteCustomerNotes,
    quoteWarrantyTerms,
    quoteValidityDays,
    quoteItems,
  };

  useEffect(() => {
    return () => {
      if (simulatedPendingAttachment?.previewUrl) {
        URL.revokeObjectURL(simulatedPendingAttachment.previewUrl);
      }
    };
  }, [simulatedPendingAttachment]);

  useEffect(() => {
    return () => {
      if (manualPendingAttachment?.previewUrl) {
        URL.revokeObjectURL(manualPendingAttachment.previewUrl);
      }
    };
  }, [manualPendingAttachment]);

  useEffect(() => {
    if (!recordingAudio) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setRecordingAudioSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [recordingAudio]);

  useEffect(() => {
    if (!simulatedRecordingAudio) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setSimulatedRecordingAudioSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [simulatedRecordingAudio]);

  useEffect(() => {
    return () => {
      if (audioRecorderRef.current?.state === "recording") {
        audioRecorderRef.current.stop();
      }

      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    return () => {
      if (simulatedAudioRecorderRef.current?.state === "recording") {
        simulatedAudioRecorderRef.current.stop();
      }

      simulatedAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function scrollMessagesToBottom(behavior: ScrollBehavior = "smooth") {
    window.requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (!container) return;

      const targetTop = messagesEndRef.current?.offsetTop ?? container.scrollHeight;
      container.scrollTo({
        top: targetTop,
        behavior,
      });
    });
  }

  function resetQuoteForm() {
    setQuoteTitle("");
    setQuoteCustomerNotes("");
    setQuoteWarrantyTerms("");
    setQuoteValidityDays("");
    setQuoteItems([createEmptyQuoteFormItem()]);
    setQuoteFormError(null);
    setQuoteFormSuccess(null);
    setQuoteFormMode("create");
    setEditingQuoteId(null);
    setEditingQuoteNumber(null);
    setEditingQuoteStatus(null);
    setLoadingQuoteForEdit(null);
  }

  function clearQuoteDraft() {
    if (typeof window === "undefined") {
      return;
    }

    if (quoteDraftPrimaryStorageKey) {
      window.localStorage.removeItem(quoteDraftPrimaryStorageKey);
    }

    if (
      quoteDraftFallbackStorageKey &&
      quoteDraftFallbackStorageKey !== quoteDraftPrimaryStorageKey
    ) {
      window.localStorage.removeItem(quoteDraftFallbackStorageKey);
    }
  }

  function closeQuoteModalAndReset() {
    if (quoteFormMode === "create") {
      clearQuoteDraft();
    }
    resetQuoteForm();
    setIsQuoteModalOpen(false);
  }

  function persistQuoteDraftToStorage(payload: QuoteDraftPayload = quoteDraftPayload) {
    if (typeof window === "undefined") {
      return;
    }

    if (quoteFormMode === "edit") {
      return;
    }

    if (quoteDraftPrimaryStorageKey) {
      window.localStorage.setItem(
        quoteDraftPrimaryStorageKey,
        JSON.stringify(payload)
      );
    }

    if (
      quoteDraftFallbackStorageKey &&
      quoteDraftFallbackStorageKey !== quoteDraftPrimaryStorageKey
    ) {
      window.localStorage.setItem(
        quoteDraftFallbackStorageKey,
        JSON.stringify(payload)
      );
    }
  }

  function addQuoteItem() {
    setQuoteItems((current) => [...current, createEmptyQuoteFormItem()]);
  }

  function openCreateQuoteModal() {
    resetQuoteForm();
    setQuoteFormError(null);
    setQuoteFormSuccess(null);
    setIsQuoteModalOpen(true);
  }

  function removeQuoteItem(itemId: string) {
    setQuoteItems((current) => {
      if (current.length <= 1) {
        return [createEmptyQuoteFormItem()];
      }

      return current.filter((item) => item.id !== itemId);
    });
  }

  function updateQuoteItem(
    itemId: string,
    field: keyof Omit<QuoteFormItem, "id">,
    value: string
  ) {
    setQuoteItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              [field]: value,
            }
          : item
      )
    );
  }

  async function generateManualQuotePdf() {
    if (isGeneratingManualQuote) {
      return;
    }

    if (quoteFormMode === "edit") {
      setQuoteFormError("Gerar nova versao em breve.");
      setQuoteFormSuccess(null);
      return;
    }

    if (!lead?.organization_id || !lead?.store_id) {
      setQuoteFormError("Nao foi possivel gerar o orcamento porque a loja do lead nao esta definida.");
      setQuoteFormSuccess(null);
      return;
    }

    if (!canGenerateQuotePdf) {
      setQuoteFormError(
        quoteValidationMessage ||
          "Preencha o titulo, o nome do item, a quantidade e o preco para gerar o PDF."
      );
      setQuoteFormSuccess(null);
      return;
    }

    const normalizedItems = quoteItems.map((item) => {
      const normalizedItemType =
        item.itemType === "service" ? "service" : "custom";

      return {
        item_type: normalizedItemType,
        name: item.name.trim(),
        description: item.description.trim() || null,
        quantity: parseQuoteQuantityValue(item.quantity),
        unit_price_cents: convertReaisToCents(item.unitPriceReais),
        discount_cents: convertReaisToCents(item.discountReais),
      };
    });

    const payload = {
      organizationId: lead.organization_id,
      storeId: lead.store_id,
      conversationId: conversation?.id || null,
      leadId: lead.id,
      title: quoteTitle.trim(),
      customer_name: lead.name || null,
      customer_phone: lead.phone || null,
      customer_notes: quoteCustomerNotes.trim() || null,
      internal_notes: null,
      warranty_terms: quoteWarrantyTerms.trim() || null,
      validity_days: quoteValidityDays.trim() || null,
      items: normalizedItems,
    };

    setIsGeneratingManualQuote(true);
    setQuoteFormError(null);
    setQuoteFormSuccess(null);

    try {
      const createResponse = await fetch("/api/sales-quotes/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const createResult =
        (await createResponse.json().catch(() => null)) as CreateSalesQuoteResponse | null;

      if (!createResponse.ok || !createResult?.ok || !createResult.quoteId) {
        throw new Error(
          createResult?.message ||
            createResult?.error ||
            "Nao foi possivel criar o orcamento."
        );
      }

      const generatePdfResponse = await fetch(
        `/api/sales-quotes/${encodeURIComponent(createResult.quoteId)}/generate-pdf`,
        {
          method: "POST",
          cache: "no-store",
        }
      );

      const generatePdfResult =
        (await generatePdfResponse.json().catch(() => null)) as GenerateSalesQuotePdfResponse | null;

      if (!generatePdfResponse.ok || !generatePdfResult?.ok) {
        throw new Error(
          generatePdfResult?.message ||
            generatePdfResult?.error ||
            "O orcamento foi criado, mas nao foi possivel gerar o PDF."
        );
      }

      setQuoteFormSuccess("Orcamento gerado com sucesso.");
      setQuoteFormError(null);
      setStatusText("Orcamento gerado com sucesso.");
      await fetchLeadConversationAndMessages({ silent: true });
      if (hasLoadedGeneratedQuotes || activeDetailsTab === "pdfs") {
        void fetchGeneratedQuotes({ silent: true });
      }
      closeQuoteModalAndReset();
    } catch (error: any) {
      setQuoteFormError(
        error?.message || "Nao foi possivel gerar o orcamento agora."
      );
      setQuoteFormSuccess(null);
      setStatusText(null);
    } finally {
      setIsGeneratingManualQuote(false);
    }
  }

  async function generateEditedQuoteVersion() {
    const safeQuoteId = String(editingQuoteId || "").trim();
    const normalizedStatus = String(editingQuoteStatus || "").trim().toLowerCase();

    if (isGeneratingManualQuote) {
      return;
    }

    if (quoteFormMode !== "edit" || !safeQuoteId) {
      setQuoteFormError("Nenhum orcamento em edicao foi encontrado.");
      setQuoteFormSuccess(null);
      return;
    }

    if (
      normalizedStatus === "sent" ||
      normalizedStatus === "cancelled" ||
      normalizedStatus === "expired" ||
      normalizedStatus === "failed"
    ) {
      setQuoteFormError("Este orcamento nao pode gerar nova versao.");
      setQuoteFormSuccess(null);
      return;
    }

    if (!canGenerateQuotePdf) {
      setQuoteFormError(
        quoteValidationMessage ||
          "Preencha o titulo, o nome do item, a quantidade e o preco para gerar a nova versao."
      );
      setQuoteFormSuccess(null);
      return;
    }

    const normalizedItems = quoteItems.map((item) => {
      const normalizedItemType = item.itemType === "service" ? "service" : "custom";

      return {
        id: item.id,
        item_type: normalizedItemType,
        name: item.name.trim(),
        description: item.description.trim() || null,
        quantity: parseQuoteQuantityValue(item.quantity),
        unit_price_cents: convertReaisToCents(item.unitPriceReais),
        discount_cents: convertReaisToCents(item.discountReais),
      };
    });

    setIsGeneratingManualQuote(true);
    setQuoteFormError(null);
    setQuoteFormSuccess(null);

    try {
      const requestChangeResponse = await fetch(
        `/api/sales-quotes/${encodeURIComponent(safeQuoteId)}/request-change`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            request_text:
              "Alteracao manual feita pelo responsavel pela tela de edicao do orcamento.",
          }),
        }
      );
      const requestChangeResult =
        (await requestChangeResponse.json().catch(() => null)) as SalesQuoteActionResponse | null;

      if (!requestChangeResponse.ok || !requestChangeResult?.ok || !requestChangeResult.changeRequestId) {
        throw new Error(
          requestChangeResult?.message ||
            requestChangeResult?.error ||
            "Nao foi possivel registrar a alteracao do orcamento."
        );
      }

      const applyChangeResponse = await fetch(
        `/api/sales-quotes/${encodeURIComponent(safeQuoteId)}/apply-change`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            changeRequestId: requestChangeResult.changeRequestId,
            title: quoteTitle.trim() || null,
            customer_notes: quoteCustomerNotes.trim() || null,
            warranty_terms: quoteWarrantyTerms.trim() || null,
            validity_days: quoteValidityDays.trim() || null,
            items: normalizedItems,
          }),
        }
      );
      const applyChangeResult =
        (await applyChangeResponse.json().catch(() => null)) as SalesQuoteActionResponse | null;

      if (!applyChangeResponse.ok || !applyChangeResult?.ok) {
        throw new Error(
          applyChangeResult?.message ||
            applyChangeResult?.error ||
            "Nao foi possivel gerar a nova versao do orcamento."
        );
      }

      await fetchGeneratedQuotes({ silent: true });
      await fetchLeadConversationAndMessages({ silent: true });
      setStatusText("Nova versao do orcamento gerada com sucesso.");
      setQuoteFormSuccess("Nova versao do orcamento gerada com sucesso.");
      closeQuoteModalAndReset();
    } catch (error: any) {
      setQuoteFormError(
        error?.message || "Nao foi possivel gerar a nova versao do orcamento."
      );
      setQuoteFormSuccess(null);
    } finally {
      setIsGeneratingManualQuote(false);
    }
  }

  async function fetchLeadConversationAndMessages(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setErrorText(null);
    setStatusText(null);

    try {
      const response = await fetch(`/api/crm/lead-details/${leadId}`, {
        method: "GET",
        cache: "no-store",
      });

      const result = (await response.json()) as LeadDetailsResponse;

      if (!response.ok || !result?.ok) {
        setErrorText(
          result?.message || result?.error || "Erro ao carregar dados do lead."
        );

        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
        return;
      }

      setLead((result.lead ?? null) as Lead | null);
      setConversation((result.conversation ?? null) as Conversation | null);
      setMessages(Array.isArray(result.messages) ? result.messages : []);
      setCommercialTasks(
        Array.isArray(result.commercialTasks) ? result.commercialTasks : []
      );
      setAppointments(Array.isArray(result.appointments) ? result.appointments : []);

      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    } catch (error: any) {
      console.error("[LeadPage] erro ao carregar dados via API:", error);

      setErrorText(
        error?.message || "Erro inesperado ao carregar dados do lead."
      );

      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }

  async function fetchGeneratedQuotes(options?: { silent?: boolean }) {
    if (!leadId) {
      return;
    }

    if (!options?.silent) {
      setGeneratedQuotesLoading(true);
    }

    setGeneratedQuotesError(null);

    try {
      const response = await fetch(
        `/api/sales-quotes?leadId=${encodeURIComponent(leadId)}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );
      const result = (await response.json()) as SalesQuoteListResponse;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel carregar os PDFs gerados.");
      }

      setGeneratedQuotes(Array.isArray(result.quotes) ? result.quotes : []);
      setHasLoadedGeneratedQuotes(true);
    } catch (error: any) {
      setGeneratedQuotesError(
        error?.message || "Nao foi possivel carregar os PDFs gerados."
      );
    } finally {
      if (!options?.silent) {
        setGeneratedQuotesLoading(false);
      }
    }
  }

  async function fetchGeneratedContracts(options?: { silent?: boolean }) {
    if (!leadId) {
      return;
    }

    if (!options?.silent) {
      setGeneratedContractsLoading(true);
    }

    setGeneratedContractsError(null);

    try {
      const response = await fetch(
        `/api/sales-contracts?leadId=${encodeURIComponent(leadId)}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );
      const result = (await response.json()) as SalesContractListResponse;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel carregar os contratos.");
      }

      setGeneratedContracts(Array.isArray(result.contracts) ? result.contracts : []);
      setHasLoadedGeneratedContracts(true);
    } catch (error: any) {
      setGeneratedContractsError(
        error?.message || "Nao foi possivel carregar os contratos."
      );
    } finally {
      if (!options?.silent) {
        setGeneratedContractsLoading(false);
      }
    }
  }

  async function openGeneratedQuotePdf(quoteId: string) {
    const safeQuoteId = String(quoteId || "").trim();

    if (!safeQuoteId) {
      return;
    }

    setOpeningGeneratedQuoteId(safeQuoteId);
    setGeneratedQuotesError(null);

    try {
      const response = await fetch(
        `/api/sales-quotes/${encodeURIComponent(safeQuoteId)}/signed-pdf-url`,
        {
          method: "GET",
          cache: "no-store",
        }
      );
      const result = (await response.json()) as SignedQuotePdfUrlResponse;

      if (!response.ok || !result?.ok || !result.signedUrl) {
        throw new Error(result?.message || "Nao foi possivel abrir o PDF deste orcamento.");
      }

      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      setGeneratedQuotesError(
        error?.message || "Nao foi possivel abrir o PDF deste orcamento."
      );
    } finally {
      setOpeningGeneratedQuoteId(null);
    }
  }

  async function createContractFromQuote(quoteId: string) {
    const safeQuoteId = String(quoteId || "").trim();

    if (!safeQuoteId || contractsByQuoteId[safeQuoteId]) {
      return;
    }

    setContractActionLoadingId(safeQuoteId);
    setContractActionLoadingType("create");
    setContractActionError(null);
    setContractActionSuccess(null);

    try {
      const response = await fetch("/api/sales-contracts/create-from-quote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quoteId: safeQuoteId,
        }),
      });
      const result =
        (await response.json().catch(() => null)) as SalesContractActionResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel criar o contrato.");
      }

      await fetchGeneratedContracts({ silent: true });
      setContractActionSuccess("Contrato criado com sucesso.");
    } catch (error: any) {
      setContractActionError(
        error?.message || "Nao foi possivel criar o contrato."
      );
      setContractActionSuccess(null);
    } finally {
      setContractActionLoadingId(null);
      setContractActionLoadingType(null);
    }
  }

  async function generateContractPdf(contractId: string) {
    const safeContractId = String(contractId || "").trim();

    if (!safeContractId) {
      return;
    }

    setContractActionLoadingId(safeContractId);
    setContractActionLoadingType("generate_pdf");
    setContractActionError(null);
    setContractActionSuccess(null);

    try {
      const response = await fetch(
        `/api/sales-contracts/${encodeURIComponent(safeContractId)}/generate-pdf`,
        {
          method: "POST",
          cache: "no-store",
        }
      );
      const result =
        (await response.json().catch(() => null)) as SalesContractActionResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel gerar o PDF do contrato.");
      }

      await fetchGeneratedContracts({ silent: true });
      setContractActionSuccess("PDF do contrato gerado com sucesso.");
    } catch (error: any) {
      setContractActionError(
        error?.message || "Nao foi possivel gerar o PDF do contrato."
      );
      setContractActionSuccess(null);
    } finally {
      setContractActionLoadingId(null);
      setContractActionLoadingType(null);
    }
  }

  async function openGeneratedContractPdf(contractId: string) {
    const safeContractId = String(contractId || "").trim();

    if (!safeContractId) {
      return;
    }

    setOpeningGeneratedContractId(safeContractId);
    setGeneratedContractsError(null);

    try {
      const response = await fetch(
        `/api/sales-contracts/${encodeURIComponent(safeContractId)}/signed-pdf-url`,
        {
          method: "GET",
          cache: "no-store",
        }
      );
      const result = (await response.json()) as SignedContractPdfUrlResponse;

      if (!response.ok || !result?.ok || !result.signedUrl) {
        throw new Error(result?.message || "Nao foi possivel abrir o PDF deste contrato.");
      }

      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      setGeneratedContractsError(
        error?.message || "Nao foi possivel abrir o PDF deste contrato."
      );
    } finally {
      setOpeningGeneratedContractId(null);
    }
  }

  async function approveGeneratedContract(
    contractId: string,
    currentStatus: string | null | undefined
  ) {
    const safeContractId = String(contractId || "").trim();
    const normalizedStatus = String(currentStatus || "").trim().toLowerCase();

    if (!safeContractId) {
      return;
    }

    if (normalizedStatus !== "pending_review" && normalizedStatus !== "draft") {
      setContractActionError("Este contrato precisa estar em revisao para ser aprovado.");
      setContractActionSuccess(null);
      return;
    }

    setContractActionLoadingId(safeContractId);
    setContractActionLoadingType("approve");
    setContractActionError(null);
    setContractActionSuccess(null);

    try {
      const response = await fetch(
        `/api/sales-contracts/${encodeURIComponent(safeContractId)}/approve`,
        {
          method: "POST",
          cache: "no-store",
        }
      );
      const result = (await response.json()) as SalesContractActionResponse;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel aprovar o contrato.");
      }

      await fetchGeneratedContracts({ silent: true });
      setContractActionSuccess("Contrato aprovado com sucesso.");
    } catch (error: any) {
      setContractActionError(error?.message || "Nao foi possivel aprovar o contrato.");
      setContractActionSuccess(null);
    } finally {
      setContractActionLoadingId(null);
      setContractActionLoadingType(null);
    }
  }

  async function sendGeneratedContractToCustomer(
    contractId: string,
    currentStatus: string | null | undefined
  ) {
    const safeContractId = String(contractId || "").trim();
    const normalizedStatus = String(currentStatus || "").trim().toLowerCase();

    if (!safeContractId) {
      return;
    }

    if (normalizedStatus !== "approved") {
      setContractActionError("Este contrato precisa ser aprovado antes de ser enviado.");
      setContractActionSuccess(null);
      return;
    }

    setContractActionLoadingId(safeContractId);
    setContractActionLoadingType("send");
    setContractActionError(null);
    setContractActionSuccess(null);

    try {
      const response = await fetch(
        `/api/sales-contracts/${encodeURIComponent(safeContractId)}/send`,
        {
          method: "POST",
          cache: "no-store",
        }
      );
      const result = (await response.json()) as SalesContractActionResponse;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel enviar o contrato ao cliente.");
      }

      await fetchGeneratedContracts({ silent: true });

      if (leadId) {
        await fetchLeadConversationAndMessages({ silent: true });
      }

      setContractActionSuccess("Contrato enviado ao cliente com sucesso.");
    } catch (error: any) {
      setContractActionError(
        error?.message || "Nao foi possivel enviar o contrato ao cliente."
      );
      setContractActionSuccess(null);
    } finally {
      setContractActionLoadingId(null);
      setContractActionLoadingType(null);
    }
  }

  async function registerCustomerContractAcceptance(contractId: string) {
    const safeContractId = String(contractId || "").trim();

    if (!safeContractId || !lead) {
      return;
    }

    setContractActionLoadingId(safeContractId);
    setContractActionLoadingType("customer_sign");
    setContractActionError(null);
    setContractActionSuccess(null);

    try {
      const response = await fetch(
        `/api/sales-contracts/${encodeURIComponent(safeContractId)}/customer-sign`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            signerName: lead.name || "Cliente",
            signerPhone: lead.phone || null,
            acceptanceText:
              "Cliente declarou que leu e aceitou os termos deste contrato.",
          }),
        }
      );
      const result = (await response.json()) as SalesContractActionResponse;

      if (!response.ok || !result?.ok) {
        throw new Error(
          result?.message || "Nao foi possivel registrar o aceite do cliente."
        );
      }

      await fetchGeneratedContracts({ silent: true });
      setContractActionSuccess(
        "Aceite rastreavel do cliente registrado com sucesso."
      );
    } catch (error: any) {
      setContractActionError(
        error?.message || "Nao foi possivel registrar o aceite do cliente."
      );
      setContractActionSuccess(null);
    } finally {
      setContractActionLoadingId(null);
      setContractActionLoadingType(null);
    }
  }

  async function confirmStoreContractSignature(contractId: string) {
    const safeContractId = String(contractId || "").trim();

    if (!safeContractId) {
      return;
    }

    setContractActionLoadingId(safeContractId);
    setContractActionLoadingType("store_sign");
    setContractActionError(null);
    setContractActionSuccess(null);

    try {
      const response = await fetch(
        `/api/sales-contracts/${encodeURIComponent(safeContractId)}/store-sign`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            signerName: "Responsavel da loja",
            acceptanceText:
              "Confirmo a assinatura e validacao deste contrato pela loja.",
          }),
        }
      );
      const result = (await response.json()) as SalesContractActionResponse;

      if (!response.ok || !result?.ok) {
        throw new Error(
          result?.message || "Nao foi possivel confirmar o contrato pela loja."
        );
      }

      await fetchGeneratedContracts({ silent: true });
      setContractActionSuccess("Contrato confirmado pela loja com sucesso.");
    } catch (error: any) {
      setContractActionError(
        error?.message || "Nao foi possivel confirmar o contrato pela loja."
      );
      setContractActionSuccess(null);
    } finally {
      setContractActionLoadingId(null);
      setContractActionLoadingType(null);
    }
  }

  async function loadQuoteForEdit(
    quoteId: string,
    quoteNumber: string | null | undefined,
    currentStatus: string | null | undefined
  ) {
    const safeQuoteId = String(quoteId || "").trim();
    const normalizedStatus = String(currentStatus || "").trim().toLowerCase();

    if (!safeQuoteId) {
      return;
    }

    if (
      normalizedStatus === "sent" ||
      normalizedStatus === "cancelled" ||
      normalizedStatus === "expired" ||
      normalizedStatus === "failed"
    ) {
      setGeneratedQuotesError("Este orcamento nao pode ser aberto para edicao.");
      return;
    }

    setLoadingQuoteForEdit(safeQuoteId);
    setGeneratedQuotesError(null);
    setQuoteActionError(null);
    setQuoteActionSuccess(null);

    try {
      const response = await fetch(`/api/sales-quotes/${encodeURIComponent(safeQuoteId)}`, {
        method: "GET",
        cache: "no-store",
      });
      const result = (await response.json().catch(() => null)) as SalesQuoteDetailResponse | null;

      if (!response.ok || !result?.ok || !result.quote) {
        throw new Error(result?.message || "Nao foi possivel carregar o orcamento para edicao.");
      }

      const formItems = Array.isArray(result.items)
        ? result.items.map((item) => {
            const normalizedItemType = String(item.item_type || "").trim().toLowerCase();
            const safeItemType: QuoteFormItem["itemType"] =
              normalizedItemType === "service"
                ? "service"
                : normalizedItemType === "custom"
                  ? "custom"
                  : "custom";

            return {
              id: item.id || createQuoteFormItemId(),
              itemType: safeItemType,
              name: item.name || "",
              description: item.description || "",
              quantity:
                typeof item.quantity === "number" && Number.isFinite(item.quantity)
                  ? String(item.quantity)
                  : "1",
              unitPriceReais: formatMoneyInputFromCents(item.unit_price_cents),
              discountReais: formatMoneyInputFromCents(item.discount_cents),
            } satisfies QuoteFormItem;
          })
        : [];

      setQuoteFormMode("edit");
      setEditingQuoteId(result.quote.id);
      setEditingQuoteNumber(result.quote.quote_number || quoteNumber || null);
      setEditingQuoteStatus(result.quote.status || currentStatus || null);
      setQuoteTitle(result.quote.title || "");
      setQuoteCustomerNotes(result.quote.customer_notes || "");
      setQuoteWarrantyTerms(result.quote.warranty_terms || "");
      setQuoteValidityDays(convertQuoteValidUntilToDays(result.quote.valid_until));
      setQuoteItems(formItems.length > 0 ? formItems : [createEmptyQuoteFormItem()]);
      setQuoteFormError(null);
      setQuoteFormSuccess(null);
      setIsQuoteModalOpen(true);
    } catch (error: any) {
      setGeneratedQuotesError(
        error?.message || "Nao foi possivel carregar o orcamento para edicao."
      );
    } finally {
      setLoadingQuoteForEdit(null);
    }
  }

  async function approveGeneratedQuote(quoteId: string, currentStatus: string | null | undefined) {
    const safeQuoteId = String(quoteId || "").trim();
    const normalizedStatus = String(currentStatus || "").trim().toLowerCase();

    if (!safeQuoteId) {
      return;
    }

    if (normalizedStatus !== "pending_review") {
      setQuoteActionError("Este orcamento precisa estar em revisao pendente para ser aprovado.");
      setQuoteActionSuccess(null);
      return;
    }

    setQuoteActionLoadingId(safeQuoteId);
    setQuoteActionLoadingType("approve");
    setQuoteActionError(null);
    setQuoteActionSuccess(null);

    try {
      const response = await fetch(
        `/api/sales-quotes/${encodeURIComponent(safeQuoteId)}/approve`,
        {
          method: "POST",
          cache: "no-store",
        }
      );
      const result = (await response.json()) as SalesQuoteActionResponse;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel aprovar o orcamento.");
      }

      await fetchGeneratedQuotes({ silent: true });
      setQuoteActionSuccess("Orcamento aprovado com sucesso.");
    } catch (error: any) {
      setQuoteActionError(error?.message || "Nao foi possivel aprovar o orcamento.");
      setQuoteActionSuccess(null);
    } finally {
      setQuoteActionLoadingId(null);
      setQuoteActionLoadingType(null);
    }
  }

  async function sendGeneratedQuoteToCustomer(
    quoteId: string,
    currentStatus: string | null | undefined
  ) {
    const safeQuoteId = String(quoteId || "").trim();
    const normalizedStatus = String(currentStatus || "").trim().toLowerCase();

    if (!safeQuoteId) {
      return;
    }

    if (normalizedStatus !== "approved") {
      setQuoteActionError("Este orcamento precisa ser aprovado antes de ser enviado.");
      setQuoteActionSuccess(null);
      return;
    }

    setQuoteActionLoadingId(safeQuoteId);
    setQuoteActionLoadingType("send");
    setQuoteActionError(null);
    setQuoteActionSuccess(null);

    try {
      const response = await fetch(`/api/sales-quotes/${encodeURIComponent(safeQuoteId)}/send`, {
        method: "POST",
        cache: "no-store",
      });
      const result = (await response.json()) as SalesQuoteActionResponse;

      if (!response.ok || !result?.ok) {
        throw new Error(getQuoteSendErrorMessage(result?.error, result?.message));
      }

      await fetchGeneratedQuotes({ silent: true });

      if (leadId) {
        await fetchLeadConversationAndMessages({ silent: true });
      }

      setQuoteActionSuccess("Orcamento enviado ao cliente com sucesso.");
    } catch (error: any) {
      setQuoteActionError(
        error?.message || "Nao foi possivel enviar o orcamento ao cliente."
      );
      setQuoteActionSuccess(null);
    } finally {
      setQuoteActionLoadingId(null);
      setQuoteActionLoadingType(null);
    }
  }

  async function takeOverConversation() {
    if (!lead || !conversation) {
      setErrorText("Nao foi possivel assumir: conversa nao encontrada para este lead.");
      return;
    }

    setWorking(true);
    setErrorText(null);
    setStatusText(null);

    const { error } = await supabase.rpc("panel_takeover_conversation_scoped", {
      p_organization_id: lead.organization_id,
      p_conversation_id: conversation.id,
      p_reason: "manual_takeover_from_crm",
    });

    if (error) {
      console.error("[LeadPage] erro ao assumir conversa:", {
        message: (error as any)?.message ?? null,
        details: (error as any)?.details ?? null,
        hint: (error as any)?.hint ?? null,
        code: (error as any)?.code ?? null,
        full: error,
      });

      setErrorText((error as any)?.message ?? "Erro ao assumir conversa.");
      setWorking(false);
      return;
    }

    setStatusText("Conversa assumida. IA pausada.");
    setWorking(false);
    await fetchLeadConversationAndMessages({ silent: true });
  }

  async function releaseConversation() {
    if (!lead || !conversation) {
      setErrorText("Nao foi possivel liberar: conversa nao encontrada para este lead.");
      return;
    }

    setWorking(true);
    setErrorText(null);
    setStatusText(null);

    const { error } = await supabase.rpc("panel_release_conversation_to_ai_scoped", {
      p_organization_id: lead.organization_id,
      p_conversation_id: conversation.id,
      p_reason: "manual_release_from_crm",
    });

    if (error) {
      console.error("[LeadPage] erro ao liberar IA:", {
        message: (error as any)?.message ?? null,
        details: (error as any)?.details ?? null,
        hint: (error as any)?.hint ?? null,
        code: (error as any)?.code ?? null,
        full: error,
      });

      setErrorText((error as any)?.message ?? "Erro ao liberar IA.");
      setWorking(false);
      return;
    }

    setStatusText(
      "IA liberada novamente. O sistema voltou pelo ultimo estado comercial valido com fallback seguro."
    );
    setWorking(false);
    await fetchLeadConversationAndMessages({ silent: true });
  }

  async function sendManualAttachment(file: File) {
    if (!lead || !conversation) {
      setErrorText("Nao foi possivel enviar o anexo: conversa nao encontrada para este lead.");
      return false;
    }

    setUploadingManualAttachment(true);

    try {
      const formData = new FormData();
      formData.append("organizationId", lead.organization_id);

      if (lead.store_id) {
        formData.append("storeId", lead.store_id);
      }

      formData.append("conversationId", conversation.id);
      formData.append("file", file);

      const response = await fetch("/api/crm/messages/send-manual-attachment", {
        method: "POST",
        body: formData,
      });

      const result = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        message?: string;
      } | null;

      if (!response.ok || !result?.ok) {
        throw new Error(
          result?.message || result?.error || "Nao foi possivel enviar o anexo."
        );
      }

      return true;
    } catch (error: any) {
      setErrorText(error?.message || "Nao foi possivel enviar o anexo.");
      setStatusText(null);
      return false;
    } finally {
      setUploadingManualAttachment(false);
    }
  }

  async function sendTextMessage(text: string) {
    if (!lead || !conversation) {
      setErrorText("Nao foi possivel enviar: conversa nao encontrada para este lead.");
      return false;
    }

    const response = await fetch("/api/crm/messages/send-manual-text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: lead.organization_id,
        storeId: lead.store_id,
        conversationId: conversation.id,
        text,
      }),
    });

    const result = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          error?: string;
          message?: string;
        }
      | null;

    if (!response.ok || !result?.ok) {
      console.error("[LeadPage] erro ao enviar mensagem:", {
        status: response.status,
        error: result?.error ?? null,
        message: result?.message ?? null,
      });

      setErrorText(result?.message ?? result?.error ?? "Erro ao enviar mensagem.");
      return false;
    }

    return true;
  }

  async function sendMessage() {
    const text = newMessage.trim();
    const pendingAttachment = manualPendingAttachment;

    if (!text && !pendingAttachment) return;

    if (!lead || !conversation) {
      setErrorText("Nao foi possivel enviar: conversa nao encontrada para este lead.");
      return;
    }

    setWorking(true);
    setErrorText(null);
    setStatusText(null);

    let textSent = false;
    let attachmentSent = false;

    if (text) {
      textSent = await sendTextMessage(text);

      if (!textSent) {
        setWorking(false);
        return;
      }
    }

    if (pendingAttachment) {
      attachmentSent = await sendManualAttachment(pendingAttachment.file);

      if (!attachmentSent) {
        if (textSent) {
          setNewMessage("");
          setStatusText("Texto enviado, mas o anexo falhou. Revise e tente novamente.");
          await fetchLeadConversationAndMessages({ silent: true });
        }

        setWorking(false);
        return;
      }
    }

    if (textSent) {
      setNewMessage("");
    }

    if (attachmentSent) {
      cancelPendingManualAttachment();
    }

    if (textSent && attachmentSent) {
      setStatusText("Mensagem e anexo enviados com sucesso.");
    } else if (attachmentSent) {
      setStatusText("Anexo enviado com sucesso.");
    } else {
      setStatusText("Mensagem enviada com sucesso.");
    }

    setWorking(false);
    await fetchLeadConversationAndMessages({ silent: true });
  }

  async function simulateCustomerMessage(options?: { skipRefresh?: boolean }) {
    const text = simulatedCustomerMessage.trim();
    const skipRefresh = options?.skipRefresh ?? false;

    if (!text) return false;

    if (!lead || !conversation) {
      setErrorText("Nao foi possivel simular: conversa nao encontrada para este lead.");
      return false;
    }

    setSimulatingCustomer(true);

    try {
      const response = await fetch("/api/simulate-customer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId: lead.organization_id,
          storeId: lead.store_id || undefined,
          conversationId: conversation.id,
          text,
        }),
      });

      const result = (await response.json()) as SimulateCustomerResponse;

      if (!response.ok || !result?.ok) {
        const errorMessage =
          result?.message ||
          result?.error ||
          "Erro ao simular mensagem do cliente.";

        console.error("[LeadPage] erro ao simular cliente:", {
          httpStatus: response.status,
          result,
        });

        setErrorText(String(errorMessage));
        setSimulatingCustomer(false);
        return false;
      }

      if (result.aiReplySaved) {
        setStatusText(
          "Mensagem do cliente simulada com sucesso e resposta da IA salva no chat."
        );
      } else if (result.customerMessageSaved) {
        setStatusText(
          "Mensagem do cliente simulada com sucesso, mas a IA nao salvou resposta nesta tentativa."
        );
      } else {
        setStatusText("Simulacao concluida.");
      }

      setSimulatingCustomer(false);
      if (!skipRefresh) {
        await fetchLeadConversationAndMessages({ silent: true });
      }
      return true;
    } catch (error: any) {
      console.error("[LeadPage] erro inesperado ao simular cliente:", error);

      setErrorText(
        error?.message || "Erro inesperado ao simular mensagem do cliente."
      );
      setSimulatingCustomer(false);
      return false;
    }
  }

  async function simulateCustomerAttachment(
    file: File,
    purpose: string,
    options?: { skipRefresh?: boolean }
  ) {
    const skipRefresh = options?.skipRefresh ?? false;

    if (!lead || !conversation) {
      setErrorText("Nao foi possivel simular o anexo: conversa nao encontrada para este lead.");
      return false;
    }

    setUploadingCustomerAttachment(true);
    setAttachmentMenuOpen(false);

    try {
      const formData = new FormData();
      formData.append("organizationId", lead.organization_id);

      if (lead.store_id) {
        formData.append("storeId", lead.store_id);
      }

      formData.append("conversationId", conversation.id);
      formData.append("purpose", String(purpose || "unknown").trim() || "unknown");
      formData.append("file", file);

      const response = await fetch("/api/simulate-customer-media", {
        method: "POST",
        body: formData,
      });

      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };

      if (!response.ok || !result?.ok) {
        throw new Error(
          result?.message ||
            result?.error ||
            "Nao foi possivel simular o anexo do cliente."
        );
      }

      setStatusText("Anexo do cliente simulado com sucesso.");
      if (!skipRefresh) {
        await fetchLeadConversationAndMessages({ silent: true });
      }
      return true;
    } catch (error: any) {
      setErrorText(
        error?.message || "Nao foi possivel simular o anexo do cliente."
      );
      setStatusText(null);
      return false;
    } finally {
      setUploadingCustomerAttachment(false);
    }
  }

  function cancelPendingCustomerAttachment() {
    setSimulatedPendingAttachment((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }

      return null;
    });
  }

  function prepareCustomerAttachment(
    file: File,
    purpose: string,
    kind: "document" | "media" | "audio"
  ) {
    const safePurpose = String(purpose || "unknown").trim() || "unknown";
    const mimeType = String(file.type || "").trim();
    const previewUrl =
      kind === "media" && mimeType.startsWith("image/")
        ? URL.createObjectURL(file)
        : null;

    setSimulatedPendingAttachment((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }

      return {
        file,
        kind,
        purpose: safePurpose,
        fileName: file.name,
        size: file.size,
        mimeType,
        previewUrl,
      };
    });

    setAttachmentMenuOpen(false);
    setErrorText(null);
    setStatusText(null);
  }

  async function submitSimulatedCustomerComposer() {
    const text = simulatedCustomerMessage.trim();
    const pendingAttachment = simulatedPendingAttachment;

    if (!text && !pendingAttachment) {
      return;
    }

    if (!lead || !conversation) {
      setErrorText("Nao foi possivel simular: conversa nao encontrada para este lead.");
      setStatusText(null);
      return;
    }

    setErrorText(null);
    setStatusText(null);

    let textSent = false;
    let attachmentSent = false;

    if (text) {
      textSent = await simulateCustomerMessage({ skipRefresh: true });

      if (!textSent) {
        return;
      }
    }

    if (pendingAttachment) {
      attachmentSent = await simulateCustomerAttachment(
        pendingAttachment.file,
        pendingAttachment.purpose,
        { skipRefresh: true }
      );

      if (!attachmentSent) {
        if (textSent) {
          setSimulatedCustomerMessage("");
          setStatusText("Texto enviado, mas o anexo falhou. Revise e tente novamente.");
          await fetchLeadConversationAndMessages({ silent: true });
        }
        return;
      }
    }

    if (textSent) {
      setSimulatedCustomerMessage("");
    }

    if (attachmentSent) {
      cancelPendingCustomerAttachment();
    }

    if (textSent && attachmentSent) {
      setStatusText("Mensagem do cliente e anexo simulados com sucesso.");
    } else if (attachmentSent) {
      setStatusText("Anexo do cliente simulado com sucesso.");
    }

    await fetchLeadConversationAndMessages({ silent: true });
  }

  function cancelPendingManualAttachment() {
    setManualPendingAttachment((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }

      return null;
    });
  }

  function inferManualAttachmentKind(file: File): "document" | "media" | "audio" {
    const mimeType = String(file.type || "").toLowerCase();

    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("image/") || mimeType.startsWith("video/")) return "media";

    return "document";
  }

  function prepareManualAttachment(file: File, kind: "document" | "media" | "audio") {
    const mimeType = String(file.type || "").trim();
    const previewUrl =
      kind === "media" && mimeType.startsWith("image/")
        ? URL.createObjectURL(file)
        : null;

    setManualPendingAttachment((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }

      return {
        file,
        kind,
        purpose: "store_manual_attachment",
        fileName: file.name,
        size: file.size,
        mimeType,
        previewUrl,
      };
    });

    setErrorText(null);
    setStatusText(null);
  }

  async function startManualAudioRecording() {
    if (!conversation) {
      setErrorText("Nao foi possivel gravar: conversa nao encontrada para este lead.");
      setStatusText(null);
      return;
    }

    if (recordingAudio) {
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorText("Este navegador nao permite gravar audio diretamente por aqui.");
      setStatusText(null);
      return;
    }

    try {
      setErrorText(null);
      setStatusText(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];

      const preferredMimeType =
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType: preferredMimeType });
      audioRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setErrorText("Nao foi possivel concluir a gravacao do audio.");
        setStatusText(null);
        setRecordingAudio(false);
        setRecordingAudioSeconds(0);
        stream.getTracks().forEach((track) => track.stop());
        audioStreamRef.current = null;
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || preferredMimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

        stream.getTracks().forEach((track) => track.stop());
        audioStreamRef.current = null;
        audioRecorderRef.current = null;
        audioChunksRef.current = [];
        setRecordingAudio(false);
        setRecordingAudioSeconds(0);

        if (audioBlob.size <= 0) {
          setErrorText("A gravacao ficou vazia. Tente gravar novamente.");
          setStatusText(null);
          return;
        }

        const extension = mimeType.includes("ogg") ? "ogg" : "webm";
        const fileName = `audio-gravado-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.${extension}`;
        const audioFile = new File([audioBlob], fileName, { type: mimeType });

        prepareManualAttachment(audioFile, "audio");
        setStatusText("Audio gravado. Aperte enviar para mandar ao cliente.");
      };

      recorder.start();
      setRecordingAudio(true);
      setRecordingAudioSeconds(0);
    } catch (error: any) {
      setErrorText(
        error?.message ||
          "Nao foi possivel acessar o microfone. Verifique a permissao do navegador."
      );
      setStatusText(null);
      setRecordingAudio(false);
      setRecordingAudioSeconds(0);
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }
  }

  function stopManualAudioRecording() {
    const recorder = audioRecorderRef.current;

    if (!recorder || recorder.state !== "recording") {
      setRecordingAudio(false);
      setRecordingAudioSeconds(0);
      return;
    }

    recorder.stop();
  }

  async function startSimulatedCustomerAudioRecording() {
    if (!conversation) {
      setErrorText("Nao foi possivel gravar: conversa nao encontrada para este lead.");
      setStatusText(null);
      return;
    }

    if (simulatedRecordingAudio) {
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorText("Este navegador nao permite gravar audio diretamente por aqui.");
      setStatusText(null);
      return;
    }

    try {
      setErrorText(null);
      setStatusText(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      simulatedAudioStreamRef.current = stream;
      simulatedAudioChunksRef.current = [];

      const preferredMimeType =
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType: preferredMimeType });
      simulatedAudioRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          simulatedAudioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setErrorText("Nao foi possivel concluir a gravacao do audio do cliente.");
        setStatusText(null);
        cleanupSimulatedCustomerAudioRecording();
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || preferredMimeType || "audio/webm";
        const audioBlob = new Blob(simulatedAudioChunksRef.current, { type: mimeType });

        cleanupSimulatedCustomerAudioRecording();

        if (audioBlob.size <= 0) {
          setErrorText("A gravacao do cliente ficou vazia. Tente gravar novamente.");
          setStatusText(null);
          return;
        }

        const extension = mimeType.includes("ogg") ? "ogg" : "webm";
        const fileName = `audio-cliente-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.${extension}`;
        const audioFile = new File([audioBlob], fileName, { type: mimeType });

        prepareCustomerAttachment(audioFile, "unknown", "audio");
        setStatusText("Audio gravado. Aperte simular cliente para enviar.");
      };

      recorder.start();
      setSimulatedRecordingAudio(true);
      setSimulatedRecordingAudioSeconds(0);
    } catch (error: any) {
      setErrorText(
        error?.message ||
          "Nao foi possivel acessar o microfone. Verifique a permissao do navegador."
      );
      setStatusText(null);
      cleanupSimulatedCustomerAudioRecording();
    }
  }

  function stopSimulatedCustomerAudioRecording() {
    const recorder = simulatedAudioRecorderRef.current;

    if (!recorder || recorder.state !== "recording") {
      cleanupSimulatedCustomerAudioRecording();
      return;
    }

    recorder.stop();
  }

  function formatRecordingDuration(seconds: number) {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  function handleManualAttachmentInputChange(
    event: ChangeEvent<HTMLInputElement>,
    kind?: "document" | "media" | "audio"
  ) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";

    if (!file) {
      return;
    }

    prepareManualAttachment(file, kind ?? inferManualAttachmentKind(file));
  }

  function inferCustomerAttachmentKind(file: File): "document" | "media" | "audio" {
    return inferManualAttachmentKind(file);
  }

  function handleAttachmentInputChange(
    event: ChangeEvent<HTMLInputElement>,
    purpose: string,
    kind: "document" | "media" | "audio"
  ) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";

    if (!file) {
      return;
    }

    prepareCustomerAttachment(file, purpose, kind);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!working) {
        void sendMessage();
      }
    }
  }

  function handleSimulatedCustomerKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (
        !simulatingCustomer &&
        !uploadingCustomerAttachment &&
        !simulatedRecordingAudio
      ) {
        void submitSimulatedCustomerComposer();
      }
    }
  }

  async function loadSignedMediaUrl(
    message: MessageRow,
    options?: { forceRefresh?: boolean }
  ) {
    const safeMessageId = String(message.id || "").trim();

    if (!safeMessageId) {
      throw new Error("Nao foi possivel identificar a mensagem do anexo.");
    }

    const cached = signedMediaByMessageId[safeMessageId];
    const now = Date.now();
    const isCachedStillValid =
      Boolean(cached?.signedUrl) &&
      (!cached?.expiresAt || cached.expiresAt - now > 5_000);

    if (!options?.forceRefresh && isCachedStillValid) {
      return cached;
    }

    setLoadingSignedMediaByMessageId((current) => ({
      ...current,
      [safeMessageId]: true,
    }));
    setSignedMediaErrorByMessageId((current) => {
      if (!current[safeMessageId]) {
        return current;
      }

      const next = { ...current };
      delete next[safeMessageId];
      return next;
    });

    try {
      const response = await fetch(
        `/api/crm/messages/${encodeURIComponent(safeMessageId)}/signed-media-url`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const result = (await response.json()) as SignedMediaUrlResponse;

      if (!response.ok || !result?.ok || !result?.signedUrl) {
        throw new Error(
          result?.message ||
            result?.error ||
            "Nao foi possivel gerar a visualizacao segura do anexo."
        );
      }

      const nextState: SignedMediaState = {
        signedUrl: result.signedUrl,
        mimeType: result.mimeType || null,
        attachmentKind: result.attachmentKind || null,
        fileName: result.fileName || null,
        expiresAt: result.expiresInSeconds
          ? Date.now() + result.expiresInSeconds * 1000
          : null,
      };

      setSignedMediaByMessageId((current) => ({
        ...current,
        [safeMessageId]: nextState,
      }));

      return nextState;
    } catch (error: any) {
      const messageText =
        error?.message || "Erro ao abrir o anexo com seguranca.";
      setSignedMediaErrorByMessageId((current) => ({
        ...current,
        [safeMessageId]: messageText,
      }));
      throw error;
    } finally {
      setLoadingSignedMediaByMessageId((current) => {
        if (!current[safeMessageId]) {
          return current;
        }

        const next = { ...current };
        delete next[safeMessageId];
        return next;
      });
    }
  }

  async function openSignedAttachment(message: MessageRow, fallbackErrorText: string) {
    try {
      const signedMedia = await loadSignedMediaUrl(message);
      window.open(signedMedia.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      setErrorText(error?.message || fallbackErrorText);
      setStatusText(null);
    }
  }

  async function openCustomerLocationPhoto(message: MessageRow) {
    await openSignedAttachment(
      message,
      "Erro ao abrir a foto recebida com seguranca."
    );
  }

  function openCatalogProductPhoto(mediaUrl: string | null) {
    const safeMediaUrl = String(mediaUrl || "").trim();

    if (!/^https?:\/\//i.test(safeMediaUrl)) {
      setErrorText("Nao foi possivel abrir a foto do catalogo.");
      setStatusText(null);
      return;
    }

    window.open(safeMediaUrl, "_blank", "noopener,noreferrer");
  }

  function cleanupSimulatedCustomerAudioRecording() {
    simulatedAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
    simulatedAudioStreamRef.current = null;
    simulatedAudioRecorderRef.current = null;
    simulatedAudioChunksRef.current = [];
    setSimulatedRecordingAudio(false);
    setSimulatedRecordingAudioSeconds(0);
  }

  function handleCatalogPreviewError(messageId: string) {
    const safeMessageId = String(messageId || "").trim();

    if (!safeMessageId) {
      return;
    }

    setImagePreviewErrors((current) => {
      if (current[safeMessageId]) {
        return current;
      }

      return {
        ...current,
        [safeMessageId]: true,
      };
    });
  }

  useEffect(() => {
    const messagesToPreload = messages.filter((message) => {
      const safeMessageId = String(message.id || "").trim();
      const inlineKind = getInlinePrivateMediaKind(message);

      if (!safeMessageId || !inlineKind) {
        return false;
      }

      if (signedMediaByMessageId[safeMessageId]?.signedUrl) {
        return false;
      }

      if (loadingSignedMediaByMessageId[safeMessageId]) {
        return false;
      }

      if (signedMediaErrorByMessageId[safeMessageId]) {
        return false;
      }

      return true;
    });

    if (messagesToPreload.length === 0) {
      return;
    }

    messagesToPreload.forEach((message) => {
      void loadSignedMediaUrl(message).catch(() => null);
    });
  }, [messages, loadingSignedMediaByMessageId, signedMediaByMessageId, signedMediaErrorByMessageId]);

  useEffect(() => {
    void fetchLeadConversationAndMessages();
  }, [leadId]);

  useEffect(() => {
    setGeneratedQuotes([]);
    setGeneratedQuotesError(null);
    setGeneratedQuotesLoading(false);
    setOpeningGeneratedQuoteId(null);
    setQuoteActionLoadingId(null);
    setQuoteActionLoadingType(null);
    setQuoteActionError(null);
    setQuoteActionSuccess(null);
    setHasLoadedGeneratedQuotes(false);
    setGeneratedContracts([]);
    setGeneratedContractsError(null);
    setGeneratedContractsLoading(false);
    setOpeningGeneratedContractId(null);
    setContractActionLoadingId(null);
    setContractActionLoadingType(null);
    setContractActionError(null);
    setContractActionSuccess(null);
    setHasLoadedGeneratedContracts(false);
  }, [leadId]);

  useEffect(() => {
    if (activeDetailsTab !== "pdfs") {
      return;
    }

    void fetchGeneratedQuotes();
    void fetchGeneratedContracts();
  }, [activeDetailsTab, leadId]);

  useEffect(() => {
    if (loading) return;

    scrollMessagesToBottom(
      hasScrolledMessagesInitiallyRef.current ? "smooth" : "auto"
    );
    hasScrolledMessagesInitiallyRef.current = true;
  }, [messages.length, loading]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (quoteFormMode !== "create") {
      return;
    }

    if (!quoteDraftStorageKey || hasRestoredQuoteDraftRef.current || !lead?.id) {
      return;
    }

    const rawDraft =
      (quoteDraftPrimaryStorageKey
        ? window.localStorage.getItem(quoteDraftPrimaryStorageKey)
        : null) ??
      (quoteDraftFallbackStorageKey
        ? window.localStorage.getItem(quoteDraftFallbackStorageKey)
        : null);

    hasRestoredQuoteDraftRef.current = true;

    if (!rawDraft) {
      return;
    }

    try {
      const parsed = JSON.parse(rawDraft) as Partial<QuoteDraftPayload> | null;
      const draftItems = Array.isArray(parsed?.quoteItems)
        ? parsed.quoteItems
            .map((item) => {
              if (!item || typeof item !== "object") {
                return null;
              }

              const safeItemType =
                item.itemType === "pool_installation" ||
                item.itemType === "service" ||
                item.itemType === "custom"
                  ? item.itemType
                  : "custom";

              return {
                id:
                  typeof item.id === "string" && item.id.trim().length > 0
                    ? item.id
                    : createQuoteFormItemId(),
                itemType: safeItemType,
                name: typeof item.name === "string" ? item.name : "",
                description: typeof item.description === "string" ? item.description : "",
                quantity: typeof item.quantity === "string" ? item.quantity : "1",
                unitPriceReais:
                  typeof item.unitPriceReais === "string" ? item.unitPriceReais : "",
                discountReais:
                  typeof item.discountReais === "string" ? item.discountReais : "",
              } satisfies QuoteFormItem;
            })
            .filter((item): item is QuoteFormItem => item !== null)
        : [];

      setQuoteTitle(typeof parsed?.quoteTitle === "string" ? parsed.quoteTitle : "");
      setQuoteCustomerNotes(
        typeof parsed?.quoteCustomerNotes === "string" ? parsed.quoteCustomerNotes : ""
      );
      setQuoteWarrantyTerms(
        typeof parsed?.quoteWarrantyTerms === "string" ? parsed.quoteWarrantyTerms : ""
      );
      setQuoteValidityDays(
        typeof parsed?.quoteValidityDays === "string" ? parsed.quoteValidityDays : ""
      );
      setQuoteItems(draftItems.length > 0 ? draftItems : [createEmptyQuoteFormItem()]);
      setIsQuoteModalOpen(parsed?.isQuoteModalOpen === true);
    } catch {
      clearQuoteDraft();
    }
  }, [
    clearQuoteDraft,
    lead?.id,
    quoteDraftFallbackStorageKey,
    quoteDraftPrimaryStorageKey,
    quoteFormMode,
    quoteDraftStorageKey,
  ]);

  useEffect(() => {
    latestQuoteDraftRef.current = quoteDraftPayload;
  }, [quoteDraftPayload]);

  useEffect(() => {
    if (typeof window === "undefined" || !detailsTabStorageKey) {
      return;
    }

    const savedTab = window.sessionStorage.getItem(detailsTabStorageKey);
    if (!savedTab) {
      return;
    }

    if (VALID_DETAIL_TABS.includes(savedTab as DetailTab)) {
      setActiveDetailsTab(savedTab as DetailTab);
    }
  }, [detailsTabStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !detailsTabStorageKey) {
      return;
    }

    if (activeDetailsTab && VALID_DETAIL_TABS.includes(activeDetailsTab)) {
      window.sessionStorage.setItem(detailsTabStorageKey, activeDetailsTab);
      return;
    }

    window.sessionStorage.removeItem(detailsTabStorageKey);
  }, [activeDetailsTab, detailsTabStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !quoteDraftStorageKey) {
      return;
    }

    if (quoteFormMode !== "create") {
      return;
    }

    if (!hasRestoredQuoteDraftRef.current) {
      return;
    }

    persistQuoteDraftToStorage();
  }, [
    quoteDraftStorageKey,
    quoteFormMode,
    persistQuoteDraftToStorage,
    quoteDraftPayload,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !quoteDraftStorageKey) {
      return;
    }

    if (quoteFormMode !== "create") {
      return;
    }

    const flushQuoteDraft = () => {
      if (!hasRestoredQuoteDraftRef.current || !latestQuoteDraftRef.current) {
        return;
      }

      persistQuoteDraftToStorage(latestQuoteDraftRef.current);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushQuoteDraft();
      }
    };

    window.addEventListener("pagehide", flushQuoteDraft);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushQuoteDraft);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [persistQuoteDraftToStorage, quoteDraftStorageKey, quoteFormMode]);

  if (loading) {
    return <div className="p-6">Carregando lead e mensagens...</div>;
  }

  if (errorText && !lead) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Erro ao carregar lead</h1>
        <p className="mt-3">{errorText}</p>
      </div>
    );
  }

  if (!lead) {
    return <div className="p-6">Lead nao encontrado</div>;
  }

  const detailTabs: Array<{
    id: DetailTab;
    label: string;
    value: string;
    help: string;
  }> = [
    {
      id: "summary",
      label: "Resumo rapido",
      value: conversation?.last_message_preview ? "Atualizado" : "Sem resumo",
      help: "Ultima mensagem e proximo passo",
    },
    {
      id: "appointments",
      label: "Agenda e compromissos",
      value: `${appointments.length}`,
      help: appointments.length === 1 ? "compromisso" : "compromissos",
    },
    {
      id: "context",
      label: "Interesses e contexto",
      value:
        latestCommercialTask?.task_payload?.recommended_model ||
        latestCommercialTask?.task_payload?.ad_model_or_requested_model ||
        "Sem modelo",
      help: "Modelo, espaco e preferencias",
    },
    {
      id: "tasks",
      label: "Pendencias comerciais",
      value: `${commercialTasks.length}`,
      help: commercialTasks.length === 1 ? "pendencia" : "pendencias",
    },
    {
      id: "pdfs",
      label: "PDFs gerados",
      value: `${generatedQuotes.length + generatedContracts.length}`,
      help:
        generatedQuotes.length + generatedContracts.length === 1
          ? "arquivo listado"
          : "arquivos listados",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-4 py-4 lg:px-6">
        {refreshing ? (
          <div className="mb-4 flex justify-end">
            <div className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 shadow-sm ring-1 ring-black/10">
              Atualizando...
            </div>
          </div>
        ) : null}

        {errorText ? (
          <div className="mb-4 rounded-2xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-600/20">
            <div className="font-semibold">Erro</div>
            <div className="mt-1 break-words">{errorText}</div>
          </div>
        ) : null}

        {statusText ? (
          <div className="mb-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
            <div className="font-semibold">Sucesso</div>
            <div className="mt-1 break-words">{statusText}</div>
          </div>
        ) : null}

        <div className="rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
          <div className="border-b border-gray-100 px-4 py-4 lg:px-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Conversa com cliente
                </div>
                <h1 className="mt-1 break-words text-xl font-bold text-gray-900">
                  {lead.name ?? "Lead sem nome"}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 font-semibold text-gray-800">
                    {isHumanActive ? "Humano no controle" : "IA ativa"}
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    onClick={() => void takeOverConversation()}
                    disabled={!canTakeOver}
                    className="rounded-xl bg-black px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isHumanActive ? "Conversa assumida" : "Assumir conversa"}
                  </button>

                  <button
                    onClick={() => void releaseConversation()}
                    disabled={!canReleaseToAI}
                    className="rounded-xl bg-gray-100 px-3.5 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isHumanActive ? "Liberar IA" : "IA liberada"}
                  </button>

                  <button
                    onClick={() => void fetchLeadConversationAndMessages({ silent: true })}
                    disabled={working || refreshing || simulatingCustomer}
                    className="rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Recarregar
                  </button>

                  <button
                    type="button"
                    onClick={openCreateQuoteModal}
                    disabled={working || refreshing || simulatingCustomer}
                    className="rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Criar orçamento
                  </button>
                </div>

                <Link
                  href="/crm"
                  className="inline-flex items-center rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Voltar para o CRM
                </Link>
              </div>
            </div>

            {!conversation ? (
              <div className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/20">
                Este lead ainda nao possui conversa. Os controles ficam bloqueados ate existir uma conversa.
              </div>
            ) : null}
          </div>

          <div className="border-b border-gray-100 bg-gray-50/70 px-4 py-3 lg:px-5">
            <div className="flex flex-wrap items-center gap-2">
              {detailTabs.map((tab) => {
                const isActive = activeDetailsTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveDetailsTab(tab.id)}
                    className={`rounded-xl px-3.5 py-2 text-xs font-semibold shadow-sm transition ${
                      isActive
                        ? "bg-black text-white"
                        : "bg-white text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {activeDetailsTab ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6">
              <div className="max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/10">
                <div className="flex items-start justify-between gap-4 border-b border-gray-100 bg-gray-950 px-5 py-4 text-white">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/50">
                      Detalhes do cliente
                    </div>
                    <h2 className="mt-1 text-lg font-bold">
                      {detailTabs.find((tab) => tab.id === activeDetailsTab)?.label}
                    </h2>
                    <div className="mt-1 text-xs text-white/60">
                      {detailTabs.find((tab) => tab.id === activeDetailsTab)?.help}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveDetailsTab(null)}
                    className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                  >
                    Fechar
                  </button>
                </div>

                <div className="max-h-[68vh] overflow-y-auto p-5">
                  {activeDetailsTab === "summary" ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <InfoCard
                        label="Numero do cliente"
                        value={lead.phone ?? "Sem telefone"}
                      />
                      <InfoCard
                        label="Estagio do funil"
                        value={formatLeadStage(lead.state)}
                      />
                      <InfoCard
                        label="Status da conversa"
                        value={
                          conversation
                            ? formatConversationStatus(conversation.status)
                            : "Sem conversa"
                        }
                      />

                      <div>
                        <div className="text-sm font-semibold text-gray-900">
                          Ultima mensagem
                        </div>
                        <div className="mt-2 text-sm leading-6 text-gray-700">
                          {conversation?.last_message_preview ||
                            "Ainda sem mensagem resumida na conversa."}
                        </div>
                        <div className="mt-2 text-xs text-gray-500">
                          {conversation?.last_message_at
                            ? formatDateTime(conversation.last_message_at)
                            : "Sem horario registrado"}
                        </div>
                      </div>

                      <div>
                        <div className="text-sm font-semibold text-gray-900">
                          Proximo passo
                        </div>
                        <div className="mt-2 text-sm leading-6 text-gray-700">
                          {latestCommercialTask?.task_payload?.next_step ||
                            "Ainda sem proximo passo registrado."}
                        </div>
                      </div>

                      <div className="lg:col-span-2">
                        <div className="text-sm font-semibold text-gray-900">
                          Resumo comercial
                        </div>
                        <div className="mt-2 text-sm leading-6 text-gray-700">
                          {latestCommercialTask?.task_payload?.conversation_summary ||
                            "Ainda sem resumo comercial registrado."}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {activeDetailsTab === "context" ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <InfoCard
                        label="Modelo citado"
                        value={
                          latestCommercialTask?.task_payload?.ad_model_or_requested_model ||
                          "Ainda sem modelo registrado"
                        }
                      />
                      <InfoCard
                        label="Modelo recomendado"
                        value={
                          latestCommercialTask?.task_payload?.recommended_model ||
                          "Ainda sem recomendacao registrada"
                        }
                      />
                      <InfoCard
                        label="Espaco informado"
                        value={
                          latestCommercialTask?.task_payload?.space_text ||
                          "Ainda sem informacao registrada"
                        }
                      />
                      <InfoCard
                        label="Localizacao"
                        value={
                          latestCommercialTask?.task_payload?.location_text ||
                          "Ainda sem informacao registrada"
                        }
                      />
                      <InfoCard
                        label="Periodo preferido"
                        value={
                          latestCommercialTask?.task_payload?.preferred_period_text ||
                          "Ainda sem informacao registrada"
                        }
                      />
                      <InfoCard
                        label="Preferencias do cliente"
                        value={
                          latestCommercialTask?.task_payload?.customer_preferences ||
                          "Ainda sem informacao registrada"
                        }
                      />
                      <InfoCard
                        label="Objecao relevante"
                        value={
                          latestCommercialTask?.task_payload?.relevant_objection ||
                          "Ainda sem informacao registrada"
                        }
                      />
                    </div>
                  ) : null}

                  {activeDetailsTab === "tasks" ? (
                    <div>
                      {commercialTasks.length === 0 ? (
                        <EmptyState text="Ainda nao existem pendencias comerciais registradas para este cliente." />
                      ) : (
                        <div className="space-y-3">
                          {commercialTasks.map((task) => (
                            <div
                              key={task.id}
                              className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white">
                                  {formatTaskTypeLabel(task.task_type)}
                                </span>
                                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-700 ring-1 ring-black/10">
                                  {formatTaskStatusLabel(task.status)}
                                </span>
                                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-700 ring-1 ring-black/10">
                                  Prioridade {formatPriorityLabel(task.priority)}
                                </span>
                              </div>

                              <div className="mt-3 text-sm font-semibold text-gray-900">
                                {task.title || formatTaskTypeLabel(task.task_type)}
                              </div>
                              <div className="mt-2 text-sm leading-6 text-gray-700">
                                {task.description || "Sem descricao registrada."}
                              </div>

                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <InfoCard
                                  label="Ultima mensagem do cliente"
                                  value={
                                    task.task_payload?.last_customer_message ||
                                    "Sem mensagem registrada"
                                  }
                                />
                                <InfoCard
                                  label="Proximo passo"
                                  value={
                                    task.task_payload?.next_step ||
                                    "Sem proximo passo registrado"
                                  }
                                />
                              </div>

                              <div className="mt-3 text-xs text-gray-500">
                                Atualizado em {formatDateTime(task.updated_at || task.created_at)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {activeDetailsTab === "pdfs" ? (
                    <div className="space-y-5">
                      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-gray-50 p-2 ring-1 ring-black/5">
                        <button
                          type="button"
                          onClick={() => setActiveGeneratedPdfTab("quotes")}
                          className={`rounded-xl px-3.5 py-2 text-xs font-semibold shadow-sm transition ${
                            activeGeneratedPdfTab === "quotes"
                              ? "bg-black text-white"
                              : "bg-white text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                          }`}
                        >
                          {`Orcamentos (${generatedQuotes.length})`}
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveGeneratedPdfTab("contracts")}
                          className={`rounded-xl px-3.5 py-2 text-xs font-semibold shadow-sm transition ${
                            activeGeneratedPdfTab === "contracts"
                              ? "bg-black text-white"
                              : "bg-white text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                          }`}
                        >
                          {`Contratos (${generatedContracts.length})`}
                        </button>
                      </div>

                      {activeGeneratedPdfTab === "quotes" ? (
                        <div>
                          <div className="text-sm font-semibold text-gray-900">
                            Orcamentos
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            PDFs de orcamento gerados para este lead.
                          </div>

                          {generatedQuotesError ? (
                            <div className="mt-3 rounded-2xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-600/20">
                              {generatedQuotesError}
                            </div>
                          ) : null}

                          {quoteActionError ? (
                            <div className="mt-3 rounded-2xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-600/20">
                              {quoteActionError}
                            </div>
                          ) : null}

                          {quoteActionSuccess ? (
                            <div className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
                              {quoteActionSuccess}
                            </div>
                          ) : null}

                          {generatedQuotesLoading ? (
                            <div className="mt-3 rounded-2xl bg-gray-50 p-4 text-sm text-gray-600 ring-1 ring-black/5">
                              Carregando orcamentos gerados...
                            </div>
                          ) : null}

                          {!generatedQuotesLoading && generatedQuotes.length === 0 ? (
                            <div className="mt-3 rounded-2xl bg-gray-50 p-4 text-sm text-gray-600 ring-1 ring-black/5">
                              Nenhum orcamento gerado ainda.
                            </div>
                          ) : null}

                          {!generatedQuotesLoading && generatedQuotes.length > 0 ? (
                            <div className="mt-3 space-y-3">
                              {generatedQuotes.map((quote) => {
                                const normalizedStatus = String(quote.status || "")
                                  .trim()
                                  .toLowerCase();
                                const linkedContract = contractsByQuoteId[quote.id];
                                const hasPdf =
                                  Boolean(quote.current_version?.storage_bucket) &&
                                  Boolean(quote.current_version?.storage_path);
                                const isOpening = openingGeneratedQuoteId === quote.id;
                                const isActionLoading = quoteActionLoadingId === quote.id;
                                const isContractActionLoading = contractActionLoadingId === quote.id;
                                const isLoadingForEdit = loadingQuoteForEdit === quote.id;
                                const canApprove = normalizedStatus === "pending_review";
                                const canSend = normalizedStatus === "approved";
                                const wasSent = normalizedStatus === "sent";
                                const canCreateContract =
                                  hasLoadedGeneratedContracts &&
                                  (normalizedStatus === "approved" || normalizedStatus === "sent") &&
                                  !linkedContract;
                                const canEditQuote =
                                  normalizedStatus === "pending_review" ||
                                  normalizedStatus === "changes_requested" ||
                                  normalizedStatus === "draft" ||
                                  normalizedStatus === "approved";

                                return (
                                  <div
                                    key={quote.id}
                                    className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white">
                                            {quote.quote_number || "Sem numero"}
                                          </span>
                                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-700 ring-1 ring-black/10">
                                            {formatQuoteStatusLabel(quote.status)}
                                          </span>
                                        </div>

                                        <div className="mt-3 text-sm font-semibold text-gray-900">
                                          {quote.title || "Orcamento sem titulo"}
                                        </div>
                                        <div className="mt-2 grid gap-3 text-sm text-gray-700 md:grid-cols-2">
                                          <InfoCard
                                            label="Valor total"
                                            value={formatCurrencyBRL((Number(quote.total_cents || 0) || 0) / 100)}
                                          />
                                          <InfoCard
                                            label="Criado em"
                                            value={formatDateTime(quote.created_at)}
                                          />
                                          <InfoCard
                                            label="Arquivo PDF"
                                            value={
                                              quote.current_version?.original_filename ||
                                              "PDF ainda nao disponivel"
                                            }
                                          />
                                          <InfoCard
                                            label="Tamanho"
                                            value={
                                              typeof quote.current_version?.size_bytes === "number"
                                                ? formatFileSize(quote.current_version.size_bytes)
                                                : "Sem tamanho registrado"
                                            }
                                          />
                                        </div>
                                      </div>

                                      <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                                        {canEditQuote ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void loadQuoteForEdit(
                                                quote.id,
                                                quote.quote_number,
                                                quote.status
                                              )
                                            }
                                            disabled={isLoadingForEdit || isActionLoading}
                                            className="rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                                          >
                                            {isLoadingForEdit
                                              ? "Carregando..."
                                              : "Editar orcamento"}
                                          </button>
                                        ) : null}

                                        {canApprove ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void approveGeneratedQuote(quote.id, quote.status)
                                            }
                                            disabled={isActionLoading}
                                            className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-200 disabled:text-emerald-700"
                                          >
                                            {isActionLoading && quoteActionLoadingType === "approve"
                                              ? "Aprovando..."
                                              : "Aprovar"}
                                          </button>
                                        ) : null}

                                        {canSend ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void sendGeneratedQuoteToCustomer(quote.id, quote.status)
                                            }
                                            disabled={isActionLoading}
                                            className="rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-200 disabled:text-blue-700"
                                          >
                                            {isActionLoading && quoteActionLoadingType === "send"
                                              ? "Enviando..."
                                              : "Enviar ao cliente"}
                                          </button>
                                        ) : null}

                                        {wasSent ? (
                                          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-600/20">
                                            Enviado ao cliente
                                          </span>
                                        ) : null}

                                        {linkedContract ? (
                                          <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800 ring-1 ring-sky-600/20">
                                            Contrato vinculado
                                          </span>
                                        ) : null}

                                        {canCreateContract ? (
                                          <button
                                            type="button"
                                            onClick={() => void createContractFromQuote(quote.id)}
                                            disabled={isContractActionLoading}
                                            className="rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-200 disabled:text-sky-700"
                                          >
                                            {isContractActionLoading &&
                                            contractActionLoadingType === "create"
                                              ? "Criando..."
                                              : "Gerar contrato"}
                                          </button>
                                        ) : null}

                                        <button
                                          type="button"
                                          onClick={() => void openGeneratedQuotePdf(quote.id)}
                                          disabled={!hasPdf || isOpening}
                                          className="rounded-xl bg-black px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:opacity-100"
                                        >
                                          {isOpening ? "Abrindo..." : "Abrir PDF"}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {activeGeneratedPdfTab === "contracts" ? (
                        <div>
                          <div className="text-sm font-semibold text-gray-900">
                            Contratos
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            Contratos gerados para este lead e seus proximos passos operacionais.
                          </div>

                          {generatedContractsError ? (
                            <div className="mt-3 rounded-2xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-600/20">
                              {generatedContractsError}
                            </div>
                          ) : null}

                          {contractActionError ? (
                            <div className="mt-3 rounded-2xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-600/20">
                              {contractActionError}
                            </div>
                          ) : null}

                          {contractActionSuccess ? (
                            <div className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
                              {contractActionSuccess}
                            </div>
                          ) : null}

                          <div className="mt-3 rounded-2xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-600/20">
                            O aceite do cliente nesta tela e um registro rastreavel operacional, nao uma assinatura digital avancada.
                          </div>

                          {generatedContractsLoading ? (
                            <div className="mt-3 rounded-2xl bg-gray-50 p-4 text-sm text-gray-600 ring-1 ring-black/5">
                              Carregando contratos...
                            </div>
                          ) : null}

                          {!generatedContractsLoading && generatedContracts.length === 0 ? (
                            <div className="mt-3 rounded-2xl bg-gray-50 p-4 text-sm text-gray-600 ring-1 ring-black/5">
                              Nenhum contrato gerado ainda.
                            </div>
                          ) : null}

                          {!generatedContractsLoading && generatedContracts.length > 0 ? (
                            <div className="mt-3 space-y-3">
                              {generatedContracts.map((contract) => {
                                const normalizedStatus = String(contract.status || "")
                                  .trim()
                                  .toLowerCase();
                                const hasCurrentVersion = Boolean(contract.current_version_id);
                                const isOpening = openingGeneratedContractId === contract.id;
                                const isActionLoading = contractActionLoadingId === contract.id;
                                const canGeneratePdf = !hasCurrentVersion;
                                const canApprove =
                                  (normalizedStatus === "pending_review" ||
                                    normalizedStatus === "draft") &&
                                  hasCurrentVersion;
                                const canSend = normalizedStatus === "approved";
                                const canRegisterCustomerAcceptance =
                                  normalizedStatus === "sent_to_customer";
                                const canConfirmStore = normalizedStatus === "customer_signed";
                                const isCompleted = normalizedStatus === "completed";

                                return (
                                  <div
                                    key={contract.id}
                                    className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white">
                                            {contract.contract_number || "Sem numero"}
                                          </span>
                                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-700 ring-1 ring-black/10">
                                            {formatContractStatusLabel(contract.status)}
                                          </span>
                                        </div>

                                        <div className="mt-3 text-sm font-semibold text-gray-900">
                                          {contract.title || "Contrato sem titulo"}
                                        </div>
                                        <div className="mt-2 grid gap-3 text-sm text-gray-700 md:grid-cols-2">
                                          <InfoCard
                                            label="Valor total"
                                            value={formatCurrencyBRL((Number(contract.total_cents || 0) || 0) / 100)}
                                          />
                                          <InfoCard
                                            label="Criado em"
                                            value={formatDateTime(contract.created_at)}
                                          />
                                          <InfoCard
                                            label="Enviado em"
                                            value={formatDateTime(contract.sent_at)}
                                          />
                                          <InfoCard
                                            label="Aceite do cliente"
                                            value={formatDateTime(contract.customer_signed_at)}
                                          />
                                          <InfoCard
                                            label="Conclusao"
                                            value={formatDateTime(contract.completed_at)}
                                          />
                                          <InfoCard
                                            label="PDF atual"
                                            value={hasCurrentVersion ? "Versao disponivel" : "PDF ainda nao gerado"}
                                          />
                                        </div>
                                      </div>

                                      <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                                        {canGeneratePdf ? (
                                          <button
                                            type="button"
                                            onClick={() => void generateContractPdf(contract.id)}
                                            disabled={isActionLoading}
                                            className="rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                                          >
                                            {isActionLoading &&
                                            contractActionLoadingType === "generate_pdf"
                                              ? "Gerando..."
                                              : "Gerar PDF"}
                                          </button>
                                        ) : null}

                                        {canApprove ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void approveGeneratedContract(contract.id, contract.status)
                                            }
                                            disabled={isActionLoading}
                                            className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-200 disabled:text-emerald-700"
                                          >
                                            {isActionLoading && contractActionLoadingType === "approve"
                                              ? "Aprovando..."
                                              : "Aprovar"}
                                          </button>
                                        ) : null}

                                        {canSend ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void sendGeneratedContractToCustomer(contract.id, contract.status)
                                            }
                                            disabled={isActionLoading}
                                            className="rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-200 disabled:text-blue-700"
                                          >
                                            {isActionLoading && contractActionLoadingType === "send"
                                              ? "Enviando..."
                                              : "Enviar ao cliente"}
                                          </button>
                                        ) : null}

                                        {canRegisterCustomerAcceptance ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void registerCustomerContractAcceptance(contract.id)
                                            }
                                            disabled={isActionLoading}
                                            className="rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-200 disabled:text-amber-700"
                                          >
                                            {isActionLoading &&
                                            contractActionLoadingType === "customer_sign"
                                              ? "Registrando..."
                                              : "Registrar aceite do cliente"}
                                          </button>
                                        ) : null}

                                        {canConfirmStore ? (
                                          <button
                                            type="button"
                                            onClick={() => void confirmStoreContractSignature(contract.id)}
                                            disabled={isActionLoading}
                                            className="rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-200 disabled:text-sky-700"
                                          >
                                            {isActionLoading && contractActionLoadingType === "store_sign"
                                              ? "Confirmando..."
                                              : "Confirmar pela loja"}
                                          </button>
                                        ) : null}

                                        {isCompleted ? (
                                          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-600/20">
                                            Concluido
                                          </span>
                                        ) : null}

                                        <button
                                          type="button"
                                          onClick={() => void openGeneratedContractPdf(contract.id)}
                                          disabled={!hasCurrentVersion || isOpening}
                                          className="rounded-xl bg-black px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:opacity-100"
                                        >
                                          {isOpening ? "Abrindo..." : "Abrir PDF"}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {activeDetailsTab === "appointments" ? (
                    <div>
                      {appointments.length === 0 ? (
                        <EmptyState text="Ainda nao existem compromissos registrados para este cliente." />
                      ) : (
                        <div className="space-y-3">
                          {appointments.map((appointment) => (
                            <div
                              key={appointment.id}
                              className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-gray-900">
                                    {formatAppointmentTypeLabel(appointment.appointment_type)}
                                  </div>
                                  <div className="mt-1 text-xs text-gray-600">
                                    {formatAppointmentStatusLabel(appointment.status)}
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-gray-500">
                                  <span>
                                    {formatDateTime(appointment.scheduled_start || appointment.scheduled_end)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => openGoogleMapsRoute(appointment.address_text)}
                                    disabled={!buildGoogleMapsRouteUrl(appointment.address_text)}
                                    title={
                                      buildGoogleMapsRouteUrl(appointment.address_text)
                                        ? "Abrir rota no Google Maps"
                                        : "Falta endereco para abrir a rota"
                                    }
                                    className="rounded-lg bg-black px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:opacity-100"
                                  >
                                    Rota
                                  </button>
                                </div>
                              </div>

                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <InfoCard
                                  label="Endereco"
                                  value={appointment.address_text || "Sem endereco registrado"}
                                />
                                <InfoCard
                                  label="Observacoes"
                                  value={appointment.notes || "Sem observacoes registradas"}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {isQuoteModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6">
              <div className="max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/10">
                <div className="flex items-start justify-between gap-4 border-b border-gray-100 bg-gray-950 px-5 py-4 text-white">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/50">
                      {isEditingQuote ? "Edicao de orcamento" : "Orçamento manual"}
                    </div>
                    <h2 className="mt-1 text-lg font-bold">
                      {isEditingQuote ? "Editar orçamento" : "Novo orçamento"}
                    </h2>
                  </div>

                  <button
                    type="button"
                    onClick={closeQuoteModalAndReset}
                    disabled={isGeneratingManualQuote}
                    className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                  >
                    Fechar
                  </button>
                </div>

                <div className="max-h-[68vh] overflow-y-auto p-5">
                  <div className="grid gap-4">
                    <div>
                      <p className="text-sm leading-6 text-gray-700">
                        {isEditingQuote
                          ? "Revise os dados atuais do orcamento antes de gerar uma nova versao."
                          : "Crie um orçamento para este cliente."}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {isEditingQuote
                          ? editingQuoteNumber
                            ? `Edicao carregada de ${editingQuoteNumber}.`
                            : "Edicao carregada do orcamento atual."
                          : "Rascunho salvo temporariamente neste navegador."}
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Título do orçamento
                        </label>
                        <input
                          value={quoteTitle}
                          onChange={(event) => setQuoteTitle(event.target.value)}
                          className="mt-1 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: Orçamento piscina premium"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Garantia
                        </label>
                        <input
                          value={quoteWarrantyTerms}
                          onChange={(event) => setQuoteWarrantyTerms(event.target.value)}
                          className="mt-1 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: 12 meses"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Validade em dias
                        </label>
                        <input
                          value={quoteValidityDays}
                          onChange={(event) => setQuoteValidityDays(event.target.value)}
                          className="mt-1 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: 7"
                          inputMode="numeric"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Observações para o cliente
                        </label>
                        <textarea
                          value={quoteCustomerNotes}
                          onChange={(event) => setQuoteCustomerNotes(event.target.value)}
                          className="mt-1 min-h-[96px] w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: Condições comerciais, escopo, observações gerais..."
                        />
                      </div>
                    </div>

                    <div className="rounded-3xl bg-gray-50 p-4 ring-1 ring-black/5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-gray-900">Itens do orçamento</div>
                          <div className="text-xs text-gray-500">
                            Adicione produtos ou serviços manualmente.
                          </div>
                        </div>

                      </div>

                      <div className="mt-4 space-y-4">
                        {quoteItems.map((item, index) => {
                          const quantity = parseQuoteQuantityValue(item.quantity);
                          const unitPrice = parseQuoteMoneyValue(item.unitPriceReais);
                          const discount = parseQuoteMoneyValue(item.discountReais);
                          const itemSubtotal = quantity * unitPrice;
                          const itemTotal = Math.max(itemSubtotal - discount, 0);

                          return (
                            <div
                              key={item.id}
                              className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/10"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="text-sm font-semibold text-gray-900">
                                  Item {index + 1}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => removeQuoteItem(item.id)}
                                  className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-200"
                                >
                                  Remover
                                </button>
                              </div>

                              <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <div>
                                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Tipo do item
                                  </label>
                                  <select
                                    value={item.itemType}
                                    onChange={(event) =>
                                      updateQuoteItem(item.id, "itemType", event.target.value)
                                    }
                                    className="mt-1 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-black"
                                  >
                                    <option value="pool_installation">
                                      {getQuoteItemTypeLabel("pool_installation")}
                                    </option>
                                    <option value="custom">{getQuoteItemTypeLabel("custom")}</option>
                                    <option value="service">{getQuoteItemTypeLabel("service")}</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Quantidade
                                  </label>
                                  <input
                                    value={item.quantity}
                                    onChange={(event) =>
                                      updateQuoteItem(item.id, "quantity", event.target.value)
                                    }
                                    className="mt-1 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-black"
                                    placeholder="1"
                                    inputMode="decimal"
                                  />
                                </div>

                                <div className="md:col-span-2">
                                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Nome
                                  </label>
                                  <input
                                    value={item.name}
                                    onChange={(event) =>
                                      updateQuoteItem(item.id, "name", event.target.value)
                                    }
                                    className="mt-1 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-black"
                                    placeholder="Ex.: Piscina Premium"
                                  />
                                </div>

                                <div className="md:col-span-2">
                                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Descrição
                                  </label>
                                  <textarea
                                    value={item.description}
                                    onChange={(event) =>
                                      updateQuoteItem(item.id, "description", event.target.value)
                                    }
                                    className="mt-1 min-h-[88px] w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-black"
                                    placeholder="Detalhes do item ou serviço"
                                  />
                                </div>

                                <div>
                                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Preço unitário (R$)
                                  </label>
                                  <input
                                    value={item.unitPriceReais}
                                    onChange={(event) =>
                                      updateQuoteItem(item.id, "unitPriceReais", event.target.value)
                                    }
                                    className="mt-1 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-black"
                                    placeholder="0,00"
                                    inputMode="decimal"
                                  />
                                </div>

                                <div>
                                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Desconto (R$)
                                  </label>
                                  <input
                                    value={item.discountReais}
                                    onChange={(event) =>
                                      updateQuoteItem(item.id, "discountReais", event.target.value)
                                    }
                                    className="mt-1 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-black"
                                    placeholder="0,00"
                                    inputMode="decimal"
                                  />
                                </div>
                              </div>

                              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                <div className="rounded-2xl bg-gray-50 px-4 py-3 ring-1 ring-black/5">
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                    Subtotal
                                  </div>
                                  <div className="mt-1 text-sm font-bold text-gray-900">
                                    {formatCurrencyBRL(itemSubtotal)}
                                  </div>
                                </div>

                                <div className="rounded-2xl bg-gray-50 px-4 py-3 ring-1 ring-black/5">
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                    Desconto
                                  </div>
                                  <div className="mt-1 text-sm font-bold text-gray-900">
                                    {formatCurrencyBRL(discount)}
                                  </div>
                                </div>

                                <div className="rounded-2xl bg-gray-950 px-4 py-3 text-white ring-1 ring-black/5">
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
                                    Total do item
                                  </div>
                                  <div className="mt-1 text-sm font-bold">
                                    {formatCurrencyBRL(itemTotal)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        <div className="flex justify-start">
                          <button
                            type="button"
                            onClick={addQuoteItem}
                            className="rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
                          >
                            Adicionar item
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl bg-gray-950 p-4 text-white ring-1 ring-black/5">
                      {quoteFormError ? (
                        <div className="mb-4 rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-100 ring-1 ring-red-300/20">
                          {quoteFormError}
                        </div>
                      ) : null}

                      {quoteFormSuccess ? (
                        <div className="mb-4 rounded-2xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100 ring-1 ring-emerald-300/20">
                          {quoteFormSuccess}
                        </div>
                      ) : null}

                      {quoteValidationMessage ? (
                        <div className="mb-4 rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/90 ring-1 ring-white/10">
                          {quoteValidationMessage}
                        </div>
                      ) : null}

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
                            Subtotal
                          </div>
                          <div className="mt-1 text-lg font-bold">
                            {formatCurrencyBRL(quoteSubtotalReais)}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
                            Desconto total
                          </div>
                          <div className="mt-1 text-lg font-bold">
                            {formatCurrencyBRL(quoteDiscountTotalReais)}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
                            Total
                          </div>
                          <div className="mt-1 text-lg font-bold">
                            {formatCurrencyBRL(quoteTotalReais)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={closeQuoteModalAndReset}
                          disabled={isGeneratingManualQuote}
                          className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                        >
                          Fechar
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void (isEditingQuote
                              ? generateEditedQuoteVersion()
                              : generateManualQuotePdf())
                          }
                          disabled={
                            isGeneratingManualQuote ||
                            (isEditingQuote ? !canGenerateQuotePdf : !canGenerateQuotePdf)
                          }
                          className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-white/15 disabled:cursor-not-allowed disabled:text-gray-400"
                        >
                          {isEditingQuote
                            ? isGeneratingManualQuote
                              ? "Gerando nova versao..."
                              : "Gerar nova versao"
                            : isGeneratingManualQuote
                              ? "Gerando..."
                              : "Gerar PDF"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex h-[620px] flex-col">
            <div
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto bg-[#f2f0ea] px-4 py-4 lg:px-5"
            >
              {!conversation ? (
                <div className="rounded-2xl bg-white p-4 text-sm text-gray-600 ring-1 ring-black/10">
                  Este lead ainda nao possui conversa criada.
                </div>
              ) : messages.length === 0 ? (
                <div className="rounded-2xl bg-white p-4 text-sm text-gray-600 ring-1 ring-black/10">
                  Nenhuma mensagem encontrada para esta conversa.
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((message) => (
                    <div key={message.id} className="flex w-full">
                      <div
                        className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${bubbleClass(
                          message
                        )}`}
                      >
                        {(() => {
                          const isCustomerLocationPhoto =
                            isCustomerLocationPhotoMessage(message);
                          const isCatalogProductPhoto =
                            isCatalogProductPhotoMessage(message);
                          const hasCatalogPreviewError =
                            imagePreviewErrors[message.id] === true;
                          const catalogMediaUrl = String(message.media_url || "").trim();
                          const attachmentKind = getAttachmentKind(message);
                          const inlinePrivateMediaKind = getInlinePrivateMediaKind(message);
                          const originalFileName = getOriginalFileName(message);
                          const mimeType = getMimeType(message);
                          const signedMedia = signedMediaByMessageId[message.id] || null;
                          const signedMediaError =
                            signedMediaErrorByMessageId[message.id] || null;
                          const isLoadingSignedMedia =
                            loadingSignedMediaByMessageId[message.id] === true;
                          const shouldRenderInlinePrivateImage =
                            inlinePrivateMediaKind === "image" && !isCatalogProductPhoto;
                          const shouldRenderInlinePrivateAudio =
                            inlinePrivateMediaKind === "audio";
                          const shouldRenderInlinePrivateVideo =
                            inlinePrivateMediaKind === "video";
                          const shouldRenderAttachmentCard =
                            isStoredAttachmentMessage(message) &&
                            !isCatalogProductPhoto &&
                            !shouldRenderInlinePrivateImage &&
                            !shouldRenderInlinePrivateAudio &&
                            !shouldRenderInlinePrivateVideo;

                          return (
                            <>
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide opacity-60">
                                {formatSender(message)}
                              </div>

                              <div className="whitespace-pre-wrap break-words leading-5">
                                {getMessageDisplayContent(message)}
                              </div>

                              {shouldRenderInlinePrivateImage ? (
                                <div className="mt-3 max-w-full">
                                  {signedMedia?.signedUrl ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void openSignedAttachment(
                                          message,
                                          "Erro ao abrir a imagem com seguranca."
                                        )
                                      }
                                      className="block max-w-full overflow-hidden rounded-xl"
                                    >
                                      <img
                                        src={signedMedia.signedUrl}
                                        alt={message.content || originalFileName || "Imagem"}
                                        className="block h-auto max-h-[320px] w-full max-w-[320px] rounded-xl object-cover ring-1 ring-black/10"
                                      />
                                    </button>
                                  ) : (
                                    <div className="rounded-xl bg-white/70 px-3 py-2 text-xs text-gray-700 ring-1 ring-black/10">
                                      {signedMediaError
                                        ? "Nao foi possivel carregar a imagem."
                                        : isLoadingSignedMedia
                                          ? "Carregando imagem..."
                                          : "Preparando imagem..."}
                                    </div>
                                  )}

                                  {(originalFileName || mimeType) && !signedMediaError ? (
                                    <div className="mt-2 space-y-1 text-[11px] opacity-70">
                                      {originalFileName ? (
                                        <div className="break-words">{originalFileName}</div>
                                      ) : null}
                                      {mimeType ? <div className="break-words">{mimeType}</div> : null}
                                    </div>
                                  ) : null}

                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void openSignedAttachment(
                                          message,
                                          "Erro ao abrir a imagem com seguranca."
                                        )
                                      }
                                      disabled={isLoadingSignedMedia}
                                      className="rounded-lg border border-current/20 px-3 py-1.5 text-xs font-semibold opacity-90 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {isLoadingSignedMedia ? "Abrindo..." : "Abrir foto"}
                                    </button>

                                    {signedMediaError ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void loadSignedMediaUrl(message, { forceRefresh: true }).catch(
                                            () => null
                                          )
                                        }
                                        disabled={isLoadingSignedMedia}
                                        className="rounded-lg border border-current/20 px-3 py-1.5 text-xs font-semibold opacity-90 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {isLoadingSignedMedia ? "Carregando..." : "Tentar novamente"}
                                      </button>
                                    ) : null}
                                  </div>

                                  {signedMediaError ? (
                                    <div className="mt-2 text-[11px] text-red-600">
                                      {signedMediaError}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              {shouldRenderAttachmentCard ? (
                                <div className="mt-2 rounded-xl bg-white/70 p-3 text-xs text-gray-900 ring-1 ring-black/10">
                                  <div className="font-semibold">
                                    {getStoredAttachmentLabel(attachmentKind)}
                                  </div>
                                  <div className="mt-1 break-words text-gray-600">
                                    {originalFileName || "Anexo salvo com seguranca"}
                                  </div>
                                  {mimeType ? (
                                    <div className="mt-1 break-words text-[11px] text-gray-500">
                                      {getFriendlyMimeTypeLabel(mimeType)}
                                    </div>
                                  ) : null}

                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {attachmentKind === "file" ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void openSignedAttachment(
                                            message,
                                            "Erro ao abrir o arquivo com seguranca."
                                          )
                                        }
                                        disabled={isLoadingSignedMedia}
                                        className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {isLoadingSignedMedia ? "Abrindo..." : "Abrir arquivo"}
                                      </button>
                                    ) : null}
                                  </div>

                                  {signedMediaError ? (
                                    <div className="mt-2 text-[11px] text-red-600">
                                      {signedMediaError}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              {shouldRenderInlinePrivateAudio ? (
                                <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs text-gray-900 ring-1 ring-black/10">
                                  <div className="font-semibold">Audio</div>
                                  <div className="mt-1 break-words text-gray-600">
                                    {originalFileName || "Audio salvo com seguranca"}
                                  </div>
                                  {mimeType ? (
                                    <div className="mt-1 break-words text-[11px] text-gray-500">
                                      {mimeType}
                                    </div>
                                  ) : null}

                                  <div className="mt-3">
                                    {signedMedia?.signedUrl ? (
                                      <audio
                                        controls
                                        preload="none"
                                        src={signedMedia.signedUrl}
                                        className="h-10 w-full max-w-[320px]"
                                      />
                                    ) : (
                                      <div className="rounded-xl bg-white px-3 py-2 text-[11px] text-gray-600 ring-1 ring-black/10">
                                        {signedMediaError
                                          ? "Nao foi possivel carregar o audio."
                                          : isLoadingSignedMedia
                                            ? "Carregando audio..."
                                            : "Preparando audio..."}
                                      </div>
                                    )}
                                  </div>

                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void openSignedAttachment(
                                          message,
                                          "Erro ao abrir o audio com seguranca."
                                        )
                                      }
                                      disabled={isLoadingSignedMedia}
                                      className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {isLoadingSignedMedia ? "Abrindo..." : "Abrir audio"}
                                    </button>

                                    {signedMediaError ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void loadSignedMediaUrl(message, { forceRefresh: true }).catch(
                                            () => null
                                          )
                                        }
                                        disabled={isLoadingSignedMedia}
                                        className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {isLoadingSignedMedia ? "Carregando..." : "Tentar novamente"}
                                      </button>
                                    ) : null}
                                  </div>

                                  {signedMediaError ? (
                                    <div className="mt-2 text-[11px] text-red-600">
                                      {signedMediaError}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              {shouldRenderInlinePrivateVideo ? (
                                <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs text-gray-900 ring-1 ring-black/10">
                                  <div className="font-semibold">Video</div>
                                  <div className="mt-1 break-words text-gray-600">
                                    {originalFileName || "Video salvo com seguranca"}
                                  </div>
                                  {mimeType ? (
                                    <div className="mt-1 break-words text-[11px] text-gray-500">
                                      {mimeType}
                                    </div>
                                  ) : null}

                                  <div className="mt-3 max-w-full">
                                    {signedMedia?.signedUrl ? (
                                      <video
                                        controls
                                        preload="metadata"
                                        src={signedMedia.signedUrl}
                                        className="block h-auto max-h-[240px] w-full max-w-[320px] rounded-xl ring-1 ring-black/10"
                                      />
                                    ) : (
                                      <div className="rounded-xl bg-white px-3 py-2 text-[11px] text-gray-600 ring-1 ring-black/10">
                                        {signedMediaError
                                          ? "Nao foi possivel carregar o video."
                                          : isLoadingSignedMedia
                                            ? "Carregando video..."
                                            : "Preparando video..."}
                                      </div>
                                    )}
                                  </div>

                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void openSignedAttachment(
                                          message,
                                          "Erro ao abrir o video com seguranca."
                                        )
                                      }
                                      disabled={isLoadingSignedMedia}
                                      className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {isLoadingSignedMedia ? "Abrindo..." : "Abrir video"}
                                    </button>

                                    {signedMediaError ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void loadSignedMediaUrl(message, { forceRefresh: true }).catch(
                                            () => null
                                          )
                                        }
                                        disabled={isLoadingSignedMedia}
                                        className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {isLoadingSignedMedia ? "Carregando..." : "Tentar novamente"}
                                      </button>
                                    ) : null}
                                  </div>

                                  {signedMediaError ? (
                                    <div className="mt-2 text-[11px] text-red-600">
                                      {signedMediaError}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              {isCatalogProductPhoto ? (
                                <div className="mt-3 max-w-full">
                                  {!hasCatalogPreviewError ? (
                                    <img
                                      src={catalogMediaUrl}
                                      alt={message.content || "Foto de catalogo"}
                                      onError={() => handleCatalogPreviewError(message.id)}
                                      className="block h-auto max-h-[220px] w-full max-w-[320px] rounded-xl object-cover ring-1 ring-black/10"
                                    />
                                  ) : (
                                    <div className="rounded-xl bg-black/5 px-3 py-2 text-xs text-gray-700 ring-1 ring-black/10">
                                      Nao foi possivel carregar a previa da foto.
                                    </div>
                                  )}
                                </div>
                              ) : null}

                              {getMessageSecondaryContent(message) ? (
                                <div className="mt-2 whitespace-pre-wrap break-words text-xs opacity-80">
                                  {getMessageSecondaryContent(message)}
                                </div>
                              ) : null}

                              {isCustomerLocationPhoto && !shouldRenderInlinePrivateImage ? (
                                <div className="mt-3">
                                  <button
                                    type="button"
                                    onClick={() => void openCustomerLocationPhoto(message)}
                                    disabled={isLoadingSignedMedia}
                                    className="rounded-lg border border-current/20 px-3 py-1.5 text-xs font-semibold opacity-90 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {isLoadingSignedMedia ? "Abrindo..." : "Ver foto"}
                                  </button>
                                </div>
                              ) : null}

                              {isCatalogProductPhoto ? (
                                <div className="mt-3">
                                  <button
                                    type="button"
                                    onClick={() => openCatalogProductPhoto(message.media_url)}
                                    className="rounded-lg border border-current/20 px-3 py-1.5 text-xs font-semibold opacity-90 transition hover:opacity-100"
                                  >
                                    Abrir foto
                                  </button>
                                </div>
                              ) : null}

                              <div className="mt-1.5 text-right text-[11px] opacity-60">
                                {formatMessageTime(message.created_at)}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div ref={messagesEndRef} aria-hidden="true" />
            </div>

            <div className="border-t border-gray-100 bg-white px-4 py-3 lg:px-5">
              <input
                ref={documentInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/jpg,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav,audio/x-wav,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                onChange={(event) => handleManualAttachmentInputChange(event)}
                className="hidden"
              />
              {manualPendingAttachment ? (
                <div className="mb-3 rounded-2xl bg-gray-50 p-3 ring-1 ring-black/5">
                  <div className="flex flex-wrap items-center gap-3">
                    {manualPendingAttachment.previewUrl ? (
                      <img
                        src={manualPendingAttachment.previewUrl}
                        alt={manualPendingAttachment.fileName}
                        className="h-16 w-16 rounded-xl object-cover ring-1 ring-black/10"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-white text-xs font-bold text-gray-500 ring-1 ring-black/10">
                        ANEXO
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="break-words text-sm font-semibold text-gray-900">
                        {manualPendingAttachment.fileName}
                      </div>
                      <div className="mt-1 break-words text-xs text-gray-500">
                        {formatFileSize(manualPendingAttachment.size)}
                        {manualPendingAttachment.mimeType
                          ? ` • ${manualPendingAttachment.mimeType}`
                          : ""}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={cancelPendingManualAttachment}
                      disabled={working || uploadingManualAttachment}
                      className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => documentInputRef.current?.click()}
                  disabled={!conversation || working || uploadingManualAttachment}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-gray-900 ring-1 ring-black/10 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Anexar arquivo"
                  title="Anexar arquivo"
                >
                  <PaperclipComposerIcon />
                </button>

                <input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  disabled={working || simulatingCustomer || uploadingManualAttachment || !conversation}
                  className="h-11 flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 text-sm outline-none focus:border-black disabled:cursor-not-allowed disabled:bg-gray-100"
                  placeholder={
                    conversation
                      ? "Mensagem"
                      : "Este lead ainda nao possui conversa disponivel."
                  }
                />

                <button
                  type="button"
                  onClick={() =>
                    recordingAudio
                      ? stopManualAudioRecording()
                      : void startManualAudioRecording()
                  }
                  disabled={!conversation || working || uploadingManualAttachment}
                  className={`flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-3 text-sm font-semibold ring-1 ring-black/10 transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    recordingAudio
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "bg-white text-gray-900 hover:bg-gray-50"
                  }`}
                  aria-label={recordingAudio ? "Parar gravacao" : "Gravar audio"}
                  title={recordingAudio ? "Parar gravacao" : "Gravar audio"}
                >
                  {recordingAudio ? (
                    <>
                      <StopRecordingComposerIcon />
                      <span>{formatRecordingDuration(recordingAudioSeconds)}</span>
                    </>
                  ) : (
                    <MicrophoneComposerIcon />
                  )}
                </button>

                <button
                  onClick={() => void sendMessage()}
                  disabled={!canSendMessage}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-700 text-white shadow-sm transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Enviar mensagem"
                  title="Enviar mensagem"
                >
                  {working || uploadingManualAttachment ? "..." : <SendComposerIcon />}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Area de testes
              </div>
              <h2 className="mt-1 text-base font-bold text-gray-900">
                Simular mensagem do cliente
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                Bloco temporario para testes do Pilar 10. No produto final, esta area deve sair da tela da loja.
              </p>
            </div>
          </div>

          <input
            ref={customerAttachmentInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/jpg,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav,audio/x-wav,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              if (!file) {
                event.target.value = "";
                return;
              }

              handleAttachmentInputChange(
                event,
                customerAttachmentPurpose,
                inferCustomerAttachmentKind(file)
              );
            }}
            className="hidden"
          />

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px]">
            <input
              value={simulatedCustomerMessage}
              onChange={(event) => setSimulatedCustomerMessage(event.target.value)}
              onKeyDown={handleSimulatedCustomerKeyDown}
              disabled={
                !conversation ||
                simulatingCustomer ||
                uploadingCustomerAttachment ||
                simulatedRecordingAudio
              }
              className="h-11 rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm outline-none focus:border-black disabled:cursor-not-allowed disabled:bg-gray-100"
              placeholder="Digite como se fosse o cliente"
            />

            <select
              value={customerAttachmentPurpose}
              onChange={(event) => setCustomerAttachmentPurpose(event.target.value)}
              disabled={
                !conversation ||
                simulatingCustomer ||
                uploadingCustomerAttachment ||
                simulatedRecordingAudio
              }
              className="h-11 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-black disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              <option value="customer_location_photo">Foto do local</option>
              <option value="customer_product_or_pool_photo">Foto de produto/piscina</option>
              <option value="payment_proof">Comprovante de pagamento</option>
              <option value="conversation_or_document_screenshot">Print/documento</option>
              <option value="unknown">Outro anexo</option>
            </select>
          </div>

          {simulatedPendingAttachment ? (
            <div className="mt-3 rounded-2xl bg-gray-50 p-3 ring-1 ring-black/5">
              <div className="flex flex-wrap items-center gap-3">
                {simulatedPendingAttachment.previewUrl ? (
                  <img
                    src={simulatedPendingAttachment.previewUrl}
                    alt={simulatedPendingAttachment.fileName}
                    className="h-14 w-14 rounded-xl object-cover ring-1 ring-black/10"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white text-xs font-bold text-gray-500 ring-1 ring-black/10">
                    ANEXO
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm font-semibold text-gray-900">
                    {simulatedPendingAttachment.fileName}
                  </div>
                  <div className="mt-1 break-words text-xs text-gray-500">
                    {formatFileSize(simulatedPendingAttachment.size)}
                    {simulatedPendingAttachment.mimeType
                      ? ` • ${simulatedPendingAttachment.mimeType}`
                      : ""}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={cancelPendingCustomerAttachment}
                  disabled={simulatingCustomer || uploadingCustomerAttachment}
                  className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() =>
                simulatedRecordingAudio
                  ? stopSimulatedCustomerAudioRecording()
                  : void startSimulatedCustomerAudioRecording()
              }
              disabled={!conversation || simulatingCustomer || uploadingCustomerAttachment}
              className={`flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold ring-1 ring-black/10 transition disabled:cursor-not-allowed disabled:opacity-50 ${
                simulatedRecordingAudio
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-white text-gray-900 hover:bg-gray-50"
              }`}
              aria-label={
                simulatedRecordingAudio
                  ? "Parar gravacao do cliente"
                  : "Gravar audio como cliente"
              }
              title={
                simulatedRecordingAudio
                  ? "Parar gravacao do cliente"
                  : "Gravar audio como cliente"
              }
            >
              {simulatedRecordingAudio ? (
                <>
                  <StopRecordingComposerIcon />
                  <span>{formatRecordingDuration(simulatedRecordingAudioSeconds)}</span>
                </>
              ) : (
                <MicrophoneComposerIcon />
              )}
            </button>

            <button
              type="button"
              onClick={() => customerAttachmentInputRef.current?.click()}
              disabled={!canSimulateCustomerAttachment}
              className="rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Anexar como cliente
            </button>

            <button
              type="button"
              onClick={() => void submitSimulatedCustomerComposer()}
              disabled={!canSimulateCustomerMessage}
              className="rounded-xl bg-black px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {simulatingCustomer || uploadingCustomerAttachment ? "Enviando..." : "Simular cliente"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
