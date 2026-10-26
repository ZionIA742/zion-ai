import { createClient } from "@supabase/supabase-js";

import type {
  ClaimedOpenAiCostOperation,
} from "./zion-admin-openai-cost-claimed-operations";

export const OPENAI_COST_FAIL_RPC =
  "zion_admin_fail_openai_cost_collection_operation_by_system";

export type OpenAiCostFailureKind =
  | "retryable"
  | "permanent"
  | "uncertain";

export type OpenAiCostFailureRpcParameters = {
  p_operation_id: string;
  p_claim_token: string;
  p_failure_kind: OpenAiCostFailureKind;
  p_error_code: string;
};

export type OpenAiCostFailureRpc = (
  name: typeof OPENAI_COST_FAIL_RPC,
  parameters: OpenAiCostFailureRpcParameters,
) => Promise<{
  data: unknown;
  error: {
    code?: string | null;
    message?: string | null;
  } | null;
}>;

export type OpenAiCostFailureRequest = {
  operation: ClaimedOpenAiCostOperation;
  kind: OpenAiCostFailureKind;
  errorCode: string;
};

export type OpenAiCostFailureDependencies = {
  rpc?: OpenAiCostFailureRpc;
  now?: () => Date;
};

export type OpenAiCostFailureResult = {
  outcome: "failure_recorded";
  operationId: string;
  operationKey: string;
  state: "retryable_failed" | "permanent_failed" | "uncertain";
  eventKind:
    | "failed_retryable"
    | "retry_limit_exhausted"
    | "failed_permanent"
    | "marked_uncertain";
  errorCode: string;
  attemptCount: number;
  maxAttempts: 3;
  retryScheduled: boolean;
  nextAttemptAt: string | null;
  retryDelayMinutes: 5 | 15 | null;
};

export type OpenAiCostFailureErrorCode =
  | "OPENAI_COST_FAILURE_REQUEST_INVALID"
  | "OPENAI_COST_FAILURE_LEASE_EXPIRED"
  | "OPENAI_COST_FAILURE_CONFIG_MISSING"
  | "OPENAI_COST_FAILURE_RECORD_UNCONFIRMED";

export class OpenAiCostFailureError extends Error {
  constructor(readonly code: OpenAiCostFailureErrorCode) {
    super(code);
    this.name = "OpenAiCostFailureError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function fail(code: OpenAiCostFailureErrorCode): never {
  throw new OpenAiCostFailureError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}[T ]/.test(value) &&
    /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value) &&
    Number.isFinite(Date.parse(value));
}

function nowMs(clock: () => Date): number {
  const value = clock();

  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    fail("OPENAI_COST_FAILURE_REQUEST_INVALID");
  }

  return value.getTime();
}

function validateRequest(
  request: OpenAiCostFailureRequest,
  timestamp: number,
): void {
  const operation = request?.operation;

  if (
    !operation ||
    !isUuid(operation.operationId) ||
    !isUuid(operation.claimToken) ||
    typeof operation.operationKey !== "string" ||
    operation.operationKey.length < 1 ||
    operation.operationKey.length > 1024 ||
    operation.operationKey !== operation.operationKey.trim() ||
    typeof operation.claimedBy !== "string" ||
    operation.claimedBy.length < 1 ||
    operation.claimedBy !== operation.claimedBy.trim() ||
    operation.maxAttempts !== 3 ||
    !Number.isInteger(operation.attemptCount) ||
    operation.attemptCount < 1 ||
    operation.attemptCount > 3 ||
    !validTimestamp(operation.claimExpiresAt) ||
    !(
      request.kind === "retryable" ||
      request.kind === "permanent" ||
      request.kind === "uncertain"
    ) ||
    typeof request.errorCode !== "string" ||
    !CODE.test(request.errorCode)
  ) {
    fail("OPENAI_COST_FAILURE_REQUEST_INVALID");
  }

  if (Date.parse(operation.claimExpiresAt) <= timestamp) {
    fail("OPENAI_COST_FAILURE_LEASE_EXPIRED");
  }
}

