/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildQuotePdf } from "./build-quote-pdf";
import { loadStoreQuoteSettings } from "./quote-settings";
import {
  buildQuoteSnapshot,
  createQuoteVersion,
} from "./quote-versioning";
import type {
  QuoteLeadRow,
  QuoteSettings,
  QuoteStoreRow,
  SalesQuoteItemRow,
  SalesQuoteRow,
} from "./types";

export const NEGOTIATION_MATERIALIZATION_OPERATION_PREFIX =
  "commercial_negotiation_concession_materialization:";
export const NEGOTIATION_MATERIALIZATION_SEND_RPC =
  "materialize_commercial_negotiation_concession_send_by_system";
export const NEGOTIATION_MATERIALIZATION_FINALIZE_RPC =
  "finalize_commercial_negotiation_concession_materialization_by_system";

type RpcError = { message: string } | null;
type SupabaseLike = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError }>;
  from(table: string): any;
  storage?: any;
};

export type NegotiationMaterializationPrepareRow = {
  materialization_id: string;
  operation_key: string;
  request_fingerprint: string;
  state: "prepared" | "quote_created" | "version_created" | "send_queued" | "materialized" | "superseded";
  negotiation_cycle_id: string;
  base_quote_id: string;
  base_quote_version_id: string;
  target_quote_id: string;
  target_quote_number: string;
  reserved_concession_number: 1 | 2 | null;
  replayed: boolean;
};

function one<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : ((data as T | null) ?? null);
}

function normalizePrepare(data: unknown): NegotiationMaterializationPrepareRow {
  const row = one<Partial<NegotiationMaterializationPrepareRow>>(data);
  if (!row) throw new Error("P9_8_5_PREPARE_EMPTY");
  const state = String(row.state || "").trim();
  if (
    !row.materialization_id ||
    !row.operation_key ||
    !row.request_fingerprint ||
    !row.negotiation_cycle_id ||
    !row.base_quote_id ||
    !row.base_quote_version_id ||
    !row.target_quote_id ||
    !row.target_quote_number ||
    !["prepared", "quote_created", "version_created", "send_queued", "materialized", "superseded"].includes(state)
  ) {
    throw new Error("P9_8_5_PREPARE_CONTRACT_INVALID");
  }
  return {
    materialization_id: String(row.materialization_id),
    operation_key: String(row.operation_key),
    request_fingerprint: String(row.request_fingerprint),
    state: state as NegotiationMaterializationPrepareRow["state"],
    negotiation_cycle_id: String(row.negotiation_cycle_id),
    base_quote_id: String(row.base_quote_id),
    base_quote_version_id: String(row.base_quote_version_id),
    target_quote_id: String(row.target_quote_id),
    target_quote_number: String(row.target_quote_number),
    reserved_concession_number:
      row.reserved_concession_number == null ? null : Number(row.reserved_concession_number) as 1 | 2,
    replayed: row.replayed === true,
  };
}

export async function prepareNegotiationConcessionMaterialization(args: {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  concessionId: string;
}) {
  const { data, error } = await args.supabase.rpc(
    "prepare_commercial_negotiation_concession_materialization_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
      p_concession_id: args.concessionId,
    },
  );
  if (error) throw new Error(`P9_8_5_PREPARE_FAILED: ${error.message}`);
  return normalizePrepare(data);
}

export function distributeAuthorizedDiscount(args: {
  items: SalesQuoteItemRow[];
  discountCents: number;
}) {
  if (!Number.isSafeInteger(args.discountCents) || args.discountCents < 0) {
    throw new Error("P9_8_5_AUTHORIZED_DISCOUNT_INVALID");
  }
  let remaining = args.discountCents;
  const items = args.items.map((item) => {
    const subtotal = Number(item.subtotal_cents || 0);
    const currentDiscount = Number(item.discount_cents || 0);
    const available = Math.max(0, subtotal - currentDiscount);
    const added = Math.min(available, remaining);
    remaining -= added;
    const discount = currentDiscount + added;
    return {
      ...item,
      discount_cents: discount,
      total_cents: subtotal - discount,
    };
  });
  if (remaining !== 0) throw new Error("P9_8_5_AUTHORIZED_DISCOUNT_EXCEEDS_QUOTE");
  return items;
}

