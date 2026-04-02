import type { ExtractedFileContent } from "./server/onboarding-file-extractors";

export type StructuredImportDestination = "pool" | "quimicos" | "acessorios" | "outros";

export type StructuredImportItem = {
  sourceFileName: string;
  destination: StructuredImportDestination;
  title: string;
  description: string;
  rawBlock: string;
  confidence: number;
  categoria?: string;
  price?: string;
  dimensions?: string;
  depth?: string;
  capacity?: string;
  material?: string;
  shape?: string;
  brand?: string;
  sku?: string;
  weight?: string;
  dosage?: string;
  color?: string;
  usage?: string;
  notes?: string;
  indication?: string;
  composition?: string;
  embalagem?: string;
  packaging?: string;
  model?: string;
  size?: string;
  compatibility?: string;
  function?: string;
  environment?: string;
  diferencial?: string;
  application?: string;
};

const DEBUG_INTELLIGENT_IMPORT =
  process.env.NEXT_PUBLIC_DEBUG_INTELLIGENT_IMPORT === "1" ||
  process.env.DEBUG_INTELLIGENT_IMPORT === "1" ||
  process.env.NODE_ENV !== "production";

function debugIntelligentImport(label: string, payload?: unknown) {
  if (!DEBUG_INTELLIGENT_IMPORT) return;
  if (typeof payload === "undefined") {
    console.log(`[ZION][intelligent-import][parser] ${label}`);
    return;
  }
  console.log(`[ZION][intelligent-import][parser] ${label}`, payload);
}

