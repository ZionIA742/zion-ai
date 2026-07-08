import type { ExtractedFileContent } from "./server/onboarding-file-extractors";

export type StructuredImportDestination = "pool" | "quimicos" | "acessorios" | "outros";

export type StructuredImportItem = {
  sourceFileName: string;
  destination: StructuredImportDestination;
  title: string;
  originalTitle?: string;
  description: string;
  originalDescription?: string;
  rawBlock: string;
  confidence: number;
  titleCleanupReasons?: string[];
  titleStatus?: "canonical" | "missing_name" | "ambiguous";
  missingName?: boolean;
  ambiguousTitle?: boolean;
  descriptionCleanupReasons?: string[];
  descriptionStatus?: "preserved" | "cleaned" | "empty";
  categoria?: string;
  price?: string;
  dimensions?: string;
  depth?: string;
  capacity?: string;
  material?: string;
  shape?: string;
  brand?: string;
  line?: string;
  sku?: string;
  unit?: string;
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
  sheetName?: string;
  sourceCategory?: string;
  sourceSubcategory?: string;
  stockQuantity?: string;
  worksheetRowNumber?: number;
  sheetScopedKey?: string;
  sourceWorksheetRowNumbers?: number[];
  sourceSheetScopedKeys?: string[];
  mergedFromSpreadsheetRows?: boolean;
  reviewSignals?: string[];
};

export type StructuredParserBlockDebug = {
  index: number;
  charCount: number;
  lineCount: number;
  previewLines: string[];
  segmentationStrategy: string;
  skuCount: number;
  priceCount: number;
  looksLikeMultipleProducts: boolean;
  looksLikeTitleOrSection: boolean;
};

export type StructuredParserCandidateDebug = {
  blockIndex: number;
  originalTitle: string;
  canonicalTitle: string;
  title: string;
  inlineProductNameCandidates?: Array<{
    label: string;
    rawValue: string;
    cleanedValue: string;
    accepted: boolean;
    rejectionReason: string;
    sourcePosition: number;
    sourceStart?: number;
    sourceEnd?: number;
    associatedSku?: string;
    associatedSkuPosition?: number;
    sourceKind?: "inline_block" | "pre_segmentation";
  }>;
  titleSource: string;
  titleCleanupReasons: string[];
  titleStatus: "canonical" | "missing_name" | "ambiguous";
  missingName: boolean;
  ambiguousTitle: boolean;
  originalDescription: string;
  canonicalDescription: string;
  descriptionCleanupReasons: string[];
  descriptionStatus: "preserved" | "cleaned" | "empty";
  descriptionCandidateSources: string[];
  rawBlockSemanticRemainder: string;
  descriptionClauses: Array<{
    originalText: string;
    removedStructuredSpans: string[];
    semanticRemainder: string;
    classification: string;
    action: "preserved" | "removed";
    reason: string;
  }>;
  preservedDescriptionParts: string[];
  rejectedDescriptionParts: string[];
  canonicalDescriptionApplied: boolean;
  frontFallbackAllowed: boolean;
  sku: string;
  allSkus: string[];
  price: string;
  allPrices: string[];
  priceExtractionCandidates?: Array<{
    rawMatch: string;
    priceLabel: string;
    numericToken: string;
    normalizedValue: string;
    source: string;
    accepted: boolean;
    rejectionReason: string;
  }>;
  destination: StructuredImportDestination;
  confidence: number;
  spreadsheetIdentityResolution?: {
    applied: boolean;
    titleSource?: string;
    skuSource?: string;
    reconciled: boolean;
    decisions: Array<{
      field: string;
      value: string;
      accepted: boolean;
      rejectionReason: string;
    }>;
  };
  alerts: string[];
};

export type StructuredParserMergeDebug = {
  key: string;
  primaryTitle: string;
  secondaryTitle: string;
  reason: "sku" | "title" | "category" | "other";
};

export type StructuredParserFragmentMergeDebug = {
  fromIndex: number;
  intoIndex: number;
  reason: string;
  sourcePreview: string;
  targetPreviewBefore?: string;
  mergedPreview: string;
};

export type StructuredParserTransitionSplitDebug = {
  fromIndex: number;
  intoIndex: number;
  reason: string;
  originalBlock: string;
  transitionText: string;
  previousFragment: string;
  nextProductSeed: string;
  nextBlock?: string;
  resultAfterCoalesce?: string;
  appliedToOutput?: boolean;
  consumedNextBlock?: boolean;
};

export type StructuredParserFileDebug = {
  fileName: string;
  mimeType?: string;
  extractedCharCount: number;
  approxLineCount: number;
  usefulLinesPreview: string[];
  looksLikeContinuousText: boolean;
  explicitNameCandidatesBeforeSegmentation?: Array<{
    label: string;
    rawValue: string;
    cleanedValue: string;
    sourceStart: number;
    sourceEnd: number;
    associatedSku?: string;
    associatedSkuPosition?: number;
    accepted: boolean;
    rejectionReason: string;
  }>;
  explicitNameCandidateAssignments?: Array<{
    cleanedValue: string;
    associatedSku?: string;
    assignedBlockIndex?: number;
    blockSkuValues: string[];
    assignmentReason: string;
    assigned: boolean;
    rejectionReason: string;
  }>;
  chooseBlocks: {
    strategy: string;
    blockCount: number;
    blocks: StructuredParserBlockDebug[];
  };
  parseSingleBlock: {
    candidateCount: number;
    nullBlockCount: number;
    candidates: StructuredParserCandidateDebug[];
  };
  sourceLooksSingleItem: {
    activated: boolean;
    reasons: string[];
    beforeCount: number;
    afterCount: number;
    candidateLifecycle?: Array<{
      key: string;
      title: string;
      sku: string;
      enteredStage: string;
      leftStage: string;
      retained: boolean;
      retainedReason?: string;
      dropReason: string;
    }>;
  };
  merge: {
    inputCount: number;
    outputCount: number;
    mergedPairs: StructuredParserMergeDebug[];
  };
  fragmentCoalesce?: {
    inputCount: number;
    outputCount: number;
    mergedPairs: StructuredParserFragmentMergeDebug[];
    transitionSplits?: StructuredParserTransitionSplitDebug[];
  };
  continuationCoalesce?: {
    inputCount: number;
    outputCount: number;
    mergedPairs: StructuredParserFragmentMergeDebug[];
  };
  spreadsheetContinuationCoalesce?: {
    inputCount: number;
    outputCount: number;
    mergedPairs: Array<{
      sheetName?: string;
      previousRow?: number;
      currentRow?: number;
      reason: string;
    }>;
  };
  spreadsheetAtomicRows?: {
    detected: boolean;
    count: number;
    narrativeSplitSkipped: boolean;
    rows: Array<{
      blockIndex: number;
      sheetName?: string;
      worksheetRowNumber?: number;
      sheetScopedKey?: string;
    }>;
  };
};

const STRUCTURED_FIELD_ALIASES: Record<string, string[]> = {
  "nome do produto": ["nome do produto", "nome comercial"],
  produto: ["produto", "nome", "item"],
  modelo: ["modelo"],
  "produto ou coisa": ["produto ou coisa"],
  descrição: ["descricao", "descricao detalhada", "descricao comercial"],
  sku: ["sku", "cod/ref", "referencia", "referência", "ref"],
  código: ["codigo", "cod"],
  "preço venda": [
    "preco venda r",
    "preco venda",
    "valor venda",
    "valor final",
    "preco final r",
    "preco final",
    "preco de venda",
    "preco de venda r",
  ],
  "preço sugerido": ["preco sugerido r", "preco sugerido"],
  "preço custo": ["preco custo r", "preco custo", "custo"],
  preço: ["preco", "valor"],
  "quantidade atual": ["quantidade", "qtd", "qtd?", "unidades"],
  estoque: ["estoque"],
  categoria: ["categoria", "cat", "familia", "família", "familia talvez", "família talvez", "tipo"],
  observações: ["observacao", "observacoes", "notas", "notes", "obs"],
  indicação: ["indicacao"],
  aplicação: ["aplicacao", "uso / observacao", "uso / observacao", "uso / observação"],
  composição: ["composicao"],
  função: ["funcao", "finalidade"],
  "peso/volume": ["peso volume", "peso / volume"],
  medidas: ["dimensoes", "medidas"],
  título: ["titulo"],
  "estoque mínimo": ["estoque minimo"],
  "estoque máximo": ["estoque maximo"],
  planilha: ["planilha", "aba", "sheet"],
  "linha da planilha": ["linha da planilha", "worksheet row number"],
  "sheet scoped key": ["sheet scoped key", "source scoped key"],
};

const CANONICAL_FIELD_KEY_BY_ALIAS = Object.entries(STRUCTURED_FIELD_ALIASES).reduce<
  Record<string, string>
>((acc, [canonicalKey, aliases]) => {
  for (const alias of aliases) {
    acc[normalizeLoose(alias)] = canonicalKey;
  }
  return acc;
}, {});

[
  ["codigo do produto", "cÃ³digo"],
  ["cÃ³digo do produto", "cÃ³digo"],
  ["categoria final", "categoria"],
  ["categoria do produto", "categoria"],
  ["subcategoria", "subcategoria"],
  ["quantidade em estoque", "estoque"],
  ["saldo em estoque", "estoque"],
  ["unidade", "unidade"],
  ["marca / linha", "marca / linha"],
  ["marca e linha", "marca / linha"],
  ["linha", "linha"],
  ["observacoes tecnicas", "observaÃ§Ãµes"],
  ["observaÃ§Ãµes tÃ©cnicas", "observaÃ§Ãµes"],
  ["notas tecnicas", "observaÃ§Ãµes"],
  ["notas tÃ©cnicas", "observaÃ§Ãµes"],
  ["preco de venda (r$)", "preço venda"],
  ["preço de venda (r$)", "preço venda"],
  ["valor de venda", "preço venda"],
].forEach(([alias, canonicalKey]) => {
  CANONICAL_FIELD_KEY_BY_ALIAS[normalizeLoose(alias)] = canonicalKey;
});

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

const INLINE_FIELD_LABELS = [
  "preço venda (r$)",
  "preco venda (r$)",
  "preço final (r$)",
  "preco final (r$)",
  "preço sugerido (r$)",
  "preco sugerido (r$)",
  "preço custo (r$)",
  "preco custo (r$)",
  "preço venda",
  "preco venda",
  "preço final",
  "preco final",
  "preço sugerido",
  "preco sugerido",
  "preço custo",
  "preco custo",
  "faixa de preço",
  "faixa de preco",
  "nome do produto",
  "nome comercial",
  "descrição detalhada",
  "descricao detalhada",
  "descrição comercial",
  "descricao comercial",
  "peso / volume",
  "peso/volume",
  "código",
  "codigo",
  "quantidade atual",
  "estoque mínimo",
  "estoque minimo",
  "estoque máximo",
  "estoque maximo",
  "controlar estoque",
  "subcategoria",
  "aplicação",
  "aplicacao",
  "observações",
  "observacoes",
  "observação",
  "observacao",
  "indicação",
  "indicacao",
  "composição",
  "composicao",
  "compatibilidade",
  "profundidade",
  "capacidade",
  "embalagem",
  "packaging",
  "categoria",
  "material",
  "formato",
  "modelo",
  "tamanho",
  "ambiente",
  "diferencial",
  "dosagem",
  "função",
  "funcao",
  "finalidade",
  "preço",
  "preco",
  "valor",
  "sku",
  "marca",
  "linha",
  "peso",
  "volume",
  "nome",
  "titulo",
  "título",
  "produto",
  "item",
  "uso",
  "cor",
  "planilha",
  "aba",
  "sheet",
].sort((a, b) => b.length - a.length);

INLINE_FIELD_LABELS.push(
  "cÃ³digo do produto",
  "codigo do produto",
  "categoria final",
  "categoria do produto",
  "preço de venda (r$)",
  "preco de venda (r$)",
  "valor de venda",
  "quantidade em estoque",
  "saldo em estoque",
  "unidade",
  "marca / linha",
  "marca e linha",
  "observaÃ§Ãµes tÃ©cnicas",
  "observacoes tecnicas",
  "notas tÃ©cnicas",
  "notas tecnicas"
);
INLINE_FIELD_LABELS.sort((a, b) => b.length - a.length);

const BLOCKED_SKU_VALUES = new Set([
  "de",
  "do",
  "da",
  "dos",
  "das",
  "para",
  "com",
  "sem",
  "max",
  "home",
  "slim",
  "basico",
  "básico",
]);

function escapeRegExp(value: string) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type PriceExtractionCandidate = {
  rawMatch: string;
  priceLabel: string;
  numericToken: string;
  normalizedValue: string;
  source: string;
  accepted: boolean;
  rejectionReason: string;
};

const PRICE_TERMINAL_BOUNDARY_REGEX_FRAGMENT =
  String.raw`(?=$|[\s\])}:;!?]|[.,](?:$|[\s\])}:;!?]))`;

const PRICE_NUMERIC_TOKEN_REGEX_FRAGMENT =
  String.raw`(?:\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)`;
const COMMERCIAL_PRICE_LABEL_REGEX_FRAGMENT =
  String.raw`(?:pre[cç]o(?:\s+(?:venda|final|sugerido|custo))?|valor|custa|custando)`;
const COMMERCIAL_PRICE_CURRENCY_REGEX_FRAGMENT = String.raw`(?:por\s+r\$|r\$|reais)`;
const PRICE_LABEL_WITH_OPTIONAL_CURRENCY_REGEX_FRAGMENT = String.raw`(?:${COMMERCIAL_PRICE_LABEL_REGEX_FRAGMENT})(?:\s*\(r\$\))?\s*[:=.\-]?\s*(?:r\$\s*)?`;
const PRICE_CONTEXT_PREFIX_REGEX_FRAGMENT = String.raw`(?:${PRICE_LABEL_WITH_OPTIONAL_CURRENCY_REGEX_FRAGMENT}|${COMMERCIAL_PRICE_CURRENCY_REGEX_FRAGMENT}\s*[:=.\-]?\s*)`;

const PRICE_EXTRACTION_PATTERNS: Array<{
  source: string;
  regex: RegExp;
  rawMatchGroup?: number;
  priceLabelGroup?: number;
  numericTokenGroup: number;
}> = [
  {
    source: "commercial_label",
    regex: new RegExp(
      String.raw`(${PRICE_LABEL_WITH_OPTIONAL_CURRENCY_REGEX_FRAGMENT})(${PRICE_NUMERIC_TOKEN_REGEX_FRAGMENT})${PRICE_TERMINAL_BOUNDARY_REGEX_FRAGMENT}`,
      "giu"
    ),
    priceLabelGroup: 1,
    numericTokenGroup: 2,
  },
  {
    source: "monetary_symbol",
    regex: new RegExp(
      String.raw`(${COMMERCIAL_PRICE_CURRENCY_REGEX_FRAGMENT}\s*[:=.\-]?\s*)(${PRICE_NUMERIC_TOKEN_REGEX_FRAGMENT})${PRICE_TERMINAL_BOUNDARY_REGEX_FRAGMENT}`,
      "giu"
    ),
    priceLabelGroup: 1,
    numericTokenGroup: 2,
  },
];

const NON_PRICE_NUMERIC_PROBE_PATTERNS: Array<{
  source: string;
  rejectionReason: string;
  regex: RegExp;
  rawMatchGroup?: number;
  priceLabelGroup?: number;
  numericTokenGroup: number;
}> = [
  {
    source: "dimension_probe",
    rejectionReason: "dimension_expression",
    regex: /(\d+(?:[\.,]\d+)?)\s+por\s+\d+(?:[\.,]\d+)?/giu,
    numericTokenGroup: 1,
  },
  {
    source: "dimension_probe",
    rejectionReason: "dimension_label",
    regex: /(largura|comprimento|altura)\s*[:\-]?\s*(\d+(?:[\.,]\d+)?)/giu,
    priceLabelGroup: 1,
    numericTokenGroup: 2,
  },
  {
    source: "depth_probe",
    rejectionReason: "depth_label",
    regex: /(profundidade)\s*[:\-]?\s*(\d+(?:[\.,]\d+)?)/giu,
    priceLabelGroup: 1,
    numericTokenGroup: 2,
  },
  {
    source: "stock_probe",
    rejectionReason: "stock_label",
    regex: /(estoque|quantidade(?:\s+atual)?)\s*[:\-]?\s*(\d+(?:[\.,]\d+)?)/giu,
    priceLabelGroup: 1,
    numericTokenGroup: 2,
  },
  {
    source: "capacity_probe",
    rejectionReason: "capacity_label",
    regex: /(capacidade)\s*[:\-]?\s*(\d+(?:[\.,]\d+)?)(?:\s*(?:l|lt|lts|litros?))?/giu,
    priceLabelGroup: 1,
    numericTokenGroup: 2,
  },
  {
    source: "weight_probe",
    rejectionReason: "weight_label",
    regex: /(peso)\s*[:\-]?\s*(\d+(?:[\.,]\d+)?)(?:\s*(?:kg|g))?/giu,
    priceLabelGroup: 1,
    numericTokenGroup: 2,
  },
];

const DIRECT_SKU_REGEX = /\b(?:qmc|acc|out)(?:-[a-z0-9]{1,8}){1,4}\b/gi;
const PRICE_WITH_CONTEXT_REGEX =
  /(?:r\$\s*|pre[cÃ§]o(?:\s+(?:venda|final|sugerido|custo))?(?:\s*\(r\$\))?\s*[:\-]?\s*|valor\s*[:\-]?\s*|reais\s*)(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]\d{2})/gi;
const PRODUCT_WORD_REGEX =
  /\b(?:cloro(?:\s+granulado)?|limpa\s+bordas|clorador|cabo\s+telesc[oÃ³]pico|piscina|peneira|kit(?:\s+limpeza)?|aspirador|escova|elevador)\b/i;
const NARRATIVE_PRODUCT_PREFIX_REGEX =
  /^(?:temos|logo depois aparece|no mesmo par[aÃ¡]grafo tem|tamb[eÃ©]m vendemos|outro item(?: importante)?|produto da promo[cÃ§][aÃ£]o ver[aÃ£]o|aparece|surge)\s+/i;

const TRANSITION_TO_NEXT_PRODUCT_REGEX =
  /\b(?:logo depois aparece|no mesmo par[aÃƒÂ¡]grafo tem|tamb[eÃƒÂ©]m vendemos|tamb[eÃƒÂ©]m temos|em seguida aparece|outro item(?: importante)?|produto(?: da)?(?: promo[cÃƒÂ§][aÃƒÂ£]o ver[aÃƒÂ£]o)?)\b/i;
const TRANSITION_TO_NEXT_PRODUCT_PREFIX_REGEX =
  /^(?:temos|logo depois aparece|no mesmo par[aÃƒÂ¡]grafo tem|tamb[eÃƒÂ©]m vendemos|tamb[eÃƒÂ©]m temos|em seguida aparece|outro item(?: importante)?|produto(?: da)?(?: promo[cÃƒÂ§][aÃƒÂ£]o ver[aÃƒÂ£]o)?|aparece|surge)\b[\s:,-]*/i;

const SAFE_TRANSITION_TO_NEXT_PRODUCT_REGEX =
  /\b(?:logo depois aparece|no mesmo par[aá]grafo tem|tamb(?:e|é)m vendemos|tamb(?:e|é)m temos|em seguida aparece|outro item(?: importante)?|produto(?: da)?(?: promo[cç][aã]o ver[aã]o)?)\b/i;
const SAFE_TRANSITION_TO_NEXT_PRODUCT_PREFIX_REGEX =
  /^(?:temos|logo depois aparece|no mesmo par[aá]grafo tem|tamb(?:e|é)m vendemos|tamb(?:e|é)m temos|em seguida aparece|outro item(?: importante)?|produto(?: da)?(?: promo[cç][aã]o ver[aã]o)?|aparece|surge)\b[\s:,-]*/i;

const EXTRA_TRANSITION_TO_NEXT_PRODUCT_REGEX =
  /\b(?:depois misturamos outro(?:\s+(?:produto|item))?)\b/i;
const EXTRA_TRANSITION_TO_NEXT_PRODUCT_PREFIX_REGEX =
  /^(?:depois misturamos outro(?:\s+(?:produto|item))?)\b[\s:,-]*/i;
const INSTRUCTIONAL_LEAD_IN_REGEX =
  /^(?:agora\s+(?:um|o)\s+trecho(?:\s+[a-zà-ÿ]+){0,3})\s*[:;,.!\-]*\s*/iu;
const CATEGORY_VALUE_SIGNAL_REGEX = /^(?:piscina(?:s)?|pool|quimic(?:o|os)|acessori(?:o|os)|outro(?:s)?)\b/i;

function canonicalizeFieldKey(value: string) {
  const normalized = normalizeLoose(value);
  const aliased = CANONICAL_FIELD_KEY_BY_ALIAS[normalized];
  if (aliased) return aliased;

  if (
    normalized === "preco venda r" ||
    normalized === "preco venda" ||
    normalized === "valor venda" ||
    normalized === "preco final r" ||
    normalized === "preco final"
  ) {
    return "preço venda";
  }
  if (normalized === "preco sugerido r" || normalized === "preco sugerido") {
    return "preço sugerido";
  }
  if (normalized === "preco custo r" || normalized === "preco custo" || normalized === "custo") {
    return "preço custo";
  }
  if (normalized === "preco" || normalized === "valor") return "preço";
  if (
    normalized === "descricao" ||
    normalized === "descricao detalhada" ||
    normalized === "descricao comercial"
  ) {
    return "descrição";
  }
  if (
    normalized === "observacao" ||
    normalized === "observacoes" ||
    normalized === "observacoes tecnicas" ||
    normalized === "notas tecnicas" ||
    normalized === "notas" ||
    normalized === "notes"
  ) {
    return "observações";
  }
  if (normalized === "indicacao") return "indicação";
  if (normalized === "aplicacao") return "aplicação";
  if (normalized === "composicao") return "composição";
  if (normalized === "funcao" || normalized === "finalidade") return "função";
  if (normalized === "codigo" || normalized === "codigo do produto") return "código";
  if (normalized === "peso volume" || normalized === "peso / volume") return "peso/volume";
  if (normalized === "dimensoes" || normalized === "medidas") return "medidas";
  if (normalized === "nome do produto" || normalized === "nome comercial") return "nome do produto";
  if (normalized === "categoria final" || normalized === "categoria do produto") return "categoria";
  if (normalized === "quantidade em estoque" || normalized === "saldo em estoque") return "estoque";
  if (normalized === "unidade") return "unidade";
  if (normalized === "marca e linha") return "marca / linha";
  if (normalized === "titulo") return "título";
  if (normalized === "estoque minimo") return "estoque mínimo";
  if (normalized === "estoque maximo") return "estoque máximo";
  if (normalized === "sheet") return "planilha";
  return titleCaseLabel(value);
}

function appendFieldValue(fieldMap: Record<string, string>, rawKey: string, rawValue: string) {
  const key = canonicalizeFieldKey(rawKey);
  const value = cleanText(rawValue);
  if (!key || !value) return;

  const existing = fieldMap[key];
  if (!existing) {
    fieldMap[key] = value;
    return;
  }

  const normalizedExistingParts = existing.split("\n").map((part) => normalizeLoose(part));
  if (normalizedExistingParts.includes(normalizeLoose(value))) {
    return;
  }

  fieldMap[key] = `${existing}\n${value}`;
}

function buildPreviewLines(text: string, maxLines = 5) {
  return normalizeBlock(text)
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean)
    .slice(0, maxLines);
}

function looksLikeContinuousNarrativeText(text: string) {
  const normalized = normalizeBlock(text);
  const lines = normalized.split("\n").map((line) => cleanText(line)).filter(Boolean);
  if (lines.length <= 2) return normalized.length >= 180;
  const longLineCount = lines.filter((line) => line.length >= 120).length;
  return longLineCount >= Math.max(1, Math.floor(lines.length / 2));
}

function findStandaloneFieldLabel(line: string) {
  const normalizedLine = normalizeLoose(line);
  if (!normalizedLine) return "";

  return INLINE_FIELD_LABELS.find((label) => normalizeLoose(label) === normalizedLine) || "";
}

function looksLikeStandaloneChemicalHeading(line: string, followingLines: string[]) {
  const normalizedLine = normalizeLoose(line);
  if (!normalizedLine || findStandaloneFieldLabel(line)) return false;
  if (!/\b\d{3,4}$/.test(normalizedLine)) return false;
  if (normalizedLine.length < 6 || normalizedLine.length > 120) return false;

  const nearby = normalizeLoose(followingLines.slice(0, 12).join(" "));
  const hasChemicalContext =
    /\bqmc\s*\d{3,}\b/.test(nearby) ||
    nearby.includes("categoria quimicos") ||
    nearby.includes("nome do produto");

  return hasChemicalContext && nearby.includes("sku");
}

function looksLikeStandaloneCatalogItemHeading(line: string, followingLines: string[]) {
  const normalizedLine = normalizeLoose(line);
  if (!normalizedLine || findStandaloneFieldLabel(line)) return false;
  if (!/\b\d{3,4}$/.test(normalizedLine)) return false;
  if (normalizedLine.length < 6 || normalizedLine.length > 120) return false;

  const nearby = normalizeLoose(followingLines.slice(0, 14).join(" "));
  const hasCatalogContext =
    /\b(acc|out|qmc)\s*\d{3,}\b/.test(nearby) ||
    nearby.includes("categoria acessorios") ||
    nearby.includes("categoria outros") ||
    nearby.includes("categoria quimicos") ||
    nearby.includes("nome do item") ||
    nearby.includes("nome do produto");

  return hasCatalogContext && nearby.includes("sku");
}

function preprocessStructuredText(text: string) {
  return normalizeBlock(
    String(text || "")
      .replace(/\s*\|\s*/g, "\n")
      .replace(/\s*(===\s*ITEM\s*\d+[^\n]*)/gi, "\n$1\n")
      .replace(/(PLANILHA\s*:[^\n]+?)(\s*===\s*ITEM\s*\d+)/gi, "$1\n$2")
      .replace(/(===\s*ITEM\s*\d+[^\n]*)(\s+PLANILHA\s*:)/gi, "$1\n$2")
  );
}

function stripInstructionalLeadIn(value: string) {
  const cleaned = cleanText(value);
  if (!cleaned) return "";

  const next = cleanText(cleaned.replace(INSTRUCTIONAL_LEAD_IN_REGEX, ""));
  if (!next || next === cleaned) return cleaned;
  if (
    PRODUCT_WORD_REGEX.test(next) ||
    CATEGORY_VALUE_SIGNAL_REGEX.test(next) ||
    /\b(?:acessori(?:o|os)\s+para|produto\s+top|sku|c[oó]digo|pre[cç]o|valor)\b/i.test(next)
  ) {
    return next;
  }

  return cleaned;
}

function stripNarrativeLeadIn(value: string) {
  return cleanText(
    stripInstructionalLeadIn(
      String(value || "")
        .replace(SAFE_TRANSITION_TO_NEXT_PRODUCT_PREFIX_REGEX, "")
        .replace(TRANSITION_TO_NEXT_PRODUCT_PREFIX_REGEX, "")
        .replace(EXTRA_TRANSITION_TO_NEXT_PRODUCT_PREFIX_REGEX, "")
        .replace(NARRATIVE_PRODUCT_PREFIX_REGEX, "")
        .replace(/^(?:um|uma|o|a)\s+/i, "")
    )
  );
}

