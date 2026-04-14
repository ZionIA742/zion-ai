"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useStoreContext } from "@/components/StoreProvider";

type InboxRow = {
  conversation_id: string;
  lead_id: string;
  store_id: string | null;
  status: string | null;
  is_human_active: boolean | null;
  conversation_created_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: string | null;
  last_message_sender: string | null;
};

type LeadRow = {
  id: string;
  name: string | null;
};

type FollowupCandidateRow = {
  conversation_id: string;
  lead_id: string;
  lead_name: string | null;
  lead_phone: string | null;
  conversation_status: string | null;
  is_human_active: boolean | null;
  last_customer_message_at: string | null;
  last_ai_message_at: string | null;
  hours_since_customer: number | null;
  suggested_action: string | null;
  blocked_reason: string | null;
};

type UnifiedConversationRow = {
  conversationId: string;
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  status: string | null;
  isHumanActive: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: string | null;
  lastMessageSender: string | null;
  followup: FollowupCandidateRow | null;
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function shortId(id: string) {
  if (!id) return "-";
  return id.slice(0, 8);
}

function isPendingReply(row: InboxRow) {
  return String(row.last_message_direction || "").toLowerCase() === "incoming";
}

function formatDirection(value: string | null) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "incoming") return "Cliente";
  if (normalized === "outgoing") return "Saída";
  return "-";
}

function formatBlockedReason(value: string | null) {
  const normalized = String(value || "").toLowerCase();

  if (!normalized) return "Liberado";
  if (normalized === "humano_ativo") return "Humano ativo";
  if (normalized === "aguardando_janela") return "Aguardando janela";
  if (normalized === "sem_mensagem_cliente") return "Sem mensagem do cliente";
  if (normalized === "cliente_ainda_recente") return "Cliente recente";
  if (normalized === "acao_ja_enfileirada") return "Ação já enfileirada";
  if (normalized === "followup_recente") return "Follow-up recente";

  return value || "-";
}

function formatSuggestedAction(value: string | null) {
  const normalized = String(value || "").toLowerCase();

  if (normalized === "followup_offer") return "Follow-up de proposta";
  if (normalized === "followup_visit") return "Follow-up de visita";

  return value || "-";
}

function formatStoppedTime(hours: number | null) {
  if (hours == null || Number.isNaN(hours)) return "-";

  const days = hours / 24;
  if (days >= 1) {
    return `${days.toFixed(1)} dia(s) • ${hours.toFixed(1)}h`;
  }

  return `${hours.toFixed(1)}h`;
}

function chipClasses(kind: "ok" | "warn" | "human" | "ia" | "pending" | "neutral") {
  if (kind === "ok") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (kind === "warn") return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  if (kind === "human") return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
  if (kind === "pending") return "bg-amber-100 text-amber-800 ring-1 ring-amber-300";
  if (kind === "neutral") return "bg-gray-100 text-gray-700 ring-1 ring-black/10";
  return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
}

