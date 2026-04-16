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

const items = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "CRM", href: "/crm" },
  { label: "Inbox", href: "/inbox" },
  { label: "Assistente", href: "/assistant" },
  { label: "Agenda", href: "/schedule" },
  { label: "Configurações", href: "/configuracoes" },
  { label: "Onboarding", href: "/onboarding" },
];

function isPendingReply(row: InboxRow) {
  return String(row.last_message_direction || "").toLowerCase() === "incoming";
}

export default function Sidebar() {
  const pathname = usePathname();
  const { loading: storeLoading, organizationId, activeStoreId } = useStoreContext();

  const [pendingReplyCount, setPendingReplyCount] = useState(0);

  const canLoadInboxCounter = useMemo(() => {
    return !storeLoading && !!organizationId;
  }, [storeLoading, organizationId]);

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
  }, [canLoadInboxCounter, organizationId, activeStoreId]);

  useEffect(() => {
    if (!canLoadInboxCounter) return;
    void loadInboxCounter();
  }, [canLoadInboxCounter, loadInboxCounter]);

  useEffect(() => {
    if (!canLoadInboxCounter) return;

    const interval = window.setInterval(() => {
      void loadInboxCounter();
    }, 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, [canLoadInboxCounter, loadInboxCounter]);

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
          const showInboxBadge = isInboxItem && pendingReplyCount > 0;

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

              {showInboxBadge ? (
                <span className="inline-flex min-w-[24px] items-center justify-center rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                  {pendingReplyCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