function defaultRpc(): OpenAiCostFailureRpc {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    fail("OPENAI_COST_FAILURE_CONFIG_MISSING");
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return async (name, parameters) => {
    const response = await supabase.rpc(name, parameters);

    return {
      data: response.data,
      error: response.error,
    };
  };
}

function confirmFailure(
  value: unknown,
  request: OpenAiCostFailureRequest,
  timestamp: number,
): OpenAiCostFailureResult {
  const { operation, kind, errorCode } = request;

  let state: OpenAiCostFailureResult["state"];
  let eventKind: OpenAiCostFailureResult["eventKind"];
  let delay: 5 | 15 | null = null;

  if (kind === "uncertain") {
    state = "uncertain";
    eventKind = "marked_uncertain";
  } else if (kind === "permanent") {
    state = "permanent_failed";
    eventKind = "failed_permanent";
  } else if (operation.attemptCount >= operation.maxAttempts) {
    state = "permanent_failed";
    eventKind = "retry_limit_exhausted";
  } else {
    state = "retryable_failed";
    eventKind = "failed_retryable";
    delay = operation.attemptCount === 1 ? 5 : 15;
  }

  const retryScheduled = delay !== null;

  if (
    !isRecord(value) ||
    value.outcome !== "failure_recorded" ||
    value.operation_id !== operation.operationId ||
    value.operation_key !== operation.operationKey ||
    value.state !== state ||
    value.event_kind !== eventKind ||
    value.error_code !== errorCode ||
    value.attempt_count !== operation.attemptCount ||
    value.max_attempts !== 3 ||
    value.retry_scheduled !== retryScheduled ||
    value.retry_delay_minutes !== delay
  ) {
    fail("OPENAI_COST_FAILURE_RECORD_UNCONFIRMED");
  }

  const nextAttemptAt = value.next_attempt_at;

  if (retryScheduled) {
    if (
      !validTimestamp(nextAttemptAt) ||
      Date.parse(nextAttemptAt) <= timestamp
    ) {
      fail("OPENAI_COST_FAILURE_RECORD_UNCONFIRMED");
    }
  } else if (nextAttemptAt !== null) {
    fail("OPENAI_COST_FAILURE_RECORD_UNCONFIRMED");
  }

  return {
    outcome: "failure_recorded",
    operationId: operation.operationId,
    operationKey: operation.operationKey,
    state,
    eventKind,
    errorCode,
    attemptCount: operation.attemptCount,
    maxAttempts: 3,
    retryScheduled,
    nextAttemptAt: retryScheduled
      ? nextAttemptAt as string
      : null,
    retryDelayMinutes: delay,
  };
}

/**
 * Records a classified failure through the fenced SQL RPC only.
 *
 * No retry is executed here: the SQL RPC may merely schedule one.
 * Transport errors never trigger an automatic second RPC call.
 *
 * Do not call this after an unconfirmed financial finalization:
 * the database might already have committed the snapshot.
 *
 * Only invoke from an authorized server-side financial workflow.
 */
export async function recordClaimedOpenAiCostFailure(
  request: OpenAiCostFailureRequest,
  dependencies: OpenAiCostFailureDependencies = {},
): Promise<OpenAiCostFailureResult> {
  const clock = dependencies.now ?? (() => new Date());
  validateRequest(request, nowMs(clock));

  const rpc = dependencies.rpc ?? defaultRpc();

  let response: Awaited<ReturnType<OpenAiCostFailureRpc>>;

  try {
    response = await rpc(OPENAI_COST_FAIL_RPC, {
      p_operation_id: request.operation.operationId,
      p_claim_token: request.operation.claimToken,
      p_failure_kind: request.kind,
      p_error_code: request.errorCode,
    });
  } catch {
    fail("OPENAI_COST_FAILURE_RECORD_UNCONFIRMED");
  }

  if (!response || response.error) {
    fail("OPENAI_COST_FAILURE_RECORD_UNCONFIRMED");
  }

  return confirmFailure(response.data, request, nowMs(clock));
}
