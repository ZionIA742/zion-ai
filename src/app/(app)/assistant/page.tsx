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
  created_at: string | null;
};

const ASSISTANT_SCROLL_KEY = "zion:assistant:scroll";

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function shortId(id: string | null) {
  if (!id) return "-";
  return id.slice(0, 8);
}

function actorLabel(message: AssistantMessage) {
  const sender = String(message.sender || "").toLowerCase();
  const senderRole = String(message.sender_role || "").toLowerCase();

  if (senderRole === "assistant_operational" || sender === "assistant") {
    return "Assistente";
  }

  if (senderRole === "store_responsible" || sender === "human") {
    return "Responsável";
  }

  return "Sistema";
}

function bubbleClass(message: AssistantMessage) {
  const senderRole = String(message.sender_role || "").toLowerCase();
  const sender = String(message.sender || "").toLowerCase();

  if (senderRole === "assistant_operational" || sender === "assistant") {
    return "ml-auto bg-black text-white";
  }

  if (senderRole === "store_responsible" || sender === "human") {
    return "ml-auto bg-blue-50 text-gray-900 ring-1 ring-blue-200";
  }

  return "bg-white text-gray-900 ring-1 ring-black/10";
}

function messageTypeLabel(value: string | null) {
  const normalized = String(value || "").toLowerCase();

  if (normalized === "report_morning") return "Relatório da manhã";
  if (normalized === "report_evening") return "Relatório do fim do dia";
  if (normalized === "alert") return "Aviso";
  if (normalized === "context") return "Contexto";
  if (normalized === "followup_summary") return "Pós-compromisso";
  return "Mensagem";
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
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const restoredScrollRef = useRef(false);

  const canLoadAssistant = useMemo(() => {
    return !storeLoading && !!organizationId && !!activeStoreId;
  }, [storeLoading, organizationId, activeStoreId]);

  const loadAssistant = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (!canLoadAssistant || !organizationId || !activeStoreId) return;

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setErrorText(null);

      const ensureThread = await supabase.rpc("assistant_get_or_create_primary_thread", {
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
      });

      if (ensureThread.error) {
        console.error("[AssistantPage] assistant_get_or_create_primary_thread error:", ensureThread.error);
        setErrorText(ensureThread.error.message);
        if (silent) setRefreshing(false);
        else setLoading(false);
        return;
      }

      const [summaryResult, messagesResult] = await Promise.all([
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

      if (summaryResult.error) {
        console.error("[AssistantPage] assistant_get_thread_summary error:", summaryResult.error);
        setErrorText(summaryResult.error.message);
        if (silent) setRefreshing(false);
        else setLoading(false);
        return;
      }

      if (messagesResult.error) {
        console.error("[AssistantPage] assistant_list_messages error:", messagesResult.error);
        setErrorText(messagesResult.error.message);
        if (silent) setRefreshing(false);
        else setLoading(false);
        return;
      }

      const summaryData = Array.isArray(summaryResult.data)
        ? (summaryResult.data[0] ?? null)
        : ((summaryResult.data ?? null) as AssistantThreadSummary | null);

      setSummary((summaryData ?? null) as AssistantThreadSummary | null);
      setMessages(((messagesResult.data || []) as AssistantMessage[]) ?? []);

      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    },
    [canLoadAssistant, organizationId, activeStoreId]
  );

  useEffect(() => {
    if (!canLoadAssistant) return;
    void loadAssistant();
  }, [canLoadAssistant, loadAssistant]);

  useEffect(() => {
    if (!canLoadAssistant) return;

    const interval = window.setInterval(() => {
      void loadAssistant({ silent: true });
    }, 10000);

    return () => window.clearInterval(interval);
  }, [canLoadAssistant, loadAssistant]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const saveScroll = () => {
      window.sessionStorage.setItem(ASSISTANT_SCROLL_KEY, String(window.scrollY));
    };

    saveScroll();
    window.addEventListener("scroll", saveScroll, { passive: true });
    return () => window.removeEventListener("scroll", saveScroll);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loading || storeLoading) return;
    if (restoredScrollRef.current) return;

    const saved = window.sessionStorage.getItem(ASSISTANT_SCROLL_KEY);
    const parsed = saved ? Number(saved) : 0;

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: Number.isFinite(parsed) ? parsed : 0, behavior: "auto" });
      restoredScrollRef.current = true;
    });
  }, [loading, storeLoading]);

  async function sendMessage() {
    const text = newMessage.trim();

    if (!text || !organizationId || !activeStoreId) return;

    setSending(true);
    setErrorText(null);
    setStatusText(null);

    const { error } = await supabase.rpc("assistant_send_human_message", {
      p_organization_id: organizationId,
      p_store_id: activeStoreId,
      p_content: text,
    });

    if (error) {
      console.error("[AssistantPage] assistant_send_human_message error:", error);
      setErrorText(error.message);
      setSending(false);
      return;
    }

    setNewMessage("");
    setStatusText("Mensagem enviada para a assistente com sucesso.");
    setSending(false);
    await loadAssistant({ silent: true });
  }

  const canSendMessage =
    !!organizationId && !!activeStoreId && !sending && newMessage.trim().length > 0;

  return (
    <div className="min-h-screen overflow-x-hidden bg-gray-100">
      <div className="mx-auto max-w-7xl overflow-x-hidden px-6 py-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Assistente operacional</h1>
            <div className="mt-2 text-xs text-gray-500">
              {storeLoading
                ? "Carregando contexto da loja..."
                : storeError
                  ? `Erro no contexto da loja: ${storeError}`
                  : `Loja ativa: ${activeStore?.name ?? "-"} • Organização: ${organizationId ?? "-"}`}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {refreshing ? (
              <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 ring-1 ring-black/10">
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
          <div className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200">
            {statusText}
          </div>
        ) : null}

        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-sm text-gray-500">Thread</div>
            <div className="mt-1 text-lg font-semibold text-gray-900">
              {summary?.title || "Assistente da Loja"}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              ID: {shortId(summary?.thread_id ?? null)}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-sm text-gray-500">Mensagens</div>
            <div className="mt-1 text-lg font-semibold text-gray-900">
              {summary?.total_messages ?? 0}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Última mensagem: {formatDateTime(summary?.last_message_at ?? null)}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-sm text-gray-500">Pendências da assistente</div>
            <div className="mt-1 text-lg font-semibold text-gray-900">
              {summary?.pending_notifications ?? 0}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Status da thread: {summary?.status || "-"}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
          <div className="border-b border-black/5 px-4 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Canal do responsável</h2>
            <p className="mt-1 text-sm text-gray-600">
              Esta aba é separada da Inbox comercial. Aqui o responsável fala com a assistente operacional da loja.
            </p>
          </div>

          <div className="border-b border-black/5 p-4">
            <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
              <div className="text-sm font-semibold text-gray-900">Último resumo</div>
              <div className="mt-2 text-sm text-gray-700">
                {summary?.last_message_preview || "Ainda não há mensagens nesta thread."}
              </div>
            </div>
          </div>

          <div className="max-h-[520px] space-y-3 overflow-y-auto border-b border-black/5 p-4">
            {loading ? (
              <div className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 ring-1 ring-black/5">
                Carregando mensagens da assistente...
              </div>
            ) : messages.length === 0 ? (
              <div className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 ring-1 ring-black/5">
                Nenhuma mensagem ainda. Você já pode enviar a primeira mensagem para a assistente.
              </div>
            ) : (
              messages.map((message) => (
                <div key={message.id} className={`max-w-[85%] rounded-2xl px-4 py-3 ${bubbleClass(message)}`}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-medium opacity-80">
                    <span>{actorLabel(message)}</span>
                    <span>•</span>
                    <span>{messageTypeLabel(message.message_type)}</span>
                    <span>•</span>
                    <span>{formatDateTime(message.created_at)}</span>
                  </div>

                  <div className="whitespace-pre-wrap break-words text-sm">{message.content}</div>

                  {(message.related_lead_id || message.related_conversation_id || message.related_appointment_id) ? (
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] opacity-80">
                      {message.related_lead_id ? (
                        <span className="rounded-full bg-white/80 px-2 py-1 text-gray-700 ring-1 ring-black/10">
                          Lead: {shortId(message.related_lead_id)}
                        </span>
                      ) : null}
                      {message.related_conversation_id ? (
                        <span className="rounded-full bg-white/80 px-2 py-1 text-gray-700 ring-1 ring-black/10">
                          Conversa: {shortId(message.related_conversation_id)}
                        </span>
                      ) : null}
                      {message.related_appointment_id ? (
                        <span className="rounded-full bg-white/80 px-2 py-1 text-gray-700 ring-1 ring-black/10">
                          Compromisso: {shortId(message.related_appointment_id)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className="p-4">
            <div className="mb-2 text-sm font-semibold text-gray-900">Falar com a assistente</div>
            <div className="grid gap-3">
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Ex.: Me atualize sobre os atendimentos mais urgentes de hoje."
                rows={4}
                className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none ring-0 placeholder:text-gray-400 focus:border-gray-400"
              />

              <div className="flex justify-end">
                <button
                  onClick={() => void sendMessage()}
                  disabled={!canSendMessage}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? "Enviando..." : "Enviar para assistente"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
