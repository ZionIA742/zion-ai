import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import type {
  DailyCostPlan,
} from "./zion-admin-openai-cost-daily-planner";

import {
  inspectOpenAiCostInventory,
} from "./zion-admin-openai-cost-inventory-reader";

import type {
  OpenAiCostInventoryResult,
} from "./zion-admin-openai-cost-inventory-reader";

type PreparePlan = Extract<DailyCostPlan, { status: "prepare" }>;

export type DailyInventoryDecision =
  | {
      status: "ready";
      plan: PreparePlan;
    }
  | {
      status: "existing";
      dateUtc: string;
      operationId: string;
      operationKey: string;
      state: string;
    }
  | {
      status: "blocked";
      reason:
        | "invalid_plan"
        | "inventory_unavailable"
        | "inventory_invalid"
        | "multiple_operations";
    };

export type DailyInventoryCoordinatorDependencies = {
  inspect?: (
    identity: string,
  ) => Promise<OpenAiCostInventoryResult>;
};

/**
 * Read-only coordinator.
 *
 * The first pure planner invocation constructs a candidate
 * identity only; it is NOT evidence of verified inventory.
 *
 * The candidate is never returned as ready until the
 * inventory reader confirms that the identity is absent.
 *
 * Does not call the preparer, claim, provider or ledger.
 */
export async function resolveDailyOpenAiCostInventory(
  now: Date,
  dependencies: DailyInventoryCoordinatorDependencies = {},
): Promise<DailyInventoryDecision> {
  const candidate = planDailyOpenAiCostCollection({
    now,
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  if (candidate.status !== "prepare") {
    return {
      status: "blocked",
      reason: "invalid_plan",
    };
  }

  let inventory: OpenAiCostInventoryResult;

  try {
    const inspect =
      dependencies.inspect ?? inspectOpenAiCostInventory;

    inventory = await inspect(candidate.queryIdentity);
  } catch {
    return {
      status: "blocked",
      reason: "inventory_unavailable",
    };
  }

  if (!inventory || typeof inventory !== "object") {
    return {
      status: "blocked",
      reason: "inventory_invalid",
    };
  }

  if (inventory.status === "blocked") {
    return {
      status: "blocked",
      reason: inventory.reason === "multiple_operations"
        ? "multiple_operations"
        : "inventory_unavailable",
    };
  }

  if (inventory.status === "existing") {
    if (
      typeof inventory.operationId !== "string" ||
      typeof inventory.operationKey !== "string" ||
      typeof inventory.state !== "string"
    ) {
      return {
        status: "blocked",
        reason: "inventory_invalid",
      };
    }

    return {
      status: "existing",
      dateUtc: candidate.dateUtc,
      operationId: inventory.operationId,
      operationKey: inventory.operationKey,
      state: inventory.state,
    };
  }

  if (inventory.status !== "absent") {
    return {
      status: "blocked",
      reason: "inventory_invalid",
    };
  }

  const verified = planDailyOpenAiCostCollection({
    now,
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  if (
    verified.status !== "prepare" ||
    verified.queryIdentity !== candidate.queryIdentity ||
    verified.operationKey !== candidate.operationKey
  ) {
    return {
      status: "blocked",
      reason: "invalid_plan",
    };
  }

  return {
    status: "ready",
    plan: verified,
  };
}
