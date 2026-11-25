import { withBackendDiagnosticRoute } from "../../../../../lib/server/zion-admin-diagnostic-backend-next";
import { createWhatsappNumberChangeLinkRouteHandler } from "./route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createWhatsappNumberChangeLinkRouteHandler();
const zionBackendOriginalGET = handlers.GET;

const zionBackendObservedGET = withBackendDiagnosticRoute(
  "/api/store/whatsapp/number-change-link",
  "GET",
  zionBackendOriginalGET,
);

export const GET: typeof zionBackendOriginalGET = async function GET(request: Parameters<typeof zionBackendOriginalGET>[0]) {
  return zionBackendObservedGET(request);
};
const zionBackendOriginalPOST = handlers.POST;

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/store/whatsapp/number-change-link",
  "POST",
  zionBackendOriginalPOST,
);

export const POST: typeof zionBackendOriginalPOST = async function POST(request: Parameters<typeof zionBackendOriginalPOST>[0]) {
  return zionBackendObservedPOST(request);
};
