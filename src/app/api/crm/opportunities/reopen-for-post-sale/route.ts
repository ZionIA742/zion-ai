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

type ReopenOpportunityRow = {
  commercial_opportunity_id: string;
  stage: string;
  lifecycle_cycle: number;
  lifecycle_event_id: string;
  event_type: string;
  reason_code: string;
  stage_changed_at: string;
  updated_at: string;
};

type ReopenForPostSaleDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
};

function normalizeOpportunityStage(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase() || null;
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

  return `crm_reopen_post_sale_opportunity:${args.commercialOpportunityId}:${lifecycleCycle}:${normalizedStage}`;
}

export function createReopenForPostSalePostHandler(
  deps: Partial<ReopenForPostSaleDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;

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
            message: "Selecione a oportunidade comercial antes de reabrir.",
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

      if (expectedStage === null || expectedLifecycleCycle === null) {
        return buildJsonResponse(
          {
            ok: false,
            error: "MISSING_OPERATION_SNAPSHOT",
            message: "Recarregue a oportunidade antes de reabrir.",
          },
          400,
        );
      }

      const normalizedActualStage = normalizeOpportunityStage(opportunity.stage);
      const normalizedExpectedStage = normalizeOpportunityStage(expectedStage);
      const idempotencyKey = buildIdempotencyKey({
        commercialOpportunityId: opportunity.id,
        expectedStage,
        expectedLifecycleCycle,
      });

      if (
        normalizedActualStage !== "concluido_sem_mais_acoes" &&
        !(
          normalizedActualStage === "pos_venda" &&
          normalizedExpectedStage === "concluido_sem_mais_acoes"
        )
      ) {
        return buildJsonResponse(
          {
            ok: false,
            error: "COMMERCIAL_OPPORTUNITY_POST_SALE_REOPEN_NOT_AVAILABLE",
            message:
              "A oportunidade selecionada nao pode ser reaberta para Pos-venda neste estado.",
          },
          409,
        );
      }

      const evidenceSummary = `Reabertura manual confirmada para a opportunity ${opportunity.id} no CRM.`;
      const { data, error } = await access.supabase.rpc(
        "reopen_commercial_opportunity_for_post_sale_by_user",
        {
          p_request_organization_id: access.organizationId,
          p_store_id: access.storeId,
          p_commercial_opportunity_id: opportunity.id,
          p_idempotency_key: idempotencyKey,
          p_reason_details: null,
          p_evidence_type: "crm_manual_action",
          p_evidence_message_id: null,
          p_evidence_summary: evidenceSummary,
          p_source: "manual_post_sale_reopen",
        },
      );

      if (error) {
        const rpcMessage = String(error.message || "").trim();

        if (rpcMessage === "ZION_IDEMPOTENT_STAGE_TRANSITION_OBSOLETE") {
          return buildJsonResponse(
            {
              ok: false,
              error: "POST_SALE_REOPEN_STATE_OUTDATED",
              message:
                "A oportunidade mudou desde a confirmacao desta reabertura. Recarregue a tela e tente novamente.",
            },
            409,
          );
        }

        if (
          rpcMessage === "commercial opportunity post-sale reopen by user is not authorized" ||
          rpcMessage === "commercial opportunity scope mismatch"
        ) {
          return buildJsonResponse(
            {
              ok: false,
              error: "COMMERCIAL_OPPORTUNITY_FORBIDDEN",
              message: "Voce nao pode reabrir esta oportunidade comercial.",
            },
            403,
          );
        }

        return buildJsonResponse(
          {
            ok: false,
            error: "REOPEN_POST_SALE_FAILED",
            message: "Nao foi possivel reabrir a oportunidade comercial agora.",
          },
          409,
        );
      }

      const resultRow = Array.isArray(data) ? (data[0] as ReopenOpportunityRow | undefined) : null;

      if (!resultRow) {
        return buildJsonResponse(
          {
            ok: false,
            error: "REOPEN_POST_SALE_EMPTY_RESULT",
            message: "Nao foi possivel confirmar a reabertura da oportunidade comercial.",
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
          error: "REOPEN_POST_SALE_ROUTE_FAILED",
          message: "Erro interno ao reabrir a oportunidade comercial.",
        },
        500,
      );
    }
  };
}

export const POST = createReopenForPostSalePostHandler();
