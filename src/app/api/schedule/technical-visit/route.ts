import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TechnicalVisitRequest = {
  leadId?: string | null;
  conversationId?: string | null;
  title?: string;
  status?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  customerName?: string | null;
  customerPhone?: string | null;
  addressText?: string | null;
  notes?: string | null;
  commercialOpportunityId?: string | null;
};

type RouteDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createServiceSupabaseClient: () => ServiceSupabaseLike;
};

type ServiceSupabaseLike = {
  rpc: (
    name: string,
    payload: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function createServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_ENV_MISSING");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function createTechnicalVisitPostHandler(deps: Partial<RouteDeps> = {}) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const makeServiceClient =
    deps.createServiceSupabaseClient ?? createServiceSupabaseClient;

  return async function POST(request: Request) {
    try {
      const access = await resolveAccess({ requirement: "active" });
      if (!access.ok) return createStoreApiDeniedResponse(access);

      const body = (await request.json().catch(() => null)) as TechnicalVisitRequest | null;
      const opportunityId = String(body?.commercialOpportunityId || "").trim();
      const title = String(body?.title || "").trim();
      const start = String(body?.scheduledStart || "").trim();
      const end = String(body?.scheduledEnd || "").trim();

      if (!opportunityId || !title || !start || !end) {
        return json({ ok: false, error: "TECHNICAL_VISIT_ARGUMENTS_REQUIRED" }, 400);
      }

      const supabase = makeServiceClient();
      const { data, error } = await supabase.rpc(
        "create_technical_visit_with_fresh_commercial_readiness_by_system",
        {
          p_organization_id: access.organizationId,
          p_store_id: access.storeId,
          p_lead_id: body?.leadId || null,
          p_conversation_id: body?.conversationId || null,
          p_title: title,
          p_status: body?.status || "scheduled",
          p_scheduled_start: start,
          p_scheduled_end: end,
          p_customer_name: body?.customerName || null,
          p_customer_phone: body?.customerPhone || null,
          p_address_text: body?.addressText || null,
          p_notes: body?.notes || null,
          p_source: "panel",
          p_created_by_user_id: null,
          p_commercial_opportunity_id: opportunityId,
        },
      );

      if (error) {
        return json(
          { ok: false, error: "TECHNICAL_VISIT_CREATE_FAILED", message: error.message },
          409,
        );
      }

      return json({ ok: true, data });
    } catch (error: unknown) {
      return json(
        {
          ok: false,
          error: "TECHNICAL_VISIT_CREATE_UNAVAILABLE",
          message: error instanceof Error ? error.message : "Unexpected error",
        },
        500,
      );
    }
  };
}

export const POST = createTechnicalVisitPostHandler();