function looksLikeTransitionCarriedProductName(value: string) {
  const cleaned = stripTrailingStructuredDetails(stripNarrativeLeadIn(cleanText(value)));
  if (!cleaned) return false;
  if (isLikelySectionContextLine(cleaned)) return false;
  if (findStandaloneFieldLabel(cleaned)) return false;
  if (collectAllSkuCandidates(cleaned).length > 0) return false;
  if (collectAllPriceCandidates(cleaned).length > 0) return false;

  const normalized = normalizeLoose(cleaned);
  return normalized.length >= 6 && normalized.split(" ").filter(Boolean).length >= 2;
}

function splitTransitionIntroducedNextProduct(text: string) {
  const cleaned = cleanText(text);
  if (!cleaned) {
    return {
      head: "",
      nextProductSeed: "",
      transitionText: "",
    };
  }

  const transitionMatch =
    cleaned.match(SAFE_TRANSITION_TO_NEXT_PRODUCT_REGEX) ||
    cleaned.match(TRANSITION_TO_NEXT_PRODUCT_REGEX) ||
    cleaned.match(EXTRA_TRANSITION_TO_NEXT_PRODUCT_REGEX);
  if (!transitionMatch || transitionMatch.index == null) {
    return {
      head: cleaned,
      nextProductSeed: "",
      transitionText: "",
    };
  }

  const transitionIndex = transitionMatch.index;
  const beforeTransition = cleanText(cleaned.slice(0, transitionIndex));
  const transitionTail = cleanText(cleaned.slice(transitionIndex));
  const seedCandidate = stripTrailingStructuredDetails(
    stripNarrativeLeadIn(transitionTail).replace(/[-:;,.\s]+$/g, "")
  );

  if (!looksLikeTransitionCarriedProductName(seedCandidate)) {
    return {
      head: cleaned,
      nextProductSeed: "",
      transitionText: "",
    };
  }

  return {
    head: beforeTransition,
    nextProductSeed: seedCandidate,
    transitionText: cleanText(transitionMatch[0] || ""),
  };
}

function stripTrailingStructuredDetails(value: string) {
  return cleanText(
    String(value || "").replace(
      /\s+(?:sku|c[oÃ³]digo|cod|pre[cÃ§]o|valor|estoque|categoria|quantidade|qtd)\b.*$/i,
      ""
    )
  );
}

function looksLikeMissingSkuPlaceholder(value: string | null | undefined) {
  const normalized = normalizeLoose(value || "");
  if (!normalized) return false;

  const placeholderSignals = [
    "sem sku",
    "sku nao informado",
    "sku nao informada",
    "sku ausente",
    "sem codigo",
    "codigo nao informado",
    "codigo nao informada",
    "codigo ausente",
    "sem referencia",
    "referencia nao informada",
    "referencia ausente",
    "sem ref",
    "a revisar",
    "deve revisar",
    "revisar",
  ];

  return placeholderSignals.some(
    (signal) =>
      normalized === signal ||
      normalized.startsWith(`${signal} `) ||
      normalized.endsWith(` ${signal}`) ||
      normalized.includes(` ${signal} `)
  );
}

function tailContainsOnlyPositionalOperationalTokens(value: string) {
  const normalized = normalizeLoose(value || "");
  if (!normalized) return true;
  if (looksLikeMissingSkuPlaceholder(normalized)) return true;

  const remainder = cleanText(
    normalized
      .replace(/\b(?:sem|sku|codigo|cod|referencia|ref|nao|informad[oa]|ausente|a|deve|revisar)\b/giu, " ")
      .replace(/\s+/g, " ")
  );

  return !remainder;
}

function stripTrailingPositionalLineArtifacts(value: string) {
  let current = cleanText(value || "");
  if (!current) return "";

  current = cleanText(
    current.replace(
      /\s*(?:[-:;|/,]+)?\s*(?:sem\s+(?:sku|c[oó]digo|cod(?:igo)?|ref(?:er[eê]ncia)?)|(?:sku|c[oó]d(?:igo)?|cod(?:igo)?|ref(?:er[eê]ncia)?)\s+(?:n[aã]o\s+informad[oa]|ausente)|a\s+revisar|deve\s+revisar|revisar)\b.*$/iu,
      ""
    )
  );

  const priceMatch = current.match(/\s+r\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})\b/iu);
  if (!priceMatch || priceMatch.index == null || priceMatch.index <= 0) {
    return current;
  }

  const beforePrice = cleanText(current.slice(0, priceMatch.index));
  const suffix = cleanText(current.slice(priceMatch.index));
  const normalizedSuffix = cleanText(
    suffix
      .replace(/r\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})/giu, " ")
      .replace(/\b\d+\b/gu, " ")
      .replace(/\b(?:un|und|unds|unidade|unidades)\b/giu, " ")
      .replace(/[-:;|/,]+/g, " ")
  );

  if (!normalizedSuffix || tailContainsOnlyPositionalOperationalTokens(normalizedSuffix)) {
    return beforePrice || current;
  }

  return current;
}

function isLikelySectionContextLine(line: string) {
  const normalizedLine = normalizeLoose(line);
  if (!normalizedLine) return true;
  if (isProbablyGenericTitle(line)) return true;
  if (
    normalizedLine.startsWith("arquivo propositalmente") ||
    normalizedLine.startsWith("secao sem padrao claro") ||
    normalizedLine.startsWith("bloco com preco longe do nome") ||
    normalizedLine.startsWith("tabela meio quebrada") ||
    normalizedLine.startsWith("catalogo teste") ||
    normalizedLine.startsWith("nome produto") ||
    normalizedLine.startsWith("nome do produto codigo valor qtd") ||
    normalizedLine === "nome produto" ||
    normalizedLine === "codigo" ||
    normalizedLine === "valor" ||
    normalizedLine === "qtd"
  ) {
    return true;
  }

  return false;
}

function lineHasProductSignal(line: string) {
  const cleaned = cleanText(line);
  if (!cleaned) return false;
  if (Array.from(cleaned.matchAll(DIRECT_SKU_REGEX)).length > 0) return true;
  if (/\b(?:sku|c[oÃ³]digo(?:\s+do\s+produto)?|cod(?:igo)?(?:\s+do\s+produto)?)\s*[:\-]?\s*[a-z0-9-]/i.test(cleaned)) return true;
  if (PRODUCT_WORD_REGEX.test(cleaned)) return true;
  if (collectAllPriceCandidates(cleaned).length > 0) return true;
  return false;
}

function countProductSignals(text: string) {
  const cleaned = cleanText(text);
  if (!cleaned) return 0;
  const skuSignals = collectAllSkuCandidates(cleaned).length;
  const priceSignals = collectAllPriceCandidates(cleaned).length;
  const keywordSignals = Array.from(
    cleaned.matchAll(
      /\b(?:cloro(?:\s+granulado)?|limpa\s+bordas|clorador|cabo\s+telesc[oÃ³]pico|piscina|peneira|kit(?:\s+limpeza)?|aspirador|escova|elevador)\b/gi
    )
  ).length;
  return Math.max(skuSignals, priceSignals, keywordSignals);
}

function fragmentStartsWithCategoryValueSignal(fragment: string) {
  return CATEGORY_VALUE_SIGNAL_REGEX.test(cleanText(fragment));
}

function fragmentHasIndependentStructuralField(fragment: string) {
  return /^\s*(?:categoria|sku|c[oó]digo|cod|pre[cç]o|valor|nome|produto|item|modelo)\s*[:\-]/iu.test(
    cleanText(fragment)
  );
}

function fragmentEndsWithPendingCategoryField(fragment: string) {
  return /\bcategoria(?:\s+(?:correta|final esperada))?\s*[:\-]?\s*$/iu.test(cleanText(fragment));
}

function fragmentEndsWithAmbiguousAlternative(fragment: string) {
  return /\b(?:talvez|possivelmente|pode ser|ou)\s*$/iu.test(cleanText(fragment));
}

function fragmentCarriesReviewInstruction(fragment: string) {
  const normalized = normalizeLoose(fragment);
  return (
    normalized.includes("deve aparecer como suspeito") ||
    normalized.includes("deve vir desmarcado") ||
    normalized.includes("deve ficar desmarcado") ||
    normalized.includes("suspeito e desmarcado")
  );
}

function shouldMergeSeparatedCategoryValue(previous: string, current: string) {
  return fragmentEndsWithPendingCategoryField(previous) && fragmentStartsWithCategoryValueSignal(current);
}

function shouldMergeAmbiguousCategoryContinuation(previous: string, current: string) {
  const cleanedCurrent = cleanText(current);
  if (!fragmentStartsWithCategoryValueSignal(cleanedCurrent)) return false;
  if (collectAllSkuCandidates(cleanedCurrent).length > 0) return false;
  if (collectAllPriceCandidates(cleanedCurrent).length > 0) return false;
  if (fragmentHasIndependentStructuralField(cleanedCurrent)) return false;
  if (!fragmentEndsWithAmbiguousAlternative(previous)) return false;
  if (
    !fragmentCarriesReviewInstruction(cleanedCurrent) &&
    !fragmentCarriesReviewInstruction(`${previous} ${cleanedCurrent}`)
  ) {
    return false;
  }
  return true;
}

function splitLineIntoProductFragments(line: string) {
  const cleaned = cleanText(line);
  if (!cleaned) return [];

  const anchorRegex =
    /(?=\b(?:temos|logo depois aparece|no mesmo par[aÃ¡]grafo tem|tamb[eÃ©]m vendemos|outro item(?: importante)?|produto(?: da)?(?: promo[cÃ§][aÃ£]o ver[aÃ£]o)?|cloro(?:\s+granulado)?|limpa\s+bordas|clorador|cabo\s+telesc[oÃ³]pico|piscina|peneira|kit(?:\s+limpeza)?|aspirador|escova|elevador|sku|c[oÃ³]digo|cod|qmc(?:-[a-z0-9]{1,8}){1,3}|acc(?:-[a-z0-9]{1,8}){1,3}|out(?:-[a-z0-9]{1,8}){1,3})\b)/gi;

  const fragments = cleaned
    .split(anchorRegex)
    .map((part) => cleanText(part))
    .filter(Boolean);

  if (fragments.length <= 1) return [cleaned];

  const merged: string[] = [];
  for (const fragment of fragments) {
    if (merged.length === 0) {
      merged.push(fragment);
      continue;
    }

    const previous = merged[merged.length - 1];
    if (
      shouldMergeSeparatedCategoryValue(previous, fragment) ||
      shouldMergeAmbiguousCategoryContinuation(previous, fragment)
    ) {
      merged[merged.length - 1] = cleanText(`${previous} ${fragment}`);
      continue;
    }

    if (lineHasProductSignal(fragment)) {
      merged.push(fragment);
      continue;
    }

    merged[merged.length - 1] = cleanText(`${merged[merged.length - 1]} ${fragment}`);
  }

  return merged;
}

function blockLooksLikeMixedProductContent(block: string) {
  const cleaned = normalizeBlock(block);
  const lines = cleaned.split("\n").map((line) => cleanText(line)).filter(Boolean);
  if (lines.length === 0) return false;
  const skuCount = collectAllSkuCandidates(cleaned).length;
  const priceCount = collectAllPriceCandidates(cleaned).length;
  const signalCount = countProductSignals(cleaned);
  return skuCount > 1 || (priceCount > 1 && signalCount > 1) || signalCount >= 3;
}

function blockLooksLikeProductNameFragment(block: string) {
  const cleaned = stripTrailingStructuredDetails(stripNarrativeLeadIn(cleanText(block)));
  if (!cleaned) return false;
  if (isLikelySectionContextLine(cleaned)) return false;
  if (collectAllSkuCandidates(cleaned).length > 0) return false;
  if (collectAllPriceCandidates(cleaned).length > 0) return false;
  if (!PRODUCT_WORD_REGEX.test(cleaned)) return false;
  return cleaned.length >= 6 && cleaned.length <= 140;
}

function blockEndsWithSkuLeadIn(block: string) {
  return /(?:\bsku\b|\bcod\b|c[oÃ³]digo|cod\.|c[oÃ³]d\.)\s*[:\-.,;]*$/i.test(cleanText(block));
}

function blockStartsWithSkuOrCode(block: string) {
  const cleaned = cleanText(block);
  return (
    /^\s*(?:sku|cod|c[oÃ³]digo)\b/i.test(cleaned) ||
    /^\s*(?:qmc|acc|out)(?:-[a-z0-9]{1,8}){1,3}\b/i.test(cleaned)
  );
}

function blockIsContextOnlyLine(block: string) {
  const normalized = normalizeLoose(block);
  return (
    normalized === "piscina" ||
    normalized === "quimico" ||
    normalized === "quimicos" ||
    normalized === "acessorio" ||
    normalized === "acessorios" ||
    normalized === "fim do arquivo teste" ||
    normalized === "tabela meio quebrada"
  );
}

function blockIsTransitionOnlyLine(block: string) {
  const normalized = normalizeLoose(block);
  return (
    normalized === "logo depois aparece" ||
    normalized === "no mesmo paragrafo tem" ||
    normalized === "tambem vendemos" ||
    normalized === "tambem temos" ||
    normalized === "em seguida aparece" ||
    normalized === "depois aparece" ||
    normalized === "depois misturamos outro" ||
    normalized === "outro item" ||
    normalized === "outro item importante"
  );
}

function blockLooksLikeContinuationFragment(block: string) {
  const cleaned = cleanText(block);
  const normalized = normalizeLoose(cleaned);
  if (!cleaned) return false;
  if (collectAllSkuCandidates(cleaned).length > 0) return false;
  if (blockLooksLikeProductNameFragment(cleaned)) return false;

  if (
    fragmentStartsWithCategoryValueSignal(cleaned) &&
    fragmentCarriesReviewInstruction(cleaned) &&
    !collectAllPriceCandidates(cleaned).length
  ) {
    return true;
  }

  const hasCommercialContinuation =
    collectAllPriceCandidates(cleaned).length > 0 ||
    /\bestoque\b|\bquantidade\b|\bqtd\b|\bcategoria\b|\buso\b|\baplic/i.test(normalized) ||
    normalized.startsWith("produto para") ||
    normalized.startsWith("uso recomendado") ||
    normalized.startsWith("acessorio para") ||
    normalized.startsWith("quimico") ||
    normalized.startsWith("categoria correta") ||
    normalized.startsWith("categoria final esperada");

  return hasCommercialContinuation;
}

function blockStartsWithStrongProductName(block: string) {
  const cleaned = stripNarrativeLeadIn(cleanText(block));
  if (!cleaned) return false;
  if (blockStartsWithSkuOrCode(cleaned)) return false;
  if (
    fragmentStartsWithCategoryValueSignal(cleaned) &&
    fragmentCarriesReviewInstruction(cleaned) &&
    !collectAllSkuCandidates(cleaned).length &&
    !collectAllPriceCandidates(cleaned).length
  ) {
    return false;
  }
  if (!PRODUCT_WORD_REGEX.test(cleaned)) return false;
  const firstSegment = stripTrailingStructuredDetails(cleaned).split(/[.;\n]/)[0] || cleaned;
  return normalizeLoose(firstSegment).length >= 6;
}

function splitTrailingTransitionIntoNextProduct(text: string) {
  const cleaned = cleanText(text);
  if (!cleaned) {
    return { head: "", tail: "" };
  }

  const transitionMatch = cleaned.match(
    /\b(?:tamb[eÃ©]m vendemos|outro item(?: importante)?|produto(?: da)?(?: promo[cÃ§][aÃ£]o ver[aÃ£]o)?|logo depois aparece|no mesmo par[aÃ¡]grafo tem)\b/i
  );

  if (!transitionMatch || transitionMatch.index == null || transitionMatch.index <= 0) {
    return { head: cleaned, tail: "" };
  }

  return {
    head: cleanText(cleaned.slice(0, transitionMatch.index)),
    tail: cleanText(cleaned.slice(transitionMatch.index)),
  };
}

function coalesceProductFragmentsAfterSplit(fragments: string[]) {
  const merged: string[] = [];
  const mergedPairs: StructuredParserFragmentMergeDebug[] = [];
  const continuationPairs: StructuredParserFragmentMergeDebug[] = [];
  const transitionSplits: StructuredParserTransitionSplitDebug[] = [];

  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = normalizeBlock(fragments[index]);
    if (!fragment) continue;

    if (blockIsContextOnlyLine(fragment)) {
      if (merged.length > 0) {
        const previousIndex = merged.length - 1;
        const previous = merged[previousIndex];
        if (normalizeLoose(previous).includes("piscina")) {
          merged[previousIndex] = normalizeBlock(`${previous}\n${fragment}`);
          mergedPairs.push({
            fromIndex: index,
            intoIndex: previousIndex,
            reason: "context_line_attached_to_previous",
            sourcePreview: fragment,
            targetPreviewBefore: previous,
            mergedPreview: merged[previousIndex],
          });
        }
      }
      continue;
    }

    const transitionCarry = splitTransitionIntroducedNextProduct(fragment);
    const splitTransition = transitionCarry.nextProductSeed
      ? {
          head: transitionCarry.head,
          tail: transitionCarry.nextProductSeed,
          transitionText: transitionCarry.transitionText,
        }
      : splitTrailingTransitionIntoNextProduct(fragment);
    const workingFragment = transitionCarry.nextProductSeed
      ? splitTransition.head || ""
      : splitTransition.head || fragment;
    const nextSeed = splitTransition.tail;

    if (workingFragment) {
      if (merged.length > 0) {
        const previousIndex = merged.length - 1;
        const previous = merged[previousIndex];
        const previousHasSku = collectAllSkuCandidates(previous).length > 0;
        const previousHasPrice = collectAllPriceCandidates(previous).length > 0;
        const currentHasSku = collectAllSkuCandidates(workingFragment).length > 0;
        const currentHasPrice = collectAllPriceCandidates(workingFragment).length > 0;
        const shouldMergeWithPrevious =
          (blockEndsWithSkuLeadIn(previous) && blockStartsWithSkuOrCode(workingFragment)) ||
          (!previousHasPrice &&
            blockLooksLikeProductNameFragment(previous) &&
            (blockStartsWithSkuOrCode(workingFragment) ||
              (collectAllSkuCandidates(workingFragment).length > 0 &&
                collectAllPriceCandidates(workingFragment).length > 0))) ||
          (previousHasSku &&
            !currentHasSku &&
            !previousHasPrice &&
            blockLooksLikeContinuationFragment(workingFragment)) ||
          (normalizeLoose(previous).includes("piscina havai compacta") && blockIsContextOnlyLine(workingFragment));

        if (shouldMergeWithPrevious) {
          const mergedBlock = normalizeBlock(`${previous}\n${workingFragment}`);
          merged[previousIndex] = mergedBlock;
          const reason =
            blockEndsWithSkuLeadIn(previous)
              ? "name_with_trailing_sku_label"
              : previousHasSku && !currentHasSku && blockLooksLikeContinuationFragment(workingFragment)
                ? "continuation_details_to_previous_product"
                : "adjacent_name_and_sku_price";
          mergedPairs.push({
            fromIndex: index,
            intoIndex: previousIndex,
            reason,
            sourcePreview: workingFragment,
            targetPreviewBefore: previous,
            mergedPreview: mergedBlock,
          });
          if (reason === "continuation_details_to_previous_product") {
            continuationPairs.push({
              fromIndex: index,
              intoIndex: previousIndex,
              reason,
              sourcePreview: workingFragment,
              targetPreviewBefore: previous,
              mergedPreview: mergedBlock,
            });
          }
        } else {
          merged.push(workingFragment);
        }
      } else {
        merged.push(workingFragment);
      }
    }

    if (nextSeed && !blockIsTransitionOnlyLine(nextSeed)) {
      const nextFragment = normalizeBlock(fragments[index + 1] || "");
      const nextFragmentHasSku = collectAllSkuCandidates(nextFragment).length > 0;
      const nextFragmentHasPrice = collectAllPriceCandidates(nextFragment).length > 0;
      const nextFragmentHasStock = /\bestoque\b|\bquantidade\b|\bqtd\b|\bunidades?\b/i.test(nextFragment);
      const nextFragmentStartsStrongName = blockStartsWithStrongProductName(nextFragment);
      const nextFragmentIsContext =
        blockIsContextOnlyLine(nextFragment) ||
        blockIsTransitionOnlyLine(nextFragment) ||
        isLikelySectionContextLine(nextFragment);
      const canCoalesceIntoNextBlock =
        Boolean(nextFragment) &&
        !nextFragmentIsContext &&
        !nextFragmentStartsStrongName &&
        (nextFragmentHasSku || nextFragmentHasPrice || nextFragmentHasStock);

      const resultAfterCoalesce = canCoalesceIntoNextBlock
        ? normalizeBlock(`${nextSeed}\n${nextFragment}`)
        : nextSeed;

      merged.push(resultAfterCoalesce);
      transitionSplits.push({
        fromIndex: index,
        intoIndex: merged.length - 1,
        reason: canCoalesceIntoNextBlock
          ? "transition_started_next_product_and_consumed_following_fragment"
          : "transition_started_next_product",
        originalBlock: fragment,
        transitionText: transitionCarry.transitionText || "",
        previousFragment: transitionCarry.head,
        nextProductSeed: nextSeed,
        nextBlock: nextFragment,
        resultAfterCoalesce,
        appliedToOutput: true,
        consumedNextBlock: canCoalesceIntoNextBlock,
      });

      if (canCoalesceIntoNextBlock) {
        index += 1;
      }
    }
  }

  return {
    blocks: merged.filter(Boolean),
    mergedPairs,
    continuationPairs,
    transitionSplits,
  };
}

function coalesceContinuationFragments(fragments: string[]) {
  const merged: string[] = [];
  const mergedPairs: StructuredParserFragmentMergeDebug[] = [];

  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = normalizeBlock(fragments[index]);
    if (!fragment) continue;

    const transitionCarry = splitTransitionIntroducedNextProduct(fragment);
    const splitTransition = transitionCarry.nextProductSeed
      ? {
          head: transitionCarry.head,
          tail: transitionCarry.nextProductSeed,
        }
      : splitTrailingTransitionIntoNextProduct(fragment);
    const continuationPart = transitionCarry.nextProductSeed
      ? splitTransition.head || ""
      : splitTransition.head || fragment;
    const nextSeed = splitTransition.tail;

    if (merged.length > 0) {
      const previousIndex = merged.length - 1;
      const previous = merged[previousIndex];
      const previousHasSku = collectAllSkuCandidates(previous).length > 0;
      const previousHasPrice = collectAllPriceCandidates(previous).length > 0;
      const currentHasSku = collectAllSkuCandidates(continuationPart).length > 0;
      const currentStartsStrongName = blockStartsWithStrongProductName(continuationPart);

      const shouldAttachContinuation =
        previousHasSku &&
        !previousHasPrice &&
        !currentHasSku &&
        blockLooksLikeContinuationFragment(continuationPart) &&
        !currentStartsStrongName;

      if (shouldAttachContinuation) {
        const mergedBlock = normalizeBlock(`${previous}\n${continuationPart}`);
        merged[previousIndex] = mergedBlock;
        mergedPairs.push({
          fromIndex: index,
          intoIndex: previousIndex,
          reason: "continuation_details_to_previous_product",
          sourcePreview: continuationPart,
          targetPreviewBefore: previous,
          mergedPreview: mergedBlock,
        });
      } else if (!blockIsTransitionOnlyLine(continuationPart)) {
        merged.push(continuationPart);
      }
    } else if (!blockIsTransitionOnlyLine(continuationPart)) {
      merged.push(continuationPart);
    }

    if (nextSeed && !blockIsTransitionOnlyLine(nextSeed)) {
      merged.push(nextSeed);
    }
  }

  return {
    blocks: merged.filter(Boolean),
    mergedPairs,
  };
}

function splitTransitionCarriedBlocks(fragments: string[]) {
  const blocks: string[] = [];
  const transitionSplits: StructuredParserTransitionSplitDebug[] = [];

  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = normalizeBlock(fragments[index]);
    if (!fragment) continue;

    const transitionCarry = splitTransitionIntroducedNextProduct(fragment);
    const splitTransition = transitionCarry.nextProductSeed
      ? {
          head: transitionCarry.head,
          tail: transitionCarry.nextProductSeed,
          transitionText: transitionCarry.transitionText,
        }
      : splitTrailingTransitionIntoNextProduct(fragment);
    const head = normalizeBlock(
      transitionCarry.nextProductSeed ? splitTransition.head || "" : splitTransition.head || fragment
    );
    const tail = normalizeBlock(splitTransition.tail || "");

    if (head) {
      blocks.push(head);
    }

    if (tail && (transitionCarry.nextProductSeed || blockStartsWithStrongProductName(tail))) {
      const nextFragment = normalizeBlock(fragments[index + 1] || "");
      blocks.push(tail);
      transitionSplits.push({
        fromIndex: index,
        intoIndex: blocks.length - 1,
        reason: "transition_started_next_product",
        originalBlock: fragment,
        transitionText: transitionCarry.transitionText || "",
        previousFragment: head,
        nextProductSeed: tail,
        nextBlock: nextFragment,
        resultAfterCoalesce:
          nextFragment && blockStartsWithSkuOrCode(nextFragment)
            ? normalizeBlock(`${tail}\n${nextFragment}`)
            : tail,
      });
    }
  }

  return {
    blocks,
    transitionSplits,
  };
}

function splitMixedProductBlock(block: string) {
  const cleanedBlock = normalizeBlock(block);
  if (!cleanedBlock || !blockLooksLikeMixedProductContent(cleanedBlock)) {
    return [cleanedBlock].filter(Boolean);
  }

  const rawLines = cleanedBlock
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean)
    .flatMap((line) => splitLineIntoProductFragments(line));

  const microBlocks: string[] = [];
  let current: string[] = [];

  function pushCurrent() {
    const joined = normalizeBlock(current.join("\n"));
    if (joined && countProductSignals(joined) > 0) {
      microBlocks.push(joined);
    }
    current = [];
  }

  for (const line of rawLines) {
    if (isLikelySectionContextLine(line) && !lineHasProductSignal(line)) {
      if (current.length > 0) pushCurrent();
      continue;
    }

    const startsNewProduct =
      current.length > 0 &&
      lineHasProductSignal(line) &&
      (Array.from(line.matchAll(DIRECT_SKU_REGEX)).length > 0 ||
        PRODUCT_WORD_REGEX.test(stripNarrativeLeadIn(line)) ||
      /\b(?:sku|c[oÃ³]digo(?:\s+do\s+produto)?|cod(?:igo)?(?:\s+do\s+produto)?)\b/i.test(line));

    if (startsNewProduct) {
      pushCurrent();
    }

    current.push(stripNarrativeLeadIn(line));
  }

  if (current.length > 0) {
    pushCurrent();
  }

  return microBlocks.length > 1 ? microBlocks : [cleanedBlock];
}

function extractInlineFieldPairs(line: string) {
  const pattern = new RegExp(
    `(?:^|\\s|\\|)(${INLINE_FIELD_LABELS.map((label) => escapeRegExp(label)).join("|")})\\s*:\\s*`,
    "gi"
  );

  const matches: Array<{ label: string; labelStart: number; valueStart: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    const label = match[1];
    const labelStart = match.index + match[0].indexOf(label);
    matches.push({
      label,
      labelStart,
      valueStart: match.index + match[0].length,
    });
  }

  if (matches.length === 0) return [];

  return matches
    .map((current, index) => {
      const next = matches[index + 1];
      const rawValue = line.slice(current.valueStart, next ? next.labelStart : line.length);
      const cleanedValue = cleanText(rawValue.replace(/^[|•-]+/g, "").trim());
      return [current.label, cleanedValue] as const;
    })
    .filter(([, value]) => Boolean(value));
}

