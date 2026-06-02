import { NextResponse } from "next/server";
import {
  ContractAccessError,
  resolveAuthorizedExistingContract,
} from "@/lib/server/sales-contracts/contract-auth";
import { registerContractBusinessEvent } from "@/lib/server/sales-contracts/contract-events";
import type { SalesContractVersion } from "@/lib/server/sales-contracts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPROVE_EVENT_TYPE = "contrato_aprovado";
const BLOCKED_CONTRACT_STATUSES = new Set(["completed", "cancelled", "expired", "failed"]);
const APPROVABLE_CONTRACT_STATUSES = new Set(["draft", "pending_review", "approved"]);

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
        error instanceof Error ? error.message : "Erro inesperado ao aprovar contrato.",
    },
    { status: 500 }
  );
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ contractId: string }> }
) {
  try {
    const { contractId: rawContractId } = await context.params;
    const contractId = String(rawContractId || "").trim();
    const scope = await resolveAuthorizedExistingContract(contractId);

    const normalizedContractStatus = String(scope.contract.status || "").trim().toLowerCase();
    if (BLOCKED_CONTRACT_STATUSES.has(normalizedContractStatus)) {
      throw new ContractAccessError(
        409,
        "CONTRACT_STATUS_NOT_APPROVABLE",
        "Este contrato nao pode ser aprovado no status atual."
      );
    }

    if (!APPROVABLE_CONTRACT_STATUSES.has(normalizedContractStatus)) {
      throw new ContractAccessError(
        409,
        "CONTRACT_STATUS_NOT_APPROVABLE",
        "Apenas contratos draft ou pending_review podem ser aprovados nesta etapa."
      );
    }

    const currentVersionId = String(scope.contract.current_version_id || "").trim();
    if (!currentVersionId) {
      throw new ContractAccessError(
        400,
        "CONTRACT_VERSION_REQUIRED",
        "Este contrato ainda nao possui current_version_id para aprovacao."
      );
    }

    if (!scope.currentVersion?.id) {
      throw new ContractAccessError(
        404,
        "CONTRACT_VERSION_NOT_FOUND",
        "Versao atual do contrato nao encontrada."
      );
    }

    const storageBucket = String(scope.currentVersion.storage_bucket || "").trim();
    const storagePath = String(scope.currentVersion.storage_path || "").trim();
    if (!storageBucket || !storagePath) {
      throw new ContractAccessError(
        400,
        "CONTRACT_PDF_STORAGE_MISSING",
        "A versao atual do contrato nao possui storage_bucket/storage_path validos."
      );
    }

    const approvedAt = new Date().toISOString();

    const { data: updatedContract, error: contractUpdateError } = await scope.supabase
      .from("sales_contracts")
      .update({
        status: "approved",
        approved_at: approvedAt,
        approved_by: scope.userId,
      })
      .eq("id", scope.contract.id)
      .select("*")
      .maybeSingle();

    if (contractUpdateError || !updatedContract?.id) {
      throw new Error(contractUpdateError?.message || "Falha ao atualizar sales_contracts.");
    }

    const { data: updatedVersion, error: versionUpdateError } = await scope.supabase
      .from("sales_contract_versions")
      .update({
        status: "approved",
        approved_at: approvedAt,
      })
      .eq("id", scope.currentVersion.id)
      .select("*")
      .maybeSingle();

    if (versionUpdateError || !updatedVersion?.id) {
      throw new Error(
        versionUpdateError?.message || "Falha ao atualizar sales_contract_versions."
      );
    }

    await registerContractBusinessEvent({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      eventKey: APPROVE_EVENT_TYPE,
      actorType: "human",
      leadId: scope.lead?.id || scope.contract.lead_id || null,
      conversationId: scope.conversation?.id || scope.contract.conversation_id || null,
      actorUserId: scope.userId,
      eventPayload: {
        contract_id: updatedContract.id,
        contract_number: updatedContract.contract_number,
        contract_version_id: updatedVersion.id,
        status: updatedContract.status,
        approved_at: approvedAt,
      },
    });

    return NextResponse.json({
      ok: true,
      contract: updatedContract,
      current_version: updatedVersion as SalesContractVersion,
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
}
