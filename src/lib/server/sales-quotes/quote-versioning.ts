import type {
  QuoteSettings,
  QuoteSnapshot,
  QuoteStoreRow,
  SalesQuoteItemRow,
  SalesQuoteRow,
  SalesQuoteVersionRow,
  QuoteLeadRow,
} from "./types";

function toNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

type SupabaseErrorLike = { message?: string | null };
type SupabaseResultLike<T> = PromiseLike<{
  data: T;
  error: SupabaseErrorLike | null;
}>;
type SupabaseWriteResultLike = PromiseLike<{ error: SupabaseErrorLike | null }>;

type SupabaseSelectBuilderLike<T> = {
  select(columns: string): SupabaseSelectBuilderLike<T>;
  eq(column: string, value: unknown): SupabaseSelectBuilderLike<T>;
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): SupabaseSelectBuilderLike<T>;
  limit(count: number): SupabaseResultLike<T[]>;
  maybeSingle(): SupabaseResultLike<T | null>;
};

type SupabaseInsertBuilderLike<T> = SupabaseWriteResultLike & {
  select(columns: string): {
    maybeSingle(): SupabaseResultLike<T | null>;
  };
};

type SupabaseTableBuilderLike<T> = SupabaseSelectBuilderLike<T> & {
  insert(payload: Record<string, unknown>): SupabaseInsertBuilderLike<T>;
  update(payload: Record<string, unknown>): {
    eq(column: string, value: unknown): SupabaseWriteResultLike;
  };
};

type QuoteVersioningSupabaseClient = {
  from(table: string): SupabaseTableBuilderLike<Record<string, unknown>>;
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: SupabaseErrorLike | null;
  }>;
};

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readQuoteHeaderText(
  quote: SalesQuoteRow,
  key: "payment_terms" | "delivery_terms" | "warranty_terms" | "valid_until",
) {
  const metadata =
    quote.metadata && typeof quote.metadata === "object" ? quote.metadata : {};
  return normalizeOptionalText(quote[key]) || normalizeOptionalText(metadata[key]);
}

export function buildQuoteSnapshot(args: {
  quote: SalesQuoteRow;
  items: SalesQuoteItemRow[];
  settings: QuoteSettings;
  store: QuoteStoreRow;
  lead: QuoteLeadRow | null;
  generationError?: string | null;
}): QuoteSnapshot {
  return {
    quote: {
      id: args.quote.id,
      quoteNumber: String(args.quote.quote_number || "").trim(),
      title: args.quote.title,
      status: String(args.quote.status || "").trim() || "draft",
      customerName: normalizeOptionalText(args.quote.customer_name) || args.lead?.name || null,
      customerPhone: normalizeOptionalText(args.quote.customer_phone) || args.lead?.phone || null,
      customerNotes: args.quote.customer_notes,
      internalNotes: args.quote.internal_notes,
      paymentTerms: readQuoteHeaderText(args.quote, "payment_terms"),
      deliveryTerms: readQuoteHeaderText(args.quote, "delivery_terms"),
      warrantyTerms: readQuoteHeaderText(args.quote, "warranty_terms"),
      validUntil: readQuoteHeaderText(args.quote, "valid_until"),
      createdAt: args.quote.created_at,
      subtotalCents: toNumber(args.quote.subtotal_cents),
      discountCents: toNumber(args.quote.discount_cents),
      totalCents: toNumber(args.quote.total_cents),
    },
    store: {
      id: args.store.id,
      name: args.store.name,
    },
    lead: {
      id: args.lead?.id || null,
      name: args.lead?.name || null,
      phone: args.lead?.phone || null,
    },
    items: args.items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
      discountCents: item.discount_cents,
      subtotalCents: item.subtotal_cents,
      totalCents: item.total_cents,
      sku: item.sku,
      sortOrder: item.sort_order,
      metadata: item.metadata,
    })),
    settings: args.settings,
    generatedAt: new Date().toISOString(),
    generationError: args.generationError || null,
  };
}

