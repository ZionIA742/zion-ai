import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { loadStoreBrandVisualPolicy } from "@/lib/server/store-brand-visual-policy";
import { buildContractPdf, loadStoreLogoForContractPdf } from "@/lib/server/sales-contracts/build-contract-pdf";
import {
  buildCanonicalContractRendererInput,
  buildContractSnapshotV2,
  computeContractContentFingerprint,
} from "@/lib/server/sales-contracts/canonical-contract-renderer";
import { resolveAuthorizedExistingContract, ContractAccessError } from "@/lib/server/sales-contracts/contract-auth";
import { registerContractBusinessEvent } from "@/lib/server/sales-contracts/contract-events";
import { storeContractPdfFile } from "@/lib/server/sales-contracts/contract-storage";
import { pushAssistantDocumentReviewMessage } from "@/lib/server/assistant/document-review-messages";
import {
  type ContractQuoteSnapshotItem,
  createSalesContractVersionBySystem,
  markContractPendingReview,
  reconcileSupersededContractVersion,
} from "@/lib/server/sales-contracts/contract-versioning";
import { resolveContractTemplateTerms } from "@/lib/server/sales-contracts/contract-template-terms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NON_EDITABLE_CONTRACT_STATUSES = new Set([
  "sent_to_customer",
  "customer_signed",
  "store_signed",
  "completed",
  "cancelled",
  "expired",
  "failed",
]);
const PDF_REGENERATION_BLOCKED_MESSAGE =
  "Este contrato ja foi enviado ou assinado e nao pode ter o PDF regenerado. Para alterar, crie um novo contrato ou cancele o contrato atual conforme o fluxo permitido.";

type GenerateContractPdfDeps = {
  buildContractPdf: typeof buildContractPdf;
  createSalesContractVersionBySystem: typeof createSalesContractVersionBySystem;
  loadStoreBrandVisualPolicy: typeof loadStoreBrandVisualPolicy;
  loadStoreLogoForContractPdf: typeof loadStoreLogoForContractPdf;
  markContractPendingReview: typeof markContractPendingReview;
  pushAssistantDocumentReviewMessage: typeof pushAssistantDocumentReviewMessage;
  registerContractBusinessEvent: typeof registerContractBusinessEvent;
  resolveAuthorizedExistingContract: typeof resolveAuthorizedExistingContract;
  resolveContractTemplateTerms: typeof resolveContractTemplateTerms;
  reconcileSupersededContractVersion: typeof reconcileSupersededContractVersion;
  storeContractPdfFile: typeof storeContractPdfFile;
};

const defaultGenerateContractPdfDeps: GenerateContractPdfDeps = {
  buildContractPdf,
  createSalesContractVersionBySystem,
  loadStoreBrandVisualPolicy,
  loadStoreLogoForContractPdf,
  markContractPendingReview,
  pushAssistantDocumentReviewMessage,
  registerContractBusinessEvent,
  resolveAuthorizedExistingContract,
  resolveContractTemplateTerms,
  reconcileSupersededContractVersion,
  storeContractPdfFile,
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
        error instanceof Error ? error.message : "Erro inesperado ao gerar PDF do contrato.",
    },
    { status: 500 }
  );
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function resolveOperationId(headerValue: string | null) {
  const operationId = String(headerValue || "").trim();
  if (!operationId) return randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    throw new ContractAccessError(
      409,
      "CONTRACT_OPERATION_ID_INVALID",
      "O identificador da operacao de geracao do contrato e invalido.",
    );
  }
  return operationId.toLowerCase();
}

function buildRequestFingerprint(args: {
  organizationId: string;
  storeId: string;
  contractId: string;
  rendererInput: ReturnType<typeof buildCanonicalContractRendererInput>;
  contentFingerprint: string;
}) {
  const orderedRequest = [
    "zion.contract-pdf.request.v1",
    args.organizationId,
    args.storeId,
    args.contractId,
    args.rendererInput.identity.quoteId,
    args.rendererInput.identity.quoteVersionId,
    args.rendererInput.templateAuthority.templateId,
    args.rendererInput.templateAuthority.templateVersionId,
    args.contentFingerprint,
  ];
  return createHash("sha256")
    .update(JSON.stringify(orderedRequest))
    .digest("hex");
}

