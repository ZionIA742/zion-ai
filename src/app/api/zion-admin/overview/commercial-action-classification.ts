import type {
  CommercialActionEvidenceKind,
  CommercialActionEvidenceSummary,
  CommercialActionEvidenceCounts,
} from "./commercial-action-evidence";

export type CommercialActionClassificationCode =
  | "processing_error_recorded"
  | "pending_unconfirmed"
  | "processed_recorded"
  | "invalid"
  | "no_actions_observed"
  | "source_partial"
  | "source_unavailable";

export type CommercialActionClassificationOccurrence = {
  code: CommercialActionClassificationCode;
  count: number;
  confirmed: boolean;
};

export type CommercialActionClassification = {
  source: "ai_sales_action_queue";
  storeId: string;
  availability: CommercialActionEvidenceSummary["availability"];
  complete: boolean;
  occurrences: CommercialActionClassificationOccurrence[];
  observedCounts: CommercialActionEvidenceCounts;
  confirmedCounts: CommercialActionEvidenceCounts | null;
};

const KIND_TO_CODE: Record<CommercialActionEvidenceKind, CommercialActionClassificationCode> = {
  processing_error_recorded: "processing_error_recorded",
  pending_unconfirmed: "pending_unconfirmed",
  processed_recorded: "processed_recorded",
  invalid: "invalid",
};

const KIND_ORDER: CommercialActionEvidenceKind[] = [
  "processing_error_recorded",
  "pending_unconfirmed",
  "processed_recorded",
  "invalid",
];

function countForKind(
  counts: CommercialActionEvidenceCounts,
  kind: CommercialActionEvidenceKind,
) {
  if (kind === "processing_error_recorded") return counts.processingErrors;
  if (kind === "pending_unconfirmed") return counts.pendingUnconfirmed;
  if (kind === "processed_recorded") return counts.processedRecorded;
  return counts.invalid;
}

export function classifyCommercialActionEvidence(
  summary: CommercialActionEvidenceSummary,
): CommercialActionClassification {
  const occurrences: CommercialActionClassificationOccurrence[] = [];

  for (const kind of KIND_ORDER) {
    const count = countForKind(summary.observedCounts, kind);
    if (count > 0) {
      occurrences.push({
        code: KIND_TO_CODE[kind],
        count,
        confirmed: kind !== "invalid",
      });
    }
  }

  if (summary.availability === "available" && occurrences.length === 0) {
    occurrences.push({
      code: "no_actions_observed",
      count: 0,
      confirmed: true,
    });
  }

  if (summary.availability === "partial") {
    occurrences.push({ code: "source_partial", count: 0, confirmed: false });
  }

  if (summary.availability === "unavailable") {
    occurrences.push({ code: "source_unavailable", count: 0, confirmed: false });
  }

  return {
    source: "ai_sales_action_queue",
    storeId: summary.storeId,
    availability: summary.availability,
    complete: summary.confirmedCounts !== null,
    occurrences,
    observedCounts: { ...summary.observedCounts },
    confirmedCounts: summary.confirmedCounts
      ? { ...summary.confirmedCounts }
      : null,
  };
}
