import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { loadStoreBrandVisualPolicy } from "@/lib/server/store-brand-visual-policy";
import {
  buildQuotePdf,
  loadStoreLogoForPdf,
} from "@/lib/server/sales-quotes/build-quote-pdf";
import {
  canInsertQuoteConversationEvent,
  insertQuoteConversationEvent,
} from "@/lib/server/sales-quotes/quote-events";
import { ensureQuoteConversationReadyForQuoteEvent } from "@/lib/server/sales-quotes/quote-conversation-readiness";
import {
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";
import { loadStoreQuoteSettings } from "@/lib/server/sales-quotes/quote-settings";
import {
  buildQuotePdfFileName,
  storeQuotePdfFile,
} from "@/lib/server/sales-quotes/quote-storage";
import { pushAssistantDocumentReviewMessage } from "@/lib/server/assistant/document-review-messages";
import {
  buildQuoteKindNotice,
  buildQuoteSnapshot,
} from "@/lib/server/sales-quotes/quote-versioning";
import {
  sha256CanonicalPayloadV1,
  withoutVolatileQuoteSnapshotFields,
} from "@/lib/server/sales-quotes/canonical-payload-v1";
import { resolveSalesQuoteKindForVersion } from "@/lib/server/sales-quotes/quote-kind";
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

function normalizeQuoteKindHint(value: unknown): "preliminary" | "definitive" | null {
  if (value == null || String(value).trim() === "") return null;

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "preliminary" || normalized === "definitive") {
    return normalized;
  }

  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function readOperationResult(data: unknown) {
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("P19A_PDF_OPERATION_RESULT_INVALID");
  }
  return result as Record<string, any>;
}

function buildCanonicalPdfPayload(args: {
  organizationId: string;
  storeId: string;
  quoteId: string;
  quoteKind: "preliminary" | "definitive" | null;
  snapshot: Record<string, unknown>;
}) {
  return sha256CanonicalPayloadV1({
    protocol: "zion-sales-quote-pdf-v1",
    organizationId: args.organizationId,
    storeId: args.storeId,
    quoteId: args.quoteId,
    quoteKind: args.quoteKind,
    snapshot: withoutVolatileQuoteSnapshotFields(args.snapshot),
  });
}

function buildPdfInputFromSnapshot(snapshot: Record<string, any>, storeLogo: {
  bytes: Uint8Array;
  mimeType: string;
} | null) {
  const quote = snapshot.quote || {};
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const rendering = snapshot.pdfRendering || {};

  return {
    storeName: snapshot.store?.name || null,
    storeLogo,
    brandVisual: rendering.brandVisual || null,
    quoteNumber: String(quote.quoteNumber || "").trim() || String(quote.id || ""),
    quoteKind: quote.quoteKind || null,
    quoteKindNotice: quote.quoteKindNotice || buildQuoteKindNotice(quote.quoteKind),
    title: quote.title || null,
    customerName: quote.customerName || null,
    customerPhone: quote.customerPhone || null,
    createdAt: quote.createdAt || null,
    validUntil: quote.validUntil || null,
    items: items.map((item: Record<string, any>) => ({
      name: item.name || null,
      description: item.description || null,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountCents: item.discountCents,
      totalCents: item.totalCents,
    })),
    subtotalCents: Number(quote.subtotalCents || 0),
    discountCents: Number(quote.discountCents || 0),
    totalCents: Number(quote.totalCents || 0),
    customerNotes: quote.customerNotes || null,
    paymentTerms: quote.paymentTerms || null,
    deliveryTerms: quote.deliveryTerms || null,
    warrantyTerms: quote.warrantyTerms || null,
    settings: snapshot.settings,
  };
}

