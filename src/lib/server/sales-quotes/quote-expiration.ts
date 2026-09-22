import { QuoteAccessError } from "@/lib/server/sales-quotes/quote-auth";
import type { SalesQuoteRow, SalesQuoteVersionRow } from "./types";

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readSnapshotValidUntil(snapshot: Record<string, unknown> | null | undefined) {
  const quote = snapshot?.quote;
  if (!quote || typeof quote !== "object" || Array.isArray(quote)) return null;
  const quoteSnapshot = quote as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(quoteSnapshot, "validUntil")) {
    return undefined;
  }

  return normalizeOptionalText(quoteSnapshot.validUntil);
}

function isIsoDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function resolveSalesQuoteVersionValidUntil(args: {
  version: Pick<SalesQuoteVersionRow, "quote_snapshot">;
  quote: Pick<SalesQuoteRow, "valid_until">;
}) {
  const snapshotValidUntil = readSnapshotValidUntil(args.version.quote_snapshot);
  return snapshotValidUntil === undefined
    ? normalizeOptionalText(args.quote.valid_until)
    : snapshotValidUntil;
}

export function getCanonicalUtcDateOnly(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function isSalesQuoteVersionExpired(args: {
  validUntil: string | null;
  today?: string;
}) {
  if (!args.validUntil) return false;
  if (!isIsoDateOnly(args.validUntil)) {
    throw new QuoteAccessError(
      409,
      "QUOTE_VALID_UNTIL_INVALID",
      "A validade do orcamento nao esta em formato canonico.",
    );
  }

  const today = args.today ?? getCanonicalUtcDateOnly();
  return args.validUntil < today;
}

export function assertSalesQuoteVersionNotExpired(args: {
  version: Pick<SalesQuoteVersionRow, "quote_snapshot">;
  quote: Pick<SalesQuoteRow, "valid_until">;
  today?: string;
}) {
  const validUntil = resolveSalesQuoteVersionValidUntil(args);
  if (isSalesQuoteVersionExpired({ validUntil, today: args.today })) {
    throw new QuoteAccessError(
      409,
      "QUOTE_VERSION_EXPIRED",
      "A versao atual do orcamento esta vencida.",
      { validUntil },
    );
  }

  return validUntil;
}
