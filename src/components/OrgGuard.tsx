"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveAccessSelection } from "@/lib/account-access";
import { supabase } from "@/lib/supabaseBrowser";

type AccessStatus = {
  is_blocked: boolean;
  reason?: string | null;
  grace_until?: string | null;
  [key: string]: unknown;
};

type MembershipRow = {
  organization_id: string;
  created_at: string | null;
};

type StoreRow = {
  id: string;
  organization_id: string;
  created_at: string | null;
};

function isNotMemberError(error: unknown) {
  const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
  const code = String((error as { code?: string } | null)?.code || "").toLowerCase();
  return message.includes("not_member") || code === "p0001";
}

export default function OrgGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const mountedRef = useRef(true);

  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessStatus | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let running = false;

    const goLogin = () => {
      if (cancelled || !mountedRef.current) return;
      if (typeof window !== "undefined" && window.location.pathname === "/login") {
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

      try {
        const { data: sessionRes, error: sessionErr } = await supabase.auth.getSession();

        if (cancelled || !mountedRef.current) return;

        if (sessionErr) {
          console.error("[OrgGuard] auth.getSession error:", {
            message: sessionErr.message ?? null,
            status: (sessionErr as { status?: number | null })?.status ?? null,
          });
          goLogin();
          return;
        }

        const user = sessionRes.session?.user;

        if (!user) {
          goLogin();
          return;
        }

        const { data: memberships, error: membershipError } = await supabase
          .from("memberships")
          .select("organization_id, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });

        if (cancelled || !mountedRef.current) return;

        if (membershipError) {
          console.error("[OrgGuard] memberships error:", {
            message: membershipError.message ?? null,
            details: membershipError.details ?? null,
            hint: membershipError.hint ?? null,
            code: membershipError.code ?? null,
          });
          setFatalError("Não foi possível validar as organizações liberadas para esta conta.");
          return;
        }

        const membershipRows = (memberships ?? []) as MembershipRow[];
        const organizationIds = Array.from(
          new Set(membershipRows.map((membership) => membership.organization_id).filter(Boolean)),
        );

        let storeRows: StoreRow[] = [];

        if (organizationIds.length > 0) {
          const { data: stores, error: storeError } = await supabase
            .from("stores")
            .select("id, organization_id, created_at")
            .in("organization_id", organizationIds)
            .order("created_at", { ascending: true });

          if (cancelled || !mountedRef.current) return;

          if (storeError) {
            console.error("[OrgGuard] stores error:", {
              message: storeError.message ?? null,
              details: storeError.details ?? null,
              hint: storeError.hint ?? null,
              code: storeError.code ?? null,
            });
            setFatalError("Não foi possível validar a loja inicial desta conta.");
            return;
          }

          storeRows = (stores ?? []) as StoreRow[];
        }

        const selection = resolveAccessSelection(membershipRows, storeRows);

        if (!selection.ok) {
          setFatalError(selection.message);
          return;
        }

        setOrgId(selection.organizationId);

        const { data: accessData, error: accessError } = await supabase.rpc(
          "get_org_access_status",
          {
            p_org_id: selection.organizationId,
          },
        );

        if (cancelled || !mountedRef.current) return;

        if (accessError) {
          console.error("[OrgGuard] get_org_access_status error:", {
            message: accessError.message ?? null,
            details: accessError.details ?? null,
            hint: accessError.hint ?? null,
            code: accessError.code ?? null,
          });

          if (isNotMemberError(accessError)) {
            setFatalError(
              "Sua conta não tem autorização válida para a organização selecionada. O time interno precisa revisar o provisionamento.",
            );
            return;
          }

          setFatalError("Falha técnica ao verificar o acesso desta organização.");
          return;
        }

        const normalizedAccess: AccessStatus =
          accessData && typeof accessData === "object"
            ? (accessData as AccessStatus)
            : ({ is_blocked: false } as AccessStatus);

        setAccess(normalizedAccess);
      } catch (error: unknown) {
        if (cancelled || !mountedRef.current) return;

        const message =
          error &&
          typeof error === "object" &&
          "message" in error &&
          typeof (error as { message?: unknown }).message === "string"
            ? (error as { message: string }).message
            : null;

        console.error("[OrgGuard] unexpected error:", {
          message,
        });
        setFatalError("Erro inesperado ao verificar o acesso da conta.");
      } finally {
        running = false;
        if (!cancelled && mountedRef.current) {
          setLoading(false);
        }
      }
    };

    void run();

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
        void run();
      }
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        Verificando acesso da organização...
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-bold">Acesso pendente de revisão</h1>
        <p className="max-w-xl">{fatalError}</p>
        <button
          type="button"
          className="rounded bg-black px-4 py-2 text-white"
          onClick={() => router.replace("/login")}
        >
          Voltar ao login
        </button>
      </div>
    );
  }

  if (!orgId) {
    return null;
  }

  if (access?.is_blocked) {
    return (
      <div className="flex h-screen flex-col items-center justify-center px-6 text-center">
        <h1 className="mb-4 text-2xl font-bold">Acesso bloqueado</h1>
        <p className="mb-2">Motivo: {access.reason ?? "bloqueio de acesso"}</p>
        <p>Regularize a situação da organização para continuar usando o ZION.</p>
      </div>
    );
  }

  return <>{children}</>;
}
