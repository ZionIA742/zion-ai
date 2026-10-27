import {
  resolveZionAdminApiAccess,
} from "./zion-admin-api-access";

import {
  createOpenAiCostBatchAdapters,
  type OpenAiCostBatchAdapterOptions,
} from "./zion-admin-openai-cost-batch-adapters";

import {
  runClaimedOpenAiCostBatch,
} from "./zion-admin-openai-cost-batch-coordinator";

import {
  createOpenAiCostExecutionGate,
  type OpenAiCostExecutionGateDeps,
  type OpenAiCostExecutionGateOutcome,
} from "./zion-admin-openai-cost-execution-gate";

import {
  claimVerifiedTargetedOpenAiCostOperation,
} from "./zion-admin-openai-cost-targeted-claim";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OpenAiCostProtectedTargetedRunnerOptions = {
  adapterOptions?: Omit<OpenAiCostBatchAdapterOptions, "claim">;
  resolveAccess?: OpenAiCostExecutionGateDeps["resolveAccess"];
  isFeatureEnabled?: OpenAiCostExecutionGateDeps["isFeatureEnabled"];
  isExecutionEnabled?: OpenAiCostExecutionGateDeps["isExecutionEnabled"];
  getAllowlist?: OpenAiCostExecutionGateDeps["getAllowlist"];
  batchRunner?: typeof runClaimedOpenAiCostBatch;
};

function invalidOperation(): OpenAiCostExecutionGateOutcome {
  return {
    ok: false,
    status: "input_invalid",
    code: "OPENAI_COST_EXECUTION_INPUT_INVALID",
  };
}

/**
 * Protected, single-operation financial runner.
 *
 * Construction is inert. Invocation requires the existing
 * feature flags, server-side ZION-ADM authorization,
 * manage_accounts capability and operator allowlist.
 *
 * A new adapter and gate are created per invocation so
 * concurrent operation IDs cannot share mutable state.
 *
 * No HTTP route, cron or retry is registered here.
 */
export function createProtectedOpenAiCostTargetedRunner(
  options: OpenAiCostProtectedTargetedRunnerOptions = {},
) {
  const executeBatch =
    options.batchRunner ?? runClaimedOpenAiCostBatch;

  return async (
    operationId: string,
  ): Promise<OpenAiCostExecutionGateOutcome> => {
    if (
      typeof operationId !== "string" ||
      !UUID.test(operationId)
    ) {
      return invalidOperation();
    }

    const targetId = operationId.toLowerCase();

    const adapters = createOpenAiCostBatchAdapters({
      ...options.adapterOptions,

      // Never allow an injected batch claim to replace
      // the targeted claim for this workflow.
      claim: (request, dependencies) =>
        claimVerifiedTargetedOpenAiCostOperation(
          {
            operationId: targetId,
            claimedBy: request.claimedBy,
          },
          dependencies,
        ),
    });

    const gate = createOpenAiCostExecutionGate({
      resolveAccess: options.resolveAccess ??
        (() => resolveZionAdminApiAccess({
          requiredCapability: "manage_accounts",
        })),

      execute: async (request) => {
        const result = await executeBatch(request, adapters);

        // An unexpected processed operation must never be
        // accepted as confirmation for this target ID.
        if (
          result.operations.some(
            (item) =>
              item.operationId.toLowerCase() !== targetId,
          )
        ) {
          throw new Error(
            "OPENAI_COST_TARGETED_BATCH_ID_MISMATCH",
          );
        }

        return result;
      },

      ...(options.isFeatureEnabled
        ? { isFeatureEnabled: options.isFeatureEnabled }
        : {}),

      ...(options.isExecutionEnabled
        ? { isExecutionEnabled: options.isExecutionEnabled }
        : {}),

      ...(options.getAllowlist
        ? { getAllowlist: options.getAllowlist }
        : {}),
    });

    return gate(1);
  };
}
