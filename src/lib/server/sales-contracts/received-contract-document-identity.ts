import type { SupabaseClient } from "@supabase/supabase-js";

export type ReceivedContractDocumentResolution =
  | {
      outcome: "identified";
      organizationId: string;
      storeId: string;
      conversationId: string;
      commercialOpportunityId: string;
      contractId: string;
      contractVersionId: string;
      sourceMessageId: string;
      storageBucket: string;
      storagePath: string;
      mimeType: string | null;
      sha256: string | null;
      originalFileName: string | null;
      signatureStatus: "not_evaluated";
      duplicateOfMessageId: string | null;
    }
  | {
      outcome: "pending";
      reason:
        | "message_not_found"
        | "message_not_customer_media"
        | "media_identity_missing"
        | "opportunity_missing"
        | "no_contract_candidate"
        | "version_evidence_missing"
        | "multiple_contract_candidates"
        | "multiple_version_candidates";
      organizationId: string;
      storeId: string;
      conversationId: string | null;
      sourceMessageId: string;
      candidateContractIds: string[];
      candidateVersionIds: string[];
      storageBucket: string | null;
      storagePath: string | null;
      mimeType: string | null;
      sha256: string | null;
      originalFileName: string | null;
      signatureStatus: "not_evaluated";
    }
  | {
      outcome: "not_contract_related";
      reason: "message_not_contract_document";
      organizationId: string;
      storeId: string;
      conversationId: string | null;
      sourceMessageId: string;
    }
  | {
      outcome: "error";
      reason: "message_lookup_failed" | "contract_lookup_failed" | "version_lookup_failed";
      organizationId: string;
      storeId: string;
      sourceMessageId: string;
      error: string;
    };

type ReceivedMessageRow = {
  id?: unknown;
  organization_id?: unknown;
  store_id?: unknown;
  conversation_id?: unknown;
  direction?: unknown;
  sender?: unknown;
  message_type?: unknown;
  content?: unknown;
  media_url?: unknown;
  external_message_id?: unknown;
  metadata?: unknown;
};

type ContractRow = {
  id?: unknown;
  organization_id?: unknown;
  store_id?: unknown;
  commercial_opportunity_id?: unknown;
  conversation_id?: unknown;
  current_version_id?: unknown;
};

type VersionRow = {
  id?: unknown;
  contract_id?: unknown;
  organization_id?: unknown;
  store_id?: unknown;
  version_number?: unknown;
  status?: unknown;
  storage_bucket?: unknown;
  storage_path?: unknown;
  original_filename?: unknown;
  mime_type?: unknown;
};

type QueryResult = { data: unknown; error: { message: string } | null };

function text(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : value ? [value as T] : [];
}

function basePending(args: {
  organizationId: string;
  storeId: string;
  sourceMessageId: string;
  conversationId: string | null;
  reason: Extract<ReceivedContractDocumentResolution, { outcome: "pending" }>['reason'];
  storageBucket?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  sha256?: string | null;
  originalFileName?: string | null;
  candidateContractIds?: string[];
  candidateVersionIds?: string[];
}): ReceivedContractDocumentResolution {
  return {
    outcome: "pending",
    reason: args.reason,
    organizationId: args.organizationId,
    storeId: args.storeId,
    conversationId: args.conversationId,
    sourceMessageId: args.sourceMessageId,
    candidateContractIds: args.candidateContractIds || [],
    candidateVersionIds: args.candidateVersionIds || [],
    storageBucket: args.storageBucket || null,
    storagePath: args.storagePath || null,
    mimeType: args.mimeType || null,
    sha256: args.sha256 || null,
    originalFileName: args.originalFileName || null,
    signatureStatus: "not_evaluated",
  };
}

