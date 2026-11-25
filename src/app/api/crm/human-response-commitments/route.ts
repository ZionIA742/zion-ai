import { withBackendDiagnosticRoute } from "../../../../lib/server/zion-admin-diagnostic-backend-next";
import { GET as originalGET, POST as originalPOST, PATCH as originalPATCH } from "./route-handler";

const zionBackendObservedGET = withBackendDiagnosticRoute(
  "/api/crm/human-response-commitments",
  "GET",
  (request: Request) => originalGET(request),
);

export async function GET(request: Request) {
  return zionBackendObservedGET(request);
}

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/crm/human-response-commitments",
  "POST",
  (request: Request) => originalPOST(request),
);

export async function POST(request: Request) {
  return zionBackendObservedPOST(request);
}

const zionBackendObservedPATCH = withBackendDiagnosticRoute(
  "/api/crm/human-response-commitments",
  "PATCH",
  (request: Request) => originalPATCH(request),
);

export async function PATCH(request: Request) {
  return zionBackendObservedPATCH(request);
}