function cleanText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLoose(value: string | null | undefined) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBlock(value: string) {
  return cleanText(
    String(value || "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
  );
}

function titleCaseLabel(label: string) {
  return String(label || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeRegExp(value: string) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const INLINE_FIELD_DEFINITIONS: Array<{
  canonicalKey: string;
  aliases: string[];
}> = [
  { canonicalKey: "planilha", aliases: ["planilha", "aba", "sheet"] },
  { canonicalKey: "sku", aliases: ["sku", "código", "codigo"] },
  { canonicalKey: "categoria", aliases: ["categoria", "category"] },
  {
    canonicalKey: "nome do produto",
    aliases: ["nome do produto", "nome comercial", "nome", "produto", "item", "título", "titulo"],
  },
  { canonicalKey: "linha", aliases: ["linha", "line"] },
  {
    canonicalKey: "preço",
    aliases: [
      "preço venda (r$)",
      "preco venda (r$)",
      "preço venda",
      "preco venda",
      "valor venda (r$)",
      "valor venda",
      "preço final (r$)",
      "preco final (r$)",
      "preço final",
      "preco final",
      "valor final (r$)",
      "valor final",
      "preço sugerido (r$)",
      "preco sugerido (r$)",
      "preço sugerido",
      "preco sugerido",
      "preço",
      "preco",
      "valor",
    ],
  },
  {
    canonicalKey: "preço custo",
    aliases: [
      "preço custo (r$)",
      "preco custo (r$)",
      "preço custo",
      "preco custo",
      "valor custo (r$)",
      "valor custo",
      "custo",
    ],
  },
  { canonicalKey: "aplicação", aliases: ["aplicação", "aplicacao", "application"] },
  { canonicalKey: "embalagem", aliases: ["embalagem", "package", "packaging"] },
  { canonicalKey: "peso", aliases: ["peso/volume", "peso volume", "peso", "volume", "conteúdo", "conteudo"] },
  { canonicalKey: "dosagem", aliases: ["dosagem", "dose"] },
  { canonicalKey: "marca", aliases: ["marca", "brand"] },
  { canonicalKey: "modelo", aliases: ["modelo", "model"] },
  { canonicalKey: "cor", aliases: ["cor", "color"] },
  { canonicalKey: "uso", aliases: ["uso", "usage"] },
  { canonicalKey: "observação", aliases: ["observações", "observacoes", "observação", "observacao", "notas", "notes"] },
  { canonicalKey: "indicação", aliases: ["indicação", "indicacao", "indicado para"] },
  { canonicalKey: "composição", aliases: ["composição", "composicao"] },
  { canonicalKey: "compatibilidade", aliases: ["compatibilidade", "compatibility"] },
  { canonicalKey: "função", aliases: ["função", "funcao", "finalidade", "function"] },
  { canonicalKey: "ambiente", aliases: ["ambiente", "ambiente indicado", "environment"] },
  { canonicalKey: "diferencial", aliases: ["diferencial"] },
  { canonicalKey: "medidas", aliases: ["medidas", "dimensões", "dimensoes", "tamanho", "size"] },
  { canonicalKey: "profundidade", aliases: ["profundidade", "prof."] },
  { canonicalKey: "capacidade", aliases: ["capacidade"] },
  { canonicalKey: "controlar estoque", aliases: ["controlar estoque", "track stock", "control stock"] },
  { canonicalKey: "quantidade atual", aliases: ["quantidade atual", "estoque inicial", "quantidade", "stock inicial", "stock quantity"] },
  { canonicalKey: "estoque mínimo", aliases: ["estoque mínimo", "estoque minimo", "stock mínimo", "stock minimo"] },
  { canonicalKey: "estoque máximo", aliases: ["estoque máximo", "estoque maximo", "stock máximo", "stock maximo"] },
];

const INLINE_FIELD_ALIAS_TO_CANONICAL = INLINE_FIELD_DEFINITIONS.reduce<Record<string, string>>(
  (acc, definition) => {
    definition.aliases.forEach((alias) => {
      acc[normalizeLoose(alias)] = definition.canonicalKey;
    });
    return acc;
  },
  {}
);

const INLINE_FIELD_PATTERN = INLINE_FIELD_DEFINITIONS.flatMap((definition) => definition.aliases)
  .sort((left, right) => right.length - left.length)
  .map((label) => escapeRegExp(label))
  .join("|");

function extractInlineFieldPairs(block: string) {
  const normalized = normalizeBlock(block).replace(/\s*\|\s*/g, "\n");
  const results: Record<string, string> = {};

  if (!INLINE_FIELD_PATTERN) return results;

  const regex = new RegExp(
    `(?:^|\\n|\\s)(${INLINE_FIELD_PATTERN})\\s*:\\s*([\\s\\S]*?)(?=(?:\\n|\\s)(?:${INLINE_FIELD_PATTERN})\\s*:|$)`,
    "gi"
  );

  for (const match of normalized.matchAll(regex)) {
    const rawLabel = cleanText(match[1]);
    const canonicalKey = INLINE_FIELD_ALIAS_TO_CANONICAL[normalizeLoose(rawLabel)];
    const rawValue = cleanText(match[2]);

    if (!canonicalKey || !rawValue) continue;

    if (!results[canonicalKey]) {
      results[canonicalKey] = rawValue;
      continue;
    }

    const currentNormalized = normalizeLoose(results[canonicalKey]);
    const nextNormalized = normalizeLoose(rawValue);
    if (!currentNormalized.includes(nextNormalized)) {
      results[canonicalKey] = `${results[canonicalKey]}\n${rawValue}`;
    }
  }

  return results;
}

function rawBlockLooksLikeStockSummary(rawBlock: string) {
  const normalized = normalizeLoose(rawBlock);
  return (
    normalized.includes("controlar estoque") ||
    normalized.includes("quantidade atual") ||
    normalized.includes("estoque minimo") ||
    normalized.includes("estoque maximo") ||
    normalized.includes("stock quantity")
  );
}

function looksLikeGuideOrNoiseBlock(rawBlock: string) {
  const normalized = normalizeLoose(rawBlock);
  return (
    normalized.includes("guia leitura") ||
    normalized.includes("guia de leitura") ||
    normalized.includes("validar leitura do upload inteligente") ||
    normalized.includes("arquivo de teste") ||
    normalized.includes("salvar em configuracoes") ||
    normalized.includes("categoria esperada no sistema")
  );
}

function extractLoosePrice(text: string) {
  const saleMatchers = [
    /pre[cç]o\s+venda(?:\s*\(r\$\))?\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i,
    /valor\s+venda(?:\s*\(r\$\))?\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i,
    /pre[cç]o\s+final(?:\s*\(r\$\))?\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i,
    /valor\s+final(?:\s*\(r\$\))?\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i,
    /pre[cç]o\s+sugerido(?:\s*\(r\$\))?\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i,
    /(?:^|[\n|])\s*(?:pre[cç]o|valor)\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i,
  ];

  for (const matcher of saleMatchers) {
    const matched = text.match(matcher);
    if (matched?.[1]) return matched[1];
  }

  const genericMoneyMatches = Array.from(
    text.matchAll(/r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/gi)
  ).map((match) => cleanText(match[1]));

  if (genericMoneyMatches.length > 0) {
    return genericMoneyMatches[genericMoneyMatches.length - 1] || "";
  }

  return "";
}

function extractLooseDimensions(text: string) {
  const rectMatch = text.match(/\b(\d+[\.,]?\d*)\s*x\s*(\d+[\.,]?\d*)\s*m\b/i);
  if (rectMatch) {
    return `${rectMatch[1]} x ${rectMatch[2]} m`;
  }

  const diamMatch = text.match(/\b(\d+[\.,]?\d*)\s*m\s*di[âa]m/i);
  if (diamMatch) {
    return `${diamMatch[1]} m diâm`;
  }

  return "";
}

function extractLooseDepth(text: string) {
  const match =
    text.match(/profundidade\s*(?:de|do|da)?\s*[:\-]?\s*(\d+[\.,]?\d*)\s*m/i) ||
    text.match(/\bprof\.?\s*(\d+[\.,]?\d*)\s*m\b/i);

  return match ? `${match[1]} m` : "";
}

function extractLooseCapacity(text: string) {
  const match =
    text.match(/capacidade(?:\s+estimada|\s+m[áa]xima|\s+aproximada)?\s*(?:de|do|da)?\s*[:\-]?\s*(\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?)?/i) ||
    text.match(/\b(\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?)\b/i);

  return match ? `${match[1]} L` : "";
}

function extractLooseMaterial(text: string) {
  const normalized = normalizeLoose(text);
  if (normalized.includes("vinil")) return "vinil";
  if (normalized.includes("alvenaria")) return "alvenaria";
  if (normalized.includes("pastilha")) return "pastilha";
  if (normalized.includes("fibra")) return "fibra";
  return "";
}

function extractLooseShape(text: string) {
  const normalized = normalizeLoose(text);
  if (normalized.includes("redonda") || normalized.includes("diam")) return "redonda";
  if (normalized.includes("oval")) return "oval";
  if (normalized.includes("raia")) return "raia";
  if (normalized.includes("retangular")) return "retangular";
  return "";
}

function extractLooseBrand(text: string) {
  const match =
    text.match(/marca\s*[:\-]?\s*(.+)/i) ||
    text.match(/\b(cris água|cris agua|brustec|sodramar|nautilus|veico|genco)\b/i);

  return cleanText(match?.[1] || "");
}

function extractLooseSku(text: string) {
  const match =
    text.match(/\bsku\s*[:\-]?\s*([a-z0-9\-_./]+)/i) ||
    text.match(/\bc[oó]digo\s*[:\-]?\s*([a-z0-9\-_./]+)/i);

  return cleanText(match?.[1] || "");
}

function extractLooseWeight(text: string) {
  const match =
    text.match(/\bpeso(?:\/volume)?\s*[:\-]?\s*(\d+[\.,]?\d*)\s*(kg|g|l|ml)\b/i) ||
    text.match(/\b(\d+[\.,]?\d*)\s*(kg|g|l|ml)\b/i);

  return match ? `${match[1]} ${match[2]}` : "";
}

function extractLooseDosage(text: string) {
  const match = text.match(/\bdosagem\s*[:\-]?\s*(.+)/i);
  return cleanText(match?.[1] || "");
}

function extractLooseColor(text: string) {
  const match =
    text.match(/\bcor\s*[:\-]?\s*(.+)/i) ||
    text.match(/\b(azul cristal|azul|branco|cinza|preto|verde)\b/i);

  return cleanText(match?.[1] || "");
}

function isChemicalSku(value: string | null | undefined) {
  const sku = cleanText(value || "").toUpperCase();
  return /^QMC-\d{3,}$/.test(sku);
}

function inferDestination(text: string, explicitSku?: string): StructuredImportDestination {
  if (isChemicalSku(explicitSku)) {
    return "quimicos";
  }

  const source = normalizeLoose(text);

  if (/\bqmc\s*-\s*\d{3,}\b/i.test(source)) {
    return "quimicos";
  }

  const chemicalScore =
    (source.includes("cloro") ? 4 : 0) +
    (source.includes("algicida") ? 4 : 0) +
    (source.includes("clarificante") ? 4 : 0) +
    (source.includes("sulfato") ? 4 : 0) +
    (source.includes("redutor de ph") ? 4 : 0) +
    (source.includes("elevador de ph") ? 4 : 0) +
    (source.includes("quimic") ? 3 : 0) +
    (source.includes("dosagem") ? 2 : 0);

  const accessoryScore =
    (source.includes("acessor") ? 4 : 0) +
    (source.includes("aspirador") ? 4 : 0) +
    (source.includes("escova") ? 4 : 0) +
    (source.includes("peneira") ? 4 : 0) +
    (source.includes("mangueira") ? 3 : 0) +
    (source.includes("dispositivo") ? 3 : 0) +
    (source.includes("clorador") ? 3 : 0) +
    (source.includes("led") ? 2 : 0) +
    (source.includes("nicho") ? 2 : 0);

  const poolScore =
    (source.includes("piscina") ? 4 : 0) +
    (source.includes("fibra") ? 2 : 0) +
    (source.includes("vinil") ? 2 : 0) +
    (source.includes("alvenaria") ? 2 : 0) +
    (source.includes("spa") ? 2 : 0) +
    (source.includes("profundidade") ? 2 : 0) +
    (source.includes("capacidade") ? 2 : 0) +
    (source.includes("litros") ? 2 : 0) +
    (/\b\d+[\.,]?\d*\s*x\s*\d+[\.,]?\d*\s*m\b/i.test(source) ? 4 : 0) +
    (/\b\d+[\.,]?\d*\s*m\s*diam/i.test(source) ? 4 : 0);

  if (chemicalScore >= 4 && chemicalScore >= accessoryScore && chemicalScore >= poolScore) {
    return "quimicos";
  }

  if (accessoryScore >= 4 && accessoryScore > chemicalScore && accessoryScore >= poolScore) {
    return "acessorios";
  }

  if (poolScore >= 5) {
    return "pool";
  }

  return "outros";
}

function splitDelimitedBlocks(text: string) {
  const normalized = normalizeBlock(text);
  if (!/={3}\s*ITEM\b/i.test(normalized)) return [];

  const markerRegex = /={3}\s*ITEM\b[^\n|]*?(?:\||\n|$)/gi;
  const markers = Array.from(normalized.matchAll(markerRegex));

  if (markers.length === 0) return [];

  const blocks: string[] = [];

  for (let index = 0; index < markers.length; index += 1) {
    const currentMarker = markers[index];
    const start = (currentMarker.index ?? 0) + currentMarker[0].length;
    const end = index + 1 < markers.length ? markers[index + 1].index ?? normalized.length : normalized.length;
    const header = cleanText(currentMarker[0].replace(/[|]/g, " ").replace(/={3}/g, "").trim());
    const body = normalizeBlock(normalized.slice(start, end));
    const joined = normalizeBlock([header, body].filter(Boolean).join("\n"));
    if (!joined) continue;
    if (normalizeLoose(joined).startsWith("planilha")) continue;
    blocks.push(joined);
  }

  return blocks;
}

function splitNumberedBlocks(text: string) {
  const normalized = normalizeBlock(text);

  const parts = normalized
    .split(/\n(?=\d{1,4}[\)\.\-]\s+)/g)
    .map((block) => normalizeBlock(block))
    .filter(Boolean);

  return parts.filter((block) => /^\d{1,4}[\)\.\-]\s+/.test(block));
}

function splitRepeatedFieldBlocks(text: string) {
  const normalized = normalizeBlock(text);
  const lines = normalized
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean);

  if (lines.length === 0) return [];

  const blocks: string[] = [];
  let current: string[] = [];

  function pushCurrent() {
    const joined = normalizeBlock(current.join("\n"));
    if (joined) blocks.push(joined);
    current = [];
  }

  for (const line of lines) {
    const normalizedLine = normalizeLoose(line);

    const startsNewBlock =
      normalizedLine.startsWith("nome do item") ||
      normalizedLine.startsWith("nome:") ||
      normalizedLine.startsWith("produto:") ||
      normalizedLine.startsWith("item:") ||
      normalizedLine.startsWith("modelo:") ||
      normalizedLine.startsWith("piscina ");

    if (startsNewBlock && current.length > 0) {
      pushCurrent();
    }

    current.push(line);
  }

  if (current.length > 0) {
    pushCurrent();
  }

  return blocks.filter((block) => block.split("\n").length >= 2);
}

