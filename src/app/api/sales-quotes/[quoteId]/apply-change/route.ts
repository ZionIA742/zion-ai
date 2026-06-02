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
  title?: string | null;
  discount_cents?: number | null;
  customer_notes?: string | null;
  internal_notes?: string | null;
  payment_terms?: string | null;
  delivery_terms?: string | null;
  warranty_terms?: string | null;
  validity_days?: string | null;
  items?: Array<{
    id?: string | null;
    item_type?: string | null;
    name?: string | null;
    description?: string | null;
    quantity?: number | string | null;
    unit_price_cents?: number | string | null;
    discount_cents?: number | string | null;
  }> | null;
};

const CHANGE_APPLIED_EVENT_TYPE = "orcamento_alterado";
const ALLOWED_APPLY_CHANGE_ITEM_TYPES = ["pool", "catalog_item", "service", "custom"] as const;

type AllowedApplyChangeItemType = (typeof ALLOWED_APPLY_CHANGE_ITEM_TYPES)[number];
type EditableSalesQuoteItemRow = SalesQuoteItemRow & {
  item_type?: string | null;
};
type NormalizedApplyChangeItem = {
  id: string | null;
  itemType: AllowedApplyChangeItemType;
  name: string;
  description: string | null;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  subtotalCents: number;
  totalCents: number;
  sortOrder: number;
  sku: string | null;
  metadata: Record<string, unknown>;
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

function parseIntegerField(value: unknown, errorCode: string, fieldName: string) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    throw new QuoteAccessError(
      400,
      errorCode,
      `${fieldName} deve ser um numero valido.`
    );
  }

  return Math.trunc(numericValue);
}

function normalizeApplyChangeItemType(value: unknown, index: number): AllowedApplyChangeItemType {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "pool_installation") {
    return "custom";
  }

  if (ALLOWED_APPLY_CHANGE_ITEM_TYPES.includes(normalized as AllowedApplyChangeItemType)) {
    return normalized as AllowedApplyChangeItemType;
  }

  throw new QuoteAccessError(
    400,
    "INVALID_ITEM_TYPE",
    `Item ${index + 1} possui tipo invalido ou ausente.`
  );
}

function getQuoteMetadata(quote: SalesQuoteRow) {
  return quote.metadata && typeof quote.metadata === "object"
    ? { ...quote.metadata }
    : {};
}

function readOfficialOrMetadataText(
  quote: SalesQuoteRow,
  metadata: Record<string, unknown>,
  key: "payment_terms" | "delivery_terms" | "warranty_terms" | "valid_until"
) {
  const officialValue = normalizeOptionalText(quote[key]);
  if (officialValue) {
    return officialValue;
  }

  return normalizeOptionalText(metadata[key]);
}

function summarizeItemsForAudit(items: Array<{
  item_type?: string | null;
  name?: string | null;
  quantity?: number | null;
  unit_price_cents?: number | null;
  discount_cents?: number | null;
}>) {
  return items.map((item) => ({
    item_type: item.item_type || "custom",
    name: item.name || null,
    quantity: typeof item.quantity === "number" ? item.quantity : 0,
    unit_price_cents:
      typeof item.unit_price_cents === "number" ? item.unit_price_cents : 0,
    discount_cents: typeof item.discount_cents === "number" ? item.discount_cents : 0,
  }));
}

