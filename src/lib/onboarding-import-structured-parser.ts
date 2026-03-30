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
  "descrição detalhada",
  "descricao detalhada",
  "nome do item",
  "regra comercial",
  "arquivo de teste",
  "item importado",
  "piscina",
  "catálogo",
  "catalogo",
];

const DESCRIPTION_LABEL_FRAGMENTS = [
  "campo",
  "valor",
  "nome do item",
  "nome comercial",
  "categoria",
  "finalidade",
  "material",
  "cor",
  "compatibilidade",
  "função",
  "funcao",
  "aplicação",
  "aplicacao",
  "indicação",
  "indicacao",
  "peso",
  "dosagem",
  "marca",
  "sku",
  "código",
  "codigo",
  "medidas",
  "profundidade",
  "capacidade",
  "preço",
  "preco",
  "formato",
  "observação",
  "observacao",
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

function isProbablyGenericTitle(value: string) {
  const normalized = normalizeLoose(value);
  if (!normalized) return true;
  if (GENERIC_TITLES.map(normalizeLoose).includes(normalized)) return true;
  return GENERIC_TITLES.some(
    (item) => normalized === normalizeLoose(item) || normalized.startsWith(normalizeLoose(item))
  );
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

function stripBoilerplateLine(line: string) {
  const normalized = normalizeLoose(line);
  if (!normalized) return true;

  const blockedFragments = [
    "arquivo de teste",
    "validar upload inteligente",
    "classificacao e salvamento no sistema",
    "objetivo validar",
    "categoria esperada no sistema",
    "isso salva tudo no lugar certo",
    "salvar em configuracoes",
    "upload inteligente envia corretamente",
    "foto 5 formato catalogo de teste",
  ];

  return blockedFragments.some((item) => normalized.includes(item));
}

function isLabelOnlyLine(line: string) {
  const normalized = normalizeLoose(line);
  if (!normalized) return true;

  if (DESCRIPTION_LABEL_FRAGMENTS.includes(normalized)) return true;
  if (DESCRIPTION_LABEL_FRAGMENTS.some((item) => normalized === normalizeLoose(item))) return true;

  return false;
}

function splitNumberedBlocks(text: string) {
  const lines = normalizeBlock(text).split("\n").map(cleanLine).filter(Boolean);
  const numberedIndices = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\d+[\).\-]\s+/.test(line));

  if (numberedIndices.length < 2) return [] as string[];

  const blocks: string[] = [];
  for (let i = 0; i < numberedIndices.length; i += 1) {
    const start = numberedIndices[i].index;
    const end = i + 1 < numberedIndices.length ? numberedIndices[i + 1].index : lines.length;
    const block = lines.slice(start, end).join("\n").trim();
    if (block) blocks.push(block);
  }
  return blocks;
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

function extractFirstPrice(block: string) {
  const match =
    block.match(/r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i) ||
    block.match(
      /pre[cç]o(?:\s+sugerido|\s+estimado|\s+aproximado)?\s*(?:de)?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i
    );

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
  ];

  const chemicalScore = chemicalHits.reduce(
    (acc, item) => acc + (normalized.includes(normalizeLoose(item)) ? 2 : 0),
    0
  );

  const accessoryScore = accessoryHits.reduce(
    (acc, item) => acc + (normalized.includes(normalizeLoose(item)) ? 2 : 0),
    0
  );

  const poolScore =
    poolHits.reduce((acc, item) => acc + (normalized.includes(normalizeLoose(item)) ? 1 : 0), 0) +
    (/\b\d+[\.,]?\d*\s*x\s*\d+[\.,]?\d*\s*m\b/i.test(source) ? 3 : 0);

  if (chemicalScore >= accessoryScore && chemicalScore >= 4 && chemicalScore >= poolScore) {
    return "quimicos";
  }
  if (accessoryScore > chemicalScore && accessoryScore >= 4 && accessoryScore >= poolScore) {
    return "acessorios";
  }
  if (poolScore >= 5) {
    return "pool";
  }
  if (normalizeLoose(explicitCategory).includes("quim")) return "quimicos";
  if (normalizeLoose(explicitCategory).includes("acessor")) return "acessorios";
  return "outros";
}

function cleanupTitle(value: string) {
  return cleanLine(
    String(value || "")
      .replace(/^\d+[\).\-]\s+/, "")
      .replace(/^nome do item\s*[:|-]?\s*/i, "")
      .replace(/^produto\s*[:|-]?\s*/i, "")
      .replace(/^piscina\s*[:|-]?\s*/i, "")
  ).slice(0, 180);
}

function cleanupDescription(lines: string[]) {
  const cleanedLines = lines
    .map(cleanLine)
    .filter(Boolean)
    .filter((line) => !stripBoilerplateLine(line))
    .filter((line) => !/^\d+[\).\-]\s*$/.test(line))
    .filter((line) => !parseLabelValue(line))
    .filter((line) => !isLabelOnlyLine(line))
    .filter((line) => normalizeLoose(line) !== "r")
    .filter((line) => normalizeLoose(line) !== "rs")
    .filter((line) => !/^(r\$?\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})?$/.test(line.trim()));

  const uniqueLines = cleanedLines.filter((line, index) => {
    const normalized = normalizeLoose(line);
    return normalized && cleanedLines.findIndex((candidate) => normalizeLoose(candidate) === normalized) === index;
  });

  const cleaned = uniqueLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned.slice(0, 4000);
}

