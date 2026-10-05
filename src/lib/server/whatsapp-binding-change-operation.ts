import {
  exchangeAndValidateMetaWhatsappBinding,
  type MetaWhatsappEmbeddedSignupValidationResult,
} from "./meta-whatsapp-embedded-signup";

export const WHATSAPP_BINDING_CHANGE_PROVIDER = "whatsapp" as const;

export type WhatsappBindingChangeStatus =
  | "requested"
  | "awaiting_customer_authorization"
  | "customer_authorizing"
  | "candidate_received"
  | "validating"
  | "ready_to_cutover"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type WhatsappBindingChangeRequest = {
  id: string;
  organization_id: string;
  store_id: string;
  provider: string;
  status: WhatsappBindingChangeStatus;
  active_integration_id: string;
  active_phone_number_id_snapshot: string | null;
  active_whatsapp_business_account_id_snapshot: string | null;
  active_display_phone_number_snapshot: string | null;
  candidate_whatsapp_business_account_id: string | null;
  candidate_phone_number_id: string | null;
  candidate_display_phone_number: string | null;
  candidate_received_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  terminal_at: string | null;
};

type WhatsappBindingChangeActive = {
  id: string;
  organization_id: string;
  store_id: string;
  provider: string;
  status: string | null;
  is_active: boolean | null;
  phone_number_id: string | null;
  whatsapp_business_account_id: string | null;
  display_phone_number: string | null;
};

type QueryResult<T> = {
  data: T | null;
  error: { message?: string | null } | null;
};

type WhatsappBindingChangeQuery = {
  eq(column: string, value: unknown): WhatsappBindingChangeQuery;
  maybeSingle(): Promise<QueryResult<unknown>>;
};

export type WhatsappBindingChangeSupabaseLike = {
  from(table: string): {
    select(columns: string): WhatsappBindingChangeQuery;
  };
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string | null } | null }>;
};

export type WhatsappBindingFreshTokenValidator = (input: {
  code: string;
  whatsappBusinessAccountId: string;
  phoneNumberId: string;
}) => Promise<MetaWhatsappEmbeddedSignupValidationResult>;

export class WhatsappBindingChangeOperationError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, httpStatus = 409) {
    super(code);
    this.name = "WhatsappBindingChangeOperationError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const REQUEST_COLUMNS = [
  "id",
  "organization_id",
  "store_id",
  "provider",
  "status",
  "active_integration_id",
  "active_phone_number_id_snapshot",
  "active_whatsapp_business_account_id_snapshot",
  "active_display_phone_number_snapshot",
  "candidate_whatsapp_business_account_id",
  "candidate_phone_number_id",
  "candidate_display_phone_number",
  "candidate_received_at",
  "expires_at",
  "completed_at",
  "terminal_at",
].join(", ");

const ACTIVE_COLUMNS = [
  "id",
  "organization_id",
  "store_id",
  "provider",
  "status",
  "is_active",
  "phone_number_id",
  "whatsapp_business_account_id",
  "display_phone_number",
].join(", ");

function cleanText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function isCandidateComplete(request: WhatsappBindingChangeRequest) {
  return Boolean(
    cleanText(request.candidate_whatsapp_business_account_id) &&
      cleanText(request.candidate_phone_number_id) &&
      cleanText(request.candidate_display_phone_number),
  );
}

