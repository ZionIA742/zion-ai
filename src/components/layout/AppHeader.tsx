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

function StoreIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-[18px] w-[18px]"
    >
      <path d="M4 10v10h16V10" />
      <path d="M3 10 5 4h14l2 6" />
      <path d="M8 20v-6h8v6" />
      <path d="M3 10c0 1.2 1 2 2.2 2S7.4 11.2 7.4 10c0 1.2 1 2 2.2 2s2.2-.8 2.2-2c0 1.2 1 2 2.2 2s2.2-.8 2.2-2c0 1.2 1 2 2.2 2S21 11.2 21 10" />
    </svg>
  );
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
    <header className="relative z-20 flex h-[76px] shrink-0 items-center justify-between gap-5 border-b border-gray-200/80 bg-white px-6 shadow-[0_1px_8px_rgba(15,23,42,0.025)]">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
          Painel operacional
        </div>

        <h2 className="mt-0.5 truncate text-xl font-bold tracking-[-0.02em] text-gray-950">
          {titulo}
        </h2>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {storesLoading ? (
          <span className="text-sm text-gray-500">
            Carregando loja...
          </span>
        ) : storesError ? (
          <span className="text-sm text-red-600">
            {storesError}
          </span>
        ) : stores.length === 0 ? (
          <span className="text-sm text-red-600">
            Nenhuma loja encontrada
          </span>
        ) : (
          <div ref={storeMenuRef} className="relative">
            <button
              type="button"
              onClick={() =>
                setIsStoreMenuOpen((current) => !current)
              }
              className="group inline-flex min-w-[178px] items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left shadow-sm transition hover:border-gray-300 hover:bg-white"
              aria-haspopup="menu"
              aria-expanded={isStoreMenuOpen}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-gray-500 shadow-sm ring-1 ring-black/5 transition group-hover:text-gray-900">
                <StoreIcon />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-[9px] font-bold uppercase tracking-[0.16em] text-gray-400">
                  Loja atual
                </span>

                <span className="mt-0.5 block max-w-[190px] truncate text-sm font-semibold text-gray-950">
                  {storeName}
                </span>
              </span>

              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={[
                  "h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200",
                  isStoreMenuOpen ? "rotate-180" : "",
                ].join(" ")}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {isStoreMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl shadow-black/10"
              >
                <div className="border-b border-gray-100 px-4 py-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-500 ring-1 ring-black/5">
                      <StoreIcon />
                    </span>

                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">
                        Loja ativa
                      </p>

                      <p className="mt-0.5 truncate text-sm font-semibold text-gray-950">
                        {storeName}
                      </p>
                    </div>
                  </div>
                </div>

                {stores.length > 1 ? (
                  <div className="border-b border-gray-100 px-4 py-4">
                    <label
                      htmlFor="active-store"
                      className="mb-2 block text-xs font-medium text-gray-500"
                    >
                      Trocar loja
                    </label>

                    <select
                      id="active-store"
                      value={activeStoreId ?? ""}
                      onChange={(e) =>
                        setActiveStoreId(e.target.value)
                      }
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-900 outline-none transition focus:border-gray-400 focus:bg-white"
                    >
                      {stores.map((store) => (
                        <option
                          key={store.id}
                          value={store.id}
                        >
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
                  className="flex w-full items-center justify-between px-4 py-3.5 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  role="menuitem"
                >
                  <span>
                    {isSigningOut ? "Saindo..." : "Sair"}
                  </span>

                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="h-4 w-4"
                  >
                    <path d="M14 5h5v14h-5" />
                    <path d="M10 17l5-5-5-5" />
                    <path d="M15 12H3" />
                  </svg>
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </header>
  );
}
