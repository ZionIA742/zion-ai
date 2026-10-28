export const SALES_CONTRACT_SEND_OUTBOUND_ORIGIN = "sales_contract_send";
export const SALES_CONTRACT_SEND_ROUTE_SOURCE = "sales_contract_send_route";
export const SALES_CONTRACT_SEND_RECONCILIATION_SOURCE =
  "system_sales_contract_send_reconciliation";
export const SALES_CONTRACT_SEND_MATERIALIZE_RPC =
  "materialize_sales_contract_send_by_system";
export const SALES_CONTRACT_SEND_FINALIZE_RPC =
  "finalize_sales_contract_send_by_system";

export type SalesContractSendDeliveryState =
  | "pending"
  | "processing"
  | "sent"
  | "uncertain"
  | "failed";

export type SalesContractSendMaterializationOutcome =
  | "queued"
  | "already_queued"
  | "already_sent"
  | "uncertain"
  | "failed";

export type SalesContractSendMaterializationRow = {
  message_id: string;
  outbound_idempotency_key: string;
  outbound_delivery_state: SalesContractSendDeliveryState;
  sales_contract_id: string;
  sales_contract_version_id: string;
  external_message_id: string | null;
  outcome: SalesContractSendMaterializationOutcome;
};

export type SalesContractSendFinalizationRow = {
  sales_contract_id: string;
  sales_contract_version_id: string;
  message_id: string;
  external_message_id: string;
  sent_at: string;
  conversation_event_created: boolean;
  outcome: "finalized" | "already_finalized";
};

export class SalesContractSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesContractSendError";
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function rowOf(data: unknown) {
  return Array.isArray(data) ? data[0] : data;
}

export function buildSalesContractSendIdempotencyKey(args: {
  organizationId: string;
  storeId: string;
  contractId: string;
  contractVersionId: string;
}) {
  return `sales_contract_send:${args.organizationId}:${args.storeId}:${args.contractId}:${args.contractVersionId}`;
}

export function buildSalesContractSendMessageMetadata(args: {
  organizationId: string;
  storeId: string;
  contractId: string;
  contractVersionId: string;
  outboundIdempotencyKey: string;
  baseMetadata: Record<string, unknown>;
  actorUserId?: string;
}) {
  return {
    ...args.baseMetadata,
    source: SALES_CONTRACT_SEND_ROUTE_SOURCE,
    channel: "whatsapp",
    external_channel: "whatsapp",
    send_external: true,
    outbound_origin: SALES_CONTRACT_SEND_OUTBOUND_ORIGIN,
    outbound_idempotency_key: args.outboundIdempotencyKey,
    organization_id: args.organizationId,
    store_id: args.storeId,
    sales_contract_id: args.contractId,
    sales_contract_version_id: args.contractVersionId,
    generated_by: "system",
    ...(args.actorUserId ? { sent_by_user_id: args.actorUserId } : {}),
  };
}

export function isSalesContractSendMetadata(metadata: unknown) {
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      text((metadata as Record<string, unknown>).outbound_origin) ===
        SALES_CONTRACT_SEND_OUTBOUND_ORIGIN,
  );
}

export function materializeSalesContractSendBySystem(args: {
  supabase: {
    rpc: (
      fn: string,
      payload: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  organizationId: string;
  storeId: string;
  contractId: string;
  contractVersionId: string;
  conversationId: string;
  messageContent: string;
  messageMetadata: Record<string, unknown>;
  actorUserId?: string;
}) {
  const key = buildSalesContractSendIdempotencyKey(args);
  return args.supabase
    .rpc(SALES_CONTRACT_SEND_MATERIALIZE_RPC, {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_contract_id: args.contractId,
      p_contract_version_id: args.contractVersionId,
      p_conversation_id: args.conversationId,
      p_message_content: args.messageContent,
      p_message_metadata: args.messageMetadata,
      p_actor_user_id: args.actorUserId ?? null,
      p_idempotency_key: key,
      p_source: SALES_CONTRACT_SEND_ROUTE_SOURCE,
    })
    .then(({ data, error }) => {
      if (error) throw new SalesContractSendError("Nao foi possivel materializar o envio canonico do contrato.");
      const row = rowOf(data) as Partial<SalesContractSendMaterializationRow> | null;
      const result = {
        message_id: text(row?.message_id),
        outbound_idempotency_key: text(row?.outbound_idempotency_key),
        outbound_delivery_state: text(row?.outbound_delivery_state),
        sales_contract_id: text(row?.sales_contract_id),
        sales_contract_version_id: text(row?.sales_contract_version_id),
        external_message_id: text(row?.external_message_id) || null,
        outcome: text(row?.outcome),
      };
      if (
        !result.message_id ||
        result.outbound_idempotency_key !== key ||
        result.sales_contract_id !== args.contractId ||
        result.sales_contract_version_id !== args.contractVersionId ||
        !["pending", "processing", "sent", "uncertain", "failed"].includes(result.outbound_delivery_state) ||
        !["queued", "already_queued", "already_sent", "uncertain", "failed"].includes(result.outcome)
      ) {
        throw new SalesContractSendError("O envio do contrato retornou uma operacao materializada invalida.");
      }
      return result as SalesContractSendMaterializationRow;
    });
}

export function finalizeSalesContractSendBySystem(args: {
  supabase: {
    rpc: (
      fn: string,
      payload: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  organizationId: string;
  storeId: string;
  contractId: string;
  contractVersionId: string;
  messageId: string;
}) {
  const key = buildSalesContractSendIdempotencyKey(args);
  return args.supabase
    .rpc(SALES_CONTRACT_SEND_FINALIZE_RPC, {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_contract_id: args.contractId,
      p_contract_version_id: args.contractVersionId,
      p_message_id: args.messageId,
      p_idempotency_key: key,
      p_source: SALES_CONTRACT_SEND_RECONCILIATION_SOURCE,
    })
    .then(({ data, error }) => {
      if (error) throw new SalesContractSendError("Nao foi possivel finalizar o envio canonico do contrato.");
      const row = rowOf(data) as Partial<SalesContractSendFinalizationRow> | null;
      const result = {
        sales_contract_id: text(row?.sales_contract_id),
        sales_contract_version_id: text(row?.sales_contract_version_id),
        message_id: text(row?.message_id),
        external_message_id: text(row?.external_message_id),
        sent_at: text(row?.sent_at),
        conversation_event_created: row?.conversation_event_created,
        outcome: text(row?.outcome),
      };
      if (
        result.sales_contract_id !== args.contractId ||
        result.sales_contract_version_id !== args.contractVersionId ||
        result.message_id !== args.messageId ||
        !result.external_message_id ||
        !result.sent_at ||
        typeof result.conversation_event_created !== "boolean" ||
        !["finalized", "already_finalized"].includes(result.outcome)
      ) {
        throw new SalesContractSendError("A finalizacao comercial do contrato retornou uma operacao invalida.");
      }
      return result as SalesContractSendFinalizationRow;
    });
}
