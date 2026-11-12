import { isDeepStrictEqual } from "node:util";

import {
  authorizeDailyOpenAiCostExecution,
  type DailyOpenAiCostExecutionAuthorization,
} from "./zion-admin-openai-cost-daily-execution-auth";

import {
  planOpenAiCostCutoverBridge,
} from "./zion-admin-openai-cost-cutover-planner";

import {
  inspectOpenAiCostInventory,
  type OpenAiCostInventoryResult,
} from "./zion-admin-openai-cost-inventory-reader";

import {
  prepareOpenAiCostOperation,
  type OpenAiCostPrepareRequest,
  type OpenAiCostPrepareResult,
} from "./zion-admin-openai-cost-operation-preparer";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import {
  claimVerifiedTargetedOpenAiCostOperation,
} from "./zion-admin-openai-cost-targeted-claim";

import {
  createOpenAiCostBatchAdapters,
  type OpenAiCostBatchAdapterOptions,
} from "./zion-admin-openai-cost-batch-adapters";

import {
  runClaimedOpenAiCostBatch,
} from "./zion-admin-openai-cost-batch-coordinator";

import {
  DAILY_OPENAI_COST_CRON_ACTOR,
} from "./zion-admin-openai-cost-daily-claim-validator";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CutoverExecutionResult =
  | { status: "blocked"; reason: string }
  | { status: "skipped"; reason: string }
  | { status: "confirmed"; dateUtc: string }
  | { status: "needs_review"; reason: string };

export type CutoverExecutionOptions = {
  authorize?: (
    request: Request,
  ) => DailyOpenAiCostExecutionAuthorization;

  enabled?: () => boolean;
  configuredDateUtc?: () => string | undefined;
  now?: () => Date;

  inspect?: (
    identity: string,
  ) => Promise<OpenAiCostInventoryResult>;

  prepare?: (
    request: OpenAiCostPrepareRequest,
  ) => Promise<OpenAiCostPrepareResult>;

  targetedClaim?:
    typeof claimVerifiedTargetedOpenAiCostOperation;

  batchRunner?: typeof runClaimedOpenAiCostBatch;

  adapterOptions?: Omit<
    OpenAiCostBatchAdapterOptions,
    "claim" | "now"
  >;
};

function isValidDate(value: unknown): value is Date {
  return value instanceof Date &&
    Number.isFinite(value.getTime());
}

function validUtcDay(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const parsed = Date.parse(`${value}T00:00:00.000Z`);

  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value;
}

function validTimeForCutover(
  now: Date,
  selectedDate: string,
): boolean {
  return isValidDate(now) &&
    now.toISOString().slice(0, 10) === selectedDate;
}

/**
 * One-day cutover bridge executor.
 *
 * No route or scheduled job is registered here.
 * Construction performs no financial I/O.
 *
 * Requires normal financial cron authorization,
 * a separate disabled-by-default cutover flag,
 * and an exact configured UTC execution date.
 *
 * Confirmed inventory is never recollected.
 * Retryable, uncertain or processing inventory
 * requires separate review.
 *
 * A targeted atomic claim and a second canonical
 * contract verification are mandatory before
 * provider collection.
 *
 * Failure/uncertainty is never recursively retried.
 */