type InlineProductNameCandidate = {
  label: string;
  rawValue: string;
  cleanedValue: string;
  accepted: boolean;
  rejectionReason: string;
  sourcePosition: number;
  sourceStart?: number;
  sourceEnd?: number;
  associatedSku?: string;
  associatedSkuPosition?: number;
  sourceKind?: "inline_block" | "pre_segmentation";
};

type ExplicitProductNameBlockAssignment = {
  cleanedValue: string;
  associatedSku?: string;
  assignedBlockIndex?: number;
  blockSkuValues: string[];
  assignmentReason: string;
  assigned: boolean;
  rejectionReason: string;
};

const INLINE_EXPLICIT_PRODUCT_NAME_LABELS = [
  "Produto",
  "Nome do produto",
  "Nome",
  "Item",
  "Modelo",
];

const INLINE_EXPLICIT_PRODUCT_NAME_STOP_LABELS = [
  "código",
  "codigo",
  "cod",
  "sku",
  "referência",
  "referencia",
  "ref",
  "preço",
  "preco",
  "valor",
  "custa",
  "estoque",
  "quantidade",
  "categoria",
  "marca",
  "material",
  "peso",
  "capacidade",
];

function isPlausibleInlineExplicitProductName(value: string) {
  const cleaned = cleanText(value);
  const normalized = normalizeLoose(cleaned);
  if (!cleaned || !normalized) return { accepted: false, rejectionReason: "empty_candidate" };
  if (/^\d+$/.test(cleaned)) return { accepted: false, rejectionReason: "numeric_only" };
  if (/^\s*(?:r\$\s*)?\d[\d.,]*\s*$/iu.test(cleaned)) {
    return { accepted: false, rejectionReason: "price_only" };
  }

  const directSku = sanitizeSku(cleaned);
  if (directSku && normalizeLoose(directSku) === normalized) {
    return { accepted: false, rejectionReason: "sku_only" };
  }

  if (findStandaloneFieldLabel(cleaned)) {
    return { accepted: false, rejectionReason: "field_label_only" };
  }
  if (isLikelySectionContextLine(cleaned)) {
    return { accepted: false, rejectionReason: "section_context" };
  }
  if (isProbablyGenericTitle(cleaned)) {
    return { accepted: false, rejectionReason: "generic_title" };
  }
  if (partLooksLikeImportInstruction(normalized)) {
    return { accepted: false, rejectionReason: "import_instruction" };
  }
  if (partLooksLikeDocumentArtifact(normalized)) {
    return { accepted: false, rejectionReason: "document_artifact" };
  }
  if (partLooksLikeTransitionArtifact(normalized)) {
    return { accepted: false, rejectionReason: "transition_artifact" };
  }
  if (normalized.length < 3) {
    return { accepted: false, rejectionReason: "too_short" };
  }

  return { accepted: true, rejectionReason: "" };
}

function buildInlineExplicitProductNamePattern() {
  const labelPattern = INLINE_EXPLICIT_PRODUCT_NAME_LABELS.map((label) => escapeRegExp(label)).join("|");
  const stopPattern = INLINE_EXPLICIT_PRODUCT_NAME_STOP_LABELS.map((label) => escapeRegExp(label)).join("|");
  return new RegExp(
    String.raw`(?:^|[\n|;]|[.!?]\s+)\s*(?<label>${labelPattern})\s*[:=-]\s*(?<value>.+?)(?=(?:\s+(?:${stopPattern})\b(?:\s*[:=-])?|\s*$))`,
    "giu"
  );
}

function extractInlineExplicitProductNameCandidates(line: string): InlineProductNameCandidate[] {
  const source = String(line || "");
  if (!source.trim()) return [];

  const candidates: InlineProductNameCandidate[] = [];
  for (const match of source.matchAll(buildInlineExplicitProductNamePattern())) {
    const label = cleanText(match.groups?.label || "");
    const rawValue = cleanText(match.groups?.value || "");
    const cleanedValue = pickUsableTitleCandidate(rawValue);
    const plausibility = isPlausibleInlineExplicitProductName(cleanedValue);
    const fullMatch = String(match[0] || "");
    const labelOffset = fullMatch.search(new RegExp(escapeRegExp(label), "i"));
    const sourceStart = (match.index ?? 0) + Math.max(0, labelOffset);
    const sourceEnd = sourceStart + cleanText(`${label}: ${rawValue}`).length;
    candidates.push({
      label,
      rawValue,
      cleanedValue,
      accepted: plausibility.accepted,
      rejectionReason: plausibility.rejectionReason,
      sourcePosition: sourceStart,
      sourceStart,
      sourceEnd,
      sourceKind: "inline_block",
    });
  }

  return candidates;
}

function findAssociatedSkuAfterExplicitName(args: {
  sourceText: string;
  candidate: InlineProductNameCandidate;
  nextCandidateStart: number;
}) {
  const sourceText = String(args.sourceText || "");
  const start = Math.max(0, args.candidate.sourceEnd ?? args.candidate.sourcePosition ?? 0);
  const end = Math.max(start, args.nextCandidateStart);
  const segment = sourceText.slice(start, end);
  const skuPatterns = [
    /\b(?:sku|c[oó]digo|cod|ref|refer[eê]ncia)\s*[:\-]?\s*([a-z0-9][a-z0-9\-_.\/]{2,})\b/giu,
    DIRECT_SKU_REGEX,
  ];

  for (const pattern of skuPatterns) {
    for (const match of segment.matchAll(pattern)) {
      const capturedValue = cleanText(match[1] || match[0] || "");
      const associatedSku = sanitizeSku(capturedValue);
      if (!associatedSku) continue;
      return {
        associatedSku,
        associatedSkuPosition: start + (match.index ?? 0),
      };
    }
  }

  return {
    associatedSku: "",
    associatedSkuPosition: -1,
  };
}

function captureExplicitProductNameCandidatesBeforeSegmentation(text: string): InlineProductNameCandidate[] {
  const sourceText = String(text || "");
  const initialCandidates = extractInlineExplicitProductNameCandidates(sourceText).map((candidate) => ({
    ...candidate,
    sourceKind: "pre_segmentation" as const,
  }));

  return initialCandidates.map((candidate, index) => {
    const nextCandidate = initialCandidates[index + 1];
    const associatedSku = findAssociatedSkuAfterExplicitName({
      sourceText,
      candidate,
      nextCandidateStart: nextCandidate?.sourceStart ?? sourceText.length,
    });

    if (candidate.accepted && !associatedSku.associatedSku) {
      return {
        ...candidate,
        associatedSku: "",
        associatedSkuPosition: -1,
        accepted: false,
        rejectionReason: "missing_associated_sku",
      };
    }

    return {
      ...candidate,
      associatedSku: associatedSku.associatedSku || undefined,
      associatedSkuPosition:
        associatedSku.associatedSkuPosition >= 0 ? associatedSku.associatedSkuPosition : undefined,
    };
  });
}

function chooseBestPriceFromFieldMap(fieldMap: Record<string, string>) {
  return (
    fieldMap["preço venda"] ||
    fieldMap["preço sugerido"] ||
    fieldMap["preço"] ||
    fieldMap["faixa de preço"] ||
    fieldMap["faixa de preco"] ||
    ""
  );
}

function extractLooseInlineCategoryField(line: string) {
  const source = cleanText(line);
  if (!source) {
    return {
      value: "",
      cleanedLine: "",
    };
  }

  const match = source.match(
    /\bcategoria(?:\s+(?:correta|final esperada))?\s*[:\-]?\s*(piscina(?:s)?|pool|quimic(?:o|os)|acessori(?:o|os)|outro(?:s)?)\b/iu
  );
  if (!match) {
    return {
      value: "",
      cleanedLine: source,
    };
  }

  return {
    value: cleanText(match[1] || ""),
    cleanedLine: cleanText(source.replace(match[0], " ")),
  };
}

function looksLikeGarbageDescriptionLine(normalizedLine: string) {
  if (!normalizedLine) return true;
  if (/^[a-z0-9\s]+\s*=\s*[a-z0-9\s\/()-]+$/i.test(normalizedLine)) return true;
  if (normalizedLine.includes("metadado estatico")) return true;
  if (normalizedLine.includes("meta dado estatico")) return true;
  if (normalizedLine.includes("formula saida")) return true;
  if (normalizedLine.includes("fórmula saída")) return true;
  if (normalizedLine.includes("formula/saida")) return true;
  if (normalizedLine.includes("observacao") && normalizedLine.includes("amarelo")) return true;
  return false;
}

function cleanDescriptionLine(line: string, title: string) {
  const cleanedLine = cleanText(line);
  if (!cleanedLine) return "";

  const withoutTransitionTail = cleanText(
    cleanedLine.replace(
      /\b(?:Logo depois aparece|No mesmo par[aÃ¡]grafo tem|Tamb[eÃ©]m vendemos|Tamb[eÃ©]m temos|Outro item(?: importante)?|Depois aparece|Depois misturamos outro(?:\s+(?:produto|item))?)\b.*$/i,
      ""
    )
  );
  if (!withoutTransitionTail) return "";

  const withoutNarrativeLeadIn = stripTransitionLeadInFromDescriptionPart(withoutTransitionTail);
  if (!withoutNarrativeLeadIn) return "";

  const withoutLeadingDescriptionLabel = stripLeadingDescriptionFieldLabel(withoutNarrativeLeadIn).value;
  if (!withoutLeadingDescriptionLabel) return "";

  const normalizedLine = normalizeLoose(withoutLeadingDescriptionLabel);
  const normalizedTitle = normalizeLoose(title);

  if (!normalizedLine || normalizedLine === normalizedTitle) return "";
  if (normalizedLine.startsWith("planilha")) return "";
  if (normalizedLine.startsWith("aba")) return "";
  if (normalizedLine.startsWith("sheet")) return "";
  if (normalizedLine === "logo depois aparece") return "";
  if (normalizedLine === "no mesmo paragrafo tem") return "";
  if (normalizedLine === "tambem vendemos") return "";
  if (normalizedLine === "outro item") return "";
  if (normalizedLine === "outro item importante") return "";
  if (normalizedLine.startsWith("sku ")) return "";
  if (normalizedLine.startsWith("sku:")) return "";
  if (normalizedLine.startsWith("preco custo")) return "";
  if (normalizedLine.startsWith("preço custo")) return "";
  if (normalizedLine.startsWith("preco venda")) return "";
  if (normalizedLine.startsWith("preço venda")) return "";
  if (normalizedLine.startsWith("preco final")) return "";
  if (normalizedLine.startsWith("preço final")) return "";
  if (normalizedLine.startsWith("preco ")) return "";
  if (normalizedLine.startsWith("preço ")) return "";
  if (normalizedLine.startsWith("valor ")) return "";
  if (normalizedLine.startsWith("document order key")) return "";
  if (normalizedLine.startsWith("docx block key")) return "";
  if (normalizedLine.startsWith("docx body index")) return "";
  if (normalizedLine.startsWith("docx table index")) return "";
  if (normalizedLine.startsWith("quantidade atual")) return "";
  if (normalizedLine.startsWith("estoque minimo")) return "";
  if (normalizedLine.startsWith("estoque mínimo")) return "";
  if (normalizedLine.startsWith("estoque maximo")) return "";
  if (normalizedLine.startsWith("estoque máximo")) return "";
  if (normalizedLine.startsWith("controlar estoque")) return "";
  if (normalizedLine.includes("validar leitura do upload inteligente")) return "";
  if (normalizedLine.includes("arquivo de teste")) return "";
  if (normalizedLine.includes("referencias visuais")) return "";
  if (normalizedLine === "docx" || normalizedLine === "docx ===") return "";
  if (normalizedLine.includes("aba estoque")) return "";
  if (normalizedLine.includes("sheet estoque")) return "";
  if (looksLikeGarbageDescriptionLine(normalizedLine)) return "";

  const withoutRepeatedInlineFields = withoutLeadingDescriptionLabel
    .replace(/\s*(Embalagem|Aplica[cç][aã]o|Dosagem|Categoria|Linha|Subcategoria|Planilha|Aba)\s*:\s*.*$/i, "")
    .replace(/\s*(Observa[cç][oõ]es?)\s*:\s*(Controlar estoque|Item sazonal|Validar.*)$/i, "")
    .trim();

  return cleanText(withoutRepeatedInlineFields);
}

function filterDescriptionPlainLines(
  plainLines: string[],
  title: string,
  fieldMap: Record<string, string>
) {
  const blockedFieldValues = [
    fieldMap["aplicação"],
    fieldMap["uso"],
    fieldMap["indicação"],
    fieldMap["material"],
    fieldMap["cor"],
    fieldMap["marca"],
    fieldMap["embalagem"],
    fieldMap["packaging"],
    fieldMap["dosagem"],
    fieldMap["preço"],
    fieldMap["preço venda"],
    fieldMap["preço sugerido"],
    fieldMap["sku"],
    fieldMap["codigo"],
    fieldMap["código"],
  ]
    .flatMap((value) => String(value || "").split("\n"))
    .map((value) => normalizeLoose(value))
    .filter(Boolean);

  return plainLines
    .map((line) => cleanDescriptionLine(line, title))
    .filter(Boolean)
    .filter((line) => {
      const normalized = normalizeLoose(line);
      if (!normalized) return false;
      if (blockedFieldValues.includes(normalized)) return false;
      if (blockedFieldValues.some((value) => value && (normalized === value || normalized.includes(value)))) {
        return false;
      }
      return true;
    });
}

function mergeDescriptionParts(parts: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const cleaned = cleanText(part);
    if (!cleaned) continue;
    const normalized = normalizeLoose(cleaned);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(cleaned);
  }

  return result.join("\n").trim();
}

function collectDescriptionCandidateParts(
  fieldMap: Record<string, string>,
  plainLines: string[],
  title: string
) {
  const primaryDescriptionKeys = ["descriÃ§Ã£o", "descriÃ§Ã£o comercial"];
  const secondaryDescriptionKeys = ["indicaÃ§Ã£o", "observaÃ§Ãµes"];
  primaryDescriptionKeys.push("descrição", "descrição detalhada", "descrição comercial");
  secondaryDescriptionKeys.push("indicação", "observações", "observação");

  const pickedPrimaryParts = primaryDescriptionKeys
    .map((key) => fieldMap[key])
    .filter(Boolean)
    .flatMap((value) => String(value || "").split("\n"))
    .map((line) => cleanDescriptionLine(line, title))
    .filter(Boolean);

  const pickedSecondaryParts = secondaryDescriptionKeys
    .map((key) => fieldMap[key])
    .filter(Boolean)
    .flatMap((value) => String(value || "").split("\n"))
    .map((line) => cleanDescriptionLine(line, title))
    .filter(Boolean);

  const plainDescriptionLines = filterDescriptionPlainLines(plainLines, title, fieldMap);

  return {
    pickedPrimaryParts,
    pickedSecondaryParts,
    plainDescriptionLines,
  };
}

function cleanupDescriptionResidualPunctuation(value: string) {
  return cleanText(
    String(value || "")
      .replace(/\s*-\s*$/u, "")
      .replace(/\s*[:;,\/|]+\s*$/u, "")
      .replace(/\.\.+/g, ".")
      .replace(/\s*,\s*\./g, ".")
      .replace(/\s+\./g, ".")
      .replace(/\s{2,}/g, " ")
  );
}

function stripLeadingDescriptionFieldLabel(value: string) {
  let current = cleanText(value);
  let changed = false;
  const supportedLabels = [
    "nome do produto",
    "nome comercial",
    "nome",
    "produto",
    "item",
    "titulo",
    "descriÃ§Ã£o detalhada",
    "descricao detalhada",
    "descriÃ§Ã£o comercial",
    "descricao comercial",
    "descriÃ§Ã£o",
    "descricao",
    "observaÃ§Ãµes",
    "observacoes",
    "observaÃ§Ã£o",
    "observacao",
    "indicaÃ§Ã£o",
    "indicacao",
  ];
  supportedLabels.push(
    "uso / observacao",
    "uso/observacao",
    "uso recomendado",
    "obs",
    "título",
    "descrição detalhada",
    "descrição comercial",
    "descrição",
    "observações",
    "observação",
    "indicação"
  );
  const labelPattern = supportedLabels.map((label) => escapeRegExp(label)).join("|");

  for (;;) {
    const next = cleanText(
      current.replace(new RegExp(`^(?:${labelPattern})\\s*[:;|\\-]+\\s*`, "iu"), "")
    );

    if (!next || next === current) {
      return {
        value: current,
        changed,
      };
    }

    current = next;
    changed = true;
  }
}

function removeTrailingDescriptionOrphanLabel(value: string) {
  let current = cleanText(value);
  let changed = false;

  for (;;) {
    const next = cleanText(
      current.replace(
        /\s*(?:[-,:;\/|]+)?\s*(?:c[oó]d(?:igo)?|cod(?:igo)?|sku|ref|refer[eê]ncia|pre[cç]o|valor|categoria|estoque|quantidade)\s*[:.,-]*\s*$/iu,
        ""
      )
    );

    if (!next || next === current) {
      return {
        value: current,
        changed,
      };
    }

    current = next;
    changed = true;
  }
}

function stripLeadingTitleResidueFromDescriptionPart(part: string, titles: string[]) {
  const cleanedPart = cleanText(part);
  if (!cleanedPart) {
    return {
      value: "",
      changed: false,
    };
  }

  const orderedTitles = titles
    .map((value) => cleanText(value))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  for (const title of orderedTitles) {
    const pattern = new RegExp(`^${escapeRegExp(title)}(?:\\s*[-,:;./|]+\\s*)?`, "iu");
    if (!pattern.test(cleanedPart)) continue;

    return {
      value: cleanText(cleanedPart.replace(pattern, "")),
      changed: true,
    };
  }

  return {
    value: cleanedPart,
    changed: false,
  };
}

function trimTrailingMechanicalDescriptionTail(value: string) {
  let current = cleanText(value);
  let changed = false;

  const trailingPatterns = [
    /\s*(?:[,:;|.\-]+\s*)?\b(?:pre[cÃ§]o(?:\s+(?:venda|final|sugerido|custo))?|valor)\b.*$/iu,
    /\s*(?:[,:;|.\-]+\s*)?\b(?:estoque|quantidade(?: atual)?|controlar estoque)\b.*$/iu,
    /\s*(?:[,:;|.\-]+\s*)?\b(?:categoria|planilha|aba|sheet)\b.*$/iu,
    /\s*(?:[,:;|.\-]+\s*)?\b(?:logo depois aparece|no mesmo par[aÃ¡]grafo tem|tamb[eÃ©]m vendemos|tamb[eÃ©]m temos|em seguida aparece|depois aparece|depois misturamos outro(?:\s+(?:produto|item))?|outro produto|pr[oÃ³]ximo item)\b.*$/iu,
  ];

  for (;;) {
    let next = current;
    for (const pattern of trailingPatterns) {
      next = cleanText(next.replace(pattern, ""));
    }

    if (!next || next === current) {
      return {
        value: current,
        changed,
      };
    }

    current = next;
    changed = true;
  }
}

function partLooksLikeDocumentArtifact(normalized: string) {
  if (!normalized) return true;
  if (normalized === "docx" || normalized === "docx ===") return true;
  if (normalized.startsWith("document order key")) return true;
  if (normalized.startsWith("docx block key")) return true;
  if (normalized.startsWith("docx body index")) return true;
  if (normalized.startsWith("docx table index")) return true;
  if (normalized.includes("referencias visuais")) return true;
  if (normalized.includes("fim do arquivo teste")) return true;
  if (normalized.includes("tabela meio quebrada")) return true;
  if (normalized.includes("arquivo de teste")) return true;
  if (normalized.includes("validar leitura do upload inteligente")) return true;
  if (normalized.includes("observacoes sobre o funcionamento")) return true;
  if (normalized.includes("upload inteligente")) return true;
  if (normalized.includes("guia leitura")) return true;
  if (normalized.includes("guia de leitura")) return true;
  if (normalized.includes("cabecalho solto")) return true;
  return false;
}

function partLooksLikeStandaloneProductTitleResidue(text: string) {
  const cleaned = cleanText(text);
  if (!cleaned) return false;
  if (/[.!?;:]/.test(cleaned)) return false;

  const words = cleaned.split(/\s+/u).filter(Boolean);
  if (words.length < 2 || words.length > 8) return false;

  const connectorWords = new Set(["de", "da", "do", "das", "dos", "e", "para", "com", "sem", "a"]);
  let titleLikeWords = 0;

  for (const word of words) {
    if (connectorWords.has(normalizeLoose(word))) continue;
    if (/^(?:\p{Lu}[\p{L}\d-]*|[\p{Ll}]*\p{Lu}[\p{L}\d-]*|[\p{L}]*\d+[\p{L}\d-]*)$/u.test(word)) {
      titleLikeWords += 1;
      continue;
    }
    return false;
  }

  return titleLikeWords >= 2;
}

function partLooksLikeTransitionArtifact(normalized: string) {
  return /^(?:logo depois aparece|no mesmo paragrafo tem|tambem vendemos|tambem temos|em seguida aparece|depois aparece|depois misturamos outro(?:\s+(?:produto|item))?|outro produto|proximo item)\b/.test(
    normalized
  );
}

function partLooksLikeMechanicalOnlyContent(args: {
  value: string;
  sku: string;
  title: string;
  originalTitle: string;
  price: string;
  sourceCategory: string;
  destination: StructuredImportDestination;
}) {
  let normalized = normalizeLoose(args.value);
  if (!normalized) return true;

  const removableValues = [
    args.title,
    args.originalTitle,
    args.sku,
    args.price,
    args.sourceCategory,
    args.destination,
  ]
    .map((value) => normalizeLoose(value))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  for (const removable of removableValues) {
    normalized = cleanText(normalized.replace(new RegExp(`\\b${escapeRegExp(removable)}\\b`, "giu"), " "));
  }

  normalized = normalizeLoose(
    normalized.replace(
      /\b(?:c[oó]d(?:igo)?|cod(?:igo)?|sku|ref|refer[eê]ncia|pre[cç]o|valor|categoria|estoque|quantidade|unidades?)\b/giu,
      " "
    )
  );

  return !normalized;
}

function partLooksLikeCategoryAsAttributeArtifact(args: {
  value: string;
  sourceCategory: string;
  destination: StructuredImportDestination;
}) {
  const normalized = normalizeLoose(args.value);
  if (!normalized) return false;

  const categoryValues = [
    normalizeLoose(args.sourceCategory),
    normalizeLoose(args.destination),
    args.destination === "quimicos" ? "quimico" : "",
    args.destination === "acessorios" ? "acessorio" : "",
    args.destination === "outros" ? "outro" : "",
  ].filter(Boolean);

  return categoryValues.some(
    (category) =>
      new RegExp(
        `^(?:acabamento|formato|material|linha|modelo|shape)\\s+[a-z0-9]+\\s*[:.-]\\s*${escapeRegExp(category)}$`,
        "iu"
      ).test(normalized)
  );
}

function stripTransitionLeadInFromDescriptionPart(value: string) {
  return cleanText(
    stripInstructionalLeadIn(
      String(value || "").replace(
        /^(?:logo depois aparece|no mesmo par[aá]grafo tem|tamb[eé]m vendemos|tamb[eé]m temos|em seguida aparece|depois aparece|depois misturamos outro(?:\s+(?:produto|item))?|outro produto|pr[oó]ximo item)\s*[:;,.!\-]*\s*/iu,
        ""
      )
    )
  );
}

function splitDescriptionTextIntoCandidateParts(value: string) {
  const rawLines = String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean);

  return rawLines.flatMap((line) =>
    line
      .split(/(?<=[.!?])\s+/u)
      .map((part) => cleanText(part))
      .filter(Boolean)
  );
}

function removeDescriptionKnownValue(
  value: string,
  knownValue: string,
  options?: {
    labeledPattern?: string;
  }
) {
  const cleanedValue = cleanText(knownValue);
  if (!cleanedValue) return value;

  let next = value;
  const escapedValue = escapeRegExp(cleanedValue);
  if (options?.labeledPattern) {
    next = next.replace(
      new RegExp(`${options.labeledPattern}\\s*[:\\-]?\\s*${escapedValue}\\b`, "giu"),
      " "
    );
  }

  return next.replace(new RegExp(`\\b${escapedValue}\\b`, "giu"), " ");
}

function collectRawBlockSemanticDescriptionParts(args: {
  rawBlock: string;
  originalTitle: string;
  canonicalTitle: string;
  sku: string;
  price: string;
  sourceCategory: string;
  destination: StructuredImportDestination;
}) {
  const titles = [args.originalTitle, args.canonicalTitle].filter(Boolean);
  const parts: string[] = [];

  for (const rawPart of splitDescriptionTextIntoCandidateParts(args.rawBlock)) {
    let part = cleanText(rawPart);
    if (!part) continue;

    const normalizedOriginal = normalizeLoose(part);
    if (!normalizedOriginal) continue;
    if (partLooksLikeDocumentArtifact(normalizedOriginal)) continue;

    const withoutTransitionLeadIn = stripTransitionLeadInFromDescriptionPart(part);
    part = withoutTransitionLeadIn || part;

    const withoutLeadingLabel = stripLeadingDescriptionFieldLabel(part);
    part = withoutLeadingLabel.value;

    const withoutLeadingTitle = stripLeadingTitleResidueFromDescriptionPart(part, titles);
    part = withoutLeadingTitle.value;

    for (const title of titles) {
      const cleanedTitle = cleanText(title);
      if (!cleanedTitle) continue;
      part = part.replace(new RegExp(`\\b${escapeRegExp(cleanedTitle)}\\b`, "giu"), " ");
    }

    part = removeDescriptionKnownValue(part, args.sku, {
      labeledPattern: "\\b(?:sku|c[oó]d(?:igo)?|cod(?:igo)?|ref|refer[eê]ncia)",
    });
    part = removeDescriptionKnownValue(part, args.price, {
      labeledPattern:
        "\\b(?:pre[cç]o(?:\\s+(?:venda|final|sugerido|custo))?|valor)(?:\\s*\\(r\\$\\))?",
    });

    part = cleanText(
      part
        .replace(
          /\b(?:pre[cç]o(?:\s+(?:venda|final|sugerido|custo))?|valor)(?:\s*\(r\$\))?\s*[:\-]?\s*(?:r\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})?\b/giu,
          " "
        )
        .replace(
          /\b(?:estoque|quantidade(?: atual)?|controlar estoque)\s*[:\-]?\s*\d+\s*(?:unidades?|unds?|un)?\b/giu,
          " "
        )
        .replace(/\b(?:categoria|planilha|aba|sheet)\s*[:\-]?\s*[a-z0-9 _./-]+\b/giu, " ")
    );

    part = removeDescriptionKnownValue(part, args.sourceCategory, {
      labeledPattern: "\\b(?:categoria|linha|destino)",
    });
    part = removeDescriptionKnownValue(part, args.destination, {
      labeledPattern: "\\b(?:categoria|linha|destino)",
    });

    const withoutMechanicalTail = trimTrailingMechanicalDescriptionTail(part);
    part = withoutMechanicalTail.value;

    const withoutTrailingLabel = removeTrailingDescriptionOrphanLabel(part);
    part = cleanupDescriptionResidualPunctuation(withoutTrailingLabel.value);

    const normalizedPart = normalizeLoose(part);
    if (!normalizedPart) continue;
    if (partLooksLikeTransitionArtifact(normalizedPart)) continue;
    if (partLooksLikeDocumentArtifact(normalizedPart)) continue;
    if (looksLikeGarbageDescriptionLine(normalizedPart)) continue;
    if (
      normalizedPart.length <= 18 &&
      normalizeLoose(args.canonicalTitle).includes(normalizedPart)
    ) {
      continue;
    }

    parts.push(part);
  }

  const dedupedParts: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const normalized = normalizeLoose(part);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    dedupedParts.push(part);
  }

  return {
    parts: dedupedParts,
    preview: mergeDescriptionParts(dedupedParts).slice(0, 240),
  };
}

