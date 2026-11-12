import {
  planDailyOpenAiCostCollection,
} from "./zion-admin-openai-cost-daily-planner";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

const DAY_MS = 86_400_000;
const DAY_SECONDS = 86_400;

type PreparePlan = Extract<
  ReturnType<typeof planDailyOpenAiCostCollection>,
  { status: "prepare" }
>;

type FinancialPeriod = {
  dateUtc: string;
  operationKey: string;
  queryIdentity: string;
  costsRequest: PreparePlan["costsRequest"];
};

export type OpenAiCostCutoverPlan =
  | {
      status: "blocked";
      reason: "invalid_time" | "invalid_plan";
    }
  | {
      status: "ready";
      bridge: FinancialPeriod;
      regular: FinancialPeriod;
    };

function canonicalPeriod(
  plan: PreparePlan,
): boolean {
  try {
    const contract = buildOpenAiCostQueryContract(
      plan.costsRequest,
    );

    return (
      contract.queryIdentity === plan.queryIdentity &&
      contract.periodStart ===
        `${plan.dateUtc}T00:00:00.000Z` &&
      Date.parse(contract.periodStart) ===
        plan.costsRequest.startTime * 1000 &&
      Date.parse(contract.periodEnd) ===
        plan.costsRequest.endTime * 1000 &&
      plan.costsRequest.endTime -
        plan.costsRequest.startTime === DAY_SECONDS
    );
  } catch {
    return false;
  }
}

/**
 * Read-only cutover planner.
 *
 * Existing production rule: UTC day minus two.
 * New rule: UTC day minus one.
 *
 * At the moment of switching, exactly one older UTC
 * day needs explicit handling alongside the new daily
 * collection.
 *
 * This computes both canonical identities using the
 * existing daily planner.
 *
 * It never reads database inventory, prepares an
 * operation, claims a lease, accesses the provider
 * or modifies financial records.
 *
 * Execution must be a separately authorized one-time
 * workflow with confirmed inventory and idempotency.
 */
export function planOpenAiCostCutoverBridge(
  now: Date,
): OpenAiCostCutoverPlan {
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    now.getTime() < DAY_MS * 3
  ) {
    return {
      status: "blocked",
      reason: "invalid_time",
    };
  }

  const regular = planDailyOpenAiCostCollection({
    now,
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  const bridge = planDailyOpenAiCostCollection({
    now: new Date(now.getTime() - DAY_MS),
    inventoryVerified: true,
    existingQueryIdentities: [],
  });

  if (
    regular.status !== "prepare" ||
    bridge.status !== "prepare" ||
    !canonicalPeriod(regular) ||
    !canonicalPeriod(bridge) ||
    bridge.operationKey === regular.operationKey ||
    bridge.queryIdentity === regular.queryIdentity ||
    bridge.costsRequest.endTime !==
      regular.costsRequest.startTime
  ) {
    return {
      status: "blocked",
      reason: "invalid_plan",
    };
  }

  return {
    status: "ready",
    bridge: {
      dateUtc: bridge.dateUtc,
      operationKey: bridge.operationKey,
      queryIdentity: bridge.queryIdentity,
      costsRequest: bridge.costsRequest,
    },
    regular: {
      dateUtc: regular.dateUtc,
      operationKey: regular.operationKey,
      queryIdentity: regular.queryIdentity,
      costsRequest: regular.costsRequest,
    },
  };
}