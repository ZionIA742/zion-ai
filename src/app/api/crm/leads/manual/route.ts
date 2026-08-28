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
  operationId?: string;
  name?: string | null;
  phone?: string | null;
};

type ManualCommercialLeadRow = {
  operation_id: string;
  lead_id: string;
  customer_id: string;
  customer_store_link_id: string;
  lead_customer_link_id: string;
  commercial_opportunity_id: string;
  stage: string;
  primary_conversation_id: string | null;
  replayed: boolean;
  created_at: string;
};

type CreateManualCommercialLeadDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeOperationId(value: unknown) {
  const operationId = normalizeOptionalText(value);
  if (!operationId || !UUID_PATTERN.test(operationId)) {
    return null;
  }
  return operationId.toLowerCase();
}

function mapManualCommercialLeadRpcError(message: string) {
  if (message === "manual commercial lead creation by user is not authorized") {
    return {
      status: 403,
      error: "MANUAL_COMMERCIAL_LEAD_FORBIDDEN",
      message: "Voce nao pode criar um lead comercial nesta loja.",
    };
  }

  if (message === "manual commercial lead creation requires name or phone") {
    return {
      status: 400,
      error: "MANUAL_COMMERCIAL_LEAD_MISSING_IDENTITY",
      message: "Informe pelo menos o nome ou o telefone do lead.",
    };
  }

  if (message === "manual commercial lead store scope not found") {
    return {
      status: 409,
      error: "MANUAL_COMMERCIAL_LEAD_STORE_SCOPE_OUTDATED",
      message: "A loja selecionada mudou. Recarregue o CRM e tente novamente.",
    };
  }

  if (message === "manual commercial lead replay payload mismatch") {
    return {
      status: 409,
      error: "MANUAL_COMMERCIAL_LEAD_OPERATION_CONFLICT",
      message:
        "Esta tentativa de criacao ja foi usada com outros dados. Reabra o formulario e tente novamente.",
    };
  }

  if (message === "manual commercial lead deterministic identity conflict") {
    return {
      status: 409,
      error: "MANUAL_COMMERCIAL_LEAD_IDENTITY_CONFLICT",
      message:
        "Nao foi possivel confirmar a identidade desta operacao com seguranca. Reabra o formulario e tente novamente.",
    };
  }

  return {
    status: 409,
    error: "CREATE_MANUAL_COMMERCIAL_LEAD_FAILED",
    message: "Nao foi possivel criar o lead comercial agora.",
  };
}

export function createManualCommercialLeadPostHandler(
  deps: Partial<CreateManualCommercialLeadDeps> = {},
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

      let body: RequestBody;
      try {
        body = (await request.json()) as RequestBody;
      } catch {
        return buildJsonResponse(
          {
            ok: false,
            error: "INVALID_REQUEST_BODY",
            message: "Nao foi possivel ler os dados do novo lead.",
          },
          400,
        );
      }

      const operationId = normalizeOperationId(body.operationId);
      if (!operationId) {
        return buildJsonResponse(
          {
            ok: false,
            error: "INVALID_OPERATION_ID",
            message: "Reabra o formulario de novo lead e tente novamente.",
          },
          400,
        );
      }

      const name = normalizeOptionalText(body.name);
      const phone = normalizeOptionalText(body.phone);

      if (!name && !phone) {
        return buildJsonResponse(
          {
            ok: false,
            error: "MANUAL_COMMERCIAL_LEAD_MISSING_IDENTITY",
            message: "Informe pelo menos o nome ou o telefone do lead.",
          },
          400,
        );
      }

      const { data, error } = await access.supabase.rpc(
        "create_manual_commercial_lead_by_user",
        {
          p_request_organization_id: access.organizationId,
          p_store_id: access.storeId,
          p_operation_id: operationId,
          p_name: name,
          p_phone: phone,
        },
      );

      if (error) {
        const mapped = mapManualCommercialLeadRpcError(
          String(error.message || "").trim(),
        );

        return buildJsonResponse(
          {
            ok: false,
            error: mapped.error,
            message: mapped.message,
          },
          mapped.status,
        );
      }

      const resultRow = Array.isArray(data)
        ? (data[0] as ManualCommercialLeadRow | undefined)
        : null;

      if (!resultRow) {
        return buildJsonResponse(
          {
            ok: false,
            error: "CREATE_MANUAL_COMMERCIAL_LEAD_EMPTY_RESULT",
            message: "Nao foi possivel confirmar a criacao do lead comercial.",
          },
          500,
        );
      }

      return buildJsonResponse({
        ok: true,
        operationId: resultRow.operation_id,
        leadId: resultRow.lead_id,
        customerId: resultRow.customer_id,
        customerStoreLinkId: resultRow.customer_store_link_id,
        leadCustomerLinkId: resultRow.lead_customer_link_id,
        commercialOpportunityId: resultRow.commercial_opportunity_id,
        stage: resultRow.stage,
        primaryConversationId: resultRow.primary_conversation_id,
        replayed: resultRow.replayed === true,
        createdAt: resultRow.created_at,
      });
    } catch {
      return buildJsonResponse(
        {
          ok: false,
          error: "CREATE_MANUAL_COMMERCIAL_LEAD_ROUTE_FAILED",
          message: "Erro interno ao criar o lead comercial.",
        },
        500,
      );
    }
  };
}

export const POST = createManualCommercialLeadPostHandler();
