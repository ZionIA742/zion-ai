import { isDeepStrictEqual } from "node:util";

import type {
  OpenAiCostClaimResult,
} from "./zion-admin-openai-cost-claimed-operations";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

export const DAILY_OPENAI_COST_CRON_ACTOR =
  "zion-admin-financial-cron-worker";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pure post-claim validation for one canonical daily cron operation.
 *
 * Must be invoked after the targeted claim and before collection.
 * This function does not claim, collect, retry or write to the DB.
 *
 * A rejected claim may already be committed in PostgreSQL.
 * Callers must not retry it blindly.
 */
export function validateDailyOpenAiCostClaim(
  result: OpenAiCostClaimResult,
  expectedOperationId: string,
  now: Date,
): boolean {
  try {
    if (
      typeof expectedOperationId !== "string" ||
      !UUID.test(expectedOperationId) ||
      !(now instanceof Date) ||
      !Number.isFinite(now.getTime()) ||
      !result ||
      result.outcome !== "claimed" ||
      result.claimedCount !== 1 ||
      !Array.isArray(result.operations) ||
      result.operations.length !== 1
    ) {
      return false;
    }

    const operation = result.operations[0];

    if (
      !operation ||
      typeof operation.operationId !== "string" ||
      operation.operationId.toLowerCase() !==
        expectedOperationId.toLowerCase() ||
      operation.claimedBy !== DAILY_OPENAI_COST_CRON_ACTOR ||
      operation.attemptCount !== 1 ||
      operation.maxAttempts !== 3 ||
      typeof operation.claimToken !== "string" ||
      !UUID.test(operation.claimToken) ||
      typeof operation.claimExpiresAt !== "string" ||
      !Number.isFinite(Date.parse(operation.claimExpiresAt)) ||
      Date.parse(operation.claimExpiresAt) <= now.getTime() ||
      !operation.contract
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

    const expected = buildOpenAiCostQueryContract(
      plan.costsRequest,
    );

    const received = buildOpenAiCostQueryContract(
      operation.contract.costsRequest,
    );

    return (
      operation.operationKey === plan.operationKey &&
      operation.contract.queryIdentity === plan.queryIdentity &&
      operation.contract.queryIdentity === expected.queryIdentity &&
      operation.contract.periodStart === expected.periodStart &&
      operation.contract.periodEnd === expected.periodEnd &&
      received.queryIdentity === expected.queryIdentity &&
      isDeepStrictEqual(
        operation.contract.queryParameters,
        expected.queryParameters,
      ) &&
      isDeepStrictEqual(
        operation.contract.costsRequest,
        expected.costsRequest,
      )
    );
  } catch {
    return false;
  }
}