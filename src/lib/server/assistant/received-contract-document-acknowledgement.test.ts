import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueReceivedContractDocumentAcknowledgement,
  RECEIVED_CONTRACT_DOCUMENT_ACK_RPC,
} from "./received-contract-document-acknowledgement";

test("enfileira o agradecimento do cliente com a ocorrência documental exata", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await enqueueReceivedContractDocumentAcknowledgement({
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          data: {
            message_id: "ack-1",
            outbound_idempotency_key: "received_contract_document_ack:org-1:store-1:source-1",
            outcome: "queued",
          },
          error: null,
        };
      },
    } as never,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conversation-1",
    sourceMessageId: "source-1",
    customerName: "Regina",
  });

  assert.equal(result.outcome, "queued");
  assert.equal(calls[0]?.name, RECEIVED_CONTRACT_DOCUMENT_ACK_RPC);
  assert.equal(calls[0]?.args.p_source_message_id, "source-1");
  assert.equal(calls[0]?.args.p_conversation_id, "conversation-1");
});

test("falha fechado sem contexto de organização, loja, conversa ou ocorrência", async () => {
  await assert.rejects(
    enqueueReceivedContractDocumentAcknowledgement({
      supabase: { rpc: async () => ({ data: null, error: null }) } as never,
      organizationId: "org-1",
      storeId: "store-1",
      conversationId: "",
      sourceMessageId: "source-1",
    }),
    /RECEIVED_CONTRACT_DOCUMENT_ACK_CONTEXT_INVALID/,
  );
});
