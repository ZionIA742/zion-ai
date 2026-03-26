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
    .replace(/[^\p{L}\p{N}\s.,/%-]/gu, " ")
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

function tokenizeCatalogText(text: string) {
  return cleanText(text)
    .replace(/\n+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildCatalogRowsFromTokens(tokens: string[]) {
  const rows: Array<{
    productName: string;
    qtdCaixa?: string;
    valorCx?: string;
    valorUni?: string;
    valorVd?: string;
    rawText: string;
  }> = [];

  const ignoredHeaders = new Set([
    "tabela",
    "de",
    "precos",
    "preço",
    "precos:",
    "preço:",
    "produtos",
    "produto",
    "qtd",
    "caixa",
    "valor",
    "cx",
    "uni",
    "vd",
  ]);

  let i = 0;

  while (i < tokens.length) {
    const current = normalizeLoose(tokens[i]);

    if (!current || ignoredHeaders.has(current)) {
      i += 1;
      continue;
    }

    const nameParts: string[] = [];

    while (i < tokens.length) {
      const token = tokens[i];

      if (isIntegerLike(token)) {
        break;
      }

      const normalized = normalizeLoose(token);
      if (!normalized || ignoredHeaders.has(normalized)) {
        i += 1;
        continue;
      }

      nameParts.push(token);
      i += 1;
    }

    if (!nameParts.length) {
      i += 1;
      continue;
    }

    const productName = nameParts.join(" ").trim();

    const qtdCaixa = i < tokens.length && isIntegerLike(tokens[i]) ? tokens[i++] : undefined;
    const valorCx = i < tokens.length && isMoneyLike(tokens[i]) ? tokens[i++] : undefined;
    const valorUni = i < tokens.length && isMoneyLike(tokens[i]) ? tokens[i++] : undefined;
    const valorVd = i < tokens.length && isMoneyLike(tokens[i]) ? tokens[i++] : undefined;

    const hasUsefulStructure = Boolean(productName && (qtdCaixa || valorCx || valorUni || valorVd));

    if (!hasUsefulStructure) {
      continue;
    }

    const rawParts = [
      `Produto: ${productName}`,
      qtdCaixa ? `Qtd caixa: ${qtdCaixa}` : null,
      valorCx ? `Valor cx: ${valorCx}` : null,
      valorUni ? `Valor uni: ${valorUni}` : null,
      valorVd ? `Valor vd: ${valorVd}` : null,
    ].filter(Boolean) as string[];

    rows.push({
      productName,
      qtdCaixa,
      valorCx,
      valorUni,
      valorVd,
      rawText: rawParts.join("\n"),
    });
  }

  return rows;
}

function extractCatalogItemsFromSimpleTable(
  extracted: ExtractedFileContent
): NormalizedImportItem[] {
  if (!looksLikeCatalogHeader(extracted.text)) {
    return [];
  }

  const tokens = tokenizeCatalogText(extracted.text);
  const rows = buildCatalogRowsFromTokens(tokens);

  return rows.map((row) => {
    const filledFields = [
      row.productName ? 1 : 0,
      row.qtdCaixa ? 1 : 0,
      row.valorCx ? 1 : 0,
      row.valorUni ? 1 : 0,
      row.valorVd ? 1 : 0,
    ].reduce((acc, value) => acc + value, 0);

    let confidence = 0.78;

    if (filledFields >= 4) confidence = 0.9;
    else if (filledFields === 3) confidence = 0.84;

    return {
      type: "catalog_item" as const,
      sourceFileName: extracted.fileName,
      title: `Catálogo: ${row.productName}`,
      rawText: row.rawText,
      confidence,
      metadata: {
        extension: extracted.extension,
        mimeType: extracted.mimeType,
        importMode: "simple_catalog_table",
        productName: row.productName,
        qtdCaixa: row.qtdCaixa ?? "",
        valorCx: row.valorCx ?? "",
        valorUni: row.valorUni ?? "",
        valorVd: row.valorVd ?? "",
      },
    };
  });
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
  const simpleCatalogItems = extractCatalogItemsFromSimpleTable(extracted);

  if (simpleCatalogItems.length > 0) {
    return simpleCatalogItems;
  }

  return buildFallbackBlocks(extracted);
}

export function normalizeMultipleExtractedFiles(
  extractedFiles: ExtractedFileContent[]
): NormalizedImportItem[] {
  return extractedFiles.flatMap((file) => normalizeExtractedFile(file));
}