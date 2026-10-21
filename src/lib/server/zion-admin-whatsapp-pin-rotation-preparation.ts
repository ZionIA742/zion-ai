import { createHmac } from "node:crypto";

/**
 * ZION-ADM PIN rotation 1.8-C1: prepare and explicitly authorize ONLY.
 * Does NOT generate a PIN, call Meta, create pending secrets, or finalize.
 * The feature flag is OFF until the rest of the flow has been validated.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE = /^\d{5,32}$/;

export type RotationAccessResult =
  | { ok: true; sessionUserId: string }
  | { ok: false; httpStatus: 401 | 403 | 409 | 503 };
export type RpcResult = { data: unknown; error: { message?: string | null } | null };
export type RotationRpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult> };
export type RotationDeps = {
  resolveAccess: () => Promise<RotationAccessResult>;
  createServiceClient: () => RotationRpc;
  isEnabled: () => boolean;
  isTrustedOrigin: (request: Request) => boolean;
  bindingSecret: () => string;
  now: () => Date;
  operationId: () => string;
  /** Resolve a listed active secret to its canonical phone, server-side only. */
  resolvePhoneTarget: (input: { actorUserId: string; organizationId: string; storeId: string; secretId: string }) => Promise<string>;
};

export function isTrustedRotationOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    const source = new URL(origin);
    const target = new URL(request.url);
    return source.origin === target.origin &&
      (source.protocol === "https:" || (source.protocol === "http:" &&
        (source.hostname === "localhost" || source.hostname === "127.0.0.1")));
  } catch { return false; }
}

