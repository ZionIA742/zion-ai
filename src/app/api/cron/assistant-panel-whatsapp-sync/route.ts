import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { recoverPendingAssistantPanelSyncNotifications } from "@/lib/server/assistant/assistant-panel-whatsapp-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActiveWhatsappIntegrationRow = {
  organization_id: string | null;
  store_id: string | null;
};

function isCronRequestAuthorized(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  return Boolean(cronSecret) && req.headers.get("authorization") === `Bearer ${cronSecret}`;
}

function getActivationAt() {
  const value = String(process.env.ASSISTANT_PANEL_WHATSAPP_SYNC_ACTIVATED_AT || "").trim();
  const timestamp = Date.parse(value);
  return value && Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function getLimit() {
  const value = Number(process.env.ASSISTANT_PANEL_WHATSAPP_SYNC_CRON_LIMIT || 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(Math.trunc(value), 100)) : 10;
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server environment is not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function listActiveWhatsappStores(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const { data, error } = await supabase
    .from("external_integrations")
    .select("organization_id, store_id")
    .eq("provider", "whatsapp")
    .eq("is_active", true)
    .eq("status", "active")
    .not("organization_id", "is", null)
    .not("store_id", "is", null);

  if (error) throw new Error(`Falha ao listar integrações WhatsApp ativas: ${error.message}`);

  const stores = new Map<string, { organizationId: string; storeId: string }>();
  for (const row of (data || []) as ActiveWhatsappIntegrationRow[]) {
    const organizationId = String(row.organization_id || "").trim();
    const storeId = String(row.store_id || "").trim();
    if (organizationId && storeId) stores.set(`${organizationId}:${storeId}`, { organizationId, storeId });
  }
  return Array.from(stores.values());
}

export async function GET(req: Request) {
  if (!isCronRequestAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED_CRON_ROUTE" }, { status: 401 });
  }

  const activationAt = getActivationAt();
  if (!activationAt) {
    return NextResponse.json(
      { ok: false, error: "ASSISTANT_PANEL_SYNC_ACTIVATION_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    const stores = await listActiveWhatsappStores(supabase);
    const results = [];

    for (const store of stores) {
      const result = await recoverPendingAssistantPanelSyncNotifications({
        organizationId: store.organizationId,
        storeId: store.storeId,
        activationAt,
        limit: getLimit(),
      });
      results.push({ ...store, ...result });
    }

    return NextResponse.json({ ok: true, stores: results });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "ASSISTANT_PANEL_SYNC_CRON_FAILED", message: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    );
  }
}
