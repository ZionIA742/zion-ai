import { createClient } from "@supabase/supabase-js";

const REGISTER_QUOTE_PREPARATION_RPC =
  "register_quote_preparation_operation_by_system" as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const OPERATION_STATUSES = new Set([
  "queued",
  "processing",
  "blocked",
  "failed",
  "uncertain",
  "completed",
]);

type RpcError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

export type QuotePreparationRegistration = {
  organizationId: string;
  storeId: string;
  leadId: string;
  conversationId: string;
  commercialOpportunityId: string;
  requestMessageId: string;
  profileVersionId: string;
  profileVersionNumber: number;
  operationKey: string;
  requestFingerprint: string;
};

export type QuotePreparationRegistrationResult = QuotePreparationRegistration & {
  outcome: "created" | "idempotent_replay" | "blocked";
  operationId: string | null;
  status: "queued" | "processing" | "blocked" | "failed" | "uncertain" | "completed";
  reason?: "active_preparation_exists";
};

export type QuotePreparationRegistrationSupabase = {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
};

export class QuotePreparationRegistrationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly kind: "input" | "rejected" | "uncertain",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "QuotePreparationRegistrationError";
  }
}

function requireUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new QuotePreparationRegistrationError(code, code, "input");
  }
  return value.trim();
}

function requireOperationKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new QuotePreparationRegistrationError(
      "P19A_QUOTE_PREP_OPERATION_KEY_REQUIRED",
      "P19A_QUOTE_PREP_OPERATION_KEY_REQUIRED",
      "input",
    );
  }
  const operationKey = value.trim();
  if (operationKey.length < 1 || operationKey.length > 200) {
    throw new QuotePreparationRegistrationError(
      "P19A_QUOTE_PREP_OPERATION_KEY_INVALID",
      "P19A_QUOTE_PREP_OPERATION_KEY_INVALID",
      "input",
    );
  }
  return operationKey;
}

function requireFingerprint(value: unknown): string {
  if (typeof value !== "string" || !FINGERPRINT_PATTERN.test(value)) {
    throw new QuotePreparationRegistrationError(
      "P19A_QUOTE_PREP_FINGERPRINT_INVALID",
      "P19A_QUOTE_PREP_FINGERPRINT_INVALID",
      "input",
    );
  }
  return value;
}

