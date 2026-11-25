import { withBackendDiagnosticRoute } from "../../../../lib/server/zion-admin-diagnostic-backend-next";
import { createDiagnosticAiRunCronGetHandler } from "./route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const zionBackendOriginalGET = createDiagnosticAiRunCronGetHandler();

const zionBackendObservedGET = withBackendDiagnosticRoute(
  "/api/cron/zion-admin-diagnostic-ai-runs",
  "GET",
  zionBackendOriginalGET,
);

export const GET: typeof zionBackendOriginalGET = async function GET(request: Request) {
  return zionBackendObservedGET(request);
};