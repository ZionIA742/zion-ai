import type { ExtractedFileContent } from "./server/onboarding-file-extractors";

export type StructuredImportDestination = "pool" | "quimicos" | "acessorios" | "outros";

export type StructuredImportItem = {
  sourceFileName: string;
  itemIndex: number;
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
};

const GENERIC_TITLES = [
  "catalogo de teste",
  "catálogo de teste",
  "descricao detalhada",
  "descrição detalhada",
  "nome do item",
  "regra comercial",
  "arquivo de teste",
  "item importado",
  "piscina",
  "catálogo",
  "catalogo",
  "campo valor",
  "campo informacao",
];

const TITLE_LABELS = [
  "nome do item",
  "nome comercial",
  "nome",
  "produto",
  "modelo",
  "titulo",
  "título",
  "item",
];

function normalizeLoose(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLine(value: string) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function normalizeBlock(value: string) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function isProbablyGenericTitle(value: string) {
  const normalized = normalizeLoose(value);
  if (!normalized) return true;
  if (GENERIC_TITLES.some((item) => normalized === normalizeLoose(item))) return true;
  return GENERIC_TITLES.some((item) => normalized.startsWith(normalizeLoose(item)));
}

function stripLeadingNoise(value: string) {
  return cleanLine(
    String(value || "")
      .replace(/^\d+[\).\-]\s+/, "")
      .replace(/^piscina\s*:\s*/i, "")
      .replace(/^produto\s*:\s*/i, "")
      .replace(/^nome do item\s*[:|-]?\s*/i, "")
      .replace(/^nome comercial\s*[:|-]?\s*/i, "")
      .replace(/^modelo\s*[:|-]?\s*/i, "")
  );
}

function stripBoilerplateLine(line: string) {
  const normalized = normalizeLoose(line);
  if (!normalized) return true;

  const blockedFragments = [
    "arquivo de teste",
    "validar upload inteligente",
    "classificacao e salvamento",
    "objetivo validar",
    "categoria esperada no sistema",
    "isso salva tudo no lugar certo",
    "salvar em configuracoes",
    "upload inteligente envia corretamente",
    "catalogo de teste",
    "imagem ilustrativa de alta qualidade para teste",
    "use este arquivo para testar",
    "nesta previa",
  ];

  return blockedFragments.some((item) => normalized.includes(item));
}

function splitNumberedBlocks(text: string) {
  const normalized = normalizeBlock(text);
  if (!normalized) return [] as string[];

  const lines = normalized.split("\n").map(cleanLine).filter(Boolean);
  const indexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\d+[\).\-]\s+/.test(line));

  if (indexes.length < 2) return [] as string[];

  const blocks: string[] = [];
  for (let i = 0; i < indexes.length; i += 1) {
    const start = indexes[i].index;
    const end = i + 1 < indexes.length ? indexes[i + 1].index : lines.length;
    const block = lines.slice(start, end).join("\n").trim();
    if (block) blocks.push(block);
  }

  return blocks;
}

function splitByKnownLabels(text: string) {
  const normalized = normalizeBlock(text);
  if (!normalized) return [] as string[];

  const pattern = /(?=^(?:nome do item|nome comercial|modelo|produto)\s*[:|])/gim;
  const blocks = normalized
    .split(pattern)
    .map(normalizeBlock)
    .filter(Boolean);

  return blocks.length > 1 ? blocks : [];
}

function splitParagraphBlocks(text: string) {
  return normalizeBlock(text)
    .split(/\n{2,}/)
    .map(normalizeBlock)
    .filter(Boolean);
}

function parseLabelValue(line: string) {
  const match = line.match(/^([^:|]{2,50})[:|]\s*(.+)$/);
  if (!match) return null;

  return {
    label: normalizeLoose(match[1]),
    value: cleanLine(match[2]),
  };
}

function extractLabeledValue(text: string, labels: string[]) {
  for (const label of labels) {
    const matcher = new RegExp(`${label}\\s*[:|]\\s*(.+)`, "i");
    const direct = text.match(matcher);
    if (direct?.[1]) {
      const value = cleanLine(direct[1].split("\n")[0] || "");
      if (value) return value;
    }
  }
  return "";
}

