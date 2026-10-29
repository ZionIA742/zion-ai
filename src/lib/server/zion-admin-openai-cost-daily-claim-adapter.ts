import type {
  OpenAiCostClaimRequest,
  OpenAiCostClaimResult,
} from "./zion-admin-openai-cost-claimed-operations";

import {
  inspectOpenAiCostInventory,
} from "./zion-admin-openai-cost-inventory-reader";

import {
  claimVerifiedTargetedOpenAiCostOperation,
} from "./zion-admin-openai-cost-targeted-claim";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  DAILY_OPENAI_COST_CRON_ACTOR,
  validateDailyOpenAiCostClaim,
} from "./zion-admin-openai-cost-daily-claim-validator";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DailyOpenAiCostClaimAdapterOptions = {
  inspect?: typeof inspectOpenAiCostInventory;
  targetedClaim?: typeof claimVerifiedTargetedOpenAiCostOperation;
  now?: () => Date;
};

function invalid(): never {
  throw new Error("OPENAI_COST_DAILY_CLAIM_NOT_VERIFIED");
}

function validDate(value: unknown): value is Date {
  return value instanceof Date &&
    Number.isFinite(value.getTime());
}

/**
 * Targeted claim adapter for the daily financial cron.
 *
 * Construction is inert. Invocation may claim one database
 * operation and MUST only happen after independent service
 * authorization and financial execution flags.
 *
 * No provider collection, finalization or automatic retry.
 * An error after claim may represent a committed claim.
 * Callers must never retry blindly.
 *
 * The adapter checks canonical inventory before claim and
 * validates the verified claim before returning it to any
 * batch coordinator or provider collector.
 */
export function createDailyOpenAiCostClaimAdapter(
  expectedOperationId: string,
  options: DailyOpenAiCostClaimAdapterOptions = {},
): (
  request: OpenAiCostClaimRequest,
) => Promise<OpenAiCostClaimResult> {
  const inspect = options.inspect ?? inspectOpenAiCostInventory;

  const targetedClaim = options.targetedClaim ??
    claimVerifiedTargetedOpenAiCostOperation;

  const clock = options.now ?? (() => new Date());

  return async (request) => {
    if (
      typeof expectedOperationId !== "string" ||
      !UUID.test(expectedOperationId) ||
      !request ||
      request.limit !== 1 ||
      request.claimedBy !== DAILY_OPENAI_COST_CRON_ACTOR
    ) {
      invalid();
    }

    const beforeClaim = clock();

    if (!validDate(beforeClaim)) {
      invalid();
    }

    const plan = planDailyOpenAiCostCollection({
      now: beforeClaim,
      inventoryVerified: true,
      existingQueryIdentities: [],
    });

    if (plan.status !== "prepare") {
      invalid();
    }

    const inventory = await inspect(plan.queryIdentity);

    if (
      inventory.status !== "existing" ||
      inventory.operationId.toLowerCase() !==
        expectedOperationId.toLowerCase() ||
      inventory.operationKey !== plan.operationKey ||
      inventory.state !== "pending"
    ) {
      invalid();
    }

    // This RPC may commit before returning a response.
    // Never repeat automatically after any error.
    const claimed = await targetedClaim({
      operationId: expectedOperationId,
      claimedBy: DAILY_OPENAI_COST_CRON_ACTOR,
    });

    if (
      !claimed ||
      claimed.outcome !== "claimed" ||
      !Array.isArray(claimed.operations) ||
      claimed.claimedCount !== claimed.operations.length ||
      claimed.claimedCount < 0 ||
      claimed.claimedCount > 1
    ) {
      invalid();
    }

    // Another worker may have won the claim concurrently.
    // Empty claim is no work, not financial confirmation.
    if (claimed.claimedCount === 0) {
      return claimed;
    }

    const afterClaim = clock();

    if (
      !validDate(afterClaim) ||
      !validateDailyOpenAiCostClaim(
        claimed,
        expectedOperationId,
        afterClaim,
      )
    ) {
      // Claim may already be committed. Never retry here.
      invalid();
    }

    return claimed;
  };
}