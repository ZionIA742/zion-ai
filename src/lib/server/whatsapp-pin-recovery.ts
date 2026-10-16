import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  exchangeAndValidateMetaWhatsappBinding,
  MetaWhatsappEmbeddedSignupError,
  registerMetaWhatsappEmbeddedSignup,
  type MetaWhatsappEmbeddedSignupValidationResult,
} from "./meta-whatsapp-embedded-signup";
import {
  decryptWhatsappTwoStepPin,
  encryptWhatsappTwoStepPin,
  type EncryptedWhatsappTwoStepPin,
} from "./whatsapp-two-step-pin-crypto";
import { resolveZionAdminApiAccess, type ZionAdminApiAccessResult } from "./zion-admin-api-access";
import { createServiceSupabaseClient } from "./zion-account-provisioning";

export const WHATSAPP_PIN_RECOVERY_TARGET = {
  organizationId: "fbd4afaa-4958-4663-9234-98589ab322c7",
  storeId: "54fb81f4-92e5-463a-af6c-fc1544ea4b04",
  wabaId: "1642288770859048",
  phoneNumberId: "1322472314288518",
} as const;

const REGISTER_FEATURE_FLAG = "ZION_WHATSAPP_PIN_RECOVERY_META_ENABLED";
const BINDING_SECRET_ENV = "ZION_WHATSAPP_PIN_RECOVERY_AUTH_SECRET";
const PROVIDER = "whatsapp";
const SECRET_KIND = "two_step_verification_pin";

type RpcResult = { data: unknown; error: { message?: string | null } | null };

type QueryLike = {
  select(columns: string): QueryLike;
  eq(column: string, value: unknown): QueryLike;
  order(column: string, options: { ascending: boolean }): QueryLike;
  limit(value: number): PromiseLike<{ data: unknown; error: { message?: string | null } | null }>;
};

export type WhatsappPinRecoverySupabaseLike = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  from(table: string): QueryLike;
};

type RecoveryAccess = Extract<ZionAdminApiAccessResult, { ok: true }>;

type RemoteObservation = {
  result: "confirmed" | "rejected" | "uncertain";
  httpStatus: number | null;
  metaErrorCode: string | null;
  requestId: string | null;
  evidenceHash: string | null;
};

type RecoveryDeps = {
  resolveAccess: () => Promise<ZionAdminApiAccessResult>;
  isRequestOriginTrusted: (request: Request) => boolean;
  createServiceSupabase: () => WhatsappPinRecoverySupabaseLike;
  now: () => Date;
  createOperationId: () => string;
  buildSessionBindingHash: (args: {
    actorUserId: string;
    operationId: string;
  }) => string;
  isMetaExecutionEnabled: () => boolean;
  validateOAuth: typeof exchangeAndValidateMetaWhatsappBinding;
  registerRemote: (
    validated: MetaWhatsappEmbeddedSignupValidationResult,
    pin: string,
  ) => Promise<RemoteObservation>;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data) && data.length !== 1) return null;
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function safeErrorCode(error: { message?: string | null } | null) {
  const message = clean(error?.message);
  return message.startsWith("ZION_") ? message.split(/[\s:]/, 1)[0] : "WHATSAPP_PIN_RECOVERY_RPC_FAILED";
}

function requireTarget(body: Record<string, unknown>) {
  const target = body.target;
  if (!target || typeof target !== "object" || Array.isArray(target)) return false;
  const value = target as Record<string, unknown>;
  return (
    clean(value.organizationId) === WHATSAPP_PIN_RECOVERY_TARGET.organizationId &&
    clean(value.storeId) === WHATSAPP_PIN_RECOVERY_TARGET.storeId &&
    clean(value.wabaId) === WHATSAPP_PIN_RECOVERY_TARGET.wabaId &&
    clean(value.phoneNumberId) === WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId
  );
}

function readBindingSecret() {
  const secret = clean(process.env[BINDING_SECRET_ENV]);
  if (!secret) throw new Error("WHATSAPP_PIN_RECOVERY_AUTH_SECRET_NOT_CONFIGURED");
  return secret;
}

