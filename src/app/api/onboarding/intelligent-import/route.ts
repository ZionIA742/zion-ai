import { NextResponse } from "next/server";
import { runOnboardingIntelligentImport } from "@/lib/server/onboarding-intelligent-import";
import {
  buildUnsupportedIntelligentImportFileMessage,
  isSupportedIntelligentImportExtension,
} from "@/lib/server/onboarding-file-extractors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const organizationId = String(formData.get("organizationId") || "").trim();
    const storeId = String(formData.get("storeId") || "").trim();

    const uploadedEntries = formData.getAll("files");
    const invalidFileNames = uploadedEntries
      .map((entry) => {
        if (!(entry instanceof File)) return "";
        const extension = entry.name.includes(".") ? entry.name.split(".").pop() || "" : "";
        return isSupportedIntelligentImportExtension(extension) ? "" : entry.name;
      })
      .filter(Boolean);

    if (invalidFileNames.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "ONBOARDING_INTELLIGENT_IMPORT_UNSUPPORTED_FILE",
          message: buildUnsupportedIntelligentImportFileMessage(invalidFileNames),
        },
        { status: 400 }
      );
    }

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
      imageDiagnostics: result.imageDiagnostics,
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
