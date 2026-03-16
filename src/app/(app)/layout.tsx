"use client";

import OrgGuard from "@/components/OrgGuard";
import { StoreProvider } from "../../components/StoreProvider";
import AppHeader from "@/components/layout/AppHeader";
import Sidebar from "@/components/layout/Sidebar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <OrgGuard>
      <StoreProvider>
        <div className="flex h-screen bg-gray-100">
          <Sidebar />

          <div className="flex-1 flex flex-col">
            <AppHeader />

            <main className="flex-1 p-6 overflow-auto">{children}</main>
          </div>
        </div>
      </StoreProvider>
    </OrgGuard>
  );
}