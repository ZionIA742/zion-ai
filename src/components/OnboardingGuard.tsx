"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { useStoreContext } from "./StoreProvider";

type OnboardingRow = {
  id?: string;
  store_id: string;
  organization_id: string;
  status: string;
  completed_at?: string | null;
  updated_at?: string;
  created_at?: string;
};

export default function OnboardingGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const mountedRef = useRef(true);

  const {
    loading: storeLoading,
    error: storeError,
    organizationId,
    activeStoreId,
  } = useStoreContext();

  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      console.log("ONBOARDING GUARD EXECUTANDO");
        if (storeLoading) {
        return;
      }

      if (storeError) {
        if (!cancelled && mountedRef.current) {
          setFatalError("Falha ao identificar a loja ativa.");
          setLoading(false);
        }
        return;
      }

      if (!organizationId || !activeStoreId) {
        if (!cancelled && mountedRef.current) {
          setFatalError("Loja ativa não encontrada.");
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setFatalError(null);

      try {
        const { data, error } = await supabase.rpc(
          "onboarding_get_store_onboarding_scoped",
          {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
          }
        );

        if (cancelled || !mountedRef.current) return;

        if (error) {
          console.error("[OnboardingGuard] RPC error:", error);
          setFatalError("Falha ao verificar onboarding da loja.");
          setLoading(false);
          return;
        }

        const onboarding = data as OnboardingRow | null;
        const status = onboarding?.status ?? "not_started";

        if (status !== "completed") {
          router.replace("/onboarding");
          return;
        }

        setLoading(false);
      } catch (err) {
        if (cancelled || !mountedRef.current) return;

        console.error("[OnboardingGuard] unexpected error:", err);
        setFatalError("Erro inesperado ao verificar onboarding.");
        setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [storeLoading, storeError, organizationId, activeStoreId, router, pathname]);

  if (storeLoading || loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        Verificando onboarding...
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-center px-6 gap-3">
        <h1 className="text-2xl font-bold">Ops…</h1>
        <p className="max-w-xl">{fatalError}</p>
        <button
          className="px-4 py-2 rounded bg-black text-white"
          onClick={() => window.location.reload()}
        >
          Recarregar
        </button>
      </div>
    );
  }

  return <>{children}</>;
}