function normalizeApplyChangeItems(
  items: ApplyChangeBody["items"],
  currentItems: EditableSalesQuoteItemRow[]
) {
  if (!Array.isArray(items)) {
    throw new QuoteAccessError(400, "INVALID_ITEMS", "items deve ser um array.");
  }

  if (items.length === 0) {
    throw new QuoteAccessError(
      400,
      "INVALID_ITEMS",
      "Informe pelo menos um item para gerar a nova versao."
    );
  }

  const currentItemsById = new Map(
    currentItems
      .map((item) => [String(item.id || "").trim(), item] as const)
      .filter(([itemId]) => itemId.length > 0)
  );

  return items.map((item, index) => {
    const record =
      item && typeof item === "object" ? (item as NonNullable<ApplyChangeBody["items"]>[number]) : null;
    const name = String(record?.name || "").trim();

    if (!name) {
      throw new QuoteAccessError(
        400,
        "INVALID_ITEM_NAME",
        `Item ${index + 1} sem nome.`
      );
    }

    const itemType = normalizeApplyChangeItemType(record?.item_type, index);
    const quantity = parseIntegerField(record?.quantity, "INVALID_ITEM_QUANTITY", "quantity");
    const unitPriceCents = parseIntegerField(
      record?.unit_price_cents,
      "INVALID_ITEM_UNIT_PRICE",
      "unit_price_cents"
    );
    const rawDiscountCents = parseIntegerField(
      record?.discount_cents ?? 0,
      "INVALID_ITEM_DISCOUNT",
      "discount_cents"
    );

    if (quantity <= 0) {
      throw new QuoteAccessError(
        400,
        "INVALID_ITEM_QUANTITY",
        `Item ${index + 1} precisa ter quantidade maior que zero.`
      );
    }

    if (unitPriceCents < 0) {
      throw new QuoteAccessError(
        400,
        "INVALID_ITEM_UNIT_PRICE",
        `Item ${index + 1} nao pode ter preco unitario negativo.`
      );
    }

    const subtotalCents = quantity * unitPriceCents;

    if (rawDiscountCents < 0 || rawDiscountCents > subtotalCents) {
      throw new QuoteAccessError(
        400,
        "INVALID_ITEM_DISCOUNT",
        `Item ${index + 1} possui desconto invalido.`
      );
    }

    const inputItemId = String(record?.id || "").trim();
    const previousItem = inputItemId ? currentItemsById.get(inputItemId) || null : null;
    const previousMetadata =
      previousItem?.metadata && typeof previousItem.metadata === "object"
        ? { ...previousItem.metadata }
        : { source: null, frozen_at: new Date().toISOString() };

    return {
      id: inputItemId || null,
      itemType,
      name,
      description: normalizeOptionalText(record?.description),
      quantity,
      unitPriceCents,
      discountCents: rawDiscountCents,
      subtotalCents,
      totalCents: Math.max(subtotalCents - rawDiscountCents, 0),
      sortOrder: index + 1,
      sku: previousItem?.sku || null,
      metadata: previousMetadata,
    } satisfies NormalizedApplyChangeItem;
  });
}

function areApplyChangeItemsEqual(
  currentItems: EditableSalesQuoteItemRow[],
  nextItems: NormalizedApplyChangeItem[]
) {
  if (currentItems.length !== nextItems.length) {
    return false;
  }

  return currentItems.every((item, index) => {
    const nextItem = nextItems[index];
    if (!nextItem) {
      return false;
    }

    return (
      String(item.item_type || "custom").trim().toLowerCase() === nextItem.itemType &&
      String(item.name || "").trim() === nextItem.name &&
      normalizeOptionalText(item.description) === nextItem.description &&
      Number(item.quantity || 0) === nextItem.quantity &&
      Number(item.unit_price_cents || 0) === nextItem.unitPriceCents &&
      Number(item.discount_cents || 0) === nextItem.discountCents
    );
  });
}

