import { createClient } from "@supabase/supabase-js";

const VALIDATE_QUOTE_PREPARATION_AUTHORIZATION_RPC =
  "validate_quote_preparation_task_authorization_by_system" as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

export type QuotePreparationTaskAuthorizationValidationResult = {
  outcome: "authorized" | "blocked";
  reason: string;
  organizationId: string;
  storeId: string;
  taskId: string;
  requestMessageId: string;
  queueId: string;
  authorizationId?: string;
  expiresAt?: string;
  taskStatus?: string;
  queueStatus?: string;
  aiCanGenerateQuote?: true;
};

export type QuotePreparationTaskAuthorizationValidationSupabase = {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
};

export class QuotePreparationTaskAuthorizationValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly kind: "input" | "rejected" | "uncertain",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "QuotePreparationTaskAuthorizationValidationError";
  }
}

function requireUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new QuotePreparationTaskAuthorizationValidationError(code, code, "input");
  }
  return value.trim();
}

function requireResultUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new QuotePreparationTaskAuthorizationValidationError(code, code, "uncertain");
  }
  return value.trim();
}

function requireResultText(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new QuotePreparationTaskAuthorizationValidationError(code, code, "uncertain");
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseResult(
  data: unknown,
  identity: {
    organizationId: string;
    storeId: string;
    taskId: string;
    requestMessageId: string;
    queueId: string;
  },
): QuotePreparationTaskAuthorizationValidationResult {
  if (!isRecord(data)) {
    throw new QuotePreparationTaskAuthorizationValidationError(
      "P19A_QUOTE_PREP_VALIDATION_RPC_RESULT_INVALID",
      "P19A_QUOTE_PREP_VALIDATION_RPC_RESULT_INVALID",
      "uncertain",
    );
  }

  if (data.outcome !== "authorized" && data.outcome !== "blocked") {
    throw new QuotePreparationTaskAuthorizationValidationError(
      "P19A_QUOTE_PREP_VALIDATION_RPC_OUTCOME_INVALID",
      "P19A_QUOTE_PREP_VALIDATION_RPC_OUTCOME_INVALID",
      "uncertain",
    );
  }

  const resultIdentity = {
    organizationId: requireResultUuid(
      data.organization_id,
      "P19A_QUOTE_PREP_VALIDATION_RESULT_ORGANIZATION_INVALID",
    ),
    storeId: requireResultUuid(
      data.store_id,
      "P19A_QUOTE_PREP_VALIDATION_RESULT_STORE_INVALID",
    ),
    taskId: requireResultUuid(
      data.task_id,
      "P19A_QUOTE_PREP_VALIDATION_RESULT_TASK_INVALID",
    ),
    requestMessageId: requireResultUuid(
      data.request_message_id,
      "P19A_QUOTE_PREP_VALIDATION_RESULT_MESSAGE_INVALID",
    ),
    queueId: requireResultUuid(
      data.queue_id,
      "P19A_QUOTE_PREP_VALIDATION_RESULT_QUEUE_INVALID",
    ),
  };

  if (
    resultIdentity.organizationId !== identity.organizationId ||
    resultIdentity.storeId !== identity.storeId ||
    resultIdentity.taskId !== identity.taskId ||
    resultIdentity.requestMessageId !== identity.requestMessageId ||
    resultIdentity.queueId !== identity.queueId
  ) {
    throw new QuotePreparationTaskAuthorizationValidationError(
      "P19A_QUOTE_PREP_VALIDATION_RESULT_SCOPE_INVALID",
      "P19A_QUOTE_PREP_VALIDATION_RESULT_SCOPE_INVALID",
      "uncertain",
    );
  }

  const reason = requireResultText(
    data.reason,
    "P19A_QUOTE_PREP_VALIDATION_RESULT_REASON_INVALID",
  );

  if (data.outcome === "blocked") {
    return { outcome: "blocked", reason, ...identity };
  }

  const authorizationId = requireResultUuid(
    data.authorization_id,
    "P19A_QUOTE_PREP_VALIDATION_RESULT_AUTHORIZATION_INVALID",
  );
  const expiresAt = requireResultText(
    data.expires_at,
    "P19A_QUOTE_PREP_VALIDATION_RESULT_EXPIRES_AT_INVALID",
  );
  const taskStatus = requireResultText(
    data.task_status,
    "P19A_QUOTE_PREP_VALIDATION_RESULT_TASK_STATUS_INVALID",
  );
  const queueStatus = requireResultText(
    data.queue_status,
    "P19A_QUOTE_PREP_VALIDATION_RESULT_QUEUE_STATUS_INVALID",
  );

  if (data.ai_can_generate_quote !== true) {
    throw new QuotePreparationTaskAuthorizationValidationError(
      "P19A_QUOTE_PREP_VALIDATION_RESULT_SETTINGS_INVALID",
      "P19A_QUOTE_PREP_VALIDATION_RESULT_SETTINGS_INVALID",
      "uncertain",
    );
  }

  return {
    outcome: "authorized",
    reason,
    ...identity,
    authorizationId,
    expiresAt,
    taskStatus,
    queueStatus,
    aiCanGenerateQuote: true,
  };
}

function createServiceRoleClient(): QuotePreparationTaskAuthorizationValidationSupabase {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new QuotePreparationTaskAuthorizationValidationError(
      "SUPABASE_SERVICE_ROLE_ENV_MISSING",
      "SUPABASE_SERVICE_ROLE_ENV_MISSING",
      "input",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as QuotePreparationTaskAuthorizationValidationSupabase;
}

export async function validateQuotePreparationTaskAuthorizationBySystem(args: {
  organizationId: string;
  storeId: string;
  taskId: string;
  requestMessageId: string;
  queueId: string;
  supabase?: QuotePreparationTaskAuthorizationValidationSupabase;
}): Promise<QuotePreparationTaskAuthorizationValidationResult> {
  const identity = {
    organizationId: requireUuid(
      args?.organizationId,
      "P19A_QUOTE_PREP_VALIDATION_ORGANIZATION_ID_INVALID",
    ),
    storeId: requireUuid(
      args?.storeId,
      "P19A_QUOTE_PREP_VALIDATION_STORE_ID_INVALID",
    ),
    taskId: requireUuid(args?.taskId, "P19A_QUOTE_PREP_VALIDATION_TASK_ID_INVALID"),
    requestMessageId: requireUuid(
      args?.requestMessageId,
      "P19A_QUOTE_PREP_VALIDATION_REQUEST_MESSAGE_ID_INVALID",
    ),
    queueId: requireUuid(args?.queueId, "P19A_QUOTE_PREP_VALIDATION_QUEUE_ID_INVALID"),
  };

  const supabase = args?.supabase ?? createServiceRoleClient();
  let response: { data: unknown; error: RpcError | null };

  try {
    response = await supabase.rpc(VALIDATE_QUOTE_PREPARATION_AUTHORIZATION_RPC, {
      p_organization_id: identity.organizationId,
      p_store_id: identity.storeId,
      p_task_id: identity.taskId,
      p_request_message_id: identity.requestMessageId,
      p_queue_id: identity.queueId,
    });
  } catch (error) {
    throw new QuotePreparationTaskAuthorizationValidationError(
      "A autoridade de validacao nao confirmou o resultado; o processamento permanece incerto.",
      "P19A_QUOTE_PREP_VALIDATION_RPC_UNCERTAIN",
      "uncertain",
      error,
    );
  }

  if (response.error) {
    const code = typeof response.error.code === "string"
      ? response.error.code
      : "P19A_QUOTE_PREP_VALIDATION_RPC_REJECTED";
    throw new QuotePreparationTaskAuthorizationValidationError(
      typeof response.error.message === "string"
        ? response.error.message
        : "A autoridade de validacao rejeitou a consulta.",
      code,
      "rejected",
      response.error,
    );
  }

  return parseResult(response.data, identity);
}
