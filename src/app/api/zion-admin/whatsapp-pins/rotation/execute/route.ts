import { withBackendDiagnosticRoute } from "../../../../../../lib/server/zion-admin-diagnostic-backend-next";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";
import { resolveWhatsappPinRotationPhoneTarget, type RotationTargetDatabase } from "@/lib/server/zion-admin-whatsapp-pin-rotation-target";
import { createWhatsappPinRotationSessionBinding, isTrustedRotationOrigin, type RotationAccessResult } from "@/lib/server/zion-admin-whatsapp-pin-rotation-preparation";
import { createWhatsappPinRotationExecuteHandler } from "@/lib/server/zion-admin-whatsapp-pin-rotation-execute-handler";
import { executeTrustedWhatsappPinRotationWhenEnabled, type TrustedRotationServerInput } from "@/lib/server/zion-admin-whatsapp-pin-rotation-wiring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Both flags are OFF by default. This route does not change existing PIN flows.
const zionBackendOriginalPOST = createWhatsappPinRotationExecuteHandler({
  resolveAccess: () => resolveZionAdminApiAccess({ requiredCapability: "manage_whatsapp_pins" }) as Promise<RotationAccessResult>,
  createServiceClient: () => createServiceSupabaseClient(),
  resolvePhoneTarget: (target) => resolveWhatsappPinRotationPhoneTarget(
    createServiceSupabaseClient() as unknown as RotationTargetDatabase, target,
  ),
  execute: (operation, client) => executeTrustedWhatsappPinRotationWhenEnabled(operation,
    { db: client as unknown as TrustedRotationServerInput["db"] },
  ),
  computeBinding: createWhatsappPinRotationSessionBinding,
  bindingSecret: () => process.env.ZION_ADMIN_WHATSAPP_PIN_ROTATION_AUTH_SECRET ?? "",
  isFeatureEnabled: () => process.env.ZION_ADMIN_WHATSAPP_PIN_ROTATION_ENABLED === "true",
  isExecutionEnabled: () => process.env.ZION_ADMIN_WHATSAPP_PIN_ROTATION_EXECUTION_ENABLED === "true",
  isTrustedOrigin: isTrustedRotationOrigin,
});

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/zion-admin/whatsapp-pins/rotation/execute",
  "POST",
  zionBackendOriginalPOST,
);

export const POST: typeof zionBackendOriginalPOST = async function POST(request: Parameters<typeof zionBackendOriginalPOST>[0]) {
  return zionBackendObservedPOST(request);
};
