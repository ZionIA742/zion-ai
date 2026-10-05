"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { StoreProvider } from "../../components/StoreProvider";
import AppHeader from "@/components/layout/AppHeader";
import Sidebar from "@/components/layout/Sidebar";

export default function AppShellClient({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isFixedFullBleedPage = pathname === "/assistant" || pathname === "/schedule";
  const isEdgeToEdgeScrollablePage = pathname === "/crm" || pathname === "/dashboard" || pathname === "/configuracoes";

  const [isSidebarCollapsed, setIsSidebarCollapsed] =
    useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedValue =
      window.localStorage.getItem(
        "zion_sidebar_collapsed"
      );

    if (storedValue !== "true") {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsSidebarCollapsed(true);
    }, 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, []);

  function handleSidebarToggle() {
    setIsSidebarCollapsed((current) => {
      const next = !current;

      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "zion_sidebar_collapsed",
          String(next)
        );
      }

      return next;
    });
  }

  return (
    <StoreProvider>
      <div className="flex h-screen bg-gray-50">
        <Sidebar
          collapsed={isSidebarCollapsed}
          onToggle={handleSidebarToggle}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader />

          <main
            className={
              isFixedFullBleedPage
                ? "flex-1 min-h-0 overflow-hidden"
                : isEdgeToEdgeScrollablePage
                  ? "flex-1 min-h-0 overflow-auto"
                  : "flex-1 p-6 overflow-auto"
            }
          >
            {children}
          </main>
        </div>
      </div>
    </StoreProvider>
  );
}
