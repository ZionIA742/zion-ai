import { createClient } from "@supabase/supabase-js";

import type {
  OpenAiOrganizationCostsCollection,
} from "./openai-organization-costs-collector";

import type {
  ClaimedOpenAiCostOperation,
} from "./zion-admin-openai-cost-claimed-operations";

import {
  parseOpenAiCostQueryContract,
} from "./zion-admin-openai-cost-query-contract";

import type {
  OpenAiCostQueryParameters,
} from "./zion-admin-openai-cost-query-contract";

import {
  buildOpenAiProviderCostSnapshotRpcParameters,
} from "./zion-admin-openai-provider-cost-writer";

import type {
  OpenAiProviderCostSnapshotRpcParameters,
} from "./zion-admin-openai-provider-cost-writer";

export const OPENAI_COST_FINALIZE_RPC =
  "zion_admin_finalize_openai_cost_collection_operation_by_system";

export type OpenAiCostFinalizeRpcParameters = {
  p_operation_id: string;
  p_claim_token: string;
  p_collection: Omit<
    OpenAiProviderCostSnapshotRpcParameters["p_collection"],
    "query_parameters"
  > & {
    query_parameters: OpenAiCostQueryParameters;
  };
  p_lines: OpenAiProviderCostSnapshotRpcParameters["p_lines"];
};

export type OpenAiCostFinalizeRpc = (
  name: typeof OPENAI_COST_FINALIZE_RPC,
  parameters: OpenAiCostFinalizeRpcParameters,
) => Promise<{
  data: unknown;
  error: {
    code?: string | null;
    message?: string | null;
  } | null;
}>;

export type OpenAiCostFinalizeDependencies = {
  rpc?: OpenAiCostFinalizeRpc;
  now?: () => Date;
};

export type OpenAiCostFinalizeResult = {
  outcome: "confirmed";
  operationId: string;
  operationKey: string;
  snapshotCollectionId: string;
  snapshotOutcome: "inserted" | "replayed";
  confirmedAt: string;
};

export type OpenAiCostFinalizeErrorCode =
  | "OPENAI_COST_FINALIZE_INPUT_INVALID"
  | "OPENAI_COST_FINALIZE_QUERY_MISMATCH"
  | "OPENAI_COST_FINALIZE_LEASE_EXPIRED"
  | "OPENAI_COST_FINALIZE_CONFIG_MISSING"
  | "OPENAI_COST_FINALIZE_UNCONFIRMED";

export class OpenAiCostFinalizeError extends Error {
  constructor(readonly code: OpenAiCostFinalizeErrorCode) {
    super(code);
    this.name = "OpenAiCostFinalizeError";
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

function fail(code: OpenAiCostFinalizeErrorCode): never {
  throw new OpenAiCostFinalizeError(code);
}

function currentDate(now: () => Date): Date {
  const value = now();

  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime())
  ) {
    fail("OPENAI_COST_FINALIZE_INPUT_INVALID");
  }

  return value;
}

function defaultRpc(): OpenAiCostFinalizeRpc {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    fail("OPENAI_COST_FINALIZE_CONFIG_MISSING");
  }

  const supabase = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return async (name, parameters) => {
    const response = await supabase.rpc(name, parameters);

    return {
      data: response.data,
      error: response.error,
    };
  };
}

/**
 * Constructs the existing SQL writer's exact 12-field header
 * and 18-field lines, then attaches the claimed query contract.
 *
 * Does not call the blocked direct writer RPC.
 * Does not contact OpenAI or Supabase.
 */
