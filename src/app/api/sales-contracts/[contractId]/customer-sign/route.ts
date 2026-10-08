import { NextResponse } from "next/server";
import {
  ContractAccessError,
  resolveExistingContractForAuthorizedStoreScope,
  type ContractAuthorizedStoreScope,
} from "@/lib/server/sales-contracts/contract-auth";
import {
  extractClientIp,
} from "@/lib/server/sales-contracts/contract-signatures";
import {
  signSalesContractAsCustomer,
  type CustomerContractAcceptanceScope,
} from "@/lib/server/sales-contracts/customer-contract-acceptance";
import type {
  SalesContractSignature,
  SalesContractVersion,
} from "@/lib/server/sales-contracts/types";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CustomerSignBody = {
  signerName?: string | null;
  signerPhone?: string | null;
  signerEmail?: string | null;
  acceptanceText?: string | null;
};

function buildErrorResponse(error: unknown) {
  if (error instanceof ContractAccessError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        message: error.message,
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "UNEXPECTED_ERROR",
      message:
        error instanceof Error ? error.message : "Erro inesperado ao registrar assinatura do cliente.",
    },
    { status: 500 }
  );
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

type CustomerSignPostDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  resolveContract: typeof resolveExistingContractForAuthorizedStoreScope;
  signAsCustomer: typeof signSalesContractAsCustomer;
};

export function createSalesContractCustomerSignPostHandler(
  deps: Partial<CustomerSignPostDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const resolveContract =
    deps.resolveContract ?? resolveExistingContractForAuthorizedStoreScope;
  const signAsCustomer = deps.signAsCustomer ?? signSalesContractAsCustomer;

  return async function POST(
    request: Request,
    context: { params: Promise<{ contractId: string }> },
  ) {
    const access = await resolveAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);

    try {
      const body = (await request.json().catch(() => null)) as CustomerSignBody | null;
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

      const currentVersion = scope.currentVersion;
      if (!currentVersion?.id) {
        throw new ContractAccessError(
          404,
          "CONTRACT_VERSION_NOT_FOUND",
          "Versao atual do contrato nao encontrada.",
        );
      }

      const currentVersionId = String(scope.contract.current_version_id || "").trim();
      if (
        (currentVersionId && currentVersion.id !== currentVersionId) ||
        currentVersion.contract_id !== scope.contract.id ||
        currentVersion.organization_id !== access.organizationId ||
        currentVersion.store_id !== access.storeId
      ) {
        throw new ContractAccessError(
          403,
          "CONTRACT_SCOPE_MISMATCH",
          "A versao atual do contrato esta fora do escopo canonico autorizado.",
        );
      }

      const customerAcceptanceScope: CustomerContractAcceptanceScope = {
        supabase: scope.supabase,
        organizationId: access.organizationId,
        store: { id: access.storeId },
        contract: scope.contract,
        currentVersion,
        lead: scope.lead
          ? { id: scope.lead.id, name: scope.lead.name, phone: scope.lead.phone }
          : null,
        conversation: scope.conversation ? { id: scope.conversation.id } : null,
      };
      const result = await signAsCustomer({
        scope: customerAcceptanceScope,
        signerName: normalizeOptionalText(body?.signerName),
        signerPhone: normalizeOptionalText(body?.signerPhone),
        signerEmail: normalizeOptionalText(body?.signerEmail),
        acceptanceText: normalizeOptionalText(body?.acceptanceText),
        userAgent: normalizeOptionalText(request.headers.get("user-agent")),
        ipAddress: extractClientIp(request.headers),
        metadataSource: "api_sales_contracts_customer_sign",
      });

      return NextResponse.json({
        ok: true,
        contract: result.contract,
        current_version: result.currentVersion as SalesContractVersion,
        signature: result.signature as SalesContractSignature,
      });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };
}

export const POST = createSalesContractCustomerSignPostHandler();
