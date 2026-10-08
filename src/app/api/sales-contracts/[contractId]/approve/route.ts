import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
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
const APPROVABLE_VERSION_STATUSES = new Set(["generated", "pending_review", "approved"]);

type ContractApprovalAuthorityResult = {
  outcome: "approved" | "already_applied" | "reconciled_partial_state";
  replayed: boolean;
  reconciled: boolean;
  contract_id: string;
  contract_version_id: string;
  contract_status: "approved";
  version_status: "approved";
  approved_at: string;
  approved_by: string;
};

type ApproveContractRouteDeps = {
  resolveContractScope?: typeof resolveAuthorizedExistingContract;
  approveContract?: (args: {
    supabase: SupabaseClient;
    organizationId: string;
    storeId: string;
    contractId: string;
    expectedContractVersionId: string;
    actorUserId: string;
  }) => Promise<ContractApprovalAuthorityResult>;
  registerContractBusinessEvent?: typeof registerContractBusinessEvent;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildErrorResponse(error: unknown) {
  if (error instanceof ContractAccessError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        message: error.message,
      },
      { status: error.status },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "UNEXPECTED_ERROR",
      message:
        error instanceof Error ? error.message : "Erro inesperado ao aprovar contrato.",
    },
    { status: 500 },
  );
}

function mapApprovalAuthorityError(error: { message?: string | null } | null) {
  const message = String(error?.message || "").trim();
  if (message.includes("P9_CONTRACT_APPROVAL_CURRENT_VERSION_MISMATCH")) {
    return new ContractAccessError(
      409,
      "CONTRACT_VERSION_STALE",
      "Existe uma versao mais recente do contrato. Revise a versao atual antes de aprovar.",
    );
  }
  if (message.includes("P9_CONTRACT_APPROVAL_STATUS_NOT_APPROVABLE")) {
    return new ContractAccessError(
      409,
      "CONTRACT_STATUS_NOT_APPROVABLE",
      "O contrato nao esta em um estado valido para aprovacao.",
    );
  }
  if (message.includes("P9_CONTRACT_APPROVAL_VERSION_STATUS_NOT_APPROVABLE")) {
    return new ContractAccessError(
      409,
      "CONTRACT_VERSION_STATUS_NOT_APPROVABLE",
      "A versao atual nao esta em um estado valido para aprovacao.",
    );
  }
  if (message.includes("P9_CONTRACT_APPROVAL_LINEAGE")) {
    return new ContractAccessError(
      409,
      "CONTRACT_LINEAGE_NOT_APPROVABLE",
      "A lineage comercial atual do contrato nao permite aprovacao.",
    );
  }
  return null;
}

