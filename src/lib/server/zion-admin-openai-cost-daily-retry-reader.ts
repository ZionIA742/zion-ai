import { readOpenAiCostInventoryViaRpc } from "./zion-admin-openai-cost-inventory-rpc";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  eligibleDailyOpenAiCostRetry,
} from "./zion-admin-openai-cost-daily-retry-eligibility";



const STATES = [
  "pending",
  "processing",
  "retryable_failed",
  "permanent_failed",
  "uncertain",
  "confirmed",
] as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type QueryResponse = {
  data: unknown;
  error: unknown;
};

export type DailyRetryReaderDependencies = {
  load?: (queryIdentity: string) => Promise<QueryResponse>;
};

export type DailyRetryReaderResult =
  | {
      status: "ready";
      operationId: string;
      operationKey: string;
      queryIdentity: string;
    }
  | {
      status: "skipped";
      reason:
        | "not_found"
        | "not_retryable"
        | "not_due";
    }
  | {
      status: "blocked";
      reason:
        | "invalid_time"
        | "invalid_plan"
        | "source_unavailable"
        | "multiple_operations"
        | "invalid_record";
    };

function record(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

async function defaultLoad(
  queryIdentity: string,
): Promise<QueryResponse> {
  return readOpenAiCostInventoryViaRpc(queryIdentity);
}

/**
 * Read-only lookup for the single UTC reporting
 * period selected by the current daily planner.
 *
 * This is NOT an authorization or a claim.
 * No historical inventory scan is permitted.
 *
 * Callers must authenticate the financial cron,
 * then use the atomic targeted claim and verify
 * the returned contract before collection.
 */
export async function inspectDueDailyOpenAiCostRetry(
  now: Date,
  dependencies: DailyRetryReaderDependencies = {},
): Promise<DailyRetryReaderResult> {
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  ) {
    return {
      status: "blocked",
      reason: "invalid_time",
    };
  }

  const plan = planDailyOpenAiCostCollection({
    now,
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  if (plan.status !== "prepare") {
    return {
      status: "blocked",
      reason: "invalid_plan",
    };
  }

  let response: QueryResponse;

  try {
    response = await (
      dependencies.load ?? defaultLoad
    )(plan.queryIdentity);
  } catch {
    return {
      status: "blocked",
      reason: "source_unavailable",
    };
  }

  if (
    !response ||
    response.error ||
    !Array.isArray(response.data)
  ) {
    return {
      status: "blocked",
      reason: "source_unavailable",
    };
  }

  if (response.data.length > 1) {
    return {
      status: "blocked",
      reason: "multiple_operations",
    };
  }

  if (response.data.length === 0) {
    return {
      status: "skipped",
      reason: "not_found",
    };
  }

  const row: unknown = response.data[0];

  if (
    !record(row) ||
    typeof row.id !== "string" ||
    !UUID.test(row.id) ||
    typeof row.operation_key !== "string" ||
    row.operation_key.length === 0 ||
    row.query_identity !== plan.queryIdentity ||
    row.provider !== "openai" ||
    row.source !== "openai_organization_costs" ||
    typeof row.state !== "string" ||
    !STATES.some((state) => state === row.state)
  ) {
    return {
      status: "blocked",
      reason: "invalid_record",
    };
  }

  if (row.state !== "retryable_failed") {
    return {
      status: "skipped",
      reason: "not_retryable",
    };
  }

  const candidate = {
    operationId: row.id,
    operationKey: row.operation_key,
    queryIdentity: row.query_identity,
    queryParameters: row.query_parameters,
    provider: row.provider,
    source: row.source,
    state: row.state,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    claimToken: row.claim_token,
    claimExpiresAt: row.claim_expires_at,
    snapshotCollectionId: row.snapshot_collection_id,
    confirmedAt: row.confirmed_at,
  };

  // Validate identity, periods and financial authority
  // even before the next attempt becomes due.
  const staticCandidate = {
    ...candidate,
    nextAttemptAt: now.toISOString(),
  };

  if (
    !eligibleDailyOpenAiCostRetry(
      staticCandidate,
      now,
    )
  ) {
    return {
      status: "blocked",
      reason: "invalid_record",
    };
  }

  if (
    typeof candidate.nextAttemptAt !== "string" ||
    !Number.isFinite(
      Date.parse(candidate.nextAttemptAt),
    )
  ) {
    return {
      status: "blocked",
      reason: "invalid_record",
    };
  }

  if (
    Date.parse(candidate.nextAttemptAt) >
    now.getTime()
  ) {
    return {
      status: "skipped",
      reason: "not_due",
    };
  }

  if (
    !eligibleDailyOpenAiCostRetry(
      candidate,
      now,
    )
  ) {
    return {
      status: "blocked",
      reason: "invalid_record",
    };
  }

  return {
    status: "ready",
    operationId: candidate.operationId,
    operationKey: candidate.operationKey,
    queryIdentity: candidate.queryIdentity,
  };
}