function extractFirstPrice(block: string) {
  const match =
    block.match(/r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i) ||
    block.match(/pre[cç]o(?:\s+sugerido|\s+estimado|\s+aproximado)?\s*(?:de)?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i);

  return match?.[1] || "";
}

function inferDestination(source: string, explicitCategory = ""): StructuredImportDestination {
  const normalized = normalizeLoose(`${explicitCategory} ${source}`);

  const chemicalHits = [
    "quim",
    "cloro",
    "algicida",
    "clarificante",
    "sulfato",
    "elevador de ph",
    "redutor de ph",
    "dosagem",
    "desinfeccao",
    "desinfecção",
  ];
  const accessoryHits = [
    "acessor",
    "aspirador",
    "escova",
    "peneira",
    "mangueira",
    "clorador",
    "dispositivo",
    "led",
    "nicho",
    "retorno",
    "hidromassagem",
    "ombrelone",
  ];
  const poolHits = [
    "piscina",
    "fibra",
    "vinil",
    "alvenaria",
    "pastilha",
    "profundidade",
    "capacidade",
    "litros",
    "spa",
  ];

  const score = (hits: string[], weight = 2) =>
    hits.reduce((acc, item) => acc + (normalized.includes(normalizeLoose(item)) ? weight : 0), 0);

  const chemicalScore = score(chemicalHits, 2);
  const accessoryScore = score(accessoryHits, 2);
  const poolScore =
    score(poolHits, 1) +
    (/\b\d+[\.,]?\d*\s*x\s*\d+[\.,]?\d*\s*m\b/i.test(source) ? 3 : 0) +
    (/\b\d+[\.,]?\d*\s*m\s*di[âa]m/i.test(source) ? 3 : 0);

  if (chemicalScore >= 4 && chemicalScore >= accessoryScore && chemicalScore >= poolScore) {
    return "quimicos";
  }
  if (accessoryScore >= 4 && accessoryScore > chemicalScore && accessoryScore >= poolScore) {
    return "acessorios";
  }
  if (poolScore >= 5) {
    return "pool";
  }
  if (normalizeLoose(explicitCategory).includes("quim")) return "quimicos";
  if (normalizeLoose(explicitCategory).includes("acessor")) return "acessorios";
  if (normalizeLoose(explicitCategory).includes("piscina")) return "pool";

  return "outros";
}

function cleanupDescription(lines: string[], title: string) {
  const normalizedTitle = normalizeLoose(title);

  return lines
    .map(cleanLine)
    .filter(Boolean)
    .filter((line) => !stripBoilerplateLine(line))
    .filter((line) => !/^\d+[\).\-]\s*$/.test(line))
    .filter((line) => !parseLabelValue(line))
    .filter((line) => normalizeLoose(line) !== normalizedTitle)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);
}

