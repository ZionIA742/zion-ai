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
import {
  buildQuoteSnapshot,
  createQuoteVersion,
  getNextQuoteVersionNumber,
  recordQuoteGenerationFailure,
} from "@/lib/server/sales-quotes/quote-versioning";
import type {
  QuoteSnapshot,
  SalesQuoteChangeRequestRow,
  SalesQuoteItemRow,
  SalesQuoteRow,
} from "@/lib/server/sales-quotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApplyChangeBody = {
  changeRequestId?: string | null;
  discount_cents?: number | null;
  customer_notes?: string | null;
  internal_notes?: string | null;
  payment_terms?: string | null;
  delivery_terms?: string | null;
  warranty_terms?: string | null;
};

const CHANGE_APPLIED_EVENT_TYPE = "orcamento_alterado";

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
        error instanceof Error
          ? error.message
          : "Erro inesperado ao aplicar alteracao do orcamento.",
    },
    { status: 500 }
  );
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function hasOwn(obj: object, key: keyof ApplyChangeBody) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function parseDiscountCents(value: unknown) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    throw new QuoteAccessError(
      400,
      "INVALID_DISCOUNT_CENTS",
      "discount_cents deve ser um numero valido."
    );
  }

  return Math.trunc(numericValue);
}

function getQuoteMetadata(quote: SalesQuoteRow) {
  return quote.metadata && typeof quote.metadata === "object"
    ? { ...quote.metadata }
    : {};
}

function buildUpdatedQuote(args: {
  quote: SalesQuoteRow;
  body: ApplyChangeBody;
}) {
  const subtotalCents = Number(args.quote.subtotal_cents || 0);
  const currentMetadata = getQuoteMetadata(args.quote);
  const nextMetadata = { ...currentMetadata };
  const appliedChanges: Record<string, { from: unknown; to: unknown }> = {};
  let metadataChanged = false;

  let nextDiscountCents = Number(args.quote.discount_cents || 0);
  let nextCustomerNotes = args.quote.customer_notes ?? null;
  let nextInternalNotes = args.quote.internal_notes ?? null;

  if (hasOwn(args.body, "discount_cents")) {
    const parsedDiscountCents = parseDiscountCents(args.body.discount_cents);

    if (parsedDiscountCents < 0) {
      throw new QuoteAccessError(
        400,
        "INVALID_DISCOUNT_CENTS",
        "discount_cents nao pode ser negativo."
      );
    }

    if (parsedDiscountCents > subtotalCents) {
      throw new QuoteAccessError(
        400,
        "INVALID_DISCOUNT_CENTS",
        "discount_cents nao pode ser maior que subtotal_cents."
      );
    }

    if (parsedDiscountCents !== nextDiscountCents) {
      appliedChanges.discount_cents = {
        from: nextDiscountCents,
        to: parsedDiscountCents,
      };
      nextDiscountCents = parsedDiscountCents;
    }
  }

  if (hasOwn(args.body, "customer_notes")) {
    const normalizedCustomerNotes = normalizeOptionalText(args.body.customer_notes);

    if (normalizedCustomerNotes !== nextCustomerNotes) {
      appliedChanges.customer_notes = {
        from: nextCustomerNotes,
        to: normalizedCustomerNotes,
      };
      nextCustomerNotes = normalizedCustomerNotes;
    }
  }

  if (hasOwn(args.body, "internal_notes")) {
    const normalizedInternalNotes = normalizeOptionalText(args.body.internal_notes);

    if (normalizedInternalNotes !== nextInternalNotes) {
      appliedChanges.internal_notes = {
        from: nextInternalNotes,
        to: normalizedInternalNotes,
      };
      nextInternalNotes = normalizedInternalNotes;
    }
  }

  for (const key of [
    "payment_terms",
    "delivery_terms",
    "warranty_terms",
  ] as const) {
    if (!hasOwn(args.body, key)) {
      continue;
    }

    const normalizedValue = normalizeOptionalText(args.body[key]);
    const currentValue = normalizeOptionalText(currentMetadata[key]);

    if (normalizedValue !== currentValue) {
      appliedChanges[key] = {
        from: currentValue,
        to: normalizedValue,
      };
      nextMetadata[key] = normalizedValue;
      metadataChanged = true;
    }
  }

  if (Object.keys(appliedChanges).length === 0) {
    throw new QuoteAccessError(
      400,
      "NO_APPLICABLE_CHANGES",
      "Nenhuma alteracao aplicavel foi informada."
    );
  }

  const nextTotalCents = Math.max(subtotalCents - nextDiscountCents, 0);

  const updatedQuote: SalesQuoteRow = {
    ...args.quote,
    status: "pending_review",
    discount_cents: nextDiscountCents,
    total_cents: nextTotalCents,
    customer_notes: nextCustomerNotes,
    internal_notes: nextInternalNotes,
    metadata: metadataChanged ? nextMetadata : args.quote.metadata,
  };

  return {
    subtotalCents,
    updatedQuote,
    nextMetadata,
    metadataChanged,
    nextDiscountCents,
    nextTotalCents,
    appliedChanges,
  };
}

