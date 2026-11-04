import { isDeepStrictEqual } from "node:util";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function utcInstant(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  ) {
    return null;
  }

  const milliseconds = Date.parse(value);

  return Number.isFinite(milliseconds)
    ? milliseconds
    : null;
}

/**
 * Read-only precondition for an automated retry of the
 * current canonical UTC financial day.
 *
 * This function does not authorize requests, query data,
 * claim operations, collect costs or finalize snapshots.
 *
 * The caller must independently authenticate the cron,
 * verify database inventory and use the atomic targeted
 * claim plus post-claim financial contract validation.
 *
 * No historical backfill or uncertain-operation recovery.
 */
export function eligibleDailyOpenAiCostRetry(
  candidate: unknown,
  now: Date,
): boolean {
  try {
    if (
      !record(candidate) ||
      !(now instanceof Date) ||
      !Number.isFinite(now.getTime())
    ) {
      return false;
    }

    const plan = planDailyOpenAiCostCollection({
      now,
      inventoryVerified: true,
      existingQueryIdentities: [],
    });

    if (plan.status !== "prepare") {
      return false;
    }

    const contract = buildOpenAiCostQueryContract(
      plan.costsRequest,
    );

    if (
      typeof candidate.operationId !== "string" ||
      !UUID.test(candidate.operationId) ||
      candidate.provider !== "openai" ||
      candidate.source !== "openai_organization_costs" ||
      candidate.state !== "retryable_failed" ||
      candidate.operationKey !== plan.operationKey ||
      candidate.queryIdentity !== plan.queryIdentity ||
      !isDeepStrictEqual(
        candidate.queryParameters,
        contract.queryParameters,
      )
    ) {
      return false;
    }

    if (
      candidate.maxAttempts !== 3 ||
      !Number.isInteger(candidate.attemptCount) ||
      (
        candidate.attemptCount !== 1 &&
        candidate.attemptCount !== 2
      )
    ) {
      return false;
    }

    // Operations with evidence of a claim or financial
    // confirmation are never automatically retried.
    if (
      candidate.claimToken !== null ||
      candidate.claimExpiresAt !== null ||
      candidate.snapshotCollectionId !== null ||
      candidate.confirmedAt !== null
    ) {
      return false;
    }

    const nextAttempt = utcInstant(
      candidate.nextAttemptAt,
    );

    const periodStart = utcInstant(
      candidate.periodStart,
    );

    const periodEnd = utcInstant(
      candidate.periodEnd,
    );

    if (
      nextAttempt === null ||
      periodStart === null ||
      periodEnd === null ||
      nextAttempt > now.getTime()
    ) {
      return false;
    }

    return periodStart ===
        plan.costsRequest.startTime * 1000 &&
      periodEnd ===
        plan.costsRequest.endTime * 1000;
  } catch {
    return false;
  }
}