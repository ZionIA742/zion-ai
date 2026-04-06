import {
  extractTextFromFile,
  type ExtractedImageAsset,
  type ExtractedFileDiagnostics,
  type XlsxImageExtractionDiagnostics,
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

export type IntelligentImportImageDiagnostics = {
  totalExtractedImagesRaw: number;
  totalAliasedImages: number;
  files: Array<{
    fileName: string;
    extension: string;
    extractedImages: number;
    xlsxImageDiagnostics?: XlsxImageExtractionDiagnostics;
  }>;
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
      imageDiagnostics: IntelligentImportImageDiagnostics;
      normalizedPreview: NormalizedImportItem[];
      dedupedPreview: DedupedImportItem[];
    }
  | {
      ok: false;
      error: string;
      message: string;
    };

const DEBUG_INTELLIGENT_IMPORT =
  process.env.NODE_ENV !== "production" ||
  process.env.DEBUG_INTELLIGENT_IMPORT === "1" ||
  process.env.NEXT_PUBLIC_DEBUG_INTELLIGENT_IMPORT === "1";

function debugIntelligentImport(...args: unknown[]) {
  if (!DEBUG_INTELLIGENT_IMPORT) return;
  console.log("[ZION][intelligent-import][server]", ...args);
}

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

    debugIntelligentImport("attachPerItemAliases:image-source", {
      sourceFileName: image.sourceFileName,
      imageFileName: image.fileName,
      relatedItemsCount: relatedItems.length,
      relatedTitles: relatedItems.map((item) => item.title),
    });

    if (relatedItems.length <= 1) {
      return [image];
    }

    return relatedItems.map((item, index) => ({
      ...image,
      sourceFileName: buildFileItemAlias(item.sourceFileName, index),
    }));
  });

  debugIntelligentImport("attachPerItemAliases:result", {
    normalizedCount: normalizedPreview.length,
    imagePreviewCount: imagePreview.length,
  });

  return {
    normalizedPreview,
    imagePreview,
  };
}

function filterUsefulItems(items: DedupedImportItem[]) {
  return items.filter((item) => {
    const genericTitle = isGenericTitle(item.title);
    const lowConfidenceUnknown = item.type === "unknown" && item.confidence < 0.55;

    if (genericTitle || lowConfidenceUnknown) {
      debugIntelligentImport("filterUsefulItems:discarded", {
        title: item.title,
        sourceFileName: item.sourceFileName,
        type: item.type,
        confidence: item.confidence,
        isDuplicate: item.isDuplicate,
        dedupKey: item.dedupKey,
        reason: genericTitle ? "generic_title" : "low_confidence_unknown",
        sku:
          item.metadata?.sku ||
          item.metadata?.SKU ||
          item.metadata?.codigo ||
          item.metadata?.["código"] ||
          "",
      });
      return false;
    }

    return true;
  });
}

