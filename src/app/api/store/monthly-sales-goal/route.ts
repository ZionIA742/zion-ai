import { NextResponse } from "next/server";
import {
  normalizeMonthlySalesGoalInput,
  normalizeStoreMonthlySalesGoalRow,
  type StoreMonthlySalesGoalInput,
  type StoreMonthlySalesGoalRow,
} from "@/lib/store-monthly-sales-goal";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MonthlySalesGoalRouteDeps = {
  resolveAccess: (params: {
    requirement: "active_or_onboarding";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
};

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function normalizeBody(value: unknown): StoreMonthlySalesGoalInput {
  const record = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

  return normalizeMonthlySalesGoalInput({
    enabled: record.enabled === true || record.monthlyGoalEnabled === true,
    amountCents:
      typeof record.amountCents === "number"
        ? record.amountCents
        : typeof record.monthlyGoalAmountCents === "number"
          ? record.monthlyGoalAmountCents
          : null,
  });
}

export function createStoreMonthlySalesGoalGetHandler(
  deps: Partial<MonthlySalesGoalRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;

  return async function GET(_request?: Request) {
    void _request;

    try {
      const access = await resolveAccess({ requirement: "active_or_onboarding" });
      if (!access.ok) return createStoreApiDeniedResponse(access);

      const { data, error } = await access.supabase
        .from("store_monthly_sales_goals")
        .select(
          "organization_id, store_id, monthly_goal_enabled, monthly_goal_amount_cents, created_at, updated_at",
        )
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle();

      if (error) {
        return buildJsonResponse(
          {
            ok: false,
            error: "STORE_MONTHLY_SALES_GOAL_LOAD_FAILED",
            message: "Nao foi possivel carregar a meta mensal da loja.",
          },
          500,
        );
      }

      return buildJsonResponse({
        ok: true,
        goal: normalizeStoreMonthlySalesGoalRow(data as StoreMonthlySalesGoalRow | null),
      });
    } catch {
      return buildJsonResponse(
        {
          ok: false,
          error: "STORE_MONTHLY_SALES_GOAL_ROUTE_FAILED",
          message: "Nao foi possivel carregar a meta mensal da loja.",
        },
        500,
      );
    }
  };
}

export function createStoreMonthlySalesGoalPostHandler(
  deps: Partial<MonthlySalesGoalRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;

  return async function POST(request: Request) {
    try {
      const access = await resolveAccess({ requirement: "active_or_onboarding" });
      if (!access.ok) return createStoreApiDeniedResponse(access);

      let normalized: StoreMonthlySalesGoalInput;
      try {
        normalized = normalizeBody(await request.json().catch(() => null));
      } catch {
        return buildJsonResponse(
          {
            ok: false,
            error: "STORE_MONTHLY_SALES_GOAL_INVALID",
            message: "Informe um valor positivo para ativar a meta mensal.",
          },
          400,
        );
      }

      const { data, error } = await access.supabase.rpc(
        "upsert_store_monthly_sales_goal_scoped",
        {
          p_organization_id: access.organizationId,
          p_store_id: access.storeId,
          p_monthly_goal_enabled: normalized.enabled,
          p_monthly_goal_amount_cents: normalized.amountCents,
        },
      );

      if (error) {
        return buildJsonResponse(
          {
            ok: false,
            error: "STORE_MONTHLY_SALES_GOAL_SAVE_FAILED",
            message: "Nao foi possivel salvar a meta mensal da loja.",
          },
          409,
        );
      }

      const row = Array.isArray(data)
        ? (data[0] as StoreMonthlySalesGoalRow | undefined)
        : (data as StoreMonthlySalesGoalRow | null);

      return buildJsonResponse({
        ok: true,
        goal: normalizeStoreMonthlySalesGoalRow(row ?? null),
      });
    } catch {
      return buildJsonResponse(
        {
          ok: false,
          error: "STORE_MONTHLY_SALES_GOAL_ROUTE_FAILED",
          message: "Nao foi possivel salvar a meta mensal da loja.",
        },
        500,
      );
    }
  };
}

export const GET = createStoreMonthlySalesGoalGetHandler();
export const POST = createStoreMonthlySalesGoalPostHandler();
