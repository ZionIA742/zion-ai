import { withBackendDiagnosticRoute } from "../../../../../../lib/server/zion-admin-diagnostic-backend-next";
/**
 * ZION-ADM / 8-E.11-D.3-C.3-E.2-C.3-A
 *
 * Visualizacao autenticada do documento original.
 *
 * Somente leitura. Nenhuma aprovacao financeira.
 */

import {
  createFinancialEvidencePrivateViewHandler,
} from "@/lib/server/zion-admin-financial-evidence-private-view-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const zionBackendOriginalPOST = createFinancialEvidencePrivateViewHandler();

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/zion-admin/financial-evidence/review/document",
  "POST",
  zionBackendOriginalPOST,
);

export const POST: typeof zionBackendOriginalPOST = async function POST(request: Parameters<typeof zionBackendOriginalPOST>[0]) {
  return zionBackendObservedPOST(request);
};