function buildUpdatedQuote(args: {
  quote: SalesQuoteRow;
  body: ApplyChangeBody;
  currentItems: EditableSalesQuoteItemRow[];
}) {
  const subtotalCents = Number(args.quote.subtotal_cents || 0);
  const currentMetadata = getQuoteMetadata(args.quote);
  const nextMetadata = { ...currentMetadata };
  const appliedChanges: Record<string, { from: unknown; to: unknown }> = {};
  let metadataChanged = false;

  let nextTitle = args.quote.title ?? null;
  let nextDiscountCents = Number(args.quote.discount_cents || 0);
  let nextSubtotalCents = subtotalCents;
  let nextCustomerNotes = args.quote.customer_notes ?? null;
  let nextInternalNotes = args.quote.internal_notes ?? null;
  let nextPaymentTerms = readOfficialOrMetadataText(
    args.quote,
    currentMetadata,
    "payment_terms"
  );
  let nextDeliveryTerms = readOfficialOrMetadataText(
    args.quote,
    currentMetadata,
    "delivery_terms"
  );
  let nextWarrantyTerms = readOfficialOrMetadataText(
    args.quote,
    currentMetadata,
    "warranty_terms"
  );
  let nextValidUntil = readOfficialOrMetadataText(
    args.quote,
    currentMetadata,
    "valid_until"
  );
  let nextItems: NormalizedApplyChangeItem[] = args.currentItems.map((item, index) => ({
    id: item.id,
    itemType: normalizeApplyChangeItemType(item.item_type || "custom", index),
    name: String(item.name || "").trim(),
    description: normalizeOptionalText(item.description),
    quantity: Number(item.quantity || 0),
    unitPriceCents: Number(item.unit_price_cents || 0),
    discountCents: Number(item.discount_cents || 0),
    subtotalCents: Number(item.subtotal_cents || 0),
    totalCents: Number(item.total_cents || 0),
    sortOrder: Number(item.sort_order || index + 1),
    sku: item.sku || null,
    metadata:
      item.metadata && typeof item.metadata === "object"
        ? { ...item.metadata }
        : { source: null, frozen_at: new Date().toISOString() },
  }));
  let itemsChanged = false;

  if (hasOwn(args.body, "title")) {
    const normalizedTitle = normalizeOptionalText(args.body.title);

    if (normalizedTitle !== nextTitle) {
      appliedChanges.title = {
        from: nextTitle,
        to: normalizedTitle,
      };
      nextTitle = normalizedTitle;
    }
  }

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

  if (hasOwn(args.body, "items")) {
    const normalizedItems = normalizeApplyChangeItems(args.body.items, args.currentItems);

    if (!areApplyChangeItemsEqual(args.currentItems, normalizedItems)) {
      appliedChanges.items = {
        from: summarizeItemsForAudit(args.currentItems),
        to: summarizeItemsForAudit(
          normalizedItems.map((item) => ({
            item_type: item.itemType,
            name: item.name,
            quantity: item.quantity,
            unit_price_cents: item.unitPriceCents,
            discount_cents: item.discountCents,
          }))
        ),
      };
      nextItems = normalizedItems;
      itemsChanged = true;
    }

    const itemsSubtotalCents = normalizedItems.reduce((sum, item) => sum + item.subtotalCents, 0);
    const itemsDiscountCents = normalizedItems.reduce((sum, item) => sum + item.discountCents, 0);

    if (hasOwn(args.body, "discount_cents") && nextDiscountCents !== itemsDiscountCents) {
      throw new QuoteAccessError(
        400,
        "INVALID_DISCOUNT_CENTS",
        "Quando items sao enviados, discount_cents deve corresponder ao desconto total dos itens."
      );
    }

    nextSubtotalCents = itemsSubtotalCents;
    nextDiscountCents = itemsDiscountCents;
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
    const currentValue = readOfficialOrMetadataText(args.quote, currentMetadata, key);

    if (normalizedValue !== currentValue) {
      appliedChanges[key] = {
        from: currentValue,
        to: normalizedValue,
      };
      nextMetadata[key] = normalizedValue;
      metadataChanged = true;

      if (key === "payment_terms") {
        nextPaymentTerms = normalizedValue;
      } else if (key === "delivery_terms") {
        nextDeliveryTerms = normalizedValue;
      } else {
        nextWarrantyTerms = normalizedValue;
      }
    }
  }

  if (hasOwn(args.body, "validity_days")) {
    const normalizedValidityDays = normalizeOptionalText(args.body.validity_days);
    const currentValidityDays =
      normalizeOptionalText(currentMetadata.validity_days) || nextValidUntil;

    if (normalizedValidityDays !== currentValidityDays) {
      appliedChanges.validity_days = {
        from: currentValidityDays,
        to: normalizedValidityDays,
      };
      nextMetadata.validity_days = normalizedValidityDays;
      nextMetadata.valid_until = normalizedValidityDays;
      metadataChanged = true;
      nextValidUntil = normalizedValidityDays;
    }
  }

  if (Object.keys(appliedChanges).length === 0) {
    throw new QuoteAccessError(
      400,
      "NO_APPLICABLE_CHANGES",
      "Nenhuma alteracao aplicavel foi informada."
    );
  }

  const nextTotalCents = Math.max(nextSubtotalCents - nextDiscountCents, 0);

  const updatedQuote: SalesQuoteRow = {
    ...args.quote,
    title: nextTitle,
    status: "pending_review",
    subtotal_cents: nextSubtotalCents,
    discount_cents: nextDiscountCents,
    total_cents: nextTotalCents,
    customer_notes: nextCustomerNotes,
    internal_notes: nextInternalNotes,
    payment_terms: nextPaymentTerms,
    delivery_terms: nextDeliveryTerms,
    warranty_terms: nextWarrantyTerms,
    valid_until: nextValidUntil,
    metadata: metadataChanged ? nextMetadata : args.quote.metadata,
  };

  return {
    subtotalCents: nextSubtotalCents,
    updatedQuote,
    nextMetadata,
    metadataChanged,
    nextDiscountCents,
    nextTotalCents,
    appliedChanges,
    nextItems,
    itemsChanged,
  };
}

