import type { QuoteSettings, StoreQuoteSettingsRow } from "./types";

const DEFAULT_QUOTE_NUMBER_PREFIX = "ORC";

export const DEFAULT_QUOTE_SETTINGS: QuoteSettings = {
  quotePdfEnabled: false,
  aiCanGenerateQuote: false,
  aiCanSendQuoteToCustomer: false,
  requiresHumanApprovalBeforeSend: true,
  quoteNumberPrefix: DEFAULT_QUOTE_NUMBER_PREFIX,
  nextQuoteNumber: 1,
};

export async function loadStoreQuoteSettings(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_quote_settings")
    .select(
      "id, organization_id, store_id, quote_pdf_enabled, ai_can_generate_quote, ai_can_send_quote_to_customer, requires_human_approval_before_send, quote_number_prefix, next_quote_number, created_at, updated_at"
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar store_quote_settings: ${error.message}`);
  }

  const row = (data || null) as StoreQuoteSettingsRow | null;

  return {
    row,
    settings: {
      quotePdfEnabled: row?.quote_pdf_enabled === true,
      aiCanGenerateQuote: row?.ai_can_generate_quote === true,
      aiCanSendQuoteToCustomer: row?.ai_can_send_quote_to_customer === true,
      requiresHumanApprovalBeforeSend:
        row?.requires_human_approval_before_send !== false,
      quoteNumberPrefix:
        String(row?.quote_number_prefix || "").trim() || DEFAULT_QUOTE_NUMBER_PREFIX,
      nextQuoteNumber:
        Number.isFinite(row?.next_quote_number)
          ? Math.max(1, Number(row?.next_quote_number))
          : 1,
    } satisfies QuoteSettings,
  };
}

function formatQuoteNumber(prefix: string, nextQuoteNumber: number) {
  return `${prefix}-${String(nextQuoteNumber).padStart(6, "0")}`;
}

export async function reserveNextQuoteNumber(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
}) {
  const { row, settings } = await loadStoreQuoteSettings(args);

  if (row?.id) {
    const currentNumber = Math.max(1, settings.nextQuoteNumber);
    const { error: updateError } = await args.supabase
      .from("store_quote_settings")
      .update({
        next_quote_number: currentNumber + 1,
      })
      .eq("id", row.id);

    if (updateError) {
      throw new Error(`Falha ao reservar numero do orcamento: ${updateError.message}`);
    }

    return {
      settings,
      quoteNumber: formatQuoteNumber(settings.quoteNumberPrefix, currentNumber),
      reservedNumber: currentNumber,
    };
  }

  const { count, error: countError } = await args.supabase
    .from("sales_quotes")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId);

  if (countError) {
    throw new Error(
      `Falha ao calcular numero fallback do orcamento: ${countError.message}`
    );
  }

  const fallbackNumber = Math.max(1, Number(count || 0) + 1);

  return {
    settings,
    quoteNumber: formatQuoteNumber(settings.quoteNumberPrefix, fallbackNumber),
    reservedNumber: fallbackNumber,
  };
}
