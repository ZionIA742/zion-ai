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
};

type LeadRow = {
  id: string;
  name: string | null;
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const canLoadInbox = useMemo(() => {
    return !storeLoading && !!organizationId;
  }, [storeLoading, organizationId]);

  const loadInbox = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (!canLoadInbox || !organizationId) {
        return;
      }

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

      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    },
    [canLoadInbox, organizationId, activeStoreId]
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

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
            <p className="text-sm text-gray-600">
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

        {errorText && (
          <div className="mb-4 rounded-xl bg-red-50 p-4 text-red-800 ring-1 ring-red-200">
            {errorText}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
          <table className="w-full text-sm">
            <thead className="border-b border-black/5 bg-gray-50">
              <tr className="text-left text-gray-600">
                <th className="px-4 py-3 font-semibold">Lead</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Modo</th>
                <th className="px-4 py-3 font-semibold">Última mensagem</th>
                <th className="px-4 py-3 font-semibold">Preview</th>
                <th className="px-4 py-3 font-semibold text-right">Ação</th>
              </tr>
            </thead>

            <tbody>
              {(loading || storeLoading) && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    Carregando inbox...
                  </td>
                </tr>
              )}

              {!loading && !storeLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    Nenhuma conversa encontrada para a loja atual.
                  </td>
                </tr>
              )}

              {!loading &&
                !storeLoading &&
                rows.map((row) => (
                  <tr
                    key={row.conversation_id}
                    className="border-b border-black/5 hover:bg-gray-50"
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
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                          Humano
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          IA
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">{formatDateTime(row.last_message_at)}</td>

                    <td className="max-w-md truncate px-4 py-3 text-gray-600">
                      {row.last_message_preview || "-"}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/crm/lead/${row.lead_id}`}
                        className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                      >
                        Abrir
                      </Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}