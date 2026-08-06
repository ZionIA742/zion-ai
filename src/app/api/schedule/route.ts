// src/app/api/schedule/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScheduleItemRow = {
  item_kind: string;
  item_id: string;
  organization_id: string;
  store_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  title: string;
  item_type: string;
  status: string;
  start_at: string;
  end_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  address_text: string | null;
  notes: string | null;
  source: string;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type ScheduleRouteDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createPrivilegedClient: () => ReturnType<typeof createClient>;
};

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      Vary: "*",
    },
  });
}

function createPrivilegedClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente.",
    );
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createScheduleGetHandler(
  deps: Partial<ScheduleRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createClientWithPrivileges =
    deps.createPrivilegedClient ?? createPrivilegedClient;

  return async function GET(request: Request) {
    try {
      const url = new URL(request.url);
      const start = String(url.searchParams.get("start") || "").trim();
      const end = String(url.searchParams.get("end") || "").trim();

      if (!start) {
        return buildJsonResponse(
          {
            ok: false,
            error: "MISSING_START",
            message: "ParÃ¢metro start nÃ£o informado.",
          },
          400,
        );
      }

      if (!end) {
        return buildJsonResponse(
          {
            ok: false,
            error: "MISSING_END",
            message: "ParÃ¢metro end nÃ£o informado.",
          },
          400,
        );
      }

      const startDate = new Date(start);
      const endDate = new Date(end);

      if (Number.isNaN(startDate.getTime())) {
        return buildJsonResponse(
          {
            ok: false,
            error: "INVALID_START",
            message: "ParÃ¢metro start invÃ¡lido.",
          },
          400,
        );
      }

      if (Number.isNaN(endDate.getTime())) {
        return buildJsonResponse(
          {
            ok: false,
            error: "INVALID_END",
            message: "ParÃ¢metro end invÃ¡lido.",
          },
          400,
        );
      }

      if (endDate <= startDate) {
        return buildJsonResponse(
          {
            ok: false,
            error: "INVALID_RANGE",
            message: "O parÃ¢metro end deve ser maior que start.",
          },
          400,
        );
      }

      const access = await resolveAccess({
        requirement: "active",
      });

      if (!access.ok) {
        return createStoreApiDeniedResponse(access);
      }

      const organizationId = access.organizationId;
      const storeId = access.storeId;
      const supabase = createClientWithPrivileges();

      const { data, error } = await supabase.rpc("list_store_schedule_items", {
        p_organization_id: organizationId,
        p_store_id: storeId,
        p_start_at: startDate.toISOString(),
        p_end_at: endDate.toISOString(),
      });

      if (error) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LOAD_SCHEDULE_FAILED",
            message: error.message,
          },
          500,
        );
      }

      const items = ((data || []) as ScheduleItemRow[]).map((item) => ({
        itemKind: item.item_kind,
        itemId: item.item_id,
        organizationId: item.organization_id,
        storeId: item.store_id,
        leadId: item.lead_id,
        conversationId: item.conversation_id,
        title: item.title,
        itemType: item.item_type,
        status: item.status,
        startAt: item.start_at,
        endAt: item.end_at,
        customerName: item.customer_name,
        customerPhone: item.customer_phone,
        addressText: item.address_text,
        notes: item.notes,
        source: item.source,
        createdByUserId: item.created_by_user_id,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }));

      return buildJsonResponse({
        ok: true,
        organizationId,
        storeId,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        count: items.length,
        items,
      });
    } catch (error: any) {
      return buildJsonResponse(
        {
          ok: false,
          error: "SCHEDULE_ROUTE_FAILED",
          message: error?.message || "Erro interno ao carregar agenda.",
        },
        500,
      );
    }
  };
}

export const GET = createScheduleGetHandler();
