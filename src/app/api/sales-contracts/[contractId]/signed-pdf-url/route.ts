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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function readExpectedContractVersionId(request: Request) {
  const raw = new URL(request.url).searchParams.get("expectedContractVersionId");
  if (raw == null || !raw.trim()) return null;
  const expected = raw.trim().toLowerCase();
  if (expected.length > 100) {
    throw new ContractAccessError(
      400,
      "CONTRACT_VERSION_EXPECTATION_INVALID",
      "A versao esperada do contrato e invalida.",
    );
  }
  return expected;
}

function buildVersionIdentity(version: Record<string, unknown>, contractId: string) {
  const snapshot = version.contract_snapshot;
  const provenance = isRecord(snapshot) && isRecord(snapshot.text_provenance)
    ? snapshot.text_provenance
    : null;
  const versionPdfSha256 = version.pdf_sha256;
  const provenanceRevision = provenance?.revision;

  if (provenance?.mode !== "saved_text_draft") {
    return {
      contractVersionId: String(version.id || ""),
      pdfSha256: isSha256(versionPdfSha256) ? versionPdfSha256 : null,
      isTextDraftVersion: false,
      textProvenance: null,
    };
  }

  if (
    !isSha256(versionPdfSha256) ||
    !isSha256(provenance.pdf_sha256) ||
    provenance.pdf_sha256 !== versionPdfSha256 ||
    !String(provenance.draft_id || "").trim() ||
    !String(provenance.template_version_id || "").trim() ||
    typeof provenanceRevision !== "number" ||
    !Number.isSafeInteger(provenanceRevision) ||
    provenanceRevision < 1 ||
    !isSha256(provenance.text_sha256) ||
    provenance.organization_id !== version.organization_id ||
    provenance.store_id !== version.store_id ||
    !isRecord(snapshot) ||
    !isRecord(snapshot.identity) ||
    snapshot.identity.contract_id !== contractId
  ) {
    throw new ContractAccessError(
      409,
      "CONTRACT_TEXT_PROVENANCE_INVALID",
      "A proveniencia textual da versao contratual e inconsistente.",
    );
  }

  return {
    contractVersionId: String(version.id || ""),
    pdfSha256: versionPdfSha256,
    isTextDraftVersion: true,
    textProvenance: {
      draftId: String(provenance.draft_id),
      revision: provenanceRevision,
      textSha256: String(provenance.text_sha256),
      templateVersionId: String(provenance.template_version_id),
    },
  };
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
    request: Request,
    context: { params: Promise<{ contractId: string }> },
  ) {
    const access = await resolveAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);

    try {
      const { contractId: rawContractId } = await context.params;
      const contractId = String(rawContractId || "").trim();
      const expectedContractVersionId = readExpectedContractVersionId(request);

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

      if (
        expectedContractVersionId &&
        version.id.toLowerCase() !== expectedContractVersionId
      ) {
        throw new ContractAccessError(
          409,
          "CONTRACT_VERSION_STALE",
          "A versao esperada do contrato nao e mais a versao atual.",
        );
      }

      const versionIdentity = buildVersionIdentity(
        version as unknown as Record<string, unknown>,
        scope.contract.id,
      );

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
        ...versionIdentity,
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