async function loadQuoteItems(args: { supabase: any; quoteId: string }) {
  const { data, error } = await args.supabase
    .from("sales_quote_items")
    .select(
      "id, quote_id, organization_id, store_id, name, description, quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents, sort_order, sku, metadata, created_at, updated_at"
    )
    .eq("quote_id", args.quoteId)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Falha ao carregar itens do orcamento: ${error.message}`);
  }

  const items = (data || []) as SalesQuoteItemRow[];

  if (items.length === 0) {
    throw new QuoteAccessError(
      400,
      "QUOTE_WITHOUT_ITEMS",
      "Nao e possivel aplicar alteracao em um orcamento sem itens."
    );
  }

  return items;
}

async function loadOpenChangeRequest(args: {
  supabase: any;
  quote: SalesQuoteRow;
  changeRequestId?: string | null;
}) {
  const effectiveChangeRequestId =
    String(args.changeRequestId || "").trim() ||
    String(args.quote.last_change_request_id || "").trim();

  if (!effectiveChangeRequestId) {
    throw new QuoteAccessError(
      400,
      "CHANGE_REQUEST_NOT_FOUND",
      "Nenhum pedido de alteracao aberto foi informado ou encontrado para este orcamento."
    );
  }

  const { data, error } = await args.supabase
    .from("sales_quote_change_requests")
    .select(
      "id, quote_id, organization_id, store_id, status, requested_by, request_text, applied_changes, created_at, applied_at, resolved_at"
    )
    .eq("id", effectiveChangeRequestId)
    .eq("quote_id", args.quote.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar sales_quote_change_requests: ${error.message}`);
  }

  const changeRequest = (data || null) as SalesQuoteChangeRequestRow | null;

  if (!changeRequest?.id) {
    throw new QuoteAccessError(
      400,
      "CHANGE_REQUEST_NOT_FOUND",
      "Pedido de alteracao nao encontrado para este orcamento."
    );
  }

  if (String(changeRequest.status || "").trim() !== "open") {
    throw new QuoteAccessError(
      400,
      "CHANGE_REQUEST_NOT_OPEN",
      "O pedido de alteracao informado nao esta aberto."
    );
  }

  return changeRequest;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ quoteId: string }> }
) {
  let storedFile:
    | {
        storeFileId: string;
        storageBucket: string;
        storagePath: string;
        originalFilename: string;
        sizeBytes: number;
      }
    | null = null;
  let quoteUpdated = false;
  let versionCreated = false;
  let revertContext:
    | {
        supabase: any;
        originalQuote: SalesQuoteRow;
      }
    | null = null;
  let failureSnapshot: QuoteSnapshot | null = null;
  let failureVersionNumber: number | null = null;

  try {
    const body = (await request.json().catch(() => null)) as ApplyChangeBody | null;
    const safeBody = body && typeof body === "object" ? body : {};

    const { quoteId: rawQuoteId } = await context.params;
    const quoteId = String(rawQuoteId || "").trim();
    const scope = await resolveAuthorizedExistingQuote(quoteId);
    const eventGuard = await canInsertQuoteConversationEvent({
      supabase: scope.supabase,
      quote: scope.quote,
      eventType: CHANGE_APPLIED_EVENT_TYPE,
    });

    if (!eventGuard.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_EVENT_NOT_ALLOWED",
          message: "A alteracao do orcamento nao esta permitida no estado atual da conversa.",
        },
        { status: 409 }
      );
    }

    const items = await loadQuoteItems({
      supabase: scope.supabase,
      quoteId: scope.quote.id,
    });
    const changeRequest = await loadOpenChangeRequest({
      supabase: scope.supabase,
      quote: scope.quote,
      changeRequestId: safeBody.changeRequestId,
    });
    const { settings } = await loadStoreQuoteSettings({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });
    const previousVersionId = scope.quote.current_version_id || null;
    const versionNumber = await getNextQuoteVersionNumber({
      supabase: scope.supabase,
      quoteId: scope.quote.id,
    });
    const {
      updatedQuote,
      nextMetadata,
      metadataChanged,
      nextDiscountCents,
      nextTotalCents,
      appliedChanges,
    } = buildUpdatedQuote({
      quote: scope.quote,
      body: safeBody,
    });

    const snapshot = buildQuoteSnapshot({
      quote: updatedQuote,
      items,
      settings,
      store: scope.store,
      lead: scope.lead,
    });
    failureSnapshot = snapshot;
    failureVersionNumber = versionNumber;

    const storeLogo = await loadStoreLogoForPdf({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });

    const pdfBytes = await buildQuotePdf({
      storeName: scope.store.name,
      storeLogo,
      quoteNumber: String(updatedQuote.quote_number || "").trim() || updatedQuote.id,
      title: updatedQuote.title,
      customerName: updatedQuote.customer_name || scope.lead?.name || null,
      customerPhone: updatedQuote.customer_phone || scope.lead?.phone || null,
      createdAt: updatedQuote.created_at,
      validUntil: null,
      items: items.map((item) => ({
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unit_price_cents,
        discountCents: item.discount_cents,
        totalCents: item.total_cents,
      })),
      subtotalCents: Number(updatedQuote.subtotal_cents || 0),
      discountCents: nextDiscountCents,
      totalCents: nextTotalCents,
      customerNotes: updatedQuote.customer_notes,
      paymentTerms: normalizeOptionalText(nextMetadata.payment_terms),
      deliveryTerms: normalizeOptionalText(nextMetadata.delivery_terms),
      warrantyTerms: normalizeOptionalText(nextMetadata.warranty_terms),
      settings,
    });

    storedFile = await storeQuotePdfFile({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      quoteId: scope.quote.id,
      quoteNumber: String(updatedQuote.quote_number || "").trim() || updatedQuote.id,
      versionNumber,
      pdfBytes,
    });

    revertContext = {
      supabase: scope.supabase,
      originalQuote: scope.quote,
    };

    const quoteUpdatePayload: Record<string, unknown> = {
      status: "pending_review",
      discount_cents: nextDiscountCents,
      total_cents: nextTotalCents,
      customer_notes: updatedQuote.customer_notes,
      internal_notes: updatedQuote.internal_notes,
    };

    if (metadataChanged) {
      quoteUpdatePayload.metadata = nextMetadata;
    }

    const { error: quoteUpdateError } = await scope.supabase
      .from("sales_quotes")
      .update(quoteUpdatePayload)
      .eq("id", scope.quote.id);

    if (quoteUpdateError) {
      throw new Error(`Falha ao atualizar sales_quotes: ${quoteUpdateError.message}`);
    }
    quoteUpdated = true;

    const versionRow = await createQuoteVersion({
      supabase: scope.supabase,
      quote: updatedQuote,
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

    const resolutionTimestamp = new Date().toISOString();
    const { error: changeRequestUpdateError } = await scope.supabase
      .from("sales_quote_change_requests")
      .update({
        status: "applied",
        applied_changes: appliedChanges,
        applied_at: resolutionTimestamp,
        resolved_at: resolutionTimestamp,
      })
      .eq("id", changeRequest.id);

    if (changeRequestUpdateError) {
      throw new Error(
        `Falha ao atualizar sales_quote_change_requests: ${changeRequestUpdateError.message}`
      );
    }

    await insertQuoteConversationEvent({
      supabase: scope.supabase,
      quote: updatedQuote,
      eventType: CHANGE_APPLIED_EVENT_TYPE,
      payload: {
        quote_id: updatedQuote.id,
        change_request_id: changeRequest.id,
        previous_version_id: previousVersionId,
        new_version_id: versionRow.id,
        quote_number: updatedQuote.quote_number,
        status: "pending_review",
        total_cents: nextTotalCents,
        applied_changes: appliedChanges,
      },
      createdBy: "human",
    });

    return NextResponse.json({
      ok: true,
      quoteId: updatedQuote.id,
      quoteNumber: updatedQuote.quote_number,
      status: "pending_review",
      changeRequestId: changeRequest.id,
      previousVersionId,
      versionId: versionRow.id,
      totalCents: nextTotalCents,
      appliedChanges,
    });
  } catch (error) {
    if (revertContext && quoteUpdated && !versionCreated) {
      try {
        await revertContext.supabase
          .from("sales_quotes")
          .update({
            status: revertContext.originalQuote.status,
            discount_cents: revertContext.originalQuote.discount_cents,
            total_cents: revertContext.originalQuote.total_cents,
            customer_notes: revertContext.originalQuote.customer_notes,
            internal_notes: revertContext.originalQuote.internal_notes,
            metadata: revertContext.originalQuote.metadata,
          })
          .eq("id", revertContext.originalQuote.id);
      } catch {
        // best effort
      }
    }

    if (storedFile && !versionCreated) {
      try {
        await revertContext!.supabase.storage
          .from(storedFile.storageBucket)
          .remove([storedFile.storagePath]);
      } catch {
        // best effort
      }

      try {
        await revertContext!.supabase
          .from("store_files")
          .delete()
          .eq("id", storedFile.storeFileId);
      } catch {
        // best effort
      }
    }

    if (revertContext && failureSnapshot && failureVersionNumber && !versionCreated) {
      try {
        await recordQuoteGenerationFailure({
          supabase: revertContext.supabase,
          quote: revertContext.originalQuote,
          versionNumber: failureVersionNumber,
          quoteSnapshot: {
            ...failureSnapshot,
            generationError:
              error instanceof Error
                ? error.message
                : "Erro inesperado ao aplicar alteracao estruturada.",
          },
        });
      } catch {
        // best effort
      }
    }

    return buildErrorResponse(error);
  }
}
