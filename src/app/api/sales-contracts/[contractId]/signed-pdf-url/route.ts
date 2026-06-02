import { NextResponse } from "next/server";
import { ContractAccessError, resolveAuthorizedExistingContract } from "@/lib/server/sales-contracts/contract-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_EXPIRATION_SECONDS = 60 * 15;

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ contractId: string }> }
) {
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
        400
      );
    }

    const scope = await resolveAuthorizedExistingContract(contractId);
    const currentVersionId = String(scope.contract.current_version_id || "").trim();

    if (!currentVersionId) {
      return buildJsonResponse(
        {
          ok: false,
          error: "CONTRACT_WITHOUT_CURRENT_VERSION",
          message: "O contrato ainda nao possui PDF gerado na versao atual.",
        },
        404
      );
    }

    const { data: version, error: versionError } = await scope.supabase
      .from("sales_contract_versions")
      .select("*")
      .eq("id", currentVersionId)
      .eq("contract_id", scope.contract.id)
      .eq("organization_id", scope.organizationId)
      .eq("store_id", scope.store.id)
      .maybeSingle();

    if (versionError) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LOAD_CONTRACT_VERSION_FAILED",
          message: versionError.message,
        },
        500
      );
    }

    if (!version) {
      return buildJsonResponse(
        {
          ok: false,
          error: "CONTRACT_VERSION_NOT_FOUND",
          message: "A versao atual do contrato nao foi encontrada.",
        },
        404
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
        422
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
        500
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
    if (error instanceof ContractAccessError) {
      return buildJsonResponse(
        {
          ok: false,
          error: error.code,
          message: error.message,
        },
        error.status
      );
    }

    return buildJsonResponse(
      {
        ok: false,
        error: "SIGNED_CONTRACT_PDF_URL_FAILED",
        message:
          error instanceof Error ? error.message : "Erro interno ao abrir o PDF do contrato.",
      },
      500
    );
  }
}
