"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CANONICAL_CRM_STAGES,
  type CanonicalCrmStageDefinition,
  type CanonicalCrmStageId,
  getCanonicalCrmStage,
} from "@/config/crm";
import { useStoreContext } from "@/components/StoreProvider";
import { supabase as supabaseClient } from "@/lib/supabaseBrowser";
import { buildCrmLeadConversationHref } from "@/lib/server/crm/lead-conversation-opportunity-context";
import {
  buildManualCommercialLeadCreationSnapshot,
  buildManualCommercialLeadCreationStorageKey,
  clearPendingManualCommercialLeadCreationOperation,
  getOrCreatePendingManualCommercialLeadCreationOperation,
} from "./manual-lead-create-operation";
import { formatManualLeadPhone } from "./manual-lead-phone";

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


type Nivel = "ok" | "pendente" | "critico";

type ManualLeadFormState = {
  name: string;
  phone: string;
};

type ManualLeadCreateApiResponse = {
  ok: true;
  operationId: string;
  leadId: string;
  customerId: string;
  customerStoreLinkId: string;
  leadCustomerLinkId: string;
  commercialOpportunityId: string;
  stage: string | null;
  primaryConversationId: string | null;
  replayed: boolean;
  createdAt: string | null;
};

type BoardView = "active" | "followup" | "attention" | "lost" | "completed";

const PIPELINE_STAGES = CANONICAL_CRM_STAGES.filter((stage) => stage.area === "pipeline");

const BOARD_VIEW_OPTIONS: Array<{ id: BoardView; label: string }> = [
  { id: "active", label: "Ativas" },
  { id: "followup", label: "Follow-up" },
  { id: "attention", label: "Ação necessária" },
  { id: "lost", label: "Perdidas" },
  { id: "completed", label: "Concluídas" },
];

const MOVEMENT_LOCK_MESSAGE =
  "Movimentacao temporariamente indisponivel enquanto o board migra para oportunidades.";

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

