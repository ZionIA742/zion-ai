import { createClient } from "@supabase/supabase-js";

import type {
  OpenAiCostOperationState,
} from "./zion-admin-openai-cost-operation-preparer";

const TABLE =
  "zion_admin_openai_cost_collection_operations";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATES: readonly string[] = [
  "pending",
  "processing",
  "retryable_failed",
  "permanent_failed",
  "uncertain",
  "confirmed",
];

export type OpenAiCostInventoryResult =
  | { status: "absent" }
  | {
      status: "existing";
      operationId: string;
      operationKey: string;
      state: OpenAiCostOperationState;
    }
  | {
      status: "blocked";
      reason:
        | "invalid_identity"
        | "source_unavailable"
        | "invalid_response"
        | "multiple_operations";
    };

type QueryResponse = {
  data: unknown;
  error: unknown;
};

export type OpenAiCostInventoryDependencies = {
  load?: (queryIdentity: string) => Promise<QueryResponse>;
};

async function defaultLoad(
  queryIdentity: string,
): Promise<QueryResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("OPENAI_COST_INVENTORY_CONFIG_MISSING");
  }

  const client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return client
    .from(TABLE)
    .select(
      "id,operation_key,provider,source,query_identity,state",
    )
    .eq("query_identity", queryIdentity)
    .limit(2);
}

function validIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("openai_organization_costs:v1:") &&
    value.length > "openai_organization_costs:v1:".length &&
    value.length <= 4096
  );
}

function record(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

/**
 * Read-only inventory check for one canonical financial query.
 *
 * Does not prepare, claim, collect, retry or finalize.
 * Any uncertainty blocks automatic preparation.
 *
 * The preparation RPC remains the authoritative
 * concurrency barrier; this lookup is not a lock.
 */
export async function inspectOpenAiCostInventory(
  queryIdentity: string,
  dependencies: OpenAiCostInventoryDependencies = {},
): Promise<OpenAiCostInventoryResult> {
  if (!validIdentity(queryIdentity)) {
    return {
      status: "blocked",
      reason: "invalid_identity",
    };
  }

  let response: QueryResponse;

  try {
    response = await (
      dependencies.load ?? defaultLoad
    )(queryIdentity);
  } catch {
    return {
      status: "blocked",
      reason: "source_unavailable",
    };
  }

  if (
    !response ||
    response.error ||
    !Array.isArray(response.data)
  ) {
    return {
      status: "blocked",
      reason: "source_unavailable",
    };
  }

  const rows: unknown[] = response.data;

  if (rows.length > 1) {
    return {
      status: "blocked",
      reason: "multiple_operations",
    };
  }

  if (rows.length === 0) {
    return { status: "absent" };
  }

  const row = rows[0];

  if (
    !record(row) ||
    typeof row.id !== "string" ||
    !UUID.test(row.id) ||
    typeof row.operation_key !== "string" ||
    row.operation_key.length === 0 ||
    row.provider !== "openai" ||
    row.source !== "openai_organization_costs" ||
    row.query_identity !== queryIdentity ||
    typeof row.state !== "string" ||
    !STATES.includes(row.state)
  ) {
    return {
      status: "blocked",
      reason: "invalid_response",
    };
  }

  return {
    status: "existing",
    operationId: row.id,
    operationKey: row.operation_key,
    state: row.state as OpenAiCostOperationState,
  };
}
