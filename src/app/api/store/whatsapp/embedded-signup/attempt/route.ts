import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { resolveStoreApiAccess } from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConnectionMode = "standard" | "business_app_coexistence";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function createPrivilegedClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY_MISSING");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  const access = await resolveStoreApiAccess({ requirement: "active_or_onboarding" });
  if (!access.ok) return createStoreApiDeniedResponse(access);

  let body: { connectionMode?: unknown; appId?: unknown; configId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }

  const connectionMode = clean(body?.connectionMode) as ConnectionMode;
  const appId = clean(body?.appId);
  const configId = clean(body?.configId);
  if (
    (connectionMode !== "standard" && connectionMode !== "business_app_coexistence") ||
    !appId ||
    !configId
  ) {
    return json({ ok: false, error: "INVALID_EMBEDDED_SIGNUP_ATTEMPT" }, 400);
  }

  const attemptId = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await createPrivilegedClient()
    .from("whatsapp_embedded_signup_attempts")
    .insert({
      id: attemptId,
      organization_id: access.organizationId,
      store_id: access.storeId,
      user_id: access.sessionUserId,
      connection_mode: connectionMode,
      meta_app_id: appId,
      meta_config_id: configId,
      status: "issued",
      expires_at: expiresAt,
    });

  if (error) {
    console.error("[embedded-signup/attempt] failed to persist attempt", error.message);
    return json({ ok: false, error: "EMBEDDED_SIGNUP_ATTEMPT_UNAVAILABLE" }, 503);
  }

  return json({ ok: true, attemptId, expiresAt, connectionMode });
}
