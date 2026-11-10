/**
 * Revisao conjunta Meta - somente confirmacao
 * contextual. Nao escreve despesas financeiras.
 */
import {
  createMetaDocumentBatchReviewHandler,
} from "@/lib/server/zion-admin-meta-document-batch-review-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createMetaDocumentBatchReviewHandler();