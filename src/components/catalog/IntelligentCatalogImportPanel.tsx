"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase as defaultSupabase } from "@/lib/supabaseBrowser";

type IntelligentImportSummary = {
  totalFiles: number;
  extractedFiles: number;
  normalizedItems: number;
  dedupedItems: number;
  duplicateItems: number;
};
type IntelligentImportExtractedPreview = {
  fileName: string;
  mimeType: string;
  extension: string;
  textPreview: string;
};
type IntelligentImportNormalizedPreview = {
  type: string;
  sourceFileName: string;
  title: string;
  rawText: string;
  confidence: number;
  metadata: Record<string, string>;
};
type IntelligentImportDedupedPreview = IntelligentImportNormalizedPreview & {
  dedupKey: string;
  duplicateOf?: string;
  isDuplicate: boolean;
};
type IntelligentImportResponse =
  | {
      ok: true;
      message: string;
      summary: IntelligentImportSummary;
      extractedPreview: IntelligentImportExtractedPreview[];
      extractedImagePreview?: Array<{
        sourceFileName: string;
        originalSourceFileName?: string;
        fileName: string;
        source: string;
        mimeType: string;
        dataUrl: string;
        sheetName?: string;
        rowIndex?: number;
        columnIndex?: number;
        anchorCell?: string;
        imageOrder?: number;
        worksheetRowNumber?: number;
        sheetScopedKey?: string;
      }>;
      normalizedPreview: IntelligentImportNormalizedPreview[];
      dedupedPreview: IntelligentImportDedupedPreview[];
    }
  | {
      ok: false;
      error: string;
      message: string;
    };
type IntelligentImportSelectedFilePreview = {
  name: string;
  type: string;
  size: number;
  lastModified: number;
};
type PersistedIntelligentImportState = {
  selectedFiles: IntelligentImportSelectedFilePreview[];
  result: IntelligentImportResponse | null;
  successMessage: string | null;
  errorMessage: string | null;
};
type ExistingCatalogItemRow = {
  id: string;
  sku: string | null;
  price_cents: number | null;
  stock_quantity: number | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
};
type IntelligentCatalogImportPanelProps = {
  organizationId: string | null | undefined;
  storeId: string | null | undefined;
  storageKey: string | null;
  source?: string;
  disabled?: boolean;
  supabaseClient?: typeof defaultSupabase;
  onError?: (message: string | null) => void;
  onSuccess?: (message: string | null) => void;
  onSaved?: () => void | Promise<void>;
  afterSaveBehavior?: () => void;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
function isImageLikeFileType(fileType: string) {
  return fileType.startsWith("image/");
}
function buildImageFallbackTitle(fileName: string) {
  const normalized = String(fileName ?? "").trim();
  if (!normalized) return "Imagem enviada pela loja";
  const withoutExtension = normalized.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return withoutExtension || normalized;
}
async function createImagePreviewDataUrl(file: File, maxSide = 240) {
  if (typeof window === "undefined" || !isImageLikeFileType(file.type)) return undefined;
  try {
    const objectUrl = URL.createObjectURL(file);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Falha ao gerar miniatura da imagem."));
      img.src = objectUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Falha ao abrir contexto da miniatura.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const previewDataUrl = canvas.toDataURL("image/jpeg", 0.62);
    URL.revokeObjectURL(objectUrl);
    return previewDataUrl;
  } catch (error) {
    console.error("[OnboardingPage] createImagePreviewDataUrl error:", error);
    return undefined;
  }
}
async function buildSelectedFilePreviews(files: File[]) {
  return files.map((file) => ({
    name: file.name,
    type: file.type || "tipo não informado",
    size: file.size,
    lastModified: file.lastModified,
  }));
}

function persistToLocalStorageSafe(key: string, value: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.error("[OnboardingPage] localStorage setItem error:", error);
  }
}

function removeFromLocalStorageSafe(key: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error("[OnboardingPage] localStorage removeItem error:", error);
  }
}

function buildLightPersistedIntelligentImportState(params: {
  selectedFiles: IntelligentImportSelectedFilePreview[];
  successMessage: string | null;
  errorMessage: string | null;
}): PersistedIntelligentImportState {
  return {
    selectedFiles: params.selectedFiles,
    result: null,
    successMessage: params.successMessage,
    errorMessage: params.errorMessage,
  };
}
function decorateIntelligentImportResultWithImageFallback(
  result: IntelligentImportResponse,
  selectedFiles: IntelligentImportSelectedFilePreview[]
): IntelligentImportResponse {
  if (!result.ok) return result;
  const hasStructuredItems = result.normalizedPreview.length > 0 || result.dedupedPreview.length > 0;
  if (hasStructuredItems) return result;
  const visualSources = selectedFiles.filter((file) => isImageLikeFileType(file.type));
  if (visualSources.length === 0) return result;
  const fallbackItems = visualSources.slice(0, 12).map((file, index) => ({
    type: "image_reference",
    sourceFileName: file.name,
    title: buildImageFallbackTitle(file.name),
    rawText:
      "Imagem enviada como referência visual da loja. Nesta prévia, a importação inteligente preservou o arquivo visual, mas ainda não transformou automaticamente a imagem em um item textual estruturado.",
    confidence: 0.42,
    metadata: {
      origem: "imagem_enviada",
      mime_type: file.type || "image/*",
      modo: "fallback_visual_frontend",
    },
  }));
  return {
    ...result,
    message: result.message || "Importação inteligente processada com apoio visual para imagens.",
    normalizedPreview: fallbackItems,
    dedupedPreview: fallbackItems.map((item, index) => ({
      ...item,
      dedupKey: `${item.sourceFileName}:${index}`,
      duplicateOf: undefined,
      isDuplicate: false,
    })),
  };
}

function enrichImportedItemWithResolvedDestination<T extends IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>(
  item: T
): T {
  const resolvedDestination = resolveImportedDestination(item);
  return {
    ...item,
    metadata: {
      ...(item.metadata ?? {}),
      __resolved_destination: resolvedDestination,
      source_sheet_name: extractImportedSourceSheetName(item) || null,
      source_category: extractImportedSourceCategory(item) || null,
      source_subcategory: extractImportedSourceSubcategory(item) || null,
    },
  };
}

function buildFrontendNormalizedPreviewFromItems(
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>
): IntelligentImportNormalizedPreview[] {
  return items.map((rawItem) => {
    const item = enrichImportedItemWithResolvedDestination(rawItem);
    return {
      type: item.type,
      sourceFileName: item.sourceFileName,
      title: item.title,
      rawText: item.rawText,
      confidence: item.confidence,
      metadata: item.metadata ?? {},
    };
  });
}

function buildFrontendDedupedPreviewFromItems(
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>
): IntelligentImportDedupedPreview[] {
  return items.map((rawItem, index) => {
    const item = enrichImportedItemWithResolvedDestination(rawItem);
    return {
      type: item.type,
      sourceFileName: item.sourceFileName,
      title: item.title,
      rawText: item.rawText,
      confidence: item.confidence,
      metadata: item.metadata ?? {},
      dedupKey: `${buildImportedSaveKey(item)}::frontend::${index}`,
      duplicateOf: undefined,
      isDuplicate: false,
    };
  });
}

function normalizeIntelligentImportResultForFrontend(
  result: IntelligentImportResponse
): IntelligentImportResponse {
  if (!result.ok) return result;

  const rawSourceItems =
    result.dedupedPreview.length > 0
      ? result.dedupedPreview.filter((item) => !item.isDuplicate)
      : result.normalizedPreview;

  const filteredSourceItems = rawSourceItems.filter((item) => !shouldSkipImportedItem(item));
  const saveReadyItems = dedupeImportedItemsForSave(filteredSourceItems);

  if (saveReadyItems.length === 0) {
    return result;
  }

  const discardedItems = Math.max(0, rawSourceItems.length - saveReadyItems.length);

  return {
    ...result,
    message:
      discardedItems > 0
        ? `${
            result.message || "Importação inteligente processada com sucesso."
          } A prévia foi ajustada para mostrar apenas os itens prontos para salvar.`
        : result.message,
    summary: {
      ...result.summary,
      normalizedItems: saveReadyItems.length,
      dedupedItems: saveReadyItems.length,
      duplicateItems: discardedItems,
    },
    normalizedPreview: buildFrontendNormalizedPreviewFromItems(saveReadyItems),
    dedupedPreview: buildFrontendDedupedPreviewFromItems(saveReadyItems),
  };
}

type ImportedDestination = "pool" | "acessorios" | "quimicos" | "outros";
type ImportedCatalogCategory = "acessorios" | "quimicos" | "outros";

function matchImportedDestinationLabel(value: string | null | undefined): ImportedDestination | null {
  const normalized = normalizeImportedLoose(value);
  if (!normalized) return null;

  if (/(^|\s)(pool|piscinas|piscina)(\s|$)/.test(normalized)) return "pool";
  if (/(^|\s)(acessorios|acessorio)(\s|$)/.test(normalized)) return "acessorios";
  if (/(^|\s)(quimicos|quimico)(\s|$)/.test(normalized)) return "quimicos";
  if (/(^|\s)(outros|outro|diversos)(\s|$)/.test(normalized)) return "outros";

  return null;
}

function resolveImportedExplicitDestination(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
): ImportedDestination | null {
  const explicitCandidates = [
    extractMetadataValue(item, [
      "__resolved_destination",
      "destination",
      "destino",
      "categoryhint",
      "category_hint",
    ]),
    extractImportedSourceCategory(item),
    extractImportedSourceSubcategory(item),
    extractImportedSourceSheetName(item),
  ];

  for (const candidate of explicitCandidates) {
    const matched = matchImportedDestinationLabel(candidate);
    if (matched) return matched;
  }

  return null;
}

function normalizeImportedCatalogCategory(value: string): ImportedCatalogCategory {
  const explicit = matchImportedDestinationLabel(value);
  if (explicit === "acessorios" || explicit === "quimicos" || explicit === "outros") {
    return explicit;
  }

  const normalized = normalizeImportedLoose(value);
  if (!normalized) return "outros";

  if (
    normalized.includes("algicida") ||
    normalized.includes("clarificante") ||
    normalized.includes("sulfato") ||
    normalized.includes("elevador de ph") ||
    normalized.includes("redutor de ph") ||
    normalized.includes("cloro granulado") ||
    normalized.includes("cloro estabilizado") ||
    normalized.includes("barrilha")
  ) {
    return "quimicos";
  }

  if (
    normalized.includes("peneira") ||
    normalized.includes("escova") ||
    normalized.includes("aspirador") ||
    normalized.includes("dispositivo") ||
    normalized.includes("mangueira") ||
    normalized.includes("clorador") ||
    normalized.includes("cascata") ||
    normalized.includes("corrimao") ||
    normalized.includes("cabo telescopico") ||
    normalized.includes("refletor") ||
    normalized.includes("nicho") ||
    normalized.includes("ralo") ||
    normalized.includes("transformador")
  ) {
    return "acessorios";
  }

  return "outros";
}

function buildIntelligentImportFormatWarnings(params: {
  extractedPreview: IntelligentImportExtractedPreview[];
  selectedFiles: IntelligentImportSelectedFilePreview[];
}) {
  const extensions = new Set(
    params.selectedFiles
      .map((file) => String(file.name || "").split(".").pop()?.toLowerCase() || "")
      .filter(Boolean)
  );
  for (const preview of params.extractedPreview) {
    const extension = String(preview.extension || "").toLowerCase();
    if (extension) extensions.add(extension);
  }

  const extractedByExtension = new Map<string, IntelligentImportExtractedPreview[]>();
  for (const preview of params.extractedPreview) {
    const extension = String(preview.extension || "").toLowerCase();
    if (!extension) continue;
    const current = extractedByExtension.get(extension) ?? [];
    current.push(preview);
    extractedByExtension.set(extension, current);
  }

  const warnings: string[] = [];
  const pdfFiles = extractedByExtension.get("pdf") ?? [];
  const hasPdf = extensions.has("pdf") || pdfFiles.length > 0;
  if (hasPdf) {
    const hasPdfWithoutText = pdfFiles.some((file) => !String(file.textPreview || "").trim());
    warnings.push(
      hasPdfWithoutText
        ? "PDF sem texto extraivel pode indicar arquivo escaneado ou imagem. Nesta etapa, PDF ainda nao tem OCR robusto."
        : "PDF e lido principalmente por texto. Catalogos com colunas, tabelas visuais ou paginas escaneadas ainda podem falhar."
    );
  }

  if (extensions.has("ppt") || extensions.has("pptx")) {
    warnings.push(
      "PowerPoint pode ter texto extraido dos slides, mas a ligacao entre imagem e item ainda e limitada."
    );
  }

  if (extensions.has("png") || extensions.has("jpg") || extensions.has("jpeg") || extensions.has("webp") || extensions.has("gif") || extensions.has("bmp") || extensions.has("heic") || extensions.has("heif")) {
    warnings.push(
      "Imagens avulsas sao preservadas para conferencia, mas ainda nao viram item estruturado automaticamente."
    );
  }

  if (extensions.has("xls")) {
    warnings.push("Arquivos .xls antigos podem ser lidos como texto de planilha, mas imagens embutidas nao sao extraidas.");
  }

  return warnings;
}
function inferImportedDestination(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
): ImportedDestination {
  const explicitSheet = normalizeImportedLoose(extractImportedSourceSheetName(item));
  const explicitCategory = normalizeImportedLoose(extractImportedSourceCategory(item));
  const explicitSubcategory = normalizeImportedLoose(extractImportedSourceSubcategory(item));
  const explicitSource = [explicitSheet, explicitCategory, explicitSubcategory]
    .filter(Boolean)
    .join(" ");

  if (/(^|\s)(acessorios|acessorio)(\s|$)/.test(explicitSource)) {
    return "acessorios";
  }
  if (/(^|\s)(outros|outro)(\s|$)/.test(explicitSource)) {
    return "outros";
  }
  if (/(^|\s)(quimicos|quimico)(\s|$)/.test(explicitSource)) {
    return "quimicos";
  }
  if (/(^|\s)(piscinas|piscina|pool)(\s|$)/.test(explicitSource)) {
    return "pool";
  }

  const titleAndMetadata = [
    item.type,
    item.title,
    extractImportedSourceCategory(item),
    extractImportedSourceSubcategory(item),
    ...Object.values(item.metadata ?? {}),
  ]
    .map((value) => normalizeImportedLoose(String(value ?? "")))
    .filter(Boolean)
    .join(" ");

  const chemicalScore =
    (titleAndMetadata.includes("algicida") ? 6 : 0) +
    (titleAndMetadata.includes("clarificante") ? 6 : 0) +
    (titleAndMetadata.includes("sulfato") ? 6 : 0) +
    (titleAndMetadata.includes("elevador de ph") ? 6 : 0) +
    (titleAndMetadata.includes("redutor de ph") ? 6 : 0) +
    (titleAndMetadata.includes("cloro granulado") ? 6 : 0) +
    (titleAndMetadata.includes("cloro estabilizado") ? 6 : 0) +
    (titleAndMetadata.includes("barrilha") ? 6 : 0);

  const accessoryScore =
    (titleAndMetadata.includes("peneira") ? 6 : 0) +
    (titleAndMetadata.includes("escova") ? 6 : 0) +
    (titleAndMetadata.includes("aspirador") ? 6 : 0) +
    (titleAndMetadata.includes("dispositivo") ? 6 : 0) +
    (titleAndMetadata.includes("cabo telescopico") ? 6 : 0) +
    (titleAndMetadata.includes("mangueira") ? 6 : 0) +
    (titleAndMetadata.includes("clorador") ? 6 : 0) +
    (titleAndMetadata.includes("corrimao") ? 6 : 0) +
    (titleAndMetadata.includes("cascata") ? 6 : 0) +
    (titleAndMetadata.includes("transformador") ? 6 : 0) +
    (titleAndMetadata.includes("ralo") ? 6 : 0) +
    (titleAndMetadata.includes("refletor") ? 5 : 0) +
    (titleAndMetadata.includes("nicho") ? 5 : 0);

  const raw = normalizeImportedLoose([item.title, item.rawText].join(" "));
  const hasStrongPoolMetric =
    /\b\d+[\.,]?\d*\s*x\s*\d+[\.,]?\d*\s*m\b/i.test(raw) ||
    /\b\d+[\.,]?\d*\s*m\s*di[âa]m/i.test(raw) ||
    (raw.includes("capacidade") && raw.includes("litros")) ||
    raw.includes("profundidade");

  const hasPoolKeyword =
    raw.includes("piscina") ||
    raw.includes("spa") ||
    raw.includes("vinil") ||
    raw.includes("alvenaria") ||
    raw.includes("pastilha");

  if (hasStrongPoolMetric && hasPoolKeyword) {
    return "pool";
  }

  if (chemicalScore >= 6 && chemicalScore > accessoryScore) {
    return "quimicos";
  }
  if (accessoryScore >= 6) {
    return "acessorios";
  }

  return "outros";
}

