import { NextResponse } from "next/server";
import {
  buildQuotePdf,
  loadStoreLogoForPdf,
} from "@/lib/server/sales-quotes/build-quote-pdf";
import {
  canInsertQuoteConversationEvent,
  insertQuoteConversationEvent,
} from "@/lib/server/sales-quotes/quote-events";
import {
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";
import { loadStoreQuoteSettings } from "@/lib/server/sales-quotes/quote-settings";
import { storeQuotePdfFile } from "@/lib/server/sales-quotes/quote-storage";
import { pushAssistantDocumentReviewMessage } from "@/lib/server/assistant/document-review-messages";
import {
  buildQuoteSnapshot,
  createQuoteVersion,
  getNextQuoteVersionNumber,
  recordQuoteGenerationFailure,
} from "@/lib/server/sales-quotes/quote-versioning";
import type { SalesQuoteItemRow } from "@/lib/server/sales-quotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildErrorResponse(error: unknown) {
  if (error instanceof QuoteAccessError) {
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
        error instanceof Error ? error.message : "Erro inesperado ao gerar PDF do orcamento.",
    },
    { status: 500 }
  );
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ quoteId: string }> }
) {
  let generationContext:
    | {
        supabase: any;
        quote: any;
        versionNumber: number;
        snapshot: any;
      }
    | null = null;
  let versionCreated = false;

  try {
    const { quoteId: rawQuoteId } = await context.params;
    const quoteId = String(rawQuoteId || "").trim();
    const scope = await resolveAuthorizedExistingQuote(quoteId);
    const eventGuard = await canInsertQuoteConversationEvent({
      supabase: scope.supabase,
      quote: scope.quote,
      eventType: "orcamento_gerado",
    });

    if (!eventGuard.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_EVENT_NOT_ALLOWED",
          message: "A geracao do orcamento nao esta permitida no estado atual da conversa.",
        },
        { status: 409 }
      );
    }

    const { settings } = await loadStoreQuoteSettings({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });

    const { data: itemsData, error: itemsError } = await scope.supabase
      .from("sales_quote_items")
      .select(
        "id, quote_id, organization_id, store_id, name, description, quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents, sort_order, sku, metadata, created_at, updated_at"
      )
      .eq("quote_id", scope.quote.id)
      .order("sort_order", { ascending: true });

    if (itemsError) {
      throw new Error(itemsError.message);
    }

    const items = (itemsData || []) as SalesQuoteItemRow[];

    if (items.length === 0) {
      throw new QuoteAccessError(
        400,
        "QUOTE_WITHOUT_ITEMS",
        "Nao e possivel gerar PDF para um orcamento sem itens."
      );
    }

    const versionNumber = await getNextQuoteVersionNumber({
      supabase: scope.supabase,
      quoteId: scope.quote.id,
    });

    const snapshot = buildQuoteSnapshot({
      quote: scope.quote,
      items,
      settings,
      store: scope.store,
      lead: scope.lead,
    });

    generationContext = {
      supabase: scope.supabase,
      quote: scope.quote,
      versionNumber,
      snapshot,
    };

    const quoteMetadata =
      scope.quote.metadata && typeof scope.quote.metadata === "object"
        ? scope.quote.metadata
        : null;

    const storeLogo = await loadStoreLogoForPdf({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });

    const pdfBytes = await buildQuotePdf({
      storeName: scope.store.name,
      storeLogo,
      quoteNumber: String(scope.quote.quote_number || "").trim() || scope.quote.id,
      title: scope.quote.title,
      customerName: scope.lead?.name || null,
      customerPhone: scope.lead?.phone || null,
      createdAt: scope.quote.created_at,
      validUntil: null,
      items: items.map((item) => ({
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unit_price_cents,
        discountCents: item.discount_cents,
        totalCents: item.total_cents,
      })),
      subtotalCents: Number(scope.quote.subtotal_cents || 0),
      discountCents: Number(scope.quote.discount_cents || 0),
      totalCents: Number(scope.quote.total_cents || 0),
      customerNotes: scope.quote.customer_notes,
      paymentTerms: String(quoteMetadata?.payment_terms || "").trim() || null,
      deliveryTerms: String(quoteMetadata?.delivery_terms || "").trim() || null,
      warrantyTerms: String(quoteMetadata?.warranty_terms || "").trim() || null,
      settings,
    });

    const storedFile = await storeQuotePdfFile({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      quoteId: scope.quote.id,
      quoteNumber: String(scope.quote.quote_number || "").trim() || scope.quote.id,
      versionNumber,
      pdfBytes,
    });

    const versionRow = await createQuoteVersion({
      supabase: scope.supabase,
      quote: scope.quote,
      versionNumber,
      storeFileId: storedFile.storeFileId,
      storageBucket: storedFile.storageBucket,
      storagePath: storedFile.storagePath,
      originalFilename: storedFile.originalFilename,
      sizeBytes: storedFile.sizeBytes,
      quoteSnapshot: snapshot,
      nextQuoteStatus: "pending_review",
    });
    versionCreated = true;

    await insertQuoteConversationEvent({
      supabase: scope.supabase,
      quote: scope.quote,
      eventType: "orcamento_gerado",
      payload: {
        quote_id: scope.quote.id,
        version_id: versionRow.id,
        quote_number: scope.quote.quote_number,
        total_cents: scope.quote.total_cents,
        status: "pending_review",
      },
      createdBy: "system",
    });

    try {
      await pushAssistantDocumentReviewMessage({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        documentType: "quote",
        documentId: scope.quote.id,
        documentVersionId: versionRow.id,
        documentNumber: String(scope.quote.quote_number || "").trim() || scope.quote.id,
        documentStatus: "pending_review",
        relatedQuoteId: scope.quote.id,
        relatedContractId: null,
        relatedLeadId: scope.lead?.id || scope.quote.lead_id || null,
        relatedConversationId:
          scope.conversation?.id || scope.quote.conversation_id || null,
        customerName: scope.quote.customer_name || scope.lead?.name || null,
        customerPhone: scope.quote.customer_phone || scope.lead?.phone || null,
        originalFileName: storedFile.originalFilename,
        fileKind: "sales_quote_pdf",
        mimeType: "application/pdf",
        storageBucket: storedFile.storageBucket,
        storagePath: storedFile.storagePath,
      });
    } catch (assistantMessageError) {
      console.warn(
        "[sales-quotes/generate-pdf] falha ao criar mensagem document_review da assistente:",
        assistantMessageError
      );
    }

    return NextResponse.json({
      ok: true,
      quoteId: scope.quote.id,
      versionId: versionRow.id,
      storeFileId: storedFile.storeFileId,
      storagePath: storedFile.storagePath,
      status: "pending_review",
    });
  } catch (error) {
    if (generationContext && !versionCreated) {
      try {
        await recordQuoteGenerationFailure({
          supabase: generationContext.supabase,
          quote: generationContext.quote,
          versionNumber: generationContext.versionNumber,
          quoteSnapshot: {
            ...generationContext.snapshot,
            generationError:
              error instanceof Error ? error.message : "Erro inesperado na geracao.",
          },
        });
      } catch {
        // best effort
      }
    }

    return buildErrorResponse(error);
  }
}
