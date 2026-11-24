import { createHash } from "node:crypto";
import type { SalesQuoteRow, SalesQuoteItemRow } from "./types";
import { prepareHumanQuoteEditBoundary } from "./human-quote-edit-boundary";
import {
  normalizeQuoteItemMoney,
  resolveQuoteDiscountFromItems,
  sumQuoteItemMoneyTotals,
} from "./money";
import {
  parseValidityDays,
  resolveDisplayValidityDays,
  resolveValidUntilFromValidityDays,
} from "../../sales-quotes/validity";

export class HumanQuoteDraftInputError extends Error {
  readonly status = 400;

  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "HumanQuoteDraftInputError";
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BODY_FIELDS = new Set([
  "expected_updated_at",
  "expected_current_version_id",
  "title",
  "customer_notes",
  "internal_notes",
  "payment_terms",
  "delivery_terms",
  "warranty_terms",
  "validity_days",
  "discount_cents",
  "items",
]);

const ITEM_FIELDS = new Set([
  "id",
  "item_type",
  "name",
  "description",
  "quantity",
  "unit_price_cents",
  "discount_cents",
]);

const ITEM_TYPES = new Set([
  "pool", "catalog_item", "service", "custom",
]);

function fail(code: string, message: string): never {
  throw new HumanQuoteDraftInputError(code, message);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_EDIT_INPUT", "Objeto de edicao invalido.");
  }

  return value as Record<string, unknown>;
}

function hasOwn(obj: object, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function checkFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("FORBIDDEN_EDIT_FIELD", `Campo nao editavel: ${key}.`);
    }
  }
}

function text(value: unknown): string | null {
  if (value == null) return null;

  if (typeof value !== "string") {
    fail("INVALID_EDIT_TEXT", "Campo textual invalido.");
  }

  return value.trim() || null;
}

function itemType(value: unknown) {
  const normalized = text(value)?.toLowerCase();
  const type = normalized === "pool_installation"
    ? "custom"
    : normalized;

  if (!type || !ITEM_TYPES.has(type)) {
    fail("INVALID_ITEM_TYPE", "Tipo de item invalido.");
  }

  return type;
}

function positiveValidityDays(value: unknown): number | null {
  if (value == null || value === "") return null;

  if (typeof value !== "string" && typeof value !== "number") {
    fail("INVALID_VALIDITY_DAYS", "Validade invalida.");
  }

  const parsed = parseValidityDays(String(value));

  if (
    parsed == null ||
    !Number.isInteger(Number(parsed)) ||
    Number(parsed) <= 0 ||
    Number(parsed) > 2147483647
  ) {
    fail(
      "INVALID_VALIDITY_DAYS",
      "Informe uma validade inteira positiva ou nula.",
    );
  }

  return Number(parsed);
}

type HumanQuoteEditInput = {
  quote: SalesQuoteRow;
  currentItems: SalesQuoteItemRow[];
  body: unknown;
};

