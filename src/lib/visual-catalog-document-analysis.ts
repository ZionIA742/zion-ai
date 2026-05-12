export type VisualDocumentPartType =
  | "pdf_page"
  | "ppt_slide"
  | "docx_section"
  | "excel_sheet"
  | "excel_row"
  | "image";

export type VisualDocumentPart = {
  partId: string;
  partType: VisualDocumentPartType;
  pageNumber: number | null;
  pageType: string | null;
  recommendedForDetailedScan: boolean;
  relevanceScore: number | null;
  confidence: number | null;
};

export type VisualDocumentEntity = {
  entityId: string;
  modelKey: string;
  name: string | null;
  sku: string | null;
  category: string | null;
  sourcePages: number[];
  confidence: number;
  sourceType?: "confirmed" | "map_hint";
};

export type VisualFieldEvidence = {
  evidenceId: string;
  entityId: string;
  partId: string;
  pageNumber: number;
  modelKey: string | null;
  field: string;
  value: string;
  confidence: number;
  extractionMethod: "page_evidence" | "product_candidate";
  rawSnippet?: string | null;
};

export type VisualReviewCandidate = {
  candidateId: string;
  modelKey: string;
  name: string | null;
  sku: string | null;
  category: string | null;
  sourcePages: number[];
  confidence: number;
  missingFields: string[];
  conflictsCount: number;
};

export type VisualConsolidatedReviewFieldSource = {
  evidenceId: string;
  pageNumber: number;
  confidence: number;
  extractionMethod: VisualFieldEvidence["extractionMethod"];
};

export type VisualConsolidatedReviewConflict = {
  field: string;
  values: string[];
  sourcePages: number[];
};

export type VisualConsolidatedReviewCandidate = {
  candidateId: string;
  entityId: string;
  modelKey: string;
  name: string | null;
  sku: string | null;
  code: string | null;
  category: string | null;
  dimensions: string | null;
  dimensionsList: string[];
  material: string | null;
  description: string | null;
  sourcePages: number[];
  fieldSources: Record<string, VisualConsolidatedReviewFieldSource[]>;
  missingFields: string[];
  confidence: number;
  conflicts: VisualConsolidatedReviewConflict[];
  conflictsCount: number;
  reviewState: "needs_review";
  status: "needs_review";
};

export type VisualDocumentCoverage = {
  totalPages: number | null;
  mappedPages: number[];
  recommendedPages: number[];
  detailedScanPages: number[];
  analyzedPages: number[];
  pendingPages: number[];
  evidenceCount: number;
  candidateCount: number;
  coverageSummary: string;
};

export type VisualDocumentAnalysis = {
  coverage: VisualDocumentCoverage;
  parts: VisualDocumentPart[];
  entities: VisualDocumentEntity[];
  mapOnlyHints: VisualDocumentEntity[];
  fieldEvidence: VisualFieldEvidence[];
  reviewCandidates: VisualReviewCandidate[];
  consolidatedReviewCandidates: VisualConsolidatedReviewCandidate[];
};

type VisualDocumentMapInput = {
  ok?: boolean;
  totalPages?: number | null;
  pages?: Array<{
    pageNumber?: number;
    pageType?: string;
    relevanceScore?: number;
    confidence?: number;
    recommendedForDetailedScan?: boolean;
    possibleModels?: string[];
  }>;
  recommendedPages?: number[];
} | null;

type VisualPageEvidenceInput = {
  ok?: boolean;
  requestedPages?: number[];
  pageEvidence?: Array<{
    pageNumber?: number;
    items?: Array<{
      evidenceId?: string;
      modelKey?: string | null;
      visibleName?: string | null;
      visibleCode?: string | null;
      category?: string | null;
      confidence?: number;
      dimensions?: {
        visualText?: string | null;
      };
      material?: string | null;
      description?: string | null;
      rawSnippet?: string | null;
    }>;
  }>;
} | null;

type VisualProductCandidateInput = {
  candidateId?: string;
  modelKey?: string;
  name?: string | null;
  sku?: string | null;
  category?: string | null;
  sourcePages?: number[];
  confidence?: number;
  dimensions?: {
    visualText?: string | null;
    width_m?: number | null;
    length_m?: number | null;
    depth_m?: number | null;
    capacity_l?: number | null;
  } | null;
  material?: string | null;
  description?: string | null;
  missingFields?: string[];
  conflicts?: unknown[];
};

export type BuildVisualDocumentAnalysisInput = {
  documentMap?: VisualDocumentMapInput;
  pageEvidence?: VisualPageEvidenceInput;
  productCandidates?: VisualProductCandidateInput[];
  totalPages?: number | null;
  selectedPages?: number[];
  detailedScanPages?: number[];
};

type DiscoverVisualDocumentEntitiesInput = {
  documentMap?: VisualDocumentMapInput;
  pageEvidence?: VisualPageEvidenceInput;
  productCandidates?: VisualProductCandidateInput[];
};

type LinkVisualEvidenceToEntitiesInput = {
  entities: VisualDocumentEntity[];
  pageEvidence?: VisualPageEvidenceInput;
  productCandidates?: VisualProductCandidateInput[];
};

