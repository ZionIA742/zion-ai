import { withBackendDiagnosticRoute } from "../../../../../lib/server/zion-admin-diagnostic-backend-next";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";
import { writeZionAdminAuditEvent } from "@/lib/server/zion-admin-audit";
import { handleAccessStateMutation } from "./route-handler";

 async function zionBackendOriginalPOST(request: Request) {
  return handleAccessStateMutation(request, {
    resolveAccess: () =>
      resolveZionAdminApiAccess({ requiredCapability: "manage_accounts" }),
    createServiceSupabase: createServiceSupabaseClient,
    writeAuditEvent: writeZionAdminAuditEvent,
  });
}

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/zion-admin/accounts/access-state",
  "POST",
  zionBackendOriginalPOST,
);

export async function POST(request: Request) {
  return zionBackendObservedPOST(request);
}