function splitParagraphBlocks(text: string) {
  return normalizeBlock(text)
    .split(/\n\s*\n/)
    .map((block) => normalizeBlock(block))
    .filter(Boolean);
}

function chooseBlocks(extracted: ExtractedFileContent) {
  const delimited = splitDelimitedBlocks(extracted.text);
  if (delimited.length > 0) return delimited;

  const repeatedFieldBlocks = splitRepeatedFieldBlocks(extracted.text);
  if (repeatedFieldBlocks.length > 1) return repeatedFieldBlocks;

  const numbered = splitNumberedBlocks(extracted.text);
  if (numbered.length > 1) return numbered;

  const paragraphs = splitParagraphBlocks(extracted.text).filter(
    (block) => normalizeLoose(block).length >= 20
  );
  if (paragraphs.length > 1) return paragraphs;

  return [normalizeBlock(extracted.text)].filter(Boolean);
}

function parseFieldLines(block: string) {
  const lines = block
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean);

  const fieldMap: Record<string, string> = {};
  const plainLines: string[] = [];

  for (const line of lines) {
    const inlinePairs = extractInlineFieldPairs(line);

    if (Object.keys(inlinePairs).length > 0) {
      for (const [key, value] of Object.entries(inlinePairs)) {
        if (!fieldMap[key]) {
          fieldMap[key] = value;
        } else if (!normalizeLoose(fieldMap[key]).includes(normalizeLoose(value))) {
          fieldMap[key] = `${fieldMap[key]}\n${value}`;
        }
      }

      const residual = normalizeBlock(
        line.replace(
          new RegExp(
            `(?:^|\\s|\\|)(?:${INLINE_FIELD_PATTERN})\\s*:\\s*[\\s\\S]*?(?=(?:\\s|\\||$)(?:${INLINE_FIELD_PATTERN})\\s*:|$)`,
            "gi"
          ),
          " "
        )
      );

      if (residual && normalizeLoose(residual).length >= 6) {
        plainLines.push(residual.replace(/^\d+[\)\.\-]\s+/, "").trim());
      }

      continue;
    }

    const match = line.match(/^([^:]{2,120}):\s*(.+)$/);
    if (match) {
      const key = titleCaseLabel(match[1]);
      const value = cleanText(match[2]);
      if (!key || !value) continue;

      if (!fieldMap[key]) {
        fieldMap[key] = value;
      } else if (!normalizeLoose(fieldMap[key]).includes(normalizeLoose(value))) {
        fieldMap[key] = `${fieldMap[key]}\n${value}`;
      }
      continue;
    }

    plainLines.push(line.replace(/^\d+[\)\.\-]\s+/, "").trim());
  }

  const blockPairs = extractInlineFieldPairs(block);
  for (const [key, value] of Object.entries(blockPairs)) {
    if (!fieldMap[key]) {
      fieldMap[key] = value;
    } else if (!normalizeLoose(fieldMap[key]).includes(normalizeLoose(value))) {
      fieldMap[key] = `${fieldMap[key]}\n${value}`;
    }
  }

  return { fieldMap, plainLines };
}