function validateRegistration(
  registration: QuotePreparationRegistration,
): QuotePreparationRegistration {
  if (
    !Number.isSafeInteger(registration?.profileVersionNumber) ||
    registration.profileVersionNumber < 1
  ) {
    throw new QuotePreparationRegistrationError(
      "P19A_QUOTE_PREP_PROFILE_VERSION_INVALID",
      "P19A_QUOTE_PREP_PROFILE_VERSION_INVALID",
      "input",
    );
  }

  return {
    organizationId: requireUuid(
      registration?.organizationId,
      "P19A_QUOTE_PREP_ORGANIZATION_ID_INVALID",
    ),
    storeId: requireUuid(registration?.storeId, "P19A_QUOTE_PREP_STORE_ID_INVALID"),
    leadId: requireUuid(registration?.leadId, "P19A_QUOTE_PREP_LEAD_ID_INVALID"),
    conversationId: requireUuid(
      registration?.conversationId,
      "P19A_QUOTE_PREP_CONVERSATION_ID_INVALID",
    ),
    commercialOpportunityId: requireUuid(
      registration?.commercialOpportunityId,
      "P19A_QUOTE_PREP_OPPORTUNITY_ID_INVALID",
    ),
    requestMessageId: requireUuid(
      registration?.requestMessageId,
      "P19A_QUOTE_PREP_REQUEST_MESSAGE_ID_INVALID",
    ),
    profileVersionId: requireUuid(
      registration?.profileVersionId,
      "P19A_QUOTE_PREP_PROFILE_VERSION_ID_INVALID",
    ),
    profileVersionNumber: registration.profileVersionNumber,
    operationKey: requireOperationKey(registration?.operationKey),
    requestFingerprint: requireFingerprint(registration?.requestFingerprint),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireStatus(value: unknown): QuotePreparationRegistrationResult["status"] {
  if (typeof value !== "string" || !OPERATION_STATUSES.has(value)) {
    throw new QuotePreparationRegistrationError(
      "P19A_QUOTE_PREP_RPC_RESULT_STATUS_INVALID",
      "P19A_QUOTE_PREP_RPC_RESULT_STATUS_INVALID",
      "uncertain",
    );
  }
  return value as QuotePreparationRegistrationResult["status"];
}

function parseResult(
  data: unknown,
  registration: QuotePreparationRegistration,
): QuotePreparationRegistrationResult {
  if (!isRecord(data)) {
    throw new QuotePreparationRegistrationError(
      "P19A_QUOTE_PREP_RPC_RESULT_INVALID",
      "P19A_QUOTE_PREP_RPC_RESULT_INVALID",
      "uncertain",
    );
  }

  const outcome = data.outcome;
  const status = requireStatus(data.status);
  const operationId = data.operation_id;

  if (
    outcome !== "created" &&
    outcome !== "idempotent_replay" &&
    outcome !== "blocked"
  ) {
    throw new QuotePreparationRegistrationError(
      "P19A_QUOTE_PREP_RPC_OUTCOME_INVALID",
      "P19A_QUOTE_PREP_RPC_OUTCOME_INVALID",
      "uncertain",
    );
  }

  if (outcome === "blocked") {
    if (
      operationId !== null ||
      status !== "blocked" ||
      data.reason !== "active_preparation_exists"
    ) {
      throw new QuotePreparationRegistrationError(
        "P19A_QUOTE_PREP_RPC_BLOCKED_RESULT_INVALID",
        "P19A_QUOTE_PREP_RPC_BLOCKED_RESULT_INVALID",
        "uncertain",
      );
    }
    return { ...registration, outcome, operationId: null, status, reason: data.reason };
  }

  if (
    typeof operationId !== "string" ||
    !UUID_PATTERN.test(operationId) ||
    typeof data.organization_id !== "string" ||
    data.organization_id !== registration.organizationId ||
    typeof data.store_id !== "string" ||
    data.store_id !== registration.storeId ||
    typeof data.profile_version_id !== "string" ||
    data.profile_version_id !== registration.profileVersionId ||
    typeof data.request_message_id !== "string" ||
    data.request_message_id !== registration.requestMessageId
  ) {
    throw new QuotePreparationRegistrationError(
      "P19A_QUOTE_PREP_RPC_RESULT_SCOPE_INVALID",
      "P19A_QUOTE_PREP_RPC_RESULT_SCOPE_INVALID",
      "uncertain",
    );
  }

  if (outcome === "created" && status !== "queued") {
    throw new QuotePreparationRegistrationError(
      "P19A_QUOTE_PREP_RPC_CREATED_STATUS_INVALID",
      "P19A_QUOTE_PREP_RPC_CREATED_STATUS_INVALID",
      "uncertain",
    );
  }

  return { ...registration, outcome, operationId, status };
}

function createServiceRoleClient(): QuotePreparationRegistrationSupabase {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new QuotePreparationRegistrationError(
      "SUPABASE_SERVICE_ROLE_ENV_MISSING",
      "SUPABASE_SERVICE_ROLE_ENV_MISSING",
      "input",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as QuotePreparationRegistrationSupabase;
}

export async function registerQuotePreparationOperationBySystem(args: {
  registration: QuotePreparationRegistration;
  supabase?: QuotePreparationRegistrationSupabase;
}): Promise<QuotePreparationRegistrationResult> {
  const registration = validateRegistration(args?.registration);
  const supabase = args?.supabase ?? createServiceRoleClient();

  let response: { data: unknown; error: RpcError | null };
  try {
    response = await supabase.rpc(REGISTER_QUOTE_PREPARATION_RPC, {
      p_organization_id: registration.organizationId,
      p_store_id: registration.storeId,
      p_lead_id: registration.leadId,
      p_conversation_id: registration.conversationId,
      p_commercial_opportunity_id: registration.commercialOpportunityId,
      p_request_message_id: registration.requestMessageId,
      p_profile_version_id: registration.profileVersionId,
      p_profile_version_number: registration.profileVersionNumber,
      p_operation_key: registration.operationKey,
      p_request_fingerprint: registration.requestFingerprint,
    });
  } catch (error) {
    throw new QuotePreparationRegistrationError(
      "A autoridade de registro nao confirmou o resultado; o estado permanece incerto.",
      "P19A_QUOTE_PREP_RPC_UNCERTAIN",
      "uncertain",
      error,
    );
  }

  if (response.error) {
    const code = typeof response.error.code === "string"
      ? response.error.code
      : "P19A_QUOTE_PREP_RPC_REJECTED";
    throw new QuotePreparationRegistrationError(
      typeof response.error.message === "string"
        ? response.error.message
        : "A autoridade de registro rejeitou a operacao.",
      code,
      "rejected",
      response.error,
    );
  }

  return parseResult(response.data, registration);
}
