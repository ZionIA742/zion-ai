import { createClient } from "@supabase/supabase-js";

import {
  claimVerifiedOpenAiCostOperations,
  OPENAI_COST_CLAIM_RPC,
  OpenAiCostClaimError,
} from "./zion-admin-openai-cost-claimed-operations";

import type {
  OpenAiCostClaimDependencies,
  OpenAiCostClaimingRpc,
  OpenAiCostClaimResult,
} from "./zion-admin-openai-cost-claimed-operations";

export const OPENAI_COST_TARGETED_CLAIM_RPC =
  "zion_admin_claim_openai_cost_operation_by_id_by_system";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OpenAiCostTargetedClaimRequest = {
  operationId: string;
  claimedBy: string;
};

function defaultRpc(): OpenAiCostClaimingRpc {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new OpenAiCostClaimError(
      "OPENAI_COST_CLAIM_CONFIG_MISSING",
    );
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

function validRequest(
  request: OpenAiCostTargetedClaimRequest,
): boolean {
  return !!request &&
    typeof request.operationId === "string" &&
    UUID.test(request.operationId) &&
    typeof request.claimedBy === "string" &&
    request.claimedBy.length >= 1 &&
    request.claimedBy.length <= 128 &&
    request.claimedBy.trim() === request.claimedBy;
}

/**
 * Targeted database claim, using the existing strict claim parser
 * and fencing-token assertion.
 *
 * This function has NO independent authorization gate. Invoke it
 * only through a separately authorized server-side workflow.
 *
 * Construction is inert; invocation can mutate a targeted database
 * operation. Never call without the execution gate.
 *
 * No automatic retry, cron, provider request or snapshot write.
 */
export async function claimVerifiedTargetedOpenAiCostOperation(
  request: OpenAiCostTargetedClaimRequest,
  dependencies: OpenAiCostClaimDependencies = {},
): Promise<OpenAiCostClaimResult> {
  if (!validRequest(request)) {
    throw new OpenAiCostClaimError(
      "OPENAI_COST_CLAIM_REQUEST_INVALID",
    );
  }

  const rpc = dependencies.rpc ?? defaultRpc();
  const expectedId = request.operationId.toLowerCase();

  const targetedRpc: OpenAiCostClaimingRpc = async (
    name,
    parameters,
  ) => {
    if (name !== OPENAI_COST_CLAIM_RPC) {
      return rpc(name, parameters);
    }

    const response = await rpc(
      OPENAI_COST_TARGETED_CLAIM_RPC,
      {
        p_operation_id: request.operationId,
        p_claimed_by: parameters.p_claimed_by,
      },
    );

    // Reject an unexpected operation before any assertion
    // and, critically, before any provider collection.
    if (
      !response.error &&
      response.data !== null &&
      typeof response.data === "object" &&
      !Array.isArray(response.data) &&
      "operations" in response.data &&
      Array.isArray(response.data.operations)
    ) {
      for (const item of response.data.operations) {
        if (
          item === null ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          !("operation_id" in item) ||
          typeof item.operation_id !== "string" ||
          item.operation_id.toLowerCase() !== expectedId
        ) {
          // The claim might already be committed. The existing
          // caller will classify this as an uncertain claim.
          throw new OpenAiCostClaimError(
            "OPENAI_COST_CLAIM_RESPONSE_INVALID",
          );
        }
      }
    }

    return response;
  };

  // Reuse existing claim/lease/fencing verification.
  // Exactly one operation is permitted.
  const result = await claimVerifiedOpenAiCostOperations(
    {
      limit: 1,
      claimedBy: request.claimedBy,
    },
    {
      ...dependencies,
      rpc: targetedRpc,
    },
  );

  if (
    result.claimedCount > 1 ||
    result.operations.some(
      (operation) =>
        operation.operationId.toLowerCase() !== expectedId,
    )
  ) {
    throw new OpenAiCostClaimError(
      "OPENAI_COST_CLAIM_RESPONSE_INVALID",
    );
  }

  return result;
}