function chooseTitle(
  fieldMap: Record<string, string>,
  plainLines: string[],
  fileName: string,
  index: number
) {
  const candidateKeys = [
    "nome",
    "nome do item",
    "titulo",
    "título",
    "produto",
    "item",
    "modelo",
    "product name",
    "nome comercial",
  ];

  for (const key of candidateKeys) {
    if (fieldMap[key]) return fieldMap[key];
  }

  const firstLongPlainLine = plainLines.find((line) => line.length >= 3 && line.length <= 180);
  if (firstLongPlainLine) return firstLongPlainLine;

  return `${fileName} • item ${index + 1}`;
}

function chooseDescription(
  fieldMap: Record<string, string>,
  plainLines: string[],
  title: string
) {
  const candidateKeys = [
    "descricao",
    "descrição",
    "descricao detalhada",
    "descrição detalhada",
    "observacao",
    "observação",
    "notas",
    "notes",
    "indicacao",
    "indicação",
    "descrição comercial",
    "descricao comercial",
  ];

  const normalizedTitle = normalizeLoose(title);
  const blockedDescriptionPrefixes = [
    "nome",
    "nome do produto",
    "produto",
    "item",
    "modelo",
    "sku",
    "categoria",
    "quantidade atual",
    "controlar estoque",
    "estoque minimo",
    "estoque máximo",
    "estoque maximo",
    "estoque inicial",
    "preço",
    "preco",
    "preço custo",
    "preco custo",
  ];

  const dedupeSet = new Set<string>();
  const lines: string[] = [];

  const tryPush = (value: string) => {
    const cleaned = cleanText(value);
    const normalized = normalizeLoose(cleaned);
    if (!cleaned || !normalized) return;
    if (normalized === normalizedTitle) return;
    if (looksLikeGuideOrNoiseBlock(cleaned)) return;
    if (blockedDescriptionPrefixes.some((prefix) => normalized.startsWith(normalizeLoose(prefix)))) return;
    if (dedupeSet.has(normalized)) return;
    dedupeSet.add(normalized);
    lines.push(cleaned);
  };

  candidateKeys
    .map((key) => fieldMap[key])
    .filter(Boolean)
    .forEach((value) => String(value).split("\n").forEach(tryPush));

  plainLines.forEach(tryPush);

  return lines.join("\n").trim();
}

