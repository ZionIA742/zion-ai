import { withBackendDiagnosticRoute } from "../../../../../lib/server/zion-admin-diagnostic-backend-next";
import {
  createWhatsappPinRecoveryGetHandler,
  createWhatsappPinRecoveryPostHandler,
} from "@/lib/server/whatsapp-pin-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const zionBackendOriginalPOST = createWhatsappPinRecoveryPostHandler();

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/zion-admin/whatsapp-pins/recovery",
  "POST",
  zionBackendOriginalPOST,
);

export const POST: typeof zionBackendOriginalPOST = async function POST(request: Parameters<typeof zionBackendOriginalPOST>[0]) {
  return zionBackendObservedPOST(request);
};
const zionBackendOriginalGET = createWhatsappPinRecoveryGetHandler();

const zionBackendObservedGET = withBackendDiagnosticRoute(
  "/api/zion-admin/whatsapp-pins/recovery",
  "GET",
  (_zionRequest?: Request) => zionBackendOriginalGET(),
);

export const GET: typeof zionBackendOriginalGET = async function GET() {
  return zionBackendObservedGET(arguments[0] as Request | undefined);
};