function extractImportedLabeledValue(
  source: string,
  labels: string[]
) {
  const rawSource = String(source || "").replace(/\r/g, " ");
  if (!rawSource.trim()) return "";

  const stopLabels = [
    "planilha", "sheet", "aba", "item", "sku", "nome do item", "nome do produto", "produto", "nome",
    "categoria", "subcategoria", "marca", "linha", "descrição curta", "descricao curta", "descrição detalhada",
    "descricao detalhada", "descrição", "descricao", "aplicação", "aplicacao", "embalagem", "dosagem",
    "preço venda", "preco venda", "preço de venda", "preco de venda", "preço final", "preco final",
    "preço unitário", "preco unitario", "preço", "preco", "valor", "quantidade atual", "estoque inicial",
    "estoque", "peso/volume", "peso volume", "peso", "volume", "conteúdo", "conteudo", "código de barras",
    "codigo de barras", "barcode", "observações", "observacoes", "observação", "observacao", "notas",
  ];

  const escapedStopLabels = stopLabels
    .map((label) => escapeImportedRegExp(label))
    .sort((left, right) => right.length - left.length)
    .join("|");

  for (const label of labels) {
    const escapedLabel = escapeImportedRegExp(label);
    const pattern = new RegExp(
      `${escapedLabel}\\s*[:=\\-–—]\\s*(.+?)(?=(?:\\s*(?:\\||===|•|·|\\n)\\s*)?(?:${escapedStopLabels})\\s*[:=\\-–—]|$)`,
      "iu"
    );
    const match = rawSource.match(pattern);
    if (match?.[1]) {
      const value = cleanupImportedDescriptionLine(match[1]);
      if (value) return value;
    }
  }

  const lines = rawSource
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const label of labels) {
    const normalizedLabel = normalizeImportedLoose(label);
    for (const line of lines) {
      const normalizedLine = normalizeImportedLoose(line);
      if (!normalizedLine) continue;
      if (
        normalizedLine.startsWith(`${normalizedLabel} `) ||
        normalizedLine.startsWith(`${normalizedLabel}:`) ||
        normalizedLine.startsWith(`${normalizedLabel} -`)
      ) {
        const value = cleanupImportedDescriptionLine(
          line.replace(/^\s*[^:–=-]+\s*[:–=-]\s*/u, "").trim()
        );
        if (value) return value;
      }
    }
  }

  return "";
}

function extractImportedSourceSheetName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  return (
    extractMetadataValue(item, [
      "source_sheet_name",
      "sheet_name",
      "planilha",
      "sheet",
      "aba",
    ]) ||
    extractImportedLabeledValue(source, ["Planilha", "Sheet", "Aba"]) ||
    ""
  ).trim();
}

function extractImportedSourceCategory(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  return (
    extractMetadataValue(item, [
      "source_category",
      "categoria",
      "category",
      "category_name",
    ]) ||
    extractImportedLabeledValue(source, ["Categoria", "Category"]) ||
    extractImportedSourceSheetName(item)
  ).trim();
}

function extractImportedSourceSubcategory(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  return (
    extractMetadataValue(item, [
      "source_subcategory",
      "subcategoria",
      "subcategory",
      "sub_category",
    ]) ||
    extractImportedLabeledValue(source, ["Subcategoria", "Subcategory"]) ||
    ""
  ).trim();
}

function extractImportedSourceItemNumber(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const rawSource = [String(item.title || ""), String(item.rawText || "")].join(" ");
  const match = rawSource.match(/\bitem\s*(\d{1,6})\b/i);
  if (!match?.[1]) return "";
  return match[1];
}

function extractImportedOriginalSourceFileName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  return String(
    item.metadata?.source_file_name_original ||
      item.metadata?.original_source_file_name ||
      item.sourceFileName ||
      ""
  ).trim();
}

function extractImportedWorksheetRowNumber(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
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
    rawText.match(/(?:^|\n)worksheet row number\s*:\s*(\d+)/i) ||
    rawText.match(/===\s*item\s*\d+\s*\|\s*planilha\s*:\s*[^|\n=]+\|\s*linha\s*:\s*(\d+)/i);

  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildImportedSheetScopedKey(sheetName: string, worksheetRowNumber: number | null | undefined) {
  const normalizedSheetName = normalizeImportedLoose(sheetName);
  if (!normalizedSheetName || !Number.isFinite(worksheetRowNumber as number) || Number(worksheetRowNumber) <= 0) {
    return "";
  }
  return `${normalizedSheetName}::row::${Number(worksheetRowNumber)}`;
}

function extractImportedSheetScopedKey(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const explicit = String(
    item.metadata?.source_sheet_scoped_key || item.metadata?.sheet_scoped_key || ""
  ).trim();
  if (explicit) return explicit;
  return buildImportedSheetScopedKey(
    extractImportedSourceSheetName(item),
    extractImportedWorksheetRowNumber(item)
  );
}

function buildImportedSourceLocationKey(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const sourceFile = normalizeImportedLoose(extractImportedOriginalSourceFileName(item));
  const sheetScopedKey = normalizeImportedLoose(extractImportedSheetScopedKey(item));
  const sheetName = normalizeImportedLoose(extractImportedSourceSheetName(item));
  const worksheetRowNumber = extractImportedWorksheetRowNumber(item);
  const itemNumber = normalizeImportedLoose(extractImportedSourceItemNumber(item));

  if (sourceFile && sheetScopedKey) {
    return `${sourceFile}::${sheetScopedKey}`;
  }
  if (sourceFile && sheetName && worksheetRowNumber != null) {
    return `${sourceFile}::${sheetName}::row::${worksheetRowNumber}`;
  }
  if (sourceFile && sheetName && itemNumber) {
    return `${sourceFile}::${sheetName}::item::${itemNumber}`;
  }
  if (sourceFile && itemNumber) {
    return `${sourceFile}::item::${itemNumber}`;
  }
  return "";
}

function buildImportedImageBucketKeys(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const keys = new Set<string>();
  const sourceFile = normalizeImportedLoose(extractImportedOriginalSourceFileName(item));
  const sheetName = normalizeImportedLoose(extractImportedSourceSheetName(item));
  const sheetScopedKey = normalizeImportedLoose(extractImportedSheetScopedKey(item));
  const worksheetRowNumber = extractImportedWorksheetRowNumber(item);
  const itemNumber = normalizeImportedLoose(extractImportedSourceItemNumber(item));

  if (sourceFile) {
    keys.add(sourceFile);
    if (sheetName) {
      keys.add(`${sourceFile}::sheet::${sheetName}`);
    }
    if (sheetScopedKey) {
      keys.add(`${sourceFile}::${sheetScopedKey}`);
      keys.add(sheetScopedKey);
    }
    if (sheetName && worksheetRowNumber != null) {
      keys.add(`${sourceFile}::${sheetName}::row::${worksheetRowNumber}`);
    }
    if (sheetName && itemNumber) {
      keys.add(`${sourceFile}::${sheetName}::item::${itemNumber}`);
    }
    if (itemNumber) {
      keys.add(`${sourceFile}::item::${itemNumber}`);
    }
  }

  return Array.from(keys).filter(Boolean);
}


function extractImportedFirstCurrencyValue(value: string | null | undefined) {
  const source = String(value || "");
  if (!source) return null;

  const match =
    source.match(/r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i) ||
    source.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/);

  if (!match) return null;
  return parseImportedDecimal(match[1]);
}

function extractImportedExcelLikeName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const explicit = [
    extractMetadataValue(item, ["nome_do_produto", "nome do produto", "product_name", "productName", "name", "nome", "title", "titulo"]),
    extractImportedLabeledValue(String(item.rawText || ""), ["Nome do produto", "Produto", "Nome"]),
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);

  if (explicit) return explicit.slice(0, 160);
  return "";
}

function extractImportedCatalogSku(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  return (
    extractMetadataValue(item, ["sku", "codigo", "código"]) ||
    extractImportedLabeledValue(source, ["SKU", "Código", "Codigo"]) ||
    ""
  ).slice(0, 120);
}

function extractImportedCatalogStockQuantity(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");

  const labeledStock =
    extractImportedLabeledValue(source, [
      "Quantidade atual",
      "Estoque inicial",
      "Quantidade",
      "Stock inicial",
      "Stock quantity",
    ]) ||
    extractMetadataValue(item, [
      "quantidade_atual",
      "quantidade atual",
      "estoque_inicial",
      "estoque inicial",
      "stock_quantity",
    ]);

  const parsedLabeledStock = parseImportedDecimal(labeledStock);
  if (parsedLabeledStock != null) {
    return Math.max(0, Math.round(parsedLabeledStock));
  }

  const fallbackStock =
    extractImportedLabeledValue(source, ["Estoque", "Stock"]) ||
    extractMetadataValue(item, ["stock", "estoque"]);

  const parsedFallbackStock = parseImportedDecimal(fallbackStock);
  if (parsedFallbackStock == null) return 0;
  return Math.max(0, Math.round(parsedFallbackStock));
}

function buildImportedCatalogFallbackIdentity(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  destination: ImportedDestination
) {
  const sourceFileName = normalizeImportedLoose(extractImportedOriginalSourceFileName(item));
  const itemName = normalizeImportedLoose(buildImportedCatalogName(item));
  const priceCents = extractImportedCatalogPriceCents(item);
  const stockQuantity = extractImportedCatalogStockQuantity(item);
  const packageHint = normalizeImportedLoose(extractImportedWeightOrVolume(item));

  const parts = [
    "catalog",
    destination,
    sourceFileName ? `file::${sourceFileName}` : "file::unknown",
    itemName ? `name::${itemName}` : "name::sem_nome",
    priceCents != null ? `price::${priceCents}` : "price::na",
    stockQuantity > 0 ? `stock::${stockQuantity}` : "stock::0",
    packageHint ? `package::${packageHint}` : "package::na",
  ];

  return parts.join("::");
}

function buildImportedSaveKey(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const destination = resolveImportedDestination(item);
  const sourceLocationKey = buildImportedSourceLocationKey(item);

  if (destination === "pool") {
    if (sourceLocationKey) {
      return `pool::${sourceLocationKey}`;
    }
    return `pool::${normalizeImportedLoose(buildImportedPoolName(item))}`;
  }

  if (sourceLocationKey) {
    return `catalog::${destination}::${sourceLocationKey}`;
  }

  const sku = normalizeImportedLoose(extractImportedCatalogSku(item));
  if (sku) {
    return `catalog::${destination}::sku::${sku}`;
  }

  return buildImportedCatalogFallbackIdentity(item, destination);
}

function buildImportedRuntimeIdentityKeys(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const destination = resolveImportedDestination(item);
  const sourceLocationKey = buildImportedSourceLocationKey(item);

  if (destination === "pool") {
    if (sourceLocationKey) {
      return [`pool::${sourceLocationKey}`];
    }
    const poolName = normalizeImportedLoose(buildImportedPoolName(item));
    return poolName ? [`pool::${poolName}`] : [];
  }

  if (sourceLocationKey) {
    return [`catalog::${destination}::${sourceLocationKey}`];
  }

  const sku = normalizeImportedLoose(extractImportedCatalogSku(item));
  if (sku) {
    return [`catalog::${destination}::sku::${sku}`];
  }

  return [buildImportedCatalogFallbackIdentity(item, destination)];
}

function scoreImportedItemForSave(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const description = buildImportedCatalogDescription(item) || buildImportedPoolDescription(item) || "";
  const hasSku = Boolean(extractImportedCatalogSku(item));
  const hasPrice = extractImportedCatalogPriceCents(item) != null;
  const stockQuantity = extractImportedCatalogStockQuantity(item);
  const nonEmptyMetadata = Object.values(item.metadata ?? {}).filter(
    (value) => typeof value === "string" && value.trim()
  ).length;

  return (
    (hasSku ? 120 : 0) +
    (hasPrice ? 90 : 0) +
    (stockQuantity != null && stockQuantity > 0 ? 60 : 0) +
    Math.min(description.length, 600) +
    nonEmptyMetadata * 4 +
    (item.confidence ?? 0) * 10
  );
}

function dedupeImportedItemsForSave(
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>
) {
  const bestByKey = new Map<string, {
    item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
    score: number;
    index: number;
  }>();

  items.forEach((item, index) => {
    const key = buildImportedSaveKey(item);
    const score = scoreImportedItemForSave(item);
    const current = bestByKey.get(key);
    if (!current || score > current.score) {
      bestByKey.set(key, { item, score, index });
    }
  });

  const exactDedupedItems = Array.from(bestByKey.values())
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.item);

  const bestByRuntimeIdentity = new Map<string, {
    item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
    score: number;
    index: number;
  }>();

  exactDedupedItems.forEach((item, index) => {
    const identityKeys = buildImportedRuntimeIdentityKeys(item);
    const score = scoreImportedItemForSave(item);

    if (identityKeys.length === 0) {
      bestByRuntimeIdentity.set(`fallback::${index}`, { item, score, index });
      return;
    }

    const currentEntries = identityKeys
      .map((key) => bestByRuntimeIdentity.get(key))
      .filter(Boolean) as Array<{
      item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
      score: number;
      index: number;
    }>;

    const bestCurrent = currentEntries.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })[0];

    if (!bestCurrent || score > bestCurrent.score) {
      for (const key of identityKeys) {
        bestByRuntimeIdentity.set(key, { item, score, index });
      }
    }
  });

  const uniqueItems = new Map<string, {
    item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
    score: number;
    index: number;
  }>();

  for (const entry of bestByRuntimeIdentity.values()) {
    const stableKey = buildImportedSaveKey(entry.item);
    const current = uniqueItems.get(stableKey);
    if (!current || entry.score > current.score) {
      uniqueItems.set(stableKey, entry);
    }
  }

  return Array.from(uniqueItems.values())
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.item);
}

