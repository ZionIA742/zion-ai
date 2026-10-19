import type { OverviewDataAvailability } from "./overview-pagination";

export type CommercialActionEvidenceKind =
  | "processed_recorded"
  | "processing_error_recorded"
  | "pending_unconfirmed"
  | "invalid";

export type CommercialActionEvidence = {
  source: "ai_sales_action_queue";
  id: string | null;
  storeId: string | null;
  kind: CommercialActionEvidenceKind;
  processedAt: string | null;
  hasProcessingError: boolean;
};

export type CommercialActionEvidenceCounts = {
  processedRecorded: number;
  processingErrors: number;
  pendingUnconfirmed: number;
  invalid: number;
};

export type CommercialActionEvidenceSummary = {
  source: "ai_sales_action_queue";
  storeId: string;
  availability: OverviewDataAvailability;
  records: CommercialActionEvidence[];
  observedCounts: CommercialActionEvidenceCounts;
  confirmedCounts: CommercialActionEvidenceCounts | null;
};

type CommercialActionQueueRow = {
  id?: unknown;
  store_id?: unknown;
  processed_at?: unknown;
  processing_error?: unknown;
  next_action?: unknown;
  action_key?: unknown;
};

const EMPTY_COUNTS: CommercialActionEvidenceCounts = {
  processedRecorded: 0,
  processingErrors: 0,
  pendingUnconfirmed: 0,
  invalid: 0,
};

function hasOwn(row: CommercialActionQueueRow, key: keyof CommercialActionQueueRow) {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function requiredText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function optionalText(value: unknown) {
  if (value === null) return true;
  return requiredText(value) !== null;
}

function validTimestamp(value: unknown) {
  if (value === null) return true;
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function createInvalidEvidence(row: CommercialActionQueueRow): CommercialActionEvidence {
  return {
    source: "ai_sales_action_queue",
    id: requiredText(row.id),
    storeId: requiredText(row.store_id),
    kind: "invalid",
    processedAt: typeof row.processed_at === "string" ? row.processed_at.trim() || null : null,
    hasProcessingError: typeof row.processing_error === "string"
      ? row.processing_error.trim().length > 0
      : row.processing_error != null,
  };
}

export function normalizeCommercialActionEvidence(value: unknown): CommercialActionEvidence {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as CommercialActionQueueRow
    : {};

  const complete = Object.keys(row).length > 0 &&
    (["id", "store_id", "processed_at", "processing_error", "next_action", "action_key"] as const)
      .every((key) => hasOwn(row, key));
  const id = requiredText(row.id);
  const storeId = requiredText(row.store_id);
  const valid = complete &&
    id !== null &&
    storeId !== null &&
    validTimestamp(row.processed_at) &&
    (row.processing_error === null || typeof row.processing_error === "string") &&
    optionalText(row.next_action) &&
    optionalText(row.action_key);

  if (!valid) return createInvalidEvidence(row);

  const processedAt = row.processed_at === null ? null : String(row.processed_at).trim();
  const hasProcessingError = String(row.processing_error || "").trim().length > 0;

  return {
    source: "ai_sales_action_queue",
    id,
    storeId,
    kind: hasProcessingError
      ? "processing_error_recorded"
      : processedAt
        ? "processed_recorded"
        : "pending_unconfirmed",
    processedAt,
    hasProcessingError,
  };
}

function incrementCounts(
  counts: CommercialActionEvidenceCounts,
  kind: CommercialActionEvidenceKind,
) {
  if (kind === "processed_recorded") counts.processedRecorded += 1;
  if (kind === "processing_error_recorded") counts.processingErrors += 1;
  if (kind === "pending_unconfirmed") counts.pendingUnconfirmed += 1;
  if (kind === "invalid") counts.invalid += 1;
}

function createSummary(
  storeId: string,
  availability: OverviewDataAvailability,
): CommercialActionEvidenceSummary {
  return {
    source: "ai_sales_action_queue",
    storeId,
    availability,
    records: [],
    observedCounts: { ...EMPTY_COUNTS },
    confirmedCounts: null,
  };
}

export function buildCommercialActionEvidenceByStore(args: {
  rows: readonly unknown[];
  storeIds: ReadonlySet<string>;
  availability: OverviewDataAvailability;
}) {
  const summaries = new Map<string, CommercialActionEvidenceSummary>();
  for (const storeId of args.storeIds) {
    const normalizedStoreId = requiredText(storeId);
    if (normalizedStoreId) {
      summaries.set(normalizedStoreId, createSummary(normalizedStoreId, args.availability));
    }
  }

  for (const row of args.rows) {
    const evidence = normalizeCommercialActionEvidence(row);
    const summary = evidence.storeId ? summaries.get(evidence.storeId) : undefined;
    if (!summary) {
      continue;
    }
    summary.records.push(evidence);
    incrementCounts(summary.observedCounts, evidence.kind);
  }

  for (const summary of summaries.values()) {
    summary.confirmedCounts = summary.availability === "available" && summary.observedCounts.invalid === 0
      ? { ...summary.observedCounts }
      : null;
  }

  return summaries;
}