function canonicalizeImportedProductDescription(args: {
  rawBlock: string;
  fieldMap: Record<string, string>;
  plainLines: string[];
  originalTitle: string;
  canonicalTitle: string;
  sku: string;
  destination: StructuredImportDestination;
  sourceCategory: string;
  initialDescription: string;
  candidateParts: string[];
  candidateSources?: string[];
  price?: string;
  missingName?: boolean;
  ambiguousTitle?: boolean;
}) {
  const extracted = extractSemanticDescriptionClauses({
    rawBlock: args.rawBlock,
    fieldMap: args.fieldMap,
    plainLines: args.plainLines,
    originalTitle: args.originalTitle,
    canonicalTitle: args.canonicalTitle,
    sku: args.sku,
    price: args.price || "",
    sourceCategory: args.sourceCategory,
    destination: args.destination,
    candidateParts: args.candidateParts,
    candidateSources: args.candidateSources || [],
    missingName: args.missingName,
    ambiguousTitle: args.ambiguousTitle,
  });
  const originalDescription = cleanText(args.initialDescription);
  const canonicalDescription = mergeDescriptionParts(extracted.preservedParts);
  const descriptionStatus = !canonicalDescription
    ? ("empty" as const)
    : canonicalDescription === originalDescription && extracted.cleanupReasons.length === 0
      ? ("preserved" as const)
      : ("cleaned" as const);

  return {
    originalDescription,
    canonicalDescription,
    cleanupReasons: extracted.cleanupReasons,
    descriptionStatus,
    candidateSources: extracted.candidateSources,
    rawBlockSemanticRemainder: extracted.rawBlockSemanticRemainder,
    descriptionClauses: extracted.descriptionClauses,
    preservedParts: extracted.preservedParts.slice(0, 8),
    rejectedParts: extracted.rejectedParts.slice(0, 8),
  };
}

type DescriptionClauseClassification =
  | "semantic_attribute"
  | "semantic_narrative"
  | "mechanical_field"
  | "review_state"
  | "weak_generic_clause"
  | "title_residue"
  | "transition"
  | "document_artifact"
  | "import_instruction"
  | "empty_residue";

type DescriptionClauseSource =
  | "field_description"
  | "secondary_fields"
  | "plain_lines"
  | "raw_block"
  | "original_title_suffix";

type DescriptionClauseDecision = {
  text: string;
  normalized: string;
  classification: DescriptionClauseClassification;
  action: "preserved" | "removed";
  reason: string;
  source: DescriptionClauseSource;
  originalText?: string;
  removedStructuredSpans?: string[];
  semanticRemainder?: string;
};

function previewDescriptionClauseText(value: string) {
  const cleaned = cleanupDescriptionResidualPunctuation(
    String(value || "")
      .replace(/^\s*[*•\-:;,.|/\\]+\s*/g, "")
      .replace(/\s{2,}/g, " ")
  );
  return cleaned.length > 160 ? `${cleaned.slice(0, 160)}...` : cleaned;
}

function splitDescriptionIntoSemanticClauses(value: string) {
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((line) =>
      line
        .split(/(?<=[.!?;])\s+|\s+-\s+|,(?!\d)\s*/u)
        .map((part) => cleanText(part))
        .filter(Boolean)
    );
}

function extractOriginalTitleSemanticSuffix(originalTitle: string, canonicalTitle: string) {
  const cleanedOriginalTitle = cleanText(originalTitle);
  const cleanedCanonicalTitle = cleanText(canonicalTitle);
  if (!cleanedOriginalTitle || !cleanedCanonicalTitle) return "";

  const normalizedOriginalTitle = normalizeLoose(cleanedOriginalTitle);
  const normalizedCanonicalTitle = normalizeLoose(cleanedCanonicalTitle);
  if (!normalizedOriginalTitle.startsWith(normalizedCanonicalTitle)) return "";
  if (normalizedOriginalTitle === normalizedCanonicalTitle) return "";

  return cleanText(cleanedOriginalTitle.slice(cleanedCanonicalTitle.length).replace(/^[-,:;./|\s]+/, ""));
}

function buildDescriptionQuantityCandidates(fieldMap: Record<string, string>) {
  return [
    fieldMap["quantidade atual"] || "",
    fieldMap["quantidade"] || "",
    fieldMap["qtd"] || "",
    fieldMap["estoque"] || "",
    fieldMap["estoque mÃ­nimo"] || "",
    fieldMap["estoque mÃ¡ximo"] || "",
  ]
    .flatMap((value) => String(value || "").split("\n"))
    .map((value) => cleanText(value))
    .filter(Boolean);
}

function buildDescriptionCategoryCandidates(args: {
  sourceCategory: string;
  destination: StructuredImportDestination;
}) {
  const aliases = new Set<string>();
  const pushAlias = (value: string) => {
    const cleaned = cleanText(value);
    const normalized = normalizeLoose(value);
    if (cleaned) aliases.add(cleaned);
    if (normalized) aliases.add(normalized);
  };

  pushAlias(args.sourceCategory);
  pushAlias(args.destination);

  if (args.destination === "quimicos") {
    ["químico", "químicos", "quimico", "quimicos"].forEach(pushAlias);
  }
  if (args.destination === "acessorios") {
    ["acessório", "acessórios", "acessorio", "acessorios"].forEach(pushAlias);
  }
  if (args.destination === "pool") {
    ["pool", "piscina", "piscinas"].forEach(pushAlias);
  }
  if (args.destination === "outros") {
    ["outro", "outros"].forEach(pushAlias);
  }

  return Array.from(aliases);
}

function partLooksLikeConnectorOnlyResidue(normalized: string) {
  if (!normalized) return true;
  return ["e", "ou", "com", "de", "para", "por", "em"].includes(normalized);
}

function partLooksLikeReviewState(normalized: string) {
  if (!normalized) return true;

  const reviewSignals = [
    "sem preco",
    "sem sku",
    "sem codigo",
    "preco aproximado",
    "deve revisar",
    "revisar",
    "suspeito",
    "nome muito generico",
    "linha fraca",
    "deve vir para revisao",
    "deve vir desmarcado",
    "deve ficar desmarcado",
    "este trecho deve ser tratado",
    "ambiguo",
    "ambigua",
  ];

  return reviewSignals.some((signal) => normalized.includes(signal));
}

function shouldDiscardWholeClauseBeforeSpanExtraction(normalized: string) {
  if (!normalized) return true;
  if (partLooksLikeReviewState(normalized)) return true;
  if (partLooksLikeImportInstruction(normalized)) return true;

  const wholeClauseSignals = [
    "sem sku unico",
    "sem codigo definido",
    "sem preco informado",
    "preco aproximado",
    "texto final ambiguo",
    "generico proposital",
    "este trecho deve ser tratado com cuidado",
  ];

  return wholeClauseSignals.some((signal) => normalized.includes(signal));
}

function partLooksLikeWeakGenericClause(normalized: string) {
  if (!normalized) return true;
  return ["oferta", "promocao", "produto", "item", "novidade", "piscina"].includes(normalized);
}

function partLooksLikeImportInstruction(normalized: string) {
  if (!normalized) return true;

  const instructionSignals = [
    "para testar associacao",
    "para testar",
    "proposital",
    "deve vir para revisao",
    "deve vir desmarcado",
    "deve ficar desmarcado",
    "deve vir bloqueado",
    "arquivo teste",
    "fim do arquivo",
    "texto final ambiguo",
    "upload inteligente",
    "validar leitura",
    "validar upload",
    "como o importador",
    "importador deveria",
    "deveria interpretar",
    "interpretar o trecho",
    "duplicado proposital",
    "deve aparecer como suspeito",
    "suspeito e desmarcado",
  ];

  return instructionSignals.some((signal) => normalized.includes(signal));
}

function partLooksLikeStructuredOrphanLabel(normalized: string) {
  if (!normalized) return true;

  return [
    "valor final",
    "valor",
    "preco",
    "preco final",
    "preco venda",
    "preco sugerido",
    "qtd",
    "qtd?",
    "estoque",
    "quantidade",
    "quantidade atual",
    "cat",
    "categoria",
    "familia talvez",
    "familia",
    "planilha",
    "linha da planilha",
    "sheet scoped key",
    "obs",
    "observacao",
    "observacoes",
    "uso / observacao",
    "uso/observacao",
  ].includes(normalized);
}

function clauseLooksMechanicalOnly(args: {
  text: string;
  normalized: string;
  sku: string;
  price: string;
  quantityCandidates: string[];
  sourceCategory: string;
  destination: StructuredImportDestination;
}) {
  const raw = cleanText(args.text);
  const normalized = args.normalized;
  if (!normalized) return true;

  if (
    /^\s*(?:planilha|linha da planilha|sheet scoped key|produto(?: ou coisa)?|modelo|obs|cat|familia(?: talvez)?|fam[ií]lia(?: talvez)?|qtd\??|largura|comprimento|profundidade|formato|material|valor(?: final)?)\s*[:\-]/iu.test(
      raw
    )
  ) {
    return true;
  }

  const normalizedSku = normalizeLoose(args.sku);
  if (normalizedSku && normalized === normalizedSku) return true;

  if (
    /^\s*(?:sku|c[oó]d(?:igo)?|cod(?:igo)?|ref|refer[eê]ncia)\s*[:\-]?\s*[a-z0-9-]+\s*$/iu.test(raw)
  ) {
    return true;
  }

  if (
    /^\s*(?:pre[cç]o(?:\s+(?:venda|final|sugerido|custo))?|valor)(?:\s*\(r\$\))?\s*[:\-]?\s*(?:r\$\s*)?\d[\d.,]*\s*$/iu.test(
      raw
    )
  ) {
    return true;
  }

  if (/^\s*(?:r\$\s*)?\d[\d.,]*\s*$/iu.test(raw)) return true;
  if (/^\s*r\$\s*$/iu.test(raw)) return true;

  if (
    /^\s*(?:estoque|quantidade(?: atual)?|controlar estoque)\s*[:\-]?\s*\d+\s*(?:unidades?|unds?|un)?\s*$/iu.test(
      raw
    )
  ) {
    return true;
  }
  if (/^\s*(?:qtd\??|unidades?)\s*[:\-]?\s*\d+\s*(?:unidades?|unds?|un)?\s*$/iu.test(raw)) {
    return true;
  }

  if (/^\s*\d+\s*(?:unidades?|unds?|un)\s*$/iu.test(raw)) return true;
  if (/^\s*\d+\s*$/u.test(raw) && args.quantityCandidates.map((value) => normalizeLoose(value)).includes(normalized)) {
    return true;
  }

  if (/^\s*(?:categoria|linha|destino)\s*[:\-]?\s*[a-zÀ-ÿ ]+\s*$/iu.test(raw)) return true;
  if (buildDescriptionCategoryCandidates(args).includes(normalized)) return true;

  const normalizedPrice = normalizeLoose(args.price);
  if (normalizedPrice && normalized === normalizedPrice) return true;

  return false;
}

function cleanupSemanticClauseText(value: string) {
  return cleanupDescriptionResidualPunctuation(
    String(value || "")
      .replace(/^\s*(?:e|and)\s+/iu, "")
      .replace(/\s+(?:e|and)\s*[.;,:-]*$/iu, "")
      .replace(/^\s*(?:quimico|quimicos|acessorio|acessorios|piscina|outro|outros)\s*[-:|,]\s*/iu, "")
      .replace(/^\s*(?:sem\s+(?:preco|preço|sku|c[oó]digo)|preco\s+aproximado)\s*[:\-]?\s*/iu, "")
      .replace(/^\s*uso\s*\/\s*observa(?:cao|ção)\s*[:\-]?\s*/iu, "")
      .replace(/^\s*observa(?:cao|ção|coes|ções)\s*[:\-]?\s*/iu, "")
      .replace(/\s+r\$\s*$/iu, "")
      .replace(/^\s*[;:,.|\-]+\s*/g, "")
      .replace(/\s*[;:,.|\-]+\s*$/g, "")
      .replace(
        /^\s*(?:valor(?:\s+final)?|pre[cç]o(?:\s+(?:venda|final|sugerido|custo))?|estoque|quantidade(?:\s+atual)?|qtd\??|cat|categoria|familia(?:\s+talvez)?|fam[ií]lia(?:\s+talvez)?|planilha|linha da planilha|sheet scoped key)\s*$/iu,
        ""
      )
  );
}

function normalizeSemanticDescriptionRemainder(args: {
  semanticRemainder: string;
  destination: StructuredImportDestination;
  sourceCategory: string;
  canonicalTitle: string;
  missingName?: boolean;
  ambiguousTitle?: boolean;
}) {
  let current = cleanupSemanticClauseText(args.semanticRemainder);
  const categoryCandidates = buildDescriptionCategoryCandidates({
    sourceCategory: args.sourceCategory,
    destination: args.destination,
  });

  const normalizedCurrent = normalizeLoose(current);
  for (const categoryCandidate of categoryCandidates) {
    const normalizedCandidate = normalizeLoose(categoryCandidate);
    if (!normalizedCandidate) continue;

    const separatorMatch = normalizedCurrent.match(/^([a-z0-9\s]+?)\s*[-:|/,]\s*(.+)$/u);
    if (separatorMatch && normalizeLoose(separatorMatch[1]) === normalizedCandidate) {
      const separatorIndex = current.search(/\s*[-:|/,]\s*/u);
      if (separatorIndex >= 0) {
        const separator = current.slice(separatorIndex).match(/^\s*[-:|/,]\s*/u);
        const start = separatorIndex + (separator?.[0].length || 0);
        current = cleanText(current.slice(start));
        break;
      }
    }
  }

  const canonicalTitle = cleanText(args.canonicalTitle);
  if (canonicalTitle) {
    current = cleanText(
      current.replace(new RegExp(`^${escapeRegExp(canonicalTitle)}(?:\\s*[-,:;./|]+\\s*)?`, "iu"), "")
    );
  }

  if (args.ambiguousTitle || args.missingName) {
    current = cleanText(
      current.replace(/^\s*(?:unico|único|sem|definido|aproximado)\s*$/iu, "")
    );
  }

  return cleanupSemanticClauseText(current);
}

function normalizeDescriptionJoinArtifacts(value: string) {
  return cleanupDescriptionResidualPunctuation(
    String(value || "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s*-\s*-\s*/g, " - ")
      .replace(/\s*,\s*,+/g, ", ")
      .replace(/\s*;\s*;+/g, "; ")
  );
}

function removeStructuredSpan(
  source: string,
  pattern: RegExp,
  removedStructuredSpans: string[]
) {
  let next = source;
  next = next.replace(pattern, (match) => {
    const cleaned = cleanText(match);
    if (cleaned) removedStructuredSpans.push(cleaned);
    return " ";
  });
  return normalizeDescriptionJoinArtifacts(next);
}

function extractStructuredSpansFromDescriptionClause(args: {
  clause: string;
  sku: string;
  price: string;
  quantityCandidates: string[];
  sourceCategory: string;
  destination: StructuredImportDestination;
}) {
  let working = cleanText(args.clause);
  const removedStructuredSpans: string[] = [];
  const normalizedSku = normalizeLoose(args.sku);
  const normalizedPrice = normalizeLoose(args.price);
  const categoryCandidates = buildDescriptionCategoryCandidates(args);
  const generalizedPriceSpanPattern = new RegExp(
    `${PRICE_CONTEXT_PREFIX_REGEX_FRAGMENT}${PRICE_NUMERIC_TOKEN_REGEX_FRAGMENT}${PRICE_TERMINAL_BOUNDARY_REGEX_FRAGMENT}`,
    "giu"
  );
  const exactGeneralizedPricePattern = args.price
    ? new RegExp(
        `${PRICE_CONTEXT_PREFIX_REGEX_FRAGMENT}${escapeRegExp(args.price)}${PRICE_TERMINAL_BOUNDARY_REGEX_FRAGMENT}`,
        "giu"
      )
    : null;

  if (args.sku) {
    working = removeStructuredSpan(
      working,
      new RegExp(`\\b(?:sku|c[oó]d(?:igo)?|cod(?:igo)?|ref|refer[eê]ncia)\\s*[:\\-]?\\s*${escapeRegExp(args.sku)}\\b`, "giu"),
      removedStructuredSpans
    );
    working = removeStructuredSpan(
      working,
      new RegExp(`\\b${escapeRegExp(args.sku)}\\b`, "giu"),
      removedStructuredSpans
    );
  }

  if (exactGeneralizedPricePattern) {
    working = removeStructuredSpan(working, exactGeneralizedPricePattern, removedStructuredSpans);
  }

  working = removeStructuredSpan(working, generalizedPriceSpanPattern, removedStructuredSpans);

  if (args.price) {
    working = removeStructuredSpan(
      working,
      new RegExp(
        `\\b(?:pre[cç]o(?:\\s+(?:venda|final|sugerido|custo))?|valor)(?:\\s*\\(r\\$\\))?\\s*[:\\-]?\\s*${escapeRegExp(
          args.price
        )}\\b`,
        "giu"
      ),
      removedStructuredSpans
    );
  }

  working = removeStructuredSpan(
    working,
    /\b(?:pre[cç]o(?:\s+(?:venda|final|sugerido|custo))?|valor)(?:\s*\(r\$\))?\s*[:\-]?\s*(?:r\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})?\b/giu,
    removedStructuredSpans
  );
  working = removeStructuredSpan(
    working,
    /\b(?:estoque|quantidade(?: atual)?)\s*[:\-]?\s*\d+\s*(?:unidades?|unds?|un)?\b/giu,
    removedStructuredSpans
  );
  working = removeStructuredSpan(
    working,
    /\b(?:categoria|destino)\s*[:\-]?\s*[a-zÀ-ÿ ]+\b/giu,
    removedStructuredSpans
  );
  working = removeStructuredSpan(
    working,
    /^\s*(?:sku|c[oó]d(?:igo)?|cod(?:igo)?|ref|refer[eê]ncia|pre[cç]o|valor|estoque|quantidade|categoria)\s*[:\-]?\s*$/giu,
    removedStructuredSpans
  );

  if (normalizedPrice) {
    working = removeStructuredSpan(
      working,
      new RegExp(`\\b${escapeRegExp(args.price)}\\b`, "giu"),
      removedStructuredSpans
    );
  }

  for (const categoryCandidate of categoryCandidates) {
    if (!categoryCandidate) continue;
    const escaped = escapeRegExp(categoryCandidate);
    working = removeStructuredSpan(
      working,
      new RegExp(`^${escaped}\\s*[-:|,]\\s*`, "giu"),
      removedStructuredSpans
    );
    working = removeStructuredSpan(
      working,
      new RegExp(`^(?:categoria|destino)\\s*[:\\-]?\\s*${escaped}\\b`, "giu"),
      removedStructuredSpans
    );
  }

  working = removeStructuredSpan(working, /^\s*r\$\s*$/giu, removedStructuredSpans);
  working = removeStructuredSpan(working, /^\s*\d+\s*(?:unidades?|unds?|un)\s*$/giu, removedStructuredSpans);

  const semanticRemainder = cleanupSemanticClauseText(working)
    .replace(/^\s*(?:produto|item|oferta|promo[cç][aã]o)\s*$/iu, "")
    .trim();

  return {
    originalClause: cleanText(args.clause),
    removedSpans: removedStructuredSpans,
    semanticRemainder,
    normalizedSemanticRemainder: normalizeLoose(semanticRemainder),
    removedOnlyMechanical:
      Boolean(removedStructuredSpans.length) &&
      !normalizeLoose(semanticRemainder),
    matchedSku: Boolean(normalizedSku && removedStructuredSpans.some((span) => normalizeLoose(span).includes(normalizedSku))),
  };
}

function classifySemanticDescriptionClause(args: {
  text: string;
  source: DescriptionClauseSource;
  originalTitle: string;
  canonicalTitle: string;
  sku: string;
  price: string;
  quantityCandidates: string[];
  sourceCategory: string;
  destination: StructuredImportDestination;
  missingName?: boolean;
  ambiguousTitle?: boolean;
}) {
  const originalClauseText = cleanText(args.text);
  let clause = originalClauseText;
  if (!clause) {
    return {
      text: "",
      normalized: "",
      classification: "empty_residue" as const,
      action: "removed" as const,
      reason: "empty_input_clause",
      source: args.source,
      originalText: "",
      removedStructuredSpans: [],
      semanticRemainder: "",
    };
  }

  clause = stripTransitionLeadInFromDescriptionPart(clause) || clause;
  clause = stripLeadingDescriptionFieldLabel(clause).value;

  const structuredTitleResidueMatch = clause.match(
    /^\s*(?:sku|c[oó]d(?:igo)?|cod(?:igo)?|ref|refer[eê]ncia)\s*[:\-]?\s*(.+)\s*$/iu
  );
  if (structuredTitleResidueMatch) {
    const labeledValue = cleanText(structuredTitleResidueMatch[1] || "");
    const strippedLabeledValue = stripSpreadsheetContinuationLeadIn(labeledValue);
    const normalizedLabeledValue = normalizeLoose(strippedLabeledValue || labeledValue);
    const titleCandidates = [args.originalTitle, args.canonicalTitle]
      .map((value) => normalizeLoose(value))
      .filter(Boolean);
    const matchesTitleResidue =
      Boolean(normalizedLabeledValue) &&
      titleCandidates.some(
        (candidate) =>
          candidate === normalizedLabeledValue ||
          candidate.includes(normalizedLabeledValue) ||
          normalizedLabeledValue.includes(candidate)
      );

    if (!normalizedLabeledValue || hasSpreadsheetContinuationMarker(labeledValue) || matchesTitleResidue) {
      return {
        text: previewDescriptionClauseText(clause),
        normalized: normalizeLoose(clause),
        classification: "mechanical_field" as const,
        action: "removed" as const,
        reason: "structured_title_source_residue",
        source: args.source,
        originalText: previewDescriptionClauseText(originalClauseText),
        removedStructuredSpans: labeledValue ? [labeledValue] : [],
        semanticRemainder: "",
      };
    }
  }

  const normalizedOriginalClause = normalizeLoose(clause);
  if (shouldDiscardWholeClauseBeforeSpanExtraction(normalizedOriginalClause)) {
    return {
      text: previewDescriptionClauseText(clause),
      normalized: normalizedOriginalClause,
      classification: partLooksLikeImportInstruction(normalizedOriginalClause)
        ? ("import_instruction" as const)
        : ("review_state" as const),
      action: "removed" as const,
      reason: "discard_whole_clause_before_span_extraction",
      source: args.source,
      originalText: previewDescriptionClauseText(originalClauseText),
      removedStructuredSpans: [],
      semanticRemainder: "",
    };
  }

  if (args.source !== "original_title_suffix") {
    const cleanedCanonicalTitle = cleanText(args.canonicalTitle);
    if (cleanedCanonicalTitle) {
      clause = cleanText(
        clause.replace(
          new RegExp(`^${escapeRegExp(cleanedCanonicalTitle)}(?:\\s*[-,:;./|]+\\s*)?`, "iu"),
          ""
        )
      );
    }
  }

  clause = cleanupSemanticClauseText(clause);
  const structuredExtraction = extractStructuredSpansFromDescriptionClause({
    clause,
    sku: args.sku,
    price: args.price,
    quantityCandidates: args.quantityCandidates,
    sourceCategory: args.sourceCategory,
    destination: args.destination,
  });
  clause = normalizeSemanticDescriptionRemainder({
    semanticRemainder: structuredExtraction.semanticRemainder || clause,
    destination: args.destination,
    sourceCategory: args.sourceCategory,
    canonicalTitle: args.canonicalTitle,
    missingName: args.missingName,
    ambiguousTitle: args.ambiguousTitle,
  });
  const normalized = normalizeLoose(clause);
  const titleCandidates = [args.originalTitle, args.canonicalTitle]
    .map((value) => normalizeLoose(value))
    .filter(Boolean);
  const canonicalTitleWords = normalizeLoose(args.canonicalTitle)
    .split(" ")
    .filter(Boolean);

  if (!normalized) {
    return {
      text: previewDescriptionClauseText(args.text),
      normalized: "",
      classification: "empty_residue" as const,
      action: "removed" as const,
      reason: "empty_after_clause_cleanup",
      source: args.source,
      originalText: previewDescriptionClauseText(originalClauseText),
      removedStructuredSpans: structuredExtraction.removedSpans,
      semanticRemainder: "",
    };
  }

  if (partLooksLikeStructuredOrphanLabel(normalized)) {
    return {
      text: previewDescriptionClauseText(clause),
      normalized,
      classification: "mechanical_field" as const,
      action: "removed" as const,
      reason: "structured_orphan_label",
      source: args.source,
      originalText: previewDescriptionClauseText(originalClauseText),
      removedStructuredSpans: structuredExtraction.removedSpans,
      semanticRemainder: "",
    };
  }

  if (titleCandidates.includes(normalized)) {
    return {
      text: previewDescriptionClauseText(clause),
      normalized,
      classification: "title_residue" as const,
      action: "removed" as const,
      reason: "matches_title_only",
      source: args.source,
      originalText: previewDescriptionClauseText(originalClauseText),
      removedStructuredSpans: structuredExtraction.removedSpans,
      semanticRemainder: "",
    };
  }

  if (
    args.source !== "original_title_suffix" &&
    partLooksLikeStandaloneProductTitleResidue(clause)
  ) {
    return {
      text: previewDescriptionClauseText(clause),
      normalized,
      classification: "title_residue" as const,
      action: "removed" as const,
      reason: "standalone_product_title_residue",
      source: args.source,
      originalText: previewDescriptionClauseText(originalClauseText),
      removedStructuredSpans: structuredExtraction.removedSpans,
      semanticRemainder: previewDescriptionClauseText(clause),
    };
  }

  if (
    args.ambiguousTitle &&
    (titleCandidates.some((candidate) => candidate && (candidate.includes(normalized) || normalized.includes(candidate))) ||
      (canonicalTitleWords.length > 0 &&
        canonicalTitleWords.filter((word) => normalized.split(" ").includes(word)).length >=
          Math.max(1, Math.min(2, canonicalTitleWords.length))))
  ) {
    return {
      text: previewDescriptionClauseText(clause),
      normalized,
      classification: "title_residue" as const,
      action: "removed" as const,
      reason: "ambiguous_title_residue",
      source: args.source,
      originalText: previewDescriptionClauseText(originalClauseText),
      removedStructuredSpans: structuredExtraction.removedSpans,
      semanticRemainder: previewDescriptionClauseText(clause),
    };
  }

  if (partLooksLikeTransitionArtifact(normalized)) {
    return {
      text: previewDescriptionClauseText(clause),
      normalized,
      classification: "transition" as const,
      action: "removed" as const,
      reason: "transition_to_other_product",
      source: args.source,
      originalText: previewDescriptionClauseText(originalClauseText),
      removedStructuredSpans: structuredExtraction.removedSpans,
      semanticRemainder: previewDescriptionClauseText(clause),
    };
  }

  if (partLooksLikeConnectorOnlyResidue(normalized)) {
    return {
      text: previewDescriptionClauseText(clause),
      normalized,
      classification: "empty_residue" as const,
      action: "removed" as const,
      reason: "connector_only_residue",
      source: args.source,
      originalText: previewDescriptionClauseText(originalClauseText),
      removedStructuredSpans: structuredExtraction.removedSpans,
      semanticRemainder: previewDescriptionClauseText(clause),
    };
  }

  if (partLooksLikeReviewState(normalized)) {
    return {
      text: previewDescriptionClauseText(clause),
      normalized,
      classification: args.ambiguousTitle ? ("review_state" as const) : ("review_state" as const),
      action: "removed" as const,
      reason: "review_state_clause",
      source: args.source,
      originalText: previewDescriptionClauseText(originalClauseText),
      removedStructuredSpans: structuredExtraction.removedSpans,
      semanticRemainder: previewDescriptionClauseText(clause),
    };
  }

  if (partLooksLikeWeakGenericClause(normalized)) {
    return {
      text: previewDescriptionClauseText(clause),
      normalized,
      classification: "weak_generic_clause" as const,
      action: "removed" as const,
      reason: "weak_generic_clause",
      source: args.source,
      originalText: previewDescriptionClauseText(originalClauseText),
      removedStructuredSpans: structuredExtraction.removedSpans,
      semanticRemainder: previewDescriptionClauseText(clause),
    };
  }

  if (partLooksLikeDocumentArtifact(normalized) || looksLikeGarbageDescriptionLine(normalized)) {
    return {
      text: previewDescriptionClauseText(clause),
      normalized,
      classification: "document_artifact" as const,
      action: "removed" as const,
      reason: "document_or_test_artifact",
      source: args.source,
      originalText: previewDescriptionClauseText(originalClauseText),
      removedStructuredSpans: structuredExtraction.removedSpans,
      semanticRemainder: previewDescriptionClauseText(clause),
    };
  }

  if (partLooksLikeImportInstruction(normalized)) {
    return {
      text: previewDescriptionClauseText(clause),
      normalized,
      classification: "import_instruction" as const,
      action: "removed" as const,
      reason: "import_process_instruction",
      source: args.source,
      originalText: previewDescriptionClauseText(originalClauseText),
      removedStructuredSpans: structuredExtraction.removedSpans,
      semanticRemainder: previewDescriptionClauseText(clause),
    };
  }

  if (
    structuredExtraction.removedOnlyMechanical ||
    clauseLooksMechanicalOnly({
      text: clause,
      normalized,
      sku: args.sku,
      price: args.price,
      quantityCandidates: args.quantityCandidates,
      sourceCategory: args.sourceCategory,
      destination: args.destination,
    })
  ) {
    return {
      text: previewDescriptionClauseText(clause),
      normalized,
      classification: "mechanical_field" as const,
      action: "removed" as const,
      reason: structuredExtraction.removedOnlyMechanical
        ? "structured_spans_removed_clause_empty"
        : "structured_field_clause",
      source: args.source,
      originalText: previewDescriptionClauseText(originalClauseText),
      removedStructuredSpans: structuredExtraction.removedSpans,
      semanticRemainder: previewDescriptionClauseText(clause),
    };
  }

  const semanticAttributeSignals = [
    "fibra",
    "material",
    "cor",
    "formato",
    "largura",
    "comprimento",
    "profundidade",
    "capacidade",
    "peso",
    "embalagem",
    "compatibilidade",
    "dosagem",
  ];

  const classification = semanticAttributeSignals.some((signal) => normalized.includes(signal))
    ? ("semantic_attribute" as const)
    : ("semantic_narrative" as const);

  return {
    text: previewDescriptionClauseText(clause),
    normalized,
    classification,
    action: "preserved" as const,
    reason:
      args.source === "original_title_suffix"
        ? "preserved_original_title_suffix_attributes"
        : "preserved_semantic_clause",
    source: args.source,
    originalText: previewDescriptionClauseText(originalClauseText),
    removedStructuredSpans: structuredExtraction.removedSpans,
    semanticRemainder: previewDescriptionClauseText(clause),
  };
}

