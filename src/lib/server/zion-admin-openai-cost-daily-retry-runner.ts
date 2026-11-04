import { isDeepStrictEqual } from "node:util";

import {
  authorizeDailyOpenAiCostExecution,
  type DailyOpenAiCostExecutionAuthorization,
} from "./zion-admin-openai-cost-daily-execution-auth";

import {
  inspectDueDailyOpenAiCostRetry,
  type DailyRetryReaderResult,
} from "./zion-admin-openai-cost-daily-retry-reader";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import {
  createOpenAiCostBatchAdapters,
  type OpenAiCostBatchAdapterOptions,
} from "./zion-admin-openai-cost-batch-adapters";

import {
  claimVerifiedTargetedOpenAiCostOperation,
} from "./zion-admin-openai-cost-targeted-claim";

import {
  runClaimedOpenAiCostBatch,
} from "./zion-admin-openai-cost-batch-coordinator";

import {
  DAILY_OPENAI_COST_CRON_ACTOR,
} from "./zion-admin-openai-cost-daily-claim-validator";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DailyRetryRunnerResult =
  | { status: "blocked"; reason: string }
  | { status: "skipped"; reason: string }
  | {
      status: "confirmed";
      operationId: string;
    }
  | {
      status: "failure_recorded";
      operationId: string;
      retryScheduled: boolean;
    }
  | {
      status: "needs_review";
      reason: string;
      operationId?: string;
    };

export type DailyRetryRunnerOptions = {
  authorize?: (
    request: Request,
  ) => DailyOpenAiCostExecutionAuthorization;

  inspect?: (
    now: Date,
  ) => Promise<DailyRetryReaderResult>;

  targetedClaim?:
    typeof claimVerifiedTargetedOpenAiCostOperation;

  batchRunner?: typeof runClaimedOpenAiCostBatch;

  adapterOptions?: Omit<
    OpenAiCostBatchAdapterOptions,
    "claim"
  >;

  now?: () => Date;
};

function validNow(value: unknown): value is Date {
  return value instanceof Date &&
    Number.isFinite(value.getTime());
}