function defaultBindingHash(args: { actorUserId: string; operationId: string }) {
  return createHmac("sha256", readBindingSecret())
    .update(`${args.actorUserId}:${args.operationId}:${WHATSAPP_PIN_RECOVERY_TARGET.organizationId}:${WHATSAPP_PIN_RECOVERY_TARGET.storeId}:${WHATSAPP_PIN_RECOVERY_TARGET.wabaId}:${WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId}`)
    .digest("hex");
}

function tokenFingerprint(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function configuredTrustedOrigin() {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_VERCEL_URL?.trim() ||
    "";
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function defaultIsRequestOriginTrusted(request: Request) {
  const origin = clean(request.headers.get("origin"));
  const trustedOrigin = configuredTrustedOrigin();
  if (!origin || !trustedOrigin || origin === "null") return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === trustedOrigin;
  } catch {
    return false;
  }
}

function observationHash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

async function readHistoricalSecretId(client: WhatsappPinRecoverySupabaseLike) {
  const { data, error } = await client
    .from("whatsapp_phone_security_secrets")
    .select("id, organization_id, store_id, provider, phone_number_id, secret_kind, status")
    .eq("organization_id", WHATSAPP_PIN_RECOVERY_TARGET.organizationId)
    .eq("store_id", WHATSAPP_PIN_RECOVERY_TARGET.storeId)
    .eq("provider", PROVIDER)
    .eq("phone_number_id", WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId)
    .eq("secret_kind", SECRET_KIND)
    .eq("status", "invalidated")
    .order("created_at", { ascending: false })
    .limit(2);

  if (error) throw new Error("WHATSAPP_PIN_RECOVERY_HISTORICAL_SECRET_LOOKUP_FAILED");
  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== 1) {
    throw new Error(
      rows.length === 0
        ? "WHATSAPP_PIN_RECOVERY_HISTORICAL_SECRET_NOT_FOUND"
        : "WHATSAPP_PIN_RECOVERY_HISTORICAL_SECRET_AMBIGUOUS",
    );
  }
  const row = rows[0];
  const id = row && typeof row === "object" ? clean((row as Record<string, unknown>).id) : "";
  if (!id) throw new Error("WHATSAPP_PIN_RECOVERY_HISTORICAL_SECRET_INVALID");
  return id;
}

async function callRpc(
  client: WhatsappPinRecoverySupabaseLike,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(safeErrorCode(result.error));
  const row = firstRow(result.data);
  if (!row) throw new Error("WHATSAPP_PIN_RECOVERY_RPC_RETURN_INVALID");
  return row;
}

function defaultDeps(): RecoveryDeps {
  return {
    resolveAccess: () => resolveZionAdminApiAccess({ requiredCapability: "manage_whatsapp_pins" }),
    isRequestOriginTrusted: defaultIsRequestOriginTrusted,
    createServiceSupabase: () => createServiceSupabaseClient() as unknown as WhatsappPinRecoverySupabaseLike,
    now: () => new Date(),
    createOperationId: randomUUID,
    buildSessionBindingHash: defaultBindingHash,
    isMetaExecutionEnabled: () => process.env[REGISTER_FEATURE_FLAG]?.trim().toLowerCase() === "true",
    validateOAuth: exchangeAndValidateMetaWhatsappBinding,
    registerRemote: defaultRegisterRemote,
  };
}