function buildHumanQuoteEditRpcArgs(
  args: HumanQuoteEditInput,
  mode: "draft" | "versioned",
) {
  const { quote, currentItems } = args;
  const body = record(args.body);

  checkFields(body, BODY_FIELDS);

  const boundary = prepareHumanQuoteEditBoundary({
    quote,
    expectedUpdatedAt: body.expected_updated_at,
    expectedCurrentVersionId: body.expected_current_version_id,
  });

  if (
    mode === "draft" &&
    (
      (boundary.preservedStatus !== "draft" && boundary.preservedStatus !== "changes_requested") ||
      boundary.expectedCurrentVersionId !== null
    )
  ) {
    fail(
      "HUMAN_QUOTE_EDIT_VERSIONED_FLOW_REQUIRED",
      "Este orcamento exige o fluxo de edicao versionada.",
    );
  }

  if (
    mode === "versioned" &&
    boundary.expectedCurrentVersionId === null
  ) {
    fail(
      "HUMAN_QUOTE_EDIT_DRAFT_FLOW_REQUIRED",
      "Este orcamento ainda nao possui uma versao.",
    );
  }

  const metadata = boundary.preservedMetadata;

  const currentById = new Map<string, SalesQuoteItemRow>();

  for (const item of currentItems) {
    if (
      item.quote_id !== quote.id ||
      item.organization_id !== quote.organization_id ||
      item.store_id !== quote.store_id ||
      !UUID_RE.test(item.id)
    ) {
      fail("INVALID_CURRENT_ITEM_SCOPE", "Item fora do escopo.");
    }

    const id = item.id.toLowerCase();

    if (currentById.has(id)) {
      fail("DUPLICATE_ITEM_ID", "Item duplicado.");
    }

    currentById.set(id, item);
  }

  const inputs = hasOwn(body, "items")
    ? body.items
    : currentItems.map((item) => ({
        id: item.id,
        item_type: item.item_type,
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
        discount_cents: item.discount_cents,
      }));

  if (!Array.isArray(inputs) || inputs.length === 0) {
    fail("INVALID_ITEMS", "Informe pelo menos um item.");
  }

  const seen = new Set<string>();

  const normalized = inputs.map((raw, index) => {
    const item = record(raw);

    checkFields(item, ITEM_FIELDS);

    const id = text(item.id)?.toLowerCase() ?? null;
    const previous = id ? currentById.get(id) : undefined;

    if (id && (!UUID_RE.test(id) || !previous)) {
      fail("INVALID_ITEM_ID", "Item nao pertence ao orcamento.");
    }

    if (id && seen.has(id)) {
      fail("DUPLICATE_ITEM_ID", "Item duplicado.");
    }

    if (id) seen.add(id);

    const type = itemType(item.item_type);
    const name = text(item.name);

    if (!name) {
      fail("INVALID_ITEM_NAME", "Informe o nome do item.");
    }

    if (previous && itemType(previous.item_type) !== type) {
      fail(
        "ITEM_TYPE_CHANGE_REQUIRES_REPLACEMENT",
        "Remova o item anterior para cadastrar outro tipo.",
      );
    }

    const money = normalizeQuoteItemMoney({
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
      discountCents: item.discount_cents ?? 0,
      itemIndex: index,
      errorCodes: {
        quantity: "INVALID_ITEM_QUANTITY",
        unitPriceCents: "INVALID_ITEM_UNIT_PRICE",
        discountCents: "INVALID_ITEM_DISCOUNT",
      },
    });

    return {
      money,
      row: {
        id,
        commercial_opportunity_id:
          previous?.commercial_opportunity_id ?? null,
        profile_component_id:
          previous?.profile_component_id ?? null,
        pool_id: previous?.pool_id ?? null,
        catalog_item_id: previous?.catalog_item_id ?? null,
        item_type: type,
        name,
        description: text(item.description),
        quantity: money.quantity,
        unit_price_cents: money.unitPriceCents,
        discount_cents: money.discountCents,
        subtotal_cents: money.subtotalCents,
        total_cents: money.totalCents,
        sort_order: index + 1,
        sku: previous?.sku ?? null,
        metadata: previous?.metadata
          ? { ...previous.metadata }
          : { source: null },
      },
    };
  });

  const totals = sumQuoteItemMoneyTotals(
    normalized.map((item) => item.money),
  );

  const suppliedDiscount = body.discount_cents;

  if (
    hasOwn(body, "discount_cents") &&
    suppliedDiscount !== null &&
    (
      typeof suppliedDiscount !== "number" ||
      !Number.isSafeInteger(suppliedDiscount) ||
      suppliedDiscount < 0
    )
  ) {
    fail("INVALID_DISCOUNT_CENTS", "Desconto invalido.");
  }

  const discountCents = resolveQuoteDiscountFromItems({
    quoteDiscountCents:
      suppliedDiscount as number | null | undefined,
    hasQuoteDiscountCents: hasOwn(body, "discount_cents"),
    itemsDiscountCents: totals.discountCents,
    errorCode: "INVALID_DISCOUNT_CENTS",
  });

  const title = text(
    hasOwn(body, "title") ? body.title : quote.title,
  );

  if (!title) {
    fail("INVALID_TITLE", "Informe o titulo do orcamento.");
  }

  function editableText(
    key: "customer_notes" | "internal_notes" |
      "payment_terms" | "delivery_terms" | "warranty_terms",
  ) {
    if (hasOwn(body, key)) return text(body[key]);

    if (key === "customer_notes" || key === "internal_notes") {
      return text(quote[key]);
    }

    return text(quote[key]) ?? text(metadata[key]);
  }

  let validUntil =
    text(quote.valid_until) ?? text(metadata.valid_until);

  const validityDays = positiveValidityDays(
    hasOwn(body, "validity_days")
      ? body.validity_days
      : resolveDisplayValidityDays({
          validityDaysValue: metadata.validity_days,
          validUntilValue: validUntil,
          baseDateValue: quote.created_at,
        }),
  );

  if (hasOwn(body, "validity_days")) {
    validUntil = validityDays === null
      ? null
      : resolveValidUntilFromValidityDays({
          validityDays: String(validityDays),
          baseDateValue: quote.created_at,
        });

    if (validityDays !== null && !validUntil) {
      fail("INVALID_VALIDITY_DAYS", "Data de validade invalida.");
    }
  }

  return {
    p_organization_id: quote.organization_id,
    p_store_id: quote.store_id,
    p_quote_id: quote.id,
    p_expected_updated_at: boundary.expectedUpdatedAt,
    p_expected_current_version_id:
      boundary.expectedCurrentVersionId,
    p_title: title,
    p_subtotal_cents: totals.subtotalCents,
    p_discount_cents: discountCents,
    p_total_cents: totals.subtotalCents - discountCents,
    p_customer_notes: editableText("customer_notes"),
    p_internal_notes: editableText("internal_notes"),
    p_payment_terms: editableText("payment_terms"),
    p_delivery_terms: editableText("delivery_terms"),
    p_warranty_terms: editableText("warranty_terms"),
    p_valid_until: validUntil,
    p_validity_days: validityDays,
    p_items: normalized.map((item) => item.row),
  };
}

