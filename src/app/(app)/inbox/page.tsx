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

  if (!normalized) return "-";
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

function formatDaysStopped(hours: number | null) {
  if (hours == null || Number.isNaN(hours)) return "-";

  const days = hours / 24;

  if (days >= 1) {
    return `${days.toFixed(1)}d • ${hours.toFixed(1)}h`;
  }

  return `${hours.toFixed(1)}h`;
}

function chipClasses(kind: "ok" | "warn" | "blocked" | "human" | "ia") {
  if (kind === "ok") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  }

  if (kind === "warn") {
    return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  }

  if (kind === "blocked") {
    return "bg-gray-100 text-gray-700 ring-1 ring-black/10";
  }

  if (kind === "human") {
    return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
  }

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
        p_limit: 20,
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

    return () => {
      window.clearInterval(interval);
    };
  }, [canLoadInbox, loadInbox]);

  const pendingReplyCount = useMemo(() => {
    return rows.filter(isPendingReply).length;
  }, [rows]);

  const actionableFollowupCount = useMemo(() => {
    return followupRows.filter((row) => !row.blocked_reason).length;
  }, [followupRows]);

  async function triggerManualFollowup(candidate: FollowupCandidateRow) {
    if (!organizationId) {
      setFollowupErrorText("Organização não carregada.");
      return;
    }

    setTriggeringConversationId(candidate.conversation_id);
    setFollowupErrorText(null);
    setFollowupStatusText(null);

    const followupType =
      String(candidate.suggested_action || "").toLowerCase() === "followup_visit"
        ? "visit"
        : "offer";

    const { data, error } = await supabase.rpc("panel_enqueue_followup_scoped", {
      p_organization_id: organizationId,
      p_conversation_id: candidate.conversation_id,
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
      next_action?: string;
      ai_run_id?: string;
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
        result.conversation_id || candidate.conversation_id
      )}.`
    );
    setTriggeringConversationId(null);
    await loadFollowupCandidates();
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 flex items-center justify-between gap-4">
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

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
          <div className="border-b border-black/5 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Inbox operacional</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Conversas pendentes e candidatas a follow-up dentro de um único bloco.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                  {pendingReplyCount} pendente(s)
                </span>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 ring-1 ring-black/5">
                  {actionableFollowupCount} follow-up liberado(s)
                </span>
              </div>
            </div>
          </div>

          {followupErrorText ? (
            <div className="mx-4 mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
              {followupErrorText}
            </div>
          ) : null}

          {followupStatusText ? (
            <div className="mx-4 mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200">
              {followupStatusText}
            </div>
          ) : null}

          <div className="border-b border-black/5 px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Candidatas a follow-up</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Conversas frias que podem receber follow-up manual controlado.
                </p>
              </div>

              <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 ring-1 ring-black/5">
                {actionableFollowupCount} liberada(s) / {followupRows.length} total
              </div>
            </div>

            <div className="space-y-3">
              {!loading && followupRows.length === 0 ? (
                <div className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 ring-1 ring-black/5">
                  Nenhuma candidata a follow-up encontrada.
                </div>
              ) : (
                followupRows.map((row) => {
                  const blocked = !!row.blocked_reason;
                  const isTriggering = triggeringConversationId === row.conversation_id;

                  return (
                    <div
                      key={row.conversation_id}
                      className="rounded-2xl bg-gray-50 px-4 py-4 ring-1 ring-black/5"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-gray-900">
                            {row.lead_name || `Lead ${shortId(row.lead_id)}`}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {row.lead_phone || "-"} • {shortId(row.conversation_id)}
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-gray-700 ring-1 ring-black/10">
                              {row.conversation_status || "-"}
                            </span>

                            <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-gray-700 ring-1 ring-black/10">
                              Último cliente: {formatDateTime(row.last_customer_message_at)}
                            </span>

                            <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-gray-700 ring-1 ring-black/10">
                              Parado: {formatDaysStopped(row.hours_since_customer)}
                            </span>

                            <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-gray-700 ring-1 ring-black/10">
                              {formatSuggestedAction(row.suggested_action)}
                            </span>

                            {blocked ? (
                              <span
                                className={`rounded-full px-2.5 py-1 font-semibold ${chipClasses(
                                  "warn"
                                )}`}
                              >
                                {formatBlockedReason(row.blocked_reason)}
                              </span>
                            ) : (
                              <span
                                className={`rounded-full px-2.5 py-1 font-semibold ${chipClasses(
                                  "ok"
                                )}`}
                              >
                                Liberado
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <Link
                            href={`/crm/lead/${row.lead_id}`}
                            className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
                          >
                            Abrir
                          </Link>

                          <button
                            onClick={() => void triggerManualFollowup(row)}
                            disabled={blocked || isTriggering}
                            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isTriggering ? "Enfileirando..." : "Disparar follow-up"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Últimas mensagens</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Conversas mais recentes da loja.
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl ring-1 ring-black/5">
              <table className="w-full text-sm">
                <thead className="border-b border-black/5 bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Lead</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Modo</th>
                    <th className="px-4 py-3 font-semibold">Última mensagem</th>
                    <th className="px-4 py-3 font-semibold">Preview</th>
                    <th className="px-4 py-3 font-semibold">Alerta</th>
                    <th className="px-4 py-3 font-semibold text-right">Ação</th>
                  </tr>
                </thead>

                <tbody>
                  {(loading || storeLoading) && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                        Carregando inbox...
                      </td>
                    </tr>
                  )}

                  {!loading && !storeLoading && rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                        Nenhuma conversa encontrada para a loja atual.
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    !storeLoading &&
                    rows.map((row) => {
                      const isPending = isPendingReply(row);

                      return (
                        <tr
                          key={row.conversation_id}
                          className={`border-b border-black/5 ${
                            isPending ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-gray-50"
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold text-gray-900">
                              {leadNames[row.lead_id] || `Lead ${shortId(row.lead_id)}`}
                            </div>

                            <div className="text-xs text-gray-500">
                              {shortId(row.conversation_id)}
                            </div>
                          </td>

                          <td className="px-4 py-3">{row.status || "-"}</td>

                          <td className="px-4 py-3">
                            {row.is_human_active ? (
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${chipClasses("human")}`}>
                                Humano
                              </span>
                            ) : (
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${chipClasses("ia")}`}>
                                IA
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3">{formatDateTime(row.last_message_at)}</td>

                          <td className="max-w-md truncate px-4 py-3 text-gray-600">
                            {row.last_message_preview || "-"}
                          </td>

                          <td className="px-4 py-3">
                            {isPending ? (
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${chipClasses("warn")}`}>
                                Pendente
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}

                            <div className="mt-1 text-[11px] text-gray-500">
                              {formatDirection(row.last_message_direction)}
                              {row.last_message_sender ? ` • ${row.last_message_sender}` : ""}
                            </div>
                          </td>

                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/crm/lead/${row.lead_id}`}
                              className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
                            >
                              Abrir
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