function buildImportedCatalogName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const pickName = (value: string | null | undefined) => {
    const cleaned = cleanupImportedDescriptionLine(String(value || ""));
    return cleaned && !isGenericImportedName(cleaned) ? cleaned.slice(0, 160) : "";
  };

  const excelLikeName = extractImportedExcelLikeName(item);
  const safeExcelLikeName = pickName(excelLikeName);
  if (safeExcelLikeName) return safeExcelLikeName;

  const title = pickName(item.title);
  if (title && !/\.xlsx?\s*[•·-]\s*item\s*\d+/i.test(title)) {
    return title.slice(0, 160);
  }

  const raw = String(item.rawText ?? "").trim();
  if (!raw) return "Item importado";

  const fromDescription = extractImportedNameFromNarrative(
    [
      extractMetadataValue(item, ["clean_description", "description", "descricao", "descriÃ§Ã£o"]),
      buildImportedCatalogDescription(item) || "",
      raw,
    ]
      .filter(Boolean)
      .join("\n")
  );
  if (fromDescription) return fromDescription;

  const fromRaw = extractImportedLabeledValue(raw, ["Nome do produto", "Produto", "Nome"]);
  const safeFromRaw = pickName(fromRaw);
  if (safeFromRaw) return safeFromRaw;

  return raw.slice(0, 160);
}

function isGenericImportedName(value: string | null | undefined) {
  const normalized = normalizeImportedLoose(value);
  if (!normalized) return true;
  if (isGenericImportedTitle(String(value || ""))) return true;
  if (
    normalized === "produto puro na esponja" ||
    normalized === "conforme analise" ||
    normalized.startsWith("dosagem ") ||
    /\b(?:ml|l|g|kg)\s+por\s+\d/.test(normalized)
  ) {
    return true;
  }
  return [
    "nome",
    "nome do produto",
    "produto",
    "titulo",
    "title",
    "item",
  ].includes(normalized);
}

function extractImportedNameFromNarrative(value: string | null | undefined) {
  const lines = String(value || "")
    .split("\n")
    .map((line) => cleanupImportedDescriptionLine(line))
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(.{3,120}?\b\d{3,4})\s+foi\s+/i);
    const candidate = cleanupImportedDescriptionLine(match?.[1] || "");
    if (candidate && !isGenericImportedName(candidate)) {
      return candidate.slice(0, 160);
    }
  }

  return "";
}

function extractImportedDosageFromText(value: string | null | undefined) {
  const source = String(value || "");
  const match =
    source.match(
      /\b(?:dosagem|dosage)\s*(?:de)?\s*[:\-]?\s*(\d+[\.,]?\d*\s*(?:ml|l|g|kg)\s+por\s+(?:\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?))/i
    ) ||
    source.match(/\b(?:dosagem|dosage)\s*(?:de)?\s*[:\-]?\s*([^.\n,;]+)/i);

  return cleanupImportedDescriptionLine(match?.[1] || "");
}

function dedupeDescriptionLines(lines: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const key = normalizeImportedLoose(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(line.trim());
  }
  return result;
}

function escapeImportedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanupImportedDescriptionLine(value: string) {
  return String(value || "")
    .replace(/\s*[-–—]+\s*item\s*\d+\b/giu, " ")
    .replace(/\bitem\s*\d+\b/giu, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,.;:])\1+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[-–—:;,\.\s]+/u, "")
    .replace(/[-–—:;,\.\s]+$/u, "")
    .trim();
}

function normalizeImportedNarrativeLine(value: string) {
  let cleaned = cleanupImportedDescriptionLine(value);

  cleaned = cleaned.replace(
    /^\s*(descri[cç][aã]o curta|descri[cç][aã]o resumida|descri[cç][aã]o|observa[cç][oõ]es|observa[cç][aã]o|obs\.?|notas?|notes?)\s*[:–-]\s*/iu,
    ""
  );

  cleaned = cleanupImportedDescriptionLine(cleaned);

  if (!cleaned) return "";

  const normalized = normalizeImportedLoose(cleaned);
  if (!normalized) return "";

  if (/^item\s*\d+$/iu.test(cleaned)) return "";

  return cleaned;
}

function stripImportedRepeatedDetailsFromText(
  source: string,
  details: Array<{ label: string; value: string }>
) {
  let cleaned = String(source || "");

  for (const detail of details) {
    const value = String(detail.value || "").trim();
    if (!value) continue;

    const labelPattern = escapeImportedRegExp(detail.label);
    const valuePattern = escapeImportedRegExp(value);

    cleaned = cleaned.replace(
      new RegExp(`(?:^|\\s)${labelPattern}\\s*[:–-]\\s*${valuePattern}(?=$|[\\s,.;])`, "giu"),
      " "
    );
  }

  const cleanedLines = cleaned
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeImportedNarrativeLine(line))
    .filter(Boolean);

  return cleanedLines.join("\n").trim();
}

function buildImportedCleanDescription(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const metadataCandidates = [
    extractMetadataValue(item, ["clean_description", "cleanDescription"]),
    extractMetadataValue(item, ["descricao", "descrição", "description"]),
    extractMetadataValue(item, ["notes", "observacao", "observação"]),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const candidate of metadataCandidates) {
    const cleaned = sanitizeImportedDescriptionText(candidate, item);
    if (cleaned) return cleaned;
  }

  return sanitizeImportedDescriptionText(String(item.rawText || ""), item);
}

function sanitizeImportedDescriptionText(
  source: string,
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const title = buildImportedCatalogName(item);
  const titleLoose = normalizeImportedLoose(title);
  const rawLines = String(source || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeImportedNarrativeLine(line))
    .filter(Boolean);

  const filtered = rawLines.filter((line) => {
    const normalized = normalizeImportedLoose(line);
    if (!normalized) return false;
    if (normalized === titleLoose) return false;

    const blockedStarts = [
      "categoria ",
      "categoria:",
      "nome ",
      "nome:",
      "nome do produto ",
      "nome do produto:",
      "linha ",
      "linha:",
      "aplicacao ",
      "aplicacao:",
      "aplicação ",
      "aplicação:",
      "embalagem ",
      "embalagem:",
      "preco ",
      "preco:",
      "preço ",
      "preço:",
      "valor ",
      "valor:",
      "medidas ",
      "medidas:",
      "profundidade ",
      "profundidade:",
      "capacidade ",
      "capacidade:",
      "material ",
      "material:",
      "formato ",
      "formato:",
      "marca ",
      "marca:",
      "sku ",
      "sku:",
      "peso ",
      "peso:",
      "peso volume ",
      "peso volume:",
      "peso/volume ",
      "peso/volume:",
      "dosagem ",
      "dosagem:",
      "cor ",
      "cor:",
      "uso ",
      "uso:",
      "quantidade atual ",
      "quantidade atual:",
      "estoque minimo ",
      "estoque minimo:",
      "estoque máximo ",
      "estoque máximo:",
      "estoque maximo ",
      "estoque maximo:",
      "estoque ",
      "estoque:",
      "controlar estoque ",
      "controlar estoque:",
      "codigo de barras ",
      "codigo de barras:",
      "código de barras ",
      "código de barras:",
      "barcode ",
      "barcode:",
    ];

    if (blockedStarts.some((value) => normalized.startsWith(value))) {
      return false;
    }

    const blockedIncludes = [
      "arquivo de teste",
      "validar upload inteligente",
      "validar leitura",
      "upload inteligente",
      "categoria esperada no sistema",
      "salvar em configuracoes",
      "salvar em configurações",
      "guia leitura",
      "guia de leitura",
      "aba guia leitura",
      "aba guia de leitura",
      "planilha estoque",
      "aba estoque",
      "sheet estoque",
      "catalogo_quimicos",
      "catalogo quimicos",
      "catálogo químicos",
      "planilha catalogo quimicos",
      "planilha catalogo_quimicos",
      "=== item",
      "controlar estoque ativo",
    ];

    if (blockedIncludes.some((value) => normalized.includes(value))) {
      return false;
    }

    return true;
  });

  const joined = dedupeDescriptionLines(filtered).join("\n").trim();
  return joined ? joined.slice(0, 4000) : null;
}


function buildImportedDescriptionSentence(value: string) {
  const cleaned = cleanupImportedDescriptionLine(value)
    .replace(/\s*,\s*\./g, ".")
    .replace(/\.\s*,/g, ".")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) return "";

  const sentence = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function buildImportedMaterialSentence(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const material = cleanupImportedDescriptionLine(
    extractMetadataValue(item, ["material", "matéria-prima", "materia_prima"])
  );
  const color = cleanupImportedDescriptionLine(
    extractMetadataValue(item, ["cor", "color"])
  );

  if (!material && !color) return "";

  if (material && color) {
    return `Construção em ${material}, com acabamento ${color}`;
  }

  if (material) {
    return `Construção em ${material}`;
  }

  return `Acabamento ${color}`;
}

function shouldSkipImportedDescriptionPart(candidate: string, chosen: string[]) {
  const normalizedCandidate = normalizeImportedLoose(candidate);
  if (!normalizedCandidate) return true;

  return chosen.some((part) => {
    const normalizedPart = normalizeImportedLoose(part);
    if (!normalizedPart) return false;
    if (normalizedPart === normalizedCandidate) return true;
    if (normalizedPart.includes(normalizedCandidate)) return true;
    if (normalizedCandidate.includes(normalizedPart) && normalizedPart.length >= 18) return true;

    const candidateWords = normalizedCandidate.split(" ").filter(Boolean);
    const partWords = normalizedPart.split(" ").filter(Boolean);
    const overlap = candidateWords.filter((word) => partWords.includes(word));
    const minWords = Math.min(candidateWords.length, partWords.length);

    return minWords >= 4 && overlap.length >= Math.max(3, minWords - 1);
  });
}

function finalizeImportedDescriptionParts(parts: string[]) {
  const chosen: string[] = [];

  for (const part of parts) {
    const cleaned = cleanupImportedDescriptionLine(part)
      .replace(/\s*,\s*\./g, ".")
      .replace(/\.\s*,/g, ".")
      .replace(/\s+,/g, ",")
      .replace(/\s+\./g, ".")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (!cleaned) continue;
    if (shouldSkipImportedDescriptionPart(cleaned, chosen)) continue;

    chosen.push(cleaned);
    if (chosen.length >= 3) break;
  }

  return chosen.map(buildImportedDescriptionSentence).filter(Boolean).join(" ").trim() || null;
}

function buildImportedCatalogDescription(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  const baseDescription = buildImportedCleanDescription(item) || "";
  const shortDescription =
    extractMetadataValue(item, ["descricao_curta", "descrição curta", "short_description"]) ||
    extractImportedLabeledValue(source, ["Descrição curta", "Descricao curta", "Descrição", "Descricao"]);
  const notesValue =
    extractMetadataValue(item, ["observacoes", "observações", "notes", "observacao", "observação"]) ||
    extractImportedLabeledValue(source, ["Observações", "Observacoes", "Notas"]);

  const narrativeLines = dedupeDescriptionLines(
    [
      ...(sanitizeImportedDescriptionText(shortDescription || "", item)?.split("\n") ?? []),
      ...(sanitizeImportedDescriptionText(baseDescription || "", item)?.split("\n") ?? []),
      ...(sanitizeImportedDescriptionText(notesValue || "", item)?.split("\n") ?? []),
    ]
      .map((value) => normalizeImportedNarrativeLine(value))
      .filter(Boolean)
  );

  const applicationValue =
    extractMetadataValue(item, ["application", "aplicacao", "aplicação", "usage", "uso"]) ||
    extractImportedLabeledValue(source, ["Aplicação", "Aplicacao", "Uso"]);
  const applicationLine = normalizeImportedNarrativeLine(String(applicationValue || ""));

  const materialLine = normalizeImportedNarrativeLine(buildImportedMaterialSentence(item));

  const preferredParts: string[] = [];

  if (narrativeLines[0]) preferredParts.push(narrativeLines[0]);
  if (applicationLine) preferredParts.push(applicationLine);

  for (const extraLine of narrativeLines.slice(1)) {
    preferredParts.push(extraLine);
  }

  if (materialLine) preferredParts.push(materialLine);

  return finalizeImportedDescriptionParts(preferredParts);
}

