import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReceivedContractDocumentEvidenceEventKey,
  parseReceivedContractDocumentEvidence,
  persistReceivedContractDocumentEvidence,
  registerReceivedContractDocumentEvidence,
  readReceivedContractDocumentEvidence,
} from "./received-contract-document-evidence";
import type { ReceivedContractDocumentResolution } from "./received-contract-document-identity";

const identified = (overrides: Partial<Extract<ReceivedContractDocumentResolution, { outcome: "identified" }>> = {}) => ({
  outcome: "identified" as const,
  organizationId: "org-1",
  storeId: "store-1",
  conversationId: "conversation-1",
  commercialOpportunityId: "opportunity-1",
  contractId: "contract-1",
  contractVersionId: "version-1",
  sourceMessageId: "incoming-1",
  receivedAt: "2026-11-03T15:00:00Z",
  storageBucket: "zion-store-files",
  storagePath: "inbound/signed-v2.pdf",
  mimeType: "application/pdf",
  sha256: "received-hash",
  originalFileName: "signed.pdf",
  signatureStatus: "not_evaluated" as const,
  duplicateOfMessageId: null,
  originalDocument: {
    sourceMessageId: "sent-1",
    storageBucket: "zion-store-files",
    storagePath: "outbound/original-v1.pdf",
    mimeType: "application/pdf",
    originalFileName: "contract.pdf",
    sentAt: "2026-11-02T15:00:00Z",
  },
  ...overrides,
});

function harness(options: { existing?: unknown; existingAfterRpc?: unknown; existingError?: string; rpcError?: { code?: string; message: string } } = {}) {
  const calls: Array<{ table: string; operation: string; values?: unknown }> = [];
  const rpcCalls: Array<{ fn: string; payload: Record<string, unknown> }> = [];
  const supabase = {
    from(table: string) {
      const query = {
        select() { return query; },
        eq() { return query; },
        contains() { return query; },
        maybeSingle: async () => {
          calls.push({ table, operation: "maybeSingle" });
          const existing = rpcCalls.length > 0 ? options.existingAfterRpc : options.existing;
          return { data: existing ?? null, error: options.existingError ? { message: options.existingError } : null };
        },
      };
      return query;
    },
    rpc: async (fn: string, payload: Record<string, unknown>) => {
      rpcCalls.push({ fn, payload });
      if (options.rpcError) return { data: null, error: options.rpcError };
      return { data: [{ id: "event-1" }], error: null };
    },
  };
  return { supabase, calls, rpcCalls };
}

test("registra evidencia identificada sem alterar contrato ou assinatura", async () => {
  const h = harness();
  const result = await persistReceivedContractDocumentEvidence({
    supabase: h.supabase,
    resolution: identified(),
    leadId: "lead-1",
  });
  assert.equal(result.outcome, "persisted");
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.rpcCalls[0].payload.p_event_key, "contract_uploaded");
  assert.equal(h.rpcCalls[0].payload.p_conversation_id, null);
  assert.equal(h.rpcCalls[0].fn, "store_business_event_register");
  const payload = h.rpcCalls[0].payload.p_event_payload as Record<string, unknown>;
  const receivedDocument = payload.received_document as Record<string, unknown>;
  const originalDocument = payload.original_document as Record<string, unknown>;
  assert.equal(payload.identification_status, "identified");
  assert.equal(payload.contract_version_id, "version-1");
  assert.equal(payload.source_message_id, "incoming-1");
  assert.equal(receivedDocument.storagePath, "inbound/signed-v2.pdf");
  assert.equal(originalDocument.storagePath, "outbound/original-v1.pdf");
  assert.equal(payload.signature_status, "not_evaluated");
  assert.deepEqual(h.calls.map((call) => call.table), ["store_business_events"]);
});

