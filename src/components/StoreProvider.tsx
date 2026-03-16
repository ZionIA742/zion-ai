"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabaseBrowser";

type StoreRow = {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
};

type StoreContextValue = {
  loading: boolean;
  error: string | null;
  organizationId: string | null;
  stores: StoreRow[];
  activeStoreId: string | null;
  activeStore: StoreRow | null;
  setActiveStoreId: (storeId: string) => void;
  refreshStores: () => Promise<void>;
};

const StoreContext = createContext<StoreContextValue | undefined>(undefined);

const ACTIVE_STORE_STORAGE_KEY = "zion_active_store_id";

function isValidStoreId(storeId: string | null, stores: StoreRow[]) {
  if (!storeId) return false;
  return stores.some((store) => store.id === storeId);
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const mountedRef = useRef(true);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [activeStoreId, setActiveStoreIdState] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: sessionRes, error: sessionErr } =
        await supabase.auth.getSession();

      if (sessionErr) {
        console.error("[StoreProvider] auth.getSession error:", sessionErr);
        throw new Error("Falha ao obter sessão.");
      }

      const user = sessionRes.session?.user;

      if (!user) {
        throw new Error("Usuário não autenticado.");
      }

      const { data: memberships, error: membershipErr } = await supabase
        .from("memberships")
        .select("organization_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (membershipErr) {
        console.error("[StoreProvider] memberships error:", membershipErr);
        throw new Error("Falha ao obter organização do usuário.");
      }

      const orgId = memberships?.[0]?.organization_id ?? null;

      if (!orgId) {
        throw new Error("Usuário sem organização vinculada.");
      }

      const { data: storeRows, error: storesErr } = await supabase
        .from("stores")
        .select("id, organization_id, name, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true });

      if (storesErr) {
        console.error("[StoreProvider] stores error:", storesErr);
        throw new Error("Falha ao carregar lojas.");
      }

      const normalizedStores = (storeRows ?? []) as StoreRow[];

      if (!mountedRef.current) return;

      setOrganizationId(orgId);
      setStores(normalizedStores);

      const savedStoreId =
        typeof window !== "undefined"
          ? window.localStorage.getItem(ACTIVE_STORE_STORAGE_KEY)
          : null;

      let nextActiveStoreId: string | null = null;

      if (isValidStoreId(savedStoreId, normalizedStores)) {
        nextActiveStoreId = savedStoreId;
      } else if (normalizedStores.length === 1) {
        nextActiveStoreId = normalizedStores[0].id;
      } else if (normalizedStores.length > 1) {
        nextActiveStoreId = normalizedStores[0].id;
      }

      setActiveStoreIdState(nextActiveStoreId);

      if (typeof window !== "undefined") {
        if (nextActiveStoreId) {
          window.localStorage.setItem(
            ACTIVE_STORE_STORAGE_KEY,
            nextActiveStoreId
          );
        } else {
          window.localStorage.removeItem(ACTIVE_STORE_STORAGE_KEY);
        }
      }
    } catch (err: any) {
      if (!mountedRef.current) return;

      console.error("[StoreProvider] unexpected error:", err);
      setError(err?.message ?? "Erro ao carregar lojas.");
      setOrganizationId(null);
      setStores([]);
      setActiveStoreIdState(null);
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setActiveStoreId = (storeId: string) => {
    if (!isValidStoreId(storeId, stores)) {
      console.warn("[StoreProvider] tentativa de selecionar store inválida:", {
        storeId,
      });
      return;
    }

    setActiveStoreIdState(storeId);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_STORE_STORAGE_KEY, storeId);
    }
  };

  const activeStore = useMemo(() => {
    if (!activeStoreId) return null;
    return stores.find((store) => store.id === activeStoreId) ?? null;
  }, [stores, activeStoreId]);

  const value = useMemo<StoreContextValue>(
    () => ({
      loading,
      error,
      organizationId,
      stores,
      activeStoreId,
      activeStore,
      setActiveStoreId,
      refreshStores: load,
    }),
    [loading, error, organizationId, stores, activeStoreId, activeStore]
  );

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

export function useStoreContext() {
  const ctx = useContext(StoreContext);

  if (!ctx) {
    throw new Error("useStoreContext deve ser usado dentro de StoreProvider.");
  }

  return ctx;
}