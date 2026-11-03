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

export const POST =
  createFinancialEvidencePrivateViewHandler();