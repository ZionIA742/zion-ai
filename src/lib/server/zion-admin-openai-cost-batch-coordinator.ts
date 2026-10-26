import {
  OpenAiOrganizationCostsCollectorError,
} from "./openai-organization-costs-collector";

import type {
  OpenAiOrganizationCostsCollection,
  OpenAiOrganizationCostsRequest,
} from "./openai-organization-costs-collector";

import type {
  ClaimedOpenAiCostOperation,
  OpenAiCostClaimRequest,
  OpenAiCostClaimResult,
} from "./zion-admin-openai-cost-claimed-operations";

import type {
  OpenAiCostFinalizeResult,
} from "./zion-admin-openai-cost-operation-finalizer";

import type {
  OpenAiCostFailureRequest,
  OpenAiCostFailureResult,
} from "./zion-admin-openai-cost-operation-failure";

/**
 * Pure coordination boundary. All four adapters are mandatory.
 * There are no implicit provider or database credentials here.
 */
export type OpenAiCostBatchDependencies = {
  claim: (
    request: OpenAiCostClaimRequest,
  ) => Promise<OpenAiCostClaimResult>;

  collect: (
    request: OpenAiOrganizationCostsRequest,
    dependencies: { collectionId: string },
  ) => Promise<OpenAiOrganizationCostsCollection>;

  finalize: (
    operation: ClaimedOpenAiCostOperation,
    collection: OpenAiOrganizationCostsCollection,
  ) => Promise<OpenAiCostFinalizeResult>;

  recordFailure: (
    request: OpenAiCostFailureRequest,
  ) => Promise<OpenAiCostFailureResult>;

  now?: () => Date;
};

export type OpenAiCostBatchItem =
  | {
      outcome: "confirmed";
      operationId: string;
      operationKey: string;
      snapshotCollectionId: string;
      snapshotOutcome: "inserted" | "replayed";
    }
  | {
      outcome: "failure_recorded";
      operationId: string;
      operationKey: string;
      state: OpenAiCostFailureResult["state"];
      retryScheduled: boolean;
    }
  | {
      outcome: "needs_review";
      operationId: string;
      operationKey: string;
      phase:
        | "lease"
        | "collection_failure"
        | "finalization";
      errorCode: string;
    };

export type OpenAiCostBatchResult = {
  outcome: "processed_batch";
  claimedCount: number;
  confirmedCount: number;
  failureRecordedCount: number;
  needsReviewCount: number;
  operations: OpenAiCostBatchItem[];
};

export class OpenAiCostBatchError extends Error {
  readonly code: "OPENAI_COST_BATCH_INPUT_INVALID"
    | "OPENAI_COST_BATCH_CLAIM_INVALID";

  constructor(
    code: "OPENAI_COST_BATCH_INPUT_INVALID"
      | "OPENAI_COST_BATCH_CLAIM_INVALID",
  ) {
    super(code);
    this.code = code;
    this.name = "OpenAiCostBatchError";
  }
}

function timeNow(now: () => Date): number {
  const value = now();

  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime())
  ) {
    throw new OpenAiCostBatchError(
      "OPENAI_COST_BATCH_INPUT_INVALID",
    );
  }

  return value.getTime();
}

function activeLease(
  operation: ClaimedOpenAiCostOperation,
  now: () => Date,
): boolean {
  const expiresAt = Date.parse(operation.claimExpiresAt);

  return Number.isFinite(expiresAt) &&
    expiresAt > timeNow(now);
}

function needsReview(
  operation: ClaimedOpenAiCostOperation,
  phase: Extract<
    OpenAiCostBatchItem,
    { outcome: "needs_review" }
  >["phase"],
  errorCode: string,
): OpenAiCostBatchItem {
  return {
    outcome: "needs_review",
    operationId: operation.operationId,
    operationKey: operation.operationKey,
    phase,
    errorCode,
  };
}

function validateClaimBatch(
  response: OpenAiCostClaimResult,
  request: OpenAiCostClaimRequest,
): ClaimedOpenAiCostOperation[] {
  if (
    !response ||
    response.outcome !== "claimed" ||
    !Array.isArray(response.operations) ||
    response.claimedCount !== response.operations.length ||
    response.claimedCount < 0 ||
    response.claimedCount > request.limit
  ) {
    throw new OpenAiCostBatchError(
      "OPENAI_COST_BATCH_CLAIM_INVALID",
    );
  }

  const seen = new Set<string>();

  for (const operation of response.operations) {
    if (
      !operation ||
      typeof operation.operationId !== "string" ||
      !operation.operationId ||
      typeof operation.operationKey !== "string" ||
      !operation.operationKey ||
      typeof operation.claimToken !== "string" ||
      !operation.claimToken ||
      operation.claimedBy !== request.claimedBy ||
      !operation.contract?.costsRequest ||
      !operation.contract?.queryIdentity ||
      seen.has(operation.operationId)
    ) {
      throw new OpenAiCostBatchError(
        "OPENAI_COST_BATCH_CLAIM_INVALID",
      );
    }

    seen.add(operation.operationId);
  }

  return response.operations;
}