function buildDurableStoreFile(version: Awaited<ReturnType<typeof createSalesContractVersionBySystem>>["version"]) {
  if (
    !version.store_file_id ||
    !version.storage_bucket ||
    !version.storage_path ||
    !version.original_filename ||
    version.size_bytes == null
  ) {
    throw new Error("A versao canonica nao possui identidade completa de storage.");
  }
  return {
    storeFileId: version.store_file_id,
    storageBucket: version.storage_bucket,
    storagePath: version.storage_path,
    originalFilename: version.original_filename,
    sizeBytes: version.size_bytes,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown, fieldName: string) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  throw new ContractAccessError(
    409,
    "CONTRACT_QUOTE_SNAPSHOT_INVALID",
    `quote_snapshot.items possui ${fieldName} invalido.`
  );
}

function nullableNumber(value: unknown, fieldName: string) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new ContractAccessError(
    409,
    "CONTRACT_QUOTE_SNAPSHOT_INVALID",
    `quote_snapshot.items possui ${fieldName} invalido.`
  );
}

function nullableMetadata(value: unknown) {
  if (value == null) return null;
  if (isRecord(value)) return value;
  throw new ContractAccessError(
    409,
    "CONTRACT_QUOTE_SNAPSHOT_INVALID",
    "quote_snapshot.items possui metadata invalido."
  );
}

function normalizeQuoteSnapshotItems(items: unknown): ContractQuoteSnapshotItem[] {
  if (!Array.isArray(items)) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_SNAPSHOT_ITEMS_INVALID",
      "quote_snapshot.items precisa ser um array."
    );
  }

  return items.map((item, index) => {
    if (!isRecord(item)) {
      throw new ContractAccessError(
        409,
        "CONTRACT_QUOTE_SNAPSHOT_INVALID",
        `quote_snapshot.items[${index}] precisa ser um objeto.`
      );
    }

    return {
      id: nullableString(item.id, "id"),
      name: nullableString(item.name, "name"),
      description: nullableString(item.description, "description"),
      quantity: nullableNumber(item.quantity, "quantity"),
      unitPriceCents: nullableNumber(item.unitPriceCents, "unitPriceCents"),
      discountCents: nullableNumber(item.discountCents, "discountCents"),
      subtotalCents: nullableNumber(item.subtotalCents, "subtotalCents"),
      totalCents: nullableNumber(item.totalCents, "totalCents"),
      sku: nullableString(item.sku, "sku"),
      sortOrder: nullableNumber(item.sortOrder, "sortOrder"),
      metadata: nullableMetadata(item.metadata),
    };
  });
}