function buildImageDiagnostics(
  extractedFiles: Array<{
    fileName: string;
    extension: string;
    extractedImages?: ExtractedImageAsset[];
    diagnostics?: ExtractedFileDiagnostics;
  }>,
  extractedImagePreviewRaw: Array<{
    sourceFileName: string;
    fileName: string;
    source: ExtractedImageAsset["source"];
    mimeType: string;
    dataUrl: string;
  }>,
  aliasedImagePreview: Array<{
    sourceFileName: string;
    fileName: string;
    source: ExtractedImageAsset["source"];
    mimeType: string;
    dataUrl: string;
  }>
): IntelligentImportImageDiagnostics {
  return {
    totalExtractedImagesRaw: extractedImagePreviewRaw.length,
    totalAliasedImages: aliasedImagePreview.length,
    files: extractedFiles.map((file) => ({
      fileName: file.fileName,
      extension: file.extension,
      extractedImages: Array.isArray(file.extractedImages) ? file.extractedImages.length : 0,
      xlsxImageDiagnostics: file.diagnostics?.xlsxImageDiagnostics,
    })),
  };
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

    debugIntelligentImport("start", {
      totalFiles: files.length,
      files: files.map((file) => ({
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.buffer.length,
      })),
    });

    const extractedFiles = await Promise.all(
      files.map((file) =>
        extractTextFromFile({
          fileName: file.fileName,
          mimeType: file.mimeType,
          buffer: file.buffer,
        })
      )
    );

    debugIntelligentImport("after-extract", {
      extractedFiles: extractedFiles.length,
      extracted: extractedFiles.map((file) => ({
        fileName: file.fileName,
        extension: file.extension,
        textLength: String(file.text || "").length,
        extractedImages: Array.isArray(file.extractedImages) ? file.extractedImages.length : 0,
        diagnostics: file.diagnostics,
      })),
    });

    const normalizedItems = normalizeMultipleExtractedFiles(extractedFiles);

    debugIntelligentImport("after-normalize", {
      normalizedCount: normalizedItems.length,
      normalizedItems: normalizedItems.map((item) => ({
        title: item.title,
        type: item.type,
        sourceFileName: item.sourceFileName,
        confidence: item.confidence,
        sku:
          item.metadata?.sku ||
          item.metadata?.SKU ||
          item.metadata?.codigo ||
          item.metadata?.["código"] ||
          "",
      })),
    });

    const extractedImagePreviewRaw = extractedFiles.flatMap((file) =>
      (file.extractedImages ?? []).map((image) => ({
        sourceFileName: file.fileName,
        fileName: image.fileName,
        source: image.source,
        mimeType: image.mimeType,
        dataUrl: image.dataUrl,
      }))
    );

    debugIntelligentImport("after-image-collect", {
      extractedImagesRawCount: extractedImagePreviewRaw.length,
      extractedImagesRaw: extractedImagePreviewRaw.map((image) => ({
        sourceFileName: image.sourceFileName,
        fileName: image.fileName,
        source: image.source,
        mimeType: image.mimeType,
      })),
    });

    const aliased = attachPerItemAliases(normalizedItems, extractedImagePreviewRaw);
    const imageDiagnostics = buildImageDiagnostics(
      extractedFiles,
      extractedImagePreviewRaw,
      aliased.imagePreview
    );

    debugIntelligentImport("after-alias", {
      normalizedCount: aliased.normalizedPreview.length,
      imagePreviewCount: aliased.imagePreview.length,
      imagePreview: aliased.imagePreview.map((image) => ({
        sourceFileName: image.sourceFileName,
        fileName: image.fileName,
        source: image.source,
      })),
      imageDiagnostics,
    });

    const dedupedBeforeFilter = dedupNormalizedItems(aliased.normalizedPreview);

    debugIntelligentImport("after-dedup-before-filter", {
      total: dedupedBeforeFilter.length,
      duplicates: dedupedBeforeFilter.filter((item) => item.isDuplicate).length,
      items: dedupedBeforeFilter.map((item) => ({
        title: item.title,
        sourceFileName: item.sourceFileName,
        type: item.type,
        confidence: item.confidence,
        isDuplicate: item.isDuplicate,
        duplicateOf: item.duplicateOf,
        dedupKey: item.dedupKey,
        sku:
          item.metadata?.sku ||
          item.metadata?.SKU ||
          item.metadata?.codigo ||
          item.metadata?.["código"] ||
          "",
      })),
    });

    const dedupedItems = filterUsefulItems(dedupedBeforeFilter);
    const duplicateItems = dedupedItems.filter((item) => item.isDuplicate).length;

    debugIntelligentImport("after-filter-final", {
      finalCount: dedupedItems.length,
      duplicateItems,
      finalItems: dedupedItems.map((item) => ({
        title: item.title,
        sourceFileName: item.sourceFileName,
        type: item.type,
        confidence: item.confidence,
        isDuplicate: item.isDuplicate,
        duplicateOf: item.duplicateOf,
        dedupKey: item.dedupKey,
        sku:
          item.metadata?.sku ||
          item.metadata?.SKU ||
          item.metadata?.codigo ||
          item.metadata?.["código"] ||
          "",
      })),
    });

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
      imageDiagnostics,
      normalizedPreview: aliased.normalizedPreview,
      dedupedPreview: dedupedItems,
    };
  } catch (error: any) {
    debugIntelligentImport("error", {
      message:
        error?.message ||
        "Erro interno ao processar importação inteligente do onboarding.",
      stack: error?.stack || null,
    });

    return {
      ok: false,
      error: "ONBOARDING_INTELLIGENT_IMPORT_FAILED",
      message:
        error?.message ||
        "Erro interno ao processar importação inteligente do onboarding.",
    };
  }
}
