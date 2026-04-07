import type { ExtractedFileContent } from "./onboarding-file-extractors";
import {
  parseStructuredImportItems,
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

export function normalizeMultipleExtractedFiles(
  extractedFiles: ExtractedFileContent[]
): NormalizedImportItem[] {
  return extractedFiles.flatMap((file) => normalizeExtractedFile(file));
}
