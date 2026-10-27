import { createClient } from "@supabase/supabase-js";

import {
  parseOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import type {
  OpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

export const OPENAI_COST_CLAIM_RPC =
  "zion_admin_claim_openai_cost_collection_operations_by_system";

export const OPENAI_COST_ASSERT_RPC =
  "zion_admin_assert_openai_cost_collection_operation_claim_by_sys";

type RpcResponse = {
  data: unknown;
  error: {
    code?: string | null;
    message?: string | null;
  } | null;
};

export type OpenAiCostClaimingRpc = (
  name: string,
  parameters: Record<string, unknown>,
) => Promise<RpcResponse>;

export type OpenAiCostClaimRequest = {
  limit: number;
  claimedBy: string;
};

export type ClaimedOpenAiCostOperation = {
  operationId: string;
  operationKey: string;
  claimToken: string;
  claimedBy: string;
  claimExpiresAt: string;
  attemptCount: number;
  maxAttempts: 3;
  contract: OpenAiCostQueryContract;
};

export type OpenAiCostClaimDependencies = {
  rpc?: OpenAiCostClaimingRpc;
  now?: () => Date;
};

export type OpenAiCostClaimResult = {
  outcome: "claimed";
  claimedCount: number;
  operations: ClaimedOpenAiCostOperation[];
};

export type OpenAiCostClaimErrorCode =
  | "OPENAI_COST_CLAIM_REQUEST_INVALID"
  | "OPENAI_COST_CLAIM_CONFIG_MISSING"
  | "OPENAI_COST_CLAIM_OUTCOME_UNCERTAIN"
  | "OPENAI_COST_CLAIM_RESPONSE_INVALID"
  | "OPENAI_COST_CLAIM_ASSERT_UNCONFIRMED";

export class OpenAiCostClaimError extends Error {
  constructor(readonly code: OpenAiCostClaimErrorCode) {
    super(code);
    this.name = "OpenAiCostClaimError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIMESTAMPTZ =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

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

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    TIMESTAMPTZ.test(value) &&
    Number.isFinite(Date.parse(value));
}

function invalid(
  code: OpenAiCostClaimErrorCode =
    "OPENAI_COST_CLAIM_RESPONSE_INVALID",
): never {
  throw new OpenAiCostClaimError(code);
}

function getNow(now: () => Date): number {
  const result = now();

  if (
    !(result instanceof Date) ||
    !Number.isFinite(result.getTime())
  ) {
    invalid("OPENAI_COST_CLAIM_REQUEST_INVALID");
  }

  return result.getTime();
}

function defaultRpc(): OpenAiCostClaimingRpc {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    invalid("OPENAI_COST_CLAIM_CONFIG_MISSING");
  }

  const supabase = createClient(url, key, {
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

function parseClaimedOperation(
  input: unknown,
  claimedBy: string,
  nowMs: number,
): ClaimedOpenAiCostOperation {
  if (!isRecord(input)) invalid();

  if (
    !isUuid(input.operation_id) ||
    typeof input.operation_key !== "string" ||
    input.operation_key.length < 1 ||
    input.operation_key.length > 1024 ||
    input.operation_key !== input.operation_key.trim() ||
    input.state !== "processing" ||
    !Number.isInteger(input.attempt_count) ||
    typeof input.attempt_count !== "number" ||
    input.attempt_count < 1 ||
    input.attempt_count > 3 ||
    input.max_attempts !== 3 ||
    !isUuid(input.claim_token) ||
    !isTimestamp(input.claim_expires_at) ||
    Date.parse(input.claim_expires_at) <= nowMs ||
    input.claimed_by !== claimedBy ||
    typeof input.query_identity !== "string" ||
    !isTimestamp(input.period_start) ||
    !isTimestamp(input.period_end)
  ) {
    invalid();
  }

  let contract: OpenAiCostQueryContract;

  try {
    contract = parseOpenAiCostQueryContract(
      input.query_identity,
      input.query_parameters,
    );
  } catch {
    invalid();
  }

  if (
    Date.parse(input.period_start) !==
      Date.parse(contract.periodStart) ||
    Date.parse(input.period_end) !==
      Date.parse(contract.periodEnd)
  ) {
    invalid();
  }

  return {
    operationId: input.operation_id,
    operationKey: input.operation_key,
    claimToken: input.claim_token,
    claimedBy,
    claimExpiresAt: input.claim_expires_at,
    attemptCount: input.attempt_count,
    maxAttempts: 3,
    contract,
  };
}

function parseClaimResponse(
  input: unknown,
  request: OpenAiCostClaimRequest,
  nowMs: number,
): ClaimedOpenAiCostOperation[] {
  if (
    !isRecord(input) ||
    input.outcome !== "claimed" ||
    input.lease_minutes !== 15 ||
    !Number.isInteger(input.claimed_count) ||
    typeof input.claimed_count !== "number" ||
    input.claimed_count < 0 ||
    input.claimed_count > request.limit ||
    !Array.isArray(input.operations) ||
    input.operations.length !== input.claimed_count
  ) {
    invalid();
  }

  const operations = input.operations.map(
    (item: unknown) =>
      parseClaimedOperation(item, request.claimedBy, nowMs),
  );

  const seenIds = new Set<string>();
  const seenTokens = new Set<string>();

  for (const item of operations) {
    if (
      seenIds.has(item.operationId) ||
      seenTokens.has(item.claimToken)
    ) {
      invalid();
    }

    seenIds.add(item.operationId);
    seenTokens.add(item.claimToken);
  }

  return operations;
}

function verifyAssertion(
  value: unknown,
  operation: ClaimedOpenAiCostOperation,
  nowMs: number,
): void {
  if (
    !isRecord(value) ||
    value.outcome !== "valid" ||
    value.operation_id !== operation.operationId ||
    value.operation_key !== operation.operationKey ||
    value.state !== "processing" ||
    value.attempt_count !== operation.attemptCount ||
    value.claimed_by !== operation.claimedBy ||
    !isTimestamp(value.claim_expires_at) ||
    Date.parse(value.claim_expires_at) !==
      Date.parse(operation.claimExpiresAt) ||
    Date.parse(value.claim_expires_at) <= nowMs
  ) {
    invalid("OPENAI_COST_CLAIM_ASSERT_UNCONFIRMED");
  }
}

/**
 * Claims a batch selected by the database and verifies every lease.
 *
 * A transport failure during claim is uncertain: the database may
 * already have committed the claim. Never retry blindly.
 *
 * No provider calls, snapshot writes, retries or cron execution.
 * The finalizer must re-check the fencing token transactionally.
 *
 * Call only from an authorized server-side financial workflow.
 */
export async function claimVerifiedOpenAiCostOperations(
  request: OpenAiCostClaimRequest,
  dependencies: OpenAiCostClaimDependencies = {},
): Promise<OpenAiCostClaimResult> {
  if (
    !request ||
    !Number.isInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > 10 ||
    typeof request.claimedBy !== "string" ||
    request.claimedBy.length < 1 ||
    request.claimedBy.length > 128 ||
    request.claimedBy !== request.claimedBy.trim()
  ) {
    invalid("OPENAI_COST_CLAIM_REQUEST_INVALID");
  }

  const now = dependencies.now ?? (() => new Date());
  getNow(now);

  const rpc = dependencies.rpc ?? defaultRpc();

  let response: RpcResponse;

  try {
    response = await rpc(OPENAI_COST_CLAIM_RPC, {
      p_limit: request.limit,
      p_claimed_by: request.claimedBy,
    });
  } catch {
    invalid("OPENAI_COST_CLAIM_OUTCOME_UNCERTAIN");
  }

  if (response.error) {
    invalid("OPENAI_COST_CLAIM_OUTCOME_UNCERTAIN");
  }

  const operations = parseClaimResponse(
    response.data,
    request,
    getNow(now),
  );

  // Validate the entire batch before returning even one operation.
  for (const operation of operations) {
    let asserted: RpcResponse;

    try {
      asserted = await rpc(OPENAI_COST_ASSERT_RPC, {
        p_operation_id: operation.operationId,
        p_claim_token: operation.claimToken,
      });
    } catch {
      invalid("OPENAI_COST_CLAIM_ASSERT_UNCONFIRMED");
    }

    if (asserted.error) {
      invalid("OPENAI_COST_CLAIM_ASSERT_UNCONFIRMED");
    }

    verifyAssertion(
      asserted.data,
      operation,
      getNow(now),
    );
  }

  return {
    outcome: "claimed",
    claimedCount: operations.length,
    operations,
  };
}
