import type {
  OpenAiOrganizationCostsCollection,
  OpenAiOrganizationCostsCollectorDependencies,
  OpenAiOrganizationCostsRequest,
} from "./openai-organization-costs-collector";
import { collectOpenAiOrganizationCosts } from "./openai-organization-costs-collector";
import type {
  OpenAiProviderCostSnapshotWriteResult,
  OpenAiProviderCostWriterDependencies,
} from "./zion-admin-openai-provider-cost-writer";
import { writeOpenAiProviderCostSnapshot } from "./zion-admin-openai-provider-cost-writer";

/**
 * Server-only coordination of an official OpenAI collection and the atomic
 * ledger RPC writer. It owns no schedule, credentials, database client, or
 * financial aggregation. In particular, it never reads ai_runs.
 */

export type RunOpenAiProviderCostCollectionRequest = {
  /**
   * Stable identity of one collection operation. The caller must reuse it for
   * retries of that operation; a later re-query must deliberately use another.
   */
  collectionId: string;
  costsRequest: OpenAiOrganizationCostsRequest;
};

export type RunOpenAiProviderCostCollectionDependencies = {
  collector?: typeof collectOpenAiOrganizationCosts;
  writer?: typeof writeOpenAiProviderCostSnapshot;
  collectorDependencies?: Omit<OpenAiOrganizationCostsCollectorDependencies, "collectionId">;
  writerDependencies?: OpenAiProviderCostWriterDependencies;
};

export type RunOpenAiProviderCostCollectionResult = {
  collectionId: string;
  queryIdentity: string;
  status: "available" | "confirmed_empty";
  recordsCollected: number;
  write: OpenAiProviderCostSnapshotWriteResult;
};

export class OpenAiProviderCostOrchestratorError extends Error {
  constructor(readonly code: "OPENAI_PROVIDER_COST_OPERATION_INVALID" | "OPENAI_PROVIDER_COST_COLLECTION_INCOMPLETE") {
    super(code);
    this.name = "OpenAiProviderCostOrchestratorError";
  }
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validUnixSeconds(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validateOperation(request: RunOpenAiProviderCostCollectionRequest) {
  if (!nonEmptyText(request.collectionId) || !request.costsRequest) {
    throw new OpenAiProviderCostOrchestratorError("OPENAI_PROVIDER_COST_OPERATION_INVALID");
  }
}

/**
 * The collector only returns after all pages have completed. This defensive
 * validation makes that boundary explicit for injected collectors and future
 * changes: a partial result is never reinterpreted as an empty snapshot.
 */
function assertCompleteCollection(args: {
  collection: OpenAiOrganizationCostsCollection;
  request: RunOpenAiProviderCostCollectionRequest;
}) {
  const { collection, request } = args;
  const period = collection?.period;
  const complete =
    collection?.source === "openai_organization_costs" &&
    collection?.provider === "openai" &&
    (collection?.status === "available" || collection?.status === "confirmed_empty") &&
    collection?.collectionId === request.collectionId &&
    nonEmptyText(collection?.queryIdentity) &&
    period?.bucketWidth === "1d" &&
    period.providerPeriodTimezone === "UTC" &&
    period.financialCompetence === null &&
    period.startTime === request.costsRequest.startTime &&
    period.endTime === request.costsRequest.endTime &&
    validUnixSeconds(period.startTime) &&
    validUnixSeconds(period.endTime) &&
    period.startTime < period.endTime &&
    Number.isSafeInteger(collection?.pages) &&
    collection.pages >= 1 &&
    Array.isArray(collection?.records) &&
    ((collection.status === "available" && collection.records.length > 0) ||
      (collection.status === "confirmed_empty" && collection.records.length === 0)) &&
    collection.records.every((record) =>
      record.collectionId === collection.collectionId &&
      record.queryIdentity === collection.queryIdentity &&
      record.providerPeriodTimezone === "UTC" &&
      record.financialCompetence === null,
    );

  if (!complete) {
    throw new OpenAiProviderCostOrchestratorError("OPENAI_PROVIDER_COST_COLLECTION_INCOMPLETE");
  }
}

/**
 * Collects one complete official range and persists it only through the
 * writer's atomic RPC. Provider failures propagate unchanged and therefore
 * cannot create a zero-cost or partial snapshot.
 */
export async function runOpenAiProviderCostCollection(
  request: RunOpenAiProviderCostCollectionRequest,
  dependencies: RunOpenAiProviderCostCollectionDependencies = {},
): Promise<RunOpenAiProviderCostCollectionResult> {
  validateOperation(request);
  const collector = dependencies.collector || collectOpenAiOrganizationCosts;
  const writer = dependencies.writer || writeOpenAiProviderCostSnapshot;
  const collection = await collector(request.costsRequest, {
    ...dependencies.collectorDependencies,
    collectionId: request.collectionId,
  });

  assertCompleteCollection({ collection, request });

  const write = await writer(collection, dependencies.writerDependencies);
  return {
    collectionId: collection.collectionId,
    queryIdentity: collection.queryIdentity,
    status: collection.status,
    recordsCollected: collection.records.length,
    write,
  };
}
