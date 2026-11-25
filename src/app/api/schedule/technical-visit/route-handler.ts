import { withBackendDiagnosticRoute } from "../../../../lib/server/zion-admin-diagnostic-backend-next";
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
  operationKey?: string;
};

type RouteDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function createTechnicalVisitPostHandler(deps: Partial<RouteDeps> = {}) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;

  return async function POST(request: Request) {
    try {
      const access = await resolveAccess({ requirement: "active" });
      if (!access.ok) return createStoreApiDeniedResponse(access);

      const body = (await request.json().catch(() => null)) as TechnicalVisitRequest | null;
      const opportunityId = String(body?.commercialOpportunityId || "").trim();
      const title = String(body?.title || "").trim();
      const start = String(body?.scheduledStart || "").trim();
      const end = String(body?.scheduledEnd || "").trim();
      const operationKey = String(body?.operationKey || "").trim();

      if (!opportunityId || !title || !start || !end || !operationKey) {
        return json({ ok: false, error: "TECHNICAL_VISIT_ARGUMENTS_REQUIRED" }, 400);
      }

      const { data, error } = await access.supabase.rpc(
        "create_technical_visit_by_user",
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
          p_commercial_opportunity_id: opportunityId,
          p_operation_key: operationKey,
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

const zionBackendOriginalPOST = createTechnicalVisitPostHandler();

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/schedule/technical-visit",
  "POST",
  zionBackendOriginalPOST,
);

export const POST: typeof zionBackendOriginalPOST = async function POST(request: Request) {
  return zionBackendObservedPOST(request);
};
