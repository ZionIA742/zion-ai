"use client"

import OrgGuard from "@/components/OrgGuard"
import AppHeader from "@/components/layout/AppHeader"
import Sidebar from "@/components/layout/Sidebar"

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <OrgGuard>
      <div className="flex h-screen bg-gray-100">
        {/* SIDEBAR */}
        <Sidebar />

        {/* CONTEÚDO */}
        <div className="flex-1 flex flex-col">
          {/* HEADER */}
          <AppHeader />

          {/* ÁREA PRINCIPAL */}
          <main className="flex-1 p-6 overflow-auto">{children}</main>
        </div>
      </div>
    </OrgGuard>
  )
}