type BuildVisualReviewCandidatesFromEvidenceInput = {
  entities: VisualDocumentEntity[];
  fieldEvidence: VisualFieldEvidence[];
};

type VisualEntitySourceKind = "document_map" | "page_evidence" | "product_candidate";

type VisualEntityAggregate = VisualDocumentEntity & {
  __confidenceValues: number[];
  __sourceKinds: Set<VisualEntitySourceKind>;
  __pageTypes: Set<string>;
  __hasMeasurements: boolean;
  __hasTechnicalDetails: boolean;
  __documentMapOnly: boolean;
  __mentions: number;
  __scoreReasons: string[];
  __score: number;
  __accepted: boolean;
};

function normalizePageNumbers(values: Array<number | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => Number(value || 0))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value))
    )
  ).sort((a, b) => a - b);
}

function buildCoverageSummary(params: {
  totalPages: number | null;
  analyzedPages: number[];
  evidenceCount: number;
  candidateCount: number;
}) {
  const analyzed = params.analyzedPages.length;
  const total = params.totalPages;
  const pageText = total ? `${analyzed}/${total} paginas` : `${analyzed} paginas`;
  return `${pageText} analisadas, ${params.evidenceCount} evidencias, ${params.candidateCount} candidatos.`;
}

function normalizeLoose(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupEntityLabel(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s*::\s*.+$/g, "")
    .replace(
      /\b\d+[\.,]?\d*\s*m?(?:\s*x\s*\d+[\.,]?\d*\s*m?){1,3}(?:\s*x\s*\d+[\.,]?\d*\s*cm)?\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEntityNameKey(value: string | null | undefined) {
  return normalizeLoose(cleanupEntityLabel(value));
}

function normalizeEntityCodeKey(value: string | null | undefined) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  return raw.replace(/[^A-Z0-9\-_/]/g, "");
}

function pickEntityKey(params: {
  sku?: string | null;
  visibleCode?: string | null;
  modelKey?: string | null;
  name?: string | null;
}) {
  const strongCode = normalizeEntityCodeKey(params.sku || params.visibleCode);
  if (strongCode) return `code::${strongCode}`;

  const normalizedName =
    normalizeEntityNameKey(params.name) || normalizeEntityNameKey(params.modelKey);
  if (normalizedName) return `name::${normalizedName}`;
  return "";
}

function preferLongerText(current: string | null, incoming: string | null) {
  if (!incoming) return current;
  if (!current) return incoming;
  return incoming.length > current.length ? incoming : current;
}

function formatCandidateDimensions(value: VisualProductCandidateInput["dimensions"]) {
  if (!value) return "";
  if (value.visualText) return String(value.visualText).trim();
  const parts = [value.width_m, value.length_m, value.depth_m]
    .filter((item) => typeof item === "number" && Number.isFinite(item))
    .map((item) => String(item).replace(".", ",") + "m");
  return parts.join(" x ");
}

function isStrongSkuOrCode(value: string | null | undefined) {
  const code = normalizeEntityCodeKey(value);
  if (!code) return false;
  return (
    /^[A-Z]{2,5}-\d{2,5}$/.test(code) ||
    /^[A-Z]\d{2,4}$/.test(code) ||
    /^[A-Z]{2,4}\d{2,4}$/.test(code)
  );
}

function isLikelyGenericVisualPhrase(value: string | null | undefined) {
  const normalized = normalizeEntityNameKey(value);
  if (!normalized) return true;

  const blockedExact = new Set([
    "piscina",
    "produto",
    "acessorio",
    "catalogo",
    "imagem",
    "foto",
    "tabela",
    "medidas",
    "capa",
    "indice",
    "logo",
    "modelo de piscina",
    "piscina generica",
  ]);
  if (blockedExact.has(normalized)) return true;

  if (
    /\b(imagem|foto|catalogo|capa|indice|ambiente|logo|banner|institucional|tabela|medidas)\b/.test(
      normalized
    )
  ) {
    return true;
  }

  return normalized.split(" ").length >= 5 && !isStrongSkuOrCode(value);
}

function isLikelyInstitutionalEntity(value: string | null | undefined) {
  const normalized = normalizeEntityNameKey(value);
  if (!normalized) return false;

  if (
    /\b(aguazul|marca|fabricante|empresa|institucional|contracapa|banner|logo)\b/.test(normalized)
  ) {
    return true;
  }

  return false;
}

function isLikelySceneOrHumanDescription(value: string | null | undefined) {
  const normalized = normalizeEntityNameKey(value);
  if (!normalized) return false;

  return /\b(pessoa|bebe|bebê|crianca|criança|rosto|oculos|óculos|chapeu|chapéu|modelo humano|paisagem|cenario|cenario floral)\b/.test(
    normalized
  );
}

function isShortSpecificModelName(value: string | null | undefined) {
  const cleaned = cleanupEntityLabel(value);
  const normalized = normalizeEntityNameKey(cleaned);
  if (!normalized || normalized.length < 2) return false;
  if (isLikelyGenericVisualPhrase(normalized) || isLikelyInstitutionalEntity(normalized)) return false;

  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 1) {
    return /^[a-z]{3,20}$/.test(words[0]) || isStrongSkuOrCode(cleaned);
  }
  if (words.length === 2) {
    return words[1] === "spa" || isStrongSkuOrCode(cleaned);
  }
  return false;
}

