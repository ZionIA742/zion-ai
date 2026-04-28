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
  const [searchOpen, setSearchOpen] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const firstLoadDoneRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(false);
  const lastMessageCountRef = useRef(0);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const canLoad = useMemo(() => {
    return !storeLoading && !!organizationId && !!activeStoreId;
  }, [storeLoading, organizationId, activeStoreId]);

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    window.requestAnimationFrame(() => {
      const node = chatScrollRef.current;
      if (!node) return;

      node.scrollTo({
        top: node.scrollHeight,
        behavior,
      });

      chatBottomRef.current?.scrollIntoView({
        behavior,
        block: "end",
      });
    });
  }, []);

  const loadAssistant = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!canLoad || !organizationId || !activeStoreId) return;

      const silent = options?.silent ?? false;
      if (silent) setRefreshing(true);
      else setLoading(true);

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
    if (loading || searchOpen) return;

    const hasNewMessages = messages.length > lastMessageCountRef.current;
    const shouldAutoScroll = !firstLoadDoneRef.current || hasNewMessages || forceScrollToBottomRef.current;

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

  if (loading) {
    return <div className="p-6">Carregando assistente...</div>;
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-white">
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
          <div className="mb-4 rounded-xl bg-red-50 p-4 text-red-800 ring-1 ring-red-200">{errorText}</div>
        ) : null}

        {statusText ? (
          <div className="mb-4 rounded-xl bg-gray-100 p-4 text-sm text-gray-800 ring-1 ring-black/10">{statusText}</div>
        ) : null}

        <section className="mb-4 rounded-3xl bg-white shadow-sm ring-1 ring-black/10 overflow-hidden">
          <div className="px-4 py-3 md:px-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="text-base font-bold text-gray-900">Canal do responsável</div>
                <div className="mt-1 inline-flex items-center rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600 ring-1 ring-black/5">
                  Thread principal da assistente
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 md:flex md:flex-wrap md:items-center">
                <div className="rounded-2xl border border-black/10 bg-white px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Thread</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">{summary?.title || "Assistente da Loja"}</div>
                </div>

                <div className="rounded-2xl border border-black/10 bg-white px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Mensagens</div>
                  <div className="mt-1 text-lg font-bold text-gray-900">{summary?.total_messages ?? messages.length}</div>
                </div>

                <div className="rounded-2xl border border-black/10 bg-white px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Pendências</div>
                  <div className="mt-1 text-lg font-bold text-gray-900">{summary?.pending_notifications ?? 0}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="min-w-0 rounded-3xl bg-white shadow-sm ring-1 ring-black/10 overflow-hidden">
          <div className="border-b border-black/10 bg-white px-4 py-3 md:px-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-lg font-semibold text-gray-900">Assistente da loja</div>
                <div className="text-xs text-gray-500">Mensagens da assistente à esquerda e do responsável à direita.</div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSearchOpen((current) => !current);
                  if (searchOpen) setSearchText("");
                }}
                className="inline-flex items-center gap-2 self-start rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-800 ring-1 ring-black/10 hover:bg-gray-50"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                Buscar na conversa
              </button>
            </div>
          </div>

          <div className="relative grid min-h-[68vh] grid-cols-1">
            <div
              ref={chatScrollRef}
              onScroll={handleChatScroll}
              className={`overflow-y-auto px-3 py-4 md:px-5 ${searchOpen ? "md:pr-[380px]" : ""}`}
              style={{ height: "58vh", background: "#f8f8f8" }}
            >
              {groupedMessages.length === 0 ? (
                <div className="mx-auto max-w-md rounded-2xl bg-white px-4 py-6 text-center text-sm text-gray-500 ring-1 ring-black/10">
                  Nenhuma mensagem ainda. Você já pode enviar a primeira mensagem para a assistente.
                </div>
              ) : (
                groupedMessages.map((group) => (
                  <div key={group.dayKey} className="mb-5">
                    <div className="mb-4 flex justify-center">
                      <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-600 shadow-sm ring-1 ring-black/10">
                        {group.dayLabel}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {group.items.map((message) => (
                        <div
                          key={message.id}
                          ref={(node) => {
                            messageRefs.current[message.id] = node;
                          }}
                          className={`flex transition-shadow duration-200 ${bubbleWrapperClass(message)}`}
                        >
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
                      placeholder="Digite para buscar nesta conversa"
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
                      Procure por nome do cliente, telefone, data, compromisso ou qualquer palavra da conversa.
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

          <div className="border-t border-black/10 bg-white p-3 md:p-4">
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
                  className="rounded-full bg-black px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