function parseSingleBlock(block: string, sourceFileName: string, itemIndex: number): StructuredImportItem | null {
  const normalizedBlock = normalizeBlock(block);
  if (!normalizedBlock) return null;

  const lines = normalizedBlock.split("\n").map(cleanLine).filter(Boolean);
  if (lines.length === 0) return null;

  const fieldMap: Record<string, string> = {};
  const freeLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/^\d+[\).\-]\s+/, "").trim();
    const parsed = parseLabelValue(line);
    if (parsed) {
      fieldMap[parsed.label] = parsed.value;
    } else {
      freeLines.push(line);
    }
  }

  const explicitTitle =
    extractLabeledValue(normalizedBlock, TITLE_LABELS) ||
    TITLE_LABELS.map((label) => fieldMap[normalizeLoose(label)]).find(Boolean) ||
    "";

  const freeTitleCandidates = freeLines
    .map(stripLeadingNoise)
    .filter(Boolean)
    .filter((line) => !stripBoilerplateLine(line))
    .filter((line) => !isProbablyGenericTitle(line));

  const title = stripLeadingNoise(explicitTitle || freeTitleCandidates[0] || "");
  if (!title || isProbablyGenericTitle(title)) return null;

  const categoryHint =
    fieldMap["categoria"] ||
    fieldMap["tipo"] ||
    extractLabeledValue(normalizedBlock, ["categoria", "tipo"]);

  const destination = inferDestination(normalizedBlock, categoryHint);

  const descriptionCandidates = [
    fieldMap["descricao"],
    fieldMap["descrição"],
    fieldMap["description"],
    fieldMap["descricao comercial"],
    fieldMap["descrição comercial"],
    fieldMap["finalidade"],
    fieldMap["aplicacao"],
    fieldMap["aplicação"],
    fieldMap["uso"],
    fieldMap["observacao"],
    fieldMap["observação"],
    ...freeLines.filter((line) => normalizeLoose(line) !== normalizeLoose(title)),
  ].filter(Boolean) as string[];

  const description = cleanupDescription(descriptionCandidates, title);

  const item: StructuredImportItem = {
    sourceFileName,
    itemIndex,
    destination,
    title,
    description,
    rawBlock: normalizedBlock,
    categoryHint,
    price:
      fieldMap["preco"] ||
      fieldMap["preço"] ||
      fieldMap["preco sugerido"] ||
      fieldMap["preço sugerido"] ||
      extractFirstPrice(normalizedBlock),
    dimensions: fieldMap["medidas"] || fieldMap["dimensoes"] || fieldMap["dimensões"] || "",
    depth: fieldMap["profundidade"] || fieldMap["prof"] || "",
    capacity: fieldMap["capacidade"] || "",
    material: fieldMap["material"] || "",
    shape: fieldMap["formato"] || "",
    brand: fieldMap["marca"] || "",
    sku: fieldMap["sku"] || fieldMap["codigo"] || fieldMap["código"] || "",
    weight: fieldMap["peso"] || "",
    dosage: fieldMap["dosagem"] || "",
    color: fieldMap["cor"] || "",
    usage: fieldMap["uso"] || fieldMap["aplicacao"] || fieldMap["aplicação"] || "",
    notes: fieldMap["observacao"] || fieldMap["observação"] || "",
  };

  return item;
}

function chooseBlocks(extracted: ExtractedFileContent) {
  const numberedBlocks = splitNumberedBlocks(extracted.text);
  if (numberedBlocks.length > 0) return numberedBlocks;

  const labeledBlocks = splitByKnownLabels(extracted.text);
  if (labeledBlocks.length > 0) return labeledBlocks;

  const paragraphBlocks = splitParagraphBlocks(extracted.text).filter((block) => {
    const normalized = normalizeLoose(block);
    if (!normalized) return false;
    if (normalized.length < 24) return false;
    return true;
  });

  if (paragraphBlocks.length > 1) {
    return paragraphBlocks;
  }

  return [normalizeBlock(extracted.text)].filter(Boolean);
}

function qualityScore(item: StructuredImportItem) {
  return (
    Math.min(item.description.length, 600) +
    (item.price ? 60 : 0) +
    (item.dimensions ? 60 : 0) +
    (item.depth ? 40 : 0) +
    (item.capacity ? 40 : 0) +
    (item.material ? 20 : 0) +
    (item.brand ? 20 : 0) +
    (item.notes ? 10 : 0)
  );
}

export function parseStructuredImportItems(extracted: ExtractedFileContent): StructuredImportItem[] {
  const blocks = chooseBlocks(extracted);
  const parsed = blocks
    .map((block, index) => parseSingleBlock(block, extracted.fileName, index))
    .filter((item): item is StructuredImportItem => Boolean(item));

  if (parsed.length === 0) return [];

  const sourceLooksSingleItem =
    !/^\d+[\).\-]\s+/m.test(normalizeBlock(extracted.text)) &&
    (normalizeLoose(extracted.text).includes("nome do item") ||
      normalizeLoose(extracted.text).includes("descricao detalhada") ||
      normalizeLoose(extracted.text).includes("descrição detalhada") ||
      normalizeLoose(extracted.text).includes("preco sugerido") ||
      normalizeLoose(extracted.text).includes("preço sugerido"));

  const sorted = [...parsed].sort((a, b) => qualityScore(b) - qualityScore(a));

  if (sourceLooksSingleItem || parsed.length === 1) {
    return [sorted[0]];
  }

  const kept: StructuredImportItem[] = [];
  const seenTitles = new Set<string>();

  for (const item of sorted) {
    const titleKey = normalizeLoose(item.title);
    if (!titleKey || seenTitles.has(titleKey)) continue;
    if (isProbablyGenericTitle(item.title)) continue;
    if (!item.description && !item.price && !item.dimensions && !item.capacity) continue;
    seenTitles.add(titleKey);
    kept.push(item);
  }

  return kept;
}