function parseImportedDecimal(value: string | null | undefined) {
  if (value == null) return null;

  const source = String(value)
    .trim()
    .replace(/[^\d,.-]/g, "");

  if (!source) return null;

  const lastComma = source.lastIndexOf(",");
  const lastDot = source.lastIndexOf(".");

  let normalized = source;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    normalized =
      decimalSeparator === ","
        ? source.replace(/\./g, "").replace(",", ".")
        : source.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const fractional = source.slice(lastComma + 1).replace(/\D/g, "");
    normalized =
      fractional.length > 0 && fractional.length <= 2
        ? source.replace(/\./g, "").replace(",", ".")
        : source.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const fractional = source.slice(lastDot + 1).replace(/\D/g, "");
    normalized =
      fractional.length > 0 && fractional.length <= 2
        ? source.replace(/,/g, "")
        : source.replace(/\./g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractImportedBestMoneyValue(value: string | null | undefined) {
  const source = String(value || "").trim();
  if (!source) return null;

  const currencyMatch = source.match(/r\$\s*([\d.,]+)/i);
  if (currencyMatch) {
    const parsedCurrency = parseImportedDecimal(currencyMatch[1]);
    if (parsedCurrency != null) return parsedCurrency;
  }

  const decimalMatch = source.match(/(\d+[.,]\d{2})/);
  if (decimalMatch) {
    const parsedDecimal = parseImportedDecimal(decimalMatch[1]);
    if (parsedDecimal != null) return parsedDecimal;
  }

  const normalized = normalizeImportedLoose(source);
  const integerTokens = source.match(/\d+/g) ?? [];
  if (
    (normalized.includes("preco") ||
      normalized.includes("valor") ||
      normalized.includes("price")) &&
    integerTokens.length >= 2
  ) {
    const cents = integerTokens[integerTokens.length - 1];
    const integer = integerTokens[integerTokens.length - 2];

    if (cents.length === 2) {
      const reconstructed = parseImportedDecimal(`${integer}.${cents}`);
      if (reconstructed != null) return reconstructed;
    }
  }

  const genericParsed = extractImportedFirstCurrencyValue(source);
  if (genericParsed != null) return genericParsed;

  const numericMatches = source.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (numericMatches.length === 1) {
    const parsedSingle = parseImportedDecimal(numericMatches[0]);
    if (parsedSingle != null) return parsedSingle;
  }

  return null;
}
function extractImportedPoolMetrics(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = [item.title, item.rawText, ...Object.values(item.metadata ?? {})]
    .map((value) => String(value ?? ""))
    .join(" ");
  let width: number | null = null;
  let length: number | null = null;
  let depth: number | null = null;
  let capacity: number | null = null;
  let price: number | null = null;
  const rectMatch = source.match(/(\d+[\.,]?\d*)\s*x\s*(\d+[\.,]?\d*)\s*m/i);
  if (rectMatch) {
    width = parseImportedDecimal(rectMatch[1]);
    length = parseImportedDecimal(rectMatch[2]);
  }
  const diamMatch = source.match(/(\d+[\.,]?\d*)\s*m\s*di[âa]m/i);
  if (diamMatch) {
    width = parseImportedDecimal(diamMatch[1]);
    length = parseImportedDecimal(diamMatch[1]);
  }
  const explicitDepth = extractMetadataValue(item, ["profundidade", "depth"]);
  const depthSource = explicitDepth || source;
  const depthMatch =
    depthSource.match(/profundidade\s*(?:de|do|da)?\s*[:\-]?\s*(\d+(?:[\.,]\d+)?)\s*m?/i) ||
    depthSource.match(/^(\d+(?:[\.,]\d+)?)\s*m?$/i) ||
    source.match(/prof\.?\s*[:\-]?\s*(\d+(?:[\.,]\d+)?)\s*m\b/i);
  if (depthMatch) {
    depth = parseImportedDecimal(depthMatch[1]);
  }
  const capacityMatch =
    source.match(/capacidade(?:\s+estimada|\s+m[áa]xima|\s+aproximada)?\s*(?:de)?\s*(\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?)?/i) ||
    source.match(/(\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?)\b/i);
  if (capacityMatch) {
    capacity = parseImportedDecimal(capacityMatch[1]);
  }
  const priceMatch =
    source.match(/r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i) ||
    source.match(/pre[cç]o\s*(?:estimado|aproximado)?\s*(?:de)?\s*r\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i);
  if (priceMatch) {
    price = parseImportedDecimal(priceMatch[1]);
  }
  const explicitMaterial = normalizeImportedLoose(
    extractMetadataValue(item, ["tipo", "material", "matéria-prima", "materia_prima"])
  );
  const materialSource = explicitMaterial || normalizeImportedLoose(source);
  let material = "fibra";
  if (materialSource.includes("spa")) material = "spa";
  else if (materialSource.includes("vinil")) material = "vinil";
  else if (materialSource.includes("alvenaria")) material = "alvenaria";
  else if (materialSource.includes("pastilha")) material = "pastilha";
  else if (materialSource.includes("fibra")) material = "fibra";
  const explicitShape = normalizeImportedLoose(extractMetadataValue(item, ["formato", "shape"]));
  const shapeSource = explicitShape || normalizeImportedLoose(source);
  let shape = "retangular";
  if (shapeSource.includes("com prainha") || shapeSource.includes("prainha")) {
    shape = "com prainha";
  } else if (shapeSource.includes("organica")) {
    shape = "organica";
  } else if (shapeSource.includes("diam") || shapeSource.includes("redonda")) {
    shape = "redonda";
  } else if (shapeSource.includes("oval")) {
    shape = "oval";
  } else if (shapeSource.includes("raia")) {
    shape = "raia";
  } else if (shapeSource.includes("retangular")) {
    shape = "retangular";
  }
  return {
    width_m: width,
    length_m: length,
    depth_m: depth,
    max_capacity_l: capacity,
    material,
    shape,
    price,
  };
}

function extractImportedCatalogPriceCents(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  const metadataEntries = Object.entries(item.metadata ?? {});
  const normalizedMetadataEntries = metadataEntries.map(([key, value]) => [
    normalizeImportedLoose(key),
    String(value ?? "").trim(),
  ] as const);

  for (const [normalizedKey, rawValue] of normalizedMetadataEntries) {
    if (
      normalizedKey.includes("price cents") ||
      normalizedKey.includes("price_cents") ||
      normalizedKey.includes("preco centavos") ||
      normalizedKey.includes("preco_centavos")
    ) {
      const centsValue = Number(String(rawValue).replace(/[^\d-]/g, ""));
      if (Number.isFinite(centsValue) && centsValue > 0) {
        return Math.round(centsValue);
      }
    }
  }

  const labeledPrice =
    extractImportedLabeledValue(source, [
      "Preço venda (R$)",
      "Preço de venda (R$)",
      "Preço venda",
      "Preço de venda",
      "Preco venda (R$)",
      "Preco de venda (R$)",
      "Preco venda",
      "Preco de venda",
      "Preço final (R$)",
      "Preço final",
      "Preco final (R$)",
      "Preco final",
      "Preço unitário (R$)",
      "Preço unitário",
      "Preco unitario (R$)",
      "Preco unitario",
      "Valor unitário",
      "Valor unitario",
      "Preço",
      "Preco",
      "Valor",
    ]) ||
    extractMetadataValue(item, [
      "preco_venda",
      "preco_de_venda",
      "preço_venda",
      "preço_de_venda",
      "preço venda",
      "preço de venda",
      "preco venda",
      "preco de venda",
      "preco_final",
      "preço_final",
      "preço final",
      "preco final",
      "preco_unitario",
      "preço_unitário",
      "preço unitário",
      "preco unitario",
      "valor_venda",
      "valor venda",
      "valor_unitario",
      "valor unitario",
      "price",
      "valor",
    ]);

  const directPrice = extractImportedBestMoneyValue(labeledPrice);
  if (directPrice != null) return Math.round(directPrice * 100);

  const metadataPriceCandidates = normalizedMetadataEntries
    .filter(([normalizedKey, rawValue]) => {
      if (!rawValue) return false;
      return (
        normalizedKey.includes("preco") ||
        normalizedKey.includes("valor") ||
        normalizedKey.includes("price")
      );
    })
    .map(([, rawValue]) => rawValue);

  for (const candidate of metadataPriceCandidates) {
    const parsedCandidate = extractImportedBestMoneyValue(candidate);
    if (parsedCandidate != null) return Math.round(parsedCandidate * 100);
  }

  const lines = source
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const priceLines = lines.filter((line) => {
    const normalized = normalizeImportedLoose(line);
    return (
      normalized.startsWith("preco venda") ||
      normalized.startsWith("preco de venda") ||
      normalized.startsWith("preço venda") ||
      normalized.startsWith("preço de venda") ||
      normalized.startsWith("preco final") ||
      normalized.startsWith("preço final") ||
      normalized.startsWith("preco unitario") ||
      normalized.startsWith("preço unitário") ||
      normalized.startsWith("valor unitario") ||
      normalized === "preco" ||
      normalized.startsWith("preco ") ||
      normalized === "preço" ||
      normalized.startsWith("preço ") ||
      normalized === "valor" ||
      normalized.startsWith("valor ") ||
      line.includes("R$")
    );
  });

  for (const line of priceLines) {
    const parsedLineValue = extractImportedBestMoneyValue(line);
    if (parsedLineValue != null) return Math.round(parsedLineValue * 100);
  }

  const fullSource = [item.title, item.rawText, ...Object.values(item.metadata ?? {})]
    .map((value) => String(value ?? ""))
    .join(" ");

  const salePriceMatch =
    fullSource.match(
      /pre[cç]o\s+(?:de\s+)?venda(?:\s*\(r\$\))?\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)/i
    ) ||
    fullSource.match(
      /valor\s+(?:de\s+)?venda\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)/i
    );

  if (salePriceMatch) {
    const parsedSale = parseImportedDecimal(salePriceMatch[1]);
    if (parsedSale != null) return Math.round(parsedSale * 100);
  }

  const genericPriceMatch =
    fullSource.match(/r\$\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)/i) ||
    fullSource.match(
      /pre[cç]o\s*(?:estimado|aproximado)?\s*(?:de)?\s*r\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)/i
    );

  if (!genericPriceMatch) return null;

  const parsedGeneric = parseImportedDecimal(genericPriceMatch[1]);
  if (parsedGeneric == null) return null;

  return Math.round(parsedGeneric * 100);
}

function extractImportedImageSourceItemNumber(image: {
  source?: string;
  sheetScopedKey?: string;
  fileName?: string;
}) {
  const source = [String(image.source || ""), String(image.sheetScopedKey || ""), String(image.fileName || "")].join(" ");
  const match = source.match(/\bitem\s*(\d{1,6})\b/i);
  if (!match?.[1]) return null;
  const parsedValue = Number(match[1]);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function buildExtractedImageBucketKeys(image: {
  sourceFileName?: string;
  originalSourceFileName?: string;
  sheetName?: string;
  source?: string;
  sheetScopedKey?: string;
  worksheetRowNumber?: number;
}) {
  const keys = new Set<string>();
  const sourceFileName = normalizeImportedLoose(
    image.originalSourceFileName || image.sourceFileName
  );
  const sheetName = normalizeImportedLoose(image.sheetName);
  const itemNumber = extractImportedImageSourceItemNumber(image);
  const worksheetRowNumber =
    typeof image.worksheetRowNumber === "number" && image.worksheetRowNumber > 0
      ? image.worksheetRowNumber
      : null;

  if (sourceFileName) {
    keys.add(sourceFileName);
    if (sheetName) {
      keys.add(`${sourceFileName}::sheet::${sheetName}`);
      if (worksheetRowNumber != null) {
        keys.add(`${sourceFileName}::${sheetName}::row::${worksheetRowNumber}`);
      }
      if (itemNumber != null) {
        keys.add(`${sourceFileName}::${sheetName}::item::${itemNumber}`);
      }
    }
    if (itemNumber != null) {
      keys.add(`${sourceFileName}::item::${itemNumber}`);
    }
  }

  const explicitScopedKey = normalizeImportedLoose(image.sheetScopedKey);
  if (explicitScopedKey) {
    keys.add(explicitScopedKey);
    if (sourceFileName) {
      keys.add(`${sourceFileName}::${explicitScopedKey}`);
    }
  }

  return Array.from(keys).filter(Boolean);
}

function buildExtractedImageSourceLocationKey(image: {
  sourceFileName?: string;
  originalSourceFileName?: string;
  sheetName?: string;
  sheetScopedKey?: string;
  worksheetRowNumber?: number;
  source?: string;
  fileName?: string;
}) {
  const sourceFileName = normalizeImportedLoose(
    image.originalSourceFileName || image.sourceFileName
  );
  const explicitScopedKey = normalizeImportedLoose(image.sheetScopedKey);
  const sheetName = normalizeImportedLoose(image.sheetName);
  const worksheetRowNumber =
    typeof image.worksheetRowNumber === "number" && image.worksheetRowNumber > 0
      ? image.worksheetRowNumber
      : null;
  const itemNumber = extractImportedImageSourceItemNumber(image);

  if (sourceFileName && explicitScopedKey) {
    return `${sourceFileName}::${explicitScopedKey}`;
  }
  if (sourceFileName && sheetName && worksheetRowNumber != null) {
    return `${sourceFileName}::${sheetName}::row::${worksheetRowNumber}`;
  }
  if (sourceFileName && sheetName && itemNumber != null) {
    return `${sourceFileName}::${sheetName}::item::${itemNumber}`;
  }
  if (sourceFileName && itemNumber != null) {
    return `${sourceFileName}::item::${itemNumber}`;
  }
  return "";
}

function buildDeterministicExtractedImageAssignments(
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>,
  extractedImageSequence: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    dataUrl: string;
    sourceFileName: string;
    originalSourceFileName?: string;
    source?: string;
    sheetName?: string;
    rowIndex?: number;
    columnIndex?: number;
    imageOrder?: number;
    worksheetRowNumber?: number;
    sheetScopedKey?: string;
  }>
) {
  const assignments = new Map<string, Array<{ fileName: string; mimeType: string; dataUrl: string }>>();
  const availableImages = [...extractedImageSequence];
  const imageByLocationKey = new Map<string, typeof extractedImageSequence[number][]>();

  for (const image of availableImages) {
    const locationKey = buildExtractedImageSourceLocationKey(image);
    if (!locationKey) continue;
    const current = imageByLocationKey.get(locationKey) ?? [];
    current.push(image);
    imageByLocationKey.set(locationKey, current);
  }

  for (const item of items) {
    const saveKey = buildImportedSaveKey(item);
    const locationKey = buildImportedSourceLocationKey(item);
    if (!saveKey || !locationKey) continue;
    const candidates = imageByLocationKey.get(locationKey) ?? [];
    const candidate = candidates.shift();
    if (!candidate) continue;
    assignments.set(saveKey, [
      {
        fileName: candidate.fileName,
        mimeType: candidate.mimeType,
        dataUrl: candidate.dataUrl,
      },
    ]);
  }

  return assignments;
}

