import type {
  ZionAdminApiAccessResult,
} from "./zion-admin-api-access";

import type {
  OpenAiCostClaimRequest,
} from "./zion-admin-openai-cost-claimed-operations";

import type {
  OpenAiCostBatchResult,
} from "./zion-admin-openai-cost-batch-coordinator";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CLAIMED_BY = "zion-admin-financial-worker";

export type OpenAiCostExecutionGateDeps = {
  resolveAccess: () => Promise<ZionAdminApiAccessResult>;

  execute: (
    request: OpenAiCostClaimRequest,
  ) => Promise<OpenAiCostBatchResult>;

  isFeatureEnabled?: () => boolean;
  isExecutionEnabled?: () => boolean;
  getAllowlist?: () => string | undefined;
};

export type OpenAiCostExecutionGateOutcome =
  | {
      ok: false;
      status:
        | "disabled"
        | "input_invalid"
        | "access_unavailable"
        | "access_denied"
        | "identity_not_allowlisted"
        | "execution_unconfirmed"
        | "result_invalid";
      code: string;
    }
  | {
      ok: true;
      status: "no_work" | "confirmed";
      claimedCount: number;
      confirmedCount: number;
      failureRecordedCount: 0;
      needsReviewCount: 0;
    }
  | {
      ok: false;
      status: "failures_recorded" | "requires_review";
      claimedCount: number;
      confirmedCount: number;
      failureRecordedCount: number;
      needsReviewCount: number;
    };

function denied(
  status: Extract<
    OpenAiCostExecutionGateOutcome,
    { code: string }
  >["status"],
  code: string,
): OpenAiCostExecutionGateOutcome {
  return { ok: false, status, code };
}

function validAllowlist(
  raw: string | undefined,
  actorId: string,
): boolean {
  if (!UUID.test(actorId)) return false;
  if (!raw || raw.trim() !== raw) return false;

  const entries = raw.split(",").map(
    (entry) => entry.trim().toLowerCase(),
  );

  if (
    entries.length === 0 ||
    entries.some((entry) => !UUID.test(entry)) ||
    new Set(entries).size !== entries.length
  ) {
    return false;
  }

  return entries.includes(actorId.toLowerCase());
}

function validBatch(
  value: OpenAiCostBatchResult,
  limit: number,
): boolean {
  if (
    !value ||
    value.outcome !== "processed_batch" ||
    !Number.isInteger(value.claimedCount) ||
    value.claimedCount < 0 ||
    value.claimedCount > limit ||
    !Array.isArray(value.operations) ||
    value.operations.length !== value.claimedCount ||
    !Number.isInteger(value.confirmedCount) ||
    !Number.isInteger(value.failureRecordedCount) ||
    !Number.isInteger(value.needsReviewCount) ||
    value.confirmedCount < 0 ||
    value.failureRecordedCount < 0 ||
    value.needsReviewCount < 0 ||
    value.confirmedCount +
      value.failureRecordedCount +
      value.needsReviewCount !== value.claimedCount
  ) {
    return false;
  }

  const allowed = new Set([
    "confirmed",
    "failure_recorded",
    "needs_review",
  ]);

  const seen = new Set<string>();

  for (const operation of value.operations) {
    if (
      !operation ||
      !allowed.has(operation.outcome) ||
      typeof operation.operationId !== "string" ||
      !UUID.test(operation.operationId) ||
      typeof operation.operationKey !== "string" ||
      !operation.operationKey ||
      seen.has(operation.operationId)
    ) {
      return false;
    }

    seen.add(operation.operationId);
  }

  return (
    value.operations.filter(
      (item) => item.outcome === "confirmed",
    ).length === value.confirmedCount &&
    value.operations.filter(
      (item) => item.outcome === "failure_recorded",
    ).length === value.failureRecordedCount &&
    value.operations.filter(
      (item) => item.outcome === "needs_review",
    ).length === value.needsReviewCount
  );
}

