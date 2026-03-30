import {
  extractTextFromFile,
  type ExtractedImageAsset,
} from "./onboarding-file-extractors";
import {
  normalizeMultipleExtractedFiles,
  type NormalizedImportItem,
} from "./onboarding-import-normalizers";
import {
  dedupNormalizedItems,
  type DedupedImportItem,
} from "./onboarding-import-dedup";

export type ImportableFile = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

export type IntelligentImportParams = {
  organizationId: string;
  storeId: string;
  files: ImportableFile[];
};

export type IntelligentImportResult =
  | {
      ok: true;
      summary: {
        totalFiles: number;
        extractedFiles: number;
        normalizedItems: number;
        dedupedItems: number;
        duplicateItems: number;
        extractedImages: number;
      };
      extractedPreview: Array<{
        fileName: string;
        mimeType: string;
        extension: string;
        textPreview: string;
      }>;
      extractedImagePreview: Array<{
        sourceFileName: string;
        fileName: string;
        source: ExtractedImageAsset["source"];
        mimeType: string;
        dataUrl: string;
      }>;
      normalizedPreview: NormalizedImportItem[];
      dedupedPreview: DedupedImportItem[];
    }
  | {
      ok: false;
      error: string;
      message: string;
    };

function buildPreview(text: string, max = 300) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function normalizeKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, "");
}

function dedupeImagePreview(images: Array<{sourceFileName:string; fileName:string; source:ExtractedImageAsset['source']; mimeType:string; dataUrl:string;}>) {
  const seen = new Set<string>();
  const out = [] as typeof images;
  for (const image of images) {
    const key = `${normalizeKey(image.sourceFileName)}::${image.fileName}::${image.dataUrl.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(image);
  }
  return out;
}

export async function runOnboardingIntelligentImport(
  params: IntelligentImportParams
): Promise<IntelligentImportResult> {
  try {
    const organizationId = String(params.organizationId || "").trim();
    const storeId = String(params.storeId || "").trim();
    const files = Array.isArray(params.files) ? params.files : [];

    if (!organizationId) {
      return { ok: false, error: "MISSING_ORGANIZATION_ID", message: "organizationId é obrigatório." };
    }
    if (!storeId) {
      return { ok: false, error: "MISSING_STORE_ID", message: "storeId é obrigatório." };
    }
    if (!files.length) {
      return { ok: false, error: "NO_FILES", message: "Nenhum arquivo foi enviado para importação." };
    }

    const extractedFiles = await Promise.all(
      files.map((file) =>
        extractTextFromFile({ fileName: file.fileName, mimeType: file.mimeType, buffer: file.buffer })
      )
    );

    const normalizedItems = normalizeMultipleExtractedFiles(extractedFiles);
    const dedupedItems = dedupNormalizedItems(normalizedItems);
    const duplicateItems = dedupedItems.filter((item) => item.isDuplicate).length;

    const extractedImagePreview = dedupeImagePreview(
      extractedFiles.flatMap((file) =>
        (file.extractedImages ?? []).map((image) => ({
          sourceFileName: file.fileName,
          fileName: image.fileName,
          source: image.source,
          mimeType: image.mimeType,
          dataUrl: image.dataUrl,
        }))
      )
    );

    return {
      ok: true,
      summary: {
        totalFiles: files.length,
        extractedFiles: extractedFiles.length,
        normalizedItems: normalizedItems.length,
        dedupedItems: dedupedItems.length,
        duplicateItems,
        extractedImages: extractedImagePreview.length,
      },
      extractedPreview: extractedFiles.map((file) => ({
        fileName: file.fileName,
        mimeType: file.mimeType,
        extension: file.extension,
        textPreview: buildPreview(file.text),
      })),
      extractedImagePreview,
      normalizedPreview: normalizedItems,
      dedupedPreview: dedupedItems,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: "ONBOARDING_INTELLIGENT_IMPORT_FAILED",
      message: error?.message || "Erro interno ao processar importação inteligente do onboarding.",
    };
  }
}
