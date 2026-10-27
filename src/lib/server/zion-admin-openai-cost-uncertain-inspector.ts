import { createClient } from "@supabase/supabase-js";

export const OPENAI_COST_INSPECT_RPC =
  "zion_admin_inspect_uncertain_openai_cost_operation_by_system";

export type OpenAiCostInspectionCandidate = {
  snapshotCollectionId: string;
  collectionKey: string;
  status: "available" | "confirmed_empty";
  resultCount: number;
  collectedAt: string;
  linkedConfirmedOperations: number;
};

export type OpenAiCostInspectionResult = {
  outcome: "inspection_completed";
  operationId: string;
  operationKey: string;
  state: "uncertain";
  attemptCount: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  matchingSnapshotCandidates: number;
  candidatesAlreadyLinkedToConfirmed: number;
  candidatesReturned: number;
  candidatesTruncated: boolean;
  candidates: OpenAiCostInspectionCandidate[];
  resolution: "requires_manual_reconciliation";
  ownershipConfirmed: false;
  financialConfirmationPerformed: false;
  retryAuthorized: false;
  retryScheduled: false;
};

export type OpenAiCostInspectRpc = (
  name: typeof OPENAI_COST_INSPECT_RPC,
  parameters: { p_operation_id: string },
) => Promise<{
  data: unknown;
  error: { code?: string | null; message?: string | null } | null;
}>;

export type OpenAiCostInspectDependencies = {
  rpc?: OpenAiCostInspectRpc;
};

export type OpenAiCostInspectionErrorCode =
  | "OPENAI_COST_INSPECTION_REQUEST_INVALID"
  | "OPENAI_COST_INSPECTION_CONFIG_MISSING"
  | "OPENAI_COST_INSPECTION_UNCONFIRMED";

