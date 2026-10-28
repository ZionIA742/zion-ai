import { NextResponse } from "next/server";
import {
  ContractAccessError,
  resolveExistingContractForAuthorizedStoreScope,
  type ContractAuthorizedStoreScope,
} from "@/lib/server/sales-contracts/contract-auth";
import {
  buildContractPdfMessageMetadata,
} from "@/lib/server/sales-contracts/contract-messaging";
import {
  buildSalesContractSendIdempotencyKey,
  buildSalesContractSendMessageMetadata,
  materializeSalesContractSendBySystem,
} from "@/lib/server/sales-contracts/contract-send";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MESSAGE_CONTENT =
  "Enviei o contrato para voce conferir. Qualquer duvida me avisa.";
const BLOCKED_CONTRACT_STATUSES = new Set(["completed", "cancelled", "expired", "failed"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isManualContractOrigin(contract: { metadata?: unknown; quote_id?: unknown; quote_version_id?: unknown }) {
  const metadata = contract.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  return (
    record.source === "responsible_text_draft" &&
    record.created_via === "create_sales_contract_manual_by_system" &&
    contract.quote_id == null &&
    contract.quote_version_id == null
  );
}

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

async function readExpectedContractVersionId(request: Request) {
  const raw = await request.text();
  if (!raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ContractAccessError(400, "CONTRACT_VERSION_EXPECTATION_INVALID", "A versao esperada do contrato e invalida.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ContractAccessError(400, "CONTRACT_VERSION_EXPECTATION_INVALID", "A versao esperada do contrato e invalida.");
  }
  const expected = (parsed as Record<string, unknown>).expectedContractVersionId;
  if (
    typeof expected !== "string" ||
    !expected.trim() ||
    expected.trim().length > 100 ||
    !UUID_PATTERN.test(expected.trim())
  ) {
    throw new ContractAccessError(400, "CONTRACT_VERSION_EXPECTATION_INVALID", "A versao esperada do contrato e invalida.");
  }
  return expected.trim().toLowerCase();
}

type SalesContractSendPostDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  resolveContract: typeof resolveExistingContractForAuthorizedStoreScope;
  materializeSend: typeof materializeSalesContractSendBySystem;
};

export function createSalesContractSendPostHandler(
  deps: Partial<SalesContractSendPostDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const resolveContract =
    deps.resolveContract ?? resolveExistingContractForAuthorizedStoreScope;
  const materializeSend = deps.materializeSend ?? materializeSalesContractSendBySystem;

  return async function POST(
    request: Request,
    context: { params: Promise<{ contractId: string }> },
  ) {
    try {
      const access = await resolveAccess({ requirement: "active" });
      if (!access.ok) return createStoreApiDeniedResponse(access);
      const expectedContractVersionId = await readExpectedContractVersionId(request);

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

      if (isManualContractOrigin(scope.contract) && !expectedContractVersionId) {
        throw new ContractAccessError(
          400,
          "CONTRACT_VERSION_EXPECTATION_REQUIRED",
          "O envio manual exige a versao exata do PDF previamente conferido.",
        );
      }

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

      if (String(currentVersion.status || "").trim().toLowerCase() !== "approved") {
        throw new ContractAccessError(
          409,
          "CONTRACT_VERSION_REQUIRES_APPROVAL",
          "A versao atual do contrato precisa ser aprovada antes do envio.",
        );
      }

      if (expectedContractVersionId && expectedContractVersionId !== currentVersionId.toLowerCase()) {
        throw new ContractAccessError(
          409,
          "CONTRACT_VERSION_STALE",
          "A versao preparada para envio nao e mais a versao atual do contrato.",
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

      const baseMetadata = {
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

      const idempotencyKey = buildSalesContractSendIdempotencyKey({
        organizationId: access.organizationId,
        storeId: access.storeId,
        contractId: scope.contract.id,
        contractVersionId: currentVersion.id,
      });
      let materialized: Awaited<ReturnType<typeof materializeSend>>;
      try {
        materialized = await materializeSend({
          supabase: scope.supabase,
          organizationId: access.organizationId,
          storeId: access.storeId,
          contractId: scope.contract.id,
          contractVersionId: currentVersion.id,
          conversationId,
          messageContent: DEFAULT_MESSAGE_CONTENT,
          actorUserId: access.sessionUserId,
          messageMetadata: buildSalesContractSendMessageMetadata({
            organizationId: access.organizationId,
            storeId: access.storeId,
            contractId: scope.contract.id,
            contractVersionId: currentVersion.id,
            outboundIdempotencyKey: idempotencyKey,
            baseMetadata,
            actorUserId: access.sessionUserId,
          }),
        });
      } catch (error) {
        // A conflict returned after the RPC began must not be retried blindly.
        // A read here is diagnostic only; the RPC remains the transaction authority.
        try {
          const latest = await resolveContract(contractId, authorizedScope);
          const latestVersionId = String(latest.contract.current_version_id || "").trim();
          const latestStatus = String(latest.contract.status || "").trim().toLowerCase();
          if (latestVersionId !== currentVersion.id || latestStatus !== "approved") {
            throw new ContractAccessError(
              409,
              "CONTRACT_VERSION_STALE",
              "A versao preparada para envio deixou de ser a versao aprovada do contrato.",
            );
          }
        } catch (diagnosticError) {
          if (diagnosticError instanceof ContractAccessError) throw diagnosticError;
        }
        throw error;
      }

      return NextResponse.json({
        ok: true,
        operation: materialized,
      });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };
}

export const POST = createSalesContractSendPostHandler();
