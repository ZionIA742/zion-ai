import { createClient } from "@supabase/supabase-js";

const CREATE_SALES_QUOTE_DRAFT_RPC =
  "create_sales_quote_draft_from_current_profile_by_system" as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

type RpcError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

export type SalesQuoteDraftOperation = {
  operationId: string;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  profileVersionId: string;
  profileVersionNumber: number;
  creationIdempotencyKey: string;
  creationRequestFingerprint: string;
};

export type SalesQuoteDraftWriterResult = {
  outcome: "created" | "idempotent_replay";
  operationId: string;
  quoteId: string;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  profileVersionId: string;
  profileVersionNumber: number;
  quoteStatus: string;
  quoteNumber?: string;
  itemCount: number;
};

export type SalesQuoteDraftWriterSupabase = {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
};

export class SalesQuoteDraftWriterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly kind: "input" | "rejected" | "uncertain",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SalesQuoteDraftWriterError";
  }
}

function requireUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new SalesQuoteDraftWriterError(code, code, "input");
  }
  return value.trim();
}

function requireText(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SalesQuoteDraftWriterError(code, code, "input");
  }
  return value.trim();
}

function validateOperation(operation: SalesQuoteDraftOperation): SalesQuoteDraftOperation {
  const profileVersionNumber = operation?.profileVersionNumber;
  if (
    !Number.isSafeInteger(profileVersionNumber) ||
    profileVersionNumber < 1
  ) {
    throw new SalesQuoteDraftWriterError(
      "P19A_QUOTE_DRAFT_PROFILE_VERSION_INVALID",
      "P19A_QUOTE_DRAFT_PROFILE_VERSION_INVALID",
      "input",
    );
  }

  const requestFingerprint = requireText(
    operation?.creationRequestFingerprint,
    "P19A_QUOTE_DRAFT_FINGERPRINT_REQUIRED",
  );
  if (!FINGERPRINT_PATTERN.test(requestFingerprint)) {
    throw new SalesQuoteDraftWriterError(
      "P19A_QUOTE_DRAFT_FINGERPRINT_INVALID",
      "P19A_QUOTE_DRAFT_FINGERPRINT_INVALID",
      "input",
    );
  }

  return {
    operationId: requireUuid(operation?.operationId, "P19A_QUOTE_DRAFT_OPERATION_ID_INVALID"),
    organizationId: requireUuid(
      operation?.organizationId,
      "P19A_QUOTE_DRAFT_ORGANIZATION_ID_INVALID",
    ),
    storeId: requireUuid(operation?.storeId, "P19A_QUOTE_DRAFT_STORE_ID_INVALID"),
    commercialOpportunityId: requireUuid(
      operation?.commercialOpportunityId,
      "P19A_QUOTE_DRAFT_OPPORTUNITY_ID_INVALID",
    ),
    profileVersionId: requireUuid(
      operation?.profileVersionId,
      "P19A_QUOTE_DRAFT_PROFILE_VERSION_ID_INVALID",
    ),
    profileVersionNumber,
    creationIdempotencyKey: requireText(
      operation?.creationIdempotencyKey,
      "P19A_QUOTE_DRAFT_IDEMPOTENCY_KEY_REQUIRED",
    ),
    creationRequestFingerprint: requestFingerprint,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseResult(
  data: unknown,
  operation: SalesQuoteDraftOperation,
): SalesQuoteDraftWriterResult {
  if (!isRecord(data)) {
    throw new SalesQuoteDraftWriterError(
      "A autoridade de criacao retornou um resultado invalido.",
      "P19A_QUOTE_DRAFT_RPC_RESULT_INVALID",
      "uncertain",
    );
  }

  const outcome = data.outcome;
  const operationId = data.operation_id;
  const quoteId = data.quote_id;
  const itemCount = data.item_count;
  const profileVersionNumber = data.profile_version_number;
  const quoteStatus = data.quote_status;

  if (outcome !== "created" && outcome !== "idempotent_replay") {
    throw new SalesQuoteDraftWriterError(
      "A autoridade de criacao retornou um outcome invalido.",
      "P19A_QUOTE_DRAFT_RPC_OUTCOME_INVALID",
      "uncertain",
    );
  }

  if (
    typeof operationId !== "string" ||
    !UUID_PATTERN.test(operationId) ||
    operationId !== operation.operationId ||
    typeof quoteId !== "string" ||
    !UUID_PATTERN.test(quoteId) ||
    data.organization_id !== operation.organizationId ||
    data.store_id !== operation.storeId ||
    data.commercial_opportunity_id !== operation.commercialOpportunityId ||
    data.profile_version_id !== operation.profileVersionId ||
    !Number.isSafeInteger(profileVersionNumber) ||
    profileVersionNumber !== operation.profileVersionNumber ||
    typeof quoteStatus !== "string" ||
    typeof itemCount !== "number" ||
    !Number.isSafeInteger(itemCount) ||
    itemCount <= 0
  ) {
    throw new SalesQuoteDraftWriterError(
      "A autoridade de criacao retornou dados fora do escopo ou incompletos.",
      "P19A_QUOTE_DRAFT_RPC_RESULT_SCOPE_INVALID",
      "uncertain",
    );
  }

  if (
    data.quote_number !== undefined &&
    (typeof data.quote_number !== "string" || !data.quote_number.trim())
  ) {
    throw new SalesQuoteDraftWriterError(
      "A autoridade de criacao retornou um numero de orcamento invalido.",
      "P19A_QUOTE_DRAFT_RPC_QUOTE_NUMBER_INVALID",
      "uncertain",
    );
  }

  return {
    outcome,
    operationId,
    quoteId,
    organizationId: operation.organizationId,
    storeId: operation.storeId,
    commercialOpportunityId: operation.commercialOpportunityId,
    profileVersionId: operation.profileVersionId,
    profileVersionNumber,
    quoteStatus,
    quoteNumber: typeof data.quote_number === "string" ? data.quote_number : undefined,
    itemCount,
  };
}

function createServiceRoleClient(): SalesQuoteDraftWriterSupabase {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new SalesQuoteDraftWriterError(
      "SUPABASE_SERVICE_ROLE_ENV_MISSING",
      "SUPABASE_SERVICE_ROLE_ENV_MISSING",
      "input",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SalesQuoteDraftWriterSupabase;
}

export async function createSalesQuoteDraftBySystem(args: {
  operation: SalesQuoteDraftOperation;
  supabase?: SalesQuoteDraftWriterSupabase;
}): Promise<SalesQuoteDraftWriterResult> {
  const operation = validateOperation(args?.operation);
  const supabase = args?.supabase ?? createServiceRoleClient();

  let response: { data: unknown; error: RpcError | null };
  try {
    response = await supabase.rpc(CREATE_SALES_QUOTE_DRAFT_RPC, {
      p_operation_id: operation.operationId,
      p_organization_id: operation.organizationId,
      p_store_id: operation.storeId,
      p_commercial_opportunity_id: operation.commercialOpportunityId,
      p_profile_version_id: operation.profileVersionId,
      p_profile_version_number: operation.profileVersionNumber,
      p_creation_idempotency_key: operation.creationIdempotencyKey,
      p_creation_request_fingerprint: operation.creationRequestFingerprint,
    });
  } catch (error) {
    throw new SalesQuoteDraftWriterError(
      "A autoridade de criacao nao confirmou o resultado; o estado permanece incerto.",
      "P19A_QUOTE_DRAFT_RPC_UNCERTAIN",
      "uncertain",
      error,
    );
  }

  if (response.error) {
    const code = typeof response.error.code === "string"
      ? response.error.code
      : "P19A_QUOTE_DRAFT_RPC_REJECTED";
    throw new SalesQuoteDraftWriterError(
      typeof response.error.message === "string"
        ? response.error.message
        : "A autoridade de criacao rejeitou a operacao.",
      code,
      "rejected",
      response.error,
    );
  }

  return parseResult(response.data, operation);
}