export function createOpenAiCostCutoverRunner(
  options: CutoverExecutionOptions = {},
) {
  const authorize =
    options.authorize ??
    authorizeDailyOpenAiCostExecution;

  const clock = options.now ?? (() => new Date());

  const enabled = options.enabled ??
    (() =>
      process.env.ZION_ADMIN_OPENAI_COST_CUTOVER_ENABLED ===
      "true");

  const configuredDate = options.configuredDateUtc ??
    (() =>
      process.env.ZION_ADMIN_OPENAI_COST_CUTOVER_DATE_UTC);

  const inspect = options.inspect ??
    inspectOpenAiCostInventory;

  const prepare = options.prepare ??
    ((request: OpenAiCostPrepareRequest) =>
      prepareOpenAiCostOperation(request));

  const targetedClaim = options.targetedClaim ??
    claimVerifiedTargetedOpenAiCostOperation;

  const batchRunner = options.batchRunner ??
    runClaimedOpenAiCostBatch;

  return async (
    request: Request,
  ): Promise<CutoverExecutionResult> => {
    let authorization: DailyOpenAiCostExecutionAuthorization;

    try {
      authorization = authorize(request);
    } catch {
      return {
        status: "blocked",
        reason: "cron_unauthorized",
      };
    }

    if (
      !authorization ||
      authorization.ok !== true ||
      authorization.status !== "authorized"
    ) {
      return {
        status: "blocked",
        reason: "cron_unauthorized",
      };
    }

    let active: boolean;
    let selectedDate: string | undefined;
    let now: Date;

    try {
      active = enabled();
      selectedDate = configuredDate();
      now = clock();
    } catch {
      return {
        status: "blocked",
        reason: "cutover_configuration_invalid",
      };
    }

    if (
      active !== true ||
      !validUtcDay(selectedDate) ||
      !validTimeForCutover(now, selectedDate)
    ) {
      return {
        status: "blocked",
        reason: "cutover_not_authorized",
      };
    }

    const plan = planOpenAiCostCutoverBridge(now);

    if (plan.status !== "ready") {
      return {
        status: "blocked",
        reason: "cutover_plan_invalid",
      };
    }

    const bridge = plan.bridge;

    const expected = buildOpenAiCostQueryContract(
      bridge.costsRequest,
    );

    let inventory: OpenAiCostInventoryResult;

    try {
      inventory = await inspect(bridge.queryIdentity);
    } catch {
      return {
        status: "blocked",
        reason: "inventory_unavailable",
      };
    }

    if (!inventory || inventory.status === "blocked") {
      return {
        status: "blocked",
        reason: "inventory_unavailable",
      };
    }

    let operationId: string;

    if (inventory.status === "existing") {
      if (
        !UUID.test(inventory.operationId) ||
        inventory.operationKey !== bridge.operationKey
      ) {
        return {
          status: "blocked",
          reason: "inventory_mismatch",
        };
      }

      if (inventory.state === "confirmed") {
        return {
          status: "skipped",
          reason: "already_confirmed",
        };
      }

      if (inventory.state !== "pending") {
        return {
          status: "blocked",
          reason: "existing_requires_review",
        };
      }

      operationId = inventory.operationId;
    } else if (inventory.status === "absent") {
      let prepared: OpenAiCostPrepareResult;

      try {
        prepared = await prepare({
          operationKey: bridge.operationKey,
          costsRequest: bridge.costsRequest,
        });
      } catch {
        return {
          status: "needs_review",
          reason: "preparation_uncertain",
        };
      }

      if (
        !prepared ||
        (prepared.outcome !== "created" &&
          prepared.outcome !== "existing") ||
        !UUID.test(prepared.operationId) ||
        prepared.operationKey !== bridge.operationKey ||
        prepared.maxAttempts !== 3 ||
        prepared.attemptCount < 0 ||
        prepared.attemptCount > 3 ||
        !prepared.contract ||
        prepared.contract.queryIdentity !==
          expected.queryIdentity ||
        prepared.contract.periodStart !==
          expected.periodStart ||
        prepared.contract.periodEnd !==
          expected.periodEnd ||
        !isDeepStrictEqual(
          prepared.contract.queryParameters,
          expected.queryParameters,
        ) ||
        !isDeepStrictEqual(
          prepared.contract.costsRequest,
          expected.costsRequest,
        )
      ) {
        return {
          status: "needs_review",
          reason: "preparation_unconfirmed",
        };
      }

      if (prepared.state === "confirmed") {
        return {
          status: "skipped",
          reason: "already_confirmed",
        };
      }

      if (
        prepared.state !== "pending" ||
        prepared.attemptCount !== 0 ||
        prepared.snapshotCollectionId !== null ||
        typeof prepared.nextAttemptAt !== "string" ||
        !Number.isFinite(
          Date.parse(prepared.nextAttemptAt),
        )
      ) {
        return {
          status: "blocked",
          reason: "prepared_operation_not_eligible",
        };
      }

      // The database assigns next_attempt_at during
      // preparation, after the initial clock reading.
      // Compare against a fresh post-preparation time.
      let afterPreparation: Date;

      try {
        afterPreparation = clock();
      } catch {
        return {
          status: "needs_review",
          reason: "post_preparation_clock_invalid",
        };
      }

      if (
        !validTimeForCutover(
          afterPreparation,
          selectedDate,
        )
      ) {
        return {
          status: "needs_review",
          reason: "cutover_date_elapsed",
        };
      }

      if (
        Date.parse(prepared.nextAttemptAt) >
        afterPreparation.getTime()
      ) {
        return {
          status: "skipped",
          reason: "not_due",
        };
      }

      operationId = prepared.operationId;
    } else {
      return {
        status: "blocked",
        reason: "inventory_invalid",
      };
    }

    operationId = operationId.toLowerCase();

    let claimVerified = false;
    let emptyClaimVerified = false;

    const adapters = createOpenAiCostBatchAdapters({
      ...options.adapterOptions,
      now: clock,

      // Override is mandatory; no generic batch claim.
      claim: async (claimRequest, dependencies) => {
        if (
          claimRequest.limit !== 1 ||
          claimRequest.claimedBy !==
            DAILY_OPENAI_COST_CRON_ACTOR ||
          !validTimeForCutover(clock(), selectedDate)
        ) {
          throw new Error(
            "OPENAI_COST_CUTOVER_CLAIM_NOT_AUTHORIZED",
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
            "OPENAI_COST_CUTOVER_CLAIM_UNCONFIRMED",
          );
        }

        const operation = result.operations[0];
        const afterClaim = clock();

        if (
          !operation ||
          operation.operationId.toLowerCase() !==
            operationId ||
          operation.operationKey !== bridge.operationKey ||
          operation.claimedBy !==
            DAILY_OPENAI_COST_CRON_ACTOR ||
          operation.attemptCount !== 1 ||
          operation.maxAttempts !== 3 ||
          typeof operation.claimToken !== "string" ||
          !UUID.test(operation.claimToken) ||
          typeof operation.claimExpiresAt !== "string" ||
          !Number.isFinite(
            Date.parse(operation.claimExpiresAt),
          ) ||
          !validTimeForCutover(afterClaim, selectedDate) ||
          Date.parse(operation.claimExpiresAt) <=
            afterClaim.getTime() ||
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
            "OPENAI_COST_CUTOVER_CLAIM_CONTRACT_INVALID",
          );
        }

        claimVerified = true;
        return result;
      },
    });

    let outcome: Awaited<
      ReturnType<typeof runClaimedOpenAiCostBatch>
    >;

    try {
      outcome = await batchRunner(
        {
          limit: 1,
          claimedBy: DAILY_OPENAI_COST_CRON_ACTOR,
        },
        adapters,
      );
    } catch {
      // Claim or financial write may already be committed.
      return {
        status: "needs_review",
        reason: "execution_uncertain",
      };
    }

    if (
      !outcome ||
      outcome.outcome !== "processed_batch" ||
      !Array.isArray(outcome.operations)
    ) {
      return {
        status: "needs_review",
        reason: "outcome_unconfirmed",
      };
    }

    if (
      emptyClaimVerified &&
      outcome.claimedCount === 0 &&
      outcome.confirmedCount === 0 &&
      outcome.failureRecordedCount === 0 &&
      outcome.needsReviewCount === 0 &&
      outcome.operations.length === 0
    ) {
      return {
        status: "skipped",
        reason: "claim_empty",
      };
    }

    if (
      !claimVerified ||
      outcome.claimedCount !== 1 ||
      outcome.operations.length !== 1
    ) {
      return {
        status: "needs_review",
        reason: "outcome_unconfirmed",
      };
    }

    const item = outcome.operations[0];

    if (
      !item ||
      item.operationId.toLowerCase() !== operationId ||
      item.operationKey !== bridge.operationKey
    ) {
      return {
        status: "needs_review",
        reason: "outcome_mismatch",
      };
    }

    if (
      outcome.confirmedCount === 1 &&
      outcome.failureRecordedCount === 0 &&
      outcome.needsReviewCount === 0 &&
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
        dateUtc: bridge.dateUtc,
      };
    }

    // An exceptional bridge failure is NOT automatically
    // routed into broad historical retries.
    return {
      status: "needs_review",
      reason: "financial_outcome_not_confirmed",
    };
  };
}