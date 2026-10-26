import { createClient } from "@supabase/supabase-js";
import type {
  OpenAiOfficialCostRecord,
  OpenAiOrganizationCostsCollection,
} from "./openai-organization-costs-collector";

/**
 * Name reserved for the additive SQL migration that will own the transaction.
 * This module deliberately does not write either ledger table directly: two
 * PostgREST inserts cannot provide the collection-and-lines atomicity required
 * for an immutable financial snapshot.
 */
export const OPENAI_PROVIDER_COST_SNAPSHOT_RPC = "zion_admin_write_openai_provider_cost_snapshot";

export type OpenAiProviderCostSnapshotRpc = (
  name: typeof OPENAI_PROVIDER_COST_SNAPSHOT_RPC,
  parameters: OpenAiProviderCostSnapshotRpcParameters,
) => Promise<{ data: unknown; error: { code?: string | null; message?: string | null } | null }>;

export type OpenAiProviderCostSnapshotRpcParameters = {
  p_collection: {
    collection_key: string;
    provider: "openai";
    source: "openai_organization_costs";
    query_identity: string;
    period_start: string;
    period_end: string;
    provider_timezone: "UTC";
    status: "available" | "confirmed_empty";
    result_count: number;
    query_parameters: {
      bucket_width: "1d";
      group_by: string[];
      query_identity: string;
      financial_competence: null;
    };
    error_code: null;
    collected_at: string;
  };
  p_lines: Array<{
    provider_line_identity: string;
    provider_version_fingerprint: string;
    provider_page: number;
    provider_result_index: number;
    period_start: string;
    period_end: string;
    currency: string;
    amount_numeric: string;
    amount_decimal_text: string;
    project_id: string | null;
    user_id: string | null;
    line_item: string | null;
    api_key_id: string | null;
    api_source: "agents_api" | "unlabeled" | null;
    quantity: string | null;
    quantity_unit: string | null;
    provider_bucket_object: string;
    provider_result_object: string;
  }>;
};

export type OpenAiProviderCostSnapshotWriteResult = {
  confirmed: true;
  outcome: "inserted" | "replayed";
  collectionId: string;
  collectionKey: string;
  status: "available" | "confirmed_empty";
  lineCount: number;
};

export type OpenAiProviderCostWriterDependencies = {
  rpc?: OpenAiProviderCostSnapshotRpc;
  /** Injectable clock only; collection periods always remain OpenAI UTC intervals. */
  now?: () => Date;
};

export type OpenAiProviderCostWriterErrorCode =
  | "OPENAI_PROVIDER_COST_COLLECTION_INVALID"
  | "OPENAI_PROVIDER_COST_WRITER_SUPABASE_CONFIG_MISSING"
  | "OPENAI_PROVIDER_COST_WRITER_RPC_FAILED"
  | "OPENAI_PROVIDER_COST_WRITER_RPC_RESPONSE_INVALID";

