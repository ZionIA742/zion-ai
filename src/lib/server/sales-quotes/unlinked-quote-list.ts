import {
  authenticateQuoteRequest,
  getSalesQuotesSelect,
  QuoteAccessError,
} from "./quote-auth";
import { assertHumanQuoteEditEligibility, HumanQuoteEditProvenanceError } from "./human-quote-edit-provenance";
import type {
  SalesQuoteRow,
  SalesQuoteVersionRow,
} from "./types";

type QuoteSupabase =
  Awaited<ReturnType<typeof authenticateQuoteRequest>>["supabase"];

function humanEditEligible(quote: SalesQuoteRow): boolean {
  try {
    assertHumanQuoteEditEligibility(quote);
    return true;
  } catch (error) {
    if (error instanceof HumanQuoteEditProvenanceError) return false;
    throw error;
  }
}

export async function listUnlinkedSalesQuotesForLead(args: {
  supabase: QuoteSupabase;
  organizationId: string;
  storeId: string;
  leadId: string;
}) {
  const { data: quotesData, error: quotesError } =
    await args.supabase
      .from("sales_quotes")
      .select(getSalesQuotesSelect())
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("lead_id", args.leadId)
      .is("commercial_opportunity_id", null)
      .order("created_at", { ascending: false });

  if (quotesError) {
    throw new QuoteAccessError(
      500,
      "LOAD_QUOTES_FAILED",
      quotesError.message,
    );
  }

  const quotes = (quotesData || []) as unknown as SalesQuoteRow[];

  const currentVersionIds = Array.from(
    new Set(
      quotes
        .map((quote) =>
          String(quote.current_version_id || "").trim(),
        )
        .filter(Boolean),
    ),
  );

  let versionsById = new Map<string, SalesQuoteVersionRow>();

  if (currentVersionIds.length > 0) {
    const { data: versionsData, error: versionsError } =
      await args.supabase
        .from("sales_quote_versions")
        .select(
          "id, quote_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, quote_snapshot, created_at, sent_at",
        )
        .in("id", currentVersionIds)
        .eq("organization_id", args.organizationId)
        .eq("store_id", args.storeId);

    if (versionsError) {
      throw new QuoteAccessError(
        500,
        "LOAD_QUOTE_VERSIONS_FAILED",
        versionsError.message,
      );
    }

    versionsById = new Map(
      (
        (versionsData || []) as unknown as SalesQuoteVersionRow[]
      ).map((version) => [version.id, version]),
    );
  }

  return quotes.map((quote) => {
    const currentVersionId =
      String(quote.current_version_id || "").trim() || null;

    const candidate = currentVersionId
      ? versionsById.get(currentVersionId) || null
      : null;

    const currentVersion =
      candidate &&
      candidate.quote_id === quote.id &&
      candidate.organization_id === quote.organization_id &&
      candidate.store_id === quote.store_id
        ? candidate
        : null;

    return {
      id: quote.id,
      quote_number: quote.quote_number,
      title: quote.title,
      status: quote.status,
      total_cents: quote.total_cents,
      created_at: quote.created_at,
      current_version_id: currentVersionId,
      human_edit_eligible: humanEditEligible(quote),
      current_version: currentVersion
        ? {
            id: currentVersion.id,
            status: currentVersion.status,
            original_filename:
              currentVersion.original_filename || null,
            mime_type: currentVersion.mime_type || null,
            size_bytes:
              typeof currentVersion.size_bytes === "number"
                ? currentVersion.size_bytes
                : null,
            storage_bucket:
              currentVersion.storage_bucket || null,
            storage_path:
              currentVersion.storage_path || null,
          }
        : null,
    };
  });
}