function sameFinancialDay(
  now: Date,
  identity: string,
): boolean {
  if (!validNow(now)) return false;

  const plan = planDailyOpenAiCostCollection({
    now,
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  return plan.status === "prepare" &&
    plan.queryIdentity === identity;
}

/**
 * Isolated retry executor.
 *
 * No route, scheduled job or background action is
 * registered by constructing this function.
 *
 * Authorization precedes all database reads.
 *
 * Only the canonical current UTC reporting period
 * can reach the atomic targeted claim.
 *
 * The claimed contract is checked again BEFORE the
 * financial batch coordinator can call the provider.
 *
 * Claim transport errors and ambiguous financial
 * outcomes require review; never retry recursively.
 */
export function createDailyOpenAiCostRetryRunner(
  options: DailyRetryRunnerOptions = {},
) {
  const clock = options.now ?? (() => new Date());

  const authorize =
    options.authorize ??
    authorizeDailyOpenAiCostExecution;

  const inspect =
    options.inspect ??
    inspectDueDailyOpenAiCostRetry;

  const targetedClaim =
    options.targetedClaim ??
    claimVerifiedTargetedOpenAiCostOperation;

  const batchRunner =
    options.batchRunner ??
    runClaimedOpenAiCostBatch;

  return async (
    request: Request,
  ): Promise<DailyRetryRunnerResult> => {
    let permission: DailyOpenAiCostExecutionAuthorization;

    try {
      permission = authorize(request);
    } catch {
      return {
        status: "blocked",
        reason: "cron_unauthorized",
      };
    }

    if (
      !permission ||
      permission.ok !== true ||
      permission.status !== "authorized"
    ) {
      return {
        status: "blocked",
        reason: permission?.ok === false
          ? permission.reason
          : "cron_unauthorized",
      };
    }

    let now: Date;

    try {
      now = clock();
    } catch {
      return {
        status: "blocked",
        reason: "invalid_clock",
      };
    }

    if (!validNow(now)) {
      return {
        status: "blocked",
        reason: "invalid_clock",
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

    const expected = buildOpenAiCostQueryContract(
      plan.costsRequest,
    );

    let inventory: DailyRetryReaderResult;

    try {
      inventory = await inspect(now);
    } catch {
      return {
        status: "blocked",
        reason: "retry_inventory_unavailable",
      };
    }

    if (!inventory || typeof inventory !== "object") {
      return {
        status: "blocked",
        reason: "retry_inventory_invalid",
      };
    }

    if (inventory.status === "blocked") {
      return {
        status: "blocked",
        reason: inventory.reason,
      };
    }

    if (inventory.status === "skipped") {
      return {
        status: "skipped",
        reason: inventory.reason,
      };
    }

    if (
      inventory.status !== "ready" ||
      typeof inventory.operationId !== "string" ||
      !UUID.test(inventory.operationId) ||
      inventory.operationKey !== plan.operationKey ||
      inventory.queryIdentity !== plan.queryIdentity
    ) {
      return {
        status: "blocked",
        reason: "retry_candidate_mismatch",
      };
    }

    const operationId = inventory.operationId.toLowerCase();

    let checkedBeforeBatch: Date;

    try {
      checkedBeforeBatch = clock();
    } catch {
      return {
        status: "blocked",
        reason: "invalid_clock",
      };
    }

    if (
      !sameFinancialDay(
        checkedBeforeBatch,
        plan.queryIdentity,
      )
    ) {
      return {
        status: "blocked",
        reason: "utc_day_changed",
      };
    }

    let claimValidated = false;
    let emptyClaimVerified = false;

    const adapters = createOpenAiCostBatchAdapters({
      ...options.adapterOptions,
      now: clock,

      // This override always wins over options.
      claim: async (claimRequest, dependencies) => {
        if (
          claimRequest.limit !== 1 ||
          claimRequest.claimedBy !==
            DAILY_OPENAI_COST_CRON_ACTOR
        ) {
          throw new Error(
            "OPENAI_COST_RETRY_CLAIM_REQUEST_INVALID",
          );
        }

        if (
          !sameFinancialDay(
            clock(),
            plan.queryIdentity,
          )
        ) {
          throw new Error(
            "OPENAI_COST_RETRY_UTC_DAY_CHANGED",
          );
        }

        const result = await targetedClaim(
          {
            operationId,
            claimedBy: DAILY_OPENAI_COST_CRON_ACTOR,
          },
          dependencies,
        );

        if (
          result?.claimedCount === 0 &&
          Array.isArray(result.operations) &&
          result.operations.length === 0
        ) {
          emptyClaimVerified = true;
          return result;
        }

        if (
          !result ||
          result.outcome !== "claimed" ||
          result.claimedCount !== 1 ||
          !Array.isArray(result.operations) ||
          result.operations.length !== 1
        ) {
          throw new Error(
            "OPENAI_COST_RETRY_CLAIM_UNCONFIRMED",
          );
        }

        const operation = result.operations[0];

        if (
          !operation ||
          operation.operationId.toLowerCase() !==
            operationId ||
          operation.operationKey !==
            plan.operationKey ||
          operation.claimedBy !==
            DAILY_OPENAI_COST_CRON_ACTOR ||
          operation.maxAttempts !== 3 ||
          (
            operation.attemptCount !== 2 &&
            operation.attemptCount !== 3
          ) ||
          typeof operation.claimToken !== "string" ||
          !UUID.test(operation.claimToken) ||
          typeof operation.claimExpiresAt !== "string" ||
          !Number.isFinite(
            Date.parse(operation.claimExpiresAt),
          ) ||
          !operation.contract ||
          operation.contract.queryIdentity !==
            expected.queryIdentity ||
          operation.contract.periodStart !==
            expected.periodStart ||
          operation.contract.periodEnd !==
            expected.periodEnd ||
          !isDeepStrictEqual(
            operation.contract.queryParameters,
            expected.queryParameters,
          ) ||
          !isDeepStrictEqual(
            operation.contract.costsRequest,
            expected.costsRequest,
          )
        ) {
          throw new Error(
            "OPENAI_COST_RETRY_CLAIM_CONTRACT_INVALID",
          );
        }

        const afterClaim = clock();

        if (
          !sameFinancialDay(
            afterClaim,
            plan.queryIdentity,
          ) ||
          Date.parse(operation.claimExpiresAt) <=
            afterClaim.getTime()
        ) {
          throw new Error(
            "OPENAI_COST_RETRY_CLAIM_LEASE_INVALID",
          );
        }

        claimValidated = true;
        return result;
      },
    });

    let result: Awaited<ReturnType<
      typeof runClaimedOpenAiCostBatch
    >>;

    try {
      result = await batchRunner(
        {
          limit: 1,
          claimedBy: DAILY_OPENAI_COST_CRON_ACTOR,
        },
        adapters,
      );
    } catch {
      // Database claim may already have committed.
      // Never recurse or repeat the provider request.
      return {
        status: "needs_review",
        reason: "execution_uncertain",
        operationId,
      };
    }

    if (
      !result ||
      result.outcome !== "processed_batch" ||
      !Array.isArray(result.operations)
    ) {
      return {
        status: "needs_review",
        reason: "outcome_unconfirmed",
        operationId,
      };
    }

    if (
      emptyClaimVerified &&
      result.claimedCount === 0 &&
      result.confirmedCount === 0 &&
      result.failureRecordedCount === 0 &&
      result.needsReviewCount === 0 &&
      result.operations.length === 0
    ) {
      return {
        status: "skipped",
        reason: "claim_empty",
      };
    }

    if (
      !claimValidated ||
      result.claimedCount !== 1 ||
      result.operations.length !== 1
    ) {
      return {
        status: "needs_review",
        reason: "outcome_unconfirmed",
        operationId,
      };
    }

    const item = result.operations[0];

    if (
      !item ||
      item.operationId.toLowerCase() !==
        operationId ||
      item.operationKey !== plan.operationKey
    ) {
      return {
        status: "needs_review",
        reason: "outcome_mismatch",
        operationId,
      };
    }

    if (
      result.confirmedCount === 1 &&
      result.failureRecordedCount === 0 &&
      result.needsReviewCount === 0 &&
      item.outcome === "confirmed" &&
      item.snapshotCollectionId.toLowerCase() ===
        operationId &&
      (
        item.snapshotOutcome === "inserted" ||
        item.snapshotOutcome === "replayed"
      )
    ) {
      return {
        status: "confirmed",
        operationId,
      };
    }

    if (
      result.confirmedCount === 0 &&
      result.failureRecordedCount === 1 &&
      result.needsReviewCount === 0 &&
      item.outcome === "failure_recorded"
    ) {
      return {
        status: "failure_recorded",
        operationId,
        retryScheduled: item.retryScheduled,
      };
    }

    return {
      status: "needs_review",
      reason: "outcome_unconfirmed",
      operationId,
    };
  };
}