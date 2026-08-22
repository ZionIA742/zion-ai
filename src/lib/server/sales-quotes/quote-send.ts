export const SALES_QUOTE_SEND_OUTBOUND_ORIGIN = "sales_quote_send";
export const SALES_QUOTE_SEND_ROUTE_SOURCE = "sales_quote_send_route";
export const SALES_QUOTE_SEND_RECONCILIATION_SOURCE = "system_quote_send_reconciliation";
export const SALES_QUOTE_SEND_MATERIALIZE_RPC =
  "materialize_sales_quote_send_by_system";
export const SALES_QUOTE_SEND_FINALIZE_RPC =
  "finalize_sales_quote_send_by_system";

export type SalesQuoteSendDeliveryState =
  | "pending"
  | "processing"
  | "sent"
  | "uncertain"
  | "failed";

export type SalesQuoteSendMaterializationOutcome =
  | "queued"
  | "already_queued"
  | "already_sent"
  | "uncertain"
  | "failed";

export type SalesQuoteSendMaterializationRow = {
  message_id: string;
  outbound_idempotency_key: string;
  outbound_delivery_state: SalesQuoteSendDeliveryState;
  commercial_opportunity_id: string;
  sales_quote_id: string;
  sales_quote_version_id: string;
  external_message_id: string | null;
  outcome: SalesQuoteSendMaterializationOutcome;
};

export class SalesQuoteSendMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesQuoteSendMaterializationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildSalesQuoteSendIdempotencyKey(args: {
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  salesQuoteId: string;
  salesQuoteVersionId: string;
}) {
  return `sales_quote_send:${args.organizationId}:${args.storeId}:${args.commercialOpportunityId}:${args.salesQuoteId}:${args.salesQuoteVersionId}`;
}

export function buildSalesQuoteSendMessageMetadata(args: {
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  salesQuoteId: string;
  salesQuoteVersionId: string;
  outboundIdempotencyKey: string;
  baseMetadata: Record<string, unknown>;
}) {
  return {
    ...args.baseMetadata,
    source: SALES_QUOTE_SEND_ROUTE_SOURCE,
    channel: "whatsapp",
    external_channel: "whatsapp",
    send_external: true,
    outbound_origin: SALES_QUOTE_SEND_OUTBOUND_ORIGIN,
    outbound_idempotency_key: args.outboundIdempotencyKey,
    organization_id: args.organizationId,
    store_id: args.storeId,
    commercial_opportunity_id: args.commercialOpportunityId,
    sales_quote_id: args.salesQuoteId,
    sales_quote_version_id: args.salesQuoteVersionId,
    generated_by: "system",
  };
}

export function isSalesQuoteSendMetadata(metadata: unknown) {
  if (!isRecord(metadata)) {
    return false;
  }

  return normalizeText(metadata.outbound_origin) === SALES_QUOTE_SEND_OUTBOUND_ORIGIN;
}

function normalizeMaterializationRow(
  data: unknown,
  expected: {
    organizationId: string;
    storeId: string;
    commercialOpportunityId: string;
    salesQuoteId: string;
    salesQuoteVersionId: string;
    outboundIdempotencyKey: string;
  },
): SalesQuoteSendMaterializationRow {
  const row = Array.isArray(data)
    ? ((data[0] as SalesQuoteSendMaterializationRow | undefined) ?? null)
    : ((data as SalesQuoteSendMaterializationRow | null) ?? null);

  if (!row) {
    throw new SalesQuoteSendMaterializationError(
      "O envio do orcamento nao retornou uma operacao materializada valida.",
    );
  }

  const messageId = normalizeText(row.message_id);
  const outboundIdempotencyKey = normalizeText(row.outbound_idempotency_key);
  const opportunityId = normalizeText(row.commercial_opportunity_id);
  const quoteId = normalizeText(row.sales_quote_id);
  const versionId = normalizeText(row.sales_quote_version_id);
  const deliveryState = normalizeText(row.outbound_delivery_state);
  const outcome = normalizeText(row.outcome);

  if (
    !messageId ||
    !outboundIdempotencyKey ||
    !opportunityId ||
    !quoteId ||
    !versionId ||
    !["pending", "processing", "sent", "uncertain", "failed"].includes(deliveryState) ||
    !["queued", "already_queued", "already_sent", "uncertain", "failed"].includes(outcome)
  ) {
    throw new SalesQuoteSendMaterializationError(
      "O envio do orcamento retornou um contrato invalido de materializacao.",
    );
  }

  if (
    outboundIdempotencyKey !== expected.outboundIdempotencyKey ||
    opportunityId !== expected.commercialOpportunityId ||
    quoteId !== expected.salesQuoteId ||
    versionId !== expected.salesQuoteVersionId
  ) {
    throw new SalesQuoteSendMaterializationError(
      "O envio do orcamento retornou uma operacao fora do escopo solicitado.",
    );
  }

  return {
    message_id: messageId,
    outbound_idempotency_key: outboundIdempotencyKey,
    outbound_delivery_state: deliveryState as SalesQuoteSendDeliveryState,
    commercial_opportunity_id: opportunityId,
    sales_quote_id: quoteId,
    sales_quote_version_id: versionId,
    external_message_id: normalizeText(row.external_message_id) || null,
    outcome: outcome as SalesQuoteSendMaterializationOutcome,
  };
}