function enrichFieldMapWithLooseExtraction(
  fieldMap: Record<string, string>,
  sourceText: string
) {
  if (!fieldMap["preco"] && !fieldMap["preço"]) {
    const loosePrice = extractLoosePrice(sourceText);
    if (loosePrice) fieldMap["preço"] = loosePrice;
  }

  if (!fieldMap["medidas"] && !fieldMap["dimensoes"] && !fieldMap["dimensões"]) {
    const looseDimensions = extractLooseDimensions(sourceText);
    if (looseDimensions) fieldMap["medidas"] = looseDimensions;
  }

  if (!fieldMap["profundidade"]) {
    const looseDepth = extractLooseDepth(sourceText);
    if (looseDepth) fieldMap["profundidade"] = looseDepth;
  }

  if (!fieldMap["capacidade"]) {
    const looseCapacity = extractLooseCapacity(sourceText);
    if (looseCapacity) fieldMap["capacidade"] = looseCapacity;
  }

  if (!fieldMap["material"]) {
    const looseMaterial = extractLooseMaterial(sourceText);
    if (looseMaterial) fieldMap["material"] = looseMaterial;
  }

  if (!fieldMap["formato"]) {
    const looseShape = extractLooseShape(sourceText);
    if (looseShape) fieldMap["formato"] = looseShape;
  }

  if (!fieldMap["marca"]) {
    const looseBrand = extractLooseBrand(sourceText);
    if (looseBrand) fieldMap["marca"] = looseBrand;
  }

  if (!fieldMap["sku"] && !fieldMap["codigo"] && !fieldMap["código"]) {
    const looseSku = extractLooseSku(sourceText);
    if (looseSku) fieldMap["sku"] = looseSku;
  }

  if (!fieldMap["peso"]) {
    const looseWeight = extractLooseWeight(sourceText);
    if (looseWeight) fieldMap["peso"] = looseWeight;
  }

  if (!fieldMap["dosagem"]) {
    const looseDosage = extractLooseDosage(sourceText);
    if (looseDosage) fieldMap["dosagem"] = looseDosage;
  }

  if (!fieldMap["cor"]) {
    const looseColor = extractLooseColor(sourceText);
    if (looseColor) fieldMap["cor"] = looseColor;
  }
}