function normalizeManualLeadText(value: string) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export default function CrmPage() {
  const router = useRouter();
  const { loading: storeLoading, organizationId, activeStoreId } = useStoreContext();

  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<UiCardRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [boardView, setBoardView] = useState<BoardView>("active");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedPipelineStageId, setSelectedPipelineStageId] = useState<CanonicalCrmStageId | null>(
    PIPELINE_STAGES[0]?.id ?? null,
  );
  const [showAllSelectedStageCards, setShowAllSelectedStageCards] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [manualLeadForm, setManualLeadForm] = useState<ManualLeadFormState>({
    name: "",
    phone: "",
  });
  const [manualLeadCreateError, setManualLeadCreateError] = useState<string | null>(null);
  const [isCreatingManualLead, setIsCreatingManualLead] = useState(false);

  const canAutoRefresh = useMemo(() => {
    return !storeLoading && !!organizationId;
  }, [storeLoading, organizationId]);

  const canOpenManualLeadModal = useMemo(() => {
    return !storeLoading && !!organizationId;
  }, [organizationId, storeLoading]);


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

  const pipelineCards = useMemo(() => {
    return sortCards(cards.filter((card) => card.canonicalStage?.area === "pipeline"));
  }, [cards]);

  const lostCards = useMemo(() => {
    return sortCards(cards.filter((card) => card.canonicalStage?.area === "lost"));
  }, [cards]);

  const completedCards = useMemo(() => {
    return sortCards(cards.filter((card) => card.canonicalStage?.area === "completed"));
  }, [cards]);

  const attentionCards = useMemo(() => {
    return sortCards(cards.filter((card) => !card.canonicalStage));
  }, [cards]);

  const followUpCards = useMemo(() => {
    return sortCards(
      cards.filter(
        (card) => card.isFollowUpActive && card.canonicalStage?.area === "pipeline",
      ),
    );
  }, [cards]);

  const searchResults = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return [];

    return sortCards(cards.filter((card) => getSearchIndex(card).includes(query)));
  }, [cards, searchText]);

  const selectedCard = useMemo(() => {
    if (!selectedCardId) return null;
    return cards.find((card) => card.commercialOpportunityId === selectedCardId) || null;
  }, [cards, selectedCardId]);

  const selectedPipelineStage = useMemo(() => {
    if (!selectedPipelineStageId) return PIPELINE_STAGES[0] ?? null;
    return PIPELINE_STAGES.find((stage) => stage.id === selectedPipelineStageId) ?? PIPELINE_STAGES[0] ?? null;
  }, [selectedPipelineStageId]);

  const selectedPipelineStageCards = useMemo(() => {
    if (!selectedPipelineStage) return [];
    return stageCardsById.get(selectedPipelineStage.id) || [];
  }, [selectedPipelineStage, stageCardsById]);

  const visibleSelectedPipelineStageCards = useMemo(() => {
    return showAllSelectedStageCards
      ? selectedPipelineStageCards
      : selectedPipelineStageCards.slice(0, 9);
  }, [selectedPipelineStageCards, showAllSelectedStageCards]);

  const selectedViewCards = useMemo(() => {
    if (boardView === "followup") return followUpCards;
    if (boardView === "attention") return attentionCards;
    if (boardView === "lost") return lostCards;
    if (boardView === "completed") return completedCards;
    return pipelineCards;
  }, [attentionCards, boardView, completedCards, followUpCards, lostCards, pipelineCards]);

  const selectedViewMeta = useMemo(() => {
    if (boardView === "followup") {
      return {
        title: "Follow-up",
        description: "Oportunidades ativas em acompanhamento, sem mudar a etapa comercial.",
      };
    }

    if (boardView === "attention") {
      return {
        title: "Ação necessária",
        description: "Oportunidades cuja etapa precisa de revisão antes de seguir.",
      };
    }

    if (boardView === "lost") {
      return {
        title: "Perdidas",
        description: "Oportunidades encerradas como perda.",
      };
    }

    if (boardView === "completed") {
      return {
        title: "Concluídas",
        description: "Oportunidades encerradas sem novas ações comerciais.",
      };
    }

    return {
      title: "Oportunidades de venda",
      description: "Acompanhe as oportunidades ativas por etapa comercial.",
    };
  }, [boardView]);

  const openManualLeadModal = useCallback(() => {
    setManualLeadCreateError(null);
    setIsCreateModalOpen(true);
  }, []);

  const closeManualLeadModal = useCallback(() => {
    if (isCreatingManualLead) return;
    setIsCreateModalOpen(false);
    setManualLeadCreateError(null);
  }, [isCreatingManualLead]);

  const updateManualLeadField = useCallback(
    <K extends keyof ManualLeadFormState>(field: K, value: ManualLeadFormState[K]) => {
      setManualLeadForm((current) => ({
        ...current,
        [field]: value,
      }));
    },
    [],
  );

  const handleCreateManualLeadSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (isCreatingManualLead) {
        return;
      }

      if (!organizationId) {
        setManualLeadCreateError(
          "Nao foi possivel identificar a organizacao autorizada para criar o lead.",
        );
        return;
      }

      const name = normalizeManualLeadText(manualLeadForm.name);
      const phone = normalizeManualLeadText(
        formatManualLeadPhone(manualLeadForm.phone),
      );

      if (!name && !phone) {
        setManualLeadCreateError(
          "Informe pelo menos o nome ou o telefone do novo lead comercial.",
        );
        return;
      }

      const requestSnapshot = buildManualCommercialLeadCreationSnapshot({
        name,
        phone,
      });
      const storageKey = buildManualCommercialLeadCreationStorageKey({
        organizationId,
        storeId: activeStoreId ?? null,
      });

      let operationId: string;

      try {
        operationId = getOrCreatePendingManualCommercialLeadCreationOperation({
          storage: window.localStorage,
          storageKey,
          requestSnapshot,
          createOperationId: () => crypto.randomUUID(),
        }).operationId;
      } catch (error) {
        setManualLeadCreateError(
          error instanceof Error
            ? error.message
            : "Nao foi possivel preparar a operacao local do novo lead.",
        );
        return;
      }

      setIsCreatingManualLead(true);
      setManualLeadCreateError(null);

      try {
        const response = await fetch("/api/crm/leads/manual", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            operationId,
            name,
            phone,
          }),
        });

        const body = (await response.json().catch(() => null)) as
          | (ManualLeadCreateApiResponse & Record<string, unknown>)
          | { ok?: false; message?: string; error?: string }
          | null;

        if (!response.ok || !body?.ok) {
          const message =
            typeof body?.message === "string" && body.message.trim()
              ? body.message.trim()
              : "Nao foi possivel criar o novo lead comercial.";
          throw new Error(message);
        }

        const href = buildCrmLeadConversationHref({
          leadId: body.leadId,
          conversationId: body.primaryConversationId,
          opportunityId: body.commercialOpportunityId,
        });

        if (!href) {
          throw new Error(
            "Nao foi possivel montar a navegacao da oportunidade criada.",
          );
        }

        clearPendingManualCommercialLeadCreationOperation({
          storage: window.localStorage,
          storageKey,
        });
        setIsCreateModalOpen(false);
        setManualLeadForm({
          name: "",
          phone: "",
        });
        setManualLeadCreateError(null);
        await fetchPageData({ silent: true });
        router.push(href);
      } catch (error) {
        setManualLeadCreateError(
          error instanceof Error
            ? error.message
            : "Nao foi possivel criar o novo lead comercial.",
        );
      } finally {
        setIsCreatingManualLead(false);
      }
    },
    [activeStoreId, fetchPageData, isCreatingManualLead, manualLeadForm, organizationId, router],
  );

  function renderCard(card: UiCardRow, options?: { showStage?: boolean }) {
    const showStage = options?.showStage === true;
    const stage = card.canonicalStage;
    const ui = getStageUi(stage);

    return (
      <button
        key={card.commercialOpportunityId}
        type="button"
        onClick={() => setSelectedCardId(card.commercialOpportunityId)}
        className="group relative w-full overflow-hidden rounded-2xl bg-white text-left shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
      >
        <div className={cx("absolute inset-x-0 top-0 h-1", ui.bar)} />

        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold leading-5 text-gray-950">
                {cardTitle(card)}
              </div>
              <div className="mt-1 truncate text-[13px] text-gray-500">
                {cardPhone(card) || "Sem telefone"}
              </div>
            </div>

            <span className="shrink-0 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-500 ring-1 ring-black/5">
              {formatCardDate(card)}
            </span>
          </div>

          {showStage ? (
            <div className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-700 ring-1 ring-black/5">
              <span className={cx("h-1.5 w-1.5 rounded-full", ui.dot)} />
              <span className="truncate">{stage ? stage.title : "Ação necessária"}</span>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {card.isFollowUpActive ? (
              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800 ring-1 ring-violet-200">
                Follow-up
              </span>
            ) : null}

            {card.isHumanActive ? (
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200">
                Humano assumiu
              </span>
            ) : null}

            {!stage ? (
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">
                Ação necessária
              </span>
            ) : null}

            {!card.conversationId ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                Sem conversa
              </span>
            ) : null}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3 text-xs">
            <span className="text-gray-400">
              {card.isFollowUpActive ? "Acompanhamento ativo" : "Oportunidade"}
            </span>
            <span className="font-semibold text-gray-700 transition group-hover:translate-x-0.5">
              Ver detalhes →
            </span>
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="min-h-[calc(100vh-151px)] overflow-x-hidden bg-gray-100">
      <div className="min-h-[calc(100vh-151px)]">
        <div className="border-b border-black/5 bg-white">
          <div className="mx-auto w-full max-w-[1320px] px-5 py-5">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-xl font-bold text-gray-950">Oportunidades de venda</h1>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void fetchPageData()}
                    title="Recarregar CRM"
                    aria-label="Recarregar CRM"
                    className="grid h-10 w-10 place-items-center rounded-xl bg-white text-base font-semibold text-gray-700 ring-1 ring-black/10 transition hover:bg-gray-50"
                  >
                    ↻
                  </button>

                  <button
                    type="button"
                    onClick={openManualLeadModal}
                    disabled={!canOpenManualLeadModal}
                    className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    + Novo lead
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-gray-50 px-4 py-3 ring-1 ring-black/5 xl:max-w-[720px]">
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
                      className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-600 ring-1 ring-black/10 hover:bg-gray-50"
                    >
                      Limpar
                    </button>
                  ) : null}
                </div>

                {!searchText.trim() ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {BOARD_VIEW_OPTIONS.map((option) => {
                      const count =
                        option.id === "active"
                          ? pipelineCards.length
                          : option.id === "followup"
                            ? followUpCards.length
                            : option.id === "attention"
                              ? attentionCards.length
                              : option.id === "lost"
                                ? lostCards.length
                                : completedCards.length;
                      const selected = boardView === option.id;

                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setBoardView(option.id)}
                          className={cx(
                            "flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold ring-1 transition",
                            selected
                              ? "bg-black text-white ring-black"
                              : "bg-white text-gray-600 ring-black/10 hover:bg-gray-50",
                          )}
                        >
                          <span>{option.label}</span>
                          <span
                            className={cx(
                              "rounded-full px-1.5 py-0.5 text-[10px]",
                              selected ? "bg-white/15 text-white" : "bg-gray-100 text-gray-600",
                            )}
                          >
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[1320px] px-5 py-5">
          {errorMsg ? (
            <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-600/20">
              <div className="font-semibold">Erro</div>
              <div className="mt-1 break-words">{errorMsg}</div>
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-2xl bg-white p-6 text-sm shadow-sm ring-1 ring-black/5">
              Carregando oportunidades...
            </div>
          ) : searchText.trim() ? (
            <div className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
              <div className="border-b border-black/5 px-5 py-4">
                <div className="text-base font-semibold text-gray-900">Resultados da busca</div>
                <div className="mt-1 text-sm text-gray-500">
                  {searchResults.length} resultado(s) encontrado(s)
                </div>
              </div>

              <div className="bg-gray-50/70 p-5">
                {searchResults.length === 0 ? (
                  <div className="rounded-xl bg-white p-5 text-sm text-gray-600 ring-1 ring-black/5">
                    Nenhuma oportunidade encontrada com essa busca.
                  </div>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {searchResults.map((card) => renderCard(card, { showStage: true }))}
                  </div>
                )}
              </div>
            </div>
          ) : boardView === "active" ? (
            <div className="space-y-4">
              <section className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/5 px-5 py-4">
                  <div>
                    <div className="text-base font-semibold text-gray-900">Etapas da venda</div>
                  </div>
                  <div className="text-sm font-medium text-gray-400">
                    {pipelineCards.length} oportunidade(s) ativas
                  </div>
                </div>

                <div className="grid gap-2.5 p-4 sm:grid-cols-2 xl:grid-cols-4">
                  {PIPELINE_STAGES.map((stage) => {
                    const items = stageCardsById.get(stage.id) || [];
                    const ui = getStageUi(stage);
                    const selected = selectedPipelineStage?.id === stage.id;

                    return (
                      <button
                        key={stage.id}
                        type="button"
                        onClick={() => {
                          setSelectedPipelineStageId(stage.id);
                          setShowAllSelectedStageCards(false);
                        }}
                        className={cx(
                          "group flex min-h-[48px] items-center gap-3 rounded-xl px-4 py-2 text-left ring-1 transition",
                          selected
                            ? "bg-gray-950 text-white shadow-md ring-gray-950"
                            : "bg-gray-50 text-gray-900 ring-black/5 hover:bg-white hover:shadow-sm hover:ring-black/10",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={cx("h-2 w-2 shrink-0 rounded-full", ui.dot)} />
                            <span className="truncate text-sm font-semibold">{stage.title}</span>
                          </div>
                        </div>

                        <span
                          className={cx(
                            "shrink-0 rounded-full px-2 py-1 text-xs font-semibold",
                            selected ? "bg-white/10 text-white" : "bg-white text-gray-600 ring-1 ring-black/5",
                          )}
                        >
                          {items.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 px-5 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cx(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        getStageUi(selectedPipelineStage).dot,
                      )}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-gray-950">
                        {selectedPipelineStage?.title || "Etapa"}
                      </div>
                      <div className="mt-0.5 text-sm text-gray-500">
                        {selectedPipelineStageCards.length} oportunidade(s) nesta etapa
                      </div>
                    </div>
                  </div>

                  {selectedPipelineStageCards.length > 9 ? (
                    <button
                      type="button"
                      onClick={() => setShowAllSelectedStageCards((current) => !current)}
                      className="rounded-xl bg-gray-50 px-3.5 py-2 text-xs font-semibold text-gray-700 ring-1 ring-black/10 transition hover:bg-gray-100"
                    >
                      {showAllSelectedStageCards
                        ? "Mostrar menos"
                        : `Ver todas as ${selectedPipelineStageCards.length}`}
                    </button>
                  ) : null}
                </div>

                <div className="bg-gray-50/60 p-4">
                  {selectedPipelineStageCards.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-white px-5 py-10 text-center text-sm text-gray-400">
                      Nenhuma oportunidade nesta etapa.
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {visibleSelectedPipelineStageCards.map((card) => renderCard(card))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
              <div className="border-b border-black/5 px-5 py-4">
                <div className="text-base font-semibold text-gray-900">{selectedViewMeta.title}</div>
                <div className="mt-1 text-sm text-gray-500">{selectedViewMeta.description}</div>
              </div>

              <div className="bg-gray-50/70 p-5">
                {selectedViewCards.length === 0 ? (
                  <div className="rounded-xl bg-white p-5 text-sm text-gray-600 ring-1 ring-black/5">
                    Nenhuma oportunidade nesta visão.
                  </div>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                    {selectedViewCards.map((card) => renderCard(card, { showStage: true }))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedCard ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/30"
          onClick={() => setSelectedCardId(null)}
        >
          <aside
            className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shrink-0 border-b border-black/10 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                    Oportunidade comercial
                  </div>
                  <h2 className="mt-1 truncate text-xl font-bold text-gray-950">
                    {cardTitle(selectedCard)}
                  </h2>
                  <div className="mt-1 text-sm text-gray-500">
                    {cardPhone(selectedCard) || "Sem telefone"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedCardId(null)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gray-50 text-sm font-semibold text-gray-600 ring-1 ring-black/10 hover:bg-gray-100"
                  aria-label="Fechar detalhes da oportunidade"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-5">
              <div className="space-y-3">
                <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Etapa atual
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className={cx(
                        "h-2.5 w-2.5 rounded-full",
                        getStageUi(selectedCard.canonicalStage).dot,
                      )}
                    />
                    <span className="text-sm font-semibold text-gray-900">
                      {selectedCard.canonicalStage?.title || "Ação necessária"}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    Atualizada em {formatCardDate(selectedCard)}.
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Situação operacional
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedCard.isFollowUpActive ? (
                      <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800 ring-1 ring-violet-200">
                        Follow-up ativo
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-600 ring-1 ring-black/5">
                        Sem follow-up ativo
                      </span>
                    )}

                    {selectedCard.isHumanActive ? (
                      <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 ring-1 ring-sky-200">
                        Humano assumiu
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        IA disponível
                      </span>
                    )}

                    {!selectedCard.canonicalStage ? (
                      <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">
                        Revisar etapa
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Vínculos
                  </div>
                  <dl className="mt-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-gray-500">Conversa</dt>
                      <dd className="font-semibold text-gray-800">
                        {selectedCard.conversationId ? "Vinculada" : "Não vinculada"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-gray-500">Lead</dt>
                      <dd className="font-semibold text-gray-800">
                        {selectedCard.leadId ? "Vinculado" : "Não vinculado"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-2xl border border-dashed border-gray-200 bg-white/70 p-4 text-xs text-gray-500">
                  {selectedCard.canonicalStage ? MOVEMENT_LOCK_MESSAGE : getAttentionReason()}
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-black/10 bg-white p-4">
              {buildCrmLeadConversationHref({
                leadId: selectedCard.leadId,
                conversationId: selectedCard.conversationId,
                opportunityId: selectedCard.commercialOpportunityId,
              }) ? (
                <Link
                  href={
                    buildCrmLeadConversationHref({
                      leadId: selectedCard.leadId,
                      conversationId: selectedCard.conversationId,
                      opportunityId: selectedCard.commercialOpportunityId,
                    })!
                  }
                  className="flex w-full items-center justify-center rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                >
                  Abrir oportunidade
                </Link>
              ) : (
                <div className="rounded-xl bg-gray-100 px-4 py-3 text-center text-sm font-semibold text-gray-500 ring-1 ring-gray-200">
                  Oportunidade sem navegação disponível
                </div>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {isCreateModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6"
          onClick={closeManualLeadModal}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-black/10"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-900">Novo lead</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Cadastre um novo lead comercial manual sem criar conversa ou mensagem ficticia.
                </p>
              </div>

              <button
                type="button"
                onClick={closeManualLeadModal}
                disabled={isCreatingManualLead}
                className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-gray-700 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Fechar modal de novo lead"
              >
                X
              </button>
            </div>

            <form onSubmit={handleCreateManualLeadSubmit} className="px-5 py-4">
              <div className="space-y-4">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Nome
                  </span>
                  <input
                    value={manualLeadForm.name}
                    onChange={(event) =>
                      updateManualLeadField("name", event.target.value)
                    }
                    disabled={isCreatingManualLead}
                    placeholder="Ex.: Cliente interessado em piscina"
                    className="w-full rounded-xl bg-white px-3 py-2 text-sm text-gray-900 ring-1 ring-black/10 outline-none transition focus:ring-2 focus:ring-black/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Telefone
                  </span>
                  <input
                    value={manualLeadForm.phone}
                    onChange={(event) =>
                      updateManualLeadField(
                        "phone",
                        formatManualLeadPhone(event.target.value),
                      )
                    }
                    disabled={isCreatingManualLead}
                    inputMode="numeric"
                    placeholder="Ex.: (11) 99999-9999"
                    className="w-full rounded-xl bg-white px-3 py-2 text-sm text-gray-900 ring-1 ring-black/10 outline-none transition focus:ring-2 focus:ring-black/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>

                <div className="rounded-xl bg-gray-50 px-3 py-3 text-xs text-gray-600 ring-1 ring-black/5">
                  Preencha pelo menos nome ou telefone. O telefone informado aqui nao
                  define identidade WhatsApp.
                </div>

                {manualLeadCreateError ? (
                  <div className="rounded-xl bg-red-50 px-3 py-3 text-sm text-red-800 ring-1 ring-red-200">
                    {manualLeadCreateError}
                  </div>
                ) : null}
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeManualLeadModal}
                  disabled={isCreatingManualLead}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isCreatingManualLead}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreatingManualLead ? "Criando lead..." : "Criar lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
