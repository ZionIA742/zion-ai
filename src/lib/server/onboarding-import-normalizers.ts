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

type SimpleCatalogRow = {
  productName: string;
  qtdCaixa?: string;
  valorCx?: string;
  valorUni?: string;
  valorVd?: string;
  rawText: string;
};

function cleanText(text: string) {
  return text.replace(/\r/g, "").replace(/\t/g, " ").trim();
}

function splitIntoParagraphBlocks(text: string) {
  return cleanText(text)
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function normalizeLoose(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s.,/%|-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMoneyLike(value: string) {
  const v = value.trim();
  return /^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(v) || /^-?\d+,\d{2}$/.test(v);
}

function isIntegerLike(value: string) {
  return /^\d+$/.test(value.trim());
}

function looksLikeCatalogHeader(text: string) {
  const lower = normalizeLoose(text);

  const hasProdutos = lower.includes("produto") || lower.includes("produtos");
  const hasQtd =
    lower.includes("qtd caixa") ||
    lower.includes("qtd") ||
    lower.includes("quantidade");
  const hasValorCx =
    lower.includes("valor cx") ||
    lower.includes("valor caixa") ||
    lower.includes("vlr cx");
  const hasValorUni =
    lower.includes("valor uni") ||
    lower.includes("valor unit") ||
    lower.includes("valor unitario");
  const hasValorVenda =
    lower.includes("valor vd") ||
    lower.includes("valor venda") ||
    lower.includes("venda");

  const score = [hasProdutos, hasQtd, hasValorCx, hasValorUni, hasValorVenda].filter(Boolean).length;

  return score >= 3;
}

function buildCatalogItem(
  extracted: ExtractedFileContent,
  row: SimpleCatalogRow,
  importMode: string,
  confidence: number
): NormalizedImportItem {
  return {
    type: "catalog_item",
    sourceFileName: extracted.fileName,
    title: `Catálogo: ${row.productName}`,
    rawText: row.rawText,
    confidence,
    metadata: {
      extension: extracted.extension,
      mimeType: extracted.mimeType,
      importMode,
      productName: row.productName,
      qtdCaixa: row.qtdCaixa ?? "",
      valorCx: row.valorCx ?? "",
      valorUni: row.valorUni ?? "",
      valorVd: row.valorVd ?? "",
    },
  };
}

function extractCatalogItemsFromPipeTable(
  extracted: ExtractedFileContent
): NormalizedImportItem[] {
  const lines = cleanText(extracted.text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const relevantLines = lines.filter((line) => line.includes("|"));

  if (!relevantLines.length) return [];

  const headerIndex = relevantLines.findIndex((line) => looksLikeCatalogHeader(line));
  if (headerIndex === -1) return [];

  const dataLines = relevantLines.slice(headerIndex + 1);
  const items: NormalizedImportItem[] = [];

  for (const line of dataLines) {
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);

    if (cells.length < 2) continue;

    const [productName, qtdCaixa, valorCx, valorUni, valorVd] = cells;

    if (!productName) continue;

    const moneyCount = [valorCx, valorUni, valorVd].filter((v) => v && isMoneyLike(v)).length;
    const hasStructure = Boolean(isIntegerLike(qtdCaixa || "") || moneyCount >= 2);

    if (!hasStructure) continue;

    const row: SimpleCatalogRow = {
      productName,
      qtdCaixa,
      valorCx,
      valorUni,
      valorVd,
      rawText: [
        `Produto: ${productName}`,
        qtdCaixa ? `Qtd caixa: ${qtdCaixa}` : null,
        valorCx ? `Valor cx: ${valorCx}` : null,
        valorUni ? `Valor uni: ${valorUni}` : null,
        valorVd ? `Valor vd: ${valorVd}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    };

    items.push(buildCatalogItem(extracted, row, "simple_catalog_pipe_table", 0.93));
  }

  return items;
}

function stripCatalogHeader(text: string) {
  return cleanText(text).replace(
    /tabela\s+de\s+pre[cç]os\s+produtos?\s+qtd\s+caixa\s+valor\s+cx\s+valor\s+uni\s+valor\s+vd/iu,
    ""
  ).trim();
}

function extractCatalogItemsFromFlatSequence(
  extracted: ExtractedFileContent
): NormalizedImportItem[] {
  if (!looksLikeCatalogHeader(extracted.text)) {
    return [];
  }

  const flattened = stripCatalogHeader(
    cleanText(extracted.text).replace(/\n+/g, " ")
  );

  if (!flattened) return [];

  const pattern =
    /([A-Za-zÀ-ÿ0-9/\-–—+().,%\s]+?)\s+(\d+)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+(\d{1,3}(?:\.\d{3})*,\d{2})(?=\s+[A-Za-zÀ-ÿ]|$)/g;

  const items: NormalizedImportItem[] = [];
  const matches = Array.from(flattened.matchAll(pattern));

  for (const match of matches) {
    const rawName = (match[1] || "").trim();
    const qtdCaixa = (match[2] || "").trim();
    const valorCx = (match[3] || "").trim();
    const valorUni = (match[4] || "").trim();
    const valorVd = (match[5] || "").trim();

    const productName = rawName
      .replace(/\s+/g, " ")
      .replace(/^[|,:;\-]+/, "")
      .replace(/[|,:;\-]+$/, "")
      .trim();

    if (!productName) continue;

    const row: SimpleCatalogRow = {
      productName,
      qtdCaixa,
      valorCx,
      valorUni,
      valorVd,
      rawText: [
        `Produto: ${productName}`,
        `Qtd caixa: ${qtdCaixa}`,
        `Valor cx: ${valorCx}`,
        `Valor uni: ${valorUni}`,
        `Valor vd: ${valorVd}`,
      ].join("\n"),
    };

    items.push(buildCatalogItem(extracted, row, "simple_catalog_flat_sequence", 0.91));
  }

  return items;
}

function detectType(block: string): NormalizedImportItemType {
  const lower = normalizeLoose(block);

  if (
    lower.includes("responsavel") ||
    lower.includes("proprietario") ||
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
    lower.includes("vinil") ||
    lower.includes("pastilha") ||
    lower.includes("revestida") ||
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
    lower.includes("hidromassagem") ||
    lower.includes("clarificante") ||
    lower.includes("limpa borda") ||
    lower.includes("redutor de ph") ||
    lower.includes("elevador de ph")
  ) {
    return "catalog_item";
  }

  if (
    lower.includes("loja") ||
    lower.includes("empresa") ||
    lower.includes("endereco") ||
    lower.includes("cidade") ||
    lower.includes("bairro") ||
    lower.includes("horario")
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

function buildFallbackBlocks(extracted: ExtractedFileContent): NormalizedImportItem[] {
  const blocks = splitIntoParagraphBlocks(extracted.text);

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
        importMode: "fallback_blocks",
      },
    };
  });
}

export function normalizeExtractedFile(
  extracted: ExtractedFileContent
): NormalizedImportItem[] {
  const pipeTableItems = extractCatalogItemsFromPipeTable(extracted);
  if (pipeTableItems.length > 0) {
    return pipeTableItems;
  }

  const flatSequenceItems = extractCatalogItemsFromFlatSequence(extracted);
  if (flatSequenceItems.length > 0) {
    return flatSequenceItems;
  }

  return buildFallbackBlocks(extracted);
}

export function normalizeMultipleExtractedFiles(
  extractedFiles: ExtractedFileContent[]
): NormalizedImportItem[] {
  return extractedFiles.flatMap((file) => normalizeExtractedFile(file));
}