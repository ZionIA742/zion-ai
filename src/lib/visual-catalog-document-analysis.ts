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
};

export type VisualFieldEvidence = {
  evidenceId: string;
  partId: string;
  pageNumber: number;
  modelKey: string | null;
  field: string;
  value: string;
  confidence: number;
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
  fieldEvidence: VisualFieldEvidence[];
  reviewCandidates: VisualReviewCandidate[];
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

  const fieldEvidence: VisualFieldEvidence[] = [];
  for (const page of evidencePages) {
    const pageNumber = Number(page.pageNumber || 0);
    if (!pageNumber) continue;
    for (const item of page.items ?? []) {
      const evidenceId = item.evidenceId || `page-${pageNumber}-evidence-${fieldEvidence.length + 1}`;
      const confidence = Math.max(0, Math.min(1, Number(item.confidence || 0)));
      const values: Array<[string, string | null | undefined]> = [
        ["name", item.visibleName],
        ["sku", item.visibleCode],
        ["category", item.category],
        ["dimensions", item.dimensions?.visualText],
        ["material", item.material],
        ["description", item.description],
      ];
      for (const [field, value] of values) {
        const cleanValue = String(value || "").trim();
        if (!cleanValue) continue;
        fieldEvidence.push({
          evidenceId,
          partId: `pdf::page::${pageNumber}`,
          pageNumber,
          modelKey: item.modelKey ?? item.visibleCode ?? item.visibleName ?? null,
          field,
          value: cleanValue,
          confidence,
        });
      }
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

  const entities = reviewCandidates.map((candidate) => ({
    entityId: candidate.candidateId,
    modelKey: candidate.modelKey,
    name: candidate.name,
    sku: candidate.sku,
    category: candidate.category,
    sourcePages: candidate.sourcePages,
    confidence: candidate.confidence,
  }));

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
    entities,
    fieldEvidence,
    reviewCandidates,
  };
}
