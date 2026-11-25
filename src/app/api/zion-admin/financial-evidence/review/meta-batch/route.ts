import { withBackendDiagnosticRoute } from "../../../../../../lib/server/zion-admin-diagnostic-backend-next";
/**
 * Revisao conjunta Meta - somente confirmacao
 * contextual. Nao escreve despesas financeiras.
 */
import {
  createMetaDocumentBatchReviewHandler,
} from "@/lib/server/zion-admin-meta-document-batch-review-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const zionBackendOriginalPOST = createMetaDocumentBatchReviewHandler();

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/zion-admin/financial-evidence/review/meta-batch",
  "POST",
  zionBackendOriginalPOST,
);

export const POST: typeof zionBackendOriginalPOST = async function POST(request: Parameters<typeof zionBackendOriginalPOST>[0]) {
  return zionBackendObservedPOST(request);
};