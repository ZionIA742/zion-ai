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

type SignedMediaState = {
  signedUrl: string;
  mimeType: string | null;
  attachmentKind: string | null;
  fileName: string | null;
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

type DetailTab = "summary" | "appointments" | "context" | "tasks";

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

function getOriginalFileName(message: MessageRow) {
  const metadata = getMessageMetadata(message);
  return String(metadata?.original_file_name || "").trim();
}

function getMimeType(message: MessageRow) {
  const metadata = getMessageMetadata(message);
  return String(metadata?.mime_type || "").trim();
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
  const [imagePreviewErrors, setImagePreviewErrors] = useState<Record<string, boolean>>(
    {}
  );
  const [signedMediaByMessageId, setSignedMediaByMessageId] = useState<
    Record<string, SignedMediaState>
  >({});
  const [signedMediaErrorByMessageId, setSignedMediaErrorByMessageId] = useState<
    Record<string, string>
  >({});
  const [viewingPhotoMessageId, setViewingPhotoMessageId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const hasConversation = Boolean(conversation);
  const isHumanActive = conversation?.is_human_active === true;
  const latestCommercialTask = getLatestCommercialTask(commercialTasks);
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

    const { error } = await supabase.rpc("panel_send_message_scoped", {
      p_organization_id: lead.organization_id,
      p_conversation_id: conversation.id,
      p_text: text,
    });

    if (error) {
      console.error("[LeadPage] erro ao enviar mensagem:", {
        message: (error as any)?.message ?? null,
        details: (error as any)?.details ?? null,
        hint: (error as any)?.hint ?? null,
        code: (error as any)?.code ?? null,
        full: error,
      });

      setErrorText((error as any)?.message ?? "Erro ao enviar mensagem.");
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

  async function loadSignedMediaUrl(message: MessageRow) {
    const safeMessageId = String(message.id || "").trim();

    if (!safeMessageId) {
      throw new Error("Nao foi possivel identificar a mensagem do anexo.");
    }

    const cached = signedMediaByMessageId[safeMessageId];
    if (cached?.signedUrl) {
      return cached;
    }

    setViewingPhotoMessageId(safeMessageId);
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
      setViewingPhotoMessageId((current) =>
        current === safeMessageId ? null : current
      );
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
    void fetchLeadConversationAndMessages();
  }, [leadId]);

  useEffect(() => {
    if (loading) return;

    scrollMessagesToBottom(
      hasScrolledMessagesInitiallyRef.current ? "smooth" : "auto"
    );
    hasScrolledMessagesInitiallyRef.current = true;
  }, [messages.length, loading]);

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
                    {lead.phone ?? "Sem telefone"}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 font-semibold text-gray-800">
                    {formatLeadStage(lead.state)}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 font-semibold text-gray-800">
                    {conversation ? formatConversationStatus(conversation.status) : "Sem conversa"}
                  </span>
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
                          const originalFileName = getOriginalFileName(message);
                          const mimeType = getMimeType(message);
                          const signedMedia = signedMediaByMessageId[message.id] || null;
                          const signedMediaError =
                            signedMediaErrorByMessageId[message.id] || null;
                          const isLoadingSignedMedia =
                            viewingPhotoMessageId === message.id;

                          return (
                            <>
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide opacity-60">
                                {formatSender(message)}
                              </div>

                              <div className="whitespace-pre-wrap break-words leading-5">
                                {getMessageDisplayContent(message)}
                              </div>

                              {isStoredAttachmentMessage(message) && !isCatalogProductPhoto ? (
                                <div className="mt-2 rounded-xl bg-white/70 p-3 text-xs text-gray-900 ring-1 ring-black/10">
                                  <div className="font-semibold">
                                    {getStoredAttachmentLabel(attachmentKind)}
                                  </div>
                                  <div className="mt-1 break-words text-gray-600">
                                    {originalFileName || "Anexo salvo com seguranca"}
                                  </div>
                                  {mimeType ? (
                                    <div className="mt-1 break-words text-[11px] text-gray-500">
                                      {mimeType}
                                    </div>
                                  ) : null}

                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {attachmentKind === "image" ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void openSignedAttachment(
                                            message,
                                            "Erro ao abrir a imagem com seguranca."
                                          )
                                        }
                                        disabled={isLoadingSignedMedia}
                                        className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {isLoadingSignedMedia ? "Abrindo..." : "Abrir imagem"}
                                      </button>
                                    ) : null}

                                    {attachmentKind === "audio" ? (
                                      <button
                                        type="button"
                                        onClick={() => void loadSignedMediaUrl(message)}
                                        disabled={isLoadingSignedMedia}
                                        className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {isLoadingSignedMedia ? "Carregando..." : "Ouvir audio"}
                                      </button>
                                    ) : null}

                                    {attachmentKind === "video" ? (
                                      <button
                                        type="button"
                                        onClick={() => void loadSignedMediaUrl(message)}
                                        disabled={isLoadingSignedMedia}
                                        className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {isLoadingSignedMedia ? "Carregando..." : "Assistir video"}
                                      </button>
                                    ) : null}

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

                                  {attachmentKind === "audio" && signedMedia?.signedUrl ? (
                                    <div className="mt-3">
                                      <audio
                                        controls
                                        preload="none"
                                        src={signedMedia.signedUrl}
                                        className="h-10 w-full max-w-[320px]"
                                      />
                                    </div>
                                  ) : null}

                                  {attachmentKind === "video" && signedMedia?.signedUrl ? (
                                    <div className="mt-3 max-w-full">
                                      <video
                                        controls
                                        preload="metadata"
                                        src={signedMedia.signedUrl}
                                        className="block h-auto max-h-[240px] w-full max-w-[320px] rounded-xl ring-1 ring-black/10"
                                      />
                                    </div>
                                  ) : null}

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

                              {isCustomerLocationPhoto ? (
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
