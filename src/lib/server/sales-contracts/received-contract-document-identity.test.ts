import assert from "node:assert/strict";
import test from "node:test";
import { identifyReceivedContractDocument, resolveReceivedContractDocumentIdentity } from "./received-contract-document-identity";

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
  conversation_id: "conversation-1",
  current_version_id: "version-1",
  metadata: {
    source: "accepted_quote_version_snapshot",
    commercial_opportunity_id: "opportunity-1",
  },
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

test("identifica contrato manual pela oportunidade canonica no metadata", () => {
  const result = resolve({
    contracts: [contract({ metadata: { created_via: "create_sales_contract_manual_by_system", commercial_opportunity_id: "opportunity-manual" } })],
  });
  assert.equal(result.outcome, "identified");
  if (result.outcome !== "identified") return;
  assert.equal(result.commercialOpportunityId, "opportunity-manual");
});

test("mantem pendente contrato sem oportunidade resolvida", () => {
  const result = resolve({ contracts: [contract({ metadata: { source: "legacy_contract" } })] });
  assert.equal(result.outcome, "pending");
  if (result.outcome !== "pending") return;
  assert.equal(result.reason, "opportunity_missing");
});

test("mantem pendente metadata de oportunidade vazio ou invalido", () => {
  const result = resolve({ contracts: [contract({ metadata: { commercial_opportunity_id: { id: "opportunity-1" } } })] });
  assert.equal(result.outcome, "pending");
  if (result.outcome !== "pending") return;
  assert.equal(result.reason, "opportunity_missing");
});

test("desempata duas versoes pelo nome do arquivo recebido contra a mensagem enviada", () => {
  const result = resolve({
    message: message({
      metadata: {
        ...message().metadata,
        storage_path: "contracts/shared.pdf",
        original_file_name: "contrato-v3.pdf",
      },
      media_url: "contracts/shared.pdf",
    }),
    sentDocuments: [
      sent({
        id: "sent-v1",
        media_url: "contracts/shared.pdf",
        metadata: {
          storage_path: "contracts/shared.pdf",
          original_file_name: "contrato-v1.pdf",
        },
      }),
      sent({
        id: "sent-v3",
        media_url: "contracts/shared.pdf",
        metadata: {
          storage_path: "contracts/shared.pdf",
          original_file_name: "contrato-v3.pdf",
        },
      }),
    ],
    versionsByContract: new Map([[
      "contract-1",
      [
        version({ id: "version-1", storage_path: "contracts/shared.pdf", original_filename: "contrato-v1.pdf" }),
        version({ id: "version-3", version_number: 3, storage_path: "contracts/shared.pdf", original_filename: "contrato-v3.pdf" }),
      ],
    ]]),
  });
  assert.equal(result.outcome, "identified");
  if (result.outcome !== "identified") return;
  assert.equal(result.contractVersionId, "version-3");
  assert.equal(result.originalDocument.sourceMessageId, "sent-v3");
});

test("desempata duas versoes pelo nome do arquivo recebido para a versao 1", () => {
  const result = resolve({
    message: message({
      metadata: {
        ...message().metadata,
        storage_path: "contracts/shared.pdf",
        original_file_name: "contrato-v1.pdf",
      },
      media_url: "contracts/shared.pdf",
    }),
    sentDocuments: [
      sent({
        id: "sent-v1",
        media_url: "contracts/shared.pdf",
        metadata: {
          storage_path: "contracts/shared.pdf",
          original_file_name: "contrato-v1.pdf",
        },
      }),
      sent({
        id: "sent-v3",
        media_url: "contracts/shared.pdf",
        metadata: {
          storage_path: "contracts/shared.pdf",
          original_file_name: "contrato-v3.pdf",
        },
      }),
    ],
    versionsByContract: new Map([[
      "contract-1",
      [
        version({ id: "version-1", storage_path: "contracts/shared.pdf", original_filename: "contrato-v1.pdf" }),
        version({ id: "version-3", version_number: 3, storage_path: "contracts/shared.pdf", original_filename: "contrato-v3.pdf" }),
      ],
    ]]),
  });
  assert.equal(result.outcome, "identified");
  if (result.outcome !== "identified") return;
  assert.equal(result.contractVersionId, "version-1");
  assert.equal(result.originalDocument.sourceMessageId, "sent-v1");
});