export function resolveAuthorizedDiscount(args: {
  baseTotalCents: number;
  previousPriceCents: unknown;
  proposedPriceCents: unknown;
  requestedDiscountCents: unknown;
}) {
  const previous = Number(args.previousPriceCents);
  const proposed = Number(args.proposedPriceCents);
  const requested = Number(args.requestedDiscountCents);
  if (
    !Number.isSafeInteger(previous) || previous < 0 ||
    !Number.isSafeInteger(proposed) || proposed < 0 || proposed >= previous ||
    !Number.isSafeInteger(requested) || requested < 0 ||
    previous !== args.baseTotalCents || requested !== previous - proposed
  ) {
    throw new Error("P9_8_5_DISCOUNT_TRANSITION_INVALID");
  }
  return { deltaCents: requested, targetTotalCents: proposed };
}

async function storeDeterministicMaterializationPdf(args: {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  quoteId: string;
  quoteNumber: string;
  materializationId: string;
  pdfBytes: Uint8Array;
}) {
  const storageBucket = "zion-store-files";
  const storagePath = `${args.organizationId}/${args.storeId}/sales-quotes/${args.quoteId}/materializations/${args.materializationId}.pdf`;
  const originalFilename = `${String(args.quoteNumber || "orcamento")}.pdf`;
  const existing = await args.supabase
    .from("store_files")
    .select("id, storage_bucket, storage_path, original_filename, size_bytes")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("storage_bucket", storageBucket)
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (existing.error) throw new Error(`P9_8_5_PDF_ROW_LOAD_FAILED: ${existing.error.message}`);
  if (existing.data?.id) {
    return {
      storeFileId: String(existing.data.id),
      storageBucket,
      storagePath,
      originalFilename: String(existing.data.original_filename || originalFilename),
      sizeBytes: Number(existing.data.size_bytes || args.pdfBytes.byteLength),
    };
  }
  if (!args.supabase.storage?.from) throw new Error("P9_8_5_STORAGE_CLIENT_REQUIRED");
  const { error: uploadError } = await args.supabase.storage
    .from(storageBucket)
    .upload(storagePath, args.pdfBytes, { upsert: true, contentType: "application/pdf" });
  if (uploadError) throw new Error(`P9_8_5_PDF_UPLOAD_FAILED: ${uploadError.message}`);
  const { data: fileRow, error: fileError } = await args.supabase
    .from("store_files")
    .insert({
      organization_id: args.organizationId,
      store_id: args.storeId,
      file_kind: "sales_quote_pdf",
      storage_bucket: storageBucket,
      storage_path: storagePath,
      original_filename: originalFilename,
      mime_type: "application/pdf",
      size_bytes: args.pdfBytes.byteLength,
      uploaded_by: "system",
    })
    .select("id, storage_bucket, storage_path, original_filename, size_bytes")
    .maybeSingle();
  if (fileError || !fileRow?.id) {
    const replay = await args.supabase
      .from("store_files")
      .select("id, storage_bucket, storage_path, original_filename, size_bytes")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("storage_bucket", storageBucket)
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (replay.data?.id) return {
      storeFileId: String(replay.data.id), storageBucket, storagePath,
      originalFilename: String(replay.data.original_filename || originalFilename),
      sizeBytes: Number(replay.data.size_bytes || args.pdfBytes.byteLength),
    };
    throw new Error(`P9_8_5_PDF_ROW_CREATE_FAILED: ${fileError?.message || "empty"}`);
  }
  return { storeFileId: String(fileRow.id), storageBucket, storagePath, originalFilename, sizeBytes: args.pdfBytes.byteLength };
}

