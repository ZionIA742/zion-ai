import { NextResponse } from "next/server";
import {
  IntelligentImportSaveAccessError,
  saveApprovedIntelligentImportItems,
} from "@/lib/server/onboarding-intelligent-import-save";
import type { IntelligentImportSaveApprovedRequest } from "@/lib/onboarding-intelligent-import-save-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<IntelligentImportSaveApprovedRequest>;
    const payload: IntelligentImportSaveApprovedRequest = {
      context: body.context,
      importedFileIds: Array.isArray(body.importedFileIds) ? body.importedFileIds : [],
      items: Array.isArray(body.items) ? body.items : [],
      organizationId: String(body.organizationId || "").trim(),
      reviewAudit: body.reviewAudit,
      selectedMediaRefs: Array.isArray(body.selectedMediaRefs) ? body.selectedMediaRefs : [],
      storeId: String(body.storeId || "").trim(),
      validateOnly: Boolean(body.validateOnly),
    };

    const result = await saveApprovedIntelligentImportItems(payload);
    return NextResponse.json(result, {
      status: result.ok ? 200 : payload.validateOnly ? 200 : 409,
    });
  } catch (error) {
    if (error instanceof IntelligentImportSaveAccessError) {
      return NextResponse.json(
        {
          items: [],
          message: error.message,
          ok: false,
          summary: {
            blockedDuplicate: 0,
            invalid: 0,
            saved: 0,
            total: 0,
            valid: 0,
          },
          validateOnly: true,
        },
        { status: error.status }
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "Erro interno ao salvar itens aprovados da importacao inteligente.";

    return NextResponse.json(
      {
        items: [],
        message,
        ok: false,
        summary: {
          blockedDuplicate: 0,
          invalid: 0,
          saved: 0,
          total: 0,
          valid: 0,
        },
        validateOnly: true,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "onboarding/intelligent-import/save-approved",
    method: "POST",
    message: "Rota de salvamento server-side do Upload Inteligente publicada.",
  });
}
