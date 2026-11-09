import { createClient } from "@supabase/supabase-js";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";
import {
  buildMonthlyFinancialHistory,
} from "@/lib/server/zion-admin-financial-history";

export const dynamic = "force-dynamic";

function recentMonths(): string[] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());

  const year = Number(
    parts.find((part) => part.type === "year")?.value,
  );
  const month = Number(
    parts.find((part) => part.type === "month")?.value,
  );

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error("FINANCIAL_HISTORY_CLOCK_UNAVAILABLE");
  }

  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    return date.toISOString().slice(0, 10);
  });
}

export async function GET() {
  const access = await resolveZionAdminApiAccess();

  if (!access.ok) {
    return createZionAdminApiDeniedResponse(access);
  }

  if (!access.resolution.capabilities.includes("manage_accounts")) {
    return createZionAdminApiJsonResponse(
      { error: "Historico financeiro nao autorizado." },
      403,
    );
  }

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error("FINANCIAL_HISTORY_SERVICE_UNAVAILABLE");
    }

    const db = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const months = recentMonths();

    const [
      preclosures,
      preclosureAudits,
      revenues,
      revenueAudits,
    ] = await Promise.all([
      db.from("zion_admin_monthly_preclosures")
        .select("month,revision,source_snapshot,pending_sources")
        .in("month", months),

      db.from("zion_admin_monthly_preclosure_audit")
        .select("month,revision")
        .in("month", months),

      db.from("zion_admin_monthly_manual_revenue")
        .select("month,amount_brl_cents,revision,updated_at")
        .in("month", months),

      db.from("zion_admin_monthly_manual_revenue_audit")
        .select("month,revision,amount_brl_cents")
        .in("month", months),
    ]);

    if (
      preclosures.error ||
      preclosureAudits.error ||
      revenues.error ||
      revenueAudits.error
    ) {
      throw new Error("FINANCIAL_HISTORY_READ_FAILED");
    }

    const history = buildMonthlyFinancialHistory({
      months,
      preclosures: preclosures.data,
      preclosureAudits: preclosureAudits.data,
      revenues: revenues.data,
      revenueAudits: revenueAudits.data,
    });

    return createZionAdminApiJsonResponse({
      ok: true,
      timezone: "America/Sao_Paulo",
      definitiveFinancialCloseAvailable: false,
      history,
    }, 200);
  } catch {
    return createZionAdminApiJsonResponse({
      error: "Historico financeiro indisponivel. Nenhum valor foi presumido.",
    }, 503);
  }
}