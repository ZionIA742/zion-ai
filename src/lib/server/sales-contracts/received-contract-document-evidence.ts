import {
  identifyReceivedContractDocument,
  type ReceivedContractDocumentResolution,
} from "./received-contract-document-identity";
export const RECEIVED_CONTRACT_DOCUMENT_EVIDENCE_EVENT =
  "contract_uploaded";
const RECEIVED_CONTRACT_DOCUMENT_EVIDENCE_SCHEMA =
  "received_contract_document_evidence";
const EVIDENCE_SCHEMA_VERSION = 1;

export type ReceivedContractDocumentEvidenceRecord = {
  organizationId: string;
  storeId: string;
  conversationId: string | null;
  commercialOpportunityId: string | null;
  contractId: string | null;
  contractVersionId: string | null;
  sourceMessageId: string;
  receivedAt: string | null;
  identificationStatus: "identified" | "pending_identification";
  identificationReason: string | null;
  receivedDocument: {
    storageBucket: string | null;
    storagePath: string | null;
    mimeType: string | null;
    originalFileName: string | null;
    sha256: string | null;
  };
  originalDocument: {
    sourceMessageId: string | null;
    storageBucket: string | null;
    storagePath: string | null;
    mimeType: string | null;
    originalFileName: string | null;
    sentAt: string | null;
  } | null;
  candidateContractIds: string[];
  candidateVersionIds: string[];
  signatureStatus: "not_evaluated";
  duplicateOfMessageId: string | null;
  eventKey: string;
};

type QueryResult = { data: unknown; error: { message: string } | null };

