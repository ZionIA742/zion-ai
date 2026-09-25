import { NextResponse } from "next/server";
import { loadStoreBrandVisualPolicy } from "@/lib/server/store-brand-visual-policy";
import { buildContractPdf, loadStoreLogoForContractPdf } from "@/lib/server/sales-contracts/build-contract-pdf";
import { resolveAuthorizedExistingContract, ContractAccessError } from "@/lib/server/sales-contracts/contract-auth";
import { registerContractBusinessEvent } from "@/lib/server/sales-contracts/contract-events";
import { storeContractPdfFile } from "@/lib/server/sales-contracts/contract-storage";
import { pushAssistantDocumentReviewMessage } from "@/lib/server/assistant/document-review-messages";
import {
  buildContractSnapshot,
  createContractVersion,
  type ContractQuoteSnapshotItem,
  getNextContractVersionNumber,
  markContractVersionStatus,
  setContractCurrentVersion,
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
  buildContractSnapshot: typeof buildContractSnapshot;
  createContractVersion: typeof createContractVersion;
  getNextContractVersionNumber: typeof getNextContractVersionNumber;
  loadStoreBrandVisualPolicy: typeof loadStoreBrandVisualPolicy;
  loadStoreLogoForContractPdf: typeof loadStoreLogoForContractPdf;
  markContractVersionStatus: typeof markContractVersionStatus;
  pushAssistantDocumentReviewMessage: typeof pushAssistantDocumentReviewMessage;
  registerContractBusinessEvent: typeof registerContractBusinessEvent;
  resolveAuthorizedExistingContract: typeof resolveAuthorizedExistingContract;
  resolveContractTemplateTerms: typeof resolveContractTemplateTerms;
  setContractCurrentVersion: typeof setContractCurrentVersion;
  storeContractPdfFile: typeof storeContractPdfFile;
};

const defaultGenerateContractPdfDeps: GenerateContractPdfDeps = {
  buildContractPdf,
  buildContractSnapshot,
  createContractVersion,
  getNextContractVersionNumber,
  loadStoreBrandVisualPolicy,
  loadStoreLogoForContractPdf,
  markContractVersionStatus,
  pushAssistantDocumentReviewMessage,
  registerContractBusinessEvent,
  resolveAuthorizedExistingContract,
  resolveContractTemplateTerms,
  setContractCurrentVersion,
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

  return normalizeQuoteSnapshotItems(quoteSnapshot.items);
}

