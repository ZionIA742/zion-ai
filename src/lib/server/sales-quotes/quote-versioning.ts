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
      customerNotes: args.quote.customer_notes,
      internalNotes: args.quote.internal_notes,
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
  supabase: any;
  quoteId: string;
}) {
  const { data, error } = await args.supabase
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
  supabase: any;
  quote: SalesQuoteRow;
  versionNumber: number;
  storeFileId: string;
  storageBucket: string;
  storagePath: string;
  originalFilename: string;
  sizeBytes: number;
  quoteSnapshot: QuoteSnapshot;
  nextQuoteStatus: string;
}) {
  if (args.quote.current_version_id) {
    const { error: supersedeError } = await args.supabase
      .from("sales_quote_versions")
      .update({
        status: "superseded",
      })
      .eq("id", args.quote.current_version_id);

    if (supersedeError) {
      throw new Error(
        `Falha ao marcar versao anterior como superseded: ${supersedeError.message}`
      );
    }
  }

  const { data: versionRow, error: versionError } = await args.supabase
    .from("sales_quote_versions")
    .insert({
      quote_id: args.quote.id,
      organization_id: args.quote.organization_id,
      store_id: args.quote.store_id,
      version_number: args.versionNumber,
      status: "generated",
      store_file_id: args.storeFileId,
      storage_bucket: args.storageBucket,
      storage_path: args.storagePath,
      original_filename: args.originalFilename,
      mime_type: "application/pdf",
      size_bytes: args.sizeBytes,
      quote_snapshot: args.quoteSnapshot,
    })
    .select(
      "id, quote_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, quote_snapshot, created_at"
    )
    .maybeSingle();

  if (versionError || !versionRow?.id) {
    throw new Error(versionError?.message || "Falha ao criar sales_quote_versions.");
  }

  const { error: quoteUpdateError } = await args.supabase
    .from("sales_quotes")
    .update({
      current_version_id: versionRow.id,
      status: args.nextQuoteStatus,
    })
    .eq("id", args.quote.id);

  if (quoteUpdateError) {
    throw new Error(
      `Falha ao atualizar sales_quotes.current_version_id: ${quoteUpdateError.message}`
    );
  }

  return versionRow as SalesQuoteVersionRow;
}

export async function recordQuoteGenerationFailure(args: {
  supabase: any;
  quote: SalesQuoteRow;
  versionNumber: number;
  quoteSnapshot: QuoteSnapshot;
}) {
  const { error } = await args.supabase.from("sales_quote_versions").insert({
    quote_id: args.quote.id,
    organization_id: args.quote.organization_id,
    store_id: args.quote.store_id,
    version_number: args.versionNumber,
    status: "failed",
    store_file_id: null,
    storage_bucket: null,
    storage_path: null,
    quote_snapshot: args.quoteSnapshot,
  });

  if (error) {
    throw new Error(`Falha ao registrar versao com erro: ${error.message}`);
  }
}
