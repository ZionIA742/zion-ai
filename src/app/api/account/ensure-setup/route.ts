import { withBackendDiagnosticRoute } from "../../../../lib/server/zion-admin-diagnostic-backend-next";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { resolveAccessForRequest } from "@/lib/server/account-access-resolver";
import { handleEnsureSetup } from "./route-handler";

 async function zionBackendOriginalPOST() {
  return handleEnsureSetup({
    createSupabase: createSupabaseServerClient,
    resolveAccess: resolveAccessForRequest,
  });
}

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/account/ensure-setup",
  "POST",
  (_zionRequest?: Request) => zionBackendOriginalPOST(),
);

export async function POST() {
  return zionBackendObservedPOST(arguments[0] as Request | undefined);
}
