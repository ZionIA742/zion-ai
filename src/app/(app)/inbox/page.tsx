"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type InboxRow = {
  conversation_id: string;
  lead_id: string;
  status: string | null;
  is_human_active: boolean | null;
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
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [leadNames, setLeadNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function loadInbox() {
    setLoading(true);
    setErrorText(null);

    const { data, error } = await supabase.rpc("panel_list_inbox", {
      p_organization_id: "3cb1d3d4-5d43-4679-8dcf-ee219b89d294",
      p_store_id: null,
      p_limit: 100,
      p_offset: 0,
    });

    if (error) {
      console.error(error);
      setErrorText(error.message);
      setLoading(false);
      return;
    }

    const inboxRows = (data || []) as InboxRow[];
    setRows(inboxRows);

    // buscar nomes dos leads
    const leadIds = [...new Set(inboxRows.map((r) => r.lead_id))];

    if (leadIds.length > 0) {
      const { data: leads } = await supabase
        .from("leads")
        .select("id,name")
        .in("id", leadIds);

      const map: Record<string, string> = {};

      (leads || []).forEach((l: LeadRow) => {
        map[l.id] = l.name || "Lead sem nome";
      });

      setLeadNames(map);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadInbox();
  }, []);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
            <p className="text-sm text-gray-600">
              Conversas reais vindas da função oficial do backend.
            </p>
          </div>

          <button
            onClick={loadInbox}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
          >
            Recarregar
          </button>
        </div>

        {errorText && (
          <div className="mb-4 rounded-xl bg-red-50 p-4 text-red-800 ring-1 ring-red-200">
            {errorText}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">

          <table className="w-full text-sm">

            <thead className="bg-gray-50 border-b border-black/5">
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

              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    Carregando inbox...
                  </td>
                </tr>
              )}

              {!loading &&
                rows.map((row) => (
                  <tr
                    key={row.conversation_id}
                    className="border-b border-black/5 hover:bg-gray-50"
                  >

                    {/* Lead */}
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">
                        {leadNames[row.lead_id] || `Lead ${shortId(row.lead_id)}`}
                      </div>

                      <div className="text-xs text-gray-500">
                        {shortId(row.conversation_id)}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      {row.status || "-"}
                    </td>

                    {/* Modo */}
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

                    {/* Última mensagem */}
                    <td className="px-4 py-3">
                      {formatDateTime(row.last_message_at)}
                    </td>

                    {/* Preview */}
                    <td className="px-4 py-3 max-w-md truncate text-gray-600">
                      {row.last_message_preview || "-"}
                    </td>

                    {/* Ação */}
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