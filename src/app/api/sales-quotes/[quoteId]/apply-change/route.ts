import { NextResponse } from "next/server";
import { loadStoreBrandVisualPolicy } from "@/lib/server/store-brand-visual-policy";
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
import { requestQuoteSendApprovalBySystem } from "@/lib/server/sales-quotes/quote-approval-request";
import {
  deliverQuoteApprovalRequest,
  type QuoteApprovalDeliveryResult,
} from "@/lib/server/sales-quotes/quote-approval-delivery";
import type { ResponsibleWhatsappTemplateContext } from "@/lib/server/assistant/responsible-whatsapp-outbound-policy";
import { loadCanonicalActivePrimaryStoreResponsible } from "@/lib/server/store-responsibles";
import {
  buildQuoteKindNotice,
  buildQuoteSnapshot,
  createQuoteVersion,
  recordQuoteGenerationFailure,
} from "@/lib/server/sales-quotes/quote-versioning";
import {
  buildAcceptedSalesQuoteRevisionOperationKey,
  ACCEPTED_REVISION_INPUT_FINGERPRINT_KEY,
  buildAcceptedSalesQuoteRevisionInputFingerprint,
  createAcceptedSalesQuoteRevisionBySystem,
  resolveAcceptedSalesQuoteRevision,
} from "@/lib/server/sales-quotes/accepted-sales-quote-revision";
import { resolveSalesQuoteKindForVersion } from "@/lib/server/sales-quotes/quote-kind";
import {
  parseValidityDays,
  resolveDisplayValidityDays,
  resolveValidUntilFromValidityDays,
} from "@/lib/sales-quotes/validity";
import {
  normalizeQuoteItemMoney,
  resolveQuoteDiscountFromItems,
  sumQuoteItemMoneyTotals,
} from "@/lib/server/sales-quotes/money";
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
type QuoteSupabaseClient = Awaited<ReturnType<typeof resolveAuthorizedExistingQuote>>["supabase"];
const ALLOWED_APPLY_CHANGE_ITEM_TYPES = ["pool", "catalog_item", "service", "custom"] as const;

