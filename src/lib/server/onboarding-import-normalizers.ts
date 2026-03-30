
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
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseItemTitle(title: string) {
  const normalized = normalizeLoose(title);
  return [
    "descricao detalhada",
    "campo valor",
    "nome do item",
    "imagem ilustrativa",
  ].includes(normalized);
}

function looksLikeNoiseBlock(text: string) {
  const normalized = normalizeLoose(text);

  return (
    normalized.length < 16 ||
    normalized.startsWith("catalogo de teste") ||
    normalized.startsWith("arquivo de teste") ||
    normalized.startsWith("objetivo validar") ||
    normalized.startsWith("salvar em configuracoes") ||
    normalized === "descricao detalhada" ||
    normalized === "campo valor"
  );
}

function cleanCatalogDescription(text: string) {
  return text
    .replace(/categoria esperada no sistema:[^\n]+/gi, "")
    .replace(/arquivo de teste[^\n]*/gi, "")
    .replace(/objetivo validar[^\n]*/gi, "")
    .replace(/salvar em configura[cç][oõ]es[^\n]*/gi, "")
    .replace(/imagem ilustrativa de alta qualidade para teste/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function mapStructuredItem(item: StructuredImportItem): NormalizedImportItem | null {
  if (isNoiseItemTitle(item.title) || looksLikeNoiseBlock(item.rawBlock)) {
    return null;
  }

  if (item.destination === "pool") {
    return {
      type: "pool",
      sourceFileName: item.sourceFileName,
      title: item.title,
      rawText: cleanCatalogDescription(item.description || item.rawBlock),
      confidence: 0.95,
      metadata: {
        destination: item.destination,
        dimensions: item.dimensions ?? "",
        depth: item.depth ?? "",
        capacity: item.capacity ?? "",
        material: item.material ?? "",
        shape: item.shape ?? "",
        price: item.price ?? "",
        brand: item.brand ?? "",
        notes: item.notes ?? "",
        usage: item.usage ?? "",
      },
    };
  }

  return {
    type: "catalog_item",
    sourceFileName: item.sourceFileName,
    title: item.title,
    rawText: cleanCatalogDescription(item.description || item.rawBlock),
    confidence: item.destination === "acessorios" ? 0.94 : item.destination === "quimicos" ? 0.95 : 0.9,
    metadata: {
      destination: item.destination,
      categoria: item.destination,
      categoryHint: item.categoryHint ?? "",
      price: item.price ?? "",
      dimensions: item.dimensions ?? "",
      depth: item.depth ?? "",
      capacity: item.capacity ?? "",
      material: item.material ?? "",
      shape: item.shape ?? "",
      brand: item.brand ?? "",
      sku: item.sku ?? "",
      weight: item.weight ?? "",
      dosage: item.dosage ?? "",
      color: item.color ?? "",
      usage: item.usage ?? "",
      notes: item.notes ?? "",
      clean_description: cleanCatalogDescription(item.description || item.rawBlock),
    },
  };
}

function buildFallbackBlock(extracted: ExtractedFileContent): NormalizedImportItem[] {
  const text = extracted.text.trim();
  if (!text) return [];

  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) || "";
  if (!firstLine || looksLikeNoiseBlock(firstLine)) return [];

  return [
    {
      type: "unknown",
      sourceFileName: extracted.fileName,
      title: firstLine.slice(0, 160),
      rawText: cleanCatalogDescription(text).slice(0, 4000),
      confidence: 0.35,
      metadata: {
        extension: extracted.extension,
        mimeType: extracted.mimeType,
      },
    },
  ];
}

export function normalizeExtractedFile(extracted: ExtractedFileContent): NormalizedImportItem[] {
  const structured = parseStructuredImportItems(extracted)
    .map(mapStructuredItem)
    .filter((item): item is NormalizedImportItem => Boolean(item));

  if (structured.length > 0) {
    return structured;
  }

  return buildFallbackBlock(extracted);
}

export function normalizeMultipleExtractedFiles(
  extractedFiles: ExtractedFileContent[]
): NormalizedImportItem[] {
  return extractedFiles.flatMap((file) => normalizeExtractedFile(file));
}
