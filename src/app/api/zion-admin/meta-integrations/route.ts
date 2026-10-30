import { createClient } from "@supabase/supabase-js";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { createZionAdminApiDeniedResponse, createZionAdminApiJsonResponse } from "@/lib/server/zion-admin-api-response";
import { buildMetaStoreOptions } from "@/lib/zion-admin-meta-cost-presentation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INTEGRATIONS = 500;

/** Admin-only list. No token, WABA ID or full phone ever enters the response. */
export async function GET() {
  const access = await resolveZionAdminApiAccess();
  if (!access.ok) return createZionAdminApiDeniedResponse(access);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return createZionAdminApiJsonResponse({ ok: false, code: "META_INTEGRATIONS_UNAVAILABLE" }, 503);
  }

  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from("external_integrations")
      .select("store_id,whatsapp_business_account_id,display_phone_number,access_token")
      .eq("is_active", true)
      .not("whatsapp_business_account_id", "is", null)
      .order("store_id", { ascending: true })
      .limit(MAX_INTEGRATIONS + 1);
    if (error || !data || data.length > MAX_INTEGRATIONS) throw new Error("META_INTEGRATIONS_UNAVAILABLE");
    return createZionAdminApiJsonResponse({ ok: true, stores: buildMetaStoreOptions(data) }, 200);
  } catch {
    return createZionAdminApiJsonResponse({ ok: false, code: "META_INTEGRATIONS_UNAVAILABLE" }, 503);
  }
}
