import assert from "node:assert/strict";
import test from "node:test";
import { pushAssistantReceivedContractDocumentMessage } from "./document-review-messages";

function harness(options: { existingMessage?: { id: string } | null } = {}) {
  const rpcCalls: Array<{ fn: string; payload: Record<string, unknown> }> = [];
  const updateCalls: Array<{ table: string; values: unknown }> = [];
  const supabase = {
    from(table: string) {
      const query: any = {
        select() { return query; },
        eq() { return query; },
        contains() { return query; },
        order() { return query; },
        limit() { return query; },
        update(values: unknown) {
          updateCalls.push({ table, values });
          return query;
        },
        maybeSingle: async () => ({
          data: table === "store_assistant_threads"
            ? { id: "thread-1" }
            : table === "store_assistant_messages"
              ? options.existingMessage || null
              : null,
          error: null,
        }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(resolve({ data: [], error: null }));
        },
      };
      return query;
    },
    rpc: async (fn: string, payload: Record<string, unknown>) => {
      rpcCalls.push({ fn, payload });
      return { data: null, error: null };
    },
  };
  return { supabase, rpcCalls, updateCalls };
}

const baseInput = {
  organizationId: "org-1",
  storeId: "store-1",
  sourceMessageId: "message-1",
  customerName: "Regina",
  customerMessage: "Regina devolveu o contrato e informou que assinou.",
  relatedLeadId: "lead-1",
  relatedConversationId: "conversation-1",
  contractId: "contract-1",
  contractVersionId: "version-2",
  documentNumber: "CTR-0001",
  receivedDocument: {
    storageBucket: "zion-store-files",
    storagePath: "inbound/contracts/signed-v2.pdf",
    mimeType: "application/pdf",
    originalFileName: "contrato-assinado.pdf",
  },
  identificationStatus: "identified" as const,
};

test("notifica documento identificado com o arquivo recebido e sem encaminhamento externo", async () => {
  const h = harness();
  const result = await pushAssistantReceivedContractDocumentMessage({
    supabase: h.supabase,
    ...baseInput,
  });

  assert.equal(result.ok, true);
  const message = h.rpcCalls.find((call) => call.fn === "assistant_push_system_message");
  assert.ok(message);
  assert.match(String(message.payload.p_content), /Regina informou que assinou/);
  assert.match(String(message.payload.p_content), /CTR-0001/);
  assert.match(String(message.payload.p_content), /contrato-assinado\.pdf/);
  const metadata = message.payload.p_metadata as Record<string, unknown>;
  assert.equal(metadata.origin, "received_contract_document_evidence");
  assert.equal(metadata.storage_path, "inbound/contracts/signed-v2.pdf");
  assert.equal(metadata.received_evidence_source_message_id, "message-1");
  assert.equal(h.rpcCalls.some((call) => call.fn === "assistant_enqueue_internal_notification"), true);
  assert.equal(h.rpcCalls.some((call) => call.fn.includes("responsible")), false);
  assert.equal(h.updateCalls.some((call) => call.table === "sales_contracts"), false);
});

test("notifica evidencia pendente sem inventar contrato ou versao", async () => {
  const h = harness();
  await pushAssistantReceivedContractDocumentMessage({
    supabase: h.supabase,
    ...baseInput,
    contractId: null,
    contractVersionId: null,
    identificationStatus: "pending_identification",
    customerMessage: "Enviei o documento para conferencia.",
  });

  const message = h.rpcCalls.find((call) => call.fn === "assistant_push_system_message");
  assert.ok(message);
  assert.match(String(message.payload.p_content), /precisa ser associado/);
  const metadata = message.payload.p_metadata as Record<string, unknown>;
  assert.equal(metadata.related_contract_id, null);
  assert.equal(metadata.received_identification_status, "pending_identification");
  assert.deepEqual(metadata.available_actions, []);
});

test("replay da mesma evidencia nao cria segunda mensagem", async () => {
  const h = harness({ existingMessage: { id: "message-assistant-1" } });
  const result = await pushAssistantReceivedContractDocumentMessage({
    supabase: h.supabase,
    ...baseInput,
  });

  assert.equal(result.deduped, true);
  assert.equal(result.messageId, "message-assistant-1");
  assert.equal(h.rpcCalls.length, 0);
});

console.log("document-review-messages.received-contract: PASS");
