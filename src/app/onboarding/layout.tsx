import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { resolveAccountAccessPageGate } from "@/lib/account-access-page-gate";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { resolveAccessForRequest } from "@/lib/server/account-access-resolver";

export const runtime = "nodejs";

export default async function OnboardingLayout({
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

  const gate = resolveAccountAccessPageGate(resolution, "onboarding");

  if (gate.action === "redirect") {
    redirect(gate.destination);
  }

  return <>{children}</>;
}
