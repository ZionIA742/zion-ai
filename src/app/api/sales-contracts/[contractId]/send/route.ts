import { NextResponse } from "next/server";
import {
  ContractAccessError,
  resolveExistingContractForAuthorizedStoreScope,
  type ContractAuthorizedStoreScope,
} from "@/lib/server/sales-contracts/contract-auth";
import { registerContractBusinessEvent } from "@/lib/server/sales-contracts/contract-events";
import {
  buildContractPdfMessageMetadata,
  extractInsertMessageId,
} from "@/lib/server/sales-contracts/contract-messaging";
import type { SalesContractVersion } from "@/lib/server/sales-contracts/types";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEND_EVENT_TYPE = "contrato_enviado";
const DEFAULT_MESSAGE_CONTENT =
  "Enviei o contrato para voce conferir. Qualquer duvida me avisa.";
const BLOCKED_CONTRACT_STATUSES = new Set(["completed", "cancelled", "expired", "failed"]);

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
        error instanceof Error ? error.message : "Erro inesperado ao enviar contrato.",
    },
    { status: 500 },
  );
}

type SalesContractSendPostDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  resolveContract: typeof resolveExistingContractForAuthorizedStoreScope;
  registerBusinessEvent: typeof registerContractBusinessEvent;
};

export function createSalesContractSendPostHandler(
  deps: Partial<SalesContractSendPostDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const resolveContract =
    deps.resolveContract ?? resolveExistingContractForAuthorizedStoreScope;
  const registerBusinessEvent =
    deps.registerBusinessEvent ?? registerContractBusinessEvent;

  return async function POST(
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

      const normalizedContractStatus = String(scope.contract.status || "").trim().toLowerCase();

      if (BLOCKED_CONTRACT_STATUSES.has(normalizedContractStatus)) {
        throw new ContractAccessError(
          409,
          "CONTRACT_STATUS_NOT_SENDABLE",
          "Este contrato nao pode ser enviado no status atual.",
        );
      }

      if (normalizedContractStatus === "sent_to_customer") {
        return NextResponse.json(
          {
            ok: false,
            error: "CONTRACT_ALREADY_SENT",
            message: "Este contrato ja foi enviado ao cliente.",
          },
          { status: 409 },
        );
      }

      if (normalizedContractStatus !== "approved") {
        throw new ContractAccessError(
          409,
          "CONTRACT_REQUIRES_APPROVAL",
          "Este contrato precisa ser aprovado antes de ser enviado ao cliente.",
        );
      }

      const conversationId = String(scope.contract.conversation_id || "").trim();
      if (!conversationId) {
        throw new ContractAccessError(
          400,
          "CONTRACT_CONVERSATION_REQUIRED",
          "Este contrato nao possui conversation_id para envio ao cliente.",
        );
      }

      const currentVersionId = String(scope.contract.current_version_id || "").trim();
      if (!currentVersionId) {
        throw new ContractAccessError(
          400,
          "CONTRACT_VERSION_REQUIRED",
          "Este contrato ainda nao possui uma versao atual de PDF.",
        );
      }

      const currentVersion = scope.currentVersion;
      if (!currentVersion) {
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

      const storageBucket = String(currentVersion.storage_bucket || "").trim();
      const storagePath = String(currentVersion.storage_path || "").trim();
      const originalFilename = String(currentVersion.original_filename || "").trim();
      const mimeType = String(currentVersion.mime_type || "").trim() || "application/pdf";
      const sizeBytes =
        typeof currentVersion.size_bytes === "number" ? currentVersion.size_bytes : 0;

      if (!storageBucket || !storagePath) {
        throw new ContractAccessError(
          400,
          "CONTRACT_FILE_MISSING",
          "A versao atual do contrato nao possui storage_bucket/storage_path validos.",
        );
      }

      if (!originalFilename) {
        throw new ContractAccessError(
          400,
          "CONTRACT_FILENAME_MISSING",
          "A versao atual do contrato nao possui original_filename valido.",
        );
      }

      const metadata = {
        ...buildContractPdfMessageMetadata({
          contractId: scope.contract.id,
          versionId: currentVersion.id,
          contractNumber:
            String(scope.contract.contract_number || "").trim() || scope.contract.id,
          quoteId: scope.contract.quote_id,
          quoteVersionId: scope.contract.quote_version_id,
          storagePath,
          originalFilename,
          sizeBytes,
        }),
        mime_type: mimeType,
        sales_contract_id: scope.contract.id,
        sales_contract_version_id: currentVersion.id,
      };

      const { data: insertData, error: insertError } = await scope.supabase.rpc(
        "insert_message",
        {
          p_conversation_id: conversationId,
          p_sender: "human",
          p_direction: "outgoing",
          p_message_type: "text",
          p_content: DEFAULT_MESSAGE_CONTENT,
          p_external_message_id: null,
          p_media_url: null,
          p_metadata: metadata,
        },
      );

      if (insertError) {
        throw new Error(`Falha ao criar mensagem do contrato: ${insertError.message}`);
      }

      const messageId = extractInsertMessageId(insertData);
      if (!messageId) {
        throw new Error("A mensagem foi criada, mas nao foi possivel identificar o message_id.");
      }

      const sentAt = new Date().toISOString();
      const { data: updatedContract, error: contractUpdateError } = await scope.supabase
        .from("sales_contracts")
        .update({
          status: "sent_to_customer",
          sent_at: sentAt,
          sent_by: access.sessionUserId,
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
        .update({ status: "sent", sent_at: sentAt })
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
        eventKey: SEND_EVENT_TYPE,
        actorType: "human",
        leadId: scope.lead?.id || scope.contract.lead_id || null,
        conversationId: scope.conversation?.id || scope.contract.conversation_id || null,
        actorUserId: access.sessionUserId,
        eventPayload: {
          contract_id: updatedContract.id,
          contract_number: updatedContract.contract_number,
          contract_version_id: updatedVersion.id,
          message_id: messageId,
          status: updatedContract.status,
          sent_at: sentAt,
        },
      });

      return NextResponse.json({
        ok: true,
        contract: updatedContract,
        current_version: updatedVersion as SalesContractVersion,
        messageId,
      });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };
}

export const POST = createSalesContractSendPostHandler();
