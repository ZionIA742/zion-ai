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

function inferDestination(text: string): StructuredImportDestination {
  const source = normalizeLoose(text);

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
  if (!normalized.includes("=== ITEM")) return [];

  return normalized
    .split(/\n={3}\s*ITEM\b[^\n]*\n/i)
    .map((block) => normalizeBlock(block))
    .filter(Boolean);
}

function splitNumberedBlocks(text: string) {
  const normalized = normalizeBlock(text);

  const parts = normalized
    .split(/\n(?=\d{1,4}[\)\.\-]\s+)/g)
    .map((block) => normalizeBlock(block))
    .filter(Boolean);

  return parts.filter((block) => /^\d{1,4}[\)\.\-]\s+/.test(block));
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
    const match = line.match(/^([^:]{2,80}):\s*(.+)$/);
    if (match) {
      const key = titleCaseLabel(match[1]);
      const value = cleanText(match[2]);
      if (!key || !value) continue;

      if (!fieldMap[key]) {
        fieldMap[key] = value;
      } else if (!fieldMap[key].includes(value)) {
        fieldMap[key] = `${fieldMap[key]}\n${value}`;
      }
      continue;
    }

    plainLines.push(line.replace(/^\d+[\)\.\-]\s+/, "").trim());
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
  ];

  const picked = candidateKeys
    .map((key) => fieldMap[key])
    .filter(Boolean)
    .join("\n")
    .trim();

  const normalizedTitle = normalizeLoose(title);

  const plainDescriptionLines = plainLines.filter(
    (line) => normalizeLoose(line) !== normalizedTitle
  );

  const combined = [picked, ...plainDescriptionLines].filter(Boolean).join("\n").trim();
  return combined;
}

function parseSingleBlock(
  block: string,
  fileName: string,
  index: number
): StructuredImportItem | null {
  const normalizedBlock = normalizeBlock(block);
  if (!normalizedBlock) return null;

  const { fieldMap, plainLines } = parseFieldLines(normalizedBlock);
  const title = chooseTitle(fieldMap, plainLines, fileName, index);
  const description = chooseDescription(fieldMap, plainLines, title);
  const sourceText = [title, description, normalizedBlock].filter(Boolean).join("\n");
  const destination = inferDestination(sourceText);

  const item: StructuredImportItem = {
    sourceFileName: fileName,
    destination,
    categoria: destination === "pool" ? "pool" : destination,
    title,
    description,
    rawBlock: normalizedBlock,
    confidence: destination === "outros" ? 0.62 : 0.86,
    price:
      fieldMap["preco"] ||
      fieldMap["preço"] ||
      fieldMap["faixa de preco"] ||
      fieldMap["faixa de preço"] ||
      "",
    dimensions:
      fieldMap["medidas"] ||
      fieldMap["dimensoes"] ||
      fieldMap["dimensões"] ||
      fieldMap["tamanho"] ||
      "",
    depth: fieldMap["profundidade"] || "",
    capacity: fieldMap["capacidade"] || "",
    material: fieldMap["material"] || "",
    shape: fieldMap["formato"] || "",
    brand: fieldMap["marca"] || "",
    sku: fieldMap["sku"] || fieldMap["codigo"] || fieldMap["código"] || "",
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
    !normalizeBlock(extracted.text).includes("=== ITEM") &&
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
    return !isProbablyGenericTitle(item.title) && item.description.length >= 10;
  });
}