"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

type CommercialHandoffTaskRow = {
  related_conversation_id: string | null;
  task_type: string | null;
  status: string | null;
};

type AssistantThreadSummary = {
  pending_notifications?: number | null;
};

const items = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "CRM", href: "/crm" },
  { label: "Inbox", href: "/inbox" },
  { label: "Assistente", href: "/assistant" },
  { label: "Agenda", href: "/schedule" },
  { label: "Configurações", href: "/configuracoes" },
  { label: "Onboarding", href: "/onboarding" },
];

const OPEN_COMMERCIAL_HANDOFF_STATUSES = [
  "open",
  "waiting_user_choice",
  "waiting_customer_response",
  "ready_to_execute",
  "in_progress",
];

function isPendingReply(row: InboxRow) {
  return String(row.last_message_direction || "").toLowerCase() === "incoming";
}

export default function Sidebar() {
  const pathname = usePathname();
  const { loading: storeLoading, organizationId, activeStoreId } = useStoreContext();

  const [pendingReplyCount, setPendingReplyCount] = useState(0);
  const [commercialPendingConversationCount, setCommercialPendingConversationCount] = useState(0);
  const [assistantPendingCount, setAssistantPendingCount] = useState(0);

  const canLoadInboxCounter = useMemo(() => {
    return !storeLoading && !!organizationId;
  }, [storeLoading, organizationId]);

  const canLoadAssistantCounter = useMemo(() => {
    return !storeLoading && !!organizationId && !!activeStoreId;
  }, [storeLoading, organizationId, activeStoreId]);

  const loadInboxCounter = useCallback(async () => {
    if (!canLoadInboxCounter || !organizationId) return;

    const { data, error } = await supabase.rpc("panel_list_inbox", {
      p_organization_id: organizationId,
      p_store_id: activeStoreId ?? null,
      p_limit: 100,
      p_offset: 0,
    });

    if (error) {
      console.error("[Sidebar] panel_list_inbox error:", error);
      return;
    }

    const rows = (data || []) as InboxRow[];
    const count = rows.filter(isPendingReply).length;
    setPendingReplyCount(count);

    const conversationIds = [...new Set(rows.map((row) => row.conversation_id).filter(Boolean))];

    if (conversationIds.length === 0) {
      setCommercialPendingConversationCount(0);
      return;
    }

    let query = supabase
      .from("store_assistant_operational_tasks")
      .select("related_conversation_id, task_type, status")
      .eq("organization_id", organizationId)
      .in("related_conversation_id", conversationIds)
      .in("task_type", ["commercial_visit_request", "commercial_quote_request"])
      .in("status", OPEN_COMMERCIAL_HANDOFF_STATUSES);

    if (activeStoreId) {
      query = query.eq("store_id", activeStoreId);
    } else {
      const storeIds = [...new Set(rows.map((row) => row.store_id).filter(Boolean))];
      if (storeIds.length > 0) {
        query = query.in("store_id", storeIds);
      }
    }

    const { data: tasks, error: tasksError } = await query;

    if (tasksError) {
      console.warn("[Sidebar] erro ao carregar handoffs comerciais do Inbox:", tasksError);
      setCommercialPendingConversationCount(0);
      return;
    }

    const conversationCount = new Set(
      ((tasks || []) as CommercialHandoffTaskRow[])
        .map((task) => String(task.related_conversation_id || "").trim())
        .filter(Boolean)
    ).size;

    setCommercialPendingConversationCount(conversationCount);
  }, [canLoadInboxCounter, organizationId, activeStoreId]);

  const loadAssistantCounter = useCallback(async () => {
    if (!canLoadAssistantCounter || !organizationId || !activeStoreId) return;

    const { data, error } = await supabase.rpc("assistant_get_thread_summary", {
      p_organization_id: organizationId,
      p_store_id: activeStoreId,
    });

    if (error) {
      console.warn("[Sidebar] assistant_get_thread_summary error:", error);
      setAssistantPendingCount(0);
      return;
    }

    const summary = (Array.isArray(data) ? data[0] : data) as AssistantThreadSummary | null;
    const count = Number(summary?.pending_notifications || 0);
    setAssistantPendingCount(Number.isFinite(count) && count > 0 ? count : 0);
  }, [canLoadAssistantCounter, organizationId, activeStoreId]);

  useEffect(() => {
    if (!canLoadInboxCounter && !canLoadAssistantCounter) return;

    const timeout = window.setTimeout(() => {
      if (canLoadInboxCounter) void loadInboxCounter();
      if (canLoadAssistantCounter) void loadAssistantCounter();
    }, 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [canLoadInboxCounter, canLoadAssistantCounter, loadInboxCounter, loadAssistantCounter]);

  useEffect(() => {
    if (!canLoadInboxCounter && !canLoadAssistantCounter) return;

    const interval = window.setInterval(() => {
      if (canLoadInboxCounter) void loadInboxCounter();
      if (canLoadAssistantCounter) void loadAssistantCounter();
    }, 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, [canLoadInboxCounter, canLoadAssistantCounter, loadInboxCounter, loadAssistantCounter]);

  useEffect(() => {
    if (!canLoadInboxCounter && !canLoadAssistantCounter) return;

    let lastRefreshAt = 0;

    const triggerRefresh = () => {
      const now = Date.now();
      if (now - lastRefreshAt < 1000) return;
      lastRefreshAt = now;

      if (canLoadInboxCounter) void loadInboxCounter();
      if (canLoadAssistantCounter) void loadAssistantCounter();
    };

    const handleFocus = () => {
      triggerRefresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerRefresh();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [canLoadInboxCounter, canLoadAssistantCounter, loadInboxCounter, loadAssistantCounter]);

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-6 py-5">
        <h1 className="text-xl font-bold text-gray-900">ZION</h1>
        <p className="text-sm text-gray-500">Painel operacional</p>
      </div>

      <nav className="flex-1 space-y-2 p-4">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const isInboxItem = item.href === "/inbox";
          const isAssistantItem = item.href === "/assistant";
          const inboxBadgeCount =
            commercialPendingConversationCount > 0
              ? commercialPendingConversationCount
              : pendingReplyCount;
          const showInboxBadge = isInboxItem && inboxBadgeCount > 0;
          const showAssistantBadge = isAssistantItem && assistantPendingCount > 0;
          const badgeCount = showInboxBadge ? inboxBadgeCount : showAssistantBadge ? assistantPendingCount : 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "flex items-center justify-between rounded-lg px-4 py-3 text-sm font-medium transition",
                isActive
                  ? "bg-transparent text-black underline underline-offset-4 decoration-2"
                  : "bg-transparent text-black hover:underline hover:underline-offset-4 hover:decoration-2",
              ].join(" ")}
            >
              <span>{item.label}</span>

              {badgeCount > 0 ? (
                <span className="inline-flex min-w-[24px] shrink-0 items-center justify-center rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                  {badgeCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
