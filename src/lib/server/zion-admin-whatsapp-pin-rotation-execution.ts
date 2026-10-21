/**
 * ZION-ADM PIN rotation, stage 1.8-C2A: offline-tested orchestration core.
 *
 * Not an HTTP endpoint. This module MUST NOT be exposed until a separate
 * server-side credential resolver has been audited and an explicit execution
 * feature gate is in place. Never pass a Meta token or PIN from browser JSON.
 *
 * The SQL authority consumes exactly one prepared+authorized operation before
 * any Meta call. An uncertain response is NEVER retried or finalized here.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGITS = /^\d{6}$/;
const PHONE = /^\d{5,32}$/;
const HEX_HASH = /^[a-f0-9]{64}$/;
const GRAPH_VERSION = /^v\d{1,2}\.\d{1,2}$/;

type RpcResponse = { data: unknown; error: { message?: string | null } | null };
export type RotationExecutionRpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResponse>;
};
export type AuthorizedRotation = {
  rotationId: string;
  operationId: string;
  actorUserId: string;
  sessionBindingHash: string;
};

/** Must originate from trusted server-side queries and a server-held token vault. */
export type TrustedRotationBinding = {
  organizationId: string;
  storeId: string;
  phoneNumberId: string;
  integrationId: string;
  /** Read from the locally protected active PIN, never from a browser form. */
  activePin: string;
  /** Retrieved by a dedicated server-side credential resolver. */
  accessToken: string;
  graphApiVersion: string;
};
export type RemotePinObservation = {
  result: "confirmed" | "rejected" | "uncertain";
  httpStatus: number | null;
  metaErrorCode: string | null;
  requestId: string | null;
  evidenceHash: string | null;
};
export type EncryptedPinMaterial = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};
export type PinRotationExecutionDeps = {
  db: RotationExecutionRpc;
  /** Must confirm the authorized operation's exact organization/store/phone/integration. */
  loadTrustedBinding: (operation: AuthorizedRotation) => Promise<TrustedRotationBinding>;
  generateSecurePin: () => string;
  encryptPin: (pin: string) => EncryptedPinMaterial;
  setMetaPin: (input: {
    phoneNumberId: string;
    accessToken: string;
    graphApiVersion: string;
    newPin: string;
  }) => Promise<RemotePinObservation>;
};
export type RotationExecutionOutcome = {
  ok: boolean;
  rotationId: string;
  state:
    | "completed"
    | "remote_rejected"
    | "remote_uncertain"
    | "manual_reconciliation_required"
    | "preflight_denied"
    | "authorization_rejected";
};

