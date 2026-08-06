import { NextResponse } from "next/server";
import {
  runOnboardingIntelligentImport,
  type IntelligentImportResult,
} from "@/lib/server/onboarding-intelligent-import";
import {
  buildUnsupportedIntelligentImportFileMessage,
  isSupportedIntelligentImportExtension,
} from "@/lib/server/onboarding-file-extractors";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IntelligentImportRouteDeps = {
  resolveAccess: (params: {
    requirement: "active_or_onboarding";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  runImport: typeof runOnboardingIntelligentImport;
};

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");

  return NextResponse.json(body, {
    ...init,
    headers,
  });
}

export function createIntelligentImportPostHandler(
  deps: Partial<IntelligentImportRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const runImport = deps.runImport ?? runOnboardingIntelligentImport;

  return async function POST(request: Request) {
    const access = await resolveAccess({
      requirement: "active_or_onboarding",
    });

    if (!access.ok) {
      return createStoreApiDeniedResponse(access);
    }

    try {
      const formData = await request.formData();
      const debugParserRaw = String(formData.get("debugParser") || "").trim().toLowerCase();
      const debugParser =
        debugParserRaw === "1" || debugParserRaw === "true" || debugParserRaw === "yes";

      const uploadedEntries = formData.getAll("files");
      const invalidFileNames = uploadedEntries
        .map((entry) => {
          if (!(entry instanceof File)) return "";
          const extension = entry.name.includes(".") ? entry.name.split(".").pop() || "" : "";
          return isSupportedIntelligentImportExtension(extension) ? "" : entry.name;
        })
        .filter(Boolean);

      if (invalidFileNames.length > 0) {
        return jsonNoStore(
          {
            ok: false,
            error: "ONBOARDING_INTELLIGENT_IMPORT_UNSUPPORTED_FILE",
            message: buildUnsupportedIntelligentImportFileMessage(invalidFileNames),
          },
          { status: 400 },
        );
      }

      const files = await Promise.all(
        uploadedEntries.map(async (entry) => {
          if (!(entry instanceof File)) {
            throw new Error("Um dos arquivos enviados e invalido.");
          }

          const arrayBuffer = await entry.arrayBuffer();

          return {
            fileName: entry.name,
            mimeType: entry.type || "application/octet-stream",
            buffer: Buffer.from(arrayBuffer),
          };
        }),
      );

      const result = await runImport({
        organizationId: access.organizationId,
        storeId: access.storeId,
        files,
        debugParser,
        uploadedBy: access.sessionUserId,
        persistRawFiles: true,
        source: "onboarding_intelligent_import",
      });

      if (!result.ok) {
        return jsonNoStore(
          {
            ok: false,
            error: result.error,
            message: result.message,
          },
          { status: 400 },
        );
      }

      return jsonNoStore({
        ok: true,
        message: "Importacao inteligente processada com sucesso.",
        summary: result.summary,
        importedFileIds: result.importedFileIds,
        importedFiles: result.importedFiles,
        mediaStagingWarnings: result.mediaStagingWarnings,
        rawFilePersistenceWarnings: result.rawFilePersistenceWarnings,
        stagedMediaAssetIds: result.stagedMediaAssetIds,
        stagedMediaAssets: result.stagedMediaAssets,
        extractedPreview: result.extractedPreview,
        extractedImagePreview: result.extractedImagePreview,
        imageDiagnostics: result.imageDiagnostics,
        normalizedPreview: result.normalizedPreview,
        dedupedPreview: result.dedupedPreview,
        parserDebug: result.parserDebug,
      });
    } catch (error: any) {
      return jsonNoStore(
        {
          ok: false,
          error: "ONBOARDING_INTELLIGENT_IMPORT_ROUTE_FAILED",
          message:
            error?.message ||
            "Erro interno ao processar rota de importacao inteligente.",
        },
        { status: 500 },
      );
    }
  };
}

export function createIntelligentImportGetHandler(
  deps: Partial<Pick<IntelligentImportRouteDeps, "resolveAccess">> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;

  return async function GET() {
    const access = await resolveAccess({
      requirement: "active_or_onboarding",
    });

    if (!access.ok) {
      return createStoreApiDeniedResponse(access);
    }

    return jsonNoStore({
      ok: true,
      route: "onboarding/intelligent-import",
      method: "POST",
      message: "Rota de importacao inteligente publicada.",
    });
  };
}

export const POST = createIntelligentImportPostHandler();
export const GET = createIntelligentImportGetHandler();