export function resolveReceivedContractDocumentIdentity(args: {
  organizationId: string;
  storeId: string;
  sourceMessageId: string;
  message: ReceivedMessageRow | null;
  contracts: ContractRow[];
  sentDocuments: ReceivedMessageRow[];
  versionsByContract: Map<string, VersionRow[]>;
}): ReceivedContractDocumentResolution {
  const organizationId = text(args.organizationId) || "";
  const storeId = text(args.storeId) || "";
  const sourceMessageId = text(args.sourceMessageId) || "";
  const message = args.message;
  const conversationId = text(message?.conversation_id);
  const metadata = record(message?.metadata);
  const messageType = text(message?.message_type)?.toLowerCase();

  if (!message) {
    return basePending({ organizationId, storeId, sourceMessageId, conversationId: null, reason: "message_not_found" });
  }
  if (
    text(message.organization_id) !== organizationId ||
    text(message.store_id) !== storeId ||
    text(message.direction)?.toLowerCase() !== "incoming" ||
    text(message.sender)?.toLowerCase() !== "user"
  ) {
    return basePending({ organizationId, storeId, sourceMessageId, conversationId, reason: "message_not_customer_media" });
  }
  if (messageType !== "document" && messageType !== "image") {
    return {
      outcome: "not_contract_related",
      reason: "message_not_contract_document",
      organizationId,
      storeId,
      conversationId,
      sourceMessageId,
    };
  }

  const storageBucket = text(metadata.storage_bucket);
  const storagePath = text(metadata.storage_path) || text(message.media_url);
  const mimeType = text(metadata.mime_type);
  const sha256 = text(metadata.sha256);
  const originalFileName = text(metadata.original_file_name);
  if (!conversationId || !storageBucket || !storagePath) {
    return basePending({
      organizationId,
      storeId,
      sourceMessageId,
      conversationId,
      reason: "media_identity_missing",
      storageBucket,
      storagePath,
      mimeType,
      sha256,
      originalFileName,
    });
  }

  const contracts = args.contracts.filter((contract) =>
    text(contract.organization_id) === organizationId &&
    text(contract.store_id) === storeId &&
    text(contract.conversation_id) === conversationId,
  );
  const candidateContractIds = contracts.map((contract) => text(contract.id)).filter((id): id is string => Boolean(id));
  if (contracts.length === 0) {
    return basePending({ organizationId, storeId, sourceMessageId, conversationId, reason: "no_contract_candidate", storageBucket, storagePath, mimeType, sha256, originalFileName });
  }
  const opportunityIds = Array.from(new Set(contracts.map((contract) => text(contract.commercial_opportunity_id)).filter((id): id is string => Boolean(id))));
  if (opportunityIds.length !== 1) {
    return basePending({ organizationId, storeId, sourceMessageId, conversationId, reason: "opportunity_missing", storageBucket, storagePath, mimeType, sha256, originalFileName, candidateContractIds });
  }
  if (contracts.length > 1) {
    return basePending({ organizationId, storeId, sourceMessageId, conversationId, reason: "multiple_contract_candidates", storageBucket, storagePath, mimeType, sha256, originalFileName, candidateContractIds });
  }

  const contract = contracts[0];
  const contractId = text(contract.id) || "";
  const versions = args.versionsByContract.get(contractId) || [];
  const matchingVersions = versions.filter((version) => {
    return text(version.organization_id) === organizationId &&
      text(version.store_id) === storeId &&
      text(version.contract_id) === contractId &&
      text(version.storage_bucket) === storageBucket &&
      text(version.storage_path) === storagePath &&
      args.sentDocuments.some((sent) =>
        text(sent.direction)?.toLowerCase() === "outgoing" &&
        text(sent.message_type)?.toLowerCase() === "document" &&
        text(sent.media_url) === storagePath &&
        text(record(sent.metadata).storage_path) === storagePath,
      );
  });
  const candidateVersionIds = matchingVersions.map((version) => text(version.id)).filter((id): id is string => Boolean(id));
  if (matchingVersions.length !== 1) {
    return basePending({ organizationId, storeId, sourceMessageId, conversationId, reason: matchingVersions.length > 1 ? "multiple_version_candidates" : "version_evidence_missing", storageBucket, storagePath, mimeType, sha256, originalFileName, candidateContractIds, candidateVersionIds });
  }

  const version = matchingVersions[0];
  const versionId = text(version.id) || "";
  const duplicate = args.sentDocuments.find((sent) =>
    text(sent.id) !== sourceMessageId &&
    text(sent.direction)?.toLowerCase() === "incoming" &&
    text(record(sent.metadata).storage_bucket) === storageBucket &&
    text(record(sent.metadata).storage_path) === storagePath &&
    (sha256 === null || text(record(sent.metadata).sha256) === sha256),
  );
  return {
    outcome: "identified",
    organizationId,
    storeId,
    conversationId,
    commercialOpportunityId: opportunityIds[0],
    contractId,
    contractVersionId: versionId,
    sourceMessageId,
    storageBucket,
    storagePath,
    mimeType,
    sha256,
    originalFileName,
    signatureStatus: "not_evaluated",
    duplicateOfMessageId: text(duplicate?.id),
  };
}

