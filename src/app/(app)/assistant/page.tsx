"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useStoreContext } from "@/components/StoreProvider";
import ResponsibleExternalNotificationsPanel from "@/components/assistant/ResponsibleExternalNotificationsPanel";
import { countActiveAssistantPendingActions } from "@/lib/assistant/active-pending-actions";

type AssistantThreadSummary = {
  thread_id: string;
  status: string | null;
  title: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  total_messages: number | null;
  pending_notifications: number | null;
};

type AssistantMessage = {
  id: string;
  thread_id: string;
  sender: string;
  sender_role: string;
  direction: string;
  message_type: string;
  content: string;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  related_appointment_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type AssistantReplyApiResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  aiText?: string;
};

type AssistantDocumentActionId =
  | "review"
  | "approve_and_send"
  | "confirm_store_signature";

type AssistantDocumentActionApiResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  signedUrl?: string;
  action?: AssistantDocumentActionId;
  documentType?: "quote" | "contract";
  documentId?: string;
};

type AssistantContractWorkflowActionId = "generate_contract";

type AssistantContractWorkflowActionApiResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  action?: AssistantContractWorkflowActionId;
  messageId?: string;
};

type AssistantDocumentActionMetadata = {
  id?: string;
  label?: string;
  kind?: string;
  requires_confirmation?: boolean;
};

type AssistantDocumentReviewMetadata = {
  kind?: string;
  document_type?: "quote" | "contract";
  document_id?: string;
  document_version_id?: string;
  document_number?: string;
  document_status?: string;
  related_quote_id?: string | null;
  related_contract_id?: string | null;
  related_lead_id?: string | null;
  related_conversation_id?: string | null;
  customer_name?: string;
  customer_phone?: string;
  storage_bucket?: string;
  storage_path?: string;
  file_kind?: string;
  mime_type?: string;
  original_file_name?: string;
  assistant_prompt?: string;
  available_actions?: AssistantDocumentActionMetadata[];
  source?: string;
};

type AssistantContractWorkflowDecisionMetadata = {
  kind?: string;
  organization_id?: string;
  store_id?: string;
  lead_id?: string | null;
  conversation_id?: string | null;
  quote_id?: string;
  quote_number?: string | null;
  customer_name?: string | null;
  trigger?: string;
  source?: string;
  decision?: {
    allowed?: boolean;
    needs_human_confirmation?: boolean;
    reason_code?: string;
    reason_message?: string;
    missing_requirements?: string[];
    warnings?: string[];
    recommended_next_action?: string;
  } | null;
  available_actions?: Array<
    | string
    | {
        id?: string;
        action?: string;
        type?: string;
        label?: string;
        kind?: string;
        requires_confirmation?: boolean;
      }
  >;
  customer_context_summary?: {
    customerName?: string;
    customerPhone?: string;
    quoteNumber?: string;
    quoteStatusLabel?: string;
    quoteTotalLabel?: string;
    quoteApprovedAt?: string;
    quoteSentAt?: string;
    contractNumber?: string;
    contractStatusLabel?: string;
    contractSentAt?: string;
    contractCustomerSignedAt?: string;
    contractCompletedAt?: string;
    latestCustomerMessage?: string;
    technicalVisitStatusLabel?: string;
    technicalVisitDate?: string;
    happened?: string[];
    suggestedNextAction?: string;
  } | null;
};

type AssistantCustomerContextReportMetadata = {
  kind?: string;
  title?: string;
  subtitle?: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  source_label?: string | null;
  main_interest?: string | null;
  customer_goal?: string | null;
  conversation_highlights?: string[] | null;
  quote_number?: string | null;
  quote_status_label?: string | null;
  quote_total_label?: string | null;
  contract_number?: string | null;
  contract_status_label?: string | null;
  technical_visit_label?: string | null;
  current_status_label?: string | null;
  suggested_next_action?: string | null;
  narrative?: string | null;
};

type DocumentFeedbackTone = "success" | "error";

const ASSISTANT_PAGE_MESSAGE_LIMIT = 50;
const TERMINAL_DOCUMENT_STATUSES = new Set([
  "completed",
  "cancelled",
  "expired",
  "failed",
]);

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function formatTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function compareAssistantMessages(left: AssistantMessage, right: AssistantMessage) {
  const leftTime = Date.parse(left.created_at || "");
  const rightTime = Date.parse(right.created_at || "");
  const safeLeftTime = Number.isFinite(leftTime) ? leftTime : 0;
  const safeRightTime = Number.isFinite(rightTime) ? rightTime : 0;

  if (safeLeftTime !== safeRightTime) {
    return safeLeftTime - safeRightTime;
  }

  return left.id.localeCompare(right.id);
}

function mergeAssistantMessages(
  current: AssistantMessage[],
  incoming: AssistantMessage[]
) {
  const byId = new Map<string, AssistantMessage>();

  current.forEach((message) => {
    byId.set(message.id, message);
  });

  incoming.forEach((message) => {
    byId.set(message.id, message);
  });

  return [...byId.values()].sort(compareAssistantMessages);
}

function formatDayDivider(value: string | null) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem data";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toDayKey(value: string | null) {
  if (!value) return "sem-data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem-data";
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function shortId(value: string | null | undefined) {
  if (!value) return "-";
  return value.slice(0, 8);
}

function formatMessageType(value: string | null | undefined) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "report_morning") return "Relatório da manhã";
  if (normalized === "report_evening") return "Relatório do fim do dia";
  if (normalized === "alert") return "Aviso";
  if (normalized === "context") return "Contexto";
  if (normalized === "followup_summary") return "Resumo de follow-up";
  return "Mensagem";
}

function senderLabel(message: AssistantMessage) {
  if (message.sender_role === "assistant_operational") return "Assistente";
  if (message.sender_role === "store_responsible") return "Responsável";
  return "Sistema";
}

function isAssistantBubble(message: AssistantMessage) {
  return message.sender_role === "assistant_operational";
}

function bubbleWrapperClass(message: AssistantMessage) {
  if (isAssistantBubble(message)) return "justify-start";
  if (message.sender_role === "store_responsible") return "justify-end";
  return "justify-center";
}

