import { createClient } from "@supabase/supabase-js";

const CREATE_AUTHORIZED_SALES_QUOTE_DRAFT_RPC =
  "create_authorized_sales_quote_draft_from_current_profile_by_system" as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

type RpcError = { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };

export type AuthorizedSalesQuoteDraftOperation = {
  authorizationId: string;
  organizationId: string;
  storeId: string;
  taskId: string;
  requestMessageId: string;
  queueId: string;
  operationId: string;
  commercialOpportunityId: string;
  profileVersionId: string;
  profileVersionNumber: number;
  creationIdempotencyKey: string;
  creationRequestFingerprint: string;
};

export type AuthorizedSalesQuoteDraftResult = {
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

export type AuthorizedSalesQuoteDraftSupabase = {
  rpc(functionName: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: RpcError | null;
  }>;
};

export class AuthorizedSalesQuoteDraftError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly kind: "input" | "rejected" | "uncertain",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AuthorizedSalesQuoteDraftError";
  }
}

function requireUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new AuthorizedSalesQuoteDraftError(code, code, "input");
  }
  return value.trim();
}

function requireText(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AuthorizedSalesQuoteDraftError(code, code, "input");
  }
  return value.trim();
}

function validateOperation(
  input: AuthorizedSalesQuoteDraftOperation,
): AuthorizedSalesQuoteDraftOperation {
  if (!Number.isSafeInteger(input?.profileVersionNumber) || input.profileVersionNumber < 1) {
    throw new AuthorizedSalesQuoteDraftError(
      "P19A_AUTHORIZED_QUOTE_DRAFT_PROFILE_VERSION_INVALID",
      "P19A_AUTHORIZED_QUOTE_DRAFT_PROFILE_VERSION_INVALID",
      "input",
    );
  }

  const fingerprint = requireText(
    input?.creationRequestFingerprint,
    "P19A_AUTHORIZED_QUOTE_DRAFT_FINGERPRINT_REQUIRED",
  );
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new AuthorizedSalesQuoteDraftError(
      "P19A_AUTHORIZED_QUOTE_DRAFT_FINGERPRINT_INVALID",
      "P19A_AUTHORIZED_QUOTE_DRAFT_FINGERPRINT_INVALID",
      "input",
    );
  }

  return {
    authorizationId: requireUuid(input?.authorizationId, "P19A_AUTHORIZED_QUOTE_DRAFT_AUTHORIZATION_ID_INVALID"),
    organizationId: requireUuid(input?.organizationId, "P19A_AUTHORIZED_QUOTE_DRAFT_ORGANIZATION_ID_INVALID"),
    storeId: requireUuid(input?.storeId, "P19A_AUTHORIZED_QUOTE_DRAFT_STORE_ID_INVALID"),
    taskId: requireUuid(input?.taskId, "P19A_AUTHORIZED_QUOTE_DRAFT_TASK_ID_INVALID"),
    requestMessageId: requireUuid(input?.requestMessageId, "P19A_AUTHORIZED_QUOTE_DRAFT_MESSAGE_ID_INVALID"),
    queueId: requireUuid(input?.queueId, "P19A_AUTHORIZED_QUOTE_DRAFT_QUEUE_ID_INVALID"),
    operationId: requireUuid(input?.operationId, "P19A_AUTHORIZED_QUOTE_DRAFT_OPERATION_ID_INVALID"),
    commercialOpportunityId: requireUuid(input?.commercialOpportunityId, "P19A_AUTHORIZED_QUOTE_DRAFT_OPPORTUNITY_ID_INVALID"),
    profileVersionId: requireUuid(input?.profileVersionId, "P19A_AUTHORIZED_QUOTE_DRAFT_PROFILE_VERSION_ID_INVALID"),
    profileVersionNumber: input.profileVersionNumber,
    creationIdempotencyKey: requireText(input?.creationIdempotencyKey, "P19A_AUTHORIZED_QUOTE_DRAFT_IDEMPOTENCY_KEY_REQUIRED"),
    creationRequestFingerprint: fingerprint,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseResult(
  data: unknown,
  operation: AuthorizedSalesQuoteDraftOperation,
): AuthorizedSalesQuoteDraftResult {
  if (!isRecord(data) || (data.outcome !== "created" && data.outcome !== "idempotent_replay")) {
    throw new AuthorizedSalesQuoteDraftError(
      "A autoridade autorizada de criacao retornou um resultado invalido.",
      "P19A_AUTHORIZED_QUOTE_DRAFT_RPC_RESULT_INVALID",
      "uncertain",
    );
  }

  const profileVersionNumber = data.profile_version_number;
  const itemCount = data.item_count;
  if (
    typeof data.operation_id !== "string" ||
    !UUID_PATTERN.test(data.operation_id) ||
    data.operation_id !== operation.operationId ||
    typeof data.quote_id !== "string" ||
    !UUID_PATTERN.test(data.quote_id) ||
    data.organization_id !== operation.organizationId ||
    data.store_id !== operation.storeId ||
    data.commercial_opportunity_id !== operation.commercialOpportunityId ||
    data.profile_version_id !== operation.profileVersionId ||
    !Number.isSafeInteger(profileVersionNumber) ||
    profileVersionNumber !== operation.profileVersionNumber ||
    typeof data.quote_status !== "string" ||
    !data.quote_status.trim() ||
    typeof itemCount !== "number" ||
    !Number.isSafeInteger(itemCount) ||
    itemCount <= 0
  ) {
    throw new AuthorizedSalesQuoteDraftError(
      "A autoridade autorizada de criacao retornou dados fora do escopo ou incompletos.",
      "P19A_AUTHORIZED_QUOTE_DRAFT_RPC_RESULT_SCOPE_INVALID",
      "uncertain",
    );
  }

  if (data.quote_number !== undefined && (typeof data.quote_number !== "string" || !data.quote_number.trim())) {
    throw new AuthorizedSalesQuoteDraftError(
      "A autoridade autorizada de criacao retornou um numero invalido.",
      "P19A_AUTHORIZED_QUOTE_DRAFT_RPC_QUOTE_NUMBER_INVALID",
      "uncertain",
    );
  }

  return {
    outcome: data.outcome,
    operationId: data.operation_id,
    quoteId: data.quote_id,
    organizationId: operation.organizationId,
    storeId: operation.storeId,
    commercialOpportunityId: operation.commercialOpportunityId,
    profileVersionId: operation.profileVersionId,
    profileVersionNumber,
    quoteStatus: data.quote_status,
    quoteNumber: typeof data.quote_number === "string" ? data.quote_number : undefined,
    itemCount,
  };
}

function createServiceRoleClient(): AuthorizedSalesQuoteDraftSupabase {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new AuthorizedSalesQuoteDraftError(
      "SUPABASE_SERVICE_ROLE_ENV_MISSING",
      "SUPABASE_SERVICE_ROLE_ENV_MISSING",
      "input",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as AuthorizedSalesQuoteDraftSupabase;
}

export async function createAuthorizedSalesQuoteDraftBySystem(args: {
  operation: AuthorizedSalesQuoteDraftOperation;
  supabase?: AuthorizedSalesQuoteDraftSupabase;
}): Promise<AuthorizedSalesQuoteDraftResult> {
  const operation = validateOperation(args?.operation);
  const supabase = args?.supabase ?? createServiceRoleClient();
  let response: { data: unknown; error: RpcError | null };

  try {
    response = await supabase.rpc(CREATE_AUTHORIZED_SALES_QUOTE_DRAFT_RPC, {
      p_authorization_id: operation.authorizationId,
      p_organization_id: operation.organizationId,
      p_store_id: operation.storeId,
      p_task_id: operation.taskId,
      p_request_message_id: operation.requestMessageId,
      p_queue_id: operation.queueId,
      p_operation_id: operation.operationId,
      p_commercial_opportunity_id: operation.commercialOpportunityId,
      p_profile_version_id: operation.profileVersionId,
      p_profile_version_number: operation.profileVersionNumber,
      p_creation_idempotency_key: operation.creationIdempotencyKey,
      p_creation_request_fingerprint: operation.creationRequestFingerprint,
    });
  } catch (error) {
    throw new AuthorizedSalesQuoteDraftError(
      "A autoridade autorizada de criacao nao confirmou o resultado; o estado permanece incerto.",
      "P19A_AUTHORIZED_QUOTE_DRAFT_RPC_UNCERTAIN",
      "uncertain",
      error,
    );
  }

  if (response.error) {
    const code = typeof response.error.code === "string"
      ? response.error.code
      : "P19A_AUTHORIZED_QUOTE_DRAFT_RPC_REJECTED";
    throw new AuthorizedSalesQuoteDraftError(
      typeof response.error.message === "string" ? response.error.message : "A autoridade autorizada rejeitou a operacao.",
      code,
      "rejected",
      response.error,
    );
  }

  return parseResult(response.data, operation);
}