export default function InboxPage() {
  const {
    loading: storeLoading,
    error: storeError,
    organizationId,
    activeStoreId,
    activeStore,
  } = useStoreContext();

  const [rows, setRows] = useState<InboxRow[]>([]);
  const [leadNames, setLeadNames] = useState<Record<string, string>>({});
  const [followupRows, setFollowupRows] = useState<FollowupCandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [followupErrorText, setFollowupErrorText] = useState<string | null>(null);
  const [followupStatusText, setFollowupStatusText] = useState<string | null>(null);
  const [triggeringConversationId, setTriggeringConversationId] = useState<string | null>(null);

  const canLoadInbox = useMemo(() => {
    return !storeLoading && !!organizationId;
  }, [storeLoading, organizationId]);

  const loadFollowupCandidates = useCallback(async () => {
    if (!organizationId) return;

    const { data, error } = await supabase.rpc(
      "panel_list_followup_candidates_scoped",
      {
        p_organization_id: organizationId,
        p_store_id: activeStoreId ?? null,
        p_followup_type: "offer",
        p_min_hours_since_customer: 24,
        p_limit: 100,
      }
    );

    if (error) {
      console.error("[InboxPage] panel_list_followup_candidates_scoped error:", error);
      setFollowupErrorText(error.message);
      setFollowupRows([]);
      return;
    }

    setFollowupErrorText(null);
    setFollowupRows((data || []) as FollowupCandidateRow[]);
  }, [organizationId, activeStoreId]);

  const loadInbox = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (!canLoadInbox || !organizationId) return;

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setErrorText(null);

      const { data, error } = await supabase.rpc("panel_list_inbox", {
        p_organization_id: organizationId,
        p_store_id: activeStoreId ?? null,
        p_limit: 100,
        p_offset: 0,
      });

      if (error) {
        console.error("[InboxPage] panel_list_inbox error:", error);
        setErrorText(error.message);

        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
        return;
      }

      const inboxRows = (data || []) as InboxRow[];
      setRows(inboxRows);

      const leadIds = [...new Set(inboxRows.map((row) => row.lead_id).filter(Boolean))];

      if (leadIds.length > 0) {
        const { data: leads, error: leadsError } = await supabase
          .from("leads")
          .select("id, name")
          .in("id", leadIds);

        if (leadsError) {
          console.error("[InboxPage] erro ao carregar nomes dos leads:", leadsError);
        }

        const map: Record<string, string> = {};
        (leads || []).forEach((lead: LeadRow) => {
          map[lead.id] = lead.name || "Lead sem nome";
        });
        setLeadNames(map);
      } else {
        setLeadNames({});
      }

      await loadFollowupCandidates();

      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    },
    [canLoadInbox, organizationId, activeStoreId, loadFollowupCandidates]
  );

  useEffect(() => {
    if (!canLoadInbox) return;
    void loadInbox();
  }, [canLoadInbox, loadInbox]);

  useEffect(() => {
    if (!canLoadInbox) return;

    const interval = window.setInterval(() => {
      void loadInbox({ silent: true });
    }, 10000);

    return () => window.clearInterval(interval);
  }, [canLoadInbox, loadInbox]);

  const followupByConversation = useMemo(() => {
    const map = new Map<string, FollowupCandidateRow>();
    for (const row of followupRows) {
      map.set(row.conversation_id, row);
    }
    return map;
  }, [followupRows]);

  const unifiedRows = useMemo(() => {
    const byConversation = new Map<string, UnifiedConversationRow>();

    for (const row of rows) {
      const followup = followupByConversation.get(row.conversation_id) || null;

      byConversation.set(row.conversation_id, {
        conversationId: row.conversation_id,
        leadId: row.lead_id,
        leadName:
          leadNames[row.lead_id] || followup?.lead_name || `Lead ${shortId(row.lead_id)}`,
        leadPhone: followup?.lead_phone || null,
        status: row.status || followup?.conversation_status || null,
        isHumanActive: row.is_human_active === true || followup?.is_human_active === true,
        lastMessageAt: row.last_message_at || followup?.last_customer_message_at || null,
        lastMessagePreview: row.last_message_preview || null,
        lastMessageDirection: row.last_message_direction || null,
        lastMessageSender: row.last_message_sender || null,
        followup,
      });
    }

    for (const row of followupRows) {
      if (byConversation.has(row.conversation_id)) continue;

      byConversation.set(row.conversation_id, {
        conversationId: row.conversation_id,
        leadId: row.lead_id,
        leadName: row.lead_name || `Lead ${shortId(row.lead_id)}`,
        leadPhone: row.lead_phone || null,
        status: row.conversation_status || null,
        isHumanActive: row.is_human_active === true,
        lastMessageAt: row.last_customer_message_at || row.last_ai_message_at || null,
        lastMessagePreview: null,
        lastMessageDirection: null,
        lastMessageSender: null,
        followup: row,
      });
    }

    return Array.from(byConversation.values()).sort((a, b) => {
      const da = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const db = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return db - da;
    });
  }, [rows, followupRows, leadNames, followupByConversation]);

  const pendingReplyCount = useMemo(() => rows.filter(isPendingReply).length, [rows]);
  const actionableFollowupCount = useMemo(
    () => followupRows.filter((row) => !row.blocked_reason).length,
    [followupRows]
  );

  async function triggerManualFollowup(conversation: UnifiedConversationRow) {
    if (!organizationId) {
      setFollowupErrorText("Organização não carregada.");
      return;
    }

    if (!conversation.followup) {
      setFollowupErrorText("Esta conversa não está elegível para follow-up.");
      return;
    }

    setTriggeringConversationId(conversation.conversationId);
    setFollowupErrorText(null);
    setFollowupStatusText(null);

    const followupType =
      String(conversation.followup.suggested_action || "").toLowerCase() === "followup_visit"
        ? "visit"
        : "offer";

    const { data, error } = await supabase.rpc("panel_enqueue_followup_scoped", {
      p_organization_id: organizationId,
      p_conversation_id: conversation.conversationId,
      p_followup_type: followupType,
    });

    if (error) {
      console.error("[InboxPage] panel_enqueue_followup_scoped error:", error);
      setFollowupErrorText(error.message);
      setTriggeringConversationId(null);
      return;
    }

    const result = (data || {}) as {
      ok?: boolean;
      error?: string;
      blocked_reason?: string;
      conversation_id?: string;
    };

    if (!result.ok) {
      setFollowupErrorText(
        result.error
          ? `Não foi possível enfileirar o follow-up: ${result.error}${
              result.blocked_reason ? ` (${formatBlockedReason(result.blocked_reason)})` : ""
            }`
          : "Não foi possível enfileirar o follow-up."
      );
      setTriggeringConversationId(null);
      await loadFollowupCandidates();
      return;
    }

    setFollowupStatusText(
      `Follow-up enfileirado com sucesso para a conversa ${shortId(
        result.conversation_id || conversation.conversationId
      )}.`
    );
    setTriggeringConversationId(null);
    await loadFollowupCandidates();
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-gray-100">
      <div className="mx-auto max-w-7xl overflow-x-hidden px-6 py-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
            <p className="mt-1 text-sm text-gray-600">
              Conversas reais vindas da função oficial do backend.
            </p>
            <div className="mt-2 text-xs text-gray-500">
              {storeLoading
                ? "Carregando contexto da loja..."
                : storeError
                ? `Erro no contexto da loja: ${storeError}`
                : `Loja ativa: ${activeStore?.name ?? "Todas"} • Organização: ${
                    organizationId ?? "-"
                  }`}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {refreshing ? (
              <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 ring-1 ring-black/10">
                Atualizando...
              </div>
            ) : null}

            <button
              onClick={() => void loadInbox()}
              disabled={loading || storeLoading || !organizationId}
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

        {followupErrorText ? (
          <div className="mb-4 rounded-xl bg-red-50 p-4 text-red-800 ring-1 ring-red-200">
            {followupErrorText}
          </div>
        ) : null}

        {followupStatusText ? (
          <div className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200">
            {followupStatusText}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
          <div className="border-b border-black/5 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Inbox operacional</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Tudo em um único bloco: últimas mensagens, status e follow-up.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${chipClasses("pending")}`}>
                  {pendingReplyCount} pendente(s)
                </span>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 ring-1 ring-black/10">
                  {actionableFollowupCount} follow-up liberado(s)
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-3 p-4">
            {loading || storeLoading ? (
              <div className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 ring-1 ring-black/5">
                Carregando inbox...
              </div>
            ) : unifiedRows.length === 0 ? (
              <div className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 ring-1 ring-black/5">
                Nenhuma conversa encontrada para a loja atual.
              </div>
            ) : (
              unifiedRows.map((row) => {
                const pending = rows.some(
                  (r) => r.conversation_id === row.conversationId && isPendingReply(r)
                );
                const followupBlocked = !!row.followup?.blocked_reason;
                const followupText = row.followup
                  ? formatBlockedReason(row.followup.blocked_reason)
                  : "Sem regra";
                const followupActionText = row.followup
                  ? formatSuggestedAction(row.followup.suggested_action)
                  : null;
                const isTriggering = triggeringConversationId === row.conversationId;

                return (
                  <div
                    key={row.conversationId}
                    className={`rounded-2xl px-4 py-4 ring-1 ring-black/5 ${
                      pending ? "bg-amber-50" : "bg-gray-50"
                    }`}
                  >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                          <div className="text-lg font-semibold text-gray-900">{row.leadName}</div>
                          <span className="text-xs text-gray-500">
                            {row.leadPhone ? `${row.leadPhone} • ` : ""}
                            {shortId(row.conversationId)}
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-gray-700 ring-1 ring-black/10">
                            {row.status || "-"}
                          </span>

                          <span
                            className={`rounded-full px-2.5 py-1 font-semibold ${
                              row.isHumanActive ? chipClasses("human") : chipClasses("ia")
                            }`}
                          >
                            {row.isHumanActive ? "Humano" : "IA"}
                          </span>

                          {pending ? (
                            <span className={`rounded-full px-2.5 py-1 font-semibold ${chipClasses("pending")}`}>
                              Cliente aguardando resposta
                            </span>
                          ) : (
                            <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-gray-700 ring-1 ring-black/10">
                              {formatDirection(row.lastMessageDirection)}
                              {row.lastMessageSender ? ` • ${row.lastMessageSender}` : ""}
                            </span>
                          )}

                          {row.followup ? (
                            <>
                              <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-gray-700 ring-1 ring-black/10">
                                {followupActionText}
                              </span>

                              <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-gray-700 ring-1 ring-black/10">
                                Parado: {formatStoppedTime(row.followup.hours_since_customer)}
                              </span>

                              <span
                                className={`rounded-full px-2.5 py-1 font-semibold ${
                                  followupBlocked ? chipClasses("warn") : chipClasses("ok")
                                }`}
                              >
                                {followupText}
                              </span>
                            </>
                          ) : null}
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Última mensagem
                            </div>
                            <div className="mt-1 text-sm text-gray-700">{formatDateTime(row.lastMessageAt)}</div>
                          </div>

                          <div className="min-w-0">
                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Preview
                            </div>
                            <div className="mt-1 break-words text-sm text-gray-700">
                              {row.lastMessagePreview || "-"}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
                        <Link
                          href={`/crm/lead/${row.leadId}`}
                          className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
                        >
                          Abrir
                        </Link>

                        {row.followup ? (
                          <button
                            onClick={() => void triggerManualFollowup(row)}
                            disabled={followupBlocked || isTriggering}
                            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isTriggering ? "Enfileirando..." : "Disparar follow-up"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
