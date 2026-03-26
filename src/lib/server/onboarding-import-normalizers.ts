import type { ExtractedFileContent } from "./onboarding-file-extractors";

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
  return text.replace(/\r/g, "").replace(/\t/g, " ").trim();
}

function splitIntoBlocks(text: string) {
  return cleanText(text)
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function detectType(block: string): NormalizedImportItemType {
  const lower = block.toLowerCase();

  if (
    lower.includes("responsável") ||
    lower.includes("proprietário") ||
    lower.includes("telefone") ||
    lower.includes("whatsapp") ||
    lower.includes("email")
  ) {
    return "responsible_info";
  }

  if (
    lower.includes("desconto") ||
    lower.includes("pagamento") ||
    lower.includes("parcelamento") ||
    lower.includes("sinal") ||
    lower.includes("entrada")
  ) {
    return "commercial_rule";
  }

  if (
    lower.includes("piscina") ||
    lower.includes("fibra") ||
    lower.includes("alvenaria") ||
    lower.includes("medidas") ||
    lower.includes("comprimento") ||
    lower.includes("largura")
  ) {
    return "pool";
  }

  if (
    lower.includes("cloro") ||
    lower.includes("algicida") ||
    lower.includes("bomba") ||
    lower.includes("filtro") ||
    lower.includes("aspirador") ||
    lower.includes("escova") ||
    lower.includes("peneira") ||
    lower.includes("led") ||
    lower.includes("hidromassagem")
  ) {
    return "catalog_item";
  }

  if (
    lower.includes("loja") ||
    lower.includes("empresa") ||
    lower.includes("endereço") ||
    lower.includes("cidade") ||
    lower.includes("bairro") ||
    lower.includes("horário")
  ) {
    return "store_info";
  }

  return "unknown";
}

function estimateConfidence(type: NormalizedImportItemType, block: string) {
  const textLength = block.trim().length;

  if (type === "unknown") return 0.2;
  if (textLength > 250) return 0.92;
  if (textLength > 120) return 0.82;
  if (textLength > 60) return 0.72;
  return 0.6;
}

function buildTitle(type: NormalizedImportItemType, block: string) {
  const firstLine = block.split("\n")[0]?.trim() || "Sem título";

  if (type === "pool") return `Piscina: ${firstLine}`;
  if (type === "catalog_item") return `Catálogo: ${firstLine}`;
  if (type === "commercial_rule") return `Regra comercial: ${firstLine}`;
  if (type === "responsible_info") return `Responsável: ${firstLine}`;
  if (type === "store_info") return `Loja: ${firstLine}`;

  return firstLine;
}

export function normalizeExtractedFile(
  extracted: ExtractedFileContent
): NormalizedImportItem[] {
  const blocks = splitIntoBlocks(extracted.text);

  return blocks.map((block) => {
    const type = detectType(block);

    return {
      type,
      sourceFileName: extracted.fileName,
      title: buildTitle(type, block),
      rawText: block,
      confidence: estimateConfidence(type, block),
      metadata: {
        extension: extracted.extension,
        mimeType: extracted.mimeType,
      },
    };
  });
}

export function normalizeMultipleExtractedFiles(
  extractedFiles: ExtractedFileContent[]
): NormalizedImportItem[] {
  return extractedFiles.flatMap((file) => normalizeExtractedFile(file));
}