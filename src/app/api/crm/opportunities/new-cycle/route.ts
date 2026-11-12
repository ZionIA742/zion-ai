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
  leadId?: string;
  previousConversationId?: string;
  previousOpportunityId?: string;
  operationId?: string;
  reason?: string;
};

type NewCycleRow = {
  operation_id: string;
  lead_id: string;
  previous_conversation_id: string;
  previous_opportunity_id: string;
  new_conversation_id: string;
  new_opportunity_id: string;
  lifecycle_cycle: number;
  replayed: boolean;
  created_at: string;
};

type NewCycleDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

function mapRpcFailure(message: string) {
  if (message === "P9_NEW_CYCLE_NOT_AUTHORIZED") {
    return { status: 403, error: "P9_NEW_CYCLE_NOT_AUTHORIZED" } as const;
  }
  if (
    message === "P9_NEW_CYCLE_PREVIOUS_CONVERSATION_NOT_TERMINAL" ||
    message === "P9_NEW_CYCLE_ACTIVE_CONVERSATION_EXISTS"
  ) {
    return { status: 409, error: message } as const;
  }
  if (message === "P9_NEW_CYCLE_OPERATION_REPLAY_CONFLICT") {
    return { status: 409, error: message } as const;
  }
  if (
    message === "P9_NEW_CYCLE_LEAD_SCOPE_OR_IDENTITY_INVALID" ||
    message === "P9_NEW_CYCLE_PREVIOUS_OPPORTUNITY_SCOPE_INVALID" ||
    message === "P9_NEW_CYCLE_LEAD_CUSTOMER_IDENTITY_AMBIGUOUS"
  ) {
    return { status: 422, error: message } as const;
  }
  return { status: 500, error: "P9_NEW_CYCLE_FAILED" } as const;
}

export function createNewCommercialCyclePostHandler(
  deps: Partial<NewCycleDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;

  return async function POST(request: Request) {
    try {
      const access = await resolveAccess({ requirement: "active" });
      if (!access.ok) return createStoreApiDeniedResponse(access);

      const body = (await request.json()) as RequestBody;
      const leadId = String(body.leadId || "").trim();
      const previousConversationId = String(body.previousConversationId || "").trim();
      const previousOpportunityId = String(body.previousOpportunityId || "").trim();
      const operationId = String(body.operationId || "").trim();
      const reason = String(body.reason || "").trim();

      if (
        ![leadId, previousConversationId, previousOpportunityId, operationId].every(isUuid) ||
        !reason ||
        reason.length > 500
      ) {
        return buildJsonResponse(
          {
            ok: false,
            error: "P9_NEW_CYCLE_INPUT_INVALID",
            message: "Informe uma autorizacao valida para iniciar o novo ciclo.",
          },
          400,
        );
      }

      const { data, error } = await access.supabase.rpc(
        "start_new_commercial_cycle_by_user",
        {
          p_request_organization_id: access.organizationId,
          p_store_id: access.storeId,
          p_lead_id: leadId,
          p_previous_conversation_id: previousConversationId,
          p_previous_opportunity_id: previousOpportunityId,
          p_operation_id: operationId,
          p_reason: reason,
        },
      );

      if (error) {
        const mapped = mapRpcFailure(String(error.message || "").trim());
        return buildJsonResponse(
          {
            ok: false,
            error: mapped.error,
            message:
              mapped.status === 409
                ? "O novo ciclo nao pode ser iniciado com o estado atual. Recarregue a conversa."
                : "Nao foi possivel iniciar o novo ciclo comercial.",
          },
          mapped.status,
        );
      }

      const row = Array.isArray(data) ? (data[0] as NewCycleRow | undefined) : undefined;
      if (!row?.new_conversation_id || !row.new_opportunity_id) {
        return buildJsonResponse(
          { ok: false, error: "P9_NEW_CYCLE_EMPTY_RESULT", message: "A operacao nao retornou o novo ciclo." },
          500,
        );
      }

      return buildJsonResponse({
        ok: true,
        operationId: row.operation_id,
        leadId: row.lead_id,
        previousConversationId: row.previous_conversation_id,
        previousOpportunityId: row.previous_opportunity_id,
        conversationId: row.new_conversation_id,
        opportunityId: row.new_opportunity_id,
        lifecycleCycle: row.lifecycle_cycle,
        replayed: row.replayed,
        createdAt: row.created_at,
      });
    } catch {
      return buildJsonResponse(
        { ok: false, error: "P9_NEW_CYCLE_REQUEST_FAILED", message: "Nao foi possivel processar a operacao." },
        500,
      );
    }
  };
}

export const POST = createNewCommercialCyclePostHandler();
