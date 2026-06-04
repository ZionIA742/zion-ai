import { NextResponse } from "next/server";
import {
  ContractAccessError,
  resolveAuthorizedExistingContract,
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

export async function POST(
  request: Request,
  context: { params: Promise<{ contractId: string }> }
) {
  try {
    const body = (await request.json().catch(() => null)) as CustomerSignBody | null;
    const { contractId: rawContractId } = await context.params;
    const contractId = String(rawContractId || "").trim();
    const scope = await resolveAuthorizedExistingContract(contractId);
    if (!scope.currentVersion?.id) {
      throw new ContractAccessError(
        404,
        "CONTRACT_VERSION_NOT_FOUND",
        "Versao atual do contrato nao encontrada."
      );
    }
    const userAgent = normalizeOptionalText(request.headers.get("user-agent"));
    const ipAddress = extractClientIp(request.headers);
    const result = await signSalesContractAsCustomer({
      scope: {
        ...scope,
        currentVersion: scope.currentVersion,
      } as CustomerContractAcceptanceScope,
      signerName: normalizeOptionalText(body?.signerName),
      signerPhone: normalizeOptionalText(body?.signerPhone),
      signerEmail: normalizeOptionalText(body?.signerEmail),
      acceptanceText: normalizeOptionalText(body?.acceptanceText),
      userAgent,
      ipAddress,
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
}
