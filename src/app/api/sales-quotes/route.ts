import { NextResponse } from "next/server";
import {
  authenticateQuoteRequest,
  getSalesQuotesSelect,
  QuoteAccessError,
} from "@/lib/server/sales-quotes/quote-auth";
import type {
  QuoteLeadRow,
  SalesQuoteRow,
  SalesQuoteVersionRow,
} from "@/lib/server/sales-quotes/types";

type SalesQuoteListItem = {
  id: string;
  quote_number: string | null;
  title: string | null;
  status: string | null;
  total_cents: number | null;
  created_at: string | null;
  current_version_id: string | null;
  current_version: {
    id: string;
    status: string | null;
    original_filename: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    storage_bucket: string | null;
    storage_path: string | null;
  } | null;
};

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const leadId = String(url.searchParams.get("leadId") || "").trim();

    if (!leadId) {
      return buildJsonResponse(
        {
          ok: false,
          error: "MISSING_LEAD_ID",
          message: "Lead ID nao informado.",
        },
        400
      );
    }

    const auth = await authenticateQuoteRequest();

    const { data: lead, error: leadError } = await auth.supabase
      .from("leads")
      .select("id, organization_id, store_id, name, phone")
      .eq("id", leadId)
      .in("organization_id", auth.organizationIds)
      .maybeSingle<QuoteLeadRow>();

    if (leadError) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LOAD_LEAD_FAILED",
          message: leadError.message,
        },
        500
      );
    }

    if (!lead) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LEAD_NOT_FOUND",
          message: "Lead nao encontrada ou fora do escopo do usuario.",
        },
        404
      );
    }

    const leadStoreId = String(lead.store_id || "").trim();

    if (leadStoreId) {
      const { data: store, error: storeError } = await auth.supabase
        .from("stores")
        .select("id, organization_id")
        .eq("id", leadStoreId)
        .eq("organization_id", lead.organization_id)
        .in("organization_id", auth.organizationIds)
        .maybeSingle<{ id: string; organization_id: string }>();

      if (storeError) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LOAD_STORE_FAILED",
            message: storeError.message,
          },
          500
        );
      }

      if (!store) {
        return buildJsonResponse(
          {
            ok: false,
            error: "STORE_SCOPE_INVALID",
            message: "A lead informada pertence a uma loja fora do escopo autorizado.",
          },
          403
        );
      }
    }

    let quotesQuery = auth.supabase
      .from("sales_quotes")
      .select(getSalesQuotesSelect())
      .eq("organization_id", lead.organization_id)
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false });

    if (leadStoreId) {
      quotesQuery = quotesQuery.eq("store_id", leadStoreId);
    }

    const { data: quotesData, error: quotesError } = await quotesQuery;

    if (quotesError) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LOAD_QUOTES_FAILED",
          message: quotesError.message,
        },
        500
      );
    }

    const quotes = ((quotesData || []) as unknown) as SalesQuoteRow[];
    const currentVersionIds = Array.from(
      new Set(
        quotes
          .map((quote) => String(quote.current_version_id || "").trim())
          .filter(Boolean)
      )
    );

    let versionsById = new Map<string, SalesQuoteVersionRow>();

    if (currentVersionIds.length > 0) {
      const { data: versionsData, error: versionsError } = await auth.supabase
        .from("sales_quote_versions")
        .select(
          "id, quote_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, quote_snapshot, created_at, sent_at"
        )
        .in("id", currentVersionIds)
        .eq("organization_id", lead.organization_id);

      if (versionsError) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LOAD_QUOTE_VERSIONS_FAILED",
            message: versionsError.message,
          },
          500
        );
      }

      versionsById = new Map(
        (((versionsData || []) as unknown) as SalesQuoteVersionRow[]).map((version) => [
          version.id,
          version,
        ])
      );
    }

    const quotesList: SalesQuoteListItem[] = quotes.map((quote) => {
      const currentVersionId = String(quote.current_version_id || "").trim() || null;
      const currentVersionCandidate = currentVersionId
        ? versionsById.get(currentVersionId) || null
        : null;
      const currentVersion =
        currentVersionCandidate &&
        currentVersionCandidate.quote_id === quote.id &&
        currentVersionCandidate.organization_id === quote.organization_id &&
        currentVersionCandidate.store_id === quote.store_id
          ? currentVersionCandidate
          : null;

      return {
        id: quote.id,
        quote_number: quote.quote_number,
        title: quote.title,
        status: quote.status,
        total_cents: quote.total_cents,
        created_at: quote.created_at,
        current_version_id: currentVersionId,
        current_version: currentVersion
          ? {
              id: currentVersion.id,
              status: currentVersion.status,
              original_filename: currentVersion.original_filename || null,
              mime_type: currentVersion.mime_type || null,
              size_bytes:
                typeof currentVersion.size_bytes === "number" ? currentVersion.size_bytes : null,
              storage_bucket: currentVersion.storage_bucket || null,
              storage_path: currentVersion.storage_path || null,
            }
          : null,
      };
    });

    return buildJsonResponse({
      ok: true,
      leadId: lead.id,
      organizationId: lead.organization_id,
      storeId: leadStoreId || null,
      quotes: quotesList,
    });
  } catch (error: unknown) {
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
        error: "SALES_QUOTES_LIST_FAILED",
        message: error instanceof Error ? error.message : "Erro interno ao listar orcamentos.",
      },
      500
    );
  }
}
