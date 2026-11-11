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

      const { data: historicalVersions, error: versionsError } = await scope.supabase
        .from("sales_contract_versions")
        .select("id, version_number, status, approved_at, approved_by, contract_snapshot")
        .eq("contract_id", scope.contract.id)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .order("version_number", { ascending: false });
      if (versionsError) {
        throw new ContractAccessError(500, "LOAD_CONTRACT_VERSIONS_FAILED", versionsError.message);
      }
      const recoverableTextCorrection = (historicalVersions || [])
        .map((version) => {
          const snapshot = version?.contract_snapshot;
          const provenance = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
            ? (snapshot as Record<string, unknown>).text_provenance
            : null;
          const correction = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
            ? (snapshot as Record<string, unknown>).text_correction
            : null;
          if (!provenance || typeof provenance !== "object" || Array.isArray(provenance) ||
              !correction || typeof correction !== "object" || Array.isArray(correction)) return null;
          const p = provenance as Record<string, unknown>;
          const c = correction as Record<string, unknown>;
          const correctedSha = String(c.corrected_text_sha256 || "").trim().toLowerCase();
          const textSha = String(p.text_sha256 || "").trim().toLowerCase();
          const isApproved = Boolean(version.approved_at || version.approved_by) || version.status === "approved" || version.status === "superseded";
          if (version.id === scope.contract.current_version_id || !isApproved ||
              c.kind !== "full_text" || p.text_representation !== "manual_contract_corrected_text_utf8_exact" ||
              !/^[0-9a-f]{64}$/.test(textSha) || correctedSha !== textSha) return null;
          return {
            sourceVersionId: version.id,
            versionNumber: Number(version.version_number),
            correctedTextSha256: textSha,
          };
        })
        .find(Boolean) || null;

      return buildJsonResponse({
        ok: true,
        contract: scope.contract,
        current_version: scope.currentVersion,
        signatures: signatures || [],
        recoverable_text_correction: recoverableTextCorrection,
      });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };
}

export const GET = createSalesContractDetailGetHandler();
