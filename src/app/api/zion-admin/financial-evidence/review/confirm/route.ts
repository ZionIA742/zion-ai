import { withBackendDiagnosticRoute } from "../../../../../../lib/server/zion-admin-diagnostic-backend-next";
/**
 * ZION-ADM - Confirmacao de revisao Meta.
 * Nao registra comprovacao financeira.
 * Nao autoriza fechamento definitivo.
 */
import {
  createFinancialEvidenceReviewConfirmHandler,
} from "@/lib/server/zion-admin-financial-evidence-review-confirm-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const zionBackendOriginalPOST = createFinancialEvidenceReviewConfirmHandler();

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/zion-admin/financial-evidence/review/confirm",
  "POST",
  zionBackendOriginalPOST,
);

export const POST: typeof zionBackendOriginalPOST = async function POST(request: Parameters<typeof zionBackendOriginalPOST>[0]) {
  return zionBackendObservedPOST(request);
};