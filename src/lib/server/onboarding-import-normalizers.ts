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

function cleanText(text: string) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLoose(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s:.,/%x()-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMetadata(item: StructuredImportItem) {
  return {
    destination: item.destination,
    categoryHint: item.categoryHint || "",
    price: item.price || "",
    dimensions: item.dimensions || "",
    depth: item.depth || "",
    capacity: item.capacity || "",
    material: item.material || "",
    shape: item.shape || "",
    sku: item.sku || "",
  };
}

function scoreStructuredItem(item: StructuredImportItem) {
  let score = 0.62;

  if (item.title && item.title.length > 4) score += 0.08;
  if (item.description && item.description.length > 20) score += 0.08;
  if (item.price) score += 0.05;
  if (item.dimensions) score += 0.05;
  if (item.capacity) score += 0.04;
  if (item.material) score += 0.03;
  if (item.shape) score += 0.03;
  if (item.destination === "pool") score += 0.08;
  if (item.destination === "quimicos" || item.destination === "acessorios") score += 0.05;

  return Math.min(0.97, Number(score.toFixed(2)));
}

function toNormalizedType(item: StructuredImportItem): NormalizedImportItemType {
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

function buildNormalizedItem(item: StructuredImportItem): NormalizedImportItem {
  return {
    type: toNormalizedType(item),
    sourceFileName: item.sourceFileName,
    title: item.title,
    rawText: cleanText(item.rawBlock),
    confidence: scoreStructuredItem(item),
    metadata: buildMetadata(item),
  };
}

function buildFallbackBlock(extracted: ExtractedFileContent): NormalizedImportItem[] {
  const text = cleanText(extracted.text);
  if (!text) return [];

  const block = text.split(/\n\s*\n+/).find((entry) => entry.trim());
  if (!block) return [];

  const destination = normalizeLoose(block).includes("piscina") ? "pool" : "outros";

  return [
    {
      type: destination === "pool" ? "pool" : "unknown",
      sourceFileName: extracted.fileName,
      title: block.split("\n")[0].slice(0, 160) || "Bloco importado",
      rawText: block,
      confidence: 0.35,
      metadata: {
        destination,
        categoryHint: destination,
      },
    },
  ];
}

function filterBadItems(items: StructuredImportItem[]) {
  return items.filter((item) => {
    const title = normalizeLoose(item.title);
    const raw = normalizeLoose(item.rawBlock);

    if (!title && !raw) return false;
    if (title === "descricao detalhada") return false;
    if (title.startsWith("catalogo de teste")) return false;

    if (
      item.destination === "pool" &&
      !item.dimensions &&
      !item.capacity &&
      !item.depth &&
      /(acessor|quimic|cloro|algicida|peneira|escova|aspirador|refletor|led)/i.test(raw)
    ) {
      return false;
    }

    return true;
  });
}

export function normalizeExtractedFile(
  extracted: ExtractedFileContent
): NormalizedImportItem[] {
  const structuredItems = filterBadItems(parseStructuredImportItems(extracted));

  if (structuredItems.length > 0) {
    return structuredItems.map(buildNormalizedItem);
  }

  return buildFallbackBlock(extracted);
}

export function normalizeMultipleExtractedFiles(
  extractedFiles: ExtractedFileContent[]
): NormalizedImportItem[] {
  return extractedFiles.flatMap((file) => normalizeExtractedFile(file));
}