export function buildHumanQuoteDraftEditRpcArgs(
  args: HumanQuoteEditInput,
) {
  return buildHumanQuoteEditRpcArgs(args, "draft");
}

function stableRevisionItemId(
  operationId: string,
  quoteId: string,
  sortOrder: number,
): string {
  const hex = createHash("sha256")
    .update(`zion-human-revision:${operationId}:${quoteId}:${sortOrder}`)
    .digest("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "8" + hex.slice(13, 16),
    "8" + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function buildHumanQuoteVersionedEditRpcArgs(
  args: HumanQuoteEditInput & {
    operationId: string;
  },
) {
  if (
    typeof args.operationId !== "string" ||
    !UUID_RE.test(args.operationId)
  ) {
    fail("INVALID_REVISION_OPERATION_ID",
      "Identificador de operacao invalido.");
  }

  const operationId = args.operationId.toLowerCase();

  const normalized = buildHumanQuoteEditRpcArgs(
    args,
    "versioned",
  );

  const previousVersionId =
    normalized.p_expected_current_version_id;

  if (!previousVersionId) {
    fail(
      "HUMAN_QUOTE_EDIT_DRAFT_FLOW_REQUIRED",
      "Este orcamento ainda nao possui uma versao.",
    );
  }

  const items = normalized.p_items.map((item) => ({
    ...item,
    id: item.id ?? stableRevisionItemId(
      operationId,
      args.quote.id.toLowerCase(),
      item.sort_order,
    ),
  }));

  if (new Set(items.map((item) => item.id)).size !== items.length) {
    fail("DUPLICATE_ITEM_ID", "Item duplicado.");
  }

  return {
    ...normalized,
    p_expected_current_version_id: previousVersionId,
    p_operation_id: operationId,
    p_items: items,
  };
}