test("executa o fluxo integrado da identificacao ate o registro canonico", async () => {
  const rpcCalls: Array<{ fn: string; payload: Record<string, unknown> }> = [];
  let messageReads = 0;
  const results: Record<string, unknown> = {
    messages: null,
    sales_contracts: [{ id: "contract-1", organization_id: "org-1", store_id: "store-1", current_version_id: "version-1", status: "sent_to_customer", metadata: { commercial_opportunity_id: "opportunity-1" }, conversation_id: "conversation-1" }],
    sales_contract_versions: [{ id: "version-1", contract_id: "contract-1", organization_id: "org-1", store_id: "store-1", status: "sent", storage_bucket: "zion-store-files", storage_path: "outbound/original-v1.pdf", original_filename: "contract.pdf", mime_type: "application/pdf" }],
  };
  const supabase = {
    from(table: string) {
      const query = {
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        contains() { return query; },
        maybeSingle: async () => {
          if (table === "messages") {
            messageReads += 1;
            if (messageReads === 1) return { data: {
              id: "incoming-1", organization_id: "org-1", store_id: "store-1", conversation_id: "conversation-1",
              direction: "incoming", sender: "user", message_type: "document", created_at: "2026-11-03T15:00:00Z",
              media_url: "inbound/signed-v2.pdf", metadata: { storage_bucket: "zion-store-files", storage_path: "inbound/signed-v2.pdf", mime_type: "application/pdf", sha256: "hash", original_file_name: "contrato-assinado.pdf" },
            }, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve: (value: unknown) => unknown) {
          const data = table === "messages" ? [{ id: "sent-1", direction: "outgoing", message_type: "document", media_url: "outbound/original-v1.pdf", external_message_id: "wamid.sent-1", outbound_delivery_state: "sent", created_at: "2026-11-02T15:00:00Z", metadata: { source: "sales_contract_send_route", outbound_origin: "sales_contract_send", whatsapp_status: "delivered", storage_bucket: "zion-store-files", storage_path: "outbound/original-v1.pdf", sales_contract_id: "contract-1", sales_contract_version_id: "version-1" } }] : results[table] || null;
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return query;
    },
    rpc: async (fn: string, payload: Record<string, unknown>) => {
      rpcCalls.push({ fn, payload });
      return { data: [{ id: "event-1" }], error: null };
    },
  };
  const result = await registerReceivedContractDocumentEvidence({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    sourceMessageId: "incoming-1",
  });
  assert.equal(result.outcome, "persisted");
  assert.equal(rpcCalls.length, 1);
  const payload = rpcCalls[0].payload.p_event_payload as Record<string, unknown>;
  const originalDocument = payload.original_document as Record<string, unknown>;
  const receivedDocument = payload.received_document as Record<string, unknown>;
  assert.equal(payload.contract_version_id, "version-1");
  assert.equal(originalDocument.storagePath, "outbound/original-v1.pdf");
  assert.equal(receivedDocument.storagePath, "inbound/signed-v2.pdf");
});

test("usa chave deterministica e nao duplica replay ja persistido", async () => {
  const first = identified();
  const eventKey = buildReceivedContractDocumentEvidenceEventKey(first);
  const h = harness({
    existing: {
      event_key: eventKey,
      organization_id: "org-1",
      store_id: "store-1",
      event_payload: {
        schema: "received_contract_document_evidence",
        schema_version: 1,
        organizationId: "org-1",
        storeId: "store-1",
        sourceMessageId: "incoming-1",
        identificationStatus: "identified",
        eventKey,
        receivedDocument: { storageBucket: "zion-store-files", storagePath: "inbound/signed-v2.pdf" },
        originalDocument: null,
        signatureStatus: "not_evaluated",
        candidateContractIds: ["contract-1"],
        candidateVersionIds: ["version-1"],
      },
    },
  });
  const result = await persistReceivedContractDocumentEvidence({ supabase: h.supabase, resolution: first });
  assert.equal(result.outcome, "already_persisted");
  assert.equal(h.rpcCalls.length, 0);
});

test("trata SQLSTATE 23505 como replay somente apos reler a evidencia", async () => {
  const first = identified();
  const eventKey = buildReceivedContractDocumentEvidenceEventKey(first);
  const h = harness({
    rpcError: { code: "23505", message: "duplicate key value violates unique constraint" },
    existingAfterRpc: {
      event_key: eventKey,
      organization_id: "org-1",
      store_id: "store-1",
      event_payload: {
        schema: "received_contract_document_evidence",
        schema_version: 1,
        organization_id: "org-1",
        store_id: "store-1",
        source_message_id: "incoming-1",
        identification_status: "identified",
        received_document: { storage_bucket: "zion-store-files", storage_path: "inbound/signed-v2.pdf" },
        signature_status: "not_evaluated",
      },
    },
  });
  const result = await persistReceivedContractDocumentEvidence({ supabase: h.supabase, resolution: first });
  assert.equal(result.outcome, "already_persisted");
  assert.equal(h.rpcCalls.length, 1);
});

test("preserva documento pendente sem inventar contrato ou versao", async () => {
  const h = harness();
  const result = await persistReceivedContractDocumentEvidence({
    supabase: h.supabase,
    resolution: {
      outcome: "pending",
      reason: "multiple_version_candidates",
      organizationId: "org-1",
      storeId: "store-1",
      conversationId: "conversation-1",
      sourceMessageId: "incoming-2",
      receivedAt: "2026-11-03T15:01:00Z",
      candidateContractIds: ["contract-1"],
      candidateVersionIds: ["version-1", "version-2"],
      storageBucket: "zion-store-files",
      storagePath: "inbound/ambiguous.pdf",
      mimeType: "application/pdf",
      sha256: null,
      originalFileName: "ambiguous.pdf",
      signatureStatus: "not_evaluated",
    },
  });
  assert.equal(result.outcome, "persisted");
  const payload = h.rpcCalls[0].payload.p_event_payload as Record<string, unknown>;
  assert.equal(payload.identification_status, "pending_identification");
  assert.equal(payload.contract_id, null);
  assert.deepEqual(payload.candidate_version_ids, ["version-1", "version-2"]);
});

test("ignora documento nao relacionado sem persistir evento contratual", async () => {
  const h = harness();
  const result = await persistReceivedContractDocumentEvidence({
    supabase: h.supabase,
    resolution: {
      outcome: "not_contract_related",
      reason: "message_not_contract_document",
      organizationId: "org-1",
      storeId: "store-1",
      conversationId: "conversation-1",
      sourceMessageId: "incoming-3",
    },
  });
  assert.equal(result.outcome, "not_contract_related");
  assert.equal(h.rpcCalls.length, 0);
  assert.equal(h.calls.length, 0);
});

test("le a evidencia somente dentro da chave de organizacao e loja", async () => {
  const resolution = identified();
  const eventKey = buildReceivedContractDocumentEvidenceEventKey(resolution);
  const h = harness({
    existing: {
      event_key: eventKey,
      organization_id: "org-1",
      store_id: "store-1",
      event_payload: {
        organizationId: "org-1", storeId: "store-1", sourceMessageId: "incoming-1",
        identificationStatus: "identified", eventKey,
        receivedDocument: { storageBucket: "zion-store-files", storagePath: "inbound/signed-v2.pdf" },
        signatureStatus: "not_evaluated", candidateContractIds: [], candidateVersionIds: [],
      },
    },
  });
  const result = await readReceivedContractDocumentEvidence({
    supabase: h.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    sourceMessageId: "incoming-1",
  });
  assert.equal(result?.contractId, null);
  assert.equal(h.calls[0].table, "store_business_events");
});

test("falha fechada para payload de evidencia malformado", () => {
  assert.equal(parseReceivedContractDocumentEvidence({ event_payload: {} }), null);
});

console.log("received-contract-document-evidence: PASS");
