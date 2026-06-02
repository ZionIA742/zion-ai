import { NextResponse } from "next/server";
import {
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";
import type {
  SalesQuoteItemRow,
  SalesQuoteVersionRow,
} from "@/lib/server/sales-quotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteMetadata = Record<string, unknown> | null;

type SalesQuoteDetailItemRow = SalesQuoteItemRow & {
  item_type?: string | null;
};

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function buildErrorResponse(error: unknown) {
  if (error instanceof QuoteAccessError) {
    return buildJsonResponse(
      {
        ok: false,
        error: error.code,
        message: error.message,
      },
      error.status
    );
  }

  return buildJsonResponse(
    {
      ok: false,
      error: "UNEXPECTED_ERROR",
      message:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao carregar orcamento.",
    },
    500
  );
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readMetadataValue(metadata: QuoteMetadata, key: string) {
  return metadata && typeof metadata === "object" ? metadata[key] : null;
}

function readOfficialOrMetadataValue(
  quote: Record<string, unknown>,
  metadata: QuoteMetadata,
  key: "payment_terms" | "delivery_terms" | "warranty_terms" | "valid_until"
) {
  return normalizeOptionalText(quote[key]) || normalizeOptionalText(readMetadataValue(metadata, key));
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ quoteId: string }> }
) {
  try {
    const { quoteId: rawQuoteId } = await context.params;
    const quoteId = String(rawQuoteId || "").trim();
    const scope = await resolveAuthorizedExistingQuote(quoteId);
    const quoteMetadata = (scope.quote.metadata ?? null) as QuoteMetadata;

    const { data: itemsData, error: itemsError } = await scope.supabase
      .from("sales_quote_items")
      .select(
        "id, quote_id, organization_id, store_id, item_type, name, description, quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents, sort_order, sku, metadata, created_at, updated_at"
      )
      .eq("quote_id", scope.quote.id)
      .eq("organization_id", scope.organizationId)
      .eq("store_id", scope.store.id)
      .order("created_at", { ascending: true });

    if (itemsError) {
      throw new QuoteAccessError(500, "LOAD_QUOTE_ITEMS_FAILED", itemsError.message);
    }

    let currentVersion: SalesQuoteVersionRow | null = null;
    const currentVersionId = String(scope.quote.current_version_id || "").trim();

    if (currentVersionId) {
      const { data: versionData, error: versionError } = await scope.supabase
        .from("sales_quote_versions")
        .select(
          "id, quote_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, quote_snapshot, created_at, sent_at"
        )
        .eq("id", currentVersionId)
        .eq("quote_id", scope.quote.id)
        .eq("organization_id", scope.organizationId)
        .eq("store_id", scope.store.id)
        .maybeSingle<SalesQuoteVersionRow>();

      if (versionError) {
        throw new QuoteAccessError(
          500,
          "LOAD_CURRENT_VERSION_FAILED",
          versionError.message
        );
      }

      currentVersion = versionData ?? null;
    }

    const items = ((itemsData || []) as SalesQuoteDetailItemRow[]).map((item) => {
      const itemMetadata = item.metadata && typeof item.metadata === "object" ? item.metadata : null;

      return {
        id: item.id,
        item_type: normalizeOptionalText(item.item_type) || "custom",
        name: item.name || null,
        description: item.description || null,
        quantity: typeof item.quantity === "number" ? item.quantity : null,
        unit_price_cents:
          typeof item.unit_price_cents === "number" ? item.unit_price_cents : null,
        discount_cents: typeof item.discount_cents === "number" ? item.discount_cents : null,
        total_cents: typeof item.total_cents === "number" ? item.total_cents : null,
        catalog_item_id: normalizeOptionalText(readMetadataValue(itemMetadata, "catalog_item_id")),
        pool_model_id: normalizeOptionalText(readMetadataValue(itemMetadata, "pool_model_id")),
      };
    });

    return buildJsonResponse({
      ok: true,
      quote: {
        id: scope.quote.id,
        quote_number: scope.quote.quote_number || null,
        status: scope.quote.status || null,
        title: scope.quote.title || null,
        customer_name: scope.quote.customer_name || null,
        customer_phone: scope.quote.customer_phone || null,
        customer_notes: scope.quote.customer_notes || null,
        internal_notes: scope.quote.internal_notes || null,
        payment_terms: readOfficialOrMetadataValue(scope.quote as Record<string, unknown>, quoteMetadata, "payment_terms"),
        delivery_terms: readOfficialOrMetadataValue(scope.quote as Record<string, unknown>, quoteMetadata, "delivery_terms"),
        warranty_terms: readOfficialOrMetadataValue(scope.quote as Record<string, unknown>, quoteMetadata, "warranty_terms"),
        valid_until: readOfficialOrMetadataValue(scope.quote as Record<string, unknown>, quoteMetadata, "valid_until"),
        subtotal_cents:
          typeof scope.quote.subtotal_cents === "number" ? scope.quote.subtotal_cents : null,
        discount_cents:
          typeof scope.quote.discount_cents === "number" ? scope.quote.discount_cents : null,
        total_cents: typeof scope.quote.total_cents === "number" ? scope.quote.total_cents : null,
        current_version_id: currentVersionId || null,
        lead_id: scope.quote.lead_id || null,
        conversation_id: scope.quote.conversation_id || null,
        store_id: scope.quote.store_id,
        organization_id: scope.quote.organization_id,
      },
      items,
      current_version: currentVersion
        ? {
            id: currentVersion.id,
            version_number:
              typeof currentVersion.version_number === "number"
                ? currentVersion.version_number
                : null,
            status: currentVersion.status || null,
            original_filename: currentVersion.original_filename || null,
            mime_type: currentVersion.mime_type || null,
            size_bytes:
              typeof currentVersion.size_bytes === "number" ? currentVersion.size_bytes : null,
            storage_bucket: currentVersion.storage_bucket || null,
            storage_path: currentVersion.storage_path || null,
            created_at: currentVersion.created_at || null,
          }
        : null,
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
}
