import {
  authorizeDailyOpenAiCostExecution,
} from "./zion-admin-openai-cost-daily-execution-auth";

import {
  runDailyOpenAiCostPreparation,
} from "./zion-admin-openai-cost-daily-preparation-service";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  createDailyOpenAiCostClaimAdapter,
  type DailyOpenAiCostClaimAdapterOptions,
} from "./zion-admin-openai-cost-daily-claim-adapter";

import {
  DAILY_OPENAI_COST_CRON_ACTOR,
} from "./zion-admin-openai-cost-daily-claim-validator";

import {
  createOpenAiCostBatchAdapters,
  type OpenAiCostBatchAdapterOptions,
} from "./zion-admin-openai-cost-batch-adapters";

import {
  runClaimedOpenAiCostBatch,
} from "./zion-admin-openai-cost-batch-coordinator";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DailyOpenAiCostExecutionOutcome =
  | {
      status: "blocked";
      reason:
        | "authorization_denied"
        | "preparation_blocked"
        | "invalid_operation"
        | "utc_day_changed";
    }
  | {
      status: "skipped";
      reason: "not_pending" | "claim_empty";
    }
  | {
      status: "confirmed";
      operationId: string;
    }
  | {
      status: "needs_review";
      reason: "execution_uncertain" | "outcome_unconfirmed";
      operationId: string;
    };

export type DailyOpenAiCostExecutionRunnerOptions = {
  authorize?: typeof authorizeDailyOpenAiCostExecution;
  prepare?: typeof runDailyOpenAiCostPreparation;
  batchRunner?: typeof runClaimedOpenAiCostBatch;
  claimAdapterOptions?: DailyOpenAiCostClaimAdapterOptions;
  adapterOptions?: Omit<OpenAiCostBatchAdapterOptions, "claim">;
  now?: () => Date;
};

function validDate(value: unknown): value is Date {
  return value instanceof Date &&
    Number.isFinite(value.getTime());
}

/**
 * Internal executor for one canonical UTC day.
 *
 * Not connected to an HTTP route or scheduled job.
 * All actual financial IO is delegated to existing adapters.
 *
 * Authorization precedes preparation, inventory, claim and
 * provider collection. Human administrator access is never
 * resolved or impersonated.
 *
 * The targeted claim adapter validates canonical inventory
 * before claim and the verified claim before collection.
 *
 * A claim might already be committed when an error occurs.
 * No retries or historical backfill are performed here.
 */
export function createDailyOpenAiCostExecutionRunner(
  options: DailyOpenAiCostExecutionRunnerOptions = {},
) {
  const authorize =
    options.authorize ?? authorizeDailyOpenAiCostExecution;

  const prepare =
    options.prepare ?? runDailyOpenAiCostPreparation;

  const batchRunner =
    options.batchRunner ?? runClaimedOpenAiCostBatch;

  const clock = options.now ?? (() => new Date());

  return async (
    request: Request,
  ): Promise<DailyOpenAiCostExecutionOutcome> => {
    try {
      const access = authorize(request);

      if (
        !access ||
        access.ok !== true ||
        access.status !== "authorized"
      ) {
        return {
          status: "blocked",
          reason: "authorization_denied",
        };
      }
    } catch {
      return {
        status: "blocked",
        reason: "authorization_denied",
      };
    }

    let firstPlan: ReturnType<
      typeof planDailyOpenAiCostCollection
    >;

    try {
      const now = clock();

      if (!validDate(now)) {
        throw new Error("INVALID_CLOCK");
      }

      firstPlan = planDailyOpenAiCostCollection({
        now,
        inventoryVerified: true,
        existingQueryIdentities: [],
      });
    } catch {
      return {
        status: "blocked",
        reason: "invalid_operation",
      };
    }

    if (firstPlan.status !== "prepare") {
      return {
        status: "blocked",
        reason: "invalid_operation",
      };
    }

    let operationId: string;

    try {
      const prepared = await prepare(request);

      if (
        !prepared ||
        (prepared.status !== "existing" &&
          prepared.status !== "prepared_pending")
      ) {
        return {
          status: "blocked",
          reason: "preparation_blocked",
        };
      }

      if (
        typeof prepared.operationId !== "string" ||
        !UUID.test(prepared.operationId)
      ) {
        return {
          status: "blocked",
          reason: "invalid_operation",
        };
      }

      if (prepared.status === "existing") {
        if (prepared.state !== "pending") {
          return {
            status: "skipped",
            reason: "not_pending",
          };
        }
      } else if (
        prepared.operationKey !== firstPlan.operationKey
      ) {
        return {
          status: "blocked",
          reason: "invalid_operation",
        };
      }

      operationId = prepared.operationId;
    } catch {
      // Preparation could have committed. No automatic retry.
      return {
        status: "blocked",
        reason: "preparation_blocked",
      };
    }

    try {
      const beforeClaim = clock();

      if (!validDate(beforeClaim)) {
        return {
          status: "blocked",
          reason: "utc_day_changed",
        };
      }

      const currentPlan = planDailyOpenAiCostCollection({
        now: beforeClaim,
        inventoryVerified: true,
        existingQueryIdentities: [],
      });

      if (
        currentPlan.status !== "prepare" ||
        currentPlan.operationKey !== firstPlan.operationKey ||
        currentPlan.queryIdentity !== firstPlan.queryIdentity
      ) {
        return {
          status: "blocked",
          reason: "utc_day_changed",
        };
      }
    } catch {
      return {
        status: "blocked",
        reason: "utc_day_changed",
      };
    }

    const claim = createDailyOpenAiCostClaimAdapter(
      operationId,
      {
        ...options.claimAdapterOptions,
        now: clock,
      },
    );

    // The protected daily claim always overrides any generic
    // batch claim. The human runner is not used.
    const adapters = createOpenAiCostBatchAdapters({
      ...options.adapterOptions,
      now: clock,
      claim: (claimRequest) => claim(claimRequest),
    });

    let result: Awaited<ReturnType<typeof batchRunner>>;

    try {
      result = await batchRunner(
        {
          limit: 1,
          claimedBy: DAILY_OPENAI_COST_CRON_ACTOR,
        },
        adapters,
      );
    } catch {
      // A claim or financial write may already be committed.
      // Never retry automatically.
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

    const item = result.operations[0];

    if (
      result.claimedCount === 1 &&
      result.confirmedCount === 1 &&
      result.failureRecordedCount === 0 &&
      result.needsReviewCount === 0 &&
      result.operations.length === 1 &&
      item?.outcome === "confirmed" &&
      item.operationId.toLowerCase() ===
        operationId.toLowerCase() &&
      item.operationKey === firstPlan.operationKey &&
      typeof item.snapshotCollectionId === "string" &&
      UUID.test(item.snapshotCollectionId) &&
      (item.snapshotOutcome === "inserted" ||
        item.snapshotOutcome === "replayed")
    ) {
      return {
        status: "confirmed",
        operationId,
      };
    }

    return {
      status: "needs_review",
      reason: "outcome_unconfirmed",
      operationId,
    };
  };
}