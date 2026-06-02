import { NextResponse } from "next/server";
import { ContractAccessError, resolveAuthorizedExistingContract } from "@/lib/server/sales-contracts/contract-auth";

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
      error.status
    );
  }

  return buildJsonResponse(
    {
      ok: false,
      error: "UNEXPECTED_ERROR",
      message:
        error instanceof Error ? error.message : "Erro inesperado ao carregar contrato.",
    },
    500
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ contractId: string }> }
) {
  try {
    const { contractId: rawContractId } = await context.params;
    const contractId = String(rawContractId || "").trim();
    const scope = await resolveAuthorizedExistingContract(contractId);

    const { data: signatures, error: signaturesError } = await scope.supabase
      .from("sales_contract_signatures")
      .select("*")
      .eq("contract_id", scope.contract.id)
      .eq("organization_id", scope.organizationId)
      .eq("store_id", scope.store.id)
      .order("created_at", { ascending: true });

    if (signaturesError) {
      throw new ContractAccessError(
        500,
        "LOAD_CONTRACT_SIGNATURES_FAILED",
        signaturesError.message
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
}
