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

type SimplePoolCard = {
  title: string;
  tipo?: string;
  medidas?: string;
  profundidade?: string;
  capacidade?: string;
  prazoEstimado?: string;
  faixaPreco?: string;
  descricao?: string;
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
    .replace(/[^\p{L}\p{N}\s.,/%|:\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMoneyLike(value: string) {
  const v = value.trim();

  return (
    /^r\$\s*\d{1,3}(\.\d{3})*,\d{2}(\s*a\s*r\$\s*\d{1,3}(\.\d{3})*,\d{2})?$/i.test(
      v
    ) ||
    /^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(v) ||
    /^-?\d+,\d{2}$/.test(v)
  );
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

  const score = [
    hasProdutos,
    hasQtd,
    hasValorCx,
    hasValorUni,
    hasValorVenda,
  ].filter(Boolean).length;

  return score >= 3;
}

function looksLikePoolDocument(text: string) {
  const lower = normalizeLoose(text);

  const signals = [
    lower.includes("piscina"),
    lower.includes("tipo"),
    lower.includes("medidas"),
    lower.includes("profundidade"),
    lower.includes("capacidade"),
    lower.includes("prazo estimado"),
    lower.includes("faixa de preco"),
  ].filter(Boolean).length;

  return signals >= 4;
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

function buildPoolItem(
  extracted: ExtractedFileContent,
  pool: SimplePoolCard,
  importMode: string,
  confidence: number
): NormalizedImportItem {
  return {
    type: "pool",
    sourceFileName: extracted.fileName,
    title: `Piscina: ${pool.title}`,
    rawText: pool.rawText,
    confidence,
    metadata: {
      extension: extracted.extension,
      mimeType: extracted.mimeType,
      importMode,
      title: pool.title,
      tipo: pool.tipo ?? "",
      medidas: pool.medidas ?? "",
      profundidade: pool.profundidade ?? "",
      capacidade: pool.capacidade ?? "",
      prazoEstimado: pool.prazoEstimado ?? "",
      faixaPreco: pool.faixaPreco ?? "",
      descricao: pool.descricao ?? "",
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

  const headerIndex = relevantLines.findIndex((line) =>
    looksLikeCatalogHeader(line)
  );
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

    const moneyCount = [valorCx, valorUni, valorVd].filter(
      (v) => v && isMoneyLike(v)
    ).length;
    const hasStructure =
      Boolean(isIntegerLike(qtdCaixa || "")) || moneyCount >= 2;

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

    items.push(
      buildCatalogItem(extracted, row, "simple_catalog_pipe_table", 0.93)
    );
  }

  return items;
}

function stripCatalogHeader(text: string) {
  return cleanText(text)
    .replace(
      /tabela\s+de\s+pre[cç]os\s+produtos?\s+qtd\s+caixa\s+valor\s+cx\s+valor\s+uni\s+valor\s+vd/iu,
      ""
    )
    .trim();
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

    items.push(
      buildCatalogItem(extracted, row, "simple_catalog_flat_sequence", 0.91)
    );
  }

  return items;
}

function extractRepeatedField(lineText: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*[|:]\\s*([^|\\n]+)`, "giu");

  return Array.from(lineText.matchAll(regex))
    .map((m) => (m[1] || "").trim())
    .filter(Boolean);
}

function extractPoolItemsFromRepeatedFieldSequence(
  extracted: ExtractedFileContent
): NormalizedImportItem[] {
  if (!looksLikePoolDocument(extracted.text)) return [];

  const flat = cleanText(extracted.text).replace(/\n+/g, " ");

  const tipos = extractRepeatedField(flat, "Tipo");
  const medidas = extractRepeatedField(flat, "Medidas");
  const profundidades = extractRepeatedField(flat, "Profundidade");
  const capacidades = extractRepeatedField(flat, "Capacidade");
  const prazos = extractRepeatedField(flat, "Prazo estimado");
  const faixas = extractRepeatedField(flat, "Faixa de preço");

  const maxLen = Math.max(
    tipos.length,
    medidas.length,
    profundidades.length,
    capacidades.length,
    prazos.length,
    faixas.length
  );

  if (maxLen < 2) return [];

  const items: NormalizedImportItem[] = [];

  for (let i = 0; i < maxLen; i++) {
    const tipo = tipos[i] || "";
    const medida = medidas[i] || "";
    const profundidade = profundidades[i] || "";
    const capacidade = capacidades[i] || "";
    const prazo = prazos[i] || "";
    const faixa = faixas[i] || "";

    const filled = [tipo, medida, profundidade, capacidade, prazo, faixa].filter(
      Boolean
    ).length;

    if (filled < 3) continue;

    const titleBase = [tipo ? `Piscina ${tipo}` : "Piscina", medida || ""]
      .filter(Boolean)
      .join(" ")
      .trim();

    const pool: SimplePoolCard = {
      title: titleBase || `Piscina ${i + 1}`,
      tipo,
      medidas: medida,
      profundidade,
      capacidade,
      prazoEstimado: prazo,
      faixaPreco: faixa,
      descricao: "",
      rawText: [
        `Piscina: ${titleBase || `Piscina ${i + 1}`}`,
        tipo ? `Tipo: ${tipo}` : null,
        medida ? `Medidas: ${medida}` : null,
        profundidade ? `Profundidade: ${profundidade}` : null,
        capacidade ? `Capacidade: ${capacidade}` : null,
        prazo ? `Prazo estimado: ${prazo}` : null,
        faixa ? `Faixa de preço: ${faixa}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    };

    let confidence = 0.84;
    if (filled >= 5) confidence = 0.9;
    if (filled >= 6) confidence = 0.94;

    items.push(
      buildPoolItem(extracted, pool, "repeated_pool_field_sequence", confidence)
    );
  }

  return items;
}

function splitPoolSections(text: string) {
  const cleaned = cleanText(text);

  return cleaned
    .split(/\n(?=Piscina\s)/g)
    .map((section) => section.trim())
    .filter(Boolean);
}

function extractValue(section: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*[:|]\\s*(.+)`, "iu");
  const match = section.match(regex);
  return match?.[1]?.trim() || "";
}

function extractPoolItemsFromSimpleCards(
  extracted: ExtractedFileContent
): NormalizedImportItem[] {
  if (!looksLikePoolDocument(extracted.text)) {
    return [];
  }

  const sections = splitPoolSections(extracted.text);
  const items: NormalizedImportItem[] = [];

  for (const section of sections) {
    const lines = section
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) continue;

    const title = lines[0].replace(/^Piscina\s*/i, "").trim() || lines[0];

    const tipo = extractValue(section, "Tipo");
    const medidas = extractValue(section, "Medidas");
    const profundidade = extractValue(section, "Profundidade");
    const capacidade = extractValue(section, "Capacidade");
    const prazoEstimado = extractValue(section, "Prazo estimado");
    const faixaPreco =
      extractValue(section, "Faixa de preço") ||
      extractValue(section, "Faixa de preco");

    const knownLines = new Set([
      lines[0],
      ...lines.filter((line) =>
        /^(tipo|medidas|profundidade|capacidade|prazo estimado|faixa de pre[cç]o)\s*[:|]/iu.test(
          line
        )
      ),
    ]);

    const descricao = lines
      .filter((line) => !knownLines.has(line))
      .join(" ")
      .trim();

    const filled = [
      title ? 1 : 0,
      tipo ? 1 : 0,
      medidas ? 1 : 0,
      profundidade ? 1 : 0,
      capacidade ? 1 : 0,
      prazoEstimado ? 1 : 0,
      faixaPreco ? 1 : 0,
    ].reduce((acc, value) => acc + value, 0);

    if (filled < 3) continue;

    const pool: SimplePoolCard = {
      title,
      tipo,
      medidas,
      profundidade,
      capacidade,
      prazoEstimado,
      faixaPreco,
      descricao,
      rawText: [
        `Piscina: ${title}`,
        tipo ? `Tipo: ${tipo}` : null,
        medidas ? `Medidas: ${medidas}` : null,
        profundidade ? `Profundidade: ${profundidade}` : null,
        capacidade ? `Capacidade: ${capacidade}` : null,
        prazoEstimado ? `Prazo estimado: ${prazoEstimado}` : null,
        faixaPreco ? `Faixa de preço: ${faixaPreco}` : null,
        descricao ? `Descrição: ${descricao}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    };

    let confidence = 0.8;
    if (filled >= 6) confidence = 0.92;
    else if (filled >= 5) confidence = 0.88;

    items.push(buildPoolItem(extracted, pool, "simple_pool_cards", confidence));
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

function buildFallbackBlocks(
  extracted: ExtractedFileContent
): NormalizedImportItem[] {
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

  const repeatedPoolItems = extractPoolItemsFromRepeatedFieldSequence(extracted);
  if (repeatedPoolItems.length > 0) {
    return repeatedPoolItems;
  }

  const simplePoolItems = extractPoolItemsFromSimpleCards(extracted);
  if (simplePoolItems.length > 0) {
    return simplePoolItems;
  }

  return buildFallbackBlocks(extracted);
}

export function normalizeMultipleExtractedFiles(
  extractedFiles: ExtractedFileContent[]
): NormalizedImportItem[] {
  return extractedFiles.flatMap((file) => normalizeExtractedFile(file));
}