export async function materializeSalesQuoteSendBySystem(args: {
  supabase: {
    rpc: (
      fn: string,
      payload: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  conversationId: string;
  salesQuoteId: string;
  salesQuoteVersionId: string;
  messageContent: string;
  messageMetadata: Record<string, unknown>;
}) {
  const outboundIdempotencyKey = buildSalesQuoteSendIdempotencyKey({
    organizationId: args.organizationId,
    storeId: args.storeId,
    commercialOpportunityId: args.commercialOpportunityId,
    salesQuoteId: args.salesQuoteId,
    salesQuoteVersionId: args.salesQuoteVersionId,
  });

  const { data, error } = await args.supabase.rpc(
    SALES_QUOTE_SEND_MATERIALIZE_RPC,
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
      p_conversation_id: args.conversationId,
      p_sales_quote_id: args.salesQuoteId,
      p_sales_quote_version_id: args.salesQuoteVersionId,
      p_message_content: args.messageContent,
      p_message_metadata: args.messageMetadata,
      p_idempotency_key: outboundIdempotencyKey,
      p_source: SALES_QUOTE_SEND_ROUTE_SOURCE,
    },
  );

  if (error) {
    throw new SalesQuoteSendMaterializationError(
      "Nao foi possivel materializar o envio canonico do orcamento.",
    );
  }

  return normalizeMaterializationRow(data, {
    organizationId: args.organizationId,
    storeId: args.storeId,
    commercialOpportunityId: args.commercialOpportunityId,
    salesQuoteId: args.salesQuoteId,
    salesQuoteVersionId: args.salesQuoteVersionId,
    outboundIdempotencyKey,
  });
}


export type SalesQuoteSendFinalizationRow = {
  sales_quote_id: string;
  sales_quote_version_id: string;
  message_id: string;
  external_message_id: string;
  sent_at: string;
  conversation_event_created: boolean;
  current_proposal_outcome: string | null;
  outcome: "finalized" | "already_finalized";
};

function normalizeFinalizationRow(
  data: unknown,
  expected: { salesQuoteId: string; salesQuoteVersionId: string; messageId: string },
): SalesQuoteSendFinalizationRow {
  const row = Array.isArray(data)
    ? ((data[0] as Partial<SalesQuoteSendFinalizationRow> | undefined) ?? null)
    : ((data as Partial<SalesQuoteSendFinalizationRow> | null) ?? null);

  if (!row) {
    throw new SalesQuoteSendMaterializationError(
      "A finalizacao comercial do orcamento nao retornou um contrato valido.",
    );
  }

  const quoteId = normalizeText(row.sales_quote_id);
  const versionId = normalizeText(row.sales_quote_version_id);
  const messageId = normalizeText(row.message_id);
  const externalMessageId = normalizeText(row.external_message_id);
  const sentAt = normalizeText(row.sent_at);
  const outcome = normalizeText(row.outcome);

  if (
    quoteId !== expected.salesQuoteId ||
    versionId !== expected.salesQuoteVersionId ||
    messageId !== expected.messageId ||
    !externalMessageId ||
    !sentAt ||
    !["finalized", "already_finalized"].includes(outcome) ||
    typeof row.conversation_event_created !== "boolean"
  ) {
    throw new SalesQuoteSendMaterializationError(
      "A finalizacao comercial do orcamento retornou uma operacao fora do escopo solicitado.",
    );
  }

  return {
    sales_quote_id: quoteId,
    sales_quote_version_id: versionId,
    message_id: messageId,
    external_message_id: externalMessageId,
    sent_at: sentAt,
    conversation_event_created: row.conversation_event_created,
    current_proposal_outcome: normalizeText(row.current_proposal_outcome) || null,
    outcome: outcome as SalesQuoteSendFinalizationRow["outcome"],
  };
}

export async function finalizeSalesQuoteSendBySystem(args: {
  supabase: {
    rpc: (
      fn: string,
      payload: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  salesQuoteId: string;
  salesQuoteVersionId: string;
  messageId: string;
}) {
  const { data, error } = await args.supabase.rpc(
    SALES_QUOTE_SEND_FINALIZE_RPC,
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
      p_sales_quote_id: args.salesQuoteId,
      p_sales_quote_version_id: args.salesQuoteVersionId,
      p_message_id: args.messageId,
      p_idempotency_key: buildSalesQuoteSendIdempotencyKey({
        organizationId: args.organizationId,
        storeId: args.storeId,
        commercialOpportunityId: args.commercialOpportunityId,
        salesQuoteId: args.salesQuoteId,
        salesQuoteVersionId: args.salesQuoteVersionId,
      }),
      p_source: SALES_QUOTE_SEND_RECONCILIATION_SOURCE,
    },
  );

  if (error) {
    throw new SalesQuoteSendMaterializationError(
      "Nao foi possivel finalizar comercialmente o envio do orcamento.",
    );
  }

  return normalizeFinalizationRow(data, {
    salesQuoteId: args.salesQuoteId,
    salesQuoteVersionId: args.salesQuoteVersionId,
    messageId: args.messageId,
  });
}
