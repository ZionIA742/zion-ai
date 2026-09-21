"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useStoreContext } from "@/components/StoreProvider";
import { buildCrmLeadConversationHref } from "@/lib/server/crm/lead-conversation-opportunity-context";
import { sortFollowupRowsByCanonicalPriority } from "./followup-priority-order";
import {
  buildGoogleMapsDirectionsUrl,
  buildStoreAddressText,
  getTextFromRoutePayload,
  type StoreGeneralAddressLike,
} from "@/lib/google-maps-route";

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
  commercial_opportunity_id: string;
  conversation_id: string;
  lead_id: string;
  lead_name: string | null;
  lead_phone: string | null;
  conversation_status: string | null;
  opportunity_stage: string | null;
  is_human_active: boolean | null;
  last_customer_message_at: string | null;
  last_ai_message_at: string | null;
  hours_since_customer: number | null;
  followup_type?: string | null;
  suggested_action: string | null;
  operational_state?: string | null;
  blocked_reason: string | null;
  followup_id?: string | null;
  followup_cycle?: number | null;
  followup_status?: string | null;
  next_action?: string | null;
  next_action_at?: string | null;
  attempt_count?: number | null;
  exhausted?: boolean | null;
  opted_out?: boolean | null;
  consent_restored?: boolean | null;
  reason_code?: string | null;
  reason_details?: string | null;
  context?: Record<string, unknown> | null;
  total_count?: number | null;
  ready_count?: number | null;
  waiting_count?: number | null;
  blocked_count?: number | null;
};

type CommercialHandoffTaskRow = {
  related_conversation_id: string | null;
  commercial_opportunity_id?: string | null;
  task_type: string | null;
  status: string | null;
  task_payload: Record<string, unknown> | null;
};

type CommercialHandoffIndicator = {
  hasVisitRequest: boolean;
  hasQuoteRequest: boolean;
  routeAddressText: string | null;
};

type PriorityRow = {
  commercial_opportunity_id: string;
  priority_band: string | null;
  priority_rank: number | null;
  reason_codes: string[] | null;
};

type FollowupTotals = {
  all: number;
  ready: number;
  waiting: number;
  blocked: number;
};

const INBOX_OPEN_SECTION_KEY = "zion:inbox:open-section";
const INBOX_SCROLL_KEY = "zion:inbox:scroll";
const EMPTY_FOLLOWUP_TOTALS: FollowupTotals = {
  all: 0,
  ready: 0,
  waiting: 0,
  blocked: 0,
};
const OPEN_COMMERCIAL_HANDOFF_STATUSES = [
  "open",
  "waiting_user_choice",
  "waiting_customer_response",
  "ready_to_execute",
  "in_progress",
];

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

function getRouteAddressFromCommercialPayload(payload: Record<string, unknown> | null | undefined) {
  return getTextFromRoutePayload(payload);
}

function openGoogleMapsRoute(originAddress: string | null | undefined, destinationAddress: string | null | undefined) {
  const routeUrl = buildGoogleMapsDirectionsUrl({
    origin: originAddress,
    destination: destinationAddress,
  });

  if (!routeUrl) {
    return;
  }

  window.open(routeUrl, "_blank", "noopener,noreferrer");
}

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

function formatBlockedReason(value: string | null) {
  const normalized = String(value || "").toLowerCase();

  if (!normalized) return "Liberado";
  if (normalized === "humano_ativo") return "Humano ativo";
  if (normalized === "aguardando_janela") return "Aguardando janela";
  if (normalized === "sem_mensagem_cliente") return "Sem mensagem";
  if (normalized === "cliente_ainda_recente") return "Cliente recente";
  if (normalized === "acao_ja_enfileirada") return "Já enfileirado";
  if (normalized === "followup_recente") return "Follow-up recente";
  if (normalized === "followup_ja_ativo") return "Follow-up já ativo";
  if (normalized === "primary_conversation_scope_inconsistency") {
    return "Conversa fora do contexto da oportunidade";
  }
  if (normalized === "multiple_opportunities_same_conversation") {
    return "Mais de uma oportunidade nesta conversa";
  }

  return value ? "Bloqueio não classificado" : "-";
}

function formatSuggestedAction(value: string | null) {
  const normalized = String(value || "").toLowerCase();

  if (normalized === "followup_offer") return "Proposta";
  if (normalized === "followup_visit") return "Visita";

  return value || "Follow-up";
}

