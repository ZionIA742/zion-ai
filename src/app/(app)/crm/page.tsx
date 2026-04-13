"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase as supabaseClient } from "@/lib/supabaseBrowser";
import { COLUNAS, nivelBaseDaColuna } from "@/config/crm";
import { useStoreContext } from "@/components/StoreProvider";

type LeadRow = {
  id: string;
  name?: string | null;
  phone?: string | null;
  state?: string | null;
  created_at?: string | null;
};

type ConversationRow = {
  id: string;
  lead_id: string;
  status: string | null;
  is_human_active: boolean | null;
  created_at?: string | null;
};

type CrmCardRow = {
  leadId: string;
  conversationId: string | null;
  name: string | null;
  phone: string | null;
  state: string;
  createdAt: string | null;
  isHumanActive: boolean;
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
  const { loading: storeLoading, organizationId } = useStoreContext();

  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<CrmCardRow[]>([]);
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

  const cardsByColumn = useMemo(() => {
    const map = new Map<string, CrmCardRow[]>();

    for (const col of columns) {
      map.set(col.id, []);
    }

    for (const card of cards) {
      const colId = String(card.state || "novo_lead");
      if (!map.has(colId)) map.set(colId, []);
      map.get(colId)!.push(card);
    }

    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
      });
      map.set(k, arr);
    }

    return map;
  }, [cards, columns]);

  async function fetchPageData() {
    if (!organizationId) {
      setCards([]);
      setLoading(false);
      return;
    }

    setErrorMsg(null);
    setLoading(true);

    try {
      const { data: leadsData, error: leadsError } = await supabaseClient
        .from("leads")
        .select("id,name,phone,state,created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (leadsError) throw leadsError;

      const leads = (leadsData || []) as LeadRow[];
      const leadIds = leads.map((lead) => lead.id);

      let conversationsByLeadId = new Map<string, ConversationRow>();

      if (leadIds.length > 0) {
        const { data: conversationsData, error: conversationsError } = await supabaseClient
          .from("conversations")
          .select("id,lead_id,status,is_human_active,created_at")
          .eq("organization_id", organizationId)
          .in("lead_id", leadIds)
          .order("created_at", { ascending: false });

        if (conversationsError) throw conversationsError;

        for (const conversation of (conversationsData || []) as ConversationRow[]) {
          if (!conversationsByLeadId.has(conversation.lead_id)) {
            conversationsByLeadId.set(conversation.lead_id, conversation);
          }
        }
      }

      const nextCards: CrmCardRow[] = leads.map((lead) => {
        const conversation = conversationsByLeadId.get(lead.id);
        const effectiveState = String(
          conversation?.status || lead.state || "novo_lead"
        );

        return {
          leadId: lead.id,
          conversationId: conversation?.id || null,
          name: lead.name || null,
          phone: lead.phone || null,
          state: effectiveState,
          createdAt: conversation?.created_at || lead.created_at || null,
          isHumanActive: conversation?.is_human_active === true,
        };
      });

      setCards(nextCards);
    } catch (error: any) {
      setErrorMsg(error?.message ?? "Erro ao carregar CRM.");
      setCards([]);
    } finally {
      setLoading(false);
    }
  }

  async function updateConversationState(card: CrmCardRow, toColumnId: string) {
    if (!organizationId) {
      setErrorMsg("Organização não carregada.");
      return;
    }

    if (!card.conversationId) {
      setErrorMsg(
        "Este lead ainda não possui conversa. O CRM não deve mover estágio sem conversa real."
      );
      return;
    }

    setErrorMsg(null);
    setMovingId(card.leadId);

    const { error } = await supabaseClient.rpc(
      "panel_transition_conversation_state_scoped",
      {
        p_organization_id: organizationId,
        p_conversation_id: card.conversationId,
        p_to_state: toColumnId,
        p_reason: "manual_move_from_crm",
      }
    );

    if (error) {
      setErrorMsg(error.message);
      setMovingId(null);
      return;
    }

    setCards((prev) =>
      prev.map((item) =>
        item.leadId === card.leadId
          ? {
              ...item,
              state: toColumnId,
              isHumanActive: toColumnId === "humano_assumiu",
            }
          : item
      )
    );
    setMovingId(null);
  }

  useEffect(() => {
    if (!storeLoading) {
      void fetchPageData();
    }
  }, [storeLoading, organizationId]);

  function leadTitle(card: CrmCardRow) {
    return String(card.name || "Lead sem nome").trim();
  }

  function leadPhone(card: CrmCardRow) {
    return String(card.phone || "").trim();
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div>
            <div className="text-xl font-semibold tracking-tight">CRM</div>
            <div className="text-sm text-gray-600">
              Agora o CRM usa o status oficial da conversa como referência principal.
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
              const items = cardsByColumn.get(col.id) || [];
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
                      <div className="mt-1 text-sm text-gray-600">
                        Leads neste estado oficial da conversa
                      </div>
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
                        {items.map((card) => {
                          const current = String(card.state || "novo_lead");
                          const currentIndex = columns.findIndex(
                            (c) => String(c.id) === current
                          );
                          const cidx = currentIndex >= 0 ? currentIndex : idx;

                          const prevId = cidx > 0 ? String(columns[cidx - 1].id) : null;
                          const nextId =
                            cidx < columns.length - 1 ? String(columns[cidx + 1].id) : null;

                          return (
                            <div
                              key={card.leadId}
                              className="overflow-hidden rounded-2xl bg-gray-50 ring-1 ring-black/5"
                            >
                              <div className={cx("h-2 w-full", ui.bar)} />

                              <div className="p-5">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="min-w-0">
                                    <div className="truncate text-base font-semibold text-gray-900">
                                      {leadTitle(card)}
                                    </div>

                                    {leadPhone(card) ? (
                                      <div className="mt-1 text-sm text-gray-600">
                                        {leadPhone(card)}
                                      </div>
                                    ) : (
                                      <div className="mt-1 text-sm text-gray-400">
                                        Sem telefone
                                      </div>
                                    )}

                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                      <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-black/10">
                                        conversa: {card.conversationId ? "sim" : "não"}
                                      </span>
                                      <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-black/10">
                                        modo: {card.isHumanActive ? "humano" : "IA"}
                                      </span>
                                    </div>
                                  </div>

                                  <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 ring-1 ring-black/10">
                                    {new Date(
                                      card.createdAt || Date.now()
                                    ).toLocaleDateString("pt-BR")}
                                  </span>
                                </div>

                                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                                  <Link
                                    href={`/crm/lead/${card.leadId}`}
                                    className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
                                  >
                                    Abrir conversa
                                  </Link>

                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      disabled={!prevId || movingId === card.leadId}
                                      onClick={() => prevId && updateConversationState(card, prevId)}
                                      className={cx(
                                        "rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm ring-1 ring-black/10",
                                        !prevId || movingId === card.leadId
                                          ? "cursor-not-allowed bg-white/60 text-gray-400"
                                          : "bg-white text-gray-800 hover:bg-gray-50"
                                      )}
                                    >
                                      ← Voltar
                                    </button>

                                    <button
                                      disabled={!nextId || movingId === card.leadId}
                                      onClick={() => nextId && updateConversationState(card, nextId)}
                                      className={cx(
                                        "rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm ring-1 ring-black/10",
                                        !nextId || movingId === card.leadId
                                          ? "cursor-not-allowed bg-white/60 text-gray-400"
                                          : "bg-black text-white hover:opacity-90"
                                      )}
                                    >
                                      Avançar →
                                    </button>
                                  </div>
                                </div>

                                {movingId === card.leadId ? (
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