export async function getNextQuoteVersionNumber(args: {
  supabase: unknown;
  quoteId: string;
}) {
  const supabase = args.supabase as QuoteVersioningSupabaseClient;
  const { data, error } = await supabase
    .from("sales_quote_versions")
    .select("version_number")
    .eq("quote_id", args.quoteId)
    .order("version_number", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Falha ao carregar versoes do orcamento: ${error.message}`);
  }

  const currentVersion = Array.isArray(data) && data[0]?.version_number
    ? Number(data[0].version_number)
    : 0;

  return Math.max(1, currentVersion + 1);
}

export async function createQuoteVersion(args: {
  supabase: unknown;
  quote: SalesQuoteRow;
  versionNumber?: number;
  storeFileId: string;
  storageBucket: string;
  storagePath: string;
  originalFilename: string;
  sizeBytes: number;
  quoteSnapshot: QuoteSnapshot;
  nextQuoteStatus: string;
  quoteKind?: "preliminary" | "definitive" | null;
}) {
  const supabase = args.supabase as QuoteVersioningSupabaseClient;

  const { data, error } = await supabase.rpc(
    "create_sales_quote_version_by_system",
    {
      p_organization_id: args.quote.organization_id,
      p_store_id: args.quote.store_id,
      p_quote_id: args.quote.id,
      p_version_status: "generated",
      p_next_quote_status: args.nextQuoteStatus,
      p_quote_kind: args.quoteKind ?? null,
      p_store_file_id: args.storeFileId,
      p_storage_bucket: args.storageBucket,
      p_storage_path: args.storagePath,
      p_original_filename: args.originalFilename,
      p_mime_type: "application/pdf",
      p_size_bytes: args.sizeBytes,
      p_quote_snapshot: args.quoteSnapshot,
    },
  );

  const versionRow = Array.isArray(data) ? data[0] : data;

  if (error || !versionRow || typeof versionRow !== "object" || !(versionRow as { id?: unknown }).id) {
    throw new Error(error?.message || "Falha ao criar sales_quote_versions.");
  }

  if (
    String((versionRow as { quote_id?: unknown }).quote_id || "") !== args.quote.id ||
    String((versionRow as { organization_id?: unknown }).organization_id || "") !== args.quote.organization_id ||
    String((versionRow as { store_id?: unknown }).store_id || "") !== args.quote.store_id ||
    String((versionRow as { status?: unknown }).status || "") !== "generated"
  ) {
    throw new Error("Falha ao criar sales_quote_versions: retorno divergente.");
  }

  return versionRow as SalesQuoteVersionRow;
}

export async function recordQuoteGenerationFailure(args: {
  supabase: unknown;
  quote: SalesQuoteRow;
  versionNumber?: number;
  quoteSnapshot: QuoteSnapshot;
}) {
  const supabase = args.supabase as QuoteVersioningSupabaseClient;
  const { data, error } = await supabase.rpc(
    "create_sales_quote_version_by_system",
    {
      p_organization_id: args.quote.organization_id,
      p_store_id: args.quote.store_id,
      p_quote_id: args.quote.id,
      p_version_status: "failed",
      p_next_quote_status: null,
      p_quote_kind: null,
      p_store_file_id: null,
      p_storage_bucket: null,
      p_storage_path: null,
      p_original_filename: null,
      p_mime_type: null,
      p_size_bytes: null,
      p_quote_snapshot: args.quoteSnapshot,
    },
  );

  const versionRow = Array.isArray(data) ? data[0] : data;

  if (error || !versionRow || typeof versionRow !== "object") {
    throw new Error(
      `Falha ao registrar versao com erro: ${
        error?.message || "retorno invalido do writer"
      }`,
    );
  }

  if (
    String((versionRow as { quote_id?: unknown }).quote_id || "") !== args.quote.id ||
    String((versionRow as { organization_id?: unknown }).organization_id || "") !== args.quote.organization_id ||
    String((versionRow as { store_id?: unknown }).store_id || "") !== args.quote.store_id ||
    String((versionRow as { status?: unknown }).status || "") !== "failed"
  ) {
    throw new Error("Falha ao registrar versao com erro: retorno divergente.");
  }
}