test("mantem pendente quando o nome recebido nao diferencia as versoes", () => {
  const result = resolve({
    message: message({
      metadata: {
        ...message().metadata,
        storage_path: "contracts/shared.pdf",
        original_file_name: "contrato-duplicado.pdf",
      },
      media_url: "contracts/shared.pdf",
    }),
    sentDocuments: [
      sent({ id: "sent-v1", media_url: "contracts/shared.pdf", metadata: { storage_path: "contracts/shared.pdf", original_file_name: "contrato-duplicado.pdf" } }),
      sent({ id: "sent-v3", media_url: "contracts/shared.pdf", metadata: { storage_path: "contracts/shared.pdf", original_file_name: "contrato-duplicado.pdf" } }),
    ],
    versionsByContract: new Map([[
      "contract-1",
      [version({ id: "version-1", storage_path: "contracts/shared.pdf" }), version({ id: "version-3", storage_path: "contracts/shared.pdf" })],
    ]]),
  });
  assert.equal(result.outcome, "pending");
  if (result.outcome !== "pending") return;
  assert.equal(result.reason, "multiple_version_candidates");
  assert.deepEqual(result.candidateVersionIds, ["version-1", "version-3"]);
});

test("mantem pendente quando o metadata de nome esta ausente ou invalido", () => {
  const result = resolve({
    message: message({
      metadata: {
        ...message().metadata,
        storage_path: "contracts/shared.pdf",
        original_file_name: { name: "contrato-v3.pdf" },
      },
      media_url: "contracts/shared.pdf",
    }),
    sentDocuments: [
      sent({ id: "sent-v1", media_url: "contracts/shared.pdf", metadata: { storage_path: "contracts/shared.pdf", original_file_name: "contrato-v1.pdf" } }),
      sent({ id: "sent-v3", media_url: "contracts/shared.pdf", metadata: { storage_path: "contracts/shared.pdf", original_file_name: "contrato-v3.pdf" } }),
    ],
    versionsByContract: new Map([[
      "contract-1",
      [version({ id: "version-1", storage_path: "contracts/shared.pdf" }), version({ id: "version-3", storage_path: "contracts/shared.pdf" })],
    ]]),
  });
  assert.equal(result.outcome, "pending");
  if (result.outcome !== "pending") return;
  assert.equal(result.reason, "multiple_version_candidates");
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

  const contractOutOfScope = resolve({ contracts: [contract({ organization_id: "other-org" })] });
  assert.equal(contractOutOfScope.outcome, "pending");
  if (contractOutOfScope.outcome !== "pending") return;
  assert.equal(contractOutOfScope.reason, "no_contract_candidate");
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

test("consulta o contrato somente com campos existentes e inclui metadata", async () => {
  const selects: Array<{ table: string; columns: string }> = [];
  const results: Record<string, unknown> = {
    messages: {
      id: "incoming-1",
      organization_id: "org-1",
      store_id: "store-1",
      conversation_id: "conversation-1",
      direction: "incoming",
      sender: "user",
      message_type: "document",
      media_url: "inbound/contracts/received.pdf",
      metadata: message().metadata,
    },
    sales_contracts: [contract()],
    sales_contract_versions: [version()],
    sent_messages: [sent()],
  };
  type Query = {
    select(columns: string): Query;
    eq(column: string, value: unknown): Query;
    in(column: string, values: unknown[]): Query;
    maybeSingle(): Promise<{ data: unknown; error: null }>;
    then(resolve: (value: unknown) => unknown): Promise<unknown>;
  };
  const supabase = {
    from(table: string) {
      const query: Query = {
        select(columns: string) { selects.push({ table, columns }); return query; },
        eq() { return query; },
        in() { return query; },
        maybeSingle: async () => ({ data: table === "messages" ? results.messages : null, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(resolve({ data: table === "messages" ? results.sent_messages : results[table] || [], error: null }));
        },
      };
      return query;
    },
  } as unknown as Parameters<typeof identifyReceivedContractDocument>[0]["supabase"];
  const result = await identifyReceivedContractDocument({ ...scope, supabase });
  assert.equal(result.outcome, "identified");
  const contractSelect = selects.find((entry) => entry.table === "sales_contracts")?.columns || "";
  assert.match(contractSelect, /metadata/);
  assert.doesNotMatch(contractSelect, /commercial_opportunity_id/);
});

console.log("received-contract-document-identity: PASS");
