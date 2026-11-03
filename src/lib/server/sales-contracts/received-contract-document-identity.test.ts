import assert from "node:assert/strict";
import test from "node:test";
import { resolveReceivedContractDocumentIdentity } from "./received-contract-document-identity";

const scope = {
  organizationId: "org-1",
  storeId: "store-1",
  sourceMessageId: "incoming-1",
};

const message = (overrides: Record<string, unknown> = {}) => ({
  id: "incoming-1",
  organization_id: "org-1",
  store_id: "store-1",
  conversation_id: "conversation-1",
  direction: "incoming",
  sender: "user",
  message_type: "document",
  media_url: "inbound/contracts/received.pdf",
  metadata: {
    storage_bucket: "zion-store-files",
    storage_path: "inbound/contracts/received.pdf",
    mime_type: "application/pdf",
    sha256: "hash-1",
    original_file_name: "contrato-assinado.pdf",
  },
  ...overrides,
});

const contract = (overrides: Record<string, unknown> = {}) => ({
  id: "contract-1",
  organization_id: "org-1",
  store_id: "store-1",
  commercial_opportunity_id: "opportunity-1",
  conversation_id: "conversation-1",
  current_version_id: "version-1",
  ...overrides,
});

const version = (overrides: Record<string, unknown> = {}) => ({
  id: "version-1",
  contract_id: "contract-1",
  organization_id: "org-1",
  store_id: "store-1",
  version_number: 1,
  status: "sent",
  storage_bucket: "zion-store-files",
  storage_path: "inbound/contracts/received.pdf",
  original_filename: "contrato.pdf",
  mime_type: "application/pdf",
  ...overrides,
});

const sent = (overrides: Record<string, unknown> = {}) => ({
  id: "sent-1",
  direction: "outgoing",
  message_type: "document",
  media_url: "inbound/contracts/received.pdf",
  metadata: { storage_path: "inbound/contracts/received.pdf" },
  ...overrides,
});

function resolve(overrides: Partial<Parameters<typeof resolveReceivedContractDocumentIdentity>[0]> = {}) {
  return resolveReceivedContractDocumentIdentity({
    ...scope,
    message: message(),
    contracts: [contract()],
    sentDocuments: [sent()],
    versionsByContract: new Map([["contract-1", [version()]]]),
    ...overrides,
  });
}

test("identifica contrato e versao pela mesma evidencia documental enviada", () => {
  const result = resolve();
  assert.equal(result.outcome, "identified");
  if (result.outcome !== "identified") return;
  assert.equal(result.contractId, "contract-1");
  assert.equal(result.contractVersionId, "version-1");
  assert.equal(result.commercialOpportunityId, "opportunity-1");
  assert.equal(result.storagePath, "inbound/contracts/received.pdf");
  assert.equal(result.signatureStatus, "not_evaluated");
});

test("separa arquivo recebido alterado da identidade do documento enviado", () => {
  const result = resolve({
    message: message({
      created_at: "2026-11-03T15:00:00Z",
      media_url: "inbound/contracts/signed-v2.pdf",
      metadata: {
        storage_bucket: "zion-store-files",
        storage_path: "inbound/contracts/signed-v2.pdf",
        mime_type: "application/pdf",
        sha256: "received-hash",
        original_file_name: "contrato-assinado.pdf",
      },
    }),
    sentDocuments: [sent({
      id: "sent-1",
      media_url: "outbound/contracts/original-v1.pdf",
      created_at: "2026-11-02T15:00:00Z",
      metadata: {
        storage_bucket: "zion-store-files",
        storage_path: "outbound/contracts/original-v1.pdf",
        mime_type: "application/pdf",
        original_file_name: "contrato.pdf",
        sales_contract_id: "contract-1",
        sales_contract_version_id: "version-1",
      },
    })],
    versionsByContract: new Map([["contract-1", [version({
      storage_path: "outbound/contracts/original-v1.pdf",
    })]]]),
  });
  assert.equal(result.outcome, "identified");
  if (result.outcome !== "identified") return;
  assert.equal(result.storagePath, "inbound/contracts/signed-v2.pdf");
  assert.equal(result.sha256, "received-hash");
  assert.deepEqual(result.originalDocument, {
    sourceMessageId: "sent-1",
    storageBucket: "zion-store-files",
    storagePath: "outbound/contracts/original-v1.pdf",
    mimeType: "application/pdf",
    originalFileName: "contrato.pdf",
    sentAt: "2026-11-02T15:00:00Z",
  });
});

test("nao escolhe automaticamente entre contratos possiveis", () => {
  const result = resolve({ contracts: [contract(), contract({ id: "contract-2" })] });
  assert.deepEqual(result, {
    outcome: "pending",
    reason: "multiple_contract_candidates",
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conversation-1",
    sourceMessageId: "incoming-1",
    receivedAt: null,
    candidateContractIds: ["contract-1", "contract-2"],
    candidateVersionIds: [],
    storageBucket: "zion-store-files",
    storagePath: "inbound/contracts/received.pdf",
    mimeType: "application/pdf",
    sha256: "hash-1",
    originalFileName: "contrato-assinado.pdf",
    signatureStatus: "not_evaluated",
  });
});

test("permanece pendente sem evidencia de versao enviada", () => {
  const result = resolve({ sentDocuments: [] });
  assert.equal(result.outcome, "pending");
  assert.equal(result.reason, "version_evidence_missing");
});

test("permanece pendente quando a evidencia aponta para versao antiga diferente", () => {
  const result = resolve({
    versionsByContract: new Map([["contract-1", [version({ id: "version-old", storage_path: "contracts/old.pdf" }), version()]]]),
    sentDocuments: [sent({ media_url: "contracts/old.pdf", metadata: { storage_path: "contracts/old.pdf" } })],
  });
  assert.equal(result.outcome, "pending");
  assert.equal(result.reason, "version_evidence_missing");
});

test("preserva ausencia de hash sem transformar isso em assinatura", () => {
  const result = resolve({ message: message({ metadata: { storage_bucket: "zion-store-files", storage_path: "inbound/contracts/received.pdf", mime_type: "application/pdf" } }) });
  assert.equal(result.outcome, "identified");
  if (result.outcome !== "identified") return;
  assert.equal(result.sha256, null);
  assert.equal(result.signatureStatus, "not_evaluated");
});

test("rejeita mistura de organizacao ou loja sem alterar contrato", () => {
  const result = resolve({ message: message({ organization_id: "other-org" }) });
  assert.equal(result.outcome, "pending");
  assert.equal(result.reason, "message_not_customer_media");
});

test("mensagem duplicada conserva a identidade e aponta a origem anterior", () => {
  const result = resolve({ sentDocuments: [sent(), { ...message({ id: "incoming-old" }) }] });
  assert.equal(result.outcome, "identified");
  if (result.outcome !== "identified") return;
  assert.equal(result.duplicateOfMessageId, "incoming-old");
});

test("nao classifica arquivo sem tipo documental como contrato", () => {
  const result = resolve({ message: message({ message_type: "text" }) });
  assert.equal(result.outcome, "not_contract_related");
});

console.log("received-contract-document-identity: PASS");
