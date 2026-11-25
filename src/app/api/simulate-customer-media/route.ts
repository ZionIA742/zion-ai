import { withBackendDiagnosticRoute } from "../../../lib/server/zion-admin-diagnostic-backend-next";
import { POST as simulateCustomerMediaPost } from "./handler";

export const runtime = "nodejs";
const zionBackendOriginalPOST = simulateCustomerMediaPost;

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/simulate-customer-media",
  "POST",
  zionBackendOriginalPOST,
);

export const POST: typeof zionBackendOriginalPOST = async function POST(request: Parameters<typeof zionBackendOriginalPOST>[0]) {
  return zionBackendObservedPOST(request);
};
