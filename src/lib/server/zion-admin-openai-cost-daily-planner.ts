import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

export type DailyCostPlanInput = {
  now: Date;
  inventoryVerified: boolean;
  existingQueryIdentities: string[];
};

export type DailyCostPlan =
  | {
      status: "blocked";
      reason: "invalid_input" | "inventory_unverified";
    }
  | {
      status: "existing";
      dateUtc: string;
      queryIdentity: string;
    }
  | {
      status: "prepare";
      dateUtc: string;
      operationKey: string;
      queryIdentity: string;
      costsRequest: {
        startTime: number;
        endTime: number;
        groupBy: ["line_item", "project_id"];
        limit: 1;
      };
    };

const DAY_MS = 86400000;
const REPORTING_LAG_DAYS = 2;

/**
 * Pure planner. Does not query the database, access OpenAI,
 * create operations, start claims or execute retries.
 *
 * Only the selected UTC day is considered. Older days are
 * not automatically backfilled by this planner.
 *
 * Every existing query identity blocks new preparation,
 * regardless of state. Any review/reconciliation must
 * happen through a separate authorized workflow.
 */
export function planDailyOpenAiCostCollection(
  input: DailyCostPlanInput,
): DailyCostPlan {
  if (
    !input ||
    !(input.now instanceof Date) ||
    !Number.isFinite(input.now.getTime()) ||
    typeof input.inventoryVerified !== "boolean" ||
    !Array.isArray(input.existingQueryIdentities) ||
    input.existingQueryIdentities.some(
      (value) => typeof value !== "string" || !value,
    )
  ) {
    return { status: "blocked", reason: "invalid_input" };
  }

  if (!input.inventoryVerified) {
    return {
      status: "blocked",
      reason: "inventory_unverified",
    };
  }

  const utcToday = Date.UTC(
    input.now.getUTCFullYear(),
    input.now.getUTCMonth(),
    input.now.getUTCDate(),
  );

  const startMs =
    utcToday - REPORTING_LAG_DAYS * DAY_MS;

  const dateUtc =
    new Date(startMs).toISOString().slice(0, 10);

  const costsRequest = {
    startTime: startMs / 1000,
    endTime: (startMs + DAY_MS) / 1000,
    groupBy: ["line_item", "project_id"] as [
      "line_item",
      "project_id"
    ],
    limit: 1 as const,
  };

  const contract =
    buildOpenAiCostQueryContract(costsRequest);

  if (
    input.existingQueryIdentities.includes(
      contract.queryIdentity,
    )
  ) {
    return {
      status: "existing",
      dateUtc,
      queryIdentity: contract.queryIdentity,
    };
  }

  return {
    status: "prepare",
    dateUtc,
    operationKey:
      `zion_admin_openai_costs_${dateUtc.replace(/-/g, "_")}_utc_org_v1`,
    queryIdentity: contract.queryIdentity,
    costsRequest,
  };
}
