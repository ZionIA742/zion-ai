import {
  authorizeOpenAiCostCron,
} from "./zion-admin-openai-cost-cron-auth";

import type {
  OpenAiCostCronAuthorization,
} from "./zion-admin-openai-cost-cron-auth";

import {
  resolveDailyOpenAiCostInventory,
} from "./zion-admin-openai-cost-daily-inventory-coordinator";

import type {
  DailyInventoryDecision,
} from "./zion-admin-openai-cost-daily-inventory-coordinator";

import {
  prepareOpenAiCostOperation,
} from "./zion-admin-openai-cost-operation-preparer";

import type {
  OpenAiCostOperationState,
  OpenAiCostPrepareRequest,
  OpenAiCostPrepareResult,
} from "./zion-admin-openai-cost-operation-preparer";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATES: readonly string[] = [
  "pending",
  "processing",
  "retryable_failed",
  "permanent_failed",
  "uncertain",
  "confirmed",
];

export type DailyPreparationOutcome =
  | {
      status: "blocked";
      reason:
        | "authorization_denied"
        | "financial_flags_disabled"
        | "inventory_blocked"
        | "preparation_unconfirmed";
    }
  | {
      status: "existing";
      operationId: string;
      state: OpenAiCostOperationState;
    }
  | {
      status: "prepared_pending";
      operationId: string;
      operationKey: string;
    };

export type DailyPreparationDependencies = {
  authorize?: (
    request: Request,
  ) => OpenAiCostCronAuthorization;
  resolve?: (
    now: Date,
  ) => Promise<DailyInventoryDecision>;
  prepare?: (
    request: OpenAiCostPrepareRequest,
  ) => Promise<OpenAiCostPrepareResult>;
  now?: () => Date;
  isCollectionEnabled?: () => boolean;
  isPreparationEnabled?: () => boolean;
};

function preparationFlagsEnabled(
  dependencies: DailyPreparationDependencies,
): boolean {
  try {
    const collection =
      dependencies.isCollectionEnabled?.() ??
      process.env.ZION_ADMIN_OPENAI_COST_COLLECTION_ENABLED === "true";

    const preparation =
      dependencies.isPreparationEnabled?.() ??
      process.env.ZION_ADMIN_OPENAI_COST_PREPARATION_ENABLED === "true";

    return collection === true && preparation === true;
  } catch {
    return false;
  }
}