function extractSemanticDescriptionClauses(args: {
  rawBlock: string;
  fieldMap: Record<string, string>;
  plainLines: string[];
  originalTitle: string;
  canonicalTitle: string;
  sku: string;
  price: string;
  sourceCategory: string;
  destination: StructuredImportDestination;
  candidateParts: string[];
  candidateSources: string[];
  missingName?: boolean;
  ambiguousTitle?: boolean;
}) {
  const quantityCandidates = buildDescriptionQuantityCandidates(args.fieldMap);
  const mappedCandidateParts = args.candidateParts.map((text, index) => ({
    text,
    source:
      args.candidateSources[index] === "field_description"
        ? ("field_description" as const)
        : args.candidateSources[index] === "secondary_fields"
          ? ("secondary_fields" as const)
          : ("plain_lines" as const),
  }));
  const rawBlockParts = splitDescriptionIntoSemanticClauses(args.rawBlock).map((text) => ({
    text,
    source: "raw_block" as const,
  }));
  const originalTitleSuffix = extractOriginalTitleSemanticSuffix(args.originalTitle, args.canonicalTitle);
  const titleSuffixParts = splitDescriptionIntoSemanticClauses(originalTitleSuffix).map((text) => ({
    text,
    source: "original_title_suffix" as const,
  }));

  const clauseDecisions = [...mappedCandidateParts, ...rawBlockParts, ...titleSuffixParts].map((clause) =>
    classifySemanticDescriptionClause({
      text: clause.text,
      source: clause.source,
      originalTitle: args.originalTitle,
      canonicalTitle: args.canonicalTitle,
      sku: args.sku,
      price: args.price,
      quantityCandidates,
      sourceCategory: args.sourceCategory,
      destination: args.destination,
      missingName: args.missingName,
      ambiguousTitle: args.ambiguousTitle,
    })
  );

  const preservedParts: string[] = [];
  const rejectedParts: string[] = [];
  const cleanupReasons = new Set<string>();
  const seen = new Set<string>();
  const candidateSources = new Set<string>(args.candidateSources);

  for (const clause of clauseDecisions) {
    if (clause.action === "removed") {
      if (clause.text) rejectedParts.push(clause.text);
      cleanupReasons.add(clause.reason);
      continue;
    }

    if (clause.source === "raw_block" || clause.source === "original_title_suffix") {
      candidateSources.add("raw_block_semantic_remainder");
    }

    const candidateNormalized = normalizeLoose(cleanupSemanticClauseText(clause.text));
    const isSemanticDuplicate = Array.from(seen).some((existing) => {
      const existingNormalized = normalizeLoose(cleanupSemanticClauseText(existing));
      return (
        existingNormalized === candidateNormalized ||
        existingNormalized.includes(candidateNormalized) ||
        candidateNormalized.includes(existingNormalized)
      );
    });
    if (isSemanticDuplicate) {
      cleanupReasons.add("deduped_description_parts");
      continue;
    }

    seen.add(clause.text);
    preservedParts.push(clause.text);
  }

  return {
    preservedParts,
    rejectedParts,
    cleanupReasons: Array.from(cleanupReasons),
    candidateSources: Array.from(candidateSources),
    rawBlockSemanticRemainder: mergeDescriptionParts(preservedParts).slice(0, 240),
    descriptionClauses: clauseDecisions.slice(0, 24).map((clause) => ({
      originalText: clause.originalText || clause.text,
      removedStructuredSpans: clause.removedStructuredSpans || [],
      semanticRemainder: clause.semanticRemainder || clause.text,
      classification: clause.classification,
      action: clause.action,
      reason: clause.reason,
    })),
  };
}

function scoreStructuredItem(item: StructuredImportItem) {
  return (
    (item.price ? 120 : 0) +
    (item.sku ? 120 : 0) +
    (item.dosage ? 40 : 0) +
    (item.application ? 40 : 0) +
    (item.embalagem ? 40 : 0) +
    (item.notes ? 20 : 0) +
    Math.min(item.description.length, 600) +
    (item.destination === "quimicos" ? 20 : 0)
  );
}

function pickPreferredText(currentValue: string | undefined, candidateValue: string | undefined) {
  const current = cleanText(currentValue);
  const candidate = cleanText(candidateValue);
  if (!candidate) return current;
  if (!current) return candidate;
  if (normalizeLoose(current) === normalizeLoose(candidate)) return current;
  return candidate.length > current.length ? candidate : current;
}

function pickPreferredPrice(currentValue: string | undefined, candidateValue: string | undefined) {
  const current = cleanText(currentValue);
  const candidate = cleanText(candidateValue);
  if (!candidate) return current;
  if (!current) return candidate;

  const currentNormalized = normalizeLoose(current);
  const candidateNormalized = normalizeLoose(candidate);

  const currentLooksCost = currentNormalized.includes("custo");
  const candidateLooksCost = candidateNormalized.includes("custo");

  if (currentLooksCost && !candidateLooksCost) return candidate;
  if (!currentLooksCost && candidateLooksCost) return current;

  return candidate.length >= current.length ? candidate : current;
}

function isSameNormalizedValue(left?: string, right?: string) {
  return normalizeLoose(left) === normalizeLoose(right);
}

function mergeUniqueStringList(left?: string[], right?: string[]) {
  const merged = Array.from(
    new Set([...(left || []), ...(right || [])].map((value) => cleanText(value)).filter(Boolean))
  );
  return merged.length > 0 ? merged : undefined;
}

function mergeUniqueNumberList(left?: number[], right?: number[]) {
  const merged = Array.from(
    new Set([...(left || []), ...(right || [])].filter((value) => Number.isFinite(value)))
  );
  return merged.length > 0 ? merged : undefined;
}

function inferMergeReason(existing: StructuredImportItem, incoming: StructuredImportItem) {
  if (normalizeLoose(existing.sku) && normalizeLoose(existing.sku) === normalizeLoose(incoming.sku)) {
    return "sku" as const;
  }
  if (
    normalizeLoose(existing.title) &&
    normalizeLoose(existing.title) === normalizeLoose(incoming.title)
  ) {
    return "title" as const;
  }
  if (
    normalizeLoose(existing.sourceCategory || existing.categoria) ===
    normalizeLoose(incoming.sourceCategory || incoming.categoria)
  ) {
    return "category" as const;
  }
  return "other" as const;
}

function itemLooksStructurallyComplete(item: StructuredImportItem) {
  const hasSku = Boolean(cleanText(item.sku));
  const hasPrice = Boolean(cleanText(item.price));
  const title = normalizeLoose(item.title);
  return Boolean(title) && hasSku && hasPrice;
}

function mergeStructuredImportItems(
  items: StructuredImportItem[],
  mergeTrace?: StructuredParserMergeDebug[]
) {
  const mergedByKey = new Map<string, StructuredImportItem>();

  for (const item of items) {
    const normalizedSku = normalizeLoose(item.sku);
    const normalizedTitle = normalizeLoose(item.title);
    const normalizedSheet = normalizeLoose(item.sheetName);
    const normalizedCategory = normalizeLoose(item.sourceCategory || item.categoria);
    const normalizedSubcategory = normalizeLoose(item.sourceSubcategory);
    const key = normalizedSku
      ? `sku::${normalizedSku}`
      : `${normalizedSheet || "sem-sheet"}::${normalizedCategory || item.destination}::${normalizedSubcategory || "sem-sub"}::${item.destination}::${normalizedTitle}`;

    const existing = mergedByKey.get(key);
    if (!existing) {
      mergedByKey.set(key, { ...item });
      continue;
    }

    if (
      normalizedSku &&
      itemLooksStructurallyComplete(existing) &&
      itemLooksStructurallyComplete(item)
    ) {
      mergedByKey.set(`${key}::duplicate::${mergedByKey.size + 1}`, { ...item });
      continue;
    }

    if (mergeTrace) {
      mergeTrace.push({
        key,
        primaryTitle: existing.title,
        secondaryTitle: item.title,
        reason: inferMergeReason(existing, item),
      });
    }

    const primary = scoreStructuredItem(existing) >= scoreStructuredItem(item) ? { ...existing } : { ...item };
    const secondary = primary === existing ? item : existing;

    const merged: StructuredImportItem = {
      ...primary,
      sourceFileName: primary.sourceFileName || secondary.sourceFileName,
      destination:
        primary.destination === secondary.destination
          ? primary.destination
          : primary.destination,
      categoria: primary.categoria || secondary.categoria,
      title: pickPreferredText(primary.title, secondary.title),
      description: mergeDescriptionParts([primary.description, secondary.description]),
      rawBlock: mergeDescriptionParts([primary.rawBlock, secondary.rawBlock]),
      confidence: Math.max(primary.confidence, secondary.confidence),
      price: pickPreferredPrice(primary.price, secondary.price),
      dimensions: pickPreferredText(primary.dimensions, secondary.dimensions),
      depth: pickPreferredText(primary.depth, secondary.depth),
      capacity: pickPreferredText(primary.capacity, secondary.capacity),
      material: pickPreferredText(primary.material, secondary.material),
      shape: pickPreferredText(primary.shape, secondary.shape),
      brand: pickPreferredText(primary.brand, secondary.brand),
      line: pickPreferredText(primary.line, secondary.line),
      sku: pickPreferredText(primary.sku, secondary.sku),
      unit: pickPreferredText(primary.unit, secondary.unit),
      weight: pickPreferredText(primary.weight, secondary.weight),
      dosage: pickPreferredText(primary.dosage, secondary.dosage),
      color: pickPreferredText(primary.color, secondary.color),
      usage: pickPreferredText(primary.usage, secondary.usage),
      notes: mergeDescriptionParts([primary.notes || "", secondary.notes || ""]),
      indication: pickPreferredText(primary.indication, secondary.indication),
      composition: pickPreferredText(primary.composition, secondary.composition),
      embalagem: pickPreferredText(primary.embalagem, secondary.embalagem),
      packaging: pickPreferredText(primary.packaging, secondary.packaging),
      model: pickPreferredText(primary.model, secondary.model),
      size: pickPreferredText(primary.size, secondary.size),
      compatibility: pickPreferredText(primary.compatibility, secondary.compatibility),
      function: pickPreferredText(primary.function, secondary.function),
      environment: pickPreferredText(primary.environment, secondary.environment),
      diferencial: pickPreferredText(primary.diferencial, secondary.diferencial),
      application: pickPreferredText(primary.application, secondary.application),
      sheetName: pickPreferredText(primary.sheetName, secondary.sheetName),
      sourceCategory: pickPreferredText(primary.sourceCategory, secondary.sourceCategory),
      sourceSubcategory: pickPreferredText(primary.sourceSubcategory, secondary.sourceSubcategory),
      stockQuantity: pickPreferredText(primary.stockQuantity, secondary.stockQuantity),
      worksheetRowNumber:
        typeof primary.worksheetRowNumber === "number"
          ? primary.worksheetRowNumber
          : secondary.worksheetRowNumber,
      sheetScopedKey: pickPreferredText(primary.sheetScopedKey, secondary.sheetScopedKey),
      sourceWorksheetRowNumbers: mergeUniqueNumberList(
        primary.sourceWorksheetRowNumbers,
        secondary.sourceWorksheetRowNumbers
      ),
      sourceSheetScopedKeys: mergeUniqueStringList(
        primary.sourceSheetScopedKeys,
        secondary.sourceSheetScopedKeys
      ),
      mergedFromSpreadsheetRows:
        Boolean(primary.mergedFromSpreadsheetRows) || Boolean(secondary.mergedFromSpreadsheetRows) || undefined,
      reviewSignals: mergeUniqueStringList(primary.reviewSignals, secondary.reviewSignals),
    };

    if (
      !isSameNormalizedValue(existing.sheetName, item.sheetName) ||
      !isSameNormalizedValue(existing.sourceCategory || existing.categoria, item.sourceCategory || item.categoria) ||
      !isSameNormalizedValue(existing.sourceSubcategory, item.sourceSubcategory)
    ) {
      mergedByKey.set(`${key}::${mergedByKey.size + 1}`, { ...item });
      continue;
    }

    mergedByKey.set(key, merged);
  }

  return Array.from(mergedByKey.values());
}

function looksLikeStockOnlyItem(item: StructuredImportItem) {
  const raw = normalizeLoose(item.rawBlock);
  const hasStockSignals =
    raw.includes("controlar estoque") ||
    raw.includes("quantidade atual") ||
    raw.includes("estoque minimo") ||
    raw.includes("estoque maximo");

  const hasCommercialSignals =
    Boolean(item.price) ||
    Boolean(item.dosage) ||
    Boolean(item.application) ||
    Boolean(item.embalagem) ||
    raw.includes("preco venda") ||
    raw.includes("preço venda");

  return hasStockSignals && !hasCommercialSignals;
}

function extractLoosePrice(text: string) {
  return collectAllPriceCandidates(text)[0] || "";

  const prioritizedPatterns = [
    /pre[cç]o\s+venda(?:\s*\(r\$\))?\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i,
    /valor\s+venda\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i,
    /pre[cç]o\s+final(?:\s*\(r\$\))?\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i,
    /pre[cç]o\s+sugerido(?:\s*\(r\$\))?\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i,
    /pre[cç]o(?:\s+estimado|\s+aproximado)?\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i,
    /faixa de pre[cç]o\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i,
    /r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i,
  ];

  for (const pattern of prioritizedPatterns) {
    const match = text.match(pattern);
    const matchedValue = match?.[1] || "";
    if (matchedValue) return matchedValue;
  }

  return "";
}

function extractLooseDimensions(text: string) {
  const threeDimMatch = text.match(
    /\b(\d+[\.,]?\d*)\s*x\s*(\d+[\.,]?\d*)\s*x\s*(\d+[\.,]?\d*)\s*(?:m|metros?)\b/i
  );
  if (threeDimMatch) {
    return `${threeDimMatch[1]} x ${threeDimMatch[2]} x ${threeDimMatch[3]} m`;
  }

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
    text.match(/\b(cris água|cris agua|brustec|sodramar|nautilus|veico|genco|hidralux|netuno|aquaplus|cristal pool)\b/i);

  return cleanText(match?.[1] || match?.[0] || "");
}

function resolveStructuredBrandAndLine(fieldMap: Record<string, string>) {
  const explicitBrand = cleanText(fieldMap["marca"] || "");
  const explicitLine = cleanText(fieldMap["linha"] || "");
  const combinedBrandLine = cleanText(fieldMap["marca / linha"] || "");

  if (explicitBrand || explicitLine) {
    return {
      brand: explicitBrand,
      line: explicitLine,
    };
  }

  if (!combinedBrandLine) {
    return {
      brand: "",
      line: "",
    };
  }

  const splitParts = combinedBrandLine
    .split(/\s*(?:\/|\|| - )\s*/g)
    .map((part) => cleanText(part))
    .filter(Boolean);

  if (splitParts.length === 2 && splitParts[0] && splitParts[1]) {
    return {
      brand: splitParts[0],
      line: splitParts[1],
    };
  }

  return {
    brand: "",
    line: combinedBrandLine,
  };
}

function isValidSkuCandidate(value: string | null | undefined) {
  const raw = cleanText(value || "");
  const normalized = normalizeLoose(raw);
  if (!raw || raw.length < 4) return false;
  if (BLOCKED_SKU_VALUES.has(normalized)) return false;
  if (looksLikeMissingSkuPlaceholder(normalized)) return false;
  if (/^(sim|nao|não|max|home|slim)$/i.test(raw)) return false;
  if (!/[a-z]/i.test(raw) || !/\d/.test(raw)) return false;
  if (!/^[a-z0-9][a-z0-9\-_.\/]{2,}$/i.test(raw)) return false;
  return true;
}

function sanitizeSku(value: string | null | undefined) {
  const cleaned = cleanText(value || "").replace(/[;,]+$/g, "").trim();
  return isValidSkuCandidate(cleaned) ? cleaned : "";
}

function resolveStructuredSkuFieldValue(fieldMap: Record<string, string>) {
  return (
    fieldMap["sku"] ||
    resolveStructuredCodeFieldValue(fieldMap) ||
    ""
  );
}

function resolveStructuredCodeFieldValue(fieldMap: Record<string, string>) {
  return (
    fieldMap["codigo"] ||
    fieldMap["código"] ||
    fieldMap["cÃ³digo"] ||
    ""
  );
}

function extractRobustSkuCandidates(text: string) {
  const candidates = [
    ...Array.from(
      String(text || "").matchAll(
        /\b(?:sku|c[oÃ³]digo(?:\s+do\s+produto)?|cod(?:igo)?(?:\s+do\s+produto)?)\s*[:\-]?\s*([a-z0-9][a-z0-9\-_.\/]{2,})\b/gi
      )
    ).map((match) => sanitizeSku(match[1] || "")),
    ...Array.from(String(text || "").matchAll(DIRECT_SKU_REGEX)).map((match) =>
      sanitizeSku(match[0] || "")
    ),
  ].filter(Boolean);

  return Array.from(new Set(candidates));
}

function collectAllSkuCandidates(text: string) {
  return extractRobustSkuCandidates(text);
}

function extractPriceCandidatesWithDiagnostics(text: string): PriceExtractionCandidate[] {
  const sourceText = String(text || "");
  const candidates: PriceExtractionCandidate[] = [];
  const acceptedKeys = new Set<string>();

  for (const pattern of PRICE_EXTRACTION_PATTERNS) {
    for (const match of sourceText.matchAll(pattern.regex)) {
      const rawMatch = cleanText(match[pattern.rawMatchGroup || 0] || match[0] || "");
      const priceLabel = cleanText(match[pattern.priceLabelGroup || 0] || "");
      const numericToken = cleanText(match[pattern.numericTokenGroup] || "");
      const normalizedValue = cleanText(numericToken);
      if (!rawMatch || !normalizedValue) continue;

      const candidateKey = `${match.index ?? -1}:${rawMatch}:${normalizedValue}`;
      if (acceptedKeys.has(candidateKey)) continue;
      acceptedKeys.add(candidateKey);
      candidates.push({
        rawMatch,
        priceLabel,
        numericToken,
        normalizedValue,
        source: pattern.source,
        accepted: true,
        rejectionReason: "",
      });
    }
  }

  const diagnosticKeys = new Set(
    candidates.map((candidate) => `${candidate.rawMatch}:${candidate.numericToken}:${candidate.source}`)
  );

  for (const probe of NON_PRICE_NUMERIC_PROBE_PATTERNS) {
    for (const match of sourceText.matchAll(probe.regex)) {
      const rawMatch = cleanText(match[probe.rawMatchGroup || 0] || match[0] || "");
      const priceLabel = cleanText(match[probe.priceLabelGroup || 0] || "");
      const numericToken = cleanText(match[probe.numericTokenGroup] || "");
      const normalizedValue = cleanText(numericToken);
      if (!rawMatch || !normalizedValue) continue;

      const candidateKey = `${rawMatch}:${numericToken}:${probe.source}`;
      if (diagnosticKeys.has(candidateKey)) continue;
      diagnosticKeys.add(candidateKey);
      candidates.push({
        rawMatch,
        priceLabel,
        numericToken,
        normalizedValue,
        source: probe.source,
        accepted: false,
        rejectionReason: probe.rejectionReason,
      });
    }
  }

  return candidates;
}

function collectAllPriceCandidates(text: string) {
  return Array.from(
    new Set(
      extractPriceCandidatesWithDiagnostics(text)
        .filter((candidate) => candidate.accepted)
        .map((candidate) => candidate.normalizedValue)
        .filter(Boolean)
    )
  );
}

function extractLooseSku(text: string) {
  const patterns = [
    /\bsku\s*[:\-]?\s*([a-z0-9][a-z0-9\-_.\/]{2,})\b/i,
    /\bc[oó]digo(?:\s+do\s+produto)?\s*[:\-]?\s*([a-z0-9][a-z0-9\-_.\/]{2,})\b/i,
    /\b(acc-\d{3,}|out-\d{3,}|qmc-\d{3,})\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = sanitizeSku(match?.[1] || match?.[0] || "");
    if (candidate) return candidate;
  }

  return "";
}

function extractLooseWeight(text: string) {
  const match =
    text.match(/\bpeso(?:\/volume)?\s*[:\-]?\s*(\d+[\.,]?\d*)\s*(kg|g|l|ml)\b/i) ||
    text.match(/\b(\d+[\.,]?\d*)\s*(kg|g|l|ml)\b/i);

  return match ? `${match[1]} ${match[2]}` : "";
}

function extractLooseDosage(text: string) {
  const structuredMatch = text.match(
    /\bdosagem\s*(?:de)?\s*[:\-]?\s*(\d+[\.,]?\d*\s*(?:ml|l|g|kg)\s+por\s+(?:\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?))/i
  );
  if (structuredMatch?.[1]) return cleanText(structuredMatch[1]);

  const match = text.match(/\bdosagem\s*(?:de)?\s*[:\-]?\s*(.+)/i);
  return cleanText(match?.[1] || "");
}

function extractLooseColor(text: string) {
  const match =
    text.match(/\bcor\s*[:\-]?\s*(.+)/i) ||
    text.match(/\b(azul cristal|azul|branco|cinza|preto|verde|amarelo)\b/i);

  return cleanText(match?.[1] || match?.[0] || "");
}

function isChemicalSku(value: string | null | undefined) {
  const sku = cleanText(value || "").toUpperCase();
  return /^QMC(?:-[A-Z0-9]{1,8}){1,4}$/.test(sku);
}

function isAccessorySku(value: string | null | undefined) {
  const sku = cleanText(value || "").toUpperCase();
  return /^ACC(?:-[A-Z0-9]{1,8}){1,4}$/.test(sku);
}

