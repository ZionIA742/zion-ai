import { withBackendDiagnosticRoute } from "../../../../lib/server/zion-admin-diagnostic-backend-next";
import { createDiagnosticOperationalCronGetHandler } from "./route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const zionBackendOriginalGET = createDiagnosticOperationalCronGetHandler();

const zionBackendObservedGET = withBackendDiagnosticRoute(
  "/api/cron/zion-admin-diagnostic-operational",
  "GET",
  zionBackendOriginalGET,
);

export const GET: typeof zionBackendOriginalGET = async function GET(request: Request) {
  return zionBackendObservedGET(request);
};