function asRequest(value: unknown): WhatsappBindingChangeRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = cleanText(row.id);
  const organizationId = cleanText(row.organization_id);
  const storeId = cleanText(row.store_id);
  const provider = cleanText(row.provider);
  const status = cleanText(row.status);
  const activeIntegrationId = cleanText(row.active_integration_id);

  if (
    !id ||
    !organizationId ||
    !storeId ||
    !provider ||
    !status ||
    !activeIntegrationId
  ) {
    return null;
  }

  return {
    id,
    organization_id: organizationId,
    store_id: storeId,
    provider,
    status: status as WhatsappBindingChangeStatus,
    active_integration_id: activeIntegrationId,
    active_phone_number_id_snapshot: cleanText(
      row.active_phone_number_id_snapshot,
    ),
    active_whatsapp_business_account_id_snapshot: cleanText(
      row.active_whatsapp_business_account_id_snapshot,
    ),
    active_display_phone_number_snapshot: cleanText(
      row.active_display_phone_number_snapshot,
    ),
    candidate_whatsapp_business_account_id: cleanText(
      row.candidate_whatsapp_business_account_id,
    ),
    candidate_phone_number_id: cleanText(row.candidate_phone_number_id),
    candidate_display_phone_number: cleanText(row.candidate_display_phone_number),
    candidate_received_at: cleanText(row.candidate_received_at),
    expires_at: cleanText(row.expires_at),
    completed_at: cleanText(row.completed_at),
    terminal_at: cleanText(row.terminal_at),
  };
}

function asActive(value: unknown): WhatsappBindingChangeActive | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = cleanText(row.id);
  const organizationId = cleanText(row.organization_id);
  const storeId = cleanText(row.store_id);
  const provider = cleanText(row.provider);
  if (!id || !organizationId || !storeId || !provider) return null;

  return {
    id,
    organization_id: organizationId,
    store_id: storeId,
    provider,
    status: cleanText(row.status),
    is_active: row.is_active === true,
    phone_number_id: cleanText(row.phone_number_id),
    whatsapp_business_account_id: cleanText(
      row.whatsapp_business_account_id,
    ),
    display_phone_number: cleanText(row.display_phone_number),
  };
}

function readRpcRow(data: unknown) {
  if (Array.isArray(data)) return data[0] ?? null;
  return data && typeof data === "object" ? data : null;
}

function ensureScope(organizationId: string, storeId: string) {
  if (!cleanText(organizationId) || !cleanText(storeId)) {
    throw new WhatsappBindingChangeOperationError(
      "WHATSAPP_BINDING_CHANGE_SCOPE_REQUIRED",
      400,
    );
  }
}

function ensureNotExpired(
  request: WhatsappBindingChangeRequest,
  now: Date,
) {
  if (request.expires_at && new Date(request.expires_at).getTime() <= now.getTime()) {
    throw new WhatsappBindingChangeOperationError(
      "ZION_WHATSAPP_CHANGE_EXPIRED",
    );
  }
}

