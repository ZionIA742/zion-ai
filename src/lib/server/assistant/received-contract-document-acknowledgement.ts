import type { SupabaseClient } from "@supabase/supabase-js";

export const RECEIVED_CONTRACT_DOCUMENT_ACK_RPC =
  "enqueue_received_contract_document_ack_by_system" as const;

export type ReceivedContractDocumentAcknowledgementResult = {
  messageId: string;
  outboundIdempotencyKey: string;
  outcome: "queued" | "replayed";
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const row = value[0];
    return row && typeof row === "object" ? row as Record<string, unknown> : null;
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

/**
 * Queues the customer acknowledgement through the server-side idempotent
 * writer. It never calls Meta directly; the normal outbound worker remains
 * responsible for policy and transport.
 */
export async function enqueueReceivedContractDocumentAcknowledgement(args: {
  supabase: Pick<SupabaseClient, "rpc">;
  organizationId: string;
  storeId: string;
  conversationId: string;
  sourceMessageId: string;
  customerName?: string | null;
}): Promise<ReceivedContractDocumentAcknowledgementResult> {
  const values = [
    args.organizationId,
    args.storeId,
    args.conversationId,
    args.sourceMessageId,
  ].map(clean);

  if (values.some((value) => !value)) {
    throw new Error("RECEIVED_CONTRACT_DOCUMENT_ACK_CONTEXT_INVALID");
  }

  const { data, error } = await args.supabase.rpc(
    RECEIVED_CONTRACT_DOCUMENT_ACK_RPC,
    {
      p_organization_id: values[0],
      p_store_id: values[1],
      p_conversation_id: values[2],
      p_source_message_id: values[3],
      p_customer_name: clean(args.customerName) || null,
    },
  );

  if (error) {
    throw new Error(`RECEIVED_CONTRACT_DOCUMENT_ACK_RPC_FAILED:${error.message}`);
  }

  const row = firstRow(data);
  const messageId = clean(row?.message_id);
  const outboundIdempotencyKey = clean(row?.outbound_idempotency_key);
  const outcome = clean(row?.outcome);

  if (
    !messageId ||
    !outboundIdempotencyKey ||
    (outcome !== "queued" && outcome !== "replayed")
  ) {
    throw new Error("RECEIVED_CONTRACT_DOCUMENT_ACK_RPC_RETURN_INVALID");
  }

  return {
    messageId,
    outboundIdempotencyKey,
    outcome: outcome as "queued" | "replayed",
  };
}
