import { randomUUID } from "node:crypto";

/**
 * Server-side collector for the official OpenAI organization-costs endpoint.
 *
 * This module deliberately has no database dependency, scheduler, logging, or
 * fallback to OPENAI_API_KEY. Its normalized output is an input to a future
 * immutable financial-snapshot ledger, not a financial total.
 */

const OPENAI_ORGANIZATION_COSTS_URL = "https://api.openai.com/v1/organization/costs";
const SUPPORTED_GROUP_BY = ["project_id", "user_id", "line_item", "api_key_id", "api_source"] as const;

export type OpenAiOrganizationCostsGroupBy = (typeof SUPPORTED_GROUP_BY)[number];

export type OpenAiOrganizationCostsRequest = {
  /** Unix seconds, inclusive. */
  startTime: number;
  /** Unix seconds, exclusive. */
  endTime: number;
  groupBy?: OpenAiOrganizationCostsGroupBy[];
  projectIds?: string[];
  apiKeyIds?: string[];
  lineItems?: string[];
  /** Number of daily buckets per page; OpenAI accepts 1 through 180. */
  limit?: number;
};

export type OpenAiOfficialCostRecord = {
  source: "openai_organization_costs";
  provider: "openai";
  bucketWidth: "1d";
  periodStartUnixSeconds: number;
  periodEndUnixSeconds: number;
  periodStartIso: string;
  periodEndIso: string;
  /** Unix timestamps from OpenAI are preserved as UTC; no local competence is assigned here. */
  providerPeriodTimezone: "UTC";
  financialCompetence: null;
  amountCurrency: string;
  /** Provider value without rounding, conversion, or aggregation. */
  amountValue: number;
  /**
   * Decimal text derived from the JSON numeric value without rounding.
   * The HTTP JSON schema provides a number, not the original numeric lexeme.
   */
  amountValueDecimal: string;
  projectId: string | null;
  userId: string | null;
  lineItem: string | null;
  apiKeyId: string | null;
  apiSource: "agents_api" | "unlabeled" | null;
  quantity: number | null;
  quantityUnit: string | null;
  providerBucketObject: string;
  providerResultObject: string;
  providerPage: number;
  providerResultIndex: number;
  /** Stable identity of the provider line across re-queries of the same bucket. */
  providerLineIdentity: string;
  /** Changes when OpenAI revises the reported amount or quantity for that line. */
  providerVersionFingerprint: string;
  /** Identity of this collection execution, distinct from provider line identity. */
  collectionId: string;
  /** Canonical identity of the queried range and filters, distinct from collectionId. */
  queryIdentity: string;
};

export type OpenAiOrganizationCostsCollection = {
  source: "openai_organization_costs";
  provider: "openai";
  status: "available" | "confirmed_empty";
  collectionId: string;
  queryIdentity: string;
  period: { startTime: number; endTime: number; bucketWidth: "1d"; providerPeriodTimezone: "UTC"; financialCompetence: null };
  groupBy: OpenAiOrganizationCostsGroupBy[];
  pages: number;
  records: OpenAiOfficialCostRecord[];
};

export type OpenAiOrganizationCostsErrorCode =
  | "OPENAI_ADMIN_KEY_MISSING"
  | "OPENAI_COSTS_REQUEST_INVALID"
  | "OPENAI_COSTS_AUTHENTICATION_FAILED"
  | "OPENAI_COSTS_RATE_LIMITED"
  | "OPENAI_COSTS_TEMPORARILY_UNAVAILABLE"
  | "OPENAI_COSTS_HTTP_FAILED"
  | "OPENAI_COSTS_RESPONSE_INVALID"
  | "OPENAI_COSTS_PAGINATION_REPEATED";

export class OpenAiOrganizationCostsCollectorError extends Error {
  constructor(
    readonly code: OpenAiOrganizationCostsErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "OpenAiOrganizationCostsCollectorError";
  }
}

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type OpenAiOrganizationCostsCollectorDependencies = {
  fetch?: (input: string, init: RequestInit) => Promise<FetchResponse>;
  adminKey?: string | undefined;
  /** Injectable only to make collection execution identity deterministic in tests/callers. */
  collectionId?: string;
};

type CostsPage = {
  object: "page";
  data: CostBucket[];
  has_more: boolean;
  next_page: string | null;
};

type CostBucket = {
  object: string;
  start_time: number;
  end_time: number;
  results: CostResult[];
};

type CostResult = {
  object: string;
  amount?: { currency?: unknown; value?: unknown } | null;
  project_id?: unknown;
  user_id?: unknown;
  line_item?: unknown;
  api_key_id?: unknown;
  api_source?: unknown;
  quantity?: unknown;
  quantity_unit?: unknown;
};

function textOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function requiredText(value: unknown) {
  const text = textOrNull(value);
  if (!text) throw invalidResponse();
  return text;
}

function finiteUnixSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function finiteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(): OpenAiOrganizationCostsCollectorError {
  return new OpenAiOrganizationCostsCollectorError("OPENAI_COSTS_RESPONSE_INVALID", false);
}

