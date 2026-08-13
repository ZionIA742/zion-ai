type QuoteCreationItemSnapshot = {
  item_type: string;
  name: string;
  description: string | null;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
};

export type ManualQuoteCreationSnapshotInput = {
  organizationId: string;
  storeId: string;
  leadId: string;
  conversationId: string | null;
  commercialOpportunityId: string | null;
  title: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_notes: string | null;
  internal_notes: string | null;
  warranty_terms: string | null;
  validity_days: string | null;
  discount_cents: number | null;
  items: QuoteCreationItemSnapshot[];
};

type PendingQuoteCreationOperation = {
  idempotencyKey: string;
  requestSnapshot: string;
};

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

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

function normalizeText(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeItems(items: QuoteCreationItemSnapshot[]) {
  return items.map((item) => ({
    item_type: normalizeText(item.item_type) || "custom",
    name: normalizeText(item.name) || "",
    description: normalizeText(item.description),
    quantity: Number(item.quantity || 0),
    unit_price_cents: Number(item.unit_price_cents || 0),
    discount_cents: Number(item.discount_cents || 0),
  }));
}

export function buildManualQuoteCreationSnapshot(
  input: ManualQuoteCreationSnapshotInput,
) {
  return stableStringify({
    organizationId: normalizeText(input.organizationId),
    storeId: normalizeText(input.storeId),
    leadId: normalizeText(input.leadId),
    conversationId: normalizeText(input.conversationId),
    commercialOpportunityId: normalizeText(input.commercialOpportunityId),
    title: normalizeText(input.title),
    customer_name: normalizeText(input.customer_name),
    customer_phone: normalizeText(input.customer_phone),
    customer_notes: normalizeText(input.customer_notes),
    internal_notes: normalizeText(input.internal_notes),
    warranty_terms: normalizeText(input.warranty_terms),
    validity_days: normalizeText(input.validity_days),
    discount_cents: Number(input.discount_cents || 0),
    items: normalizeItems(input.items),
  });
}

export function buildManualQuoteCreationStorageKey(args: {
  organizationId: string;
  storeId: string;
  leadId: string;
  conversationId: string | null;
  commercialOpportunityId: string | null;
}) {
  const conversationId = normalizeText(args.conversationId) || "no-conversation";
  const commercialOpportunityId =
    normalizeText(args.commercialOpportunityId) || "no-opportunity";

  return [
    "zion",
    "manual-quote-create",
    normalizeText(args.organizationId) || "no-org",
    normalizeText(args.storeId) || "no-store",
    normalizeText(args.leadId) || "no-lead",
    conversationId,
    commercialOpportunityId,
  ].join(":");
}

export function getOrCreatePendingManualQuoteCreationOperation(args: {
  storage: StorageLike;
  storageKey: string;
  requestSnapshot: string;
  createIdempotencyKey: () => string;
}) {
  const raw = args.storage.getItem(args.storageKey);

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as PendingQuoteCreationOperation | null;
      const idempotencyKey = normalizeText(parsed?.idempotencyKey);
      const requestSnapshot = normalizeText(parsed?.requestSnapshot);

      if (idempotencyKey && requestSnapshot === args.requestSnapshot) {
        return {
          idempotencyKey,
          reused: true,
        };
      }
    } catch {
      args.storage.removeItem(args.storageKey);
    }
  }

  const idempotencyKey = normalizeText(args.createIdempotencyKey());

  if (!idempotencyKey) {
    throw new Error("Nao foi possivel gerar a idempotency key da criacao da quote.");
  }

  args.storage.setItem(
    args.storageKey,
    JSON.stringify({
      idempotencyKey,
      requestSnapshot: args.requestSnapshot,
    } satisfies PendingQuoteCreationOperation),
  );

  return {
    idempotencyKey,
    reused: false,
  };
}

export function clearPendingManualQuoteCreationOperation(args: {
  storage: StorageLike;
  storageKey: string;
}) {
  args.storage.removeItem(args.storageKey);
}
