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
} from "./zion-admin-openai-cost-execution-gate";

/**
 * Dependencies can be injected by trusted server tests.
 * Production defaults always use the existing ZION-ADM
 * authorization and the existing batch coordinator.
 */
export type OpenAiCostProtectedRunnerOptions = {
  adapterOptions?: OpenAiCostBatchAdapterOptions;
  resolveAccess?: OpenAiCostExecutionGateDeps["resolveAccess"];
  isFeatureEnabled?: OpenAiCostExecutionGateDeps["isFeatureEnabled"];
  isExecutionEnabled?: OpenAiCostExecutionGateDeps["isExecutionEnabled"];
  getAllowlist?: OpenAiCostExecutionGateDeps["getAllowlist"];
  batchRunner?: typeof runClaimedOpenAiCostBatch;
};

/**
 * Creates the protected server-side financial batch runner.
 *
 * Construction does not claim operations, access OpenAI,
 * invoke Supabase, schedule work or authorize a retry.
 *
 * Invocation is guarded by:
 * - both server-side feature switches;
 * - the existing ZION-ADM access resolution;
 * - manage_accounts capability;
 * - the explicit financial operator allowlist.
 *
 * The claim, collection, finalization and failure handlers
 * remain the existing audited implementations.
 *
 * Reconciliation adapters are deliberately NOT invoked here.
 * Uncertain operations require separate investigation.
 *
 * No HTTP route or cron is exposed by this module.
 */
export function createProtectedOpenAiCostBatchRunner(
  options: OpenAiCostProtectedRunnerOptions = {},
) {
  const adapters = createOpenAiCostBatchAdapters(
    options.adapterOptions,
  );

  const executeBatch = options.batchRunner ??
    runClaimedOpenAiCostBatch;

  return createOpenAiCostExecutionGate({
    resolveAccess: options.resolveAccess ??
      (() => resolveZionAdminApiAccess({
        requiredCapability: "manage_accounts",
      })),

    execute: (request) => executeBatch(request, adapters),

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
}