function validPreparedResult(
  result: OpenAiCostPrepareResult,
  request: OpenAiCostPrepareRequest,
): boolean {
  if (!result || typeof result !== "object") {
    return false;
  }

  const expected = buildOpenAiCostQueryContract(
    request.costsRequest,
  );

  if (
    !UUID.test(result.operationId) ||
    result.operationKey !== request.operationKey ||
    !["created", "existing"].includes(result.outcome) ||
    !STATES.includes(result.state) ||
    !Number.isSafeInteger(result.attemptCount) ||
    result.attemptCount < 0 ||
    result.attemptCount > 3 ||
    result.maxAttempts !== 3 ||
    !result.contract ||
    result.contract.queryIdentity !== expected.queryIdentity ||
    result.contract.periodStart !== expected.periodStart ||
    result.contract.periodEnd !== expected.periodEnd ||
    JSON.stringify(result.contract.queryParameters) !==
      JSON.stringify(expected.queryParameters)
  ) {
    return false;
  }

  const pending =
    result.state === "pending" ||
    result.state === "retryable_failed";

  if (
    pending !== (result.nextAttemptAt !== null) ||
    (result.state === "confirmed") !==
      (result.snapshotCollectionId !== null)
  ) {
    return false;
  }

  if (
    result.outcome === "created" &&
    (
      result.state !== "pending" ||
      result.attemptCount !== 0
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Internal preparation service for an authenticated financial cron.
 *
 * No HTTP route is registered here.
 * No claim, OpenAI request, retry, finalization or snapshot write.
 *
 * Authentication must precede all inventory and financial RPC access.
 * A possibly committed RPC failure is never retried here.
 */
export async function runDailyOpenAiCostPreparation(
  request: Request,
  dependencies: DailyPreparationDependencies = {},
): Promise<DailyPreparationOutcome> {
  let authorized: OpenAiCostCronAuthorization;

  try {
    authorized = (
      dependencies.authorize ?? authorizeOpenAiCostCron
    )(request);
  } catch {
    return {
      status: "blocked",
      reason: "authorization_denied",
    };
  }

  if (
    !authorized ||
    authorized.ok !== true ||
    authorized.status !== "authorized"
  ) {
    return {
      status: "blocked",
      reason: "authorization_denied",
    };
  }

  if (!preparationFlagsEnabled(dependencies)) {
    return {
      status: "blocked",
      reason: "financial_flags_disabled",
    };
  }

  let decision: DailyInventoryDecision;
  let now: Date;

  try {
    now = (dependencies.now ?? (() => new Date()))();

    decision = await (
      dependencies.resolve ??
      resolveDailyOpenAiCostInventory
    )(now);
  } catch {
    return {
      status: "blocked",
      reason: "inventory_blocked",
    };
  }

  if (!decision || typeof decision !== "object") {
    return {
      status: "blocked",
      reason: "inventory_blocked",
    };
  }

  if (decision.status === "existing") {
    if (
      !UUID.test(decision.operationId) ||
      !STATES.includes(decision.state)
    ) {
      return {
        status: "blocked",
        reason: "inventory_blocked",
      };
    }

    return {
      status: "existing",
      operationId: decision.operationId,
      state: decision.state as OpenAiCostOperationState,
    };
  }

  if (decision.status !== "ready") {
    return {
      status: "blocked",
      reason: "inventory_blocked",
    };
  }

  const plan = decision.plan;

  if (
    !plan ||
    plan.status !== "prepare" ||
    typeof plan.operationKey !== "string" ||
    typeof plan.queryIdentity !== "string"
  ) {
    return {
      status: "blocked",
      reason: "inventory_blocked",
    };
  }

  const expectedPlan = planDailyOpenAiCostCollection({
    now,
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  if (
    expectedPlan.status !== "prepare" ||
    plan.dateUtc !== expectedPlan.dateUtc ||
    plan.operationKey !== expectedPlan.operationKey ||
    plan.queryIdentity !== expectedPlan.queryIdentity
  ) {
    return {
      status: "blocked",
      reason: "inventory_blocked",
    };
  }

  let matchingContract = false;

  try {
    matchingContract =
      buildOpenAiCostQueryContract(
        plan.costsRequest,
      ).queryIdentity === expectedPlan.queryIdentity;
  } catch {
    return {
      status: "blocked",
      reason: "inventory_blocked",
    };
  }

  if (!matchingContract) {
    return {
      status: "blocked",
      reason: "inventory_blocked",
    };
  }

  const prepareRequest: OpenAiCostPrepareRequest = {
    operationKey: plan.operationKey,
    costsRequest: plan.costsRequest,
    supersedesOperationId: null,
  };

  let result: OpenAiCostPrepareResult;

  try {
    result = await (
      dependencies.prepare ??
      prepareOpenAiCostOperation
    )(prepareRequest);
  } catch {
    // RPC may have committed before its response was lost.
    // Never retry a financial preparation blindly.
    return {
      status: "blocked",
      reason: "preparation_unconfirmed",
    };
  }

  let valid = false;

  try {
    valid = validPreparedResult(result, prepareRequest);
  } catch {
    valid = false;
  }

  if (!valid) {
    return {
      status: "blocked",
      reason: "preparation_unconfirmed",
    };
  }

  if (result.outcome === "existing") {
    return {
      status: "existing",
      operationId: result.operationId,
      state: result.state,
    };
  }

  return {
    status: "prepared_pending",
    operationId: result.operationId,
    operationKey: result.operationKey,
  };
}