export function createGenerateContractPdfPostHandler(
  deps: Partial<GenerateContractPdfDeps> = {},
) {
  const buildContractPdf =
    deps.buildContractPdf ?? defaultGenerateContractPdfDeps.buildContractPdf;
  const buildContractSnapshot =
    deps.buildContractSnapshot ?? defaultGenerateContractPdfDeps.buildContractSnapshot;
  const createContractVersion =
    deps.createContractVersion ?? defaultGenerateContractPdfDeps.createContractVersion;
  const getNextVersionNumber =
    deps.getNextContractVersionNumber ??
    defaultGenerateContractPdfDeps.getNextContractVersionNumber;
  const loadStoreBrandVisualPolicy =
    deps.loadStoreBrandVisualPolicy ??
    defaultGenerateContractPdfDeps.loadStoreBrandVisualPolicy;
  const loadStoreLogoForContractPdf =
    deps.loadStoreLogoForContractPdf ??
    defaultGenerateContractPdfDeps.loadStoreLogoForContractPdf;
  const markContractVersionStatus =
    deps.markContractVersionStatus ??
    defaultGenerateContractPdfDeps.markContractVersionStatus;
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
  const setContractCurrentVersion =
    deps.setContractCurrentVersion ??
    defaultGenerateContractPdfDeps.setContractCurrentVersion;
  const storeContractPdfFile =
    deps.storeContractPdfFile ?? defaultGenerateContractPdfDeps.storeContractPdfFile;

  return async function POST(
    _request: Request,
    context: { params: Promise<{ contractId: string }> }
  ) {
  let scope:
    | Awaited<ReturnType<typeof resolveAuthorizedExistingContract>>
    | null = null;
  let versionIdToRollback: string | null = null;
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

    const items = await loadContractQuoteSnapshotItems(scope);

    const versionNumber = await getNextVersionNumber({
      supabase: scope.supabase,
      contractId: scope.contract.id,
    });

    const templateTerms = await resolveTemplateTerms({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });

    if (templateTerms.warning) {
      console.warn(
        "[sales-contracts/generate-pdf] usando fallback de termos do contrato:",
        templateTerms.warning
      );
    }

    const resolvedContractTerms =
      normalizeOptionalText(templateTerms.generatedContractTerms) ||
      normalizeOptionalText(scope.contract.contract_terms) ||
      "A definir pela loja.";

    const snapshot = buildContractSnapshot({
      contract: scope.contract,
      store: scope.store,
      lead: scope.lead,
      items,
      templateTerms: {
        ...templateTerms,
        generatedContractTerms:
          normalizeOptionalText(templateTerms.generatedContractTerms) || null,
      },
    });

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

    const pdfBytes = await buildContractPdf({
      storeName: scope.store.name,
      storeLogo,
      brandVisual: brandVisualPolicy.configured
        ? {
            primaryColor: brandVisualPolicy.primaryColor,
            secondaryColor: brandVisualPolicy.secondaryColor,
            documentFooter: brandVisualPolicy.documentFooter,
          }
        : null,
      contractNumber: scope.contract.contract_number,
      quoteNumber:
        scope.contract.metadata && typeof scope.contract.metadata === "object"
          ? String(scope.contract.metadata.quote_number || "").trim() || null
          : null,
      title: scope.contract.title,
      customerName: scope.contract.customer_name || scope.lead?.name || null,
      customerPhone: scope.contract.customer_phone || scope.lead?.phone || null,
      createdAt: scope.contract.created_at,
      validUntil: scope.contract.valid_until,
      items: items.map((item) => ({
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unit_price_cents: item.unitPriceCents,
        discount_cents: item.discountCents,
        total_cents: item.totalCents,
      })),
      subtotalCents: Number(scope.contract.subtotal_cents || 0),
      discountCents: Number(scope.contract.discount_cents || 0),
      totalCents: Number(scope.contract.total_cents || 0),
      paymentTerms: scope.contract.payment_terms,
      deliveryTerms: scope.contract.delivery_terms,
      warrantyTerms: scope.contract.warranty_terms,
      contractTerms: resolvedContractTerms,
    });

    const storedFile = await storeContractPdfFile({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      contractId: scope.contract.id,
      contractNumber: scope.contract.contract_number,
      versionNumber,
      pdfBytes,
    });

    storeFileToRollback = {
      storeFileId: storedFile.storeFileId,
      storageBucket: storedFile.storageBucket,
      storagePath: storedFile.storagePath,
    };

    const version = await createContractVersion({
      supabase: scope.supabase,
      contract: scope.contract,
      versionNumber,
      status: "generated",
      storeFileId: storedFile.storeFileId,
      storageBucket: storedFile.storageBucket,
      storagePath: storedFile.storagePath,
      originalFilename: storedFile.originalFilename,
      sizeBytes: storedFile.sizeBytes,
      contractSnapshot: snapshot,
    });

    versionIdToRollback = version.id;

    if (scope.currentVersion?.id) {
      await markContractVersionStatus({
        supabase: scope.supabase,
        versionId: scope.currentVersion.id,
        status: "superseded",
      });
    }

    await setContractCurrentVersion({
      supabase: scope.supabase,
      contractId: scope.contract.id,
      versionId: version.id,
      status: "pending_review",
    });

    if (versionNumber === 1) {
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
        originalFileName: storedFile.originalFilename,
        fileKind: "sales_contract_pdf",
        mimeType: "application/pdf",
        storageBucket: storedFile.storageBucket,
        storagePath: storedFile.storagePath,
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
      storeFile: storedFile,
    });
  } catch (error) {
    if (scope && versionIdToRollback) {
      try {
        await scope.supabase
          .from("sales_contract_versions")
          .delete()
          .eq("id", versionIdToRollback);
      } catch {
        // best effort
      }
    }

    if (scope && storeFileToRollback) {
      try {
        await scope.supabase.storage
          .from(storeFileToRollback.storageBucket)
          .remove([storeFileToRollback.storagePath]);
        await scope.supabase.from("store_files").delete().eq("id", storeFileToRollback.storeFileId);
      } catch {
        // best effort
      }
    }

    return buildErrorResponse(error);
  }
  };
}

export const POST = createGenerateContractPdfPostHandler();