function scoreVisualEntityCandidate(entity: VisualEntityAggregate) {
  let score = 0;
  const reasons: string[] = [];
  const displayName = entity.name || entity.sku || entity.modelKey;
  const normalizedPageTypes = Array.from(entity.__pageTypes);
  const sourceKindCount = entity.__sourceKinds.size;
  const pageCount = entity.sourcePages.length;
  const hasStrongCode = isStrongSkuOrCode(entity.sku || entity.modelKey);
  const usefulPageType = normalizedPageTypes.some((pageType) =>
    ["model_photos", "measurement_table", "mixed", "spa", "accessories"].includes(pageType)
  );
  const hostilePageType = normalizedPageTypes.some((pageType) =>
    ["cover", "index", "institutional", "back_cover"].includes(pageType)
  );

  if (hasStrongCode) {
    score += 5;
    reasons.push("codigo_forte");
  }
  if (normalizedPageTypes.includes("measurement_table")) {
    score += 4;
    reasons.push("tabela_medidas");
  }
  if (entity.__hasMeasurements) {
    score += 4;
    reasons.push("medidas");
  }
  if (entity.__sourceKinds.has("product_candidate")) {
    score += 4;
    reasons.push("product_candidate");
  }
  if (entity.__sourceKinds.has("page_evidence")) {
    score += 3;
    reasons.push("page_evidence");
  }
  if (pageCount >= 2) {
    score += 3;
    reasons.push("multiplas_paginas");
  }
  if (usefulPageType) {
    score += 3;
    reasons.push("pagina_util");
  }
  if (isShortSpecificModelName(displayName)) {
    score += 2;
    reasons.push("nome_especifico");
  }
  if (entity.category) {
    score += 2;
    reasons.push("categoria");
  }
  if (entity.__hasTechnicalDetails) {
    score += 2;
    reasons.push("detalhe_tecnico");
  }

  if (hostilePageType) {
    score -= 6;
    reasons.push("pagina_hostil");
  }
  if (isLikelySceneOrHumanDescription(displayName)) {
    score -= 5;
    reasons.push("cena_ou_pessoa");
  }
  if (isLikelyGenericVisualPhrase(displayName)) {
    score -= 5;
    reasons.push("frase_generica");
  }
  if (entity.__documentMapOnly) {
    score -= 4;
    reasons.push("apenas_document_map");
  }
  if (isLikelyInstitutionalEntity(displayName)) {
    score -= 4;
    reasons.push("institucional_ou_marca");
  }
  if ((displayName || "").trim().split(/\s+/).length >= 5 && !hasStrongCode) {
    score -= 3;
    reasons.push("frase_longa");
  }
  if (
    /\b(imagem|foto|catalogo|capa|indice|ambiente|logo|banner|institucional)\b/.test(
      normalizeEntityNameKey(displayName)
    )
  ) {
    score -= 3;
    reasons.push("termos_ruido");
  }
  if (
    /\b(pessoa|bebe|crianca|rosto|oculos|chapeu|paisagem|cenario)\b/.test(
      normalizeEntityNameKey(displayName)
    )
  ) {
    score -= 4;
    reasons.push("humano_ambiente");
  }

  if (sourceKindCount >= 2 && entity.__sourceKinds.has("page_evidence") && entity.__sourceKinds.has("product_candidate")) {
    score += 3;
    reasons.push("duas_fontes_confiaveis");
  }

  return { score, reasons };
}

function shouldAcceptVisualEntity(entity: VisualEntityAggregate) {
  const displayName = entity.name || entity.sku || entity.modelKey;
  const normalizedPageTypes = Array.from(entity.__pageTypes);
  const { score } = scoreVisualEntityCandidate(entity);
  const hasStrongCode = isStrongSkuOrCode(entity.sku || entity.modelKey);
  const hasStrongNameAndMeasures = isShortSpecificModelName(displayName) && entity.__hasMeasurements;
  const hasTrustedSources =
    entity.__sourceKinds.has("page_evidence") && entity.__sourceKinds.has("product_candidate");
  const hasTwoUsefulContexts =
    entity.sourcePages.length >= 2 &&
    normalizedPageTypes.some((pageType) => ["model_photos", "spa"].includes(pageType)) &&
    normalizedPageTypes.some((pageType) => ["measurement_table", "mixed"].includes(pageType));

  const hardReject =
    (entity.__documentMapOnly &&
      (normalizedPageTypes.length === 0 ||
        normalizedPageTypes.every((pageType) =>
          ["cover", "index", "institutional", "back_cover", "unknown"].includes(pageType)
        ))) ||
    isLikelySceneOrHumanDescription(displayName) ||
    isLikelyGenericVisualPhrase(displayName) ||
    isLikelyInstitutionalEntity(displayName);

  if (hardReject && !hasStrongCode && !hasStrongNameAndMeasures && !hasTrustedSources) {
    return false;
  }

  return score >= 4 || hasStrongCode || hasStrongNameAndMeasures || hasTrustedSources || hasTwoUsefulContexts;
}