export class OpenAiProviderCostWriterError extends Error {
  constructor(readonly code: OpenAiProviderCostWriterErrorCode) {
    super(code);
    this.name = "OpenAiProviderCostWriterError";
  }
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function invalidCollection(): never {
  throw new OpenAiProviderCostWriterError("OPENAI_PROVIDER_COST_COLLECTION_INVALID");
}

function utcIsoFromUnixSeconds(value: unknown): string {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalidCollection();
  const iso = new Date((value as number) * 1000).toISOString();
  if (!nonEmptyText(iso)) invalidCollection();
  return iso;
}

function collectionKey(collectionId: string) {
  // The collection execution ID is the idempotency key. A retry must reuse it;
  // a later re-query receives a new collection ID and remains a new snapshot.
  return `openai_organization_costs:v1:${collectionId}`;
}

function validateRecord(record: OpenAiOfficialCostRecord, collection: OpenAiOrganizationCostsCollection) {
  if (
    record.source !== "openai_organization_costs" ||
    record.provider !== "openai" ||
    record.bucketWidth !== "1d" ||
    record.providerPeriodTimezone !== "UTC" ||
    record.financialCompetence !== null ||
    record.collectionId !== collection.collectionId ||
    record.queryIdentity !== collection.queryIdentity ||
    !nonEmptyText(record.providerLineIdentity) ||
    !nonEmptyText(record.providerVersionFingerprint) ||
    !nonEmptyText(record.amountCurrency) ||
    !finiteNonNegative(record.amountValue) ||
    record.amountValueDecimal !== String(record.amountValue) ||
    !Number.isSafeInteger(record.periodStartUnixSeconds) ||
    !Number.isSafeInteger(record.periodEndUnixSeconds) ||
    record.periodEndUnixSeconds <= record.periodStartUnixSeconds ||
    record.periodStartUnixSeconds < collection.period.startTime ||
    record.periodEndUnixSeconds > collection.period.endTime ||
    !Number.isSafeInteger(record.providerPage) || record.providerPage < 0 ||
    !Number.isSafeInteger(record.providerResultIndex) || record.providerResultIndex < 0 ||
    !nonEmptyText(record.providerBucketObject) || !nonEmptyText(record.providerResultObject) ||
    !/^[a-zA-Z]{3}$/.test(record.amountCurrency)
  ) invalidCollection();

  if (record.quantity !== null && !finiteNonNegative(record.quantity)) invalidCollection();
}

function toRpcLine(record: OpenAiOfficialCostRecord): OpenAiProviderCostSnapshotRpcParameters["p_lines"][number] {
  return {
    provider_line_identity: record.providerLineIdentity,
    provider_version_fingerprint: record.providerVersionFingerprint,
    provider_page: record.providerPage,
    provider_result_index: record.providerResultIndex,
    period_start: utcIsoFromUnixSeconds(record.periodStartUnixSeconds),
    period_end: utcIsoFromUnixSeconds(record.periodEndUnixSeconds),
    // The provider supplies ISO currency in lower case; the existing ledger
    // constraint stores the same ISO code canonically in upper case.
    currency: record.amountCurrency.toUpperCase(),
    amount_numeric: record.amountValueDecimal,
    amount_decimal_text: record.amountValueDecimal,
    project_id: record.projectId,
    user_id: record.userId,
    line_item: record.lineItem,
    api_key_id: record.apiKeyId,
    api_source: record.apiSource,
    quantity: record.quantity === null ? null : String(record.quantity),
    quantity_unit: record.quantityUnit,
    provider_bucket_object: record.providerBucketObject,
    provider_result_object: record.providerResultObject,
  };
}

/**
 * Converts one fully-normalized OpenAI collection to the RPC's atomic payload.
 * It intentionally accepts only a completed collection. Missing credentials,
 * provider failures, pagination failures and partial results must never be
 * represented as a confirmed empty snapshot.
 */
export function buildOpenAiProviderCostSnapshotRpcParameters(
  collection: OpenAiOrganizationCostsCollection,
  collectedAt: Date = new Date(),
): OpenAiProviderCostSnapshotRpcParameters {
  if (
    collection.source !== "openai_organization_costs" ||
    collection.provider !== "openai" ||
    (collection.status !== "available" && collection.status !== "confirmed_empty") ||
    !nonEmptyText(collection.collectionId) ||
    !nonEmptyText(collection.queryIdentity) ||
    collection.period.bucketWidth !== "1d" ||
    collection.period.providerPeriodTimezone !== "UTC" ||
    collection.period.financialCompetence !== null ||
    !Number.isSafeInteger(collection.period.startTime) ||
    !Number.isSafeInteger(collection.period.endTime) ||
    collection.period.startTime < 0 ||
    collection.period.endTime <= collection.period.startTime ||
    !Number.isSafeInteger(collection.pages) || collection.pages < 1 ||
    (collection.status === "confirmed_empty" && collection.records.length !== 0) ||
    (collection.status === "available" && collection.records.length === 0) ||
    Number.isNaN(collectedAt.getTime())
  ) invalidCollection();

  const positions = new Set<string>();
  const identities = new Set<string>();
  const lines = collection.records.map((record) => {
    validateRecord(record, collection);
    const position = `${record.providerPage}:${record.providerResultIndex}`;
    const identity = `${record.providerLineIdentity}:${record.providerVersionFingerprint}`;
    if (positions.has(position) || identities.has(identity)) invalidCollection();
    positions.add(position);
    identities.add(identity);
    return toRpcLine(record);
  });

  return {
    p_collection: {
      collection_key: collectionKey(collection.collectionId),
      provider: "openai",
      source: "openai_organization_costs",
      query_identity: collection.queryIdentity,
      period_start: utcIsoFromUnixSeconds(collection.period.startTime),
      period_end: utcIsoFromUnixSeconds(collection.period.endTime),
      provider_timezone: "UTC",
      status: collection.status,
      result_count: lines.length,
      query_parameters: {
        bucket_width: "1d",
        group_by: [...collection.groupBy],
        query_identity: collection.queryIdentity,
        financial_competence: null,
      },
      error_code: null,
      collected_at: collectedAt.toISOString(),
    },
    p_lines: lines,
  };
}

function defaultRpc(): OpenAiProviderCostSnapshotRpc {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!nonEmptyText(url) || !nonEmptyText(serviceRoleKey)) {
    throw new OpenAiProviderCostWriterError("OPENAI_PROVIDER_COST_WRITER_SUPABASE_CONFIG_MISSING");
  }
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return async (name, parameters) => {
    const result = await supabase.rpc(name, parameters);
    return { data: result.data, error: result.error };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function confirmedRpcResult(data: unknown, payload: OpenAiProviderCostSnapshotRpcParameters): OpenAiProviderCostSnapshotWriteResult {
  const status = isRecord(data) ? data.status : null;
  if (!isRecord(data) ||
    (data.outcome !== "inserted" && data.outcome !== "replayed") ||
    !nonEmptyText(data.collection_id) ||
    data.collection_key !== payload.p_collection.collection_key ||
    (status !== "available" && status !== "confirmed_empty") ||
    status !== payload.p_collection.status ||
    data.line_count !== payload.p_lines.length
  ) {
    throw new OpenAiProviderCostWriterError("OPENAI_PROVIDER_COST_WRITER_RPC_RESPONSE_INVALID");
  }
  return {
    confirmed: true,
    outcome: data.outcome,
    collectionId: data.collection_id,
    collectionKey: data.collection_key,
    status,
    lineCount: data.line_count,
  };
}

/**
 * Persists through one future database function. The function must insert the
 * header and every line in one transaction and return the confirmation shape
 * checked above. No direct table insert, financial aggregation or ai_runs read
 * exists in this module.
 */
export async function writeOpenAiProviderCostSnapshot(
  collection: OpenAiOrganizationCostsCollection,
  dependencies: OpenAiProviderCostWriterDependencies = {},
): Promise<OpenAiProviderCostSnapshotWriteResult> {
  const payload = buildOpenAiProviderCostSnapshotRpcParameters(collection, dependencies.now?.() ?? new Date());
  const rpc = dependencies.rpc || defaultRpc();
  let response: Awaited<ReturnType<OpenAiProviderCostSnapshotRpc>>;
  try {
    response = await rpc(OPENAI_PROVIDER_COST_SNAPSHOT_RPC, payload);
  } catch {
    throw new OpenAiProviderCostWriterError("OPENAI_PROVIDER_COST_WRITER_RPC_FAILED");
  }
  if (response.error) throw new OpenAiProviderCostWriterError("OPENAI_PROVIDER_COST_WRITER_RPC_FAILED");
  return confirmedRpcResult(response.data, payload);
}
