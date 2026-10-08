import { NextResponse } from "next/server";
import {
  ContractAccessError,
  resolveExistingContractForAuthorizedStoreScope,
  type ContractAuthorizedStoreScope,
} from "@/lib/server/sales-contracts/contract-auth";
import { pushAssistantDocumentReviewMessage } from "@/lib/server/assistant/document-review-messages";
import { registerContractBusinessEvent } from "@/lib/server/sales-contracts/contract-events";
import {
  loadExistingContractSignature,
} from "@/lib/server/sales-contracts/contract-signatures";
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

const STORE_SIGN_EVENT_TYPE = "contrato_assinado_loja";
const CONTRACT_COMPLETED_EVENT_TYPE = "contrato_concluido";
const BLOCKED_CONTRACT_STATUSES = new Set(["completed", "cancelled", "expired", "failed"]);
const DEFAULT_ACCEPTANCE_TEXT =
  "Confirmo a assinatura/validacao deste contrato pela loja.";

type StoreSignBody = {
  signerName?: string | null;
  acceptanceText?: string | null;
};

function buildErrorResponse(error: unknown) {
  if (error instanceof ContractAccessError) {
    return NextResponse.json(
      { ok: false, error: error.code, message: error.message },
      { status: error.status },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "UNEXPECTED_ERROR",
      message:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao registrar assinatura da loja.",
    },
    { status: 500 },
  );
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

type StoreSignPostDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  resolveContract: typeof resolveExistingContractForAuthorizedStoreScope;
  loadExistingSignature: typeof loadExistingContractSignature;
  registerBusinessEvent: typeof registerContractBusinessEvent;
  pushAssistantReviewMessage: typeof pushAssistantDocumentReviewMessage;
};

