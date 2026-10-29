import type { QuoteSettings, StoreQuoteSettingsRow } from "./types";

const DEFAULT_QUOTE_NUMBER_PREFIX = "ORC";

type QuoteSettingsSupabase = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{
            data: unknown;
            error: { message?: unknown } | null;
          }>;
        };
      };
    };
  };
  rpc: (
    functionName: string,
    payload: { p_organization_id: string; p_store_id: string },
  ) => Promise<{
    data: unknown;
    error: { message?: unknown } | null;
  }>;
};

export const DEFAULT_QUOTE_SETTINGS: QuoteSettings = {
  quotePdfEnabled: false,
  aiCanGenerateQuote: false,
  aiCanSendQuoteToCustomer: false,
  requiresHumanApprovalBeforeSend: true,
  quoteNumberPrefix: DEFAULT_QUOTE_NUMBER_PREFIX,
  nextQuoteNumber: 1,
};

export async function loadStoreQuoteSettings(args: {
  supabase: QuoteSettingsSupabase;
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

export async function reserveNextQuoteNumber(args: {
  supabase: QuoteSettingsSupabase;
  organizationId: string;
  storeId: string;
}) {
  const { row, settings } = await loadStoreQuoteSettings(args);

  if (!row?.id) {
    throw new Error(
      "Configuracao de numeracao do orcamento nao encontrada para a loja.",
    );
  }

  const { data, error } = await args.supabase.rpc(
    "reserve_next_sales_quote_number_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
    },
  );

  if (error) {
    throw new Error(`Falha ao reservar numero do orcamento: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : null;
  if (rows?.length !== 1) {
    throw new Error(
      "A autoridade de numeracao do orcamento retornou uma quantidade invalida de linhas.",
    );
  }

  const reservation = rows[0] as {
    quote_number?: unknown;
    reserved_number?: unknown;
    quote_number_prefix?: unknown;
  } | null;
  const reservedNumber = reservation?.reserved_number;
  const quoteNumber = reservation?.quote_number;
  const quoteNumberPrefix = reservation?.quote_number_prefix;

  if (
    typeof quoteNumber !== "string" ||
    !quoteNumber.trim() ||
    typeof quoteNumberPrefix !== "string" ||
    !quoteNumberPrefix.trim() ||
    typeof reservedNumber !== "number" ||
    !Number.isInteger(reservedNumber) ||
    reservedNumber < 1
  ) {
    throw new Error(
      "A autoridade de numeracao do orcamento retornou uma reserva invalida.",
    );
  }

  return {
    settings,
    quoteNumber: quoteNumber.trim(),
    reservedNumber,
  };
}
