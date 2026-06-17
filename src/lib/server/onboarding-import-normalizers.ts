import type { ExtractedFileContent } from "./onboarding-file-extractors";
import {
  parseStructuredImportItems,
  parseStructuredImportItemsDetailed,
  type StructuredParserFileDebug,
  type StructuredImportItem,
} from "../onboarding-import-structured-parser";

export type NormalizedImportItemType =
  | "store_info"
  | "responsible_info"
  | "commercial_rule"
  | "pool"
  | "catalog_item"
  | "unknown";

export type NormalizedImportItem = {
  type: NormalizedImportItemType;
  sourceFileName: string;
  title: string;
  rawText: string;
  confidence: number;
  metadata: Record<string, string>;
};

export type NormalizedImportDebug = {
  files: Array<{
    fileName: string;
    parsedItems: number;
    normalizedItems: number;
    droppedItems: string[];
    parser: StructuredParserFileDebug;
  }>;
  totalParsedItems: number;
  totalNormalizedItems: number;
};

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

  const blocked = [
    "catalogo de teste",
    "catálogo de teste",
    "arquivo de teste",
    "nome do item",
    "item importado",
    "descricao detalhada",
    "descrição detalhada",
  ];

  return blocked.some(
    (item) => normalized === normalizeLoose(item) || normalized.startsWith(normalizeLoose(item))
  );
}

function resolveNormalizedType(item: StructuredImportItem): NormalizedImportItemType {
  if (item.destination === "pool") return "pool";
  if (
    item.destination === "quimicos" ||
    item.destination === "acessorios" ||
    item.destination === "outros"
  ) {
    return "catalog_item";
  }
  return "unknown";
}

function buildMetadata(item: StructuredImportItem): Record<string, string> {
  const explicitCategory = String(item.sourceCategory || item.categoria || "").trim();
  const explicitSubcategory = String(item.sourceSubcategory || "").trim();
  const explicitSheetName = String(item.sheetName || "").trim();
  const resolvedCategory = explicitCategory || (item.destination === "pool" ? "pool" : item.destination);
  const normalizedTitle = normalizeLoose(item.title || "");
  const missingPrice = !String(item.price || "").trim();
  const missingSku = !String(item.sku || "").trim();
  const genericTitle =
    !normalizedTitle ||
    normalizedTitle.includes("produto promocao verao") ||
    normalizedTitle.includes("produto promocao") ||
    normalizedTitle === "qmc d2 005";
  const ambiguousBundle =
    normalizedTitle.includes("kit limpeza completo") ||
    normalizedTitle.includes("peneira e cabo") ||
    normalizedTitle.includes("varios itens") ||
    normalizedTitle.includes("varios item");
  const weakCandidate = genericTitle || ambiguousBundle || (missingPrice && missingSku);
  const reviewRequired =
    weakCandidate ||
    (missingPrice && item.destination !== "pool") ||
    (missingSku && item.destination !== "pool");
  const reviewReasons = [
    missingPrice ? "missing_price" : "",
    missingSku ? "missing_sku" : "",
    genericTitle ? "generic_title" : "",
    ambiguousBundle ? "ambiguous_bundle" : "",
    weakCandidate ? "weak_candidate" : "",
  ].filter(Boolean);

  return {
    categoria: resolvedCategory,
    category: resolvedCategory,
    category_name: resolvedCategory,
    destination: item.destination,
    __resolved_destination: item.destination,
    subcategoria: explicitSubcategory,
    source_subcategory: explicitSubcategory,
    sub_category: explicitSubcategory,
    sheet_name: explicitSheetName,
    planilha: explicitSheetName,
    aba: explicitSheetName,
    sheet: explicitSheetName,
    source_category: resolvedCategory,
    clean_description: item.description || "",
    clean_description_status: item.descriptionStatus || "",
    description_canonicalized: item.descriptionStatus ? "true" : "false",
    imported_clean_description_original: item.originalDescription || "",
    price: item.price || "",
    dimensions: item.dimensions || "",
    depth: item.depth || "",
    capacity: item.capacity || "",
    material: item.material || "",
    shape: item.shape || "",
    brand: item.brand || "",
    sku: item.sku || "",
    weight: item.weight || "",
    dosage: item.dosage || "",
    color: item.color || "",
    usage: item.usage || "",
    notes: item.notes || "",
    indication: item.indication || "",
    composition: item.composition || "",
    embalagem: item.embalagem || "",
    packaging: item.packaging || "",
    model: item.model || "",
    size: item.size || "",
    compatibility: item.compatibility || "",
    function: item.function || "",
    environment: item.environment || "",
    diferencial: item.diferencial || "",
    application: item.application || "",
    source_file_name: item.sourceFileName,
    missing_price: missingPrice ? "true" : "false",
    missing_sku: missingSku ? "true" : "false",
    generic_title: genericTitle ? "true" : "false",
    ambiguous_bundle: ambiguousBundle ? "true" : "false",
    weak_candidate: weakCandidate ? "true" : "false",
    review_required: reviewRequired ? "true" : "false",
    review_reason: reviewReasons.join(","),
    review_label: reviewRequired ? "Revisar com atenção" : "",
    review_selection_default: reviewRequired ? "unselected" : "selected",
  };
}

function toNormalizedItem(item: StructuredImportItem): NormalizedImportItem | null {
  const title = String(item.title || "").trim();
  if (!title || isGenericTitle(title)) {
    return null;
  }

  const rawText = String(item.rawBlock || item.description || item.title || "").trim();

  return {
    type: resolveNormalizedType(item),
    sourceFileName: item.sourceFileName,
    title,
    rawText,
    confidence: item.confidence,
    metadata: buildMetadata(item),
  };
}

function normalizeExtractedFile(extracted: ExtractedFileContent): NormalizedImportItem[] {
  const structuredItems = parseStructuredImportItems(extracted);
  if (structuredItems.length === 0) {
    return [];
  }

  return structuredItems
    .map(toNormalizedItem)
    .filter((item): item is NormalizedImportItem => Boolean(item));
}

function normalizeExtractedFileDetailed(extracted: ExtractedFileContent) {
  const structured = parseStructuredImportItemsDetailed(extracted);
  const normalizedItems = structured.items
    .map(toNormalizedItem)
    .filter((item): item is NormalizedImportItem => Boolean(item));
  const droppedItems = structured.items
    .filter((item) => !toNormalizedItem(item))
    .map((item) => item.title)
    .slice(0, 20);

  return {
    items: normalizedItems,
    debug: {
      fileName: extracted.fileName,
      parsedItems: structured.items.length,
      normalizedItems: normalizedItems.length,
      droppedItems,
      parser: structured.debug,
    },
  };
}

export function normalizeMultipleExtractedFiles(
  extractedFiles: ExtractedFileContent[]
): NormalizedImportItem[] {
  return extractedFiles.flatMap((file) => normalizeExtractedFile(file));
}

export function normalizeMultipleExtractedFilesDetailed(
  extractedFiles: ExtractedFileContent[]
): {
  items: NormalizedImportItem[];
  debug: NormalizedImportDebug;
} {
  const detailed = extractedFiles.map((file) => normalizeExtractedFileDetailed(file));
  const items = detailed.flatMap((file) => file.items);

  return {
    items,
    debug: {
      files: detailed.map((file) => file.debug),
      totalParsedItems: detailed.reduce((sum, file) => sum + file.debug.parsedItems, 0),
      totalNormalizedItems: items.length,
    },
  };
}