export async function identifyReceivedContractDocument(args: {
  supabase: Pick<SupabaseClient, "from">;
  organizationId: string;
  storeId: string;
  sourceMessageId: string;
}): Promise<ReceivedContractDocumentResolution> {
  const organizationId = text(args.organizationId) || "";
  const storeId = text(args.storeId) || "";
  const sourceMessageId = text(args.sourceMessageId) || "";
  const messageQuery = await args.supabase
    .from("messages")
    .select("id, organization_id, store_id, conversation_id, direction, sender, message_type, media_url, metadata")
    .eq("id", sourceMessageId)
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .maybeSingle() as QueryResult;
  if (messageQuery.error) return { outcome: "error", reason: "message_lookup_failed", organizationId, storeId, sourceMessageId, error: messageQuery.error.message };
  const message = (messageQuery.data || null) as ReceivedMessageRow | null;
  const conversationId = text(message?.conversation_id);
  if (!conversationId) return resolveReceivedContractDocumentIdentity({ organizationId, storeId, sourceMessageId, message, contracts: [], sentDocuments: [], versionsByContract: new Map() });

  const contractsQuery = await args.supabase
    .from("sales_contracts")
    .select("id, organization_id, store_id, commercial_opportunity_id, conversation_id, current_version_id")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("conversation_id", conversationId) as QueryResult;
  if (contractsQuery.error) return { outcome: "error", reason: "contract_lookup_failed", organizationId, storeId, sourceMessageId, error: contractsQuery.error.message };
  const contracts = rows<ContractRow>(contractsQuery.data);
  const contractIds = contracts.map((contract) => text(contract.id)).filter((id): id is string => Boolean(id));
  const versionsByContract = new Map<string, VersionRow[]>();
  for (const contractId of contractIds) {
    const versionsQuery = await args.supabase
      .from("sales_contract_versions")
      .select("id, contract_id, organization_id, store_id, version_number, status, storage_bucket, storage_path, original_filename, mime_type")
      .eq("contract_id", contractId)
      .eq("organization_id", organizationId)
      .eq("store_id", storeId) as QueryResult;
    if (versionsQuery.error) return { outcome: "error", reason: "version_lookup_failed", organizationId, storeId, sourceMessageId, error: versionsQuery.error.message };
    versionsByContract.set(contractId, rows<VersionRow>(versionsQuery.data));
  }

  const sentDocumentsQuery = await args.supabase
    .from("messages")
    .select("id, direction, message_type, media_url, metadata")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("conversation_id", conversationId)
    .in("message_type", ["document", "image"]) as QueryResult;
  if (sentDocumentsQuery.error) return { outcome: "error", reason: "version_lookup_failed", organizationId, storeId, sourceMessageId, error: sentDocumentsQuery.error.message };

  return resolveReceivedContractDocumentIdentity({
    organizationId,
    storeId,
    sourceMessageId,
    message,
    contracts,
    sentDocuments: rows<ReceivedMessageRow>(sentDocumentsQuery.data),
    versionsByContract,
  });
}
