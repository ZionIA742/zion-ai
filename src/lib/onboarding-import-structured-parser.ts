
import type { ExtractedFileContent } from "./server/onboarding-file-extractors";

export type StructuredImportDestination = "pool" | "quimicos" | "acessorios" | "outros";

export type StructuredImportItem = {
  destination: StructuredImportDestination;
  title: string;
  description: string;
  rawBlock: string;
  categoryHint?: string;
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
  sourceFileName: string;
};

const NOISE_TITLE_PATTERNS = [
  /^descri[cç][aã]o detalhada$/i,
  /^cat[aá]logo de teste/i,
  /^regra comercial/i,
  /^campo valor$/i,
  /^nome do item$/i,
  /^imagem ilustrativa/i,
];

const BOILERPLATE_PATTERNS = [
  /categoria esperada no sistema:.*?(?=$|(?:pre[cç]o|material|cor|uso|indica[cç][aã]o|aplica[cç][aã]o|observa[cç][aã]o))/gi,
  /arquivo de teste.*?(?=$|(?:pre[cç]o|material|cor|uso|indica[cç][aã]o|aplica[cç][aã]o|observa[cç][aã]o))/gi,
  /objetivo validar.*?(?=$|(?:pre[cç]o|material|cor|uso|indica[cç][aã]o|aplica[cç][aã]o|observa[cç][aã]o))/gi,
  /salvar em configura[cç][oõ]es.*?(?=$|(?:pre[cç]o|material|cor|uso|indica[cç][aã]o|aplica[cç][aã]o|observa[cç][aã]o))/gi,
  /campo valor/gi,
  /imagem ilustrativa de alta qualidade para teste/gi,
  /documento criado para validar.*$/gi,
  /arquivo de teste com .*$/gi,
];

function normalizeLoose(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.:,\-/%x]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function collapseText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isNoiseTitle(title: string) {
  const cleaned = cleanLine(title);
  return NOISE_TITLE_PATTERNS.some((pattern) => pattern.test(cleaned));
}

function removeBoilerplate(value: string) {
  let next = value;
  for (const pattern of BOILERPLATE_PATTERNS) {
    next = next.replace(pattern, " ");
  }
  return collapseText(next);
}

function extractFirst(patterns: RegExp[], source: string) {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return cleanLine(match[1]);
  }
  return "";
}

function extractPrice(source: string) {
  return extractFirst(
    [
      /pre[cç]o(?: sugerido| estimado| aproximado)?\s*(?:r\$)?\s*[:\-]?\s*(r\$\s*\d[\d\.\,]*)/i,
      /(r\$\s*\d[\d\.\,]*)/i,
    ],
    source
  );
}

function extractDimensions(source: string) {
  return extractFirst(
    [
      /(?:medidas?|tamanho)\s*[:\-]?\s*([0-9\.,]+\s*m?\s*x\s*[0-9\.,]+\s*m?)/i,
      /([0-9\.,]+\s*m?\s*x\s*[0-9\.,]+\s*m)/i,
    ],
    source
  );
}

function extractDepth(source: string) {
  return extractFirst(
    [
      /profundidade\s*[:\-]?\s*([0-9\.,]+\s*m)/i,
      /prof\.?\s*[:\-]?\s*([0-9\.,]+\s*m)/i,
    ],
    source
  );
}

function extractCapacity(source: string) {
  return extractFirst(
    [
      /capacidade(?: estimada| m[aá]xima| aproximada)?\s*[:\-]?\s*([0-9\.\,]+\s*(?:l|litros))/i,
      /([0-9\.\,]+\s*(?:l|litros))/i,
    ],
    source
  );
}

function extractField(source: string, names: string[]) {
  const patterns = names.map(
    (name) =>
      new RegExp(`${name}\\s*[:\\-]?\\s*([^\\n]+)`, "i")
  );
  return extractFirst(patterns, source);
}

function inferDestination(source: string, fileName: string): StructuredImportDestination {
  const text = normalizeLoose(`${fileName} ${source}`);

  const chemicalScore =
    (text.includes("quimico") ? 4 : 0) +
    (text.includes("cloro") ? 5 : 0) +
    (text.includes("algicida") ? 4 : 0) +
    (text.includes("ph") ? 2 : 0) +
    (text.includes("barrilha") ? 4 : 0) +
    (text.includes("clarificante") ? 4 : 0) +
    (text.includes("sulfato") ? 4 : 0) +
    (text.includes("dosagem") ? 3 : 0);

  const accessoryScore =
    (text.includes("acessorio") ? 4 : 0) +
    (text.includes("peneira") ? 5 : 0) +
    (text.includes("escova") ? 5 : 0) +
    (text.includes("aspirador") ? 5 : 0) +
    (text.includes("clorador") ? 4 : 0) +
    (text.includes("refletor") ? 4 : 0) +
    (text.includes("led") ? 3 : 0) +
    (text.includes("cabo telescopico") ? 3 : 0) +
    (text.includes("dispositivo") ? 3 : 0) +
    (text.includes("nicho") ? 3 : 0);

  const poolScore =
    (text.includes("piscina") ? 4 : 0) +
    (text.includes("fibra") ? 3 : 0) +
    (text.includes("vinil") ? 3 : 0) +
    (text.includes("alvenaria") ? 3 : 0) +
    (text.includes("profundidade") ? 2 : 0) +
    (text.includes("capacidade") ? 2 : 0) +
    (/\b\d+[.,]?\d*\s*x\s*\d+[.,]?\d*\s*m\b/i.test(text) ? 3 : 0);

  if (chemicalScore >= accessoryScore && chemicalScore >= poolScore && chemicalScore >= 4) {
    return "quimicos";
  }

  if (accessoryScore >= chemicalScore && accessoryScore >= poolScore && accessoryScore >= 4) {
    return "acessorios";
  }

  if (poolScore > accessoryScore && poolScore >= chemicalScore && poolScore >= 6) {
    return "pool";
  }

  return "outros";
}