export function buildClaimedOpenAiCostFinalizePayload(
  operation: ClaimedOpenAiCostOperation,
  collection: OpenAiOrganizationCostsCollection,
  collectedAt: Date = new Date(),
): OpenAiCostFinalizeRpcParameters {
  if (
    !operation ||
    !isUuid(operation.operationId) ||
    !isUuid(operation.claimToken) ||
    typeof operation.operationKey !== "string" ||
    operation.operationKey.length < 1 ||
    operation.operationKey.length > 1024 ||
    operation.operationKey !== operation.operationKey.trim() ||
    typeof operation.claimedBy !== "string" ||
    !operation.claimedBy.trim() ||
    operation.claimedBy !== operation.claimedBy.trim() ||
    !Number.isInteger(operation.attemptCount) ||
    operation.attemptCount < 1 ||
    operation.attemptCount > 3 ||
    operation.maxAttempts !== 3 ||
    !isTimestamp(operation.claimExpiresAt) ||
    !(collectedAt instanceof Date) ||
    !Number.isFinite(collectedAt.getTime())
  ) {
    fail("OPENAI_COST_FINALIZE_INPUT_INVALID");
  }

  if (Date.parse(operation.claimExpiresAt) <= collectedAt.getTime()) {
    fail("OPENAI_COST_FINALIZE_LEASE_EXPIRED");
  }

  if (!operation.contract) {
    fail("OPENAI_COST_FINALIZE_QUERY_MISMATCH");
  }

  let canonical: ReturnType<typeof parseOpenAiCostQueryContract>;

  try {
    canonical = parseOpenAiCostQueryContract(
      operation.contract.queryIdentity,
      operation.contract.queryParameters,
    );
  } catch {
    fail("OPENAI_COST_FINALIZE_QUERY_MISMATCH");
  }

  if (
    operation.contract.periodStart !== canonical.periodStart ||
    operation.contract.periodEnd !== canonical.periodEnd ||
    JSON.stringify(operation.contract.costsRequest) !==
      JSON.stringify(canonical.costsRequest)
  ) {
    fail("OPENAI_COST_FINALIZE_QUERY_MISMATCH");
  }

  const expectedGroupBy = canonical.costsRequest.groupBy ?? [];

  if (
    !collection ||
    collection.source !== "openai_organization_costs" ||
    collection.provider !== "openai" ||
    collection.collectionId !== operation.operationId ||
    collection.queryIdentity !== canonical.queryIdentity ||
    collection.period?.startTime !==
      canonical.costsRequest.startTime ||
    collection.period?.endTime !==
      canonical.costsRequest.endTime ||
    collection.period?.bucketWidth !== "1d" ||
    collection.period?.providerPeriodTimezone !== "UTC" ||
    collection.period?.financialCompetence !== null ||
    !Array.isArray(collection.groupBy) ||
    collection.groupBy.length !== expectedGroupBy.length ||
    collection.groupBy.some(
      (value, index) => value !== expectedGroupBy[index],
    )
  ) {
    fail("OPENAI_COST_FINALIZE_QUERY_MISMATCH");
  }

  // Keep all established monetary and line-level validation.
  const payload = buildOpenAiProviderCostSnapshotRpcParameters(
    collection,
    collectedAt,
  );

  // The direct writer's legacy builder did not contain all
  // query filters. The SQL operation finalizer requires exact
  // equality with the claimed operation's persisted JSON.
  const canonicalCollection = {
    ...payload.p_collection,
    query_parameters: canonical.queryParameters,
  };

  if (
    payload.p_collection.query_identity !==
      canonical.queryIdentity ||
    payload.p_collection.period_start !== canonical.periodStart ||
    payload.p_collection.period_end !== canonical.periodEnd ||
    payload.p_collection.collection_key !==
      `openai_organization_costs:v1:${operation.operationId}`
  ) {
    fail("OPENAI_COST_FINALIZE_QUERY_MISMATCH");
  }

  return {
    p_operation_id: operation.operationId,
    p_claim_token: operation.claimToken,
    p_collection: canonicalCollection,
    p_lines: payload.p_lines,
  };
}

function confirmedResult(
  value: unknown,
  operation: ClaimedOpenAiCostOperation,
): OpenAiCostFinalizeResult {
  if (
    !isRecord(value) ||
    value.outcome !== "confirmed" ||
    value.operation_id !== operation.operationId ||
    value.operation_key !== operation.operationKey ||
    !isUuid(value.snapshot_collection_id) ||
    (
      value.snapshot_outcome !== "inserted" &&
      value.snapshot_outcome !== "replayed"
    ) ||
    !isTimestamp(value.confirmed_at)
  ) {
    fail("OPENAI_COST_FINALIZE_UNCONFIRMED");
  }

  return {
    outcome: "confirmed",
    operationId: operation.operationId,
    operationKey: operation.operationKey,
    snapshotCollectionId: value.snapshot_collection_id,
    snapshotOutcome: value.snapshot_outcome,
    confirmedAt: value.confirmed_at,
  };
}

/**
 * Calls only the atomic operation finalizer, not the writer.
 *
 * Errors after an RPC attempt are unconfirmed: a network error
 * may occur after the database commits. No automatic retry,
 * fail transition or second financial write occurs here.
 *
 * The SQL finalizer independently verifies the active claim
 * and atomically persists snapshot, operation and audit event.
 */
export async function finalizeClaimedOpenAiCostCollection(
  operation: ClaimedOpenAiCostOperation,
  collection: OpenAiOrganizationCostsCollection,
  dependencies: OpenAiCostFinalizeDependencies = {},
): Promise<OpenAiCostFinalizeResult> {
  const collectedAt = currentDate(
    dependencies.now ?? (() => new Date()),
  );

  const payload = buildClaimedOpenAiCostFinalizePayload(
    operation,
    collection,
    collectedAt,
  );

  const rpc = dependencies.rpc ?? defaultRpc();

  let response: Awaited<ReturnType<OpenAiCostFinalizeRpc>>;

  try {
    response = await rpc(OPENAI_COST_FINALIZE_RPC, payload);
  } catch {
    fail("OPENAI_COST_FINALIZE_UNCONFIRMED");
  }

  if (!response || response.error) {
    fail("OPENAI_COST_FINALIZE_UNCONFIRMED");
  }

  return confirmedResult(response.data, operation);
}
