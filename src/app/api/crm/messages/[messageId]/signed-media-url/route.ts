import { withBackendDiagnosticRoute } from "../../../../../../lib/server/zion-admin-diagnostic-backend-next";
import { GET as originalGET } from "./route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withBackendDiagnosticRoute(
  "/api/crm/messages/[messageId]/signed-media-url",
  "GET",
  originalGET,
);
