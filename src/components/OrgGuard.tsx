"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type AccessStatus = {
  is_blocked: boolean;
  reason?: string | null;
  grace_until?: string | null;
  [key: string]: any;
};

function isNotMemberError(err: unknown) {
  const msg = (err as any)?.message ?? String(err ?? "");
  const lower = String(msg).toLowerCase();
  return (
    lower.includes("not_member") ||
    lower.includes("not member") ||
    lower.includes("p0001")
  );
}

async function rpcGetAccessStatus(
  orgId: string
): Promise<{ data: any; error: any }> {
  const tries: Array<Record<string, any>> = [
    { p_org_id: orgId },
    { org_id: orgId },
    { p_organization_id: orgId },
    { organization_id: orgId },
  ];

  let last: any = null;

  for (const args of tries) {
    const res = await supabase.rpc("get_org_access_status", args);
    if (!res.error) return res;
    last = res;
  }

  return last ?? {
    data: null,
    error: new Error("RPC get_org_access_status falhou"),
  };
}

export default function OrgGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let running = false;

    const goLogin = () => {
      if (cancelled || !mountedRef.current) return;
      if (
        typeof window !== "undefined" &&
        window.location.pathname === "/login"
      ) {
        return;
      }
      router.replace("/login");
    };

    const run = async () => {
      if (running) return;
      running = true;

      setLoading(true);
      setFatalError(null);
      setOrgId(null);
      setAccess(null);

      const timeoutMs = 12000;
      const timeout = setTimeout(() => {
        if (cancelled || !mountedRef.current) return;
        setFatalError("Tempo excedido verificando acesso. Recarregue a página.");
        setLoading(false);
      }, timeoutMs);

      try {
        const { data: sessionRes, error: sessionErr } =
          await supabase.auth.getSession();

        if (cancelled || !mountedRef.current) return;

        if (sessionErr) {
          console.error("[OrgGuard] auth.getSession error:", {
            message: sessionErr.message ?? null,
            status: (sessionErr as any)?.status ?? null,
            name: (sessionErr as any)?.name ?? null,
            full: sessionErr,
          });
          goLogin();
          return;
        }

        const session = sessionRes.session;

        if (!session?.user) {
          console.warn("[OrgGuard] sessão ausente ou sem usuário.");
          goLogin();
          return;
        }

        const userId = session.user.id;

        console.log("[OrgGuard] session user id:", userId);

        const { data: memRows, error: memErr } = await supabase
          .from("memberships")
          .select("id, organization_id, user_id, role, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (cancelled || !mountedRef.current) return;

        console.log("[OrgGuard] memberships rows:", memRows);
        console.log("[OrgGuard] memberships error raw:", memErr);
        console.log(
          "[OrgGuard] memberships error json:",
          JSON.stringify(memErr, null, 2)
        );

        if (memErr) {
          console.error("[OrgGuard] memberships query error details:", {
            message: (memErr as any)?.message ?? null,
            details: (memErr as any)?.details ?? null,
            hint: (memErr as any)?.hint ?? null,
            code: (memErr as any)?.code ?? null,
            full: memErr,
          });
          goLogin();
          return;
        }

        const foundOrgId = memRows?.[0]?.organization_id ?? null;

        if (!foundOrgId) {
          console.warn(
            "[OrgGuard] usuário logado, mas sem membership (organization_id)."
          );
          goLogin();
          return;
        }

        setOrgId(foundOrgId);

        const { data: accessData, error: accessErr } =
          await rpcGetAccessStatus(foundOrgId);

        if (cancelled || !mountedRef.current) return;

        if (accessErr) {
          console.error("[OrgGuard] RPC get_org_access_status error:", {
            message: (accessErr as any)?.message ?? null,
            details: (accessErr as any)?.details ?? null,
            hint: (accessErr as any)?.hint ?? null,
            code: (accessErr as any)?.code ?? null,
            full: accessErr,
          });

          if (isNotMemberError(accessErr)) {
            goLogin();
            return;
          }

          setFatalError("Falha ao verificar assinatura/acesso. Veja o console.");
          return;
        }

        const normalized: AccessStatus =
          accessData && typeof accessData === "object"
            ? (accessData as AccessStatus)
            : ({ is_blocked: false, raw: accessData } as AccessStatus);

        setAccess(normalized);
      } catch (e: any) {
        if (cancelled || !mountedRef.current) return;

        console.error("[OrgGuard] erro inesperado:", {
          message: e?.message ?? null,
          stack: e?.stack ?? null,
          full: e,
        });

        setFatalError("Erro inesperado no guard. Veja o console.");
      } finally {
        clearTimeout(timeout);
        running = false;

        if (cancelled || !mountedRef.current) return;
        setLoading(false);
      }
    };

    run();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT" ||
        event === "TOKEN_REFRESHED"
      ) {
        run();
      }
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        Verificando assinatura...
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

  if (!orgId) return null;

  if (access?.is_blocked) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-center px-6">
        <h1 className="text-2xl font-bold mb-4">Sistema bloqueado</h1>
        <p className="mb-2">Motivo: {access?.reason ?? "bloqueio"}</p>
        <p>Regularize sua assinatura para continuar usando o Zion.</p>
      </div>
    );
  }

  return <>{children}</>;
}