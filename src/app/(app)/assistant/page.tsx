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

function bubbleClass(message: AssistantMessage) {
  if (message.sender_role === "assistant_operational") {
    return "ml-auto bg-black text-white";
  }

  if (message.sender_role === "store_responsible") {
    return "ml-auto bg-blue-50 text-gray-900 ring-1 ring-blue-200";
  }

  return "bg-white text-gray-900 ring-1 ring-black/10";
}

function senderLabel(message: AssistantMessage) {
  if (message.sender_role === "assistant_operational") return "Assistente";
  if (message.sender_role === "store_responsible") return "Responsável";
  return "Sistema";
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
  const restoredScrollRef = useRef(false);

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
    if (restoredScrollRef.current) return;

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
      restoredScrollRef.current = true;
    });
  }, [loading]);

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

  if (loading) {
    return <div className="p-6">Carregando assistente...</div>;
  }

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
          <div className="mb-4 rounded-xl bg-red-50 p-4 text-red-800 ring-1 ring-red-200">
            {errorText}
          </div>
        ) : null}

        {statusText ? (
          <div className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200">
            {statusText}
          </div>
        ) : null}

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-sm text-gray-500">Thread</div>
            <div className="mt-2 text-2xl font-bold text-gray-900">{summary?.title || "Assistente da Loja"}</div>
            <div className="mt-2 text-xs text-gray-500">ID: {shortId(summary?.thread_id)}</div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-sm text-gray-500">Mensagens</div>
            <div className="mt-2 text-2xl font-bold text-gray-900">{summary?.total_messages ?? messages.length}</div>
            <div className="mt-2 text-xs text-gray-500">
              Última mensagem: {formatDateTime(summary?.last_message_at || null)}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-sm text-gray-500">Pendências da assistente</div>
            <div className="mt-2 text-2xl font-bold text-gray-900">{summary?.pending_notifications ?? 0}</div>
            <div className="mt-2 text-xs text-gray-500">Status da thread: {summary?.status || "active"}</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
          <div className="border-b border-black/5 px-4 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Canal do responsável</h2>
            <p className="mt-2 text-sm text-gray-600">
              Esta aba é separada da Inbox comercial. Aqui o responsável fala com a assistente operacional da loja.
            </p>
          </div>

          <div className="border-b border-black/5 p-4">
            <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
              <div className="text-sm font-semibold text-gray-900">Último resumo</div>
              <div className="mt-3 text-sm text-gray-700">
                {summary?.last_message_preview || "Ainda não há mensagens nesta thread."}
              </div>
            </div>
          </div>

          <div className="space-y-3 border-b border-black/5 p-4">
            {messages.length === 0 ? (
              <div className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 ring-1 ring-black/5">
                Nenhuma mensagem ainda. Você já pode enviar a primeira mensagem para a assistente.
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-3xl rounded-2xl px-4 py-3 ${bubbleClass(message)}`}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-80">
                    <span className="font-semibold">{senderLabel(message)}</span>
                    <span>•</span>
                    <span>{formatMessageType(message.message_type)}</span>
                    <span>•</span>
                    <span>{formatDateTime(message.created_at)}</span>
                  </div>

                  <div className="mt-2 whitespace-pre-wrap break-words text-sm">{message.content}</div>
                </div>
              ))
            )}
          </div>

          <div className="p-4">
            <div className="mb-3 text-base font-semibold text-gray-900">Falar com a assistente</div>
            <textarea
              value={newMessage}
              onChange={(event) => setNewMessage(event.target.value)}
              placeholder="Ex.: Me atualize sobre os atendimentos mais urgentes de hoje."
              className="min-h-[120px] w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none ring-0 placeholder:text-gray-400 focus:border-gray-400"
            />

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => void sendMessageToAssistant()}
                disabled={sending || !newMessage.trim()}
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "Enviando..." : "Enviar para assistente"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