export function createSalesContractStoreSignPostHandler(
  deps: Partial<StoreSignPostDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const resolveContract =
    deps.resolveContract ?? resolveExistingContractForAuthorizedStoreScope;
  const loadExistingSignature =
    deps.loadExistingSignature ?? loadExistingContractSignature;
  const registerBusinessEvent =
    deps.registerBusinessEvent ?? registerContractBusinessEvent;
  const pushAssistantReviewMessage =
    deps.pushAssistantReviewMessage ?? pushAssistantDocumentReviewMessage;

  return async function POST(
    request: Request,
    context: { params: Promise<{ contractId: string }> },
  ) {
    const access = await resolveAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);

    try {
      const body = (await request.json().catch(() => null)) as StoreSignBody | null;
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

      const normalizedContractStatus = String(scope.contract.status || "").trim().toLowerCase();

      if (BLOCKED_CONTRACT_STATUSES.has(normalizedContractStatus)) {
        throw new ContractAccessError(
          409,
          "CONTRACT_STATUS_NOT_SIGNABLE",
          "Este contrato nao pode receber assinatura da loja no status atual.",
        );
      }

      if (normalizedContractStatus !== "customer_signed") {
        throw new ContractAccessError(
          409,
          "CONTRACT_CUSTOMER_SIGNATURE_REQUIRED",
          "A loja so pode assinar depois que o cliente aceitar o contrato.",
        );
      }

      const currentVersionId = String(scope.contract.current_version_id || "").trim();
      if (!currentVersionId) {
        throw new ContractAccessError(
          400,
          "CONTRACT_VERSION_REQUIRED",
          "Este contrato ainda nao possui current_version_id.",
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

      if (
        currentVersion.id !== currentVersionId ||
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

      const existingSignature = await loadExistingSignature({
        supabase: scope.supabase,
        contract: scope.contract,
        versionId: currentVersionId,
        signerType: "store",
      });

      if (existingSignature?.id) {
        return NextResponse.json(
          {
            ok: false,
            error: "STORE_SIGNATURE_ALREADY_EXISTS",
            message: "Ja existe uma assinatura/confirmacao da loja para a versao atual deste contrato.",
            signature: existingSignature,
          },
          { status: 409 },
        );
      }

      const signedAt = new Date().toISOString();
      const signerName = normalizeOptionalText(body?.signerName) || "Responsavel da loja";
      const acceptanceText =
        normalizeOptionalText(body?.acceptanceText) || DEFAULT_ACCEPTANCE_TEXT;

      const { data: signature, error: signatureError } = await scope.supabase
        .from("sales_contract_signatures")
        .insert({
          contract_id: scope.contract.id,
          contract_version_id: currentVersion.id,
          organization_id: access.organizationId,
          store_id: access.storeId,
          signer_type: "store",
          signer_user_id: access.sessionUserId,
          signer_name: signerName,
          status: "signed",
          signed_at: signedAt,
          acceptance_text: acceptanceText,
          metadata: { source: "api_sales_contracts_store_sign" },
        })
        .select("*")
        .maybeSingle();

      if (signatureError || !signature?.id) {
        throw new Error(signatureError?.message || "Falha ao criar sales_contract_signatures.");
      }

      if (
        signature.contract_id !== scope.contract.id ||
        signature.contract_version_id !== currentVersion.id ||
        signature.organization_id !== access.organizationId ||
        signature.store_id !== access.storeId ||
        signature.signer_type !== "store"
      ) {
        throw new Error("Assinatura retornada possui escopo ou autoridade incoerente.");
      }

      const { data: updatedContract, error: contractUpdateError } = await scope.supabase
        .from("sales_contracts")
        .update({
          status: "completed",
          store_signed_at: signedAt,
          completed_at: signedAt,
          completed_by: access.sessionUserId,
        })
        .eq("id", scope.contract.id)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .select("*")
        .maybeSingle();

      if (contractUpdateError || !updatedContract?.id) {
        throw new Error(contractUpdateError?.message || "Falha ao atualizar sales_contracts.");
      }

      if (
        updatedContract.id !== scope.contract.id ||
        updatedContract.organization_id !== access.organizationId ||
        updatedContract.store_id !== access.storeId
      ) {
        throw new Error("Atualizacao de sales_contracts retornou escopo incoerente.");
      }

      const { data: updatedVersion, error: versionUpdateError } = await scope.supabase
        .from("sales_contract_versions")
        .update({ status: "completed" })
        .eq("id", currentVersion.id)
        .eq("contract_id", scope.contract.id)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .select("*")
        .maybeSingle();

      if (versionUpdateError || !updatedVersion?.id) {
        throw new Error(
          versionUpdateError?.message || "Falha ao atualizar sales_contract_versions.",
        );
      }

      if (
        updatedVersion.id !== currentVersion.id ||
        updatedVersion.contract_id !== scope.contract.id ||
        updatedVersion.organization_id !== access.organizationId ||
        updatedVersion.store_id !== access.storeId
      ) {
        throw new Error("Atualizacao de sales_contract_versions retornou escopo incoerente.");
      }

      await registerBusinessEvent({
        supabase: scope.supabase,
        organizationId: access.organizationId,
        storeId: access.storeId,
        eventKey: STORE_SIGN_EVENT_TYPE,
        actorType: "human",
        leadId: scope.lead?.id || scope.contract.lead_id || null,
        conversationId: scope.conversation?.id || scope.contract.conversation_id || null,
        actorUserId: access.sessionUserId,
        eventPayload: {
          contract_id: updatedContract.id,
          contract_number: updatedContract.contract_number,
          contract_version_id: updatedVersion.id,
          signature_id: signature.id,
          signer_name: signerName,
          signed_at: signedAt,
          status: updatedContract.status,
        },
      });

      await registerBusinessEvent({
        supabase: scope.supabase,
        organizationId: access.organizationId,
        storeId: access.storeId,
        eventKey: CONTRACT_COMPLETED_EVENT_TYPE,
        actorType: "human",
        leadId: scope.lead?.id || scope.contract.lead_id || null,
        conversationId: scope.conversation?.id || scope.contract.conversation_id || null,
        actorUserId: access.sessionUserId,
        eventPayload: {
          contract_id: updatedContract.id,
          contract_number: updatedContract.contract_number,
          contract_version_id: updatedVersion.id,
          completed_at: signedAt,
          status: updatedContract.status,
        },
      });

      try {
        await pushAssistantReviewMessage({
          supabase: scope.supabase,
          organizationId: access.organizationId,
          storeId: access.storeId,
          documentType: "contract",
          documentId: updatedContract.id,
          documentVersionId: updatedVersion.id,
          documentNumber:
            String(updatedContract.contract_number || "").trim() || updatedContract.id,
          documentStatus: "completed",
          relatedQuoteId: updatedContract.quote_id || null,
          relatedContractId: updatedContract.id,
          relatedLeadId: scope.lead?.id || updatedContract.lead_id || null,
          relatedConversationId:
            scope.conversation?.id || updatedContract.conversation_id || null,
          customerName: updatedContract.customer_name || scope.lead?.name || null,
          customerPhone: updatedContract.customer_phone || scope.lead?.phone || null,
          originalFileName: updatedVersion.original_filename || null,
          fileKind: "sales_contract_pdf",
          mimeType: updatedVersion.mime_type || "application/pdf",
          storageBucket: updatedVersion.storage_bucket || null,
          storagePath: updatedVersion.storage_path || null,
          contentOverride: [
            "Contrato concluido.",
            "",
            `Cliente: ${updatedContract.customer_name || scope.lead?.name || "Nao informado"}`,
            `Documento: ${String(updatedContract.contract_number || "").trim() || updatedContract.id}`,
            "Status atual: Concluido",
            "",
            "A loja confirmou o contrato. O processo contratual foi concluido.",
          ].join("\n"),
          assistantPromptOverride:
            "Contrato concluido. Voce ainda pode revisar o documento se precisar.",
          availableActionsOverride: [
            { id: "review", label: "Revisar", kind: "open_document" },
          ],
          sourceOverride: "assistant_contract_status_workflow_v1",
        });
      } catch (assistantMessageError) {
        console.warn(
          "[sales-contracts/store-sign] falha ao criar mensagem de status da assistente:",
          assistantMessageError,
        );
      }

      return NextResponse.json({
        ok: true,
        contract: updatedContract,
        current_version: updatedVersion as SalesContractVersion,
        signature: signature as SalesContractSignature,
      });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };
}

export const POST = createSalesContractStoreSignPostHandler();
