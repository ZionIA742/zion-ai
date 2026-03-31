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
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function normalizeLoose(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericTitle(value: string) {
  const normalized = normalizeLoose(value);
  if (!normalized) return true;

  const blockedStarts = [
    "descricao detalhada",
    "descrição detalhada",
    "catalogo de teste",
    "catálogo de teste",
    "arquivo de teste",
    "nome do item",
    "item importado",
    "regra comercial",
  ];

  return blockedStarts.some(
    (item) => normalized === normalizeLoose(item) || normalized.startsWith(normalizeLoose(item))
  );
}

function buildFileItemAlias(fileName: string, index: number) {
  return `${fileName} • item ${index + 1}`;
}

function attachPerItemAliases(
  items: NormalizedImportItem[],
  extractedImages: Array<{
    sourceFileName: string;
    fileName: string;
    source: ExtractedImageAsset["source"];
    mimeType: string;
    dataUrl: string;
  }>
) {
  const groupedBySourceFile = new Map<string, NormalizedImportItem[]>();

  for (const item of items) {
    const key = String(item.sourceFileName || "").trim().toLowerCase();
    const current = groupedBySourceFile.get(key) ?? [];
    current.push(item);
    groupedBySourceFile.set(key, current);
  }

  const normalizedPreview = items.map((item) => ({ ...item }));

  const imagePreview = extractedImages.flatMap((image) => {
    const key = String(image.sourceFileName || "").trim().toLowerCase();
    const relatedItems = groupedBySourceFile.get(key) ?? [];
    if (relatedItems.length <= 1) {
      return [image];
    }

    return relatedItems.map((item, index) => ({
      ...image,
      sourceFileName: buildFileItemAlias(item.sourceFileName, index),
    }));
  });

  return {
    normalizedPreview,
    imagePreview,
  };
}

function filterUsefulItems(items: DedupedImportItem[]) {
  return items.filter((item) => {
    if (isGenericTitle(item.title)) return false;
    if (item.type === "unknown" && item.confidence < 0.55) return false;
    return true;
  });
}

export async function runOnboardingIntelligentImport(
  params: IntelligentImportParams
): Promise<IntelligentImportResult> {
  const { files } = params;

  try {
    if (!files.length) {
      return {
        ok: false,
        error: "NO_FILES",
        message: "Nenhum arquivo foi enviado para a importação inteligente.",
      };
    }

    const extractedFiles = await Promise.all(
      files.map((file) =>
        extractTextFromFile({
          fileName: file.fileName,
          mimeType: file.mimeType,
          buffer: file.buffer,
        })
      )
    );

    const normalizedItems = normalizeMultipleExtractedFiles(extractedFiles);

    const extractedImagePreviewRaw = extractedFiles.flatMap((file) =>
      (file.extractedImages ?? []).map((image) => ({
        sourceFileName: file.fileName,
        fileName: image.fileName,
        source: image.source,
        mimeType: image.mimeType,
        dataUrl: image.dataUrl,
      }))
    );

    const aliased = attachPerItemAliases(normalizedItems, extractedImagePreviewRaw);
    const dedupedItems = filterUsefulItems(dedupNormalizedItems(aliased.normalizedPreview));
    const duplicateItems = dedupedItems.filter((item) => item.isDuplicate).length;

    return {
      ok: true,
      summary: {
        totalFiles: files.length,
        extractedFiles: extractedFiles.length,
        normalizedItems: aliased.normalizedPreview.length,
        dedupedItems: dedupedItems.length,
        duplicateItems,
        extractedImages: aliased.imagePreview.length,
      },
      extractedPreview: extractedFiles.map((file) => ({
        fileName: file.fileName,
        mimeType: file.mimeType,
        extension: file.extension,
        textPreview: buildPreview(file.text),
      })),
      extractedImagePreview: aliased.imagePreview,
      normalizedPreview: aliased.normalizedPreview,
      dedupedPreview: dedupedItems,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: "ONBOARDING_INTELLIGENT_IMPORT_FAILED",
      message:
        error?.message ||
        "Erro interno ao processar importação inteligente do onboarding.",
    };
  }
}
