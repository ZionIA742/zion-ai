"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useStoreContext } from "@/components/StoreProvider";
import { countActiveAssistantPendingActions } from "@/lib/assistant/active-pending-actions";

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

type AssistantCounterMessage = {
  id: string;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

type NavIconName =
  | "dashboard"
  | "crm"
  | "inbox"
  | "assistant"
  | "schedule"
  | "settings"
  | "help"
  | "onboarding";

const items: Array<{
  label: string;
  href: string;
  icon: NavIconName;
}> = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "CRM", href: "/crm", icon: "crm" },
  { label: "Inbox", href: "/inbox", icon: "inbox" },
  { label: "Assistente", href: "/assistant", icon: "assistant" },
  { label: "Agenda", href: "/schedule", icon: "schedule" },
  { label: "Configurações", href: "/configuracoes", icon: "settings" },
  { label: "Ajuda", href: "/help", icon: "help" },
  { label: "Onboarding", href: "/onboarding", icon: "onboarding" },
];

function NavIcon({ name }: { name: NavIconName }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "dashboard") {
    return (
      <svg {...commonProps}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    );
  }

  if (name === "crm") {
    return (
      <svg {...commonProps}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19c.7-3.2 2.7-5 5.5-5s4.8 1.8 5.5 5" />
        <path d="M16 8h5M18.5 5.5v5" />
      </svg>
    );
  }

  if (name === "inbox") {
    return (
      <svg {...commonProps}>
        <path d="M4 5h16l1.5 9H16l-2 3h-4l-2-3H2.5L4 5Z" />
        <path d="M3 14v5h18v-5" />
      </svg>
    );
  }

  if (name === "assistant") {
    return (
      <svg {...commonProps}>
        <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" />
        <path d="m18.5 13 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" />
        <path d="m5.5 14 .6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6.6-1.9Z" />
      </svg>
    );
  }

  if (name === "schedule") {
    return (
      <svg {...commonProps}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4M17 3v4M3 10h18" />
        <path d="M8 14h3M8 17h6" />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </svg>
    );
  }

  if (name === "help") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.7 9a2.5 2.5 0 1 1 4.4 1.6c-.9 1-2.1 1.3-2.1 2.9" />
        <path d="M12 17h.01" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M12 3 4.5 7.2v9.6L12 21l7.5-4.2V7.2L12 3Z" />
      <path d="M8.5 10.5 12 8.6l3.5 1.9v4L12 16.4l-3.5-1.9v-4Z" />
    </svg>
  );
}

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

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

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
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

    const [{ error: summaryError }, { data: messagesData, error: messagesError }] =
      await Promise.all([
        supabase.rpc("assistant_get_thread_summary", {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
        }),
        supabase.rpc("assistant_list_messages", {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
          p_limit: 200,
        }),
      ]);

    if (summaryError) {
      console.warn("[Sidebar] assistant_get_thread_summary error:", summaryError);
      setAssistantPendingCount(0);
      return;
    }

    if (messagesError) {
      console.warn("[Sidebar] assistant_list_messages error:", messagesError);
      setAssistantPendingCount(0);
      return;
    }

    const messages = Array.isArray(messagesData) ? (messagesData as AssistantCounterMessage[]) : [];
    const activePendingCount = countActiveAssistantPendingActions(messages);
    setAssistantPendingCount(activePendingCount > 0 ? activePendingCount : 0);
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
    <div
      className={[
        "relative h-screen shrink-0 transition-[width] duration-300 ease-out",
        collapsed ? "w-0" : "w-64",
      ].join(" ")}
    >
      <aside
        className={[
          "absolute inset-y-0 left-0 z-30 flex h-screen w-64 flex-col border-r border-gray-200/80 bg-white shadow-[4px_0_18px_rgba(15,23,42,0.035)] transition-transform duration-300 ease-out",
          collapsed ? "-translate-x-full" : "translate-x-0",
        ].join(" ")}
      >
        <div className="border-b border-gray-100 px-5 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-black shadow-sm ring-1 ring-black/10">
              <img
                src="/zion-mark.png"
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover"
              />
            </div>

            <div className="min-w-0">
              <h1 className="text-[19px] font-black tracking-[0.04em] text-gray-950">
                ZION
              </h1>
              <p className="mt-0.5 text-xs font-medium text-gray-400">
                Painel operacional
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          <div className="space-y-1.5">
            {items.map((item, index) => {
              const isActive =
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`);

              const isInboxItem = item.href === "/inbox";
              const isAssistantItem = item.href === "/assistant";

              const inboxBadgeCount =
                commercialPendingConversationCount > 0
                  ? commercialPendingConversationCount
                  : pendingReplyCount;

              const showInboxBadge =
                isInboxItem && inboxBadgeCount > 0;

              const showAssistantBadge =
                isAssistantItem && assistantPendingCount > 0;

              const badgeCount = showInboxBadge
                ? inboxBadgeCount
                : showAssistantBadge
                  ? assistantPendingCount
                  : 0;

              return (
                <div key={item.href}>
                  {index === 5 ? (
                    <div className="mx-3 my-4 border-t border-gray-100" />
                  ) : null}

                  <Link
                    href={item.href}
                    className={[
                      "group relative flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition-all duration-150",
                      isActive
                        ? "bg-gray-100 text-gray-950 shadow-sm ring-1 ring-black/5"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-950",
                    ].join(" ")}
                  >
                    {isActive ? (
                      <span className="absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-r-full bg-gray-950" />
                    ) : null}

                    <span
                      className={[
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition",
                        isActive
                          ? "bg-white text-gray-950 shadow-sm ring-1 ring-black/5"
                          : "text-gray-400 group-hover:bg-white group-hover:text-gray-700 group-hover:ring-1 group-hover:ring-black/5",
                      ].join(" ")}
                    >
                      <span className="h-[18px] w-[18px]">
                        <NavIcon name={item.icon} />
                      </span>
                    </span>

                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>

                    {badgeCount > 0 ? (
                      <span className="inline-flex min-w-[22px] shrink-0 items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
                        {badgeCount}
                      </span>
                    ) : null}
                  </Link>
                </div>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-300">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
            ZION
          </div>
        </div>
      </aside>

      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? "Abrir menu lateral" : "Recolher menu lateral"}
        title={collapsed ? "Abrir menu lateral" : "Recolher menu lateral"}
        className={[
          "absolute left-full top-1/2 z-40 flex h-14 w-6 -translate-y-1/2 items-center justify-center border border-l-0 border-gray-200 bg-white text-gray-400 shadow-[3px_0_10px_rgba(15,23,42,0.10)] transition-all duration-300 hover:bg-gray-50 hover:text-gray-950",
          collapsed
            ? "rounded-r-xl"
            : "rounded-r-xl",
        ].join(" ")}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-5 w-5"
        >
          <path
            d={
              collapsed
                ? "m9 18 6-6-6-6"
                : "m15 18-6-6 6-6"
            }
          />
        </svg>
      </button>
    </div>
  );
}
