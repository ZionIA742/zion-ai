import { QuoteAccessError } from "./quote-auth";
import type { SalesQuoteRow } from "./types";

const ATOMIC_REQUEST_CHANGE_RPC = "request_sales_quote_change_by_system";

function firstRpcRow(data: unknown) {
  if (Array.isArray(data)) {
    return (data[0] || null) as Record<string, unknown> | null;
  }

  return (data || null) as Record<string, unknown> | null;
}

function mapAtomicWriterError(error: { message?: string | null } | null) {
  const message = String(error?.message || "").trim();

  if (message.includes("ZION_SALES_QUOTE_CHANGE_REQUEST_INCONSISTENT_OPEN")) {
    return new QuoteAccessError(
      409,
      "QUOTE_CHANGE_REQUEST_INCONSISTENT_OPEN",
      "Este orcamento possui um pedido de alteracao aberto em estado inconsistente.",
    );
  }

  if (message.includes("ZION_QUOTE_EVENT_NOT_ALLOWED")) {
    return new QuoteAccessError(
      409,
      "QUOTE_EVENT_NOT_ALLOWED",
      "A solicitacao de alteracao do orcamento nao esta permitida no estado atual da conversa.",
    );
  }

  if (message.includes("ZION_SALES_QUOTE_REQUEST_CHANGE_SCOPE_MISMATCH")) {
    return new QuoteAccessError(
      403,
      "QUOTE_SCOPE_MISMATCH",
      "O orcamento, a conversa e a lead nao pertencem ao mesmo escopo.",
    );
  }

  return null;
}

export async function requestQuoteChangeAtomically(args: {
  supabase: any;
  quote: SalesQuoteRow;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string;
  requestText: string;
}) {
  const { data, error } = await args.supabase.rpc(ATOMIC_REQUEST_CHANGE_RPC, {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_quote_id: args.quote.id,
    p_conversation_id: args.conversationId,
    p_lead_id: args.leadId,
    p_request_text: args.requestText,
  });

  if (error) {
    const mapped = mapAtomicWriterError(error);
    if (mapped) {
      throw mapped;
    }

    throw new Error(`Falha ao registrar alteracao atomica do orcamento: ${error.message}`);
  }

  const row = firstRpcRow(data);
  if (
    !row ||
    String(row.quote_id || "").trim() !== args.quote.id ||
    String(row.change_request_id || "").trim().length === 0 ||
    String(row.status || "").trim() !== "changes_requested" ||
    typeof row.event_created !== "boolean" ||
    typeof row.reused_existing_request !== "boolean"
  ) {
    throw new Error("Falha ao registrar alteracao atomica do orcamento: retorno invalido.");
  }

  return {
    quoteId: String(row.quote_id),
    changeRequestId: String(row.change_request_id),
    status: String(row.status),
    eventCreated: row.event_created === true,
    reusedExistingRequest: row.reused_existing_request === true,
  };
}