function parseSingleBlock(block: string, sourceFileName: string, itemIndex: number): StructuredImportItem | null {
  const lines = normalizeBlock(block).split("\n").map(cleanLine).filter(Boolean);
  if (lines.length === 0) return null;

  const fieldMap: Record<string, string> = {};
  const freeLines: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const line = rawLine.replace(/^\d+[\).\-]\s+/, "").trim();
    const parsed = parseLabelValue(line);

    if (parsed) {
      fieldMap[parsed.label] = parsed.value;
      continue;
    }

    const normalizedLine = normalizeLoose(line);
    const nextLine = lines[lineIndex + 1] ? cleanLine(lines[lineIndex + 1]) : "";
    const nextNormalized = normalizeLoose(nextLine);

    if (
      DESCRIPTION_LABEL_FRAGMENTS.includes(normalizedLine) &&
      nextLine &&
      !DESCRIPTION_LABEL_FRAGMENTS.includes(nextNormalized) &&
      !stripBoilerplateLine(nextLine) &&
      !parseLabelValue(nextLine)
    ) {
      fieldMap[normalizedLine] = nextLine;
      lineIndex += 1;
      continue;
    }

    freeLines.push(line);
  }

  const explicitTitle =
    fieldMap["nome do item"] ||
    fieldMap["nome comercial"] ||
    fieldMap["nome"] ||
    fieldMap["produto"] ||
    fieldMap["titulo"] ||
    fieldMap["título"];

  let title = cleanupTitle(explicitTitle || freeLines[0] || "");
  if (!title && lines.length > 0) {
    title = cleanupTitle(lines[0]);
  }
  if (!title || isProbablyGenericTitle(title)) return null;

  const categoryHint = fieldMap["categoria"] || fieldMap["tipo"] || "";
  const destination = inferDestination(block, categoryHint);

  const descriptionCandidates = [
    fieldMap["descricao"],
    fieldMap["descrição"],
    fieldMap["description"],
    fieldMap["finalidade"],
    fieldMap["compatibilidade"],
    fieldMap["funcao"],
    fieldMap["função"],
    fieldMap["aplicacao"],
    fieldMap["aplicação"],
    fieldMap["uso"],
    fieldMap["indicacao"],
    fieldMap["indicação"],
    fieldMap["observacao"],
    fieldMap["observação"],
    ...freeLines.slice(1),
  ].filter(Boolean) as string[];

  const description = cleanupDescription(descriptionCandidates);

  const item: StructuredImportItem = {
    sourceFileName,
    itemIndex,
    destination,
    title,
    description,
    rawBlock: normalizeBlock(
      [
        title,
        description,
        fieldMap["medidas"],
        fieldMap["profundidade"],
        fieldMap["capacidade"],
        fieldMap["preco"],
        fieldMap["preço"],
        fieldMap["preco sugerido"],
        fieldMap["preço sugerido"],
      ]
        .filter(Boolean)
        .join("\n")
    ),
    categoryHint,
    price: extractFirstPrice(block) || fieldMap["preco"] || fieldMap["preço"] || fieldMap["preco sugerido"] || fieldMap["preço sugerido"] || "",
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
    usage:
      fieldMap["uso"] ||
      fieldMap["aplicacao"] ||
      fieldMap["aplicação"] ||
      fieldMap["funcao"] ||
      fieldMap["função"] ||
      fieldMap["finalidade"] ||
      fieldMap["indicacao"] ||
      fieldMap["indicação"] ||
      "",
    notes: fieldMap["observacao"] || fieldMap["observação"] || "",
  };

  item.rawBlock = item.rawBlock || normalizeBlock([title, description].filter(Boolean).join("\n"));
  return item;
}

function chooseBlocks(extracted: ExtractedFileContent) {
  const numberedBlocks = splitNumberedBlocks(extracted.text);
  if (numberedBlocks.length > 0) return numberedBlocks;

  const paragraphBlocks = splitParagraphBlocks(extracted.text).filter((block) => {
    const normalized = normalizeLoose(block);
    if (!normalized) return false;
    if (stripBoilerplateLine(block)) return false;
    return normalized.length > 20;
  });

  if (paragraphBlocks.length > 1) {
    return paragraphBlocks;
  }

  return [normalizeBlock(extracted.text)].filter(Boolean);
}

export function parseStructuredImportItems(extracted: ExtractedFileContent): StructuredImportItem[] {
  const blocks = chooseBlocks(extracted);
  const items: StructuredImportItem[] = [];

  blocks.forEach((block, index) => {
    const parsed = parseSingleBlock(block, extracted.fileName, index);
    if (parsed) {
      items.push(parsed);
    }
  });

  if (items.length === 0) return [];

  const qualitySorted = [...items].sort((a, b) => {
    const score = (item: StructuredImportItem) =>
      (item.description ? Math.min(item.description.length, 600) : 0) +
      (item.price ? 50 : 0) +
      (item.dimensions ? 50 : 0) +
      (item.capacity ? 50 : 0) +
      (item.material ? 20 : 0) +
      (item.brand ? 20 : 0);

    return score(b) - score(a);
  });

  const sourceLooksSingleItem =
    !/^\d+[\).\-]\s+/m.test(normalizeBlock(extracted.text)) &&
    (items.length === 1 ||
      normalizeLoose(extracted.text).includes("nome do item") ||
      normalizeLoose(extracted.text).includes("descricao detalhada") ||
      normalizeLoose(extracted.text).includes("preco sugerido") ||
      normalizeLoose(extracted.text).includes("preço sugerido"));

  if (sourceLooksSingleItem) {
    return [qualitySorted[0]];
  }

  return qualitySorted.filter((item, index) => {
    if (index === 0) return true;
    return !isProbablyGenericTitle(item.title) && item.description.length >= 25;
  });
}
