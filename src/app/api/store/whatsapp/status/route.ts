import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MembershipRow = {
  organization_id: string;
};

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
};

type ExternalIntegrationRow = {
  provider: string | null;
  status: string | null;
  is_active: boolean | null;
  display_phone_number: string | null;
  phone_number_id: string | null;
  whatsapp_business_account_id: string | null;
};

type InboxTimestampRow = {
  received_at: string | null;
};

type InboxErrorRow = {
  processing_error: string | null;
  received_at: string | null;
};

type OutboundTimestampRow = {
  created_at: string | null;
};

type RecentOutboundStatusRow = {
  delivered_at: string | null;
  read_at: string | null;
  metadata: Record<string, unknown> | null;
};

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function getServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service role nao configurada.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function sanitizeSafeError(value: unknown, maxLength = 220) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function readWhatsappStatus(metadata: Record<string, unknown> | null | undefined) {
  const rawValue = String(metadata?.whatsapp_status || metadata?.whatsapp_last_status || "")
    .trim()
    .toLowerCase();

  if (["sent", "delivered", "read", "failed"].includes(rawValue)) {
    return rawValue as "sent" | "delivered" | "read" | "failed";
  }

  return null;
}

async function resolveAuthorizedStoreContext(searchParams: URLSearchParams) {
  const sessionSupabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await sessionSupabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "UNAUTHENTICATED",
          message: "Usuario nao autenticado.",
        },
        401
      ),
    };
  }

  const storeId = String(searchParams.get("storeId") || "").trim();
  const requestedOrganizationId = String(searchParams.get("organizationId") || "").trim();

  if (!storeId) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "INVALID_STORE_ID",
          message: "Store ID nao informado.",
        },
        400
      ),
    };
  }

  const serviceSupabase = getServiceSupabaseClient();
  const { data: memberships, error: membershipError } = await serviceSupabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id);

  if (membershipError) {
    throw membershipError;
  }

  const organizationIds = Array.from(
    new Set(
      ((memberships ?? []) as MembershipRow[])
        .map((membership) => String(membership.organization_id || "").trim())
        .filter(Boolean)
    )
  );

  if (organizationIds.length === 0) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "FORBIDDEN",
          message: "Usuario sem acesso a lojas.",
        },
        403
      ),
    };
  }

  const { data: store, error: storeError } = await serviceSupabase
    .from("stores")
    .select("id, organization_id, name")
    .eq("id", storeId)
    .maybeSingle<StoreRow>();

  if (storeError) {
    throw storeError;
  }

  if (!store) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "STORE_NOT_FOUND",
          message: "Loja nao encontrada.",
        },
        404
      ),
    };
  }

  if (!organizationIds.includes(store.organization_id)) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "FORBIDDEN",
          message: "Voce nao pode acessar esta loja.",
        },
        403
      ),
    };
  }

  if (requestedOrganizationId && requestedOrganizationId !== store.organization_id) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "ORGANIZATION_STORE_MISMATCH",
          message: "organizationId nao corresponde a loja informada.",
        },
        400
      ),
    };
  }

  return {
    ok: true as const,
    supabase: serviceSupabase,
    store,
  };
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const auth = await resolveAuthorizedStoreContext(searchParams);

    if (!auth.ok) {
      return auth.response;
    }

    const organizationId = auth.store.organization_id;
    const storeId = auth.store.id;

    const [
      integrationsResult,
      lastInboundResult,
      pendingInboxCountResult,
      lastInboxErrorResult,
      lastOutboundResult,
      pendingOutboundCountResult,
      recentOutboundStatusesResult,
    ] = await Promise.all([
      auth.supabase
        .from("external_integrations")
        .select(
          "provider, status, is_active, display_phone_number, phone_number_id, whatsapp_business_account_id"
        )
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .eq("provider", "whatsapp")
        .limit(5),
      auth.supabase
        .from("channel_whatsapp_inbox")
        .select("received_at")
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle<InboxTimestampRow>(),
      auth.supabase
        .from("channel_whatsapp_inbox")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .is("processed_at", null)
        .is("processing_error", null),
      auth.supabase
        .from("channel_whatsapp_inbox")
        .select("processing_error, received_at")
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .not("processing_error", "is", null)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle<InboxErrorRow>(),
      auth.supabase
        .from("messages")
        .select("created_at")
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .eq("direction", "outgoing")
        .not("external_message_id", "is", null)
        .is("deleted_at", null)
        .contains("metadata", {
          external_channel: "whatsapp",
        })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<OutboundTimestampRow>(),
      auth.supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .eq("direction", "outgoing")
        .is("external_message_id", null)
        .is("deleted_at", null)
        .contains("metadata", {
          send_external: true,
          external_channel: "whatsapp",
        }),
      auth.supabase
        .from("messages")
        .select("delivered_at, read_at, metadata")
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .eq("direction", "outgoing")
        .not("external_message_id", "is", null)
        .is("deleted_at", null)
        .contains("metadata", {
          external_channel: "whatsapp",
        })
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const queryError =
      integrationsResult.error ||
      lastInboundResult.error ||
      pendingInboxCountResult.error ||
      lastInboxErrorResult.error ||
      lastOutboundResult.error ||
      pendingOutboundCountResult.error ||
      recentOutboundStatusesResult.error;

    if (queryError) {
      throw queryError;
    }

    const integrations = ((integrationsResult.data || []) as ExternalIntegrationRow[]).filter(
      (row) => String(row.provider || "").trim() === "whatsapp"
    );
    const preferredIntegration =
      integrations.find((row) => row.is_active === true && String(row.status || "").trim().toLowerCase() === "active") ||
      integrations.find((row) => row.is_active === true) ||
      integrations[0] ||
      null;

    const recentStatuses = (recentOutboundStatusesResult.data || []) as RecentOutboundStatusRow[];
    const sentCount = recentStatuses.length;
    const deliveredCount = recentStatuses.filter((row) => {
      const status = readWhatsappStatus(row.metadata);
      return Boolean(row.delivered_at) || status === "delivered" || status === "read";
    }).length;
    const readCount = recentStatuses.filter((row) => {
      const status = readWhatsappStatus(row.metadata);
      return Boolean(row.read_at) || status === "read";
    }).length;

    const connected =
      Boolean(preferredIntegration) &&
      preferredIntegration?.is_active === true &&
      String(preferredIntegration?.status || "").trim().toLowerCase() === "active";

    return buildJsonResponse({
      ok: true,
      connected,
      provider: preferredIntegration?.provider || null,
      status: preferredIntegration?.status || null,
      isActive: preferredIntegration?.is_active === true,
      displayPhoneNumber: preferredIntegration?.display_phone_number || null,
      phoneNumberId: preferredIntegration?.phone_number_id || null,
      whatsappBusinessAccountId:
        preferredIntegration?.whatsapp_business_account_id || null,
      lastInboundAt: lastInboundResult.data?.received_at || null,
      lastOutboundAt: lastOutboundResult.data?.created_at || null,
      pendingInboxCount: pendingInboxCountResult.count ?? 0,
      pendingOutboundCount: pendingOutboundCountResult.count ?? 0,
      lastSafeError: sanitizeSafeError(lastInboxErrorResult.data?.processing_error),
      recentDeliveryStatus: {
        sentCount,
        deliveredCount,
        readCount,
      },
      automaticWorker: {
        routeReady: true,
        scheduledAutomatically: false,
        reason: "Cron frequente desativado no plano Hobby da Vercel",
      },
    });
  } catch (error: any) {
    console.error("[api/store/whatsapp/status][GET] error:", error);

    return buildJsonResponse(
      {
        ok: false,
        error: "LOAD_STORE_WHATSAPP_STATUS_FAILED",
        message: "Nao foi possivel carregar o status do WhatsApp da loja.",
      },
      500
    );
  }
}
