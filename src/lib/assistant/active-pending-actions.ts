export type AssistantPendingCounterMessage = {
  id: string;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

const TERMINAL_DOCUMENT_STATUSES = new Set([
  "completed",
  "cancelled",
  "expired",
  "failed",
  "resolved",
]);

const ACTIONABLE_DOCUMENT_ACTIONS = new Set([
  "review",
  "approve_and_send",
  "approve",
  "send",
  "edit",
  "generate_pdf",
  "confirm_store_signature",
]);

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getSafeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getActionKey(
  action:
    | string
    | {
        id?: string;
        action?: string;
        type?: string;
        kind?: string;
      }
    | null
    | undefined
) {
  if (typeof action === "string") {
    return normalizeText(action);
  }

  return normalizeText(action?.id || action?.action || action?.type || action?.kind);
}

function getActionKeys(value: unknown) {
  if (!Array.isArray(value)) {
    return new Set<string>();
  }

  return new Set(
    value
      .map((item) =>
        getActionKey(
          typeof item === "string" || isRecord(item)
            ? (item as string | Record<string, unknown>)
            : null
        )
      )
      .filter(Boolean)
  );
}

function getMessageTimestamp(value: string | null | undefined) {
  const timestamp = Date.parse(String(value || "").trim());
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getDocumentEntityKey(metadata: Record<string, unknown>) {
  const documentType = normalizeText(metadata.document_type);
  const documentId = getSafeString(metadata.document_id);

  if ((documentType === "quote" || documentType === "contract") && documentId) {
    return `${documentType}:${documentId}`;
  }

  const relatedQuoteId = getSafeString(metadata.related_quote_id);
  if (relatedQuoteId) {
    return `quote:${relatedQuoteId}`;
  }

  const relatedContractId = getSafeString(metadata.related_contract_id);
  if (relatedContractId) {
    return `contract:${relatedContractId}`;
  }

  return null;
}

function getDocumentQuoteRelationKey(metadata: Record<string, unknown>) {
  const relatedQuoteId = getSafeString(metadata.related_quote_id);
  if (relatedQuoteId) {
    return `quote:${relatedQuoteId}`;
  }

  if (normalizeText(metadata.document_type) === "quote") {
    const documentId = getSafeString(metadata.document_id);
    if (documentId) {
      return `quote:${documentId}`;
    }
  }

  return null;
}

function getWorkflowQuoteKey(metadata: Record<string, unknown>) {
  const quoteId = getSafeString(metadata.quote_id);
  return quoteId ? `quote:${quoteId}` : null;
}

function isActiveDocumentReview(metadata: Record<string, unknown>) {
  const status = normalizeText(metadata.document_status);
  const actionKeys = getActionKeys(metadata.available_actions);

  if (actionKeys.size === 0) {
    return false;
  }

  if (TERMINAL_DOCUMENT_STATUSES.has(status)) {
    return false;
  }

  if (status === "sent" || status === "sent_to_customer") {
    return false;
  }

  if (status === "customer_signed") {
    return actionKeys.has("confirm_store_signature");
  }

  if (status === "approved") {
    return actionKeys.has("approve_and_send") || actionKeys.has("send");
  }

  if (status === "pending_review" || status === "draft" || !status) {
    return [...actionKeys].some((actionKey) =>
      ACTIONABLE_DOCUMENT_ACTIONS.has(actionKey)
    );
  }

  return [...actionKeys].some((actionKey) =>
    ACTIONABLE_DOCUMENT_ACTIONS.has(actionKey)
  );
}

function isActiveContractWorkflow(metadata: Record<string, unknown>) {
  const actionKeys = getActionKeys(metadata.available_actions);
  return actionKeys.has("generate_contract");
}

type PendingCandidate = {
  countAsPending: boolean;
  dedupeKey: string;
  kind: "document_review" | "contract_workflow_decision";
  quoteRelationKey: string | null;
  createdAt: number;
};

function buildPendingCandidate(
  message: AssistantPendingCounterMessage
): PendingCandidate | null {
  if (!isRecord(message.metadata)) {
    return null;
  }

  const kind = normalizeText(message.metadata.kind);
  const createdAt = getMessageTimestamp(message.created_at);

  if (kind === "document_review") {
    const entityKey = getDocumentEntityKey(message.metadata) || `message:${message.id}`;
    return {
      countAsPending: isActiveDocumentReview(message.metadata),
      dedupeKey: entityKey,
      kind: "document_review",
      quoteRelationKey: getDocumentQuoteRelationKey(message.metadata),
      createdAt,
    };
  }

  if (kind === "contract_workflow_decision") {
    const quoteKey = getWorkflowQuoteKey(message.metadata);
    return {
      countAsPending: isActiveContractWorkflow(message.metadata),
      dedupeKey: quoteKey ? `workflow:${quoteKey}` : `workflow-message:${message.id}`,
      kind: "contract_workflow_decision",
      quoteRelationKey: quoteKey,
      createdAt,
    };
  }

  return null;
}

export function countActiveAssistantPendingActions(
  messages: AssistantPendingCounterMessage[]
) {
  const latestByKey = new Map<string, PendingCandidate>();

  messages.forEach((message) => {
    const candidate = buildPendingCandidate(message);
    if (!candidate) {
      return;
    }

    const current = latestByKey.get(candidate.dedupeKey);
    if (!current || candidate.createdAt >= current.createdAt) {
      latestByKey.set(candidate.dedupeKey, candidate);
    }
  });

  const latestCandidates = [...latestByKey.values()];
  const latestDocumentTimestampByQuoteKey = new Map<string, number>();

  latestCandidates.forEach((candidate) => {
    if (
      candidate.kind === "document_review" &&
      candidate.quoteRelationKey &&
      candidate.createdAt > (latestDocumentTimestampByQuoteKey.get(candidate.quoteRelationKey) || 0)
    ) {
      latestDocumentTimestampByQuoteKey.set(
        candidate.quoteRelationKey,
        candidate.createdAt
      );
    }
  });

  return latestCandidates.filter((candidate) => {
    if (!candidate.countAsPending) {
      return false;
    }

    if (
      candidate.kind === "contract_workflow_decision" &&
      candidate.quoteRelationKey
    ) {
      const latestDocumentTimestamp =
        latestDocumentTimestampByQuoteKey.get(candidate.quoteRelationKey) || 0;

      if (latestDocumentTimestamp >= candidate.createdAt) {
        return false;
      }
    }

    return true;
  }).length;
}