function reply(payload: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function singleRow(data: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown> : null;
}
function requireIds(input: Record<string, unknown>) {
  const organizationId = clean(input.organizationId).toLowerCase();
  const storeId = clean(input.storeId).toLowerCase();
  const secretId = clean(input.secretId).toLowerCase();
  // The browser may only pass a listed secret UUID, never a raw phone number.
  if (!validUuid(organizationId) || !validUuid(storeId) || !validUuid(secretId) ||
      Object.hasOwn(input, "phoneNumberId")) {
    return null;
  }
  return { organizationId, storeId, secretId };
}
export function createWhatsappPinRotationSessionBinding(args: {
  secret: string; actorId: string; operationId: string;
  organizationId: string; storeId: string; phoneNumberId: string;
  sessionCookie: string;
}): string {
  // Never accept an attacker-controlled binding hash in the request JSON.
  // The HMAC incorporates the authenticated user's cookie for same-session binding.
  if (args.secret.length < 32 || args.sessionCookie.length < 12) {
    throw new Error("ROTATION_SERVER_BINDING_UNAVAILABLE");
  }
  return createHmac("sha256", args.secret)
    .update(JSON.stringify([
      args.actorId, args.operationId, args.organizationId, args.storeId,
      args.phoneNumberId, args.sessionCookie,
    ]))
    .digest("hex");
}

/** Injectable for offline tests. No Meta connection or PIN generation in this module. */
export function createPinRotationPreparationHandler(deps: RotationDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    if (!deps.isEnabled()) return reply({ ok: false, error: "PIN_ROTATION_NOT_ENABLED" }, 503);
    if (!deps.isTrustedOrigin(request)) return reply({ ok: false, error: "PIN_ROTATION_ORIGIN_DENIED" }, 403);
    let access: RotationAccessResult;
    try { access = await deps.resolveAccess(); }
    catch { return reply({ ok: false, error: "PIN_ROTATION_ACCESS_UNAVAILABLE" }, 503); }
    if (!access.ok) return reply({ ok: false, error: "PIN_ROTATION_ACCESS_DENIED" }, access.httpStatus);
    if (!validUuid(access.sessionUserId)) return reply({ ok: false, error: "PIN_ROTATION_ACCESS_INVALID" }, 403);

    let input: Record<string, unknown>;
    try {
      if (Number(request.headers.get("content-length")) > 8192) throw new Error("too-large");
      const raw = await request.text();
      if (raw.length > 8192) throw new Error("too-large");
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid-json");
      input = parsed as Record<string, unknown>;
    } catch { return reply({ ok: false, error: "PIN_ROTATION_REQUEST_INVALID" }, 400); }

    if (input.consent !== true) return reply({ ok: false, error: "PIN_ROTATION_CONSENT_REQUIRED" }, 400);
    const target = requireIds(input);
    if (!target) return reply({ ok: false, error: "PIN_ROTATION_TARGET_INVALID" }, 400);
    const action = clean(input.action);
    if (action !== "prepare" && action !== "authorize") {
      return reply({ ok: false, error: "PIN_ROTATION_ACTION_INVALID" }, 400);
    }

    let operationId: string;
    let rotationId: string | null = null;
    if (action === "prepare") {
      operationId = deps.operationId();
      if (!validUuid(operationId)) return reply({ ok: false, error: "PIN_ROTATION_OPERATION_INVALID" }, 503);
    } else {
      operationId = clean(input.operationId).toLowerCase();
      rotationId = clean(input.rotationId).toLowerCase();
      if (!validUuid(operationId) || !validUuid(rotationId)) {
        return reply({ ok: false, error: "PIN_ROTATION_OPERATION_INVALID" }, 400);
      }
    }

    let phoneNumberId: string;
    try {
      phoneNumberId = await deps.resolvePhoneTarget({
        actorUserId: access.sessionUserId, ...target,
      });
      if (!PHONE.test(phoneNumberId)) throw new Error("invalid-canonical-phone");
    } catch {
      return reply({ ok: false, error: "PIN_ROTATION_TARGET_UNAVAILABLE" }, 409);
    }

    let bindingHash: string;
    try {
      bindingHash = createWhatsappPinRotationSessionBinding({
        secret: deps.bindingSecret(), actorId: access.sessionUserId,
        operationId, organizationId: target.organizationId,
        storeId: target.storeId, phoneNumberId, sessionCookie: request.headers.get("cookie") ?? "",
      });
    } catch {
      return reply({ ok: false, error: "PIN_ROTATION_BINDING_UNAVAILABLE" }, 503);
    }

    try {
      const client = deps.createServiceClient();
      const name = action === "prepare"
        ? "zion_admin_prepare_whatsapp_pin_rotation_by_system"
        : "zion_admin_authorize_whatsapp_pin_rotation_by_system";
      const args: Record<string, unknown> = action === "prepare"
        ? {
            p_operation_id: operationId,
            p_actor_user_id: access.sessionUserId,
            p_organization_id: target.organizationId,
            p_store_id: target.storeId,
            p_phone_number_id: phoneNumberId,
            p_session_binding_hash: bindingHash,
            p_expires_at: new Date(deps.now().getTime() + 5 * 60_000).toISOString(),
          }
        : {
            p_rotation_id: rotationId, p_operation_id: operationId,
            p_actor_user_id: access.sessionUserId, p_session_binding_hash: bindingHash,
          };
      const { data, error } = await client.rpc(name, args);
      if (error) return reply({ ok: false, error: "PIN_ROTATION_AUTHORITY_REJECTED" }, 409);
      const row = singleRow(data);
      const id = clean(row?.rotation_id).toLowerCase();
      const status = clean(row?.status);
      const outcome = clean(row?.outcome);
      if (!validUuid(id) ||
          (action === "prepare" && (clean(row?.operation_id) !== operationId || status !== "prepared" || outcome !== "created")) ||
          (action === "authorize" && (id !== rotationId || status !== "authorized" || outcome !== "authorized"))) {
        return reply({ ok: false, error: "PIN_ROTATION_AUTHORITY_RESPONSE_INVALID" }, 503);
      }
      return reply({ ok: true, status, rotationId: id, operationId,
        expiresInSeconds: action === "prepare" ? 300 : undefined,
        executionEnabled: false }, 200);
    } catch { return reply({ ok: false, error: "PIN_ROTATION_SERVER_UNAVAILABLE" }, 503); }
  };
}