async function approveContractByUserAtomic(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  contractId: string;
  expectedContractVersionId: string;
  actorUserId: string;
}) {
  const { data, error } = await args.supabase.rpc(
    "approve_sales_contract_by_user_atomic",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_contract_id: args.contractId,
      p_expected_contract_version_id: args.expectedContractVersionId,
      p_actor_user_id: args.actorUserId,
    },
  );

  if (error) {
    const mapped = mapApprovalAuthorityError(error);
    if (mapped) throw mapped;
    throw new Error(`Falha na authority atomica de aprovacao: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (
    !isRecord(row) ||
    !["approved", "already_applied", "reconciled_partial_state"].includes(String(row.outcome)) ||
    typeof row.replayed !== "boolean" ||
    typeof row.reconciled !== "boolean" ||
    String(row.contract_id || "") !== args.contractId ||
    !String(row.contract_version_id || "") ||
    String(row.contract_status || "") !== "approved" ||
    String(row.version_status || "") !== "approved" ||
    !String(row.approved_at || "").trim() ||
    !String(row.approved_by || "").trim()
  ) {
    throw new Error("A authority atomica de aprovacao retornou dados incompletos ou incoerentes.");
  }

  const result = row as ContractApprovalAuthorityResult;
  if (
    (result.outcome === "approved" && (result.replayed || result.reconciled)) ||
    (result.outcome === "already_applied" && (!result.replayed || result.reconciled)) ||
    (result.outcome === "reconciled_partial_state" && (!result.replayed || !result.reconciled))
  ) {
    throw new Error("A authority atomica de aprovacao retornou flags incoerentes.");
  }

  return result;
}

export function createApproveContractPostHandler(deps: ApproveContractRouteDeps = {}) {
  const resolveContractScope = deps.resolveContractScope ?? resolveAuthorizedExistingContract;
  const approveContract = deps.approveContract ?? approveContractByUserAtomic;
  const recordBusinessEvent =
    deps.registerContractBusinessEvent ?? registerContractBusinessEvent;

  return async function POST(
    _request: Request,
    context: { params: Promise<{ contractId: string }> },
  ) {
    try {
      const { contractId: rawContractId } = await context.params;
      const contractId = String(rawContractId || "").trim();
      const scope = await resolveContractScope(contractId);
      const normalizedContractStatus = String(scope.contract.status || "").trim().toLowerCase();

      if (BLOCKED_CONTRACT_STATUSES.has(normalizedContractStatus)) {
        throw new ContractAccessError(
          409,
          "CONTRACT_STATUS_NOT_APPROVABLE",
          "Este contrato nao pode ser aprovado no status atual.",
        );
      }

      if (!APPROVABLE_CONTRACT_STATUSES.has(normalizedContractStatus)) {
        throw new ContractAccessError(
          409,
          "CONTRACT_STATUS_NOT_APPROVABLE",
          "Apenas contratos draft ou pending_review podem ser aprovados nesta etapa.",
        );
      }

      const currentVersionId = String(scope.contract.current_version_id || "").trim();
      if (!currentVersionId) {
        throw new ContractAccessError(
          400,
          "CONTRACT_VERSION_REQUIRED",
          "Este contrato ainda nao possui current_version_id para aprovacao.",
        );
      }

      if (!scope.currentVersion?.id) {
        throw new ContractAccessError(
          404,
          "CONTRACT_VERSION_NOT_FOUND",
          "Versao atual do contrato nao encontrada.",
        );
      }

      if (currentVersionId !== scope.currentVersion.id) {
        throw new ContractAccessError(
          409,
          "CONTRACT_VERSION_STALE",
          "Existe uma versao atual diferente da carregada para aprovacao.",
        );
      }

      const currentVersionStatus = String(scope.currentVersion.status || "").trim().toLowerCase();
      if (!APPROVABLE_VERSION_STATUSES.has(currentVersionStatus)) {
        throw new ContractAccessError(
          409,
          "CONTRACT_VERSION_STATUS_NOT_APPROVABLE",
          "A versao atual nao esta em um estado valido para aprovacao.",
        );
      }

      const storageBucket = String(scope.currentVersion.storage_bucket || "").trim();
      const storagePath = String(scope.currentVersion.storage_path || "").trim();
      if (!storageBucket || !storagePath) {
        throw new ContractAccessError(
          400,
          "CONTRACT_PDF_STORAGE_MISSING",
          "A versao atual do contrato nao possui storage_bucket/storage_path validos.",
        );
      }

      const authority = await approveContract({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        contractId: scope.contract.id,
        expectedContractVersionId: scope.currentVersion.id,
        actorUserId: scope.userId,
      });

      const { data: durableContract, error: durableContractError } = await scope.supabase
        .from("sales_contracts")
        .select("*")
        .eq("id", scope.contract.id)
        .eq("organization_id", scope.organizationId)
        .eq("store_id", scope.store.id)
        .maybeSingle();
      if (durableContractError || !durableContract?.id) {
        throw new Error(
          durableContractError?.message || "Falha ao reler o contrato aprovado.",
        );
      }

      const { data: durableVersion, error: durableVersionError } = await scope.supabase
        .from("sales_contract_versions")
        .select("*")
        .eq("id", authority.contract_version_id)
        .eq("contract_id", durableContract.id)
        .eq("organization_id", scope.organizationId)
        .eq("store_id", scope.store.id)
        .maybeSingle();
      if (durableVersionError || !durableVersion?.id) {
        throw new Error(
          durableVersionError?.message || "Falha ao reler a versao aprovada.",
        );
      }

      if (
        durableContract.status !== "approved" ||
        durableContract.current_version_id !== authority.contract_version_id ||
        durableVersion.status !== "approved" ||
        durableVersion.contract_id !== durableContract.id ||
        durableVersion.organization_id !== scope.organizationId ||
        durableVersion.store_id !== scope.store.id ||
        String(durableContract.approved_at || "") !== authority.approved_at ||
        String(durableVersion.approved_at || "") !== authority.approved_at ||
        String(durableContract.approved_by || "") !== authority.approved_by
      ) {
        throw new Error("A leitura duravel da aprovacao retornou estado incoerente.");
      }

      let businessEvent: "recorded" | "failed" | "skipped" = "skipped";
      if (authority.outcome !== "already_applied") {
        try {
          await recordBusinessEvent({
            supabase: scope.supabase,
            organizationId: scope.organizationId,
            storeId: scope.store.id,
            eventKey: APPROVE_EVENT_TYPE,
            actorType: "human",
            leadId: scope.lead?.id || scope.contract.lead_id || null,
            conversationId: scope.conversation?.id || scope.contract.conversation_id || null,
            actorUserId: scope.userId,
            eventPayload: {
              contract_id: durableContract.id,
              contract_number: durableContract.contract_number,
              contract_version_id: durableVersion.id,
              status: durableContract.status,
              approved_at: authority.approved_at,
              approved_by: authority.approved_by,
            },
          });
          businessEvent = "recorded";
        } catch (error) {
          businessEvent = "failed";
          console.warn("[sales-contracts/approve] business event failed after atomic approval", error);
        }
      }

      return NextResponse.json({
        ok: true,
        contract: durableContract,
        current_version: durableVersion as SalesContractVersion,
        outcome: authority.outcome,
        replayed: authority.replayed,
        reconciled: authority.reconciled,
        sideEffects: { businessEvent },
      });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };
}

export const POST = createApproveContractPostHandler();