async function defaultRegisterRemote(
  validated: MetaWhatsappEmbeddedSignupValidationResult,
  pin: string,
): Promise<RemoteObservation> {
  let registerResponse: { status: number; body: unknown; requestId: string | null } | null = null;
  const observedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (String(input).includes(`/${validated.phoneNumberId}/register`)) {
      let body: unknown = null;
      try {
        body = await response.clone().json();
      } catch {
        body = null;
      }
      registerResponse = {
        status: response.status,
        body,
        requestId: response.headers.get("x-fb-trace-id") || response.headers.get("x-fb-request-id"),
      };
    }
    return response;
  };

  try {
    await registerMetaWhatsappEmbeddedSignup(validated, pin, { deps: { fetch: observedFetch } });
    const observed = registerResponse as { status: number; body: unknown; requestId: string | null } | null;
    const successBody = observed?.body;
    if (!observed || !successBody || typeof successBody !== "object" || (successBody as Record<string, unknown>).success !== true) {
      return {
        result: "uncertain",
        httpStatus: observed?.status ?? null,
        metaErrorCode: null,
        requestId: observed?.requestId ?? null,
        evidenceHash: observed ? observationHash({ status: observed.status, body: observed.body, requestId: observed.requestId }) : null,
      };
    }
    return {
      result: "confirmed",
      httpStatus: observed.status,
      metaErrorCode: null,
      requestId: observed.requestId,
      evidenceHash: observationHash({ status: observed.status, body: observed.body, requestId: observed.requestId }),
    };
  } catch (error) {
    const metaError = error instanceof MetaWhatsappEmbeddedSignupError ? error : null;
    const deterministic =
      metaError &&
      [400, 401, 403].includes(metaError.evidence.httpStatus) &&
      Boolean(metaError.evidence.metaCode);
    const observed = registerResponse as { status: number; body: unknown; requestId: string | null } | null;
    return {
      result: deterministic ? "rejected" : "uncertain",
      httpStatus: observed?.status ?? metaError?.evidence.httpStatus ?? null,
      metaErrorCode: metaError?.evidence.metaCode ?? null,
      requestId: observed?.requestId ?? null,
      evidenceHash: observed ? observationHash({ status: observed.status, body: observed.body, requestId: observed.requestId }) : null,
    };
  }
}

function depsWithDefaults(overrides?: Partial<RecoveryDeps>): RecoveryDeps {
  return { ...defaultDeps(), ...overrides };
}

function requireOperationIds(body: Record<string, unknown>) {
  const attemptId = clean(body.attemptId);
  const operationId = clean(body.operationId);
  if (!attemptId || !operationId) throw new Error("WHATSAPP_PIN_RECOVERY_OPERATION_REQUIRED");
  return { attemptId, operationId };
}

function validateMetaTarget(validated: MetaWhatsappEmbeddedSignupValidationResult) {
  if (
    validated.whatsappBusinessAccountId !== WHATSAPP_PIN_RECOVERY_TARGET.wabaId ||
    validated.phoneNumberId !== WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId ||
    validated.connectionMode !== "standard"
  ) {
    throw new Error("WHATSAPP_PIN_RECOVERY_META_TARGET_MISMATCH");
  }
}

async function prepare(body: Record<string, unknown>, access: RecoveryAccess, deps: RecoveryDeps) {
  if (body.consent !== true || !requireTarget(body)) {
    return jsonResponse({ ok: false, error: "WHATSAPP_PIN_RECOVERY_EXPLICIT_CONSENT_REQUIRED" }, 400);
  }
  const client = deps.createServiceSupabase();
  const operationId = deps.createOperationId();
  const historicalSecretId = await readHistoricalSecretId(client);
  const bindingHash = deps.buildSessionBindingHash({ actorUserId: access.sessionUserId, operationId });
  const expiresAt = new Date(deps.now().getTime() + 5 * 60_000).toISOString();
  const row = await callRpc(client, "prepare_whatsapp_pin_recovery_attempt_by_system", {
    p_operation_id: operationId,
    p_actor_user_id: access.sessionUserId,
    p_organization_id: WHATSAPP_PIN_RECOVERY_TARGET.organizationId,
    p_store_id: WHATSAPP_PIN_RECOVERY_TARGET.storeId,
    p_waba_id: WHATSAPP_PIN_RECOVERY_TARGET.wabaId,
    p_phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId,
    p_historical_secret_id: historicalSecretId,
    p_session_binding_hash: bindingHash,
    p_authorization_expires_at: expiresAt,
  });
  if (
    !isUuid(clean(row.attempt_id)) ||
    clean(row.operation_id) !== operationId ||
    clean(row.status) !== "prepared" ||
    !isUuid(clean(row.historical_secret_id)) ||
    !clean(row.expires_at) ||
    !["created", "idempotent_replay"].includes(clean(row.outcome))
  ) throw new Error("WHATSAPP_PIN_RECOVERY_PREPARATION_INVALID");
  return jsonResponse({
    ok: true,
    outcome: clean(row.outcome),
    attemptId: clean(row.attempt_id),
    operationId: clean(row.operation_id),
    status: clean(row.status),
    expiresAt: clean(row.expires_at),
    target: { ...WHATSAPP_PIN_RECOVERY_TARGET },
  });
}

