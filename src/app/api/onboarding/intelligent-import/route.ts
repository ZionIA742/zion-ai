import { NextResponse } from "next/server";
import { runOnboardingIntelligentImport } from "@/lib/server/onboarding-intelligent-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const organizationId = String(formData.get("organizationId") || "").trim();
    const storeId = String(formData.get("storeId") || "").trim();

    const uploadedEntries = formData.getAll("files");
    const files = await Promise.all(
      uploadedEntries.map(async (entry) => {
        if (!(entry instanceof File)) {
          throw new Error("Um dos arquivos enviados é inválido.");
        }

        const arrayBuffer = await entry.arrayBuffer();

        return {
          fileName: entry.name,
          mimeType: entry.type || "application/octet-stream",
          buffer: Buffer.from(arrayBuffer),
        };
      })
    );

    const result = await runOnboardingIntelligentImport({
      organizationId,
      storeId,
      files,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          message: result.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Importação inteligente processada com sucesso.",
      summary: result.summary,
      extractedPreview: result.extractedPreview,
      extractedImagePreview: result.extractedImagePreview,
      normalizedPreview: result.normalizedPreview,
      dedupedPreview: result.dedupedPreview,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ONBOARDING_INTELLIGENT_IMPORT_ROUTE_FAILED",
        message:
          error?.message ||
          "Erro interno ao processar rota de importação inteligente.",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "onboarding/intelligent-import",
    method: "POST",
    message: "Rota de importação inteligente publicada.",
  });
}
