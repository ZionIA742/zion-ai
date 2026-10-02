"use client";

import type { ReactNode } from "react";
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
  const isAssistantPage = pathname === "/assistant";

  return (
    <StoreProvider>
      <div className="flex h-screen bg-gray-100">
        <Sidebar />

        <div className="flex-1 flex flex-col">
          <AppHeader />

          <main
            className={
              isAssistantPage
                ? "flex-1 min-h-0 overflow-hidden"
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