async function execute(body: Record<string, unknown>, access: RecoveryAccess, deps: RecoveryDeps) {
  if (!deps.isMetaExecutionEnabled()) return jsonResponse({ ok: false, error: "WHATSAPP_PIN_RECOVERY_META_EXECUTION_DISABLED" }, 503);
  const { attemptId, operationId } = requireOperationIds(body);
  const code = clean(body.oauthCode);
  if (!code) return jsonResponse({ ok: false, error: "WHATSAPP_PIN_RECOVERY_OAUTH_CODE_REQUIRED" }, 400);
  const validated = await deps.validateOAuth({ code, whatsappBusinessAccountId: WHATSAPP_PIN_RECOVERY_TARGET.wabaId, phoneNumberId: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId });
  validateMetaTarget(validated);
  const fingerprint = tokenFingerprint(validated.accessToken);
  const client = deps.createServiceSupabase();
  const bindingHash = deps.buildSessionBindingHash({ actorUserId: access.sessionUserId, operationId });
  const begun = await callRpc(client, "begin_whatsapp_pin_recovery_attempt_by_system", {
    p_attempt_id: attemptId,
    p_operation_id: operationId,
    p_actor_user_id: access.sessionUserId,
    p_session_binding_hash: bindingHash,
    p_access_token_fingerprint: fingerprint,
    p_meta_graph_api_version: validated.graphApiVersion,
    p_meta_app_id: validated.appId,
  });
  if (
    clean(begun.attempt_id) !== attemptId ||
    clean(begun.status) !== "executing" ||
    clean(begun.waba_id) !== WHATSAPP_PIN_RECOVERY_TARGET.wabaId ||
    clean(begun.phone_number_id) !== WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId ||
    !isUuid(clean(begun.historical_secret_id)) ||
    !clean(begun.ciphertext) ||
    !clean(begun.iv) ||
    !clean(begun.auth_tag) ||
    !Number.isInteger(Number(begun.key_version)) ||
    Number(begun.key_version) < 1
  ) {
    throw new Error("WHATSAPP_PIN_RECOVERY_BEGIN_RETURN_INVALID");
  }
  const material: EncryptedWhatsappTwoStepPin = {
    ciphertext: clean(begun.ciphertext),
    iv: clean(begun.iv),
    authTag: clean(begun.auth_tag),
    keyVersion: Number(begun.key_version) as EncryptedWhatsappTwoStepPin["keyVersion"],
  };
  let pin = decryptWhatsappTwoStepPin(material);
  try {
    const replacementMaterial = encryptWhatsappTwoStepPin(pin);
    const replacement = await callRpc(client, "create_whatsapp_pin_recovery_replacement_secret_by_system", {
      p_attempt_id: attemptId,
      p_operation_id: operationId,
      p_actor_user_id: access.sessionUserId,
      p_ciphertext: replacementMaterial.ciphertext,
      p_iv: replacementMaterial.iv,
      p_auth_tag: replacementMaterial.authTag,
      p_key_version: replacementMaterial.keyVersion,
    });
    const replacementSecretId = clean(replacement.replacement_secret_id);
    if (
      !replacementSecretId ||
      !isUuid(replacementSecretId) ||
      clean(replacement.status) !== "pending" ||
      !["created", "idempotent_replay"].includes(clean(replacement.outcome))
    ) {
      throw new Error("WHATSAPP_PIN_RECOVERY_REPLACEMENT_RETURN_INVALID");
    }
    const remote = await deps.registerRemote(validated, pin);
    if (
      !["confirmed", "rejected", "uncertain"].includes(remote.result) ||
      (remote.result === "confirmed" &&
        (remote.httpStatus === null || remote.httpStatus < 200 || remote.httpStatus > 299 || !clean(remote.evidenceHash))) ||
      (remote.result === "rejected" &&
        (remote.httpStatus === null || ![400, 401, 403].includes(remote.httpStatus) || !clean(remote.metaErrorCode)))
    ) {
      throw new Error("WHATSAPP_PIN_RECOVERY_REMOTE_OBSERVATION_INVALID");
    }
    const recorded = await callRpc(client, "record_whatsapp_pin_recovery_remote_result_by_system", {
      p_attempt_id: attemptId,
      p_operation_id: operationId,
      p_actor_user_id: access.sessionUserId,
      p_result: remote.result,
      p_http_status: remote.httpStatus,
      p_meta_error_code: remote.metaErrorCode,
      p_meta_request_id: remote.requestId,
      p_remote_evidence_hash: remote.evidenceHash,
    });
    const expectedStatus = remote.result === "confirmed"
      ? "remote_confirmed"
      : remote.result === "rejected"
        ? "remote_rejected"
        : "remote_uncertain";
    if (
      clean(recorded.attempt_id) !== attemptId ||
      clean(recorded.status) !== expectedStatus ||
      !["recorded", "idempotent_replay"].includes(clean(recorded.outcome))
    ) {
      throw new Error("WHATSAPP_PIN_RECOVERY_REMOTE_RESULT_RETURN_INVALID");
    }
    if (remote.result === "uncertain") return jsonResponse({ ok: false, outcome: clean(recorded.outcome), status: "remote_uncertain", retryAllowed: false }, 503);
    if (remote.result === "rejected") return jsonResponse({ ok: false, outcome: clean(recorded.outcome), status: "remote_rejected", retryAllowed: false }, 422);
    return jsonResponse({ ok: true, outcome: clean(recorded.outcome), status: "remote_confirmed", requiresFreshOAuth: true, retryAllowed: false });
  } finally {
    pin = "";
  }
}