class RotationSqlDenial extends Error {
  constructor() { super("PIN_ROTATION_RPC_DENIED"); }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function validUuid(value: string): boolean {
  return UUID.test(value);
}
function oneRow(data: unknown): Record<string, unknown> | null {
  const value = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
function outcome(op: AuthorizedRotation, state: RotationExecutionOutcome["state"]): RotationExecutionOutcome {
  return { ok: state === "completed", rotationId: op.rotationId, state };
}
function validOperation(op: AuthorizedRotation): boolean {
  return validUuid(op.rotationId) && validUuid(op.operationId) &&
    validUuid(op.actorUserId) && HEX_HASH.test(op.sessionBindingHash);
}
function validTrustedBinding(binding: TrustedRotationBinding): boolean {
  return validUuid(binding.organizationId) && validUuid(binding.storeId) &&
    validUuid(binding.integrationId) && PHONE.test(binding.phoneNumberId) &&
    DIGITS.test(binding.activePin) && GRAPH_VERSION.test(binding.graphApiVersion) &&
    typeof binding.accessToken === "string" && binding.accessToken.trim().length >= 12;
}
function validMaterial(material: EncryptedPinMaterial): boolean {
  return !!material && typeof material.ciphertext === "string" && material.ciphertext.length > 0 &&
    typeof material.iv === "string" && material.iv.length > 0 &&
    typeof material.authTag === "string" && material.authTag.length > 0 &&
    Number.isSafeInteger(material.keyVersion) && material.keyVersion > 0;
}
function validatedObservation(value: RemotePinObservation): RemotePinObservation {
  if (!value || typeof value !== "object") {
    return { result: "uncertain", httpStatus: null, metaErrorCode: null, requestId: null, evidenceHash: null };
  }
  const httpStatus = Number.isInteger(value.httpStatus) &&
    (value.httpStatus as number) >= 100 && (value.httpStatus as number) <= 599
    ? value.httpStatus : null;
  const evidenceHash = typeof value.evidenceHash === "string" && HEX_HASH.test(value.evidenceHash)
    ? value.evidenceHash : null;
  const metaErrorCode = typeof value.metaErrorCode === "string" && /^\d{1,12}$/.test(value.metaErrorCode)
    ? value.metaErrorCode : null;
  const requestId = typeof value.requestId === "string" && value.requestId.length <= 256
    ? value.requestId : null;

  if (value.result === "confirmed" && httpStatus !== null && httpStatus >= 200 &&
      httpStatus <= 299 && evidenceHash) {
    return { result: "confirmed", httpStatus, metaErrorCode: null, requestId, evidenceHash };
  }
  if (value.result === "rejected" && [400, 401, 403].includes(httpStatus ?? -1) && metaErrorCode) {
    return { result: "rejected", httpStatus, metaErrorCode, requestId, evidenceHash };
  }
  return { result: "uncertain", httpStatus, metaErrorCode, requestId, evidenceHash };
}
async function rpcRow(db: RotationExecutionRpc, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new RotationSqlDenial();
  const row = oneRow(data);
  if (!row) throw new Error("PIN_ROTATION_RPC_RESPONSE_INVALID");
  return row;
}

/**
 * IMPORTANT: no retries, including after an RPC error or malformed response.
 * A prior claim could have committed even when its response could not be read.
 */
export async function executeAuthorizedWhatsappPinRotation(
  op: AuthorizedRotation,
  deps: PinRotationExecutionDeps,
): Promise<RotationExecutionOutcome> {
  if (!validOperation(op)) return outcome(op, "preflight_denied");
  let binding: TrustedRotationBinding;
  try {
    binding = await deps.loadTrustedBinding(op);
    if (!validTrustedBinding(binding)) return outcome(op, "preflight_denied");
  } catch {
    return outcome(op, "preflight_denied");
  }

  // A new PIN must differ from the currently active PIN; generate server-side.
  let pin = "";
  for (let attempt = 0; attempt < 16; attempt++) {
    try { pin = deps.generateSecurePin(); }
    catch { return outcome(op, "preflight_denied"); }
    if (!DIGITS.test(pin)) return outcome(op, "preflight_denied");
    if (pin !== binding.activePin) break;
  }
  if (pin === binding.activePin) return outcome(op, "preflight_denied");

  let material: EncryptedPinMaterial;
  try {
    material = deps.encryptPin(pin);
    if (!validMaterial(material)) return outcome(op, "preflight_denied");
  } catch {
    return outcome(op, "preflight_denied");
  }

  // This transaction must atomically verify/consume same-session authorization,
  // create the encrypted pending PIN, and claim the operation exactly once.
  try {
    const claimed = await rpcRow(deps.db, "zion_admin_begin_whatsapp_pin_rotation_by_system", {
      p_rotation_id: op.rotationId,
      p_operation_id: op.operationId,
      p_actor_user_id: op.actorUserId,
      p_session_binding_hash: op.sessionBindingHash,
      p_ciphertext: material.ciphertext,
      p_iv: material.iv,
      p_auth_tag: material.authTag,
      p_key_version: material.keyVersion,
    });
    if (clean(claimed.rotation_id) !== op.rotationId ||
        clean(claimed.status) !== "executing" ||
        !validUuid(clean(claimed.new_secret_id)) ||
        clean(claimed.phone_number_id) !== binding.phoneNumberId ||
        clean(claimed.integration_id) !== binding.integrationId) {
      // Claim may have committed. Never attempt Meta until reviewed.
      return outcome(op, "manual_reconciliation_required");
    }
  } catch (error) {
    // A definite SQL rejection rolls back the claim. Connection loss is
    // ambiguous: the claim may have committed, so require manual review.
    return outcome(op, error instanceof RotationSqlDenial
      ? "authorization_rejected" : "manual_reconciliation_required");
  }

  let remote: RemotePinObservation;
  try {
    remote = validatedObservation(await deps.setMetaPin({
      phoneNumberId: binding.phoneNumberId,
      accessToken: binding.accessToken,
      graphApiVersion: binding.graphApiVersion,
      newPin: pin,
    }));
  } catch {
    remote = { result: "uncertain", httpStatus: null, metaErrorCode: null,
      requestId: null, evidenceHash: null };
  }

  // Persist exactly the observed outcome, without leaking or logging secrets.
  const status = remote.result === "confirmed" ? "remote_confirmed" :
    remote.result === "rejected" ? "remote_rejected" : "remote_uncertain";
  try {
    const recorded = await rpcRow(deps.db, "zion_admin_record_whatsapp_pin_rotation_result_by_system", {
      p_rotation_id: op.rotationId,
      p_operation_id: op.operationId,
      p_actor_user_id: op.actorUserId,
      p_result: remote.result,
      p_http_status: remote.httpStatus,
      p_meta_error_code: remote.metaErrorCode,
      p_meta_request_id: remote.requestId,
      p_evidence_hash: remote.evidenceHash,
    });
    if (clean(recorded.rotation_id) !== op.rotationId || clean(recorded.status) !== status ||
        clean(recorded.outcome) !== "recorded") {
      return outcome(op, "manual_reconciliation_required");
    }
  } catch {
    return outcome(op, "manual_reconciliation_required");
  }

  if (remote.result === "rejected") return outcome(op, "remote_rejected");
  if (remote.result !== "confirmed") return outcome(op, "remote_uncertain");

  // Only a confirmed Meta observation is allowed to activate the pending PIN.
  try {
    const finalized = await rpcRow(deps.db, "zion_admin_finalize_whatsapp_pin_rotation_by_system", {
      p_rotation_id: op.rotationId,
      p_operation_id: op.operationId,
      p_actor_user_id: op.actorUserId,
    });
    if (clean(finalized.rotation_id) !== op.rotationId ||
        clean(finalized.status) !== "completed" ||
        !validUuid(clean(finalized.new_secret_id)) ||
        clean(finalized.outcome) !== "completed") {
      return outcome(op, "manual_reconciliation_required");
    }
    return outcome(op, "completed");
  } catch {
    // Meta may already have changed the PIN. Do not call Meta again.
    return outcome(op, "manual_reconciliation_required");
  }
}