export async function readWhatsappBindingChangeRequest(args: {
  supabase: WhatsappBindingChangeSupabaseLike;
  organizationId: string;
  storeId: string;
  requestId: string;
}): Promise<WhatsappBindingChangeRequest> {
  ensureScope(args.organizationId, args.storeId);
  const requestId = cleanText(args.requestId);
  if (!requestId) {
    throw new WhatsappBindingChangeOperationError(
      "WHATSAPP_BINDING_CHANGE_REQUEST_REQUIRED",
      400,
    );
  }

  const query = args.supabase
    .from("whatsapp_binding_change_requests")
    .select(REQUEST_COLUMNS);
  const scopedQuery = query
    .eq("id", requestId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("provider", WHATSAPP_BINDING_CHANGE_PROVIDER);
  const { data, error } = await scopedQuery.maybeSingle();

  if (error) {
    throw new WhatsappBindingChangeOperationError(
      "WHATSAPP_BINDING_CHANGE_READ_FAILED",
      503,
    );
  }

  const request = asRequest(data);
  if (!request) {
    throw new WhatsappBindingChangeOperationError(
      "WHATSAPP_BINDING_CHANGE_REQUEST_NOT_FOUND",
      404,
    );
  }

  return request;
}

async function readActiveBinding(args: {
  supabase: WhatsappBindingChangeSupabaseLike;
  request: WhatsappBindingChangeRequest;
}) {
  const query = args.supabase
    .from("external_integrations")
    .select(ACTIVE_COLUMNS);
  const scopedQuery = query
    .eq("id", args.request.active_integration_id)
    .eq("organization_id", args.request.organization_id)
    .eq("store_id", args.request.store_id)
    .eq("provider", WHATSAPP_BINDING_CHANGE_PROVIDER);
  const { data, error } = await scopedQuery.maybeSingle();

  if (error) {
    throw new WhatsappBindingChangeOperationError(
      "WHATSAPP_BINDING_CHANGE_ACTIVE_READ_FAILED",
      503,
    );
  }

  const active = asActive(data);
  if (!active) {
    throw new WhatsappBindingChangeOperationError(
      "ZION_WHATSAPP_CHANGE_ACTIVE_BINDING_MISSING",
    );
  }

  return active;
}

function ensureCandidate(request: WhatsappBindingChangeRequest) {
  if (!isCandidateComplete(request)) {
    throw new WhatsappBindingChangeOperationError(
      "ZION_WHATSAPP_CHANGE_CANDIDATE_REQUIRED",
    );
  }
}

function ensureAdvanceState(
  request: WhatsappBindingChangeRequest,
  expectedStatus: WhatsappBindingChangeStatus,
) {
  if (request.status !== expectedStatus) {
    throw new WhatsappBindingChangeOperationError(
      request.status === "failed" ||
        request.status === "cancelled" ||
        request.status === "expired"
        ? "ZION_WHATSAPP_CHANGE_TERMINAL_REQUEST"
        : "ZION_WHATSAPP_CHANGE_STATE_TRANSITION_INVALID",
    );
  }
}

export async function advanceWhatsappBindingChangeRequest(args: {
  supabase: WhatsappBindingChangeSupabaseLike;
  organizationId: string;
  storeId: string;
  requestId: string;
  nextStatus: "validating" | "ready_to_cutover";
  now?: Date;
}) {
  const request = await readWhatsappBindingChangeRequest(args);
  ensureNotExpired(request, args.now ?? new Date());
  ensureCandidate(request);
  ensureAdvanceState(
    request,
    args.nextStatus === "validating" ? "candidate_received" : "validating",
  );

  const { error } = await args.supabase.rpc(
    "advance_whatsapp_binding_change_request_by_system",
    {
      p_organization_id: request.organization_id,
      p_store_id: request.store_id,
      p_request_id: request.id,
      p_next_status: args.nextStatus,
    },
  );

  if (error) {
    throw new WhatsappBindingChangeOperationError(
      "WHATSAPP_BINDING_CHANGE_ADVANCE_FAILED",
      409,
    );
  }

  return readWhatsappBindingChangeRequest(args);
}

export async function cutoverWhatsappBindingChangeRequest(args: {
  supabase: WhatsappBindingChangeSupabaseLike;
  organizationId: string;
  storeId: string;
  requestId: string;
  authorizationCode?: string | null;
  validateFreshToken?: WhatsappBindingFreshTokenValidator;
  now?: Date;
}) {
  const request = await readWhatsappBindingChangeRequest(args);
  if (request.status === "completed") return request;

  ensureNotExpired(request, args.now ?? new Date());

  const authorizationCode = cleanText(args.authorizationCode);
  if (!authorizationCode) {
    throw new WhatsappBindingChangeOperationError(
      "ZION_WHATSAPP_CHANGE_AUTHORIZATION_CODE_REQUIRED",
      400,
    );
  }

  ensureCandidate(request);

  if (request.status !== "ready_to_cutover") {
    throw new WhatsappBindingChangeOperationError(
      request.status === "failed" ||
        request.status === "cancelled" ||
        request.status === "expired"
        ? "ZION_WHATSAPP_CHANGE_TERMINAL_REQUEST"
        : "ZION_WHATSAPP_CHANGE_NOT_READY_TO_CUTOVER",
    );
  }

  const active = await readActiveBinding({
    supabase: args.supabase,
    request,
  });

  if (
    active.status !== "active" ||
    active.is_active !== true ||
    active.phone_number_id !== request.active_phone_number_id_snapshot ||
    active.whatsapp_business_account_id !==
      request.active_whatsapp_business_account_id_snapshot ||
    active.display_phone_number !== request.active_display_phone_number_snapshot
  ) {
    throw new WhatsappBindingChangeOperationError(
      "ZION_WHATSAPP_CHANGE_ACTIVE_BINDING_STALE",
    );
  }

  const validateFreshToken =
    args.validateFreshToken ?? exchangeAndValidateMetaWhatsappBinding;
  const validated = await validateFreshToken({
    code: authorizationCode,
    whatsappBusinessAccountId: request.candidate_whatsapp_business_account_id!,
    phoneNumberId: request.candidate_phone_number_id!,
  });

  if (
    validated.whatsappBusinessAccountId !==
      request.candidate_whatsapp_business_account_id ||
    validated.phoneNumberId !== request.candidate_phone_number_id
  ) {
    throw new WhatsappBindingChangeOperationError(
      "ZION_WHATSAPP_CHANGE_META_BINDING_MISMATCH",
    );
  }

  const { data, error } = await args.supabase.rpc(
    "cutover_whatsapp_binding_change_request_by_system",
    {
      p_organization_id: request.organization_id,
      p_store_id: request.store_id,
      p_provider: WHATSAPP_BINDING_CHANGE_PROVIDER,
      p_request_id: request.id,
      p_cutover_idempotency_key: `whatsapp-binding-change-cutover:${request.id}`,
      p_expected_active_integration_id: active.id,
      p_expected_candidate_whatsapp_business_account_id:
        request.candidate_whatsapp_business_account_id,
      p_expected_candidate_phone_number_id: request.candidate_phone_number_id,
      p_expected_candidate_display_phone_number:
        request.candidate_display_phone_number,
      p_fresh_access_token: validated.accessToken,
      p_provenance: {
        source: "p19a_whatsapp_binding_change_operation",
      },
    },
  );

  if (error || !readRpcRow(data)) {
    throw new WhatsappBindingChangeOperationError(
      "WHATSAPP_BINDING_CHANGE_CUTOVER_FAILED",
      409,
    );
  }

  return readWhatsappBindingChangeRequest(args);
}

export async function cancelWhatsappBindingChangeRequest(args: {
  supabase: WhatsappBindingChangeSupabaseLike;
  organizationId: string;
  storeId: string;
  requestId: string;
}) {
  const request = await readWhatsappBindingChangeRequest(args);
  if (request.status === "expired") {
    throw new WhatsappBindingChangeOperationError(
      "ZION_WHATSAPP_CHANGE_TERMINAL_REQUEST",
    );
  }

  const { error } = await args.supabase.rpc(
    "cancel_whatsapp_binding_change_request_by_system",
    {
      p_organization_id: request.organization_id,
      p_store_id: request.store_id,
      p_provider: WHATSAPP_BINDING_CHANGE_PROVIDER,
      p_request_id: request.id,
      p_provenance: { source: "p19a_whatsapp_binding_change_operation" },
    },
  );
  if (error) {
    throw new WhatsappBindingChangeOperationError(
      "WHATSAPP_BINDING_CHANGE_CANCEL_FAILED",
      409,
    );
  }

  return readWhatsappBindingChangeRequest(args);
}

export async function expireWhatsappBindingChangeRequest(args: {
  supabase: WhatsappBindingChangeSupabaseLike;
  organizationId: string;
  storeId: string;
  requestId: string;
  now?: Date;
}) {
  const request = await readWhatsappBindingChangeRequest(args);
  const now = args.now ?? new Date();
  if (!request.expires_at || new Date(request.expires_at).getTime() > now.getTime()) {
    throw new WhatsappBindingChangeOperationError(
      "ZION_WHATSAPP_CHANGE_NOT_EXPIRED",
    );
  }

  const { error } = await args.supabase.rpc(
    "expire_whatsapp_binding_change_request_by_system",
    {
      p_organization_id: request.organization_id,
      p_store_id: request.store_id,
      p_provider: WHATSAPP_BINDING_CHANGE_PROVIDER,
      p_request_id: request.id,
      p_provenance: { source: "p19a_whatsapp_binding_change_operation" },
    },
  );
  if (error) {
    throw new WhatsappBindingChangeOperationError(
      "WHATSAPP_BINDING_CHANGE_EXPIRE_FAILED",
      409,
    );
  }

  return readWhatsappBindingChangeRequest(args);
}
