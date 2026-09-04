import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  mapCommercialActionReadinessFailure,
  refreshCommercialActionReadiness,
  type RefreshCommercialActionReadinessResult,
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
  organizationId?: string;
  storeId?: string;
  commercialOpportunityId?: string;
  expectedStage?: string | null;
  expectedLifecycleCycle?: number | null;
};

type OpportunityRow = {
  id: string;
  organization_id: string;
  store_id: string;
  stage: string | null;
  lifecycle_cycle: number | null;
};

type ConcludeOpportunityRow = {
  commercial_opportunity_id: string;
  stage: string;
  lifecycle_cycle: number;
  lifecycle_event_id: string;
  event_type: string;
  reason_code: string;
  stage_changed_at: string;
  updated_at: string;
};

function normalizeOpportunityStage(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase() || null;
}

type ConcludeOpportunityDeps = {
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

function buildIdempotencyKey(args: {
  commercialOpportunityId: string;
  expectedStage: string | null;
  expectedLifecycleCycle: number | null;
}) {
  const normalizedStage = String(args.expectedStage || "").trim().toLowerCase() || "unknown";
  const lifecycleCycle = Number.isFinite(args.expectedLifecycleCycle)
    ? Number(args.expectedLifecycleCycle)
    : 0;

  return `crm_conclude_opportunity:${args.commercialOpportunityId}:${lifecycleCycle}:${normalizedStage}`;
}

function buildReadinessGateResponse(
  result: RefreshCommercialActionReadinessResult,
) {
  const mapped = mapCommercialActionReadinessFailure(result);

  if (!result.ok) {
    return buildJsonResponse(
      {
        ok: false,
        error: mapped.error,
        message: "Nao foi possivel validar a prontidao da conclusao comercial agora.",
      },
      mapped.status,
    );
  }

  return buildJsonResponse(
    {
      ok: false,
      error: mapped.error,
      message: "A conclusao comercial ainda nao esta pronta para execucao.",
      actionKey: result.decision.actionKey,
      readinessState: result.decision.readinessState,
      reasonCode: result.decision.reasonCode,
      blockingItems: result.decision.blockingItems,
      authorityFingerprint: result.decision.authorityFingerprint,
    },
    mapped.status,
  );
}

export function createConcludeOpportunityPostHandler(
  deps: Partial<ConcludeOpportunityDeps> = {},
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

      const body = (await request.json()) as RequestBody;
      const commercialOpportunityId = String(body.commercialOpportunityId || "").trim();
      const expectedStage = String(body.expectedStage || "").trim() || null;
      const expectedLifecycleCycle = Number.isFinite(body.expectedLifecycleCycle)
        ? Number(body.expectedLifecycleCycle)
        : null;

      if (!commercialOpportunityId) {
        return buildJsonResponse(
          {
            ok: false,
            error: "MISSING_COMMERCIAL_OPPORTUNITY_ID",
            message: "Selecione a oportunidade comercial antes de concluir.",
          },
          400,
        );
      }

      const { data: opportunity, error: opportunityError } = await access.supabase
        .from("commercial_opportunities")
        .select("id, organization_id, store_id, stage, lifecycle_cycle")
        .eq("id", commercialOpportunityId)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<OpportunityRow>();

      if (opportunityError) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LOAD_OPPORTUNITY_FAILED",
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

      if (normalizeOpportunityStage(opportunity.stage) !== "pos_venda") {
        return buildJsonResponse(
          {
            ok: false,
            error: "COMMERCIAL_OPPORTUNITY_CONCLUSION_NOT_AVAILABLE",
            message: "A conclusao manual so fica disponivel ao final do Pos-venda.",
          },
          409,
        );
      }

      if (expectedStage === null || expectedLifecycleCycle === null) {
        return buildJsonResponse(
          {
            ok: false,
            error: "MISSING_OPERATION_SNAPSHOT",
            message: "Recarregue a oportunidade antes de concluir.",
          },
          400,
        );
      }

      const idempotencyKey = buildIdempotencyKey({
        commercialOpportunityId: opportunity.id,
        expectedStage,
        expectedLifecycleCycle,
      });
      const readiness = await refreshActionReadiness({
        supabase: makeServiceSupabase() as never,
        organizationId: access.organizationId,
        storeId: access.storeId,
        commercialOpportunityId: opportunity.id,
        actionKey: "conclude_opportunity",
      });

      if (!readiness.ok || readiness.decision.readinessState !== "ready") {
        return buildReadinessGateResponse(readiness);
      }

      const evidenceSummary = `Conclusao manual confirmada para a opportunity ${opportunity.id} no CRM.`;
      const { data, error } = await access.supabase.rpc(
        "conclude_commercial_opportunity_by_user",
        {
          p_request_organization_id: access.organizationId,
          p_store_id: access.storeId,
          p_commercial_opportunity_id: opportunity.id,
          p_idempotency_key: idempotencyKey,
          p_reason_details: null,
          p_evidence_type: "crm_manual_action",
          p_evidence_message_id: null,
          p_evidence_summary: evidenceSummary,
          p_source: "manual_conclusion",
        },
      );

      if (error) {
        const rpcMessage = String(error.message || "").trim();

        if (rpcMessage === "ZION_IDEMPOTENT_STAGE_TRANSITION_OBSOLETE") {
          return buildJsonResponse(
            {
              ok: false,
              error: "CONCLUSION_STATE_OUTDATED",
              message:
                "A oportunidade mudou desde a confirmacao desta conclusao. Recarregue a tela e tente novamente.",
            },
            409,
          );
        }

        if (
          rpcMessage === "commercial opportunity conclusion by user is not authorized" ||
          rpcMessage === "commercial opportunity scope mismatch"
        ) {
          return buildJsonResponse(
            {
              ok: false,
              error: "COMMERCIAL_OPPORTUNITY_FORBIDDEN",
              message: "Voce nao pode concluir esta oportunidade comercial.",
            },
            403,
          );
        }

        return buildJsonResponse(
          {
            ok: false,
            error: "CONCLUDE_COMMERCIAL_OPPORTUNITY_FAILED",
            message: "Nao foi possivel concluir a oportunidade comercial agora.",
          },
          409,
        );
      }

      const resultRow = Array.isArray(data) ? (data[0] as ConcludeOpportunityRow | undefined) : null;

      if (!resultRow) {
        return buildJsonResponse(
          {
            ok: false,
            error: "CONCLUDE_COMMERCIAL_OPPORTUNITY_EMPTY_RESULT",
            message: "Nao foi possivel confirmar a conclusao da oportunidade comercial.",
          },
          500,
        );
      }

      return buildJsonResponse({
        ok: true,
        commercialOpportunityId: resultRow.commercial_opportunity_id,
        stage: resultRow.stage,
        lifecycleCycle: resultRow.lifecycle_cycle,
        lifecycleEventId: resultRow.lifecycle_event_id,
        eventType: resultRow.event_type,
        reasonCode: resultRow.reason_code,
        stageChangedAt: resultRow.stage_changed_at,
        updatedAt: resultRow.updated_at,
        idempotencyKey,
      });
    } catch {
      return buildJsonResponse(
        {
          ok: false,
          error: "CONCLUDE_COMMERCIAL_OPPORTUNITY_ROUTE_FAILED",
          message: "Erro interno ao concluir a oportunidade comercial.",
        },
        500,
      );
    }
  };
}

export const POST = createConcludeOpportunityPostHandler();
