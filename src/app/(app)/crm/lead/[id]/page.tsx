"use client";

import Link from "next/link";
import { KeyboardEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type Lead = {
  id: string;
  organization_id: string;
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
};

type MessageRow = {
  id: string;
  sender: string | null;
  content: string | null;
  direction: string | null;
  message_type: string | null;
  created_at: string | null;
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
    return "Saída";
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
  if (Number.isNaN(date.getTime())) return "Data inválida";
  return date.toLocaleString("pt-BR");
}

export default function LeadPage() {
  const params = useParams();
  const leadId = params.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
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
  const canTakeOver = hasConversation && !isHumanActive && !working && !simulatingCustomer;
  const canReleaseToAI = hasConversation && isHumanActive && !working && !simulatingCustomer;
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

    const { data: leadData, error: leadError } = await supabase
      .from("leads")
      .select("id, organization_id, name, phone, state")
      .eq("id", leadId)
      .single();

    if (leadError) {
      console.error("[LeadPage] erro ao buscar lead:", {
        message: (leadError as any)?.message ?? null,
        details: (leadError as any)?.details ?? null,
        hint: (leadError as any)?.hint ?? null,
        code: (leadError as any)?.code ?? null,
        full: leadError,
      });

      setErrorText(
        (leadError as any)?.message ?? "Erro desconhecido ao buscar o lead."
      );

      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
      return;
    }

    const {
      data: conversationsData,
      error: conversationsError,
    } = await supabase
      .from("conversations")
      .select("id, organization_id, lead_id, created_at, status, is_human_active")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (conversationsError) {
      console.error("[LeadPage] erro ao buscar conversations:", {
        message: (conversationsError as any)?.message ?? null,
        details: (conversationsError as any)?.details ?? null,
        hint: (conversationsError as any)?.hint ?? null,
        code: (conversationsError as any)?.code ?? null,
        full: conversationsError,
      });

      setErrorText(
        (conversationsError as any)?.message ??
          "Erro desconhecido ao buscar a conversa."
      );

      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
      return;
    }

    const latestConversation =
      conversationsData && conversationsData.length > 0
        ? (conversationsData[0] as Conversation)
        : null;

    let messagesData: MessageRow[] = [];
    let messagesError: any = null;

    if (latestConversation) {
      const messagesResult = await supabase
        .from("messages")
        .select("id, sender, content, direction, message_type, created_at")
        .eq("conversation_id", latestConversation.id)
        .order("created_at", { ascending: true });

      messagesData = (messagesResult.data || []) as MessageRow[];
      messagesError = messagesResult.error;
    }

    if (messagesError) {
      console.error("[LeadPage] erro ao buscar mensagens:", {
        message: (messagesError as any)?.message ?? null,
        details: (messagesError as any)?.details ?? null,
        hint: (messagesError as any)?.hint ?? null,
        code: (messagesError as any)?.code ?? null,
        full: messagesError,
      });

      setErrorText(
        (messagesError as any)?.message ??
          "Erro desconhecido ao buscar as mensagens."
      );

      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
      return;
    }

    setLead(leadData as Lead);
    setConversation(latestConversation);
    setMessages(messagesData);

    if (silent) {
      setRefreshing(false);
    } else {
      setLoading(false);
    }
  }

  async function takeOverConversation() {
    if (!lead || !conversation) {
      setErrorText("Não foi possível assumir: conversa não encontrada para este lead.");
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
      setErrorText("Não foi possível liberar: conversa não encontrada para este lead.");
      return;
    }

    setWorking(true);
    setErrorText(null);
    setStatusText(null);

    const { error } = await supabase.rpc("panel_release_conversation_to_ai_scoped", {
      p_organization_id: lead.organization_id,
      p_conversation_id: conversation.id,
      p_to_state: "qualificacao",
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

    setStatusText("IA liberada novamente.");
    setWorking(false);
    await fetchLeadConversationAndMessages({ silent: true });
  }

  async function sendMessage() {
    const text = newMessage.trim();

    if (!text) return;

    if (!lead || !conversation) {
      setErrorText("Não foi possível enviar: conversa não encontrada para este lead.");
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
      setErrorText("Não foi possível simular: conversa não encontrada para este lead.");
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
          conversationId: conversation.id,
          text,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result?.ok) {
        const aiMessage =
          result?.ai?.message ||
          result?.message ||
          result?.error ||
          "Erro ao simular mensagem do cliente.";

        setErrorText(String(aiMessage));
        setSimulatingCustomer(false);
        return;
      }

      setSimulatedCustomerMessage("");

      if (result?.ai?.ok === false) {
        setStatusText(
          "Mensagem do cliente simulada com sucesso. A IA foi acionada, mas não respondeu nesta tentativa."
        );
      } else {
        setStatusText("Mensagem do cliente simulada com sucesso.");
      }

      setSimulatingCustomer(false);
      await fetchLeadConversationAndMessages({ silent: true });
    } catch (error: any) {
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
    return <div className="p-6">Lead não encontrado</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-5">
          <Link
            href="/crm"
            className="inline-flex items-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
          >
            ← Voltar para o CRM
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
            <h1 className="text-2xl font-bold text-gray-900">Conversa do Lead</h1>

            {refreshing ? (
              <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 ring-1 ring-black/10">
                Atualizando...
              </div>
            ) : null}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-5">
            <div className="rounded-xl bg-gray-50 p-4 ring-1 ring-black/5">
              <div className="text-sm text-gray-500">Nome</div>
              <div className="mt-1 font-semibold text-gray-900">
                {lead.name ?? "Sem nome"}
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 p-4 ring-1 ring-black/5">
              <div className="text-sm text-gray-500">Telefone</div>
              <div className="mt-1 font-semibold text-gray-900">
                {lead.phone ?? "Sem telefone"}
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 p-4 ring-1 ring-black/5">
              <div className="text-sm text-gray-500">Etapa do lead</div>
              <div className="mt-1 font-semibold text-gray-900">{lead.state}</div>
            </div>

            <div className="rounded-xl bg-gray-50 p-4 ring-1 ring-black/5">
              <div className="text-sm text-gray-500">Conversa</div>
              <div className="mt-1 break-all font-semibold text-gray-900">
                {conversation?.id ?? "Sem conversa"}
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 p-4 ring-1 ring-black/5">
              <div className="text-sm text-gray-500">Status da conversa</div>
              <div className="mt-1 font-semibold text-gray-900">
                {conversation?.status ?? "Sem conversa"}
              </div>
              <div className="mt-2 text-xs text-gray-500">
                {conversation
                  ? isHumanActive
                    ? "Humano ativo"
                    : "IA ativa"
                  : "Nenhuma conversa disponível"}
              </div>
            </div>
          </div>

          {!conversation ? (
            <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-600/20">
              Este lead ainda não possui conversa. Os controles de assumir, liberar e responder ficam bloqueados até existir uma conversa.
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => void takeOverConversation()}
              disabled={!canTakeOver}
              className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isHumanActive ? "Conversa já assumida" : "Assumir conversa"}
            </button>

            <button
              onClick={() => void releaseConversation()}
              disabled={!canReleaseToAI}
              className="rounded-xl bg-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isHumanActive ? "Liberar IA" : "IA já está liberada"}
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
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-gray-900">Mensagens</h2>
            <div className="text-sm text-gray-500">
              {messages.length} mensagem(ns)
            </div>
          </div>

          {!conversation ? (
            <div className="mt-6 rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">
              Este lead ainda não possui conversa criada.
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
                      {message.content || "(mensagem sem conteúdo textual)"}
                    </div>

                    <div className="mt-2 text-[11px] opacity-70">
                      {formatDateTime(message.created_at)}
                      {message.message_type ? ` • ${message.message_type}` : ""}
                      {message.direction ? ` • ${message.direction}` : ""}
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
                  : "Este lead ainda não possui conversa disponível."
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
            Pressione <span className="font-semibold">Enter</span> para enviar ou use o botão
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
                  : "Este lead ainda não possui conversa disponível."
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