function buildTitleFromBlock(block: string) {
  const lines = collapseText(block).split("\n").map(cleanLine).filter(Boolean);
  for (const line of lines) {
    if (
      isNoiseTitle(line) ||
      /^arquivo de origem$/i.test(line) ||
      /^categoria$/i.test(line) ||
      /^pre[cç]o$/i.test(line)
    ) {
      continue;
    }
    return line;
  }
  return "";
}

function splitNumberedBlocks(text: string) {
  const compact = collapseText(text);
  const regex = /(?:^|\n)\s*(\d+)\.\s+/g;
  const matches = Array.from(compact.matchAll(regex));

  if (matches.length < 2) return [];

  const blocks: string[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? compact.length : compact.length;
    const block = compact.slice(start, end).replace(/^\s*\d+\.\s*/, "").trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

function splitParagraphBlocks(text: string) {
  return collapseText(text)
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function looksLikeItemBlock(block: string) {
  const text = normalizeLoose(block);
  if (text.length < 20) return false;
  if (isNoiseTitle(buildTitleFromBlock(block))) return false;

  const score =
    (text.includes("preco") ? 1 : 0) +
    (text.includes("material") ? 1 : 0) +
    (text.includes("categoria") ? 1 : 0) +
    (text.includes("indicacao") ? 1 : 0) +
    (text.includes("aplicacao") ? 1 : 0) +
    (text.includes("descricao") ? 1 : 0) +
    (text.includes("capacidade") ? 1 : 0) +
    (text.includes("profundidade") ? 1 : 0) +
    (text.includes("medidas") ? 1 : 0);

  return score >= 1;
}

function buildStructuredItem(block: string, extracted: ExtractedFileContent): StructuredImportItem | null {
  const title = buildTitleFromBlock(block);
  if (!title || isNoiseTitle(title)) return null;

  const cleanedBlock = removeBoilerplate(block);
  const destination = inferDestination(cleanedBlock, extracted.fileName);

  const description = collapseText(
    cleanedBlock
      .replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
      .replace(/\b(?:categoria|pre[cç]o|material|cor|uso|indica[cç][aã]o|aplica[cç][aã]o|observa[cç][aã]o|dosagem|peso|marca|arquivo de origem)\b\s*:/gi, (m) => `\n${m}`)
  );

  const item: StructuredImportItem = {
    destination,
    title: cleanLine(title),
    description: description || cleanedBlock,
    rawBlock: collapseText(block),
    sourceFileName: extracted.fileName,
    categoryHint: extractField(cleanedBlock, ["categoria"]),
    price: extractPrice(cleanedBlock),
    dimensions: extractDimensions(cleanedBlock),
    depth: extractDepth(cleanedBlock),
    capacity: extractCapacity(cleanedBlock),
    material: extractField(cleanedBlock, ["material"]),
    shape: extractField(cleanedBlock, ["formato", "shape"]),
    brand: extractField(cleanedBlock, ["marca"]),
    sku: extractField(cleanedBlock, ["sku", "c[oó]digo"]),
    weight: extractField(cleanedBlock, ["peso"]),
    dosage: extractField(cleanedBlock, ["dosagem"]),
    color: extractField(cleanedBlock, ["cor"]),
    usage: extractField(cleanedBlock, ["indica[cç][aã]o", "uso", "aplica[cç][aã]o"]),
    notes: extractField(cleanedBlock, ["observa[cç][aã]o", "observacoes", "observações"]),
  };

  return item;
}

export function parseStructuredImportItems(extracted: ExtractedFileContent): StructuredImportItem[] {
  const numberedBlocks = splitNumberedBlocks(extracted.text);
  const paragraphBlocks = splitParagraphBlocks(extracted.text);
  const candidateBlocks = numberedBlocks.length > 0 ? numberedBlocks : paragraphBlocks;

  const uniqueBlocks = Array.from(new Set(candidateBlocks.map((block) => collapseText(block)))).filter(looksLikeItemBlock);

  const items = uniqueBlocks
    .map((block) => buildStructuredItem(block, extracted))
    .filter((item): item is StructuredImportItem => Boolean(item));

  return items.filter((item) => {
    if (!item.title || isNoiseTitle(item.title)) return false;
    const text = normalizeLoose(`${item.title} ${item.description}`);
    if (text.includes("catalogo de teste") && text.split(" ").length < 8) return false;
    if (text in {"descricao detalhada":1, "campo valor":1} ) return false;
    return true;
  });
}
