import { NextResponse } from "next/server";
import {
  ContractAccessError,
  resolveExistingContractForAuthorizedStoreScope,
  type ContractAuthorizedStoreScope,
} from "@/lib/server/sales-contracts/contract-auth";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function buildErrorResponse(error: unknown) {
  if (error instanceof ContractAccessError) {
    return buildJsonResponse(
      {
        ok: false,
        error: error.code,
        message: error.message,
      },
      error.status,
    );
  }

  return buildJsonResponse(
    {
      ok: false,
      error: "UNEXPECTED_ERROR",
      message:
        error instanceof Error ? error.message : "Erro inesperado ao carregar contrato.",
    },
    500,
  );
}

type SalesContractDetailGetDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  resolveContract: typeof resolveExistingContractForAuthorizedStoreScope;
};

export function createSalesContractDetailGetHandler(
  deps: Partial<SalesContractDetailGetDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const resolveContract =
    deps.resolveContract ?? resolveExistingContractForAuthorizedStoreScope;

  return async function GET(
    _request: Request,
    context: { params: Promise<{ contractId: string }> },
  ) {
    const access = await resolveAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);

    try {
      const { contractId: rawContractId } = await context.params;
      const contractId = String(rawContractId || "").trim();
      const authorizedScope: ContractAuthorizedStoreScope = {
        organizationId: access.organizationId,
        storeId: access.storeId,
        sessionUserId: access.sessionUserId,
      };
      const scope = await resolveContract(contractId, authorizedScope);

      if (
        scope.organizationId !== access.organizationId ||
        scope.store.id !== access.storeId ||
        scope.store.organization_id !== access.organizationId ||
        scope.contract.organization_id !== access.organizationId ||
        scope.contract.store_id !== access.storeId
      ) {
        throw new ContractAccessError(
          403,
          "CONTRACT_SCOPE_MISMATCH",
          "O contrato retornado esta fora do escopo canonico autorizado.",
        );
      }

      const { data: signatures, error: signaturesError } = await scope.supabase
        .from("sales_contract_signatures")
        .select("*")
        .eq("contract_id", scope.contract.id)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .order("created_at", { ascending: true });

      if (signaturesError) {
        throw new ContractAccessError(
          500,
          "LOAD_CONTRACT_SIGNATURES_FAILED",
          signaturesError.message,
        );
      }

      return buildJsonResponse({
        ok: true,
        contract: scope.contract,
        current_version: scope.currentVersion,
        signatures: signatures || [],
      });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };
}

export const GET = createSalesContractDetailGetHandler();
