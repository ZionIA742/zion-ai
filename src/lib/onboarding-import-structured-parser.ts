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
  sku?: string;
  sourceFileName: string;
};

const CHEMICAL_KEYWORDS = [
  "cloro",
  "algicida",
  "clarificante",
  "sulfato",
  "barrilha",
  "ph",
  "elevador",
  "redutor",
  "decantador",
  "tratamento",
];

const ACCESSORY_KEYWORDS = [
  "peneira",
  "escova",
  "aspirador",
  "clorador",
  "refletor",
  "led",
  "mangueira",
  "cabo telescópico",
  "nicho",
  "retorno",
  "hidromassagem",
  "dispositivo",
  "tampa",
  "caixa de passagem",
];

const OTHER_KEYWORDS = [
  "ombrelone",
  "mesa",
  "cadeira",
  "capa",
  "deck",
  "móvel",
  "decoração",
];

function normalizeLoose(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s:.,/%x()-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value: string) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function lines(value: string) {
  return cleanText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractNamedField(block: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = block.match(new RegExp(`${escaped}\\s*[:|-]\\s*([^\\n]+)`, "iu"));
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function inferCategoryFromText(text: string): StructuredImportDestination {
  const lower = normalizeLoose(text);

  const poolScore =
    (lower.includes("piscina") ? 6 : 0) +
    (/\b\d+[.,]?\d*\s*x\s*\d+[.,]?\d*\s*m\b/i.test(lower) ? 4 : 0) +
    (/\b\d+[.,]?\d*\s*m\s*diam/i.test(lower) ? 4 : 0) +
    (lower.includes("profundidade") ? 3 : 0) +
    (lower.includes("capacidade") ? 3 : 0) +
    (lower.includes("litros") ? 2 : 0) +
    (lower.includes("fibra") ? 2 : 0) +
    (lower.includes("vinil") ? 2 : 0) +
    (lower.includes("alvenaria") ? 2 : 0);

  const chemicalScore = CHEMICAL_KEYWORDS.reduce(
    (score, keyword) => score + (lower.includes(keyword) ? 3 : 0),
    0
  );

  const accessoryScore = ACCESSORY_KEYWORDS.reduce(
    (score, keyword) => score + (lower.includes(keyword) ? 3 : 0),
    0
  );

  const otherScore = OTHER_KEYWORDS.reduce(
    (score, keyword) => score + (lower.includes(keyword) ? 2 : 0),
    0
  );

  const explicitCategory = extractNamedField(text, ["Categoria", "Categoria esperada", "Categoria prevista"]);
  const explicitNormalized = normalizeLoose(explicitCategory);
  if (explicitNormalized.includes("quim")) return "quimicos";
  if (explicitNormalized.includes("acessor")) return "acessorios";
  if (explicitNormalized.includes("outro")) return "outros";
  if (explicitNormalized.includes("piscina")) return "pool";

  if (poolScore >= 8 && poolScore >= chemicalScore && poolScore >= accessoryScore) return "pool";
  if (chemicalScore >= 3 && chemicalScore >= accessoryScore) return "quimicos";
  if (accessoryScore >= 3) return "acessorios";
  if (otherScore >= 2) return "outros";

  return "outros";
}

function sanitizeTitle(value: string) {
  return value
    .replace(/^(piscina|produto|item|catalogo|cat[aá]logo)\s*[:\-]\s*/i, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}

function extractPrice(text: string) {
  const match =
    text.match(/r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[.,]?\d*)/i) ||
    text.match(/pre[cç]o(?:\s+estimado|\s+aproximado)?\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[.,]?\d*)/i);
  return match?.[1]?.trim() || "";
}

function extractDimensions(text: string) {
  const rectangular = text.match(/(\d+[.,]?\d*)\s*x\s*(\d+[.,]?\d*)\s*m/i);
  if (rectangular) return `${rectangular[1]} x ${rectangular[2]} m`;

  const diam = text.match(/(\d+[.,]?\d*)\s*m\s*di[âa]m/i);
  if (diam) return `${diam[1]} m diâm.`;

  return extractNamedField(text, ["Medidas", "Tamanho", "Dimensões", "Dimensoes"]);
}

function extractDepth(text: string) {
  const match =
    text.match(/profundidade(?:\s+estimada)?\s*[:\-]?\s*([^,\n]+)/i) ||
    text.match(/\bprof\.?\s*[:\-]?\s*([^,\n]+)/i);
  return match?.[1]?.trim() || "";
}

function extractCapacity(text: string) {
  const match =
    text.match(/capacidade(?:\s+estimada)?\s*[:\-]?\s*([^,\n]+)/i) ||
    text.match(/(\d{1,3}(?:\.\d{3})+|\d+[.,]?\d*)\s*(?:l|litros?)\b/i);
  return match?.[1]?.trim() || "";
}

function extractMaterial(text: string) {
  const explicit = extractNamedField(text, ["Material"]);
  if (explicit) return explicit;
  const lower = normalizeLoose(text);
  if (lower.includes("fibra")) return "fibra";
  if (lower.includes("vinil")) return "vinil";
  if (lower.includes("alvenaria")) return "alvenaria";
  if (lower.includes("pastilha")) return "pastilha";
  return "";
}

function extractShape(text: string) {
  const explicit = extractNamedField(text, ["Formato"]);
  if (explicit) return explicit;
  const lower = normalizeLoose(text);
  if (lower.includes("retangular")) return "retangular";
  if (lower.includes("oval")) return "oval";
  if (lower.includes("redonda") || lower.includes("diam")) return "redonda";
  if (lower.includes("raia")) return "raia";
  return "";
}

function extractDescription(block: string, title: string) {
  const blockLines = lines(block);
  const filtered = blockLines.filter((line, index) => {
    if (index === 0 && sanitizeTitle(line) === title) return false;
    return !/^(categoria|pre[cç]o|valor|medidas|profundidade|capacidade|material|formato|sku|c[oó]digo)\s*[:\-]/i.test(line);
  });
  return filtered.join("\n").trim();
}

function buildItem(block: string, sourceFileName: string): StructuredImportItem | null {
  const blockLines = lines(block);
  if (blockLines.length === 0) return null;

  const destination = inferCategoryFromText(block);
  const explicitName =
    extractNamedField(block, ["Nome do item", "Produto", "Item", "Modelo", "Nome"]) || sanitizeTitle(blockLines[0]);

  const title = sanitizeTitle(explicitName) || "Item importado";
  const description = extractDescription(block, title);
  const categoryHint =
    extractNamedField(block, ["Categoria", "Categoria esperada", "Categoria prevista"]) ||
    destination;

  return {
    destination,
    title,
    description,
    rawBlock: cleanText(block),
    categoryHint,
    price: extractPrice(block),
    dimensions: extractDimensions(block),
    depth: extractDepth(block),
    capacity: extractCapacity(block),
    material: extractMaterial(block),
    shape: extractShape(block),
    sku: extractNamedField(block, ["SKU", "Código", "Codigo"]),
    sourceFileName,
  };
}

function splitNumberedItems(text: string) {
  const normalized = cleanText(text);
  const matches = [...normalized.matchAll(/(?:^|\n)\s*(\d+)\.\s+/g)];
  if (matches.length < 2) return [];
  const chunks: string[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? normalized.length : normalized.length;
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function splitPoolBlocks(text: string) {
  const chunked = cleanText(text);
  const matches = [...chunked.matchAll(/(?:^|\n)(?:piscina|modelo)\s*[:\-]/gi)];
  if (matches.length < 2) return [];
  const chunks: string[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? chunked.length : chunked.length;
    const chunk = chunked.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function splitParagraphBlocks(text: string) {
  return cleanText(text)
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function shouldIgnoreBlock(block: string) {
  const lower = normalizeLoose(block);
  if (!lower) return true;
  if (lower.length < 12) return true;
  if (
    lower.startsWith("catalogo de teste") ||
    lower.startsWith("arquivo de teste") ||
    lower.startsWith("objetivo") ||
    lower === "descricao detalhada"
  ) {
    return true;
  }
  return false;
}

export function parseStructuredImportItems(extracted: ExtractedFileContent): StructuredImportItem[] {
  const text = cleanText(extracted.text);
  if (!text) return [];

  const candidates = [
    ...splitNumberedItems(text),
    ...splitPoolBlocks(text),
    ...splitParagraphBlocks(text),
  ];

  const uniqueBlocks: string[] = [];
  const seen = new Set<string>();
  for (const block of candidates) {
    const key = normalizeLoose(block);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueBlocks.push(block);
  }

  const items = uniqueBlocks
    .filter((block) => !shouldIgnoreBlock(block))
    .map((block) => buildItem(block, extracted.fileName))
    .filter((item): item is StructuredImportItem => Boolean(item))
    .filter((item) => {
      const normalizedTitle = normalizeLoose(item.title);
      const normalizedDescription = normalizeLoose(item.description);
      if (!normalizedTitle && !normalizedDescription) return false;
      if (normalizedTitle === "descricao detalhada") return false;
      if (
        item.destination !== "pool" &&
        normalizedTitle.startsWith("piscina ") &&
        CHEMICAL_KEYWORDS.some((keyword) => normalizeLoose(item.rawBlock).includes(keyword))
      ) {
        item.destination = "quimicos";
      }
      return true;
    });

  return items;
}