async function loadQuoteItems(args: { supabase: any; quoteId: string }) {
  const { data, error } = await args.supabase
    .from("sales_quote_items")
    .select(
      "id, quote_id, organization_id, store_id, item_type, name, description, quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents, sort_order, sku, metadata, created_at, updated_at"
    )
    .eq("quote_id", args.quoteId)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Falha ao carregar itens do orcamento: ${error.message}`);
  }

  const items = (data || []) as EditableSalesQuoteItemRow[];

  if (items.length === 0) {
    throw new QuoteAccessError(
      400,
      "QUOTE_WITHOUT_ITEMS",
      "Nao e possivel aplicar alteracao em um orcamento sem itens."
    );
  }

  return items;
}

async function replaceQuoteItems(args: {
  supabase: any;
  quote: SalesQuoteRow;
  items: NormalizedApplyChangeItem[];
}) {
  const { error: deleteError } = await args.supabase
    .from("sales_quote_items")
    .delete()
    .eq("quote_id", args.quote.id);

  if (deleteError) {
    throw new Error(`Falha ao remover itens antigos do orcamento: ${deleteError.message}`);
  }

  const rows = args.items.map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    quote_id: args.quote.id,
    organization_id: args.quote.organization_id,
    store_id: args.quote.store_id,
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

  const { error: insertError } = await args.supabase.from("sales_quote_items").insert(rows);

  if (insertError) {
    throw new Error(`Falha ao salvar novos itens do orcamento: ${insertError.message}`);
  }
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
  let itemsReplaced = false;
  let revertContext:
    | {
        supabase: any;
        originalQuote: SalesQuoteRow;
        originalItems: EditableSalesQuoteItemRow[];
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
      nextItems,
      itemsChanged,
    } = buildUpdatedQuote({
      quote: scope.quote,
      body: safeBody,
      currentItems: items,
    });

    const snapshot = buildQuoteSnapshot({
      quote: updatedQuote,
      items: nextItems.map((item, index) => ({
        id: item.id || `pending-item-${index + 1}`,
        quote_id: scope.quote.id,
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
        created_at: null,
        updated_at: null,
      })),
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
      validUntil: normalizeOptionalText(nextMetadata.valid_until),
      items: nextItems.map((item) => ({
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountCents: item.discountCents,
        totalCents: item.totalCents,
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
      originalItems: items,
    };

    const quoteUpdatePayload: Record<string, unknown> = {
      title: updatedQuote.title,
      status: "pending_review",
      subtotal_cents: Number(updatedQuote.subtotal_cents || 0),
      discount_cents: nextDiscountCents,
      total_cents: nextTotalCents,
      customer_notes: updatedQuote.customer_notes,
      internal_notes: updatedQuote.internal_notes,
      payment_terms: updatedQuote.payment_terms ?? null,
      delivery_terms: updatedQuote.delivery_terms ?? null,
      warranty_terms: updatedQuote.warranty_terms ?? null,
      valid_until: updatedQuote.valid_until ?? null,
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

    if (itemsChanged) {
      await replaceQuoteItems({
        supabase: scope.supabase,
        quote: scope.quote,
        items: nextItems,
      });
      itemsReplaced = true;
    }

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
            title: revertContext.originalQuote.title,
            status: revertContext.originalQuote.status,
            subtotal_cents: revertContext.originalQuote.subtotal_cents,
            discount_cents: revertContext.originalQuote.discount_cents,
            total_cents: revertContext.originalQuote.total_cents,
            customer_notes: revertContext.originalQuote.customer_notes,
            internal_notes: revertContext.originalQuote.internal_notes,
            payment_terms: revertContext.originalQuote.payment_terms ?? null,
            delivery_terms: revertContext.originalQuote.delivery_terms ?? null,
            warranty_terms: revertContext.originalQuote.warranty_terms ?? null,
            valid_until: revertContext.originalQuote.valid_until ?? null,
            metadata: revertContext.originalQuote.metadata,
          })
          .eq("id", revertContext.originalQuote.id);
      } catch {
        // best effort
      }
    }

    if (revertContext && itemsReplaced && !versionCreated) {
      try {
        await revertContext.supabase
          .from("sales_quote_items")
          .delete()
          .eq("quote_id", revertContext.originalQuote.id);

        await revertContext.supabase.from("sales_quote_items").insert(
          revertContext.originalItems.map((item) => ({
            id: item.id,
            quote_id: item.quote_id,
            organization_id: item.organization_id,
            store_id: item.store_id,
            item_type: item.item_type || null,
            name: item.name,
            description: item.description,
            quantity: item.quantity,
            unit_price_cents: item.unit_price_cents,
            discount_cents: item.discount_cents,
            subtotal_cents: item.subtotal_cents,
            total_cents: item.total_cents,
            sort_order: item.sort_order,
            sku: item.sku,
            metadata: item.metadata,
          }))
        );
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
