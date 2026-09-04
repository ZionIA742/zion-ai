import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  isCommercialActionKey,
  mapCommercialActionReadinessFailure,
  refreshCommercialActionReadiness,
} from "@/lib/server/commercial-action-readiness";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  commercialOpportunityId?: string;
  actionKey?: string;
};

type OpportunityRow = {
  id: string;
  organization_id: string;
  store_id: string;
};

type ActionReadinessRouteDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createServiceSupabaseClient: () => unknown;
  refreshActionReadiness: typeof refreshCommercialActionReadiness;
};

function createServiceSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente.",
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function buildReadinessBlockedResponse(
  result: Awaited<ReturnType<typeof refreshCommercialActionReadiness>>,
) {
  const mapped = mapCommercialActionReadinessFailure(result);
  if (!result.ok) {
    return buildJsonResponse(
      {
        ok: false,
        error: mapped.error,
        message: "Nao foi possivel validar a prontidao da acao comercial agora.",
      },
      mapped.status,
    );
  }

  return buildJsonResponse(
    {
      ok: false,
      error: mapped.error,
      message: "A acao comercial ainda nao esta pronta para execucao.",
      actionKey: result.decision.actionKey,
      readinessState: result.decision.readinessState,
      reasonCode: result.decision.reasonCode,
      blockingItems: result.decision.blockingItems,
      authorityFingerprint: result.decision.authorityFingerprint,
    },
    mapped.status,
  );
}

export function createActionReadinessPostHandler(
  deps: Partial<ActionReadinessRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const makeServiceSupabase =
    deps.createServiceSupabaseClient ?? createServiceSupabaseClient;
  const refreshActionReadiness =
    deps.refreshActionReadiness ?? refreshCommercialActionReadiness;

  return async function POST(request: Request) {
    try {
      const access = await resolveAccess({
        requirement: "active",
      });

      if (!access.ok) {
        return createStoreApiDeniedResponse(access);
      }

      const body = (await request.json().catch(() => null)) as RequestBody | null;
      const commercialOpportunityId = String(
        body?.commercialOpportunityId || "",
      ).trim();
      const actionKey = String(body?.actionKey || "").trim();

      if (!commercialOpportunityId) {
        return buildJsonResponse(
          {
            ok: false,
            error: "MISSING_COMMERCIAL_OPPORTUNITY_ID",
            message: "Selecione a oportunidade comercial antes de validar a acao.",
          },
          400,
        );
      }

      if (!actionKey) {
        return buildJsonResponse(
          {
            ok: false,
            error: "MISSING_COMMERCIAL_ACTION_KEY",
            message: "Informe a acao comercial antes de validar a prontidao.",
          },
          400,
        );
      }

      if (!isCommercialActionKey(actionKey)) {
        return buildJsonResponse(
          {
            ok: false,
            error: "COMMERCIAL_ACTION_KEY_INVALID",
            message: "Informe uma acao comercial valida.",
          },
          400,
        );
      }

      const { data: opportunity, error: opportunityError } = await access.supabase
        .from("commercial_opportunities")
        .select("id, organization_id, store_id")
        .eq("id", commercialOpportunityId)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<OpportunityRow>();

      if (opportunityError) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LOAD_COMMERCIAL_OPPORTUNITY_FAILED",
            message: "Nao foi possivel validar a oportunidade comercial informada.",
          },
          500,
        );
      }

      if (!opportunity) {
        return buildJsonResponse(
          {
            ok: false,
            error: "COMMERCIAL_OPPORTUNITY_NOT_FOUND",
            message: "Oportunidade comercial nao encontrada para a loja informada.",
          },
          404,
        );
      }

      const readiness = await refreshActionReadiness({
        supabase: makeServiceSupabase() as never,
        organizationId: access.organizationId,
        storeId: access.storeId,
        commercialOpportunityId: opportunity.id,
        actionKey,
      });

      if (!readiness.ok || readiness.decision.readinessState !== "ready") {
        return buildReadinessBlockedResponse(readiness);
      }

      return buildJsonResponse({
        ok: true,
        actionKey: readiness.decision.actionKey,
        readinessState: readiness.decision.readinessState,
        reasonCode: readiness.decision.reasonCode,
        blockingItems: readiness.decision.blockingItems,
        authorityFingerprint: readiness.decision.authorityFingerprint,
      });
    } catch {
      return buildJsonResponse(
        {
          ok: false,
          error: "COMMERCIAL_ACTION_READINESS_ROUTE_FAILED",
          message: "Erro interno ao validar a prontidao da acao comercial.",
        },
        500,
      );
    }
  };
}

export const POST = createActionReadinessPostHandler();
