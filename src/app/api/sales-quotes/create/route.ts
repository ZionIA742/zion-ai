import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  QuoteAccessError,
  resolveAuthorizedQuoteScope,
} from "@/lib/server/sales-quotes/quote-auth";
import {
  createProductionDataAccess,
  resolveAuthorizedOpportunityDetailCore,
  type ResolveAuthorizedOpportunityDetailResult,
  type ServiceSupabaseLike,
} from "@/lib/server/crm/resolve-authorized-opportunity-detail.internal";
import { resolveValidUntilFromValidityDays, parseValidityDays } from "@/lib/sales-quotes/validity";
import { reserveNextQuoteNumber } from "@/lib/server/sales-quotes/quote-settings";
import type { NormalizedQuoteItemInput, QuoteItemInput } from "@/lib/server/sales-quotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateQuoteBody = {
  organizationId?: string;
  storeId?: string;
  creationIdempotencyKey?: string | null;
  commercialOpportunityId?: string | null;
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
  warranty_terms?: string | null;
  validity_days?: string | null;
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
type QuoteScope = Awaited<ReturnType<typeof resolveAuthorizedQuoteScope>>;
type QuoteScopeResolver = (args: {
  requestOrganizationId?: string | null;
  requestStoreId: string;
  conversationId?: string | null;
  leadId?: string | null;
}) => Promise<QuoteScope>;
type QuoteNumberReservation = Awaited<ReturnType<typeof reserveNextQuoteNumber>>;
type QuoteNumberReservationResolver = (args: {
  supabase: QuoteScope["supabase"];
  organizationId: string;
  storeId: string;
}) => Promise<QuoteNumberReservation>;
type QuoteRow = {
  id: string;
  organization_id: string;
  store_id: string;
  commercial_opportunity_id: string | null;
  creation_idempotency_key: string | null;
  creation_request_fingerprint: string | null;
  conversation_id: string | null;
  lead_id: string | null;
  quote_number: string | null;
  title: string | null;
  status: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_notes: string | null;
  internal_notes: string | null;
  warranty_terms: string | null;
  valid_until: string | null;
  subtotal_cents: number | null;
  discount_cents: number | null;
  total_cents: number | null;
  current_version_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};
type QuoteItemRow = {
  item_type: string | null;
  name: string | null;
  description: string | null;
  quantity: number | null;
  unit_price_cents: number | null;
  discount_cents: number | null;
  subtotal_cents: number | null;
  total_cents: number | null;
  sort_order: number | null;
  sku: string | null;
};
type QuoteStageProjectionRow = {
  commercial_opportunity_id: string;
  sales_quote_id: string;
  stage: string;
  lifecycle_cycle: number;
  lifecycle_event_id: string | null;
  event_type: string | null;
  reason_code: string | null;
  stage_changed: boolean;
  outcome: string;
  stage_changed_at: string | null;
  updated_at: string | null;
};
type QuoteStageProjectionOutcome =
  | "advanced_to_orcamento"
  | "already_in_quote_stage"
  | "stage_not_eligible_for_quote_projection"
  | "idempotent_replay";

const QUOTE_STAGE_PROJECTION_SOURCE = "sales_quote_create_route";
const QUOTE_STAGE_PROJECTION_REASON_DETAILS = "sales quote created";
const ACCEPTED_QUOTE_STAGE_PROJECTION_OUTCOMES = new Set<QuoteStageProjectionOutcome>([
  "advanced_to_orcamento",
  "already_in_quote_stage",
  "stage_not_eligible_for_quote_projection",
  "idempotent_replay",
]);

function buildErrorResponse(error: unknown) {
  if (error instanceof QuoteAccessError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        message: error.message,
        ...(error.details ?? {}),
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

function resolveQuoteValidUntil(args: {
  validityDays: string | null;
  baseDate: Date;
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
    baseDateValue: args.baseDate,
  });

  if (!resolvedValidUntil) {
    throw new Error("Falha ao resolver valid_until da quote.");
  }

  return resolvedValidUntil;
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};

    for (const key of Object.keys(record).sort()) {
      normalized[key] = canonicalizeValue(record[key]);
    }

    return normalized;
  }

  return value;
}

