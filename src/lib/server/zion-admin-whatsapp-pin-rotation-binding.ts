/**
 * ZION-ADM WhatsApp PIN rotation: trusted binding resolver (1.8-C2C).
 *
 * This module is SERVER ONLY. Its return value contains a Meta token and
 * decrypted PIN. Never expose this to an HTTP response, log, or browser.
 *
 * The privileged SQL RPC is the authorization authority: it checks a single
 * authorized operation, admin status, tenant, phone, integration and active
 * encrypted PIN. The begin RPC rechecks the binding before consuming it.
 * This module NEVER changes SQL, generates PINs, or calls Meta.
 */
import type {
  AuthorizedRotation,
  TrustedRotationBinding,
} from "./zion-admin-whatsapp-pin-rotation-execution";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE = /^\d{5,32}$/;
const HEX_HASH = /^[a-f0-9]{64}$/;
const GRAPH_VERSION = /^v\d{1,2}\.\d{1,2}$/;
const PIN = /^\d{6}$/;

type RpcResponse = { data: unknown; error: { message?: string | null } | null };
export type RotationBindingRpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResponse>;
};
export type ActiveEncryptedPin = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: 1;
};
export type RotationBindingDependencies = {
  /** This client MUST use the server-side service_role. Never browser auth. */
  db: RotationBindingRpc;
  /** Reuse WHATSAPP_GRAPH_API_VERSION, same as Embedded Signup. */
  graphApiVersion: () => string | undefined;
  /** Use the existing decryptWhatsappTwoStepPin server-only function. */
  decryptPin: (material: ActiveEncryptedPin) => string;
};

function denied(): Error {
  // Keep all SQL error messages and secret values out of errors/logs.
  return new Error("ZION_ADMIN_PIN_ROTATION_BINDING_UNAVAILABLE");
}
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function validOp(op: AuthorizedRotation): boolean {
  return !!op && UUID.test(text(op.rotationId)) &&
    UUID.test(text(op.operationId)) && UUID.test(text(op.actorUserId)) &&
    HEX_HASH.test(text(op.sessionBindingHash));
}
function soleRow(data: unknown): Record<string, unknown> {
  const value = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw denied();
  return value as Record<string, unknown>;
}

/**
 * Return trusted binding only for a SQL-authorized operation. Every error
 * fails closed and contains no PIN/token/SQL details.
 */
export async function resolveTrustedWhatsappPinRotationBinding(
  op: AuthorizedRotation,
  deps: RotationBindingDependencies,
): Promise<TrustedRotationBinding> {
  if (!validOp(op)) throw denied();
  try {
    const graphApiVersion = text(deps.graphApiVersion());
    if (!GRAPH_VERSION.test(graphApiVersion)) throw denied();

    const { data, error } = await deps.db.rpc(
      "zion_admin_read_whatsapp_pin_rotation_binding_by_system",
      {
        p_rotation_id: op.rotationId,
        p_operation_id: op.operationId,
        p_actor_user_id: op.actorUserId,
        p_session_binding_hash: op.sessionBindingHash,
      },
    );
    if (error) throw denied();
    const row = soleRow(data);
    const organizationId = text(row.organization_id);
    const storeId = text(row.store_id);
    const phoneNumberId = text(row.phone_number_id);
    const integrationId = text(row.integration_id);
    const oldSecretId = text(row.old_secret_id);
    const accessToken = text(row.access_token);
    const ciphertext = text(row.ciphertext);
    const iv = text(row.iv);
    const authTag = text(row.auth_tag);
    const keyVersion = row.key_version;
    if (!UUID.test(organizationId) || !UUID.test(storeId) ||
        !PHONE.test(phoneNumberId) || !UUID.test(integrationId) ||
        !UUID.test(oldSecretId) || accessToken.length < 12 ||
        !ciphertext || !iv || !authTag || keyVersion !== 1) {
      throw denied();
    }

    const activePin = deps.decryptPin({ ciphertext, iv, authTag, keyVersion: 1 });
    if (!PIN.test(activePin)) throw denied();
    return {
      organizationId,
      storeId,
      phoneNumberId,
      integrationId,
      activePin,
      accessToken,
      graphApiVersion,
    };
  } catch {
    throw denied();
  }
}