function text(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayOfText(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(text).filter((item): item is string => Boolean(item))
    : [];
}

export function buildReceivedContractDocumentEvidenceEventKey(args: {
  organizationId: string;
  storeId: string;
  sourceMessageId: string;
}) {
  void args;
  return RECEIVED_CONTRACT_DOCUMENT_EVIDENCE_EVENT;
}

function toRecord(
  resolution: Exclude<ReceivedContractDocumentResolution, { outcome: "error" | "not_contract_related" }>,
  eventKey: string,
): ReceivedContractDocumentEvidenceRecord {
  const identified = resolution.outcome === "identified";
  return {
    organizationId: resolution.organizationId,
    storeId: resolution.storeId,
    conversationId: resolution.conversationId,
    commercialOpportunityId: identified ? resolution.commercialOpportunityId : null,
    contractId: identified ? resolution.contractId : null,
    contractVersionId: identified ? resolution.contractVersionId : null,
    sourceMessageId: resolution.sourceMessageId,
    receivedAt: resolution.receivedAt,
    identificationStatus: identified ? "identified" : "pending_identification",
    identificationReason: identified ? null : resolution.reason,
    receivedDocument: {
      storageBucket: resolution.storageBucket,
      storagePath: resolution.storagePath,
      mimeType: resolution.mimeType,
      originalFileName: resolution.originalFileName,
      sha256: resolution.sha256,
    },
    originalDocument: identified ? resolution.originalDocument : null,
    candidateContractIds: identified ? [resolution.contractId] : resolution.candidateContractIds,
    candidateVersionIds: identified ? [resolution.contractVersionId] : resolution.candidateVersionIds,
    signatureStatus: "not_evaluated",
    duplicateOfMessageId: identified ? resolution.duplicateOfMessageId : null,
    eventKey,
  };
}

function eventPayload(record: ReceivedContractDocumentEvidenceRecord) {
  return {
    schema: RECEIVED_CONTRACT_DOCUMENT_EVIDENCE_SCHEMA,
    schema_version: EVIDENCE_SCHEMA_VERSION,
    event_type: RECEIVED_CONTRACT_DOCUMENT_EVIDENCE_SCHEMA,
    organization_id: record.organizationId,
    store_id: record.storeId,
    conversation_id: record.conversationId,
    commercial_opportunity_id: record.commercialOpportunityId,
    contract_id: record.contractId,
    contract_version_id: record.contractVersionId,
    source_message_id: record.sourceMessageId,
    received_at: record.receivedAt,
    identification_status: record.identificationStatus,
    identification_reason: record.identificationReason,
    received_document: record.receivedDocument,
    original_document: record.originalDocument,
    candidate_contract_ids: record.candidateContractIds,
    candidate_version_ids: record.candidateVersionIds,
    signature_status: record.signatureStatus,
    duplicate_of_message_id: record.duplicateOfMessageId,
  };
}

function isUniqueViolation(error: { code?: unknown; message?: unknown } | null) {
  return String(error?.code || "").trim() === "23505" ||
    String(error?.message || "").toLowerCase().includes("duplicate key");
}

export type ReceivedContractDocumentEvidencePersistence =
  | { outcome: "persisted" | "already_persisted"; record: ReceivedContractDocumentEvidenceRecord }
  | { outcome: "not_contract_related"; record: null };

export async function persistReceivedContractDocumentEvidence(args: {
  supabase: any;
  resolution: ReceivedContractDocumentResolution;
  leadId?: string | null;
}) : Promise<ReceivedContractDocumentEvidencePersistence> {
  if (args.resolution.outcome === "error") {
    throw new Error(`Falha ao identificar documento recebido: ${args.resolution.error}`);
  }
  if (args.resolution.outcome === "not_contract_related") {
    return { outcome: "not_contract_related", record: null };
  }

  const eventKey = buildReceivedContractDocumentEvidenceEventKey(args.resolution);
  const record = toRecord(args.resolution, eventKey);
  const existingQuery = await args.supabase
    .from("store_business_events")
    .select("event_key, organization_id, store_id, event_payload")
    .eq("organization_id", record.organizationId)
    .eq("store_id", record.storeId)
    .eq("event_key", RECEIVED_CONTRACT_DOCUMENT_EVIDENCE_EVENT)
    .contains("event_payload", {
      schema: RECEIVED_CONTRACT_DOCUMENT_EVIDENCE_SCHEMA,
      source_message_id: record.sourceMessageId,
    })
    .maybeSingle() as QueryResult;
  if (existingQuery.error) {
    throw new Error(`Falha ao consultar evidencia documental existente: ${existingQuery.error.message}`);
  }
  if (existingQuery.data) {
    const existing = parseReceivedContractDocumentEvidence(existingQuery.data);
    if (
      !existing ||
      existing.eventKey !== eventKey ||
      existing.organizationId !== record.organizationId ||
      existing.storeId !== record.storeId ||
      existing.sourceMessageId !== record.sourceMessageId
    ) {
      throw new Error("Evidencia documental existente possui escopo ou payload invalido.");
    }
    return { outcome: "already_persisted", record: existing };
  }

  const { error } = await args.supabase.rpc("store_business_event_register", {
    p_organization_id: record.organizationId,
    p_store_id: record.storeId,
    p_event_key: RECEIVED_CONTRACT_DOCUMENT_EVIDENCE_EVENT,
    p_actor_type: "customer",
    p_lead_id: args.leadId || null,
    p_conversation_id: null,
    p_actor_user_id: null,
    p_event_payload: eventPayload(record),
  });
  if (error) {
    if (isUniqueViolation(error)) {
      const replay = await readReceivedContractDocumentEvidence({
        supabase: args.supabase,
        organizationId: record.organizationId,
        storeId: record.storeId,
        sourceMessageId: record.sourceMessageId,
      });
      if (replay) return { outcome: "already_persisted", record: replay };
    }
    throw new Error(`Falha ao registrar evidencia documental: ${error.message || "erro SQL"}`);
  }
  return { outcome: "persisted", record };
}

export async function registerReceivedContractDocumentEvidence(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  sourceMessageId: string;
  leadId?: string | null;
}) {
  const resolution = await identifyReceivedContractDocument(args);
  return persistReceivedContractDocumentEvidence({
    supabase: args.supabase,
    resolution,
    leadId: args.leadId,
  });
}

