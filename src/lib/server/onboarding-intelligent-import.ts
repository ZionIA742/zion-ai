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

type IntelligentImportPreviewImage = {
  sourceFileName: string;
  originalSourceFileName?: string;
  fileName: string;
  source: ExtractedImageAsset["source"];
  mimeType: string;
  dataUrl: string;
  sheetName?: string;
  rowIndex?: number;
  columnIndex?: number;
  anchorCell?: string;
  drawingName?: string;
  imageRelationshipId?: string;
  imageOrder?: number;
  worksheetRowNumber?: number;
  sheetScopedKey?: string;
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
      extractedImagePreview: IntelligentImportPreviewImage[];
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

function extractItemSheetName(item: NormalizedImportItem) {
  const metadataCandidates = [
    item.metadata?.source_sheet_name,
    item.metadata?.sheet_name,
    item.metadata?.sheetName,
    item.metadata?.planilha,
    item.metadata?.sheet,
    item.metadata?.sourceCategory,
    item.metadata?.source_category,
    item.metadata?.categoria,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (metadataCandidates.length > 0) {
    return metadataCandidates[0];
  }

  const rawText = String(item.rawText || "");
  const match =
    rawText.match(/(?:^|\n)planilha\s*:\s*([^\n|]+)/i) ||
    rawText.match(/===\s*item\s*\d+\s*\|\s*planilha\s*:\s*([^=|\n]+)/i) ||
    rawText.match(/(?:^|\n)sheet\s*:\s*([^\n|]+)/i) ||
    rawText.match(/(?:^|\n)aba\s*:\s*([^\n|]+)/i);

  return match?.[1]?.trim() || "";
}

function extractItemWorksheetRowNumber(item: NormalizedImportItem) {
  const metadataCandidates = [
    item.metadata?.source_worksheet_row_number,
    item.metadata?.worksheet_row_number,
    item.metadata?.worksheetRowNumber,
    item.metadata?.source_row_number,
    item.metadata?.row_number,
    item.metadata?.sheet_row_number,
  ]
    .map((value) => Number(String(value ?? "").replace(/[^\d-]/g, "")))
    .find((value) => Number.isFinite(value) && value > 0);

  if (metadataCandidates != null) return metadataCandidates;

  const rawText = String(item.rawText || "");
  const match =
    rawText.match(/(?:^|\n)linha da planilha\s*:\s*(\d+)/i) ||
    rawText.match(/===\s*item\s*\d+\s*\|\s*planilha\s*:\s*[^|\n=]+\|\s*linha\s*:\s*(\d+)/i) ||
    rawText.match(/(?:^|\n)worksheet row number\s*:\s*(\d+)/i);

  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSheetScopedKey(sheetName: string, worksheetRowNumber: number | null | undefined) {
  const normalizedSheetName = normalizeLoose(sheetName);
  if (!normalizedSheetName || !Number.isFinite(worksheetRowNumber as number) || Number(worksheetRowNumber) <= 0) {
    return "";
  }
  return `${normalizedSheetName}::row::${Number(worksheetRowNumber)}`;
}

function enrichItemWithImportCoordinates(item: NormalizedImportItem) {
  const sourceSheetName = extractItemSheetName(item);
  const worksheetRowNumber = extractItemWorksheetRowNumber(item);
  const sheetScopedKey = buildSheetScopedKey(sourceSheetName, worksheetRowNumber);
  const originalSourceFileName = String(item.sourceFileName || "").trim();

  return {
    ...item,
    metadata: {
      ...(item.metadata ?? {}),
      source_file_name_original:
        String(item.metadata?.source_file_name_original || item.metadata?.original_source_file_name || "").trim() ||
        originalSourceFileName,
      source_sheet_name:
        String(item.metadata?.source_sheet_name || item.metadata?.sheet_name || item.metadata?.sheetName || "").trim() ||
        sourceSheetName ||
        "",
      source_worksheet_row_number: worksheetRowNumber != null ? String(worksheetRowNumber) : "",
      source_sheet_scoped_key: sheetScopedKey || "",
    },
  };
}

function scoreImageAgainstItem(
  item: ReturnType<typeof enrichItemWithImportCoordinates>,
  image: IntelligentImportPreviewImage,
  fallbackImageIndex: number
) {
  let score = 0;

  const itemOriginalFile = normalizeLoose(String(item.metadata?.source_file_name_original || item.sourceFileName || ""));
  const imageOriginalFile = normalizeLoose(image.originalSourceFileName || image.sourceFileName || "");
  if (itemOriginalFile && imageOriginalFile && itemOriginalFile === imageOriginalFile) score += 400;

  const itemSheet = normalizeLoose(String(item.metadata?.source_sheet_name || ""));
  const imageSheet = normalizeLoose(image.sheetName || "");
  if (itemSheet && imageSheet) {
    if (itemSheet === imageSheet) score += 250;
    else score -= 600;
  }

  const itemRow = Number(String(item.metadata?.source_worksheet_row_number || "").replace(/[^\d-]/g, ""));
  const imageRow = typeof image.worksheetRowNumber === "number" ? image.worksheetRowNumber : null;
  if (Number.isFinite(itemRow) && itemRow > 0 && imageRow != null) {
    const distance = Math.abs(itemRow - imageRow);
    if (distance === 0) score += 900;
    else if (distance === 1) score += 240;
    else if (distance === 2) score += 120;
    else if (distance === 3) score += 40;
    else score -= Math.min(distance * 30, 300);
  }

  const itemSheetScopedKey = normalizeLoose(String(item.metadata?.source_sheet_scoped_key || ""));
  const imageSheetScopedKey = normalizeLoose(image.sheetScopedKey || "");
  if (itemSheetScopedKey && imageSheetScopedKey) {
    if (itemSheetScopedKey === imageSheetScopedKey) score += 1000;
    else score -= 120;
  }

  const itemOrder = extractItemStableAssignmentOrder(item, fallbackImageIndex);
  const imageOrder = typeof image.worksheetRowNumber === "number"
    ? image.worksheetRowNumber
    : (typeof image.rowIndex === "number" ? image.rowIndex + 1 : null);
  if (imageOrder != null) {
    const distance = Math.abs(itemOrder - imageOrder);
    if (distance === 0) score += 120;
    else if (distance <= 2) score += 40;
  }

  score -= fallbackImageIndex * 0.01;
  return score;
}

function buildFileItemAlias(fileName: string, index: number, sheetName?: string) {
  const normalizedSheetName = String(sheetName || "").trim();
  if (normalizedSheetName) {
    return `${fileName} • ${normalizedSheetName} • item ${index + 1}`;
  }
  return `${fileName} • item ${index + 1}`;
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

function extractNumericSuffix(value: string) {
  const match = String(value || "").match(/(\d+)(?!.*\d)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractItemStableAssignmentOrder(item: NormalizedImportItem, fallbackIndex: number) {
  const skuCandidate = [
    item.metadata?.sku,
    item.metadata?.SKU,
    item.metadata?.codigo,
    item.metadata?.["código"],
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);

  const numericFromSku = skuCandidate ? extractNumericSuffix(skuCandidate) : null;
  if (numericFromSku != null) return numericFromSku;

  const numericFromTitle = extractNumericSuffix(String(item.title || ""));
  if (numericFromTitle != null) return numericFromTitle;

  const numericFromRawText = extractNumericSuffix(String(item.rawText || ""));
  if (numericFromRawText != null) return numericFromRawText;

  return 100000 + fallbackIndex;
}

function sortImagesForStableAssignment(images: IntelligentImportPreviewImage[]) {
  return [...images].sort((a, b) => {
    const sourceA = normalizeLoose(a.sourceFileName || "");
    const sourceB = normalizeLoose(b.sourceFileName || "");
    if (sourceA !== sourceB) return sourceA.localeCompare(sourceB);

    const sourceTypeA = a.source === "xlsx" ? 0 : 1;
    const sourceTypeB = b.source === "xlsx" ? 0 : 1;
    if (sourceTypeA !== sourceTypeB) return sourceTypeA - sourceTypeB;

    const sheetA = normalizeLoose(a.sheetName || "");
    const sheetB = normalizeLoose(b.sheetName || "");
    if (sheetA !== sheetB) return sheetA.localeCompare(sheetB, undefined, { numeric: true });

    const rowA = typeof a.rowIndex === "number" ? a.rowIndex : Number.MAX_SAFE_INTEGER;
    const rowB = typeof b.rowIndex === "number" ? b.rowIndex : Number.MAX_SAFE_INTEGER;
    if (rowA !== rowB) return rowA - rowB;

    const colA = typeof a.columnIndex === "number" ? a.columnIndex : Number.MAX_SAFE_INTEGER;
    const colB = typeof b.columnIndex === "number" ? b.columnIndex : Number.MAX_SAFE_INTEGER;
    if (colA !== colB) return colA - colB;

    const orderA = typeof a.imageOrder === "number" ? a.imageOrder : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.imageOrder === "number" ? b.imageOrder : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;

    return String(a.fileName || "").localeCompare(String(b.fileName || ""), undefined, {
      numeric: true,
    });
  });
}

function attachPerItemAliases(
  items: NormalizedImportItem[],
  extractedImages: IntelligentImportPreviewImage[]
) {
  const normalizedPreview = items.map((item) => enrichItemWithImportCoordinates(item));

  const imagePreview: IntelligentImportPreviewImage[] = extractedImages.map((image) => ({
    ...image,
    sourceFileName: String(image.originalSourceFileName || image.sourceFileName || "").trim(),
    originalSourceFileName: String(
      image.originalSourceFileName || image.sourceFileName || ""
    ).trim(),
  }));

  debugIntelligentImport("attachPerItemAliases:result", {
    normalizedCount: normalizedPreview.length,
    imagePreviewCount: imagePreview.length,
    mode: "preserve_original_image_coordinates",
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
  extractedImagePreviewRaw: IntelligentImportPreviewImage[],
  aliasedImagePreview: IntelligentImportPreviewImage[]
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

    const extractedImagePreviewRaw: IntelligentImportPreviewImage[] = extractedFiles.flatMap((file) =>
      (file.extractedImages ?? []).map((image) => ({
        sourceFileName: file.fileName,
        originalSourceFileName: file.fileName,
        fileName: image.fileName,
        source: image.source,
        mimeType: image.mimeType,
        dataUrl: image.dataUrl,
        sheetName: image.sheetName,
        rowIndex: image.rowIndex,
        columnIndex: image.columnIndex,
        anchorCell: image.anchorCell,
        drawingName: image.drawingName,
        imageRelationshipId: image.imageRelationshipId,
        imageOrder: image.imageOrder,
        worksheetRowNumber: image.worksheetRowNumber,
        sheetScopedKey: image.sheetScopedKey,
      }))
    );

    debugIntelligentImport("after-image-collect", {
      extractedImagesRawCount: extractedImagePreviewRaw.length,
      extractedImagesRaw: extractedImagePreviewRaw.map((image) => ({
        sourceFileName: image.sourceFileName,
        fileName: image.fileName,
        source: image.source,
        mimeType: image.mimeType,
        sheetName: image.sheetName,
        rowIndex: image.rowIndex,
        columnIndex: image.columnIndex,
        anchorCell: image.anchorCell,
        imageOrder: image.imageOrder,
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
        sheetName: image.sheetName,
        rowIndex: image.rowIndex,
        columnIndex: image.columnIndex,
        anchorCell: image.anchorCell,
        imageOrder: image.imageOrder,
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
