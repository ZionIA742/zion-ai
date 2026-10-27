import { createClient } from "@supabase/supabase-js";

export const OPENAI_COST_QUARANTINE_RPC =
  "zion_admin_quarantine_expired_openai_cost_operations_by_system";

export const OPENAI_COST_QUARANTINE_ACTOR =
  "zion-admin-openai-cost-reconciler";

export type OpenAiCostQuarantineOperation = {
  operationId: string;
  operationKey: string;
  previousState: "processing";
  state: "uncertain";
  attemptCount: number;
  previousClaimedBy: string | null;
  previousClaimExpiresAt: string;
  matchingSnapshotCandidates: number;
  snapshotLinked: false;
  retryScheduled: false;
  requiresReconciliation: true;
};

export type OpenAiCostQuarantineResult = {
  outcome: "quarantine_completed";
  quarantinedCount: number;
  operations: OpenAiCostQuarantineOperation[];
};

export type OpenAiCostQuarantineRpc = (
  name: typeof OPENAI_COST_QUARANTINE_RPC,
  parameters: {
    p_limit: number;
    p_actor: string;
  },
) => Promise<{
  data: unknown;
  error: {
    code?: string | null;
    message?: string | null;
  } | null;
}>;

export type OpenAiCostQuarantineDependencies = {
  rpc?: OpenAiCostQuarantineRpc;
};

export type OpenAiCostQuarantineErrorCode =
  | "OPENAI_COST_QUARANTINE_INPUT_INVALID"
  | "OPENAI_COST_QUARANTINE_CONFIG_MISSING"
  | "OPENAI_COST_QUARANTINE_UNCONFIRMED";

export class OpenAiCostQuarantineError extends Error {
  constructor(readonly code: OpenAiCostQuarantineErrorCode) {
    super(code);
    this.name = "OpenAiCostQuarantineError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESPONSE_KEYS = [
  "outcome",
  "quarantined_count",
  "operations",
] as const;

const ITEM_KEYS = [
  "operation_id",
  "operation_key",
  "previous_state",
  "state",
  "attempt_count",
  "previous_claimed_by",
  "previous_claim_expires_at",
  "matching_snapshot_candidates",
  "snapshot_linked",
  "retry_scheduled",
  "requires_reconciliation",
] as const;

function unconfirmed(): never {
  throw new OpenAiCostQuarantineError(
    "OPENAI_COST_QUARANTINE_UNCONFIRMED",
  );
}

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);

  return actual.length === keys.length &&
    actual.every((key) => keys.includes(key));
}

function count(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

function text(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value === value.trim();
}

function timestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(value)
  ) {
    return false;
  }

  return Number.isFinite(Date.parse(value));
}

function validateItem(
  value: unknown,
): OpenAiCostQuarantineOperation {
  if (
    !isObject(value) ||
    !exactKeys(value, ITEM_KEYS) ||
    typeof value.operation_id !== "string" ||
    !UUID.test(value.operation_id) ||
    !text(value.operation_key) ||
    value.previous_state !== "processing" ||
    value.state !== "uncertain" ||
    !count(value.attempt_count) ||
    value.attempt_count < 1 ||
    (
      value.previous_claimed_by !== null &&
      !text(value.previous_claimed_by)
    ) ||
    (
      typeof value.previous_claimed_by === "string" &&
      value.previous_claimed_by.length > 128
    ) ||
    !timestamp(value.previous_claim_expires_at) ||
    !count(value.matching_snapshot_candidates) ||
    value.snapshot_linked !== false ||
    value.retry_scheduled !== false ||
    value.requires_reconciliation !== true
  ) {
    unconfirmed();
  }

  return {
    operationId: value.operation_id,
    operationKey: value.operation_key,
    previousState: "processing",
    state: "uncertain",
    attemptCount: value.attempt_count,
    previousClaimedBy: value.previous_claimed_by,
    previousClaimExpiresAt: value.previous_claim_expires_at,
    matchingSnapshotCandidates: value.matching_snapshot_candidates,
    snapshotLinked: false,
    retryScheduled: false,
    requiresReconciliation: true,
  };
}

function validateResult(
  value: unknown,
  limit: number,
): OpenAiCostQuarantineResult {
  if (
    !isObject(value) ||
    !exactKeys(value, RESPONSE_KEYS) ||
    value.outcome !== "quarantine_completed" ||
    !count(value.quarantined_count) ||
    value.quarantined_count > limit ||
    !Array.isArray(value.operations) ||
    value.operations.length !== value.quarantined_count
  ) {
    unconfirmed();
  }

  const operations = value.operations.map(validateItem);

  if (
    new Set(operations.map((item) => item.operationId)).size !==
    operations.length
  ) {
    unconfirmed();
  }

  return {
    outcome: "quarantine_completed",
    quarantinedCount: value.quarantined_count,
    operations,
  };
}

function defaultRpc(): OpenAiCostQuarantineRpc {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new OpenAiCostQuarantineError(
      "OPENAI_COST_QUARANTINE_CONFIG_MISSING",
    );
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return async (name, parameters) => {
    const result = await supabase.rpc(name, parameters);

    return {
      data: result.data,
      error: result.error,
    };
  };
}

/**
 * Server-only adapter for the existing atomic quarantine RPC.
 *
 * This adapter must only be invoked by a future explicitly
 * authorized server-side reconciler.
 *
 * It does not collect OpenAI costs, create snapshots, confirm
 * expenses, authorize retries, or connect to HTTP/cron.
 *
 * Transport uncertainty is never retried automatically.
 */
export async function quarantineExpiredOpenAiCostOperations(
  limit: number,
  dependencies: OpenAiCostQuarantineDependencies = {},
): Promise<OpenAiCostQuarantineResult> {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 10
  ) {
    throw new OpenAiCostQuarantineError(
      "OPENAI_COST_QUARANTINE_INPUT_INVALID",
    );
  }

  const rpc = dependencies.rpc ?? defaultRpc();

  let response: Awaited<ReturnType<OpenAiCostQuarantineRpc>>;

  try {
    response = await rpc(OPENAI_COST_QUARANTINE_RPC, {
      p_limit: limit,
      p_actor: OPENAI_COST_QUARANTINE_ACTOR,
    });
  } catch {
    // The DB transaction might already have committed.
    // Never issue a second RPC blindly.
    unconfirmed();
  }

  if (!response || response.error) {
    unconfirmed();
  }

  return validateResult(response.data, limit);
}
