import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import AppShellClient from "./AppShellClient";
import StoreSessionBoundary from "./StoreSessionBoundary";
import { resolveAccountAccessPageGate } from "@/lib/account-access-page-gate";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { resolveAccessForRequest } from "@/lib/server/account-access-resolver";

export const runtime = "nodejs";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  let resolution;

  try {
    const supabase = await createSupabaseServerClient();
    resolution = await resolveAccessForRequest({
      requestedDomain: "store_area",
      supabase,
    });
  } catch {
    redirect("/account/access-unavailable");
  }

  const gate = resolveAccountAccessPageGate(resolution, "store_app");

  if (gate.action === "redirect") {
    redirect(gate.destination);
  }

  if (!resolution.sessionUserId) {
    redirect("/account/access-unavailable");
  }

  return (
    <StoreSessionBoundary
      key={resolution.sessionUserId}
      expectedUserId={resolution.sessionUserId}
    >
      <AppShellClient>{children}</AppShellClient>
    </StoreSessionBoundary>
  );
}
