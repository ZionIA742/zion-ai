import { withBackendDiagnosticRoute } from "../../../lib/server/zion-admin-diagnostic-backend-next";
import { POST as simulateCustomerPost } from "./handler";

export const runtime = "nodejs";

const zionBackendOriginalPOST = simulateCustomerPost;

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/simulate-customer",
  "POST",
  zionBackendOriginalPOST,
);

export const POST: typeof zionBackendOriginalPOST = async function POST(req: Parameters<typeof zionBackendOriginalPOST>[0]) {
  return zionBackendObservedPOST(req);
};
