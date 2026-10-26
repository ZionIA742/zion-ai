import {
  claimVerifiedOpenAiCostOperations,
} from "./zion-admin-openai-cost-claimed-operations";

import type {
  OpenAiCostClaimDependencies,
} from "./zion-admin-openai-cost-claimed-operations";

import {
  collectOpenAiOrganizationCosts,
} from "./openai-organization-costs-collector";

import type {
  OpenAiOrganizationCostsCollectorDependencies,
} from "./openai-organization-costs-collector";

import {
  finalizeClaimedOpenAiCostCollection,
} from "./zion-admin-openai-cost-operation-finalizer";

import type {
  OpenAiCostFinalizeDependencies,
} from "./zion-admin-openai-cost-operation-finalizer";

import {
  recordClaimedOpenAiCostFailure,
} from "./zion-admin-openai-cost-operation-failure";

import type {
  OpenAiCostFailureDependencies,
} from "./zion-admin-openai-cost-operation-failure";

import type {
  OpenAiCostBatchDependencies,
} from "./zion-admin-openai-cost-batch-coordinator";

export type OpenAiCostBatchAdapterOptions = {
  claim?: typeof claimVerifiedOpenAiCostOperations;
  collect?: typeof collectOpenAiOrganizationCosts;
  finalize?: typeof finalizeClaimedOpenAiCostCollection;
  recordFailure?: typeof recordClaimedOpenAiCostFailure;

  claimDependencies?: OpenAiCostClaimDependencies;
  collectorDependencies?: Omit<
    OpenAiOrganizationCostsCollectorDependencies,
    "collectionId"
  >;
  finalizeDependencies?: OpenAiCostFinalizeDependencies;
  failureDependencies?: OpenAiCostFailureDependencies;

  now?: () => Date;
};

/**
 * Connects the existing claim, provider collector, atomic finalizer
 * and fenced failure recorder to the batch coordinator.
 *
 * Construction performs no I/O. No claim, fetch, write, cron,
 * retry, or schedule is started here.
 *
 * The operation ID from the database is always passed as the
 * collection ID. Caller-provided collector dependencies cannot
 * substitute a different collection identity.
 *
 * To execute a batch, a separately authorized server workflow
 * must explicitly invoke runClaimedOpenAiCostBatch().
 */
export function createOpenAiCostBatchAdapters(
  options: OpenAiCostBatchAdapterOptions = {},
): OpenAiCostBatchDependencies {
  const claim =
    options.claim ?? claimVerifiedOpenAiCostOperations;

  const collect =
    options.collect ?? collectOpenAiOrganizationCosts;

  const finalize =
    options.finalize ?? finalizeClaimedOpenAiCostCollection;

  const recordFailure =
    options.recordFailure ?? recordClaimedOpenAiCostFailure;

  const clock = options.now;

  return {
    now: clock,

    claim: (request) => claim(request, {
      ...options.claimDependencies,
      ...(clock ? { now: clock } : {}),
    }),

    collect: (request, context) => collect(request, {
      ...options.collectorDependencies,
      collectionId: context.collectionId,
    }),

    finalize: (operation, collection) =>
      finalize(operation, collection, {
        ...options.finalizeDependencies,
        ...(clock ? { now: clock } : {}),
      }),

    recordFailure: (request) =>
      recordFailure(request, {
        ...options.failureDependencies,
        ...(clock ? { now: clock } : {}),
      }),
  };
}