async function loadContractQuoteSnapshotItems(
  scope: Awaited<ReturnType<typeof resolveAuthorizedExistingContract>>,
) {
  const quoteId = normalizeOptionalText(scope.contract.quote_id);
  const quoteVersionId = normalizeOptionalText(scope.contract.quote_version_id);

  if (!quoteId) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_ID_REQUIRED_FOR_PDF",
      "Contrato sem quote_id nao pode gerar PDF com lineage comprovada."
    );
  }

  if (!quoteVersionId) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_VERSION_ID_REQUIRED_FOR_PDF",
      "Contrato sem quote_version_id nao pode gerar PDF com lineage comprovada."
    );
  }

  const { data: quoteVersion, error: quoteVersionError } = await scope.supabase
    .from("sales_quote_versions")
    .select("id, quote_id, organization_id, store_id, status, sent_at, quote_snapshot")
    .eq("id", quoteVersionId)
    .eq("quote_id", quoteId)
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.store.id)
    .maybeSingle();

  if (quoteVersionError) {
    throw new Error(
      `Falha ao carregar versao exata do orcamento do contrato: ${quoteVersionError.message}`
    );
  }

  if (!quoteVersion) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_VERSION_NOT_FOUND",
      "Versao exata do orcamento do contrato nao encontrada."
    );
  }

  if (
    quoteVersion.id !== quoteVersionId ||
    quoteVersion.quote_id !== quoteId ||
    quoteVersion.organization_id !== scope.organizationId ||
    quoteVersion.store_id !== scope.store.id
  ) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_VERSION_LINEAGE_MISMATCH",
      "Versao do orcamento nao corresponde a lineage do contrato."
    );
  }

  const normalizedStatus = String(quoteVersion.status || "").trim().toLowerCase();
  if (normalizedStatus !== "sent" && normalizedStatus !== "superseded") {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_VERSION_STATUS_INVALID",
      "Versao do orcamento precisa estar sent ou superseded para gerar PDF do contrato."
    );
  }

  if (!normalizeOptionalText(quoteVersion.sent_at)) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_VERSION_SENT_AT_REQUIRED",
      "Versao do orcamento precisa ter sent_at para gerar PDF do contrato."
    );
  }

  const quoteSnapshot = quoteVersion.quote_snapshot;
  if (!isRecord(quoteSnapshot)) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_SNAPSHOT_INVALID",
      "quote_snapshot da versao do orcamento precisa ser um objeto."
    );
  }

  if (!isRecord(quoteSnapshot.quote)) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_SNAPSHOT_INVALID",
      "quote_snapshot.quote precisa ser um objeto."
    );
  }

  if (String(quoteSnapshot.quote.id || "").trim() !== quoteId) {
    throw new ContractAccessError(
      409,
      "CONTRACT_QUOTE_SNAPSHOT_LINEAGE_MISMATCH",
      "quote_snapshot.quote.id nao corresponde ao quote_id do contrato."
    );
  }

  return {
    quoteSnapshot,
    items: normalizeQuoteSnapshotItems(quoteSnapshot.items),
  };
}

