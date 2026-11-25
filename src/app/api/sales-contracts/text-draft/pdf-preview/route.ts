import { withBackendDiagnosticRoute } from "../../../../../lib/server/zion-admin-diagnostic-backend-next";
import { createContractTextDraftHandlers } from "../route-handler";
import { buildContractTextDraftPdf } from "@/lib/server/sales-contracts/build-contract-text-draft-pdf";
import { createContractTextDraftPdfPreviewHandler } from "@/lib/server/sales-contracts/contract-text-draft-pdf-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PREVIEW ONLY: no storage, canonical version, status change, event or WhatsApp send.
// Reuse the existing authenticated/scoped GET, not user-supplied text.
const zionBackendOriginalGET = createContractTextDraftPdfPreviewHandler({
  getAuthorizedDraft: createContractTextDraftHandlers().GET,
  renderPdf: buildContractTextDraftPdf,
});

const zionBackendObservedGET = withBackendDiagnosticRoute(
  "/api/sales-contracts/text-draft/pdf-preview",
  "GET",
  zionBackendOriginalGET,
);

export const GET: typeof zionBackendOriginalGET = async function GET(request: Parameters<typeof zionBackendOriginalGET>[0]) {
  return zionBackendObservedGET(request);
};
