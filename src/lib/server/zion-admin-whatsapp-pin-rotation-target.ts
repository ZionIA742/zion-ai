/**
 * ZION-ADM: resolve a masked PIN row to the canonical WhatsApp phone server-side.
 * Must be called ONLY after the HTTP layer has granted manage_whatsapp_pins.
 * Service-role client is required. Never return phone IDs to browser JSON.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE = /^\d{5,32}$/;

type DbResponse = { data: unknown; error: unknown };
type Query = {
  eq(column: string, value: string): Query;
  maybeSingle(): PromiseLike<DbResponse>;
};
export type RotationTargetDatabase = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResponse>;
  from(table: string): { select(columns: string): Query };
};
export type RotationTargetRequest = {
  actorUserId: string;
  organizationId: string;
  storeId: string;
  secretId: string;
};

function denied(): Error {
  return new Error("ZION_ADMIN_PIN_ROTATION_TARGET_UNAVAILABLE");
}
function value(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}
function normalizedUuid(input: unknown): string {
  return value(input).toLowerCase();
}
function row(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : null;
}

export async function resolveWhatsappPinRotationPhoneTarget(
  db: RotationTargetDatabase,
  input: RotationTargetRequest,
): Promise<string> {
  const actorUserId = normalizedUuid(input.actorUserId);
  const organizationId = normalizedUuid(input.organizationId);
  const storeId = normalizedUuid(input.storeId);
  const secretId = normalizedUuid(input.secretId);
  if (![actorUserId, organizationId, storeId, secretId].every((id) => UUID.test(id))) {
    throw denied();
  }

  try {
    // The existing administrative list authority gates the PIN on this admin,
    // organization, store and secret. A browser-provided UUID is never enough.
    const listed = await db.rpc("list_zion_admin_whatsapp_pins_by_system", {
      p_actor_user_id: actorUserId,
    });
    if (listed.error || !Array.isArray(listed.data)) throw denied();
    const matching = listed.data.filter((item) => {
      const pin = row(item);
      return pin && normalizedUuid(pin.secret_id) === secretId &&
        normalizedUuid(pin.organization_id) === organizationId &&
        normalizedUuid(pin.store_id) === storeId &&
        pin.secret_status === "active" && pin.can_reveal === true;
    });
    if (matching.length !== 1) throw denied();

    const secretResult = await db.from("whatsapp_phone_security_secrets")
      .select("id,organization_id,store_id,phone_number_id,external_integration_id,provider,secret_kind,status")
      .eq("id", secretId)
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("provider", "whatsapp")
      .eq("secret_kind", "two_step_verification_pin")
      .eq("status", "active")
      .maybeSingle();
    const secret = row(secretResult.data);
    if (secretResult.error || !secret ||
      normalizedUuid(secret.id) !== secretId ||
      normalizedUuid(secret.organization_id) !== organizationId ||
      normalizedUuid(secret.store_id) !== storeId ||
      secret.provider !== "whatsapp" || secret.secret_kind !== "two_step_verification_pin" ||
      secret.status !== "active") throw denied();
    const phoneNumberId = value(secret.phone_number_id);
    const integrationId = normalizedUuid(secret.external_integration_id);
    if (!PHONE.test(phoneNumberId) || !UUID.test(integrationId)) throw denied();

    const integrationResult = await db.from("external_integrations")
      .select("id,organization_id,store_id,phone_number_id,provider,status,is_active")
      .eq("id", integrationId)
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("phone_number_id", phoneNumberId)
      .eq("provider", "whatsapp")
      .eq("status", "active")
      .maybeSingle();
    const integration = row(integrationResult.data);
    if (integrationResult.error || !integration ||
      normalizedUuid(integration.id) !== integrationId ||
      normalizedUuid(integration.organization_id) !== organizationId ||
      normalizedUuid(integration.store_id) !== storeId ||
      value(integration.phone_number_id) !== phoneNumberId ||
      integration.provider !== "whatsapp" || integration.status !== "active" ||
      integration.is_active !== true) throw denied();

    return phoneNumberId;
  } catch {
    throw denied();
  }
}