export function createGenerateContractPdfPostHandler(
  deps: Partial<GenerateContractPdfDeps> = {},
) {
  const buildContractPdf =
    deps.buildContractPdf ?? defaultGenerateContractPdfDeps.buildContractPdf;
  const createCanonicalVersion =
    deps.createSalesContractVersionBySystem ??
    defaultGenerateContractPdfDeps.createSalesContractVersionBySystem;
  const loadStoreBrandVisualPolicy =
    deps.loadStoreBrandVisualPolicy ??
    defaultGenerateContractPdfDeps.loadStoreBrandVisualPolicy;
  const loadStoreLogoForContractPdf =
    deps.loadStoreLogoForContractPdf ??
    defaultGenerateContractPdfDeps.loadStoreLogoForContractPdf;
  const markContractPendingReview =
    deps.markContractPendingReview ??
    defaultGenerateContractPdfDeps.markContractPendingReview;
  const pushDocumentReviewMessage =
    deps.pushAssistantDocumentReviewMessage ??
    defaultGenerateContractPdfDeps.pushAssistantDocumentReviewMessage;
  const registerBusinessEvent =
    deps.registerContractBusinessEvent ??
    defaultGenerateContractPdfDeps.registerContractBusinessEvent;
  const resolveContract =
    deps.resolveAuthorizedExistingContract ??
    defaultGenerateContractPdfDeps.resolveAuthorizedExistingContract;
  const resolveTemplateTerms =
    deps.resolveContractTemplateTerms ??
    defaultGenerateContractPdfDeps.resolveContractTemplateTerms;
  const reconcilePreviousVersion =
    deps.reconcileSupersededContractVersion ??
    defaultGenerateContractPdfDeps.reconcileSupersededContractVersion;
  const storeContractPdfFile =
    deps.storeContractPdfFile ?? defaultGenerateContractPdfDeps.storeContractPdfFile;

  return async function POST(
    request: Request,
    context: { params: Promise<{ contractId: string }> }
  ) {
  let scope:
    | Awaited<ReturnType<typeof resolveAuthorizedExistingContract>>
    | null = null;
  let authorityState: "unconfirmed" | "committed_new" | "committed_replay" =
    "unconfirmed";
  let storeFileToRollback:
    | {
        storeFileId: string;
        storageBucket: string;
        storagePath: string;
      }
    | null = null;

  try {
    const { contractId: rawContractId } = await context.params;
    const contractId = String(rawContractId || "").trim();
    scope = await resolveContract(contractId);

    const normalizedStatus = String(scope.contract.status || "").trim().toLowerCase();
    const sentAt = normalizeOptionalText(scope.contract.sent_at);
    const customerSignedAt = normalizeOptionalText(scope.contract.customer_signed_at);
    const storeSignedAt = normalizeOptionalText(scope.contract.store_signed_at);
    const completedAt = normalizeOptionalText(scope.contract.completed_at);

    if (
      NON_EDITABLE_CONTRACT_STATUSES.has(normalizedStatus) ||
      sentAt ||
      customerSignedAt ||
      storeSignedAt ||
      completedAt
    ) {
      throw new ContractAccessError(
        409,
        "CONTRACT_STATUS_NOT_GENERATABLE",
        PDF_REGENERATION_BLOCKED_MESSAGE
      );
    }

    const { quoteSnapshot, items } = await loadContractQuoteSnapshotItems(scope);
    const operationId = resolveOperationId(
      request.headers.get("x-zion-contract-operation-id"),
    );
    const operationKey = `p9:contract-pdf:${scope.contract.id}:${operationId}`;
    if (operationKey.length > 200) {
      throw new ContractAccessError(
        409,
        "CONTRACT_OPERATION_KEY_INVALID",
        "A chave da operacao de geracao do contrato e invalida.",
      );
    }

    const templateTerms = await resolveTemplateTerms({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });

    if (
      !templateTerms.contractTemplateUsed ||
      !templateTerms.templateId ||
      !templateTerms.templateVersionId ||
      !templateTerms.generatedContractTerms
    ) {
      throw new ContractAccessError(
        409,
        "CONTRACT_TEMPLATE_AUTHORITY_REQUIRED",
        templateTerms.warning ||
          "Template ativo e regras finais sao obrigatorios para gerar uma versao canonica do contrato."
      );
    }

    const brandVisualPolicy = await loadStoreBrandVisualPolicy({
      supabase: scope.sessionSupabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });

    const storeLogo =
      !brandVisualPolicy.configured || brandVisualPolicy.useLogoOnContracts === true
        ? await loadStoreLogoForContractPdf({
            supabase: scope.supabase,
            organizationId: scope.organizationId,
            storeId: scope.store.id,
          })
        : null;

    const rendererInput = buildCanonicalContractRendererInput({
      contract: scope.contract,
      store: scope.store,
      lead: scope.lead,
      quoteSnapshot,
      items,
      templateTerms,
      brandVisual: brandVisualPolicy.configured
        ? {
            primaryColor: brandVisualPolicy.primaryColor,
            secondaryColor: brandVisualPolicy.secondaryColor,
            documentFooter: brandVisualPolicy.documentFooter,
          }
        : null,
      logo: storeLogo,
    });
    const contentFingerprint = computeContractContentFingerprint(rendererInput);
    const requestFingerprint = buildRequestFingerprint({
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      contractId: scope.contract.id,
      rendererInput,
      contentFingerprint,
    });

    const pdfBytes = await buildContractPdf(rendererInput);
    const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");
    const snapshot = buildContractSnapshotV2({
      input: rendererInput,
      contentFingerprint,
      materializedAt: new Date().toISOString(),
    });

    const storedFile = await storeContractPdfFile({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      contractId: scope.contract.id,
      contractNumber: scope.contract.contract_number,
      contentFingerprint,
      pdfBytes,
    });

    storeFileToRollback = {
      storeFileId: storedFile.storeFileId,
      storageBucket: storedFile.storageBucket,
      storagePath: storedFile.storagePath,
    };

    const canonicalResult = await createCanonicalVersion({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      contractId: scope.contract.id,
      operationKey,
      requestFingerprint,
      contentFingerprint,
      storeFileId: storedFile.storeFileId,
      storageBucket: storedFile.storageBucket,
      storagePath: storedFile.storagePath,
      originalFilename: storedFile.originalFilename,
      mimeType: "application/pdf",
      sizeBytes: storedFile.sizeBytes,
      pdfSha256,
      contractSnapshot: snapshot as Record<string, unknown>,
      onAuthorityResolved: ({ replayed }) => {
        authorityState = replayed ? "committed_replay" : "committed_new";
      },
    });
    const version = canonicalResult.version;
    const durableStoreFile = buildDurableStoreFile(version);

    if (canonicalResult.replayed) {
      try {
        await scope.supabase.storage
          .from(storedFile.storageBucket)
          .remove([storedFile.storagePath]);
        await scope.supabase
          .from("store_files")
          .delete()
          .eq("id", storedFile.storeFileId)
          .eq("organization_id", scope.organizationId)
          .eq("store_id", scope.store.id);
      } catch {
        // best effort: the canonical replay artifact remains authoritative
      }
    }
    storeFileToRollback = null;

    await reconcilePreviousVersion({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      contractId: scope.contract.id,
      versionNumber: version.version_number,
    });
    await markContractPendingReview({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      contractId: scope.contract.id,
      expectedCurrentVersionId: version.id,
    });

    if (!canonicalResult.replayed && version.version_number === 1) {
      await registerBusinessEvent({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        eventKey: "contrato_gerado",
        actorType: "human",
        leadId: scope.lead?.id || scope.contract.lead_id || null,
        conversationId: scope.conversation?.id || scope.contract.conversation_id || null,
        actorUserId: scope.userId,
        eventPayload: {
          contract_id: scope.contract.id,
          contract_number: scope.contract.contract_number,
          version_id: version.id,
          version_number: version.version_number,
          stage: "first_pdf_generated",
        },
        });
    }

    try {
      await pushDocumentReviewMessage({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        documentType: "contract",
        documentId: scope.contract.id,
        documentVersionId: version.id,
        documentNumber:
          String(scope.contract.contract_number || "").trim() || scope.contract.id,
        documentStatus: "pending_review",
        relatedQuoteId: scope.contract.quote_id || null,
        relatedContractId: scope.contract.id,
        relatedLeadId: scope.lead?.id || scope.contract.lead_id || null,
        relatedConversationId:
          scope.conversation?.id || scope.contract.conversation_id || null,
        customerName: scope.contract.customer_name || scope.lead?.name || null,
        customerPhone: scope.contract.customer_phone || scope.lead?.phone || null,
        originalFileName: durableStoreFile.originalFilename,
        fileKind: "sales_contract_pdf",
        mimeType: "application/pdf",
        storageBucket: durableStoreFile.storageBucket,
        storagePath: durableStoreFile.storagePath,
      });
    } catch (assistantMessageError) {
      console.warn(
        "[sales-contracts/generate-pdf] falha ao criar mensagem document_review da assistente:",
        assistantMessageError
      );
    }

    return NextResponse.json({
      ok: true,
      contract: {
        ...scope.contract,
        current_version_id: version.id,
        status: "pending_review",
      },
      version,
      storeFile: durableStoreFile,
    });
  } catch (error) {
    const shouldRollbackTemporaryArtifact =
      authorityState === "unconfirmed" || authorityState === "committed_replay";

    if (scope && storeFileToRollback && shouldRollbackTemporaryArtifact) {
      try {
        await scope.supabase.storage
          .from(storeFileToRollback.storageBucket)
          .remove([storeFileToRollback.storagePath]);
        await scope.supabase
          .from("store_files")
          .delete()
          .eq("id", storeFileToRollback.storeFileId)
          .eq("organization_id", scope.organizationId)
          .eq("store_id", scope.store.id);
      } catch {
        // best effort
      }
    }

    return buildErrorResponse(error);
  }
  };
}

export const POST = createGenerateContractPdfPostHandler();