async function reconcileQuoteGenerationSideEffects(args: {
  supabase: any;
  quote: any;
  scope: any;
  versionId: string;
  storagePath: string;
  originalFilename: string;
  operationId: string;
}) {
  const findExistingEvent = async () => {
    const { data, error } = await args.supabase
      .from("conversation_events")
      .select("id")
      .eq("conversation_id", String(args.quote.conversation_id || "").trim())
      .eq("organization_id", args.quote.organization_id)
      .eq("event_type", "orcamento_gerado")
      .contains("payload", {
        quote_id: args.quote.id,
        version_id: args.versionId,
        operation_id: args.operationId,
      })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data?.id ? String(data.id) : null;
  };

  const conversationId = String(args.quote.conversation_id || "").trim();
  if (conversationId) {
    if (!(await findExistingEvent())) {
      const inserted = await insertQuoteConversationEvent({
        supabase: args.supabase,
        quote: args.quote,
        eventType: "orcamento_gerado",
        payload: {
          quote_id: args.quote.id,
          version_id: args.versionId,
          operation_id: args.operationId,
          quote_number: args.quote.quote_number,
          total_cents: args.quote.total_cents,
          status: "pending_review",
        },
        createdBy: "system",
      });

      if (inserted.deduped && !(await findExistingEvent())) {
        throw new Error("O evento de geracao foi deduplicado, mas sua identidade nao foi confirmada.");
      }
    }
  }

  await pushAssistantDocumentReviewMessage({
    supabase: args.supabase,
    organizationId: args.scope.organizationId,
    storeId: args.scope.store.id,
    documentType: "quote",
    documentId: args.quote.id,
    documentVersionId: args.versionId,
    documentNumber: String(args.quote.quote_number || "").trim() || args.quote.id,
    documentStatus: "pending_review",
    relatedQuoteId: args.quote.id,
    relatedContractId: null,
    relatedLeadId: args.scope.lead?.id || args.quote.lead_id || null,
    relatedConversationId: args.scope.conversation?.id || args.quote.conversation_id || null,
    customerName: args.quote.customer_name || args.scope.lead?.name || null,
    customerPhone: args.quote.customer_phone || args.scope.lead?.phone || null,
    originalFileName: args.originalFilename,
    fileKind: "sales_quote_pdf",
    mimeType: "application/pdf",
    storageBucket: "zion-store-files",
    storagePath: args.storagePath,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ quoteId: string }> }
) {
  let operationId: string | null = null;
  let claimToken: string | null = null;
  let operationMaterialized = false;
  let replayed = false;
  let generationScope: Awaited<ReturnType<typeof resolveAuthorizedExistingQuote>> | null = null;

  try {
    const body = (await request.json().catch(() => null)) as
      | { quoteKind?: unknown; quote_kind?: unknown }
      | null;
    const requestedQuoteKind = normalizeQuoteKindHint(body?.quoteKind ?? body?.quote_kind);
    const { quoteId: rawQuoteId } = await context.params;
    const quoteId = String(rawQuoteId || "").trim();
    operationId = String(request.headers.get("x-zion-quote-operation-id") || "").trim().toLowerCase();
    if (!UUID_RE.test(operationId)) {
      throw new QuoteAccessError(
        400,
        "QUOTE_PDF_OPERATION_ID_REQUIRED",
        "A geração do PDF precisa de uma identidade de operação válida.",
      );
    }
    const scope = await resolveAuthorizedExistingQuote(quoteId);
    generationScope = scope;
    const { data: lookupData, error: lookupError } = await scope.supabase.rpc(
      "get_sales_quote_pdf_generation_replay_by_system",
      {
        p_operation_id: operationId,
        p_organization_id: scope.organizationId,
        p_store_id: scope.store.id,
        p_quote_id: scope.quote.id,
      },
    );
    if (lookupError) throw new Error(lookupError.message);
    const lookup = readOperationResult(lookupData);
    if (lookup.operation_id !== operationId) {
      throw new Error("P19A_PDF_OPERATION_IDENTITY_INVALID");
    }
    if (lookup.outcome === "idempotent_replay") {
      if (
        !lookup.quote_version_id ||
        !lookup.store_file_id ||
        !lookup.storage_path ||
        !lookup.original_filename
      ) {
        throw new Error("P19A_PDF_REPLAY_RESULT_INVALID");
      }
      await reconcileQuoteGenerationSideEffects({
        supabase: scope.supabase,
        quote: scope.quote,
        scope,
        versionId: String(lookup.quote_version_id),
        storagePath: String(lookup.storage_path),
        originalFilename: String(lookup.original_filename),
        operationId,
      });
      replayed = true;
      return NextResponse.json({
        ok: true,
        quoteId: scope.quote.id,
        versionId: String(lookup.quote_version_id),
        storeFileId: String(lookup.store_file_id),
        storagePath: String(lookup.storage_path || ""),
        status: "pending_review",
        replayed,
      });
    }
    const existingOperation = lookup.outcome === "existing_operation";

    if (!existingOperation) {
      await ensureQuoteConversationReadyForQuoteEvent({
        supabase: scope.supabase,
        actorUserId: scope.user.id,
        organizationId: scope.organizationId,
        conversationId: scope.conversation?.id || scope.quote.conversation_id || null,
        leadId: scope.lead?.id || scope.quote.lead_id || null,
        source: "quote_pdf_generation",
      });

      const eventGuard = await canInsertQuoteConversationEvent({
        supabase: scope.supabase,
        quote: scope.quote,
        eventType: "orcamento_gerado",
      });

      if (!eventGuard.allowed) {
        throw new QuoteAccessError(
          409,
          "QUOTE_EVENT_NOT_ALLOWED",
          "A geracao do orcamento nao esta permitida no estado atual da conversa."
        );
      }
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

    const quoteKind = await resolveSalesQuoteKindForVersion({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      quoteId: scope.quote.id,
      commercialOpportunityId: scope.quote.commercial_opportunity_id,
      fallbackQuoteKind: requestedQuoteKind,
    });

    const snapshot = buildQuoteSnapshot({
      quote: scope.quote,
      items,
      settings,
      store: scope.store,
      lead: scope.lead,
      quoteKind,
    });

    const brandVisualPolicy = await loadStoreBrandVisualPolicy({
      supabase: scope.sessionSupabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });

    const storeLogo =
      !brandVisualPolicy.configured || brandVisualPolicy.useLogoOnQuotes === true
        ? await loadStoreLogoForPdf({
            supabase: scope.supabase,
            organizationId: scope.organizationId,
            storeId: scope.store.id,
          })
        : null;
    const brandVisual = brandVisualPolicy.configured
      ? {
          primaryColor: brandVisualPolicy.primaryColor,
          secondaryColor: brandVisualPolicy.secondaryColor,
          documentFooter: brandVisualPolicy.documentFooter,
        }
      : null;
    const logoSha256 = storeLogo
      ? createHash("sha256").update(storeLogo.bytes).digest("hex")
      : null;
    const persistedSnapshot = {
      ...snapshot,
      quote: {
        ...snapshot.quote,
        updatedAt: scope.quote.updated_at,
        currentVersionId: scope.quote.current_version_id,
      },
      pdfRendering: {
        brandVisual,
        logoSha256,
      },
    } as Record<string, unknown>;
    const canonical = buildCanonicalPdfPayload({
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      quoteId: scope.quote.id,
      quoteKind,
      snapshot: persistedSnapshot,
    });
    const originalFilename = buildQuotePdfFileName(
      String(scope.quote.quote_number || "").trim() || scope.quote.id,
      null,
    );
    const { data: beginData, error: beginError } = await scope.supabase.rpc(
      "begin_sales_quote_pdf_generation_by_system",
      {
        p_operation_id: operationId,
        p_organization_id: scope.organizationId,
        p_store_id: scope.store.id,
        p_quote_id: scope.quote.id,
        p_request_fingerprint: canonical.fingerprint,
        p_quote_kind: quoteKind,
        p_quote_snapshot: persistedSnapshot,
        p_original_filename: originalFilename,
        p_canonical_payload_v1: canonical.canonicalPayload,
      },
    );
    if (beginError) throw new Error(beginError.message);

    let operation = readOperationResult(beginData);
    if (operation.operation_id !== operationId) {
      throw new Error("P19A_PDF_OPERATION_IDENTITY_INVALID");
    }

    if (operation.outcome === "idempotent_replay") {
      operationMaterialized = true;
      replayed = true;
    } else if (operation.outcome === "in_progress") {
      return NextResponse.json(
        { ok: false, outcome: "in_progress", operationId, leaseExpiresAt: operation.lease_expires_at },
        { status: 409 },
      );
    } else {
      if (operation.outcome === "recoverable") {
        const { data: recoveredData, error: recoveredError } = await scope.supabase.rpc(
          "claim_recoverable_sales_quote_pdf_generation_by_system",
          {
            p_operation_id: operationId,
            p_organization_id: scope.organizationId,
            p_store_id: scope.store.id,
            p_request_fingerprint: canonical.fingerprint,
          },
        );
        if (recoveredError) throw new Error(recoveredError.message);
        operation = readOperationResult(recoveredData);
      }

      if (operation.outcome !== "claimed" && operation.outcome !== "reclaimed") {
        throw new Error("P19A_PDF_OPERATION_CLAIM_INVALID");
      }
      claimToken = String(operation.claim_token || "").trim();
      if (!UUID_RE.test(claimToken)) throw new Error("P19A_PDF_CLAIM_TOKEN_INVALID");

      const { data: startedData, error: startedError } = await scope.supabase.rpc(
        "start_sales_quote_pdf_generation_by_system",
        {
          p_operation_id: operationId,
          p_organization_id: scope.organizationId,
          p_store_id: scope.store.id,
          p_claim_token: claimToken,
        },
      );
      if (startedError) throw new Error(startedError.message);
      const started = readOperationResult(startedData);
      if (started.outcome !== "processing") throw new Error("P19A_PDF_START_INVALID");

      const renderSnapshot =
        operation.outcome === "reclaimed" && operation.quote_snapshot && typeof operation.quote_snapshot === "object"
          ? operation.quote_snapshot as Record<string, any>
          : persistedSnapshot;
      const savedLogoSha256 =
        renderSnapshot.pdfRendering && typeof renderSnapshot.pdfRendering === "object"
          ? (renderSnapshot.pdfRendering as Record<string, unknown>).logoSha256 ?? null
          : null;
      if (savedLogoSha256 !== logoSha256) {
        throw new Error("P19A_PDF_RENDER_INPUT_CHANGED");
      }
      const pdfBytes = await buildQuotePdf(
        buildPdfInputFromSnapshot(renderSnapshot, storeLogo),
      );
      const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");
      const storedFile = await storeQuotePdfFile({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        quoteId: scope.quote.id,
        quoteNumber: String(scope.quote.quote_number || "").trim() || scope.quote.id,
        storagePath: String(operation.storage_path || "").trim(),
        originalFilename: String(operation.original_filename || "").trim(),
        expectedPdfSha256: pdfSha256,
        pdfBytes,
      });
      const { data: materializedData, error: materializedError } = await scope.supabase.rpc(
        "materialize_sales_quote_pdf_generation_by_system",
        {
          p_operation_id: operationId,
          p_organization_id: scope.organizationId,
          p_store_id: scope.store.id,
          p_claim_token: claimToken,
          p_store_file_id: storedFile.storeFileId,
          p_storage_bucket: storedFile.storageBucket,
          p_storage_path: storedFile.storagePath,
          p_original_filename: storedFile.originalFilename,
          p_size_bytes: storedFile.sizeBytes,
          p_pdf_sha256: pdfSha256,
        },
      );
      if (materializedError) throw new Error(materializedError.message);
      operation = readOperationResult(materializedData);
      operationMaterialized = operation.outcome === "materialized";
    }

    if (!operationMaterialized || !operation.quote_version_id || !operation.store_file_id) {
      throw new Error("P19A_PDF_MATERIALIZED_RESULT_INVALID");
    }

    await reconcileQuoteGenerationSideEffects({
      supabase: scope.supabase,
      quote: scope.quote,
      scope,
      versionId: String(operation.quote_version_id),
      storagePath: String(operation.storage_path),
      originalFilename: String(operation.original_filename),
      operationId,
    });

    return NextResponse.json({
      ok: true,
      quoteId: scope.quote.id,
      versionId: String(operation.quote_version_id),
      storeFileId: String(operation.store_file_id),
      storagePath: String(operation.storage_path),
      status: "pending_review",
      replayed,
    });
  } catch (error) {
    if (operationId && claimToken && !operationMaterialized) {
      try {
        if (!generationScope) throw new Error("P19A_PDF_SCOPE_UNAVAILABLE");
        await generationScope.supabase.rpc("mark_sales_quote_pdf_generation_recoverable_by_system", {
          p_operation_id: operationId,
          p_organization_id: generationScope.organizationId,
          p_store_id: generationScope.store.id,
          p_claim_token: claimToken,
          p_error_code: "P19A_PDF_GENERATION_FAILED",
          p_error_message: error instanceof Error ? error.message : "Erro inesperado na geracao.",
        });
      } catch {
        // best effort
      }
    }

    return buildErrorResponse(error);
  }
}
