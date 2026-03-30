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
    "descricao detalhada",
    "descrição detalhada",
    "piscina",
    "item importado",
    "regra comercial",
    "arquivo de teste",
    "nome do item",
  ];
  return blocked.some((item) => normalized === item || normalized.startsWith(item));
}

function descriptionToRawText(item: StructuredImportItem) {
  const parts = [
    item.title,
    item.description,
    item.price ? `Preço ${item.price}` : "",
    item.dimensions ? `Medidas ${item.dimensions}` : "",
    item.depth ? `Profundidade ${item.depth}` : "",
    item.capacity ? `Capacidade ${item.capacity}` : "",
    item.material ? `Material ${item.material}` : "",
    item.shape ? `Formato ${item.shape}` : "",
    item.usage ? `Uso ${item.usage}` : "",
    item.notes ? `Observação ${item.notes}` : "",
  ].filter(Boolean);

  return parts.join("\n").trim().slice(0, 4000);
}

function buildMetadata(item: StructuredImportItem) {
  return {
    destination: item.destination,
    categoria: item.destination === "pool" ? "piscinas" : item.destination,
    categoryHint: item.categoryHint || "",
    clean_description: item.description || "",
    description: item.description || "",
    title: item.title || "",
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
    item_index: String(item.itemIndex),
    original_source_file_name: item.sourceFileName,
    source_file_name: item.sourceFileName,
  };
}

function toNormalizedItem(item: StructuredImportItem): NormalizedImportItem | null {
  if (!item.title || isGenericTitle(item.title)) return null;

  const type: NormalizedImportItemType = item.destination === "pool" ? "pool" : "catalog_item";
  const rawText = descriptionToRawText(item);
  if (!rawText) return null;

  const confidence = item.destination === "pool" ? 0.97 : 0.95;

  return {
    type,
    sourceFileName: item.sourceFileName,
    title: item.title,
    rawText,
    confidence,
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
