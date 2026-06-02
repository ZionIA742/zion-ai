import { NextResponse } from "next/server";
import { buildContractPdf, loadStoreLogoForContractPdf } from "@/lib/server/sales-contracts/build-contract-pdf";
import { resolveAuthorizedExistingContract, ContractAccessError } from "@/lib/server/sales-contracts/contract-auth";
import { registerContractBusinessEvent } from "@/lib/server/sales-contracts/contract-events";
import { storeContractPdfFile } from "@/lib/server/sales-contracts/contract-storage";
import { pushAssistantDocumentReviewMessage } from "@/lib/server/assistant/document-review-messages";
import {
  buildContractSnapshot,
  createContractVersion,
  getNextContractVersionNumber,
  markContractVersionStatus,
  setContractCurrentVersion,
} from "@/lib/server/sales-contracts/contract-versioning";
import type { SalesQuoteItemRow } from "@/lib/server/sales-quotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(
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
    scope = await resolveAuthorizedExistingContract(contractId);

    const normalizedStatus = String(scope.contract.status || "").trim().toLowerCase();
    if (
      normalizedStatus === "completed" ||
      normalizedStatus === "cancelled" ||
      normalizedStatus === "expired"
    ) {
      throw new ContractAccessError(
        409,
        "CONTRACT_STATUS_NOT_GENERATABLE",
        "Este contrato nao pode gerar nova versao de PDF no status atual."
      );
    }

    let items: SalesQuoteItemRow[] = [];
    if (scope.contract.quote_id) {
      const { data: itemsData, error: itemsError } = await scope.supabase
        .from("sales_quote_items")
        .select(
          "id, quote_id, organization_id, store_id, item_type, name, description, quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents, sort_order, sku, metadata, created_at, updated_at"
        )
        .eq("quote_id", scope.contract.quote_id)
        .eq("organization_id", scope.organizationId)
        .eq("store_id", scope.store.id)
        .order("sort_order", { ascending: true });

      if (itemsError) {
        throw new Error(`Falha ao carregar itens do orcamento base: ${itemsError.message}`);
      }

      items = (itemsData || []) as SalesQuoteItemRow[];
    }

    const versionNumber = await getNextContractVersionNumber({
      supabase: scope.supabase,
      contractId: scope.contract.id,
    });

    const snapshot = buildContractSnapshot({
      contract: scope.contract,
      store: scope.store,
      lead: scope.lead,
      items,
    });

    const storeLogo = await loadStoreLogoForContractPdf({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });

    const pdfBytes = await buildContractPdf({
      storeName: scope.store.name,
      storeLogo,
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
        unit_price_cents: item.unit_price_cents,
        discount_cents: item.discount_cents,
        total_cents: item.total_cents,
      })),
      subtotalCents: Number(scope.contract.subtotal_cents || 0),
      discountCents: Number(scope.contract.discount_cents || 0),
      totalCents: Number(scope.contract.total_cents || 0),
      paymentTerms: scope.contract.payment_terms,
      deliveryTerms: scope.contract.delivery_terms,
      warrantyTerms: scope.contract.warranty_terms,
      contractTerms:
        normalizeOptionalText(scope.contract.contract_terms) ||
        "A definir pela loja.",
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
      await registerContractBusinessEvent({
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
      await pushAssistantDocumentReviewMessage({
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
}
