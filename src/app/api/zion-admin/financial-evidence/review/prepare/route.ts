import { withBackendDiagnosticRoute } from "../../../../../../lib/server/zion-admin-diagnostic-backend-next";
/**
 * ZION-ADM / 8-E.11-D.3-C.3-E.2-B
 *
 * Somente prepara revisao financeira.
 * Nao aprova comprovantes nem executa fechamento.
 */

import {
  createFinancialEvidenceReviewPrepareHandler,
} from "@/lib/server/zion-admin-financial-evidence-review-prepare-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const zionBackendOriginalPOST = createFinancialEvidenceReviewPrepareHandler();

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/zion-admin/financial-evidence/review/prepare",
  "POST",
  zionBackendOriginalPOST,
);

export const POST: typeof zionBackendOriginalPOST = async function POST(request: Parameters<typeof zionBackendOriginalPOST>[0]) {
  return zionBackendObservedPOST(request);
};