function parseSingleBlock(
  block: string,
  fileName: string,
  index: number
): StructuredImportItem | null {
  const normalizedBlock = normalizeBlock(block);
  if (!normalizedBlock) return null;

  const { fieldMap, plainLines } = parseFieldLines(normalizedBlock);
  enrichFieldMapWithLooseExtraction(fieldMap, normalizedBlock);

  const title = chooseTitle(fieldMap, plainLines, fileName, index);
  const description = chooseDescription(fieldMap, plainLines, title);
  const resolvedSku = fieldMap["sku"] || fieldMap["codigo"] || fieldMap["código"] || "";

  const sourceText = [title, description, normalizedBlock, resolvedSku].filter(Boolean).join("\n");
  const destination = inferDestination(sourceText, resolvedSku);
  const stockLikeBlock = rawBlockLooksLikeStockSummary(normalizedBlock);

  const item: StructuredImportItem = {
    sourceFileName: fileName,
    destination,
    categoria: destination === "pool" ? "pool" : destination,
    title,
    description,
    rawBlock: normalizedBlock,
    confidence: destination === "outros" ? (stockLikeBlock ? 0.44 : 0.62) : stockLikeBlock ? 0.58 : 0.88,
    price: fieldMap["preço"] || fieldMap["preco"] || fieldMap["faixa de preco"] || fieldMap["faixa de preço"] || "",
    dimensions: fieldMap["medidas"] || fieldMap["dimensoes"] || fieldMap["dimensões"] || fieldMap["tamanho"] || "",
    depth: fieldMap["profundidade"] || "",
    capacity: fieldMap["capacidade"] || "",
    material: fieldMap["material"] || "",
    shape: fieldMap["formato"] || "",
    brand: fieldMap["marca"] || "",
    sku: resolvedSku,
    weight: fieldMap["peso"] || "",
    dosage: fieldMap["dosagem"] || "",
    color: fieldMap["cor"] || "",
    usage: fieldMap["uso"] || "",
    notes: fieldMap["observacao"] || fieldMap["observação"] || fieldMap["notas"] || "",
    indication: fieldMap["indicacao"] || fieldMap["indicação"] || "",
    composition: fieldMap["composicao"] || fieldMap["composição"] || "",
    embalagem: fieldMap["embalagem"] || "",
    packaging: fieldMap["packaging"] || "",
    model: fieldMap["modelo"] || "",
    size: fieldMap["tamanho"] || "",
    compatibility: fieldMap["compatibilidade"] || "",
    function: fieldMap["funcao"] || fieldMap["função"] || fieldMap["finalidade"] || "",
    environment: fieldMap["ambiente"] || fieldMap["ambiente indicado"] || "",
    diferencial: fieldMap["diferencial"] || "",
    application: fieldMap["aplicacao"] || fieldMap["aplicação"] || "",
  };

  if (!normalizeLoose(item.title)) return null;
  return item;
}

function isProbablyGenericTitle(title: string) {
  const normalized = normalizeLoose(title);
  if (!normalized) return true;

  const blocked = [
    "catalogo de teste",
    "catálogo de teste",
    "arquivo de teste",
    "nome do item",
    "descricao detalhada",
    "descrição detalhada",
    "item importado",
  ];

  return blocked.some(
    (value) =>
      normalized === normalizeLoose(value) ||
      normalized.startsWith(normalizeLoose(value))
  );
}

function looksLikeMultiItemSource(extractedText: string, blockCount: number) {
  const normalized = normalizeLoose(extractedText);

  if (blockCount > 1) return true;
  if (normalizeBlock(extractedText).includes("=== ITEM")) return true;
  if (/^\d+[\).\-]\s+/m.test(normalizeBlock(extractedText))) return true;

  const repeatedHints = [
    "nome do item",
    "preço",
    "preco",
    "medidas",
    "profundidade",
    "capacidade",
    "descrição detalhada",
    "descricao detalhada",
  ];

  let hintCount = 0;
  for (const hint of repeatedHints) {
    const regex = new RegExp(normalizeLoose(hint), "g");
    const matches = normalized.match(regex);
    hintCount += matches ? matches.length : 0;
  }

  return hintCount >= 6;
}

function hasUsefulContent(item: StructuredImportItem) {
  return (
    item.description.length >= 10 ||
    Boolean(item.price) ||
    Boolean(item.dimensions) ||
    Boolean(item.capacity) ||
    Boolean(item.material) ||
    Boolean(item.embalagem) ||
    Boolean(item.application) ||
    Boolean(item.dosage)
  );
}

