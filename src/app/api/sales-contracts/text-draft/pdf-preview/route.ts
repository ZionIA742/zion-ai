import { createContractTextDraftHandlers } from "../route";
import { buildContractTextDraftPdf } from "@/lib/server/sales-contracts/build-contract-text-draft-pdf";
import { createContractTextDraftPdfPreviewHandler } from "@/lib/server/sales-contracts/contract-text-draft-pdf-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PREVIEW ONLY: no storage, canonical version, status change, event or WhatsApp send.
// Reuse the existing authenticated/scoped GET, not user-supplied text.
export const GET = createContractTextDraftPdfPreviewHandler({
  getAuthorizedDraft: createContractTextDraftHandlers().GET,
  renderPdf: buildContractTextDraftPdf,
});
