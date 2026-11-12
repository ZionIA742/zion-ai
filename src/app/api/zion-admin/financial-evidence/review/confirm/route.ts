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

export const POST =
  createFinancialEvidenceReviewConfirmHandler();