function pickBestRelatedFallbackImage(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  extractedImageSequence: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    dataUrl: string;
    sourceFileName: string;
    originalSourceFileName?: string;
    source?: string;
    sheetName?: string;
    rowIndex?: number;
    columnIndex?: number;
    imageOrder?: number;
    worksheetRowNumber?: number;
    sheetScopedKey?: string;
  }>,
  consumedExtractedImageIds: Set<string>
) {
  const sourceFileName = normalizeImportedLoose(item.sourceFileName);
  const sourceSheetName = normalizeImportedLoose(extractImportedSourceSheetName(item));
  const sourceItemNumberRaw = extractImportedSourceItemNumber(item);
  const sourceItemNumber = sourceItemNumberRaw ? Number(sourceItemNumberRaw) : null;

  const candidates = extractedImageSequence.filter((candidate) => {
    if (!candidate || consumedExtractedImageIds.has(candidate.id)) return false;
    if (normalizeImportedLoose(candidate.originalSourceFileName || candidate.sourceFileName) !== sourceFileName) return false;
    if (sourceSheetName) {
      const candidateSheetName = normalizeImportedLoose(candidate.sheetName);
      if (candidateSheetName && candidateSheetName !== sourceSheetName) return false;
    }
    return true;
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  if (sourceItemNumber != null) {
    const candidatesWithItemNumber = candidates
      .map((candidate) => ({
        candidate,
        itemNumber: extractImportedImageSourceItemNumber(candidate),
      }))
      .filter((entry) => entry.itemNumber != null) as Array<{
      candidate: (typeof candidates)[number];
      itemNumber: number;
    }>;

    if (candidatesWithItemNumber.length > 0) {
      candidatesWithItemNumber.sort((left, right) => {
        const leftDistance = Math.abs(left.itemNumber - sourceItemNumber);
        const rightDistance = Math.abs(right.itemNumber - sourceItemNumber);
        if (leftDistance !== rightDistance) return leftDistance - rightDistance;
        return left.itemNumber - right.itemNumber;
      });
      return candidatesWithItemNumber[0].candidate;
    }
  }

  return candidates[candidates.length - 1];
}

function pickRelatedExtractedImages(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  extractedImageBuckets: Map<
    string,
    Array<{
      id: string;
      fileName: string;
      mimeType: string;
      dataUrl: string;
      sourceFileName: string;
      originalSourceFileName?: string;
      source?: string;
      sheetName?: string;
      rowIndex?: number;
      columnIndex?: number;
      imageOrder?: number;
      worksheetRowNumber?: number;
      sheetScopedKey?: string;
    }>
  >,
  extractedImageBucketCursors: Map<string, number>,
  extractedImageSequence: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    dataUrl: string;
    sourceFileName: string;
    originalSourceFileName?: string;
    source?: string;
    sheetName?: string;
    rowIndex?: number;
    columnIndex?: number;
    imageOrder?: number;
    worksheetRowNumber?: number;
    sheetScopedKey?: string;
  }>,
  consumedExtractedImageIds: Set<string>,
  totalSourceItems: number
) {
  const sourceBucketKeys = buildImportedImageBucketKeys(item);

  const tryConsumeFromBucket = (bucketKey: string) => {
    const bucket = extractedImageBuckets.get(bucketKey);
    if (!bucket || bucket.length === 0) {
      return [] as Array<{ fileName: string; mimeType: string; dataUrl: string }>;
    }

    let cursor = extractedImageBucketCursors.get(bucketKey) ?? 0;

    while (cursor < bucket.length) {
      const candidate = bucket[cursor];
      cursor += 1;
      extractedImageBucketCursors.set(bucketKey, cursor);

      if (!candidate || consumedExtractedImageIds.has(candidate.id)) {
        continue;
      }

      consumedExtractedImageIds.add(candidate.id);
      return [
        {
          fileName: candidate.fileName,
          mimeType: candidate.mimeType,
          dataUrl: candidate.dataUrl,
        },
      ];
    }

    return [] as Array<{ fileName: string; mimeType: string; dataUrl: string }>;
  };

  for (const bucketKey of sourceBucketKeys) {
    const direct = tryConsumeFromBucket(bucketKey);
    if (direct.length > 0) return direct;
  }

  const sourceFileKey = normalizeImportedLoose(item.sourceFileName).replace(/\.[^.]+$/, "");
  if (sourceFileKey) {
    for (const key of extractedImageBuckets.keys()) {
      const normalizedKey = key.replace(/\.[^.]+$/, "");
      if (
        normalizedKey === sourceFileKey ||
        normalizedKey.includes(sourceFileKey) ||
        sourceFileKey.includes(normalizedKey)
      ) {
        const related = tryConsumeFromBucket(key);
        if (related.length > 0) return related;
      }
    }
  }

  const specificRelatedFallback = pickBestRelatedFallbackImage(
    item,
    extractedImageSequence,
    consumedExtractedImageIds
  );
  if (specificRelatedFallback) {
    consumedExtractedImageIds.add(specificRelatedFallback.id);
    return [
      {
        fileName: specificRelatedFallback.fileName,
        mimeType: specificRelatedFallback.mimeType,
        dataUrl: specificRelatedFallback.dataUrl,
      },
    ];
  }

  if (totalSourceItems === 1) {
    for (const key of extractedImageBuckets.keys()) {
      const fallback = tryConsumeFromBucket(key);
      if (fallback.length > 0) return fallback;
    }
  }

  const globalFallback = extractedImageSequence.find(
    (candidate) => !consumedExtractedImageIds.has(candidate.id)
  );

  if (!globalFallback) {
    return [] as Array<{ fileName: string; mimeType: string; dataUrl: string }>;
  }

  consumedExtractedImageIds.add(globalFallback.id);
  return [
    {
      fileName: globalFallback.fileName,
      mimeType: globalFallback.mimeType,
      dataUrl: globalFallback.dataUrl,
    },
  ];
}
function canPersistAsPool(metrics: {
  width_m: number | null;
  length_m: number | null;
  depth_m: number | null;
  max_capacity_l: number | null;
}) {
  return (
    metrics.width_m != null &&
    metrics.length_m != null &&
    (metrics.depth_m != null || metrics.max_capacity_l != null)
  );
}
function normalizeImportedLoose(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function extractMetadataValue(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  keys: string[]
) {
  for (const key of keys) {
    const direct = item.metadata?.[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
  }
  const lowerKeyMap = Object.entries(item.metadata ?? {}).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (typeof value === "string" && value.trim()) {
        acc[key.toLowerCase()] = value.trim();
      }
      return acc;
    },
    {}
  );
  for (const key of keys) {
    const found = lowerKeyMap[key.toLowerCase()];
    if (found) return found;
  }
  return "";
}
function isGenericImportedTitle(title: string) {
  const normalized = normalizeImportedLoose(title);
  if (!normalized) return true;
  const blockedStarts = [
    "catalogo de teste",
    "descricao detalhada",
    "regra comercial",
    "arquivo de teste",
    "nome do item",
  ];
  if (blockedStarts.some((item) => normalized === item || normalized.startsWith(item))) {
    return true;
  }
  if (normalized === "piscina" || normalized === "item importado") {
    return true;
  }
  return false;
}
function shouldSkipImportedItem(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const normalizedTitle = normalizeImportedLoose(item.title);
  const normalizedRaw = normalizeImportedLoose(item.rawText);
  const normalizedType = normalizeImportedLoose(item.type);
  if (normalizedType === "commercial rule" || normalizedType === "commercial_rule") {
    return true;
  }
  if (normalizedType === "store info" || normalizedType === "store_info") {
    return true;
  }
  if (normalizedType === "responsible info" || normalizedType === "responsible_info") {
    return true;
  }
  if (normalizedType === "unknown" && item.confidence <= 0.35) {
    return true;
  }
  if (isGenericImportedTitle(item.title) && item.confidence <= 0.75) {
    return true;
  }
  if (
    normalizedRaw.includes("arquivo de teste") &&
    normalizedRaw.includes("validar upload inteligente") &&
    !normalizedRaw.includes("r$") &&
    !normalizedRaw.includes("capacidade") &&
    !normalizedRaw.includes("profundidade")
  ) {
    return true;
  }

if (
  normalizedRaw.includes("planilha estoque") ||
  normalizedRaw.includes("aba estoque") ||
  normalizedRaw.includes("sheet estoque")
) {
  return true;
}

  return false;
}

const IMPORTED_POOL_ACCESSORY_TERMS = [
  "capa",
  "filtro",
  "bomba",
  "escada",
  "refletor",
  "kit",
  "cloro",
  "aspirador",
  "peneira",
  "mangueira",
  "skimmer",
  "iluminacao",
  "dispositivo",
  "retorno",
  "hidromassagem",
];

function looksLikeDuplicatedSavedPoolCatalogItem(args: {
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
  itemName: string;
  metrics: ReturnType<typeof extractImportedPoolMetrics>;
  savedPoolNames: Set<string>;
}) {
  if (args.savedPoolNames.size === 0) return false;

  const normalizedItemName = normalizeImportedLoose(args.itemName);
  const normalizedText = normalizeImportedLoose(
    [
      args.itemName,
      args.item.title,
      args.item.rawText,
      ...Object.values(args.item.metadata ?? {}),
    ].join(" ")
  );

  if (!normalizedItemName || !normalizedText.includes("piscina")) return false;
  if (IMPORTED_POOL_ACCESSORY_TERMS.some((term) => normalizedText.includes(term))) return false;

  const hasPoolMetric =
    (args.metrics.width_m != null && args.metrics.length_m != null) ||
    /\b\d+[\.,]?\d*\s*x\s*\d+[\.,]?\d*\s*m?\b/i.test(String(args.itemName || args.item.rawText || ""));

  if (!hasPoolMetric) return false;

  for (const savedPoolName of args.savedPoolNames) {
    if (!savedPoolName) continue;
    if (normalizedItemName.includes(savedPoolName) || savedPoolName.includes(normalizedItemName)) {
      return true;
    }
  }

  return false;
}

function looksLikeImportedDocumentIntroCatalogItem(args: {
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
  itemName: string;
  category: ImportedCatalogCategory;
  metrics: ReturnType<typeof extractImportedPoolMetrics>;
}) {
  if (!["outros", "acessorios", "quimicos"].includes(args.category)) return false;
  if (canPersistAsPool(args.metrics)) return false;

  const rawText = String(args.item.rawText || "");
  const normalizedName = normalizeImportedLoose(args.itemName);
  const normalizedText = normalizeImportedLoose(
    [
      args.itemName,
      args.item.title,
      rawText,
      ...Object.values(args.item.metadata ?? {}),
    ].join(" ")
  );

  const hasDocumentTitleSignal =
    normalizedName === "catalogo de acessorios" ||
    normalizedName === "catalogo de produtos quimicos" ||
    normalizedName === "catalogo de teste" ||
    normalizedName === "documento de teste" ||
    normalizedName.startsWith("catalogo de teste ");
  const hasRealProductNamePattern = /\b\d{3,4}$/.test(normalizedName) && !hasDocumentTitleSignal;
  const hasPrice = extractImportedCatalogPriceCents(args.item) != null;
  const hasIntroSignal =
    normalizedText.includes("arquivo ficticio") ||
    normalizedText.includes("catalogo de teste") ||
    normalizedText.includes("documento de teste") ||
    normalizedText.includes("documento de teste com 100 itens") ||
    normalizedText.includes("objetivo") ||
    normalizedText.includes("objetivo do arquivo") ||
    normalizedText.includes("validar importacao") ||
    normalizedText.includes("100 piscinas") ||
    normalizedText.includes("total de piscinas") ||
    normalizedText.includes("fake com foto") ||
    (hasDocumentTitleSignal && normalizedText.includes("docx"));

  if (!hasIntroSignal) return false;

  if (
    (args.category === "acessorios" || args.category === "quimicos") &&
    hasDocumentTitleSignal &&
    !hasPrice &&
    !hasRealProductNamePattern
  ) {
    return true;
  }

  const hasRealProductSignal =
    Boolean(extractImportedCatalogSku(args.item)) ||
    hasPrice ||
    Boolean(extractMetadataValue(args.item, ["embalagem", "package", "packaging", "marca", "brand"])) ||
    Boolean(extractImportedLabeledValue(rawText, ["Embalagem", "Marca", "SKU", "PreÃ§o", "Preco"])) ||
    normalizeImportedLoose(extractImportedSourceCategory(args.item)).includes("quimicos") ||
    normalizeImportedLoose(extractImportedSourceCategory(args.item)).includes("acessorios");

  return !hasRealProductSignal;
}

function resolveImportedDestination(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
): ImportedDestination {
  const explicitDestination = resolveImportedExplicitDestination(item);
  if (explicitDestination) return explicitDestination;

  const inferred = inferImportedDestination(item);
  if (inferred === "pool") {
    const metrics = extractImportedPoolMetrics(item);
    if (!canPersistAsPool(metrics)) {
      return normalizeImportedCatalogCategory(
        [
          extractImportedSourceCategory(item),
          extractImportedSourceSubcategory(item),
          extractImportedSourceSheetName(item),
          item.type,
          item.title,
        ].join(" ")
      );
    }
  }

  return inferred;
}
function buildImportedPoolName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const explicitTitle = extractMetadataValue(item, ["title", "titulo", "nome", "productName"]);
  const candidate = explicitTitle || item.title || item.rawText || "Piscina importada";
  return candidate
    .replace(/^Piscina\s*:\s*/i, "")
    .replace(/^Cat[aá]logo\s*:\s*/i, "")
    .replace(/^Nome do item\s*:\s*/i, "")
    .trim()
    .slice(0, 160);
}
function buildImportedPoolDescription(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  return buildImportedCleanDescription(item);
}

function extractImportedWeightOrVolume(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");

  return (
    extractMetadataValue(item, [
      "peso_volume",
      "peso volume",
      "peso",
      "volume",
      "conteudo",
      "conteúdo",
      "embalagem",
      "package",
      "packaging",
    ]) ||
    extractImportedLabeledValue(source, [
      "Peso/Volume",
      "Peso / Volume",
      "Peso",
      "Volume",
      "Conteúdo",
      "Conteudo",
      "Embalagem",
    ]) ||
    ""
  ).trim();
}

function buildImportedCatalogMetadata(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  category: ImportedCatalogCategory,
  metadataSource = "onboarding_intelligent_import"
) {
  const source = String(item.rawText || "");
  const sku =
    extractImportedCatalogSku(item) ||
    extractMetadataValue(item, ["sku", "codigo", "código"]);
  const line =
    extractMetadataValue(item, ["linha", "line"]) ||
    extractImportedLabeledValue(source, ["Linha"]);
  const application =
    extractMetadataValue(item, ["aplicacao", "aplicação", "application"]) ||
    extractImportedLabeledValue(source, ["Aplicação", "Aplicacao"]);
  const packaging =
    extractMetadataValue(item, ["embalagem", "package", "packaging"]) ||
    extractImportedLabeledValue(source, ["Embalagem"]);
  const dosage =
    extractMetadataValue(item, ["dosagem", "dose", "diluição", "diluicao"]) ||
    extractImportedLabeledValue(source, ["Dosagem", "Dose"]);
  const barcode =
    extractMetadataValue(item, ["codigo_barras", "código de barras", "barcode"]) ||
    extractImportedLabeledValue(source, ["Código de barras", "Codigo de barras", "Barcode"]);
  const stockInitial = extractImportedCatalogStockQuantity(item);
  const resolvedDosage =
    dosage ||
    extractMetadataValue(item, ["dosage"]) ||
    extractImportedDosageFromText(
      [
        extractMetadataValue(item, ["clean_description", "description", "descricao", "descriÃ§Ã£o"]),
        buildImportedCatalogDescription(item) || "",
        source,
      ]
        .filter(Boolean)
        .join("\n")
    );

  return {
    categoria: category,
    source: metadataSource,
    source_file_name: item.sourceFileName,
    source_type: item.type,
    confidence: item.confidence,
    dedup_key: "dedupKey" in item ? item.dedupKey : null,
    source_location_key: buildImportedSourceLocationKey(item) || null,
    source_sheet_name: extractImportedSourceSheetName(item) || null,
    source_category: extractImportedSourceCategory(item) || null,
    source_subcategory: extractImportedSourceSubcategory(item) || null,
    imported_title: buildImportedCatalogName(item),
    imported_dimensions: extractMetadataValue(item, ["medidas", "dimensions"]),
    imported_depth: extractMetadataValue(item, ["profundidade", "depth"]),
    imported_capacity: extractMetadataValue(item, ["capacidade", "capacity"]),
    imported_material: extractMetadataValue(item, ["material"]),
    imported_shape: extractMetadataValue(item, ["formato", "shape"]),
    imported_package: packaging,
    imported_weight_or_volume:
      extractMetadataValue(item, ["peso_volume", "peso", "volume", "conteudo", "conteúdo"]) ||
      extractImportedWeightOrVolume(item),
    imported_dosage: resolvedDosage,
    imported_barcode: barcode,
    clean_description: buildImportedCatalogDescription(item) || "",
    sku,
    line,
    application,
    embalagem: packaging,
    dosagem: resolvedDosage,
    dosage: resolvedDosage,
    barcode,
    stock_initial: stockInitial,
  };
}

