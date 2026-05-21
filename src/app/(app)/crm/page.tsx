"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase as supabaseClient } from "@/lib/supabaseBrowser";
import { COLUNAS, nivelBaseDaColuna } from "@/config/crm";
import { useStoreContext } from "@/components/StoreProvider";

type CrmCardRow = {
  lead_id: string;
  conversation_id: string | null;
  name: string | null;
  phone: string | null;
  effective_state: string | null;
  lead_state: string | null;
  conversation_status: string | null;
  is_human_active: boolean | null;
  created_at: string | null;
};

type UiCardRow = {
  leadId: string;
  conversationId: string | null;
  name: string | null;
  phone: string | null;
  state: string;
  createdAt: string | null;
  isHumanActive: boolean;
};

type CommercialHandoffTaskRow = {
  related_lead_id: string | null;
  related_conversation_id: string | null;
  task_type: string | null;
  status: string | null;
};

type CommercialHandoffIndicator = {
  hasVisitRequest: boolean;
  hasQuoteRequest: boolean;
};

type Nivel = "ok" | "pendente" | "critico";

const OPEN_COMMERCIAL_HANDOFF_STATUSES = [
  "open",
  "waiting_user_choice",
  "waiting_customer_response",
  "ready_to_execute",
  "in_progress",
];

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  agendar_instalacao: ["pos_venda_nps"],
  agendar_visita: ["pos_venda_nps"],
  aguardando_aprovacao: ["humano_assumiu"],
  fechamento_pagamento: ["humano_assumiu", "pagamento_pendente_confirmacao"],
  humano_assumiu: ["negociacao", "orcamento", "qualificacao"],
  negociacao: ["fechamento_pagamento", "humano_assumiu", "perdido"],
  novo_lead: ["humano_assumiu", "qualificacao"],
  orcamento: ["aguardando_aprovacao", "humano_assumiu", "negociacao"],
  pagamento_confirmado: ["agendar_instalacao", "agendar_visita"],
  pagamento_pendente_confirmacao: ["pagamento_confirmado"],
  pos_venda_nps: ["humano_assumiu"],
  qualificacao: ["aguardando_aprovacao", "humano_assumiu", "orcamento"],
};

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

function canMoveTo(fromState: string, toState: string | null) {
  if (!toState) return false;
  return (ALLOWED_TRANSITIONS[fromState] || []).includes(toState);
}

function getCommercialHandoffBadgeLabel(indicator: CommercialHandoffIndicator | null | undefined) {
  if (!indicator) return null;
  if (indicator.hasVisitRequest && indicator.hasQuoteRequest) {
    return "Visita e orçamento pendentes";
  }
  if (indicator.hasVisitRequest) {
    return "Pedido de visita pendente";
  }
  if (indicator.hasQuoteRequest) {
    return "Orçamento pendente";
  }
  return null;
}