function stableStringify(value: unknown) {
  return JSON.stringify(canonicalizeValue(value));
}

function buildCreationIdempotencyKey(value: string | null | undefined) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    throw new QuoteAccessError(
      400,
      "MISSING_CREATION_IDEMPOTENCY_KEY",
      "A creationIdempotencyKey da tentativa de criacao do orcamento e obrigatoria."
    );
  }

  if (normalized.length < 8 || normalized.length > 160) {
    throw new QuoteAccessError(
      400,
      "INVALID_CREATION_IDEMPOTENCY_KEY",
      "A creationIdempotencyKey informada e invalida."
    );
  }

  if (!/^[A-Za-z0-9:_-]+$/.test(normalized)) {
    throw new QuoteAccessError(
      400,
      "INVALID_CREATION_IDEMPOTENCY_KEY",
      "A creationIdempotencyKey informada e invalida."
    );
  }

  return normalized;
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

function buildCreationRequestFingerprint(args: {
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  conversationId: string | null;
  leadId: string | null;
  title: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerNotes: string | null;
  internalNotes: string | null;
  warrantyTerms: string | null;
  validityDays: string | null;
  discountCents: number;
  items: NormalizedCreateQuoteItem[];
}) {
  const payload = {
    organizationId: args.organizationId,
    storeId: args.storeId,
    commercialOpportunityId: args.commercialOpportunityId,
    conversationId: args.conversationId,
    leadId: args.leadId,
    title: args.title,
    customerName: args.customerName,
    customerPhone: args.customerPhone,
    customerNotes: args.customerNotes,
    internalNotes: args.internalNotes,
    warrantyTerms: args.warrantyTerms,
    validityDays: args.validityDays,
    discountCents: args.discountCents,
    items: args.items.map((item) => ({
      itemType: item.itemType,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountCents: item.discountCents,
      subtotalCents: item.subtotalCents,
      totalCents: item.totalCents,
      sku: item.sku,
      sortOrder: item.sortOrder,
    })),
  };

  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

async function loadExistingQuoteByCreationIdempotencyKey(args: {
  supabase: QuoteScope["supabase"];
  organizationId: string;
  storeId: string;
  creationIdempotencyKey: string;
}) {
  const { data, error } = await args.supabase
    .from("sales_quotes")
    .select(
      "id, organization_id, store_id, commercial_opportunity_id, creation_idempotency_key, creation_request_fingerprint, conversation_id, lead_id, quote_number, title, status, customer_name, customer_phone, customer_notes, internal_notes, warranty_terms, valid_until, subtotal_cents, discount_cents, total_cents, current_version_id, metadata, created_at, updated_at"
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("creation_idempotency_key", args.creationIdempotencyKey)
    .maybeSingle<QuoteRow>();

  if (error) {
    throw new Error(`Falha ao carregar replay de sales_quotes: ${error.message}`);
  }

  return data ?? null;
}

async function loadExistingQuoteItems(args: {
  supabase: QuoteScope["supabase"];
  quoteId: string;
}) {
  const { data, error } = await args.supabase
    .from("sales_quote_items")
    .select(
      "item_type, name, description, quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents, sort_order, sku"
    )
    .eq("quote_id", args.quoteId)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Falha ao carregar replay de sales_quote_items: ${error.message}`);
  }

  return (data ?? []) as QuoteItemRow[];
}

function areExistingQuoteItemsComplete(args: {
  existingItems: QuoteItemRow[];
  expectedItems: NormalizedCreateQuoteItem[];
}) {
  if (args.existingItems.length !== args.expectedItems.length) {
    return false;
  }

  return args.expectedItems.every((expectedItem, index) => {
    const existingItem = args.existingItems[index];

    return (
      String(existingItem?.item_type || "").trim().toLowerCase() === expectedItem.itemType &&
      String(existingItem?.name || "").trim() === expectedItem.name &&
      normalizeOptionalText(existingItem?.description) === expectedItem.description &&
      Number(existingItem?.quantity || 0) === expectedItem.quantity &&
      Number(existingItem?.unit_price_cents || 0) === expectedItem.unitPriceCents &&
      Number(existingItem?.discount_cents || 0) === expectedItem.discountCents &&
      Number(existingItem?.subtotal_cents || 0) === expectedItem.subtotalCents &&
      Number(existingItem?.total_cents || 0) === expectedItem.totalCents &&
      Number(existingItem?.sort_order || 0) === expectedItem.sortOrder &&
      normalizeOptionalText(existingItem?.sku) === expectedItem.sku
    );
  });
}

async function resolveExistingQuoteReplay(args: {
  supabase: QuoteScope["supabase"];
  organizationId: string;
  storeId: string;
  creationIdempotencyKey: string;
  creationRequestFingerprint: string;
  items: NormalizedCreateQuoteItem[];
}) {
  const existingQuote = await loadExistingQuoteByCreationIdempotencyKey(args);

  if (!existingQuote?.id) {
    throw new QuoteAccessError(
      409,
      "QUOTE_CREATION_IDEMPOTENCY_KEY_CONFLICT",
      "A criacao da quote entrou em conflito e precisa ser tentada novamente."
    );
  }

  if (
    String(existingQuote.creation_request_fingerprint || "").trim() !==
    args.creationRequestFingerprint
  ) {
    throw new QuoteAccessError(
      409,
      "QUOTE_CREATION_IDEMPOTENCY_KEY_REUSED",
      "A creationIdempotencyKey informada ja foi usada com outro payload de criacao de orcamento."
    );
  }

  const existingItems = await loadExistingQuoteItems({
    supabase: args.supabase,
    quoteId: existingQuote.id,
  });

  if (
    !areExistingQuoteItemsComplete({
      existingItems,
      expectedItems: args.items,
    })
  ) {
    throw new QuoteAccessError(
      409,
      "QUOTE_CREATION_IN_PROGRESS",
      "A quote dessa tentativa ja existe, mas a criacao ainda nao foi concluida por completo."
    );
  }

  return existingQuote;
}

function isUniqueViolation(error: unknown) {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function buildNonIdempotentUniqueConflictError() {
  return new QuoteAccessError(
    409,
    "QUOTE_CREATION_UNIQUE_CONFLICT",
    "A criacao da quote entrou em conflito com outra restricao de unicidade e precisa ser tentada novamente."
  );
}

function buildQuoteStageProjectionIdempotencyKey(args: {
  salesQuoteId: string;
  commercialOpportunityId: string;
}) {
  return `sales_quote_created_stage_projection:${args.salesQuoteId}:${args.commercialOpportunityId}`;
}

function buildCreateQuoteSuccessResponse(args: {
  quote: QuoteRow;
  itemCount: number;
  customerName: string | null;
  customerPhone: string | null;
  replayed: boolean;
}) {
  return NextResponse.json({
    ok: true,
    quoteId: args.quote.id,
    quoteNumber: args.quote.quote_number,
    status: args.quote.status,
    customerName: args.customerName,
    customerPhone: args.customerPhone,
    itemCount: args.itemCount,
    subtotalCents: Number(args.quote.subtotal_cents || 0),
    discountCents: Number(args.quote.discount_cents || 0),
    totalCents: Number(args.quote.total_cents || 0),
    replayed: args.replayed,
  });
}

async function projectCommercialOpportunityToQuoteStage(args: {
  supabase: QuoteScope["supabase"];
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  salesQuoteId: string;
}) {
  const projectionIdempotencyKey = buildQuoteStageProjectionIdempotencyKey({
    salesQuoteId: args.salesQuoteId,
    commercialOpportunityId: args.commercialOpportunityId,
  });
  const { data, error } = await args.supabase.rpc(
    "advance_commercial_opportunity_to_quote_stage_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
      p_sales_quote_id: args.salesQuoteId,
      p_idempotency_key: projectionIdempotencyKey,
      p_reason_details: QUOTE_STAGE_PROJECTION_REASON_DETAILS,
      p_source: QUOTE_STAGE_PROJECTION_SOURCE,
    }
  );

  if (error) {
    throw new QuoteAccessError(
      409,
      "QUOTE_CREATED_STAGE_PROJECTION_FAILED",
      "A quote foi criada, mas nao foi possivel concluir a projecao do stage da oportunidade comercial.",
      {
        quoteId: args.salesQuoteId,
      }
    );
  }

  const resultRow = Array.isArray(data)
    ? ((data[0] as QuoteStageProjectionRow | undefined) ?? null)
    : null;

  if (!resultRow || !ACCEPTED_QUOTE_STAGE_PROJECTION_OUTCOMES.has(resultRow.outcome as QuoteStageProjectionOutcome)) {
    throw new QuoteAccessError(
      409,
      "QUOTE_CREATED_STAGE_PROJECTION_FAILED",
      "A quote foi criada, mas nao foi possivel concluir a projecao do stage da oportunidade comercial.",
      {
        quoteId: args.salesQuoteId,
      }
    );
  }
}

async function resolveValidatedCommercialOpportunityId(args: {
  body: CreateQuoteBody | null;
  scope: QuoteScope;
  resolveOpportunityDetail: (
    commercialOpportunityId: string,
    scope: QuoteScope
  ) => Promise<ResolveAuthorizedOpportunityDetailResult>;
}) {
  const commercialOpportunityId =
    String(args.body?.commercialOpportunityId || "").trim() || null;

  if (!commercialOpportunityId) {
    throw new QuoteAccessError(
      400,
      "MISSING_COMMERCIAL_OPPORTUNITY_ID",
      "Selecione a oportunidade comercial antes de criar o orcamento."
    );
  }

  if (!args.scope.lead?.id) {
    throw new QuoteAccessError(
      400,
      "LEAD_REQUIRED_FOR_COMMERCIAL_OPPORTUNITY",
      "Nao foi possivel validar a oportunidade comercial sem uma lead autorizada."
    );
  }

  const opportunityResult = await args.resolveOpportunityDetail(
    commercialOpportunityId,
    args.scope
  );

  if (!opportunityResult.ok) {
    throw new QuoteAccessError(
      opportunityResult.error === "not_found" ? 404 : 403,
      opportunityResult.error === "not_found"
        ? "COMMERCIAL_OPPORTUNITY_NOT_FOUND"
        : "COMMERCIAL_OPPORTUNITY_INVALID",
      "A oportunidade comercial informada nao esta disponivel para este contexto."
    );
  }

  const opportunity = opportunityResult.data;

  if (opportunity.opportunity.organizationId !== args.scope.organizationId) {
    throw new QuoteAccessError(
      403,
      "COMMERCIAL_OPPORTUNITY_ORGANIZATION_MISMATCH",
      "A oportunidade comercial informada pertence a outra organizacao."
    );
  }

  if (opportunity.opportunity.storeId !== args.scope.store.id) {
    throw new QuoteAccessError(
      403,
      "COMMERCIAL_OPPORTUNITY_STORE_MISMATCH",
      "A oportunidade comercial informada pertence a outra loja."
    );
  }

  if (opportunity.originLead?.id !== args.scope.lead.id) {
    throw new QuoteAccessError(
      403,
      "COMMERCIAL_OPPORTUNITY_LEAD_MISMATCH",
      "A oportunidade comercial informada nao pertence a lead selecionada."
    );
  }

  if (args.scope.conversation?.id) {
    if (!opportunity.primaryConversation?.id) {
      throw new QuoteAccessError(
        403,
        "COMMERCIAL_OPPORTUNITY_CONVERSATION_MISSING",
        "A oportunidade comercial informada nao possui conversa canonica valida."
      );
    }

    if (opportunity.primaryConversation.id !== args.scope.conversation.id) {
      throw new QuoteAccessError(
        403,
        "COMMERCIAL_OPPORTUNITY_CONVERSATION_MISMATCH",
        "A oportunidade comercial informada nao corresponde a conversa selecionada."
      );
    }
  }

  if (opportunity.problems.length > 0 || opportunity.requiresAttention) {
    throw new QuoteAccessError(
      403,
      "COMMERCIAL_OPPORTUNITY_CONTEXT_INVALID",
      "A oportunidade comercial informada nao possui contexto comercial canonico valido."
    );
  }

  return commercialOpportunityId;
}

export function createCreateQuotePostHandler(deps?: {
  resolveQuoteScope?: QuoteScopeResolver;
  reserveQuoteNumber?: QuoteNumberReservationResolver;
  getNow?: () => Date;
  resolveOpportunityDetail?: (
    commercialOpportunityId: string,
    scope: QuoteScope
  ) => Promise<ResolveAuthorizedOpportunityDetailResult>;
}) {
  const resolveQuoteScope = deps?.resolveQuoteScope ?? resolveAuthorizedQuoteScope;
  const reserveQuoteNumber = deps?.reserveQuoteNumber ?? reserveNextQuoteNumber;
  const getNow = deps?.getNow ?? (() => new Date());
  const resolveOpportunityDetail =
    deps?.resolveOpportunityDetail ??
    ((commercialOpportunityId: string, scope: QuoteScope) => {
      return resolveAuthorizedOpportunityDetailCore(
        commercialOpportunityId,
        {
          sessionUserId: scope.user.id,
          organizationId: scope.organizationId,
          storeId: scope.store.id,
        },
        createProductionDataAccess(scope.supabase as unknown as ServiceSupabaseLike)
      );
    });

  return async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CreateQuoteBody | null;
    const creationIdempotencyKey = buildCreationIdempotencyKey(
      body?.creationIdempotencyKey
    );
    const storeId = String(body?.storeId || "").trim();
    const conversationId = String(body?.conversationId || "").trim() || null;
    const leadId = String(body?.leadId || "").trim() || null;
    const title = String(body?.title || "").trim() || null;
    const customerNotes = normalizeOptionalText(body?.customer_notes);
    const internalNotes = normalizeOptionalText(body?.internal_notes);
    const warrantyTerms = normalizeOptionalText(body?.warranty_terms);
    const validityDays = normalizeOptionalText(body?.validity_days);
    const validUntil = resolveQuoteValidUntil({
      validityDays,
      baseDate: getNow(),
    });
    const quoteDiscountCents = Math.max(0, parseInteger(body?.discount_cents, 0));
    const items = normalizeQuoteItems(body?.items || []);

    const scope = await resolveQuoteScope({
      requestOrganizationId: body?.organizationId,
      requestStoreId: storeId,
      conversationId,
      leadId,
    });
    const commercialOpportunityId =
      await resolveValidatedCommercialOpportunityId({
        body,
        scope,
        resolveOpportunityDetail,
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
    const customerName =
      normalizeOptionalText(body?.customerName ?? body?.customer_name) ??
      normalizeOptionalText(scope.lead?.name);
    const customerPhone =
      normalizeOptionalText(body?.customerPhone ?? body?.customer_phone) ??
      normalizeOptionalText(scope.lead?.phone);
    const creationRequestFingerprint = buildCreationRequestFingerprint({
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      commercialOpportunityId,
      conversationId: scope.conversation?.id || null,
      leadId: scope.lead?.id || null,
      title: title || null,
      customerName,
      customerPhone,
      customerNotes,
      internalNotes,
      warrantyTerms,
      validityDays,
      discountCents: quoteDiscountCents,
      items,
    });

    const existingQuote = await loadExistingQuoteByCreationIdempotencyKey({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      creationIdempotencyKey,
    });

    if (existingQuote?.id) {
      const replayQuote = await resolveExistingQuoteReplay({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        creationIdempotencyKey,
        creationRequestFingerprint,
        items,
      });

      await projectCommercialOpportunityToQuoteStage({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        commercialOpportunityId,
        salesQuoteId: replayQuote.id,
      });

      return buildCreateQuoteSuccessResponse({
        quote: replayQuote,
        itemCount: items.length,
        customerName: replayQuote.customer_name,
        customerPhone: replayQuote.customer_phone,
        replayed: true,
      });
    }

    const numberReservation = await reserveQuoteNumber({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });
    const quoteTitle = title || `Orcamento ${numberReservation.quoteNumber}`;

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
      warranty_terms: warrantyTerms,
      validity_days: validityDays,
      valid_until: validUntil,
    };

    const { data: quoteRow, error: quoteError } = await scope.supabase
      .from("sales_quotes")
      .insert({
        organization_id: scope.organizationId,
        store_id: scope.store.id,
        commercial_opportunity_id: commercialOpportunityId,
        creation_idempotency_key: creationIdempotencyKey,
        creation_request_fingerprint: creationRequestFingerprint,
        conversation_id: scope.conversation?.id || null,
        lead_id: scope.lead?.id || null,
        quote_number: numberReservation.quoteNumber,
        title: quoteTitle,
        status: "draft",
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_notes: customerNotes,
        internal_notes: internalNotes,
        warranty_terms: warrantyTerms,
        valid_until: validUntil,
        subtotal_cents: subtotalCents,
        discount_cents: discountCents,
        total_cents: totalCents,
        current_version_id: null,
        metadata: quoteMetadata,
      })
      .select(
        "id, organization_id, store_id, commercial_opportunity_id, creation_idempotency_key, creation_request_fingerprint, conversation_id, lead_id, quote_number, title, status, customer_name, customer_phone, customer_notes, internal_notes, warranty_terms, valid_until, subtotal_cents, discount_cents, total_cents, current_version_id, metadata, created_at, updated_at"
      )
      .maybeSingle<QuoteRow>();

    if (quoteError || !quoteRow?.id) {
      if (isUniqueViolation(quoteError)) {
        const concurrentQuote = await loadExistingQuoteByCreationIdempotencyKey({
          supabase: scope.supabase,
          organizationId: scope.organizationId,
          storeId: scope.store.id,
          creationIdempotencyKey,
        });

        if (!concurrentQuote?.id) {
          throw buildNonIdempotentUniqueConflictError();
        }

        const replayQuote = await resolveExistingQuoteReplay({
          supabase: scope.supabase,
          organizationId: scope.organizationId,
          storeId: scope.store.id,
          creationIdempotencyKey,
          creationRequestFingerprint,
          items,
        });

        await projectCommercialOpportunityToQuoteStage({
          supabase: scope.supabase,
          organizationId: scope.organizationId,
          storeId: scope.store.id,
          commercialOpportunityId,
          salesQuoteId: replayQuote.id,
        });

        return buildCreateQuoteSuccessResponse({
          quote: replayQuote,
          itemCount: items.length,
          customerName: replayQuote.customer_name,
          customerPhone: replayQuote.customer_phone,
          replayed: true,
        });
      }

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

    await projectCommercialOpportunityToQuoteStage({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      commercialOpportunityId,
      salesQuoteId: quoteRow.id,
    });

    return buildCreateQuoteSuccessResponse({
      quote: quoteRow,
      itemCount: items.length,
      customerName,
      customerPhone,
      replayed: false,
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
  };
}

export const POST = createCreateQuotePostHandler();
