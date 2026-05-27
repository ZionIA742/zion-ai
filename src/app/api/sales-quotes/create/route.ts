import { NextResponse } from "next/server";
import {
  QuoteAccessError,
  resolveAuthorizedQuoteScope,
} from "@/lib/server/sales-quotes/quote-auth";
import { reserveNextQuoteNumber } from "@/lib/server/sales-quotes/quote-settings";
import type { NormalizedQuoteItemInput, QuoteItemInput } from "@/lib/server/sales-quotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateQuoteBody = {
  organizationId?: string;
  storeId?: string;
  conversationId?: string | null;
  leadId?: string | null;
  title?: string | null;
  items?: QuoteItemInput[];
  customerName?: string | null;
  customer_name?: string | null;
  customerPhone?: string | null;
  customer_phone?: string | null;
  customer_notes?: string | null;
  internal_notes?: string | null;
  discount_cents?: number | null;
};

const ALLOWED_QUOTE_ITEM_TYPES = [
  "pool",
  "catalog_item",
  "service",
  "custom",
] as const;

type AllowedQuoteItemType = (typeof ALLOWED_QUOTE_ITEM_TYPES)[number];
type NormalizedCreateQuoteItem = NormalizedQuoteItemInput & {
  itemType: AllowedQuoteItemType;
};

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
        error instanceof Error ? error.message : "Erro inesperado ao criar orcamento.",
    },
    { status: 500 }
  );
}