function getFollowupActionValue(row: FollowupCandidateRow) {
  const followupType = String(row.followup_type || "").toLowerCase();
  if (followupType === "offer") return "followup_offer";
  if (followupType === "visit") return "followup_visit";

  const suggestedAction = String(row.suggested_action || "").toLowerCase();
  if (suggestedAction === "followup_offer" || suggestedAction === "followup_visit") {
    return suggestedAction;
  }

  return null;
}

function getFollowupWriterType(row: FollowupCandidateRow) {
  const actionValue = getFollowupActionValue(row);
  if (actionValue === "followup_visit") return "visit";
  if (actionValue === "followup_offer") return "offer";
  return null;
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
  if (kind === "pending") return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  if (kind === "neutral") return "bg-gray-100 text-gray-700 ring-1 ring-black/10";
  return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
}

type FollowupFilter = "all" | "ready" | "waiting" | "blocked";

function getFollowupBucket(row: FollowupCandidateRow): Exclude<FollowupFilter, "all"> {
  const operationalState = String(row.operational_state || "").toLowerCase();
  if (operationalState === "ready" || operationalState === "waiting" || operationalState === "blocked") {
    return operationalState;
  }

  const reason = String(row.blocked_reason || "").toLowerCase();

  if (!reason) return "ready";
  if (["aguardando_janela", "cliente_ainda_recente", "followup_recente", "acao_ja_enfileirada"].includes(reason)) {
    return "waiting";
  }
  return "blocked";
}

function getFollowupBucketLabel(row: FollowupCandidateRow) {
  const bucket = getFollowupBucket(row);
  if (bucket === "ready") return "Pronto para contato";
  if (bucket === "waiting") return "Aguardando momento";
  return "Bloqueado";
}

function getFollowupBucketClasses(row: FollowupCandidateRow) {
  const bucket = getFollowupBucket(row);
  if (bucket === "ready") return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200";
  if (bucket === "waiting") return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  return "bg-gray-100 text-gray-700 ring-1 ring-gray-300";
}

function getFollowupActionClasses(value: string | null) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "followup_visit") return "bg-orange-50 text-orange-800 ring-1 ring-orange-200";
  if (normalized === "followup_offer") return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
  if (!normalized) return "bg-gray-100 text-gray-700 ring-1 ring-black/10";
  return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
}