export default function CrmPage() {
  const { loading: storeLoading, organizationId, activeStoreId } = useStoreContext();

  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<UiCardRow[]>([]);
  const [commercialHandoffByCardKey, setCommercialHandoffByCardKey] = useState<
    Record<string, CommercialHandoffIndicator>
  >({});
  const [movingId, setMovingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);

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
    const map = new Map<string, UiCardRow[]>();

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

  const selectedColumn = useMemo(() => {
    if (!selectedColumnId) return null;
    return columns.find((col) => String(col.id) === selectedColumnId) || null;
  }, [columns, selectedColumnId]);

  const selectedColumnCards = useMemo(() => {
    if (!selectedColumnId) return [];
    return cardsByColumn.get(selectedColumnId) || [];
  }, [cardsByColumn, selectedColumnId]);

  const searchResults = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return [];

    return cards.filter((card) => {
      const name = String(card.name || "").toLowerCase();
      const phone = String(card.phone || "").toLowerCase();
      return name.includes(query) || phone.includes(query);
    });
  }, [cards, searchText]);

  async function fetchPageData() {
    if (!organizationId) {
      setCards([]);
      setLoading(false);
      return;
    }

    setErrorMsg(null);
    setLoading(true);

    try {
      const { data, error } = await supabaseClient.rpc(
        "panel_list_crm_cards_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId ?? null,
          p_limit: 500,
          p_offset: 0,
        }
      );

      if (error) throw error;

      const nextCards: UiCardRow[] = ((data || []) as CrmCardRow[]).map((row) => ({
        leadId: row.lead_id,
        conversationId: row.conversation_id || null,
        name: row.name || null,
        phone: row.phone || null,
        state: String(row.effective_state || "novo_lead"),
        createdAt: row.created_at || null,
        isHumanActive: row.is_human_active === true,
      }));

      setCards(nextCards);

      const leadIds = [...new Set(nextCards.map((card) => card.leadId).filter(Boolean))];
      const conversationIds = [
        ...new Set(nextCards.map((card) => card.conversationId).filter(Boolean)),
      ] as string[];

      if (leadIds.length === 0 && conversationIds.length === 0) {
        setCommercialHandoffByCardKey({});
      } else {
        let query = supabaseClient
          .from("store_assistant_operational_tasks")
          .select("related_lead_id, related_conversation_id, task_type, status")
          .eq("organization_id", organizationId)
          .in("task_type", ["commercial_visit_request", "commercial_quote_request"])
          .in("status", OPEN_COMMERCIAL_HANDOFF_STATUSES);

        if (activeStoreId) {
          query = query.eq("store_id", activeStoreId);
        }

        if (leadIds.length > 0) {
          query = query.in("related_lead_id", leadIds);
        } else if (conversationIds.length > 0) {
          query = query.in("related_conversation_id", conversationIds);
        }

        const { data: handoffTasks, error: handoffError } = await query;

        if (handoffError) {
          console.warn("[CrmPage] erro ao carregar handoffs comerciais:", handoffError);
          setCommercialHandoffByCardKey({});
        } else {
          const nextIndicators: Record<string, CommercialHandoffIndicator> = {};

          for (const task of (handoffTasks || []) as CommercialHandoffTaskRow[]) {
            const leadId = String(task.related_lead_id || "").trim();
            const conversationId = String(task.related_conversation_id || "").trim();
            const keys = [
              leadId ? `lead:${leadId}` : null,
              conversationId ? `conversation:${conversationId}` : null,
            ].filter(Boolean) as string[];

            for (const key of keys) {
              if (!nextIndicators[key]) {
                nextIndicators[key] = {
                  hasVisitRequest: false,
                  hasQuoteRequest: false,
                };
              }

              if (task.task_type === "commercial_visit_request") {
                nextIndicators[key].hasVisitRequest = true;
              }

              if (task.task_type === "commercial_quote_request") {
                nextIndicators[key].hasQuoteRequest = true;
              }
            }
          }

          setCommercialHandoffByCardKey(nextIndicators);
        }
      }
    } catch (error: any) {
      setErrorMsg(error?.message ?? "Erro ao carregar CRM.");
      setCards([]);
      setCommercialHandoffByCardKey({});
    } finally {
      setLoading(false);
    }
  }

  async function updateConversationState(card: UiCardRow, toColumnId: string) {
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

    if (!canMoveTo(card.state, toColumnId)) {
      setErrorMsg(`Transição inválida de ${card.state} para ${toColumnId}.`);
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

    setMovingId(null);
    await fetchPageData();
  }

  useEffect(() => {
    if (!storeLoading) {
      void fetchPageData();
    }
  }, [storeLoading, organizationId, activeStoreId]);

  function leadTitle(card: UiCardRow) {
    return String(card.name || "Lead sem nome").trim();
  }

  function leadPhone(card: UiCardRow) {
    return String(card.phone || "").trim();
  }

  function getColumnForCard(card: UiCardRow) {
    return columns.find((col) => String(col.id) === String(card.state)) || null;
  }

  function renderLeadCard(card: UiCardRow, options?: { compact?: boolean; showStage?: boolean }) {
    const compact = options?.compact === true;
    const showStage = options?.showStage === true;
    const current = String(card.state || "novo_lead");
    const currentIndex = columns.findIndex((c) => String(c.id) === current);
    const cidx = currentIndex >= 0 ? currentIndex : 0;
    const previousColumnId = cidx > 0 ? String(columns[cidx - 1].id) : null;
    const nextColumnId = cidx < columns.length - 1 ? String(columns[cidx + 1].id) : null;
    const canGoBack = canMoveTo(current, previousColumnId);
    const canGoNext = canMoveTo(current, nextColumnId);
    const cardColumn = getColumnForCard(card);
    const ui = cardColumn?.ui || nivelToUI("ok");
    const handoffLabel =
      getCommercialHandoffBadgeLabel(
        commercialHandoffByCardKey[
          card.conversationId ? `conversation:${card.conversationId}` : `lead:${card.leadId}`
        ]
      ) ||
      getCommercialHandoffBadgeLabel(commercialHandoffByCardKey[`lead:${card.leadId}`]);

    return (
      <div
        key={card.leadId}
        className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5"
      >
        <div className={cx("h-1 w-full", ui.bar)} />

        <div className={compact ? "p-3" : "p-4"}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-900">
                {leadTitle(card)}
              </div>

              {leadPhone(card) ? (
                <div className="mt-0.5 truncate text-xs text-gray-600">
                  {leadPhone(card)}
                </div>
              ) : (
                <div className="mt-0.5 text-xs text-gray-400">Sem telefone</div>
              )}
            </div>

            <span className="shrink-0 rounded-full bg-gray-50 px-2 py-1 text-[10px] font-semibold text-gray-700 ring-1 ring-black/10">
              {new Date(card.createdAt || Date.now()).toLocaleDateString("pt-BR")}
            </span>
          </div>

          {showStage && cardColumn ? (
            <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full bg-gray-50 px-2 py-1 text-[10px] font-semibold text-gray-600 ring-1 ring-black/10">
              <span className={cx("h-1.5 w-1.5 rounded-full", cardColumn.ui.dot)} />
              <span className="truncate">{cardColumn.title}</span>
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
            <span className="rounded-full bg-gray-50 px-2 py-1 ring-1 ring-black/10">
              conversa: {card.conversationId ? "sim" : "não"}
            </span>
            <span className="rounded-full bg-gray-50 px-2 py-1 ring-1 ring-black/10">
              modo: {card.isHumanActive ? "humano" : "IA"}
            </span>
            {handoffLabel ? (
              <span className="rounded-full bg-orange-50 px-2 py-1 text-orange-800 ring-1 ring-orange-200">
                {handoffLabel}
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/crm/lead/${card.leadId}`}
              className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
            >
              Abrir conversa
            </Link>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                disabled={!canGoBack || movingId === card.leadId}
                onClick={() =>
                  previousColumnId &&
                  canGoBack &&
                  updateConversationState(card, previousColumnId)
                }
                className={cx(
                  "rounded-lg px-3 py-2 text-xs font-semibold shadow-sm ring-1 ring-black/10",
                  !canGoBack || movingId === card.leadId
                    ? "cursor-not-allowed bg-white/60 text-gray-400"
                    : "bg-white text-gray-800 hover:bg-gray-50"
                )}
              >
                ← Voltar
              </button>

              <button
                disabled={!canGoNext || movingId === card.leadId}
                onClick={() =>
                  nextColumnId &&
                  canGoNext &&
                  updateConversationState(card, nextColumnId)
                }
                className={cx(
                  "rounded-lg px-3 py-2 text-xs font-semibold shadow-sm ring-1 ring-black/10",
                  !canGoNext || movingId === card.leadId
                    ? "cursor-not-allowed bg-white/60 text-gray-400"
                    : "bg-black text-white hover:opacity-90"
                )}
              >
                Avançar →
              </button>
            </div>
          </div>

          {movingId === card.leadId ? (
            <div className="mt-2 text-xs text-gray-500">Atualizando...</div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-151px)] overflow-hidden bg-gray-100">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-black/5 bg-white">
          <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-3 px-4 py-3">
            <div className="text-xl font-semibold tracking-tight">CRM</div>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/inbox"
                className="rounded-lg bg-black px-3 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90"
              >
                Ir para Inbox
              </Link>

              <button
                onClick={() => void fetchPageData()}
                className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
              >
                Recarregar
              </button>
            </div>
          </div>
        </div>

        <div className="mx-auto flex min-h-0 w-full max-w-[1320px] flex-1 flex-col overflow-hidden px-4 py-2">
          {errorMsg ? (
            <div className="mb-3 shrink-0 rounded-xl bg-red-50 p-3 text-xs text-red-800 ring-1 ring-red-600/20">
              <div className="font-semibold">Erro</div>
              <div className="mt-1 break-words">{errorMsg}</div>
            </div>
          ) : null}

          <div className="mb-2 shrink-0 rounded-2xl bg-white p-2.5 shadow-sm ring-1 ring-black/5">
            <label className="text-xs font-semibold text-gray-700" htmlFor="crm-search">
              Buscar pessoa
            </label>
            <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-1.5 ring-1 ring-black/5">
              <span className="text-sm text-gray-400">⌕</span>
              <input
                id="crm-search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Procure por nome ou telefone"
                className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
              {searchText.trim() ? (
                <button
                  type="button"
                  onClick={() => setSearchText("")}
                  className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Limpar
                </button>
              ) : null}
            </div>
          </div>

          {loading ? (
            <div className="rounded-2xl bg-white p-5 text-sm shadow-sm ring-1 ring-black/5">
              Carregando leads...
            </div>
          ) : searchText.trim() ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
              <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-2">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Resultados da busca</div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {searchResults.length} resultado(s) encontrado(s)
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {searchResults.length === 0 ? (
                  <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-600 ring-1 ring-black/5">
                    Nenhum lead encontrado com essa busca.
                  </div>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {searchResults.map((card) => renderLeadCard(card, { compact: true, showStage: true }))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
              <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="shrink-0 border-b border-black/5 px-4 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">Processos do CRM</div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        Clique em uma linha para ver os leads daquela etapa.
                      </div>
                    </div>

                    <div className="text-xs font-semibold text-gray-500">
                      {cards.length} lead(s)
                    </div>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden p-2">
                  <div className="grid min-h-0 gap-1">
                    {columns.map((col) => {
                      const items = cardsByColumn.get(col.id) || [];
                      const ui = col.ui || nivelToUI(col.nivel);

                      return (
                        <button
                          key={col.id}
                          type="button"
                          onClick={() => setSelectedColumnId(col.id)}
                          className="group flex h-5 min-h-0 items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-0 text-left ring-1 ring-black/5 transition hover:bg-white hover:shadow-sm"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", ui.dot)} />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-gray-900">
                                {col.title}
                              </div>

                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-gray-700 ring-1 ring-black/5">
                              {items.length}
                            </span>
                            <span
                              className={cx(
                                "rounded-full px-2.5 py-0.5 text-[10px] font-semibold",
                                ui.chip
                              )}
                            >
                              {ui.label}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedColumn ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/30"
          onClick={() => setSelectedColumnId(null)}
        >
          <div
            className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shrink-0 border-b border-black/10 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cx("h-2.5 w-2.5 shrink-0 rounded-full", selectedColumn.ui.dot)}
                    />
                    <h2 className="truncate text-lg font-bold text-gray-900">
                      {selectedColumn.title}
                    </h2>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 ring-1 ring-black/5">
                      {selectedColumnCards.length}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Leads desta etapa do CRM
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedColumnId(null)}
                  className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-gray-100 p-4">
              {selectedColumnCards.length === 0 ? (
                <div className="rounded-2xl bg-white p-4 text-sm text-gray-600 shadow-sm ring-1 ring-black/5">
                  Sem leads aqui ainda.
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedColumnCards.map((card) => renderLeadCard(card))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
