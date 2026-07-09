import type { ExtractedFileContent } from "./onboarding-file-extractors";
import {
  parseStructuredImportItems,
  parseStructuredImportItemsDetailed,
  type StructuredParserFileDebug,
  type StructuredImportItem,
} from "../onboarding-import-structured-parser";

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

export type NormalizedImportDebug = {
  files: Array<{
    fileName: string;
    parsedItems: number;
    normalizedItems: number;
    droppedItems: string[];
    parser: StructuredParserFileDebug;
  }>;
  totalParsedItems: number;
  totalNormalizedItems: number;
};

function normalizeLoose(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_STRUCTURED_TITLES = new Set([
  "piscina",
  "produto",
  "item",
  "kit",
  "acessorio",
  "acessorios",
  "quimico",
  "quimicos",
]);

const POOL_CONTEXT_TERMS = [
  "piscina",
  "fibra",
  "vinil",
  "alvenaria",
  "profundidade",
  "largura",
  "comprimento",
  "capacidade",
  "casa de maquinas",
  "instalacao embutida",
];

const ACCESSORY_CONTEXT_TERMS = [
  "escada",
  "refletor",
  "aspirador",
  "peneira",
  "cabo telescopico",
  "cabo",
  "mangueira",
  "skimmer",
];

const POSITIONAL_FRAGMENT_SIGNALS = [
  "fragment_price_lead",
  "fragment_detail_lead",
  "fragment_description_residue",
  "weak_nominal_anchor",
] as const;

const STRUCTURED_SKU_PATTERN = /\b(?:qmc|acc|out|otr)\b/gi;

function normalizeStructuredSkuValue(value: string) {
  return String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

export function collectStructuredSkuMatches(text: string) {
  const sourceText = String(text || "");
  const candidates = Array.from(sourceText.matchAll(STRUCTURED_SKU_PATTERN))
    .map((match) => {
      const start = match.index ?? -1;
      if (start < 0) {
        return {
          rawValue: "",
          normalizedValue: "",
          start: -1,
          end: -1,
        };
      }
      const prefixEnd = start + String(match[0] || "").length;
      const suffixCandidates: Array<{
        separator: string;
        token: string;
        tokenEnd: number;
      }> = [];
      let cursor = prefixEnd;
      while (suffixCandidates.length < 4) {
        const remainder = sourceText.slice(cursor);
        const tokenMatch = remainder.match(/^([-\s]+)([a-z0-9]{1,8})/i);
        if (!tokenMatch) break;
        const separator = tokenMatch[1] || "";
        const token = tokenMatch[2] || "";
        if (!separator || !token) break;
        suffixCandidates.push({
          separator,
          token,
          tokenEnd: cursor + tokenMatch[0].length,
        });
        cursor += tokenMatch[0].length;
      }

      let bestSuffixLength = 0;
      for (let length = Math.min(4, suffixCandidates.length); length >= 1; length -= 1) {
        const tokens = suffixCandidates.slice(0, length).map((entry) => entry.token);
        if (!tokens[tokens.length - 1] || !/\d/.test(tokens[tokens.length - 1] || "")) continue;
        let digitSeen = false;
        let alphaOnlyBeforeDigitCount = 0;
        let valid = true;
        for (const token of tokens) {
          const hasDigit = /\d/.test(token);
          if (!digitSeen) {
            if (hasDigit) {
              digitSeen = true;
              continue;
            }
            alphaOnlyBeforeDigitCount += 1;
            if (alphaOnlyBeforeDigitCount > 1) {
              valid = false;
              break;
            }
            continue;
          }
          if (!hasDigit) {
            valid = false;
            break;
          }
        }
        if (valid && digitSeen) {
          bestSuffixLength = length;
          break;
        }
      }

      if (bestSuffixLength === 0) {
        return {
          rawValue: "",
          normalizedValue: "",
          start: -1,
          end: -1,
        };
      }

      let expandedStart = start;
      let qualifierCount = 0;
      while (qualifierCount < 3) {
        if (expandedStart < 2 || sourceText[expandedStart - 1] !== "-") break;
        let tokenEnd = expandedStart - 1;
        let tokenStart = tokenEnd - 1;
        while (tokenStart >= 0 && /[a-z0-9]/i.test(sourceText[tokenStart])) {
          tokenStart -= 1;
        }
        tokenStart += 1;
        const token = sourceText.slice(tokenStart, tokenEnd);
        if (!/^[a-z0-9]{1,8}$/i.test(token)) break;
        expandedStart = tokenStart;
        qualifierCount += 1;
      }

      const rawEnd = suffixCandidates[bestSuffixLength - 1]?.tokenEnd ?? prefixEnd;
      const rawValue = String(sourceText.slice(expandedStart, rawEnd) || "").trim();
      const normalizedValue = normalizeStructuredSkuValue(rawValue);
      return {
        rawValue,
        normalizedValue,
        start: expandedStart,
        end: expandedStart + rawValue.length,
      };
    })
    .filter((candidate) => candidate.rawValue && candidate.normalizedValue && candidate.start >= 0)
    .sort((left, right) => {
      const leftLength = left.end - left.start;
      const rightLength = right.end - right.start;
      if (left.start !== right.start) return left.start - right.start;
      return rightLength - leftLength;
    });

  const accepted: typeof candidates = [];
  for (const candidate of candidates) {
    const containedByAccepted = accepted.some(
      (existing) =>
        existing.start <= candidate.start &&
        existing.end >= candidate.end &&
        (existing.end - existing.start > candidate.end - candidate.start ||
          existing.normalizedValue === candidate.normalizedValue)
    );
    if (containedByAccepted) continue;
    accepted.push(candidate);
  }

  return Array.from(
    new Map(accepted.map((candidate) => [candidate.normalizedValue, candidate.rawValue])).values()
  );
}

function isGenericTitle(value: string) {
  const normalized = normalizeLoose(value);
  if (!normalized) return true;

  const blocked = [
    "catalogo de teste",
    "catálogo de teste",
    "arquivo de teste",
    "nome do item",
    "item importado",
    "descricao detalhada",
    "descrição detalhada",
  ];

  return blocked.some(
    (item) => normalized === normalizeLoose(item) || normalized.startsWith(normalizeLoose(item))
  );
}

function textIncludesAny(normalizedText: string, terms: string[]) {
  return terms.some((term) => normalizedText.includes(normalizeLoose(term)));
}

function extractStructuredPriceRange(value: string) {
  const source = String(value || "").trim();
  if (!source) return null;

  const rangeMatch = source.match(
    /((?:r\$\s*)?(?:\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d{4,}(?:,\d{2})?|\d+[.,]\d{2})\s*(?:a|ate|até)\s*(?:r\$\s*)?(?:\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d{4,}(?:,\d{2})?|\d+[.,]\d{2}))/i
  );
  if (!rangeMatch) return null;

  const values = Array.from(
    rangeMatch[1].matchAll(
      /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d{4,}(?:,\d{2})?|\d+[.,]\d{2})/gi
    )
  )
    .map((match) => {
      const raw = String(match[1] || "").trim();
      const parsed = Number(raw.replace(/\./g, "").replace(",", "."));
      return Number.isFinite(parsed) ? { raw, parsed } : null;
    })
    .filter((entry): entry is { raw: string; parsed: number } => Boolean(entry));

  if (values.length < 2) return null;
  const [first, second] = values;
  const min = Math.min(first.parsed, second.parsed);
  const max = Math.max(first.parsed, second.parsed);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return null;

  return {
    raw: rangeMatch[1].trim(),
    min,
    max,
  };
}

function isStrongStructuredSpreadsheetRow(item: StructuredImportItem) {
  const sourceFileName = String(item.sourceFileName || "").trim().toLowerCase();
  const isSpreadsheetSource =
    sourceFileName.endsWith(".xlsx") || sourceFileName.endsWith(".xlsm") || sourceFileName.endsWith(".xls");
  const hasRowProvenance =
    typeof item.worksheetRowNumber === "number" &&
    Number.isFinite(item.worksheetRowNumber) &&
    item.worksheetRowNumber > 0 &&
    Boolean(String(item.sheetScopedKey || "").trim());
  const hasStructuredIdentity =
    Boolean(String(item.sourceCategory || item.categoria || "").trim()) &&
    Boolean(String(item.title || "").trim()) &&
    Boolean(String(item.sku || "").trim()) &&
    Boolean(String(item.price || "").trim());

  return isSpreadsheetSource && hasRowProvenance && hasStructuredIdentity && !item.mergedFromSpreadsheetRows;
}

function isStrongStructuredDocxItem(item: StructuredImportItem) {
  const sourceFileName = String(item.sourceFileName || "").trim().toLowerCase();
  if (!sourceFileName.endsWith(".docx")) return false;

  const rawBlock = String(item.rawBlock || "");
  const hasDocxProvenance =
    /(?:^|\n)docx block key\s*:/i.test(rawBlock) &&
    /(?:^|\n)docx body index\s*:/i.test(rawBlock) &&
    /(?:^|\n)docx table index\s*:/i.test(rawBlock);
  if (!hasDocxProvenance) return false;

  const hasStructuredIdentity =
    Boolean(String(item.sourceCategory || item.categoria || "").trim()) &&
    Boolean(String(item.title || "").trim()) &&
    Boolean(String(item.sku || "").trim()) &&
    Boolean(String(item.price || "").trim());
  if (!hasStructuredIdentity) return false;

  return collectStructuredSkuMatches(rawBlock).length === 1;
}

function hasPoolDimensionSignals(item: StructuredImportItem) {
  if (String(item.dimensions || "").trim()) return true;
  if (String(item.depth || "").trim() && String(item.size || "").trim()) return true;

  const normalizedRaw = normalizeLoose(item.rawBlock || "");
  return (
    /\b\d+[\.,]?\d*\s*x\s*\d+[\.,]?\d*(?:\s*x\s*\d+[\.,]?\d*)?\s*m\b/.test(normalizedRaw) ||
    normalizedRaw.includes("profundidade") ||
    normalizedRaw.includes("capacidade")
  );
}

function collectStructuralReviewSignals(item: StructuredImportItem) {
  const signals = new Set<string>();
  const normalizedTitle = normalizeLoose(item.title || "");
  const normalizedRaw = normalizeLoose(item.rawBlock || "");
  const normalizedDescription = normalizeLoose(item.description || "");
  const combinedText = [normalizedTitle, normalizedRaw, normalizedDescription].filter(Boolean).join(" ");
  const priceProbeText = String(item.rawBlock || item.description || item.title || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, " ");

  const genericTitle =
    !normalizedTitle ||
    GENERIC_STRUCTURED_TITLES.has(normalizedTitle) ||
    normalizedTitle.includes("produto promocao verao") ||
    normalizedTitle.includes("produto promocao") ||
    normalizedTitle === "qmc d2 005";
  if (genericTitle) {
    signals.add("generic_title");
  }

  if (item.missingName || item.titleStatus === "missing_name") {
    signals.add("missing_name");
  }

  if (item.ambiguousTitle || item.titleStatus === "ambiguous") {
    signals.add("ambiguous_title");
  }

  const priceMatches =
    priceProbeText.match(
      /(?:r\$\s*\d+(?:\.\d{3})*,\d{2}|preco\s*[:\-]?\s*\d+(?:\.\d{3})*,\d{2}|valor\s*[:\-]?\s*\d+(?:\.\d{3})*,\d{2})/g
    ) ?? [];
  const structuredPriceRange = extractStructuredPriceRange(item.price || "");
  if (priceMatches.length > 1 && !structuredPriceRange) {
    signals.add("multiple_prices");
  }

  const skuMatches = collectStructuredSkuMatches(combinedText);
  if (skuMatches.length > 1) {
    signals.add("multiple_skus");
  }

  const strongStructuredSpreadsheetRow = isStrongStructuredSpreadsheetRow(item);
  const strongStructuredDocxItem = isStrongStructuredDocxItem(item);
  const strongStructuredItem = strongStructuredSpreadsheetRow || strongStructuredDocxItem;
  const hasPoolContext = textIncludesAny(combinedText, POOL_CONTEXT_TERMS);
  const hasAccessoryContext = textIncludesAny(combinedText, ACCESSORY_CONTEXT_TERMS);
  if (!strongStructuredItem && hasPoolContext && hasAccessoryContext) {
    signals.add("mixed_product_context");
  }

  if (
    !strongStructuredItem &&
    item.destination !== "pool" &&
    hasPoolContext &&
    hasAccessoryContext &&
    hasPoolDimensionSignals(item)
  ) {
    signals.add("possible_merged_items");
  }

  if (item.destination === "pool" && !hasPoolDimensionSignals(item)) {
    signals.add("pool_missing_required_measures");
  }

  for (const reviewSignal of item.reviewSignals || []) {
    if (POSITIONAL_FRAGMENT_SIGNALS.includes(reviewSignal as (typeof POSITIONAL_FRAGMENT_SIGNALS)[number])) {
      signals.add(reviewSignal);
    }
  }

  return {
    genericTitle,
    signals: Array.from(signals),
  };
}

function buildReviewReasons(args: {
  missingPrice: boolean;
  missingSku: boolean;
  genericTitle: boolean;
  ambiguousBundle: boolean;
  weakCandidate: boolean;
  sourceReviewSignals: string[];
  structuralSignals: string[];
}) {
  const reasons = [
    args.structuralSignals.includes("missing_name") ? "missing_name" : "",
    args.structuralSignals.includes("ambiguous_title") ? "ambiguous_title" : "",
    args.structuralSignals.includes("generic_title") ? "generic_title" : "",
    args.structuralSignals.includes("multiple_prices") ? "multiple_prices_in_block" : "",
    args.structuralSignals.includes("multiple_skus") ? "multiple_skus_in_block" : "",
    args.structuralSignals.includes("possible_merged_items") ? "possible_merged_items" : "",
    args.structuralSignals.includes("mixed_product_context") ? "mixed_product_context" : "",
    args.structuralSignals.includes("pool_missing_required_measures")
      ? "pool_missing_required_measures"
      : "",
    args.structuralSignals.includes("fragment_price_lead") ? "fragment_price_lead" : "",
    args.structuralSignals.includes("fragment_detail_lead") ? "fragment_detail_lead" : "",
    args.structuralSignals.includes("fragment_description_residue") ? "fragment_description_residue" : "",
    args.structuralSignals.includes("weak_nominal_anchor") ? "weak_nominal_anchor" : "",
    args.ambiguousBundle ? "ambiguous_bundle" : "",
    args.weakCandidate ? "weak_candidate" : "",
    args.missingPrice ? "missing_price" : "",
    args.missingSku ? "missing_sku" : "",
    ...args.sourceReviewSignals,
  ].filter(Boolean);

  return Array.from(new Set(reasons));
}

function resolveNormalizedType(item: StructuredImportItem): NormalizedImportItemType {
  if (item.destination === "pool") return "pool";
  if (
    item.destination === "quimicos" ||
    item.destination === "acessorios" ||
    item.destination === "outros"
  ) {
    return "catalog_item";
  }
  return "unknown";
}

function canonicalCategoryForDestination(destination: StructuredImportItem["destination"]) {
  if (destination === "pool") return "pool";
  if (destination === "quimicos") return "quimicos";
  if (destination === "acessorios") return "acessorios";
  if (destination === "outros") return "outros";
  return "";
}

function resolveCategoryMetadata(item: StructuredImportItem) {
  const rawExplicitCategory = String(item.sourceCategory || item.categoria || "").trim();
  const rawExplicitSubcategory = String(item.sourceSubcategory || "").trim();
  const categoryParts = rawExplicitCategory
    .split("\n")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const subcategoryParts = rawExplicitSubcategory
    .split("\n")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  const canonicalDestinationCategory = canonicalCategoryForDestination(item.destination);
  const primaryCategoryCandidate = categoryParts[0] || rawExplicitCategory;
  const normalizedPrimaryCategoryCandidate = normalizeLoose(primaryCategoryCandidate);
  const explicitCategory =
    !normalizedPrimaryCategoryCandidate
      ? canonicalDestinationCategory
      : normalizedPrimaryCategoryCandidate === "pool" ||
          normalizedPrimaryCategoryCandidate === "piscina" ||
          normalizedPrimaryCategoryCandidate === "piscinas"
        ? "pool"
        : normalizedPrimaryCategoryCandidate === "quimico" ||
            normalizedPrimaryCategoryCandidate === "quimicos"
          ? "quimicos"
          : normalizedPrimaryCategoryCandidate === "acessorio" ||
              normalizedPrimaryCategoryCandidate === "acessorios"
            ? "acessorios"
            : normalizedPrimaryCategoryCandidate === "outro" ||
                normalizedPrimaryCategoryCandidate === "outros"
              ? "outros"
              : canonicalDestinationCategory || primaryCategoryCandidate;

  const mergedSubcategoryParts = [...categoryParts.slice(1), ...subcategoryParts].filter(Boolean);
  const explicitSubcategory = Array.from(
    new Map(mergedSubcategoryParts.map((part) => [normalizeLoose(part), part])).values()
  ).join("\n");

  return {
    explicitCategory,
    explicitSubcategory,
  };
}

function buildMetadata(item: StructuredImportItem): Record<string, string> {
  const categoryMetadata = resolveCategoryMetadata(item);
  const explicitCategory = categoryMetadata.explicitCategory;
  const explicitSubcategory = categoryMetadata.explicitSubcategory;
  const explicitSheetName = String(item.sheetName || "").trim();
  const resolvedCategory = explicitCategory || (item.destination === "pool" ? "pool" : item.destination);
  const categorySource = explicitCategory ? "explicit" : "inferred";
  const normalizedTitle = normalizeLoose(item.title || "");
  const missingPrice = !String(item.price || "").trim();
  const missingSku = !String(item.sku || "").trim();
  const structuralSignals = collectStructuralReviewSignals(item);
  const genericTitle = structuralSignals.genericTitle;
  const ambiguousBundle =
    normalizedTitle.includes("kit limpeza completo") ||
    normalizedTitle.includes("peneira e cabo") ||
    normalizedTitle.includes("varios itens") ||
    normalizedTitle.includes("varios item");
  const sourceReviewSignals = Array.from(
    new Set((item.reviewSignals || []).map((value) => String(value || "").trim()).filter(Boolean))
  );
  const sourceReviewSignalsWithoutMissingOnly = sourceReviewSignals.filter(
    (signal) => signal !== "missing_price_signal" && signal !== "missing_sku_signal"
  );
  const structuralReviewRequired =
    structuralSignals.signals.includes("missing_name") ||
    structuralSignals.signals.includes("ambiguous_title") ||
    structuralSignals.signals.includes("generic_title") ||
    structuralSignals.signals.includes("multiple_prices") ||
    structuralSignals.signals.includes("multiple_skus") ||
    structuralSignals.signals.includes("possible_merged_items") ||
    structuralSignals.signals.includes("mixed_product_context") ||
    structuralSignals.signals.includes("pool_missing_required_measures") ||
    structuralSignals.signals.includes("fragment_price_lead") ||
    structuralSignals.signals.includes("fragment_detail_lead") ||
    structuralSignals.signals.includes("fragment_description_residue") ||
    structuralSignals.signals.includes("weak_nominal_anchor");
  const weakCandidate =
    structuralReviewRequired ||
    ambiguousBundle ||
    (missingPrice && missingSku && (genericTitle || sourceReviewSignalsWithoutMissingOnly.length > 0));
  const reviewRequired =
    structuralReviewRequired ||
    sourceReviewSignalsWithoutMissingOnly.length > 0 ||
    ambiguousBundle ||
    (missingPrice && missingSku && (genericTitle || sourceReviewSignalsWithoutMissingOnly.length > 0));
  const reviewReasons = buildReviewReasons({
    missingPrice,
    missingSku,
    genericTitle,
    ambiguousBundle,
    weakCandidate,
    sourceReviewSignals,
    structuralSignals: structuralSignals.signals,
  });
  const structuredPriceRange = extractStructuredPriceRange(item.price || "");

  return {
    categoria: resolvedCategory,
    category: resolvedCategory,
    category_name: resolvedCategory,
    explicit_category: explicitCategory,
    explicit_category_name: explicitCategory,
    inferred_destination: item.destination,
    category_source: categorySource,
    destination: item.destination,
    __resolved_destination: "",
    title: item.title || "",
    nome: item.title || "",
    productName: item.title || "",
    subcategoria: explicitSubcategory,
    source_subcategory: explicitSubcategory,
    sub_category: explicitSubcategory,
    sheet_name: explicitSheetName,
    planilha: explicitSheetName,
    aba: explicitSheetName,
    sheet: explicitSheetName,
    source_category: explicitCategory,
    clean_description: item.description || "",
    clean_description_status: item.descriptionStatus || "",
    description_canonicalized: item.descriptionStatus ? "true" : "false",
    imported_clean_description_original: item.originalDescription || "",
    price: item.price || "",
    price_range: structuredPriceRange?.raw || "",
    price_range_min: structuredPriceRange ? String(structuredPriceRange.min) : "",
    price_range_max: structuredPriceRange ? String(structuredPriceRange.max) : "",
    dimensions: item.dimensions || "",
    depth: item.depth || "",
    capacity: item.capacity || "",
    material: item.material || "",
    shape: item.shape || "",
    brand: item.brand || "",
    line: item.line || "",
    linha: item.line || "",
    sku: item.sku || "",
    stock: item.stockQuantity || "",
    estoque: item.stockQuantity || "",
    quantidade_atual: item.stockQuantity || "",
    unit: item.unit || "",
    unidade: item.unit || "",
    weight: item.weight || "",
    dosage: item.dosage || "",
    color: item.color || "",
    usage: item.usage || "",
    notes: item.notes || "",
    technical_notes: item.notes || "",
    indication: item.indication || "",
    composition: item.composition || "",
    embalagem: item.embalagem || "",
    packaging: item.packaging || "",
    model: item.model || "",
    size: item.size || "",
    compatibility: item.compatibility || "",
    function: item.function || "",
    environment: item.environment || "",
    diferencial: item.diferencial || "",
    application: item.application || "",
    source_file_name: item.sourceFileName,
    worksheet_row_number:
      typeof item.worksheetRowNumber === "number" ? String(item.worksheetRowNumber) : "",
    source_worksheet_row_number:
      typeof item.worksheetRowNumber === "number" ? String(item.worksheetRowNumber) : "",
    source_sheet_scoped_key: item.sheetScopedKey || "",
    sheet_scoped_key: item.sheetScopedKey || "",
    source_row_numbers: (item.sourceWorksheetRowNumbers || []).join(","),
    source_sheet_scoped_keys: (item.sourceSheetScopedKeys || []).join(","),
    merged_from_spreadsheet_rows: item.mergedFromSpreadsheetRows ? "true" : "false",
    missing_price: missingPrice ? "true" : "false",
    missing_sku: missingSku ? "true" : "false",
    generic_title: genericTitle ? "true" : "false",
    ambiguous_bundle: ambiguousBundle ? "true" : "false",
    weak_candidate: weakCandidate ? "true" : "false",
    title_status: item.titleStatus || "",
    missing_name: item.missingName ? "true" : "false",
    ambiguous_title: item.ambiguousTitle ? "true" : "false",
    structural_review_signals: structuralSignals.signals.join(","),
    review_required: reviewRequired ? "true" : "false",
    review_reason: reviewReasons.join(","),
    review_reasons: reviewReasons.join(","),
    source_review_signals: sourceReviewSignals.join(","),
    review_label: reviewRequired ? "Revisar com atenção" : "",
    review_selection_default: reviewRequired ? "unselected" : "selected",
  };
}

function toNormalizedItem(item: StructuredImportItem): NormalizedImportItem | null {
  const title = String(item.title || "").trim();
  if (!title || isGenericTitle(title)) {
    return null;
  }

  const rawText = String(item.rawBlock || item.description || item.title || "").trim();

  return {
    type: resolveNormalizedType(item),
    sourceFileName: item.sourceFileName,
    title,
    rawText,
    confidence: item.confidence,
    metadata: buildMetadata(item),
  };
}

function normalizeExtractedFile(extracted: ExtractedFileContent): NormalizedImportItem[] {
  const structuredItems = parseStructuredImportItems(extracted);
  if (structuredItems.length === 0) {
    return [];
  }

  return structuredItems
    .map(toNormalizedItem)
    .filter((item): item is NormalizedImportItem => Boolean(item));
}

function normalizeExtractedFileDetailed(extracted: ExtractedFileContent) {
  const structured = parseStructuredImportItemsDetailed(extracted);
  const normalizedItems = structured.items
    .map(toNormalizedItem)
    .filter((item): item is NormalizedImportItem => Boolean(item));
  const droppedItems = structured.items
    .filter((item) => !toNormalizedItem(item))
    .map((item) => item.title)
    .slice(0, 20);

  return {
    items: normalizedItems,
    debug: {
      fileName: extracted.fileName,
      parsedItems: structured.items.length,
      normalizedItems: normalizedItems.length,
      droppedItems,
      parser: structured.debug,
    },
  };
}

export function normalizeMultipleExtractedFiles(
  extractedFiles: ExtractedFileContent[]
): NormalizedImportItem[] {
  return extractedFiles.flatMap((file) => normalizeExtractedFile(file));
}

export function normalizeMultipleExtractedFilesDetailed(
  extractedFiles: ExtractedFileContent[]
): {
  items: NormalizedImportItem[];
  debug: NormalizedImportDebug;
} {
  const detailed = extractedFiles.map((file) => normalizeExtractedFileDetailed(file));
  const items = detailed.flatMap((file) => file.items);

  return {
    items,
    debug: {
      files: detailed.map((file) => file.debug),
      totalParsedItems: detailed.reduce((sum, file) => sum + file.debug.parsedItems, 0),
      totalNormalizedItems: items.length,
    },
  };
}