async function processOne(
  operation: ClaimedOpenAiCostOperation,
  dependencies: OpenAiCostBatchDependencies,
  now: () => Date,
): Promise<OpenAiCostBatchItem> {
  if (!activeLease(operation, now)) {
    return needsReview(
      operation,
      "lease",
      "OPENAI_COST_BATCH_LEASE_NOT_ACTIVE",
    );
  }

  let collection: OpenAiOrganizationCostsCollection;

  try {
    // Never generate an independent collection ID.
    collection = await dependencies.collect(
      operation.contract.costsRequest,
      { collectionId: operation.operationId },
    );
  } catch (error) {
    if (!activeLease(operation, now)) {
      return needsReview(
        operation,
        "lease",
        "OPENAI_COST_BATCH_LEASE_NOT_ACTIVE",
      );
    }

    // Only known collector errors may be classified as
    // retryable or permanent. Unknown exceptions are uncertain.
    const known = error instanceof
      OpenAiOrganizationCostsCollectorError;

    const kind = known
      ? (error.retryable ? "retryable" : "permanent")
      : "uncertain";

    const errorCode = known
      ? error.code
      : "OPENAI_COST_COLLECTION_UNCLASSIFIED";

    try {
      const recorded = await dependencies.recordFailure({
        operation,
        kind,
        errorCode,
      });

      if (
        recorded.outcome !== "failure_recorded" ||
        recorded.operationId !== operation.operationId ||
        recorded.operationKey !== operation.operationKey
      ) {
        return needsReview(
          operation,
          "collection_failure",
          "OPENAI_COST_FAILURE_RECORD_UNCONFIRMED",
        );
      }

      return {
        outcome: "failure_recorded",
        operationId: operation.operationId,
        operationKey: operation.operationKey,
        state: recorded.state,
        retryScheduled: recorded.retryScheduled,
      };
    } catch {
      return needsReview(
        operation,
        "collection_failure",
        "OPENAI_COST_FAILURE_RECORD_UNCONFIRMED",
      );
    }
  }

  if (!activeLease(operation, now)) {
    return needsReview(
      operation,
      "lease",
      "OPENAI_COST_BATCH_LEASE_NOT_ACTIVE",
    );
  }

  // A failed/unconfirmed finalization must NEVER be
  // converted into a retryable collector failure.
  // The database may already have committed the snapshot.
  try {
    const finalized = await dependencies.finalize(
      operation,
      collection,
    );

    if (
      finalized.outcome !== "confirmed" ||
      finalized.operationId !== operation.operationId ||
      finalized.operationKey !== operation.operationKey
    ) {
      return needsReview(
        operation,
        "finalization",
        "OPENAI_COST_FINALIZATION_UNCONFIRMED",
      );
    }

    return {
      outcome: "confirmed",
      operationId: operation.operationId,
      operationKey: operation.operationKey,
      snapshotCollectionId: finalized.snapshotCollectionId,
      snapshotOutcome: finalized.snapshotOutcome,
    };
  } catch {
    return needsReview(
      operation,
      "finalization",
      "OPENAI_COST_FINALIZATION_UNCONFIRMED",
    );
  }
}

/**
 * Executes only database-claimed work, one operation at a time.
 *
 * Claim transport uncertainty is propagated without retry.
 * Collector errors may be recorded through the fenced failure
 * RPC. Finalization uncertainty requires reconciliation.
 *
 * No automatic retries, scheduling, aggregation, or cron.
 */
export async function runClaimedOpenAiCostBatch(
  request: OpenAiCostClaimRequest,
  dependencies: OpenAiCostBatchDependencies,
): Promise<OpenAiCostBatchResult> {
  if (
    !request ||
    !Number.isInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > 10 ||
    typeof request.claimedBy !== "string" ||
    !request.claimedBy ||
    request.claimedBy !== request.claimedBy.trim() ||
    !dependencies ||
    typeof dependencies.claim !== "function" ||
    typeof dependencies.collect !== "function" ||
    typeof dependencies.finalize !== "function" ||
    typeof dependencies.recordFailure !== "function"
  ) {
    throw new OpenAiCostBatchError(
      "OPENAI_COST_BATCH_INPUT_INVALID",
    );
  }

  const now = dependencies.now ?? (() => new Date());
  timeNow(now);

  // If claim fails, never make a second claim automatically.
  const claimed = await dependencies.claim(request);
  const operations = validateClaimBatch(claimed, request);

  const outcomes: OpenAiCostBatchItem[] = [];

  for (const operation of operations) {
    outcomes.push(await processOne(
      operation,
      dependencies,
      now,
    ));
  }

  return {
    outcome: "processed_batch",
    claimedCount: operations.length,
    confirmedCount: outcomes.filter(
      (item) => item.outcome === "confirmed",
    ).length,
    failureRecordedCount: outcomes.filter(
      (item) => item.outcome === "failure_recorded",
    ).length,
    needsReviewCount: outcomes.filter(
      (item) => item.outcome === "needs_review",
    ).length,
    operations: outcomes,
  };
}