function validateRequest(request: OpenAiOrganizationCostsRequest) {
  if (!finiteUnixSeconds(request.startTime) || !finiteUnixSeconds(request.endTime) || request.startTime >= request.endTime) {
    throw new OpenAiOrganizationCostsCollectorError("OPENAI_COSTS_REQUEST_INVALID", false);
  }
  const groupBy = request.groupBy || [];
  if (new Set(groupBy).size !== groupBy.length || groupBy.some((value) => !SUPPORTED_GROUP_BY.includes(value))) {
    throw new OpenAiOrganizationCostsCollectorError("OPENAI_COSTS_REQUEST_INVALID", false);
  }
  if (request.limit !== undefined && (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 180)) {
    throw new OpenAiOrganizationCostsCollectorError("OPENAI_COSTS_REQUEST_INVALID", false);
  }
  for (const value of [...(request.projectIds || []), ...(request.apiKeyIds || []), ...(request.lineItems || [])]) {
    if (!textOrNull(value)) throw new OpenAiOrganizationCostsCollectorError("OPENAI_COSTS_REQUEST_INVALID", false);
  }
}

function sortedTexts(values: string[] | undefined) {
  return [...(values || [])].sort();
}

function queryIdentity(request: OpenAiOrganizationCostsRequest) {
  const query = new URLSearchParams();
  query.set("start_time", String(request.startTime));
  query.set("end_time", String(request.endTime));
  query.set("bucket_width", "1d");
  if (request.limit !== undefined) query.set("limit", String(request.limit));
  for (const value of sortedTexts(request.groupBy)) query.append("group_by", value);
  for (const value of sortedTexts(request.projectIds)) query.append("project_ids", value);
  for (const value of sortedTexts(request.apiKeyIds)) query.append("api_key_ids", value);
  for (const value of sortedTexts(request.lineItems)) query.append("line_items", value);
  return `openai_organization_costs:v1:${query.toString()}`;
}

function buildUrl(request: OpenAiOrganizationCostsRequest, page: string | null) {
  const url = new URL(OPENAI_ORGANIZATION_COSTS_URL);
  url.searchParams.set("start_time", String(request.startTime));
  url.searchParams.set("end_time", String(request.endTime));
  url.searchParams.set("bucket_width", "1d");
  if (request.limit !== undefined) url.searchParams.set("limit", String(request.limit));
  for (const value of request.groupBy || []) url.searchParams.append("group_by", value);
  for (const value of request.projectIds || []) url.searchParams.append("project_ids", value);
  for (const value of request.apiKeyIds || []) url.searchParams.append("api_key_ids", value);
  for (const value of request.lineItems || []) url.searchParams.append("line_items", value);
  if (page) url.searchParams.set("page", page);
  return url.toString();
}

function parsePage(value: unknown): CostsPage {
  if (!isRecord(value) || value.object !== "page" || !Array.isArray(value.data) || typeof value.has_more !== "boolean") {
    throw invalidResponse();
  }
  if (value.next_page !== null && typeof value.next_page !== "string") throw invalidResponse();
  if (value.has_more !== Boolean(value.next_page)) throw invalidResponse();
  const data = value.data.map((bucket): CostBucket => {
    if (!isRecord(bucket) || bucket.object !== "bucket" || !finiteUnixSeconds(bucket.start_time) || !finiteUnixSeconds(bucket.end_time) || bucket.start_time >= bucket.end_time || !Array.isArray(bucket.results)) {
      throw invalidResponse();
    }
    const results = bucket.results.map((result): CostResult => {
      if (!isRecord(result) || result.object !== "organization.costs.result") throw invalidResponse();
      if (result.amount !== undefined && result.amount !== null && !isRecord(result.amount)) throw invalidResponse();
      return {
        object: result.object,
        amount: result.amount as CostResult["amount"],
        project_id: result.project_id,
        user_id: result.user_id,
        line_item: result.line_item,
        api_key_id: result.api_key_id,
        api_source: result.api_source,
        quantity: result.quantity,
        quantity_unit: result.quantity_unit,
      };
    });
    return { object: bucket.object, start_time: bucket.start_time, end_time: bucket.end_time, results };
  });
  return { object: "page", data, has_more: value.has_more, next_page: value.next_page };
}

function identityPart(value: string | number | null) {
  return value === null ? "~" : encodeURIComponent(String(value));
}

