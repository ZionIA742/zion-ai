import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueReceivedContractDocumentAcknowledgement,
  RECEIVED_CONTRACT_DOCUMENT_ACK_RPC,
} from "./received-contract-document-acknowledgement";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

test("ACK operacional usa classificacao propria e nao uma classificacao comercial", () => {
  const historicalAckMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20261104211500_p9_9_16_received_document_customer_ack.sql",
    ),
    "utf8",
  );
  const guardMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20261106140000_p9_9_3_c5_received_document_ack_outbound_kind.sql",
    ),
    "utf8",
  );

  assert.match(historicalAckMigration, /'outbound_origin', 'received_contract_document_ack'/);
  assert.doesNotMatch(
    historicalAckMigration,
    /'outbound_kind', 'received_contract_document_ack'/,
  );
  assert.match(
    guardMigration,
    /enqueue_received_contract_document_ack_by_system\(uuid,uuid,uuid,uuid,text\)/,
  );
  assert.match(
    guardMigration,
    /'outbound_kind', 'received_contract_document_ack'/,
  );
  assert.doesNotMatch(guardMigration, /'outbound_kind', 'reactive_ai_reply'/);
  assert.match(guardMigration, /received_document_ack_source_scope_mismatch/);
  assert.match(guardMigration, /received_document_ack_origin_mismatch/);
  assert.match(guardMigration, /v_initial_outbound_kind <> 'received_contract_document_ack'/);
  assert.match(guardMigration, /v_outbound_kind <> 'received_contract_document_ack'/);
});

test("texto incremental do ACK nao usa ponto final", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20261106220000_p9_9_3_c5_contract_message_text_no_period.sql",
    ),
    "utf8",
  );

  assert.match(migration, /Me dê alguns minutos para verificar esse arquivo/);
  assert.match(migration, /v_new CONSTANT text[\s\S]*Me dê alguns minutos para verificar esse arquivo/);
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
