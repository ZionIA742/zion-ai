"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CANONICAL_CRM_STAGES,
  type CanonicalCrmStageArea,
  type CanonicalCrmStageDefinition,
  type CanonicalCrmStageId,
  getCanonicalCrmStage,
} from "@/config/crm";
import { useStoreContext } from "@/components/StoreProvider";
import { supabase as supabaseClient } from "@/lib/supabaseBrowser";
import { buildCrmLeadConversationHref } from "@/lib/server/crm/lead-conversation-opportunity-context";

type CrmOpportunityCardRow = {
  commercial_opportunity_id: string;
  organization_id: string;
  store_id: string | null;
  customer_id: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  name: string | null;
  phone: string | null;
  opportunity_stage: string | null;
  is_human_active: boolean | null;
  is_follow_up_active?: boolean | null;
  stage_changed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type UiCardRow = {
  commercialOpportunityId: string;
  leadId: string | null;
  conversationId: string | null;
  name: string | null;
  phone: string | null;
  opportunityStage: string | null;
  canonicalStage: CanonicalCrmStageDefinition | null;
  stageChangedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isHumanActive: boolean;
  isFollowUpActive: boolean;
};

type BoardSection = {
  id: string;
  title: string;
  description: string;
  area: CanonicalCrmStageArea | "attention";
  stages: CanonicalCrmStageDefinition[];
};

type Nivel = "ok" | "pendente" | "critico";

const ATTENTION_BUCKET_ID = "__attention__";
const FOLLOW_UP_BUCKET_ID = "__follow_up__";
const MOVEMENT_LOCK_MESSAGE =
  "Movimentacao temporariamente indisponivel enquanto o board migra para oportunidades.";
const DETAIL_LOCK_MESSAGE =
  "Detalhe por oportunidade em atualizacao. Abra a Inbox para seguir o atendimento.";

function cx(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

function nivelToUI(nivel: Nivel) {
  if (nivel === "critico") {
    return {
      dot: "bg-red-500",
      bar: "bg-red-500",
      chip: "bg-red-50 text-red-700 ring-1 ring-red-600/25",
      label: "CRITICO",
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

function getStageUi(stage: CanonicalCrmStageDefinition | null) {
  if (stage) {
    return nivelToUI(stage.nivel);
  }

  return {
    dot: "bg-slate-500",
    bar: "bg-slate-500",
    chip: "bg-slate-100 text-slate-700 ring-1 ring-slate-300",
    label: "REVISAO",
  };
}

function getCardDate(card: UiCardRow) {
  return card.stageChangedAt || card.updatedAt || card.createdAt || null;
}

function sortCards(cards: UiCardRow[]) {
  return [...cards].sort((a, b) => {
    const da = getCardDate(a) ? new Date(getCardDate(a)!).getTime() : 0;
    const db = getCardDate(b) ? new Date(getCardDate(b)!).getTime() : 0;
    return db - da;
  });
}

function formatCardDate(card: UiCardRow) {
  const value = getCardDate(card);
  if (!value) return "Sem data";
  return new Date(value).toLocaleDateString("pt-BR");
}

function cardTitle(card: UiCardRow) {
  return String(card.name || "Oportunidade sem nome").trim();
}

function cardPhone(card: UiCardRow) {
  return String(card.phone || "").trim();
}

function getAttentionReason() {
  return "Não foi possível identificar corretamente a etapa desta oportunidade.";
}

function isCanonicalStageId(value: string): value is CanonicalCrmStageId {
  return CANONICAL_CRM_STAGES.some((stage) => stage.id === value);
}

function getSearchIndex(card: UiCardRow) {
  return [
    cardTitle(card),
    cardPhone(card),
    card.opportunityStage || "",
    card.conversationId || "",
    card.leadId || "",
  ]
    .join(" ")
    .toLowerCase();
}

export default function CrmPage() {
  const { loading: storeLoading, organizationId, activeStoreId } = useStoreContext();

  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<UiCardRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [selectedBucketId, setSelectedBucketId] = useState<string | null>(null);

  const canAutoRefresh = useMemo(() => {
    return !storeLoading && !!organizationId;
  }, [storeLoading, organizationId]);

  const boardSections = useMemo<BoardSection[]>(() => {
    return [
      {
        id: "pipeline",
        title: "Pipeline comercial",
        description: "Etapas ativas do board por oportunidade.",
        area: "pipeline",
        stages: CANONICAL_CRM_STAGES.filter((stage) => stage.area === "pipeline"),
      },
      {
        id: "lost",
        title: "Encerradas como perda",
        description: "Oportunidades encerradas em perda.",
        area: "lost",
        stages: CANONICAL_CRM_STAGES.filter((stage) => stage.area === "lost"),
      },
      {
        id: "completed",
        title: "Concluidas",
        description: "Oportunidades que nao exigem mais acoes comerciais.",
        area: "completed",
        stages: CANONICAL_CRM_STAGES.filter((stage) => stage.area === "completed"),
      },
    ];
  }, []);

  const fetchPageData = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (!organizationId) {
        setCards([]);
        setLoading(false);
        return;
      }

      setErrorMsg(null);
      if (!silent) {
        setLoading(true);
      }

      try {
        const { data, error } = await supabaseClient.rpc(
          "panel_list_crm_opportunity_cards_scoped",
          {
            p_organization_id: organizationId,
            p_store_id: activeStoreId ?? null,
            p_limit: 500,
            p_offset: 0,
          }
        );

        if (error) {
          throw error;
        }

        const nextCards: UiCardRow[] = ((data || []) as CrmOpportunityCardRow[]).map((row) => ({
          commercialOpportunityId: row.commercial_opportunity_id,
          leadId: row.lead_id || null,
          conversationId: row.conversation_id || null,
          name: row.name || null,
          phone: row.phone || null,
          opportunityStage: row.opportunity_stage || null,
          canonicalStage: getCanonicalCrmStage(row.opportunity_stage),
          stageChangedAt: row.stage_changed_at || null,
          createdAt: row.created_at || null,
          updatedAt: row.updated_at || null,
          isHumanActive: row.is_human_active === true,
          isFollowUpActive: row.is_follow_up_active === true,
        }));

        setCards(nextCards);
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao carregar o board canônico de oportunidades.";
        setErrorMsg(message || "Falha ao carregar o board canônico de oportunidades.");
        setCards([]);
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [organizationId, activeStoreId]
  );

  useEffect(() => {
    if (canAutoRefresh) {
      void fetchPageData();
    }
  }, [canAutoRefresh, fetchPageData]);

  useEffect(() => {
    if (!canAutoRefresh) return;

    const interval = window.setInterval(() => {
      void fetchPageData({ silent: true });
    }, 10000);

    return () => window.clearInterval(interval);
  }, [canAutoRefresh, fetchPageData]);

  useEffect(() => {
    if (!canAutoRefresh) return;

    let lastRefreshAt = 0;

    const triggerSilentRefresh = () => {
      const now = Date.now();
      if (now - lastRefreshAt < 1000) return;
      lastRefreshAt = now;
      void fetchPageData({ silent: true });
    };

    const handleFocus = () => {
      triggerSilentRefresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerSilentRefresh();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [canAutoRefresh, fetchPageData]);

  const stageCardsById = useMemo(() => {
    const map = new Map<CanonicalCrmStageId, UiCardRow[]>();

    for (const stage of CANONICAL_CRM_STAGES) {
      map.set(stage.id, []);
    }

    for (const card of cards) {
      if (!card.canonicalStage) continue;
      map.get(card.canonicalStage.id)?.push(card);
    }

    for (const [stageId, stageCards] of map.entries()) {
      map.set(stageId, sortCards(stageCards));
    }

    return map;
  }, [cards]);

  const attentionCards = useMemo(() => {
    return sortCards(cards.filter((card) => !card.canonicalStage));
  }, [cards]);

  const followUpCards = useMemo(() => {
    return sortCards(cards.filter((card) => card.isFollowUpActive));
  }, [cards]);

  const searchResults = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return [];

    return sortCards(cards.filter((card) => getSearchIndex(card).includes(query)));
  }, [cards, searchText]);

  const selectedStage = useMemo(() => {
    if (
      !selectedBucketId ||
      selectedBucketId === ATTENTION_BUCKET_ID ||
      selectedBucketId === FOLLOW_UP_BUCKET_ID
    ) {
      return null;
    }

    return CANONICAL_CRM_STAGES.find((stage) => stage.id === selectedBucketId) || null;
  }, [selectedBucketId]);

  const selectedBucketCards = useMemo(() => {
    if (!selectedBucketId) return [];
    if (selectedBucketId === ATTENTION_BUCKET_ID) return attentionCards;
    if (selectedBucketId === FOLLOW_UP_BUCKET_ID) return followUpCards;
    if (!isCanonicalStageId(selectedBucketId)) return [];
    return stageCardsById.get(selectedBucketId) || [];
  }, [attentionCards, followUpCards, selectedBucketId, stageCardsById]);

  const selectedBucketTitle = useMemo(() => {
    if (selectedBucketId === FOLLOW_UP_BUCKET_ID) {
      return "Follow-up";
    }

    return selectedStage ? selectedStage.title : "AÃ§Ã£o necessÃ¡ria";
  }, [selectedBucketId, selectedStage]);

  const selectedBucketDescription = useMemo(() => {
    if (selectedBucketId === FOLLOW_UP_BUCKET_ID) {
      return "Oportunidades com follow-up ativo sem alterar a etapa comercial.";
    }

    return selectedStage
      ? "Oportunidades desta etapa."
      : "NÃ£o foi possÃ­vel identificar corretamente a etapa destas oportunidades.";
  }, [selectedBucketId, selectedStage]);

  const selectedBucketDotClass = useMemo(() => {
    if (selectedBucketId === FOLLOW_UP_BUCKET_ID) {
      return "bg-violet-500";
    }

    return selectedStage ? getStageUi(selectedStage).dot : "bg-red-500";
  }, [selectedBucketId, selectedStage]);

  function renderCard(card: UiCardRow, options?: { compact?: boolean; showStage?: boolean }) {
    const compact = options?.compact === true;
    const showStage = options?.showStage === true;
    const stage = card.canonicalStage;
    const ui = getStageUi(stage);

    return (
      <div
        key={card.commercialOpportunityId}
        className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5"
      >
        <div className={cx("h-1 w-full", ui.bar)} />

        <div className={compact ? "p-3" : "p-4"}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-900">
                {cardTitle(card)}
              </div>

              {cardPhone(card) ? (
                <div className="mt-0.5 truncate text-xs text-gray-600">
                  {cardPhone(card)}
                </div>
              ) : (
                <div className="mt-0.5 text-xs text-gray-400">Sem telefone</div>
              )}
            </div>

            <span className="shrink-0 rounded-full bg-gray-50 px-2 py-1 text-[10px] font-semibold text-gray-700 ring-1 ring-black/10">
              {formatCardDate(card)}
            </span>
          </div>

          {showStage ? (
            <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full bg-gray-50 px-2 py-1 text-[10px] font-semibold text-gray-600 ring-1 ring-black/10">
              <span className={cx("h-1.5 w-1.5 rounded-full", ui.dot)} />
              <span className="truncate">{stage ? stage.title : "Ação necessária"}</span>
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
            <span className="rounded-full bg-gray-50 px-2 py-1 ring-1 ring-black/10">
              conversa: {card.conversationId ? "sim" : "nao"}
            </span>
            {card.isFollowUpActive ? (
              <span className="rounded-full bg-violet-50 px-2 py-1 text-violet-800 ring-1 ring-violet-200">
                Em Follow-up
              </span>
            ) : null}
            {card.isHumanActive ? (
              <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-800 ring-1 ring-sky-200">
                Humano assumiu
              </span>
            ) : null}
            {!card.leadId ? (
              <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-800 ring-1 ring-amber-200">
                Sem lead vinculado
              </span>
            ) : null}
            {!card.conversationId ? (
              <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-800 ring-1 ring-amber-200">
                Sem conversa vinculada
              </span>
            ) : null}
            {!stage ? (
              <span className="rounded-full bg-red-50 px-2 py-1 text-red-800 ring-1 ring-red-200">
                Ação necessária
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            {buildCrmLeadConversationHref({
              leadId: card.leadId,
              conversationId: card.conversationId,
              opportunityId: card.commercialOpportunityId,
            }) ? (
              <Link
                href={
                  buildCrmLeadConversationHref({
                    leadId: card.leadId,
                    conversationId: card.conversationId,
                    opportunityId: card.commercialOpportunityId,
                  })!
                }
                className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
              >
                Abrir oportunidade
              </Link>
            ) : (
              <span className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-500 ring-1 ring-gray-200">
                Lead indisponivel
              </span>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled
                title={MOVEMENT_LOCK_MESSAGE}
                className="cursor-not-allowed rounded-lg bg-white/60 px-3 py-2 text-xs font-semibold text-gray-400 shadow-sm ring-1 ring-black/10"
              >
                ← Voltar
              </button>

              <button
                type="button"
                disabled
                title={MOVEMENT_LOCK_MESSAGE}
                className="cursor-not-allowed rounded-lg bg-white/60 px-3 py-2 text-xs font-semibold text-gray-400 shadow-sm ring-1 ring-black/10"
              >
                Avancar →
              </button>
            </div>
          </div>

          <div className="mt-2 text-xs text-gray-500">
            {!stage ? getAttentionReason() : MOVEMENT_LOCK_MESSAGE}
          </div>
          {!stage ? (
            <div className="mt-1 text-xs text-gray-500">
              As movimentações estão bloqueadas até a correção.
            </div>
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
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 ring-1 ring-black/5">
              <span className="shrink-0 text-sm text-gray-400">⌕</span>
              <input
                id="crm-search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Buscar oportunidade por nome, telefone ou identificadores"
                className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
              {searchText.trim() ? (
                <button
                  type="button"
                  onClick={() => setSearchText("")}
                  className="shrink-0 rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Limpar
                </button>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/inbox"
                className="rounded-lg bg-black px-3 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90"
              >
                Ir para Inbox
              </Link>

              <button
                type="button"
                onClick={() => void fetchPageData()}
                className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
              >
                Recarregar
              </button>
            </div>
          </div>
        </div>

        <div className="mx-auto flex min-h-0 w-full max-w-[1320px] flex-1 flex-col overflow-hidden px-4 py-3">
          {errorMsg ? (
            <div className="mb-3 shrink-0 rounded-xl bg-red-50 p-3 text-xs text-red-800 ring-1 ring-red-600/20">
              <div className="font-semibold">Erro</div>
              <div className="mt-1 break-words">{errorMsg}</div>
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-2xl bg-white p-5 text-sm shadow-sm ring-1 ring-black/5">
              Carregando oportunidades...
            </div>
          ) : searchText.trim() ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
              <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-2">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    Resultados da busca
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {searchResults.length} resultado(s) encontrado(s)
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {searchResults.length === 0 ? (
                  <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-600 ring-1 ring-black/5">
                    Nenhuma oportunidade encontrada com essa busca.
                  </div>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {searchResults.map((card) =>
                      renderCard(card, { compact: true, showStage: true })
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5">
              <div className="space-y-4">
                <div className="rounded-2xl border border-black/5 bg-gray-50 px-4 py-3">
                  <div className="text-sm font-semibold text-gray-900">
                    Board comercial por oportunidade
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {cards.length} oportunidade(s) carregada(s).
                  </div>
                </div>

                {boardSections
                  .filter((section) => section.area === "pipeline")
                  .map((section) => (
                  <section key={section.id} className="space-y-2">
                    <div className="px-1">
                      <div className="text-sm font-semibold text-gray-900">
                        {section.title}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {section.description}
                      </div>
                    </div>

                    <div className="grid gap-1">
                      {section.stages.map((stage) => {
                        const items = stageCardsById.get(stage.id) || [];
                        const ui = getStageUi(stage);

                        return (
                          <button
                            key={stage.id}
                            type="button"
                            onClick={() => setSelectedBucketId(stage.id)}
                            className="group flex min-h-[38px] items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-2 text-left ring-1 ring-black/5 transition hover:bg-white hover:shadow-sm"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span
                                className={cx("h-2.5 w-2.5 shrink-0 rounded-full", ui.dot)}
                              />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-gray-900">
                                  {stage.title}
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
                  </section>
                ))}

                <section className="space-y-2">
                  <div className="px-1">
                    <div className="text-sm font-semibold text-gray-900">Follow-up</div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      Oportunidades com follow-up ativo sem sair da etapa comercial atual.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedBucketId(FOLLOW_UP_BUCKET_ID)}
                    className="group flex min-h-[38px] items-center justify-between gap-3 rounded-xl bg-violet-50 px-4 py-2 text-left ring-1 ring-violet-200 transition hover:bg-white hover:shadow-sm"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">
                          Follow-up
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-gray-700 ring-1 ring-black/5">
                        {followUpCards.length}
                      </span>
                      <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-semibold text-violet-800 ring-1 ring-violet-200">
                        ATIVO
                      </span>
                    </div>
                  </button>
                </section>

                {boardSections
                  .filter((section) => section.area !== "pipeline")
                  .map((section) => (
                    <section key={section.id} className="space-y-2">
                      <div className="px-1">
                        <div className="text-sm font-semibold text-gray-900">
                          {section.title}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {section.description}
                        </div>
                      </div>

                      <div className="grid gap-1">
                        {section.stages.map((stage) => {
                          const items = stageCardsById.get(stage.id) || [];
                          const ui = getStageUi(stage);

                          return (
                            <button
                              key={stage.id}
                              type="button"
                              onClick={() => setSelectedBucketId(stage.id)}
                              className="group flex min-h-[38px] items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-2 text-left ring-1 ring-black/5 transition hover:bg-white hover:shadow-sm"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <span
                                  className={cx("h-2.5 w-2.5 shrink-0 rounded-full", ui.dot)}
                                />
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-gray-900">
                                    {stage.title}
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
                    </section>
                  ))}

                <section className="space-y-2">
                  <div className="px-1">
                    <div className="text-sm font-semibold text-gray-900">
                      Ação necessária
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      Oportunidades com etapa não identificada corretamente.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedBucketId(ATTENTION_BUCKET_ID)}
                    className="group flex min-h-[38px] items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-2 text-left ring-1 ring-red-200 transition hover:bg-white hover:shadow-sm"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">
                          Ação necessária
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-gray-700 ring-1 ring-black/5">
                        {attentionCards.length}
                      </span>
                      <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200">
                        REVISAO
                      </span>
                    </div>
                  </button>
                </section>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedBucketId ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/30"
          onClick={() => setSelectedBucketId(null)}
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
                      className={cx("h-2.5 w-2.5 shrink-0 rounded-full", selectedBucketDotClass)}
                    />
                    <h2 className="truncate text-lg font-bold text-gray-900">
                      {selectedBucketTitle}
                    </h2>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 ring-1 ring-black/5">
                      {selectedBucketCards.length}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {selectedBucketDescription}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedBucketId(null)}
                  className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-gray-100 p-4">
              {selectedBucketCards.length === 0 ? (
                <div className="rounded-2xl bg-white p-4 text-sm text-gray-600 shadow-sm ring-1 ring-black/5">
                  Sem oportunidades aqui ainda.
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedBucketCards.map((card) =>
                    renderCard(card, {
                      showStage: selectedBucketId === FOLLOW_UP_BUCKET_ID,
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