function normalizeResult(args: {
  bucket: CostBucket;
  result: CostResult;
  page: number;
  resultIndex: number;
  collectionId: string;
  queryIdentity: string;
}): OpenAiOfficialCostRecord {
  const { bucket, result, page, resultIndex, collectionId, queryIdentity: queryKey } = args;
  const amount = result.amount;
  if (!amount || !finiteNonNegativeNumber(amount.value)) throw invalidResponse();
  const apiSource = textOrNull(result.api_source);
  if (apiSource !== null && apiSource !== "agents_api" && apiSource !== "unlabeled") throw invalidResponse();
  let quantity: number | null = null;
  if (result.quantity != null) {
    if (!finiteNonNegativeNumber(result.quantity)) throw invalidResponse();
    quantity = result.quantity;
  }
  const projectId = textOrNull(result.project_id);
  const userId = textOrNull(result.user_id);
  const lineItem = textOrNull(result.line_item);
  const apiKeyId = textOrNull(result.api_key_id);
  const amountCurrency = requiredText(amount.currency);
  const amountValueDecimal = String(amount.value);
  const providerLineIdentity = [
    "openai_organization_costs_line:v1",
    bucket.start_time,
    bucket.end_time,
    result.object,
    identityPart(projectId), identityPart(userId), identityPart(lineItem), identityPart(apiKeyId), identityPart(apiSource),
  ].join(":");
  const providerVersionFingerprint = [providerLineIdentity, identityPart(amountCurrency), amountValueDecimal, identityPart(quantity), identityPart(textOrNull(result.quantity_unit))].join(":");
  return {
    source: "openai_organization_costs",
    provider: "openai",
    bucketWidth: "1d",
    periodStartUnixSeconds: bucket.start_time,
    periodEndUnixSeconds: bucket.end_time,
    periodStartIso: new Date(bucket.start_time * 1000).toISOString(),
    periodEndIso: new Date(bucket.end_time * 1000).toISOString(),
    providerPeriodTimezone: "UTC",
    financialCompetence: null,
    amountCurrency,
    amountValue: amount.value,
    amountValueDecimal,
    projectId,
    userId,
    lineItem,
    apiKeyId,
    apiSource: apiSource as "agents_api" | "unlabeled" | null,
    quantity,
    quantityUnit: textOrNull(result.quantity_unit),
    providerBucketObject: bucket.object,
    providerResultObject: result.object,
    providerPage: page,
    providerResultIndex: resultIndex,
    providerLineIdentity,
    providerVersionFingerprint,
    collectionId,
    queryIdentity: queryKey,
  };
}

function httpError(status: number) {
  if (status === 401 || status === 403) return new OpenAiOrganizationCostsCollectorError("OPENAI_COSTS_AUTHENTICATION_FAILED", false);
  if (status === 429) return new OpenAiOrganizationCostsCollectorError("OPENAI_COSTS_RATE_LIMITED", true);
  if (status >= 500) return new OpenAiOrganizationCostsCollectorError("OPENAI_COSTS_TEMPORARILY_UNAVAILABLE", true);
  return new OpenAiOrganizationCostsCollectorError("OPENAI_COSTS_HTTP_FAILED", false);
}

/**
 * Collects official organization costs only. It never reads ai_runs or returns
 * an aggregate, preventing accidental addition of provider costs to estimates.
 */
export async function collectOpenAiOrganizationCosts(
  request: OpenAiOrganizationCostsRequest,
  dependencies: OpenAiOrganizationCostsCollectorDependencies = {},
): Promise<OpenAiOrganizationCostsCollection> {
  validateRequest(request);
  const adminKey = dependencies.adminKey ?? process.env.OPENAI_ADMIN_KEY;
  if (!textOrNull(adminKey)) throw new OpenAiOrganizationCostsCollectorError("OPENAI_ADMIN_KEY_MISSING", false);
  const fetchImpl = dependencies.fetch || fetch;
  const collectionId = textOrNull(dependencies.collectionId) || randomUUID();
  const queryKey = queryIdentity(request);
  const records: OpenAiOfficialCostRecord[] = [];
  const seenPages = new Set<string>();
  let page: string | null = null;
  let pages = 0;

  do {
    if (page && seenPages.has(page)) {
      throw new OpenAiOrganizationCostsCollectorError("OPENAI_COSTS_PAGINATION_REPEATED", false);
    }
    if (page) seenPages.add(page);
    let response: FetchResponse;
    try {
      response = await fetchImpl(buildUrl(request, page), {
        method: "GET",
        headers: { Authorization: `Bearer ${adminKey}`, Accept: "application/json" },
      });
    } catch {
      throw new OpenAiOrganizationCostsCollectorError("OPENAI_COSTS_TEMPORARILY_UNAVAILABLE", true);
    }
    if (!response.ok) throw httpError(response.status);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw invalidResponse();
    }
    const parsed = parsePage(payload);
    pages += 1;
    for (const bucket of parsed.data) {
      bucket.results.forEach((result, resultIndex) => records.push(normalizeResult({ bucket, result, page: pages, resultIndex, collectionId, queryIdentity: queryKey })));
    }
    page = parsed.next_page;
  } while (page);

  return {
    source: "openai_organization_costs",
    provider: "openai",
    status: records.length === 0 ? "confirmed_empty" : "available",
    collectionId,
    queryIdentity: queryKey,
    period: { startTime: request.startTime, endTime: request.endTime, bucketWidth: "1d", providerPeriodTimezone: "UTC", financialCompetence: null },
    groupBy: [...(request.groupBy || [])],
    pages,
    records,
  };
}
