import { NextResponse } from "next/server";
import {
  ContractAccessError,
  resolveAuthorizedExistingContract,
} from "@/lib/server/sales-contracts/contract-auth";
import { registerContractBusinessEvent } from "@/lib/server/sales-contracts/contract-events";
import {
  extractClientIp,
  loadExistingContractSignature,
} from "@/lib/server/sales-contracts/contract-signatures";
import type {
  SalesContractSignature,
  SalesContractVersion,
} from "@/lib/server/sales-contracts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CUSTOMER_SIGN_EVENT_TYPE = "contrato_assinado_cliente";
const BLOCKED_CONTRACT_STATUSES = new Set(["completed", "cancelled", "expired", "failed"]);
const DEFAULT_ACCEPTANCE_TEXT = "Li e aceito os termos deste contrato.";

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

    const normalizedContractStatus = String(scope.contract.status || "").trim().toLowerCase();

    if (BLOCKED_CONTRACT_STATUSES.has(normalizedContractStatus)) {
      throw new ContractAccessError(
        409,
        "CONTRACT_STATUS_NOT_SIGNABLE",
        "Este contrato nao pode receber aceite do cliente no status atual."
      );
    }

    if (normalizedContractStatus !== "sent_to_customer") {
      throw new ContractAccessError(
        409,
        "CONTRACT_NOT_SENT_TO_CUSTOMER",
        "O cliente so pode aceitar o contrato depois que ele estiver enviado."
      );
    }

    const currentVersionId = String(scope.contract.current_version_id || "").trim();
    if (!currentVersionId) {
      throw new ContractAccessError(
        400,
        "CONTRACT_VERSION_REQUIRED",
        "Este contrato ainda nao possui current_version_id."
      );
    }

    if (!scope.currentVersion?.id) {
      throw new ContractAccessError(
        404,
        "CONTRACT_VERSION_NOT_FOUND",
        "Versao atual do contrato nao encontrada."
      );
    }

    const existingSignature = await loadExistingContractSignature({
      supabase: scope.supabase,
      contract: scope.contract,
      versionId: currentVersionId,
      signerType: "customer",
    });

    if (existingSignature?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "CUSTOMER_SIGNATURE_ALREADY_EXISTS",
          message: "Ja existe uma assinatura/aceite do cliente para a versao atual deste contrato.",
          signature: existingSignature,
        },
        { status: 409 }
      );
    }

    const signedAt = new Date().toISOString();
    const userAgent = normalizeOptionalText(request.headers.get("user-agent"));
    const ipAddress = extractClientIp(request.headers);
    const signerName =
      normalizeOptionalText(body?.signerName) ||
      normalizeOptionalText(scope.contract.customer_name) ||
      normalizeOptionalText(scope.lead?.name);
    const signerPhone =
      normalizeOptionalText(body?.signerPhone) ||
      normalizeOptionalText(scope.contract.customer_phone) ||
      normalizeOptionalText(scope.lead?.phone);
    const signerEmail = normalizeOptionalText(body?.signerEmail);
    const acceptanceText =
      normalizeOptionalText(body?.acceptanceText) || DEFAULT_ACCEPTANCE_TEXT;

    const { data: signature, error: signatureError } = await scope.supabase
      .from("sales_contract_signatures")
      .insert({
        contract_id: scope.contract.id,
        contract_version_id: scope.currentVersion.id,
        organization_id: scope.organizationId,
        store_id: scope.store.id,
        signer_type: "customer",
        signer_name: signerName,
        signer_phone: signerPhone,
        signer_email: signerEmail,
        status: "signed",
        signed_at: signedAt,
        ip_address: ipAddress,
        user_agent: userAgent,
        acceptance_text: acceptanceText,
        metadata: {
          source: "api_sales_contracts_customer_sign",
          ip_capture_available: Boolean(ipAddress),
        },
      })
      .select("*")
      .maybeSingle();

    if (signatureError || !signature?.id) {
      throw new Error(signatureError?.message || "Falha ao criar sales_contract_signatures.");
    }

    const { data: updatedContract, error: contractUpdateError } = await scope.supabase
      .from("sales_contracts")
      .update({
        status: "customer_signed",
        customer_signed_at: signedAt,
      })
      .eq("id", scope.contract.id)
      .select("*")
      .maybeSingle();

    if (contractUpdateError || !updatedContract?.id) {
      throw new Error(contractUpdateError?.message || "Falha ao atualizar sales_contracts.");
    }

    await registerContractBusinessEvent({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      eventKey: CUSTOMER_SIGN_EVENT_TYPE,
      actorType: "customer",
      leadId: scope.lead?.id || scope.contract.lead_id || null,
      conversationId: scope.conversation?.id || scope.contract.conversation_id || null,
      actorUserId: null,
      eventPayload: {
        contract_id: updatedContract.id,
        contract_number: updatedContract.contract_number,
        contract_version_id: scope.currentVersion.id,
        signature_id: signature.id,
        signer_name: signerName,
        signer_phone: signerPhone,
        signer_email: signerEmail,
        signed_at: signedAt,
        ip_address: ipAddress,
        user_agent: userAgent,
        status: updatedContract.status,
      },
    });

    return NextResponse.json({
      ok: true,
      contract: updatedContract,
      current_version: scope.currentVersion as SalesContractVersion,
      signature: signature as SalesContractSignature,
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
}