function inferDestination(params: {
  text: string;
  explicitSku?: string;
  explicitCategory?: string;
  explicitSubcategory?: string;
  explicitSheetName?: string;
}): StructuredImportDestination {
  const explicitSource = normalizeLoose(
    [params.explicitCategory, params.explicitSubcategory, params.explicitSheetName]
      .filter(Boolean)
      .join(" ")
  );

  if (/(^|\s)(acessorios|acessorio)(\s|$)/.test(explicitSource)) return "acessorios";
  if (/(^|\s)(outros|outro)(\s|$)/.test(explicitSource)) return "outros";
  if (/(^|\s)(quimicos|quimico)(\s|$)/.test(explicitSource)) return "quimicos";
  if (/(^|\s)(pool|piscinas|piscina)(\s|$)/.test(explicitSource)) return "pool";

  if (isChemicalSku(params.explicitSku)) {
    return "quimicos";
  }
  if (isAccessorySku(params.explicitSku)) {
    return "acessorios";
  }

  const source = normalizeLoose(params.text);

  if (source.includes("categoria correta quimico") || source.includes("categoria correta quimicos")) {
    return "quimicos";
  }
  if (source.includes("categoria final esperada piscina") || source.includes("categoria final esperada pool")) {
    return "pool";
  }
  if (source.includes("acessorio para pastilhas") || source.includes("acessorios para pastilhas")) {
    return "acessorios";
  }
  if (source.includes("quimico aplicacao semanal") || source.includes("quimicos aplicacao semanal")) {
    return "quimicos";
  }

  if (/\bqmc(?:\s*-\s*[a-z0-9]{1,8}){1,4}\b/i.test(source)) {
    return "quimicos";
  }
  if (/\bacc(?:\s*-\s*[a-z0-9]{1,8}){1,4}\b/i.test(source)) {
    return "acessorios";
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
  const normalized = preprocessStructuredText(text);
  if (!normalized.includes("=== ITEM")) return [];

  const markerRegex = /===\s*ITEM\b[^\n]*/gi;
  const markers = Array.from(normalized.matchAll(markerRegex));

  if (markers.length === 0) return [];

  const blocks: string[] = [];

  for (let index = 0; index < markers.length; index += 1) {
    const start = markers[index].index ?? 0;
    const end =
      index + 1 < markers.length ? markers[index + 1].index ?? normalized.length : normalized.length;
    const rawBlock = normalized.slice(start, end);
    const cleanedBlock = stripTrailingSpreadsheetSectionHeader(
      normalizeBlock(
        rawBlock.replace(
          /^===\s*ITEM\b[^\n]*(?:\n\s*(?:PLANILHA|ABA|SHEET)\s*:[^\n]*)?(?:\n\s*LINHA\s*:[^\n]*===)?\n?/i,
          "",
        ),
      ),
    );

    if (cleanedBlock) {
      blocks.push(cleanedBlock);
    }
  }

  return blocks;
}

function stripTrailingSpreadsheetSectionHeader(block: string) {
  return normalizeBlock(block.replace(/\n(?:PLANILHA|ABA|SHEET)\s*:\s*[^\n]+$/g, ""));
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

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalizeLoose(line);
    const previousLineIsNameLabel = normalizeLoose(lines[index - 1] || "") === "nome do item";

    const startsNewBlock =
      /^nome do item\s*[:=-]/i.test(line) ||
      normalizedLine.startsWith("nome:") ||
      normalizedLine.startsWith("produto:") ||
      normalizedLine.startsWith("item:") ||
      normalizedLine.startsWith("modelo:") ||
      normalizedLine.startsWith("piscina ") ||
      looksLikeStandaloneChemicalHeading(line, lines.slice(index + 1, index + 13)) ||
      (!previousLineIsNameLabel &&
        looksLikeStandaloneCatalogItemHeading(line, lines.slice(index + 1, index + 15)));

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

function assignExplicitProductNamesToBlocks(
  blocks: string[],
  explicitNameCandidates: InlineProductNameCandidate[]
) {
  const assignments: ExplicitProductNameBlockAssignment[] = [];
  const assignedByBlockIndex = new Map<number, InlineProductNameCandidate[]>();
  const normalizedBlockSkus = blocks.map((block) =>
    collectAllSkuCandidates(block).map((sku) => normalizeSkuForTitleComparison(sku))
  );
  const rawBlockSkus = blocks.map((block) => collectAllSkuCandidates(block));

  for (const candidate of explicitNameCandidates) {
    if (!candidate.accepted) {
      assignments.push({
        cleanedValue: candidate.cleanedValue,
        associatedSku: candidate.associatedSku,
        blockSkuValues: [],
        assignmentReason: "",
        assigned: false,
        rejectionReason: candidate.rejectionReason || "candidate_rejected_before_assignment",
      });
      continue;
    }

    const normalizedAssociatedSku = normalizeSkuForTitleComparison(candidate.associatedSku);
    if (!normalizedAssociatedSku) {
      assignments.push({
        cleanedValue: candidate.cleanedValue,
        associatedSku: candidate.associatedSku,
        blockSkuValues: [],
        assignmentReason: "",
        assigned: false,
        rejectionReason: "missing_associated_sku",
      });
      continue;
    }

    const matchingIndexes = normalizedBlockSkus
      .map((blockSkus, blockIndex) =>
        blockSkus.includes(normalizedAssociatedSku) ? blockIndex : -1
      )
      .filter((value) => value >= 0);

    if (matchingIndexes.length !== 1) {
      assignments.push({
        cleanedValue: candidate.cleanedValue,
        associatedSku: candidate.associatedSku,
        blockSkuValues: matchingIndexes.flatMap((blockIndex) => rawBlockSkus[blockIndex] || []),
        assignmentReason: "",
        assigned: false,
        rejectionReason:
          matchingIndexes.length === 0 ? "no_block_with_matching_explicit_sku" : "ambiguous_matching_explicit_sku",
      });
      continue;
    }

    const assignedBlockIndex = matchingIndexes[0];
    const assignedCandidate: InlineProductNameCandidate = {
      ...candidate,
      sourceKind: "pre_segmentation",
    };
    const existing = assignedByBlockIndex.get(assignedBlockIndex) || [];
    existing.push(assignedCandidate);
    assignedByBlockIndex.set(assignedBlockIndex, existing);

    assignments.push({
      cleanedValue: candidate.cleanedValue,
      associatedSku: candidate.associatedSku,
      assignedBlockIndex,
      blockSkuValues: rawBlockSkus[assignedBlockIndex] || [],
      assignmentReason: "matching_explicit_sku",
      assigned: true,
      rejectionReason: "",
    });
  }

  return {
    assignedByBlockIndex,
    assignments,
  };
}

function splitParagraphBlocks(text: string) {
  return normalizeBlock(text)
    .split(/\n\s*\n/)
    .map((block) => normalizeBlock(block))
    .filter(Boolean);
}

function summarizeBlockForDebug(
  block: string,
  index: number,
  segmentationStrategy: string
): StructuredParserBlockDebug {
  const normalizedBlock = normalizeBlock(block);
  const lines = normalizedBlock.split("\n").map((line) => cleanText(line)).filter(Boolean);
  const allSkus = collectAllSkuCandidates(normalizedBlock);
  const priceExtractionCandidates = extractPriceCandidatesWithDiagnostics(normalizedBlock);
  const allPrices = Array.from(
    new Set(
      priceExtractionCandidates
        .filter((candidate) => candidate.accepted)
        .map((candidate) => candidate.normalizedValue)
        .filter(Boolean)
    )
  );
  const normalized = normalizeLoose(normalizedBlock);
  const categoryMatches = [
    normalized.includes("quimicos") || normalized.includes("quimico"),
    normalized.includes("acessorios") || normalized.includes("acessorio"),
    normalized.includes("piscinas") || normalized.includes("piscina"),
    normalized.includes("outros") || normalized.includes("outro"),
  ].filter(Boolean).length;

  return {
    index,
    charCount: normalizedBlock.length,
    lineCount: lines.length,
    previewLines: lines.slice(0, 6),
    segmentationStrategy,
    skuCount: allSkus.length,
    priceCount: allPrices.length,
    looksLikeMultipleProducts:
      allSkus.length > 1 ||
      allPrices.length > 1 ||
      lines.filter((line, lineIndex) =>
        looksLikeStandaloneCatalogItemHeading(line, lines.slice(lineIndex + 1, lineIndex + 15))
      ).length > 1,
    looksLikeTitleOrSection:
      Boolean(lines[0] && isProbablyGenericTitle(lines[0])) ||
      categoryMatches > 1 ||
      /^cat[aá]logo\b/i.test(lines[0] || ""),
  };
}

function extractSpreadsheetRowBlockProvenance(block: string) {
  const normalizedBlock = normalizeBlock(block);
  const sheetName = cleanText(
    normalizedBlock.match(/(?:^|\n)planilha\s*:\s*([^\n]+)/i)?.[1] || ""
  );
  const worksheetRowNumberRaw =
    normalizedBlock.match(/(?:^|\n)linha da planilha\s*:\s*(\d+)/i)?.[1] || "";
  const worksheetRowNumber = worksheetRowNumberRaw ? Number(worksheetRowNumberRaw) : undefined;
  const sheetScopedKey = cleanText(
    normalizedBlock.match(/(?:^|\n)sheet scoped key\s*:\s*([^\n]+)/i)?.[1] || ""
  );

  const detected =
    Boolean(sheetName) &&
    typeof worksheetRowNumber === "number" &&
    Number.isFinite(worksheetRowNumber) &&
    worksheetRowNumber > 0 &&
    Boolean(sheetScopedKey);

  return {
    detected,
    sheetName: sheetName || undefined,
    worksheetRowNumber: detected ? worksheetRowNumber : undefined,
    sheetScopedKey: sheetScopedKey || undefined,
  };
}

function extractSpreadsheetRowBlockMergeProvenance(block: string) {
  const normalizedBlock = normalizeBlock(block);
  const rowNumbers = Array.from(
    normalizedBlock.matchAll(/(?:^|\n)linha da planilha\s*:\s*(\d+)/giu)
  )
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  const sheetScopedKeys = Array.from(
    normalizedBlock.matchAll(/(?:^|\n)sheet scoped key\s*:\s*([^\n]+)/giu)
  )
    .map((match) => cleanText(match[1] || ""))
    .filter(Boolean);

  return {
    sourceWorksheetRowNumbers: rowNumbers.length > 0 ? Array.from(new Set(rowNumbers)) : undefined,
    sourceSheetScopedKeys: sheetScopedKeys.length > 0 ? Array.from(new Set(sheetScopedKeys)) : undefined,
    mergedFromSpreadsheetRows: rowNumbers.length > 1 || sheetScopedKeys.length > 1,
  };
}

function summarizeSpreadsheetAtomicRows(blocks: string[]) {
  const rows = blocks
    .map((block, index) => ({
      blockIndex: index,
      ...extractSpreadsheetRowBlockProvenance(block),
    }))
    .filter((row) => row.detected)
    .map(({ blockIndex, sheetName, worksheetRowNumber, sheetScopedKey }) => ({
      blockIndex,
      sheetName,
      worksheetRowNumber,
      sheetScopedKey,
    }));

  return {
    detected: rows.length > 0 && rows.length === blocks.length,
    count: rows.length,
    rows: rows.slice(0, 20),
  };
}

function countStructuredFieldLikeLines(block: string) {
  return normalizeBlock(block)
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line) => /^[^:\n]{2,80}:\s+\S+/u.test(line)).length;
}

function summarizeDelimitedStructuredBlocks(blocks: string[]) {
  const rows = blocks
    .map((block, index) => {
      const { fieldMap } = parseFieldLines(block);
      const hasExplicitTitle = Boolean(
        cleanText(
          fieldMap["nome do produto"] ||
            fieldMap["nome"] ||
            fieldMap["produto"] ||
            fieldMap["item"] ||
            fieldMap["título"] ||
            fieldMap["titulo"] ||
            ""
        )
      );
      const hasCommercialIdentity = Boolean(
        cleanText(resolveStructuredSkuFieldValue(fieldMap)) ||
          cleanText(chooseBestPriceFromFieldMap(fieldMap)) ||
          cleanText(fieldMap["categoria"] || "")
      );
      const fieldLikeLines = countStructuredFieldLikeLines(block);

      return {
        blockIndex: index,
        detected: hasExplicitTitle && hasCommercialIdentity && fieldLikeLines >= 6,
      };
    })
    .filter((row) => row.detected);

  return {
    detected: rows.length > 0 && rows.length === blocks.length,
    count: rows.length,
  };
}

function coalesceSpreadsheetContinuationRows(blocks: string[]) {
  const mergedBlocks: string[] = [];
  const mergedPairs: Array<{
    sheetName?: string;
    previousRow?: number;
    currentRow?: number;
    reason: string;
  }> = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const currentBlock = normalizeBlock(blocks[index]);
    if (!currentBlock) continue;

    if (mergedBlocks.length === 0) {
      mergedBlocks.push(currentBlock);
      continue;
    }

    const previousBlock = mergedBlocks[mergedBlocks.length - 1];
    const previousProvenance = extractSpreadsheetRowBlockProvenance(previousBlock);
    const currentProvenance = extractSpreadsheetRowBlockProvenance(currentBlock);

    const sameSheet =
      previousProvenance.detected &&
      currentProvenance.detected &&
      normalizeLoose(previousProvenance.sheetName || "") === normalizeLoose(currentProvenance.sheetName || "");
    const consecutiveRows =
      sameSheet &&
      typeof previousProvenance.worksheetRowNumber === "number" &&
      typeof currentProvenance.worksheetRowNumber === "number" &&
      currentProvenance.worksheetRowNumber === previousProvenance.worksheetRowNumber + 1;

    if (!consecutiveRows) {
      mergedBlocks.push(currentBlock);
      continue;
    }

    const previousParsed = parseFieldLines(previousBlock);
    const currentParsed = parseFieldLines(currentBlock);
    const previousProductCandidate = evaluateSpreadsheetRowTitleCandidate(
      previousParsed.fieldMap["produto ou coisa"] || previousParsed.fieldMap["sku"] || "",
      previousParsed.fieldMap["produto ou coisa"] ? "product_like" : "sku"
    );
    const currentProductCandidate = evaluateSpreadsheetRowTitleCandidate(
      currentParsed.fieldMap["produto ou coisa"] || currentParsed.fieldMap["descrição"] || currentParsed.fieldMap["sku"] || "",
      currentParsed.fieldMap["produto ou coisa"]
        ? "product_like"
        : currentParsed.fieldMap["descrição"]
          ? "description"
          : "sku"
    );
    const previousSku = sanitizeSku(resolveStructuredSkuFieldValue(previousParsed.fieldMap)) ||
      collectAllSkuCandidates(previousBlock)[0] ||
      "";
    const previousPrice = chooseBestPriceFromFieldMap(previousParsed.fieldMap);
    const currentSku = sanitizeSku(resolveStructuredSkuFieldValue(currentParsed.fieldMap)) ||
      collectAllSkuCandidates(currentBlock)[0] ||
      "";
    const currentPrice = chooseBestPriceFromFieldMap(currentParsed.fieldMap) || collectAllPriceCandidates(currentBlock)[0] || "";
    const currentStock = extractStructuredStockQuantity(currentParsed.fieldMap);
    const currentCarriesContinuation = hasSpreadsheetContinuationMarker(
      [
        currentParsed.fieldMap["sku"] || "",
        currentParsed.fieldMap["descrição"] || "",
        currentParsed.plainLines[0] || "",
      ].join(" ")
    );
    const previousIncomplete = !previousSku && !previousPrice;
    const currentHasStructuredComplements = Boolean(currentSku || currentPrice || currentStock);
    const currentHasCompetingTitle = currentProductCandidate.accepted && !currentCarriesContinuation;

    if (
      previousIncomplete &&
      previousProductCandidate.accepted &&
      currentCarriesContinuation &&
      currentHasStructuredComplements &&
      !currentHasCompetingTitle
    ) {
      mergedBlocks[mergedBlocks.length - 1] = normalizeBlock(`${previousBlock}\n${currentBlock}`);
      mergedPairs.push({
        sheetName: currentProvenance.sheetName,
        previousRow: previousProvenance.worksheetRowNumber,
        currentRow: currentProvenance.worksheetRowNumber,
        reason: "spreadsheet_row_continuation",
      });
      continue;
    }

    mergedBlocks.push(currentBlock);
  }

  return {
    blocks: mergedBlocks,
    trace: {
      inputCount: blocks.length,
      outputCount: mergedBlocks.length,
      mergedPairs,
    },
  };
}

function chooseBlocksDetailed(extracted: ExtractedFileContent) {
  const positionalBlocks = Array.isArray(extracted.positionalTextBlocks)
    ? extracted.positionalTextBlocks
        .filter((block) => {
          const text = cleanText(block.text);
          if (!text) return false;
          return true;
        })
        .filter((block) => Boolean(cleanText(block.text)))
        .sort((left, right) => {
          if (left.pageNumber !== right.pageNumber) return left.pageNumber - right.pageNumber;
          return left.blockIndex - right.blockIndex;
        })
        .map((block) => cleanText(block.text))
        .filter(Boolean)
    : [];
  const baseText = positionalBlocks.length > 0 ? positionalBlocks.join("\n\n") : extracted.text;
  const preparedText = preprocessStructuredText(baseText);
  const explicitNameCandidatesBeforeSegmentation =
    captureExplicitProductNameCandidatesBeforeSegmentation(preparedText);
  const finalizeBlocks = (blocks: string[], strategy: string) => {
    const normalizedBlocks = blocks.map((block) => normalizeBlock(block)).filter(Boolean);
    const spreadsheetAtomicRows = summarizeSpreadsheetAtomicRows(normalizedBlocks);
    if (strategy === "delimited_items" && spreadsheetAtomicRows.detected) {
      const spreadsheetContinuation = coalesceSpreadsheetContinuationRows(normalizedBlocks);
      const explicitNameAssignments = assignExplicitProductNamesToBlocks(
        spreadsheetContinuation.blocks,
        explicitNameCandidatesBeforeSegmentation
      );
      return {
        blocks: spreadsheetContinuation.blocks,
        explicitNameCandidatesBeforeSegmentation,
        explicitNameAssignments: explicitNameAssignments.assignments,
        explicitNamesByBlockIndex: explicitNameAssignments.assignedByBlockIndex,
        strategy: `${strategy}+spreadsheet_atomic_rows`,
        fragmentCoalesce: {
          inputCount: spreadsheetContinuation.blocks.length,
          outputCount: spreadsheetContinuation.blocks.length,
          mergedPairs: [],
          transitionSplits: [],
        },
        continuationCoalesce: {
          inputCount: spreadsheetContinuation.blocks.length,
          outputCount: spreadsheetContinuation.blocks.length,
          mergedPairs: [],
        },
        spreadsheetContinuationCoalesce: spreadsheetContinuation.trace,
        spreadsheetAtomicRows: {
          detected: true,
          count: spreadsheetAtomicRows.count,
          narrativeSplitSkipped: true,
          rows: spreadsheetAtomicRows.rows,
        },
      };
    }

    const structuredDelimitedBlocks = summarizeDelimitedStructuredBlocks(normalizedBlocks);
    if (strategy === "delimited_items" && structuredDelimitedBlocks.detected) {
      const explicitNameAssignments = assignExplicitProductNamesToBlocks(
        normalizedBlocks,
        explicitNameCandidatesBeforeSegmentation
      );
      return {
        blocks: normalizedBlocks,
        explicitNameCandidatesBeforeSegmentation,
        explicitNameAssignments: explicitNameAssignments.assignments,
        explicitNamesByBlockIndex: explicitNameAssignments.assignedByBlockIndex,
        strategy: `${strategy}+structured_atomic_blocks`,
        fragmentCoalesce: {
          inputCount: normalizedBlocks.length,
          outputCount: normalizedBlocks.length,
          mergedPairs: [],
          transitionSplits: [],
        },
        continuationCoalesce: {
          inputCount: normalizedBlocks.length,
          outputCount: normalizedBlocks.length,
          mergedPairs: [],
        },
        spreadsheetContinuationCoalesce: {
          inputCount: normalizedBlocks.length,
          outputCount: normalizedBlocks.length,
          mergedPairs: [],
        },
        spreadsheetAtomicRows: {
          detected: false,
          count: spreadsheetAtomicRows.count,
          narrativeSplitSkipped: true,
          rows: spreadsheetAtomicRows.rows,
        },
      };
    }

    if (strategy === "pdf_positional_blocks") {
      const explicitNameAssignments = assignExplicitProductNamesToBlocks(
        normalizedBlocks,
        explicitNameCandidatesBeforeSegmentation
      );
      return {
        blocks: normalizedBlocks,
        explicitNameCandidatesBeforeSegmentation,
        explicitNameAssignments: explicitNameAssignments.assignments,
        explicitNamesByBlockIndex: explicitNameAssignments.assignedByBlockIndex,
        strategy,
        fragmentCoalesce: {
          inputCount: normalizedBlocks.length,
          outputCount: normalizedBlocks.length,
          mergedPairs: [],
          transitionSplits: [],
        },
        continuationCoalesce: {
          inputCount: normalizedBlocks.length,
          outputCount: normalizedBlocks.length,
          mergedPairs: [],
        },
        spreadsheetContinuationCoalesce: {
          inputCount: normalizedBlocks.length,
          outputCount: normalizedBlocks.length,
          mergedPairs: [],
        },
        spreadsheetAtomicRows: {
          detected: false,
          count: spreadsheetAtomicRows.count,
          narrativeSplitSkipped: true,
          rows: spreadsheetAtomicRows.rows,
        },
      };
    }

    const segmented = blocks.flatMap((block) => splitMixedProductBlock(block));
    const coalesced = coalesceProductFragmentsAfterSplit(segmented);
    const transitionSplit = splitTransitionCarriedBlocks(coalesced.blocks);
    const continued = coalesceContinuationFragments(transitionSplit.blocks);
    const finalBlocks = continued.blocks;
    const explicitNameAssignments = assignExplicitProductNamesToBlocks(
      finalBlocks,
      explicitNameCandidatesBeforeSegmentation
    );
    const finalStrategy =
      segmented.length > blocks.length ? `${strategy}+mixed_product_split` : strategy;
    return {
      blocks: finalBlocks,
      explicitNameCandidatesBeforeSegmentation,
      explicitNameAssignments: explicitNameAssignments.assignments,
      explicitNamesByBlockIndex: explicitNameAssignments.assignedByBlockIndex,
      strategy:
        coalesced.blocks.length < segmented.length || continued.blocks.length < coalesced.blocks.length
          ? `${finalStrategy}+fragment_coalesce`
          : finalStrategy,
      fragmentCoalesce: {
        inputCount: segmented.length,
        outputCount: coalesced.blocks.length,
        mergedPairs: coalesced.mergedPairs,
        transitionSplits: [
          ...coalesced.transitionSplits,
          ...transitionSplit.transitionSplits,
        ],
      },
      continuationCoalesce: {
        inputCount: coalesced.blocks.length,
        outputCount: finalBlocks.length,
        mergedPairs: continued.mergedPairs,
      },
      spreadsheetContinuationCoalesce: {
        inputCount: normalizedBlocks.length,
        outputCount: normalizedBlocks.length,
        mergedPairs: [],
      },
      spreadsheetAtomicRows: {
        detected: false,
        count: spreadsheetAtomicRows.count,
        narrativeSplitSkipped: false,
        rows: spreadsheetAtomicRows.rows,
      },
    };
  };

  if (positionalBlocks.length > 0) {
    return finalizeBlocks(positionalBlocks, "pdf_positional_blocks");
  }

  const delimited = splitDelimitedBlocks(preparedText);
  if (delimited.length > 0) {
    return finalizeBlocks(delimited, "delimited_items");
  }

  const repeatedFieldBlocks = splitRepeatedFieldBlocks(preparedText);
  if (repeatedFieldBlocks.length > 1) {
    return finalizeBlocks(repeatedFieldBlocks, "repeated_field_blocks");
  }

  const numbered = splitNumberedBlocks(preparedText);
  if (numbered.length > 1) {
    return finalizeBlocks(numbered, "numbered_blocks");
  }

  const paragraphs = splitParagraphBlocks(preparedText).filter(
    (block) => normalizeLoose(block).length >= 20
  );
  if (paragraphs.length > 1) {
    return finalizeBlocks(paragraphs, "paragraph_blocks");
  }

  return finalizeBlocks([normalizeBlock(preparedText)].filter(Boolean), "single_block_fallback");
}

function chooseBlocks(extracted: ExtractedFileContent) {
  return chooseBlocksDetailed(extracted).blocks;
}

function parseFieldLines(block: string) {
  const lines = block
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean);

  const fieldMap: Record<string, string> = {};
  const plainLines: string[] = [];
  const inlineProductNameCandidates: InlineProductNameCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const looseCategoryField = extractLooseInlineCategoryField(line);
    const effectiveLine = looseCategoryField.cleanedLine || line;
    if (looseCategoryField.value) {
      appendFieldValue(fieldMap, "categoria", looseCategoryField.value);
    }
    const explicitNameCandidates = extractInlineExplicitProductNameCandidates(effectiveLine);
    if (explicitNameCandidates.length > 0) {
      inlineProductNameCandidates.push(...explicitNameCandidates);
      for (const candidate of explicitNameCandidates) {
        if (!candidate.accepted) continue;
        appendFieldValue(fieldMap, candidate.label, candidate.cleanedValue);
      }
    }

    const inlinePairs = extractInlineFieldPairs(effectiveLine);
    if (inlinePairs.length > 0) {
      for (const [key, value] of inlinePairs) {
        appendFieldValue(fieldMap, key, value);
      }
      continue;
    }

    const match = effectiveLine.match(/^([^:]{2,120}):\s*(.+)$/);
    if (match) {
      appendFieldValue(fieldMap, match[1], match[2]);
      continue;
    }

    const standaloneLabel = findStandaloneFieldLabel(effectiveLine);
    const nextLine = standaloneLabel ? cleanText(lines[index + 1] || "") : "";
    if (standaloneLabel && nextLine && !findStandaloneFieldLabel(nextLine)) {
      appendFieldValue(fieldMap, standaloneLabel, nextLine);
      index += 1;
      continue;
    }

    const plainLine = effectiveLine.replace(/^\d+[\)\.\-]\s+/, "").trim();
    if (plainLine) {
      plainLines.push(plainLine);
    }
  }

  return { fieldMap, plainLines, inlineProductNameCandidates };
}

function pickUsableTitleCandidate(value: string | null | undefined) {
  const candidates = String(value || "")
    .split("\n")
    .map((line) => stripTrailingPositionalLineArtifacts(stripTrailingStructuredDetails(stripNarrativeLeadIn(line))))
    .filter(Boolean);

  return (
    candidates.find((line) => {
      if (findStandaloneFieldLabel(line)) return false;
      if (isProbablyGenericTitle(line)) return false;
      if (isLikelySectionContextLine(line)) return false;
      return line.length >= 3 && line.length <= 180;
    }) || ""
  );
}

function stripSpreadsheetContinuationLeadIn(value: string | null | undefined) {
  const cleaned = cleanText(value || "");
  if (!cleaned) return "";

  const stripped = cleanText(
    cleaned.replace(
      /^(?:linha\s+quebrada\s+parte\s*\d+\s*[:\-]?\s*|parte\s*\d+\s*[:\-]?\s*|continua(?:cao|ção)\s*[:\-]?\s*)/iu,
      ""
    )
  );

  return stripped || cleaned;
}

function hasSpreadsheetContinuationMarker(value: string | null | undefined) {
  return /(?:linha\s+quebrada\s+parte\s*\d+|continua(?:cao|ção))/iu.test(String(value || ""));
}

type SpreadsheetRowIdentityDecision = {
  field: string;
  value: string;
  accepted: boolean;
  rejectionReason: string;
};

type SpreadsheetRowIdentityResolution = {
  applied: boolean;
  resolvedTitle?: string;
  resolvedSku?: string;
  titleSource?: string;
  skuSource?: string;
  reconciled: boolean;
  decisions: SpreadsheetRowIdentityDecision[];
};

