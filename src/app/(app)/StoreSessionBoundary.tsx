"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type SessionBoundaryState =
  | "checking"
  | "ready"
  | "signed_out"
  | "identity_changed"
  | "unavailable";

export default function StoreSessionBoundary({
  expectedUserId,
  children,
}: {
  expectedUserId: string;
  children: ReactNode;
}) {
  const [state, setState] =
    useState<SessionBoundaryState>("checking");

  const terminalRef = useRef(false);
  const navigationStartedRef = useRef(false);

  useEffect(() => {
    let active = true;

    function block(
      next: "signed_out" | "identity_changed" | "unavailable",
    ) {
      if (!active || terminalRef.current) return;

      terminalRef.current = true;
      setState(next);
    }

    if (terminalRef.current) return;

    try {
      const { data: { subscription } } =
        supabase.auth.onAuthStateChange((event, session) => {
          if (!active || terminalRef.current) return;

          const actualUserId = session?.user?.id;

          if (event === "SIGNED_OUT" || !actualUserId) {
            block("signed_out");
            return;
          }

          if (actualUserId !== expectedUserId) {
            block("identity_changed");
            return;
          }

          setState("ready");
        });

      return () => {
        active = false;
        subscription.unsubscribe();
      };
    } catch {
      block("unavailable");

      return () => {
        active = false;
      };
    }
  }, [expectedUserId]);

  useEffect(() => {
    if (
      state === "checking" ||
      state === "ready" ||
      navigationStartedRef.current
    ) {
      return;
    }

    navigationStartedRef.current = true;

    if (state === "signed_out") {
      window.location.replace("/login");
      return;
    }

    if (state === "identity_changed") {
      // Reexecutar o gate canonico no servidor.
      // Nunca liberar os dados da identidade anterior.
      window.location.reload();
      return;
    }

    window.location.replace("/account/access-unavailable");
  }, [state]);

  if (state !== "ready") {
    return (
      <div
        role="status"
        className="flex min-h-dvh items-center justify-center bg-white px-6 text-sm text-gray-600"
      >
        {state === "checking"
          ? "Verificando sess\u00e3o..."
          : "Atualizando sess\u00e3o..."}
      </div>
    );
  }

  return <>{children}</>;
}