type AllowedApplyChangeItemType = (typeof ALLOWED_APPLY_CHANGE_ITEM_TYPES)[number];
type EditableSalesQuoteItemRow = SalesQuoteItemRow & {
  item_type?: string | null;
};
type NormalizedApplyChangeItem = {
  id: string | null;
  commercialOpportunityId: string | null;
  profileComponentId: string | null;
  poolId: string | null;
  catalogItemId: string | null;
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

function resolveNextValidUntil(args: {
  validityDays: string | null;
  baseDateValue: unknown;
}) {
  if (args.validityDays == null) {
    return null;
  }

  if (parseValidityDays(args.validityDays) == null) {
    throw new QuoteAccessError(
      400,
      "INVALID_VALIDITY_DAYS",
      "validity_days deve ser um numero inteiro maior ou igual a zero."
    );
  }

  const resolvedValidUntil = resolveValidUntilFromValidityDays({
    validityDays: args.validityDays,
    baseDateValue: args.baseDateValue,
  });

  if (!resolvedValidUntil) {
    throw new Error("Falha ao resolver valid_until da alteracao da quote.");
  }

  return resolvedValidUntil;
}

function hasOwn(obj: object, key: keyof ApplyChangeBody) {
  return Object.prototype.hasOwnProperty.call(obj, key);
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
    const money = normalizeQuoteItemMoney({
      quantity: record?.quantity,
      unitPriceCents: record?.unit_price_cents,
      discountCents: record?.discount_cents ?? 0,
      itemIndex: index,
      errorCodes: {
        quantity: "INVALID_ITEM_QUANTITY",
        unitPriceCents: "INVALID_ITEM_UNIT_PRICE",
        discountCents: "INVALID_ITEM_DISCOUNT",
      },
    });

    const inputItemId = String(record?.id || "").trim();
    const previousItem = inputItemId ? currentItemsById.get(inputItemId) || null : null;
    const previousMetadata =
      previousItem?.metadata && typeof previousItem.metadata === "object"
        ? { ...previousItem.metadata }
        : { source: null, frozen_at: new Date().toISOString() };

    return {
      id: inputItemId || null,
      commercialOpportunityId: previousItem?.commercial_opportunity_id || null,
      profileComponentId: previousItem?.profile_component_id || null,
      poolId: previousItem?.pool_id || null,
      catalogItemId: previousItem?.catalog_item_id || null,
      itemType,
      name,
      description: normalizeOptionalText(record?.description),
      quantity: money.quantity,
      unitPriceCents: money.unitPriceCents,
      discountCents: money.discountCents,
      subtotalCents: money.subtotalCents,
      totalCents: money.totalCents,
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

export function buildUpdatedQuote(args: {
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
    commercialOpportunityId: item.commercial_opportunity_id || null,
    profileComponentId: item.profile_component_id || null,
    poolId: item.pool_id || null,
    catalogItemId: item.catalog_item_id || null,
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

  const hasBodyItems = hasOwn(args.body, "items");

  if (hasOwn(args.body, "discount_cents") && !hasBodyItems) {
    const itemTotals = sumQuoteItemMoneyTotals(nextItems);
    const parsedDiscountCents = resolveQuoteDiscountFromItems({
      quoteDiscountCents: args.body.discount_cents,
      hasQuoteDiscountCents: true,
      itemsDiscountCents: itemTotals.discountCents,
      errorCode: "INVALID_DISCOUNT_CENTS",
    });

    nextSubtotalCents = itemTotals.subtotalCents;

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

    const itemTotals = sumQuoteItemMoneyTotals(normalizedItems);
    nextSubtotalCents = itemTotals.subtotalCents;
    nextDiscountCents = resolveQuoteDiscountFromItems({
      quoteDiscountCents: args.body.discount_cents,
      hasQuoteDiscountCents: hasOwn(args.body, "discount_cents"),
      itemsDiscountCents: itemTotals.discountCents,
      errorCode: "INVALID_DISCOUNT_CENTS",
    });
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
    const currentValidityDays = resolveDisplayValidityDays({
      validityDaysValue: currentMetadata.validity_days,
      validUntilValue: nextValidUntil || currentMetadata.valid_until,
      baseDateValue: args.quote.created_at,
    });
    const nextResolvedValidUntil = resolveNextValidUntil({
      validityDays: normalizedValidityDays,
      baseDateValue: args.quote.created_at,
    });

    if (normalizedValidityDays !== currentValidityDays) {
      appliedChanges.validity_days = {
        from: currentValidityDays,
        to: normalizedValidityDays,
      };
      nextMetadata.validity_days = normalizedValidityDays;
      nextMetadata.valid_until = nextResolvedValidUntil;
      metadataChanged = true;
      nextValidUntil = nextResolvedValidUntil;
    }
  }

  if (Object.keys(appliedChanges).length === 0) {
    throw new QuoteAccessError(
      400,
      "NO_APPLICABLE_CHANGES",
      "Nenhuma alteracao aplicavel foi informada."
    );
  }

  const nextTotalCents = nextSubtotalCents - nextDiscountCents;

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
      "id, quote_id, organization_id, store_id, commercial_opportunity_id, profile_component_id, pool_id, catalog_item_id, item_type, name, description, quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents, sort_order, sku, metadata, created_at, updated_at"
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

function serializeQuoteItemsForAtomicWriter(items: NormalizedApplyChangeItem[]) {
  return items.map((item) => ({
    id: item.id,
    commercial_opportunity_id: item.commercialOpportunityId,
    profile_component_id: item.profileComponentId,
    pool_id: item.poolId,
    catalog_item_id: item.catalogItemId,
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
}

function normalizePersistedQuoteItemsForAtomicWriter(items: EditableSalesQuoteItemRow[]) {
  return items.map((item, index) => ({
    id: item.id,
    commercialOpportunityId: item.commercial_opportunity_id || null,
    profileComponentId: item.profile_component_id || null,
    poolId: item.pool_id || null,
    catalogItemId: item.catalog_item_id || null,
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
}

export async function persistQuoteChangeAtomically(args: {
  supabase: any;
  quote: SalesQuoteRow;
  updatedQuote: SalesQuoteRow;
  items: NormalizedApplyChangeItem[];
}) {
  const { data, error } = await args.supabase.rpc(
    "apply_sales_quote_change_money_and_items_by_system",
    {
      p_organization_id: args.quote.organization_id,
      p_store_id: args.quote.store_id,
      p_quote_id: args.quote.id,
      p_title: args.updatedQuote.title,
      p_status: args.updatedQuote.status,
      p_subtotal_cents: Number(args.updatedQuote.subtotal_cents || 0),
      p_discount_cents: Number(args.updatedQuote.discount_cents || 0),
      p_total_cents: Number(args.updatedQuote.total_cents || 0),
      p_customer_notes: args.updatedQuote.customer_notes,
      p_internal_notes: args.updatedQuote.internal_notes,
      p_payment_terms: args.updatedQuote.payment_terms ?? null,
      p_delivery_terms: args.updatedQuote.delivery_terms ?? null,
      p_warranty_terms: args.updatedQuote.warranty_terms ?? null,
      p_valid_until: args.updatedQuote.valid_until ?? null,
      p_metadata: args.updatedQuote.metadata ?? {},
      p_items: serializeQuoteItemsForAtomicWriter(args.items),
    }
  );

  if (error) {
    throw new Error(`Falha ao aplicar alteracao atomica do orcamento: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row || row.quote_id !== args.quote.id) {
    throw new Error("Falha ao aplicar alteracao atomica do orcamento: retorno invalido.");
  }

  if (
    Number(row.item_count || 0) !== args.items.length ||
    Number(row.subtotal_cents || 0) !== Number(args.updatedQuote.subtotal_cents || 0) ||
    Number(row.discount_cents || 0) !== Number(args.updatedQuote.discount_cents || 0) ||
    Number(row.total_cents || 0) !== Number(args.updatedQuote.total_cents || 0)
  ) {
    throw new Error("Falha ao aplicar alteracao atomica do orcamento: retorno divergente.");
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

async function loadAcceptedRevisionReplay(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  quoteId: string;
  changeRequestId?: string | null;
  inputFingerprint: string;
  quoteMetadata: unknown;
}) {
  const changeRequestId = String(args.changeRequestId || "").trim();
  if (!changeRequestId) return null;

  const operationKey = buildAcceptedSalesQuoteRevisionOperationKey(changeRequestId);
  const { data, error } = await args.supabase
    .from("p9_accepted_quote_revisions")
    .select(
      "id, quote_id, source_quote_version_id, target_quote_version_id, source_acceptance_event_id, commercial_opportunity_id, lifecycle_cycle, operation_key"
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("quote_id", args.quoteId)
    .eq("operation_key", operationKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao verificar replay da revisao aceita: ${error.message}`);
  }

  if (!data?.id) return null;

  const metadata =
    args.quoteMetadata && typeof args.quoteMetadata === "object"
      ? (args.quoteMetadata as Record<string, unknown>)
      : null;
  if (metadata?.[ACCEPTED_REVISION_INPUT_FINGERPRINT_KEY] !== args.inputFingerprint) {
    throw new QuoteAccessError(
      409,
      "ACCEPTED_REVISION_OPERATION_KEY_CONFLICT",
      "O pedido de alteracao diverge da operacao de revisao ja materializada."
    );
  }

  return {
    revisionId: String(data.id),
    quoteId: String(data.quote_id),
    sourceQuoteVersionId: String(data.source_quote_version_id),
    targetQuoteVersionId: String(data.target_quote_version_id),
    sourceAcceptanceEventId: String(data.source_acceptance_event_id),
    commercialOpportunityId: String(data.commercial_opportunity_id),
    lifecycleCycle: Number(data.lifecycle_cycle),
    operationKey,
  };
}

async function loadRevisionVersionForApproval(args: {
  supabase: QuoteSupabaseClient;
  organizationId: string;
  storeId: string;
  quoteId: string;
  quoteVersionId: string;
}) {
  const { data, error } = await args.supabase
    .from("sales_quote_versions")
    .select("id, quote_id, organization_id, store_id, version_number, status, sent_at, store_file_id")
    .eq("id", args.quoteVersionId)
    .eq("quote_id", args.quoteId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar a versao revisada para aprovacao: ${error.message}`);
  }
  if (
    !data?.id ||
    String(data.id) !== args.quoteVersionId ||
    String(data.quote_id) !== args.quoteId ||
    Number(data.version_number) < 1 ||
    String(data.status || "").trim() !== "pending_review" ||
    data.sent_at ||
    !String(data.store_file_id || "").trim()
  ) {
    throw new Error("P9_QUOTE_APPROVAL_REVISION_VERSION_INVALID");
  }

  return {
    id: String(data.id),
    versionNumber: Number(data.version_number),
    storeFileId: String(data.store_file_id),
  };
}

function buildQuoteApprovalReportSnapshot(args: {
  quote: SalesQuoteRow;
  quoteVersionId: string;
  versionNumber: number;
  storeFileId: string;
}) {
  const metadata = args.quote.metadata && typeof args.quote.metadata === "object"
    ? args.quote.metadata
    : {};
  const currency = typeof metadata.currency === "string" && metadata.currency.trim()
    ? metadata.currency.trim().toUpperCase()
    : "BRL";

  return {
    quote_id: args.quote.id,
    quote_version_id: args.quoteVersionId,
    quote_number: String(args.quote.quote_number || "").trim(),
    quote_version_number: String(args.versionNumber),
    customer_name: args.quote.customer_name || null,
    payment_terms: args.quote.payment_terms || null,
    delivery_terms: args.quote.delivery_terms || null,
    valid_until: args.quote.valid_until || null,
    notes: args.quote.customer_notes || null,
    subtotal_cents: Number(args.quote.subtotal_cents || 0),
    discount_cents: Number(args.quote.discount_cents || 0),
    total_cents: Number(args.quote.total_cents || 0),
    currency,
    quote_pdf_store_file_id: args.storeFileId,
  };
}

async function requestApprovalForRevision(args: {
  supabase: QuoteSupabaseClient;
  organizationId: string;
  storeId: string;
  quote: SalesQuoteRow;
  commercialOpportunityId: string;
  lifecycleCycle: number;
  quoteVersionId: string;
}) {
  const responsible = await loadCanonicalActivePrimaryStoreResponsible({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
  });
  if (!responsible.ok) {
    throw new Error(`P9_QUOTE_APPROVAL_RESPONSIBLE_UNAVAILABLE:${responsible.reason}`);
  }

  const version = await loadRevisionVersionForApproval({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    quoteId: args.quote.id,
    quoteVersionId: args.quoteVersionId,
  });

  return requestQuoteSendApprovalBySystem({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    responsibleId: responsible.responsible.id,
    commercialOpportunityId: args.commercialOpportunityId,
    expectedLifecycleCycle: args.lifecycleCycle,
    quoteId: args.quote.id,
    quoteVersionId: args.quoteVersionId,
    reportSnapshot: buildQuoteApprovalReportSnapshot({
      quote: args.quote,
      quoteVersionId: args.quoteVersionId,
      versionNumber: version.versionNumber,
      storeFileId: version.storeFileId,
    }),
  });
}

function buildQuoteApprovalOpeningTemplateContext(
  quote: SalesQuoteRow,
): ResponsibleWhatsappTemplateContext {
  return {
    templateKind: "operational_approval",
    body: "Uma versao revisada do orcamento aguarda aprovacao comercial.",
    context: {
      situation: "Uma versao revisada do orcamento aguarda aprovacao comercial.",
      decision: "aprovar ou recusar a versao revisada do orcamento",
    },
    relatedLeadId: quote.lead_id,
    relatedConversationId: quote.conversation_id,
  };
}

type RevisionApprovalDeliveryResult = QuoteApprovalDeliveryResult | {
  ok: true;
  requestId: string;
  requestStatus: string;
  state: "already_reconciled";
};

function revisionDeliveryState(delivery: RevisionApprovalDeliveryResult): string {
  return "state" in delivery ? delivery.state : "completed";
}

async function deliverRevisionApproval(args: {
  supabase: QuoteSupabaseClient;
  requestId: string;
  requestStatus: string;
  quote: SalesQuoteRow;
}): Promise<RevisionApprovalDeliveryResult> {
  if (args.requestStatus === "awaiting_responsible" || args.requestStatus === "approved") {
    return {
      ok: true,
      requestId: args.requestId,
      requestStatus: args.requestStatus,
      state: "already_reconciled",
    };
  }
  if (args.requestStatus === "dispatch_uncertain") {
    return {
      ok: false,
      requestId: args.requestId,
      state: "dispatch_uncertain",
      reason: "P9_DELIVERY_DISPATCH_UNCERTAIN_REQUIRES_RECONCILIATION",
      requestStatus: args.requestStatus,
    };
  }
  try {
    return await deliverQuoteApprovalRequest({
      requestId: args.requestId,
      supabase: args.supabase as unknown as NonNullable<Parameters<typeof deliverQuoteApprovalRequest>[0]["supabase"]>,
      openingTemplateContext: buildQuoteApprovalOpeningTemplateContext(args.quote),
    });
  } catch {
    return {
      ok: false,
      requestId: args.requestId,
      state: "delivery_exception",
      reason: "P9_DELIVERY_EXCEPTION_REQUIRES_RECONCILIATION",
      requestStatus: args.requestStatus,
    };
  }
}

function deliveryFailureResponse(args: {
  delivery: Exclude<RevisionApprovalDeliveryResult, { ok: true }>;
  approvalRequestId: string;
  revisionId: string;
  versionId: string;
}) {
  return NextResponse.json(
    {
      ok: false,
      error: "QUOTE_APPROVAL_DELIVERY_FAILED",
      approvalRequestId: args.approvalRequestId,
      revisionId: args.revisionId,
      versionId: args.versionId,
      deliveryState: args.delivery.state,
      deliveryReason: args.delivery.reason,
      retryable: args.delivery.state !== "uncertain" && args.delivery.state !== "finalization_uncertain" && args.delivery.state !== "dispatch_uncertain",
    },
    { status: 503 },
  );
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
  let acceptedRevisionFlow = false;
  let acceptedRevisionRpcCalled = false;
  let acceptedRevisionResult: Awaited<ReturnType<typeof createAcceptedSalesQuoteRevisionBySystem>> | null = null;

  try {
    const body = (await request.json().catch(() => null)) as ApplyChangeBody | null;
    const safeBody = body && typeof body === "object" ? body : {};

    const { quoteId: rawQuoteId } = await context.params;
    const quoteId = String(rawQuoteId || "").trim();
    const scope = await resolveAuthorizedExistingQuote(quoteId);
    const requestedChangeId = String(safeBody.changeRequestId || scope.quote.last_change_request_id || "").trim();
    const acceptedRevisionInputFingerprint = buildAcceptedSalesQuoteRevisionInputFingerprint(
      safeBody as Record<string, unknown>,
      requestedChangeId,
    );
    if (String(scope.quote.status || "").trim().toLowerCase() !== "changes_requested") {
      const replay = await loadAcceptedRevisionReplay({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        quoteId: scope.quote.id,
        changeRequestId: requestedChangeId,
        inputFingerprint: acceptedRevisionInputFingerprint,
        quoteMetadata: scope.quote.metadata,
      });

      if (replay) {
        try {
          const approval = await requestApprovalForRevision({
            supabase: scope.supabase,
            organizationId: scope.organizationId,
            storeId: scope.store.id,
            quote: scope.quote,
            commercialOpportunityId: replay.commercialOpportunityId,
            lifecycleCycle: replay.lifecycleCycle,
            quoteVersionId: replay.targetQuoteVersionId,
          });
          const delivery = await deliverRevisionApproval({
            supabase: scope.supabase,
            requestId: approval.requestId,
            requestStatus: approval.status,
            quote: scope.quote,
          });
          if (!delivery.ok) {
            return deliveryFailureResponse({
              delivery,
              approvalRequestId: approval.requestId,
              revisionId: replay.revisionId,
              versionId: replay.targetQuoteVersionId,
            });
          }
          return NextResponse.json({
            ok: true,
            outcome: "replayed",
            quoteId: replay.quoteId,
            status: "pending_review",
            changeRequestId: requestedChangeId,
            previousVersionId: replay.sourceQuoteVersionId,
            versionId: replay.targetQuoteVersionId,
            revisionId: replay.revisionId,
            acceptanceEventId: replay.sourceAcceptanceEventId,
            approvalRequestId: approval.requestId,
            approvalStatus: approval.status,
            approvalCreated: approval.created,
            deliveryState: revisionDeliveryState(delivery),
            deliveryRequestStatus: delivery.requestStatus,
          });
        } catch {
          return NextResponse.json(
            {
              ok: false,
              error: "QUOTE_REVISION_APPROVAL_REQUEST_FAILED",
              revisionId: replay.revisionId,
              versionId: replay.targetQuoteVersionId,
              retryable: true,
            },
            { status: 503 },
          );
        }
      }
    }
    const acceptedRevision =
      String(scope.quote.status || "").trim().toLowerCase() === "changes_requested"
        ? await resolveAcceptedSalesQuoteRevision({
            supabase: scope.supabase,
            organizationId: scope.organizationId,
            storeId: scope.store.id,
            commercialOpportunityId: scope.quote.commercial_opportunity_id,
            quoteId: scope.quote.id,
            quoteVersionId: scope.quote.current_version_id,
          })
        : { kind: "not_accepted" as const };

    const acceptedRevisionDetails = acceptedRevision.kind === "accepted" ? acceptedRevision : null;
    if (acceptedRevisionDetails) {
      acceptedRevisionFlow = true;
    }
    if (!acceptedRevisionFlow) {
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
    let previousQuoteKind: string | null = null;
    if (previousVersionId) {
      const { data: previousVersionData, error: previousVersionError } = await scope.supabase
        .from("sales_quote_versions")
        .select("id, quote_id, organization_id, store_id, quote_kind")
        .eq("id", previousVersionId)
        .eq("quote_id", scope.quote.id)
        .eq("organization_id", scope.organizationId)
        .eq("store_id", scope.store.id)
        .maybeSingle();

      if (previousVersionError) {
        throw new Error(`Falha ao carregar quote_kind da versao atual: ${previousVersionError.message}`);
      }

      previousQuoteKind =
        typeof previousVersionData?.quote_kind === "string"
          ? previousVersionData.quote_kind
          : null;
    }
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

    if (acceptedRevisionDetails) {
      nextMetadata[ACCEPTED_REVISION_INPUT_FINGERPRINT_KEY] =
        acceptedRevisionInputFingerprint;
    }

    const quoteKind = await resolveSalesQuoteKindForVersion({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      quoteId: scope.quote.id,
      commercialOpportunityId: updatedQuote.commercial_opportunity_id,
      fallbackQuoteKind: previousQuoteKind,
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
      quoteKind,
    });
    failureSnapshot = snapshot;

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

    const pdfBytes = await buildQuotePdf({
      storeName: scope.store.name,
      storeLogo,
      brandVisual: brandVisualPolicy.configured
        ? {
            primaryColor: brandVisualPolicy.primaryColor,
            secondaryColor: brandVisualPolicy.secondaryColor,
            documentFooter: brandVisualPolicy.documentFooter,
          }
        : null,
      quoteNumber: String(updatedQuote.quote_number || "").trim() || updatedQuote.id,
      quoteKind,
      quoteKindNotice: buildQuoteKindNotice(quoteKind),
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
      versionNumber: null,
      operationKey: acceptedRevisionFlow
        ? buildAcceptedSalesQuoteRevisionOperationKey(changeRequest.id)
        : null,
      pdfBytes,
    });

    if (acceptedRevisionDetails) {
      const operationKey = buildAcceptedSalesQuoteRevisionOperationKey(changeRequest.id);
      const revisionSnapshot = {
        ...snapshot,
        generatedAt: changeRequest.created_at || snapshot.generatedAt,
      };
      const revisionPayload = {
        items: serializeQuoteItemsForAtomicWriter(nextItems),
        quote_snapshot: revisionSnapshot,
        subtotal_cents: Number(updatedQuote.subtotal_cents || 0),
        discount_cents: nextDiscountCents,
        total_cents: nextTotalCents,
        title: updatedQuote.title,
        customer_notes: updatedQuote.customer_notes,
        internal_notes: updatedQuote.internal_notes,
        payment_terms: updatedQuote.payment_terms ?? null,
        delivery_terms: updatedQuote.delivery_terms ?? null,
        warranty_terms: updatedQuote.warranty_terms ?? null,
        metadata: nextMetadata,
        valid_until: updatedQuote.valid_until ?? null,
        store_file_id: storedFile.storeFileId,
        storage_bucket: storedFile.storageBucket,
        storage_path: storedFile.storagePath,
        original_filename: storedFile.originalFilename,
        mime_type: "application/pdf",
        size_bytes: storedFile.sizeBytes,
        quote_kind: quoteKind,
      };

      acceptedRevisionRpcCalled = true;
      const revision = await createAcceptedSalesQuoteRevisionBySystem({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        commercialOpportunityId: acceptedRevisionDetails.commercialOpportunityId,
        expectedLifecycleCycle: acceptedRevisionDetails.lifecycleCycle,
        quoteId: acceptedRevisionDetails.quoteId,
        sourceQuoteVersionId: acceptedRevisionDetails.quoteVersionId,
        sourceAcceptanceEventId: acceptedRevisionDetails.acceptanceEventId,
        changeRequestId: changeRequest.id,
        operationKey,
        revision: revisionPayload,
      });
      acceptedRevisionResult = revision;

      const approval = await requestApprovalForRevision({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        quote: updatedQuote,
        commercialOpportunityId: acceptedRevisionDetails.commercialOpportunityId,
        lifecycleCycle: acceptedRevisionDetails.lifecycleCycle,
        quoteVersionId: revision.targetQuoteVersionId,
      });
      const delivery = await deliverRevisionApproval({
        supabase: scope.supabase,
        requestId: approval.requestId,
        requestStatus: approval.status,
        quote: updatedQuote,
      });
      if (!delivery.ok) {
        return deliveryFailureResponse({
          delivery,
          approvalRequestId: approval.requestId,
          revisionId: revision.revisionId,
          versionId: revision.targetQuoteVersionId,
        });
      }

      return NextResponse.json({
        ok: true,
        outcome: revision.outcome,
        quoteId: revision.quoteId,
        quoteNumber: updatedQuote.quote_number,
        status: revision.quoteStatus,
        changeRequestId: changeRequest.id,
        previousVersionId: revision.sourceQuoteVersionId,
        versionId: revision.targetQuoteVersionId,
        revisionId: revision.revisionId,
        acceptanceEventId: revision.sourceAcceptanceEventId,
        approvalRequestId: approval.requestId,
        approvalStatus: approval.status,
        approvalCreated: approval.created,
        deliveryState: revisionDeliveryState(delivery),
        deliveryRequestStatus: delivery.requestStatus,
        totalCents: nextTotalCents,
        appliedChanges,
      });
    }

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

    if (itemsChanged) {
      await persistQuoteChangeAtomically({
        supabase: scope.supabase,
        quote: scope.quote,
        updatedQuote,
        items: nextItems,
      });
      quoteUpdated = true;
      itemsReplaced = true;
    } else {
      const { error: quoteUpdateError } = await scope.supabase
        .from("sales_quotes")
        .update(quoteUpdatePayload)
        .eq("id", scope.quote.id);

      if (quoteUpdateError) {
        throw new Error(`Falha ao atualizar sales_quotes: ${quoteUpdateError.message}`);
      }
      quoteUpdated = true;
    }

    const versionRow = await createQuoteVersion({
      supabase: scope.supabase,
      quote: updatedQuote,
      storeFileId: storedFile.storeFileId,
      storageBucket: storedFile.storageBucket,
      storagePath: storedFile.storagePath,
      originalFilename: storedFile.originalFilename,
      sizeBytes: storedFile.sizeBytes,
      quoteSnapshot: snapshot,
      nextQuoteStatus: "pending_review",
      quoteKind,
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
    if (acceptedRevisionFlow) {
      return NextResponse.json(
        {
          ok: false,
          error: acceptedRevisionResult
            ? "QUOTE_REVISION_APPROVAL_REQUEST_FAILED"
            : "QUOTE_REVISION_FAILED",
          ...(acceptedRevisionResult
            ? {
                revisionId: acceptedRevisionResult.revisionId,
                versionId: acceptedRevisionResult.targetQuoteVersionId,
              }
            : {}),
          retryable: true,
        },
        { status: 503 },
      );
    }
    if (!acceptedRevisionFlow && revertContext && quoteUpdated && !versionCreated) {
      try {
        if (itemsReplaced) {
          await persistQuoteChangeAtomically({
            supabase: revertContext.supabase,
            quote: revertContext.originalQuote,
            updatedQuote: revertContext.originalQuote,
            items: normalizePersistedQuoteItemsForAtomicWriter(revertContext.originalItems),
          });
        } else {
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
        }
      } catch {
        // best effort
      }
    }

    if (storedFile && !versionCreated && (!acceptedRevisionFlow || !acceptedRevisionRpcCalled)) {
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

    if (!acceptedRevisionFlow && revertContext && failureSnapshot && !versionCreated) {
      try {
        await recordQuoteGenerationFailure({
          supabase: revertContext.supabase,
          quote: revertContext.originalQuote,
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