export class OpenAiCostInspectionError extends Error {
  constructor(readonly code: OpenAiCostInspectionErrorCode) {
    super(code);
    this.name = "OpenAiCostInspectionError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

const RESULT_KEYS = [
  "outcome",
  "operation_id",
  "operation_key",
  "state",
  "attempt_count",
  "max_attempts",
  "last_error_code",
  "last_error_at",
  "matching_snapshot_candidates",
  "candidates_already_linked_to_confirmed",
  "candidates_returned",
  "candidates_truncated",
  "candidates",
  "resolution",
  "ownership_confirmed",
  "financial_confirmation_performed",
  "retry_authorized",
  "retry_scheduled",
] as const;

const CANDIDATE_KEYS = [
  "snapshot_collection_id",
  "collection_key",
  "status",
  "result_count",
  "collected_at",
  "linked_confirmed_operations",
] as const;

function unconfirmed(): never {
  throw new OpenAiCostInspectionError(
    "OPENAI_COST_INSPECTION_UNCONFIRMED",
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === allowed.length &&
    actual.every((key) => allowed.includes(key));
}

function validCount(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
    Number.isFinite(Date.parse(value));
}

function validText(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value === value.trim();
}

function validateCandidate(
  value: unknown,
): OpenAiCostInspectionCandidate {
  if (
    !isObject(value) ||
    !exactKeys(value, CANDIDATE_KEYS) ||
    typeof value.snapshot_collection_id !== "string" ||
    !UUID.test(value.snapshot_collection_id) ||
    !validText(value.collection_key) ||
    (
      value.status !== "available" &&
      value.status !== "confirmed_empty"
    ) ||
    !validCount(value.result_count) ||
    !validTimestamp(value.collected_at) ||
    !validCount(value.linked_confirmed_operations)
  ) {
    unconfirmed();
  }

  return {
    snapshotCollectionId: value.snapshot_collection_id,
    collectionKey: value.collection_key,
    status: value.status,
    resultCount: value.result_count,
    collectedAt: value.collected_at,
    linkedConfirmedOperations: value.linked_confirmed_operations,
  };
}

function validateInspection(
  value: unknown,
  operationId: string,
): OpenAiCostInspectionResult {
  if (
    !isObject(value) ||
    !exactKeys(value, RESULT_KEYS) ||
    value.outcome !== "inspection_completed" ||
    value.operation_id !== operationId ||
    !validText(value.operation_key) ||
    value.state !== "uncertain" ||
    !validCount(value.attempt_count) ||
    value.attempt_count < 1 ||
    !validCount(value.max_attempts) ||
    value.max_attempts < 1 ||
    value.attempt_count > value.max_attempts ||
    (
      value.last_error_code !== null &&
      (
        typeof value.last_error_code !== "string" ||
        !ERROR_CODE.test(value.last_error_code)
      )
    ) ||
    (
      value.last_error_at !== null &&
      !validTimestamp(value.last_error_at)
    ) ||
    !validCount(value.matching_snapshot_candidates) ||
    !validCount(value.candidates_already_linked_to_confirmed) ||
    !validCount(value.candidates_returned) ||
    typeof value.candidates_truncated !== "boolean" ||
    !Array.isArray(value.candidates) ||
    value.resolution !== "requires_manual_reconciliation" ||
    value.ownership_confirmed !== false ||
    value.financial_confirmation_performed !== false ||
    value.retry_authorized !== false ||
    value.retry_scheduled !== false
  ) {
    unconfirmed();
  }

  const total = value.matching_snapshot_candidates;
  const linked = value.candidates_already_linked_to_confirmed;

  if (
    linked > total ||
    value.candidates_returned !== Math.min(total, 20) ||
    value.candidates.length !== value.candidates_returned ||
    value.candidates_truncated !== (total > 20)
  ) {
    unconfirmed();
  }

  const candidates = value.candidates.map(validateCandidate);

  if (
    new Set(
      candidates.map((item) => item.snapshotCollectionId),
    ).size !== candidates.length
  ) {
    unconfirmed();
  }

  const visibleLinked = candidates.filter(
    (item) => item.linkedConfirmedOperations > 0,
  ).length;

  if (
    visibleLinked > linked ||
    (!value.candidates_truncated && visibleLinked !== linked)
  ) {
    unconfirmed();
  }

  return {
    outcome: "inspection_completed",
    operationId,
    operationKey: value.operation_key,
    state: "uncertain",
    attemptCount: value.attempt_count,
    maxAttempts: value.max_attempts,
    lastErrorCode: value.last_error_code,
    lastErrorAt: value.last_error_at,
    matchingSnapshotCandidates: total,
    candidatesAlreadyLinkedToConfirmed: linked,
    candidatesReturned: value.candidates_returned,
    candidatesTruncated: value.candidates_truncated,
    candidates,
    resolution: "requires_manual_reconciliation",
    ownershipConfirmed: false,
    financialConfirmationPerformed: false,
    retryAuthorized: false,
    retryScheduled: false,
  };
}

function defaultRpc(): OpenAiCostInspectRpc {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new OpenAiCostInspectionError(
      "OPENAI_COST_INSPECTION_CONFIG_MISSING",
    );
  }

  const supabase = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return async (name, parameters) => {
    const response = await supabase.rpc(name, parameters);

    return {
      data: response.data,
      error: response.error,
    };
  };
}

/**
 * Conservative, server-side inspection of ONE uncertain operation.
 *
 * The existing SQL RPC is STABLE/read-only. This adapter never:
 * - confirms or changes financial state;
 * - links or writes a snapshot;
 * - authorizes or schedules a retry;
 * - calls another RPC.
 *
 * A matching snapshot remains evidence, not proof of ownership.
 * Do not expose this adapter through an unauthenticated route.
 */
export async function inspectUncertainOpenAiCostOperation(
  operationId: string,
  dependencies: OpenAiCostInspectDependencies = {},
): Promise<OpenAiCostInspectionResult> {
  if (typeof operationId !== "string" || !UUID.test(operationId)) {
    throw new OpenAiCostInspectionError(
      "OPENAI_COST_INSPECTION_REQUEST_INVALID",
    );
  }

  const rpc = dependencies.rpc ?? defaultRpc();

  let response: Awaited<ReturnType<OpenAiCostInspectRpc>>;

  try {
    response = await rpc(OPENAI_COST_INSPECT_RPC, {
      p_operation_id: operationId,
    });
  } catch {
    unconfirmed();
  }

  if (!response || response.error) {
    unconfirmed();
  }

  return validateInspection(response.data, operationId);
}