function itemRichnessScore(item: StructuredImportItem) {
  return (
    Math.min(item.description.length, 800) +
    (item.price ? 140 : 0) +
    (item.dosage ? 80 : 0) +
    (item.application ? 70 : 0) +
    (item.embalagem ? 70 : 0) +
    (item.weight ? 40 : 0) +
    (item.capacity ? 40 : 0) +
    (item.dimensions ? 40 : 0) +
    (item.material ? 30 : 0) +
    (item.brand ? 20 : 0) +
    (rawBlockLooksLikeStockSummary(item.rawBlock) ? -180 : 0) +
    (looksLikeGuideOrNoiseBlock(item.rawBlock) ? -500 : 0)
  );
}

function itemIdentityKey(item: StructuredImportItem) {
  if (isChemicalSku(item.sku)) {
    return `sku:${cleanText(item.sku).toUpperCase()}`;
  }

  const normalizedTitle = normalizeLoose(item.title);
  if (normalizedTitle) {
    return `${item.destination}:${normalizedTitle}`;
  }

  return `${item.sourceFileName}:${normalizeLoose(item.rawBlock).slice(0, 120)}`;
}

function choosePreferredValue(
  currentValue: string | undefined,
  nextValue: string | undefined,
  currentOwner: StructuredImportItem,
  nextOwner: StructuredImportItem
) {
  const current = cleanText(currentValue || "");
  const next = cleanText(nextValue || "");

  if (!current) return next;
  if (!next) return current;
  if (current === next) return current;

  const currentScore = current.length - (rawBlockLooksLikeStockSummary(currentOwner.rawBlock) ? 40 : 0) - (looksLikeGuideOrNoiseBlock(currentOwner.rawBlock) ? 100 : 0);
  const nextScore = next.length - (rawBlockLooksLikeStockSummary(nextOwner.rawBlock) ? 40 : 0) - (looksLikeGuideOrNoiseBlock(nextOwner.rawBlock) ? 100 : 0);

  return nextScore > currentScore ? next : current;
}

function mergeDescriptions(currentItem: StructuredImportItem, nextItem: StructuredImportItem) {
  const lines = [...String(currentItem.description || "").split("\n"), ...String(nextItem.description || "").split("\n")];
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const cleaned = cleanText(rawLine);
    const normalized = normalizeLoose(cleaned);
    if (!cleaned || !normalized) continue;
    if (seen.has(normalized)) continue;
    if (looksLikeGuideOrNoiseBlock(cleaned)) continue;
    if (normalized.startsWith("quantidade atual")) continue;
    if (normalized.startsWith("controlar estoque")) continue;
    if (normalized.startsWith("estoque minimo")) continue;
    if (normalized.startsWith("estoque maximo")) continue;
    seen.add(normalized);
    deduped.push(cleaned);
  }

  return deduped.join("\n").trim();
}

function mergeStructuredImportItems(items: StructuredImportItem[]) {
  const mergedMap = new Map<string, StructuredImportItem>();

  for (const item of items) {
    const key = itemIdentityKey(item);
    const current = mergedMap.get(key);

    if (!current) {
      mergedMap.set(key, item);
      continue;
    }

    const preferredShell = itemRichnessScore(item) > itemRichnessScore(current) ? item : current;
    const secondary = preferredShell === item ? current : item;

    const merged: StructuredImportItem = {
      ...preferredShell,
      title: choosePreferredValue(current.title, item.title, current, item) || preferredShell.title,
      description: mergeDescriptions(current, item),
      rawBlock: [current.rawBlock, item.rawBlock]
        .filter(Boolean)
        .filter((value, index, array) => array.indexOf(value) === index)
        .join("\n\n"),
      confidence: Math.max(current.confidence, item.confidence),
      categoria: preferredShell.categoria,
      destination: preferredShell.destination !== "outros" ? preferredShell.destination : secondary.destination,
      price: choosePreferredValue(current.price, item.price, current, item),
      dimensions: choosePreferredValue(current.dimensions, item.dimensions, current, item),
      depth: choosePreferredValue(current.depth, item.depth, current, item),
      capacity: choosePreferredValue(current.capacity, item.capacity, current, item),
      material: choosePreferredValue(current.material, item.material, current, item),
      shape: choosePreferredValue(current.shape, item.shape, current, item),
      brand: choosePreferredValue(current.brand, item.brand, current, item),
      sku: choosePreferredValue(current.sku, item.sku, current, item),
      weight: choosePreferredValue(current.weight, item.weight, current, item),
      dosage: choosePreferredValue(current.dosage, item.dosage, current, item),
      color: choosePreferredValue(current.color, item.color, current, item),
      usage: choosePreferredValue(current.usage, item.usage, current, item),
      notes: choosePreferredValue(current.notes, item.notes, current, item),
      indication: choosePreferredValue(current.indication, item.indication, current, item),
      composition: choosePreferredValue(current.composition, item.composition, current, item),
      embalagem: choosePreferredValue(current.embalagem, item.embalagem, current, item),
      packaging: choosePreferredValue(current.packaging, item.packaging, current, item),
      model: choosePreferredValue(current.model, item.model, current, item),
      size: choosePreferredValue(current.size, item.size, current, item),
      compatibility: choosePreferredValue(current.compatibility, item.compatibility, current, item),
      function: choosePreferredValue(current.function, item.function, current, item),
      environment: choosePreferredValue(current.environment, item.environment, current, item),
      diferencial: choosePreferredValue(current.diferencial, item.diferencial, current, item),
      application: choosePreferredValue(current.application, item.application, current, item),
    };

    mergedMap.set(key, merged);
  }

  return Array.from(mergedMap.values());
}

