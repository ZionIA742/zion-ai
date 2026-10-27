import type {
  ZionAdminApiAccessResult,
} from "./zion-admin-api-access";

import {
  resolveZionAdminApiAccess,
} from "./zion-admin-api-access";

import {
  prepareOpenAiCostOperation,
} from "./zion-admin-openai-cost-operation-preparer";

import type {
  OpenAiCostOperationState,
  OpenAiCostPrepareRequest,
} from "./zion-admin-openai-cost-operation-preparer";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

export type OpenAiCostProtectedPreparerOptions = {
  resolveAccess?: () => Promise<ZionAdminApiAccessResult>;
  prepare?: typeof prepareOpenAiCostOperation;
  isCollectionEnabled?: () => boolean;
  isPreparationEnabled?: () => boolean;
  getAllowlist?: () => string | undefined;
};

type DeniedStatus =
  | "disabled"
  | "invalid_input"
  | "access_unavailable"
  | "access_denied"
  | "identity_not_allowlisted"
  | "preparation_unconfirmed";

export type OpenAiCostProtectedPrepareOutcome =
  | {
      ok: false;
      status: DeniedStatus;
    }
  | {
      ok: true;
      status: "created_pending" | "existing_pending";
      operationId: string;
      operationKey: string;
      state: "pending";
      financialConfirmed: false;
      claimStarted: false;
    }
  | {
      ok: false;
      status: "requires_review" | "existing_not_pending";
      operationId: string;
      operationKey: string;
      state: OpenAiCostOperationState;
      financialConfirmed: false;
      claimStarted: false;
    };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function denied(status: DeniedStatus):
  OpenAiCostProtectedPrepareOutcome {
  return { ok: false, status };
}

function allowedIdentity(
  raw: string | undefined,
  identity: string,
): boolean {
  if (!raw || !UUID.test(identity)) return false;

  const entries = raw.split(",").map((item) => item.trim().toLowerCase());

  if (
    entries.length < 1 ||
    entries.length > 32 ||
    entries.some((item) => !UUID.test(item)) ||
    new Set(entries).size !== entries.length
  ) {
    return false;
  }

  return entries.includes(identity.toLowerCase());
}

function validateInput(
  request: OpenAiCostPrepareRequest,
): boolean {
  if (
    !request ||
    typeof request !== "object" ||
    typeof request.operationKey !== "string" ||
    request.operationKey.length < 1 ||
    request.operationKey.length > 1024 ||
    request.operationKey !== request.operationKey.trim() ||
    (
      request.supersedesOperationId != null &&
      (
        typeof request.supersedesOperationId !== "string" ||
        !UUID.test(request.supersedesOperationId)
      )
    )
  ) {
    return false;
  }

  try {
    buildOpenAiCostQueryContract(request.costsRequest);
    return true;
  } catch {
    return false;
  }
}

/**
 * Administrative, fail-closed wrapper for the existing preparer.
 *
 * Creating this function performs no I/O.
 *
 * Both the collection feature flag and the separate preparation
 * flag must be explicitly true. Preparation does not require
 * enabling the financial batch execution flag.
 *
 * This module creates no route, cron, claim, provider request,
 * snapshot, retry or financial confirmation.
 *
 * If preparation may have committed but its response was lost,
 * it NEVER retries automatically.
 */
