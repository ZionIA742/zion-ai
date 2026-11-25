import { withBackendDiagnosticRoute } from "../../../../lib/server/zion-admin-diagnostic-backend-next";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";
import { createWhatsappNumberChangeRouteHandler } from "./route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createWhatsappNumberChangeRouteHandler({
  resolveAccess: () => resolveZionAdminApiAccess({ requiredCapability: "manage_accounts" }),
  createServiceSupabase: () => createServiceSupabaseClient() as never,
});

const zionBackendOriginalPOST = handler;

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/zion-admin/whatsapp-number-change",
  "POST",
  zionBackendOriginalPOST,
);

export const POST: typeof zionBackendOriginalPOST = async function POST(request: Parameters<typeof zionBackendOriginalPOST>[0]) {
  return zionBackendObservedPOST(request);
};
