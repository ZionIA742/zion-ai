"use client"

import { usePathname } from "next/navigation"

function getTitulo(pathname: string) {
  if (pathname.startsWith("/dashboard")) return "Dashboard"
  if (pathname.startsWith("/crm")) return "CRM"
  if (pathname.startsWith("/configuracoes")) return "Configurações"
  return "ZION"
}

export default function AppHeader() {
  const pathname = usePathname()
  const titulo = getTitulo(pathname)

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center px-6">
      <h2 className="text-lg font-semibold">{titulo}</h2>
    </header>
  )
}