export function discoverVisualDocumentEntities(
  input: DiscoverVisualDocumentEntitiesInput
): { confirmedEntities: VisualDocumentEntity[]; mapOnlyHints: VisualDocumentEntity[] } {
  const entities = new Map<string, VisualEntityAggregate>();
  const pageTypeByNumber = new Map<number, string>();

  if (input.documentMap?.ok) {
    for (const page of input.documentMap.pages ?? []) {
      const pageNumber = Number(page.pageNumber || 0);
      if (!pageNumber) continue;
      pageTypeByNumber.set(pageNumber, String(page.pageType || "unknown"));
    }
  }
  if (input.pageEvidence?.ok) {
    for (const page of input.pageEvidence.pageEvidence ?? []) {
      const pageNumber = Number(page.pageNumber || 0);
      if (!pageNumber || pageTypeByNumber.has(pageNumber)) continue;
      pageTypeByNumber.set(pageNumber, "unknown");
    }
  }

  const upsertEntity = (params: {
    key: string;
    name?: string | null;
    sku?: string | null;
    category?: string | null;
    sourcePages?: Array<number | null | undefined>;
    confidence?: number | null;
    sourceKind: VisualEntitySourceKind;
    pageType?: string | null;
    hasMeasurements?: boolean;
    hasTechnicalDetails?: boolean;
  }) => {
    if (!params.key) return;
    const confidence = Math.max(0, Math.min(1, Number(params.confidence || 0)));
    const existing = entities.get(params.key);
    const sourcePages = normalizePageNumbers(params.sourcePages ?? []);
    const next =
      existing ??
      ({
        entityId: params.key,
        modelKey: params.key.replace(/^(code|name)::/i, ""),
        name: null,
        sku: null,
        category: null,
        sourcePages: [],
        confidence: 0,
        __confidenceValues: [],
        __sourceKinds: new Set<VisualEntitySourceKind>(),
        __pageTypes: new Set<string>(),
        __hasMeasurements: false,
        __hasTechnicalDetails: false,
        __documentMapOnly: true,
        __mentions: 0,
        __scoreReasons: [],
        __score: 0,
        __accepted: false,
      } satisfies VisualEntityAggregate);

    next.name = preferLongerText(next.name, cleanupEntityLabel(params.name || null) || null);
    next.sku = normalizeEntityCodeKey(params.sku) || next.sku;
    next.category = next.category || params.category || null;
    next.sourcePages = normalizePageNumbers([...next.sourcePages, ...sourcePages]);
    next.__confidenceValues.push(confidence);
    next.__sourceKinds.add(params.sourceKind);
    if (params.pageType) next.__pageTypes.add(params.pageType);
    next.__hasMeasurements = next.__hasMeasurements || Boolean(params.hasMeasurements);
    next.__hasTechnicalDetails = next.__hasTechnicalDetails || Boolean(params.hasTechnicalDetails);
    next.__documentMapOnly =
      next.__documentMapOnly && params.sourceKind === "document_map";
    next.__mentions += 1;
    entities.set(params.key, next);
  };

  if (input.documentMap?.ok) {
    for (const page of input.documentMap.pages ?? []) {
      const pageNumber = Number(page.pageNumber || 0);
      for (const possibleModel of page.possibleModels ?? []) {
        const cleanName = cleanupEntityLabel(possibleModel);
        const key = pickEntityKey({ name: cleanName, modelKey: cleanName });
        upsertEntity({
          key,
          name: cleanName,
          category: null,
          sourcePages: [pageNumber],
          confidence: typeof page.confidence === "number" ? page.confidence * 0.7 : 0.35,
          sourceKind: "document_map",
          pageType: pageTypeByNumber.get(pageNumber) || String(page.pageType || "unknown"),
        });
      }
    }
  }

  if (input.pageEvidence?.ok) {
    for (const page of input.pageEvidence.pageEvidence ?? []) {
      const pageNumber = Number(page.pageNumber || 0);
      for (const item of page.items ?? []) {
        const preferredName = item.visibleName || item.visibleCode || item.modelKey || null;
        const key = pickEntityKey({
          sku: item.visibleCode,
          visibleCode: item.visibleCode,
          modelKey: item.modelKey,
          name: preferredName,
        });
        upsertEntity({
          key,
          name: preferredName,
          sku: item.visibleCode ?? null,
          category: item.category ?? null,
          sourcePages: [pageNumber],
          confidence: item.confidence ?? 0.5,
          sourceKind: "page_evidence",
          pageType: pageTypeByNumber.get(pageNumber) || "unknown",
          hasMeasurements: Boolean(item.dimensions?.visualText),
          hasTechnicalDetails: Boolean(item.material || item.description || item.dimensions?.visualText),
        });
      }
    }
  }

  for (const candidate of input.productCandidates ?? []) {
    const preferredName = candidate.name || candidate.sku || candidate.modelKey || null;
    const key = pickEntityKey({
      sku: candidate.sku,
      visibleCode: candidate.sku,
      modelKey: candidate.modelKey,
      name: preferredName,
    });
    upsertEntity({
      key,
      name: preferredName,
      sku: candidate.sku ?? null,
      category: candidate.category ?? null,
      sourcePages: candidate.sourcePages ?? [],
      confidence: candidate.confidence ?? 0.6,
      sourceKind: "product_candidate",
      pageType: null,
      hasMeasurements: false,
      hasTechnicalDetails: false,
    });
  }

  const normalizedEntities = Array.from(entities.values())
    .map((entity) => {
      const scoreResult = scoreVisualEntityCandidate(entity);
      entity.__scoreReasons = scoreResult.reasons;
      entity.__score = scoreResult.score;
      entity.__accepted = shouldAcceptVisualEntity(entity);
      return {
        entityId: entity.entityId,
        modelKey: entity.modelKey,
        name: entity.name,
        sku: entity.sku,
        category: entity.category,
        sourcePages: entity.sourcePages,
        confidence:
          entity.__confidenceValues.length > 0
            ? entity.__confidenceValues.reduce((sum, value) => sum + value, 0) /
              entity.__confidenceValues.length
            : 0,
        sourceType: entity.__documentMapOnly
          ? ("map_hint" as const)
          : ("confirmed" as const),
        __score: entity.__score,
        __accepted: entity.__accepted,
        __documentMapOnly: entity.__documentMapOnly,
        __sourceKinds: entity.__sourceKinds,
      };
    })
    .filter((entity) => Boolean(entity.modelKey || entity.name || entity.sku))
    .sort((a, b) => {
      const pageA = a.sourcePages[0] ?? Number.MAX_SAFE_INTEGER;
      const pageB = b.sourcePages[0] ?? Number.MAX_SAFE_INTEGER;
      return pageA - pageB || a.modelKey.localeCompare(b.modelKey);
    });

  const confirmedEntities = normalizedEntities
    .filter((entity) => entity.__accepted && entity.sourceType === "confirmed")
    .map(({ __score: _score, __accepted: _accepted, __documentMapOnly: _documentMapOnly, __sourceKinds: _sourceKinds, ...entity }) => entity);

  const mapOnlyHints = normalizedEntities
    .filter((entity) => entity.sourceType === "map_hint")
    .filter((entity) => !isLikelySceneOrHumanDescription(entity.name || entity.modelKey))
    .filter((entity) => !isLikelyGenericVisualPhrase(entity.name || entity.modelKey))
    .filter((entity) => !isLikelyInstitutionalEntity(entity.name || entity.modelKey))
    .filter((entity) =>
      entity.__score >= -2 ||
      isShortSpecificModelName(entity.name || entity.modelKey) ||
      isStrongSkuOrCode(entity.sku || entity.modelKey)
    )
    .map(({ __score: _score, __accepted: _accepted, __documentMapOnly: _documentMapOnly, __sourceKinds: _sourceKinds, ...entity }) => entity);

  return {
    confirmedEntities,
    mapOnlyHints,
  };
}

