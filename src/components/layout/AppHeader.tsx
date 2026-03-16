"use client";

import { usePathname } from "next/navigation";
import { useStoreContext } from "../StoreProvider";

function getTitulo(pathname: string) {
  if (pathname.startsWith("/dashboard")) return "Dashboard";
  if (pathname.startsWith("/crm")) return "CRM";
  if (pathname.startsWith("/configuracoes")) return "Configurações";
  if (pathname.startsWith("/inbox")) return "Inbox";
  return "ZION";
}

export default function AppHeader() {
  const pathname = usePathname();
  const titulo = getTitulo(pathname);

  const {
    loading: storesLoading,
    error: storesError,
    stores,
    activeStoreId,
    activeStore,
    setActiveStoreId,
  } = useStoreContext();

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 gap-4">
      <h2 className="text-lg font-semibold">{titulo}</h2>

      <div className="flex items-center gap-3">
        {storesLoading ? (
          <span className="text-sm text-gray-500">Carregando loja...</span>
        ) : storesError ? (
          <span className="text-sm text-red-600">{storesError}</span>
        ) : stores.length === 0 ? (
          <span className="text-sm text-red-600">
            Nenhuma loja encontrada
          </span>
        ) : stores.length === 1 ? (
          <div className="text-sm text-gray-700">
            <span className="text-gray-500 mr-1">Loja:</span>
            <span className="font-medium">{activeStore?.name ?? stores[0].name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <label htmlFor="active-store" className="text-sm text-gray-500">
              Loja:
            </label>
            <select
              id="active-store"
              value={activeStoreId ?? ""}
              onChange={(e) => setActiveStoreId(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
            >
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </header>
  );
}