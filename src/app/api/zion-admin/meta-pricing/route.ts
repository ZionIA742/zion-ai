import { createClient } from "@supabase/supabase-js";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { createZionAdminApiDeniedResponse, createZionAdminApiJsonResponse } from "@/lib/server/zion-admin-api-response";
import { summarizeMetaPricingAnalytics } from "@/lib/server/zion-admin-meta-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetaIntegration = {
  whatsapp_business_account_id: string | null;
  display_phone_number: string | null;
  access_token: string | null;
};

export async function GET(request: Request) {
  const access = await resolveZionAdminApiAccess();
  if (!access.ok) return createZionAdminApiDeniedResponse(access);

  const params = new URL(request.url).searchParams;
  const storeId = params.get("storeId") || "";
  const month = params.get("month") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId) ||
      !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) {
    return createZionAdminApiJsonResponse({ ok: false, code: "INVALID_META_PRICING_QUERY" }, 400);
  }

  const [year, monthNumber] = month.split("-").map(Number);
  const start = Date.UTC(year, monthNumber - 1, 1) / 1000;
  const end = Date.UTC(year, monthNumber, 1) / 1000;
  const now = Date.now() / 1000;
  if (start > now || start < now - 365 * 86400) {
    return createZionAdminApiJsonResponse({ ok: false, code: "META_PRICING_PERIOD_UNAVAILABLE" }, 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiVersion = process.env.META_GRAPH_API_VERSION || "v26.0";
  if (!supabaseUrl || !serviceRoleKey || !/^v\d+\.\d+$/.test(apiVersion)) {
    return createZionAdminApiJsonResponse({ ok: false, code: "META_PRICING_UNAVAILABLE" }, 503);
  }

  try {
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await db.from("external_integrations")
      .select("whatsapp_business_account_id,display_phone_number,access_token")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .not("whatsapp_business_account_id", "is", null)
      .limit(3);
    if (error || !data) throw new Error("META_PRICING_INTEGRATION_UNAVAILABLE");
    if (data.length !== 1) {
      return createZionAdminApiJsonResponse({ ok: false, code: "META_PRICING_INTEGRATION_AMBIGUOUS_OR_MISSING" }, 409);
    }
    const integration = data[0] as MetaIntegration;
    const wabaId = integration.whatsapp_business_account_id?.trim() || "";
    const token = integration.access_token?.trim() || "";
    const phone = (integration.display_phone_number || "").replace(/\D/g, "");
    if (!/^\d{5,25}$/.test(wabaId) || !/^[1-9]\d{9,14}$/.test(phone) || !token) {
      return createZionAdminApiJsonResponse({ ok: false, code: "META_PRICING_INTEGRATION_INCOMPLETE" }, 409);
    }

    const fields = `currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY).phone_numbers(["${phone}"]).dimensions(PRICING_CATEGORY,PRICING_TYPE)`;
    const url = new URL(`https://graph.facebook.com/${apiVersion}/${wabaId}`);
    url.searchParams.set("fields", fields);
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("META_PRICING_PROVIDER_UNAVAILABLE");
    const payload: unknown = await response.json();
    const summary = summarizeMetaPricingAnalytics(payload, wabaId);
    return createZionAdminApiJsonResponse({
      ok: true,
      storeId,
      month,
      periodTimezone: "UTC",
      source: "meta_pricing_analytics",
      ...summary,
    }, 200);
  } catch {
    return createZionAdminApiJsonResponse({ ok: false, code: "META_PRICING_UNAVAILABLE" }, 503);
  }
}