async function loadBase(args: {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  prepared: NegotiationMaterializationPrepareRow;
}) {
  const { data: quote, error: quoteError } = await args.supabase
    .from("sales_quotes")
    .select("*")
    .eq("id", args.prepared.base_quote_id)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("commercial_opportunity_id", args.commercialOpportunityId)
    .maybeSingle();
  if (quoteError || !quote) throw new Error(`P9_8_5_BASE_QUOTE_LOAD_FAILED: ${quoteError?.message || "not found"}`);
  if (String(quote.current_version_id || "") !== args.prepared.base_quote_version_id) {
    throw new Error("P9_8_5_BASE_QUOTE_VERSION_CHANGED");
  }
  const { data: version, error: versionError } = await args.supabase
    .from("sales_quote_versions")
    .select("*")
    .eq("id", args.prepared.base_quote_version_id)
    .eq("quote_id", args.prepared.base_quote_id)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();
  if (versionError || !version || !version.sent_at || !["sent", "superseded"].includes(String(version.status))) {
    throw new Error("P9_8_5_BASE_VERSION_INVALID");
  }
  const { data: itemRows, error: itemError } = await args.supabase
    .from("sales_quote_items")
    .select("*")
    .eq("quote_id", args.prepared.base_quote_id)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .order("sort_order", { ascending: true });
  if (itemError || !Array.isArray(itemRows) || itemRows.length === 0) {
    throw new Error(`P9_8_5_BASE_ITEMS_INVALID: ${itemError?.message || "empty"}`);
  }
  const { data: store, error: storeError } = await args.supabase
    .from("stores")
    .select("id, organization_id, name, created_at")
    .eq("id", args.storeId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();
  if (storeError || !store) throw new Error("P9_8_5_STORE_SCOPE_INVALID");
  const lead = quote.lead_id
    ? (await args.supabase.from("leads").select("id, organization_id, store_id, name, phone").eq("id", quote.lead_id).eq("organization_id", args.organizationId).maybeSingle()).data
    : null;
  const settingsResult = await loadStoreQuoteSettings({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
  });
  return {
    quote: quote as SalesQuoteRow,
    version,
    items: itemRows as SalesQuoteItemRow[],
    store: store as QuoteStoreRow,
    lead: (lead || null) as QuoteLeadRow | null,
    settings: settingsResult.settings as QuoteSettings,
  };
}

async function ensureTargetQuote(args: {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  prepared: NegotiationMaterializationPrepareRow;
  base: Awaited<ReturnType<typeof loadBase>>;
  concession: Record<string, unknown>;
}) {
  const { data: existing, error: existingError } = await args.supabase
    .from("sales_quotes")
    .select("*")
    .eq("id", args.prepared.target_quote_id)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("commercial_opportunity_id", args.commercialOpportunityId)
    .maybeSingle();
  if (existingError) throw new Error(`P9_8_5_TARGET_QUOTE_LOAD_FAILED: ${existingError.message}`);
  if (existing) return existing as SalesQuoteRow;
  const previousCondition = (args.concession.previous_condition || {}) as Record<string, unknown>;
  const proposedCondition = (args.concession.proposed_condition || {}) as Record<string, unknown>;
  resolveAuthorizedDiscount({
    baseTotalCents: Number(args.base.quote.total_cents || 0),
    previousPriceCents: previousCondition.price_cents,
    proposedPriceCents: proposedCondition.price_cents,
    requestedDiscountCents: args.concession.requested_discount_cents,
  });
  const { data: written, error: writerError } = await args.supabase.rpc(
    "materialize_commercial_negotiation_concession_target_quote_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
      p_materialization_id: args.prepared.materialization_id,
    },
  );
  if (writerError || !one(written)) {
    throw new Error(`P9_8_5_TARGET_QUOTE_CREATE_FAILED: ${writerError?.message || "empty"}`);
  }
  const { data: target, error: targetError } = await args.supabase
    .from("sales_quotes")
    .select("*")
    .eq("id", args.prepared.target_quote_id)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("commercial_opportunity_id", args.commercialOpportunityId)
    .maybeSingle();
  if (targetError || !target) throw new Error(`P9_8_5_TARGET_QUOTE_RELOAD_FAILED: ${targetError?.message || "empty"}`);
  return target as SalesQuoteRow;
}

