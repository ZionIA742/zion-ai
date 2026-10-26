import type {
  OpenAiOrganizationCostsGroupBy,
  OpenAiOrganizationCostsRequest,
} from "./openai-organization-costs-collector";

const PREFIX = "openai_organization_costs:v1:";

const GROUP_BY = [
  "project_id",
  "user_id",
  "line_item",
  "api_key_id",
  "api_source",
] as const;

const REQUEST_KEYS = new Set([
  "startTime",
  "endTime",
  "groupBy",
  "projectIds",
  "apiKeyIds",
  "lineItems",
  "limit",
]);

export type OpenAiCostQueryParameters = {
  start_time: number;
  end_time: number;
  bucket_width: "1d";
  group_by: OpenAiOrganizationCostsGroupBy[];
  project_ids?: string[];
  api_key_ids?: string[];
  line_items?: string[];
  limit?: number;
  query_identity: string;
  financial_competence: null;
};

export type OpenAiCostQueryContract = {
  queryIdentity: string;
  queryParameters: OpenAiCostQueryParameters;
  periodStart: string;
  periodEnd: string;
  costsRequest: OpenAiOrganizationCostsRequest;
};

export class OpenAiCostQueryContractError extends Error {
  readonly code = "OPENAI_COST_QUERY_CONTRACT_INVALID";

  constructor() {
    super("OPENAI_COST_QUERY_CONTRACT_INVALID");
    this.name = "OpenAiCostQueryContractError";
  }
}

function invalid(): never {
  throw new OpenAiCostQueryContractError();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function validUnix(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    Number.isFinite(new Date(value * 1000).getTime());
}

function canonicalList(
  value: unknown,
  allowed?: readonly string[],
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid();

  const values: string[] = [];

  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.length === 0 ||
      item !== item.trim() ||
      (allowed && !allowed.includes(item))
    ) {
      invalid();
    }

    values.push(item);
  }

  if (new Set(values).size !== values.length) invalid();

  return values.sort();
}

/**
 * Builds a canonical identity and SQL query parameters.
 * Does not access the provider, database or financial ledger.
 */
export function buildOpenAiCostQueryContract(
  request: OpenAiOrganizationCostsRequest,
): OpenAiCostQueryContract {
  if (!isObject(request)) invalid();

  for (const key of Object.keys(request)) {
    if (!REQUEST_KEYS.has(key)) invalid();
  }

  if (
    !validUnix(request.startTime) ||
    !validUnix(request.endTime) ||
    request.startTime >= request.endTime
  ) {
    invalid();
  }

  const groupBy = canonicalList(
    request.groupBy,
    GROUP_BY,
  ) as OpenAiOrganizationCostsGroupBy[];

  const projectIds = canonicalList(request.projectIds);
  const apiKeyIds = canonicalList(request.apiKeyIds);
  const lineItems = canonicalList(request.lineItems);

  if (
    request.limit !== undefined &&
    (!Number.isSafeInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 180)
  ) {
    invalid();
  }

  const query = new URLSearchParams();
  query.set("start_time", String(request.startTime));
  query.set("end_time", String(request.endTime));
  query.set("bucket_width", "1d");

  if (request.limit !== undefined) {
    query.set("limit", String(request.limit));
  }

  for (const value of groupBy) {
    query.append("group_by", value);
  }

  for (const value of projectIds) {
    query.append("project_ids", value);
  }

  for (const value of apiKeyIds) {
    query.append("api_key_ids", value);
  }

  for (const value of lineItems) {
    query.append("line_items", value);
  }

  const queryIdentity = PREFIX + query.toString();

  const queryParameters: OpenAiCostQueryParameters = {
    start_time: request.startTime,
    end_time: request.endTime,
    bucket_width: "1d",
    group_by: groupBy,
    query_identity: queryIdentity,
    financial_competence: null,
  };

  if (projectIds.length > 0) {
    queryParameters.project_ids = projectIds;
  }

  if (apiKeyIds.length > 0) {
    queryParameters.api_key_ids = apiKeyIds;
  }

  if (lineItems.length > 0) {
    queryParameters.line_items = lineItems;
  }

  if (request.limit !== undefined) {
    queryParameters.limit = request.limit;
  }

  const costsRequest: OpenAiOrganizationCostsRequest = {
    startTime: request.startTime,
    endTime: request.endTime,
    groupBy: [...groupBy],
  };

  if (projectIds.length > 0) {
    costsRequest.projectIds = [...projectIds];
  }

  if (apiKeyIds.length > 0) {
    costsRequest.apiKeyIds = [...apiKeyIds];
  }

  if (lineItems.length > 0) {
    costsRequest.lineItems = [...lineItems];
  }

  if (request.limit !== undefined) {
    costsRequest.limit = request.limit;
  }

  return {
    queryIdentity,
    queryParameters,
    periodStart: new Date(
      request.startTime * 1000,
    ).toISOString(),
    periodEnd: new Date(
      request.endTime * 1000,
    ).toISOString(),
    costsRequest,
  };
}

/**
 * Reconstructs a claimed query without substituting
 * new request parameters or silently discarding filters.
 */
export function parseOpenAiCostQueryContract(
  identity: unknown,
  parameters: unknown,
): OpenAiCostQueryContract {
  if (
    typeof identity !== "string" ||
    !identity.startsWith(PREFIX) ||
    !isObject(parameters) ||
    !validUnix(parameters.start_time) ||
    !validUnix(parameters.end_time) ||
    !Array.isArray(parameters.group_by) ||
    parameters.bucket_width !== "1d" ||
    parameters.financial_competence !== null ||
    parameters.query_identity !== identity
  ) {
    invalid();
  }

  const request: OpenAiOrganizationCostsRequest = {
    startTime: parameters.start_time,
    endTime: parameters.end_time,
    groupBy:
      parameters.group_by as OpenAiOrganizationCostsGroupBy[],
  };

  if ("project_ids" in parameters) {
    request.projectIds = parameters.project_ids as string[];
  }

  if ("api_key_ids" in parameters) {
    request.apiKeyIds = parameters.api_key_ids as string[];
  }

  if ("line_items" in parameters) {
    request.lineItems = parameters.line_items as string[];
  }

  if ("limit" in parameters) {
    request.limit = parameters.limit as number;
  }

  const expected = buildOpenAiCostQueryContract(request);

  if (expected.queryIdentity !== identity) invalid();

  const received = parameters as Record<string, unknown>;
  const canonical =
    expected.queryParameters as Record<string, unknown>;

  const receivedKeys = Object.keys(received).sort();
  const canonicalKeys = Object.keys(canonical).sort();

  if (
    JSON.stringify(receivedKeys) !==
    JSON.stringify(canonicalKeys)
  ) {
    invalid();
  }

  for (const key of canonicalKeys) {
    if (
      JSON.stringify(received[key]) !==
      JSON.stringify(canonical[key])
    ) {
      invalid();
    }
  }

  return expected;
}
