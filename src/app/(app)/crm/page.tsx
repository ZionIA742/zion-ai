"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase as supabaseClient } from "@/lib/supabaseBrowser";
import { COLUNAS, nivelBaseDaColuna } from "@/config/crm";

type LeadRow = {
  id: string;
  name?: string | null;
  phone?: string | null;
  state?: string | null;
  created_at?: string | null;
};

type Nivel = "ok" | "pendente" | "critico";

function cx(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

function safeNivel(raw: unknown): Nivel {
  const n = String(raw || "").toLowerCase();
  if (n.includes("critic") || n.includes("vermel") || n.includes("red")) return "critico";
  if (n.includes("pend") || n.includes("amarel") || n.includes("yellow")) return "pendente";
  return "ok";
}

function nivelToUI(nivel: Nivel) {
  if (nivel === "critico") {
    return {
      dot: "bg-red-500",
      bar: "bg-red-500",
      chip: "bg-red-50 text-red-700 ring-1 ring-red-600/25",
      label: "CRÍTICO",
    };
  }

  if (nivel === "pendente") {
    return {
      dot: "bg-amber-500",
      bar: "bg-amber-500",
      chip: "bg-amber-50 text-amber-800 ring-1 ring-amber-600/25",
      label: "PENDENTE",
    };
  }

  return {
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/25",
    label: "OK",
  };
}

export default function CrmPage() {
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const columns = useMemo(() => {
    return (COLUNAS as any[]).map((c) => {
      const id = String(c.id);
      const title = String(c.title ?? c.titulo ?? c.label ?? c.nome ?? id);
      const nivelRaw = nivelBaseDaColuna(id as any);
      const nivel = safeNivel(nivelRaw);
      const ui = nivelToUI(nivel);

      return { ...c, id, title, nivel, ui };
    });
  }, []);

  const leadsByColumn = useMemo(() => {
    const map = new Map<string, LeadRow[]>();

    for (const col of columns) {
      map.set(col.id, []);
    }

    for (const l of leads) {
      const colId = String(l.state || "novo_lead");
      if (!map.has(colId)) map.set(colId, []);
      map.get(colId)!.push(l);
    }

    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      });
      map.set(k, arr);
    }

    return map;
  }, [leads, columns]);

  async function fetchLeads() {
    const { data, error } = await supabaseClient
      .from("leads")
      .select("id,name,phone,state,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    setLeads((data || []) as LeadRow[]);
  }

  async function fetchPageData() {
    setErrorMsg(null);
    setLoading(true);

    try {
      await fetchLeads();
    } catch (error: any) {
      setErrorMsg(error?.message ?? "Erro ao carregar CRM.");
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }

  async function updateLeadState(leadId: string, toColumnId: string) {
    setErrorMsg(null);
    setMovingId(leadId);

    const { error } = await supabaseClient
      .from("leads")
      .update({ state: toColumnId })
      .eq("id", leadId);

    if (error) {
      setErrorMsg(error.message);
      setMovingId(null);
      return;
    }

    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, state: toColumnId } : l))
    );
    setMovingId(null);
  }

  useEffect(() => {
    void fetchPageData();
  }, []);

  function leadTitle(l: LeadRow) {
    return String(l.name || "Lead sem nome").trim();
  }

  function leadPhone(l: LeadRow) {
    return String(l.phone || "").trim();
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div>
            <div className="text-xl font-semibold tracking-tight">CRM</div>
            <div className="text-sm text-gray-600">
              Verde = OK • Amarelo = Pendente • Vermelho = Crítico
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/inbox"
              className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"
            >
              Ir para Inbox
            </Link>

            <button
              onClick={() => void fetchPageData()}
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
            >
              Recarregar
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-6">
        {errorMsg ? (
          <div className="mb-5 rounded-2xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-600/20">
            <div className="font-semibold">Erro</div>
            <div className="mt-1 break-words">{errorMsg}</div>
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            Carregando leads...
          </div>
        ) : (
          <div className="space-y-6">
            {columns.map((col, idx) => {
              const items = leadsByColumn.get(col.id) || [];
              const ui = col.ui || nivelToUI(col.nivel);

              return (
                <section
                  key={col.id}
                  className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-black/5 px-6 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cx("h-2.5 w-2.5 rounded-full", ui.dot)} />
                        <h2 className="truncate text-base font-semibold text-gray-900">
                          {col.title}
                        </h2>
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 ring-1 ring-black/5">
                          {items.length}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-gray-600">Leads neste estado</div>
                    </div>

                    <span
                      className={cx(
                        "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
                        ui.chip
                      )}
                    >
                      {ui.label}
                    </span>
                  </div>

                  <div className="p-6">
                    {items.length === 0 ? (
                      <div className="rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">
                        Sem leads aqui ainda.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {items.map((l) => {
                          const current = String(l.state || "novo_lead");
                          const currentIndex = columns.findIndex(
                            (c) => String(c.id) === current
                          );
                          const cidx = currentIndex >= 0 ? currentIndex : idx;

                          const prevId = cidx > 0 ? String(columns[cidx - 1].id) : null;
                          const nextId =
                            cidx < columns.length - 1 ? String(columns[cidx + 1].id) : null;

                          return (
                            <div
                              key={l.id}
                              className="overflow-hidden rounded-2xl bg-gray-50 ring-1 ring-black/5"
                            >
                              <div className={cx("h-2 w-full", ui.bar)} />

                              <div className="p-5">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="min-w-0">
                                    <div className="truncate text-base font-semibold text-gray-900">
                                      {leadTitle(l)}
                                    </div>

                                    {leadPhone(l) ? (
                                      <div className="mt-1 text-sm text-gray-600">
                                        {leadPhone(l)}
                                      </div>
                                    ) : (
                                      <div className="mt-1 text-sm text-gray-400">
                                        Sem telefone
                                      </div>
                                    )}
                                  </div>

                                  <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 ring-1 ring-black/10">
                                    {new Date(
                                      l.created_at || Date.now()
                                    ).toLocaleDateString("pt-BR")}
                                  </span>
                                </div>

                                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                                  <Link
                                    href={`/crm/lead/${l.id}`}
                                    className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
                                  >
                                    Abrir conversa
                                  </Link>

                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      disabled={!prevId || movingId === l.id}
                                      onClick={() => prevId && updateLeadState(l.id, prevId)}
                                      className={cx(
                                        "rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm ring-1 ring-black/10",
                                        !prevId || movingId === l.id
                                          ? "cursor-not-allowed bg-white/60 text-gray-400"
                                          : "bg-white text-gray-800 hover:bg-gray-50"
                                      )}
                                    >
                                      ← Voltar
                                    </button>

                                    <button
                                      disabled={!nextId || movingId === l.id}
                                      onClick={() => nextId && updateLeadState(l.id, nextId)}
                                      className={cx(
                                        "rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm ring-1 ring-black/10",
                                        !nextId || movingId === l.id
                                          ? "cursor-not-allowed bg-white/60 text-gray-400"
                                          : "bg-black text-white hover:opacity-90"
                                      )}
                                    >
                                      Avançar →
                                    </button>
                                  </div>
                                </div>

                                {movingId === l.id ? (
                                  <div className="mt-3 text-sm text-gray-500">Atualizando...</div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}