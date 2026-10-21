import { randomUUID } from "node:crypto";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";
import { resolveWhatsappPinRotationPhoneTarget, type RotationTargetDatabase } from "@/lib/server/zion-admin-whatsapp-pin-rotation-target";
import { createPinRotationPreparationHandler, isTrustedRotationOrigin, type RotationAccessResult, type RotationRpc } from "@/lib/server/zion-admin-whatsapp-pin-rotation-preparation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prepare or authorize only. No PIN generation, no call to Meta, no activation. */
export const POST = createPinRotationPreparationHandler({
  resolveAccess: () => resolveZionAdminApiAccess({ requiredCapability: "manage_whatsapp_pins" }) as Promise<RotationAccessResult>,
  createServiceClient: () => createServiceSupabaseClient() as unknown as RotationRpc,
  isEnabled: () => process.env.ZION_ADMIN_WHATSAPP_PIN_ROTATION_ENABLED === "true",
  isTrustedOrigin: isTrustedRotationOrigin,
  bindingSecret: () => process.env.ZION_ADMIN_WHATSAPP_PIN_ROTATION_AUTH_SECRET ?? "",
  now: () => new Date(),
  operationId: randomUUID,
  resolvePhoneTarget: (target) => resolveWhatsappPinRotationPhoneTarget(
    createServiceSupabaseClient() as unknown as RotationTargetDatabase, target,
  ),
});