export function createProtectedOpenAiCostPreparer(
  options: OpenAiCostProtectedPreparerOptions = {},
) {
  return async (
    request: OpenAiCostPrepareRequest,
  ): Promise<OpenAiCostProtectedPrepareOutcome> => {
    let enabled = false;

    try {
      enabled =
        (options.isCollectionEnabled?.() ??
          process.env.ZION_ADMIN_OPENAI_COST_COLLECTION_ENABLED === "true") &&
        (options.isPreparationEnabled?.() ??
          process.env.ZION_ADMIN_OPENAI_COST_PREPARATION_ENABLED === "true");
    } catch {
      enabled = false;
    }

    if (!enabled) return denied("disabled");
    if (!validateInput(request)) return denied("invalid_input");

    let access: ZionAdminApiAccessResult;

    try {
      const resolve = options.resolveAccess ??
        (() => resolveZionAdminApiAccess({
          requiredCapability: "manage_accounts",
        }));

      access = await resolve();
    } catch {
      return denied("access_unavailable");
    }

    if (
      !access ||
      !access.ok ||
      access.resolution.domain !== "zion_admin" ||
      access.resolution.status !== "zion_admin_allowed" ||
      access.resolution.sessionUserId !== access.sessionUserId ||
      !UUID.test(access.sessionUserId) ||
      !access.resolution.capabilities.includes("manage_accounts")
    ) {
      return denied("access_denied");
    }

    let allowlisted = false;

    try {
      allowlisted = allowedIdentity(
        options.getAllowlist?.() ??
          process.env.ZION_ADMIN_OPENAI_COST_EXECUTION_USER_IDS,
        access.sessionUserId,
      );
    } catch {
      allowlisted = false;
    }

    if (!allowlisted) {
      return denied("identity_not_allowlisted");
    }

    const prepare = options.prepare ?? prepareOpenAiCostOperation;

    try {
      const result = await prepare(request);
      const expected = buildOpenAiCostQueryContract(
        request.costsRequest,
      );

      if (
        !result ||
        (result.outcome !== "created" &&
          result.outcome !== "existing") ||
        typeof result.operationId !== "string" ||
        !UUID.test(result.operationId) ||
        result.operationKey !== request.operationKey ||
        !result.contract ||
        result.contract.queryIdentity !== expected.queryIdentity ||
        result.contract.periodStart !== expected.periodStart ||
        result.contract.periodEnd !== expected.periodEnd ||
        JSON.stringify(result.contract.queryParameters) !==
          JSON.stringify(expected.queryParameters) ||
        !Number.isSafeInteger(result.attemptCount) ||
        result.attemptCount < 0 ||
        result.attemptCount > 3 ||
        result.maxAttempts !== 3 ||
        (
          result.snapshotCollectionId !== null &&
          (
            typeof result.snapshotCollectionId !== "string" ||
            !UUID.test(result.snapshotCollectionId)
          )
        ) ||
        (
          result.nextAttemptAt !== null &&
          (
            typeof result.nextAttemptAt !== "string" ||
            !Number.isFinite(Date.parse(result.nextAttemptAt))
          )
        )
      ) {
        return denied("preparation_unconfirmed");
      }

      const states = [
        "pending",
        "processing",
        "retryable_failed",
        "permanent_failed",
        "uncertain",
        "confirmed",
      ];

      if (!states.includes(result.state)) {
        return denied("preparation_unconfirmed");
      }

      if (
        (result.state === "confirmed") !==
          (result.snapshotCollectionId !== null) ||
        (
          (result.state === "pending" ||
            result.state === "retryable_failed") !==
          (result.nextAttemptAt !== null)
        ) ||
        (
          result.outcome === "created" &&
          (result.state !== "pending" ||
            result.attemptCount !== 0)
        )
      ) {
        return denied("preparation_unconfirmed");
      }

      const base = {
        operationId: result.operationId,
        operationKey: result.operationKey,
        financialConfirmed: false as const,
        claimStarted: false as const,
      };

      if (result.state === "pending") {
        return {
          ok: true,
          status: result.outcome === "created"
            ? "created_pending"
            : "existing_pending",
          ...base,
          state: "pending",
        };
      }

      return {
        ok: false,
        status: result.state === "uncertain"
          ? "requires_review"
          : "existing_not_pending",
        ...base,
        state: result.state,
      };
    } catch {
      // A server RPC may have committed before an error.
      // No second prepare call is authorized here.
      return denied("preparation_unconfirmed");
    }
  };
}