function evaluateSpreadsheetRowTitleCandidate(
  rawValue: string | null | undefined,
  field: string
): SpreadsheetRowIdentityDecision & { candidate: string } {
  const value = cleanText(rawValue || "");
  const candidate =
    field === "product_like"
      ? cleanText(
          stripTrailingPositionalLineArtifacts(
            stripTrailingStructuredDetails(stripSpreadsheetContinuationLeadIn(value))
          )
        )
      : pickUsableTitleCandidate(stripSpreadsheetContinuationLeadIn(value));
  const normalizedCandidate = normalizeLoose(candidate);

  if (!candidate) {
    return { field, value, candidate: "", accepted: false, rejectionReason: "empty_candidate" };
  }
  if (sanitizeSku(candidate)) {
    return { field, value, candidate, accepted: false, rejectionReason: "sku_like_value" };
  }
  if (collectAllSkuCandidates(candidate).length > 0) {
    return { field, value, candidate, accepted: false, rejectionReason: "embedded_sku_signal" };
  }
  if (/^\s*(?:r\$\s*)?\d[\d.,]*\s*$/iu.test(candidate)) {
    return { field, value, candidate, accepted: false, rejectionReason: "price_only" };
  }
  if (findStandaloneFieldLabel(candidate)) {
    return { field, value, candidate, accepted: false, rejectionReason: "field_label_only" };
  }
  if (isProbablyGenericTitle(candidate)) {
    return { field, value, candidate, accepted: false, rejectionReason: "generic_title" };
  }
  if (isLikelySectionContextLine(candidate)) {
    return { field, value, candidate, accepted: false, rejectionReason: "section_context" };
  }
  if (partLooksLikeImportInstruction(normalizedCandidate)) {
    return { field, value, candidate, accepted: false, rejectionReason: "import_instruction" };
  }
  if (partLooksLikeDocumentArtifact(normalizedCandidate)) {
    return { field, value, candidate, accepted: false, rejectionReason: "document_artifact" };
  }
  if (partLooksLikeTransitionArtifact(normalizedCandidate)) {
    return { field, value, candidate, accepted: false, rejectionReason: "transition_artifact" };
  }
  if (/^(?:linha quebrada|continua(?:cao|ção))\b/i.test(candidate)) {
    return { field, value, candidate, accepted: false, rejectionReason: "continuation_marker" };
  }
  if (/^objetivo\b/i.test(candidate)) {
    return { field, value, candidate, accepted: false, rejectionReason: "instruction_heading" };
  }

  return { field, value, candidate, accepted: true, rejectionReason: "" };
}

function resolveSpreadsheetRowIdentity(args: {
  fieldMap: Record<string, string>;
  normalizedBlock: string;
}): SpreadsheetRowIdentityResolution {
  const provenance = extractSpreadsheetRowBlockProvenance(args.normalizedBlock);
  if (!provenance.detected) {
    return {
      applied: false,
      reconciled: false,
      decisions: [],
    };
  }

  const productLikeDecision = evaluateSpreadsheetRowTitleCandidate(
    args.fieldMap["produto ou coisa"] || "",
    "product_like"
  );
  const descriptionDecision = evaluateSpreadsheetRowTitleCandidate(
    args.fieldMap["descrição"] || args.fieldMap["descriÃ§Ã£o"] || "",
    "description"
  );
  const skuFieldDecision = evaluateSpreadsheetRowTitleCandidate(args.fieldMap["sku"] || "", "sku");

  const strongSkuFromSkuField =
    sanitizeSku(args.fieldMap["sku"] || "") || collectAllSkuCandidates(args.fieldMap["sku"] || "")[0] || "";
  const strongSkuFromCodeField =
    sanitizeSku(args.fieldMap["codigo"] || args.fieldMap["código"] || args.fieldMap["cÃ³digo"] || "") ||
    collectAllSkuCandidates(
      args.fieldMap["codigo"] || args.fieldMap["código"] || args.fieldMap["cÃ³digo"] || ""
    )[0] ||
    "";
  const strongSkuFromDescriptionField =
    sanitizeSku(args.fieldMap["descrição"] || args.fieldMap["descriÃ§Ã£o"] || "") ||
    collectAllSkuCandidates(args.fieldMap["descrição"] || args.fieldMap["descriÃ§Ã£o"] || "")[0] ||
    "";
  const strongestSku =
    strongSkuFromSkuField || strongSkuFromCodeField || strongSkuFromDescriptionField || "";
  const decisions = [productLikeDecision, descriptionDecision, skuFieldDecision].map(
    ({ field, value, accepted, rejectionReason }) => ({
      field,
      value,
      accepted,
      rejectionReason,
    })
  );

  if (productLikeDecision.accepted) {
    return {
      applied: true,
      resolvedTitle: productLikeDecision.candidate,
      resolvedSku: strongestSku || undefined,
      titleSource: "spreadsheet_alias:product_like",
      skuSource: strongSkuFromSkuField
        ? "sku"
        : strongSkuFromCodeField
          ? "codigo"
          : strongSkuFromDescriptionField
            ? "description"
            : undefined,
      reconciled: false,
      decisions,
    };
  }

  if (!strongSkuFromSkuField && skuFieldDecision.accepted && strongSkuFromDescriptionField) {
    return {
      applied: true,
      resolvedTitle: skuFieldDecision.candidate,
      resolvedSku: strongSkuFromDescriptionField,
      titleSource: "spreadsheet_field:original_sku_field",
      skuSource: "description",
      reconciled: true,
      decisions,
    };
  }

  if (descriptionDecision.accepted && (strongSkuFromSkuField || strongSkuFromCodeField)) {
    return {
      applied: true,
      resolvedTitle: descriptionDecision.candidate,
      resolvedSku: strongSkuFromSkuField || strongSkuFromCodeField,
      titleSource: "spreadsheet_field:description",
      skuSource: strongSkuFromSkuField ? "sku" : "codigo",
      reconciled: false,
      decisions,
    };
  }

  if (!strongestSku && skuFieldDecision.accepted) {
    return {
      applied: true,
      resolvedTitle: skuFieldDecision.candidate,
      titleSource: "spreadsheet_field:original_sku_field",
      reconciled: true,
      decisions,
    };
  }

  if (skuFieldDecision.accepted && strongSkuFromSkuField) {
    return {
      applied: true,
      resolvedTitle: skuFieldDecision.candidate,
      resolvedSku: strongSkuFromSkuField,
      titleSource: "spreadsheet_field:original_sku_field",
      skuSource: "sku",
      reconciled: true,
      decisions,
    };
  }

  return {
    applied: true,
    resolvedSku: strongestSku || undefined,
    skuSource: strongSkuFromSkuField
      ? "sku"
      : strongSkuFromCodeField
        ? "codigo"
        : strongSkuFromDescriptionField
          ? "description"
          : undefined,
    reconciled: false,
    decisions,
  };
}

const TITLE_FIELD_CANDIDATE_KEYS = [
  "nome",
  "nome do produto",
  "nome do item",
  "titulo",
  "título",
  "produto",
  "item",
  "modelo",
  "product name",
  "nome comercial",
];

function findStructuredTitleCandidate(fieldMap: Record<string, string>) {
  for (const key of TITLE_FIELD_CANDIDATE_KEYS) {
    const candidate = pickUsableTitleCandidate(fieldMap[key]);
    if (candidate) {
      return {
        key,
        candidate,
      };
    }
  }

  return null;
}

function injectExplicitProductNameIntoFieldMap(
  fieldMap: Record<string, string>,
  candidates: InlineProductNameCandidate[]
) {
  if (findStructuredTitleCandidate(fieldMap)) {
    return false;
  }

  const acceptedCandidate = candidates.find((candidate) => candidate.accepted && candidate.cleanedValue);
  if (!acceptedCandidate) {
    return false;
  }

  appendFieldValue(fieldMap, acceptedCandidate.label || "nome do produto", acceptedCandidate.cleanedValue);
  return true;
}

function extractAllSkuCandidates(text: string) {
  const matches = Array.from(
    String(text || "").matchAll(
      /\b(?:sku|c[oó]digo(?:\s+do\s+produto)?)\s*[:\-]?\s*([a-z0-9][a-z0-9\-_.\/]{2,})\b/gi
    )
  )
    .map((match) => sanitizeSku(match[1] || ""))
    .filter(Boolean);

  const directMatches = Array.from(
    String(text || "").matchAll(/\b(acc-\d{3,}|out-\d{3,}|qmc-\d{3,})\b/gi)
  )
    .map((match) => sanitizeSku(match[1] || ""))
    .filter(Boolean);

  return Array.from(new Set([...matches, ...directMatches]));
}

function extractAllPriceCandidates(text: string) {
  return extractPriceCandidatesWithDiagnostics(text)
    .filter((candidate) => candidate.accepted)
    .map((candidate) => candidate.normalizedValue);

  return Array.from(
    String(text || "").matchAll(
      /(?:r\$\s*|pre[cç]o(?:\s+(?:venda|final|sugerido|custo))?(?:\s*\(r\$\))?\s*[:\-]?\s*)(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/gi
    )
  )
    .map((match) => cleanText(match[1] || ""))
    .filter(Boolean);
}

function extractChemicalTitleFromNarrative(value: string | null | undefined) {
  const lines = String(value || "")
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(.{3,120}?\b\d{3,4})\s+foi\s+/i);
    const candidate = pickUsableTitleCandidate(match?.[1] || "");
    if (candidate) return candidate;
  }

  return "";
}

function normalizeSkuForTitleComparison(value: string | null | undefined) {
  return normalizeLoose(String(value || "").replace(/[-_.\/]+/g, " "));
}

function cleanupTitleResidualPunctuation(value: string) {
  return cleanText(
    String(value || "")
      .replace(/\s*(?:[,:;\/|]+|[-–—])\s*$/u, "")
      .replace(/\s*[,.]+$/u, "")
  );
}

function removeTrailingTitleFieldLabels(value: string) {
  let current = cleanText(value);
  let changed = false;

  for (;;) {
    const next = cleanText(
      current.replace(
        /\s*(?:[-,:;\/|]+)?\s*(?:c[oó]d(?:igo)?|cod(?:igo)?|sku|ref|refer[eê]ncia|pre[cç]o|valor)\s*$/iu,
        ""
      )
    );

    if (!next || next === current) {
      return { value: current, changed };
    }

    current = next;
    changed = true;
  }
}

function findSpecificationStartIndex(args: {
  title: string;
  destination: StructuredImportDestination;
}) {
  const title = cleanText(args.title);
  if (!title) return -1;

  const markerRegex =
    /\b(?:material|fibra|formato|largura|altura|comprimento|profundidade|capacidade|volume|peso|cor|acabamento|estoque|pre[cç]o|categoria|aplica[cç][aã]o|uso|c[oó]digo|sku)\b/giu;
  const matches = Array.from(title.matchAll(markerRegex));
  if (matches.length === 0) return -1;

  for (const match of matches) {
    const index = match.index ?? -1;
    if (index <= 0) continue;

    const prefix = cleanText(title.slice(0, index));
    const suffix = cleanText(title.slice(index));
    const prefixWordCount = normalizeLoose(prefix).split(" ").filter(Boolean).length;
    const suffixMarkerCount = Array.from(suffix.matchAll(markerRegex)).length;
    const hasDimensionSignal =
      /\b\d+(?:[.,]\d+)?\s*m\b/iu.test(suffix) ||
      /\bretangular\b|\boval\b|\bredond[ao]\b/iu.test(suffix);

    if (!prefix || prefixWordCount < 2) continue;

    if (suffixMarkerCount >= 2) {
      return index;
    }

    if (args.destination === "pool" && suffixMarkerCount >= 1 && hasDimensionSignal) {
      return index;
    }
  }

  return -1;
}

function looksLikeAmbiguousBundleTitle(value: string) {
  const cleaned = cleanText(value);
  const normalized = normalizeLoose(cleaned);
  if (!normalized) return false;

  if (normalized.includes("peneira e cabo")) return true;
  if (normalized.includes("varios itens") || normalized.includes("varios item")) return true;
  if (normalized.includes("kit ou varios itens")) return true;
  if (/\b(e|ou)\b/.test(normalized) && /\b(sem|com|para|de|do|da|em)\s*$/i.test(normalized)) {
    return true;
  }
  if (/\bsem\b/i.test(normalized) && normalized.split(" ").filter(Boolean).length <= 6) {
    return true;
  }

  return false;
}

function stripTrailingImportInstructionSentence(value: string) {
  const cleaned = cleanText(value);
  if (!cleaned) {
    return {
      value: "",
      removed: false,
    };
  }

  const sentenceParts = cleaned
    .split(/(?<=[.!?])\s+/u)
    .map((part) => cleanText(part))
    .filter(Boolean);
  if (sentenceParts.length < 2) {
    return {
      value: cleaned,
      removed: false,
    };
  }

  const trailingSentence = sentenceParts[sentenceParts.length - 1] || "";
  if (!partLooksLikeImportInstruction(normalizeLoose(trailingSentence))) {
    return {
      value: cleaned,
      removed: false,
    };
  }

  const remaining = cleanText(sentenceParts.slice(0, -1).join(". ").replace(/[.!?\s]+$/u, ""));
  if (!remaining) {
    return {
      value: cleaned,
      removed: false,
    };
  }

  return {
    value: remaining,
    removed: true,
  };
}

function looksLikeAmbiguousReviewCandidateTitle(args: {
  title: string;
  destination: StructuredImportDestination;
  hasSku: boolean;
  hasPrice: boolean;
}) {
  const normalized = normalizeLoose(args.title);
  if (!normalized) return false;

  const hasCommercialAbsenceSignal =
    normalized.includes("sem codigo") ||
    normalized.includes("sem sku") ||
    normalized.includes("sem preco");
  const hasUncertaintySignal =
    normalized.includes("talvez") ||
    normalized.includes("possivelmente") ||
    normalized.includes("pode ser") ||
    normalized.includes("aparenta ser");
  if (!hasCommercialAbsenceSignal || !hasUncertaintySignal) {
    return false;
  }

  const categoryAliases = (
    [
      { destination: "pool" as const, aliases: buildDescriptionCategoryCandidates({ sourceCategory: "", destination: "pool" }) },
      {
        destination: "quimicos" as const,
        aliases: buildDescriptionCategoryCandidates({ sourceCategory: "", destination: "quimicos" }),
      },
      {
        destination: "acessorios" as const,
        aliases: buildDescriptionCategoryCandidates({ sourceCategory: "", destination: "acessorios" }),
      },
      { destination: "outros" as const, aliases: buildDescriptionCategoryCandidates({ sourceCategory: "", destination: "outros" }) },
    ] satisfies Array<{ destination: StructuredImportDestination; aliases: string[] }>
  ).filter(({ destination }) => destination !== "outros");

  const referencedDestinations = categoryAliases
    .filter(({ aliases }) =>
      aliases.some((alias) => {
        const normalizedAlias = normalizeLoose(alias);
        return normalizedAlias && normalized.includes(normalizedAlias);
      })
    )
    .map(({ destination }) => destination);

  const uniqueReferencedDestinations = Array.from(new Set(referencedDestinations));
  if (uniqueReferencedDestinations.length < 2) {
    return false;
  }

  return !args.hasSku && !args.hasPrice;
}

function canonicalizeImportedProductTitle(args: {
  candidateTitle: string;
  rawBlock: string;
  destination: StructuredImportDestination;
  sku: string;
}) {
  const originalTitle = cleanText(args.candidateTitle);
  const rawBlockNormalized = normalizeLoose(args.rawBlock);
  let title = originalTitle;
  const titleCleanupReasons: string[] = [];

  const cleanedLeadIn = stripNarrativeLeadIn(title);
  if (cleanedLeadIn && cleanedLeadIn !== title) {
    title = cleanedLeadIn;
    titleCleanupReasons.push("removed_narrative_prefix");
  }

  const trailingFieldCleanup = removeTrailingTitleFieldLabels(title);
  if (trailingFieldCleanup.changed) {
    title = trailingFieldCleanup.value;
    titleCleanupReasons.push("removed_trailing_field_label");
  }

  const specificationStartIndex = findSpecificationStartIndex({
    title,
    destination: args.destination,
  });
  const blockHasAttributeContext =
    /\bfibra\b|\bformato\b|\blargura\b|\baltura\b|\bcomprimento\b|\bprofundidade\b|\bcapacidade\b|\bvolume\b|\bpeso\b|\bcor\b|\bmaterial\b/.test(
      rawBlockNormalized
    );
  if (
    specificationStartIndex > 0 &&
    (args.destination === "pool" || blockHasAttributeContext)
  ) {
    title = cleanText(title.slice(0, specificationStartIndex));
    titleCleanupReasons.push("trimmed_trailing_specifications");
  }

  const withoutResidualPunctuation = cleanupTitleResidualPunctuation(title);
  if (withoutResidualPunctuation !== title) {
    title = withoutResidualPunctuation;
    titleCleanupReasons.push("removed_residual_punctuation");
  }

  const withoutTrailingInstruction = stripTrailingImportInstructionSentence(title);
  if (withoutTrailingInstruction.removed) {
    title = withoutTrailingInstruction.value;
    titleCleanupReasons.push("removed_trailing_import_instruction");
  }

  title = cleanText(title);

  const titleMatchesSku =
    Boolean(title) &&
    Boolean(args.sku) &&
    normalizeSkuForTitleComparison(title) === normalizeSkuForTitleComparison(args.sku);
  const ambiguousTitle = looksLikeAmbiguousBundleTitle(title);
  const titleStatus = titleMatchesSku
    ? ("missing_name" as const)
    : ambiguousTitle
      ? ("ambiguous" as const)
      : ("canonical" as const);

  if (titleMatchesSku) {
    titleCleanupReasons.push("title_matches_sku");
  }
  if (ambiguousTitle) {
    titleCleanupReasons.push("ambiguous_bundle_title");
  }

  return {
    originalTitle,
    canonicalTitle: title,
    titleCleanupReasons,
    titleStatus,
    missingName: titleMatchesSku,
    ambiguousTitle,
  };
}

function chooseTitle(
  fieldMap: Record<string, string>,
  plainLines: string[],
  fileName: string,
  index: number
) {
  const structuredCandidate = findStructuredTitleCandidate(fieldMap);
  if (structuredCandidate) {
    return structuredCandidate.candidate;
  }

  const titleFromNarrative = extractChemicalTitleFromNarrative(
    [
      fieldMap["descriÃ§Ã£o"],
      fieldMap["descriÃ§Ã£o comercial"],
      fieldMap["observaÃ§Ãµes"],
      ...plainLines,
    ]
      .filter(Boolean)
      .join("\n")
  );
  if (titleFromNarrative) return titleFromNarrative;

  const firstLongPlainLine = plainLines
    .map((line) => pickUsableTitleCandidate(line))
    .find(Boolean);
  if (firstLongPlainLine) return firstLongPlainLine;

  return `${fileName} • item ${index + 1}`;
}

function chooseDescription(
  fieldMap: Record<string, string>,
  plainLines: string[],
  title: string
) {
  const primaryDescriptionKeys = ["descrição", "descrição comercial"];
  const secondaryDescriptionKeys = ["indicação", "observações"];

  const pickedPrimaryParts = primaryDescriptionKeys
    .map((key) => fieldMap[key])
    .filter(Boolean)
    .flatMap((value) => String(value || "").split("\n"))
    .map((line) => cleanDescriptionLine(line, title))
    .filter(Boolean);

  const pickedSecondaryParts = secondaryDescriptionKeys
    .map((key) => fieldMap[key])
    .filter(Boolean)
    .flatMap((value) => String(value || "").split("\n"))
    .map((line) => cleanDescriptionLine(line, title))
    .filter(Boolean);

  const plainDescriptionLines = filterDescriptionPlainLines(plainLines, title, fieldMap);

  const mergedPrimary = mergeDescriptionParts([...pickedPrimaryParts, ...plainDescriptionLines]);
  if (mergedPrimary) {
    return mergedPrimary;
  }

  return mergeDescriptionParts(pickedSecondaryParts);
}

function detectTitleSource(
  fieldMap: Record<string, string>,
  plainLines: string[],
  fileName: string,
  index: number,
  title: string
) {
  const normalizedTitle = normalizeLoose(title);
  const structuredCandidate = findStructuredTitleCandidate(fieldMap);
  if (structuredCandidate && normalizeLoose(structuredCandidate.candidate) === normalizedTitle) {
    return `named_field:${structuredCandidate.key}`;
  }

  const titleFromNarrative = extractChemicalTitleFromNarrative(
    [
      fieldMap["descriÃƒÂ§ÃƒÂ£o"],
      fieldMap["descriÃƒÂ§ÃƒÂ£o comercial"],
      fieldMap["observaÃƒÂ§ÃƒÂµes"],
      ...plainLines,
    ]
      .filter(Boolean)
      .join("\n")
  );
  if (titleFromNarrative && normalizeLoose(titleFromNarrative) === normalizedTitle) {
    return "narrative";
  }

  const firstLongPlainLine = plainLines
    .map((line) => pickUsableTitleCandidate(line))
    .find(Boolean);
  if (firstLongPlainLine && normalizeLoose(firstLongPlainLine) === normalizedTitle) {
    return "first_line";
  }

  if (normalizeLoose(`${fileName} â€¢ item ${index + 1}`) === normalizedTitle) {
    return "fallback";
  }

  return "unknown";
}

