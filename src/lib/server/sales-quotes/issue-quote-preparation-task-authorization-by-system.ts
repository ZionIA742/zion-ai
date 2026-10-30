import { createClient } from "@supabase/supabase-js";

const ISSUE_QUOTE_PREPARATION_AUTHORIZATION_RPC =
  "issue_quote_preparation_task_authorization_by_system" as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

export type QuotePreparationTaskAuthorizationOutcome =
  | "created"
  | "idempotent_replay"
  | "blocked";

export type QuotePreparationTaskAuthorizationResult = {
  outcome: QuotePreparationTaskAuthorizationOutcome;
  authorizationId: string;
  organizationId: string;
  storeId: string;
  taskId: string;
  requestMessageId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  reason?: "authorization_expired" | "authorization_revoked";
};

export type QuotePreparationTaskAuthorizationSupabase = {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
};

export class QuotePreparationTaskAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly kind: "input" | "rejected" | "uncertain",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "QuotePreparationTaskAuthorizationError";
  }
}

function requireUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new QuotePreparationTaskAuthorizationError(code, code, "input");
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireResultUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new QuotePreparationTaskAuthorizationError(code, code, "uncertain");
  }
  return value.trim();
}

function requireTimestamp(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new QuotePreparationTaskAuthorizationError(code, code, "uncertain");
  }
  return value;
}

function parseResult(
  data: unknown,
  identity: {
    organizationId: string;
    storeId: string;
    taskId: string;
    requestMessageId: string;
  },
): QuotePreparationTaskAuthorizationResult {
  if (!isRecord(data)) {
    throw new QuotePreparationTaskAuthorizationError(
      "P19A_QUOTE_PREP_AUTH_RPC_RESULT_INVALID",
      "P19A_QUOTE_PREP_AUTH_RPC_RESULT_INVALID",
      "uncertain",
    );
  }

  const outcome = data.outcome;
  if (
    outcome !== "created" &&
    outcome !== "idempotent_replay" &&
    outcome !== "blocked"
  ) {
    throw new QuotePreparationTaskAuthorizationError(
      "P19A_QUOTE_PREP_AUTH_RPC_OUTCOME_INVALID",
      "P19A_QUOTE_PREP_AUTH_RPC_OUTCOME_INVALID",
      "uncertain",
    );
  }

  const authorizationId = requireResultUuid(
    data.authorization_id,
    "P19A_QUOTE_PREP_AUTH_RESULT_ID_INVALID",
  );
  const organizationId = requireResultUuid(
    data.organization_id,
    "P19A_QUOTE_PREP_AUTH_RESULT_ORGANIZATION_INVALID",
  );
  const storeId = requireResultUuid(
    data.store_id,
    "P19A_QUOTE_PREP_AUTH_RESULT_STORE_INVALID",
  );
  const taskId = requireResultUuid(
    data.task_id,
    "P19A_QUOTE_PREP_AUTH_RESULT_TASK_INVALID",
  );
  const requestMessageId = requireResultUuid(
    data.request_message_id,
    "P19A_QUOTE_PREP_AUTH_RESULT_MESSAGE_INVALID",
  );

  if (
    organizationId !== identity.organizationId ||
    storeId !== identity.storeId ||
    taskId !== identity.taskId ||
    requestMessageId !== identity.requestMessageId
  ) {
    throw new QuotePreparationTaskAuthorizationError(
      "P19A_QUOTE_PREP_AUTH_RESULT_SCOPE_INVALID",
      "P19A_QUOTE_PREP_AUTH_RESULT_SCOPE_INVALID",
      "uncertain",
    );
  }

  const issuedAt = requireTimestamp(
    data.issued_at,
    "P19A_QUOTE_PREP_AUTH_RESULT_ISSUED_AT_INVALID",
  );
  const expiresAt = requireTimestamp(
    data.expires_at,
    "P19A_QUOTE_PREP_AUTH_RESULT_EXPIRES_AT_INVALID",
  );

  if (outcome === "blocked") {
    if (
      data.reason !== "authorization_expired" &&
      data.reason !== "authorization_revoked"
    ) {
      throw new QuotePreparationTaskAuthorizationError(
        "P19A_QUOTE_PREP_AUTH_BLOCKED_RESULT_INVALID",
        "P19A_QUOTE_PREP_AUTH_BLOCKED_RESULT_INVALID",
        "uncertain",
      );
    }

    if (data.revoked_at !== undefined && data.revoked_at !== null) {
      requireTimestamp(
        data.revoked_at,
        "P19A_QUOTE_PREP_AUTH_RESULT_REVOKED_AT_INVALID",
      );
    }

    return {
      outcome,
      authorizationId,
      organizationId,
      storeId,
      taskId,
      requestMessageId,
      issuedAt,
      expiresAt,
      revokedAt: typeof data.revoked_at === "string" ? data.revoked_at : null,
      reason: data.reason,
    };
  }

  return {
    outcome,
    authorizationId,
    organizationId,
    storeId,
    taskId,
    requestMessageId,
    issuedAt,
    expiresAt,
  };
}

function createServiceRoleClient(): QuotePreparationTaskAuthorizationSupabase {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new QuotePreparationTaskAuthorizationError(
      "SUPABASE_SERVICE_ROLE_ENV_MISSING",
      "SUPABASE_SERVICE_ROLE_ENV_MISSING",
      "input",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as QuotePreparationTaskAuthorizationSupabase;
}

export async function issueQuotePreparationTaskAuthorizationBySystem(args: {
  organizationId: string;
  storeId: string;
  taskId: string;
  requestMessageId: string;
  supabase?: QuotePreparationTaskAuthorizationSupabase;
}): Promise<QuotePreparationTaskAuthorizationResult> {
  const identity = {
    organizationId: requireUuid(
      args?.organizationId,
      "P19A_QUOTE_PREP_AUTH_ORGANIZATION_ID_INVALID",
    ),
    storeId: requireUuid(args?.storeId, "P19A_QUOTE_PREP_AUTH_STORE_ID_INVALID"),
    taskId: requireUuid(args?.taskId, "P19A_QUOTE_PREP_AUTH_TASK_ID_INVALID"),
    requestMessageId: requireUuid(
      args?.requestMessageId,
      "P19A_QUOTE_PREP_AUTH_REQUEST_MESSAGE_ID_INVALID",
    ),
  };

  const supabase = args?.supabase ?? createServiceRoleClient();
  let response: { data: unknown; error: RpcError | null };

  try {
    response = await supabase.rpc(ISSUE_QUOTE_PREPARATION_AUTHORIZATION_RPC, {
      p_organization_id: identity.organizationId,
      p_store_id: identity.storeId,
      p_task_id: identity.taskId,
      p_request_message_id: identity.requestMessageId,
    });
  } catch (error) {
    throw new QuotePreparationTaskAuthorizationError(
      "A autoridade de autorizacao nao confirmou o resultado; o estado permanece incerto.",
      "P19A_QUOTE_PREP_AUTH_RPC_UNCERTAIN",
      "uncertain",
      error,
    );
  }

  if (response.error) {
    const code = typeof response.error.code === "string"
      ? response.error.code
      : "P19A_QUOTE_PREP_AUTH_RPC_REJECTED";
    throw new QuotePreparationTaskAuthorizationError(
      typeof response.error.message === "string"
        ? response.error.message
        : "A autoridade de autorizacao rejeitou a emissao.",
      code,
      "rejected",
      response.error,
    );
  }

  return parseResult(response.data, identity);
}
