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

  const [mobileMenu, setMobileMenu] = useState({
    pathname,
    open: false,
  });

  const isMobileMenuOpen =
    mobileMenu.pathname === pathname && mobileMenu.open;

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileMenu({ pathname, open: false });
      }
    }

    const media = window.matchMedia("(max-width: 767px)");
    function handleViewportChange(event: MediaQueryListEvent) {
      if (!event.matches) {
        setMobileMenu({ pathname, open: false });
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    media.addEventListener("change", handleViewportChange);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      media.removeEventListener("change", handleViewportChange);
    };
  }, [isMobileMenuOpen, pathname]);

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
      <div className="flex h-dvh min-w-0 bg-zion-canvas text-zion-ink">
        <Sidebar
          collapsed={isSidebarCollapsed}
          onToggle={handleSidebarToggle}
          mobileOpen={isMobileMenuOpen}
          onMobileClose={() => setMobileMenu({ pathname, open: false })}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            mobileMenuOpen={isMobileMenuOpen}
            onOpenMobileMenu={() => setMobileMenu({ pathname, open: true })}
          />

          <main
            className={
              isFixedFullBleedPage
                ? "flex-1 min-h-0 overflow-hidden"
                : isEdgeToEdgeScrollablePage
                  ? "flex-1 min-h-0 overflow-auto"
                  : "min-w-0 flex-1 overflow-auto p-3 sm:p-4 md:p-6"
            }
          >
            {children}
          </main>
        </div>
      </div>
    </StoreProvider>
  );
}
