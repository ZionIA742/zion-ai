/**
 * ZION-ADM: explicit execution gate for an already authorized PIN rotation.
 * Server only: this handler never accepts a phone ID, PIN, or Meta token from
 * the browser. Both feature flags default to OFF. No retries are performed.
 */
import type { AuthorizedRotation, RotationExecutionOutcome } from "./zion-admin-whatsapp-pin-rotation-execution";
import type { RotationAccessResult } from "./zion-admin-whatsapp-pin-rotation-preparation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE = /^\d{5,32}$/;
const HASH = /^[a-f0-9]{64}$/;

export type ExecuteRotationDeps<Db> = {
  resolveAccess: () => Promise<RotationAccessResult>;
  createServiceClient: () => Db;
  resolvePhoneTarget: (input: { actorUserId: string; organizationId: string; storeId: string; secretId: string }) => Promise<string>;
  execute: (op: AuthorizedRotation, db: Db) => Promise<RotationExecutionOutcome>;
  computeBinding: (input: {
    secret: string; actorId: string; operationId: string;
    organizationId: string; storeId: string; phoneNumberId: string;
    sessionCookie: string;
  }) => string;
  bindingSecret: () => string;
  isFeatureEnabled: () => boolean;
  isExecutionEnabled: () => boolean;
  isTrustedOrigin: (request: Request) => boolean;
};

function text(value: unknown): string { return typeof value === "string" ? value.trim().toLowerCase() : ""; }
function uuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function response(payload: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(payload), { status,
    headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/** Injected dependencies support offline unit tests; no Meta call happens on import. */
export function createWhatsappPinRotationExecuteHandler<Db>(deps: ExecuteRotationDeps<Db>) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    if (!deps.isFeatureEnabled() || !deps.isExecutionEnabled()) {
      return response({ ok: false, error: "PIN_ROTATION_EXECUTION_DISABLED" }, 503);
    }
    if (!deps.isTrustedOrigin(request)) return response({ ok: false, error: "PIN_ROTATION_ORIGIN_DENIED" }, 403);

    let access: RotationAccessResult;
    try { access = await deps.resolveAccess(); }
    catch { return response({ ok: false, error: "PIN_ROTATION_ACCESS_UNAVAILABLE" }, 503); }
    if (!access.ok) return response({ ok: false, error: "PIN_ROTATION_ACCESS_DENIED" }, access.httpStatus);
    if (!uuid(access.sessionUserId)) return response({ ok: false, error: "PIN_ROTATION_ACCESS_INVALID" }, 403);

    let body: Record<string, unknown>;
    try {
      if (Number(request.headers.get("content-length")) > 8192) throw Error("too-large");
      const raw = await request.text();
      if (raw.length > 8192) throw Error("too-large");
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error("bad-json");
      body = parsed as Record<string, unknown>;
    } catch { return response({ ok: false, error: "PIN_ROTATION_REQUEST_INVALID" }, 400); }

    if (body.action !== "execute" || body.consent !== true) {
      return response({ ok: false, error: "PIN_ROTATION_EXPLICIT_CONSENT_REQUIRED" }, 400);
    }
    // Only allow a listed secret UUID: never trust a raw phone, token, or PIN.
    if (["phoneNumberId", "accessToken", "pin", "newPin", "sessionBindingHash"].some(k => Object.hasOwn(body, k))) {
      return response({ ok: false, error: "PIN_ROTATION_UNTRUSTED_FIELDS" }, 400);
    }
    const organizationId = text(body.organizationId);
    const storeId = text(body.storeId);
    const secretId = text(body.secretId);
    const operationId = text(body.operationId);
    const rotationId = text(body.rotationId);
    if (![organizationId, storeId, secretId, operationId, rotationId].every(uuid)) {
      return response({ ok: false, error: "PIN_ROTATION_IDENTIFIERS_INVALID" }, 400);
    }

    let phoneNumberId: string;
    try {
      phoneNumberId = await deps.resolvePhoneTarget({
        actorUserId: access.sessionUserId, organizationId, storeId, secretId,
      });
      if (!PHONE.test(phoneNumberId)) throw Error("phone-target-invalid");
    } catch { return response({ ok: false, error: "PIN_ROTATION_TARGET_UNAVAILABLE" }, 409); }

    let sessionBindingHash: string;
    try {
      sessionBindingHash = deps.computeBinding({
        secret: deps.bindingSecret(), actorId: access.sessionUserId,
        operationId, organizationId, storeId, phoneNumberId,
        sessionCookie: request.headers.get("cookie") ?? "",
      });
      if (!HASH.test(sessionBindingHash)) throw Error("invalid-binding");
    } catch { return response({ ok: false, error: "PIN_ROTATION_BINDING_UNAVAILABLE" }, 503); }

    try {
      const outcome = await deps.execute({
        rotationId, operationId, actorUserId: access.sessionUserId, sessionBindingHash,
      }, deps.createServiceClient());
      // Never expose sensitive SQL errors, Meta tokens, the old/new PIN, or any material.
      const states = new Set(["completed", "remote_rejected", "remote_uncertain",
        "manual_reconciliation_required", "preflight_denied", "authorization_rejected"]);
      if (!outcome || !states.has(outcome.state) || outcome.rotationId !== rotationId ||
          outcome.ok !== (outcome.state === "completed")) {
        return response({ ok: false, status: "manual_reconciliation_required" }, 409);
      }
      return response({ ok: outcome.state === "completed", status: outcome.state },
        outcome.state === "completed" ? 200 : 409);
    } catch {
      // The remote request may already have run. Never retry automatically.
      return response({ ok: false, status: "manual_reconciliation_required" }, 409);
    }
  };
}