/**
 * Server-only guard around an explicitly injected batch executor.
 *
 * No route, cron, claim or provider request is created here.
 * Both execution flags are OFF unless their exact server values
 * are "true". Access is resolved from the existing ZION-ADM
 * server authorization layer, never from caller-provided identity.
 *
 * Failure and reconciliation states are NOT financial success.
 */
export function createOpenAiCostExecutionGate(
  deps: OpenAiCostExecutionGateDeps,
) {
  return async (
    limit: number,
  ): Promise<OpenAiCostExecutionGateOutcome> => {
    // Check switches before resolving access or opening a claim.
    let enabled = false;

    try {
      enabled = (
        (deps.isFeatureEnabled?.() ??
          (process.env.ZION_ADMIN_OPENAI_COST_COLLECTION_ENABLED === "true")) &&
        (deps.isExecutionEnabled?.() ??
          (process.env.ZION_ADMIN_OPENAI_COST_EXECUTION_ENABLED === "true"))
      );
    } catch {
      enabled = false;
    }

    if (!enabled) {
      return denied(
        "disabled",
        "OPENAI_COST_EXECUTION_DISABLED",
      );
    }

    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 10
    ) {
      return denied(
        "input_invalid",
        "OPENAI_COST_EXECUTION_INPUT_INVALID",
      );
    }

    let access: ZionAdminApiAccessResult;

    try {
      access = await deps.resolveAccess();
    } catch {
      return denied(
        "access_unavailable",
        "OPENAI_COST_EXECUTION_ACCESS_UNAVAILABLE",
      );
    }

    if (
      !access ||
      !access.ok ||
      access.resolution.status !== "zion_admin_allowed" ||
      access.resolution.sessionUserId !== access.sessionUserId ||
      !access.resolution.capabilities.includes("manage_accounts")
    ) {
      return denied(
        "access_denied",
        "OPENAI_COST_EXECUTION_ACCESS_DENIED",
      );
    }

    let authorized = false;

    try {
      authorized = validAllowlist(
        deps.getAllowlist?.() ??
          process.env.ZION_ADMIN_OPENAI_COST_EXECUTION_USER_IDS,
        access.sessionUserId,
      );
    } catch {
      authorized = false;
    }

    if (!authorized) {
      return denied(
        "identity_not_allowlisted",
        "OPENAI_COST_EXECUTION_IDENTITY_NOT_ALLOWLISTED",
      );
    }

    // The worker identity comes from the server, not HTTP input.
    const request: OpenAiCostClaimRequest = {
      limit,
      claimedBy: CLAIMED_BY,
    };

    let batch: OpenAiCostBatchResult;

    try {
      batch = await deps.execute(request);
    } catch {
      // A claim may already have committed. Never retry blindly.
      return denied(
        "execution_unconfirmed",
        "OPENAI_COST_EXECUTION_UNCONFIRMED",
      );
    }

    if (!validBatch(batch, limit)) {
      return denied(
        "result_invalid",
        "OPENAI_COST_EXECUTION_RESULT_INVALID",
      );
    }

    const counts = {
      claimedCount: batch.claimedCount,
      confirmedCount: batch.confirmedCount,
      failureRecordedCount: batch.failureRecordedCount,
      needsReviewCount: batch.needsReviewCount,
    };

    if (batch.needsReviewCount > 0) {
      return {
        ok: false,
        status: "requires_review",
        ...counts,
      };
    }

    if (batch.failureRecordedCount > 0) {
      return {
        ok: false,
        status: "failures_recorded",
        ...counts,
      };
    }

    if (batch.claimedCount === 0) {
      return {
        ok: true,
        status: "no_work",
        ...counts,
        failureRecordedCount: 0,
        needsReviewCount: 0,
      };
    }

    return {
      ok: true,
      status: "confirmed",
      ...counts,
      failureRecordedCount: 0,
      needsReviewCount: 0,
    };
  };
}