export async function materializeNegotiationConcession(args: {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  concessionId: string;
  messageContent: string;
  messageMetadata?: Record<string, unknown>;
}) {
  const prepared = await prepareNegotiationConcessionMaterialization(args);
  if (prepared.state === "materialized" || prepared.state === "superseded") {
    return { prepared, targetQuote: null, targetVersion: null, send: null };
  }
  const { data: concession, error: concessionError } = await args.supabase
    .from("commercial_negotiation_concessions")
    .select("*")
    .eq("id", args.concessionId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("commercial_opportunity_id", args.commercialOpportunityId)
    .maybeSingle();
  if (concessionError || !concession) throw new Error("P9_8_5_CONCESSION_LOAD_FAILED");
  const base = await loadBase({ ...args, prepared });
  const targetQuote = await ensureTargetQuote({ ...args, prepared, base, concession });
  const targetItemsResult = await args.supabase.from("sales_quote_items").select("*").eq("quote_id", targetQuote.id).order("sort_order", { ascending: true });
  const targetItems = (targetItemsResult.data || []) as SalesQuoteItemRow[];
  const snapshot = buildQuoteSnapshot({
    quote: targetQuote,
    items: targetItems,
    settings: base.settings,
    store: base.store,
    lead: base.lead,
    quoteKind: "definitive",
  });
  const pdfBytes = await buildQuotePdf({
    storeName: base.store.name,
    quoteNumber: String(targetQuote.quote_number || ""),
    quoteKind: "definitive",
    title: targetQuote.title,
    customerName: targetQuote.customer_name || base.lead?.name || null,
    customerPhone: targetQuote.customer_phone || base.lead?.phone || null,
    createdAt: targetQuote.created_at,
    validUntil: targetQuote.valid_until || null,
    items: targetItems.map((item) => ({ name: item.name, description: item.description, quantity: item.quantity, unitPriceCents: item.unit_price_cents, discountCents: item.discount_cents, totalCents: item.total_cents })),
    subtotalCents: Number(targetQuote.subtotal_cents || 0),
    discountCents: Number(targetQuote.discount_cents || 0),
    totalCents: Number(targetQuote.total_cents || 0),
    customerNotes: targetQuote.customer_notes,
    paymentTerms: targetQuote.payment_terms || null,
    deliveryTerms: targetQuote.delivery_terms || null,
    warrantyTerms: targetQuote.warranty_terms || null,
    settings: base.settings,
  });
  let targetVersion = targetQuote.current_version_id
    ? (await args.supabase.from("sales_quote_versions").select("*").eq("id", targetQuote.current_version_id).maybeSingle()).data
    : null;
  if (!targetVersion) {
    const storedFile = await storeDeterministicMaterializationPdf({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      quoteId: targetQuote.id,
      quoteNumber: String(targetQuote.quote_number || targetQuote.id),
      materializationId: prepared.materialization_id,
      pdfBytes,
    });
    targetVersion = await createQuoteVersion({
      supabase: args.supabase,
      quote: targetQuote,
      storeFileId: storedFile.storeFileId,
      storageBucket: storedFile.storageBucket,
      storagePath: storedFile.storagePath,
      originalFilename: storedFile.originalFilename,
      sizeBytes: storedFile.sizeBytes,
      quoteSnapshot: snapshot,
      nextQuoteStatus: "pending_review",
      quoteKind: "definitive",
    });
  }
  const { data: bound, error: bindError } = await args.supabase.rpc(
    "bind_commercial_negotiation_concession_materialization_version_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
      p_materialization_id: prepared.materialization_id,
      p_target_quote_id: targetQuote.id,
      p_target_quote_version_id: targetVersion.id,
    },
  );
  if (bindError || !one(bound)) throw new Error(`P9_8_5_VERSION_BIND_FAILED: ${bindError?.message || "empty"}`);
  const { data: send, error: sendError } = await args.supabase.rpc(NEGOTIATION_MATERIALIZATION_SEND_RPC, {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_commercial_opportunity_id: args.commercialOpportunityId,
    p_materialization_id: prepared.materialization_id,
    p_conversation_id: targetQuote.conversation_id,
    p_target_quote_id: targetQuote.id,
    p_target_quote_version_id: targetVersion.id,
    p_message_content: args.messageContent,
    p_message_metadata: args.messageMetadata || {},
  });
  if (sendError) throw new Error(`P9_8_5_SEND_QUEUE_FAILED: ${sendError.message}`);
  return { prepared, targetQuote, targetVersion, send: one(send) };
}

export async function finalizeNegotiationConcessionMaterialization(args: {
  supabase: SupabaseLike;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  materializationId: string;
  messageId: string;
  targetQuoteId: string;
  targetQuoteVersionId: string;
}) {
  const { data, error } = await args.supabase.rpc(NEGOTIATION_MATERIALIZATION_FINALIZE_RPC, {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_commercial_opportunity_id: args.commercialOpportunityId,
    p_materialization_id: args.materializationId,
    p_message_id: args.messageId,
    p_target_quote_id: args.targetQuoteId,
    p_target_quote_version_id: args.targetQuoteVersionId,
  });
  if (error) throw new Error(`P9_8_5_FINALIZE_FAILED: ${error.message}`);
  return one(data);
}
