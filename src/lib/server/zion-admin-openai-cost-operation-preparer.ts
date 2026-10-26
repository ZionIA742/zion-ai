import { createClient } from "@supabase/supabase-js";

import type {
  OpenAiOrganizationCostsRequest,
} from "./openai-organization-costs-collector";

import {
  buildOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import type {
  OpenAiCostQueryContract,
  OpenAiCostQueryParameters,
} from "./zion-admin-openai-cost-query-contract";

export const OPENAI_COST_PREPARE_RPC =
  "zion_admin_prepare_openai_cost_collection_operation_by_system";

export type OpenAiCostOperationState =
  | "pending"
  | "processing"
  | "retryable_failed"
  | "permanent_failed"
  | "uncertain"
  | "confirmed";

export type OpenAiCostPrepareParameters = {
  p_operation_key: string;
  p_query_identity: string;
  p_query_parameters: OpenAiCostQueryParameters;
  p_period_start: string;
  p_period_end: string;
  p_supersedes_operation_id: string | null;
};

export type OpenAiCostPrepareRpc = (
  name: typeof OPENAI_COST_PREPARE_RPC,
  parameters: OpenAiCostPrepareParameters,
) => Promise<{
  data: unknown;
  error: {
    code?: string | null;
    message?: string | null;
  } | null;
}>;

export type OpenAiCostPrepareRequest = {
  operationKey: string;
  costsRequest: OpenAiOrganizationCostsRequest;
  supersedesOperationId?: string | null;
};

export type OpenAiCostPrepareDependencies = {
  rpc?: OpenAiCostPrepareRpc;
};

export type OpenAiCostPrepareResult = {
  outcome: "created" | "existing";
  operationId: string;
  operationKey: string;
  state: OpenAiCostOperationState;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  snapshotCollectionId: string | null;
  contract: OpenAiCostQueryContract;
};

export type OpenAiCostPrepareErrorCode =
  | "OPENAI_COST_PREPARE_INVALID_REQUEST"
  | "OPENAI_COST_PREPARE_SUPABASE_CONFIG_MISSING"
  | "OPENAI_COST_PREPARE_RPC_FAILED"
  | "OPENAI_COST_PREPARE_RESPONSE_INVALID";

export class OpenAiCostPrepareError extends Error {
  constructor(readonly code: OpenAiCostPrepareErrorCode) {
    super(code);
    this.name = "OpenAiCostPrepareError";
  }
}

const STATES: readonly OpenAiCostOperationState[] = [
  "pending",
  "processing",
  "retryable_failed",
  "permanent_failed",
  "uncertain",
  "confirmed",
];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function validTime(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value));
}

function invalidRequest(): never {
  throw new OpenAiCostPrepareError(
    "OPENAI_COST_PREPARE_INVALID_REQUEST",
  );
}

function invalidResponse(): never {
  throw new OpenAiCostPrepareError(
    "OPENAI_COST_PREPARE_RESPONSE_INVALID",
  );
}

function defaultRpc(): OpenAiCostPrepareRpc {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new OpenAiCostPrepareError(
      "OPENAI_COST_PREPARE_SUPABASE_CONFIG_MISSING",
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return async (name, parameters) => {
    const result = await supabase.rpc(name, parameters);
    return {
      data: result.data,
      error: result.error,
    };
  };
}

function validateResult(
  value: unknown,
  operationKey: string,
  contract: OpenAiCostQueryContract,
): OpenAiCostPrepareResult {
  if (!isRecord(value)) invalidResponse();

  const outcome = value.outcome;
  const state = value.state;
  const attemptCount = value.attempt_count;
  const maxAttempts = value.max_attempts;
  const nextAttemptAt = value.next_attempt_at;
  const snapshotCollectionId = value.snapshot_collection_id;

  if (
    (outcome !== "created" && outcome !== "existing") ||
    !isUuid(value.operation_id) ||
    value.operation_key !== operationKey ||
    typeof state !== "string" ||
    !STATES.includes(state as OpenAiCostOperationState) ||
    !Number.isInteger(attemptCount) ||
    typeof attemptCount !== "number" ||
    attemptCount < 0 ||
    attemptCount > 3 ||
    maxAttempts !== 3 ||
    !(nextAttemptAt === null || validTime(nextAttemptAt)) ||
    !(snapshotCollectionId === null ||
      isUuid(snapshotCollectionId))
  ) {
    invalidResponse();
  }

  if (
    (state === "pending" || state === "retryable_failed") &&
    nextAttemptAt === null
  ) {
    invalidResponse();
  }

  if (
    state !== "pending" &&
    state !== "retryable_failed" &&
    nextAttemptAt !== null
  ) {
    invalidResponse();
  }

  if (
    (state === "confirmed") !==
    (snapshotCollectionId !== null)
  ) {
    invalidResponse();
  }

  if (
    outcome === "created" &&
    (state !== "pending" ||
      attemptCount !== 0 ||
      snapshotCollectionId !== null)
  ) {
    invalidResponse();
  }

  return {
    outcome,
    operationId: value.operation_id,
    operationKey,
    state: state as OpenAiCostOperationState,
    attemptCount,
    maxAttempts,
    nextAttemptAt,
    snapshotCollectionId,
    contract,
  };
}

/**
 * Prepares exactly one idempotent financial operation.
 *
 * Does not claim, collect, retry, finalize or write snapshots.
 * The operation key must be stable and supplied by the caller.
 *
 * Backend callers must establish their own authorization.
 * Possession of a service-role credential is not administrator
 * authentication.
 */
export async function prepareOpenAiCostOperation(
  request: OpenAiCostPrepareRequest,
  dependencies: OpenAiCostPrepareDependencies = {},
): Promise<OpenAiCostPrepareResult> {
  if (
    !request ||
    typeof request.operationKey !== "string" ||
    request.operationKey.length < 1 ||
    request.operationKey.length > 1024 ||
    request.operationKey !== request.operationKey.trim()
  ) {
    invalidRequest();
  }

  const supersedes = request.supersedesOperationId ?? null;

  if (supersedes !== null && !isUuid(supersedes)) {
    invalidRequest();
  }

  const contract = buildOpenAiCostQueryContract(
    request.costsRequest,
  );

  const parameters: OpenAiCostPrepareParameters = {
    p_operation_key: request.operationKey,
    p_query_identity: contract.queryIdentity,
    p_query_parameters: contract.queryParameters,
    p_period_start: contract.periodStart,
    p_period_end: contract.periodEnd,
    p_supersedes_operation_id: supersedes,
  };

  const rpc = dependencies.rpc ?? defaultRpc();

  let response: Awaited<ReturnType<OpenAiCostPrepareRpc>>;

  try {
    response = await rpc(OPENAI_COST_PREPARE_RPC, parameters);
  } catch {
    throw new OpenAiCostPrepareError(
      "OPENAI_COST_PREPARE_RPC_FAILED",
    );
  }

  if (response.error) {
    throw new OpenAiCostPrepareError(
      "OPENAI_COST_PREPARE_RPC_FAILED",
    );
  }

  return validateResult(
    response.data,
    request.operationKey,
    contract,
  );
}
