"use client";

import Link from "next/link";
import { KeyboardEvent, useEffect, useState } from "react";
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
    sender.includes("bot")
  ) {
    return "bg-black text-white ml-auto";
  }

  if (
    sender.includes("human") ||
    sender.includes("agent") ||
    (sender.includes("user") && direction === "outgoing")
  ) {
    return "bg-blue-50 text-gray-900 ml-auto ring-1 ring-blue-200";
  }

  return "bg-white text-gray-900 ring-1 ring-black/10";
}

function formatDateTime(value: string | null) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data invalida";
  return date.toLocaleString("pt-BR");
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
    newMessage.trim().length > 0;

  const canSimulateCustomerMessage =
    hasConversation &&
    !working &&
    !simulatingCustomer &&
    simulatedCustomerMessage.trim().length > 0;

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

  async function sendMessage() {
    const text = newMessage.trim();

    if (!text) return;

    if (!lead || !conversation) {
      setErrorText("Nao foi possivel enviar: conversa nao encontrada para este lead.");
      return;
    }

    setWorking(true);
    setErrorText(null);
    setStatusText(null);

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
      setWorking(false);
      return;
    }

    setNewMessage("");
    setStatusText("Mensagem enviada com sucesso.");
    setWorking(false);
    await fetchLeadConversationAndMessages({ silent: true });
  }

  async function simulateCustomerMessage() {
    const text = simulatedCustomerMessage.trim();

    if (!text) return;

    if (!lead || !conversation) {
      setErrorText("Nao foi possivel simular: conversa nao encontrada para este lead.");
      return;
    }

    setSimulatingCustomer(true);
    setErrorText(null);
    setStatusText(null);

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
        return;
      }

      setSimulatedCustomerMessage("");

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
      await fetchLeadConversationAndMessages({ silent: true });
    } catch (error: any) {
      console.error("[LeadPage] erro inesperado ao simular cliente:", error);

      setErrorText(
        error?.message || "Erro inesperado ao simular mensagem do cliente."
      );
      setSimulatingCustomer(false);
    }
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
      if (!simulatingCustomer) {
        void simulateCustomerMessage();
      }
    }
  }

  useEffect(() => {
    void fetchLeadConversationAndMessages();
  }, [leadId]);

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

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-5">
          <Link
            href="/crm"
            className="inline-flex items-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
          >
            Voltar para o CRM
          </Link>
        </div>

        {errorText ? (
          <div className="mb-5 rounded-2xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-600/20">
            <div className="font-semibold">Erro</div>
            <div className="mt-1 break-words">{errorText}</div>
          </div>
        ) : null}

        {statusText ? (
          <div className="mb-5 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
            <div className="font-semibold">Sucesso</div>
            <div className="mt-1 break-words">{statusText}</div>
          </div>
        ) : null}

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-bold text-gray-900">Ficha do cliente</h1>

            {refreshing ? (
              <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 ring-1 ring-black/10">
                Atualizando...
              </div>
            ) : null}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-5">
            <InfoCard label="Nome" value={lead.name ?? "Sem nome"} />
            <InfoCard label="Telefone" value={lead.phone ?? "Sem telefone"} />
            <InfoCard label="Etapa atual" value={formatLeadStage(lead.state)} />
            <InfoCard
              label="Status da conversa"
              value={conversation ? formatConversationStatus(conversation.status) : "Sem conversa"}
              help={
                conversation
                  ? isHumanActive
                    ? "Humano ativo"
                    : "IA ativa"
                  : "Nenhuma conversa disponivel"
              }
            />
            <InfoCard
              label="Ultima interacao"
              value={formatDateTime(conversation?.last_message_at ?? conversation?.created_at ?? null)}
            />
          </div>

          {!conversation ? (
            <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-600/20">
              Este lead ainda nao possui conversa. Os controles de assumir, liberar e responder ficam bloqueados ate existir uma conversa.
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => void takeOverConversation()}
              disabled={!canTakeOver}
              className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isHumanActive ? "Conversa ja assumida" : "Assumir conversa"}
            </button>

            <button
              onClick={() => void releaseConversation()}
              disabled={!canReleaseToAI}
              className="rounded-xl bg-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isHumanActive ? "Liberar IA" : "IA ja esta liberada"}
            </button>

            <button
              onClick={() => void fetchLeadConversationAndMessages({ silent: true })}
              disabled={working || refreshing || simulatingCustomer}
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Recarregar
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <h2 className="text-xl font-semibold text-gray-900">Resumo rapido</h2>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
              <div className="text-sm font-semibold text-gray-700">
                Ultima mensagem da conversa
              </div>
              <div className="mt-2 text-sm leading-6 text-gray-700">
                {conversation?.last_message_preview ||
                  "Ainda sem mensagem resumida na conversa."}
              </div>
              {(conversation?.last_message_at ||
                conversation?.last_message_direction ||
                conversation?.last_message_sender) ? (
                <div className="mt-3 text-xs text-gray-500">
                  {conversation?.last_message_at
                    ? formatDateTime(conversation.last_message_at)
                    : "Sem horario"}
                  {conversation?.last_message_direction
                    ? ` - ${formatDirectionLabel(conversation.last_message_direction)}`
                    : ""}
                  {conversation?.last_message_sender
                    ? ` - ${formatSender({
                        id: "preview",
                        sender: conversation.last_message_sender,
                        content: null,
                        direction: conversation.last_message_direction,
                        message_type: null,
                        created_at: conversation.last_message_at,
                      })}`
                    : ""}
                </div>
              ) : null}
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                <div className="text-sm font-semibold text-gray-700">
                  Resumo comercial
                </div>
                <div className="mt-2 text-sm leading-6 text-gray-700">
                  {latestCommercialTask?.task_payload?.conversation_summary ||
                    "Ainda sem resumo comercial registrado."}
                </div>
              </div>

              <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                <div className="text-sm font-semibold text-gray-700">
                  Proximo passo
                </div>
                <div className="mt-2 text-sm leading-6 text-gray-700">
                  {latestCommercialTask?.task_payload?.next_step ||
                    "Ainda sem proximo passo registrado."}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <h2 className="text-xl font-semibold text-gray-900">
            Pendencias comerciais
          </h2>

          <div className="mt-4">
            {commercialTasks.length === 0 ? (
              <EmptyState text="Ainda nao existem pendencias comerciais registradas para este cliente." />
            ) : (
              <div className="space-y-4">
                {commercialTasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
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

                        <div className="mt-3 text-base font-semibold text-gray-900">
                          {task.title || formatTaskTypeLabel(task.task_type)}
                        </div>

                        <div className="mt-2 text-sm leading-6 text-gray-700">
                          {task.description || "Sem descricao registrada."}
                        </div>
                      </div>

                      <div className="shrink-0 text-xs text-gray-500">
                        Atualizado em {formatDateTime(task.updated_at || task.created_at)}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl bg-white p-3 ring-1 ring-black/5">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Ultima mensagem do cliente
                        </div>
                        <div className="mt-2 text-sm leading-6 text-gray-700">
                          {task.task_payload?.last_customer_message ||
                            "Sem mensagem registrada na task."}
                        </div>
                      </div>

                      <div className="rounded-xl bg-white p-3 ring-1 ring-black/5">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Proximo passo
                        </div>
                        <div className="mt-2 text-sm leading-6 text-gray-700">
                          {task.task_payload?.next_step ||
                            "Sem proximo passo registrado."}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 text-xs text-gray-500">
                      Criado em {formatDateTime(task.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <h2 className="text-xl font-semibold text-gray-900">
            Interesse e contexto do cliente
          </h2>

          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <InfoCard
              label="Modelo recomendado"
              value={
                latestCommercialTask?.task_payload?.recommended_model ||
                "Ainda sem informacao registrada"
              }
            />
            <InfoCard
              label="Modelo citado / anuncio"
              value={
                latestCommercialTask?.task_payload?.ad_model_or_requested_model ||
                "Ainda sem informacao registrada"
              }
            />
            <InfoCard
              label="Espaco / medidas"
              value={
                latestCommercialTask?.task_payload?.space_text ||
                "Ainda sem informacao registrada"
              }
            />
            <InfoCard
              label="Area solicitada"
              value={
                latestCommercialTask?.task_payload?.requested_area_m2 != null
                  ? `${latestCommercialTask.task_payload.requested_area_m2} m2`
                  : "Ainda sem informacao registrada"
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
        </div>

        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <h2 className="text-xl font-semibold text-gray-900">
            Agenda e compromissos
          </h2>

          <div className="mt-4">
            {appointments.length === 0 ? (
              <EmptyState text="Ainda nao existem compromissos registrados para este cliente." />
            ) : (
              <div className="space-y-4">
                {appointments.map((appointment) => (
                  <div
                    key={appointment.id}
                    className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-gray-900">
                          {formatAppointmentTypeLabel(appointment.appointment_type)}
                        </div>
                        <div className="mt-1 text-sm text-gray-600">
                          {formatAppointmentStatusLabel(appointment.status)}
                        </div>
                      </div>

                      <div className="text-xs text-gray-500">
                        Atualizado em {formatDateTime(appointment.updated_at || appointment.created_at)}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <InfoCard
                        label="Data e hora"
                        value={formatDateTime(appointment.scheduled_start || appointment.scheduled_end)}
                      />
                      <InfoCard
                        label="Endereco"
                        value={appointment.address_text || "Sem endereco registrado"}
                      />
                    </div>

                    <div className="mt-3 rounded-xl bg-white p-3 ring-1 ring-black/5">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Observacoes
                      </div>
                      <div className="mt-2 text-sm leading-6 text-gray-700">
                        {appointment.notes || "Sem observacoes registradas."}
                      </div>
                    </div>

                    <div className="mt-3 text-xs text-gray-500">
                      Criado em {formatDateTime(appointment.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-gray-900">Mensagens</h2>
            <div className="text-sm text-gray-500">{messages.length} mensagem(ns)</div>
          </div>

          {!conversation ? (
            <div className="mt-6 rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">
              Este lead ainda nao possui conversa criada.
            </div>
          ) : messages.length === 0 ? (
            <div className="mt-6 rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">
              Nenhuma mensagem encontrada para esta conversa.
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {messages.map((message) => (
                <div key={message.id} className="flex w-full">
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${bubbleClass(
                      message
                    )}`}
                  >
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">
                      {formatSender(message)}
                    </div>

                    <div className="whitespace-pre-wrap break-words text-sm">
                      {message.content || "(mensagem sem conteudo textual)"}
                    </div>

                    <div className="mt-2 text-[11px] opacity-70">
                      {formatDateTime(message.created_at)}
                      {message.message_type ? ` - ${message.message_type}` : ""}
                      {message.direction ? ` - ${message.direction}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <h2 className="text-xl font-semibold text-gray-900">Responder manualmente</h2>

          <div className="mt-4 flex gap-3">
            <input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={working || simulatingCustomer || !conversation}
              className="flex-1 rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black disabled:cursor-not-allowed disabled:bg-gray-100"
              placeholder={
                conversation
                  ? "Digite sua mensagem e pressione Enter..."
                  : "Este lead ainda nao possui conversa disponivel."
              }
            />

            <button
              onClick={() => void sendMessage()}
              disabled={!canSendMessage}
              className="rounded-xl bg-black px-6 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {working ? "Enviando..." : "Enviar"}
            </button>
          </div>

          <div className="mt-3 text-sm text-gray-500">
            Pressione <span className="font-semibold">Enter</span> para enviar ou use o botao
            <span className="font-semibold"> Enviar</span>.
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <h2 className="text-xl font-semibold text-gray-900">Simular mensagem do cliente</h2>

          <div className="mt-4 flex gap-3">
            <input
              value={simulatedCustomerMessage}
              onChange={(e) => setSimulatedCustomerMessage(e.target.value)}
              onKeyDown={handleSimulatedCustomerKeyDown}
              disabled={working || simulatingCustomer || !conversation}
              className="flex-1 rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black disabled:cursor-not-allowed disabled:bg-gray-100"
              placeholder={
                conversation
                  ? "Digite a mensagem do cliente e pressione Enter..."
                  : "Este lead ainda nao possui conversa disponivel."
              }
            />

            <button
              onClick={() => void simulateCustomerMessage()}
              disabled={!canSimulateCustomerMessage}
              className="rounded-xl bg-black px-6 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {simulatingCustomer ? "Simulando..." : "Simular cliente"}
            </button>
          </div>

          <div className="mt-3 text-sm text-gray-500">
            Use este campo para simular um cliente enviando mensagem para a IA.
          </div>
        </div>
      </div>
    </div>
  );
}
