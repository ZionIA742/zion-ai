"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { useStoreContext } from "../StoreProvider";

function getTitulo(pathname: string) {
  if (pathname.startsWith("/dashboard")) return "Dashboard";
  if (pathname.startsWith("/crm")) return "CRM";
  if (pathname.startsWith("/configuracoes")) return "Configurações";
  if (pathname.startsWith("/inbox")) return "Inbox";
  if (pathname.startsWith("/assistant")) return "Assistente";
  if (pathname.startsWith("/schedule")) return "Agenda";
  if (pathname.startsWith("/onboarding")) return "Onboarding";
  if (pathname.startsWith("/help")) return "Ajuda";
  return "ZION";
}

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const titulo = getTitulo(pathname);
  const storeMenuRef = useRef<HTMLDivElement | null>(null);
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const {
    loading: storesLoading,
    error: storesError,
    stores,
    activeStoreId,
    activeStore,
    setActiveStoreId,
  } = useStoreContext();

  const storeName = activeStore?.name ?? stores[0]?.name ?? "Loja";

  useEffect(() => {
    if (!isStoreMenuOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        storeMenuRef.current &&
        !storeMenuRef.current.contains(event.target as Node)
      ) {
        setIsStoreMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isStoreMenuOpen]);

  async function handleSignOut() {
    if (isSigningOut) return;

    setIsSigningOut(true);

    try {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("zion_active_store_id");
      }

      await supabase.auth.signOut();
    } catch (err) {
      console.error("[AppHeader] signOut error:", err);
    } finally {
      if (typeof window !== "undefined") {
        const loginUrl = `${window.location.origin}/login`;

        window.location.replace(loginUrl);

        window.setTimeout(() => {
          window.location.assign(loginUrl);
        }, 50);
      } else {
        router.replace("/login");
        router.refresh();
      }
    }
  }

  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b border-gray-200 bg-white px-6">
      <h2 className="text-lg font-semibold">{titulo}</h2>

      <div className="flex items-center gap-3">
        {storesLoading ? (
          <span className="text-sm text-gray-500">Carregando loja...</span>
        ) : storesError ? (
          <span className="text-sm text-red-600">{storesError}</span>
        ) : stores.length === 0 ? (
          <span className="text-sm text-red-600">Nenhuma loja encontrada</span>
        ) : (
          <div ref={storeMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setIsStoreMenuOpen((current) => !current)}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50"
              aria-haspopup="menu"
              aria-expanded={isStoreMenuOpen}
            >
              <span className="text-gray-500">Loja:</span>
              <span className="max-w-[220px] truncate font-medium text-gray-900">
                {storeName}
              </span>
              <span className="text-xs text-gray-400">▾</span>
            </button>

            {isStoreMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
              >
                <div className="border-b border-gray-100 px-4 py-3">
                  <p className="text-xs text-gray-500">Loja ativa</p>
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {storeName}
                  </p>
                </div>

                {stores.length > 1 ? (
                  <div className="border-b border-gray-100 px-4 py-3">
                    <label
                      htmlFor="active-store"
                      className="mb-1 block text-xs text-gray-500"
                    >
                      Trocar loja
                    </label>
                    <select
                      id="active-store"
                      value={activeStoreId ?? ""}
                      onChange={(e) => setActiveStoreId(e.target.value)}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  role="menuitem"
                >
                  <span>{isSigningOut ? "Saindo..." : "Sair"}</span>
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </header>
  );
}