export function parseReceivedContractDocumentEvidence(value: unknown): ReceivedContractDocumentEvidenceRecord | null {
  const row = object(value);
  const payload = object(row.event_payload || value);
  const organizationId = text(payload.organizationId || payload.organization_id);
  const storeId = text(payload.storeId || payload.store_id);
  const sourceMessageId = text(payload.sourceMessageId || payload.source_message_id);
  const eventKey = text(row.event_key || payload.eventKey || payload.event_key);
  const status = text(payload.identificationStatus || payload.identification_status);
  const receivedDocument = object(payload.receivedDocument || payload.received_document);
  if (
    !organizationId || !storeId || !sourceMessageId || eventKey !== RECEIVED_CONTRACT_DOCUMENT_EVIDENCE_EVENT ||
    !["identified", "pending_identification"].includes(status || "") ||
    text(receivedDocument.storagePath || receivedDocument.storage_path) === null &&
      text(receivedDocument.storageBucket || receivedDocument.storage_bucket) === null
  ) return null;
  const original = payload.originalDocument || payload.original_document;
  const originalDocument = original ? object(original) : null;
  return {
    organizationId,
    storeId,
    conversationId: text(payload.conversationId || payload.conversation_id),
    commercialOpportunityId: text(payload.commercialOpportunityId || payload.commercial_opportunity_id),
    contractId: text(payload.contractId || payload.contract_id),
    contractVersionId: text(payload.contractVersionId || payload.contract_version_id),
    sourceMessageId,
    receivedAt: text(payload.receivedAt || payload.received_at),
    identificationStatus: status as "identified" | "pending_identification",
    identificationReason: text(payload.identificationReason || payload.identification_reason),
    receivedDocument: {
      storageBucket: text(receivedDocument.storageBucket || receivedDocument.storage_bucket),
      storagePath: text(receivedDocument.storagePath || receivedDocument.storage_path),
      mimeType: text(receivedDocument.mimeType || receivedDocument.mime_type),
      originalFileName: text(receivedDocument.originalFileName || receivedDocument.original_file_name),
      sha256: text(receivedDocument.sha256),
    },
    originalDocument: originalDocument ? {
      sourceMessageId: text(originalDocument.sourceMessageId || originalDocument.source_message_id),
      storageBucket: text(originalDocument.storageBucket || originalDocument.storage_bucket),
      storagePath: text(originalDocument.storagePath || originalDocument.storage_path),
      mimeType: text(originalDocument.mimeType || originalDocument.mime_type),
      originalFileName: text(originalDocument.originalFileName || originalDocument.original_file_name),
      sentAt: text(originalDocument.sentAt || originalDocument.sent_at),
    } : null,
    candidateContractIds: arrayOfText(payload.candidateContractIds || payload.candidate_contract_ids),
    candidateVersionIds: arrayOfText(payload.candidateVersionIds || payload.candidate_version_ids),
    signatureStatus: "not_evaluated",
    duplicateOfMessageId: text(payload.duplicateOfMessageId || payload.duplicate_of_message_id),
    eventKey,
  };
}

export async function readReceivedContractDocumentEvidence(args: {
  supabase: Pick<any, "from">;
  organizationId: string;
  storeId: string;
  sourceMessageId: string;
}): Promise<ReceivedContractDocumentEvidenceRecord | null> {
  const eventKey = buildReceivedContractDocumentEvidenceEventKey(args);
  const result = await args.supabase
    .from("store_business_events")
    .select("event_key, organization_id, store_id, event_payload")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("event_key", RECEIVED_CONTRACT_DOCUMENT_EVIDENCE_EVENT)
    .contains("event_payload", {
      schema: RECEIVED_CONTRACT_DOCUMENT_EVIDENCE_SCHEMA,
      source_message_id: args.sourceMessageId,
    })
    .maybeSingle() as QueryResult;
  if (result.error) throw new Error(`Falha ao ler evidencia documental: ${result.error.message}`);
  const record = result.data ? parseReceivedContractDocumentEvidence(result.data) : null;
  if (record && (record.organizationId !== args.organizationId || record.storeId !== args.storeId || record.sourceMessageId !== args.sourceMessageId)) {
    throw new Error("Evidencia documental lida fora do escopo solicitado.");
  }
  return record;
}
