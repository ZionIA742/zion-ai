import { QuoteAccessError } from "@/lib/server/sales-quotes/quote-auth";

export type ResolvedSalesQuoteKind = "preliminary" | "definitive";

type QuoteKindResolutionRow = {
  resolution_state?: unknown;
  quote_kind?: unknown;
  reason_code?: unknown;
  blocking_items?: unknown;
  authority_fingerprint?: unknown;
};

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeQuoteKind(value: unknown): ResolvedSalesQuoteKind | null {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (normalized === "preliminary" || normalized === "definitive") return normalized;
  return null;
}

function normalizeBlockingItems(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export async function resolveSalesQuoteKindForVersion(args: {
  supabase: {
    rpc: (
      fn: string,
      payload: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message?: string | null } | null }>;
  };
  organizationId: string;
  storeId: string;
  quoteId: string;
  commercialOpportunityId?: string | null;
  fallbackQuoteKind?: unknown;
}) {
  const commercialOpportunityId = normalizeOptionalText(args.commercialOpportunityId);
  const fallbackQuoteKind = normalizeQuoteKind(args.fallbackQuoteKind);

  if (!commercialOpportunityId) {
    return fallbackQuoteKind;
  }

  const { data, error } = await args.supabase.rpc(
    "resolve_sales_quote_kind_for_generation_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: commercialOpportunityId,
      p_sales_quote_id: args.quoteId,
    },
  );

  const row = Array.isArray(data)
    ? (data[0] as QuoteKindResolutionRow | undefined)
    : (data as QuoteKindResolutionRow | null);

  if (error || !row) {
    throw new QuoteAccessError(
      409,
      "QUOTE_KIND_RESOLUTION_FAILED",
      error?.message || "Nao foi possivel resolver o tipo canonico do orcamento.",
    );
  }

  const state = normalizeOptionalText(row.resolution_state);
  const quoteKind = normalizeQuoteKind(row.quote_kind);
  const reasonCode = normalizeOptionalText(row.reason_code);

  if (state !== "ready" || !quoteKind) {
    throw new QuoteAccessError(
      409,
      "QUOTE_KIND_BLOCKED",
      "As condicoes comerciais atuais bloqueiam a geracao deste orcamento.",
      {
        reasonCode,
        blockingItems: normalizeBlockingItems(row.blocking_items),
        authorityFingerprint: normalizeOptionalText(row.authority_fingerprint),
      },
    );
  }

  return quoteKind;
}