function bubbleClass(message: AssistantMessage) {
  if (isAssistantBubble(message)) {
    return "bg-white text-gray-900 ring-1 ring-black/10 rounded-2xl rounded-bl-md";
  }

  if (message.sender_role === "store_responsible") {
    return "bg-[#f3f3f3] text-gray-900 ring-1 ring-black/10 rounded-2xl rounded-br-md";
  }

  return "bg-[#f7f7f7] text-gray-800 ring-1 ring-black/8 rounded-2xl";
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAttachmentKind(file: File | null) {
  if (!file) return "Arquivo";
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  if (type.startsWith("image/")) return "Imagem";
  if (type.startsWith("audio/")) return "Áudio";
  if (type.startsWith("video/")) return "Vídeo";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  return "Documento";
}

function getSafeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuidLike(value: string | null | undefined) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getAssistantDocumentReviewMetadata(
  metadata: Record<string, unknown> | null | undefined
): AssistantDocumentReviewMetadata | null {
  if (!isRecord(metadata)) return null;
  if (getSafeString(metadata.kind) !== "document_review") return null;
  return metadata as AssistantDocumentReviewMetadata;
}

function getAssistantContractWorkflowDecisionMetadata(
  metadata: Record<string, unknown> | null | undefined
): AssistantContractWorkflowDecisionMetadata | null {
  if (!isRecord(metadata)) return null;
  if (getSafeString(metadata.kind) !== "contract_workflow_decision") return null;
  return metadata as AssistantContractWorkflowDecisionMetadata;
}

function getAssistantCustomerContextReportMetadata(
  metadata: Record<string, unknown> | null | undefined
): AssistantCustomerContextReportMetadata | null {
  if (!isRecord(metadata)) return null;
  if (getSafeString(metadata.kind) !== "customer_context_report") return null;
  return metadata as AssistantCustomerContextReportMetadata;
}

function getDocumentTypeLabel(value: string | null | undefined) {
  return normalizeText(value) === "contract" ? "Contrato" : "Orcamento";
}

function formatDocumentStatus(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return "Nao informado";
  if (normalized === "pending_review") return "Pendente de revisao";
  if (normalized === "approved") return "Aprovado";
  if (normalized === "sent" || normalized === "sent_to_customer") return "Enviado";
  if (normalized === "draft") return "Rascunho";
  if (normalized === "completed") return "Concluido";
  if (normalized === "cancelled") return "Cancelado";
  if (normalized === "expired") return "Expirado";
  if (normalized === "failed") return "Falhou";
  return value ? String(value) : "Nao informado";
}

function getDocumentActionMetadata(
  metadata: AssistantDocumentReviewMetadata,
  actionId: AssistantDocumentActionId
) {
  const available = Array.isArray(metadata.available_actions)
    ? metadata.available_actions
    : [];

  return (
    available.find((item) => {
      const id = getSafeString(item?.id);
      const kind = getSafeString(item?.kind);

      if (actionId === "review") {
        return id === "review" || kind === "open_document";
      }

      if (actionId === "approve_and_send") {
        return id === "approve_and_send" || kind === "approve_and_send";
      }

      return (
        id === "confirm_store_signature" || kind === "confirm_store_signature"
      );
    }) || null
  );
}

function getDocumentActionLabel(
  metadata: AssistantDocumentReviewMetadata,
  actionId: AssistantDocumentActionId
) {
  const action = getDocumentActionMetadata(metadata, actionId);
  const fallback =
    actionId === "review"
      ? "Revisar"
      : actionId === "approve_and_send"
        ? "Aprovar e enviar"
        : "Confirmar pela loja";
  return getSafeString(action?.label) || fallback;
}

function isDocumentActionEnabled(
  metadata: AssistantDocumentReviewMetadata,
  actionId: AssistantDocumentActionId
) {
  return Boolean(getDocumentActionMetadata(metadata, actionId));
}

function hasCompleteDocumentReviewMetadata(metadata: AssistantDocumentReviewMetadata | null) {
  if (!metadata) return false;
  const documentType = normalizeText(metadata.document_type);
  const documentId = getSafeString(metadata.document_id);
  return (
    (documentType === "quote" || documentType === "contract") &&
    isUuidLike(documentId)
  );
}

function isTerminalDocumentStatus(value: string | null | undefined) {
  return TERMINAL_DOCUMENT_STATUSES.has(normalizeText(value));
}

function getValidatedDocumentActionPayload(
  metadata: AssistantDocumentReviewMetadata | null
) {
  const documentType = normalizeText(metadata?.document_type);
  const documentId = getSafeString(metadata?.document_id);
  const validType = documentType === "quote" || documentType === "contract";
  const validDocumentId = isUuidLike(documentId);

  return {
    documentType: validType ? (documentType as "quote" | "contract") : null,
    documentId: validDocumentId ? documentId : null,
    isValid: validType && validDocumentId,
  };
}

function getDocumentPromptText(metadata: AssistantDocumentReviewMetadata | null) {
  const customPrompt = getSafeString(metadata?.assistant_prompt);
  if (customPrompt) return customPrompt;

  const status = normalizeText(metadata?.document_status);

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

  return "Esse documento pode ser enviado ou precisa ser editado? Caso precise ser editado, me diga o que precisa que eu edito.";
}

function getContractWorkflowTriggerLabel(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (normalized === "customer_requested_contract") return "Cliente pediu contrato";
  if (normalized === "customer_accepted_quote") return "Cliente aceitou o orcamento";
  if (normalized === "crm_closing_stage") return "Lead entrou em fechamento";
  if (normalized === "post_visit_human_confirmed") {
    return "Visita tecnica confirmou fechamento";
  }
  if (normalized === "system_suggestion") return "Sistema identificou possivel fechamento";
  if (normalized === "human_explicit_request") return "Responsavel pediu geracao do contrato";
  return "Possivel fechamento";
}

function getContractWorkflowDecisionStatusLabel(
  metadata: AssistantContractWorkflowDecisionMetadata | null
) {
  const decision = metadata?.decision || null;
  if (decision?.needs_human_confirmation === true) {
    return "Precisa de confirmação humana";
  }
  if (decision?.allowed === true) {
    return "Pode gerar contrato";
  }
  return "Ainda não pode gerar contrato";
}

function getContractWorkflowActionKey(
  action:
    | string
    | {
        id?: string;
        action?: string;
        type?: string;
        label?: string;
        kind?: string;
      }
    | null
    | undefined
) {
  if (typeof action === "string") {
    return normalizeText(action);
  }

  return normalizeText(action?.id || action?.action || action?.type || action?.kind);
}

function getContractWorkflowActionLabel(
  action:
    | string
    | {
        id?: string;
        action?: string;
        type?: string;
        label?: string;
        kind?: string;
      }
    | null
    | undefined
) {
  const explicitLabel =
    typeof action === "string" ? "" : getSafeString(action?.label);
  if (explicitLabel) return explicitLabel;

  const key = getContractWorkflowActionKey(action);
  if (key === "generate_contract") return "Gerar contrato";
  if (key === "not_closed_yet") return "Ainda não fechou";
  if (key === "adjust_quote") return "Ajustar orçamento";
  if (key === "remind_later") return "Me lembrar depois";
  return "Ação";
}

function findAddressTextInMetadata(value: unknown, depth = 0): string | null {
  if (!value || depth > 4) return null;

  if (typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const addressKeys = [
    "addressText",
    "address_text",
    "address",
    "endereco",
    "endereço",
    "locationText",
    "location_text",
    "location",
    "appointmentAddress",
    "appointment_address",
    "customerAddress",
    "customer_address",
    "destination",
    "destinationText",
    "destination_text",
  ];

  for (const key of addressKeys) {
    const candidate = getSafeString(record[key]);
    if (candidate) return candidate;
  }

  for (const nestedValue of Object.values(record)) {
    if (!nestedValue || typeof nestedValue !== "object") continue;

    if (Array.isArray(nestedValue)) {
      for (const item of nestedValue) {
        const found = findAddressTextInMetadata(item, depth + 1);
        if (found) return found;
      }
      continue;
    }

    const found = findAddressTextInMetadata(nestedValue, depth + 1);
    if (found) return found;
  }

  return null;
}

function cleanRouteAddressCandidate(value: string) {
  return String(value || "")
    .replace(/^[\s:：,.;-]+/, "")
    .replace(/[\s.。]+$/, "")
    .trim();
}

function looksLikeUsefulRouteAddress(value: string) {
  const normalized = cleanRouteAddressCandidate(value);

  if (normalized.length < 8) return false;

  const hasAddressSignal =
    /\b(rua|r\.|avenida|av\.|estrada|rodovia|travessa|alameda|praça|praca|bairro|cep|sp|são paulo|sao paulo)\b/i.test(
      normalized
    );
  const hasNumberOrCep = /\d/.test(normalized) || /\b\d{5}-?\d{3}\b/.test(normalized);

  return hasAddressSignal && hasNumberOrCep;
}

function extractRouteAddressFromMessageContent(content: string | null | undefined) {
  const text = String(content || "").replace(/\s+/g, " ").trim();

  if (!text) return null;

  const patterns = [
    /(?:no|na|com|o)?\s*endere[cç]o\s*:?[\s-]+(.+?)(?=\s+(?:O objetivo|Objetivo|Quer|Deseja|Não há|Nao ha|Não tem|Nao tem|$))/i,
    /(?:rua|r\.|avenida|av\.|estrada|rodovia|travessa|alameda|praça|praca)\s+.+?(?=\s+(?:O objetivo|Objetivo|Quer|Deseja|Não há|Nao ha|Não tem|Nao tem|$))/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = cleanRouteAddressCandidate(match?.[1] || match?.[0] || "");

    if (looksLikeUsefulRouteAddress(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getAssistantMessageRouteAddress(message: AssistantMessage) {
  return (
    findAddressTextInMetadata(message.metadata) ||
    extractRouteAddressFromMessageContent(message.content)
  );
}

function shouldShowRouteButton(message: AssistantMessage) {
  return Boolean(message.related_appointment_id || getAssistantMessageRouteAddress(message));
}

function buildGoogleMapsRouteUrl(addressText: string | null | undefined) {
  const safeAddress = String(addressText || "").trim();

  if (!safeAddress) return null;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    safeAddress
  )}`;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchesSearch(message: AssistantMessage, query: string) {
  const q = normalizeText(query);
  if (!q) return true;

  const haystack = [
    message.content,
    senderLabel(message),
    formatMessageType(message.message_type),
    formatDateTime(message.created_at),
  ]
    .map((item) => normalizeText(item))
    .join(" \n ");

  return haystack.includes(q);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlightedText(text: string, query: string) {
  if (!query.trim()) return text;

  const safeQuery = escapeRegExp(query.trim());
  if (!safeQuery) return text;

  const parts = text.split(new RegExp(`(${safeQuery})`, "ig"));

  return parts.map((part, index) => {
    const isMatch = part.toLowerCase() === query.trim().toLowerCase();
    if (!isMatch) return <span key={index}>{part}</span>;

    return (
      <mark key={index} className="rounded bg-black px-1 py-0.5 text-white">
        {part}
      </mark>
    );
  });
}

export default function AssistantPage() {
  const {
    loading: storeLoading,
    organizationId,
    activeStoreId,
  } = useStoreContext();

  const [summary, setSummary] = useState<AssistantThreadSummary | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingErrorText, setRecordingErrorText] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [documentActionLoadingKeys, setDocumentActionLoadingKeys] = useState<Record<string, boolean>>({});
  const [documentActionFeedback, setDocumentActionFeedback] = useState<
    Record<string, { tone: DocumentFeedbackTone; text: string }>
  >({});
  const [dismissedApproveActionsByMessage, setDismissedApproveActionsByMessage] = useState<
    Record<string, boolean>
  >({});
  const [dismissedStoreSignatureActionsByMessage, setDismissedStoreSignatureActionsByMessage] =
    useState<Record<string, boolean>>({});
  const [contractWorkflowActionLoadingKeys, setContractWorkflowActionLoadingKeys] = useState<
    Record<string, boolean>
  >({});
  const [contractWorkflowActionFeedback, setContractWorkflowActionFeedback] = useState<
    Record<string, { tone: DocumentFeedbackTone; text: string }>
  >({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const firstLoadDoneRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(false);
  const lastMessageCountRef = useRef(0);
  const markedNotificationsSeenKeyRef = useRef<string | null>(null);
  const messagesRef = useRef<AssistantMessage[]>([]);
  const initialMessagesLoadedRef = useRef(false);
  const reachedConversationStartRef = useRef(false);
  const prependScrollRestoreRef = useRef<{ previousScrollHeight: number; previousScrollTop: number } | null>(
    null
  );
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const canLoad = useMemo(() => {
    return !storeLoading && !!organizationId && !!activeStoreId;
  }, [storeLoading, organizationId, activeStoreId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    window.requestAnimationFrame(() => {
      const node = chatScrollRef.current;
      if (!node) return;

      // Importante: rola somente a caixa interna do chat.
      // Não usamos scrollIntoView aqui, porque ele pode mover a página inteira da Assistente.
      node.scrollTo({
        top: node.scrollHeight,
        behavior,
      });
    });
  }, []);

  const loadAssistant = useCallback(
    async (options?: { silent?: boolean; reset?: boolean }) => {
      if (!canLoad || !organizationId || !activeStoreId) return;

      const silent = options?.silent ?? false;
      const reset = options?.reset ?? false;
      if (silent) setRefreshing(true);
      else setLoading(true);

      setErrorText(null);

      const currentMessages = messagesRef.current;
      const lastLoadedMessage =
        !reset && initialMessagesLoadedRef.current && currentMessages.length > 0
          ? currentMessages[currentMessages.length - 1]
          : null;

      const [{ data: summaryData, error: summaryError }, { data: messagesData, error: messagesError }] =
        await Promise.all([
          supabase.rpc("assistant_get_thread_summary", {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
          }),
          lastLoadedMessage
            ? supabase.rpc("assistant_list_messages_paginated", {
                p_organization_id: organizationId,
                p_store_id: activeStoreId,
                p_limit: ASSISTANT_PAGE_MESSAGE_LIMIT,
                p_after_created_at: lastLoadedMessage.created_at,
                p_after_id: lastLoadedMessage.id,
              })
            : supabase.rpc("assistant_list_messages_paginated", {
                p_organization_id: organizationId,
                p_store_id: activeStoreId,
                p_limit: ASSISTANT_PAGE_MESSAGE_LIMIT,
              }),
        ]);

      if (summaryError) {
        setErrorText(summaryError.message || "Erro ao carregar resumo da assistente.");
        if (silent) setRefreshing(false);
        else setLoading(false);
        return;
      }

      if (messagesError) {
        setErrorText(messagesError.message || "Erro ao carregar mensagens da assistente.");
        if (silent) setRefreshing(false);
        else setLoading(false);
        return;
      }

      const summaryRow = Array.isArray(summaryData)
        ? ((summaryData[0] || null) as AssistantThreadSummary | null)
        : ((summaryData || null) as AssistantThreadSummary | null);
      const nextMessages = Array.isArray(messagesData)
        ? (messagesData as AssistantMessage[])
        : [];
      const totalMessages = Number(summaryRow?.total_messages || 0);

      setSummary(summaryRow);

      if (lastLoadedMessage) {
        if (nextMessages.length > 0) {
          setMessages((current) => mergeAssistantMessages(current, nextMessages));
        }
      } else {
        setMessages(mergeAssistantMessages([], nextMessages));
        initialMessagesLoadedRef.current = true;
        reachedConversationStartRef.current = totalMessages <= nextMessages.length;
      }

      if (silent) setRefreshing(false);
      else setLoading(false);
    },
    [canLoad, organizationId, activeStoreId]
  );

  const markNotificationsSeen = useCallback(async () => {
    if (!canLoad || !organizationId || !activeStoreId) return;

    const seenKey = `${organizationId}:${activeStoreId}`;
    if (markedNotificationsSeenKeyRef.current === seenKey) return;

    const { error } = await supabase.rpc("assistant_mark_notifications_seen", {
      p_organization_id: organizationId,
      p_store_id: activeStoreId,
    });

    if (error) {
      console.warn("[AssistantPage] assistant_mark_notifications_seen error:", error);
      return;
    }

    markedNotificationsSeenKeyRef.current = seenKey;
    await loadAssistant({ silent: true });
  }, [canLoad, organizationId, activeStoreId, loadAssistant]);

  useEffect(() => {
    if (!canLoad) return;
    initialMessagesLoadedRef.current = false;
    reachedConversationStartRef.current = false;
    prependScrollRestoreRef.current = null;
    firstLoadDoneRef.current = false;
    lastMessageCountRef.current = 0;
    shouldStickToBottomRef.current = true;
    forceScrollToBottomRef.current = false;
    void loadAssistant({ reset: true });
  }, [canLoad, loadAssistant]);

  useEffect(() => {
    if (!canLoad) return;

    const timeout = window.setTimeout(() => {
      void markNotificationsSeen();
    }, 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [canLoad, markNotificationsSeen]);

  useEffect(() => {
    if (!canLoad) return;

    const interval = window.setInterval(() => {
      void loadAssistant({ silent: true });
    }, 10000);

    return () => window.clearInterval(interval);
  }, [canLoad, loadAssistant]);

  useEffect(() => {
    if (loading || searchOpen) return;

    const hasNewMessages = messages.length > lastMessageCountRef.current;
    const prependRestore = prependScrollRestoreRef.current;

    if (prependRestore && chatScrollRef.current) {
      window.requestAnimationFrame(() => {
        const node = chatScrollRef.current;
        if (!node) return;

        const nextScrollTop =
          prependRestore.previousScrollTop +
          (node.scrollHeight - prependRestore.previousScrollHeight);

        node.scrollTop = nextScrollTop;
        prependScrollRestoreRef.current = null;
        firstLoadDoneRef.current = true;
        lastMessageCountRef.current = messages.length;
      });
      return;
    }

    const shouldAutoScroll =
      !firstLoadDoneRef.current ||
      forceScrollToBottomRef.current ||
      (hasNewMessages && shouldStickToBottomRef.current);

    window.requestAnimationFrame(() => {
      if (!chatScrollRef.current || !shouldAutoScroll) {
        firstLoadDoneRef.current = true;
        lastMessageCountRef.current = messages.length;
        return;
      }

      scrollChatToBottom(firstLoadDoneRef.current ? "smooth" : "auto");

      forceScrollToBottomRef.current = false;
      shouldStickToBottomRef.current = true;
      firstLoadDoneRef.current = true;
      lastMessageCountRef.current = messages.length;
    });
  }, [messages, loading, searchOpen, scrollChatToBottom]);

  useEffect(() => {
    if (!searchOpen) return;
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [searchOpen]);

  const handleChatScroll = useCallback(() => {
    const node = chatScrollRef.current;
    if (!node) return;

    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom <= 80;
  }, []);

  function clearPendingAttachment() {
    setPendingAttachment(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function startAudioRecording() {
    setRecordingErrorText(null);

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setRecordingErrorText("Este navegador não liberou gravação de áudio.");
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setRecordingErrorText("A gravação de áudio não está disponível neste navegador.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      recordedChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const extension = mimeType.includes("mp4") ? "m4a" : "webm";
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const file = new File([blob], `audio-assistente-${Date.now()}.${extension}`, {
          type: mimeType,
        });

        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        recordedChunksRef.current = [];
        setPendingAttachment(file);
        setRecording(false);
      };

      recorder.start();
      setRecording(true);
    } catch (error: any) {
      setRecordingErrorText(error?.message || "Não foi possível iniciar a gravação de áudio.");
      setRecording(false);
    }
  }

  function stopAudioRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      setRecording(false);
      return;
    }

    if (recorder.state !== "inactive") {
      recorder.stop();
    } else {
      setRecording(false);
    }
  }

  async function sendMessageToAssistant() {
    const text = newMessage.trim();

    if (!text && !pendingAttachment) return;

    if (pendingAttachment) {
      setErrorText("A interface de anexos já está preparada, mas o envio real de arquivos ainda precisa ser conectado ao backend da Assistente.");
      return;
    }
    if (!organizationId || !activeStoreId) {
      setErrorText("Organização ou loja ativa não carregada.");
      return;
    }

    setSending(true);
    setErrorText(null);
    setStatusText(null);

    const { error } = await supabase.rpc("assistant_send_human_message", {
      p_organization_id: organizationId,
      p_store_id: activeStoreId,
      p_content: text,
    });

    if (error) {
      setErrorText(error.message || "Erro ao enviar mensagem para a assistente.");
      setSending(false);
      return;
    }

    setNewMessage("");
    forceScrollToBottomRef.current = true;
    setStatusText("Mensagem enviada. Gerando resposta da assistente...");
    await loadAssistant({ silent: true });
    scrollChatToBottom("smooth");

    try {
      const response = await fetch("/api/assistant/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId,
          storeId: activeStoreId,
        }),
      });

      const result = (await response.json()) as AssistantReplyApiResponse;

      if (!response.ok || !result.ok) {
        setErrorText(result.message || result.error || "Erro ao gerar resposta da assistente.");
        setSending(false);
        await loadAssistant({ silent: true });
        return;
      }

      setStatusText("Assistente respondeu com sucesso.");
      setSending(false);
      forceScrollToBottomRef.current = true;
      await loadAssistant({ silent: true });
      scrollChatToBottom("smooth");
    } catch (error: any) {
      setErrorText(error?.message || "Erro inesperado ao gerar resposta da assistente.");
      setSending(false);
      forceScrollToBottomRef.current = true;
      await loadAssistant({ silent: true });
      scrollChatToBottom("smooth");
    }
  }

  const groupedMessages = useMemo(() => {
    const groups: Array<{ dayKey: string; dayLabel: string; items: AssistantMessage[] }> = [];

    messages.forEach((message) => {
      const dayKey = toDayKey(message.created_at);
      const existing = groups[groups.length - 1];
      if (!existing || existing.dayKey !== dayKey) {
        groups.push({ dayKey, dayLabel: formatDayDivider(message.created_at), items: [message] });
        return;
      }
      existing.items.push(message);
    });

    return groups;
  }, [messages]);

  const searchResults = useMemo(() => {
    const trimmed = searchText.trim();
    if (!trimmed) return [] as Array<{ dayKey: string; dayLabel: string; items: AssistantMessage[] }>;

    const filtered = messages.filter((message) => matchesSearch(message, trimmed));
    const groups: Array<{ dayKey: string; dayLabel: string; items: AssistantMessage[] }> = [];

    filtered.forEach((message) => {
      const dayKey = toDayKey(message.created_at);
      const existing = groups[groups.length - 1];
      if (!existing || existing.dayKey !== dayKey) {
        groups.push({ dayKey, dayLabel: formatDayDivider(message.created_at), items: [message] });
        return;
      }
      existing.items.push(message);
    });

    return groups;
  }, [messages, searchText]);

  const activePendingActionsCount = useMemo(() => {
    return countActiveAssistantPendingActions(messages);
  }, [messages]);

  const unreadNotificationsCount = useMemo(() => {
    const count = Number(summary?.pending_notifications || 0);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }, [summary?.pending_notifications]);

  const hasOlderMessages =
    !reachedConversationStartRef.current &&
    Number(summary?.total_messages || 0) > messages.length;
  const showingRecentMessagesOnly =
    Number(summary?.total_messages || 0) > messages.length;

  const loadOlderMessages = useCallback(async () => {
    if (
      !canLoad ||
      !organizationId ||
      !activeStoreId ||
      loadingOlderMessages ||
      messages.length === 0 ||
      reachedConversationStartRef.current
    ) {
      return;
    }

    const firstMessage = messages[0];
    const scrollNode = chatScrollRef.current;
    if (scrollNode) {
      prependScrollRestoreRef.current = {
        previousScrollHeight: scrollNode.scrollHeight,
        previousScrollTop: scrollNode.scrollTop,
      };
    }

    setLoadingOlderMessages(true);
    setErrorText(null);

    const { data, error } = await supabase.rpc("assistant_list_messages_paginated", {
      p_organization_id: organizationId,
      p_store_id: activeStoreId,
      p_limit: ASSISTANT_PAGE_MESSAGE_LIMIT,
      p_before_created_at: firstMessage.created_at,
      p_before_id: firstMessage.id,
    });

    if (error) {
      prependScrollRestoreRef.current = null;
      setErrorText(error.message || "Erro ao carregar mensagens anteriores.");
      setLoadingOlderMessages(false);
      return;
    }

    const olderMessages = Array.isArray(data) ? (data as AssistantMessage[]) : [];

    if (olderMessages.length === 0) {
      prependScrollRestoreRef.current = null;
      reachedConversationStartRef.current = true;
      setLoadingOlderMessages(false);
      return;
    }

    setMessages((current) => {
      const merged = mergeAssistantMessages(current, olderMessages);
      const totalMessages = Number(summary?.total_messages || 0);
      if (
        olderMessages.length < ASSISTANT_PAGE_MESSAGE_LIMIT ||
        (totalMessages > 0 && merged.length >= totalMessages)
      ) {
        reachedConversationStartRef.current = true;
      }
      return merged;
    });

    setLoadingOlderMessages(false);
  }, [
    canLoad,
    organizationId,
    activeStoreId,
    loadingOlderMessages,
    messages,
    summary?.total_messages,
  ]);

  const jumpToMessage = useCallback((messageId: string) => {
    setSearchOpen(false);

    window.requestAnimationFrame(() => {
      const node = messageRefs.current[messageId];
      if (!node || !chatScrollRef.current) return;
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.classList.add("ring-2", "ring-black");
      window.setTimeout(() => {
        node.classList.remove("ring-2", "ring-black");
      }, 1800);
    });
  }, []);

  const setDocumentActionLoading = useCallback((key: string, loading: boolean) => {
    setDocumentActionLoadingKeys((current) => {
      if (loading) {
        return { ...current, [key]: true };
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const setContractWorkflowActionLoading = useCallback(
    (key: string, loading: boolean) => {
      setContractWorkflowActionLoadingKeys((current) => {
        if (loading) {
          return { ...current, [key]: true };
        }

        const next = { ...current };
        delete next[key];
        return next;
      });
    },
    []
  );

  async function handleDocumentAction(
    message: AssistantMessage,
    actionId: AssistantDocumentActionId
  ) {
    const metadata = getAssistantDocumentReviewMetadata(message.metadata);
    const payload = getValidatedDocumentActionPayload(metadata);
    const actionKey = `${message.id}:${actionId}`;

    if (!metadata || !payload.isValid || !payload.documentType || !payload.documentId) {
      setDocumentActionFeedback((current) => ({
        ...current,
        [message.id]: {
          tone: "error",
          text: "Dados do documento incompletos ou invalidos.",
        },
      }));
      return;
    }

    if (
      actionId === "approve_and_send" &&
      isTerminalDocumentStatus(metadata.document_status)
    ) {
      setDocumentActionFeedback((current) => ({
        ...current,
        [message.id]: {
          tone: "error",
          text: "Este documento nao pode ser aprovado e enviado no status atual.",
        },
      }));
      return;
    }

    if (
      actionId === "confirm_store_signature" &&
      (payload.documentType !== "contract" ||
        isTerminalDocumentStatus(metadata.document_status))
    ) {
      setDocumentActionFeedback((current) => ({
        ...current,
        [message.id]: {
          tone: "error",
          text: "Este contrato nao pode ser confirmado pela loja no status atual.",
        },
      }));
      return;
    }

    if (actionId === "approve_and_send") {
      const confirmed = window.confirm(
        "Tem certeza que deseja aprovar e enviar este documento ao cliente?"
      );

      if (!confirmed) return;
    }

    if (actionId === "confirm_store_signature") {
      const confirmed = window.confirm(
        "Tem certeza que deseja confirmar este contrato pela loja?"
      );

      if (!confirmed) return;
    }

    setDocumentActionLoading(actionKey, true);
    setDocumentActionFeedback((current) => {
      const next = { ...current };
      delete next[message.id];
      return next;
    });

    try {
      const response = await fetch("/api/assistant/actions/document", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: actionId,
          documentType: payload.documentType,
          documentId: payload.documentId,
        }),
      });

      const result = (await response.json()) as AssistantDocumentActionApiResponse;

      if (!response.ok || !result.ok) {
        setDocumentActionFeedback((current) => ({
          ...current,
          [message.id]: {
            tone: "error",
            text:
              result.message ||
              result.error ||
              "Nao foi possivel executar a acao deste documento.",
          },
        }));
        return;
      }

      if (actionId === "review") {
        if (!result.signedUrl) {
          setDocumentActionFeedback((current) => ({
            ...current,
            [message.id]: {
              tone: "error",
              text: "Nao recebi um link valido para abrir o documento.",
            },
          }));
          return;
        }

        window.open(result.signedUrl, "_blank", "noopener,noreferrer");
      }

      setDocumentActionFeedback((current) => ({
        ...current,
        [message.id]: {
          tone: "success",
          text:
            result.message ||
            (actionId === "review"
              ? "Documento aberto para revisao."
              : actionId === "approve_and_send"
                ? "Documento aprovado e enviado com sucesso."
                : "Contrato confirmado pela loja com sucesso."),
        },
      }));

      if (actionId === "approve_and_send") {
        setDismissedApproveActionsByMessage((current) => ({
          ...current,
          [message.id]: true,
        }));
        await loadAssistant({ silent: true });
      }

      if (actionId === "confirm_store_signature") {
        setDismissedStoreSignatureActionsByMessage((current) => ({
          ...current,
          [message.id]: true,
        }));
        await loadAssistant({ silent: true });
      }
    } catch (error: any) {
      setDocumentActionFeedback((current) => ({
        ...current,
        [message.id]: {
          tone: "error",
          text:
            error?.message || "Erro inesperado ao executar a acao do documento.",
        },
      }));
    } finally {
      setDocumentActionLoading(actionKey, false);
    }
  }

  async function handleContractWorkflowAction(
    message: AssistantMessage,
    actionId: AssistantContractWorkflowActionId
  ) {
    const metadata = getAssistantContractWorkflowDecisionMetadata(message.metadata);
    const actionKey = `${message.id}:${actionId}`;

    if (!metadata || !message.id) {
      setContractWorkflowActionFeedback((current) => ({
        ...current,
        [message.id]: {
          tone: "error",
          text: "Dados do card de pré-contrato incompletos ou inválidos.",
        },
      }));
      return;
    }

    if (actionId !== "generate_contract") {
      setContractWorkflowActionFeedback((current) => ({
        ...current,
        [message.id]: {
          tone: "error",
          text: "Essa ação ainda não está disponível.",
        },
      }));
      return;
    }

    const confirmed = window.confirm(
      "Tem certeza que deseja gerar o contrato para revisão a partir deste card?"
    );

    if (!confirmed) return;

    setContractWorkflowActionLoading(actionKey, true);
    setContractWorkflowActionFeedback((current) => {
      const next = { ...current };
      delete next[message.id];
      return next;
    });

    try {
      const response = await fetch("/api/assistant/actions/contract-workflow", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: actionId,
          messageId: message.id,
        }),
      });

      const result =
        (await response.json()) as AssistantContractWorkflowActionApiResponse;

      if (!response.ok || !result.ok) {
        setContractWorkflowActionFeedback((current) => ({
          ...current,
          [message.id]: {
            tone: "error",
            text:
              result.message ||
              result.error ||
              "Não consegui gerar o contrato agora. Tente novamente em instantes.",
          },
        }));
        await loadAssistant({ silent: true });
        return;
      }

      setContractWorkflowActionFeedback((current) => ({
        ...current,
        [message.id]: {
          tone: "success",
          text:
            result.message ||
            "Contrato gerado para revisão. Confira o documento antes de aprovar ou enviar ao cliente.",
        },
      }));

      await loadAssistant({ silent: true });
    } catch (error: any) {
      setContractWorkflowActionFeedback((current) => ({
        ...current,
        [message.id]: {
          tone: "error",
          text:
            error?.message ||
            "Não consegui gerar o contrato agora. Tente novamente em instantes.",
        },
      }));
    } finally {
      setContractWorkflowActionLoading(actionKey, false);
    }
  }

  if (loading) {
    return <div className="p-4 text-sm text-gray-600">Carregando assistente...</div>;
  }

  return (
    <div className="h-[calc(100dvh-132px)] overflow-hidden bg-gray-100 text-sm text-gray-900">
      <div className="mx-auto flex h-full min-h-0 max-w-[1120px] flex-col px-2 py-2 md:px-4">
        {errorText ? (
          <div className="mb-2 shrink-0 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-red-200">
            {errorText}
          </div>
        ) : null}

        {statusText || recordingErrorText ? (
          <div className="mb-2 shrink-0 rounded-xl bg-white px-3 py-2 text-xs text-gray-700 ring-1 ring-black/10">
            {recordingErrorText || statusText}
          </div>
        ) : null}

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/10">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/10 bg-white px-3 py-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white">
                IA
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-gray-900">Assistente da loja</div>
                <div className="truncate text-[11px] text-gray-500">
                  {refreshing
                    ? "Atualizando..."
                    : `${summary?.total_messages ?? messages.length} mensagens • ${
                        activePendingActionsCount > 0
                          ? `${activePendingActionsCount} pendências`
                          : "Nada pendente no momento"
                      }${
                        unreadNotificationsCount > 0
                          ? ` • ${unreadNotificationsCount} novas`
                          : ""
                      }`}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setSearchOpen((current) => !current);
                  if (searchOpen) setSearchText("");
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-700 ring-1 ring-black/10 hover:bg-gray-50"
                aria-label="Buscar na conversa"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </button>

              <button
                onClick={() => void loadAssistant()}
                disabled={loading || storeLoading || !organizationId || !activeStoreId}
                className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Recarregar
              </button>
            </div>
          </div>

          <ResponsibleExternalNotificationsPanel
            organizationId={organizationId}
            storeId={activeStoreId}
            enabled={canLoad}
          />

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <div
              ref={chatScrollRef}
              onScroll={handleChatScroll}
              className={`min-h-0 flex-1 overflow-y-auto px-2.5 py-3 md:px-4 ${searchOpen ? "md:pr-[380px]" : ""}`}
              style={{ background: "#f7f7f7" }}
            >
              {groupedMessages.length > 0 ? (
                <div className="mb-3 flex flex-col items-center gap-2">
                  {hasOlderMessages ? (
                    <button
                      type="button"
                      onClick={() => void loadOlderMessages()}
                      disabled={loadingOlderMessages}
                      className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loadingOlderMessages
                        ? "Carregando mensagens anteriores..."
                        : "Carregar mensagens anteriores"}
                    </button>
                  ) : (
                    <div className="rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-gray-500 shadow-sm ring-1 ring-black/10">
                      Início da conversa carregado.
                    </div>
                  )}
                </div>
              ) : null}

              {showingRecentMessagesOnly ? (
                <div className="mb-3 flex justify-center">
                  <div className="rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-gray-500 shadow-sm ring-1 ring-black/10">
                    Mostrando mensagens recentes desta conversa.
                  </div>
                </div>
              ) : null}

              {groupedMessages.length === 0 ? (
                <div className="mx-auto mt-8 max-w-sm rounded-2xl bg-white px-4 py-5 text-center text-xs text-gray-500 ring-1 ring-black/10">
                  Nenhuma mensagem ainda. Envie a primeira mensagem para a assistente.
                </div>
              ) : (
                groupedMessages.map((group) => (
                  <div key={group.dayKey} className="mb-4">
                    <div className="mb-3 flex justify-center">
                      <div className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-gray-500 shadow-sm ring-1 ring-black/10">
                        {group.dayLabel}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {group.items.map((message) => (
                        <div
                          key={message.id}
                          ref={(node) => {
                            messageRefs.current[message.id] = node;
                          }}
                          className={`flex transition-shadow duration-200 ${bubbleWrapperClass(message)}`}
                        >
                          <div className={`max-w-[88%] px-3 py-2 shadow-sm md:max-w-[72%] ${bubbleClass(message)}`}>
                            <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-gray-500">
                              <span className="font-semibold text-gray-700">{senderLabel(message)}</span>
                              <span>•</span>
                              <span>{formatMessageType(message.message_type)}</span>
                            </div>

                            <div className="whitespace-pre-wrap break-words text-[13px] leading-5 text-gray-900">
                              {message.content}
                            </div>

                            {(() => {
                              const contractWorkflowMetadata =
                                getAssistantContractWorkflowDecisionMetadata(
                                  message.metadata
                                );

                              if (!contractWorkflowMetadata) return null;

                              const decision = contractWorkflowMetadata.decision || null;
                              const missingRequirements = Array.isArray(
                                decision?.missing_requirements
                              )
                                ? decision?.missing_requirements.filter((item) =>
                                    Boolean(getSafeString(item))
                                  )
                                : [];
                              const warnings = Array.isArray(decision?.warnings)
                                ? decision?.warnings.filter((item) =>
                                    Boolean(getSafeString(item))
                                  )
                                : [];
                              const availableActions = Array.isArray(
                                contractWorkflowMetadata.available_actions
                              )
                                ? contractWorkflowMetadata.available_actions
                                : [];
                              const workflowFeedback =
                                contractWorkflowActionFeedback[message.id] || null;
                              const generateContractLoading =
                                contractWorkflowActionLoadingKeys[
                                  `${message.id}:generate_contract`
                                ] === true;

                              return (
                                <div className="mt-3 rounded-2xl border border-black/10 bg-[#fafafa] p-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full bg-black px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                                      PRÉ-CONTRATO
                                    </span>
                                    <span className="text-[12px] font-semibold text-gray-900">
                                      Possível fechamento identificado
                                    </span>
                                  </div>

                                  <div className="mt-3 grid gap-2 rounded-xl bg-white px-3 py-3 text-[12px] leading-5 text-gray-700 ring-1 ring-black/5">
                                    <div>
                                      <span className="font-semibold text-gray-900">Cliente:</span>{" "}
                                      {getSafeString(contractWorkflowMetadata.customer_name) ||
                                        "Nao informado"}
                                    </div>
                                    <div>
                                      <span className="font-semibold text-gray-900">Orçamento:</span>{" "}
                                      {getSafeString(contractWorkflowMetadata.quote_number) ||
                                        getSafeString(contractWorkflowMetadata.quote_id) ||
                                        "Nao informado"}
                                    </div>
                                    <div>
                                      <span className="font-semibold text-gray-900">
                                        Origem do sinal:
                                      </span>{" "}
                                      {getContractWorkflowTriggerLabel(
                                        contractWorkflowMetadata.trigger ||
                                          contractWorkflowMetadata.source
                                      )}
                                    </div>
                                    <div>
                                      <span className="font-semibold text-gray-900">Status:</span>{" "}
                                      {getContractWorkflowDecisionStatusLabel(
                                        contractWorkflowMetadata
                                      )}
                                    </div>
                                  </div>

                                  <div className="mt-3 rounded-xl bg-white px-3 py-2 text-[12px] leading-5 text-gray-700 ring-1 ring-black/5">
                                    <div className="font-medium text-gray-900">
                                      Esse cliente parece estar perto de fechar.
                                    </div>
                                    <div className="mt-1">
                                      {getSafeString(decision?.reason_message) ||
                                        "Antes de gerar contrato, confirme o que deseja fazer."}
                                    </div>
                                    <div className="mt-2 text-[11px] text-gray-500">
                                      Antes de gerar contrato, confirme a próxima ação.
                                    </div>
                                  </div>

                                  {missingRequirements.length > 0 ? (
                                    <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-200">
                                      Pendencias: {missingRequirements.join(", ")}
                                    </div>
                                  ) : null}

                                  {warnings.length > 0 ? (
                                    <div className="mt-2 rounded-xl bg-white px-3 py-2 text-[11px] text-gray-600 ring-1 ring-black/5">
                                      Avisos: {warnings.join(" ")}
                                    </div>
                                  ) : null}

                                  {workflowFeedback ? (
                                    <div
                                      className={[
                                        "mt-2 rounded-xl px-3 py-2 text-[11px] ring-1",
                                        workflowFeedback.tone === "success"
                                          ? "bg-green-50 text-green-800 ring-green-200"
                                          : "bg-red-50 text-red-800 ring-red-200",
                                      ].join(" ")}
                                    >
                                      {workflowFeedback.text}
                                    </div>
                                  ) : null}

                                  {availableActions.length > 0 ? (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {availableActions.map((action, index) => (
                                        <button
                                          key={`${message.id}:contract-workflow-action:${index}`}
                                          type="button"
                                          onClick={() => {
                                            if (
                                              getContractWorkflowActionKey(action) ===
                                              "generate_contract"
                                            ) {
                                              void handleContractWorkflowAction(
                                                message,
                                                "generate_contract"
                                              );
                                            }
                                          }}
                                          disabled={
                                            getContractWorkflowActionKey(action) !==
                                              "generate_contract" ||
                                            generateContractLoading
                                          }
                                          title={
                                            getContractWorkflowActionKey(action) ===
                                            "generate_contract"
                                              ? "Gera um contrato para revisão sem enviar ao cliente."
                                              : "Esta ação será ativada no próximo bloco."
                                          }
                                          className={[
                                            "rounded-full px-3 py-1.5 text-[11px] font-semibold ring-1 disabled:cursor-not-allowed disabled:opacity-70",
                                            getContractWorkflowActionKey(action) ===
                                              "generate_contract"
                                              ? "bg-black text-white ring-black"
                                              : "bg-white text-gray-900 ring-black/10",
                                          ].join(" ")}
                                        >
                                          {getContractWorkflowActionKey(action) ===
                                            "generate_contract" &&
                                          generateContractLoading
                                            ? "Gerando..."
                                            : getContractWorkflowActionLabel(action)}
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}

                                  <div className="mt-2 text-[11px] text-gray-500">
                                    Apenas "Gerar contrato" executa ação neste bloco.
                                  </div>
                                </div>
                              );
                            })()}

                            {(() => {
                              const customerContextReportMetadata =
                                getAssistantCustomerContextReportMetadata(
                                  message.metadata
                                );

                              if (!customerContextReportMetadata) return null;

                              const highlights = Array.isArray(
                                customerContextReportMetadata.conversation_highlights
                              )
                                ? customerContextReportMetadata.conversation_highlights.filter(
                                    (item) => Boolean(getSafeString(item))
                                  )
                                : [];

                              return (
                                <div className="mt-3 rounded-2xl border border-black/10 bg-[#fafafa] p-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full bg-black px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                                      RELATÓRIO DO CLIENTE
                                    </span>
                                    <span className="text-[12px] font-semibold text-gray-900">
                                      {getSafeString(customerContextReportMetadata.subtitle) ||
                                        "Contexto para decisão do responsável"}
                                    </span>
                                  </div>

                                  {getSafeString(customerContextReportMetadata.narrative) ||
                                  getSafeString(message.content) ? (
                                    <div className="mt-3 rounded-xl bg-white px-3 py-3 text-[12px] leading-5 text-gray-700 ring-1 ring-black/5">
                                      {getSafeString(
                                        customerContextReportMetadata.narrative
                                      ) || getSafeString(message.content)}
                                    </div>
                                  ) : null}

                                  <div className="mt-3 grid gap-2 rounded-xl bg-white px-3 py-3 text-[12px] leading-5 text-gray-700 ring-1 ring-black/5">
                                    {getSafeString(
                                      customerContextReportMetadata.customer_name
                                    ) ? (
                                      <div>
                                        <span className="font-semibold text-gray-900">
                                          Cliente:
                                        </span>{" "}
                                        {getSafeString(
                                          customerContextReportMetadata.customer_name
                                        )}
                                      </div>
                                    ) : null}

                                    {getSafeString(
                                      customerContextReportMetadata.customer_phone
                                    ) ? (
                                      <div>
                                        <span className="font-semibold text-gray-900">
                                          Contato:
                                        </span>{" "}
                                        {getSafeString(
                                          customerContextReportMetadata.customer_phone
                                        )}
                                      </div>
                                    ) : null}

                                    {getSafeString(
                                      customerContextReportMetadata.source_label
                                    ) ? (
                                      <div>
                                        <span className="font-semibold text-gray-900">
                                          Origem:
                                        </span>{" "}
                                        {getSafeString(
                                          customerContextReportMetadata.source_label
                                        )}
                                      </div>
                                    ) : null}

                                    {getSafeString(
                                      customerContextReportMetadata.main_interest
                                    ) ? (
                                      <div>
                                        <span className="font-semibold text-gray-900">
                                          Interesse principal:
                                        </span>{" "}
                                        {getSafeString(
                                          customerContextReportMetadata.main_interest
                                        )}
                                      </div>
                                    ) : null}

                                    {getSafeString(
                                      customerContextReportMetadata.customer_goal
                                    ) ? (
                                      <div>
                                        <span className="font-semibold text-gray-900">
                                          O que o cliente quer:
                                        </span>{" "}
                                        {getSafeString(
                                          customerContextReportMetadata.customer_goal
                                        )}
                                      </div>
                                    ) : null}

                                    {getSafeString(
                                      customerContextReportMetadata.quote_number
                                    ) ||
                                    getSafeString(
                                      customerContextReportMetadata.quote_status_label
                                    ) ||
                                    getSafeString(
                                      customerContextReportMetadata.quote_total_label
                                    ) ? (
                                      <div>
                                        <span className="font-semibold text-gray-900">
                                          Orçamento relacionado:
                                        </span>{" "}
                                        {[
                                          getSafeString(
                                            customerContextReportMetadata.quote_number
                                          ),
                                          getSafeString(
                                            customerContextReportMetadata.quote_status_label
                                          ),
                                          getSafeString(
                                            customerContextReportMetadata.quote_total_label
                                          ),
                                        ]
                                          .filter(Boolean)
                                          .join(" • ")}
                                      </div>
                                    ) : null}

                                    {getSafeString(
                                      customerContextReportMetadata.contract_number
                                    ) ||
                                    getSafeString(
                                      customerContextReportMetadata.contract_status_label
                                    ) ? (
                                      <div>
                                        <span className="font-semibold text-gray-900">
                                          Contrato relacionado:
                                        </span>{" "}
                                        {[
                                          getSafeString(
                                            customerContextReportMetadata.contract_number
                                          ),
                                          getSafeString(
                                            customerContextReportMetadata.contract_status_label
                                          ),
                                        ]
                                          .filter(Boolean)
                                          .join(" • ")}
                                      </div>
                                    ) : null}

                                    {getSafeString(
                                      customerContextReportMetadata.technical_visit_label
                                    ) ? (
                                      <div>
                                        <span className="font-semibold text-gray-900">
                                          Visita técnica:
                                        </span>{" "}
                                        {getSafeString(
                                          customerContextReportMetadata.technical_visit_label
                                        )}
                                      </div>
                                    ) : null}

                                    {getSafeString(
                                      customerContextReportMetadata.current_status_label
                                    ) ? (
                                      <div>
                                        <span className="font-semibold text-gray-900">
                                          Situação atual:
                                        </span>{" "}
                                        {getSafeString(
                                          customerContextReportMetadata.current_status_label
                                        )}
                                      </div>
                                    ) : null}
                                  </div>

                                  {highlights.length > 0 ? (
                                    <div className="mt-3 rounded-xl bg-white px-3 py-3 text-[12px] leading-5 text-gray-700 ring-1 ring-black/5">
                                      <div className="font-semibold text-gray-900">
                                        Informações importantes da conversa
                                      </div>
                                      <div className="mt-2 space-y-1">
                                        {highlights.map((item, index) => (
                                          <div
                                            key={`${message.id}:customer-report-highlight:${index}`}
                                            className="flex gap-2"
                                          >
                                            <span className="mt-[2px] text-gray-400">-</span>
                                            <span>{item}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}

                                  {getSafeString(
                                    customerContextReportMetadata.suggested_next_action
                                  ) ? (
                                    <div className="mt-3 rounded-xl bg-white px-3 py-3 text-[12px] leading-5 text-gray-700 ring-1 ring-black/5">
                                      <div className="font-semibold text-gray-900">
                                        Próxima ação sugerida
                                      </div>
                                      <div className="mt-1">
                                        {getSafeString(
                                          customerContextReportMetadata.suggested_next_action
                                        )}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })()}

                            {(() => {
                              const documentMetadata = getAssistantDocumentReviewMetadata(
                                message.metadata
                              );

                              if (!documentMetadata) return null;

                              const payload =
                                getValidatedDocumentActionPayload(documentMetadata);
                              const metadataComplete =
                                hasCompleteDocumentReviewMetadata(documentMetadata);
                              const terminalStatus = isTerminalDocumentStatus(
                                documentMetadata.document_status
                              );
                              const feedback = documentActionFeedback[message.id] || null;
                              const reviewEnabled =
                                metadataComplete &&
                                isDocumentActionEnabled(documentMetadata, "review");
                              const approveEnabled =
                                metadataComplete &&
                                !terminalStatus &&
                                dismissedApproveActionsByMessage[message.id] !== true &&
                                isDocumentActionEnabled(
                                  documentMetadata,
                                  "approve_and_send"
                                );
                              const confirmStoreSignatureEnabled =
                                metadataComplete &&
                                !terminalStatus &&
                                payload.documentType === "contract" &&
                                normalizeText(documentMetadata.document_status) ===
                                  "customer_signed" &&
                                dismissedStoreSignatureActionsByMessage[message.id] !==
                                  true &&
                                isDocumentActionEnabled(
                                  documentMetadata,
                                  "confirm_store_signature"
                                );
                              const reviewLoading =
                                documentActionLoadingKeys[`${message.id}:review`] === true;
                              const approveLoading =
                                documentActionLoadingKeys[
                                  `${message.id}:approve_and_send`
                                ] === true;
                              const confirmStoreSignatureLoading =
                                documentActionLoadingKeys[
                                  `${message.id}:confirm_store_signature`
                                ] === true;

                              return (
                                <div className="mt-3 rounded-2xl border border-black/10 bg-[#fafafa] p-3">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="rounded-full bg-black px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                                      {getDocumentTypeLabel(documentMetadata.document_type)}
                                    </span>
                                    {getSafeString(documentMetadata.document_number) ? (
                                      <span className="text-[12px] font-semibold text-gray-900">
                                        {getSafeString(documentMetadata.document_number)}
                                      </span>
                                    ) : null}
                                    <span className="text-[11px] font-medium text-gray-500">
                                      PDF privado
                                    </span>
                                  </div>

                                  <div className="mt-3 rounded-xl bg-white px-3 py-2 text-[12px] leading-5 text-gray-700 ring-1 ring-black/5">
                                    {getDocumentPromptText(documentMetadata)}
                                  </div>

                                  {!metadataComplete ? (
                                    <div className="mt-2 text-[11px] font-medium text-amber-700">
                                      Dados do documento incompletos ou invalidos.
                                    </div>
                                  ) : null}

                                  {feedback ? (
                                    <div
                                      className={[
                                        "mt-2 rounded-xl px-3 py-2 text-[11px] ring-1",
                                        feedback.tone === "success"
                                          ? "bg-green-50 text-green-800 ring-green-200"
                                          : "bg-red-50 text-red-800 ring-red-200",
                                      ].join(" ")}
                                    >
                                      {feedback.text}
                                    </div>
                                  ) : null}

                                  {reviewEnabled ||
                                  approveEnabled ||
                                  confirmStoreSignatureEnabled ? (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {reviewEnabled ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void handleDocumentAction(message, "review")
                                          }
                                          disabled={
                                            !payload.isValid ||
                                            reviewLoading ||
                                            approveLoading ||
                                            confirmStoreSignatureLoading
                                          }
                                          className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {reviewLoading
                                            ? "Abrindo..."
                                            : getDocumentActionLabel(
                                                documentMetadata,
                                                "review"
                                              )}
                                        </button>
                                      ) : null}
                                      {approveEnabled ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void handleDocumentAction(
                                              message,
                                              "approve_and_send"
                                            )
                                          }
                                          disabled={
                                            !payload.isValid ||
                                            reviewLoading ||
                                            approveLoading ||
                                            confirmStoreSignatureLoading
                                          }
                                          className="rounded-full bg-black px-3 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {approveLoading
                                            ? "Enviando..."
                                            : getDocumentActionLabel(
                                                documentMetadata,
                                                "approve_and_send"
                                              )}
                                        </button>
                                      ) : null}
                                      {confirmStoreSignatureEnabled ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void handleDocumentAction(
                                              message,
                                              "confirm_store_signature"
                                            )
                                          }
                                          disabled={
                                            !payload.isValid ||
                                            reviewLoading ||
                                            approveLoading ||
                                            confirmStoreSignatureLoading
                                          }
                                          className="rounded-full bg-black px-3 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {confirmStoreSignatureLoading
                                            ? "Confirmando..."
                                            : getDocumentActionLabel(
                                                documentMetadata,
                                                "confirm_store_signature"
                                              )}
                                        </button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })()}

                            {shouldShowRouteButton(message) ? (
                              <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                                {buildGoogleMapsRouteUrl(getAssistantMessageRouteAddress(message)) ? (
                                  <a
                                    href={buildGoogleMapsRouteUrl(getAssistantMessageRouteAddress(message)) || "#"}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded-full bg-black px-3 py-1 text-[11px] font-semibold text-white transition hover:opacity-90"
                                  >
                                    Rota
                                  </a>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    title="Falta endereço no compromisso para abrir a rota no Maps."
                                    className="cursor-not-allowed rounded-full bg-gray-100 px-3 py-1 text-[11px] font-semibold text-gray-400 ring-1 ring-black/5"
                                  >
                                    Rota
                                  </button>
                                )}
                              </div>
                            ) : null}

                            <div className="mt-1 text-right text-[10px] text-gray-400">
                              {formatTime(message.created_at)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
              <div ref={chatBottomRef} aria-hidden="true" />
            </div>

            {searchOpen ? (
              <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-[360px] flex-col border-l border-black/10 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
                <div className="flex items-center gap-3 border-b border-black/10 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSearchOpen(false);
                      setSearchText("");
                    }}
                    className="rounded-full p-2 text-gray-600 hover:bg-gray-100"
                    aria-label="Fechar busca"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>

                  <div className="text-base font-semibold text-gray-900">Pesquisar mensagens</div>
                </div>

                <div className="border-b border-black/10 px-4 py-3">
                  <label className="flex items-center gap-2 rounded-full bg-white px-4 py-2 ring-1 ring-black/15">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                    <input
                      ref={searchInputRef}
                      value={searchText}
                      onChange={(event) => setSearchText(event.target.value)}
                      placeholder="Digite para buscar nas mensagens carregadas"
                      className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
                    />
                    {searchText.trim() ? (
                      <button
                        type="button"
                        onClick={() => setSearchText("")}
                        className="rounded-full p-1 text-gray-500 hover:bg-gray-100"
                        aria-label="Limpar busca"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </button>
                    ) : null}
                  </label>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  {!searchText.trim() ? (
                    <div className="rounded-2xl border border-dashed border-black/10 p-4 text-sm text-gray-500">
                      Procure por nome do cliente, telefone, data, compromisso ou qualquer palavra das mensagens carregadas.
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-black/10 p-4 text-sm text-gray-500">
                      Não encontrei resultados para essa busca.
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {searchResults.map((group) => (
                        <div key={group.dayKey}>
                          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {group.dayLabel}
                          </div>

                          <div className="space-y-2">
                            {group.items.map((message) => (
                              <button
                                key={message.id}
                                type="button"
                                onClick={() => jumpToMessage(message.id)}
                                className="w-full rounded-2xl border border-black/10 bg-white p-3 text-left hover:bg-gray-50"
                              >
                                <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-500">
                                  <span className="font-semibold text-gray-700">{senderLabel(message)}</span>
                                  <span>•</span>
                                  <span>{formatTime(message.created_at)}</span>
                                </div>
                                <div className="line-clamp-3 text-sm leading-6 text-gray-900">
                                  {renderHighlightedText(message.content, searchText)}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </aside>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-black/10 bg-white px-2.5 py-2 md:px-3">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setPendingAttachment(file);
                setErrorText(null);
              }}
            />

            {pendingAttachment ? (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-2xl bg-gray-50 px-3 py-2 text-xs ring-1 ring-black/10">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-gray-900">
                    {formatAttachmentKind(pendingAttachment)} selecionado
                  </div>
                  <div className="truncate text-[11px] text-gray-500">
                    {pendingAttachment.name} • {formatFileSize(pendingAttachment.size)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearPendingAttachment}
                  className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 ring-1 ring-black/10 hover:bg-gray-100"
                >
                  Remover
                </button>
              </div>
            ) : null}

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-gray-700 ring-1 ring-black/10 hover:bg-gray-50"
                aria-label="Anexar arquivo"
                title="Anexar imagem, vídeo, áudio, PDF ou documento"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>

              <textarea
                value={newMessage}
                onChange={(event) => setNewMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessageToAssistant();
                  }
                }}
                placeholder="Mensagem"
                rows={1}
                className="max-h-24 min-h-[40px] flex-1 resize-none rounded-3xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm leading-5 text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-300 focus:bg-white"
              />

              <button
                type="button"
                onClick={() => (recording ? stopAudioRecording() : void startAudioRecording())}
                className={[
                  "mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-black/10 hover:bg-gray-50",
                  recording ? "bg-red-50 text-red-700" : "bg-white text-gray-700",
                ].join(" ")}
                aria-label={recording ? "Parar gravação" : "Gravar áudio"}
                title={recording ? "Parar gravação" : "Gravar áudio"}
              >
                {recording ? (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                    <rect x="7" y="7" width="10" height="10" rx="2" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
                    <path d="M19 11a7 7 0 0 1-14 0" />
                    <path d="M12 18v4" />
                  </svg>
                )}
              </button>

              <button
                onClick={() => void sendMessageToAssistant()}
                disabled={sending || (!newMessage.trim() && !pendingAttachment)}
                className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Enviar mensagem"
                title="Enviar"
              >
                {sending ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m22 2-7 20-4-9-9-4Z" />
                    <path d="M22 2 11 13" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
