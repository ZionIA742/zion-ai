"use client";

import React, {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { resolveAccessSelection } from "@/lib/account-access";
import { supabase } from "@/lib/supabaseBrowser";

type StoreRow = {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
};

type MembershipRow = {
  organization_id: string;
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

function getStoreStorageKey(userId: string) {
  return `${ACTIVE_STORE_STORAGE_KEY}:${userId}`;
}

function clearStoredStoreSelection(userId?: string | null) {
  if (typeof window === "undefined") return;

  const keysToRemove = new Set<string>([ACTIVE_STORE_STORAGE_KEY]);

  if (userId) {
    keysToRemove.add(getStoreStorageKey(userId));
  }

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);

    if (key && key.startsWith(`${ACTIVE_STORE_STORAGE_KEY}:`)) {
      keysToRemove.add(key);
    }
  }

  for (const key of keysToRemove) {
    window.localStorage.removeItem(key);
  }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const mountedRef = useRef(true);
  const currentUserIdRef = useRef<string | null>(null);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: sessionRes, error: sessionErr } =
        await supabase.auth.getSession();

      if (sessionErr) {
        console.error("[StoreProvider] auth.getSession error:", sessionErr);
        throw new Error("Falha ao obter sessao.");
      }

      const user = sessionRes.session?.user;

      if (!user) {
        currentUserIdRef.current = null;
        clearStoredStoreSelection();
        throw new Error("Usuario nao autenticado.");
      }

      if (currentUserIdRef.current && currentUserIdRef.current !== user.id) {
        clearStoredStoreSelection(currentUserIdRef.current);
      }

      currentUserIdRef.current = user.id;

      const { data: memberships, error: membershipErr } = await supabase
        .from("memberships")
        .select("organization_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (membershipErr) {
        console.error("[StoreProvider] memberships error:", membershipErr);
        throw new Error("Falha ao obter organizacao do usuario.");
      }

      const membershipRows = (memberships ?? []) as MembershipRow[];
      const organizationIds = Array.from(
        new Set(
          membershipRows
            .map((membership) => membership.organization_id)
            .filter(Boolean)
        )
      );

      let normalizedStores: StoreRow[] = [];
      let orgId: string | null = null;

      if (organizationIds.length > 0) {
        const { data: allStoreRows, error: storesErr } = await supabase
          .from("stores")
          .select("id, organization_id, name, created_at")
          .in("organization_id", organizationIds)
          .order("created_at", { ascending: true });

        if (storesErr) {
          console.error("[StoreProvider] stores error:", storesErr);
          throw new Error("Falha ao carregar lojas.");
        }

        const storesByOrganization = new Map<string, StoreRow[]>();

        for (const store of (allStoreRows ?? []) as StoreRow[]) {
          const bucket = storesByOrganization.get(store.organization_id) ?? [];
          bucket.push(store);
          storesByOrganization.set(store.organization_id, bucket);
        }

        const selection = resolveAccessSelection(
          membershipRows,
          (allStoreRows ?? []) as StoreRow[],
        );

        if (!selection.ok) {
          throw new Error(selection.message);
        }

        orgId = selection.organizationId;
        normalizedStores = storesByOrganization.get(orgId) ?? [];
      } else {
        const selection = resolveAccessSelection(membershipRows, []);

        if (!selection.ok) {
          throw new Error(selection.message);
        }

        orgId = selection.organizationId;
        normalizedStores = selection.stores as StoreRow[];
      }

      if (!orgId) {
        throw new Error("Usuario sem organizacao vinculada.");
      }

      if (!mountedRef.current) return;

      setOrganizationId(orgId);
      setStores(normalizedStores);

      const savedStoreId =
        typeof window !== "undefined"
          ? window.localStorage.getItem(getStoreStorageKey(user.id)) ||
            window.localStorage.getItem(ACTIVE_STORE_STORAGE_KEY)
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
          window.localStorage.setItem(getStoreStorageKey(user.id), nextActiveStoreId);
          window.localStorage.removeItem(ACTIVE_STORE_STORAGE_KEY);
        } else {
          clearStoredStoreSelection(user.id);
        }
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;

      const message =
        err &&
        typeof err === "object" &&
        "message" in err &&
        typeof (err as { message?: unknown }).message === "string"
          ? (err as { message: string }).message
          : "Erro ao carregar lojas.";

      console.error("[StoreProvider] unexpected error:", err);
      setError(message);
      currentUserIdRef.current = null;
      setOrganizationId(null);
      setStores([]);
      setActiveStoreIdState(null);
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user?.id ?? null;

      if (!nextUserId) {
        currentUserIdRef.current = null;
        clearStoredStoreSelection();

        if (!mountedRef.current) return;

        setOrganizationId(null);
        setStores([]);
        setActiveStoreIdState(null);
        setError(null);
        setLoading(false);
        return;
      }

      if (currentUserIdRef.current && currentUserIdRef.current !== nextUserId) {
        clearStoredStoreSelection(currentUserIdRef.current);
      }

      void load();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [load]);

  const setActiveStoreId = useCallback((storeId: string) => {
    if (!isValidStoreId(storeId, stores)) {
      console.warn("[StoreProvider] tentativa de selecionar store invalida:", {
        storeId,
      });
      return;
    }

    setActiveStoreIdState(storeId);

    if (typeof window !== "undefined") {
      const userId = currentUserIdRef.current;

      if (userId) {
        window.localStorage.setItem(getStoreStorageKey(userId), storeId);
        window.localStorage.removeItem(ACTIVE_STORE_STORAGE_KEY);
      }
    }
  }, [stores]);

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
    [loading, error, organizationId, stores, activeStoreId, activeStore, setActiveStoreId, load]
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
