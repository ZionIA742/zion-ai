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

const SIGNED_URL_EXPIRATION_SECONDS = 60 * 15;

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function buildErrorResponse(error: unknown) {
  if (error instanceof ContractAccessError) {
    return buildJsonResponse(
      { ok: false, error: error.code, message: error.message },
      error.status,
    );
  }

  return buildJsonResponse(
    {
      ok: false,
      error: "SIGNED_CONTRACT_PDF_URL_FAILED",
      message:
        error instanceof Error ? error.message : "Erro interno ao abrir o PDF do contrato.",
    },
    500,
  );
}

type SignedContractPdfUrlGetDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  resolveContract: typeof resolveExistingContractForAuthorizedStoreScope;
};

export function createSignedContractPdfUrlGetHandler(
  deps: Partial<SignedContractPdfUrlGetDeps> = {},
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

      if (!contractId) {
        return buildJsonResponse(
          {
            ok: false,
            error: "INVALID_CONTRACT_ID",
            message: "Contract ID nao informado.",
          },
          400,
        );
      }

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

      const currentVersionId = String(scope.contract.current_version_id || "").trim();
      if (!currentVersionId) {
        return buildJsonResponse(
          {
            ok: false,
            error: "CONTRACT_WITHOUT_CURRENT_VERSION",
            message: "O contrato ainda nao possui PDF gerado na versao atual.",
          },
          404,
        );
      }

      const version = scope.currentVersion;
      if (!version) {
        return buildJsonResponse(
          {
            ok: false,
            error: "CONTRACT_VERSION_NOT_FOUND",
            message: "A versao atual do contrato nao foi encontrada.",
          },
          404,
        );
      }

      if (
        version.id !== currentVersionId ||
        version.contract_id !== scope.contract.id ||
        version.organization_id !== access.organizationId ||
        version.store_id !== access.storeId
      ) {
        throw new ContractAccessError(
          403,
          "CONTRACT_SCOPE_MISMATCH",
          "A versao atual do contrato esta fora do escopo canonico autorizado.",
        );
      }

      const storageBucket = String(version.storage_bucket || "").trim();
      const storagePath = String(version.storage_path || "").trim();
      if (!storageBucket || !storagePath) {
        return buildJsonResponse(
          {
            ok: false,
            error: "CONTRACT_PDF_STORAGE_MISSING",
            message: "A versao atual do contrato nao possui arquivo PDF valido para abrir.",
          },
          422,
        );
      }

      const { data: signedData, error: signedError } = await scope.supabase.storage
        .from(storageBucket)
        .createSignedUrl(storagePath, SIGNED_URL_EXPIRATION_SECONDS);

      if (signedError || !signedData?.signedUrl) {
        return buildJsonResponse(
          {
            ok: false,
            error: "SIGNED_URL_GENERATION_FAILED",
            message:
              signedError?.message || "Nao foi possivel gerar o link temporario deste PDF.",
          },
          500,
        );
      }

      return buildJsonResponse({
        ok: true,
        signedUrl: signedData.signedUrl,
        originalFilename: version.original_filename || null,
        mimeType: version.mime_type || "application/pdf",
        expiresIn: SIGNED_URL_EXPIRATION_SECONDS,
      });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };
}

export const GET = createSignedContractPdfUrlGetHandler();
