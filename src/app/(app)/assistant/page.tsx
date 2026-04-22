"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useStoreContext } from "@/components/StoreProvider";

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
  if (isAssistantBubble(message)) {
    return "justify-start";
  }

  if (message.sender_role === "store_responsible") {
    return "justify-end";
  }

  return "justify-center";
}

function bubbleClass(message: AssistantMessage) {
  if (isAssistantBubble(message)) {
    return "bg-white text-gray-900 ring-1 ring-black/10 rounded-2xl rounded-bl-md";
  }

  if (message.sender_role === "store_responsible") {
    return "bg-[#dcf8c6] text-gray-900 ring-1 ring-black/5 rounded-2xl rounded-br-md";
  }

  return "bg-gray-100 text-gray-800 ring-1 ring-black/5 rounded-2xl";
}

function normalizeText(value: string | null | undefined) {
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

export default function AssistantPage() {
  const {
    loading: storeLoading,
    error: storeError,
    organizationId,
    activeStoreId,
    activeStore,
  } = useStoreContext();

  const [summary, setSummary] = useState<AssistantThreadSummary | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [searchText, setSearchText] = useState("");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const firstLoadDoneRef = useRef(false);

  const canLoad = useMemo(() => {
    return !storeLoading && !!organizationId && !!activeStoreId;
  }, [storeLoading, organizationId, activeStoreId]);

  const loadAssistant = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!canLoad || !organizationId || !activeStoreId) return;

      const silent = options?.silent ?? false;
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setErrorText(null);

      const [{ data: summaryData, error: summaryError }, { data: messagesData, error: messagesError }] =
        await Promise.all([
          supabase.rpc("assistant_get_thread_summary", {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
          }),
          supabase.rpc("assistant_list_messages", {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_limit: 200,
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

      setSummary(summaryRow);
      setMessages((messagesData || []) as AssistantMessage[]);

      if (silent) setRefreshing(false);
      else setLoading(false);
    },
    [canLoad, organizationId, activeStoreId]
  );

  useEffect(() => {
    if (!canLoad) return;
    void loadAssistant();
  }, [canLoad, loadAssistant]);

  useEffect(() => {
    if (!canLoad) return;

    const interval = window.setInterval(() => {
      void loadAssistant({ silent: true });
    }, 10000);

    return () => window.clearInterval(interval);
  }, [canLoad, loadAssistant]);

  useEffect(() => {
    if (loading) return;

    window.requestAnimationFrame(() => {
      if (!chatScrollRef.current) return;
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: firstLoadDoneRef.current ? "smooth" : "auto",
      });
      firstLoadDoneRef.current = true;
    });
  }, [messages, loading]);

  async function sendMessageToAssistant() {
    const text = newMessage.trim();

    if (!text) return;
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
    setStatusText("Mensagem enviada. Gerando resposta da assistente...");
    await loadAssistant({ silent: true });

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
      await loadAssistant({ silent: true });
    } catch (error: any) {
      setErrorText(error?.message || "Erro inesperado ao gerar resposta da assistente.");
      setSending(false);
      await loadAssistant({ silent: true });
    }
  }

  const filteredMessages = useMemo(() => {
    return messages.filter((message) => matchesSearch(message, searchText));
  }, [messages, searchText]);

  const groupedMessages = useMemo(() => {
    const groups: Array<{ dayKey: string; dayLabel: string; items: AssistantMessage[] }> = [];

    filteredMessages.forEach((message) => {
      const dayKey = toDayKey(message.created_at);
      const existing = groups[groups.length - 1];
      if (!existing || existing.dayKey !== dayKey) {
        groups.push({
          dayKey,
          dayLabel: formatDayDivider(message.created_at),
          items: [message],
        });
        return;
      }

      existing.items.push(message);
    });

    return groups;
  }, [filteredMessages]);

  if (loading) {
    return <div className="p-6">Carregando assistente...</div>;
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#efeae2]">
      <div className="mx-auto max-w-7xl px-4 py-4 md:px-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Assistente operacional</h1>
            <div className="mt-1 text-xs text-gray-500">
              {storeLoading
                ? "Carregando contexto da loja..."
                : storeError
                  ? `Erro no contexto da loja: ${storeError}`
                  : `Loja ativa: ${activeStore?.name ?? "-"} • Organização: ${organizationId ?? "-"}`}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {refreshing ? (
              <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-600 ring-1 ring-black/10">
                Atualizando...
              </div>
            ) : null}

            <button
              onClick={() => void loadAssistant()}
              disabled={loading || storeLoading || !organizationId || !activeStoreId}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Recarregar
            </button>
          </div>
        </div>

        {errorText ? (
          <div className="mb-4 rounded-xl bg-red-50 p-4 text-red-800 ring-1 ring-red-200">
            {errorText}
          </div>
        ) : null}

        {statusText ? (
          <div className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200">
            {statusText}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-3xl bg-[#f0f2f5] shadow-sm ring-1 ring-black/5 overflow-hidden">
            <div className="border-b border-black/5 bg-[#008069] px-4 py-4 text-white">
              <div className="text-lg font-bold">Canal do responsável</div>
              <div className="mt-1 text-xs text-white/80">Conversa separada da Inbox comercial.</div>
            </div>

            <div className="space-y-4 p-4">
              <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                <div className="text-xs uppercase tracking-wide text-gray-500">Thread</div>
                <div className="mt-2 text-lg font-bold text-gray-900">{summary?.title || "Assistente da Loja"}</div>
                <div className="mt-2 text-xs text-gray-500">ID: {shortId(summary?.thread_id)}</div>
              </div>

              <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                <div className="text-xs uppercase tracking-wide text-gray-500">Resumo rápido</div>
                <div className="mt-2 text-sm text-gray-700">
                  {summary?.last_message_preview || "Ainda não há mensagens nesta thread."}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Mensagens</div>
                  <div className="mt-2 text-2xl font-bold text-gray-900">{summary?.total_messages ?? messages.length}</div>
                  <div className="mt-2 text-xs text-gray-500">Última: {formatDateTime(summary?.last_message_at || null)}</div>
                </div>

                <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Pendências</div>
                  <div className="mt-2 text-2xl font-bold text-gray-900">{summary?.pending_notifications ?? 0}</div>
                  <div className="mt-2 text-xs text-gray-500">Status: {summary?.status || "active"}</div>
                </div>
              </div>
            </div>
          </aside>

          <section className="min-w-0 rounded-3xl bg-[#efeae2] shadow-sm ring-1 ring-black/5 overflow-hidden">
            <div className="border-b border-black/5 bg-[#f0f2f5] px-4 py-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-lg font-semibold text-gray-900">Assistente da loja</div>
                  <div className="text-xs text-gray-500">Mensagens da assistente à esquerda e do responsável à direita.</div>
                </div>

                <div className="w-full md:max-w-sm">
                  <label className="flex items-center gap-2 rounded-full bg-white px-4 py-2 ring-1 ring-black/10">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                    <input
                      value={searchText}
                      onChange={(event) => setSearchText(event.target.value)}
                      placeholder="Buscar mensagens nesta conversa"
                      className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div
              ref={chatScrollRef}
              className="h-[58vh] overflow-y-auto px-3 py-4 md:px-5"
              style={{ backgroundImage: "linear-gradient(rgba(239,234,226,0.96), rgba(239,234,226,0.96))" }}
            >
              {groupedMessages.length === 0 ? (
                <div className="mx-auto max-w-md rounded-2xl bg-white px-4 py-6 text-center text-sm text-gray-500 ring-1 ring-black/5">
                  {searchText.trim()
                    ? "Não achei nenhuma mensagem com esse termo."
                    : "Nenhuma mensagem ainda. Você já pode enviar a primeira mensagem para a assistente."}
                </div>
              ) : (
                groupedMessages.map((group) => (
                  <div key={group.dayKey} className="mb-5">
                    <div className="mb-4 flex justify-center">
                      <div className="rounded-full bg-[#d9fdd3] px-3 py-1 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-black/5">
                        {group.dayLabel}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {group.items.map((message) => (
                        <div key={message.id} className={`flex ${bubbleWrapperClass(message)}`}>
                          <div className={`max-w-[92%] md:max-w-[75%] px-4 py-3 shadow-sm ${bubbleClass(message)}`}>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
                              <span className="font-semibold text-gray-700">{senderLabel(message)}</span>
                              <span>•</span>
                              <span>{formatMessageType(message.message_type)}</span>
                              <span>•</span>
                              <span>{formatTime(message.created_at)}</span>
                            </div>

                            <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-900">
                              {message.content}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-black/5 bg-[#f0f2f5] p-3 md:p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="min-w-0 flex-1">
                  <textarea
                    value={newMessage}
                    onChange={(event) => setNewMessage(event.target.value)}
                    placeholder="Ex.: Me atualize sobre os atendimentos mais urgentes de hoje."
                    className="min-h-[96px] w-full resize-none rounded-3xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-400"
                  />
                </div>

                <div className="flex justify-end md:pb-1">
                  <button
                    onClick={() => void sendMessageToAssistant()}
                    disabled={sending || !newMessage.trim()}
                    className="rounded-full bg-[#008069] px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sending ? "Enviando..." : "Enviar"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