export function parseStructuredImportItems(extracted: ExtractedFileContent): StructuredImportItem[] {
  const blocks = chooseBlocks(extracted);
  debugIntelligentImport("parser-blocks", {
    fileName: extracted.fileName,
    blockCount: blocks.length,
    firstBlocks: blocks.slice(0, 5).map((block, index) => ({
      index,
      preview: block.slice(0, 180),
    })),
  });

  const items: StructuredImportItem[] = [];

  blocks.forEach((block, index) => {
    if (looksLikeGuideOrNoiseBlock(block)) {
      debugIntelligentImport("parser-null-item", {
        fileName: extracted.fileName,
        blockIndex: index,
        reason: "guide-or-noise-block",
        preview: block.slice(0, 180),
      });
      return;
    }

    const parsed = parseSingleBlock(block, extracted.fileName, index);
    if (parsed) {
      items.push(parsed);
    } else {
      debugIntelligentImport("parser-null-item", {
        fileName: extracted.fileName,
        blockIndex: index,
        preview: block.slice(0, 180),
      });
    }
  });

  if (items.length === 0) {
    debugIntelligentImport("parser-summary", {
      fileName: extracted.fileName,
      totalItems: 0,
      keptItems: 0,
    });
    return [];
  }

  const mergedItems = mergeStructuredImportItems(items);
  const qualitySorted = [...mergedItems].sort((a, b) => itemRichnessScore(b) - itemRichnessScore(a));

  debugIntelligentImport("parser-quality-sorted", {
    fileName: extracted.fileName,
    items: qualitySorted.slice(0, 20).map((item, index) => ({
      index,
      title: item.title,
      sku: item.sku,
      destination: item.destination,
      richness: itemRichnessScore(item),
    })),
  });

  const sourceLooksSingleItem =
    !looksLikeMultiItemSource(extracted.text, mergedItems.length) &&
    (mergedItems.length === 1 ||
      normalizeLoose(extracted.text).includes("nome do item") ||
      normalizeLoose(extracted.text).includes("descricao detalhada") ||
      normalizeLoose(extracted.text).includes("preco sugerido") ||
      normalizeLoose(extracted.text).includes("preço sugerido"));

  if (sourceLooksSingleItem) {
    const kept = qualitySorted[0] ? [qualitySorted[0]] : [];
    debugIntelligentImport("parser-summary", {
      fileName: extracted.fileName,
      sourceLooksSingleItem,
      totalItems: items.length,
      mergedItems: mergedItems.length,
      keptItems: kept.length,
      kept: kept.map((item) => ({
        title: item.title,
        sku: item.sku,
        destination: item.destination,
      })),
    });
    return kept;
  }

  const keptItems = mergedItems.filter((item) => {
    if (looksLikeGuideOrNoiseBlock(item.rawBlock)) {
      debugIntelligentImport("parser-filtered-out", {
        reason: "guide-or-noise-block",
        fileName: extracted.fileName,
        title: item.title,
        sku: item.sku,
        destination: item.destination,
      });
      return false;
    }

    if (isChemicalSku(item.sku)) {
      return true;
    }

    if (isProbablyGenericTitle(item.title)) {
      debugIntelligentImport("parser-filtered-out", {
        reason: "generic-title",
        fileName: extracted.fileName,
        title: item.title,
        sku: item.sku,
        destination: item.destination,
      });
      return false;
    }

    if (!hasUsefulContent(item)) {
      debugIntelligentImport("parser-filtered-out", {
        reason: "not-useful-enough",
        fileName: extracted.fileName,
        title: item.title,
        sku: item.sku,
        destination: item.destination,
      });
      return false;
    }

    return true;
  });

  debugIntelligentImport("parser-summary", {
    fileName: extracted.fileName,
    sourceLooksSingleItem,
    totalItems: items.length,
    mergedItems: mergedItems.length,
    keptItems: keptItems.length,
    kept: keptItems.slice(0, 120).map((item, index) => ({
      index,
      title: item.title,
      sku: item.sku,
      destination: item.destination,
      richness: itemRichnessScore(item),
    })),
  });

  return keptItems;
}