function normalizePhoneSearch(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

type MessageFilter = "all" | "waiting" | "zion_last" | "commercial";

export default function InboxPage() {
  const {
    loading: storeLoading,
    error: storeError,
    organizationId,
    activeStoreId,
  } = useStoreContext();

  const [rows, setRows] = useState<InboxRow[]>([]);
  const [leadNames, setLeadNames] = useState<Record<string, string>>({});
  const [followupRows, setFollowupRows] = useState<FollowupCandidateRow[]>([]);
  const [followupTotals, setFollowupTotals] = useState<FollowupTotals>(EMPTY_FOLLOWUP_TOTALS);
  const [followupHasLoadedSuccessfully, setFollowupHasLoadedSuccessfully] = useState(false);
  const [priorityByOpportunity, setPriorityByOpportunity] = useState<Record<string, PriorityRow>>({});
  const [storeRouteOriginAddress, setStoreRouteOriginAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [followupErrorText, setFollowupErrorText] = useState<string | null>(null);
  const [followupStatusText, setFollowupStatusText] = useState<string | null>(null);
  const [triggeringOpportunityId, setTriggeringOpportunityId] = useState<string | null>(null);
  const [followupTypeChooserOpportunityId, setFollowupTypeChooserOpportunityId] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<"followup" | "messages" | null>(null);
  const [messageFilter, setMessageFilter] = useState<MessageFilter>("all");
  const [followupFilter, setFollowupFilter] = useState<FollowupFilter>("all");
  const [followupSearchText, setFollowupSearchText] = useState("");
  const [commercialHandoffByConversation, setCommercialHandoffByConversation] = useState<
    Record<string, CommercialHandoffIndicator>
  >({});

  const restoredSectionRef = useRef(false);
  const restoredScrollRef = useRef(false);
  const loadInboxRequestSeqRef = useRef(0);

  const canLoadInbox = useMemo(() => {
    return !storeLoading && !!organizationId;
  }, [storeLoading, organizationId]);

  useEffect(() => {
    if (typeof window === "undefined" || restoredSectionRef.current) return;

    const saved = window.localStorage.getItem(INBOX_OPEN_SECTION_KEY);
    if (saved === "followup" || saved === "messages") {
      setOpenSection(saved);
    } else {
      setOpenSection(null);
    }

    restoredSectionRef.current = true;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (openSection) {
      window.localStorage.setItem(INBOX_OPEN_SECTION_KEY, openSection);
    } else {
      window.localStorage.removeItem(INBOX_OPEN_SECTION_KEY);
    }
  }, [openSection]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const saveScroll = () => {
      window.sessionStorage.setItem(INBOX_SCROLL_KEY, String(window.scrollY));
    };

    saveScroll();
    window.addEventListener("scroll", saveScroll, { passive: true });
    return () => window.removeEventListener("scroll", saveScroll);
  }, []);

  const loadFollowupCandidates = useCallback(async () => {
    if (!organizationId) return;

    const pageSize = 100;
    const rows: FollowupCandidateRow[] = [];
    const totals: FollowupTotals = { ...EMPTY_FOLLOWUP_TOTALS };
    let offset = 0;
    let expectedTotal: number | null = null;

    while (expectedTotal === null || offset < expectedTotal) {
      const { data, error } = await supabase.rpc("panel_list_followup_opportunity_candidates_scoped_v4", {
        p_organization_id: organizationId,
        p_store_id: activeStoreId ?? null,
        p_min_hours_since_customer: 24,
        p_limit: pageSize,
        p_offset: offset,
      });

      if (error) {
        console.error("[InboxPage] panel_list_followup_opportunity_candidates_scoped_v4 error:", error);
        setFollowupErrorText(`Erro ao atualizar follow-ups: ${error.message}`);
        return;
      }

      const pageRows = (data || []) as FollowupCandidateRow[];
      const firstRow = pageRows[0];

      if (firstRow) {
        expectedTotal = Number(firstRow.total_count || 0);
        if (offset === 0) {
          totals.all = expectedTotal;
          totals.ready = Number(firstRow.ready_count || 0);
          totals.waiting = Number(firstRow.waiting_count || 0);
          totals.blocked = Number(firstRow.blocked_count || 0);
        }
      } else {
        expectedTotal = 0;
      }

      rows.push(...pageRows);

      if (pageRows.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    setFollowupErrorText(null);
    setFollowupRows(rows);
    setFollowupTotals(totals);
    setFollowupHasLoadedSuccessfully(true);
  }, [organizationId, activeStoreId]);

  const loadCommercialPriority = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setPriorityByOpportunity({});
      return;
    }

    const { data, error } = await supabase.rpc("panel_list_commercial_opportunity_priority_scoped", {
      p_organization_id: organizationId,
      p_store_id: activeStoreId,
      p_limit: 200,
      p_offset: 0,
      p_as_of: null,
    });

    if (error) {
      console.warn("[InboxPage] panel_list_commercial_opportunity_priority_scoped error:", error);
      setPriorityByOpportunity({});
      return;
    }

    const nextMap: Record<string, PriorityRow> = {};
    for (const row of (data || []) as PriorityRow[]) {
      const opportunityId = String(row.commercial_opportunity_id || "").trim();
      if (opportunityId) nextMap[opportunityId] = row;
    }

    setPriorityByOpportunity(nextMap);
  }, [organizationId, activeStoreId]);

  const loadStoreRouteOriginAddress = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setStoreRouteOriginAddress(null);
      return;
    }

    const { data, error } = await supabase.rpc("read_store_general_address_settings_scoped", {
      p_organization_id: organizationId,
      p_store_id: activeStoreId,
    });

    if (error) {
      console.warn("[InboxPage] read_store_general_address_settings_scoped error:", error);
      setStoreRouteOriginAddress(null);
      return;
    }

    const rows = Array.isArray(data) ? (data as StoreGeneralAddressLike[]) : [];
    setStoreRouteOriginAddress(buildStoreAddressText(rows[0] || null));
  }, [organizationId, activeStoreId]);

  const loadCommercialHandoffIndicators = useCallback(
    async (inboxRows: InboxRow[]) => {
      if (!organizationId) {
        setCommercialHandoffByConversation({});
        return;
      }

      const conversationIds = [...new Set(inboxRows.map((row) => row.conversation_id).filter(Boolean))];

      if (conversationIds.length === 0) {
        setCommercialHandoffByConversation({});
        return;
      }

      let query = supabase
        .from("store_assistant_operational_tasks")
        .select("related_conversation_id, commercial_opportunity_id, task_type, status, task_payload")
        .eq("organization_id", organizationId)
        .in("related_conversation_id", conversationIds)
        .in("task_type", ["commercial_visit_request", "commercial_quote_request"])
        .in("status", OPEN_COMMERCIAL_HANDOFF_STATUSES);

      if (activeStoreId) {
        query = query.eq("store_id", activeStoreId);
      } else {
        const storeIds = [...new Set(inboxRows.map((row) => row.store_id).filter(Boolean))];
        if (storeIds.length > 0) {
          query = query.in("store_id", storeIds);
        }
      }

      const { data, error } = await query;

      if (error) {
        console.warn("[InboxPage] erro ao carregar handoffs comerciais:", error);
        setCommercialHandoffByConversation({});
        return;
      }

      const nextMap: Record<string, CommercialHandoffIndicator> = {};

      for (const task of (data || []) as CommercialHandoffTaskRow[]) {
        const conversationId = String(task.related_conversation_id || "").trim();
        if (!conversationId) continue;

        if (!nextMap[conversationId]) {
          nextMap[conversationId] = {
            hasVisitRequest: false,
            hasQuoteRequest: false,
            routeAddressText: null,
          };
        }

        if (task.task_type === "commercial_visit_request") {
          nextMap[conversationId].hasVisitRequest = true;

          const routeAddressText = getRouteAddressFromCommercialPayload(task.task_payload);
          if (routeAddressText && !nextMap[conversationId].routeAddressText) {
            nextMap[conversationId].routeAddressText = routeAddressText;
          }
        }

        if (task.task_type === "commercial_quote_request") {
          nextMap[conversationId].hasQuoteRequest = true;
        }
      }

      setCommercialHandoffByConversation(nextMap);
    },
    [organizationId, activeStoreId]
  );

  const loadInbox = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (!canLoadInbox || !organizationId) return;

      const requestSeq = loadInboxRequestSeqRef.current + 1;
      loadInboxRequestSeqRef.current = requestSeq;

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setErrorText(null);

      const inboxPageSize = 100;
      const inboxRows: InboxRow[] = [];
      let inboxOffset = 0;

      while (true) {
        const { data, error } = await supabase.rpc("panel_list_inbox", {
          p_organization_id: organizationId,
          p_store_id: activeStoreId ?? null,
          p_limit: inboxPageSize,
          p_offset: inboxOffset,
        });

        if (requestSeq !== loadInboxRequestSeqRef.current) {
          return;
        }

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

        const pageRows = (data || []) as InboxRow[];
        inboxRows.push(...pageRows);

        if (pageRows.length < inboxPageSize) {
          break;
        }

        inboxOffset += inboxPageSize;
      }

      setRows(inboxRows);
      await loadCommercialHandoffIndicators(inboxRows);
      if (requestSeq !== loadInboxRequestSeqRef.current) {
        return;
      }

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
        if (requestSeq !== loadInboxRequestSeqRef.current) {
          return;
        }
        setLeadNames(map);
      } else {
        setLeadNames({});
      }

      await Promise.all([
        loadFollowupCandidates(),
        loadCommercialPriority(),
        loadStoreRouteOriginAddress(),
      ]);

      if (requestSeq !== loadInboxRequestSeqRef.current) {
        return;
      }

      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    },
    [
      canLoadInbox,
      organizationId,
      activeStoreId,
      loadCommercialHandoffIndicators,
      loadFollowupCandidates,
      loadCommercialPriority,
      loadStoreRouteOriginAddress,
    ]
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

  useEffect(() => {
    if (!canLoadInbox) return;

    let lastRefreshAt = 0;

    const triggerSilentRefresh = () => {
      const now = Date.now();
      if (now - lastRefreshAt < 1000) return;
      lastRefreshAt = now;
      void loadInbox({ silent: true });
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
  }, [canLoadInbox, loadInbox]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loading || storeLoading) return;
    if (restoredScrollRef.current) return;

    const saved = window.sessionStorage.getItem(INBOX_SCROLL_KEY);
    const parsed = saved ? Number(saved) : 0;

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: Number.isFinite(parsed) ? parsed : 0, behavior: "auto" });
      restoredScrollRef.current = true;
    });
  }, [loading, storeLoading]);

  const pendingReplyCount = useMemo(() => rows.filter(isPendingReply).length, [rows]);
  const commercialPendingConversationCount = useMemo(
    () => Object.keys(commercialHandoffByConversation).length,
    [commercialHandoffByConversation]
  );

  const storeLastMessageCount = useMemo(
    () => rows.filter((row) => String(row.last_message_direction || "").toLowerCase() === "outgoing").length,
    [rows]
  );

  const visibleMessageRows = useMemo(() => {
    if (messageFilter === "waiting") return rows.filter(isPendingReply);
    if (messageFilter === "zion_last") {
      return rows.filter((row) => String(row.last_message_direction || "").toLowerCase() === "outgoing");
    }
    if (messageFilter === "commercial") {
      return rows.filter((row) => Boolean(commercialHandoffByConversation[row.conversation_id]));
    }
    return rows;
  }, [commercialHandoffByConversation, messageFilter, rows]);

  const sortedFollowupRows = useMemo(() => {
    return sortFollowupRowsByCanonicalPriority(followupRows, priorityByOpportunity);
  }, [followupRows, priorityByOpportunity]);

  const visibleFollowupRows = useMemo(() => {
    const bucketRows =
      followupFilter === "all"
        ? sortedFollowupRows
        : sortedFollowupRows.filter((row) => getFollowupBucket(row) === followupFilter);

    const query = followupSearchText.trim().toLowerCase();
    if (!query) return bucketRows;

    const queryDigits = normalizePhoneSearch(query);
    return bucketRows.filter((row) => {
      const name = String(row.lead_name || "").toLowerCase();
      const phoneDigits = normalizePhoneSearch(row.lead_phone);
      return name.includes(query) || (queryDigits.length > 0 && phoneDigits.includes(queryDigits));
    });
  }, [followupFilter, followupSearchText, sortedFollowupRows]);

  const followupCountLabel = followupHasLoadedSuccessfully ? String(followupTotals.all) : "-";
  const followupFilterCounts = followupHasLoadedSuccessfully
    ? followupTotals
    : {
        all: "-",
        ready: "-",
        waiting: "-",
        blocked: "-",
      };
  const followupSearchActive = followupSearchText.trim().length > 0;

  async function triggerManualFollowup(candidate: FollowupCandidateRow, selectedFollowupType?: "offer" | "visit") {
    if (!organizationId) {
      setFollowupErrorText("Organização não carregada.");
      return;
    }

    if (!activeStoreId) {
      setFollowupErrorText("Loja não carregada.");
      return;
    }
    if (!candidate.commercial_opportunity_id || !candidate.conversation_id) {
      setFollowupErrorText("Follow-up sem identidade canônica suficiente.");
      return;
    }

    const followupType = selectedFollowupType ?? getFollowupWriterType(candidate);

    if (!followupType) {
      setFollowupTypeChooserOpportunityId(candidate.commercial_opportunity_id);
      return;
    }

    setTriggeringOpportunityId(candidate.commercial_opportunity_id);
    setFollowupTypeChooserOpportunityId(null);
    setFollowupErrorText(null);
    setFollowupStatusText(null);
    const cadenceIntervalMinutes = 1440;
    const operationKey = `inbox-manual:${crypto.randomUUID()}`;
    const nextActionAt = new Date(Date.now() + cadenceIntervalMinutes * 60 * 1000).toISOString();

    const { data, error } = await supabase.rpc("panel_enqueue_followup_opportunity_scoped", {
      p_organization_id: organizationId,
      p_store_id: activeStoreId,
      p_commercial_opportunity_id: candidate.commercial_opportunity_id,
      p_conversation_id: candidate.conversation_id,
      p_followup_type: followupType,
      p_operation_key: operationKey,
      p_cadence_interval_minutes: cadenceIntervalMinutes,
      p_next_action_at: nextActionAt,
    });

    if (error) {
      console.error("[InboxPage] panel_enqueue_followup_opportunity_scoped error:", error);
      setFollowupErrorText(error.message);
      setTriggeringOpportunityId(null);
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
      setTriggeringOpportunityId(null);
      await loadFollowupCandidates();
      return;
    }

    setFollowupStatusText(
      `Follow-up enfileirado com sucesso para a conversa ${shortId(
        result.conversation_id || candidate.conversation_id
      )}.`
    );
    setTriggeringOpportunityId(null);
    await loadFollowupCandidates();
  }

  function toggleSection(section: "followup" | "messages") {
    setOpenSection((current) => (current === section ? null : section));
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-gray-100">
      <div className="mx-auto max-w-7xl overflow-x-hidden px-6 py-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-gray-950" />
              <h1 className="text-2xl font-bold text-gray-950">Central de atenção</h1>
            </div>
            {storeError ? (
              <div className="mt-2 text-xs font-medium text-red-700">
                Erro ao carregar o contexto da loja: {storeError}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {refreshing ? (
              <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-600 shadow-sm ring-1 ring-black/5">
                Atualizando...
              </div>
            ) : null}

            <button
              onClick={() => void loadInbox()}
              disabled={loading || storeLoading || !organizationId}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-base font-semibold text-gray-700 shadow-sm ring-1 ring-black/10 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              title="Recarregar"
              aria-label="Recarregar central de atenção"
            >
              ↻
            </button>
          </div>
        </div>

        {errorText ? (
          <div className="mb-4 rounded-xl bg-red-50 p-4 text-red-800 ring-1 ring-red-200">{errorText}</div>
        ) : null}

        {followupErrorText ? (
          <div className="mb-4 rounded-xl bg-red-50 p-4 text-red-800 ring-1 ring-red-200">{followupErrorText}</div>
        ) : null}

        {followupStatusText ? (
          <div className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200">
            {followupStatusText}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={() => toggleSection("messages")}
            className={`relative overflow-hidden rounded-2xl p-5 text-left shadow-sm ring-1 transition ${
              openSection === "messages"
                ? "bg-gray-950 text-white ring-gray-950"
                : "bg-white text-gray-950 ring-black/5 hover:bg-gray-50"
            }`}
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gray-950" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${openSection === "messages" ? "text-gray-300" : "text-gray-500"}`}>
                  Conversas
                </div>
                <div className={`mt-1 text-lg font-bold ${openSection === "messages" ? "text-white" : "text-gray-950"}`}>Mensagens</div>
                <div className={`mt-1 text-sm ${openSection === "messages" ? "text-gray-300" : "text-gray-600"}`}>
                  Veja quem falou por último e quem está esperando resposta.
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${openSection === "messages" ? "bg-white text-gray-950 ring-white" : "bg-gray-100 text-gray-800 ring-gray-200"}`}>
                  {pendingReplyCount} aguardando
                </span>
                {commercialPendingConversationCount > 0 ? (
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${openSection === "messages" ? "bg-gray-800 text-white ring-gray-700" : "bg-gray-100 text-gray-700 ring-gray-200"}`}>
                    {commercialPendingConversationCount} comerciais
                  </span>
                ) : null}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => toggleSection("followup")}
            className={`relative overflow-hidden rounded-2xl p-5 text-left shadow-sm ring-1 transition ${
              openSection === "followup"
                ? "bg-gray-950 text-white ring-gray-950"
                : "bg-white text-gray-950 ring-black/5 hover:bg-gray-50"
            }`}
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gray-950" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${openSection === "followup" ? "text-gray-300" : "text-gray-500"}`}>
                  Retomadas comerciais
                </div>
                <div className={`mt-1 text-lg font-bold ${openSection === "followup" ? "text-white" : "text-gray-950"}`}>Follow-up</div>
                <div className={`mt-1 text-sm ${openSection === "followup" ? "text-gray-300" : "text-gray-600"}`}>
                  Organize quem pode receber contato agora e quem precisa aguardar.
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ring-1 ${openSection === "followup" ? "bg-white text-gray-950 ring-white" : "bg-gray-100 text-gray-800 ring-gray-200"}`}>
                {followupHasLoadedSuccessfully ? followupRows.length : "-"}
              </span>
            </div>
          </button>
        </div>

        {openSection === null ? (
          <div className="mt-4 rounded-2xl bg-white px-5 py-8 text-center shadow-sm ring-1 ring-black/5">
            <div className="text-sm font-semibold text-gray-900">Escolha o que você quer acompanhar</div>
            <div className="mt-1 text-sm text-gray-500">Mensagens e follow-ups ficam separados para a tela continuar simples.</div>
          </div>
        ) : null}

        {openSection === "messages" ? (
          <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
            <div className="border-b border-black/5 px-5 py-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-950">Mensagens recentes</h2>
                  <p className="mt-1 text-sm text-gray-500">Aguardando resposta significa que o cliente falou por último.</p>
                </div>
                <div className="text-sm font-semibold text-gray-500">{rows.length} conversas</div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {([
                  ["all", "Todas", rows.length, "bg-black text-white ring-black"],
                  ["waiting", "Aguardando resposta", pendingReplyCount, "bg-amber-500 text-white ring-amber-500"],
                  ["zion_last", "Loja respondeu por último", storeLastMessageCount, "bg-emerald-600 text-white ring-emerald-600"],
                  ["commercial", "Pendência comercial", commercialPendingConversationCount, "bg-gray-800 text-white ring-gray-800"],
                ] as const).map(([value, label, count, activeClass]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMessageFilter(value)}
                    className={`rounded-full px-3 py-2 text-xs font-semibold ring-1 transition ${
                      messageFilter === value
                        ? activeClass
                        : "bg-white text-gray-700 ring-black/10 hover:bg-gray-50"
                    }`}
                  >
                    {label} <span className="ml-1 opacity-80">{count}</span>
                  </button>
                ))}
              </div>

            </div>

            <div className="space-y-3 p-4">
              {!loading && !storeLoading && visibleMessageRows.length === 0 ? (
                <div className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 ring-1 ring-black/5">
                  Nenhuma conversa encontrada neste filtro.
                </div>
              ) : (
                visibleMessageRows.map((row) => {
                  const pending = isPendingReply(row);
                  const handoffIndicator = commercialHandoffByConversation[row.conversation_id];
                  const handoffLabel = getCommercialHandoffBadgeLabel(handoffIndicator);
                  const routeUrl = buildGoogleMapsDirectionsUrl({
                    origin: storeRouteOriginAddress,
                    destination: handoffIndicator?.routeAddressText,
                  });
                  const conversationHref =
                    buildCrmLeadConversationHref({
                      leadId: row.lead_id,
                      conversationId: row.conversation_id,
                    }) || `/crm/lead/${row.lead_id}`;

                  return (
                    <div
                      key={row.conversation_id}
                      className={`overflow-hidden rounded-2xl border ${pending ? "border-amber-200 bg-amber-50/45" : "border-emerald-100 bg-emerald-50/35"}`}
                    >
                      <div className={`h-1 w-full ${pending ? "bg-amber-500" : "bg-emerald-500"}`} />
                      <div className="p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-[15px] font-bold text-gray-950">{leadNames[row.lead_id] || `Lead ${shortId(row.lead_id)}`}</div>
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${row.is_human_active ? chipClasses("human") : chipClasses("ia")}`}>
                                {row.is_human_active ? "Atendimento humano" : "IA ativa"}
                              </span>
                              {pending ? (
                                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">Cliente aguardando</span>
                              ) : (
                                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">Respondido</span>
                              )}
                              {handoffLabel ? (
                                <span className="rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-800 ring-1 ring-orange-200">{handoffLabel}</span>
                              ) : null}
                            </div>

                            <div className="mt-2 text-xs text-gray-500">{formatDateTime(row.last_message_at)} • {row.status || "status não informado"}</div>
                            <div className="mt-2 line-clamp-2 break-words text-sm leading-6 text-gray-800">{row.last_message_preview || "Sem prévia da mensagem."}</div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {handoffIndicator?.hasVisitRequest ? (
                              <button
                                type="button"
                                onClick={() => openGoogleMapsRoute(storeRouteOriginAddress, handoffIndicator.routeAddressText)}
                                disabled={!routeUrl}
                                title={routeUrl ? "Abrir rota no Google Maps" : "Falta endereço para abrir a rota"}
                                className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                              >
                                Rota
                              </button>
                            ) : null}
                            <Link href={conversationHref} className="rounded-xl bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">
                              Abrir conversa
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        ) : null}

        {openSection === "followup" ? (
          <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
            <div className="border-b border-black/5 px-5 py-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-950">Follow-ups</h2>
                  <p className="mt-1 text-sm text-gray-500">Separe o que pode ser feito agora do que ainda precisa aguardar ou está bloqueado.</p>
                </div>
                <div className="text-sm font-semibold text-gray-500">{followupCountLabel} oportunidades</div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {([
                  ["all", "Todos", followupFilterCounts.all, "bg-gray-950 text-white ring-gray-950"],
                  ["ready", "Prontos agora", followupFilterCounts.ready, "bg-emerald-600 text-white ring-emerald-600"],
                  ["waiting", "Aguardando", followupFilterCounts.waiting, "bg-amber-500 text-white ring-amber-500"],
                  ["blocked", "Bloqueados", followupFilterCounts.blocked, "bg-gray-800 text-white ring-gray-800"],
                ] as const).map(([value, label, count, activeClass]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFollowupFilter(value)}
                    className={`rounded-full px-3 py-2 text-xs font-semibold ring-1 transition ${followupFilter === value ? activeClass : "bg-white text-gray-700 ring-black/10 hover:bg-gray-50"}`}
                  >
                    {label} <span className="ml-1 opacity-80">{count}</span>
                  </button>
                ))}
              </div>

              <div className="mt-4 max-w-md">
                <label className="sr-only" htmlFor="followup-search">
                  Buscar por nome ou telefone
                </label>
                <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-black/10">
                  <span className="text-sm text-gray-400" aria-hidden="true">⌕</span>
                  <input
                    id="followup-search"
                    value={followupSearchText}
                    onChange={(event) => setFollowupSearchText(event.target.value)}
                    placeholder="Buscar por nome ou telefone"
                    className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
                  />
                </div>
                {followupSearchActive ? (
                  <div className="mt-2 text-xs font-medium text-gray-500">{visibleFollowupRows.length} resultado(s) encontrados</div>
                ) : null}
              </div>
            </div>

            <div className="space-y-3 p-4">
              {!loading && visibleFollowupRows.length === 0 && followupSearchActive ? (
                <div className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 ring-1 ring-black/5">
                  Nenhum resultado encontrado para esta busca.
                </div>
              ) : !loading && visibleFollowupRows.length === 0 ? (
                <div className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 ring-1 ring-black/5">Nenhum follow-up nesta área.</div>
              ) : (
                visibleFollowupRows.map((row) => {
                  const blocked = !!row.blocked_reason;
                  const isTriggering = triggeringOpportunityId === row.commercial_opportunity_id;
                  const isChoosingFollowupType = followupTypeChooserOpportunityId === row.commercial_opportunity_id;
                  const bucket = getFollowupBucket(row);
                  const priority = priorityByOpportunity[row.commercial_opportunity_id];
                  const actionValue = getFollowupActionValue(row);
                  const followupConversationHref =
                    buildCrmLeadConversationHref({
                      leadId: row.lead_id,
                      conversationId: row.conversation_id,
                      opportunityId: row.commercial_opportunity_id,
                    }) || `/crm/lead/${row.lead_id}`;

                  return (
                    <div
                      key={`${row.commercial_opportunity_id}:${row.followup_type || row.suggested_action || "followup"}:${row.followup_id || "candidate"}`}
                      className={`overflow-hidden rounded-2xl border ${bucket === "ready" ? "border-emerald-200 bg-emerald-50/35" : bucket === "waiting" ? "border-amber-200 bg-amber-50/35" : "border-gray-300 bg-gray-50/80"}`}
                    >
                      <div className={`h-1 w-full ${bucket === "ready" ? "bg-emerald-500" : bucket === "waiting" ? "bg-amber-500" : "bg-gray-500"}`} />
                      <div className="p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-[15px] font-bold text-gray-950">{row.lead_name || `Lead ${shortId(row.lead_id)}`}</div>
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getFollowupActionClasses(actionValue)}`}>{formatSuggestedAction(actionValue)}</span>
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getFollowupBucketClasses(row)}`}>{getFollowupBucketLabel(row)}</span>
                              {priority?.priority_band ? (
                                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 ring-1 ring-black/10">
                                  Prioridade {priority.priority_band}
                                </span>
                              ) : null}
                            </div>

                            <div className="mt-1 text-xs text-gray-500">{row.lead_phone || "Sem telefone"} • {row.opportunity_stage || "etapa não informada"}</div>

                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                              <div className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-black/5">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Última mensagem do cliente</div>
                                <div className="mt-1 text-xs font-semibold text-gray-700">{formatDateTime(row.last_customer_message_at)}</div>
                              </div>
                              <div className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-black/5">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Tempo sem novo contato</div>
                                <div className="mt-1 text-xs font-semibold text-gray-700">{formatStoppedTime(row.hours_since_customer)}</div>
                              </div>
                              <div className="min-w-0 rounded-xl bg-white/80 px-3 py-2 ring-1 ring-black/5">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Situação</div>
                                <div className="mt-1 break-words text-xs font-semibold leading-4 text-gray-700">
                                  {blocked ? formatBlockedReason(row.blocked_reason) : "Liberado para contato"}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            <Link href={followupConversationHref} className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50">
                              Abrir conversa
                            </Link>
                            <button
                              onClick={() => void triggerManualFollowup(row)}
                              disabled={blocked || isTriggering}
                              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                            >
                              {isTriggering ? "Enfileirando..." : "Iniciar follow-up"}
                            </button>
                            {isChoosingFollowupType && !blocked ? (
                              <div className="basis-full rounded-xl bg-white p-3 text-sm ring-1 ring-black/10">
                                <div className="font-semibold text-gray-900">Qual tipo de follow-up deseja iniciar?</div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void triggerManualFollowup(row, "offer")}
                                    className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                                  >
                                    Proposta
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void triggerManualFollowup(row, "visit")}
                                    className="rounded-xl bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-700"
                                  >
                                    Visita
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