async function materialize(body: Record<string, unknown>, access: RecoveryAccess, deps: RecoveryDeps) {
  if (!deps.isMetaExecutionEnabled()) return jsonResponse({ ok: false, error: "WHATSAPP_PIN_RECOVERY_META_EXECUTION_DISABLED" }, 503);
  const { attemptId, operationId } = requireOperationIds(body);
  const code = clean(body.oauthCode);
  if (!code) return jsonResponse({ ok: false, error: "WHATSAPP_PIN_RECOVERY_FRESH_OAUTH_CODE_REQUIRED" }, 400);
  const validated = await deps.validateOAuth({ code, whatsappBusinessAccountId: WHATSAPP_PIN_RECOVERY_TARGET.wabaId, phoneNumberId: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId });
  validateMetaTarget(validated);
  const fingerprint = tokenFingerprint(validated.accessToken);
  const client = deps.createServiceSupabase();
  const bindingHash = deps.buildSessionBindingHash({ actorUserId: access.sessionUserId, operationId });
  const authorization = await callRpc(client, "authorize_whatsapp_pin_recovery_materialization_token_by_system", {
    p_attempt_id: attemptId,
    p_operation_id: operationId,
    p_actor_user_id: access.sessionUserId,
    p_session_binding_hash: bindingHash,
    p_access_token_fingerprint: fingerprint,
    p_validated_at: validated.validatedAt,
  });
  if (
    clean(authorization.attempt_id) !== attemptId ||
    clean(authorization.status) !== "remote_confirmed" ||
    !["bound", "idempotent_replay"].includes(clean(authorization.outcome))
  ) {
    throw new Error("WHATSAPP_PIN_RECOVERY_MATERIALIZATION_AUTHORIZATION_INVALID");
  }
  const integrationRow = await callRpc(client, "materialize_store_whatsapp_embedded_signup_by_system", {
    p_organization_id: WHATSAPP_PIN_RECOVERY_TARGET.organizationId,
    p_store_id: WHATSAPP_PIN_RECOVERY_TARGET.storeId,
    p_whatsapp_business_account_id: validated.whatsappBusinessAccountId,
    p_phone_number_id: validated.phoneNumberId,
    p_display_phone_number: validated.displayPhoneNumber,
    p_access_token: validated.accessToken,
    p_meta_graph_api_version: validated.graphApiVersion,
    p_meta_app_id: validated.appId,
    p_validated_at: validated.validatedAt,
  });
  const integrationId = clean(integrationRow.integration_id);
  const materializedWaba = clean(integrationRow.whatsapp_business_account_id);
  if (
    !integrationId ||
    !isUuid(integrationId) ||
    !["inserted", "reconnected", "legacy_converted", "idempotent_replay"].includes(clean(integrationRow.outcome)) ||
    clean(integrationRow.provider) !== "whatsapp" ||
    !materializedWaba ||
    clean(integrationRow.phone_number_id) !== WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId ||
    materializedWaba !== WHATSAPP_PIN_RECOVERY_TARGET.wabaId ||
    clean(integrationRow.status) !== "active" ||
    integrationRow.is_active !== true
  ) throw new Error("WHATSAPP_PIN_RECOVERY_INTEGRATION_INVALID");
  const finalized = await callRpc(client, "finalize_whatsapp_pin_recovery_materialization_by_system", {
    p_attempt_id: attemptId,
    p_operation_id: operationId,
    p_actor_user_id: access.sessionUserId,
    p_integration_id: integrationId,
    p_access_token_fingerprint: fingerprint,
    p_meta_graph_api_version: validated.graphApiVersion,
    p_meta_app_id: validated.appId,
    p_validated_at: validated.validatedAt,
  });
  if (
    clean(finalized.attempt_id) !== attemptId ||
    clean(finalized.status) !== "completed" ||
    clean(finalized.integration_id) !== integrationId ||
    !isUuid(clean(finalized.replacement_secret_id)) ||
    !["completed", "idempotent_replay"].includes(clean(finalized.outcome))
  ) {
    throw new Error("WHATSAPP_PIN_RECOVERY_FINALIZE_RETURN_INVALID");
  }
  return jsonResponse({ ok: true, outcome: clean(finalized.outcome), status: clean(finalized.status), integrationId });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createWhatsappPinRecoveryPostHandler(overrides: Partial<RecoveryDeps> = {}) {
  const deps = depsWithDefaults(overrides);
  return async function POST(request: Request) {
    if (!deps.isRequestOriginTrusted(request)) {
      return jsonResponse({ ok: false, error: "WHATSAPP_PIN_RECOVERY_CSRF_REJECTED" }, 403);
    }
    let access: ZionAdminApiAccessResult;
    try {
      access = await deps.resolveAccess();
    } catch {
      return jsonResponse({ ok: false, error: "WHATSAPP_PIN_RECOVERY_ACCESS_UNAVAILABLE" }, 503);
    }
    if (!access.ok) return jsonResponse(access.payload, access.httpStatus);
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return jsonResponse({ ok: false, error: "WHATSAPP_PIN_RECOVERY_BODY_INVALID" }, 400);
    }
    try {
      const action = clean(body.action);
      if (action === "prepare") return await prepare(body, access, deps);
      if (action === "execute") return await execute(body, access, deps);
      if (action === "materialize") return await materialize(body, access, deps);
      return jsonResponse({ ok: false, error: "WHATSAPP_PIN_RECOVERY_ACTION_INVALID" }, 400);
    } catch (error) {
      const code = error instanceof Error ? error.message : "WHATSAPP_PIN_RECOVERY_FAILED";
      const status =
        code.includes("IN_PROGRESS") || code.includes("CONFLICT") || code.includes("CONSUMED")
          ? 409
          : code.includes("NOT_FOUND") ||
              code.includes("REQUIRED") ||
              code.includes("INVALID") ||
              code.includes("TARGET_MISMATCH")
            ? 400
            : 503;
      return jsonResponse({ ok: false, error: code.startsWith("WHATSAPP_") || code.startsWith("ZION_") ? code : "WHATSAPP_PIN_RECOVERY_FAILED" }, status);
    }
  };
}
