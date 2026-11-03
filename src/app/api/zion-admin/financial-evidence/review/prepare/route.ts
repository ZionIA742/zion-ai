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

export const POST =
  createFinancialEvidenceReviewPrepareHandler();