function parseInteger(value: unknown, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.trunc(numericValue);
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeQuoteItemType(
  record: Record<string, unknown> | null,
  index: number
): AllowedQuoteItemType {
  const rawItemType = String(
    record?.item_type ?? record?.itemType ?? record?.type ?? ""
  )
    .trim()
    .toLowerCase();

  if (
    ALLOWED_QUOTE_ITEM_TYPES.includes(rawItemType as AllowedQuoteItemType)
  ) {
    return rawItemType as AllowedQuoteItemType;
  }

  throw new QuoteAccessError(
    400,
    "INVALID_ITEM_TYPE",
    `Item ${index + 1} possui tipo invalido ou ausente.`
  );
}

function normalizeQuoteItems(items: unknown): NormalizedCreateQuoteItem[] {
  if (!Array.isArray(items)) {
    throw new QuoteAccessError(400, "INVALID_ITEMS", "items deve ser um array.");
  }

  return items.map((item, index) => {
    const record =
      item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const name = String(record?.name || "").trim();

    if (!name) {
      throw new QuoteAccessError(
        400,
        "INVALID_ITEM_NAME",
        `Item ${index + 1} sem nome.`
      );
    }

    const itemType = normalizeQuoteItemType(record, index);
    const quantity = Math.max(1, parseInteger(record?.quantity, 1));
    const unitPriceCents = Math.max(0, parseInteger(record?.unit_price_cents, 0));
    const rawDiscountCents = Math.max(
      0,
      parseInteger(record?.discount_cents, 0)
    );
    const subtotalCents = quantity * unitPriceCents;
    const discountCents = Math.min(subtotalCents, rawDiscountCents);
    const totalCents = Math.max(0, subtotalCents - discountCents);

    return {
      itemType,
      name,
      description: String(record?.description || "").trim() || null,
      quantity,
      unitPriceCents,
      discountCents,
      subtotalCents,
      totalCents,
      sku: String(record?.sku || "").trim() || null,
      sortOrder: index + 1,
      metadata: {
        source: record?.source && typeof record.source === "object" ? record.source : null,
        frozen_at: new Date().toISOString(),
      },
    };
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CreateQuoteBody | null;
    const storeId = String(body?.storeId || "").trim();
    const conversationId = String(body?.conversationId || "").trim() || null;
    const leadId = String(body?.leadId || "").trim() || null;
    const title = String(body?.title || "").trim() || null;
    const customerNotes = normalizeOptionalText(body?.customer_notes);
    const internalNotes = normalizeOptionalText(body?.internal_notes);
    const quoteDiscountCents = Math.max(0, parseInteger(body?.discount_cents, 0));
    const items = normalizeQuoteItems(body?.items || []);

    const scope = await resolveAuthorizedQuoteScope({
      requestOrganizationId: body?.organizationId,
      requestStoreId: storeId,
      conversationId,
      leadId,
    });

    const numberReservation = await reserveNextQuoteNumber({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });

    const itemsSubtotalCents = items.reduce(
      (sum, item) => sum + item.subtotalCents,
      0
    );
    const itemsDiscountCents = items.reduce(
      (sum, item) => sum + item.discountCents,
      0
    );
    const subtotalCents = itemsSubtotalCents;
    const discountCents = itemsDiscountCents + quoteDiscountCents;
    const totalCents = Math.max(0, subtotalCents - discountCents);
    const quoteTitle = title || `Orcamento ${numberReservation.quoteNumber}`;
    const customerName =
      normalizeOptionalText(body?.customerName ?? body?.customer_name) ??
      normalizeOptionalText(scope.lead?.name);
    const customerPhone =
      normalizeOptionalText(body?.customerPhone ?? body?.customer_phone) ??
      normalizeOptionalText(scope.lead?.phone);

    const quoteMetadata = {
      quote_pdf_enabled_snapshot: numberReservation.settings.quotePdfEnabled,
      ai_can_generate_quote_snapshot: numberReservation.settings.aiCanGenerateQuote,
      ai_can_send_quote_to_customer_snapshot:
        numberReservation.settings.aiCanSendQuoteToCustomer,
      requires_human_approval_before_send_snapshot:
        numberReservation.settings.requiresHumanApprovalBeforeSend,
      quote_number_prefix_snapshot: numberReservation.settings.quoteNumberPrefix,
      next_quote_number_reserved: numberReservation.reservedNumber,
      created_via: "api_sales_quotes_create",
      payment_terms: null,
      delivery_terms: null,
      warranty_terms: null,
    };

    const { data: quoteRow, error: quoteError } = await scope.supabase
      .from("sales_quotes")
      .insert({
        organization_id: scope.organizationId,
        store_id: scope.store.id,
        conversation_id: scope.conversation?.id || null,
        lead_id: scope.lead?.id || null,
        quote_number: numberReservation.quoteNumber,
        title: quoteTitle,
        status: "draft",
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_notes: customerNotes,
        internal_notes: internalNotes,
        subtotal_cents: subtotalCents,
        discount_cents: discountCents,
        total_cents: totalCents,
        current_version_id: null,
        metadata: quoteMetadata,
      })
      .select(
        "id, organization_id, store_id, conversation_id, lead_id, quote_number, title, status, customer_notes, internal_notes, subtotal_cents, discount_cents, total_cents, current_version_id, metadata, created_at, updated_at"
      )
      .maybeSingle();

    if (quoteError || !quoteRow?.id) {
      throw new Error(quoteError?.message || "Falha ao criar sales_quotes.");
    }

    if (items.length > 0) {
      const itemRows = items.map((item) => ({
        quote_id: quoteRow.id,
        organization_id: scope.organizationId,
        store_id: scope.store.id,
        item_type: item.itemType,
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unit_price_cents: item.unitPriceCents,
        discount_cents: item.discountCents,
        subtotal_cents: item.subtotalCents,
        total_cents: item.totalCents,
        sort_order: item.sortOrder,
        sku: item.sku,
        metadata: item.metadata,
      }));

      const { error: itemsError } = await scope.supabase
        .from("sales_quote_items")
        .insert(itemRows);

      if (itemsError) {
        await scope.supabase.from("sales_quotes").delete().eq("id", quoteRow.id);
        throw new Error(itemsError.message);
      }
    }

    return NextResponse.json({
      ok: true,
      quoteId: quoteRow.id,
      quoteNumber: quoteRow.quote_number,
      status: quoteRow.status,
      customerName,
      customerPhone,
      itemCount: items.length,
      subtotalCents,
      discountCents,
      totalCents,
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
}