function findLinkedEntity(
  entities: VisualDocumentEntity[],
  params: {
    sku?: string | null;
    visibleCode?: string | null;
    modelKey?: string | null;
    name?: string | null;
  }
) {
  const codeKey = normalizeEntityCodeKey(params.sku || params.visibleCode);
  if (codeKey) {
    const byCode = entities.find((entity) => normalizeEntityCodeKey(entity.sku || entity.modelKey) === codeKey);
    if (byCode) return byCode;
  }

  const candidateNames = [
    params.name,
    params.modelKey,
    params.visibleCode,
  ]
    .map((value) => normalizeEntityNameKey(value))
    .filter(Boolean);

  for (const candidateName of candidateNames) {
    const byName = entities.find(
      (entity) =>
        normalizeEntityNameKey(entity.name) === candidateName ||
        normalizeEntityNameKey(entity.modelKey) === candidateName
    );
    if (byName) return byName;
  }

  return null;
}

export function linkVisualEvidenceToEntities(
  input: LinkVisualEvidenceToEntitiesInput
): VisualFieldEvidence[] {
  const linkedEvidence: VisualFieldEvidence[] = [];
  const confirmedEntities = input.entities.filter((entity) => entity.sourceType !== "map_hint");

  if (input.pageEvidence?.ok) {
    for (const page of input.pageEvidence.pageEvidence ?? []) {
      const pageNumber = Number(page.pageNumber || 0);
      if (!pageNumber) continue;

      for (const item of page.items ?? []) {
        const linkedEntity = findLinkedEntity(confirmedEntities, {
          sku: item.visibleCode,
          visibleCode: item.visibleCode,
          modelKey: item.modelKey,
          name: item.visibleName,
        });
        if (!linkedEntity) continue;

        const evidenceId = item.evidenceId || `page-${pageNumber}-evidence-${linkedEvidence.length + 1}`;
        const base = {
          evidenceId,
          entityId: linkedEntity.entityId,
          partId: `pdf::page::${pageNumber}`,
          pageNumber,
          modelKey: item.modelKey ?? item.visibleCode ?? item.visibleName ?? null,
          confidence: Math.max(0, Math.min(1, Number(item.confidence || 0))),
          extractionMethod: "page_evidence" as const,
          rawSnippet: item.rawSnippet ?? item.description ?? item.visibleName ?? item.visibleCode ?? null,
        };

        const fields: Array<[string, string | null | undefined]> = [
          ["name", item.visibleName],
          ["sku", item.visibleCode],
          ["category", item.category],
          ["dimensions", item.dimensions?.visualText],
          ["material", item.material],
          ["description", item.description],
        ];

        for (const [field, value] of fields) {
          const cleanValue = String(value || "").trim();
          if (!cleanValue) continue;
          linkedEvidence.push({
            ...base,
            field,
            value: cleanValue,
          });
        }
      }
    }
  }

  for (const candidate of input.productCandidates ?? []) {
    const linkedEntity = findLinkedEntity(confirmedEntities, {
      sku: candidate.sku,
      visibleCode: candidate.sku,
      modelKey: candidate.modelKey,
      name: candidate.name,
    });
    if (!linkedEntity) continue;

    const pageNumbers = normalizePageNumbers(candidate.sourcePages ?? []);
    const pageNumber = pageNumbers[0] ?? 0;
    const partId = pageNumber > 0 ? `pdf::page::${pageNumber}` : `candidate::${candidate.candidateId || linkedEntity.entityId}`;
    const evidenceIdBase = candidate.candidateId || linkedEntity.entityId;
    const fields: Array<[string, string | null | undefined]> = [
      ["name", candidate.name],
      ["sku", candidate.sku],
      ["category", candidate.category],
      ["dimensions", formatCandidateDimensions(candidate.dimensions)],
      ["material", candidate.material],
      ["description", candidate.description],
    ];

    for (const [field, value] of fields) {
      const cleanValue = String(value || "").trim();
      if (!cleanValue) continue;
      linkedEvidence.push({
        evidenceId: `${evidenceIdBase}::${field}`,
        entityId: linkedEntity.entityId,
        partId,
        pageNumber,
        modelKey: candidate.modelKey ?? candidate.sku ?? candidate.name ?? null,
        field,
        value: cleanValue,
        confidence: Math.max(0, Math.min(1, Number(candidate.confidence || 0))),
        extractionMethod: "product_candidate",
        rawSnippet: candidate.description ?? candidate.name ?? candidate.sku ?? null,
      });
    }
  }

  const deduped = new Map<string, VisualFieldEvidence>();
  for (const evidence of linkedEvidence) {
    const dedupeKey = [
      evidence.entityId,
      evidence.field,
      evidence.value,
      evidence.pageNumber,
      evidence.extractionMethod,
    ].join("::");
    const existing = deduped.get(dedupeKey);
    if (!existing || evidence.confidence > existing.confidence) {
      deduped.set(dedupeKey, evidence);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => {
    const pageDelta = a.pageNumber - b.pageNumber;
    if (pageDelta !== 0) return pageDelta;
    const entityDelta = a.entityId.localeCompare(b.entityId);
    if (entityDelta !== 0) return entityDelta;
    return a.field.localeCompare(b.field);
  });
}

function normalizeVisualEvidenceFieldName(field: string | null | undefined) {
  const cleanField = String(field || "").trim().toLowerCase();
  if (cleanField === "code") return "sku";
  return cleanField;
}

function normalizeVisualEvidenceValue(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function makeVisualEvidenceValueKey(value: string | null | undefined) {
  return normalizeLoose(normalizeVisualEvidenceValue(value));
}

function compareVisualFieldEvidenceQuality(a: VisualFieldEvidence, b: VisualFieldEvidence) {
  const confidenceDelta = b.confidence - a.confidence;
  if (confidenceDelta !== 0) return confidenceDelta;
  const lengthDelta = normalizeVisualEvidenceValue(b.value).length - normalizeVisualEvidenceValue(a.value).length;
  if (lengthDelta !== 0) return lengthDelta;
  return a.pageNumber - b.pageNumber;
}

function collectVisualFieldSources(items: VisualFieldEvidence[]) {
  const sourcesByKey = new Map<string, VisualConsolidatedReviewFieldSource>();
  for (const item of items) {
    const pageNumber = Number(item.pageNumber || 0);
    if (!pageNumber) continue;
    const key = `${item.evidenceId}::${pageNumber}::${item.extractionMethod}`;
    const current = sourcesByKey.get(key);
    if (!current || item.confidence > current.confidence) {
      sourcesByKey.set(key, {
        evidenceId: item.evidenceId,
        pageNumber,
        confidence: Math.max(0, Math.min(1, Number(item.confidence || 0))),
        extractionMethod: item.extractionMethod,
      });
    }
  }

  return Array.from(sourcesByKey.values()).sort((a, b) => {
    const pageDelta = a.pageNumber - b.pageNumber;
    if (pageDelta !== 0) return pageDelta;
    return b.confidence - a.confidence;
  });
}

function pickBestVisualEvidenceValue(items: VisualFieldEvidence[]) {
  const bestEvidence = [...items].sort(compareVisualFieldEvidenceQuality)[0];
  return bestEvidence ? normalizeVisualEvidenceValue(bestEvidence.value) || null : null;
}

function listDistinctVisualEvidenceValues(items: VisualFieldEvidence[]) {
  const valuesByKey = new Map<string, { value: string; evidence: VisualFieldEvidence }>();
  for (const item of items) {
    const cleanValue = normalizeVisualEvidenceValue(item.value);
    if (!cleanValue) continue;
    const key = makeVisualEvidenceValueKey(cleanValue);
    const current = valuesByKey.get(key);
    if (!current || compareVisualFieldEvidenceQuality(item, current.evidence) < 0) {
      valuesByKey.set(key, { value: cleanValue, evidence: item });
    }
  }

  return Array.from(valuesByKey.values())
    .sort((a, b) => compareVisualFieldEvidenceQuality(a.evidence, b.evidence))
    .map((item) => item.value);
}

function buildVisualFieldConflict(field: string, items: VisualFieldEvidence[]) {
  const values = listDistinctVisualEvidenceValues(items);
  if (values.length <= 1) return null;

  return {
    field,
    values,
    sourcePages: normalizePageNumbers(items.map((item) => item.pageNumber)),
  } satisfies VisualConsolidatedReviewConflict;
}

export function buildVisualReviewCandidatesFromEvidence(
  input: BuildVisualReviewCandidatesFromEvidenceInput
): VisualConsolidatedReviewCandidate[] {
  const confirmedEntities = input.entities.filter((entity) => entity.sourceType !== "map_hint");
  const evidenceByEntityId = new Map<string, VisualFieldEvidence[]>();

  for (const evidence of input.fieldEvidence) {
    if (!evidence.entityId) continue;
    const current = evidenceByEntityId.get(evidence.entityId) ?? [];
    current.push({
      ...evidence,
      field: normalizeVisualEvidenceFieldName(evidence.field),
      value: normalizeVisualEvidenceValue(evidence.value),
    });
    evidenceByEntityId.set(evidence.entityId, current);
  }

  return confirmedEntities
    .map((entity, index) => {
      const entityEvidence = evidenceByEntityId.get(entity.entityId) ?? [];
      const byField = new Map<string, VisualFieldEvidence[]>();
      for (const evidence of entityEvidence) {
        if (!evidence.field || !evidence.value) continue;
        const current = byField.get(evidence.field) ?? [];
        current.push(evidence);
        byField.set(evidence.field, current);
      }

      const name = pickBestVisualEvidenceValue(byField.get("name") ?? []) ?? entity.name ?? null;
      const sku = pickBestVisualEvidenceValue(byField.get("sku") ?? []) ?? entity.sku ?? null;
      const category = pickBestVisualEvidenceValue(byField.get("category") ?? []) ?? entity.category ?? null;
      const dimensionsList = listDistinctVisualEvidenceValues(byField.get("dimensions") ?? []);
      const material = pickBestVisualEvidenceValue(byField.get("material") ?? []);
      const description = pickBestVisualEvidenceValue(byField.get("description") ?? []);
      const fieldSources: Record<string, VisualConsolidatedReviewFieldSource[]> = {};

      for (const [field, items] of byField.entries()) {
        fieldSources[field] = collectVisualFieldSources(items);
      }

      const conflicts = ["name", "sku", "category", "material", "description"]
        .map((field) => buildVisualFieldConflict(field, byField.get(field) ?? []))
        .filter((conflict): conflict is VisualConsolidatedReviewConflict => Boolean(conflict));
      const sourcePages = normalizePageNumbers([
        ...entity.sourcePages,
        ...entityEvidence.map((evidence) => evidence.pageNumber),
      ]);
      const confidenceValues = [
        entity.confidence,
        ...entityEvidence.map((evidence) => evidence.confidence),
      ].filter((value) => Number.isFinite(value));
      const confidence =
        confidenceValues.length > 0
          ? Math.max(0, Math.min(1, confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length))
          : 0;
      const missingFields = [
        !name ? "name" : null,
        !sku ? "code" : null,
        !category ? "category" : null,
        dimensionsList.length === 0 ? "dimensions" : null,
        !material ? "material" : null,
        "price",
      ].filter((field): field is string => Boolean(field));

      return {
        candidateId: `visual-consolidated-${entity.entityId || index + 1}`,
        entityId: entity.entityId,
        modelKey: entity.modelKey,
        name,
        sku,
        code: sku,
        category,
        dimensions: dimensionsList[0] ?? null,
        dimensionsList,
        material,
        description,
        sourcePages,
        fieldSources,
        missingFields,
        confidence,
        conflicts,
        conflictsCount: conflicts.length,
        reviewState: "needs_review" as const,
        status: "needs_review" as const,
      };
    })
    .filter(
      (candidate) =>
        candidate.sourcePages.length > 0 ||
        Boolean(candidate.name || candidate.sku || candidate.category || candidate.dimensions)
    )
    .sort((a, b) => {
      const firstPageDelta = (a.sourcePages[0] ?? Number.MAX_SAFE_INTEGER) - (b.sourcePages[0] ?? Number.MAX_SAFE_INTEGER);
      if (firstPageDelta !== 0) return firstPageDelta;
      return a.candidateId.localeCompare(b.candidateId);
    });
}

export function buildVisualDocumentAnalysis(
  input: BuildVisualDocumentAnalysisInput
): VisualDocumentAnalysis {
  const mapOk = input.documentMap?.ok === true;
  const evidenceOk = input.pageEvidence?.ok === true;
  const mapPages = mapOk ? input.documentMap?.pages ?? [] : [];
  const evidencePages = evidenceOk ? input.pageEvidence?.pageEvidence ?? [] : [];
  const candidates = input.productCandidates ?? [];
  const totalPages =
    input.totalPages ??
    (mapOk ? input.documentMap?.totalPages ?? null : null) ??
    null;

  const mappedPages = normalizePageNumbers(mapPages.map((page) => page.pageNumber));
  const recommendedPages = normalizePageNumbers(
    mapOk ? input.documentMap?.recommendedPages ?? [] : []
  );
  const detailedScanPages = normalizePageNumbers([
    ...(input.detailedScanPages ?? []),
    ...(input.selectedPages ?? []),
    ...(evidenceOk ? input.pageEvidence?.requestedPages ?? [] : []),
  ]);
  const analyzedPages = normalizePageNumbers(evidencePages.map((page) => page.pageNumber));
  const pendingPages =
    totalPages && totalPages > 0
      ? Array.from({ length: totalPages }, (_, index) => index + 1).filter(
          (page) => !analyzedPages.includes(page)
        )
      : recommendedPages.filter((page) => !analyzedPages.includes(page));

  const partsById = new Map<string, VisualDocumentPart>();
  for (const page of mapPages) {
    const pageNumber = Number(page.pageNumber || 0);
    if (!pageNumber) continue;
    partsById.set(`pdf::page::${pageNumber}`, {
      partId: `pdf::page::${pageNumber}`,
      partType: "pdf_page",
      pageNumber,
      pageType: page.pageType ?? null,
      recommendedForDetailedScan: Boolean(page.recommendedForDetailedScan),
      relevanceScore:
        typeof page.relevanceScore === "number" ? page.relevanceScore : null,
      confidence: typeof page.confidence === "number" ? page.confidence : null,
    });
  }
  for (const pageNumber of analyzedPages) {
    const partId = `pdf::page::${pageNumber}`;
    if (!partsById.has(partId)) {
      partsById.set(partId, {
        partId,
        partType: "pdf_page",
        pageNumber,
        pageType: null,
        recommendedForDetailedScan: recommendedPages.includes(pageNumber),
        relevanceScore: null,
        confidence: null,
      });
    }
  }

  const reviewCandidates = candidates
    .filter((candidate) => candidate.modelKey || candidate.name || candidate.sku)
    .map((candidate, index) => ({
      candidateId: candidate.candidateId || `visual-candidate-${index + 1}`,
      modelKey: candidate.modelKey || candidate.sku || candidate.name || `candidate-${index + 1}`,
      name: candidate.name ?? null,
      sku: candidate.sku ?? null,
      category: candidate.category ?? null,
      sourcePages: normalizePageNumbers(candidate.sourcePages ?? []),
      confidence: Math.max(0, Math.min(1, Number(candidate.confidence || 0))),
      missingFields: Array.isArray(candidate.missingFields) ? candidate.missingFields : [],
      conflictsCount: Array.isArray(candidate.conflicts) ? candidate.conflicts.length : 0,
    }));

  const discoveredEntities = discoverVisualDocumentEntities({
    documentMap: input.documentMap,
    pageEvidence: input.pageEvidence,
    productCandidates: candidates,
  });
  const fieldEvidence = linkVisualEvidenceToEntities({
    entities: discoveredEntities.confirmedEntities,
    pageEvidence: input.pageEvidence,
    productCandidates: candidates,
  });
  const consolidatedReviewCandidates = buildVisualReviewCandidatesFromEvidence({
    entities: discoveredEntities.confirmedEntities,
    fieldEvidence,
  });

  const evidenceCount = fieldEvidence.length;
  const candidateCount = reviewCandidates.length;

  return {
    coverage: {
      totalPages,
      mappedPages,
      recommendedPages,
      detailedScanPages,
      analyzedPages,
      pendingPages,
      evidenceCount,
      candidateCount,
      coverageSummary: buildCoverageSummary({
        totalPages,
        analyzedPages,
        evidenceCount,
        candidateCount,
      }),
    },
    parts: Array.from(partsById.values()).sort(
      (a, b) => Number(a.pageNumber || 0) - Number(b.pageNumber || 0)
    ),
    entities: discoveredEntities.confirmedEntities,
    mapOnlyHints: discoveredEntities.mapOnlyHints,
    fieldEvidence,
    reviewCandidates,
    consolidatedReviewCandidates,
  };
}
