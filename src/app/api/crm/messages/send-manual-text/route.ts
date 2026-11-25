import { withBackendDiagnosticRoute } from "../../../../../lib/server/zion-admin-diagnostic-backend-next";
import { POST as originalPOST } from "./route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withBackendDiagnosticRoute(
  "/api/crm/messages/send-manual-text",
  "POST",
  originalPOST,
);
