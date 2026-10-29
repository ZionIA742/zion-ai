import {
  authorizeOpenAiCostCron,
} from "./zion-admin-openai-cost-cron-auth";

import type {
  OpenAiCostCronAuthOptions,
} from "./zion-admin-openai-cost-cron-auth";

export type DailyOpenAiCostExecutionFlags = {
  collectionEnabled: boolean;
  preparationEnabled: boolean;
  executionEnabled: boolean;
  autoExecutionEnabled: boolean;
};

export type DailyOpenAiCostExecutionAuthorization =
  | {
      ok: true;
      status: "authorized";
    }
  | {
      ok: false;
      status: "blocked";
      reason:
        | "cron_unauthorized"
        | "financial_execution_disabled";
    };

export type DailyOpenAiCostExecutionAuthOptions = {
  cronAuthOptions?: OpenAiCostCronAuthOptions;
  readFlags?: () => DailyOpenAiCostExecutionFlags;
};

function readDefaultFlags(): DailyOpenAiCostExecutionFlags {
  return {
    collectionEnabled:
      process.env.ZION_ADMIN_OPENAI_COST_COLLECTION_ENABLED === "true",

    preparationEnabled:
      process.env.ZION_ADMIN_OPENAI_COST_PREPARATION_ENABLED === "true",

    executionEnabled:
      process.env.ZION_ADMIN_OPENAI_COST_EXECUTION_ENABLED === "true",

    autoExecutionEnabled:
      process.env.ZION_ADMIN_OPENAI_COST_AUTO_EXECUTION_ENABLED === "true",
  };
}

/**
 * Dedicated authorization boundary for automated OpenAI cost
 * execution through the financial cron.
 *
 * Requires the real cron bearer authorization and all financial
 * flags, including the additional auto-execution flag.
 *
 * It does not resolve or impersonate a human administrator.
 *
 * Construction and evaluation do not access the database,
 * claim operations, call OpenAI, finalize financial records,
 * schedule jobs or perform retries.
 *
 * Callers must separately verify the canonical daily operation
 * and use the protected targeted claim flow before collection.
 *
 * Test-only dependencies are injectable. Production callers
 * should invoke this function without overrides.
 */
export function authorizeDailyOpenAiCostExecution(
  request: Request,
  options: DailyOpenAiCostExecutionAuthOptions = {},
): DailyOpenAiCostExecutionAuthorization {
  let authorization: ReturnType<typeof authorizeOpenAiCostCron>;

  try {
    authorization = authorizeOpenAiCostCron(
      request,
      options.cronAuthOptions,
    );
  } catch {
    return {
      ok: false,
      status: "blocked",
      reason: "cron_unauthorized",
    };
  }

  if (!authorization.ok) {
    return {
      ok: false,
      status: "blocked",
      reason: "cron_unauthorized",
    };
  }

  let flags: DailyOpenAiCostExecutionFlags;

  try {
    flags = (options.readFlags ?? readDefaultFlags)();
  } catch {
    return {
      ok: false,
      status: "blocked",
      reason: "financial_execution_disabled",
    };
  }

  if (
    !flags ||
    flags.collectionEnabled !== true ||
    flags.preparationEnabled !== true ||
    flags.executionEnabled !== true ||
    flags.autoExecutionEnabled !== true
  ) {
    return {
      ok: false,
      status: "blocked",
      reason: "financial_execution_disabled",
    };
  }

  return {
    ok: true,
    status: "authorized",
  };
}