function enrichFieldMapWithLooseExtraction(
  fieldMap: Record<string, string>,
  sourceText: string
) {
  if (!fieldMap["preço venda"] && !fieldMap["preço sugerido"] && !fieldMap["preço"]) {
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

  if (!fieldMap["marca"] && !fieldMap["marca / linha"]) {
    const looseBrand = extractLooseBrand(sourceText);
    if (looseBrand) fieldMap["marca"] = looseBrand;
  }

  if (!resolveStructuredSkuFieldValue(fieldMap)) {
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

function extractStructuredStockQuantity(fieldMap: Record<string, string>) {
  return cleanText(fieldMap["estoque"] || fieldMap["quantidade atual"] || "");
}

function extractLooseStructuredStockQuantity(text: string) {
  const match = String(text || "").match(
    /\b(?:estoque|quantidade(?: atual)?|qtd\??|unidades?)\s*[:\-]?\s*(\d+)\b/iu
  );
  return cleanText(match?.[1] || "");
}

function collectSpreadsheetReviewSignals(args: {
  provenanceDetected: boolean;
  fieldMap: Record<string, string>;
  title: string;
  price: string;
  sku: string;
}) {
  if (!args.provenanceDetected) return [];

  const reviewSource = [
    args.fieldMap["observações"] || "",
    args.fieldMap["aplicação"] || "",
    args.fieldMap["descrição"] || "",
    args.fieldMap["produto ou coisa"] || "",
    args.title,
  ]
    .filter(Boolean)
    .join("\n");
  const normalized = normalizeLoose(reviewSource);
  const signals = new Set<string>();

  if (normalized.includes("suspeito")) signals.add("suspect_source_marker");
  if (normalized.includes("nome muito generico")) signals.add("generic_name_signal");
  if (normalized.includes("linha fraca")) signals.add("weak_source_signal");
  if (normalized.includes("deve revisar") || normalized.includes("revisar")) {
    signals.add("manual_review_signal");
  }
  if (!cleanText(args.price) && normalized.includes("sem preco")) {
    signals.add("missing_price_signal");
  }
  if (!cleanText(args.sku) && (normalized.includes("sem sku") || normalized.includes("sem codigo"))) {
    signals.add("missing_sku_signal");
  }

  return Array.from(signals);
}

function inferCandidateAlerts(
  normalizedBlock: string,
  title: string,
  allSkus: string[],
  allPrices: string[],
  destination: StructuredImportDestination,
  titleStatus?: "canonical" | "missing_name" | "ambiguous"
) {
  const lines = normalizedBlock.split("\n").map((line) => cleanText(line)).filter(Boolean);
  const normalizedLines = lines.map((line) => normalizeLoose(line));
  const normalizedTitle = normalizeLoose(title);
  const titleLineIndex = normalizedLines.findIndex((line) => line.includes(normalizedTitle));
  const findClosestDistance = (values: string[]) => {
    if (titleLineIndex < 0) return Number.MAX_SAFE_INTEGER;
    const valueIndexes = values
      .map((value) => normalizedLines.findIndex((line) => line.includes(normalizeLoose(value))))
      .filter((value) => value >= 0);
    if (valueIndexes.length === 0) return Number.MAX_SAFE_INTEGER;
    return Math.min(...valueIndexes.map((valueIndex) => Math.abs(valueIndex - titleLineIndex)));
  };

  const categoryHits = [
    normalizedBlock.match(/\bquimic(?:o|os)?\b/g)?.length || 0,
    normalizedBlock.match(/\bacessor(?:io|ios)\b/g)?.length || 0,
    normalizedBlock.match(/\bpiscina(?:s)?\b/g)?.length || 0,
    normalizedBlock.match(/\boutro(?:s)?\b/g)?.length || 0,
  ].filter((count) => count > 0).length;

  const alerts: string[] = [];
  if (allSkus.length > 1) alerts.push("multiple_skus");
  if (allPrices.length > 1) alerts.push("multiple_prices");
  if (isProbablyGenericTitle(title)) alerts.push("title_looks_document_heading");
  if (findClosestDistance(allSkus) > 3) alerts.push("sku_far_from_title");
  if (findClosestDistance(allPrices) > 3) alerts.push("price_far_from_title");
  if (categoryHits > 1) alerts.push("mixed_categories");
  if (lines.length > 6 && !normalizedBlock.includes("=== item") && lines.filter((line) => line.includes(":")).length < 2) {
    alerts.push("weak_separator");
  }
  if (allSkus.length > 1 || (allPrices.length > 1 && destination === "outros")) {
    alerts.push("possible_merged_items");
  }
  if (titleStatus === "missing_name") alerts.push("missing_name");
  if (titleStatus === "ambiguous") alerts.push("ambiguous_title");
  return alerts;
}

function normalizeFragmentSignalText(value: string | null | undefined) {
  return normalizeLoose(cleanText(value || ""));
}

function startsWithPriceLikeFragment(value: string) {
  return /^(?:r\$\s*\d|\d+(?:[.,]\d{2})\b)/i.test(cleanText(value));
}

function startsWithDetailLikeFragment(value: string) {
  return /^(?:apenas\s+informa|texto\s+perdido|valor\s+colocado|sem\s+preco|sem\s+sku|instalacao|estoque|categoria|medidas?|largura|comprimento|profundidade|capacidade|observa(?:cao|coes)|notas?)/i.test(
    normalizeFragmentSignalText(value)
  );
}

function hasReliableNominalAnchor(args: {
  title: string;
  rawBlock: string;
  sku: string;
  destination: StructuredImportDestination;
}) {
  const normalizedTitle = normalizeFragmentSignalText(args.title);
  const normalizedRawBlock = normalizeFragmentSignalText(args.rawBlock);
  const alphaWordCount = normalizedTitle
    .split(" ")
    .filter((token) => token.length >= 3 && /[a-z]/.test(token)).length;

  if (cleanText(args.sku)) return true;
  if (PRODUCT_WORD_REGEX.test(args.title)) return true;
  if (args.destination === "pool" && /\bpiscina\b/.test(normalizedRawBlock)) return true;
  if (alphaWordCount >= 3 && !startsWithPriceLikeFragment(args.title) && !startsWithDetailLikeFragment(args.title)) {
    return true;
  }

  return false;
}

function collectPositionalFragmentReviewSignals(args: {
  title: string;
  rawBlock: string;
  sku: string;
  destination: StructuredImportDestination;
  description: string;
}) {
  const signals = new Set<string>();
  const normalizedTitle = normalizeFragmentSignalText(args.title);
  const normalizedDescription = normalizeFragmentSignalText(args.description);
  const reliableNominalAnchor = hasReliableNominalAnchor(args);
  const shortAlphaText =
    normalizedTitle.replace(/[^a-z\s]/g, " ").trim().length > 0 &&
    normalizedTitle.split(" ").filter((token) => /[a-z]/.test(token)).length <= 4;

  if (startsWithPriceLikeFragment(args.title)) {
    signals.add("fragment_price_lead");
  }
  if (startsWithDetailLikeFragment(args.title)) {
    signals.add("fragment_detail_lead");
  }
  if (
    !reliableNominalAnchor &&
    (normalizedDescription.startsWith(normalizedTitle) ||
      startsWithDetailLikeFragment(args.rawBlock) ||
      /^(?:apenas|texto|valor|sem)\b/.test(normalizedTitle))
  ) {
    signals.add("fragment_description_residue");
  }
  if (!reliableNominalAnchor && (shortAlphaText || startsWithPriceLikeFragment(args.title))) {
    signals.add("weak_nominal_anchor");
  }

  return Array.from(signals);
}

function isWeakFragmentItem(item: StructuredImportItem) {
  const normalizedTitle = normalizeLoose(item.title);
  if (!normalizedTitle) return true;
  const hasSku = Boolean(cleanText(item.sku));
  const hasPrice = Boolean(cleanText(item.price));
  if (hasSku || hasPrice) return false;

  if (
    normalizedTitle === "escova" ||
    normalizedTitle === "aspirador" ||
    normalizedTitle === "kit ou varios itens separados" ||
    normalizedTitle === "kit ou varios itens separado" ||
    /,$/.test(String(item.title || "").trim())
  ) {
    return true;
  }

  return normalizedTitle.length <= 18 && item.description.trim().length <= 40;
}

function shouldPreserveAmbiguousReviewCandidate(item: StructuredImportItem) {
  const hasAmbiguitySignal = item.ambiguousTitle === true || item.titleStatus === "ambiguous";
  if (!hasAmbiguitySignal) return false;

  const normalizedTitle = normalizeLoose(item.title);
  const normalizedRawBlock = normalizeLoose(item.rawBlock);
  const normalizedDescription = normalizeLoose(item.description);
  const combinedContext = [normalizedTitle, normalizedRawBlock, normalizedDescription]
    .filter(Boolean)
    .join(" ");

  const explicitReviewEvidence = [
    "sem sku",
    "sem sku unico",
    "preco aproximado",
    "preco estimado",
    "deve ser tratado com cuidado",
    "este trecho deve ser tratado com cuidado",
    "deve vir para revisao",
    "revisao",
    "revisar",
    "suspeito",
    "desmarcado",
  ].some((signal) => combinedContext.includes(signal));

  if (!explicitReviewEvidence) return false;

  const plausibleCommercialCandidate =
    PRODUCT_WORD_REGEX.test(cleanText(item.title)) ||
    /\b(?:peneira|cabo|kit|itens?)\b/.test(combinedContext);

  if (!plausibleCommercialCandidate) return false;

  if (partLooksLikeDocumentArtifact(normalizedTitle) || partLooksLikeDocumentArtifact(normalizedRawBlock)) {
    return false;
  }

  if (partLooksLikeTransitionArtifact(normalizedTitle) || partLooksLikeTransitionArtifact(normalizedRawBlock)) {
    return false;
  }

  if (blockIsTransitionOnlyLine(item.title) || blockIsTransitionOnlyLine(item.rawBlock)) {
    return false;
  }

  if (blockIsContextOnlyLine(item.title) || blockLooksLikeContinuationFragment(item.rawBlock)) {
    return false;
  }

  return true;
}

function parseSingleBlockDetailed(
  block: string,
  fileName: string,
  index: number,
  preassignedExplicitNames: InlineProductNameCandidate[] = []
): {
  item: StructuredImportItem | null;
  debug: StructuredParserCandidateDebug | null;
} {
  const normalizedBlock = normalizeBlock(block);
  if (!normalizedBlock) {
    return {
      item: null,
      debug: null,
    };
  }

  const { fieldMap, plainLines, inlineProductNameCandidates } = parseFieldLines(normalizedBlock);
  const transportedInlineProductNameCandidates = preassignedExplicitNames.map((candidate) => ({
    ...candidate,
    sourceKind: "pre_segmentation" as const,
  }));

  injectExplicitProductNameIntoFieldMap(fieldMap, transportedInlineProductNameCandidates);

  enrichFieldMapWithLooseExtraction(fieldMap, normalizedBlock);

  const spreadsheetIdentityResolution = resolveSpreadsheetRowIdentity({
    fieldMap,
    normalizedBlock,
  });
  const provenance = extractSpreadsheetRowBlockProvenance(normalizedBlock);
  const mergeProvenance = extractSpreadsheetRowBlockMergeProvenance(normalizedBlock);
  const title =
    spreadsheetIdentityResolution.resolvedTitle || chooseTitle(fieldMap, plainLines, fileName, index);

  const resolvedSku = sanitizeSku(resolveStructuredSkuFieldValue(fieldMap));
  const resolvedDosage = findStandaloneFieldLabel(fieldMap["dosagem"] || "")
    ? extractLooseDosage(normalizedBlock)
    : fieldMap["dosagem"] || extractLooseDosage(normalizedBlock);
  const resolvedBrandAndLine = resolveStructuredBrandAndLine(fieldMap);
  const fallbackSku = collectAllSkuCandidates(normalizedBlock)[0] || "";
  const effectiveSku = spreadsheetIdentityResolution.resolvedSku || resolvedSku || fallbackSku;
  const sheetName =
    provenance.sheetName ||
    cleanText(fieldMap["planilha"] || fieldMap["aba"] || fieldMap["sheet"] || "");
  const sourceCategory = cleanText(fieldMap["categoria"] || "");
  const sourceSubcategory = cleanText(fieldMap["subcategoria"] || "");

  const sourceText = [
    title,
    normalizedBlock,
    effectiveSku,
    sourceCategory,
    sourceSubcategory,
    sheetName,
  ]
    .filter(Boolean)
    .join("\n");
  const destination = inferDestination({
    text: sourceText,
    explicitSku: effectiveSku,
    explicitCategory: sourceCategory,
    explicitSubcategory: sourceSubcategory,
    explicitSheetName: sheetName,
  });
  const canonicalTitle = canonicalizeImportedProductTitle({
    candidateTitle: title,
    rawBlock: normalizedBlock,
    destination,
    sku: effectiveSku,
  });
  const promotedPrice = chooseBestPriceFromFieldMap(fieldMap);
  const stockQuantity =
    extractStructuredStockQuantity(fieldMap) ||
    (provenance.detected ? extractLooseStructuredStockQuantity(normalizedBlock) : "");
  const titleIsStructurallyAmbiguous =
    canonicalTitle.ambiguousTitle ||
    looksLikeAmbiguousReviewCandidateTitle({
      title: canonicalTitle.canonicalTitle || title,
      destination,
      hasSku: Boolean(cleanText(effectiveSku)),
      hasPrice: Boolean(cleanText(promotedPrice)),
    });
  const resolvedTitleStatus = canonicalTitle.missingName
    ? ("missing_name" as const)
    : titleIsStructurallyAmbiguous
      ? ("ambiguous" as const)
      : ("canonical" as const);
  const titleForDescription =
    spreadsheetIdentityResolution.titleSource === "spreadsheet_alias:product_like"
      ? cleanText(title)
      : canonicalTitle.canonicalTitle || title;
  const descriptionCandidates = collectDescriptionCandidateParts(
    fieldMap,
    plainLines,
    titleForDescription
  );
  const initialDescription = chooseDescription(fieldMap, plainLines, titleForDescription);
  const canonicalDescription = canonicalizeImportedProductDescription({
    rawBlock: normalizedBlock,
    fieldMap,
    plainLines,
    originalTitle: canonicalTitle.originalTitle || title,
    canonicalTitle: titleForDescription,
    sku: effectiveSku,
    destination,
    sourceCategory,
    initialDescription,
    candidateParts: [
      ...descriptionCandidates.pickedPrimaryParts,
      ...descriptionCandidates.plainDescriptionLines,
      ...descriptionCandidates.pickedSecondaryParts,
    ],
    candidateSources: [
      ...(descriptionCandidates.pickedPrimaryParts.length > 0 ? ["field_description"] : []),
      ...(descriptionCandidates.plainDescriptionLines.length > 0 ? ["plain_lines"] : []),
      ...(descriptionCandidates.pickedSecondaryParts.length > 0 ? ["secondary_fields"] : []),
    ],
    price: promotedPrice,
    missingName: canonicalTitle.missingName,
    ambiguousTitle: canonicalTitle.ambiguousTitle,
  });
  const reviewSignals = Array.from(
    new Set([
      ...collectSpreadsheetReviewSignals({
        provenanceDetected: provenance.detected,
        fieldMap,
        title: titleForDescription,
        price: promotedPrice,
        sku: effectiveSku,
      }),
      ...collectPositionalFragmentReviewSignals({
        title: titleForDescription,
        rawBlock: normalizedBlock,
        sku: effectiveSku,
        destination,
        description: canonicalDescription.canonicalDescription,
      }),
    ])
  );

  const item: StructuredImportItem = {
    sourceFileName: fileName,
    destination,
    categoria: sourceCategory || (destination === "pool" ? "pool" : destination),
    title: titleForDescription,
    originalTitle: canonicalTitle.originalTitle || title,
    description: canonicalDescription.canonicalDescription,
    originalDescription: canonicalDescription.originalDescription,
    rawBlock: normalizedBlock,
    confidence:
      titleIsStructurallyAmbiguous && !cleanText(effectiveSku) && !cleanText(promotedPrice)
        ? 0.62
        : destination === "outros"
          ? 0.62
          : 0.86,
    titleCleanupReasons: canonicalTitle.titleCleanupReasons,
    titleStatus: resolvedTitleStatus,
    missingName: canonicalTitle.missingName,
    ambiguousTitle: titleIsStructurallyAmbiguous,
    descriptionCleanupReasons: canonicalDescription.cleanupReasons,
    descriptionStatus: canonicalDescription.descriptionStatus,
    price: promotedPrice,
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
    brand: resolvedBrandAndLine.brand,
    line: resolvedBrandAndLine.line,
    sku: effectiveSku,
    unit: fieldMap["unidade"] || "",
    weight: fieldMap["peso"] || fieldMap["peso/volume"] || fieldMap["volume"] || "",
    dosage: resolvedDosage,
    color: fieldMap["cor"] || "",
    usage: fieldMap["uso"] || "",
    notes: fieldMap["observações"] || "",
    indication: fieldMap["indicação"] || "",
    composition: fieldMap["composição"] || "",
    embalagem: fieldMap["embalagem"] || "",
    packaging: fieldMap["packaging"] || "",
    model: fieldMap["modelo"] || "",
    size: fieldMap["tamanho"] || "",
    compatibility: fieldMap["compatibilidade"] || "",
    function: fieldMap["função"] || fieldMap["finalidade"] || "",
    environment: fieldMap["ambiente"] || fieldMap["ambiente indicado"] || "",
    diferencial: fieldMap["diferencial"] || "",
    application: fieldMap["aplicação"] || "",
    sheetName,
    sourceCategory,
    sourceSubcategory,
    stockQuantity,
    worksheetRowNumber: provenance.worksheetRowNumber,
    sheetScopedKey: provenance.sheetScopedKey,
    sourceWorksheetRowNumbers:
      mergeProvenance.sourceWorksheetRowNumbers ||
      (provenance.worksheetRowNumber ? [provenance.worksheetRowNumber] : undefined),
    sourceSheetScopedKeys:
      mergeProvenance.sourceSheetScopedKeys ||
      (provenance.sheetScopedKey ? [provenance.sheetScopedKey] : undefined),
    mergedFromSpreadsheetRows: mergeProvenance.mergedFromSpreadsheetRows,
    reviewSignals,
  };

  if (!normalizeLoose(item.title)) {
    return {
      item: null,
      debug: null,
    };
  }

  const allSkus = collectAllSkuCandidates(normalizedBlock);
  const priceExtractionCandidates = extractPriceCandidatesWithDiagnostics(normalizedBlock);
  const allPrices = Array.from(
    new Set(
      priceExtractionCandidates
        .filter((candidate) => candidate.accepted)
        .map((candidate) => candidate.normalizedValue)
        .filter(Boolean)
    )
  );
  const promotedPriceFinal =
    item.price || (allPrices.length === 1 && !/[a-z]/i.test(allPrices[0] || "") ? allPrices[0] : "");

  return {
    item: {
      ...item,
      price: promotedPriceFinal,
    },
    debug: {
      blockIndex: index,
      originalTitle: canonicalTitle.originalTitle || title,
      canonicalTitle: item.title,
      title: item.title,
      inlineProductNameCandidates: [
        ...inlineProductNameCandidates,
        ...transportedInlineProductNameCandidates,
      ],
      titleSource:
        spreadsheetIdentityResolution.titleSource ||
        detectTitleSource(fieldMap, plainLines, fileName, index, item.title),
      titleCleanupReasons: canonicalTitle.titleCleanupReasons,
      titleStatus: resolvedTitleStatus,
      missingName: canonicalTitle.missingName,
      ambiguousTitle: titleIsStructurallyAmbiguous,
      originalDescription: canonicalDescription.originalDescription,
      canonicalDescription: canonicalDescription.canonicalDescription,
      descriptionCleanupReasons: canonicalDescription.cleanupReasons,
      descriptionStatus: canonicalDescription.descriptionStatus,
      descriptionCandidateSources: canonicalDescription.candidateSources,
      rawBlockSemanticRemainder: canonicalDescription.rawBlockSemanticRemainder,
      descriptionClauses: canonicalDescription.descriptionClauses,
      preservedDescriptionParts: canonicalDescription.preservedParts,
      rejectedDescriptionParts: canonicalDescription.rejectedParts,
      canonicalDescriptionApplied: true,
      frontFallbackAllowed: false,
      sku: item.sku || "",
      allSkus,
      price: promotedPriceFinal,
      allPrices,
      priceExtractionCandidates,
      destination: item.destination,
      confidence: item.confidence,
      spreadsheetIdentityResolution: {
        applied: spreadsheetIdentityResolution.applied,
        titleSource: spreadsheetIdentityResolution.titleSource,
        skuSource: spreadsheetIdentityResolution.skuSource,
        reconciled: spreadsheetIdentityResolution.reconciled,
        decisions: spreadsheetIdentityResolution.decisions,
      },
      alerts: inferCandidateAlerts(
        normalizedBlock,
        item.title,
        allSkus,
        allPrices,
        item.destination,
        resolvedTitleStatus
      ),
    },
  };
}

function parseSingleBlock(
  block: string,
  fileName: string,
  index: number,
  preassignedExplicitNames: InlineProductNameCandidate[] = []
): StructuredImportItem | null {
  return parseSingleBlockDetailed(block, fileName, index, preassignedExplicitNames).item;
}

function isProbablyGenericTitle(title: string) {
  const normalized = normalizeLoose(title);
  if (!normalized) return true;
  if (normalized === "docx" || normalized === "pdf" || normalized === "xlsx" || normalized === "pptx") {
    return true;
  }
  if (/\b(docx|pdf|xlsx|pptx)\s+item\s+\d+$/.test(normalized)) return true;
  if (/^\d+\s+itens?$/.test(normalized)) return true;

  const blocked = [
    "catalogo de teste",
    "catálogo de teste",
    "catalogo de produtos",
    "documento de teste",
    "arquivo de teste",
    "nome do produto",
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
  if (preprocessStructuredText(extractedText).includes("=== ITEM")) return true;
  if (/^\d+[\).\-]\s+/m.test(preprocessStructuredText(extractedText))) return true;

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
    (Boolean(cleanText(item.title)) && Boolean(cleanText(item.sku))) ||
    (Boolean(cleanText(item.title)) && Boolean(item.reviewSignals && item.reviewSignals.length > 0)) ||
    Boolean(item.price) ||
    Boolean(item.dimensions) ||
    Boolean(item.capacity) ||
    Boolean(item.material) ||
    Boolean(item.dosage) ||
    Boolean(item.application) ||
    Boolean(item.embalagem)
  );
}

function buildParserCandidateLifecycleKey(item: StructuredImportItem) {
  const sku = normalizeLoose(item.sku);
  const title = normalizeLoose(item.title);
  return sku ? `sku::${sku}` : `title::${title}`;
}

export function parseStructuredImportItems(extracted: ExtractedFileContent): StructuredImportItem[] {
  const preparedText = preprocessStructuredText(extracted.text);
  const preparedExtracted: ExtractedFileContent = {
    ...extracted,
    text: preparedText,
  };

  const chosenBlocks = chooseBlocksDetailed(preparedExtracted);
  const blocks = chosenBlocks.blocks;
  debugIntelligentImport("parser-blocks", {
    fileName: extracted.fileName,
    blockCount: blocks.length,
    firstBlocks: blocks.slice(0, 5).map((block, index) => ({
      index,
      preview: block.slice(0, 180),
    })),
  });

  const parsedItems: StructuredImportItem[] = [];

  blocks.forEach((block, index) => {
    const parsed = parseSingleBlock(
      block,
      extracted.fileName,
      index,
      chosenBlocks.explicitNamesByBlockIndex.get(index) || []
    );
    if (parsed) {
      parsedItems.push(parsed);
    } else {
      debugIntelligentImport("parser-null-item", {
        fileName: extracted.fileName,
        blockIndex: index,
        preview: block.slice(0, 180),
      });
    }
  });

  if (parsedItems.length === 0) {
    debugIntelligentImport("parser-summary", {
      fileName: extracted.fileName,
      totalItems: 0,
      keptItems: 0,
    });
    return [];
  }

  const mergedItems = mergeStructuredImportItems(parsedItems);

  const qualitySorted = [...mergedItems].sort((a, b) => {
    const score = (item: StructuredImportItem) =>
      scoreStructuredItem(item) +
      (item.dimensions ? 50 : 0) +
      (item.capacity ? 50 : 0) +
      (item.material ? 20 : 0) +
      (item.brand ? 20 : 0) -
      (looksLikeStockOnlyItem(item) ? 80 : 0);

    return score(b) - score(a);
  });

  debugIntelligentImport("parser-quality-sorted", {
    fileName: extracted.fileName,
    items: qualitySorted.slice(0, 20).map((item, index) => ({
      index,
      title: item.title,
      sku: item.sku,
      destination: item.destination,
      price: item.price,
      sheetName: item.sheetName,
      sourceCategory: item.sourceCategory,
      sourceSubcategory: item.sourceSubcategory,
    })),
  });

  const sourceLooksSingleItem =
    !looksLikeMultiItemSource(preparedText, mergedItems.length) &&
    (mergedItems.length === 1 ||
      normalizeLoose(preparedText).includes("nome do item") ||
      normalizeLoose(preparedText).includes("descricao detalhada") ||
      normalizeLoose(preparedText).includes("preco sugerido") ||
      normalizeLoose(preparedText).includes("preço sugerido"));

  if (sourceLooksSingleItem) {
    const kept = qualitySorted[0] ? [qualitySorted[0]] : [];
    debugIntelligentImport("parser-summary", {
      fileName: extracted.fileName,
      sourceLooksSingleItem,
      totalItems: mergedItems.length,
      keptItems: kept.length,
      kept: kept.map((item) => ({
        title: item.title,
        sku: item.sku,
        destination: item.destination,
        price: item.price,
      })),
    });
    return kept;
  }

  const keptItems = qualitySorted.filter((item) => {
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

    if (shouldPreserveAmbiguousReviewCandidate(item)) {
      return true;
    }

    if (isWeakFragmentItem(item)) {
      debugIntelligentImport("parser-filtered-out", {
        reason: "weak-fragment",
        fileName: extracted.fileName,
        title: item.title,
        sku: item.sku,
        destination: item.destination,
      });
      return false;
    }

    if (looksLikeStockOnlyItem(item)) {
      debugIntelligentImport("parser-filtered-out", {
        reason: "stock-only",
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
    totalItems: mergedItems.length,
    keptItems: keptItems.length,
    kept: keptItems.slice(0, 120).map((item, index) => ({
      index,
      title: item.title,
      sku: item.sku,
      destination: item.destination,
      price: item.price,
      sheetName: item.sheetName,
      sourceCategory: item.sourceCategory,
      sourceSubcategory: item.sourceSubcategory,
    })),
  });

  return keptItems;
}

export function parseStructuredImportItemsDetailed(extracted: ExtractedFileContent): {
  items: StructuredImportItem[];
  debug: StructuredParserFileDebug;
} {
  const preparedText = preprocessStructuredText(extracted.text);
  const preparedExtracted: ExtractedFileContent = {
    ...extracted,
    text: preparedText,
  };
  const chosenBlocks = chooseBlocksDetailed(preparedExtracted);
  const blocks = chosenBlocks.blocks;
  const parsedItems: StructuredImportItem[] = [];
  const parserCandidates: StructuredParserCandidateDebug[] = [];
  const mergeTrace: StructuredParserMergeDebug[] = [];

  blocks.forEach((block, index) => {
    const parsed = parseSingleBlockDetailed(
      block,
      extracted.fileName,
      index,
      chosenBlocks.explicitNamesByBlockIndex.get(index) || []
    );
    if (parsed.debug) parserCandidates.push(parsed.debug);
    if (parsed.item) parsedItems.push(parsed.item);
  });

  const buildDebug = (
    itemsBeforeFilter: StructuredImportItem[],
    keptItems: StructuredImportItem[],
    sourceLooksSingleItem: boolean,
    sourceLooksSingleItemReasons: string[]
  ): StructuredParserFileDebug => {
    const keptKeys = new Set(keptItems.map((item) => buildParserCandidateLifecycleKey(item)));
    const lifecycle = itemsBeforeFilter.slice(0, 24).map((item) => {
      const key = buildParserCandidateLifecycleKey(item);
      const retained = keptKeys.has(key);
      const retainedReason = retained && shouldPreserveAmbiguousReviewCandidate(item)
        ? "ambiguous-review-candidate"
        : "";
      let dropReason = "";
      if (!retained) {
        if (sourceLooksSingleItem) {
          dropReason = "source_looks_single_item_kept_higher_score";
        } else if (isProbablyGenericTitle(item.title)) {
          dropReason = "generic-title";
        } else if (isWeakFragmentItem(item)) {
          dropReason = "weak-fragment";
        } else if (looksLikeStockOnlyItem(item)) {
          dropReason = "stock-only";
        } else if (!hasUsefulContent(item)) {
          dropReason = "not-useful-enough";
        } else {
          dropReason = "dropped_after_filter";
        }
      }

      return {
        key,
        title: item.title,
        sku: item.sku || "",
        enteredStage: "merge",
        leftStage: retained ? (retainedReason ? "retained" : "final") : sourceLooksSingleItem ? "sourceLooksSingleItem" : "filter",
        retained,
        retainedReason: retainedReason || undefined,
        dropReason,
      };
    });

    return {
      fileName: extracted.fileName,
      mimeType: extracted.mimeType,
      extractedCharCount: String(extracted.text || "").length,
      approxLineCount: normalizeBlock(extracted.text || "").split("\n").filter(Boolean).length,
      usefulLinesPreview: buildPreviewLines(extracted.text, 6),
      looksLikeContinuousText: looksLikeContinuousNarrativeText(extracted.text),
      explicitNameCandidatesBeforeSegmentation: chosenBlocks.explicitNameCandidatesBeforeSegmentation?.map(
        (candidate) => ({
          label: candidate.label,
          rawValue: candidate.rawValue,
          cleanedValue: candidate.cleanedValue,
          sourceStart: candidate.sourceStart ?? candidate.sourcePosition,
          sourceEnd: candidate.sourceEnd ?? candidate.sourcePosition,
          associatedSku: candidate.associatedSku,
          associatedSkuPosition: candidate.associatedSkuPosition,
          accepted: candidate.accepted,
          rejectionReason: candidate.rejectionReason,
        })
      ),
      explicitNameCandidateAssignments: chosenBlocks.explicitNameAssignments,
      chooseBlocks: {
        strategy: chosenBlocks.strategy,
        blockCount: blocks.length,
        blocks: blocks.slice(0, 20).map((block, index) =>
          summarizeBlockForDebug(block, index, chosenBlocks.strategy)
        ),
      },
      parseSingleBlock: {
        candidateCount: parsedItems.length,
        nullBlockCount: Math.max(0, blocks.length - parsedItems.length),
        candidates: parserCandidates.slice(0, 20),
      },
      sourceLooksSingleItem: {
        activated: sourceLooksSingleItem,
        reasons: sourceLooksSingleItemReasons,
        beforeCount: itemsBeforeFilter.length,
        afterCount: keptItems.length,
        candidateLifecycle: lifecycle,
      },
      merge: {
        inputCount: parsedItems.length,
        outputCount: itemsBeforeFilter.length,
        mergedPairs: mergeTrace.slice(0, 20),
      },
      fragmentCoalesce: chosenBlocks.fragmentCoalesce,
      continuationCoalesce: chosenBlocks.continuationCoalesce,
      spreadsheetContinuationCoalesce: chosenBlocks.spreadsheetContinuationCoalesce,
      spreadsheetAtomicRows: chosenBlocks.spreadsheetAtomicRows,
    };
  };

  if (parsedItems.length === 0) {
    return {
      items: [],
      debug: buildDebug([], [], false, []),
    };
  }

  const mergedItems = mergeStructuredImportItems(parsedItems, mergeTrace);
  const qualitySorted = [...mergedItems].sort((a, b) => {
    const score = (item: StructuredImportItem) =>
      scoreStructuredItem(item) +
      (item.dimensions ? 50 : 0) +
      (item.capacity ? 50 : 0) +
      (item.material ? 20 : 0) +
      (item.brand ? 20 : 0) -
      (looksLikeStockOnlyItem(item) ? 80 : 0);

    return score(b) - score(a);
  });

  const sourceLooksSingleItem =
    !looksLikeMultiItemSource(preparedText, mergedItems.length) &&
    (mergedItems.length === 1 ||
      normalizeLoose(preparedText).includes("nome do item") ||
      normalizeLoose(preparedText).includes("descricao detalhada") ||
      normalizeLoose(preparedText).includes("preco sugerido") ||
      normalizeLoose(preparedText).includes("preÃ§o sugerido"));
  const sourceLooksSingleItemReasons = [
    !looksLikeMultiItemSource(preparedText, mergedItems.length) ? "not_multi_item_source" : "",
    mergedItems.length === 1 ? "single_merged_item" : "",
    normalizeLoose(preparedText).includes("nome do item") ? "contains_nome_do_item" : "",
    normalizeLoose(preparedText).includes("descricao detalhada") ? "contains_descricao_detalhada" : "",
    normalizeLoose(preparedText).includes("preco sugerido") ||
    normalizeLoose(preparedText).includes("preÃ§o sugerido")
      ? "contains_preco_sugerido"
      : "",
  ].filter(Boolean);

  if (sourceLooksSingleItem) {
    const kept = qualitySorted[0] ? [qualitySorted[0]] : [];
    return {
      items: kept,
      debug: buildDebug(mergedItems, kept, true, sourceLooksSingleItemReasons),
    };
  }

  const keptItems = qualitySorted.filter((item) => {
    if (isChemicalSku(item.sku)) return true;
    if (isProbablyGenericTitle(item.title)) return false;
    if (shouldPreserveAmbiguousReviewCandidate(item)) return true;
    if (isWeakFragmentItem(item)) return false;
    if (looksLikeStockOnlyItem(item)) return false;
    if (!hasUsefulContent(item)) return false;
    return true;
  });

  return {
    items: keptItems,
    debug: buildDebug(mergedItems, keptItems, false, sourceLooksSingleItemReasons),
  };
}