function dataUrlToBlob(dataUrl: string) {
  const [header, data] = String(dataUrl || "").split(",");
  if (!header || !data) {
    throw new Error("Data URL inválida para upload da imagem.");
  }
  const mimeMatch = header.match(/data:(.*?);base64/i);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}
function buildSafeImportedImageExtension(fileName: string, mimeType: string) {
  const byName = String(fileName || "").split(".").pop()?.toLowerCase();
  if (byName) return byName;
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}

function buildImportedRawFileExtension(fileName: string) {
  const normalized = String(fileName || "").trim();
  const extension = normalized.includes(".") ? normalized.split(".").pop() : "";
  return String(extension || "").trim().toLowerCase() || null;
}

function buildImportedRawFilePath(
  organizationId: string,
  storeId: string,
  fileName: string
) {
  const safeName = String(fileName || "arquivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-120) || "arquivo";
  return `${organizationId}/${storeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
}

async function persistImportedRawFiles(params: {
  organizationId: string;
  storeId: string;
  files: File[];
  summary: IntelligentImportSummary;
  source?: string;
}) {
  const savedFiles = new Map<
    string,
    {
      id: string;
      original_file_name: string;
      storage_path: string;
    }
  >();

  for (const file of params.files) {
    const storagePath = buildImportedRawFilePath(
      params.organizationId,
      params.storeId,
      file.name
    );

    const { error: uploadError } = await defaultSupabase.storage
      .from("store-import-files")
      .upload(storagePath, file, {
        upsert: false,
        contentType: file.type || undefined,
      });

    if (uploadError) throw uploadError;

    const payload = {
      organization_id: params.organizationId,
      store_id: params.storeId,
      source: params.source || "onboarding_intelligent_import",
      original_file_name: file.name,
      mime_type: file.type || null,
      extension: buildImportedRawFileExtension(file.name),
      size_bytes: file.size,
      storage_bucket: "store-import-files",
      storage_path: storagePath,
      import_summary: params.summary,
      status: "active",
    };

    const { data: createdRow, error: insertError } = await defaultSupabase
      .from("store_import_files")
      .insert(payload)
      .select("id, original_file_name, storage_path")
      .single();

    if (insertError) throw insertError;

    savedFiles.set(String(file.name || "").trim().toLowerCase(), {
      id: createdRow.id,
      original_file_name: createdRow.original_file_name,
      storage_path: createdRow.storage_path,
    });
  }

  return savedFiles;
}

async function linkImportedFileToDestination(params: {
  importFileId: string;
  organizationId: string;
  storeId: string;
  destinationType: "pool" | "catalog_item";
  destinationTable: "pools" | "store_catalog_items";
  destinationItemId: string;
}) {
  const { error } = await defaultSupabase.from("store_import_file_items").insert({
    import_file_id: params.importFileId,
    organization_id: params.organizationId,
    store_id: params.storeId,
    destination_type: params.destinationType,
    destination_table: params.destinationTable,
    destination_item_id: params.destinationItemId,
  });

  if (error) throw error;
}
async function uploadExtractedImageToPool(
  organizationId: string,
  storeId: string,
  poolId: string,
  image: { fileName: string; mimeType: string; dataUrl: string },
  sortOrder: number
) {
  const blob = dataUrlToBlob(image.dataUrl);
  const extension = buildSafeImportedImageExtension(image.fileName, image.mimeType);
  const filePath = `${organizationId}/${storeId}/${poolId}/${Date.now()}-${sortOrder}.${extension}`;
  const { error: uploadError } = await defaultSupabase.storage
    .from("pool-photos")
    .upload(filePath, blob, {
      upsert: false,
      contentType: image.mimeType || blob.type || "image/jpeg",
    });
  if (uploadError) throw uploadError;
  const { error: metadataError } = await defaultSupabase.from("pool_photos").insert({
    organization_id: organizationId,
    store_id: storeId,
    pool_id: poolId,
    storage_path: filePath,
    file_name: image.fileName,
    file_size_bytes: blob.size,
    sort_order: sortOrder,
  });
  if (metadataError) throw metadataError;
}
async function uploadExtractedImageToCatalog(
  organizationId: string,
  storeId: string,
  catalogItemId: string,
  image: { fileName: string; mimeType: string; dataUrl: string },
  sortOrder: number
) {
  const blob = dataUrlToBlob(image.dataUrl);
  const extension = buildSafeImportedImageExtension(image.fileName, image.mimeType);
  const filePath = `${organizationId}/${storeId}/${catalogItemId}/${Date.now()}-${sortOrder}.${extension}`;
  const { error: uploadError } = await defaultSupabase.storage
    .from("store-catalog-photos")
    .upload(filePath, blob, {
      upsert: false,
      contentType: image.mimeType || blob.type || "image/jpeg",
    });
  if (uploadError) throw uploadError;
  const { error: metadataError } = await defaultSupabase.from("store_catalog_item_photos").insert({
    catalog_item_id: catalogItemId,
    storage_path: filePath,
    file_name: image.fileName,
    file_size_bytes: blob.size,
    sort_order: sortOrder,
  });
  if (metadataError) throw metadataError;
}
async function clearCatalogItemPhotos(catalogItemId: string) {
  const { data: existingPhotos, error: existingPhotosError } = await defaultSupabase
    .from("store_catalog_item_photos")
    .select("id, storage_path")
    .eq("catalog_item_id", catalogItemId);

  if (existingPhotosError) throw existingPhotosError;

  const storagePaths = (existingPhotos ?? [])
    .map((photo) => String(photo.storage_path || "").trim())
    .filter(Boolean);

  if (storagePaths.length > 0) {
    const { error: removeStorageError } = await defaultSupabase.storage
      .from("store-catalog-photos")
      .remove(storagePaths);

    if (removeStorageError) {
      console.error("[OnboardingPage] clearCatalogItemPhotos remove storage error:", removeStorageError);
    }
  }

  const { error: deleteMetadataError } = await defaultSupabase
    .from("store_catalog_item_photos")
    .delete()
    .eq("catalog_item_id", catalogItemId);

  if (deleteMetadataError) throw deleteMetadataError;
}

async function replaceCatalogItemPhotos(
  organizationId: string,
  storeId: string,
  catalogItemId: string,
  images: Array<{ fileName: string; mimeType: string; dataUrl: string }>
) {
  const normalizedImages = images.filter((image) => Boolean(image?.dataUrl)).slice(0, 1);
  if (normalizedImages.length === 0) return;

  await clearCatalogItemPhotos(catalogItemId);

  for (let index = 0; index < normalizedImages.length; index += 1) {
    await uploadExtractedImageToCatalog(
      organizationId,
      storeId,
      catalogItemId,
      normalizedImages[index],
      index
    );
  }
}
function SectionTitle({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-medium text-gray-900">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-gray-500">{hint}</p> : null}
    </div>
  );
}
function InfoBlock({
  title,
  description,
  subtle = false,
}: {
  title: string;
  description: string;
  subtle?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-xl border px-4 py-3",
        subtle
          ? "border-gray-200 bg-gray-50 text-gray-700"
          : "border-amber-300 bg-amber-50 text-amber-900"
      )}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm leading-6">{description}</p>
    </div>
  );
}
export default function IntelligentCatalogImportPanel({
  organizationId,
  storeId,
  storageKey,
  source = "onboarding_intelligent_import",
  disabled = false,
  supabaseClient = defaultSupabase,
  onError,
  onSuccess,
  onSaved,
  afterSaveBehavior,
}: IntelligentCatalogImportPanelProps) {
  const supabase = supabaseClient;
  const intelligentImportStorageKey = storageKey;

  function setParentError(message: string | null) {
    onError?.(message);
  }

  function setParentSuccess(message: string | null) {
    onSuccess?.(message);
  }

  const [intelligentImportFiles, setIntelligentImportFiles] = useState<File[]>([]);
  const [intelligentImportSelectedFilesPreview, setIntelligentImportSelectedFilesPreview] = useState<
    IntelligentImportSelectedFilePreview[]
  >([]);
  const [intelligentImportLoading, setIntelligentImportLoading] = useState(false);
  const [intelligentImportError, setIntelligentImportError] = useState<string | null>(null);
  const [intelligentImportSuccess, setIntelligentImportSuccess] = useState<string | null>(null);
  const [intelligentImportRecovered, setIntelligentImportRecovered] = useState(false);
  const [intelligentImportResult, setIntelligentImportResult] =
    useState<IntelligentImportResponse | null>(null);
  const [savingImportedCatalog, setSavingImportedCatalog] = useState(false);

  const visibleIntelligentImportFiles = useMemo(() => {
    if (intelligentImportFiles.length > 0) {
      return intelligentImportFiles.map((file) => ({
        name: file.name,
        type: file.type || "tipo n?o informado",
        size: file.size,
        lastModified: file.lastModified,
      }));
    }
    return intelligentImportSelectedFilesPreview;
  }, [intelligentImportFiles, intelligentImportSelectedFilesPreview]);
  const selectedImagePreviews = useMemo(() => {
    return intelligentImportFiles
      .filter((file) => isImageLikeFileType(file.type))
      .map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
      }));
  }, [intelligentImportFiles]);
  const safeExtractedPreview = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) return [];
    return Array.isArray(intelligentImportResult.extractedPreview)
      ? intelligentImportResult.extractedPreview
      : [];
  }, [intelligentImportResult]);
  const safeNormalizedPreview = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) return [];
    return Array.isArray(intelligentImportResult.normalizedPreview)
      ? intelligentImportResult.normalizedPreview
      : [];
  }, [intelligentImportResult]);
  const safeDedupedPreview = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) return [];
    return Array.isArray(intelligentImportResult.dedupedPreview)
      ? intelligentImportResult.dedupedPreview
      : [];
  }, [intelligentImportResult]);
  const safeExtractedImagePreview = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) return [];
    const candidate = intelligentImportResult.extractedImagePreview;
    return Array.isArray(candidate) ? candidate : [];
  }, [intelligentImportResult]);
  const intelligentImportDiagnostics = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) {
      return {
        previewItems: 0,
        saveCandidateItems: 0,
        duplicates: 0,
        imagesWithOriginClues: 0,
        destinationCounts: {
          pools: 0,
          quimicos: 0,
          acessorios: 0,
          outros: 0,
        },
        formatWarnings: [] as string[],
      };
    }

    const saveCandidates =
      safeDedupedPreview.length > 0
        ? safeDedupedPreview.filter((item) => !item.isDuplicate)
        : safeNormalizedPreview;

    const destinationCounts = {
      pools: 0,
      quimicos: 0,
      acessorios: 0,
      outros: 0,
    };

    for (const item of saveCandidates) {
      const destination = resolveImportedDestination(item);
      if (destination === "pool") destinationCounts.pools += 1;
      else if (destination === "quimicos") destinationCounts.quimicos += 1;
      else if (destination === "acessorios") destinationCounts.acessorios += 1;
      else destinationCounts.outros += 1;
    }

    const imagesWithOriginClues = safeExtractedImagePreview.filter((image) =>
      Boolean(image.sheetScopedKey || image.worksheetRowNumber || image.anchorCell || image.sheetName)
    ).length;

    return {
      previewItems: safeDedupedPreview.length || safeNormalizedPreview.length,
      saveCandidateItems: saveCandidates.length,
      duplicates: safeDedupedPreview.filter((item) => item.isDuplicate).length,
      imagesWithOriginClues,
      destinationCounts,
      formatWarnings: buildIntelligentImportFormatWarnings({
        extractedPreview: safeExtractedPreview,
        selectedFiles: visibleIntelligentImportFiles,
      }),
    };
  }, [
    intelligentImportResult,
    safeDedupedPreview,
    safeExtractedImagePreview,
    safeExtractedPreview,
    safeNormalizedPreview,
    visibleIntelligentImportFiles,
  ]);
  useEffect(() => {
    return () => {
      for (const preview of selectedImagePreviews) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [selectedImagePreviews]);

  function clearIntelligentImportState() {
    setIntelligentImportFiles([]);
    setIntelligentImportSelectedFilesPreview([]);
    setIntelligentImportError(null);
    setIntelligentImportSuccess(null);
    setIntelligentImportResult(null);
    setIntelligentImportRecovered(false);
    if (intelligentImportStorageKey && typeof window !== "undefined") {
      removeFromLocalStorageSafe(intelligentImportStorageKey);
    }
  }
  async function handleRunIntelligentImport() {
    if (!organizationId || !storeId) {
      setIntelligentImportError("Não foi possível identificar a organização e a loja ativa.");
      return;
    }
    if (intelligentImportFiles.length === 0) {
      setIntelligentImportError(
        "Selecione pelo menos um arquivo para testar a importação inteligente novamente."
      );
      return;
    }
    setIntelligentImportLoading(true);
    setIntelligentImportError(null);
    setIntelligentImportSuccess(null);
    setIntelligentImportResult(null);
    setIntelligentImportRecovered(false);
    try {
      const selectedFilesPreview = await buildSelectedFilePreviews(intelligentImportFiles);
      setIntelligentImportSelectedFilesPreview(selectedFilesPreview);

      const formData = new FormData();
      formData.append("organizationId", organizationId);
      formData.append("storeId", storeId);
      for (const file of intelligentImportFiles) {
        formData.append("files", file);
      }
      const response = await fetch("/api/onboarding/intelligent-import", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as IntelligentImportResponse;
      if (!response.ok || !result.ok) {
        setIntelligentImportError(result.message || "Falha ao processar a importação inteligente.");
        setIntelligentImportResult(result);
        return;
      }
      const decoratedResult = decorateIntelligentImportResultWithImageFallback(result, selectedFilesPreview);
      const frontendReadyResult = normalizeIntelligentImportResultForFrontend(decoratedResult);
      setIntelligentImportResult(frontendReadyResult);
      setIntelligentImportSuccess(
        frontendReadyResult.message || "Importação inteligente processada com sucesso."
      );
    } catch (error) {
      console.error("[OnboardingPage] handleRunIntelligentImport error:", error);
      setIntelligentImportError("Erro inesperado ao testar a importação inteligente.");
    } finally {
      setIntelligentImportLoading(false);
    }
  }
  
  async function uploadImportedImageToPool(poolId: string, file: File, sortOrder = 0) {
    if (!organizationId || !storeId) {
      throw new Error("Loja ativa não identificada para salvar a foto da piscina.");
    }
    const extension = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
    const safeExtension = extension ? extension.toLowerCase() : "jpg";
    const filePath = `${organizationId}/${storeId}/${poolId}/${Date.now()}-${sortOrder}.${safeExtension}`;
    const { error: uploadError } = await supabase.storage
      .from("pool-photos")
      .upload(filePath, file, {
        upsert: false,
        contentType: file.type || undefined,
      });
    if (uploadError) throw uploadError;
    const { error: metadataError } = await supabase.from("pool_photos").insert({
      organization_id: organizationId,
      store_id: storeId,
      pool_id: poolId,
      storage_path: filePath,
      file_name: file.name,
      file_size_bytes: file.size,
      sort_order: sortOrder,
    });
    if (metadataError) throw metadataError;
  }
  async function uploadImportedImageToCatalog(catalogItemId: string, file: File, sortOrder = 0) {
    if (!organizationId || !storeId) {
      throw new Error("Loja ativa não identificada para salvar a foto do catálogo.");
    }
    const extension = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
    const safeExtension = extension ? extension.toLowerCase() : "jpg";
    const filePath = `${organizationId}/${storeId}/${catalogItemId}/${Date.now()}-${sortOrder}.${safeExtension}`;
    const { error: uploadError } = await supabase.storage
      .from("store-catalog-photos")
      .upload(filePath, file, {
        upsert: false,
        contentType: file.type || undefined,
      });
    if (uploadError) throw uploadError;
    const { error: metadataError } = await supabase.from("store_catalog_item_photos").insert({
      catalog_item_id: catalogItemId,
      storage_path: filePath,
      file_name: file.name,
      file_size_bytes: file.size,
      sort_order: sortOrder,
    });
    if (metadataError) throw metadataError;
  }
  
async function handleSaveImportedItemsToCatalog() {
    if (!organizationId || !storeId) {
      setParentError("Não foi possível identificar a organização e a loja ativa.");
      return;
    }
    if (!intelligentImportResult || !intelligentImportResult.ok) {
      setParentError("Faça a importação inteligente antes de salvar no sistema.");
      return;
    }

    const rawSourceItems =
      intelligentImportResult.dedupedPreview.length > 0
        ? intelligentImportResult.dedupedPreview.filter((item) => !item.isDuplicate)
        : intelligentImportResult.normalizedPreview;

    const filteredSourceItems = rawSourceItems.filter((item) => !shouldSkipImportedItem(item));
    const sourceItems = dedupeImportedItemsForSave(filteredSourceItems);

    if (sourceItems.length === 0) {
      setParentError(
        "A análise não encontrou itens prontos para salvar. Tente um arquivo mais direto ou revise a importação."
      );
      return;
    }

    setSavingImportedCatalog(true);
    setParentError(null);
    setParentSuccess(null);

    try {
      const selectedImageFiles = intelligentImportFiles.filter((file) =>
        String(file.type || "").startsWith("image/")
      );
      const savedImportFilesByName = await persistImportedRawFiles({
        organizationId,
        storeId: storeId,
        files: intelligentImportFiles,
        summary: intelligentImportResult.summary,
        source,
      });


      const extractedImageBuckets = new Map<
        string,
        Array<{
          id: string;
          fileName: string;
          mimeType: string;
          dataUrl: string;
          sourceFileName: string;
          originalSourceFileName?: string;
          source?: string;
          sheetName?: string;
          rowIndex?: number;
          columnIndex?: number;
          imageOrder?: number;
          worksheetRowNumber?: number;
          sheetScopedKey?: string;
        }>
      >();

      const extractedImageBucketCursors = new Map<string, number>();
      const consumedExtractedImageIds = new Set<string>();

      const extractedImageSequence = safeExtractedImagePreview.map((image, index) => ({
        id: `${String(image.originalSourceFileName || image.sourceFileName || "").trim().toLowerCase()}::${image.fileName || "imagem-extraida.jpg"}::${index}`,
        fileName: image.fileName || "imagem-extraida.jpg",
        mimeType: image.mimeType || "image/jpeg",
        dataUrl: image.dataUrl,
        sourceFileName: String(image.sourceFileName || "").trim().toLowerCase(),
        originalSourceFileName:
          typeof image.originalSourceFileName === "string"
            ? String(image.originalSourceFileName || "").trim().toLowerCase()
            : String(image.sourceFileName || "").trim().toLowerCase(),
        source: typeof image.source === "string" ? image.source : undefined,
        sheetName: typeof image.sheetName === "string" ? image.sheetName : undefined,
        rowIndex: typeof image.rowIndex === "number" ? image.rowIndex : undefined,
        columnIndex: typeof image.columnIndex === "number" ? image.columnIndex : undefined,
        imageOrder: typeof image.imageOrder === "number" ? image.imageOrder : undefined,
        worksheetRowNumber:
          typeof image.worksheetRowNumber === "number" ? image.worksheetRowNumber : undefined,
        sheetScopedKey:
          typeof image.sheetScopedKey === "string" ? image.sheetScopedKey : undefined,
      }));

      for (const image of extractedImageSequence) {
        const bucketKeys = buildExtractedImageBucketKeys(image);
        if (bucketKeys.length === 0) {
          bucketKeys.push("__sem_origem__");
        }

        for (const bucketKey of bucketKeys) {
          const currentBucket = extractedImageBuckets.get(bucketKey) ?? [];
          currentBucket.push(image);
          extractedImageBuckets.set(bucketKey, currentBucket);
        }
      }

      const extractedImageAssignments = buildDeterministicExtractedImageAssignments(
        sourceItems,
        extractedImageSequence
      );

      let firstPoolId: string | null = null;
      let firstCatalogCategory: ImportedCatalogCategory | null = null;

      let savedPools = 0;
      let savedAcessorios = 0;
      let savedQuimicos = 0;
      let savedOutros = 0;
      let imageCursor = 0;

      const itemErrors: string[] = [];
      const savedRuntimeIdentityKeys = new Set<string>();
      const savedPoolNames = new Set<string>();

      for (const item of sourceItems) {
        try {
          const initialDestination = resolveImportedDestination(item);
          const metrics = extractImportedPoolMetrics(item);
          const destination =
            initialDestination === "pool" && !canPersistAsPool(metrics)
              ? normalizeImportedCatalogCategory(
                  [
                    extractImportedSourceCategory(item),
                    extractImportedSourceSubcategory(item),
                    extractImportedSourceSheetName(item),
                    item.type,
                    item.title,
                    item.rawText,
                    ...Object.values(item.metadata ?? {}),
                  ].join(" ")
                )
              : initialDestination;
          const runtimeIdentityKeys = buildImportedRuntimeIdentityKeys({
            ...item,
            metadata: {
              ...(item.metadata ?? {}),
              __resolved_destination: destination,
            },
          });

          if (
            runtimeIdentityKeys.length > 0 &&
            runtimeIdentityKeys.some((key) => savedRuntimeIdentityKeys.has(key))
          ) {
            continue;
          }

          if (destination === "pool") {
            const poolName = buildImportedPoolName(item);

            if (!poolName || isGenericImportedTitle(poolName)) {
              continue;
            }

            let poolDescription = buildImportedPoolDescription(item);
            let safeDepth = metrics.depth_m;

            if (safeDepth == null) {
              safeDepth = 1.4;
              poolDescription = [
                poolDescription || "",
                "Importação automática: a profundidade não foi identificada com segurança no arquivo. Foi usado 1,40 m de forma provisória para permitir o cadastro. Revise este item depois.",
              ]
                .filter(Boolean)
                .join("\n");
            }

            const { data: existingPool } = await supabase
              .from("pools")
              .select("id")
              .eq("organization_id", organizationId)
              .eq("store_id", storeId)
              .eq("name", poolName)
              .maybeSingle();

            let persistedPoolId: string | null = existingPool?.id ?? null;

            if (existingPool?.id) {
              const { error: updatePoolError } = await supabase
                .from("pools")
                .update({
                  width_m: metrics.width_m,
                  length_m: metrics.length_m,
                  depth_m: safeDepth,
                  shape: metrics.shape,
                  material: metrics.material,
                  max_capacity_l: metrics.max_capacity_l ?? 0,
                  price: metrics.price,
                  description: poolDescription,
                  is_active: true,
                  track_stock: true,
                })
                .eq("id", existingPool.id);

              if (updatePoolError) throw updatePoolError;
            } else {
              const { data: createdPool, error } = await supabase
                .from("pools")
                .insert({
                  organization_id: organizationId,
                  store_id: storeId,
                  name: poolName,
                  width_m: metrics.width_m,
                  length_m: metrics.length_m,
                  depth_m: safeDepth,
                  shape: metrics.shape,
                  material: metrics.material,
                  max_capacity_l: metrics.max_capacity_l ?? 0,
                  weight_kg: null,
                  price: metrics.price,
                  description: poolDescription,
                  is_active: true,
                  track_stock: true,
                  stock_quantity: 0,
                })
                .select("id")
                .single();

              if (error) throw error;
              persistedPoolId = createdPool.id;
            }

            if (!persistedPoolId) {
              throw new Error("Falha ao persistir a piscina importada.");
            }

            if (!firstPoolId) firstPoolId = persistedPoolId;
            savedPools += 1;
            savedPoolNames.add(normalizeImportedLoose(poolName));
            runtimeIdentityKeys.forEach((key) => savedRuntimeIdentityKeys.add(key));

            const sourceFileKey = String(extractImportedOriginalSourceFileName(item) || item.sourceFileName || "")
              .trim()
              .toLowerCase();
            const relatedImportFile = savedImportFilesByName.get(sourceFileKey);
            if (relatedImportFile?.id) {
              await linkImportedFileToDestination({
                importFileId: relatedImportFile.id,
                organizationId,
                storeId: storeId,
                destinationType: "pool",
                destinationTable: "pools",
                destinationItemId: persistedPoolId,
              });
            }

            const poolImages = (
              extractedImageAssignments.get(buildImportedSaveKey(item)) ??
              pickRelatedExtractedImages(
                item,
                extractedImageBuckets,
                extractedImageBucketCursors,
                extractedImageSequence,
                consumedExtractedImageIds,
                sourceItems.length
              )
            ).slice(0, 1);
            if (poolImages.length > 0) {
              for (let index = 0; index < poolImages.length; index += 1) {
                await uploadExtractedImageToPool(
                  organizationId,
                  storeId,
                  persistedPoolId,
                  poolImages[index],
                  index
                );
              }
            } else if (selectedImageFiles[imageCursor]) {
              try {
                await uploadImportedImageToPool(persistedPoolId, selectedImageFiles[imageCursor], 0);
                imageCursor += 1;
              } catch (uploadError) {
                console.error("[OnboardingPage] uploadImportedImageToPool error:", uploadError);
              }
            }

            continue;
          }

          const category =
            destination === "quimicos" || destination === "acessorios" || destination === "outros"
              ? destination
              : normalizeImportedCatalogCategory(
                  [item.type, item.title, item.rawText, ...Object.values(item.metadata ?? {})].join(" ")
                );

          const itemName = buildImportedCatalogName(item);
          if (!itemName || isGenericImportedTitle(itemName)) {
            continue;
          }

          if (
            looksLikeImportedDocumentIntroCatalogItem({
              item,
              itemName,
              category,
              metrics,
            })
          ) {
            continue;
          }

          if (
            category === "outros" &&
            looksLikeDuplicatedSavedPoolCatalogItem({
              item,
              itemName,
              metrics,
              savedPoolNames,
            })
          ) {
            continue;
          }

          const sku = extractImportedCatalogSku(item) || null;
          const priceCents = extractImportedCatalogPriceCents(item);
          const stockQuantity = extractImportedCatalogStockQuantity(item);
          const metadata = buildImportedCatalogMetadata(item, category, source);
          const description = buildImportedCatalogDescription(item);

          let existingCatalogItem: ExistingCatalogItemRow | null = null;

          if (sku) {
            const { data } = await supabase
              .from("store_catalog_items")
              .select("id, sku, price_cents, stock_quantity, description, metadata")
              .eq("organization_id", organizationId)
              .eq("store_id", storeId)
              .eq("sku", sku)
              .maybeSingle();
            existingCatalogItem = (data as ExistingCatalogItemRow | null) ?? null;
          }

          const sourceLocationKey = buildImportedSourceLocationKey(item);

          if (!existingCatalogItem && sourceLocationKey) {
            const { data } = await supabase
              .from("store_catalog_items")
              .select("id, sku, price_cents, stock_quantity, description, metadata")
              .eq("organization_id", organizationId)
              .eq("store_id", storeId)
              .contains("metadata", {
                source_location_key: sourceLocationKey,
              })
              .maybeSingle();
            existingCatalogItem = (data as ExistingCatalogItemRow | null) ?? null;
          }

          const safePriceCents = priceCents ?? existingCatalogItem?.price_cents ?? null;
          const safeStockQuantity =
            stockQuantity > 0 ? stockQuantity : existingCatalogItem?.stock_quantity ?? 0;

          let persistedCatalogItemId: string | null = existingCatalogItem?.id ?? null;

          if (existingCatalogItem?.id) {
            const mergedMetadata = {
              ...(existingCatalogItem.metadata ?? {}),
              ...metadata,
            } as Record<string, unknown>;

            const { error: updateCatalogError } = await supabase
              .from("store_catalog_items")
              .update({
                sku,
                name: itemName,
                description: description ?? existingCatalogItem.description ?? null,
                price_cents: safePriceCents,
                currency: "BRL",
                is_active: true,
                track_stock: true,
                stock_quantity: safeStockQuantity,
                metadata: mergedMetadata,
              })
              .eq("id", existingCatalogItem.id);

            if (updateCatalogError) throw updateCatalogError;
          } else {
            const { data: createdItem, error } = await supabase
              .from("store_catalog_items")
              .insert({
                organization_id: organizationId,
                store_id: storeId,
                sku,
                name: itemName,
                description,
                price_cents: safePriceCents,
                currency: "BRL",
                is_active: true,
                track_stock: true,
                stock_quantity: safeStockQuantity,
                metadata,
              })
              .select("id")
              .single();

            if (error) throw error;
            persistedCatalogItemId = createdItem.id;
          }

          if (!persistedCatalogItemId) {
            throw new Error("Falha ao persistir o item importado do catálogo.");
          }

          if (!firstCatalogCategory) firstCatalogCategory = category;
          if (category === "quimicos") savedQuimicos += 1;
          else if (category === "acessorios") savedAcessorios += 1;
          else savedOutros += 1;
          runtimeIdentityKeys.forEach((key) => savedRuntimeIdentityKeys.add(key));

          const sourceFileKey = String(extractImportedOriginalSourceFileName(item) || item.sourceFileName || "")
            .trim()
            .toLowerCase();
          const relatedImportFile = savedImportFilesByName.get(sourceFileKey);
          if (relatedImportFile?.id) {
            await linkImportedFileToDestination({
              importFileId: relatedImportFile.id,
              organizationId,
              storeId: storeId,
              destinationType: "catalog_item",
              destinationTable: "store_catalog_items",
              destinationItemId: persistedCatalogItemId,
            });
          }

          const catalogImages = (
            extractedImageAssignments.get(buildImportedSaveKey(item)) ??
            pickRelatedExtractedImages(
              item,
              extractedImageBuckets,
              extractedImageBucketCursors,
              extractedImageSequence,
              consumedExtractedImageIds,
              sourceItems.length
            )
          ).slice(0, 1);
          if (catalogImages.length > 0) {
            try {
              await replaceCatalogItemPhotos(
                organizationId,
                storeId,
                persistedCatalogItemId,
                catalogImages
              );
            } catch (uploadError) {
              console.error("[OnboardingPage] replaceCatalogItemPhotos error:", uploadError);
            }
          } else if (selectedImageFiles[imageCursor]) {
            try {
              await clearCatalogItemPhotos(persistedCatalogItemId);
              await uploadImportedImageToCatalog(
                persistedCatalogItemId,
                selectedImageFiles[imageCursor],
                0
              );
              imageCursor += 1;
            } catch (uploadError) {
              console.error("[OnboardingPage] replaceCatalogItemPhotosFromFiles error:", uploadError);
            }
          }
        } catch (itemError) {
          console.error("[OnboardingPage] handleSaveImportedItemsToCatalog item error:", itemError);
          itemErrors.push(
            itemError instanceof Error
              ? itemError.message
              : "Erro inesperado ao salvar um item importado."
          );
        }
      }

      const totalCreated = savedPools + savedAcessorios + savedQuimicos + savedOutros;

      if (totalCreated === 0) {
        if (itemErrors.length > 0) {
          setParentError(`Nenhum item foi salvo. Primeiros erros: ${itemErrors.slice(0, 3).join(" | ")}`);
        } else {
          setParentError(
            "A análise foi concluída, mas nenhum item válido ficou pronto para salvar. Revise o arquivo e teste novamente."
          );
        }
        return;
      }

      setParentSuccess(
        `Importação salva com sucesso. Piscinas: ${savedPools}. Químicos: ${savedQuimicos}. Acessórios: ${savedAcessorios}. Outros: ${savedOutros}. Os arquivos brutos desta importação também foram guardados no sistema.`
      );

      clearIntelligentImportState();
      await onSaved?.();
      void afterSaveBehavior?.();
      return;
    } catch (error) {
      console.error("[OnboardingPage] handleSaveImportedItemsToCatalog error:", error);
      setParentError(
        error instanceof Error
          ? error.message
          : "Erro ao salvar os itens importados no sistema."
      );
    } finally {
      setSavingImportedCatalog(false);
    }
  }
  useEffect(() => {
    if (!intelligentImportStorageKey || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(intelligentImportStorageKey);
    if (!raw) {
      setIntelligentImportRecovered(false);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as PersistedIntelligentImportState;
      setIntelligentImportSelectedFilesPreview(
        Array.isArray(parsed.selectedFiles) ? parsed.selectedFiles : []
      );
      setIntelligentImportResult(null);
      setIntelligentImportSuccess(parsed.successMessage ?? null);
      setIntelligentImportError(parsed.errorMessage ?? null);
      setIntelligentImportRecovered(Boolean((parsed.selectedFiles?.length ?? 0) > 0));
    } catch (error) {
      console.error("[OnboardingPage] intelligent import restore error:", error);
      removeFromLocalStorageSafe(intelligentImportStorageKey);
      setIntelligentImportRecovered(false);
    }
  }, [intelligentImportStorageKey]);
  useEffect(() => {
    if (!intelligentImportStorageKey || typeof window === "undefined") return;
    const hasPersistedContent =
      visibleIntelligentImportFiles.length > 0 ||
      Boolean(intelligentImportSuccess) ||
      Boolean(intelligentImportError);
    if (!hasPersistedContent) {
      removeFromLocalStorageSafe(intelligentImportStorageKey);
      return;
    }
    const payload = buildLightPersistedIntelligentImportState({
      selectedFiles: visibleIntelligentImportFiles,
      successMessage: intelligentImportSuccess,
      errorMessage: intelligentImportError,
    });
    persistToLocalStorageSafe(intelligentImportStorageKey, JSON.stringify(payload));
  }, [
    intelligentImportStorageKey,
    visibleIntelligentImportFiles,
    intelligentImportSuccess,
    intelligentImportError,
  ]);
  return (
    <>
              <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4">
                <SectionTitle
                  title="Importar catálogo, piscinas e materiais da loja"
                  hint="Envie fotos, Excel básico, Word básico ou PDF básico para a IA começar a entender os produtos, piscinas, acessórios e materiais mais comuns da loja. Nesta fase ela ainda mostra uma prévia da leitura antes da parte de salvamento real."
                />
                <div className="space-y-3">
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.txt,.xlsx,.xls,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.heic,.heif,image/*"
                    onChange={async (e) => {
                      const input = e.currentTarget;
                      const selectedFiles = Array.from(input.files ?? []) as File[];
                      setIntelligentImportFiles(selectedFiles);
                      setIntelligentImportSelectedFilesPreview(
                        await buildSelectedFilePreviews(selectedFiles)
                      );
                      setIntelligentImportRecovered(false);
                      setIntelligentImportError(null);
                      setIntelligentImportSuccess(null);
                      setIntelligentImportResult(null);
                      if (input) {
                        input.value = "";
                      }
                    }}
                    className="block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                  />
                  <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700">
                    Você pode enviar fotos do catálogo, imagens de produtos, tabelas simples em foto, PDF, Word, Excel e PowerPoint. As imagens selecionadas aparecem em pré-visualização logo abaixo para facilitar a conferência antes do teste.
                  </div>
                  {visibleIntelligentImportFiles.length > 0 ? (
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <p className="text-sm font-semibold text-gray-900">
                        Arquivos selecionados ou restaurados (mostrando até 10 de {visibleIntelligentImportFiles.length})
                      </p>
                      <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                        {visibleIntelligentImportFiles.slice(0, 10).map((file, index) => (
                          <div
                            key={`${file.name}-${file.size}-${file.lastModified}`}
                            className={cx(
                              "grid gap-1 px-3 py-2 text-sm text-gray-700 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-3",
                              index > 0 ? "border-t border-gray-200" : ""
                            )}
                          >
                            <span className="truncate font-medium text-gray-900">{file.name}</span>
                            <span className="text-xs text-gray-500 md:text-right">
                              {file.type || "tipo não informado"} • {formatFileSize(file.size)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {selectedImagePreviews.length > 0 ? (
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <p className="text-sm font-semibold text-gray-900">
                        Pré-visualização das fotos selecionadas (mostrando até 10 de {selectedImagePreviews.length})
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                        {selectedImagePreviews.slice(0, 10).map((preview) => (
                          <div
                            key={preview.name}
                            className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                          >
                            <div className="aspect-square w-full bg-white">
                              <img
                                src={preview.url}
                                alt={preview.name}
                                className="h-full w-full object-cover"
                              />
                            </div>
                            <div className="border-t border-gray-200 px-3 py-2">
                              <p className="truncate text-xs font-medium text-gray-700">
                                {preview.name}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <button
                      type="button"
                      onClick={() => void handleRunIntelligentImport()}
                      disabled={disabled || intelligentImportLoading}
                      className="rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {intelligentImportLoading
                        ? "Processando importação..."
                        : "Testar importação inteligente"}
                    </button>
                    {visibleIntelligentImportFiles.length > 0 ? (
                      <button
                        type="button"
                        onClick={clearIntelligentImportState}
                        disabled={disabled || intelligentImportLoading}
                        className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-60"
                      >
                        Limpar arquivos e análise
                      </button>
                    ) : null}
                  </div>
                  {intelligentImportError ? (
                    <InfoBlock
                      title="Falha na importação inteligente"
                      description={intelligentImportError}
                    />
                  ) : null}
                  {intelligentImportSuccess ? (
                    <InfoBlock
                      title="Importação inteligente processada"
                      description={intelligentImportSuccess}
                      subtle
                    />
                  ) : null}
                  {intelligentImportResult?.ok ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Arquivos enviados</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.totalFiles}
                          </p>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Arquivos lidos</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.extractedFiles}
                          </p>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Blocos normalizados</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.normalizedItems}
                          </p>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Itens deduplicados</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.dedupedItems}
                          </p>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Duplicados detectados</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.duplicateItems}
                          </p>
                        </div>
                      </div>
                      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                          <div>
                            <p className="text-sm font-semibold text-sky-950">
                              Diagnostico da leitura
                            </p>
                            <p className="mt-1 text-sm leading-6 text-sky-900">
                              A tela mostra uma previa curta para ficar leve. O salvamento usa os itens validos
                              encontrados na analise, nao apenas os itens visiveis na previa.
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm md:min-w-[360px]">
                            <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                              <p className="text-xs text-sky-700">Itens na previa</p>
                              <p className="font-semibold text-sky-950">
                                {intelligentImportDiagnostics.previewItems}
                              </p>
                            </div>
                            <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                              <p className="text-xs text-sky-700">Candidatos para salvar</p>
                              <p className="font-semibold text-sky-950">
                                {intelligentImportDiagnostics.saveCandidateItems}
                              </p>
                            </div>
                            <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                              <p className="text-xs text-sky-700">Fotos encontradas</p>
                              <p className="font-semibold text-sky-950">
                                {safeExtractedImagePreview.length}
                              </p>
                            </div>
                            <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                              <p className="text-xs text-sky-700">Fotos com pista de item</p>
                              <p className="font-semibold text-sky-950">
                                {intelligentImportDiagnostics.imagesWithOriginClues}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                          <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                            <p className="text-xs text-sky-700">Piscinas</p>
                            <p className="font-semibold text-sky-950">
                              {intelligentImportDiagnostics.destinationCounts.pools}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                            <p className="text-xs text-sky-700">Quimicos</p>
                            <p className="font-semibold text-sky-950">
                              {intelligentImportDiagnostics.destinationCounts.quimicos}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                            <p className="text-xs text-sky-700">Acessorios</p>
                            <p className="font-semibold text-sky-950">
                              {intelligentImportDiagnostics.destinationCounts.acessorios}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                            <p className="text-xs text-sky-700">Outros</p>
                            <p className="font-semibold text-sky-950">
                              {intelligentImportDiagnostics.destinationCounts.outros}
                            </p>
                          </div>
                        </div>
                        {intelligentImportDiagnostics.formatWarnings.length > 0 ? (
                          <div className="mt-3 space-y-1.5">
                            {intelligentImportDiagnostics.formatWarnings.map((warning) => (
                              <p key={warning} className="text-xs leading-5 text-sky-900">
                                {warning}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white p-3">
                        <p className="text-sm font-semibold text-gray-900">Prévia dos arquivos extraídos</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Mostrando ate 10 arquivos na tela.
                        </p>
                        {safeExtractedPreview.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-500">
                            Nenhum texto foi extraído nesta tentativa.
                          </p>
                        ) : (
                          <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                            {safeExtractedPreview.slice(0, 10).map((item, index) => (
                              <div
                                key={`${item.fileName}-${item.extension}`}
                                className={cx("px-3 py-2.5", index > 0 ? "border-t border-gray-200" : "")}
                              >
                                <div className="grid gap-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-3">
                                  <p className="truncate text-sm font-semibold text-gray-900">{item.fileName}</p>
                                  <p className="text-xs text-gray-500 md:text-right">
                                    {item.extension.toUpperCase()} • {item.mimeType}
                                  </p>
                                </div>
                                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-5 text-gray-700">
                                  {item.textPreview || "Sem texto extraído nesta fase."}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white p-3">
                        <p className="text-sm font-semibold text-gray-900">
                          Fotos encontradas nos arquivos
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          Mostrando ate 10 fotos. Fotos com pista de item usam aba, linha ou celula quando
                          o arquivo fornece esses dados.
                        </p>
                        {safeExtractedImagePreview.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-500">
                            Nenhuma foto embutida foi encontrada nos arquivos desta análise.
                          </p>
                        ) : (
                          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                            {safeExtractedImagePreview.slice(0, 10).map((image, index) => (
                              <div
                                key={`${image.sourceFileName}-${image.fileName}-${index}`}
                                className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                              >
                                <div className="aspect-square w-full bg-white">
                                  <img
                                    src={image.dataUrl}
                                    alt={image.fileName}
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                                <div className="border-t border-gray-200 px-3 py-2">
                                  <p className="truncate text-xs font-semibold text-gray-800">
                                    {image.fileName}
                                  </p>
                                  <p className="mt-1 truncate text-[11px] text-gray-500">
                                    Origem: {image.sourceFileName}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white p-3">
                        <p className="text-sm font-semibold text-gray-900">Prévia dos blocos classificados</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Mostrando ate 12 blocos classificados. Arquivos grandes podem ter mais itens do que esta previa.
                        </p>
                        {safeNormalizedPreview.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-500">
                            Nenhum bloco foi classificado nesta tentativa.
                          </p>
                        ) : (
                          <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                            {safeNormalizedPreview.slice(0, 12).map((item, index) => (
                              <div key={`${item.sourceFileName}-${item.title}-${index}`} className={cx("px-3 py-2.5", index > 0 ? "border-t border-gray-200" : "")}>
                                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
                                    <p className="text-xs text-gray-500">
                                      Tipo: {item.type} • Arquivo: {item.sourceFileName}
                                    </p>
                                  </div>
                                  <span className="inline-flex rounded-full bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
                                    {Math.round(item.confidence * 100)}%
                                  </span>
                                </div>
                                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm leading-5 text-gray-700">
                                  {item.rawText}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white p-3">
                        <p className="text-sm font-semibold text-gray-900">Prévia da deduplicação</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Mostrando ate 12 itens. Duplicados detectados nao entram como candidatos principais para salvar.
                        </p>
                        {safeDedupedPreview.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-500">
                            Nenhum item foi analisado na deduplicação.
                          </p>
                        ) : (
                          <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                            {safeDedupedPreview.slice(0, 12).map((item, index) => (
                              <div
                                key={`${item.dedupKey}-${index}`}
                                className={cx(
                                  "px-3 py-2.5",
                                  index > 0 ? "border-t border-gray-200" : "",
                                  item.isDuplicate ? "bg-amber-50" : "bg-white"
                                )}
                              >
                                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-3">
                                  <div>
                                    <p className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
                                    <p className="text-xs text-gray-500">
                                      Tipo: {item.type} • Arquivo: {item.sourceFileName}
                                    </p>
                                  </div>
                                  <span
                                    className={cx(
                                      "rounded-full px-3 py-1 text-xs font-medium ring-1",
                                      item.isDuplicate
                                        ? "bg-white text-amber-800 ring-amber-200"
                                        : "bg-white text-gray-700 ring-gray-200"
                                    )}
                                  >
                                    {item.isDuplicate
                                      ? `Duplicado de: ${item.duplicateOf ?? "item anterior"}`
                                      : "Único nesta análise"}
                                  </span>
                                </div>
                                <p className="mt-3 break-all text-xs text-gray-500">
                                  Chave: {item.dedupKey}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              {intelligentImportResult?.ok ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-base font-semibold text-emerald-900">
                        Salvar resultado no catálogo da loja
                      </p>
                      <p className="mt-1 text-sm leading-6 text-emerald-900">
                        Isso salva tudo no lugar certo: piscinas em Piscinas, produtos químicos em Químicos,
                        acessórios em Acessórios e o restante em Outros.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveImportedItemsToCatalog()}
                      disabled={disabled || savingImportedCatalog || intelligentImportLoading}
                      className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {savingImportedCatalog ? "Salvando no sistema..." : "Salvar no catálogo"}
                    </button>
                  </div>
                </div>
              ) : null}
    </>
  );
}
