"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase as defaultSupabase } from "@/lib/supabaseBrowser";
import {
  buildImportDedupIdentity,
  normalizeImportDedupSku,
  normalizeImportDedupText,
} from "@/lib/onboarding-import-dedup-identity";
import {
  buildVisualDocumentAnalysis,
  type VisualDocumentAnalysis,
} from "@/lib/visual-catalog-document-analysis";
import type {
  IntelligentImportGlobalReviewConfirmation,
  IntelligentImportStagedMediaAsset,
  IntelligentImportSelectedMediaRef,
  IntelligentImportReviewedSaveItem,
  IntelligentImportSaveApprovedRequest,
  IntelligentImportSaveApprovedResponse,
  IntelligentImportStructuredReviewSnapshot,
  IntelligentImportStructuredReviewSnapshotEntry,
} from "@/lib/onboarding-intelligent-import-save-contract";

type IntelligentImportSummary = {
  totalFiles: number;
  extractedFiles: number;
  normalizedItems: number;
  dedupedItems: number;
  duplicateItems: number;
};
type IntelligentImportExtractedPreview = {
  fileName: string;
  mimeType: string;
  extension: string;
  textPreview: string;
};
type IntelligentImportNormalizedPreview = {
  type: string;
  sourceFileName: string;
  title: string;
  rawText: string;
  confidence: number;
  metadata: Record<string, string>;
};
type IntelligentImportDedupedPreview = IntelligentImportNormalizedPreview & {
  dedupKey: string;
  duplicateOf?: string;
  isDuplicate: boolean;
};
type IntelligentImportParserDebug = {
  enabled: boolean;
  extraction: Array<{
    fileName: string;
    mimeType?: string;
    charCount: number;
    approxLineCount: number;
    usefulLinesPreview: string[];
    looksLikeContinuousText: boolean;
  }>;
  normalization: unknown;
  dedupe: unknown;
  filter: unknown;
};
type IntelligentImportResponse =
  | {
      ok: true;
      message: string;
      importedFileIds?: string[];
      importedFiles?: Array<{
        id: string;
        importBatchId?: string | null;
        originalFileName: string;
        storageBucket: string;
        storagePath: string;
        sizeBytes: number;
        mimeType: string | null;
        status: string | null;
      }>;
      mediaStagingWarnings?: string[];
      rawFilePersistenceWarnings?: string[];
      stagedMediaAssetIds?: string[];
      stagedMediaAssets?: IntelligentImportStagedMediaAsset[];
      summary: IntelligentImportSummary;
      extractedPreview: IntelligentImportExtractedPreview[];
      extractedImagePreview?: Array<{
        sourceFileName: string;
        originalSourceFileName?: string;
        fileName: string;
        source: string;
        sourceKind?: string;
        mimeType: string;
        dataUrl: string;
        placement?: string;
        evidenceType?: string;
        associationState?: string;
        sheetName?: string;
        rowIndex?: number;
        columnIndex?: number;
        anchorCell?: string;
        imageOrder?: number;
        worksheetRowNumber?: number;
        sheetScopedKey?: string;
        docxRelId?: string;
        docxMediaPath?: string;
        docxBodyIndex?: number;
        docxTableIndex?: number;
        docxTableCell?: string;
        documentOrderKey?: string;
        docxBlockKey?: string;
      }>;
      normalizedPreview: IntelligentImportNormalizedPreview[];
      dedupedPreview: IntelligentImportDedupedPreview[];
      parserDebug?: IntelligentImportParserDebug;
    }
  | {
      ok: false;
      error: string;
      message: string;
    };
type VisualCatalogImportResponse =
  | {
      ok: true;
      pageStart: number;
      pageLimit: number;
      model?: string;
      pages: Array<{
        pageNumber: number;
        width: number | null;
        height: number | null;
        imageRef: string;
        hasRenderedImage: boolean;
      }>;
      drafts: Array<{
        category: string | null;
        name: string | null;
        sku: string | null;
        price_cents?: number | null;
        stock_quantity?: number | null;
        dimensions?: {
          width_m: number | null;
          length_m: number | null;
          depth_m: number | null;
          capacity_l: number | null;
        } | null;
        visualDimensionsText?: string | null;
        material?: string | null;
        description?: string | null;
        pageNumber: number;
        imageRef: string;
        confidence: number;
        missingFields: string[];
      }>;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
      message: string;
    };
type EditableVisualCatalogDraft = {
  id: string;
  name: string;
  category: "" | "pool" | "chemical" | "accessory" | "other";
  visualDimensionsText: string;
  material: string;
  description: string;
  price: string;
  stock: string;
  pageNumber: number;
  confidence: number;
  missingFields: string[];
};
type VisualReviewItemState = "pending" | "approved" | "ignored";
const VISUAL_REVIEW_NO_IMAGE_KEY = "__no_visual_review_image__";
type EditableVisualReviewItem = {
  id: string;
  candidateId: string;
  entityId: string;
  name: string;
  category: "" | "pool" | "chemical" | "accessory" | "other";
  sku: string;
  code: string;
  price: string;
  selectedImageKey?: string;
  selectedImageKeys: string[];
  dimensionsText: string;
  dimensionsList: string[];
  material: string;
  description: string;
  stock: string;
  isActive: boolean;
  reviewState: VisualReviewItemState;
  sourcePages: number[];
  confidence: number;
  missingFields: string[];
  conflicts: VisualDocumentAnalysis["consolidatedReviewCandidates"][number]["conflicts"];
  fieldSources: VisualDocumentAnalysis["consolidatedReviewCandidates"][number]["fieldSources"];
  dirty: boolean;
  saved: boolean;
  originalCandidate: VisualDocumentAnalysis["consolidatedReviewCandidates"][number];
};
type VisualReviewSavePreviewItem = {
  item: EditableVisualReviewItem;
  blockers: string[];
  warnings: string[];
};
type VisualReviewSelectedImageSummary = {
  readyToUploadItemCount: number;
  selectedImageCount: number;
  withoutPhotoCount: number;
  noSelectionCount: number;
  relatedWithoutPreviewCount: number;
};
type VisualReviewDuplicateDiagnosticGroup = {
  id: string;
  type: "SKU parecido" | "Nome igual" | "Nome parecido";
  items: EditableVisualReviewItem[];
};
type VisualReviewDuplicateDiagnostics = {
  totalItems: number;
  suspiciousGroups: VisualReviewDuplicateDiagnosticGroup[];
  suspiciousItemCount: number;
};
type ImportedSelectedMediaRefDebug = {
  matchedSamples: Array<{
    clientItemId: string;
    importBatchId: string | null;
    importFileId: string | null;
    sourceFileName: string | null;
    sourceLocationKey: string | null;
    stagedAssetId: string;
    worksheetRowNumber: number | null;
  }>;
  selectedMediaRefsCount: number;
  stagedMediaAssetsAvailable: number;
  stagedMediaAssetSamples: Array<{
    id: string;
    importBatchId: string | null;
    importFileId: string | null;
    sourceFileName: string | null;
    sourceLocationKey: string | null;
    sheetScopedKey: string | null;
    worksheetRowNumber: number | null;
  }>;
  unmatchedSamples: Array<{
    clientItemId: string;
    importBatchId: string | null;
    importFileId: string | null;
    reasons: string[];
    sourceFileName: string | null;
    sourceLocationKey: string | null;
    sheetScopedKey: string | null;
    worksheetRowNumber: number | null;
  }>;
};
type VisualReviewSaveResult = {
  savedCount: number;
  failedCount: number;
  savedPhotoCount: number;
  failedPhotoCount: number;
  savedItems: Array<{
    name: string;
    category: string;
    destination: string;
    photoSavedCount?: number;
    photoFailedCount?: number;
  }>;
  failedItems: Array<{
    name: string;
    reason: string;
  }>;
  photoFailures: Array<{
    name: string;
    reason: string;
  }>;
  savedByCategory: {
    piscinas: number;
    quimicos: number;
    acessorios: number;
    outros: number;
  };
};
type VisualCatalogDocumentScanResponse =
  | {
      ok: true;
      fileKey: string;
      requestedPages: number[];
      pageLimit: number;
      model?: string;
      pageEvidence: Array<{
        fileKey: string;
        pageNumber: number;
        pageType: "cover" | "model_photos" | "measurement_table" | "description" | "mixed" | "unknown";
        items: Array<{
          evidenceId: string;
          modelKey: string | null;
          visibleName: string | null;
          visibleCode: string | null;
          category: "pool" | "chemical" | "accessory" | "other" | null;
          dimensions?: {
            visualText?: string | null;
            width_m?: number | null;
            length_m?: number | null;
            depth_m?: number | null;
            capacity_l?: number | null;
          };
          material?: string | null;
          description?: string | null;
          confidence: number;
          missingFields: string[];
          rawSnippet?: string | null;
        }>;
        warnings: string[];
      }>;
      pagePreviews?: Array<{
        pageNumber: number;
        dataUrl: string;
        mimeType: string;
        fileName: string;
        sourceFileName: string;
      }>;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
      message: string;
    };
type VisualCatalogDocumentScanSuccess = Extract<VisualCatalogDocumentScanResponse, { ok: true }>;
type VisualCatalogDocumentMapResponse =
  | {
      ok: true;
      fileKey: string;
      totalPages: number | null;
      pageLimit: number;
      model?: string;
      pages: Array<{
        pageNumber: number;
        pageType:
          | "cover"
          | "index"
          | "model_photos"
          | "measurement_table"
          | "spa"
          | "accessories"
          | "institutional"
          | "back_cover"
          | "mixed"
          | "unknown";
        relevanceScore: number;
        detectedLabels: string[];
        possibleModels: string[];
        hasMeasurements: boolean;
        hasManySmallItems: boolean;
        confidence: number;
        recommendedForDetailedScan: boolean;
        reason: string;
      }>;
      recommendedPages: number[];
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
      message: string;
    };
type VisualCatalogDocumentMapSuccess = Extract<VisualCatalogDocumentMapResponse, { ok: true }>;
type VisualProductCandidateFieldSource = {
  pageNumber: number;
  evidenceId: string;
  confidence: number;
};
type VisualProductCandidate = {
  candidateId: string;
  modelKey: string;
  category: "pool" | "chemical" | "accessory" | "other" | null;
  name: string | null;
  sku: string | null;
  dimensions: {
    visualText: string | null;
    width_m: number | null;
    length_m: number | null;
    depth_m: number | null;
    capacity_l: number | null;
  } | null;
  material: string | null;
  description: string | null;
  primaryImageRef: string | null;
  sourcePages: number[];
  fieldSources: Record<string, VisualProductCandidateFieldSource[]>;
  confidence: number;
  conflicts: Array<{
    field: string;
    values: string[];
    sourcePages: number[];
  }>;
  missingFields: string[];
};

const VISUAL_LINKED_EVIDENCE_FIELD_PRIORITY = [
  "sku",
  "code",
  "name",
  "dimensions",
  "price",
  "category",
  "material",
  "description",
];

function normalizeVisualLinkedEvidenceField(field: string) {
  const cleanField = String(field || "").trim().toLowerCase();
  if (cleanField === "sku") return "code";
  return cleanField;
}

function getVisualLinkedEvidenceFieldPriority(field: string) {
  const canonicalField = field === "code" ? "sku" : field;
  const index = VISUAL_LINKED_EVIDENCE_FIELD_PRIORITY.indexOf(canonicalField);
  return index >= 0 ? index : VISUAL_LINKED_EVIDENCE_FIELD_PRIORITY.length;
}

function shouldEnableParserDebugFromLocation() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const value = String(params.get("debugParser") || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function buildVisualLinkedEvidenceSummary(analysis: VisualDocumentAnalysis) {
  const entitiesById = new Map(analysis.entities.map((entity, index) => [entity.entityId, { entity, index }]));
  const groupedEvidence = new Map<
    string,
    {
      label: string;
      order: number;
      fields: Map<string, { field: string; pageNumber: number; priority: number }>;
    }
  >();

  for (const evidence of analysis.fieldEvidence) {
    const pageNumber = Number(evidence.pageNumber || 0);
    if (!pageNumber) continue;

    const field = normalizeVisualLinkedEvidenceField(evidence.field);
    if (!field) continue;

    const entityMatch = entitiesById.get(evidence.entityId);
    const label =
      entityMatch?.entity.sku ||
      entityMatch?.entity.name ||
      entityMatch?.entity.modelKey ||
      evidence.modelKey ||
      evidence.entityId;
    const entityKey = evidence.entityId || label;
    const currentGroup =
      groupedEvidence.get(entityKey) ??
      {
        label,
        order: entityMatch?.index ?? analysis.entities.length + groupedEvidence.size,
        fields: new Map<string, { field: string; pageNumber: number; priority: number }>(),
      };

    const dedupeKey = `${field}::${pageNumber}`;
    if (!currentGroup.fields.has(dedupeKey)) {
      currentGroup.fields.set(dedupeKey, {
        field,
        pageNumber,
        priority: getVisualLinkedEvidenceFieldPriority(field),
      });
    }

    groupedEvidence.set(entityKey, currentGroup);
  }

  return Array.from(groupedEvidence.values())
    .sort((a, b) => {
      const orderDelta = a.order - b.order;
      if (orderDelta !== 0) return orderDelta;
      return a.label.localeCompare(b.label);
    })
    .slice(0, 8)
    .map((group) => {
      const fieldSummary = Array.from(group.fields.values())
        .sort((a, b) => {
          const priorityDelta = a.priority - b.priority;
          if (priorityDelta !== 0) return priorityDelta;
          const pageDelta = a.pageNumber - b.pageNumber;
          if (pageDelta !== 0) return pageDelta;
          return a.field.localeCompare(b.field);
        })
        .slice(0, 6)
        .map((item) => `${item.field} p${item.pageNumber}`)
        .join(", ");

      return `${group.label}: ${fieldSummary}`;
    });
}

function formatVisualConsolidatedCandidateSummary(analysis: VisualDocumentAnalysis) {
  return analysis.consolidatedReviewCandidates.slice(0, 8).map((candidate) => {
    const label = candidate.sku || candidate.name || candidate.modelKey || candidate.entityId;
    const fields = [
      candidate.name ? "nome" : null,
      candidate.sku ? "codigo" : null,
      candidate.category ? "categoria" : null,
      candidate.dimensionsList.length > 0 ? "medidas" : null,
      candidate.material ? "material" : null,
      candidate.description ? "descricao" : null,
    ].filter(Boolean);
    const missingFields = candidate.missingFields
      .map((field) => (field === "code" || field === "sku" ? "codigo" : field))
      .slice(0, 4);
    const details = [
      `paginas ${candidate.sourcePages.join(",") || "-"}`,
      fields.length > 0 ? `campos ${fields.join(", ")}` : "campos -",
      candidate.dimensionsList.length > 1 ? `${candidate.dimensionsList.length} medidas encontradas` : null,
      missingFields.length > 0 ? `faltando ${missingFields.join("/")}` : null,
      candidate.conflictsCount > 0 ? `${candidate.conflictsCount} conflito(s)` : null,
    ].filter(Boolean);

    return `${label}: ${details.join("; ")}`;
  });
}

function getVisualConsolidatedFoundFields(candidate: VisualDocumentAnalysis["consolidatedReviewCandidates"][number]) {
  return [
    candidate.name ? "Nome" : null,
    candidate.sku ? "Codigo/SKU" : null,
    candidate.category ? "Categoria" : null,
    candidate.dimensionsList.length > 0 ? "Medidas" : null,
    candidate.material ? "Material" : null,
    candidate.description ? "Descricao" : null,
  ].filter((field): field is string => Boolean(field));
}

function getVisualConsolidatedMissingFields(candidate: VisualDocumentAnalysis["consolidatedReviewCandidates"][number]) {
  return candidate.missingFields.map((field) => {
    if (field === "code") return "Codigo/SKU";
    if (field === "price") return "Preco";
    return translateVisualMissingField(field);
  });
}
function normalizeEditableVisualReviewCategory(category: string | null | undefined): EditableVisualReviewItem["category"] {
  return category === "pool" ||
    category === "chemical" ||
    category === "accessory" ||
    category === "other"
    ? category
    : "";
}
function buildVisualReviewCandidatesSignature(
  candidates: VisualDocumentAnalysis["consolidatedReviewCandidates"]
) {
  return candidates.map((candidate) => candidate.candidateId).join("|");
}
function cleanupEditableVisualReviewMissingFields(item: EditableVisualReviewItem) {
  const filled = new Set<string>();
  if (item.name.trim()) filled.add("name");
  if (item.sku.trim() || item.code.trim()) {
    filled.add("sku");
    filled.add("code");
  }
  if (item.category) filled.add("category");
  if (item.dimensionsText.trim()) filled.add("dimensions");
  if (item.material.trim()) filled.add("material");
  if (item.description.trim()) filled.add("description");
  if (item.price.trim()) filled.add("price");
  if (item.stock.trim()) filled.add("stock");

  return {
    ...item,
    missingFields: item.originalCandidate.missingFields.filter((field) => !filled.has(field)),
  };
}
function buildEditableVisualReviewItemsFromCandidates(
  candidates: VisualDocumentAnalysis["consolidatedReviewCandidates"]
): EditableVisualReviewItem[] {
  return candidates.map((candidate) => {
    const sku = candidate.sku || candidate.code || "";
    const item: EditableVisualReviewItem = {
      id: candidate.candidateId,
      candidateId: candidate.candidateId,
      entityId: candidate.entityId,
      name: candidate.name || "",
      category: normalizeEditableVisualReviewCategory(candidate.category),
      sku,
      code: candidate.code || sku,
      price: "",
      selectedImageKey: "",
      selectedImageKeys: [],
      dimensionsText: candidate.dimensionsList.join(" | ") || candidate.dimensions || "",
      dimensionsList: candidate.dimensionsList,
      material: candidate.material || "",
      description: candidate.description || "",
      stock: "",
      isActive: true,
      reviewState: "pending",
      sourcePages: candidate.sourcePages,
      confidence: candidate.confidence || 0,
      missingFields: candidate.missingFields,
      conflicts: candidate.conflicts,
      fieldSources: candidate.fieldSources,
      dirty: false,
      saved: false,
      originalCandidate: candidate,
    };
    return cleanupEditableVisualReviewMissingFields(item);
  });
}
function buildVisualReviewSavePreviewItem(item: EditableVisualReviewItem): VisualReviewSavePreviewItem {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const priceInput = parseVisualReviewPriceInput(item.price);

  if (item.reviewState !== "approved") {
    blockers.push("Item nao aprovado");
  }
  if (!item.name.trim()) {
    blockers.push("Nome vazio");
  }
  if (!item.category) {
    blockers.push("Categoria nao escolhida");
  }
  if (priceInput.error) {
    blockers.push("Preco invalido ou ambiguo");
  }
  if (!item.dimensionsText.trim()) {
    warnings.push(item.category === "pool" ? "Piscina sem medidas revisadas" : "Medidas vazias");
  }

  return { item, blockers, warnings };
}
function normalizeVisualReviewDiagnosticCode(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_/\.]+/g, "")
    .replace(/[^A-Z0-9]/g, "");
  return normalized.length >= 3 && /[A-Z]/.test(normalized) && /\d/.test(normalized)
    ? normalized
    : "";
}
function normalizeVisualReviewDiagnosticName(value: string | null | undefined) {
  const words = normalizeImportedLoose(value).split(" ").filter(Boolean);
  return words.filter((word, index) => index === 0 || word !== words[index - 1]).join(" ");
}
function normalizeVisualReviewDiagnosticCategory(value: string | null | undefined) {
  const normalized = normalizeImportedLoose(value);
  if (!normalized) return "";
  if (["pool", "piscina", "piscinas"].includes(normalized)) return "pool";
  if (["chemical", "chemicals", "quimico", "quimicos", "produto quimico", "produtos quimicos"].includes(normalized)) {
    return "chemical";
  }
  if (["accessory", "accessories", "acessorio", "acessorios"].includes(normalized)) return "accessory";
  if (["other", "others", "outro", "outros"].includes(normalized)) return "other";
  return normalized;
}
function getVisualReviewDiagnosticStatus(item: EditableVisualReviewItem) {
  if (item.saved) return "salvo";
  if (item.reviewState === "approved") return "aprovado";
  if (item.reviewState === "ignored") return "ignorado";
  return "pendente";
}
function getVisualReviewDiagnosticSignature(items: EditableVisualReviewItem[]) {
  return items.map((item) => item.id).sort().join("|");
}
function getVisualReviewNameTokens(item: EditableVisualReviewItem) {
  return Array.from(
    new Set(
      normalizeVisualReviewDiagnosticName(item.name)
        .split(" ")
        .filter((token) => token.length >= 3)
    )
  );
}
function areVisualReviewNamesWeaklySimilar(left: EditableVisualReviewItem, right: EditableVisualReviewItem) {
  const leftCategory = normalizeVisualReviewDiagnosticCategory(left.category);
  const rightCategory = normalizeVisualReviewDiagnosticCategory(right.category);
  if (!leftCategory || leftCategory !== rightCategory) return false;

  const leftName = normalizeVisualReviewDiagnosticName(left.name);
  const rightName = normalizeVisualReviewDiagnosticName(right.name);
  if (!leftName || !rightName || leftName === rightName) return false;

  const leftTokens = getVisualReviewNameTokens(left);
  const rightTokens = getVisualReviewNameTokens(right);
  if (leftTokens.length < 2 || rightTokens.length < 2) return false;

  const rightTokenSet = new Set(rightTokens);
  const sharedCount = leftTokens.filter((token) => rightTokenSet.has(token)).length;
  const overlap = sharedCount / Math.min(leftTokens.length, rightTokens.length);
  return sharedCount >= 2 && overlap >= 0.75;
}
function buildVisualReviewDuplicateDiagnostics(
  items: EditableVisualReviewItem[]
): VisualReviewDuplicateDiagnostics {
  const suspiciousGroups: VisualReviewDuplicateDiagnosticGroup[] = [];
  const signatures = new Set<string>();
  const pushGroup = (
    type: VisualReviewDuplicateDiagnosticGroup["type"],
    key: string,
    groupItems: EditableVisualReviewItem[]
  ) => {
    const uniqueItems = Array.from(new Map(groupItems.map((item) => [item.id, item])).values());
    if (uniqueItems.length < 2) return;
    const signature = `${type}::${getVisualReviewDiagnosticSignature(uniqueItems)}`;
    if (signatures.has(signature)) return;
    signatures.add(signature);
    suspiciousGroups.push({
      id: `${type}-${key}-${suspiciousGroups.length}`,
      type,
      items: uniqueItems,
    });
  };

  const byCode = new Map<string, EditableVisualReviewItem[]>();
  const byNameCategory = new Map<string, EditableVisualReviewItem[]>();

  for (const item of items) {
    const code = normalizeVisualReviewDiagnosticCode(item.sku || item.code);
    if (code) byCode.set(code, [...(byCode.get(code) ?? []), item]);

    const name = normalizeVisualReviewDiagnosticName(item.name);
    const category = normalizeVisualReviewDiagnosticCategory(item.category);
    if (name && category) {
      const key = `${category}::${name}`;
      byNameCategory.set(key, [...(byNameCategory.get(key) ?? []), item]);
    }
  }

  for (const [key, groupItems] of byCode.entries()) {
    pushGroup("SKU parecido", key, groupItems);
  }
  for (const [key, groupItems] of byNameCategory.entries()) {
    pushGroup("Nome igual", key, groupItems);
  }

  const weakSimilarGroups: EditableVisualReviewItem[][] = [];
  for (const item of items) {
    let group = weakSimilarGroups.find((currentGroup) =>
      currentGroup.some((candidate) => areVisualReviewNamesWeaklySimilar(candidate, item))
    );
    if (!group) {
      group = [];
      weakSimilarGroups.push(group);
    }
    group.push(item);
  }
  for (const groupItems of weakSimilarGroups) {
    if (groupItems.length < 2) continue;
    const categories = new Set(groupItems.map((item) => normalizeVisualReviewDiagnosticCategory(item.category)));
    if (categories.size !== 1) continue;
    pushGroup("Nome parecido", getVisualReviewDiagnosticSignature(groupItems), groupItems);
  }

  return {
    totalItems: items.length,
    suspiciousGroups,
    suspiciousItemCount: new Set(
      suspiciousGroups.flatMap((group) => group.items.map((item) => item.id))
    ).size,
  };
}
function mapVisualReviewCategoryToCatalogCategory(
  category: EditableVisualReviewItem["category"]
): ImportedCatalogCategory | null {
  if (category === "chemical") return "quimicos";
  if (category === "accessory") return "acessorios";
  if (category === "other") return "outros";
  return null;
}
function parseVisualReviewPriceCents(value: string) {
  return parseVisualReviewPriceInput(value).cents;
}
function parseVisualReviewPriceInput(value: string): {
  amount: number | null;
  cents: number | null;
  error: string | null;
  isAmbiguous: boolean;
} {
  const raw = String(value || "").trim();
  if (!raw) {
    return { amount: null, cents: null, error: null, isAmbiguous: false };
  }

  const numericSource = raw.replace(/[^\d,.]/g, "");
  const digitsOnly = numericSource.replace(/\D/g, "");
  const hasSeparator = /[,.]/.test(numericSource);

  if (!hasSeparator && digitsOnly.length >= 7) {
    return {
      amount: null,
      cents: null,
      error: "Preco muito alto sem separador. Use formato como 150.000,00.",
      isAmbiguous: true,
    };
  }

  const parsed = parseImportedDecimal(raw);
  if (parsed == null) {
    return {
      amount: null,
      cents: null,
      error: "Preco invalido ou ambiguo.",
      isAmbiguous: false,
    };
  }

  const amount = Math.max(0, parsed);
  return {
    amount,
    cents: Math.max(0, Math.round(amount * 100)),
    error: null,
    isAmbiguous: false,
  };
}
function parseVisualReviewStockQuantity(value: string) {
  const parsed = parseImportedDecimal(value);
  return parsed == null ? 0 : Math.max(0, Math.round(parsed));
}
function parseVisualReviewPoolMetrics(item: EditableVisualReviewItem) {
  const source = normalizeImportedPoolMetricSource(
    [item.dimensionsText, item.material, item.description].filter(Boolean).join(" ")
  );
  const numbers = (source.match(/\d+(?:[\.,]\d+)?/g) ?? [])
    .map((value) => parseImportedDecimal(value))
    .filter((value): value is number => value != null && value > 0);
  const width = numbers[0] ?? null;
  const length = numbers[1] ?? null;
  const depth = numbers[2] ?? null;
  const capacityMatch = source.match(/(\d{3,}(?:[\.,]\d+)?)\s*(?:l|litros?)\b/i);
  const capacity = capacityMatch ? parseImportedDecimal(capacityMatch[1]) : null;
  const materialSource = normalizeImportedLoose([item.material, item.description].join(" "));
  const shapeSource = normalizeImportedLoose([item.name, item.dimensionsText, item.description].join(" "));
  let material = item.material.trim() || "fibra";
  if (!item.material.trim()) {
    if (materialSource.includes("spa")) material = "spa";
    else if (materialSource.includes("vinil")) material = "vinil";
    else if (materialSource.includes("alvenaria")) material = "alvenaria";
    else if (materialSource.includes("pastilha")) material = "pastilha";
  }
  let shape = "retangular";
  if (shapeSource.includes("prainha")) shape = "com prainha";
  else if (shapeSource.includes("organica")) shape = "organica";
  else if (shapeSource.includes("diam") || shapeSource.includes("redonda")) shape = "redonda";
  else if (shapeSource.includes("oval")) shape = "oval";
  else if (shapeSource.includes("raia")) shape = "raia";

  return {
    width_m: width,
    length_m: length,
    depth_m: depth,
    max_capacity_l: capacity ? Math.round(capacity) : null,
    material,
    shape,
  };
}
function buildVisualReviewItemMetadata(
  item: EditableVisualReviewItem,
  category: ImportedCatalogCategory
) {
  return {
    source: "visual_catalog_review",
    categoria: category,
    visual_candidate_id: item.candidateId,
    visual_entity_id: item.entityId,
    source_pages: item.sourcePages,
    confidence: item.confidence,
    dimensions_text: item.dimensionsText,
    dimensions_list: item.dimensionsList,
    material: item.material || null,
    field_sources: item.fieldSources,
    conflicts: item.conflicts,
    original_missing_fields: item.originalCandidate.missingFields,
    review_state: item.reviewState,
  };
}
function buildVisualReviewIdentityKey(item: EditableVisualReviewItem) {
  const normalizedName = normalizeImportedLoose(item.name);
  const normalizedSku = normalizeImportedLoose(item.sku || item.code);
  if (item.category === "pool") return `pool::${normalizedName}`;
  const category = mapVisualReviewCategoryToCatalogCategory(item.category) ?? "outros";
  if (normalizedSku) return `catalog::${category}::sku::${normalizedSku}`;
  return `catalog::${category}::name::${normalizedName}`;
}
type VisualReviewExtractedImagePreview = NonNullable<
  Extract<IntelligentImportResponse, { ok: true }>["extractedImagePreview"]
>[number];
type VisualReviewSuggestedImage = {
  key: string;
  fileName: string;
  sourceFileName: string;
  mimeType: string;
  dataUrl: string;
  pageNumber: number;
  preferredSourceMatch: boolean;
};
type VisualReviewImageSuggestions = {
  candidatesWithPreview: VisualReviewSuggestedImage[];
  candidatesWithoutPreview: Array<{
    key: string;
    fileName: string;
    sourceFileName: string;
    pageNumber: number;
    preferredSourceMatch: boolean;
  }>;
  hasPageMatchWithoutPreview: boolean;
  matchedPages: number[];
};
type StructuredReviewPhotoAssociation =
  | "sheet_scoped_key"
  | "source_location_key"
  | "sheet_row_unique"
  | "docx_block_key"
  | "ambiguous"
  | "none";
type StructuredReviewPhotoCandidate = {
  id: string;
  key: string;
  association: Exclude<StructuredReviewPhotoAssociation, "ambiguous" | "none">;
  associationStrength: "strong_auto" | "visual_evidence" | "weak_confirmed";
  fileName: string;
  sourceFileName: string;
  mimeType: string;
  dataUrl: string;
  sourceKind: string;
  sheetName: string;
  sheetScopedKey: string;
  sourceLocationKey: string;
  worksheetRowNumber: number | null;
  stagingAssetId: string | null;
  stagingStorageRef: string | null;
  placement: string;
  evidenceType: string;
  associationState: string;
  docxBlockKey: string;
  docxMediaPath: string;
  docxTableCell: string;
  documentOrderKey: string;
};
type StructuredReviewPhotoResolution =
  | {
      state: "strong";
      association: Exclude<StructuredReviewPhotoAssociation, "ambiguous" | "none">;
      primary: StructuredReviewPhotoCandidate;
      candidates: StructuredReviewPhotoCandidate[];
      message: string;
    }
  | {
      state: "ambiguous";
      association: "ambiguous";
      primary: null;
      candidates: StructuredReviewPhotoCandidate[];
      message: string;
    }
  | {
      state: "evidence";
      association: "docx_block_key";
      primary: StructuredReviewPhotoCandidate | null;
      candidates: StructuredReviewPhotoCandidate[];
      message: string;
      evidenceState: "evidence_confirmable" | "weak_confirmed" | "evidence_ambiguous" | "evidence_unmatched";
      confirmedCandidateKeys: string[];
    }
  | {
      state: "none";
      association: "none";
      primary: null;
      candidates: [];
      message: string;
    };
type StructuredUnifiedReviewItem = {
  candidate: EditableStructuredImportCandidate;
  candidateValidation: StructuredReviewCandidateValidation | null;
  reviewedItem: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
  displayName: string;
  sku: string;
  priceLabel: string;
  stockLabel: string;
  descriptionSnippet: string;
  originLabel: string;
  sourceFileName: string;
  sourceSheetName: string;
  worksheetRowNumber: number | null;
  sourceLocationKey: string;
  sourceKind: string;
  confidencePercent: number;
  stateLabel: string;
  hasLocalEdits: boolean;
  categoryAdjusted: boolean;
  duplicateReason: string | null;
  photoResolution: StructuredReviewPhotoResolution;
  warnings: string[];
  blockingReasons: string[];
};
function getStructuredCompactStatus(item: StructuredUnifiedReviewItem) {
  const duplicateReason = String(item.duplicateReason || "").trim();
  if (duplicateReason) {
    return {
      label: duplicateReason.replace(/\.$/, ""),
      tone: "blocked" as const,
    };
  }

  const primaryBlockingReason = String(item.blockingReasons[0] || "").trim();
  if (primaryBlockingReason) {
    return {
      label: primaryBlockingReason.replace(/\.$/, ""),
      tone: "blocked" as const,
    };
  }

  const primaryWarning = String(item.warnings[0] || "").trim();
  if (primaryWarning) {
    return {
      label: primaryWarning.replace(/\.$/, ""),
      tone: "warning" as const,
    };
  }

  return {
    label: item.candidate.selected ? "Pronto para salvar" : "Revisar antes de salvar",
    tone: item.candidate.selected ? ("ready" as const) : ("warning" as const),
  };
}
function getVisualReviewImagePageNumber(image: VisualReviewExtractedImagePreview) {
  if (typeof image.worksheetRowNumber === "number" && image.worksheetRowNumber > 0) {
    return Math.floor(image.worksheetRowNumber);
  }

  const scopedPageMatch = String(image.sheetScopedKey || "").match(/pdf::page::(\d+)/i);
  if (scopedPageMatch?.[1]) {
    const parsed = Number(scopedPageMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }

  if (typeof image.imageOrder === "number" && image.imageOrder >= 0) {
    return Math.floor(image.imageOrder + 1);
  }

  return null;
}
function buildVisualReviewSuggestedImageKey(
  image: VisualReviewExtractedImagePreview,
  pageNumber: number,
  index: number
) {
  return [
    "visual-review-image",
    String(image.originalSourceFileName || image.sourceFileName || "").trim().toLowerCase(),
    pageNumber,
    String(image.fileName || "imagem-extraida").trim().toLowerCase(),
    index,
  ].join("::");
}
function buildStructuredReviewSuggestedImageKey(
  image: VisualReviewExtractedImagePreview,
  index: number
) {
  return [
    "structured-review-image",
    String(image.originalSourceFileName || image.sourceFileName || "").trim().toLowerCase(),
    String(image.docxBlockKey || "").trim().toLowerCase(),
    String(image.sheetScopedKey || "").trim().toLowerCase(),
    String(image.worksheetRowNumber ?? ""),
    String(image.fileName || "imagem-extraida").trim().toLowerCase(),
    index,
  ].join("::");
}
function extractImportedDocxBlockKey(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const metadataCandidates = [
    item.metadata?.docx_block_key,
    item.metadata?.docxBlockKey,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (metadataCandidates.length > 0) return metadataCandidates[0];

  const rawText = [String(item.title || ""), String(item.rawText || "")].join("\n");
  const match = rawText.match(/(?:^|\n)docx block key\s*:\s*([^\n]+)/i);
  return String(match?.[1] || "").trim();
}
function normalizeStructuredReviewSourceFileName(value: string | null | undefined) {
  return normalizeImportedLoose(String(value || "").replace(/\.[^.]+$/g, "").trim());
}
function buildStructuredPreviewImageSourceLocationKey(image: VisualReviewExtractedImagePreview) {
  const sourceFileName = normalizeStructuredReviewSourceFileName(
    image.originalSourceFileName || image.sourceFileName
  );
  const sheetScopedKey = normalizeImportedLoose(String(image.sheetScopedKey || "").trim());
  const sheetName = normalizeImportedLoose(String(image.sheetName || "").trim());
  const worksheetRowNumber =
    typeof image.worksheetRowNumber === "number" && Number.isFinite(image.worksheetRowNumber) && image.worksheetRowNumber > 0
      ? Math.floor(image.worksheetRowNumber)
      : null;

  if (sourceFileName && sheetScopedKey) {
    return `${sourceFileName}::${sheetScopedKey}`;
  }
  if (sourceFileName && sheetName && worksheetRowNumber != null) {
    return `${sourceFileName}::${sheetName}::row::${worksheetRowNumber}`;
  }
  return "";
}
function findStructuredReviewStagedAssetForImage(
  image: VisualReviewExtractedImagePreview,
  stagedMediaAssets: IntelligentImportStagedMediaAsset[]
) {
  const sourceFileName = normalizeStructuredReviewSourceFileName(
    image.originalSourceFileName || image.sourceFileName
  );
  const sheetScopedKey = normalizeImportedLoose(String(image.sheetScopedKey || "").trim());
  const sourceLocationKey = normalizeImportedLoose(buildStructuredPreviewImageSourceLocationKey(image));
  const worksheetRowNumber =
    typeof image.worksheetRowNumber === "number" && Number.isFinite(image.worksheetRowNumber) && image.worksheetRowNumber > 0
      ? Math.floor(image.worksheetRowNumber)
      : null;

  const matches = stagedMediaAssets.filter((asset) => {
    if (asset.sourceKind !== "xlsx_row_image") return false;
    const assetFileName = normalizeStructuredReviewSourceFileName(asset.sourceFileName);
    if (sourceFileName && assetFileName && assetFileName !== sourceFileName) return false;
    const assetSheetScopedKey = normalizeImportedLoose(String(asset.sheetScopedKey || "").trim());
    const assetSourceLocationKey = normalizeImportedLoose(String(asset.sourceLocationKey || "").trim());
    const assetWorksheetRowNumber =
      typeof asset.worksheetRowNumber === "number" && Number.isFinite(asset.worksheetRowNumber) && asset.worksheetRowNumber > 0
        ? Math.floor(asset.worksheetRowNumber)
        : null;

    return (
      (sheetScopedKey && assetSheetScopedKey && sheetScopedKey === assetSheetScopedKey) ||
      (sourceLocationKey && assetSourceLocationKey && sourceLocationKey === assetSourceLocationKey) ||
      (worksheetRowNumber != null &&
        assetWorksheetRowNumber != null &&
        worksheetRowNumber === assetWorksheetRowNumber)
    );
  });

  return matches.length === 1 ? matches[0] : null;
}
function buildStructuredReviewPhotoCandidate(
  image: VisualReviewExtractedImagePreview,
  association: StructuredReviewPhotoCandidate["association"],
  index: number,
  stagedMediaAssets: IntelligentImportStagedMediaAsset[],
  confirmed = false
): StructuredReviewPhotoCandidate {
  const stagedAsset = findStructuredReviewStagedAssetForImage(image, stagedMediaAssets);
  return {
    id: stagedAsset?.id || buildStructuredReviewSuggestedImageKey(image, index),
    key: buildStructuredReviewSuggestedImageKey(image, index),
    association,
    associationStrength: confirmed
      ? "weak_confirmed"
      : association === "docx_block_key"
        ? "visual_evidence"
        : "strong_auto",
    fileName: image.fileName || "imagem-extraida",
    sourceFileName: String(image.originalSourceFileName || image.sourceFileName || "").trim(),
    mimeType: image.mimeType || "image/png",
    dataUrl: image.dataUrl,
    sourceKind: String(image.sourceKind || image.source || "").trim() || "xlsx",
    sheetName: String(image.sheetName || "").trim(),
    sheetScopedKey: String(image.sheetScopedKey || "").trim(),
    sourceLocationKey: buildStructuredPreviewImageSourceLocationKey(image),
    worksheetRowNumber:
      typeof image.worksheetRowNumber === "number" && Number.isFinite(image.worksheetRowNumber) && image.worksheetRowNumber > 0
        ? Math.floor(image.worksheetRowNumber)
        : null,
    stagingAssetId: stagedAsset?.id || null,
    stagingStorageRef: stagedAsset?.stagingStorageRef || null,
    placement: String(image.placement || "").trim(),
    evidenceType: String(image.evidenceType || "").trim(),
    associationState: String(image.associationState || "").trim(),
    docxBlockKey: String(image.docxBlockKey || "").trim(),
    docxMediaPath: String(image.docxMediaPath || "").trim(),
    docxTableCell: String(image.docxTableCell || "").trim(),
    documentOrderKey: String(image.documentOrderKey || "").trim(),
  };
}
function resolveStructuredReviewPhotoResolution(args: {
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
  images: VisualReviewExtractedImagePreview[];
  stagedMediaAssets: IntelligentImportStagedMediaAsset[];
  confirmedDocxImageKeys?: string[];
}) : StructuredReviewPhotoResolution {
  const itemSourceFileName = normalizeStructuredReviewSourceFileName(
    extractImportedOriginalSourceFileName(args.item) || args.item.sourceFileName
  );
  const itemSheetScopedKey = normalizeImportedLoose(extractImportedSheetScopedKey(args.item));
  const itemSourceLocationKey = normalizeImportedLoose(buildImportedSourceLocationKey(args.item));
  const itemSheetName = normalizeImportedLoose(extractImportedSourceSheetName(args.item));
  const itemWorksheetRowNumber = extractImportedWorksheetRowNumber(args.item);
  const itemDocxBlockKey = normalizeImportedLoose(extractImportedDocxBlockKey(args.item));
  const confirmedDocxImageKeys = new Set(
    (args.confirmedDocxImageKeys ?? []).map((value) => normalizeImportedLoose(value)).filter(Boolean)
  );

  const candidateImages = args.images
    .map((image, index) => ({ image, index }))
    .filter(({ image }) => normalizeImportedLoose(String(image.source || "")) === "xlsx")
    .filter(({ image }) => {
      const imageSourceFileName = normalizeStructuredReviewSourceFileName(
        image.originalSourceFileName || image.sourceFileName
      );
      return !itemSourceFileName || !imageSourceFileName || itemSourceFileName === imageSourceFileName;
    });

  const sheetScopedMatches = candidateImages.filter(({ image }) => {
    const imageSheetScopedKey = normalizeImportedLoose(String(image.sheetScopedKey || "").trim());
    return Boolean(itemSheetScopedKey && imageSheetScopedKey && itemSheetScopedKey === imageSheetScopedKey);
  });
  if (sheetScopedMatches.length === 1) {
    const { image, index } = sheetScopedMatches[0];
    return {
      state: "strong",
      association: "sheet_scoped_key",
      primary: buildStructuredReviewPhotoCandidate(image, "sheet_scoped_key", index, args.stagedMediaAssets),
      candidates: [
        buildStructuredReviewPhotoCandidate(image, "sheet_scoped_key", index, args.stagedMediaAssets),
      ],
      message: "Foto associada automaticamente por sheetScopedKey.",
    };
  }
  if (sheetScopedMatches.length > 1) {
    return {
      state: "ambiguous",
      association: "ambiguous",
      primary: null,
      candidates: sheetScopedMatches.map(({ image, index }) =>
        buildStructuredReviewPhotoCandidate(image, "sheet_scoped_key", index, args.stagedMediaAssets)
      ),
      message: "Mais de uma foto corresponde ao mesmo sheetScopedKey.",
    };
  }

  const sourceLocationMatches = candidateImages.filter(({ image }) => {
    const imageSourceLocationKey = normalizeImportedLoose(buildStructuredPreviewImageSourceLocationKey(image));
    return Boolean(
      itemSourceLocationKey &&
        imageSourceLocationKey &&
        itemSourceLocationKey === imageSourceLocationKey
    );
  });
  if (sourceLocationMatches.length === 1) {
    const { image, index } = sourceLocationMatches[0];
    return {
      state: "strong",
      association: "source_location_key",
      primary: buildStructuredReviewPhotoCandidate(image, "source_location_key", index, args.stagedMediaAssets),
      candidates: [
        buildStructuredReviewPhotoCandidate(image, "source_location_key", index, args.stagedMediaAssets),
      ],
      message: "Foto associada automaticamente por sourceLocationKey.",
    };
  }
  if (sourceLocationMatches.length > 1) {
    return {
      state: "ambiguous",
      association: "ambiguous",
      primary: null,
      candidates: sourceLocationMatches.map(({ image, index }) =>
        buildStructuredReviewPhotoCandidate(image, "source_location_key", index, args.stagedMediaAssets)
      ),
      message: "Mais de uma foto corresponde ao mesmo sourceLocationKey.",
    };
  }

  const sheetRowMatches = candidateImages.filter(({ image }) => {
    const imageSheetName = normalizeImportedLoose(String(image.sheetName || "").trim());
    const imageWorksheetRowNumber =
      typeof image.worksheetRowNumber === "number" && Number.isFinite(image.worksheetRowNumber) && image.worksheetRowNumber > 0
        ? Math.floor(image.worksheetRowNumber)
        : null;
    return Boolean(
      itemSheetName &&
        imageSheetName &&
        itemWorksheetRowNumber != null &&
        imageWorksheetRowNumber != null &&
        itemSheetName === imageSheetName &&
        itemWorksheetRowNumber === imageWorksheetRowNumber
    );
  });
  if (sheetRowMatches.length === 1) {
    const { image, index } = sheetRowMatches[0];
    return {
      state: "strong",
      association: "sheet_row_unique",
      primary: buildStructuredReviewPhotoCandidate(image, "sheet_row_unique", index, args.stagedMediaAssets),
      candidates: [
        buildStructuredReviewPhotoCandidate(image, "sheet_row_unique", index, args.stagedMediaAssets),
      ],
      message: "Foto associada automaticamente por aba + linha unica.",
    };
  }
  if (sheetRowMatches.length > 1) {
    return {
      state: "ambiguous",
      association: "ambiguous",
      primary: null,
      candidates: sheetRowMatches.map(({ image, index }) =>
        buildStructuredReviewPhotoCandidate(image, "sheet_row_unique", index, args.stagedMediaAssets)
      ),
      message: "Mais de uma foto corresponde a esta aba + linha.",
    };
  }

  const docxBlockMatches = args.images
    .map((image, index) => ({ image, index }))
    .filter(({ image }) => normalizeImportedLoose(String(image.source || "")) === "docx")
    .filter(
      ({ image }) =>
        normalizeImportedLoose(String(image.placement || "")) ===
        normalizeImportedLoose("inline_table")
    )
    .filter(({ image }) => {
      const imageSourceFileName = normalizeStructuredReviewSourceFileName(
        image.originalSourceFileName || image.sourceFileName
      );
      return !itemSourceFileName || !imageSourceFileName || itemSourceFileName === imageSourceFileName;
    })
    .filter(({ image }) => {
      const imageDocxBlockKey = normalizeImportedLoose(String(image.docxBlockKey || "").trim());
      return Boolean(itemDocxBlockKey && imageDocxBlockKey && itemDocxBlockKey === imageDocxBlockKey);
    });
  if (docxBlockMatches.length > 0) {
    const candidates = docxBlockMatches.map(({ image, index }) =>
      buildStructuredReviewPhotoCandidate(
        image,
        "docx_block_key",
        index,
        args.stagedMediaAssets,
        confirmedDocxImageKeys.has(normalizeImportedLoose(buildStructuredReviewSuggestedImageKey(image, index)))
      )
    );
    const confirmedCandidateKeys = candidates
      .map((candidate) => candidate.key)
      .filter((candidateKey) => confirmedDocxImageKeys.has(normalizeImportedLoose(candidateKey)));
    return {
      state: "evidence",
      association: "docx_block_key",
      primary: candidates[0] ?? null,
      candidates,
      message:
        confirmedCandidateKeys.length > 0
          ? `${confirmedCandidateKeys.length} foto(s) confirmada(s) neste bloco.`
          : `${candidates.length} foto(s) encontradas neste bloco - confirme para incluir no catalogo.`,
      evidenceState: confirmedCandidateKeys.length > 0 ? "weak_confirmed" : "evidence_confirmable",
      confirmedCandidateKeys,
    };
  }

  return {
    state: "none",
    association: "none",
    primary: null,
    candidates: [],
    message: "Nenhuma foto associada.",
  };
}
function getVisualReviewSuggestedImages(
  item: EditableVisualReviewItem,
  images: VisualReviewExtractedImagePreview[],
  preferredSourceFileName?: string | null,
  blockedPages?: Set<number>
): VisualReviewImageSuggestions {
  const sourcePages = new Set(
    item.sourcePages
      .map((page) => Number(page || 0))
      .filter((page) => Number.isFinite(page) && page > 0)
      .map((page) => Math.floor(page))
  );
  if (sourcePages.size === 0) {
    return {
      candidatesWithPreview: [],
      candidatesWithoutPreview: [],
      hasPageMatchWithoutPreview: false,
      matchedPages: [],
    };
  }

  const normalizedPreferredSource = normalizeImportedLoose(preferredSourceFileName);
  const candidates = images
    .map((image, index) => {
      const pageNumber = getVisualReviewImagePageNumber(image);
      if (!pageNumber || !sourcePages.has(pageNumber)) return null;
      if (blockedPages?.has(pageNumber)) return null;
      if (String(image.source || "").toLowerCase() !== "pdf") return null;

      const sourceFileName = String(image.originalSourceFileName || image.sourceFileName || "").trim();
      const preferredSourceMatch =
        Boolean(normalizedPreferredSource) &&
        normalizeImportedLoose(sourceFileName) === normalizedPreferredSource;

      return {
        key: buildVisualReviewSuggestedImageKey(image, pageNumber, index),
        fileName: image.fileName || `Pagina ${pageNumber}`,
        sourceFileName,
        mimeType: image.mimeType || "image/png",
        dataUrl: image.dataUrl,
        pageNumber,
        preferredSourceMatch,
      };
    })
    .filter((image): image is VisualReviewSuggestedImage => Boolean(image))
    .sort((left, right) => {
      if (left.preferredSourceMatch !== right.preferredSourceMatch) {
        return left.preferredSourceMatch ? -1 : 1;
      }
      const sourcePageOrder =
        item.sourcePages.indexOf(left.pageNumber) - item.sourcePages.indexOf(right.pageNumber);
      if (sourcePageOrder !== 0) return sourcePageOrder;
      if (left.pageNumber !== right.pageNumber) return left.pageNumber - right.pageNumber;
      return left.fileName.localeCompare(right.fileName);
    });
  const candidatesWithPreview = candidates.filter((image) => String(image.dataUrl || "").trim());
  const candidatesWithoutPreview = candidates.filter((image) => !String(image.dataUrl || "").trim());

  return {
    candidatesWithPreview,
    candidatesWithoutPreview,
    hasPageMatchWithoutPreview: candidatesWithPreview.length === 0 && candidatesWithoutPreview.length > 0,
    matchedPages: Array.from(new Set(candidates.map((image) => image.pageNumber))).sort((a, b) => a - b),
  };
}
function getVisualReviewSelectedImageKeys(item: EditableVisualReviewItem): string[] {
  const selectedImageKeys = Array.isArray(item.selectedImageKeys) ? item.selectedImageKeys : [];
  const legacySelectedImageKey = String(item.selectedImageKey || "").trim();
  const keys = selectedImageKeys
    .map((key) => String(key || "").trim())
    .filter((key) => key && key !== VISUAL_REVIEW_NO_IMAGE_KEY);

  if (
    keys.length === 0 &&
    legacySelectedImageKey &&
    legacySelectedImageKey !== VISUAL_REVIEW_NO_IMAGE_KEY
  ) {
    keys.push(legacySelectedImageKey);
  }

  return Array.from(new Set(keys));
}
function isVisualReviewMarkedWithoutPhoto(item: EditableVisualReviewItem): boolean {
  return String(item.selectedImageKey || "").trim() === VISUAL_REVIEW_NO_IMAGE_KEY;
}
function getSelectedVisualReviewImagesForUpload(
  item: EditableVisualReviewItem,
  images: VisualReviewExtractedImagePreview[],
  preferredSourceFileName?: string | null,
  blockedPages?: Set<number>
): VisualReviewSuggestedImage[] {
  if (isVisualReviewMarkedWithoutPhoto(item)) return [];

  const selectedImageKeys = new Set(getVisualReviewSelectedImageKeys(item));
  if (selectedImageKeys.size === 0) return [];

  const suggestions = getVisualReviewSuggestedImages(item, images, preferredSourceFileName, blockedPages);
  return suggestions.candidatesWithPreview.filter(
    (image) => selectedImageKeys.has(image.key) && Boolean(String(image.dataUrl || "").trim())
  );
}
function getSelectedVisualReviewImageForUpload(
  item: EditableVisualReviewItem,
  images: VisualReviewExtractedImagePreview[],
  preferredSourceFileName?: string | null,
  blockedPages?: Set<number>
): VisualReviewSuggestedImage | null {
  return getSelectedVisualReviewImagesForUpload(item, images, preferredSourceFileName, blockedPages)[0] ?? null;
}
type IntelligentImportSelectedFilePreview = {
  name: string;
  type: string;
  size: number;
  lastModified: number;
};
type PersistedIntelligentImportState = {
  selectedFiles: IntelligentImportSelectedFilePreview[];
  result: IntelligentImportResponse | null;
  successMessage: string | null;
  errorMessage: string | null;
};
type VisualAnalysisCacheFileMeta = {
  name: string;
  size: number;
  lastModified: number;
};
type PersistedVisualAnalysisCache = {
  cacheVersion: number;
  createdAt: number;
  expiresAt: number;
  organizationId: string | null;
  storeId: string | null;
  file: VisualAnalysisCacheFileMeta;
  pages: number[];
  visualEvidencePagesInput: string;
  visualPdfTotalPages: number | null;
  visualDocumentMapResult: VisualCatalogDocumentMapResponse | null;
  visualEvidenceResult: VisualCatalogDocumentScanResponse | null;
};
type PersistedVisualAnalysisPreviewCache = {
  cacheVersion: number;
  createdAt: number;
  expiresAt: number;
  organizationId: string | null;
  storeId: string | null;
  file: VisualAnalysisCacheFileMeta;
  extractedImagePreview: VisualReviewExtractedImagePreview[];
};
type ExistingCatalogItemRow = {
  id: string;
  sku: string | null;
  price_cents: number | null;
  stock_quantity: number | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
};
type StructuredReviewCategory = "pool" | "quimicos" | "acessorios" | "outros";
type EditableStructuredImportCandidate = {
  id: string;
  sourceItem: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
  selected: boolean;
  manuallyIgnored: boolean;
  humanReviewConfirmed: boolean;
  finalCategory: StructuredReviewCategory;
  initialCategory: StructuredReviewCategory;
};
type StructuredReviewListFilter = "all" | "selected" | "deselected" | "ignored";
type StructuredReviewAction = "save" | "dry-run";
type StructuredCandidateDraft = {
  finalCategory: StructuredReviewCategory;
  confirmedDocxImageKeys: string[];
  name: string;
  sku: string;
  price: string;
  stock: string;
  description: string;
  descriptionEdited: boolean;
  isActive: boolean;
  trackStock: boolean;
  brand: string;
  material: string;
  shape: string;
  color: string;
  finishLine: string;
  width: string;
  height: string;
  length: string;
  depth: string;
  unit: string;
  variantSize: string;
  weight: string;
  modelLine: string;
  includedItems: string;
  installationNotes: string;
  application: string;
  technicalNotes: string;
};
type StructuredPreSaveValidationItem = {
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
  destination: ImportedDestination;
  normalizedName: string;
  normalizedSku: string;
  duplicateReason: string | null;
};
type StructuredPreSaveValidationResult = {
  validItems: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>;
  blockedItems: StructuredPreSaveValidationItem[];
  evaluatedItems: StructuredPreSaveValidationItem[];
};
type StructuredDuplicateReferenceData = {
  existingPoolNames: Set<string>;
  existingCatalogNames: Set<string>;
  existingCatalogSkus: Set<string>;
};
type StructuredReviewCandidateValidation = {
  candidateId: string;
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
  destination: ImportedDestination;
  duplicateReason: string | null;
};

const VISUAL_PDF_IMPORT_MESSAGE =
  "PDF visual detectado. O arquivo tem paginas renderizadas, mas nao possui texto extraivel suficiente para gerar itens automaticamente nesta etapa. Para importar esse catalogo, sera necessario OCR/vision por pagina.";
const VISUAL_ANALYSIS_CACHE_VERSION = 1;
const VISUAL_ANALYSIS_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const VISUAL_ANALYSIS_CACHE_MAX_CHARS = 450_000;
const VISUAL_ANALYSIS_CACHE_MAX_IMAGE_PREVIEWS = 40;
const VISUAL_ANALYSIS_CACHE_MAX_IMAGE_PREVIEW_CHARS = 5_000_000;
const VISUAL_ANALYSIS_PREVIEW_CACHE_MAX_CHARS = 4_000_000;
const VISUAL_ANALYSIS_PREVIEW_CACHE_THUMBNAIL_WIDTH = 560;
const VISUAL_ANALYSIS_PREVIEW_CACHE_THUMBNAIL_QUALITY = 0.72;
const VISUAL_ANALYSIS_MAIN_FLOW_MAX_RECOMMENDED_PAGES = 20;
const INTELLIGENT_IMPORT_SUPPORTED_EXTENSIONS = [
  "pdf",
  "docx",
  "txt",
  "xlsx",
  "xlsm",
  "xls",
  "pptx",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "svg",
] as const;
const INTELLIGENT_IMPORT_ACCEPT_ATTRIBUTE =
  ".pdf,.docx,.txt,.xlsx,.xlsm,.xls,.pptx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg";
const INTELLIGENT_IMPORT_SUPPORTED_FORMATS_LABEL =
  "PDF, DOCX, TXT, XLS/XLSX/XLSM, PPTX, PNG, JPG, JPEG, WEBP, GIF, BMP e SVG.";
const INTELLIGENT_IMPORT_SUPPORTED_FORMATS_ERROR_LABEL =
  "PDF, DOCX, TXT, XLS/XLSX/XLSM, PPTX, PNG, JPG, JPEG, WEBP, GIF, BMP ou SVG";
type IntelligentCatalogImportPanelProps = {
  organizationId: string | null | undefined;
  storeId: string | null | undefined;
  storageKey: string | null;
  source?: string;
  disabled?: boolean;
  supabaseClient?: typeof defaultSupabase;
  onError?: (message: string | null) => void;
  onSuccess?: (message: string | null) => void;
  onSaved?: () => void | Promise<void>;
  afterSaveBehavior?: () => void;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
function areStructuredReviewDraftsEqual(
  left: StructuredCandidateDraft | null | undefined,
  right: StructuredCandidateDraft | null | undefined
) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
function computeStableReviewHash(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
function buildStructuredReviewFinalFingerprint(item: IntelligentImportReviewedSaveItem) {
  const serialized = JSON.stringify({
    clientItemId: String(item.clientItemId || "").trim(),
    description: String(item.description || "").trim(),
    destination: item.destination,
    isActive: Boolean(item.isActive),
    name: String(item.name || "").trim(),
    poolPayload: item.poolPayload
      ? {
          depth_m: item.poolPayload.depth_m ?? null,
          length_m: item.poolPayload.length_m ?? null,
          material: item.poolPayload.material ?? null,
          max_capacity_l: item.poolPayload.max_capacity_l ?? null,
          price: item.poolPayload.price ?? null,
          shape: item.poolPayload.shape ?? null,
          weight_kg: item.poolPayload.weight_kg ?? null,
          width_m: item.poolPayload.width_m ?? null,
        }
      : null,
    priceCents: item.priceCents ?? null,
    reviewRequired: Boolean(item.reviewRequired),
    sku: String(item.sku || "").trim(),
    stockQuantity: Number(item.stockQuantity || 0),
    trackStock: Boolean(item.trackStock),
  });
  return `structured-final-v1:${computeStableReviewHash(serialized)}`;
}
function buildStructuredReviewStateSignature(
  entries: IntelligentImportStructuredReviewSnapshotEntry[]
) {
  const serialized = entries
    .slice()
    .sort((left, right) => left.candidateKey.localeCompare(right.candidateKey))
    .map((entry) => [
      entry.candidateKey,
      entry.state,
      entry.finalCategory,
      entry.reviewRequired ? "1" : "0",
      entry.humanReviewConfirmed ? "1" : "0",
      entry.finalFingerprint,
    ]);
  const input = JSON.stringify(serialized);
  return `structured-review-v1:${computeStableReviewHash(input)}:${serialized.length}`;
}
function hasStructuredReviewHumanConfirmationValue(
  metadata: Record<string, unknown> | null | undefined
) {
  if (!metadata || typeof metadata !== "object") return false;
  const candidates = [
    metadata.review_confirmed_by_user,
    metadata.human_review_confirmed,
    metadata.review_confirmation_state,
  ];
  return candidates.some((value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "sim" || normalized === "yes" || normalized === "confirmed";
  });
}
function getStructuredReviewListStatus(item: StructuredUnifiedReviewItem) {
  if (item.candidate.manuallyIgnored) return "ignored" as const;
  if (item.candidate.selected && !item.duplicateReason) return "selected" as const;
  return "deselected" as const;
}
function buildStructuredReviewSearchText(item: StructuredUnifiedReviewItem) {
  return normalizeImportedLoose(
    [
      item.displayName,
      item.reviewedItem.title,
      item.sku,
      getStructuredReviewCategoryLabel(item.candidate.finalCategory),
      extractMetadataValue(item.reviewedItem, [
        "reviewed_category",
        "__resolved_destination",
        "category",
        "categoria",
      ]),
      extractMetadataValue(item.reviewedItem, ["brand", "marca"]),
      extractMetadataValue(item.reviewedItem, ["line", "linha", "finish_line"]),
      extractMetadataValue(item.reviewedItem, ["model", "modelo"]),
    ]
      .filter(Boolean)
      .join(" ")
  );
}
function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
function getIntelligentImportFileExtension(fileName: string) {
  const trimmed = String(fileName || "").trim().toLowerCase();
  if (!trimmed.includes(".")) return "";
  return trimmed.split(".").pop() || "";
}
function isSupportedIntelligentImportFile(file: File) {
  const extension = getIntelligentImportFileExtension(file.name);
  return INTELLIGENT_IMPORT_SUPPORTED_EXTENSIONS.includes(
    extension as (typeof INTELLIGENT_IMPORT_SUPPORTED_EXTENSIONS)[number]
  );
}
function formatUnsupportedIntelligentImportFiles(fileNames: string[]) {
  const cleanedNames = Array.from(
    new Set(
      fileNames
        .map((fileName) => String(fileName || "").trim())
        .filter(Boolean)
    )
  );

  if (cleanedNames.length === 0) {
    return `Nenhum arquivo valido para importar. Use ${INTELLIGENT_IMPORT_SUPPORTED_FORMATS_ERROR_LABEL}.`;
  }

  return `Alguns arquivos foram ignorados por formato nao suportado: ${cleanedNames.join(", ")}.`;
}
function normalizeIntelligentImportErrorMessage(message: string | null | undefined) {
  const cleanMessage = String(message || "").trim();
  if (!cleanMessage) {
    return `Arquivo nao suportado. Use ${INTELLIGENT_IMPORT_SUPPORTED_FORMATS_ERROR_LABEL}.`;
  }

  if (
    cleanMessage.toLowerCase().includes("arquivo nao suportado") ||
    cleanMessage.toLowerCase().includes("arquivos nao suportados")
  ) {
    return cleanMessage;
  }

  if (
    cleanMessage.toLowerCase().includes("tipo de arquivo") &&
    cleanMessage.toLowerCase().includes("suport")
  ) {
    return `Arquivo nao suportado. Use ${INTELLIGENT_IMPORT_SUPPORTED_FORMATS_ERROR_LABEL}.`;
  }

  return cleanMessage;
}
function isImageLikeFileType(fileType: string) {
  return fileType.startsWith("image/");
}
function buildImageFallbackTitle(fileName: string) {
  const normalized = String(fileName ?? "").trim();
  if (!normalized) return "Imagem enviada pela loja";
  const withoutExtension = normalized.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return withoutExtension || normalized;
}
async function createImagePreviewDataUrl(file: File, maxSide = 240) {
  if (typeof window === "undefined" || !isImageLikeFileType(file.type)) return undefined;
  try {
    const objectUrl = URL.createObjectURL(file);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Falha ao gerar miniatura da imagem."));
      img.src = objectUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Falha ao abrir contexto da miniatura.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const previewDataUrl = canvas.toDataURL("image/jpeg", 0.62);
    URL.revokeObjectURL(objectUrl);
    return previewDataUrl;
  } catch (error) {
    console.error("[OnboardingPage] createImagePreviewDataUrl error:", error);
    return undefined;
  }
}
async function buildSelectedFilePreviews(files: File[]) {
  return files.map((file) => ({
    name: file.name,
    type: file.type || "tipo não informado",
    size: file.size,
    lastModified: file.lastModified,
  }));
}

function persistToLocalStorageSafe(key: string, value: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.error("[OnboardingPage] localStorage setItem error:", error);
  }
}

function removeFromLocalStorageSafe(key: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error("[OnboardingPage] localStorage removeItem error:", error);
  }
}

function buildLightPersistedIntelligentImportState(params: {
  selectedFiles: IntelligentImportSelectedFilePreview[];
  successMessage: string | null;
  errorMessage: string | null;
}): PersistedIntelligentImportState {
  return {
    selectedFiles: params.selectedFiles,
    result: null,
    successMessage: params.successMessage,
    errorMessage: params.errorMessage,
  };
}
function decorateIntelligentImportResultWithImageFallback(
  result: IntelligentImportResponse,
  selectedFiles: IntelligentImportSelectedFilePreview[]
): IntelligentImportResponse {
  if (!result.ok) return result;
  const hasStructuredItems = result.normalizedPreview.length > 0 || result.dedupedPreview.length > 0;
  if (hasStructuredItems) return result;
  const visualSources = selectedFiles.filter((file) => isImageLikeFileType(file.type));
  if (visualSources.length === 0) return result;
  const fallbackItems = visualSources.slice(0, 12).map((file, index) => ({
    type: "image_reference",
    sourceFileName: file.name,
    title: buildImageFallbackTitle(file.name),
    rawText:
      "Imagem enviada como referência visual da loja. Nesta prévia, a importação inteligente preservou o arquivo visual, mas ainda não transformou automaticamente a imagem em um item textual estruturado.",
    confidence: 0.42,
    metadata: {
      origem: "imagem_enviada",
      mime_type: file.type || "image/*",
      modo: "fallback_visual_frontend",
    },
  }));
  return {
    ...result,
    message: result.message || "Importação inteligente processada com apoio visual para imagens.",
    normalizedPreview: fallbackItems,
    dedupedPreview: fallbackItems.map((item, index) => ({
      ...item,
      dedupKey: `${item.sourceFileName}:${index}`,
      duplicateOf: undefined,
      isDuplicate: false,
    })),
  };
}

function enrichImportedItemWithResolvedDestination<T extends IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>(
  item: T
): T {
  const resolvedDestination = resolveImportedDestination(item);
  return {
    ...item,
    metadata: {
      ...(item.metadata ?? {}),
      __resolved_destination: resolvedDestination,
      source_sheet_name: extractImportedSourceSheetName(item) || null,
      source_worksheet_row_number: extractImportedWorksheetRowNumber(item) ?? null,
      source_sheet_scoped_key: extractImportedSheetScopedKey(item) || null,
      source_category: extractImportedSourceCategory(item) || null,
      source_subcategory: extractImportedSourceSubcategory(item) || null,
    },
  };
}

function buildFrontendNormalizedPreviewFromItems(
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>
): IntelligentImportNormalizedPreview[] {
  return items.map((rawItem) => {
    const item = enrichImportedItemWithResolvedDestination(rawItem);
    return {
      type: item.type,
      sourceFileName: item.sourceFileName,
      title: item.title,
      rawText: item.rawText,
      confidence: item.confidence,
      metadata: item.metadata ?? {},
    };
  });
}

function buildFrontendDedupedPreviewFromItems(
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>
): IntelligentImportDedupedPreview[] {
  return items.map((rawItem, index) => {
    const item = enrichImportedItemWithResolvedDestination(rawItem);
    return {
      type: item.type,
      sourceFileName: item.sourceFileName,
      title: item.title,
      rawText: item.rawText,
      confidence: item.confidence,
      metadata: item.metadata ?? {},
      dedupKey: `${buildImportedSaveKey(item)}::frontend::${index}`,
      duplicateOf: undefined,
      isDuplicate: false,
    };
  });
}

function isVisualOnlyPdfText(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return true;

  const withoutPagination = text
    .replace(/[-–—]{1,3}\s*\d{1,4}\s+of\s+\d{1,4}\s*[-–—]{1,3}/gi, " ")
    .replace(/[-–—]{1,3}\s*p[aá]gina\s*\d{1,4}\s*(?:de|\/)\s*\d{1,4}\s*[-–—]{0,3}/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.length <= 500 && withoutPagination.length <= 20;
}

function isVisualPdfImportResult(result: IntelligentImportResponse) {
  if (!result.ok) return false;

  const pdfPreviews = result.extractedPreview.filter(
    (preview) => String(preview.extension || "").toLowerCase() === "pdf"
  );
  if (pdfPreviews.length === 0) return false;

  const renderedPdfImages = (result.extractedImagePreview ?? []).filter(
    (image) => String(image.source || "").toLowerCase() === "pdf"
  );
  if (renderedPdfImages.length === 0) return false;

  return pdfPreviews.some((preview) => isVisualOnlyPdfText(preview.textPreview));
}

function normalizeIntelligentImportResultForFrontend(
  result: IntelligentImportResponse
): IntelligentImportResponse {
  if (!result.ok) return result;

  if (isVisualPdfImportResult(result)) {
    return {
      ...result,
      message: VISUAL_PDF_IMPORT_MESSAGE,
      summary: {
        ...result.summary,
        normalizedItems: 0,
        dedupedItems: 0,
        duplicateItems: 0,
      },
      normalizedPreview: [],
      dedupedPreview: [],
    };
  }

  const rawSourceItems =
    result.dedupedPreview.length > 0
      ? result.dedupedPreview
      : result.normalizedPreview;

  const filteredSourceItems = rawSourceItems.filter((item) => !shouldSkipImportedItem(item));
  const saveReadyItems =
    result.dedupedPreview.length > 0
      ? filteredSourceItems
      : dedupeImportedItemsForSave(filteredSourceItems);

  if (saveReadyItems.length === 0) {
    return result;
  }

  const discardedItems = Math.max(0, rawSourceItems.length - saveReadyItems.length);
  const dedupedPreviewForFrontend: IntelligentImportDedupedPreview[] =
    result.dedupedPreview.length > 0
      ? (saveReadyItems as IntelligentImportDedupedPreview[]).map((item) => ({ ...item }))
      : buildFrontendDedupedPreviewFromItems(saveReadyItems);

  return {
    ...result,
    message:
      discardedItems > 0
        ? `${
            result.message || "Importação inteligente processada com sucesso."
          } A prévia foi ajustada para mostrar apenas os itens prontos para salvar.`
        : result.message,
    summary: {
      ...result.summary,
      normalizedItems: saveReadyItems.length,
      dedupedItems: saveReadyItems.length,
      duplicateItems:
        result.dedupedPreview.length > 0
          ? saveReadyItems.filter((item) => "isDuplicate" in item && item.isDuplicate).length
          : discardedItems,
    },
    normalizedPreview: buildFrontendNormalizedPreviewFromItems(saveReadyItems),
    dedupedPreview: dedupedPreviewForFrontend,
  };
}

function getImportedRawFileIdsFromResult(result: IntelligentImportResponse | null) {
  if (!result?.ok || !Array.isArray(result.importedFileIds)) return [];
  return result.importedFileIds
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function getStagedMediaAssetsFromResult(result: IntelligentImportResponse | null) {
  if (!result?.ok || !Array.isArray(result.stagedMediaAssets)) return [];
  return result.stagedMediaAssets.filter((asset) => Boolean(String(asset.id || "").trim()));
}

function getImportedFilesFromResult(result: IntelligentImportResponse | null) {
  if (!result?.ok || !Array.isArray(result.importedFiles)) return [];
  return result.importedFiles.filter((file) => Boolean(String(file.id || "").trim()));
}

function normalizeImportedFileLikeName(value: string | null | undefined) {
  return normalizeImportedLoose(String(value || "").replace(/\.[^.]+$/g, "").trim());
}

function matchesImportedSourceFileName(
  itemFileName: string | null | undefined,
  candidateFileName: string | null | undefined
) {
  const normalizedItem = normalizeImportedFileLikeName(itemFileName);
  const normalizedCandidate = normalizeImportedFileLikeName(candidateFileName);
  if (!normalizedItem || !normalizedCandidate) return true;
  return (
    normalizedItem === normalizedCandidate ||
    normalizedItem.includes(normalizedCandidate) ||
    normalizedCandidate.includes(normalizedItem)
  );
}

function buildSelectedMediaRefsForSave(args: {
  images: NonNullable<Extract<IntelligentImportResponse, { ok: true }>["extractedImagePreview"]>;
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>;
  confirmedDocxImageKeysByItemKey?: Record<string, string[] | undefined>;
  importedFiles?: Array<{
    id: string;
    importBatchId?: string | null;
    originalFileName: string;
  }>;
  stagedMediaAssets?: IntelligentImportStagedMediaAsset[];
}) {
  const selectedMediaRefs: IntelligentImportSelectedMediaRef[] = [];
  const diagnostics: string[] = [];
  const matchedSamples: ImportedSelectedMediaRefDebug["matchedSamples"] = [];
  const unmatchedSamples: ImportedSelectedMediaRefDebug["unmatchedSamples"] = [];

  if (args.items.length === 0) {
    diagnostics.push("Nenhum item elegivel para montar selectedMediaRefs.");
    return {
      debug: {
        matchedSamples,
        selectedMediaRefsCount: 0,
        stagedMediaAssetsAvailable: Array.isArray(args.stagedMediaAssets) ? args.stagedMediaAssets.length : 0,
        stagedMediaAssetSamples: [],
        unmatchedSamples,
      } satisfies ImportedSelectedMediaRefDebug,
      selectedMediaRefs,
      diagnostics,
    };
  }

  if (args.images.length === 0) {
    diagnostics.push("Nenhuma imagem extraida disponivel para photoPlan neste request.");
  }

  const stagedAssets = Array.isArray(args.stagedMediaAssets) ? args.stagedMediaAssets : [];
  const importedFiles = Array.isArray(args.importedFiles) ? args.importedFiles : [];
  const importedFilesByName = new Map<string, Array<(typeof importedFiles)[number]>>();
  for (const importedFile of importedFiles) {
    const key = normalizeImportedFileLikeName(importedFile.originalFileName);
    if (!key) continue;
    const current = importedFilesByName.get(key) ?? [];
    current.push(importedFile);
    importedFilesByName.set(key, current);
  }
  if (stagedAssets.length === 0) {
    diagnostics.push("Nenhum stagedMediaAsset forte de XLSX/XLSM disponivel; photoPlan seguira vazio neste request.");
  }

  let skippedWithoutStableLocationCount = 0;
  let skippedWithoutStagingCount = 0;

  for (const [itemIndex, item] of args.items.entries()) {
    const itemSaveKey = buildImportedSaveKey(item);
    const sourceLocationKey = buildImportedSourceLocationKey(item);
    const sourceFileName = String(extractImportedOriginalSourceFileName(item) || item.sourceFileName || "").trim();
    const sheetScopedKey = extractImportedSheetScopedKey(item);
    const worksheetRowNumber = extractImportedWorksheetRowNumber(item);
    const itemClientItemId = buildReviewedImportedSaveItem(item, itemIndex).clientItemId;
    const confirmedDocxKeys = new Set(
      (args.confirmedDocxImageKeysByItemKey?.[itemSaveKey] ?? [])
        .map((value) => normalizeImportedLoose(value))
        .filter(Boolean)
    );
    if (confirmedDocxKeys.size > 0) {
      const matchingDocxImages = args.images
        .map((image, imageIndex) => ({
          image,
          key: buildStructuredReviewSuggestedImageKey(image, imageIndex),
        }))
        .filter(({ image, key }) => {
          if (normalizeImportedLoose(String(image.source || "")) !== "docx") return false;
          if (!confirmedDocxKeys.has(normalizeImportedLoose(key))) return false;
          return matchesImportedSourceFileName(sourceFileName, image.originalSourceFileName || image.sourceFileName);
        });
      matchingDocxImages.forEach(({ image, key }) => {
        selectedMediaRefs.push({
          associationMode: "weak_confirmed",
          clientItemId: itemClientItemId,
          confirmedByUser: true,
          fileName: image.fileName || null,
          importBatchId: null,
          importFileId: null,
          mediaRefId: key,
          mimeType: image.mimeType || null,
          pageNumber: null,
          sheetScopedKey: null,
          sizeBytes: null,
          sourceFileName: sourceFileName || image.sourceFileName || null,
          sourceImageId: String(image.docxRelId || key).trim() || key,
          sourceKind: "docx_media",
          sourceLocationKey:
            sourceFileName && image.docxBlockKey ? `${sourceFileName}::${image.docxBlockKey}` : image.docxBlockKey || null,
          stagingAssetId: null,
          stagingStorageRef: null,
          worksheetRowNumber: null,
        });
      });
    }
    const relatedImportedFiles =
      importedFilesByName.get(normalizeImportedFileLikeName(sourceFileName)) ??
      (importedFiles.length === 1 ? importedFiles : []);
    const expectedImportBatchIds = new Set(
      relatedImportedFiles.map((file) => String(file.importBatchId || "").trim()).filter(Boolean)
    );
    const expectedImportFileIds = new Set(
      relatedImportedFiles.map((file) => String(file.id || "").trim()).filter(Boolean)
    );

    if (!sourceLocationKey && !sheetScopedKey && worksheetRowNumber == null) {
      skippedWithoutStableLocationCount += 1;
      if (unmatchedSamples.length < 5) {
        unmatchedSamples.push({
          clientItemId: itemClientItemId,
          importBatchId:
            expectedImportBatchIds.size === 1 ? Array.from(expectedImportBatchIds)[0] : null,
          importFileId: expectedImportFileIds.size === 1 ? Array.from(expectedImportFileIds)[0] : null,
          reasons: ["Item sem sourceLocationKey, sheetScopedKey e worksheetRowNumber utilizaveis."],
          sourceFileName: sourceFileName || null,
          sourceLocationKey: sourceLocationKey || null,
          sheetScopedKey: sheetScopedKey || null,
          worksheetRowNumber,
        });
      }
      continue;
    }

    const stagedAsset = stagedAssets
      .map((candidate) => {
        if (candidate.sourceKind !== "xlsx_row_image") {
          return { candidate, score: -1 };
        }

        const candidateImportBatchId = String(candidate.importBatchId || "").trim();
        const candidateImportFileId = String(candidate.importFileId || "").trim();
        const importBatchMatch =
          expectedImportBatchIds.size === 0 ||
          !candidateImportBatchId ||
          expectedImportBatchIds.has(candidateImportBatchId);
        const importFileMatch =
          expectedImportFileIds.size === 0 ||
          !candidateImportFileId ||
          expectedImportFileIds.has(candidateImportFileId);
        if (!importBatchMatch || !importFileMatch) {
          return { candidate, score: -1 };
        }

        const sourceFileMatch = matchesImportedSourceFileName(sourceFileName, candidate.sourceFileName);
        if (sourceFileName && candidate.sourceFileName && !sourceFileMatch) {
          return { candidate, score: -1 };
        }

        let score = 0;
        if (candidateImportBatchId && expectedImportBatchIds.has(candidateImportBatchId)) score += 120;
        if (candidateImportFileId && expectedImportFileIds.has(candidateImportFileId)) score += 120;
        if (sourceFileMatch && sourceFileName && candidate.sourceFileName) score += 60;

        const sourceLocationMatch =
          sourceLocationKey &&
          candidate.sourceLocationKey &&
          normalizeImportedLoose(candidate.sourceLocationKey) === normalizeImportedLoose(sourceLocationKey);
        const sheetScopedKeyMatch =
          sheetScopedKey &&
          candidate.sheetScopedKey &&
          normalizeImportedLoose(candidate.sheetScopedKey) === normalizeImportedLoose(sheetScopedKey);
        const worksheetRowMatch =
          worksheetRowNumber != null &&
          typeof candidate.worksheetRowNumber === "number" &&
          Math.floor(candidate.worksheetRowNumber) === Math.floor(worksheetRowNumber);

        if (sourceLocationMatch) score += 500;
        if (sheetScopedKeyMatch) score += 350;
        if (worksheetRowMatch) score += 250;
        if (!sourceLocationMatch && !sheetScopedKeyMatch && !worksheetRowMatch) {
          return { candidate, score: -1 };
        }

        return { candidate, score };
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.candidate;

    if (!stagedAsset) {
      skippedWithoutStagingCount += 1;
      if (unmatchedSamples.length < 5) {
        unmatchedSamples.push({
          clientItemId: itemClientItemId,
          importBatchId:
            expectedImportBatchIds.size === 1 ? Array.from(expectedImportBatchIds)[0] : null,
          importFileId: expectedImportFileIds.size === 1 ? Array.from(expectedImportFileIds)[0] : null,
          reasons: [
            sourceFileName ? `sourceFileName=${sourceFileName}` : "sourceFileName ausente no item",
            sourceLocationKey ? `sourceLocationKey=${sourceLocationKey}` : "sourceLocationKey ausente",
            sheetScopedKey ? `sheetScopedKey=${sheetScopedKey}` : "sheetScopedKey ausente",
            worksheetRowNumber != null ? `worksheetRowNumber=${worksheetRowNumber}` : "worksheetRowNumber ausente",
          ],
          sourceFileName: sourceFileName || null,
          sourceLocationKey: sourceLocationKey || null,
          sheetScopedKey: sheetScopedKey || null,
          worksheetRowNumber,
        });
      }
      continue;
    }

    selectedMediaRefs.push({
      associationMode: "strong_auto",
      clientItemId: itemClientItemId,
      confirmedByUser: false,
      fileName: stagedAsset.fileName || null,
      importBatchId: stagedAsset.importBatchId || null,
      importFileId: stagedAsset.importFileId || null,
      mediaRefId: stagedAsset.id,
      mimeType: stagedAsset.mimeType || null,
      pageNumber: null,
      sheetScopedKey: stagedAsset.sheetScopedKey || sheetScopedKey || null,
      sizeBytes: stagedAsset.sizeBytes ?? null,
      sourceFileName: sourceFileName || stagedAsset.sourceFileName || null,
      sourceKind: "xlsx_row_image",
      sourceLocationKey: sourceLocationKey || stagedAsset.sourceLocationKey || null,
      stagingAssetId: stagedAsset.id,
      stagingStorageRef: stagedAsset.stagingStorageRef || null,
      worksheetRowNumber:
        typeof stagedAsset.worksheetRowNumber === "number"
          ? Math.floor(stagedAsset.worksheetRowNumber)
          : worksheetRowNumber ?? null,
    });
    if (matchedSamples.length < 5) {
      matchedSamples.push({
        clientItemId: itemClientItemId,
        importBatchId: stagedAsset.importBatchId || null,
        importFileId: stagedAsset.importFileId || null,
        sourceFileName: sourceFileName || stagedAsset.sourceFileName || null,
        sourceLocationKey: sourceLocationKey || stagedAsset.sourceLocationKey || null,
        stagedAssetId: stagedAsset.id,
        worksheetRowNumber:
          typeof stagedAsset.worksheetRowNumber === "number"
            ? Math.floor(stagedAsset.worksheetRowNumber)
            : worksheetRowNumber ?? null,
      });
    }
  }

  if (selectedMediaRefs.length === 0) {
    diagnostics.push("Nenhum stagedMediaAsset forte/estavel foi selecionado para o photoPlan.");
  }
  if (skippedWithoutStableLocationCount > 0) {
    diagnostics.push(
      `${skippedWithoutStableLocationCount} item(ns) sem sourceLocationKey/sheetScopedKey forte ficaram fora do photoPlan.`
    );
  }
  if (skippedWithoutStagingCount > 0) {
    diagnostics.push(
      `${skippedWithoutStagingCount} item(ns) com origem XLSX forte ficaram sem stagingAsset correspondente e nao entraram no photoPlan.`
    );
  }

  return {
    debug: {
      matchedSamples,
      selectedMediaRefsCount: selectedMediaRefs.length,
      stagedMediaAssetsAvailable: stagedAssets.length,
      stagedMediaAssetSamples: stagedAssets.slice(0, 5).map((asset) => ({
        id: asset.id,
        importBatchId: asset.importBatchId || null,
        importFileId: asset.importFileId || null,
        sourceFileName: asset.sourceFileName || null,
        sourceLocationKey: asset.sourceLocationKey || null,
        sheetScopedKey: asset.sheetScopedKey || null,
        worksheetRowNumber:
          typeof asset.worksheetRowNumber === "number" ? Math.floor(asset.worksheetRowNumber) : null,
      })),
      unmatchedSamples,
    } satisfies ImportedSelectedMediaRefDebug,
    selectedMediaRefs,
    diagnostics,
  };
}

type ImportedDestination = "pool" | "acessorios" | "quimicos" | "outros";
type ImportedCatalogCategory = "acessorios" | "quimicos" | "outros";

function matchImportedDestinationLabel(value: string | null | undefined): ImportedDestination | null {
  const normalized = normalizeImportedLoose(value);
  if (!normalized) return null;

  if (/(^|\s)(pool|piscinas|piscina)(\s|$)/.test(normalized)) return "pool";
  if (/(^|\s)(acessorios|acessorio)(\s|$)/.test(normalized)) return "acessorios";
  if (/(^|\s)(quimicos|quimico)(\s|$)/.test(normalized)) return "quimicos";
  if (/(^|\s)(outros|outro|diversos)(\s|$)/.test(normalized)) return "outros";

  return null;
}

function resolveImportedExplicitDestination(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
): ImportedDestination | null {
  const explicitCandidates = [
    extractMetadataValue(item, [
      "__resolved_destination",
      "reviewed_category",
      "destino",
      "categoryhint",
      "category_hint",
      "explicit_category",
      "explicit_category_name",
    ]),
    extractImportedSourceCategory(item),
  ];

  for (const candidate of explicitCandidates) {
    const matched = matchImportedDestinationLabel(candidate);
    if (matched) return matched;
  }

  return null;
}

function getStructuredReviewCategoryLabel(category: StructuredReviewCategory) {
  const labels: Record<StructuredReviewCategory, string> = {
    pool: "Piscina",
    quimicos: "Quimico",
    acessorios: "Acessorio",
    outros: "Outro",
  };
  return labels[category];
}

function formatStructuredReviewPriceLabel(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const priceCents = extractImportedCatalogPriceCents(item);
  if (priceCents == null) return "";
  const renderedLabel = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(priceCents / 100);
  const explicitPrice = resolveExplicitImportedPriceReais(item);
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search || "");
    if (params.get("debugParser") === "true") {
      console.debug("[reviewPriceResolution]", {
        title: item.title,
        sku: resolveImportedCatalogSku(item),
        explicitPriceSource: explicitPrice?.source || "",
        explicitPriceValue: explicitPrice?.value || "",
        parsedReais: explicitPrice?.parsedReais ?? null,
        resolvedPriceCents: priceCents,
        fallbackHeuristicUsed: !explicitPrice,
        renderedLabel,
      });
    }
  }
  return renderedLabel;
}

function buildStructuredReviewOriginLabel(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const preferredSheetName = String(extractImportedSourceSheetName(item) || "").trim();
  const preferredWorksheetRowNumber = extractImportedWorksheetRowNumber(item);
  if (preferredSheetName && preferredWorksheetRowNumber != null) {
    return `${preferredSheetName}, linha ${preferredWorksheetRowNumber}`;
  }

  const parts = [
    item.sourceFileName,
    extractImportedSourceSheetName(item),
    extractImportedSourceCategory(item),
    extractImportedSourceSubcategory(item),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return parts.join(" • ");
}

function parseImportedCommaSeparatedMetadata(value: string | null | undefined) {
  return String(value || "")
    .split(",")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
}

function buildStructuredReviewIgnoreReasons(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  duplicateReason?: string | null
) {
  if (duplicateReason) return [duplicateReason];

  const reasons: string[] = [];
  const reviewSignals = parseImportedCommaSeparatedMetadata(
    extractMetadataValue(item, ["source_review_signals", "review_reasons", "review_reason"])
  );
  const missingPrice = extractMetadataValue(item, ["missing_price"]);
  const missingSku = extractMetadataValue(item, ["missing_sku"]);
  const genericTitle = extractMetadataValue(item, ["generic_title"]);
  const weakCandidate = extractMetadataValue(item, ["weak_candidate"]);
  const destination = resolveImportedExplicitDestination(item) || inferImportedDestination(item);
  const hasStrongSuspicionSignal = reviewSignals.some(
    (signal) => signal.includes("generic_name_signal") || signal.includes("suspect")
  );

  if (hasStrongSuspicionSignal) {
    reasons.push("Nome genérico e marcado como suspeito na origem.");
  } else if (
    reviewSignals.some((signal) => signal.includes("manual_review") || signal.includes("weak_source_signal"))
  ) {
    reasons.push("Marcado para revisão na origem.");
  }

  if (["true", "1", "sim", "yes"].includes(normalizeImportedLoose(missingPrice))) {
    reasons.push("Preco nao informado.");
  }
  const shouldSuppressMissingSkuReason = destination === "pool" && hasStrongSuspicionSignal;
  if (
    !shouldSuppressMissingSkuReason &&
    ["true", "1", "sim", "yes"].includes(normalizeImportedLoose(missingSku))
  ) {
    reasons.push("SKU nao informado.");
  }
  if (
    reasons.length === 0 &&
    (["true", "1", "sim", "yes"].includes(normalizeImportedLoose(genericTitle)) ||
      ["true", "1", "sim", "yes"].includes(normalizeImportedLoose(weakCandidate)))
  ) {
    reasons.push("Nome pouco confiável.");
  }

  return reasons.slice(0, 2);
}

function buildStructuredReviewDescriptionSnippet(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const descriptionState = getImportedDescriptionCanonicalState(item);
  const description = descriptionState.canonicalized
    ? buildImportedCatalogDescription(item) || buildImportedPoolDescription(item) || ""
    : buildImportedCatalogDescription(item) || buildImportedPoolDescription(item) || item.rawText || "";
  const normalized = String(description || "").replace(/\s+/g, " ").trim();
  debugReviewDescriptionResolution(item, normalized);
  if (!normalized) return "";
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function debugReviewDescriptionResolution(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  renderedSnippet: string
) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search || "");
  if (params.get("debugParser") !== "true") return;

  const descriptionState = getImportedDescriptionCanonicalState(item);
  const cleanDescription = readImportedMetadataValue(item, ["clean_description", "cleanDescription"]) || "";
  const sanitizedDescription = sanitizeImportedDescriptionText(String(cleanDescription || ""), item) || "";
  const missingName = String(
    readImportedMetadataValue(item, ["missing_name", "missingName"]) || ""
  ).trim();
  const selectedSource = descriptionState.canonicalized
    ? "clean_description"
    : cleanDescription
      ? "clean_description_legacy"
      : item.rawText
        ? "rawText_legacy"
        : "empty";

  console.debug("[reviewDescriptionResolution]", {
    title: item.title,
    sku: resolveImportedCatalogSku(item),
    missingName,
    canonicalized: descriptionState.canonicalized,
    cleanDescriptionStatus: descriptionState.status,
    cleanDescriptionPreview: String(cleanDescription || "").slice(0, 180),
    importedDescriptionPreview: String(item.rawText || "").slice(0, 180),
    sanitizedDescriptionPreview: String(sanitizedDescription || "").slice(0, 180),
    selectedSource,
    renderedSnippetPreview: String(renderedSnippet || "").slice(0, 180),
    hiddenByCondition: !String(renderedSnippet || "").trim(),
  });
}

function buildStructuredReviewDisplayName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  category: StructuredReviewCategory
) {
  if (category === "pool") {
    return buildImportedPoolName(item);
  }
  return buildImportedCatalogName(item);
}

function getStructuredReviewSignalList(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  return parseImportedCommaSeparatedMetadata(
    extractMetadataValue(item, ["source_review_signals"])
  );
}
function hasStructuredReviewFlag(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  keys: string[]
) {
  return ["true", "1", "sim", "yes"].includes(
    normalizeImportedLoose(extractMetadataValue(item, keys))
  );
}
function isStructuredCandidateCompleteForAutoSelection(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const destination = resolveImportedExplicitDestination(item) || inferImportedDestination(item);
  const hasName = Boolean(String(buildStructuredReviewDisplayName(item, resolveImportedDestination(item)) || "").trim());
  const hasStrongOrigin = Boolean(
    extractImportedSheetScopedKey(item) ||
      buildImportedSourceLocationKey(item) ||
      (extractImportedSourceSheetName(item) && extractImportedWorksheetRowNumber(item) != null)
  );
  const hasMissingPrice = hasStructuredReviewFlag(item, ["missing_price"]);
  const hasMissingSku = hasStructuredReviewFlag(item, ["missing_sku"]);
  const hasGenericTitle = hasStructuredReviewFlag(item, ["generic_title"]);
  const hasWeakCandidate = hasStructuredReviewFlag(item, ["weak_candidate"]);
  const hasSku = Boolean(String(resolveImportedCatalogSku(item) || "").trim());
  const hasPrice = Boolean(formatStructuredReviewPriceLabel(item));

  if (!hasName || !hasStrongOrigin || hasGenericTitle || hasWeakCandidate || hasMissingPrice) {
    return false;
  }
  if (destination !== "pool" && (!hasSku || !hasPrice || hasMissingSku)) {
    return false;
  }
  return true;
}
function hasIsolatedManualReviewSignal(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const signals = getStructuredReviewSignalList(item);
  if (signals.length === 0) return false;
  return signals.every((signal) => isManualReviewSignal(signal));
}
function isSafeStructuredManualReviewAutoApproval(args: {
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
  photoResolution: StructuredReviewPhotoResolution;
  duplicateBlocked: boolean;
}) {
  if (args.duplicateBlocked) {
    return false;
  }
  if (args.photoResolution.state === "ambiguous") {
    return false;
  }
  return (
    hasIsolatedManualReviewSignal(args.item) &&
    isStructuredCandidateCompleteForAutoSelection(args.item)
  );
}
function shouldStartStructuredImportCandidateSelected(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  photoResolution: StructuredReviewPhotoResolution
) {
  if (
    isSafeStructuredManualReviewAutoApproval({
      item,
      photoResolution,
      duplicateBlocked: false,
    })
  ) {
    return true;
  }
  if (photoResolution.state === "ambiguous") {
    return false;
  }
  const reviewSelectionDefault = extractMetadataValue(item, ["review_selection_default"]);
  if (normalizeImportedLoose(reviewSelectionDefault) === "unselected") {
    return false;
  }
  const reviewRequired = extractMetadataValue(item, ["review_required", "weak_candidate"]);
  if (["true", "1", "sim", "yes"].includes(normalizeImportedLoose(reviewRequired))) {
    return false;
  }
  return true;
}

function buildEditableStructuredImportCandidates(
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>,
  images: VisualReviewExtractedImagePreview[],
  stagedMediaAssets: IntelligentImportStagedMediaAsset[]
) {
  return items.map((item, index) => {
    const finalCategory = resolveImportedDestination(item);
    const photoResolution = resolveStructuredReviewPhotoResolution({
      item,
      images,
      stagedMediaAssets,
      confirmedDocxImageKeys: [],
    });
    return {
      id: `${buildImportedSaveKey(item)}::review::${index}`,
      sourceItem: item,
      selected: shouldStartStructuredImportCandidateSelected(item, photoResolution),
      manuallyIgnored: false,
      humanReviewConfirmed: false,
      finalCategory,
      initialCategory: finalCategory,
    } satisfies EditableStructuredImportCandidate;
  });
}

const STRUCTURED_SELECTION_DEBUG_SKUS = new Set(["QMC-081", "QMC-090", "QMC-064"]);

function buildStructuredSelectionDebugSnapshot(args: {
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
  photoResolution: StructuredReviewPhotoResolution;
  selected: boolean | null;
}) {
  const sku = String(resolveImportedCatalogSku(args.item) || "").trim();
  if (!STRUCTURED_SELECTION_DEBUG_SKUS.has(sku.toUpperCase())) return null;

  const sourceReviewSignals = getStructuredReviewSignalList(args.item);
  return {
    sku,
    dedupKey: String((args.item as { dedupKey?: string | null }).dedupKey || "").trim() || null,
    isDuplicate: Boolean((args.item as { isDuplicate?: boolean }).isDuplicate),
    review_required: extractMetadataValue(args.item, ["review_required"]) || "",
    weak_candidate: extractMetadataValue(args.item, ["weak_candidate"]) || "",
    manual_review_signal: sourceReviewSignals.some((signal) => isManualReviewSignal(signal)),
    review_selection_default: extractMetadataValue(args.item, ["review_selection_default"]) || "",
    source_review_signals: sourceReviewSignals,
    source_sheet_name: extractImportedSourceSheetName(args.item) || "",
    source_sheet_scoped_key: String(args.item.metadata?.source_sheet_scoped_key || "").trim(),
    sheet_scoped_key: String(args.item.metadata?.sheet_scoped_key || "").trim(),
    photoResolutionState: args.photoResolution.state,
    isStructuredCandidateCompleteForAutoSelection:
      isStructuredCandidateCompleteForAutoSelection(args.item),
    hasIsolatedManualReviewSignal: hasIsolatedManualReviewSignal(args.item),
    shouldStartStructuredImportCandidateSelected:
      args.photoResolution.state === "ambiguous"
        ? false
        : shouldStartStructuredImportCandidateSelected(args.item, args.photoResolution),
    selected: args.selected,
  };
}

function extractStructuredSelectionRawCategoryValue(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  const metadata = item.metadata && typeof item.metadata === "object"
    ? (item.metadata as Record<string, unknown>)
    : null;
  const explicitSkuValues = [
    "sku" in item ? (item as { sku?: unknown }).sku : undefined,
    "code" in item ? (item as { code?: unknown }).code : undefined,
    metadata?.reviewed_sku,
    metadata?.sku,
    metadata?.codigo,
    metadata?.["código"],
    metadata?.["cÃ³digo"],
    metadata?.["cÃƒÂ³digo"],
  ];
  const hasExplicitSkuField = explicitSkuValues.some((value) => value != null);
  if (hasExplicitSkuField) {
    const explicitSku = explicitSkuValues.find((value) => String(value || "").trim()) ?? "";
    return normalizeImportedSkuPlaceholder(String(explicitSku || "").slice(0, 120));
  }
  const normalizedImportedSku = normalizeImportedSkuPlaceholder(
    (
      extractMetadataValue(item, ["sku", "codigo", "cÃ³digo"]) ||
      extractImportedLabeledValue(source, ["SKU", "CÃ³digo", "Codigo"]) ||
      ""
    ).slice(0, 120)
  );
  return normalizedImportedSku;
  return (
    extractImportedLabeledValue(source, [
      "Categoria Final",
      "Categoria",
      "Category Final",
      "Category",
    ]) || ""
  ).trim();
}

function classifyStructuredSelectionReason(args: {
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
  photoResolution: StructuredReviewPhotoResolution;
}) {
  if (
    isSafeStructuredManualReviewAutoApproval({
      item: args.item,
      photoResolution: args.photoResolution,
      duplicateBlocked: false,
    })
  ) {
    return "isolated_manual_review_auto_approved";
  }
  if (args.photoResolution.state === "ambiguous") {
    return "ambiguous_photo";
  }
  const reviewSelectionDefault = extractMetadataValue(args.item, ["review_selection_default"]);
  if (normalizeImportedLoose(reviewSelectionDefault) === "unselected") {
    return "review_selection_default_unselected";
  }
  const reviewRequired = extractMetadataValue(args.item, ["review_required", "weak_candidate"]);
  if (["true", "1", "sim", "yes"].includes(normalizeImportedLoose(reviewRequired))) {
    return "review_required_or_weak_candidate";
  }
  return "selected_by_default";
}

function shouldEmitStructuredSelectionRuntimeDebug(
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>
) {
  return shouldEnableParserDebugFromLocation() && items.length > 0 && items.length <= 30;
}

function buildStructuredSelectionRuntimeDebugEntry(args: {
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
  index: number;
  photoResolution: StructuredReviewPhotoResolution;
  selected: boolean | null;
  finalCategory: StructuredReviewCategory;
  phase: "before" | "after";
}) {
  const finalDisplayName = buildStructuredReviewDisplayName(args.item, args.finalCategory);
  const explicitDestination = resolveImportedExplicitDestination(args.item);
  const inferredDestination = inferImportedDestination(args.item);
  const computedSelection = shouldStartStructuredImportCandidateSelected(args.item, args.photoResolution);
  const sourceReviewSignals = getStructuredReviewSignalList(args.item);

  return {
    phase: args.phase,
    index: args.index,
    originalTitle: String(args.item.title || "").trim(),
    finalCardName: String(finalDisplayName || "").trim(),
    sku: String(resolveImportedCatalogSku(args.item) || "").trim(),
    sourceFileName: String(args.item.sourceFileName || "").trim(),
    sheetName: String(extractImportedSourceSheetName(args.item) || "").trim(),
    worksheetRowNumber: extractImportedWorksheetRowNumber(args.item),
    sheetScopedKey: String(extractImportedSheetScopedKey(args.item) || "").trim(),
    rawCategoryValue: extractStructuredSelectionRawCategoryValue(args.item),
    metadataCategoria: String(args.item.metadata?.categoria || "").trim(),
    metadataCategory: String(args.item.metadata?.category || "").trim(),
    metadataCategoryName: String(args.item.metadata?.category_name || "").trim(),
    metadataSourceCategory: String(args.item.metadata?.source_category || "").trim(),
    metadataSourceSubcategory: String(args.item.metadata?.source_subcategory || "").trim(),
    explicitDestination,
    inferredDestination,
    finalCategory: args.finalCategory,
    finalDestination: args.finalCategory,
    finalType: args.finalCategory === "pool" ? "pool" : "catalog_item",
    sourceType: String(args.item.type || "").trim(),
    reviewRequired: extractMetadataValue(args.item, ["review_required"]) || "",
    weakCandidate: extractMetadataValue(args.item, ["weak_candidate"]) || "",
    reviewSelectionDefault: extractMetadataValue(args.item, ["review_selection_default"]) || "",
    sourceReviewSignals,
    photoState: args.photoResolution.state,
    duplicateSource: Boolean((args.item as { isDuplicate?: boolean }).isDuplicate),
    duplicateOf: String((args.item as { duplicateOf?: string | null }).duplicateOf || "").trim() || null,
    duplicateBlocked: false,
    hasIsolatedManualReviewSignal: hasIsolatedManualReviewSignal(args.item),
    isStructuredCandidateCompleteForAutoSelection:
      isStructuredCandidateCompleteForAutoSelection(args.item),
    shouldStartStructuredImportCandidateSelected: computedSelection,
    selectionReason: classifyStructuredSelectionReason({
      item: args.item,
      photoResolution: args.photoResolution,
    }),
    selected: args.selected,
  };
}

function emitStructuredSelectionRuntimeDebug(args: {
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>;
  builtCandidates: EditableStructuredImportCandidate[];
  images: VisualReviewExtractedImagePreview[];
  stagedMediaAssets: IntelligentImportStagedMediaAsset[];
}) {
  if (!shouldEmitStructuredSelectionRuntimeDebug(args.items)) {
    return;
  }

  const before = args.items.map((item, index) => {
    const photoResolution = resolveStructuredReviewPhotoResolution({
      item,
      images: args.images,
      stagedMediaAssets: args.stagedMediaAssets,
      confirmedDocxImageKeys: [],
    });
    const finalCategory = resolveImportedDestination(item);
    return buildStructuredSelectionRuntimeDebugEntry({
      item,
      index,
      photoResolution,
      selected: null,
      finalCategory,
      phase: "before",
    });
  });

  const after = args.builtCandidates.map((candidate, index) => {
    const photoResolution = resolveStructuredReviewPhotoResolution({
      item: candidate.sourceItem,
      images: args.images,
      stagedMediaAssets: args.stagedMediaAssets,
      confirmedDocxImageKeys: [],
    });
    return buildStructuredSelectionRuntimeDebugEntry({
      item: candidate.sourceItem,
      index,
      photoResolution,
      selected: candidate.selected,
      finalCategory: candidate.finalCategory,
      phase: "after",
    });
  });

  const selectedCount = after.filter((entry) => entry.selected === true).length;
  const selectionReasonCounts = after.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.selectionReason] = (acc[entry.selectionReason] || 0) + 1;
    return acc;
  }, {});
  const finalDestinationCounts = after.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.finalDestination] = (acc[entry.finalDestination] || 0) + 1;
    return acc;
  }, {});
  const ignoredItems = after
    .filter((entry) => entry.selected !== true)
    .map((entry) => ({
      sku: entry.sku,
      title: entry.originalTitle,
      selectionReason: entry.selectionReason,
      finalDestination: entry.finalDestination,
    }));
  const summary = {
    total: after.length,
    selected: selectedCount,
    ignored: Math.max(0, after.length - selectedCount),
    bySelectionReason: selectionReasonCounts,
    byFinalDestination: finalDestinationCounts,
    ignoredItems,
  };
  const runtimeDebugPayload = {
    before,
    after,
    summary,
  };
  const debugWindow = window as typeof window & {
    __zionP8StructuredSelectionRuntimeDebug?: typeof runtimeDebugPayload;
  };
  debugWindow.__zionP8StructuredSelectionRuntimeDebug = runtimeDebugPayload;

  console.table(
    [...before, ...after].map((entry) => ({
      phase: entry.phase,
      index: entry.index,
      sku: entry.sku,
      originalTitle: entry.originalTitle,
      finalCardName: entry.finalCardName,
      finalDestination: entry.finalDestination,
      reviewSelectionDefault: entry.reviewSelectionDefault,
      reviewRequired: entry.reviewRequired,
      weakCandidate: entry.weakCandidate,
      photoState: entry.photoState,
      selectionReason: entry.selectionReason,
      selected: entry.selected,
      sheetName: entry.sheetName,
      worksheetRowNumber: entry.worksheetRowNumber,
    }))
  );
  console.info("[ZION P8 structured-selection-runtime]", runtimeDebugPayload);
}

function buildStructuredReviewedCatalogDescription(draft: StructuredCandidateDraft) {
  const parts = [
    draft.name.trim(),
    draft.sku.trim() ? `SKU: ${draft.sku.trim()}` : "",
    draft.finalCategory ? `Categoria: ${getStructuredReviewCategoryLabel(draft.finalCategory)}` : "",
    draft.price.trim() ? `Preco: ${draft.price.trim()}` : "",
    draft.stock.trim() ? `Estoque: ${draft.stock.trim()}` : "",
    draft.brand.trim() ? `Marca: ${draft.brand.trim()}` : "",
    draft.modelLine.trim() ? `Linha/Modelo: ${draft.modelLine.trim()}` : "",
    draft.unit.trim() ? `Unidade: ${draft.unit.trim()}` : "",
    draft.variantSize.trim() ? `Tamanho/Variacao: ${draft.variantSize.trim()}` : "",
    draft.material.trim() ? `Material: ${draft.material.trim()}` : "",
    draft.shape.trim() ? `Formato: ${draft.shape.trim()}` : "",
    draft.color.trim() ? `Cor: ${draft.color.trim()}` : "",
    draft.width.trim() ? `Largura: ${draft.width.trim()}` : "",
    draft.height.trim() ? `Altura: ${draft.height.trim()}` : "",
    draft.length.trim() ? `Comprimento: ${draft.length.trim()}` : "",
    draft.depth.trim() ? `Profundidade: ${draft.depth.trim()}` : "",
    draft.weight.trim() ? `Peso: ${draft.weight.trim()}` : "",
    draft.application.trim() ? `Aplicacao/Uso recomendado: ${draft.application.trim()}` : "",
    draft.technicalNotes.trim() ? `Observacoes tecnicas: ${draft.technicalNotes.trim()}` : "",
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return parts.join("\n").trim();
}

function buildStructuredReviewedPoolDescription(draft: StructuredCandidateDraft) {
  const parts = [
    draft.name.trim(),
    draft.material.trim() ? `Material: ${draft.material.trim()}` : "",
    draft.shape.trim() ? `Formato: ${draft.shape.trim()}` : "",
    draft.width.trim() ? `Largura: ${draft.width.trim()}` : "",
    draft.length.trim() ? `Comprimento: ${draft.length.trim()}` : "",
    draft.depth.trim() ? `Profundidade: ${draft.depth.trim()}` : "",
    draft.price.trim() ? `Preco: ${draft.price.trim()}` : "",
    draft.stock.trim() ? `Estoque: ${draft.stock.trim()}` : "",
    draft.brand.trim() ? `Marca: ${draft.brand.trim()}` : "",
    draft.color.trim() ? `Cor: ${draft.color.trim()}` : "",
    draft.finishLine.trim() ? `Acabamento/Linha: ${draft.finishLine.trim()}` : "",
    draft.includedItems.trim() ? `Itens inclusos: ${draft.includedItems.trim()}` : "",
    draft.installationNotes.trim() ? `Observacoes de instalacao: ${draft.installationNotes.trim()}` : "",
    draft.application.trim() ? `Aplicacao/Uso recomendado: ${draft.application.trim()}` : "",
    draft.technicalNotes.trim() ? `Observacoes tecnicas: ${draft.technicalNotes.trim()}` : "",
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return dedupeDescriptionLines(parts).join("\n").trim();
}

function buildStructuredDraftRawText(
  sourceItem: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  draft: StructuredCandidateDraft
) {
  const lines = [
    draft.name.trim() || sourceItem.title || "",
    draft.sku.trim() ? `SKU: ${draft.sku.trim()}` : "",
    draft.price.trim() ? `Preco: ${draft.price.trim()}` : "",
    draft.stock.trim() ? `Estoque: ${draft.stock.trim()}` : "",
    draft.brand.trim() ? `Marca: ${draft.brand.trim()}` : "",
    draft.modelLine.trim() ? `Linha: ${draft.modelLine.trim()}` : "",
    draft.unit.trim() ? `Unidade: ${draft.unit.trim()}` : "",
    draft.variantSize.trim() ? `Tamanho: ${draft.variantSize.trim()}` : "",
    draft.material.trim() ? `Material: ${draft.material.trim()}` : "",
    draft.shape.trim() ? `Formato: ${draft.shape.trim()}` : "",
    draft.color.trim() ? `Cor: ${draft.color.trim()}` : "",
    draft.width.trim() ? `Largura: ${draft.width.trim()}` : "",
    draft.height.trim() ? `Altura: ${draft.height.trim()}` : "",
    draft.length.trim() ? `Comprimento: ${draft.length.trim()}` : "",
    draft.depth.trim() ? `Profundidade: ${draft.depth.trim()}` : "",
    draft.weight.trim() ? `Peso: ${draft.weight.trim()}` : "",
    draft.application.trim() ? `Aplicacao: ${draft.application.trim()}` : "",
    draft.technicalNotes.trim() ? `Observacoes: ${draft.technicalNotes.trim()}` : "",
    draft.description.trim(),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return lines.join("\n").trim() || sourceItem.rawText || sourceItem.title;
}

function normalizeStructuredDraftComparableValue(value: string | boolean) {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildStructuredReviewedDescription(
  candidate: EditableStructuredImportCandidate,
  draft: StructuredCandidateDraft
) {
  const finalCategory = draft.finalCategory || candidate.finalCategory;
  const normalizedDraftSku = normalizeImportedSkuPlaceholder(draft.sku.trim());
  const baselineDraft = buildStructuredCandidateDraft(candidate.sourceItem, finalCategory);
  const userEditedDescription = Boolean(draft.descriptionEdited);
  const structuredFieldsChanged = [
    draft.name !== baselineDraft.name,
    draft.sku !== baselineDraft.sku,
    draft.price !== baselineDraft.price,
    draft.stock !== baselineDraft.stock,
    draft.brand !== baselineDraft.brand,
    draft.material !== baselineDraft.material,
    draft.shape !== baselineDraft.shape,
    draft.color !== baselineDraft.color,
    draft.finishLine !== baselineDraft.finishLine,
    draft.width !== baselineDraft.width,
    draft.height !== baselineDraft.height,
    draft.length !== baselineDraft.length,
    draft.depth !== baselineDraft.depth,
    draft.unit !== baselineDraft.unit,
    draft.variantSize !== baselineDraft.variantSize,
    draft.weight !== baselineDraft.weight,
    draft.modelLine !== baselineDraft.modelLine,
    draft.includedItems !== baselineDraft.includedItems,
    draft.installationNotes !== baselineDraft.installationNotes,
    draft.application !== baselineDraft.application,
    draft.technicalNotes !== baselineDraft.technicalNotes,
    draft.isActive !== baselineDraft.isActive,
    draft.trackStock !== baselineDraft.trackStock,
    finalCategory !== candidate.initialCategory,
  ].some(Boolean);
  const inheritedDescriptionUnchanged =
    normalizeStructuredDraftComparableValue(draft.description) ===
    normalizeStructuredDraftComparableValue(baselineDraft.description);

  if (!userEditedDescription && !structuredFieldsChanged) {
    return {
      finalDescription: String(
        finalCategory === "pool"
          ? buildImportedPoolDescription(candidate.sourceItem)
          : buildImportedCatalogDescription(candidate.sourceItem)
      ).trim(),
      userEditedDescription,
      structuredFieldsChanged,
    };
  }

  if (userEditedDescription) {
    return {
      finalDescription: String(draft.description || "").trim(),
      userEditedDescription,
      structuredFieldsChanged,
    };
  }

  if (!inheritedDescriptionUnchanged && !structuredFieldsChanged) {
    return {
      finalDescription: String(draft.description || "").trim(),
      userEditedDescription,
      structuredFieldsChanged,
    };
  }

  return {
    finalDescription: String(
      finalCategory === "pool"
        ? buildStructuredReviewedPoolDescription(draft)
        : buildStructuredReviewedCatalogDescription(draft)
    ).trim(),
    userEditedDescription,
    structuredFieldsChanged,
  };
}

function parseStructuredReviewedBoolean(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  keys: string[],
  fallback: boolean
) {
  const rawValue = extractMetadataValue(item, keys);
  const normalized = normalizeImportedLoose(rawValue);
  if (!normalized) return fallback;
  if (["true", "1", "sim", "yes", "ativo"].includes(normalized)) return true;
  if (["false", "0", "nao", "não", "no", "inativo"].includes(normalized)) return false;
  return fallback;
}

function buildStructuredReviewedSourceItem(
  candidate: EditableStructuredImportCandidate,
  draft?: StructuredCandidateDraft | null
) {
  const reviewConfirmedByUser = candidate.humanReviewConfirmed;
  const reviewConfirmationState = reviewConfirmedByUser ? "confirmed" : "pending";
  const reviewConfirmationSource = reviewConfirmedByUser ? "structured_selection_toggle" : "";
  if (!draft) {
    const normalizedSourceSku = normalizeImportedSkuPlaceholder(resolveImportedCatalogSku(candidate.sourceItem));
    const sourceItemWithNormalizedSku = {
      ...candidate.sourceItem,
      sku: normalizedSourceSku,
      code: normalizedSourceSku,
    };
    return {
      ...sourceItemWithNormalizedSku,
      dedupKey: buildImportedSaveKey(sourceItemWithNormalizedSku),
      metadata: {
        ...(candidate.sourceItem.metadata ?? {}),
        __resolved_destination: candidate.finalCategory,
        sku: normalizedSourceSku,
        codigo: normalizedSourceSku,
        "código": normalizedSourceSku,
        reviewed_sku: normalizedSourceSku,
        dedup_key: buildImportedSaveKey(sourceItemWithNormalizedSku),
        human_review_confirmed: reviewConfirmedByUser ? "true" : "false",
        review_confirmed_by_user: reviewConfirmedByUser ? "true" : "false",
        review_confirmation_state: reviewConfirmationState,
        review_confirmation_source: reviewConfirmationSource,
      },
    };
  }

  const priceValue = parseImportedDecimal(draft.price);
  const stockValue = parseImportedDecimal(draft.stock);
  const widthValue = parseImportedDecimal(draft.width);
  const heightValue = parseImportedDecimal(draft.height);
  const lengthValue = parseImportedDecimal(draft.length);
  const depthValue = parseImportedDecimal(draft.depth);
  const weightValue = parseImportedDecimal(draft.weight);
  const finalCategory = draft.finalCategory || candidate.finalCategory;
  const normalizedDraftSku = normalizeImportedSkuPlaceholder(draft.sku.trim());
  const { finalDescription, userEditedDescription, structuredFieldsChanged } =
    buildStructuredReviewedDescription(candidate, draft);
  const originalSourceCategory = resolveImportedDestination(candidate.sourceItem);
  const originalSourceDescription =
    originalSourceCategory === "pool"
      ? buildImportedPoolDescription(candidate.sourceItem)
      : buildImportedCatalogDescription(candidate.sourceItem);
  const mergedMetadata = {
    ...(candidate.sourceItem.metadata ?? {}),
    __resolved_destination: finalCategory,
    destination: finalCategory,
    categoria: finalCategory,
    category: finalCategory,
    category_name: finalCategory,
    title: draft.name.trim(),
    nome: draft.name.trim(),
    productName: draft.name.trim(),
    sku: normalizedDraftSku,
    codigo: normalizedDraftSku,
    "código": normalizedDraftSku,
    price: draft.price.trim(),
    preco: draft.price.trim(),
    "preço": draft.price.trim(),
    price_cents: priceValue != null ? String(Math.round(priceValue * 100)) : "",
    stock_quantity: stockValue != null ? String(Math.max(0, Math.round(stockValue))) : "",
    stock: stockValue != null ? String(Math.max(0, Math.round(stockValue))) : "",
    estoque: stockValue != null ? String(Math.max(0, Math.round(stockValue))) : "",
    quantity: stockValue != null ? String(Math.max(0, Math.round(stockValue))) : "",
    description: finalDescription,
    descricao: finalDescription,
    "descrição": finalDescription,
    clean_description: finalDescription,
    reviewed_description: finalDescription,
    reviewed_name: draft.name.trim(),
    reviewed_sku: normalizedDraftSku,
    reviewed_price: draft.price.trim(),
    reviewed_stock_quantity: stockValue != null ? String(Math.max(0, Math.round(stockValue))) : "",
    reviewed_category: finalCategory,
    human_review_confirmed: reviewConfirmedByUser ? "true" : "false",
    review_confirmed_by_user: reviewConfirmedByUser ? "true" : "false",
    review_confirmation_state: reviewConfirmationState,
    review_confirmation_source: reviewConfirmationSource,
    reviewed_description_mode: userEditedDescription
      ? "manual"
      : structuredFieldsChanged
        ? "regenerated"
        : "preserved",
    imported_title_original:
      extractMetadataValue(candidate.sourceItem, ["imported_title_original", "imported_title"]) ||
      buildImportedCatalogName(candidate.sourceItem),
    imported_clean_description_original:
      extractMetadataValue(candidate.sourceItem, [
        "imported_clean_description_original",
        "clean_description",
        "description",
        "descricao",
      ]) || String(originalSourceDescription || "").trim(),
    brand: draft.brand.trim(),
    marca: draft.brand.trim(),
    material: draft.material.trim(),
    shape: draft.shape.trim(),
    formato: draft.shape.trim(),
    color: draft.color.trim(),
    cor: draft.color.trim(),
    line: draft.finishLine.trim() || draft.modelLine.trim(),
    linha: draft.finishLine.trim() || draft.modelLine.trim(),
    model: draft.modelLine.trim(),
    modelo: draft.modelLine.trim(),
    unit: draft.unit.trim(),
    unidade: draft.unit.trim(),
    size: draft.variantSize.trim(),
    tamanho: draft.variantSize.trim(),
    variation: draft.variantSize.trim(),
    variacao: draft.variantSize.trim(),
    "variação": draft.variantSize.trim(),
    weight: draft.weight.trim(),
    peso: draft.weight.trim(),
    width: draft.width.trim(),
    largura: draft.width.trim(),
    height: draft.height.trim(),
    altura: draft.height.trim(),
    length: draft.length.trim(),
    comprimento: draft.length.trim(),
    depth: draft.depth.trim(),
    profundidade: draft.depth.trim(),
    dimensions:
      widthValue != null || lengthValue != null
        ? [draft.width.trim(), draft.length.trim(), draft.depth.trim()].filter(Boolean).join(" x ")
        : "",
    application: draft.application.trim(),
    aplicacao: draft.application.trim(),
    "aplicação": draft.application.trim(),
    usage: draft.application.trim(),
    uso: draft.application.trim(),
    technical_notes: draft.technicalNotes.trim(),
    notes: draft.technicalNotes.trim(),
    observacoes: draft.technicalNotes.trim(),
    "observações": draft.technicalNotes.trim(),
    included_items: draft.includedItems.trim(),
    itens_inclusos: draft.includedItems.trim(),
    installation_notes: draft.installationNotes.trim(),
    observacoes_instalacao: draft.installationNotes.trim(),
    is_active: draft.isActive ? "true" : "false",
    track_stock: draft.trackStock ? "true" : "false",
    capacity: candidate.sourceItem.metadata?.capacity || "",
    embalagem: candidate.sourceItem.metadata?.embalagem || "",
    packaging: candidate.sourceItem.metadata?.packaging || "",
    source_file_name: candidate.sourceItem.metadata?.source_file_name || candidate.sourceItem.sourceFileName || "",
    source: candidate.sourceItem.metadata?.source || "",
    origem: candidate.sourceItem.metadata?.origem || "",
  } satisfies Record<string, string>;

  const reviewedSourceItem = {
    ...candidate.sourceItem,
    sku: normalizedDraftSku,
    code: normalizedDraftSku,
    title: draft.name.trim() || candidate.sourceItem.title,
    rawText: buildStructuredDraftRawText(candidate.sourceItem, draft),
    metadata: {
      ...mergedMetadata,
    },
  };

  return {
    ...reviewedSourceItem,
    dedupKey: buildImportedSaveKey(reviewedSourceItem),
  };
}

function buildStructuredSelectedReviewedSourceItems(args: {
  candidates: EditableStructuredImportCandidate[];
  drafts: Record<string, StructuredCandidateDraft | undefined>;
  validationByCandidateId: Map<string, StructuredReviewCandidateValidation>;
}) {
  return args.candidates.flatMap((candidate) => {
    if (!candidate.selected) return [];
    const candidateValidation = args.validationByCandidateId.get(candidate.id);
    if (candidateValidation?.duplicateReason) return [];
    return [buildStructuredReviewedSourceItem(candidate, args.drafts[candidate.id])];
  });
}

function buildReviewedImportedSaveItem(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  index: number,
  options?: {
    duplicateBlocked?: boolean;
    photoResolution?: StructuredReviewPhotoResolution;
  }
): IntelligentImportReviewedSaveItem {
  const destination = resolveImportedDestination(item);
  const isPool = destination === "pool";
  const poolMetrics = isPool ? extractImportedPoolMetrics(item) : null;
  const catalogCategory =
    destination === "quimicos" || destination === "acessorios" || destination === "outros"
      ? destination
      : "outros";
  const baseMetadata = isPool
    ? { ...(item.metadata ?? {}), __resolved_destination: destination }
    : buildImportedCatalogMetadata(item, catalogCategory);
  const reviewRequiredByMetadata = ["true", "1", "sim", "yes"].includes(
    normalizeImportedLoose(extractMetadataValue(item, ["review_required", "weak_candidate"]))
  );
  const canAutoApproveManualReview = options?.photoResolution
    ? isSafeStructuredManualReviewAutoApproval({
        item,
        photoResolution: options.photoResolution,
        duplicateBlocked: Boolean(options.duplicateBlocked),
      })
    : false;

  return {
    clientItemId: buildImportedSaveKey(item) || `reviewed-item-${index}`,
    description: (isPool ? buildImportedPoolDescription(item) : buildImportedCatalogDescription(item)) || null,
    destination,
    duplicateBlocked: false,
    isActive: parseStructuredReviewedBoolean(item, ["is_active", "ativo", "vendivel", "vendível"], true),
    metadata: baseMetadata,
    name: isPool ? buildImportedPoolName(item) : buildImportedCatalogName(item),
    poolPayload: isPool
      ? {
          depth_m: poolMetrics?.depth_m ?? null,
          length_m: poolMetrics?.length_m ?? null,
          material: poolMetrics?.material ?? null,
          max_capacity_l: poolMetrics?.max_capacity_l ?? null,
          price: poolMetrics?.price ?? null,
          shape: poolMetrics?.shape ?? null,
          weight_kg: null,
          width_m: poolMetrics?.width_m ?? null,
        }
      : null,
    priceCents: isPool ? null : extractImportedCatalogPriceCents(item),
    reviewRequired: canAutoApproveManualReview ? false : reviewRequiredByMetadata,
    reviewState: "approved",
    selected: true,
    sku: isPool ? "" : resolveImportedCatalogSku(item),
    sourceFileName: item.sourceFileName,
    sourceType: item.type,
    stockQuantity: extractImportedCatalogStockQuantity(item),
    trackStock: parseStructuredReviewedBoolean(
      item,
      ["track_stock", "controlar_estoque", "controlar estoque"],
      true
    ),
  };
}

function formatStructuredDraftPriceValue(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const explicitPrice = String(
    extractMetadataValue(item, ["price", "preco", "preço", "price_label"]) || ""
  ).trim();
  if (explicitPrice) return explicitPrice;

  const priceCents = extractImportedCatalogPriceCents(item);
  if (priceCents == null) return "";
  return (priceCents / 100).toFixed(2);
}

function formatStructuredDraftPriceLabel(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (/^r\$/i.test(trimmed)) return trimmed;
  return `R$ ${trimmed}`;
}

function buildStructuredDraftDescriptionSnippet(value: string) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

function buildStructuredCandidateDraft(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  finalCategory: StructuredReviewCategory
) {
  const metrics = extractImportedPoolMetrics(item);
  const name =
    finalCategory === "pool" ? buildImportedPoolName(item) : buildImportedCatalogName(item);
  const description =
    finalCategory === "pool"
      ? buildImportedPoolDescription(item)
      : buildImportedCatalogDescription(item);
  const stockQuantity = extractImportedCatalogStockQuantity(item);

  return {
    finalCategory,
    confirmedDocxImageKeys: [],
    name,
    sku: String(resolveImportedCatalogSku(item) || "").trim(),
    price: formatStructuredDraftPriceValue(item),
    stock: stockQuantity > 0 ? String(stockQuantity) : "",
    description: description || "",
    descriptionEdited: false,
    isActive: true,
    trackStock: true,
    brand: String(extractMetadataValue(item, ["brand", "marca"]) || "").trim(),
    material: String(extractMetadataValue(item, ["material"]) || "").trim(),
    shape: String(extractMetadataValue(item, ["shape", "formato"]) || "").trim(),
    color: String(extractMetadataValue(item, ["color", "cor"]) || "").trim(),
    finishLine: String(extractMetadataValue(item, ["line", "linha", "finish_line"]) || "").trim(),
    width: metrics.width_m != null ? String(metrics.width_m) : "",
    height: String(extractMetadataValue(item, ["height", "altura"]) || "").trim(),
    length: metrics.length_m != null ? String(metrics.length_m) : "",
    depth: metrics.depth_m != null ? String(metrics.depth_m) : "",
    unit: String(extractMetadataValue(item, ["unit", "unidade"]) || "").trim(),
    variantSize: String(extractMetadataValue(item, ["size", "tamanho", "variacao", "variação"]) || "").trim(),
    weight: String(extractMetadataValue(item, ["weight", "peso", "peso_volume"]) || "").trim(),
    modelLine: String(extractMetadataValue(item, ["model", "modelo", "line", "linha"]) || "").trim(),
    includedItems: String(extractMetadataValue(item, ["included_items", "itens_inclusos"]) || "").trim(),
    installationNotes: String(
      extractMetadataValue(item, ["installation_notes", "observacoes_instalacao", "observações_instalação"]) || ""
    ).trim(),
    application: String(
      extractMetadataValue(item, ["application", "aplicacao", "aplicação", "usage", "uso"]) || ""
    ).trim(),
    technicalNotes: String(
      extractMetadataValue(item, ["technical_notes", "notes", "observacoes", "observações"]) || ""
    ).trim(),
  } satisfies StructuredCandidateDraft;
}

function createEmptyStructuredDuplicateReferenceData(): StructuredDuplicateReferenceData {
  return {
    existingPoolNames: new Set<string>(),
    existingCatalogNames: new Set<string>(),
    existingCatalogSkus: new Set<string>(),
  };
}

function buildStructuredCandidateDuplicateIdentity(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  destination: ImportedDestination,
  normalizedName?: string
) {
  return buildImportDedupIdentity({
    type: destination === "pool" ? "pool" : item.type,
    category: destination,
    title:
      normalizedName ??
      (destination === "pool" ? buildImportedPoolName(item) : buildImportedCatalogName(item)),
    sku: destination === "pool" ? "" : resolveImportedCatalogSku(item),
  });
}

function computeStructuredPreSaveValidation(args: {
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>;
  existingReferences: StructuredDuplicateReferenceData;
}) {
  const seenPoolNames = new Set<string>();
  const seenCatalogSkus = new Set<string>();
  const seenDuplicateIdentities = new Set<string>();
  const validItems: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview> = [];
  const blockedItems: StructuredPreSaveValidationItem[] = [];
  const evaluatedItems: StructuredPreSaveValidationItem[] = [];

  for (const item of args.items) {
    const destination = resolveImportedDestination(item);
    const normalizedName = normalizeImportDedupText(
      destination === "pool" ? buildImportedPoolName(item) : buildImportedCatalogName(item)
    );
    const normalizedSku = normalizeImportDedupSku(resolveImportedCatalogSku(item));
    const duplicateIdentity = buildStructuredCandidateDuplicateIdentity(item, destination, normalizedName);

    let duplicateReason: string | null = null;

    if (destination === "pool") {
      if (duplicateIdentity && seenDuplicateIdentities.has(duplicateIdentity)) {
        duplicateReason = "Duplicado neste arquivo.";
      } else if (normalizedName && args.existingReferences.existingPoolNames.has(normalizedName)) {
        duplicateReason = "Ja existe uma piscina com esse nome nesta loja.";
      }

      if (normalizedName) {
        seenPoolNames.add(normalizedName);
      }
      if (duplicateIdentity) {
        seenDuplicateIdentities.add(duplicateIdentity);
      }
    } else {
      if (duplicateIdentity && seenDuplicateIdentities.has(duplicateIdentity)) {
        duplicateReason = "Duplicado neste arquivo.";
      } else if (normalizedSku && args.existingReferences.existingCatalogSkus.has(normalizedSku)) {
        duplicateReason = "Ja existe um item com esse SKU nesta loja.";
      } else if (normalizedName && args.existingReferences.existingCatalogNames.has(normalizedName)) {
        duplicateReason = "Ja existe um item com esse nome nesta loja.";
      }

      if (normalizedSku) {
        seenCatalogSkus.add(normalizedSku);
      }
      if (duplicateIdentity) {
        seenDuplicateIdentities.add(duplicateIdentity);
      }
    }

    const evaluatedItem = {
      item,
      destination,
      normalizedName,
      normalizedSku,
      duplicateReason,
    } satisfies StructuredPreSaveValidationItem;

    evaluatedItems.push(evaluatedItem);

    if (duplicateReason) {
      blockedItems.push(evaluatedItem);
      continue;
    }

    validItems.push(item);
  }

  return {
    validItems,
    blockedItems,
    evaluatedItems,
  } satisfies StructuredPreSaveValidationResult;
}

async function loadStructuredDuplicateReferenceData(args: {
  supabase: typeof defaultSupabase;
  organizationId: string;
  storeId: string;
}) {
  const { data: existingPools, error: existingPoolsError } = await args.supabase
    .from("pools")
    .select("id, name")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId);

  if (existingPoolsError) {
    throw existingPoolsError;
  }

  const { data: existingCatalogItems, error: existingCatalogItemsError } = await args.supabase
    .from("store_catalog_items")
    .select("id, name, sku")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId);

  if (existingCatalogItemsError) {
    throw existingCatalogItemsError;
  }

  return {
    existingPoolNames: new Set(
      (existingPools ?? [])
        .map((pool) => normalizeImportDedupText(pool.name))
        .filter(Boolean)
    ),
    existingCatalogNames: new Set(
      (existingCatalogItems ?? [])
        .map((item) => normalizeImportDedupText(item.name))
        .filter(Boolean)
    ),
    existingCatalogSkus: new Set(
      (existingCatalogItems ?? [])
        .map((item) => normalizeImportDedupSku(item.sku))
        .filter(Boolean)
    ),
  } satisfies StructuredDuplicateReferenceData;
}

function normalizeImportedCatalogCategory(value: string): ImportedCatalogCategory {
  const explicit = matchImportedDestinationLabel(value);
  if (explicit === "acessorios" || explicit === "quimicos" || explicit === "outros") {
    return explicit;
  }

  const normalized = normalizeImportedLoose(value);
  if (!normalized) return "outros";

  if (
    normalized.includes("algicida") ||
    normalized.includes("clarificante") ||
    normalized.includes("sulfato") ||
    normalized.includes("elevador de ph") ||
    normalized.includes("redutor de ph") ||
    normalized.includes("cloro granulado") ||
    normalized.includes("cloro estabilizado") ||
    normalized.includes("barrilha")
  ) {
    return "quimicos";
  }

  if (
    normalized.includes("peneira") ||
    normalized.includes("escova") ||
    normalized.includes("aspirador") ||
    normalized.includes("dispositivo") ||
    normalized.includes("mangueira") ||
    normalized.includes("clorador") ||
    normalized.includes("cascata") ||
    normalized.includes("corrimao") ||
    normalized.includes("cabo telescopico") ||
    normalized.includes("refletor") ||
    normalized.includes("nicho") ||
    normalized.includes("ralo") ||
    normalized.includes("transformador")
  ) {
    return "acessorios";
  }

  return "outros";
}

function buildIntelligentImportFormatWarnings(params: {
  extractedPreview: IntelligentImportExtractedPreview[];
  selectedFiles: IntelligentImportSelectedFilePreview[];
}) {
  const extensions = new Set(
    params.selectedFiles
      .map((file) => String(file.name || "").split(".").pop()?.toLowerCase() || "")
      .filter(Boolean)
  );
  for (const preview of params.extractedPreview) {
    const extension = String(preview.extension || "").toLowerCase();
    if (extension) extensions.add(extension);
  }

  const extractedByExtension = new Map<string, IntelligentImportExtractedPreview[]>();
  for (const preview of params.extractedPreview) {
    const extension = String(preview.extension || "").toLowerCase();
    if (!extension) continue;
    const current = extractedByExtension.get(extension) ?? [];
    current.push(preview);
    extractedByExtension.set(extension, current);
  }

  const warnings: string[] = [];
  const pdfFiles = extractedByExtension.get("pdf") ?? [];
  const hasPdf = extensions.has("pdf") || pdfFiles.length > 0;
  if (hasPdf) {
    const hasPdfWithoutText = pdfFiles.some((file) => !String(file.textPreview || "").trim());
    warnings.push(
      hasPdfWithoutText
        ? "PDF sem texto extraivel pode indicar arquivo escaneado ou imagem. Nesta etapa, PDF ainda nao tem OCR robusto."
        : "PDF e lido principalmente por texto. Catalogos com colunas, tabelas visuais ou paginas escaneadas ainda podem falhar."
    );
  }

  if (extensions.has("ppt") || extensions.has("pptx")) {
    warnings.push(
      "PowerPoint pode ter texto extraido dos slides, mas a ligacao entre imagem e item ainda e limitada."
    );
  }

  if (extensions.has("png") || extensions.has("jpg") || extensions.has("jpeg") || extensions.has("webp") || extensions.has("gif") || extensions.has("bmp") || extensions.has("heic") || extensions.has("heif")) {
    warnings.push(
      "Imagens avulsas sao preservadas para conferencia, mas ainda nao viram item estruturado automaticamente."
    );
  }

  if (extensions.has("xls")) {
    warnings.push("Arquivos .xls antigos podem ser lidos como texto de planilha, mas imagens embutidas nao sao extraidas.");
  }

  return warnings;
}
function buildVisualCatalogSessionCacheKey(file: File, page: number) {
  return `${file.name}::${file.size}::${page}`;
}
function normalizeVisualAnalysisPages(values: Array<number | null | undefined>) {
  return normalizeVisualAnalysisPageList(values).slice(0, 5);
}
function normalizeVisualAnalysisPageList(values: Array<number | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => Number(value || 0))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value))
    )
  )
    .sort((a, b) => a - b);
}
function getVisualAnalysisFileMeta(file: File | IntelligentImportSelectedFilePreview): VisualAnalysisCacheFileMeta {
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
  };
}
function buildVisualEvidenceSessionCacheKey(file: File, pages: number[]) {
  return `${file.name}::${file.size}::${pages.join(",")}`;
}
function buildVisualDocumentMapSessionCacheKey(file: File) {
  return `${file.name}::${file.size}::document-map`;
}
function buildVisualAnalysisCacheKey(params: {
  organizationId: string | null | undefined;
  storeId: string | null | undefined;
  file: VisualAnalysisCacheFileMeta;
  pages: number[];
}) {
  const scope = [params.organizationId || "org", params.storeId || "store"]
    .map((value) => encodeURIComponent(String(value)))
    .join(":");
  const pagesKey = normalizeVisualAnalysisPageList(params.pages).join(",");
  const fileKey = [params.file.name, params.file.size, params.file.lastModified]
    .map((value) => encodeURIComponent(String(value)))
    .join(":");
  return `zion:visual-catalog-analysis:v${VISUAL_ANALYSIS_CACHE_VERSION}:${scope}:${fileKey}:${pagesKey}`;
}
function buildVisualAnalysisCachePrefix(params: {
  organizationId: string | null | undefined;
  storeId: string | null | undefined;
  file: VisualAnalysisCacheFileMeta;
}) {
  const scope = [params.organizationId || "org", params.storeId || "store"]
    .map((value) => encodeURIComponent(String(value)))
    .join(":");
  const fileKey = [params.file.name, params.file.size, params.file.lastModified]
    .map((value) => encodeURIComponent(String(value)))
    .join(":");
  return `zion:visual-catalog-analysis:v${VISUAL_ANALYSIS_CACHE_VERSION}:${scope}:${fileKey}:`;
}
function buildVisualAnalysisPreviewCacheKey(params: {
  organizationId: string | null | undefined;
  storeId: string | null | undefined;
  file: VisualAnalysisCacheFileMeta;
}) {
  const scope = [params.organizationId || "org", params.storeId || "store"]
    .map((value) => encodeURIComponent(String(value)))
    .join(":");
  const fileKey = [params.file.name, params.file.size, params.file.lastModified]
    .map((value) => encodeURIComponent(String(value)))
    .join(":");
  return `zion:visual-catalog-preview-cache:v${VISUAL_ANALYSIS_CACHE_VERSION}:${scope}:${fileKey}`;
}
function getVisualAnalysisStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch (error) {
    console.error("[OnboardingPage] sessionStorage access error:", error);
    return null;
  }
}
function isVisualAnalysisCacheValid(
  value: PersistedVisualAnalysisCache,
  params: {
    organizationId: string | null | undefined;
    storeId: string | null | undefined;
    file: VisualAnalysisCacheFileMeta;
    pages: number[];
  }
) {
  if (!value || value.cacheVersion !== VISUAL_ANALYSIS_CACHE_VERSION) return false;
  if (!value.expiresAt || value.expiresAt <= Date.now()) return false;
  if ((value.organizationId || null) !== (params.organizationId || null)) return false;
  if ((value.storeId || null) !== (params.storeId || null)) return false;
  if (value.file?.name !== params.file.name) return false;
  if (value.file?.size !== params.file.size) return false;
  if (value.file?.lastModified !== params.file.lastModified) return false;
  const expectedPages = normalizeVisualAnalysisPageList(params.pages).join(",");
  const cachedPages = normalizeVisualAnalysisPageList(value.pages ?? []).join(",");
  if (!expectedPages || cachedPages !== expectedPages) return false;
  return Boolean(value.visualEvidenceResult?.ok);
}
function readVisualAnalysisCache(params: {
  organizationId: string | null | undefined;
  storeId: string | null | undefined;
  file: VisualAnalysisCacheFileMeta;
  pages: number[];
}) {
  const storage = getVisualAnalysisStorage();
  if (!storage) return null;
  const key = buildVisualAnalysisCacheKey(params);
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PersistedVisualAnalysisCache;
    if (!isVisualAnalysisCacheValid(parsed, params)) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch (error) {
    console.error("[OnboardingPage] visual analysis cache parse error:", error);
    storage.removeItem(key);
    return null;
  }
}
function readLatestVisualAnalysisCacheForFile(params: {
  organizationId: string | null | undefined;
  storeId: string | null | undefined;
  file: VisualAnalysisCacheFileMeta;
}) {
  const storage = getVisualAnalysisStorage();
  if (!storage) return null;
  const prefix = buildVisualAnalysisCachePrefix(params);
  let best: PersistedVisualAnalysisCache | null = null;

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(prefix)) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as PersistedVisualAnalysisCache;
      if (!isVisualAnalysisCacheValid(parsed, { ...params, pages: parsed.pages ?? [] })) {
        storage.removeItem(key);
        continue;
      }
      if (!best || parsed.createdAt > best.createdAt) {
        best = parsed;
      }
    } catch (error) {
      console.error("[OnboardingPage] visual analysis cache scan error:", error);
      storage.removeItem(key);
    }
  }

  return best;
}
function buildVisualAnalysisCacheImagePreviews(params: {
  images: VisualReviewExtractedImagePreview[];
  pages: number[];
  fileName?: string | null;
}) {
  const orderedPages = normalizeVisualAnalysisPageList(params.pages);
  const pages = new Set(orderedPages);
  if (pages.size === 0) return [];

  const normalizedFileName = normalizeImportedLoose(params.fileName);
  const seen = new Set<string>();
  const previews: VisualReviewExtractedImagePreview[] = [];
  const candidates = params.images
    .map((image, index) => {
      if (String(image.source || "").toLowerCase() !== "pdf") return null;
      const dataUrl = String(image.dataUrl || "").trim();
      if (!dataUrl) return null;
      const pageNumber = getVisualReviewImagePageNumber(image);
      if (!pageNumber || !pages.has(pageNumber)) return null;

      const sourceFileName = String(image.originalSourceFileName || image.sourceFileName || "").trim();
      if (
        normalizedFileName &&
        sourceFileName &&
        normalizeImportedLoose(sourceFileName) !== normalizedFileName
      ) {
        return null;
      }

      return {
        image,
        index,
        dataUrl,
        pageNumber,
        sourceFileName,
        pagePriority: orderedPages.indexOf(pageNumber),
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => {
      const leftPriority = left.pagePriority >= 0 ? left.pagePriority : Number.MAX_SAFE_INTEGER;
      const rightPriority = right.pagePriority >= 0 ? right.pagePriority : Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      const leftSize = left.dataUrl.length;
      const rightSize = right.dataUrl.length;
      if (leftSize !== rightSize) return leftSize - rightSize;
      return left.index - right.index;
    });

  const firstCandidateByPage = new Map<number, (typeof candidates)[number]>();
  const extraCandidates: typeof candidates = [];
  for (const candidate of candidates) {
    if (!firstCandidateByPage.has(candidate.pageNumber)) {
      firstCandidateByPage.set(candidate.pageNumber, candidate);
    } else {
      extraCandidates.push(candidate);
    }
  }

  function pushPreview(candidate: (typeof candidates)[number]) {
    if (previews.length >= VISUAL_ANALYSIS_CACHE_MAX_IMAGE_PREVIEWS) return;
    const { image, dataUrl, pageNumber, sourceFileName } = candidate;
    if (dataUrl.length > VISUAL_ANALYSIS_CACHE_MAX_IMAGE_PREVIEW_CHARS) return;

    const key = [
      pageNumber,
      image.imageOrder ?? "",
      image.worksheetRowNumber ?? "",
      image.sheetScopedKey ?? "",
      image.fileName ?? "",
    ].join("::");
    if (seen.has(key)) return;
    seen.add(key);

    previews.push({
      sourceFileName: image.sourceFileName,
      originalSourceFileName: image.originalSourceFileName,
      fileName: image.fileName || `${sourceFileName || params.fileName || "catalogo"}#page-${pageNumber}`,
      source: image.source,
      mimeType: image.mimeType || "image/png",
      dataUrl,
      sheetName: image.sheetName,
      rowIndex: image.rowIndex,
      columnIndex: image.columnIndex,
      anchorCell: image.anchorCell,
      imageOrder: typeof image.imageOrder === "number" ? image.imageOrder : pageNumber - 1,
      worksheetRowNumber:
        typeof image.worksheetRowNumber === "number" ? image.worksheetRowNumber : pageNumber,
      sheetScopedKey: image.sheetScopedKey,
    });
  }

  for (const pageNumber of orderedPages) {
    const candidate = firstCandidateByPage.get(pageNumber);
    if (candidate) pushPreview(candidate);
  }
  for (const candidate of extraCandidates) {
    pushPreview(candidate);
  }

  return previews;
}
function loadVisualAnalysisPreviewImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Falha ao carregar miniatura."));
    image.src = dataUrl;
  });
}
function replaceVisualPreviewFileExtension(fileName: string, extension: string) {
  const safeExtension = extension.replace(/^\./, "");
  const baseName = String(fileName || "preview").replace(/\.[^.]+$/i, "");
  return `${baseName}.${safeExtension}`;
}
async function compactVisualAnalysisPreviewImage(
  image: VisualReviewExtractedImagePreview
): Promise<VisualReviewExtractedImagePreview> {
  const dataUrl = String(image.dataUrl || "").trim();
  if (!dataUrl || typeof document === "undefined") return image;
  if (dataUrl.length <= 180_000) return { ...image, dataUrl };

  try {
    const loadedImage = await loadVisualAnalysisPreviewImage(dataUrl);
    const sourceWidth = loadedImage.naturalWidth || loadedImage.width;
    const sourceHeight = loadedImage.naturalHeight || loadedImage.height;
    if (!sourceWidth || !sourceHeight) return { ...image, dataUrl };

    const scale = Math.min(1, VISUAL_ANALYSIS_PREVIEW_CACHE_THUMBNAIL_WIDTH / sourceWidth);
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) return { ...image, dataUrl };
    context.drawImage(loadedImage, 0, 0, targetWidth, targetHeight);
    const compactDataUrl = canvas.toDataURL(
      "image/jpeg",
      VISUAL_ANALYSIS_PREVIEW_CACHE_THUMBNAIL_QUALITY
    );
    if (!compactDataUrl || compactDataUrl.length >= dataUrl.length) return { ...image, dataUrl };

    return {
      ...image,
      fileName: replaceVisualPreviewFileExtension(image.fileName, "jpg"),
      mimeType: "image/jpeg",
      dataUrl: compactDataUrl,
    };
  } catch {
    return { ...image, dataUrl };
  }
}
async function compactVisualAnalysisPreviewImages(images: VisualReviewExtractedImagePreview[]) {
  const compactedImages: VisualReviewExtractedImagePreview[] = [];
  for (const image of images) {
    compactedImages.push(await compactVisualAnalysisPreviewImage(image));
  }
  return compactedImages;
}
function isVisualAnalysisPreviewCacheValid(
  value: PersistedVisualAnalysisPreviewCache,
  params: {
    organizationId: string | null | undefined;
    storeId: string | null | undefined;
    file: VisualAnalysisCacheFileMeta;
  }
) {
  if (!value || value.cacheVersion !== VISUAL_ANALYSIS_CACHE_VERSION) return false;
  if (!value.expiresAt || value.expiresAt <= Date.now()) return false;
  if ((value.organizationId || null) !== (params.organizationId || null)) return false;
  if ((value.storeId || null) !== (params.storeId || null)) return false;
  if (value.file?.name !== params.file.name) return false;
  if (value.file?.size !== params.file.size) return false;
  if (value.file?.lastModified !== params.file.lastModified) return false;
  return Array.isArray(value.extractedImagePreview);
}
function readVisualAnalysisPreviewCache(params: {
  organizationId: string | null | undefined;
  storeId: string | null | undefined;
  file: VisualAnalysisCacheFileMeta;
}) {
  const storage = getVisualAnalysisStorage();
  if (!storage) return [];
  const key = buildVisualAnalysisPreviewCacheKey(params);
  const raw = storage.getItem(key);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as PersistedVisualAnalysisPreviewCache;
    if (!isVisualAnalysisPreviewCacheValid(parsed, params)) {
      storage.removeItem(key);
      return [];
    }
    return parsed.extractedImagePreview.filter((image) => String(image.dataUrl || "").trim());
  } catch (error) {
    console.error("[OnboardingPage] visual analysis preview cache parse error:", error);
    storage.removeItem(key);
    return [];
  }
}
function writeVisualAnalysisPreviewCache(
  params: {
    organizationId: string | null | undefined;
    storeId: string | null | undefined;
    file: VisualAnalysisCacheFileMeta;
  },
  extractedImagePreview: VisualReviewExtractedImagePreview[]
) {
  const storage = getVisualAnalysisStorage();
  if (!storage || extractedImagePreview.length === 0) return;

  const createdAt = Date.now();
  void compactVisualAnalysisPreviewImages(extractedImagePreview).then((compactedImagePreview) => {
    const latestStorage = getVisualAnalysisStorage();
    if (!latestStorage || compactedImagePreview.length === 0) return;
    const cacheKey = buildVisualAnalysisPreviewCacheKey(params);
    let existingImagePreview: VisualReviewExtractedImagePreview[] = [];
    let cacheCreatedAt = createdAt;
    try {
      const existingRaw = latestStorage.getItem(cacheKey);
      if (existingRaw) {
        const existing = JSON.parse(existingRaw) as PersistedVisualAnalysisPreviewCache;
        if (isVisualAnalysisPreviewCacheValid(existing, params)) {
          existingImagePreview = existing.extractedImagePreview.filter((image) =>
            Boolean(String(image.dataUrl || "").trim())
          );
          cacheCreatedAt = Math.max(createdAt, Number(existing.createdAt || 0));
        } else {
          latestStorage.removeItem(cacheKey);
        }
      }
    } catch (error) {
      console.error("[OnboardingPage] visual analysis preview cache merge error:", error);
    }
    const mergedImagePreview = mergeVisualReviewImagePreviews(
      existingImagePreview,
      compactedImagePreview.filter((image) => Boolean(String(image.dataUrl || "").trim()))
    );
    if (mergedImagePreview.length === 0) return;
    const baseValue = {
      cacheVersion: VISUAL_ANALYSIS_CACHE_VERSION,
      createdAt: cacheCreatedAt,
      expiresAt: cacheCreatedAt + VISUAL_ANALYSIS_CACHE_TTL_MS,
      organizationId: params.organizationId || null,
      storeId: params.storeId || null,
      file: params.file,
    };
    let previewsToPersist = mergedImagePreview;
    let serialized = JSON.stringify({
      ...baseValue,
      extractedImagePreview: previewsToPersist,
    } satisfies PersistedVisualAnalysisPreviewCache);
    while (
      serialized.length > VISUAL_ANALYSIS_PREVIEW_CACHE_MAX_CHARS &&
      previewsToPersist.length > 1
    ) {
      previewsToPersist = previewsToPersist.slice(0, -1);
      serialized = JSON.stringify({
        ...baseValue,
        extractedImagePreview: previewsToPersist,
      } satisfies PersistedVisualAnalysisPreviewCache);
    }
    if (serialized.length > VISUAL_ANALYSIS_PREVIEW_CACHE_MAX_CHARS) return;

    try {
      latestStorage.setItem(cacheKey, serialized);
    } catch (error) {
      console.error("[OnboardingPage] visual analysis preview cache setItem error:", error);
    }
  });
}
function removeVisualAnalysisPreviewCacheForFile(params: {
  organizationId: string | null | undefined;
  storeId: string | null | undefined;
  file: VisualAnalysisCacheFileMeta;
}) {
  const storage = getVisualAnalysisStorage();
  if (!storage) return;
  try {
    storage.removeItem(buildVisualAnalysisPreviewCacheKey(params));
  } catch (error) {
    console.error("[OnboardingPage] visual analysis preview cache remove error:", error);
  }
}
function writeVisualAnalysisCache(
  params: {
    organizationId: string | null | undefined;
    storeId: string | null | undefined;
    file: VisualAnalysisCacheFileMeta;
    pages: number[];
  },
  payload: {
    visualEvidencePagesInput: string;
    visualPdfTotalPages: number | null;
    visualDocumentMapResult: VisualCatalogDocumentMapResponse | null;
    visualEvidenceResult: VisualCatalogDocumentScanResponse | null;
  }
) {
  const storage = getVisualAnalysisStorage();
  if (!storage) return;
  const pages = normalizeVisualAnalysisPageList(params.pages);
  if (pages.length === 0) return;

  const value: PersistedVisualAnalysisCache = {
    cacheVersion: VISUAL_ANALYSIS_CACHE_VERSION,
    createdAt: Date.now(),
    expiresAt: Date.now() + VISUAL_ANALYSIS_CACHE_TTL_MS,
    organizationId: params.organizationId || null,
    storeId: params.storeId || null,
    file: params.file,
    pages,
    visualEvidencePagesInput: payload.visualEvidencePagesInput,
    visualPdfTotalPages: payload.visualPdfTotalPages,
    visualDocumentMapResult: payload.visualDocumentMapResult,
    visualEvidenceResult: stripVisualDocumentScanPreviews(payload.visualEvidenceResult),
  };
  const serialized = JSON.stringify(value);
  if (serialized.length > VISUAL_ANALYSIS_CACHE_MAX_CHARS) return;

  try {
    storage.setItem(buildVisualAnalysisCacheKey({ ...params, pages }), serialized);
  } catch (error) {
    console.error("[OnboardingPage] visual analysis cache setItem error:", error);
  }
}
function removeVisualAnalysisCache(params: {
  organizationId: string | null | undefined;
  storeId: string | null | undefined;
  file: VisualAnalysisCacheFileMeta;
  pages: number[];
}) {
  const storage = getVisualAnalysisStorage();
  if (!storage) return;
  try {
    storage.removeItem(buildVisualAnalysisCacheKey(params));
  } catch (error) {
    console.error("[OnboardingPage] visual analysis cache removeItem error:", error);
  }
}
function removeVisualAnalysisCacheForFile(params: {
  organizationId: string | null | undefined;
  storeId: string | null | undefined;
  file: VisualAnalysisCacheFileMeta;
}) {
  const storage = getVisualAnalysisStorage();
  if (!storage) return;
  const prefix = buildVisualAnalysisCachePrefix(params);
  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      storage.removeItem(key);
    }
    removeVisualAnalysisPreviewCacheForFile(params);
  } catch (error) {
    console.error("[OnboardingPage] visual analysis cache remove file error:", error);
  }
}
function buildRestoredVisualPdfImportResult(params: {
  file: VisualAnalysisCacheFileMeta;
  totalPages: number | null;
  extractedImagePreview?: VisualReviewExtractedImagePreview[];
}): IntelligentImportResponse {
  const totalPages = params.totalPages && params.totalPages > 0 ? Math.floor(params.totalPages) : 1;
  const restoredImagePreviews = Array.isArray(params.extractedImagePreview)
    ? params.extractedImagePreview.filter(
        (image) =>
          String(image.source || "").toLowerCase() === "pdf" &&
          Boolean(String(image.dataUrl || "").trim())
      )
    : [];
  const restoredPreviewPages = new Set(
    restoredImagePreviews
      .map((image) => getVisualReviewImagePageNumber(image))
      .filter((pageNumber): pageNumber is number => Boolean(pageNumber))
  );
  const placeholderImagePreviews = Array.from({ length: totalPages }, (_, index) => ({
    sourceFileName: params.file.name,
    fileName: `${params.file.name}#page-${index + 1}`,
    source: "pdf",
    mimeType: "image/png",
    dataUrl: "",
    imageOrder: index,
    worksheetRowNumber: index + 1,
  })).filter((image) => !restoredPreviewPages.has(image.worksheetRowNumber));
  return {
    ok: true,
    message: VISUAL_PDF_IMPORT_MESSAGE,
    summary: {
      totalFiles: 1,
      extractedFiles: 1,
      normalizedItems: 0,
      dedupedItems: 0,
      duplicateItems: 0,
    },
    extractedPreview: [
      {
        fileName: params.file.name,
        mimeType: "application/pdf",
        extension: "pdf",
        textPreview: "",
      },
    ],
    extractedImagePreview:
      restoredImagePreviews.length > 0
        ? [...restoredImagePreviews, ...placeholderImagePreviews]
        : placeholderImagePreviews,
    normalizedPreview: [],
    dedupedPreview: [],
  };
}
function getVisualPdfTotalPagesFromResult(result: IntelligentImportResponse | null) {
  if (!result?.ok) return null;
  const pageNumbers = (result.extractedImagePreview ?? [])
    .filter((image) => String(image.source || "").toLowerCase() === "pdf")
    .map((image) =>
      typeof image.worksheetRowNumber === "number"
        ? image.worksheetRowNumber
        : typeof image.imageOrder === "number"
          ? image.imageOrder + 1
          : 0
    )
    .filter((value) => Number.isFinite(value) && value > 0);
  return pageNumbers.length > 0 ? Math.max(...pageNumbers) : null;
}
function buildVisualReviewImagePreviewsFromScanResult(
  result: VisualCatalogDocumentScanResponse | null,
  fallbackSourceFileName?: string | null
): VisualReviewExtractedImagePreview[] {
  if (!result?.ok || !Array.isArray(result.pagePreviews)) return [];
  const images: VisualReviewExtractedImagePreview[] = [];
  for (const preview of result.pagePreviews) {
    const pageNumber = Math.floor(Number(preview.pageNumber || 0));
    const dataUrl = String(preview.dataUrl || "").trim();
    if (!pageNumber || !dataUrl) continue;
    const sourceFileName = String(preview.sourceFileName || fallbackSourceFileName || result.fileKey || "").trim();
    images.push({
      sourceFileName,
      originalSourceFileName: sourceFileName,
      fileName: preview.fileName || `${sourceFileName || "catalogo"}#page-${pageNumber}`,
      source: "pdf",
      mimeType: preview.mimeType || "image/png",
      dataUrl,
      sheetName: "PDF",
      imageOrder: pageNumber - 1,
      worksheetRowNumber: pageNumber,
      sheetScopedKey: `pdf::page::${pageNumber}`,
    });
  }
  return images;
}
function mergeVisualReviewImagePreviews(
  primaryImages: VisualReviewExtractedImagePreview[],
  secondaryImages: VisualReviewExtractedImagePreview[]
) {
  const merged = new Map<string, VisualReviewExtractedImagePreview>();
  for (const image of [...primaryImages, ...secondaryImages]) {
    const pageNumber = getVisualReviewImagePageNumber(image) ?? 0;
    const sourceFileName = String(image.originalSourceFileName || image.sourceFileName || "").trim().toLowerCase();
    const fileName = String(image.fileName || "").trim().toLowerCase();
    const key = [String(image.source || "").toLowerCase(), sourceFileName, pageNumber, fileName].join("::");
    const existing = merged.get(key);
    if (!existing || (!String(existing.dataUrl || "").trim() && String(image.dataUrl || "").trim())) {
      merged.set(key, image);
    }
  }
  return Array.from(merged.values());
}
function stripVisualDocumentScanPreviews(
  result: VisualCatalogDocumentScanResponse | null
): VisualCatalogDocumentScanResponse | null {
  if (!result?.ok || !Array.isArray(result.pagePreviews) || result.pagePreviews.length === 0) return result;
  const { pagePreviews: _pagePreviews, ...rest } = result;
  return rest;
}
function hasInstitutionalVisualPageText(value: string | null | undefined) {
  const normalized = normalizeImportedLoose(value);
  if (!normalized) return false;
  return /\b(indice|sumario|institucional|contracapa|apresentacao|40 anos|bebe|crianca|oculos|chapeu)\b/.test(
    normalized
  );
}
function hasUsefulVisualImagePageEvidence(
  page: Extract<VisualCatalogDocumentScanResponse, { ok: true }>["pageEvidence"][number]
) {
  return page.items.some((item) => {
    const label = normalizeImportedLoose([item.visibleName, item.visibleCode].filter(Boolean).join(" "));
    const hasCategory = Boolean(item.category);
    const hasCode = Boolean(String(item.visibleCode || "").trim());
    const hasDimensions = Boolean(formatVisualEvidenceDimensions(item.dimensions));
    return Boolean((label || hasCategory || hasCode || hasDimensions) && !hasInstitutionalVisualPageText(label));
  });
}
function buildBlockedVisualReviewImagePages(params: {
  documentMap: VisualCatalogDocumentMapResponse | null;
  evidence: VisualCatalogDocumentScanResponse | null;
}) {
  const blockedPages = new Set<number>();
  const blockedPageTypes = new Set(["cover", "index", "institutional", "back_cover"]);
  const usefulPageTypes = new Set(["model_photos", "measurement_table", "mixed", "spa", "accessories"]);

  if (params.documentMap?.ok) {
    for (const page of params.documentMap.pages) {
      if (blockedPageTypes.has(page.pageType)) {
        blockedPages.add(page.pageNumber);
        continue;
      }
      if (usefulPageTypes.has(page.pageType)) continue;
      const pageText = [
        page.reason,
        ...page.detectedLabels,
        ...page.possibleModels,
      ].join(" ");
      if (hasInstitutionalVisualPageText(pageText)) {
        blockedPages.add(page.pageNumber);
      }
    }
  }

  if (params.evidence?.ok) {
    for (const page of params.evidence.pageEvidence) {
      if (blockedPageTypes.has(page.pageType)) {
        blockedPages.add(page.pageNumber);
        continue;
      }
      if (usefulPageTypes.has(page.pageType) || hasUsefulVisualImagePageEvidence(page)) continue;
      const pageText = page.items
        .map((item) =>
          [
            item.visibleName,
            item.visibleCode,
            item.description,
            item.rawSnippet,
          ].filter(Boolean).join(" ")
        )
        .join(" ");
      if (hasInstitutionalVisualPageText(pageText)) {
        blockedPages.add(page.pageNumber);
      }
    }
  }

  return blockedPages;
}
function selectAutomaticVisualEvidencePages(totalPages: number | null) {
  if (!totalPages || totalPages <= 0) return [1, 2, 3, 4, 5];
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const candidates =
    totalPages >= 12
      ? [3, 4, 5, Math.round(totalPages * 0.7), Math.max(2, totalPages - 1)]
      : [2, 3, Math.ceil(totalPages / 2), Math.max(2, totalPages - 1), totalPages];
  return Array.from(
    new Set(candidates.map((page) => Math.max(1, Math.min(totalPages, page))))
  ).slice(0, 5);
}
function addVisualScanPage(target: number[], page: number | null | undefined, totalPages: number | null) {
  if (!page || !Number.isFinite(page) || page <= 0) return;
  const normalized = Math.floor(totalPages ? Math.min(page, totalPages) : page);
  if (!target.includes(normalized) && target.length < 5) {
    target.push(normalized);
  }
}
function selectBalancedVisualEvidencePages(
  mapResult: VisualCatalogDocumentMapResponse | null,
  fallbackPages: number[]
) {
  if (!mapResult?.ok) return fallbackPages.slice(0, 5);

  const totalPages =
    mapResult.totalPages ||
    Math.max(0, ...mapResult.pages.map((page) => page.pageNumber), ...fallbackPages);
  const selected: number[] = [];
  const validFallbackPages = fallbackPages.filter((page) => !totalPages || page <= totalPages);
  const pageByNumber = new Map(mapResult.pages.map((page) => [page.pageNumber, page]));
  const usefulTypes = new Set(["model_photos", "measurement_table", "spa", "accessories", "mixed"]);
  const ignoredTypes = new Set(["cover", "index", "institutional", "back_cover"]);
  const relevantPages = mapResult.pages
    .filter((page) => usefulTypes.has(page.pageType) || page.recommendedForDetailedScan)
    .filter((page) => !ignoredTypes.has(page.pageType) || page.relevanceScore >= 0.75);
  const measurementPages = relevantPages
    .filter((page) => page.pageType === "measurement_table" || (page.pageType === "mixed" && page.hasMeasurements))
    .sort((a, b) => b.relevanceScore - a.relevanceScore || a.pageNumber - b.pageNumber);
  const photoPages = relevantPages
    .filter((page) => ["model_photos", "spa", "accessories"].includes(page.pageType) || (page.pageType === "mixed" && !page.hasMeasurements))
    .sort((a, b) => a.pageNumber - b.pageNumber);
  const recommendedPages = mapResult.recommendedPages
    .map((pageNumber) => pageByNumber.get(pageNumber))
    .filter((page): page is NonNullable<typeof page> => Boolean(page))
    .filter((page) => !ignoredTypes.has(page.pageType) || page.relevanceScore >= 0.75)
    .sort((a, b) => b.relevanceScore - a.relevanceScore || a.pageNumber - b.pageNumber);
  const safeAnchorPages =
    totalPages >= 12
      ? [3, 4, 5, Math.round(totalPages * 0.7)]
      : validFallbackPages.slice(0, 3);

  for (const page of safeAnchorPages) {
    addVisualScanPage(selected, page, totalPages);
  }
  for (const page of measurementPages.slice(0, 2)) {
    addVisualScanPage(selected, page.pageNumber, totalPages);
  }
  for (const page of photoPages) {
    addVisualScanPage(selected, page.pageNumber, totalPages);
  }
  for (const page of recommendedPages) {
    addVisualScanPage(selected, page.pageNumber, totalPages);
  }
  for (const page of validFallbackPages) {
    addVisualScanPage(selected, page, totalPages);
  }

  return selected.slice(0, 5);
}
function translateVisualMissingField(field: string) {
  const normalized = String(field || "").trim();
  const labels: Record<string, string> = {
    visibleName: "Nome",
    visible_name: "Nome",
    visibleCode: "Codigo",
    visible_code: "Codigo",
    sku: "Codigo/SKU",
    price_cents: "Preco",
    stock_quantity: "Estoque",
    capacity_l: "Capacidade em litros",
    material: "Material",
    description: "Descricao",
    dimensions: "Medidas",
    width_m: "Largura",
    length_m: "Comprimento",
    depth_m: "Profundidade",
    name: "Nome",
    category: "Categoria",
  };
  return labels[normalized] || normalized;
}
function getVisualDisplayMissingFields(
  fields: string[],
  filled: {
    name?: string | null;
    sku?: string | null;
    dimensions?: unknown;
    material?: string | null;
    description?: string | null;
    category?: string | null;
  }
) {
  const blocked = new Set<string>();
  if (filled.name) {
    blocked.add("name");
    blocked.add("visibleName");
    blocked.add("visible_name");
  }
  if (filled.sku) {
    blocked.add("sku");
    blocked.add("visibleCode");
    blocked.add("visible_code");
  }
  if (filled.dimensions) blocked.add("dimensions");
  if (filled.material) blocked.add("material");
  if (filled.description) blocked.add("description");
  if (filled.category) blocked.add("category");
  return Array.from(new Set(fields.filter((field) => !blocked.has(field))));
}
function formatVisualMeter(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(2).replace(".", ",")}m`
    : "";
}
function formatVisualDraftDimensions(
  dimensions:
    | {
        width_m: number | null;
        length_m: number | null;
        depth_m: number | null;
        capacity_l: number | null;
      }
    | null
    | undefined
) {
  if (!dimensions || typeof dimensions !== "object") return "";
  const values = [
    formatVisualMeter((dimensions as any).width_m),
    formatVisualMeter((dimensions as any).length_m),
    formatVisualMeter((dimensions as any).depth_m),
  ].filter(Boolean);
  return values.length > 0 ? values.join(" x ") : "";
}
function getVisualDraftDimensionsLabel(draft: {
  visualDimensionsText?: string | null;
  dimensions?: {
    width_m: number | null;
    length_m: number | null;
    depth_m: number | null;
    capacity_l: number | null;
  } | null;
}) {
  const visualText = String(draft.visualDimensionsText || "").trim();
  if (visualText) return { label: "Medidas lidas", value: visualText };

  const fallback = formatVisualDraftDimensions(draft.dimensions);
  return fallback ? { label: "Medidas estimadas", value: fallback } : null;
}
function getVisualCategoryLabel(category: string | null | undefined) {
  const labels: Record<string, string> = {
    pool: "Piscina",
    chemical: "Produto quimico",
    accessory: "Acessorio",
    other: "Outro",
  };
  return labels[String(category || "")] || "A revisar";
}
function cleanupEditableVisualMissingFields(draft: EditableVisualCatalogDraft) {
  const filled = new Set<string>();
  if (draft.name.trim()) filled.add("name");
  if (draft.visualDimensionsText.trim()) {
    filled.add("dimensions");
    filled.add("width_m");
    filled.add("length_m");
    filled.add("depth_m");
  }
  if (draft.material.trim()) filled.add("material");
  if (draft.description.trim()) filled.add("description");
  if (draft.price.trim()) filled.add("price_cents");
  if (draft.stock.trim()) filled.add("stock_quantity");
  return {
    ...draft,
    missingFields: draft.missingFields.filter((field) => !filled.has(field)),
  };
}
function buildEditableVisualCatalogDrafts(
  result: VisualCatalogImportResponse | null
): EditableVisualCatalogDraft[] {
  if (!result?.ok) return [];
  return result.drafts.map((draft, index) => {
    const dimensionsLabel = getVisualDraftDimensionsLabel(draft);
    const editableDraft: EditableVisualCatalogDraft = {
      id: `${draft.pageNumber}-${draft.imageRef}-${index}`,
      name: draft.name || "",
      category:
        draft.category === "pool" ||
        draft.category === "chemical" ||
        draft.category === "accessory" ||
        draft.category === "other"
          ? draft.category
          : "",
      visualDimensionsText: dimensionsLabel?.value || "",
      material: draft.material || "",
      description: draft.description || "",
      price:
        typeof draft.price_cents === "number" && Number.isFinite(draft.price_cents)
          ? (draft.price_cents / 100).toFixed(2).replace(".", ",")
          : "",
      stock:
        typeof draft.stock_quantity === "number" && Number.isFinite(draft.stock_quantity)
          ? String(draft.stock_quantity)
          : "",
      pageNumber: draft.pageNumber,
      confidence: draft.confidence || 0,
      missingFields: Array.isArray(draft.missingFields) ? draft.missingFields : [],
    };
    return cleanupEditableVisualMissingFields(editableDraft);
  });
}
function getVisualEvidencePageTypeLabel(pageType: string) {
  const labels: Record<string, string> = {
    cover: "Capa",
    model_photos: "Modelos/fotos",
    measurement_table: "Tabela de medidas",
    description: "Descricao",
    mixed: "Misto",
    unknown: "Desconhecido",
  };
  return labels[pageType] || "Desconhecido";
}
function getVisualEvidenceDisplayPageType(page: {
  pageType: string;
  items: Array<{
    visibleName: string | null;
    visibleCode: string | null;
    dimensions?: {
      visualText?: string | null;
      width_m?: number | null;
      length_m?: number | null;
      depth_m?: number | null;
      capacity_l?: number | null;
    };
  }>;
}) {
  const hasItems = page.items.length > 0;
  const hasNamedModels = page.items.some((item) => Boolean(item.visibleName || item.visibleCode));
  const hasDimensions = page.items.some((item) => Boolean(formatVisualEvidenceDimensions(item.dimensions)));

  if (hasNamedModels && hasDimensions) return "Misto";
  if (hasDimensions) return "Tabela de medidas";
  if (hasNamedModels) return "Modelos/fotos";
  if (page.pageType === "cover" && hasItems) return "Misto";
  return getVisualEvidencePageTypeLabel(page.pageType);
}
function formatLooseVisualMeasureText(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/\s+x\s+/i.test(text)) return text;

  const parts = text.match(/\d+(?:[,.]\d+)?\s*(?:cm|m|mm)\b/gi);
  if (!parts || parts.length < 2) return text;

  const withoutParts = parts.reduce((current, part) => current.replace(part, ""), text).trim();
  if (withoutParts && /[A-Za-zÀ-ÿ]/.test(withoutParts.replace(/[xX\s,.;:-]/g, ""))) return text;

  return parts.map((part) => part.replace(/\s+/g, "")).join(" x ");
}
function formatVisualEvidenceDimensions(dimensions: {
  visualText?: string | null;
  width_m?: number | null;
  length_m?: number | null;
  depth_m?: number | null;
  capacity_l?: number | null;
} | null | undefined) {
  if (!dimensions) return "";
  const visualText = String(dimensions.visualText || "").trim();
  if (visualText) return formatLooseVisualMeasureText(visualText);
  const values = [
    formatVisualMeter(dimensions.width_m),
    formatVisualMeter(dimensions.length_m),
    formatVisualMeter(dimensions.depth_m),
  ].filter(Boolean);
  return values.length > 0 ? values.join(" x ") : "";
}
function normalizeVisualProductKey(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b\d+(?:[,.]\d+)?\s*m?\s*x\s*\d+(?:[,.]\d+)?\s*m?(?:\s*x\s*\d+(?:[,.]\d+)?\s*m?)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
function normalizeVisualConflictValue(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
function getVisualCandidateDimensionsKey(dimensions: VisualProductCandidate["dimensions"]) {
  if (!dimensions) return "";
  return [
    normalizeVisualConflictValue(dimensions.visualText),
    dimensions.width_m ?? "",
    dimensions.length_m ?? "",
    dimensions.depth_m ?? "",
    dimensions.capacity_l ?? "",
  ].join("|");
}
function getVisualEvidenceDimensionsGroupKey(dimensions: {
  visualText?: string | null;
  width_m?: number | null;
  length_m?: number | null;
  depth_m?: number | null;
  capacity_l?: number | null;
} | null | undefined) {
  const displayText = formatVisualEvidenceDimensions(dimensions);
  if (displayText) return normalizeVisualConflictValue(displayText);
  if (!dimensions) return "";
  return [
    dimensions.width_m ?? "",
    dimensions.length_m ?? "",
    dimensions.depth_m ?? "",
    dimensions.capacity_l ?? "",
  ]
    .join("|")
    .replace(/\|+$/g, "");
}
function isStrongVisualCode(value: string | null | undefined) {
  return /^[A-Z]{1,5}[-\s]?\d{1,4}$/i.test(String(value || "").trim());
}
function summarizeVisualEvidencePages(result: VisualCatalogDocumentScanResponse | null) {
  if (!result?.ok) return [];

  return result.pageEvidence.map((page) => {
    const labels = Array.from(
      new Set(
        page.items
          .map((item) => String(item.visibleName || item.visibleCode || "").trim())
          .filter(Boolean)
      )
    );
    const codes = Array.from(
      new Set(
        page.items
          .map((item) => String(item.visibleCode || "").trim())
          .filter((value) => isStrongVisualCode(value))
      )
    );

    return {
      pageNumber: page.pageNumber,
      pageType: getVisualEvidenceDisplayPageType(page),
      itemCount: page.items.length,
      labels: labels.slice(0, 8),
      hasMoreLabels: labels.length > 8,
      codes: codes.slice(0, 8),
      hasMoreCodes: codes.length > 8,
    };
  });
}
function getAnalyzedVisualEvidencePages(result: VisualCatalogDocumentScanResponse | null) {
  if (!result?.ok) return [];
  return normalizeVisualAnalysisPageList(result.pageEvidence.map((page) => page.pageNumber));
}
function getNextVisualRecommendedPagesBatch(
  mapResult: VisualCatalogDocumentMapResponse | null,
  evidenceResult: VisualCatalogDocumentScanResponse | null
) {
  if (!mapResult?.ok) return [];
  const analyzedPages = new Set(getAnalyzedVisualEvidencePages(evidenceResult));
  return normalizeVisualAnalysisPages(
    mapResult.recommendedPages.filter((pageNumber) => !analyzedPages.has(pageNumber))
  ).slice(0, 5);
}
function mergeVisualEvidenceResults(
  current: VisualCatalogDocumentScanResponse | null,
  incoming: Extract<VisualCatalogDocumentScanResponse, { ok: true }>
): Extract<VisualCatalogDocumentScanResponse, { ok: true }> {
  if (!current?.ok) return incoming;

  type VisualCatalogDocumentScanSuccess = Extract<VisualCatalogDocumentScanResponse, { ok: true }>;
  const pageEvidenceByNumber = new Map<number, VisualCatalogDocumentScanSuccess["pageEvidence"][number]>();
  for (const page of current.pageEvidence) {
    pageEvidenceByNumber.set(page.pageNumber, page);
  }
  for (const page of incoming.pageEvidence) {
    pageEvidenceByNumber.set(page.pageNumber, page);
  }

  return {
    ok: true,
    fileKey: incoming.fileKey || current.fileKey,
    requestedPages: normalizeVisualAnalysisPageList([
      ...current.requestedPages,
      ...incoming.requestedPages,
      ...Array.from(pageEvidenceByNumber.keys()),
    ]),
    pageLimit: incoming.pageLimit || current.pageLimit,
    model: incoming.model || current.model,
    pageEvidence: Array.from(pageEvidenceByNumber.values()).sort((a, b) => a.pageNumber - b.pageNumber),
    pagePreviews: mergeVisualReviewImagePreviews(
      buildVisualReviewImagePreviewsFromScanResult(current),
      buildVisualReviewImagePreviewsFromScanResult(incoming)
    ).map((image) => ({
      pageNumber: getVisualReviewImagePageNumber(image) ?? 0,
      dataUrl: image.dataUrl,
      mimeType: image.mimeType,
      fileName: image.fileName,
      sourceFileName: image.sourceFileName,
    })).filter((preview) => preview.pageNumber > 0),
    warnings: Array.from(new Set([...(current.warnings ?? []), ...(incoming.warnings ?? [])])),
  };
}
function buildVisualProductCandidateId(modelKey: string) {
  return `visual-candidate-${modelKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
function addVisualCandidateFieldSource(
  candidate: VisualProductCandidate,
  field: string,
  source: VisualProductCandidateFieldSource
) {
  candidate.fieldSources[field] = [...(candidate.fieldSources[field] ?? []), source];
}
function addVisualCandidateConflict(
  candidate: VisualProductCandidate,
  field: string,
  values: Array<string | null | undefined>,
  sourcePages: number[]
) {
  const normalizedValues = Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean))
  );
  if (normalizedValues.length < 2) return;
  const existing = candidate.conflicts.find((conflict) => conflict.field === field);
  if (existing) {
    existing.values = Array.from(new Set([...existing.values, ...normalizedValues]));
    existing.sourcePages = Array.from(new Set([...existing.sourcePages, ...sourcePages])).sort((a, b) => a - b);
    return;
  }
  candidate.conflicts.push({
    field,
    values: normalizedValues,
    sourcePages: Array.from(new Set(sourcePages)).sort((a, b) => a - b),
  });
}
function buildVisualProductMissingFields(candidate: VisualProductCandidate) {
  const missing = new Set<string>();
  if (!candidate.name) missing.add("name");
  if (!candidate.sku) missing.add("sku");
  if (!candidate.category) missing.add("category");
  if (!candidate.dimensions) missing.add("dimensions");
  if (!candidate.material) missing.add("material");
  if (!candidate.description) missing.add("description");
  if (candidate.name) {
    missing.delete("visibleName");
    missing.delete("visible_name");
    missing.delete("name");
  }
  if (candidate.sku) {
    missing.delete("visibleCode");
    missing.delete("visible_code");
    missing.delete("sku");
  }
  return Array.from(missing);
}
function consolidateVisualProductCandidates(
  result: VisualCatalogDocumentScanResponse | null
): VisualProductCandidate[] {
  if (!result?.ok) return [];

  const candidates = new Map<
    string,
    VisualProductCandidate & {
      __fieldConfidence?: Record<string, number>;
      __dimensionKey?: string;
      __confidenceValues?: number[];
    }
  >();

  for (const page of result.pageEvidence) {
    for (const item of page.items) {
      const baseModelKey =
        normalizeVisualProductKey(item.visibleCode) ||
        normalizeVisualProductKey(item.modelKey) ||
        normalizeVisualProductKey(item.visibleName);
      const dimensionsGroupKey = getVisualEvidenceDimensionsGroupKey(item.dimensions);
      const shouldSplitPoolByDimensions =
        item.category === "pool" &&
        dimensionsGroupKey &&
        !isStrongVisualCode(item.visibleCode);
      const modelKey = shouldSplitPoolByDimensions
        ? `${baseModelKey}::${dimensionsGroupKey}`
        : baseModelKey;
      const confidence = Math.max(0, Math.min(1, Number(item.confidence || 0)));
      if (!modelKey || confidence < 0.15) continue;

      const source = {
        pageNumber: page.pageNumber,
        evidenceId: item.evidenceId,
        confidence,
      };
      const existing = candidates.get(modelKey);
      const candidate =
        existing ??
        ({
          candidateId: buildVisualProductCandidateId(modelKey),
          modelKey,
          category: null,
          name: null,
          sku: null,
          dimensions: null,
          material: null,
          description: null,
          primaryImageRef: null,
          sourcePages: [],
          fieldSources: {},
          confidence: 0,
          conflicts: [],
          missingFields: [],
          __fieldConfidence: {},
          __dimensionKey: "",
          __confidenceValues: [],
        } satisfies VisualProductCandidate & {
          __fieldConfidence: Record<string, number>;
          __dimensionKey: string;
          __confidenceValues: number[];
        });

      candidate.sourcePages = Array.from(new Set([...candidate.sourcePages, page.pageNumber])).sort((a, b) => a - b);
      candidate.__confidenceValues?.push(confidence);

      const incomingName = item.visibleName || item.visibleCode || null;
      if (incomingName) {
        const currentConfidence = candidate.__fieldConfidence?.name ?? -1;
        if (candidate.name && normalizeVisualConflictValue(candidate.name) !== normalizeVisualConflictValue(incomingName)) {
          addVisualCandidateConflict(candidate, "name", [candidate.name, incomingName], candidate.sourcePages);
        }
        if (!candidate.name || confidence > currentConfidence) {
          candidate.name = incomingName;
          candidate.__fieldConfidence!.name = confidence;
        }
        addVisualCandidateFieldSource(candidate, "name", source);
      }

      if (item.visibleCode) {
        const currentConfidence = candidate.__fieldConfidence?.sku ?? -1;
        if (candidate.sku && normalizeVisualConflictValue(candidate.sku) !== normalizeVisualConflictValue(item.visibleCode)) {
          addVisualCandidateConflict(candidate, "sku", [candidate.sku, item.visibleCode], candidate.sourcePages);
        }
        if (!candidate.sku || confidence > currentConfidence) {
          candidate.sku = item.visibleCode;
          candidate.__fieldConfidence!.sku = confidence;
        }
        addVisualCandidateFieldSource(candidate, "sku", source);
      }

      if (item.category) {
        const currentConfidence = candidate.__fieldConfidence?.category ?? -1;
        if (candidate.category && candidate.category !== item.category) {
          addVisualCandidateConflict(candidate, "category", [candidate.category, item.category], candidate.sourcePages);
        }
        if (!candidate.category || confidence > currentConfidence) {
          candidate.category = item.category;
          candidate.__fieldConfidence!.category = confidence;
        }
        addVisualCandidateFieldSource(candidate, "category", source);
      }

      const dimensionText = formatVisualEvidenceDimensions(item.dimensions);
      const incomingDimensions = item.dimensions && dimensionText
        ? {
            visualText: item.dimensions.visualText || dimensionText || null,
            width_m: item.dimensions.width_m ?? null,
            length_m: item.dimensions.length_m ?? null,
            depth_m: item.dimensions.depth_m ?? null,
            capacity_l: item.dimensions.capacity_l ?? null,
          }
        : null;
      if (incomingDimensions) {
        const incomingKey = getVisualCandidateDimensionsKey(incomingDimensions);
        const currentConfidence = candidate.__fieldConfidence?.dimensions ?? -1;
        if (candidate.dimensions && candidate.__dimensionKey && candidate.__dimensionKey !== incomingKey) {
          addVisualCandidateConflict(
            candidate,
            "dimensions",
            [formatVisualEvidenceDimensions(candidate.dimensions), formatVisualEvidenceDimensions(incomingDimensions)],
            candidate.sourcePages
          );
        }
        if (!candidate.dimensions || confidence > currentConfidence) {
          candidate.dimensions = incomingDimensions;
          candidate.__dimensionKey = incomingKey;
          candidate.__fieldConfidence!.dimensions = confidence;
        }
        addVisualCandidateFieldSource(candidate, "dimensions", source);
      }

      if (item.material) {
        const currentConfidence = candidate.__fieldConfidence?.material ?? -1;
        if (candidate.material && normalizeVisualConflictValue(candidate.material) !== normalizeVisualConflictValue(item.material)) {
          addVisualCandidateConflict(candidate, "material", [candidate.material, item.material], candidate.sourcePages);
        }
        if (!candidate.material || confidence > currentConfidence) {
          candidate.material = item.material;
          candidate.__fieldConfidence!.material = confidence;
        }
        addVisualCandidateFieldSource(candidate, "material", source);
      }

      if (item.description) {
        const currentConfidence = candidate.__fieldConfidence?.description ?? -1;
        if (candidate.description && normalizeVisualConflictValue(candidate.description) !== normalizeVisualConflictValue(item.description)) {
          addVisualCandidateConflict(candidate, "description", [candidate.description, item.description], candidate.sourcePages);
        }
        if (!candidate.description || confidence > currentConfidence) {
          candidate.description = item.description;
          candidate.__fieldConfidence!.description = confidence;
        }
        addVisualCandidateFieldSource(candidate, "description", source);
      }

      candidates.set(modelKey, candidate);
    }
  }

  return Array.from(candidates.values())
    .map((candidate) => {
      const confidenceValues = candidate.__confidenceValues ?? [];
      const averageConfidence =
        confidenceValues.length > 0
          ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
          : 0;
      const cleanCandidate: VisualProductCandidate = {
        candidateId: candidate.candidateId,
        modelKey: candidate.modelKey,
        category: candidate.category,
        name: candidate.name,
        sku: candidate.sku,
        dimensions: candidate.dimensions,
        material: candidate.material,
        description: candidate.description,
        primaryImageRef: candidate.primaryImageRef,
        sourcePages: candidate.sourcePages,
        fieldSources: candidate.fieldSources,
        confidence: Math.max(0, Math.min(1, averageConfidence)),
        conflicts: candidate.conflicts,
        missingFields: [],
      };
      cleanCandidate.missingFields = buildVisualProductMissingFields(cleanCandidate);
      return cleanCandidate;
    })
    .filter((candidate) => Boolean(candidate.modelKey && (candidate.name || candidate.sku)))
    .sort((a, b) => a.sourcePages[0] - b.sourcePages[0] || a.modelKey.localeCompare(b.modelKey));
}
function inferImportedDestination(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
): ImportedDestination {
  const explicitSheet = normalizeImportedLoose(extractImportedSourceSheetName(item));
  const explicitCategory = normalizeImportedLoose(extractImportedSourceCategory(item));
  const explicitSubcategory = normalizeImportedLoose(extractImportedSourceSubcategory(item));
  const explicitSource = [explicitSheet, explicitCategory, explicitSubcategory]
    .filter(Boolean)
    .join(" ");

  if (/(^|\s)(acessorios|acessorio)(\s|$)/.test(explicitSource)) {
    return "acessorios";
  }
  if (/(^|\s)(outros|outro)(\s|$)/.test(explicitSource)) {
    return "outros";
  }
  if (/(^|\s)(quimicos|quimico)(\s|$)/.test(explicitSource)) {
    return "quimicos";
  }
  if (/(^|\s)(piscinas|piscina|pool)(\s|$)/.test(explicitSource)) {
    return "pool";
  }

  const titleAndMetadata = [
    item.type,
    item.title,
    extractImportedSourceCategory(item),
    extractImportedSourceSubcategory(item),
    ...Object.values(item.metadata ?? {}),
  ]
    .map((value) => normalizeImportedLoose(String(value ?? "")))
    .filter(Boolean)
    .join(" ");

  const chemicalScore =
    (titleAndMetadata.includes("algicida") ? 6 : 0) +
    (titleAndMetadata.includes("clarificante") ? 6 : 0) +
    (titleAndMetadata.includes("sulfato") ? 6 : 0) +
    (titleAndMetadata.includes("elevador de ph") ? 6 : 0) +
    (titleAndMetadata.includes("redutor de ph") ? 6 : 0) +
    (titleAndMetadata.includes("cloro granulado") ? 6 : 0) +
    (titleAndMetadata.includes("cloro estabilizado") ? 6 : 0) +
    (titleAndMetadata.includes("barrilha") ? 6 : 0);

  const accessoryScore =
    (titleAndMetadata.includes("peneira") ? 6 : 0) +
    (titleAndMetadata.includes("escova") ? 6 : 0) +
    (titleAndMetadata.includes("aspirador") ? 6 : 0) +
    (titleAndMetadata.includes("dispositivo") ? 6 : 0) +
    (titleAndMetadata.includes("cabo telescopico") ? 6 : 0) +
    (titleAndMetadata.includes("mangueira") ? 6 : 0) +
    (titleAndMetadata.includes("clorador") ? 6 : 0) +
    (titleAndMetadata.includes("corrimao") ? 6 : 0) +
    (titleAndMetadata.includes("cascata") ? 6 : 0) +
    (titleAndMetadata.includes("transformador") ? 6 : 0) +
    (titleAndMetadata.includes("ralo") ? 6 : 0) +
    (titleAndMetadata.includes("refletor") ? 5 : 0) +
    (titleAndMetadata.includes("nicho") ? 5 : 0);

  const raw = normalizeImportedLoose([item.title, item.rawText].join(" "));
  const hasStrongPoolMetric =
    /\b\d+[\.,]?\d*\s*x\s*\d+[\.,]?\d*\s*m\b/i.test(raw) ||
    /\b\d+[\.,]?\d*\s*m\s*di[âa]m/i.test(raw) ||
    (raw.includes("capacidade") && raw.includes("litros")) ||
    raw.includes("profundidade");

  const hasPoolKeyword =
    raw.includes("piscina") ||
    raw.includes("spa") ||
    raw.includes("vinil") ||
    raw.includes("alvenaria") ||
    raw.includes("pastilha");

  if (hasStrongPoolMetric && hasPoolKeyword) {
    return "pool";
  }

  if (chemicalScore >= 6 && chemicalScore > accessoryScore) {
    return "quimicos";
  }
  if (accessoryScore >= 6) {
    return "acessorios";
  }

  return "outros";
}

function extractImportedLabeledValue(
  source: string,
  labels: string[]
) {
  const rawSource = String(source || "").replace(/\r/g, " ");
  if (!rawSource.trim()) return "";

  const stopLabels = [
    "planilha", "sheet", "aba", "item", "sku", "nome do item", "nome do produto", "produto", "nome",
    "categoria", "subcategoria", "marca", "linha", "descrição curta", "descricao curta", "descrição detalhada",
    "descricao detalhada", "descrição", "descricao", "aplicação", "aplicacao", "embalagem", "dosagem",
    "preço venda", "preco venda", "preço de venda", "preco de venda", "preço final", "preco final",
    "preço unitário", "preco unitario", "preço", "preco", "valor", "quantidade atual", "estoque inicial",
    "estoque", "peso/volume", "peso volume", "peso", "volume", "conteúdo", "conteudo", "código de barras",
    "codigo de barras", "barcode", "observações", "observacoes", "observação", "observacao", "notas",
  ];

  const escapedStopLabels = stopLabels
    .map((label) => escapeImportedRegExp(label))
    .sort((left, right) => right.length - left.length)
    .join("|");

  for (const label of labels) {
    const escapedLabel = escapeImportedRegExp(label);
    const pattern = new RegExp(
      `${escapedLabel}\\s*[:=\\-–—]\\s*(.+?)(?=(?:\\s*(?:\\||===|•|·|\\n)\\s*)?(?:${escapedStopLabels})\\s*[:=\\-–—]|$)`,
      "iu"
    );
    const match = rawSource.match(pattern);
    if (match?.[1]) {
      const value = cleanupImportedDescriptionLine(match[1]);
      if (value) return value;
    }
  }

  const lines = rawSource
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const label of labels) {
    const normalizedLabel = normalizeImportedLoose(label);
    for (const line of lines) {
      const normalizedLine = normalizeImportedLoose(line);
      if (!normalizedLine) continue;
      if (
        normalizedLine.startsWith(`${normalizedLabel} `) ||
        normalizedLine.startsWith(`${normalizedLabel}:`) ||
        normalizedLine.startsWith(`${normalizedLabel} -`)
      ) {
        const value = cleanupImportedDescriptionLine(
          line.replace(/^\s*[^:–=-]+\s*[:–=-]\s*/u, "").trim()
        );
        if (value) return value;
      }
    }
  }

  return "";
}

function extractImportedSourceSheetName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  const worksheetRowNumber = extractImportedWorksheetRowNumber(item);
  const explicitCandidates = getImportedExplicitSheetNameCandidates(item);
  const canonicalSheetScopedKey = normalizeImportedLoose(
    String(item.metadata?.sheet_scoped_key || item.metadata?.["sheet scoped key"] || "").trim()
  );

  if (canonicalSheetScopedKey) {
    const consistentExplicitCandidate = explicitCandidates.find((candidate) => {
      const derivedCandidate = buildImportedSheetScopedKey(candidate, worksheetRowNumber);
      return Boolean(
        derivedCandidate && normalizeImportedLoose(derivedCandidate) === canonicalSheetScopedKey
      );
    });
    if (consistentExplicitCandidate) {
      return consistentExplicitCandidate;
    }
  }

  return (
    explicitCandidates[0] ||
    extractImportedLabeledValue(source, ["Planilha", "Sheet", "Aba"]) ||
    ""
  ).trim();
}

function extractImportedSourceCategory(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  const categorySource = normalizeImportedLoose(
    extractMetadataValue(item, ["category_source"])
  );
  const explicitMetadataCategory =
    extractMetadataValue(item, ["explicit_category", "explicit_category_name", "source_category"]) || "";

  if (explicitMetadataCategory) {
    return explicitMetadataCategory.trim();
  }

  if (categorySource === "explicit") {
    const compatibleExplicitCategory =
      extractMetadataValue(item, ["categoria", "category", "category_name"]) || "";
    if (compatibleExplicitCategory) {
      return compatibleExplicitCategory.trim();
    }
  }

  return (
    extractMetadataValue(item, ["source_category"]) ||
    extractImportedLabeledValue(source, ["Categoria", "Category"]) ||
    ""
  ).trim();
}

function extractImportedSourceSubcategory(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  return (
    extractMetadataValue(item, [
      "source_subcategory",
      "subcategoria",
      "subcategory",
      "sub_category",
    ]) ||
    extractImportedLabeledValue(source, ["Subcategoria", "Subcategory"]) ||
    ""
  ).trim();
}

function extractImportedSourceItemNumber(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const rawSource = [String(item.title || ""), String(item.rawText || "")].join(" ");
  const match = rawSource.match(/\bitem\s*(\d{1,6})\b/i);
  if (!match?.[1]) return "";
  return match[1];
}

function extractImportedOriginalSourceFileName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  return String(
    item.metadata?.source_file_name_original ||
      item.metadata?.original_source_file_name ||
      item.sourceFileName ||
      ""
  ).trim();
}

function extractImportedWorksheetRowNumber(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const metadataCandidates = [
    item.metadata?.source_worksheet_row_number,
    item.metadata?.worksheet_row_number,
    item.metadata?.worksheetRowNumber,
    item.metadata?.source_row_number,
    item.metadata?.row_number,
    item.metadata?.sheet_row_number,
  ]
    .map((value) => Number(String(value ?? "").replace(/[^\d-]/g, "")))
    .find((value) => Number.isFinite(value) && value > 0);

  if (metadataCandidates != null) return metadataCandidates;

  const rawText = [String(item.title || ""), String(item.rawText || "")].join("\n");
  const match =
    rawText.match(/(?:^|\n)linha da planilha\s*:\s*(\d+)/i) ||
    rawText.match(/\blinha\s*(\d{1,6})\b/i) ||
    rawText.match(/\brow\s*(\d{1,6})\b/i) ||
    rawText.match(/(?:^|\n)worksheet row number\s*:\s*(\d+)/i) ||
    rawText.match(/===\s*item\s*\d+\s*\|\s*planilha\s*:\s*[^|\n=]+\|\s*linha\s*:\s*(\d+)/i);

  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildImportedSheetScopedKey(sheetName: string, worksheetRowNumber: number | null | undefined) {
  const normalizedSheetName = normalizeImportedLoose(sheetName);
  if (!normalizedSheetName || !Number.isFinite(worksheetRowNumber as number) || Number(worksheetRowNumber) <= 0) {
    return "";
  }
  return `${normalizedSheetName}::row::${Number(worksheetRowNumber)}`;
}

function getImportedExplicitSheetNameCandidates(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  return [
    String(item.metadata?.source_sheet_name || "").trim(),
    String(item.metadata?.sheet_name || item.metadata?.sheetName || "").trim(),
    String(item.metadata?.planilha || item.metadata?.sheet || item.metadata?.aba || "").trim(),
  ].filter(Boolean);
}

function getImportedExplicitSheetScopedKeyCandidates(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  return [
    String(item.metadata?.sheet_scoped_key || item.metadata?.["sheet scoped key"] || "").trim(),
    String(item.metadata?.source_sheet_scoped_key || "").trim(),
  ].filter(Boolean);
}

function extractImportedSheetScopedKey(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const worksheetRowNumber = extractImportedWorksheetRowNumber(item);
  const sheetNameCandidates = getImportedExplicitSheetNameCandidates(item);
  const derivedCandidates = sheetNameCandidates
    .map((sheetName) => buildImportedSheetScopedKey(sheetName, worksheetRowNumber))
    .filter(Boolean);
  const explicitCandidates = getImportedExplicitSheetScopedKeyCandidates(item);

  for (const explicitCandidate of explicitCandidates) {
    const normalizedExplicitCandidate = normalizeImportedLoose(explicitCandidate);
    if (!normalizedExplicitCandidate) continue;
    if (derivedCandidates.some((candidate) => normalizeImportedLoose(candidate) === normalizedExplicitCandidate)) {
      return explicitCandidate;
    }
  }

  if (explicitCandidates.length > 0) {
    return explicitCandidates[0];
  }

  const fallbackSheetName = extractImportedSourceSheetName(item);
  return buildImportedSheetScopedKey(fallbackSheetName, worksheetRowNumber);
}

function buildImportedSourceLocationKey(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const sourceFile = normalizeImportedLoose(extractImportedOriginalSourceFileName(item));
  const sheetScopedKey = normalizeImportedLoose(extractImportedSheetScopedKey(item));
  const sheetName = normalizeImportedLoose(extractImportedSourceSheetName(item));
  const worksheetRowNumber = extractImportedWorksheetRowNumber(item);
  const itemNumber = normalizeImportedLoose(extractImportedSourceItemNumber(item));

  if (sourceFile && sheetScopedKey) {
    return `${sourceFile}::${sheetScopedKey}`;
  }
  if (sourceFile && sheetName && worksheetRowNumber != null) {
    return `${sourceFile}::${sheetName}::row::${worksheetRowNumber}`;
  }
  if (sourceFile && sheetName && itemNumber) {
    return `${sourceFile}::${sheetName}::item::${itemNumber}`;
  }
  if (sourceFile && itemNumber) {
    return `${sourceFile}::item::${itemNumber}`;
  }
  return "";
}

function buildImportedImageBucketKeys(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const keys = new Set<string>();
  const sourceFile = normalizeImportedLoose(extractImportedOriginalSourceFileName(item));
  const sheetName = normalizeImportedLoose(extractImportedSourceSheetName(item));
  const sheetScopedKey = normalizeImportedLoose(extractImportedSheetScopedKey(item));
  const worksheetRowNumber = extractImportedWorksheetRowNumber(item);
  const itemNumber = normalizeImportedLoose(extractImportedSourceItemNumber(item));

  if (sourceFile) {
    keys.add(sourceFile);
    if (sheetName) {
      keys.add(`${sourceFile}::sheet::${sheetName}`);
    }
    if (sheetScopedKey) {
      keys.add(`${sourceFile}::${sheetScopedKey}`);
      keys.add(sheetScopedKey);
    }
    if (sheetName && worksheetRowNumber != null) {
      keys.add(`${sourceFile}::${sheetName}::row::${worksheetRowNumber}`);
    }
    if (sheetName && itemNumber) {
      keys.add(`${sourceFile}::${sheetName}::item::${itemNumber}`);
    }
    if (itemNumber) {
      keys.add(`${sourceFile}::item::${itemNumber}`);
    }
  }

  return Array.from(keys).filter(Boolean);
}


function extractImportedFirstCurrencyValue(value: string | null | undefined) {
  const source = String(value || "");
  if (!source) return null;

  const match =
    source.match(/r\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)(?![\d.,])/i) ||
    source.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)(?![\d.,])/);

  if (!match) return null;
  return parseImportedDecimal(match[1]);
}

function extractImportedExcelLikeName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const explicit = [
    extractMetadataValue(item, ["nome_do_produto", "nome do produto", "product_name", "productName", "name", "nome", "title", "titulo"]),
    extractImportedLabeledValue(String(item.rawText || ""), ["Nome do produto", "Produto", "Nome"]),
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);

  if (explicit) return explicit.slice(0, 160);
  return "";
}

function isStructuredSpreadsheetImportItem(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const metadata = item.metadata ?? {};
  const source = String(item.rawText || "");

  const explicitSheetScopedKey = String(
    metadata.source_sheet_scoped_key ||
      metadata.sheet_scoped_key ||
      metadata["sheet scoped key"] ||
      ""
  ).trim();
  const explicitSheetName = String(
    metadata.source_sheet_name ||
      metadata.sheet_name ||
      metadata.planilha ||
      metadata.aba ||
      metadata.sheet ||
      ""
  ).trim();
  const explicitWorksheetRowNumber = String(
    metadata.worksheet_row_number ||
      metadata.row_number ||
      metadata.linha_planilha ||
      metadata["linha da planilha"] ||
      ""
  ).trim();

  if (explicitSheetScopedKey && explicitSheetName && explicitWorksheetRowNumber) {
    return true;
  }

  return (
    /(?:^|\n)\s*Planilha\s*:/iu.test(source) &&
    /(?:^|\n)\s*Linha da planilha\s*:/iu.test(source) &&
    /(?:^|\n)\s*Sheet scoped key\s*:/iu.test(source)
  );
}

function normalizeImportedSkuPlaceholder(value: string | null | undefined) {
  const cleaned = String(value || "").trim().slice(0, 120);
  const normalized = normalizeImportedLoose(cleaned);
  if (!cleaned || !normalized) return "";

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
    "revisar",
    "a revisar",
    "deve revisar",
  ];

  const isPlaceholder = placeholderSignals.some(
    (signal) =>
      normalized === signal ||
      normalized.startsWith(`${signal} `) ||
      normalized.endsWith(` ${signal}`) ||
      normalized.includes(` ${signal} `)
  );

  return isPlaceholder ? "" : cleaned;
}

function extractImportedCatalogSku(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  const normalizedImportedSku = normalizeImportedSkuPlaceholder(
    (
      extractMetadataValue(item, ["sku", "codigo", "cÃ³digo"]) ||
      extractImportedLabeledValue(source, ["SKU", "CÃ³digo", "Codigo"]) ||
      ""
    ).slice(0, 120)
  );
  return normalizedImportedSku;
  return (
    extractMetadataValue(item, ["sku", "codigo", "código"]) ||
    extractImportedLabeledValue(source, ["SKU", "Código", "Codigo"]) ||
    ""
  ).slice(0, 120);
}

function resolveImportedCatalogSku(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  const metadata =
    item.metadata && typeof item.metadata === "object"
      ? (item.metadata as Record<string, unknown>)
      : null;
  const topLevelItem = item as Record<string, unknown>;
  const explicitSkuCandidates = [
    "sku" in topLevelItem ? topLevelItem.sku : undefined,
    "code" in topLevelItem ? topLevelItem.code : undefined,
    "codigo" in topLevelItem ? topLevelItem.codigo : undefined,
    metadata?.reviewed_sku,
    metadata?.sku,
    metadata?.codigo,
    metadata?.["código"],
    metadata?.["cÃ³digo"],
    metadata?.["cÃƒÂ³digo"],
  ];
  const hasExplicitSkuField = explicitSkuCandidates.some((value) => value != null);
  if (hasExplicitSkuField) {
    const explicitSku = explicitSkuCandidates.find((value) => String(value ?? "").trim()) ?? "";
    return normalizeImportedSkuPlaceholder(String(explicitSku ?? "").slice(0, 120));
  }
  const canonicalSku = extractMetadataValue(item, ["sku", "codigo", "cÃ³digo"]);
  if (canonicalSku) {
    return normalizeImportedSkuPlaceholder(canonicalSku);
  }

  const normalizedImportedSku = normalizeImportedSkuPlaceholder(
    (extractImportedLabeledValue(source, ["SKU", "CÃƒÂ³digo", "Codigo"]) || "").slice(0, 120)
  );
  if (normalizedImportedSku) {
    return normalizedImportedSku;
  }

  const normalizedFallbackImportedSku = normalizeImportedSkuPlaceholder(
    (extractImportedLabeledValue(source, ["SKU", "CÃƒÂ³digo", "Codigo"]) || "").slice(0, 120)
  );
  if (normalizedFallbackImportedSku) {
    return normalizedFallbackImportedSku;
  }

  if (isStructuredSpreadsheetImportItem(item)) {
    return "";
  }

  return (extractImportedLabeledValue(source, ["SKU", "CÃ³digo", "Codigo"]) || "").slice(0, 120);
}

function extractImportedCatalogStockQuantity(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  const canonicalStock = extractMetadataValue(item, [
    "stock",
    "estoque",
    "quantidade_atual",
    "quantidade atual",
    "stock_quantity",
  ]);
  const parsedCanonicalStock = parseImportedDecimal(canonicalStock);
  if (parsedCanonicalStock != null) {
    return Math.max(0, Math.round(parsedCanonicalStock));
  }

  const labeledStock =
    extractImportedLabeledValue(source, [
      "Quantidade atual",
      "Estoque inicial",
      "Quantidade",
      "Stock inicial",
      "Stock quantity",
    ]) ||
    extractMetadataValue(item, [
      "quantidade_atual",
      "quantidade atual",
      "estoque_inicial",
      "estoque inicial",
      "stock_quantity",
    ]);

  const parsedLabeledStock = parseImportedDecimal(labeledStock);
  if (parsedLabeledStock != null) {
    return Math.max(0, Math.round(parsedLabeledStock));
  }

  if (isStructuredSpreadsheetImportItem(item)) {
    return 0;
  }

  const fallbackStock =
    extractImportedLabeledValue(source, ["Estoque", "Stock"]) ||
    extractMetadataValue(item, ["stock", "estoque"]);

  const parsedFallbackStock = parseImportedDecimal(fallbackStock);
  if (parsedFallbackStock == null) return 0;
  return Math.max(0, Math.round(parsedFallbackStock));
}

function buildImportedCatalogFallbackIdentity(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  destination: ImportedDestination
) {
  const sourceFileName = normalizeImportedLoose(extractImportedOriginalSourceFileName(item));
  const itemName = normalizeImportedLoose(buildImportedCatalogName(item));
  const priceCents = extractImportedCatalogPriceCents(item);
  const stockQuantity = extractImportedCatalogStockQuantity(item);
  const packageHint = normalizeImportedLoose(extractImportedWeightOrVolume(item));

  const parts = [
    "catalog",
    destination,
    sourceFileName ? `file::${sourceFileName}` : "file::unknown",
    itemName ? `name::${itemName}` : "name::sem_nome",
    priceCents != null ? `price::${priceCents}` : "price::na",
    stockQuantity > 0 ? `stock::${stockQuantity}` : "stock::0",
    packageHint ? `package::${packageHint}` : "package::na",
  ];

  return parts.join("::");
}

function buildImportedSaveKey(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const destination = resolveImportedDestination(item);
  const sourceLocationKey = buildImportedSourceLocationKey(item);

  if (destination === "pool") {
    if (sourceLocationKey) {
      return `pool::${sourceLocationKey}`;
    }
    return `pool::${normalizeImportedLoose(buildImportedPoolName(item))}`;
  }

  if (sourceLocationKey) {
    return `catalog::${destination}::${sourceLocationKey}`;
  }

  const sku = normalizeImportedLoose(resolveImportedCatalogSku(item));
  if (sku) {
    return `catalog::${destination}::sku::${sku}`;
  }

  return buildImportedCatalogFallbackIdentity(item, destination);
}

function buildImportedRuntimeIdentityKeys(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const destination = resolveImportedDestination(item);
  const sourceLocationKey = buildImportedSourceLocationKey(item);

  if (destination === "pool") {
    if (sourceLocationKey) {
      return [`pool::${sourceLocationKey}`];
    }
    const poolName = normalizeImportedLoose(buildImportedPoolName(item));
    return poolName ? [`pool::${poolName}`] : [];
  }

  if (sourceLocationKey) {
    return [`catalog::${destination}::${sourceLocationKey}`];
  }

  const sku = normalizeImportedLoose(resolveImportedCatalogSku(item));
  if (sku) {
    return [`catalog::${destination}::sku::${sku}`];
  }

  return [buildImportedCatalogFallbackIdentity(item, destination)];
}

function scoreImportedItemForSave(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const description = buildImportedCatalogDescription(item) || buildImportedPoolDescription(item) || "";
  const hasSku = Boolean(resolveImportedCatalogSku(item));
  const hasPrice = extractImportedCatalogPriceCents(item) != null;
  const stockQuantity = extractImportedCatalogStockQuantity(item);
  const nonEmptyMetadata = Object.values(item.metadata ?? {}).filter(
    (value) => typeof value === "string" && value.trim()
  ).length;

  return (
    (hasSku ? 120 : 0) +
    (hasPrice ? 90 : 0) +
    (stockQuantity != null && stockQuantity > 0 ? 60 : 0) +
    Math.min(description.length, 600) +
    nonEmptyMetadata * 4 +
    (item.confidence ?? 0) * 10
  );
}

function dedupeImportedItemsForSave(
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>
) {
  const bestByKey = new Map<string, {
    item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
    score: number;
    index: number;
  }>();

  items.forEach((item, index) => {
    const key = buildImportedSaveKey(item);
    const score = scoreImportedItemForSave(item);
    const current = bestByKey.get(key);
    if (!current || score > current.score) {
      bestByKey.set(key, { item, score, index });
    }
  });

  const exactDedupedItems = Array.from(bestByKey.values())
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.item);

  const bestByRuntimeIdentity = new Map<string, {
    item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
    score: number;
    index: number;
  }>();

  exactDedupedItems.forEach((item, index) => {
    const identityKeys = buildImportedRuntimeIdentityKeys(item);
    const score = scoreImportedItemForSave(item);

    if (identityKeys.length === 0) {
      bestByRuntimeIdentity.set(`fallback::${index}`, { item, score, index });
      return;
    }

    const currentEntries = identityKeys
      .map((key) => bestByRuntimeIdentity.get(key))
      .filter(Boolean) as Array<{
      item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
      score: number;
      index: number;
    }>;

    const bestCurrent = currentEntries.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })[0];

    if (!bestCurrent || score > bestCurrent.score) {
      for (const key of identityKeys) {
        bestByRuntimeIdentity.set(key, { item, score, index });
      }
    }
  });

  const uniqueItems = new Map<string, {
    item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
    score: number;
    index: number;
  }>();

  for (const entry of bestByRuntimeIdentity.values()) {
    const stableKey = buildImportedSaveKey(entry.item);
    const current = uniqueItems.get(stableKey);
    if (!current || entry.score > current.score) {
      uniqueItems.set(stableKey, entry);
    }
  }

  return Array.from(uniqueItems.values())
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.item);
}

function buildImportedCatalogName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  options?: { skipDescriptionFallback?: boolean }
) {
  const pickName = (value: string | null | undefined) => {
    const cleaned = cleanupImportedDescriptionLine(String(value || ""));
    const normalized = normalizeImportedLoose(cleaned);
    if (
      normalized === "quimico logo depois aparece" ||
      normalized === "quimicos logo depois aparece" ||
      normalized === "logo depois aparece" ||
      normalized.startsWith("categoria correta quimico") ||
      normalized.startsWith("categoria correta quimicos")
    ) {
      return "";
    }
    return cleaned && !isGenericImportedName(cleaned) ? cleaned.slice(0, 160) : "";
  };

  const excelLikeName = extractImportedExcelLikeName(item);
  const safeExcelLikeName = pickName(excelLikeName);
  if (safeExcelLikeName) return safeExcelLikeName;

  const title = pickName(item.title);
  if (title && !/\.xlsx?\s*[•·-]\s*item\s*\d+/i.test(title)) {
    return title.slice(0, 160);
  }

  const raw = String(item.rawText ?? "").trim();
  if (!raw) return "Item importado";

  if (!options?.skipDescriptionFallback) {
    const fromDescription = extractImportedNameFromNarrative(
      [
        extractMetadataValue(item, ["clean_description", "description", "descricao", "descriÃ§Ã£o"]),
        buildImportedCatalogDescription(item) || "",
        raw,
      ]
        .filter(Boolean)
        .join("\n")
    );
    if (fromDescription) return fromDescription;
  }

  const fromRaw = extractImportedLabeledValue(raw, ["Nome do produto", "Produto", "Nome"]);
  const safeFromRaw = pickName(fromRaw);
  if (safeFromRaw) return safeFromRaw;

  return raw.slice(0, 160);
}

function isGenericImportedName(value: string | null | undefined) {
  const normalized = normalizeImportedLoose(value);
  if (!normalized) return true;
  if (isGenericImportedTitle(String(value || ""))) return true;
  if (
    normalized === "produto puro na esponja" ||
    normalized === "conforme analise" ||
    normalized.startsWith("dosagem ") ||
    /\b(?:ml|l|g|kg)\s+por\s+\d/.test(normalized)
  ) {
    return true;
  }
  return [
    "nome",
    "nome do produto",
    "produto",
    "titulo",
    "title",
    "item",
  ].includes(normalized);
}

function extractImportedNameFromNarrative(value: string | null | undefined) {
  const lines = String(value || "")
    .split("\n")
    .map((line) => cleanupImportedDescriptionLine(line))
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(.{3,120}?\b\d{3,4})\s+foi\s+/i);
    const candidate = cleanupImportedDescriptionLine(match?.[1] || "");
    if (candidate && !isGenericImportedName(candidate)) {
      return candidate.slice(0, 160);
    }
  }

  return "";
}

function extractImportedDosageFromText(value: string | null | undefined) {
  const source = String(value || "");
  const match =
    source.match(
      /\b(?:dosagem|dosage)\s*(?:de)?\s*[:\-]?\s*(\d+[\.,]?\d*\s*(?:ml|l|g|kg)\s+por\s+(?:\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?))/i
    ) ||
    source.match(/\b(?:dosagem|dosage)\s*(?:de)?\s*[:\-]?\s*([^.\n,;]+)/i);

  return cleanupImportedDescriptionLine(match?.[1] || "");
}

function cleanImportedDosageValue(value: string | null | undefined) {
  const source = cleanupImportedDescriptionLine(String(value || ""));
  if (!source) return "";

  const dosageMatch = source.match(
    /\b(\d+[\.,]?\d*\s*(?:ml|l|g|kg)\s+por\s+(?:\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?))\b/i
  );

  if (dosageMatch?.[1]) {
    return cleanupImportedDescriptionLine(dosageMatch[1]);
  }

  return cleanupImportedDescriptionLine(
    source
      .replace(/^\s*(?:dosagem|dosage)\s*(?:operacional\s+)?(?:de\s+)?[:\-]?\s*/i, "")
      .split(".")[0] || ""
  );
}

function cleanImportedPackagingValue(value: string | null | undefined) {
  return cleanupImportedDescriptionLine(
    String(value || "").replace(/^\s*embalagem\s*[:\-]?\s*/i, "")
  );
}

function cleanImportedApplicationValue(value: string | null | undefined) {
  return cleanupImportedDescriptionLine(
    String(value || "").replace(/^\s*aplica(?:c(?:ao)?|\u00e7\u00e3o)\s*[:\-]?\s*/i, "")
  );
}

function cleanImportedTechnicalDescriptionArtifacts(value: string | null | undefined) {
  let cleaned = String(value || "");

  cleaned = cleaned
    .replace(/\bCampo\s+Valor\b/giu, " ")
    .replace(
      /\bCampos\s+completos\s*,?\s*pre[c\u00e7]o\s*,?\s*estoque\s*,?\s*SKU\s+e\s+foto\s+do\s+item\b/giu,
      " "
    )
    .replace(
      /\bCompletos\s*,?\s*pre[c\u00e7]o\s*,?\s*estoque\s*,?\s*SKU\s+e\s+foto\s+do\s+item\b/giu,
      " "
    )
    .replace(
      /\bFoi\s+criado\s+para\s+validar\s+importa\S*o\s+de\s+PDF\s+com\s+campos\b[^.!?]*(?:[.!?]|$)/giu,
      " "
    )
    .replace(
      /\bDe\s+PDF\s+com\s+campos\s+completos\b[^.!?]*(?:[.!?]|$)/giu,
      " "
    )
    .replace(/(^|[.!?]\s*)De\s+PDF\s*(?:[.!?]+|$)/giu, "$1 ")
    .replace(/\bN[a\u00e3]o\s+misturar\s+produtos\s+sem\s*\.?/giu, " ")
    .replace(/\s*,\s*com\s*(?=[.!?]|$|\bObserva|\bOrienta)/giu, "")
    .replace(/\s+\bcom\s*(?=[.!?]|$|\bObserva|\bOrienta)/giu, " ")
    .replace(/\s*\.\s*\./g, ".")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,.;:])\1+/g, "$1")
    .replace(/(?:^|\s)\.(?=\s|$)/g, " ")
    .replace(/\s{2,}/g, " ");

  return cleanupImportedDescriptionLine(cleaned);
}

function dedupeDescriptionLines(lines: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const key = normalizeImportedLoose(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(line.trim());
  }
  return result;
}

function escapeImportedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanupImportedDescriptionLine(value: string) {
  return String(value || "")
    .replace(/\s*[-–—]+\s*item\s*\d+\b/giu, " ")
    .replace(/\bitem\s*\d+\b/giu, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,.;:])\1+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[-–—:;,\.\s]+/u, "")
    .replace(/[-–—:;,\.\s]+$/u, "")
    .trim();
}

function normalizeImportedNarrativeLine(value: string) {
  let cleaned = cleanImportedTechnicalDescriptionArtifacts(value);

  cleaned = cleaned.replace(
    /^\s*(descri[cç][aã]o curta|descri[cç][aã]o resumida|descri[cç][aã]o|observa[cç][oõ]es|observa[cç][aã]o|obs\.?|notas?|notes?)\s*[:–-]\s*/iu,
    ""
  );

  cleaned = cleanImportedTechnicalDescriptionArtifacts(cleaned);

  if (!cleaned) return "";

  const normalized = normalizeImportedLoose(cleaned);
  if (!normalized) return "";

  if (/^item\s*\d+$/iu.test(cleaned)) return "";

  return cleaned;
}

function stripImportedRepeatedDetailsFromText(
  source: string,
  details: Array<{ label: string; value: string }>
) {
  let cleaned = String(source || "");

  for (const detail of details) {
    const value = String(detail.value || "").trim();
    if (!value) continue;

    const labelPattern = escapeImportedRegExp(detail.label);
    const valuePattern = escapeImportedRegExp(value);

    cleaned = cleaned.replace(
      new RegExp(`(?:^|\\s)${labelPattern}\\s*[:–-]\\s*${valuePattern}(?=$|[\\s,.;])`, "giu"),
      " "
    );
  }

  const cleanedLines = cleaned
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeImportedNarrativeLine(line))
    .filter(Boolean);

  return cleanedLines.join("\n").trim();
}

function buildImportedCleanDescription(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const descriptionState = getImportedDescriptionCanonicalState(item);
  if (descriptionState.canonicalized) {
    const canonicalDescription = readImportedMetadataValue(item, [
      "clean_description",
      "cleanDescription",
    ]);
    const cleanedCanonical = sanitizeImportedDescriptionText(String(canonicalDescription || ""), item);
    return cleanedCanonical || "";
  }

  const metadataCandidates = [
    extractMetadataValue(item, ["clean_description", "cleanDescription"]),
    extractMetadataValue(item, ["descricao", "descrição", "description"]),
    extractMetadataValue(item, ["notes", "observacao", "observação"]),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const candidate of metadataCandidates) {
    const cleaned = sanitizeImportedDescriptionText(candidate, item);
    if (cleaned) return cleaned;
  }

  return descriptionState.rawFallbackAllowed
    ? sanitizeImportedDescriptionText(String(item.rawText || ""), item)
    : "";
}

function sanitizeImportedDescriptionText(
  source: string,
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const descriptionState = getImportedDescriptionCanonicalState(item);
  const title = buildImportedCatalogName(item, { skipDescriptionFallback: true });
  const titleLoose = normalizeImportedLoose(title);
  const rawLines = String(source || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeImportedNarrativeLine(line))
    .filter(Boolean);

  const filtered = rawLines.filter((line) => {
    const normalized = normalizeImportedLoose(line);
    if (!normalized) return false;
    if (normalized === titleLoose) return false;
    if (normalized === "docx") return false;
    if (/^\d+\s+of\s+\d+$/.test(normalized)) return false;
    if (/^(pagina|page|pag)\s+\d+$/.test(normalized)) return false;
    if (normalized === "logo depois aparece") return false;
    if (normalized === "no mesmo paragrafo tem") return false;
    if (normalized === "tambem vendemos") return false;
    if (normalized === "outro item") return false;
    if (normalized === "outro item importante") return false;

    const blockedStarts = [
      "categoria ",
      "categoria:",
      "nome ",
      "nome:",
      "nome do produto ",
      "nome do produto:",
      "produto ou coisa ",
      "produto ou coisa:",
      "linha:",
      "aplicacao ",
      "aplicacao:",
      "aplicação ",
      "aplicação:",
      "embalagem ",
      "embalagem:",
      "preco ",
      "preco:",
      "preço ",
      "preço:",
      "valor ",
      "valor:",
      "valor final ",
      "valor final:",
      "medidas ",
      "medidas:",
      "largura ",
      "largura:",
      "comprimento ",
      "comprimento:",
      "profundidade ",
      "profundidade:",
      "capacidade ",
      "capacidade:",
      "material ",
      "material:",
      "formato ",
      "formato:",
      "modelo ",
      "modelo:",
      "model ",
      "model:",
      "marca ",
      "marca:",
      "sku ",
      "sku:",
      "codigo ",
      "codigo:",
      "código ",
      "código:",
      "cat ",
      "cat:",
      "familia ",
      "familia:",
      "família ",
      "família:",
      "familia talvez ",
      "familia talvez:",
      "família talvez ",
      "família talvez:",
      "peso ",
      "peso:",
      "peso volume ",
      "peso volume:",
      "peso/volume ",
      "peso/volume:",
      "dosagem ",
      "dosagem:",
      "cor ",
      "cor:",
      "quantidade atual ",
      "quantidade atual:",
      "qtd ",
      "qtd:",
      "qtd? ",
      "qtd?:",
      "estoque minimo ",
      "estoque minimo:",
      "estoque máximo ",
      "estoque máximo:",
      "estoque maximo ",
      "estoque maximo:",
      "estoque ",
      "estoque:",
      "controlar estoque ",
      "controlar estoque:",
      "codigo de barras ",
      "codigo de barras:",
      "código de barras ",
      "código de barras:",
      "barcode ",
      "barcode:",
      "planilha ",
      "planilha:",
      "aba ",
      "aba:",
      "sheet ",
      "sheet:",
      "sheet scoped key ",
      "sheet scoped key:",
      "source scoped key ",
      "source scoped key:",
      "document order key ",
      "document order key:",
      "docx block key ",
      "docx block key:",
      "docx body index ",
      "docx body index:",
      "docx table index ",
      "docx table index:",
      "linha da planilha ",
      "linha da planilha:",
      "foto ",
      "foto:",
      "imagem ",
      "imagem:",
      "arquivo ",
      "arquivo:",
      "obs ",
      "obs:",
    ];

    const isCanonicalApplicationNarrative =
      descriptionState.canonicalized &&
      (normalized.startsWith("aplicacao ") ||
        normalized.startsWith("aplicacao:") ||
        normalized.startsWith("aplicaÃ§Ã£o ") ||
        normalized.startsWith("aplicaÃ§Ã£o:"));

    if (!isCanonicalApplicationNarrative && blockedStarts.some((value) => normalized.startsWith(value))) {
      return false;
    }

    const blockedIncludes = [
      "arquivo de teste",
      "validar upload inteligente",
      "validar leitura",
      "upload inteligente",
      "suspeito",
      "deve revisar",
      "sem preco",
      "nome muito generico",
      "categoria esperada no sistema",
      "salvar em configuracoes",
      "salvar em configurações",
      "guia leitura",
      "guia de leitura",
      "aba guia leitura",
      "aba guia de leitura",
      "planilha estoque",
      "aba estoque",
      "sheet estoque",
      "catalogo_quimicos",
      "catalogo quimicos",
      "catálogo químicos",
      "planilha catalogo quimicos",
      "planilha catalogo_quimicos",
      "=== item",
      "controlar estoque ativo",
    ];

    if (blockedIncludes.some((value) => normalized.includes(value))) {
      return false;
    }

    return true;
  });

  const joined = dedupeDescriptionLines(filtered).join("\n").trim();
  return joined ? joined.slice(0, 4000) : null;
}


function buildImportedDescriptionSentence(value: string) {
  const cleaned = cleanupImportedDescriptionLine(value)
    .replace(/\s*,\s*\./g, ".")
    .replace(/\.\s*,/g, ".")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) return "";

  const sentence = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function buildImportedMaterialSentence(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const material = cleanupImportedDescriptionLine(
    extractMetadataValue(item, ["material", "matéria-prima", "materia_prima"])
  );
  const color = cleanupImportedDescriptionLine(
    extractMetadataValue(item, ["cor", "color"])
  );

  if (!material && !color) return "";

  if (material && color) {
    return `Construção em ${material}, com acabamento ${color}`;
  }

  if (material) {
    return `Construção em ${material}`;
  }

  return `Acabamento ${color}`;
}

function shouldSkipImportedDescriptionPart(candidate: string, chosen: string[]) {
  const normalizedCandidate = normalizeImportedLoose(candidate);
  if (!normalizedCandidate) return true;

  return chosen.some((part) => {
    const normalizedPart = normalizeImportedLoose(part);
    if (!normalizedPart) return false;
    if (normalizedPart === normalizedCandidate) return true;
    if (normalizedPart.includes(normalizedCandidate)) return true;
    if (normalizedCandidate.includes(normalizedPart) && normalizedPart.length >= 18) return true;

    const candidateWords = normalizedCandidate.split(" ").filter(Boolean);
    const partWords = normalizedPart.split(" ").filter(Boolean);
    const overlap = candidateWords.filter((word) => partWords.includes(word));
    const minWords = Math.min(candidateWords.length, partWords.length);

    return minWords >= 4 && overlap.length >= Math.max(3, minWords - 1);
  });
}

function finalizeImportedDescriptionParts(parts: string[]) {
  const chosen: string[] = [];

  for (const part of parts) {
    const cleaned = cleanImportedTechnicalDescriptionArtifacts(part)
      .replace(/\s*,\s*\./g, ".")
      .replace(/\.\s*,/g, ".")
      .replace(/\s+,/g, ",")
      .replace(/\s+\./g, ".")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (!cleaned) continue;
    if (shouldSkipImportedDescriptionPart(cleaned, chosen)) continue;

    chosen.push(cleaned);
    if (chosen.length >= 3) break;
  }

  return chosen.map(buildImportedDescriptionSentence).filter(Boolean).join(" ").trim() || null;
}

function buildImportedCatalogDescription(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const reviewedDescription = extractMetadataValue(item, [
    "reviewed_description",
    "final_reviewed_description",
  ]);
  if (reviewedDescription) {
    return String(reviewedDescription || "").trim();
  }

  const descriptionState = getImportedDescriptionCanonicalState(item);
  const source = String(item.rawText || "");
  const baseDescription = buildImportedCleanDescription(item) || "";
  if (descriptionState.canonicalized) {
    return baseDescription;
  }

  const shortDescription =
    extractMetadataValue(item, ["descricao_curta", "descrição curta", "short_description"]) ||
    extractImportedLabeledValue(source, ["Descrição curta", "Descricao curta", "Descrição", "Descricao"]);
  const notesValue =
    extractMetadataValue(item, ["observacoes", "observações", "notes", "observacao", "observação"]) ||
    extractImportedLabeledValue(source, ["Observações", "Observacoes", "Notas"]);

  const narrativeLines = dedupeDescriptionLines(
    [
      ...(sanitizeImportedDescriptionText(shortDescription || "", item)?.split("\n") ?? []),
      ...(sanitizeImportedDescriptionText(baseDescription || "", item)?.split("\n") ?? []),
      ...(sanitizeImportedDescriptionText(notesValue || "", item)?.split("\n") ?? []),
    ]
      .map((value) => normalizeImportedNarrativeLine(value))
      .filter(Boolean)
  );

  const applicationValue =
    extractMetadataValue(item, ["application", "aplicacao", "aplicação", "usage", "uso"]) ||
    extractImportedLabeledValue(source, ["Aplicação", "Aplicacao", "Uso"]);
  const applicationLine = normalizeImportedNarrativeLine(cleanImportedApplicationValue(applicationValue));

  const materialLine = normalizeImportedNarrativeLine(buildImportedMaterialSentence(item));

  const preferredParts: string[] = [];

  if (narrativeLines[0]) preferredParts.push(narrativeLines[0]);
  if (applicationLine) preferredParts.push(applicationLine);

  for (const extraLine of narrativeLines.slice(1)) {
    preferredParts.push(extraLine);
  }

  if (materialLine) preferredParts.push(materialLine);

  return finalizeImportedDescriptionParts(preferredParts);
}

function parseImportedDecimal(value: string | null | undefined) {
  if (value == null) return null;

  const source = String(value)
    .trim()
    .replace(/[^\d,.-]/g, "");

  if (!source) return null;

  const lastComma = source.lastIndexOf(",");
  const lastDot = source.lastIndexOf(".");

  let normalized = source;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    normalized =
      decimalSeparator === ","
        ? source.replace(/\./g, "").replace(",", ".")
        : source.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const fractional = source.slice(lastComma + 1).replace(/\D/g, "");
    normalized =
      fractional.length > 0 && fractional.length <= 2
        ? source.replace(/\./g, "").replace(",", ".")
        : source.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const fractional = source.slice(lastDot + 1).replace(/\D/g, "");
    normalized =
      fractional.length > 0 && fractional.length <= 2
        ? source.replace(/,/g, "")
        : source.replace(/\./g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractImportedBestMoneyValue(value: string | null | undefined) {
  const source = String(value || "").trim();
  if (!source) return null;

  const currencyMatch = source.match(/r\$\s*([\d.,]+)/i);
  if (currencyMatch) {
    const parsedCurrency = parseImportedDecimal(currencyMatch[1]);
    if (parsedCurrency != null) return parsedCurrency;
  }

  const groupedMoneyMatch = source.match(/(\d{1,3}(?:\.\d{3})+,\d{2})/);
  if (groupedMoneyMatch) {
    const parsedGrouped = parseImportedDecimal(groupedMoneyMatch[1]);
    if (parsedGrouped != null) return parsedGrouped;
  }

  const decimalMatch = source.match(/(\d+[.,]\d{2})/);
  if (decimalMatch) {
    const parsedDecimal = parseImportedDecimal(decimalMatch[1]);
    if (parsedDecimal != null) return parsedDecimal;
  }

  const normalized = normalizeImportedLoose(source);
  const integerTokens = source.match(/\d+/g) ?? [];
  if (
    (normalized.includes("preco") ||
      normalized.includes("valor") ||
      normalized.includes("price")) &&
    integerTokens.length >= 2
  ) {
    const cents = integerTokens[integerTokens.length - 1];
    const integer = integerTokens[integerTokens.length - 2];

    if (cents.length === 2) {
      const reconstructed = parseImportedDecimal(`${integer}.${cents}`);
      if (reconstructed != null) return reconstructed;
    }
  }

  const genericParsed = extractImportedFirstCurrencyValue(source);
  if (genericParsed != null) return genericParsed;

  const numericMatches = source.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (numericMatches.length === 1) {
    const parsedSingle = parseImportedDecimal(numericMatches[0]);
    if (parsedSingle != null) return parsedSingle;
  }

  return null;
}

function resolveExplicitImportedPriceReais(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const explicitCandidates = [
    {
      source: "reviewed_price",
      value: extractMetadataValue(item, ["reviewed_price"]),
    },
    {
      source: "metadata.price",
      value: extractMetadataValue(item, ["price"]),
    },
    {
      source: "metadata.preco",
      value: extractMetadataValue(item, ["preco", "preÃ§o"]),
    },
    {
      source: "metadata.sale_price",
      value: extractMetadataValue(item, [
        "preco_venda",
        "preco_de_venda",
        "preÃ§o_venda",
        "preÃ§o_de_venda",
        "preÃ§o venda",
        "preÃ§o de venda",
        "preco venda",
        "preco de venda",
        "preco_final",
        "preÃ§o_final",
        "preÃ§o final",
        "preco final",
        "preco_unitario",
        "preÃ§o_unitÃ¡rio",
        "preÃ§o unitÃ¡rio",
        "preco unitario",
        "valor_venda",
        "valor venda",
        "valor_final",
        "valor final",
        "valor_unitario",
        "valor unitario",
      ]),
    },
  ];

  for (const candidate of explicitCandidates) {
    const rawValue = String(candidate.value || "").trim();
    if (!rawValue) continue;
    const parsedReais = parseImportedDecimal(rawValue);
    if (parsedReais != null) {
      return {
        source: candidate.source,
        value: rawValue,
        parsedReais,
      };
    }
  }

  return null;
}

function normalizeImportedPoolMetricSource(value: string) {
  return String(value || "")
    .replace(/[×✕]/g, "x")
    .replace(/(\d)\s*([,.])\s*(\d)/g, "$1$2$3")
    .replace(/\s+/g, " ");
}

function extractImportedPoolMetrics(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = [item.title, item.rawText, ...Object.values(item.metadata ?? {})]
    .map((value) => String(value ?? ""))
    .join(" ");
  const metricSource = normalizeImportedPoolMetricSource(source);
  let width = parseImportedDecimal(extractMetadataValue(item, ["width", "largura"]));
  let length = parseImportedDecimal(extractMetadataValue(item, ["length", "comprimento"]));
  let depth = parseImportedDecimal(extractMetadataValue(item, ["depth", "profundidade"]));
  let capacity = parseImportedDecimal(
    extractMetadataValue(item, ["capacity", "capacidade", "max_capacity_l"])
  );
  let price = resolveExplicitImportedPriceReais(item)?.parsedReais ?? null;
  const threeDimMatch =
    metricSource.match(
      /(?:medidas?|dimens(?:oes|[õo]es)|tamanho)\s*[:\-]?\s*(\d+[\.,]?\d*)\s*m?\s*(?:x|por)\s*(\d+[\.,]?\d*)\s*m?\s*(?:x|por)\s*(\d+[\.,]?\d*)\s*m\b/i
    ) ||
    metricSource.match(
      /(\d+[\.,]?\d*)\s*m?\s*(?:x|por)\s*(\d+[\.,]?\d*)\s*m?\s*(?:x|por)\s*(\d+[\.,]?\d*)\s*m\b/i
    );
  if (threeDimMatch) {
    width ??= parseImportedDecimal(threeDimMatch[1]);
    length ??= parseImportedDecimal(threeDimMatch[2]);
    depth ??= parseImportedDecimal(threeDimMatch[3]);
  }
  const rectMatch =
    metricSource.match(/(?:medidas?|dimens(?:oes|[õo]es)|tamanho)\s*[:\-]?\s*(\d+[\.,]?\d*)\s*m?\s*(?:x|por)\s*(\d+[\.,]?\d*)\s*m?/i) ||
    metricSource.match(/(\d+[\.,]?\d*)\s*m?\s*(?:x|por)\s*(\d+[\.,]?\d*)\s*m\b/i);
  if (rectMatch) {
    width ??= parseImportedDecimal(rectMatch[1]);
    length ??= parseImportedDecimal(rectMatch[2]);
  }
  if (width == null) {
    const widthMatch = metricSource.match(/(?:largura|width)\s*(?:de)?\s*[:\-]?\s*(\d+[\.,]?\d*)\s*m?/i);
    if (widthMatch) width = parseImportedDecimal(widthMatch[1]);
  }
  if (length == null) {
    const lengthMatch = metricSource.match(/(?:comprimento|length)\s*(?:de)?\s*[:\-]?\s*(\d+[\.,]?\d*)\s*m?/i);
    if (lengthMatch) length = parseImportedDecimal(lengthMatch[1]);
  }
  const diamMatch = source.match(/(\d+[\.,]?\d*)\s*m\s*di[âa]m/i);
  if (diamMatch) {
    width ??= parseImportedDecimal(diamMatch[1]);
    length ??= parseImportedDecimal(diamMatch[1]);
  }
  if (width == null || length == null) {
    const normalizedDiamMatch = metricSource.match(/(\d+[\.,]?\d*)\s*m\s*diam/i);
    if (normalizedDiamMatch) {
      width ??= parseImportedDecimal(normalizedDiamMatch[1]);
      length ??= parseImportedDecimal(normalizedDiamMatch[1]);
    }
  }
  const explicitDepth = extractMetadataValue(item, ["profundidade", "depth"]);
  const depthSource = normalizeImportedPoolMetricSource(explicitDepth || metricSource);
  const depthMatch =
    depthSource.match(/profundidade\s*(?:de|do|da)?\s*[:\-]?\s*(\d+(?:[\.,]\d+)?)\s*m?/i) ||
    depthSource.match(/^(\d+(?:[\.,]\d+)?)\s*m?$/i) ||
    metricSource.match(/prof\.?\s*[:\-]?\s*(\d+(?:[\.,]\d+)?)\s*m\b/i);
  if (depthMatch) {
    depth ??= parseImportedDecimal(depthMatch[1]);
  }
  if (depth == null) {
    const normalizedDepthMatch = metricSource.match(/prof(?:undidade)?\.?\s*(?:de)?\s*[:\-]?\s*(\d+(?:[\.,]\d+)?)\s*m\b/i);
    if (normalizedDepthMatch) depth = parseImportedDecimal(normalizedDepthMatch[1]);
  }
  const capacityMatch =
    source.match(/capacidade(?:\s+estimada|\s+m[áa]xima|\s+aproximada)?\s*(?:de)?\s*(\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?)?/i) ||
    source.match(/(\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?)\b/i);
  if (capacityMatch) {
    capacity ??= parseImportedDecimal(capacityMatch[1]);
  }
  if (capacity == null) {
    const normalizedCapacityMatch =
      metricSource.match(/capacidade(?:\s+estimada|\s+maxima|\s+aproximada)?\s*(?:de)?\s*(\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?)?/i) ||
      metricSource.match(/(\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?)\b/i);
    if (normalizedCapacityMatch) capacity = parseImportedDecimal(normalizedCapacityMatch[1]);
  }
  const priceMatch =
    source.match(/r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i) ||
    source.match(/pre[cç]o\s*(?:estimado|aproximado)?\s*(?:de)?\s*r\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i);
  if (priceMatch) {
    price = parseImportedDecimal(priceMatch[1]);
  }
  const explicitMaterial = normalizeImportedLoose(
    extractMetadataValue(item, ["tipo", "material", "matéria-prima", "materia_prima"])
  );
  const materialSource = explicitMaterial || normalizeImportedLoose(source);
  let material = explicitMaterial || "fibra";
  if (materialSource.includes("spa")) material = "spa";
  else if (materialSource.includes("vinil")) material = "vinil";
  else if (materialSource.includes("alvenaria")) material = "alvenaria";
  else if (materialSource.includes("pastilha")) material = "pastilha";
  else if (materialSource.includes("fibra")) material = "fibra";
  const explicitShape = normalizeImportedLoose(extractMetadataValue(item, ["formato", "shape"]));
  const shapeSource = explicitShape || normalizeImportedLoose(source);
  let shape = explicitShape || "retangular";
  if (shapeSource.includes("com prainha") || shapeSource.includes("prainha")) {
    shape = "com prainha";
  } else if (shapeSource.includes("organica")) {
    shape = "organica";
  } else if (shapeSource.includes("diam") || shapeSource.includes("redonda")) {
    shape = "redonda";
  } else if (shapeSource.includes("oval")) {
    shape = "oval";
  } else if (shapeSource.includes("raia")) {
    shape = "raia";
  } else if (shapeSource.includes("retangular")) {
    shape = "retangular";
  }
  return {
    width_m: width,
    length_m: length,
    depth_m: depth,
    max_capacity_l: capacity,
    material,
    shape,
    price,
  };
}

function extractImportedCatalogPriceCents(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  const metadataEntries = Object.entries(item.metadata ?? {});
  const normalizedMetadataEntries = metadataEntries.map(([key, value]) => [
    normalizeImportedLoose(key),
    String(value ?? "").trim(),
  ] as const);

  for (const [normalizedKey, rawValue] of normalizedMetadataEntries) {
    if (
      normalizedKey.includes("price cents") ||
      normalizedKey.includes("price_cents") ||
      normalizedKey.includes("preco centavos") ||
      normalizedKey.includes("preco_centavos")
    ) {
      const centsValue = Number(String(rawValue).replace(/[^\d-]/g, ""));
      if (Number.isFinite(centsValue) && centsValue > 0) {
        return Math.round(centsValue);
      }
    }
  }

  const explicitPrice = resolveExplicitImportedPriceReais(item);
  if (explicitPrice) {
    return Math.round(explicitPrice.parsedReais * 100);
  }

  if (isStructuredSpreadsheetImportItem(item)) {
    return null;
  }

  const labeledPrice =
    extractImportedLabeledValue(source, [
      "Preço venda (R$)",
      "Preço de venda (R$)",
      "Preço venda",
      "Preço de venda",
      "Preco venda (R$)",
      "Preco de venda (R$)",
      "Preco venda",
      "Preco de venda",
      "Preço final (R$)",
      "Preço final",
      "Preco final (R$)",
      "Preco final",
      "Preço unitário (R$)",
      "Preço unitário",
      "Preco unitario (R$)",
      "Preco unitario",
      "Valor unitário",
      "Valor unitario",
      "Preço",
      "Preco",
      "Valor",
    ]) ||
    extractMetadataValue(item, [
      "preco_venda",
      "preco_de_venda",
      "preço_venda",
      "preço_de_venda",
      "preço venda",
      "preço de venda",
      "preco venda",
      "preco de venda",
      "preco_final",
      "preço_final",
      "preço final",
      "preco final",
      "preco_unitario",
      "preço_unitário",
      "preço unitário",
      "preco unitario",
      "valor_venda",
      "valor venda",
      "valor_unitario",
      "valor unitario",
      "price",
      "valor",
    ]);

  const directPrice = extractImportedBestMoneyValue(labeledPrice);
  if (directPrice != null) return Math.round(directPrice * 100);

  const metadataPriceCandidates = normalizedMetadataEntries
    .filter(([normalizedKey, rawValue]) => {
      if (!rawValue) return false;
      return (
        normalizedKey.includes("preco") ||
        normalizedKey.includes("valor") ||
        normalizedKey.includes("price")
      );
    })
    .map(([, rawValue]) => rawValue);

  for (const candidate of metadataPriceCandidates) {
    const parsedCandidate = extractImportedBestMoneyValue(candidate);
    if (parsedCandidate != null) return Math.round(parsedCandidate * 100);
  }

  const lines = source
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const priceLines = lines.filter((line) => {
    const normalized = normalizeImportedLoose(line);
    return (
      normalized.startsWith("preco venda") ||
      normalized.startsWith("preco de venda") ||
      normalized.startsWith("preço venda") ||
      normalized.startsWith("preço de venda") ||
      normalized.startsWith("preco final") ||
      normalized.startsWith("preço final") ||
      normalized.startsWith("preco unitario") ||
      normalized.startsWith("preço unitário") ||
      normalized.startsWith("valor unitario") ||
      normalized === "preco" ||
      normalized.startsWith("preco ") ||
      normalized === "preço" ||
      normalized.startsWith("preço ") ||
      normalized === "valor" ||
      normalized.startsWith("valor ") ||
      line.includes("R$")
    );
  });

  for (const line of priceLines) {
    const parsedLineValue = extractImportedBestMoneyValue(line);
    if (parsedLineValue != null) return Math.round(parsedLineValue * 100);
  }

  const fullSource = [item.title, item.rawText, ...Object.values(item.metadata ?? {})]
    .map((value) => String(value ?? ""))
    .join(" ");

  const salePriceMatch =
    fullSource.match(
      /pre[cç]o\s+(?:de\s+)?venda(?:\s*\(r\$\))?\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)/i
    ) ||
    fullSource.match(
      /valor\s+(?:de\s+)?venda\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)/i
    );

  if (salePriceMatch) {
    const parsedSale = parseImportedDecimal(salePriceMatch[1]);
    if (parsedSale != null) return Math.round(parsedSale * 100);
  }

  const genericPriceMatch =
    fullSource.match(/r\$\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)/i) ||
    fullSource.match(
      /pre[cç]o\s*(?:estimado|aproximado)?\s*(?:de)?\s*r\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)/i
    );

  if (!genericPriceMatch) return null;

  const parsedGeneric = parseImportedDecimal(genericPriceMatch[1]);
  if (parsedGeneric == null) return null;

  return Math.round(parsedGeneric * 100);
}

function canPersistAsPool(metrics: {
  width_m: number | null;
  length_m: number | null;
  depth_m: number | null;
  max_capacity_l: number | null;
}) {
  return (
    metrics.width_m != null &&
    metrics.length_m != null &&
    (metrics.depth_m != null || metrics.max_capacity_l != null)
  );
}
function normalizeImportedLoose(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const NORMALIZED_MANUAL_REVIEW_SIGNAL = normalizeImportedLoose("manual_review_signal");
function isManualReviewSignal(value: string | null | undefined) {
  return normalizeImportedLoose(value) === NORMALIZED_MANUAL_REVIEW_SIGNAL;
}
function extractMetadataValue(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  keys: string[]
) {
  for (const key of keys) {
    const direct = item.metadata?.[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
  }
  const lowerKeyMap = Object.entries(item.metadata ?? {}).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (typeof value === "string" && value.trim()) {
        acc[key.toLowerCase()] = value.trim();
      }
      return acc;
    },
    {}
  );
  for (const key of keys) {
    const found = lowerKeyMap[key.toLowerCase()];
    if (found) return found;
  }
  return "";
}

function readImportedMetadataValue(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  keys: string[]
) {
  const metadata = item.metadata ?? {};
  for (const key of keys) {
    if (typeof metadata[key] === "string") return metadata[key];
  }

  const lowerKeyMap = Object.entries(metadata).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === "string") {
      acc[key.toLowerCase()] = value;
    }
    return acc;
  }, {});

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(lowerKeyMap, key.toLowerCase())) {
      return lowerKeyMap[key.toLowerCase()];
    }
  }

  return undefined;
}

function getImportedDescriptionCanonicalState(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const canonicalizedFlag = String(
    readImportedMetadataValue(item, ["description_canonicalized"]) || ""
  )
    .trim()
    .toLowerCase();
  const status = String(readImportedMetadataValue(item, ["clean_description_status"]) || "").trim();
  const canonicalized =
    canonicalizedFlag === "true" ||
    status === "empty" ||
    status === "cleaned" ||
    status === "preserved";

  return {
    canonicalized,
    status,
    rawFallbackAllowed: !canonicalized,
  };
}
function isGenericImportedTitle(title: string) {
  const normalized = normalizeImportedLoose(title);
  if (!normalized) return true;
  const blockedStarts = [
    "catalogo de teste",
    "descricao detalhada",
    "regra comercial",
    "arquivo de teste",
    "nome do item",
  ];
  if (blockedStarts.some((item) => normalized === item || normalized.startsWith(item))) {
    return true;
  }
  if (normalized === "piscina" || normalized === "item importado") {
    return true;
  }
  return false;
}
function buildImportedPdfAccessoryDetectionText(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  return normalizeImportedLoose(
    [
      extractImportedOriginalSourceFileName(item),
      item.sourceFileName,
      extractMetadataValue(item, [
        "source_file_name",
        "source_file_name_original",
        "original_source_file_name",
      ]),
      extractImportedSourceCategory(item),
      extractImportedSourceSubcategory(item),
      extractImportedSourceSheetName(item),
      item.type,
      item.title,
      ...Object.values(item.metadata ?? {}),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function isPdfAccessoryImportItem(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const detectionText = buildImportedPdfAccessoryDetectionText(item);
  return (
    detectionText.includes("pdf") &&
    (detectionText.includes("acessorios") || detectionText.includes("acessorio"))
  );
}

function hasImportedAccessorySku(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const sku = String(resolveImportedCatalogSku(item) || "").trim();
  if (/^ACC[-\s]?\d{1,4}$/i.test(sku)) return true;

  const text = [item.title, item.rawText, ...Object.values(item.metadata ?? {})].join(" ");
  return /\bACC[-\s]?\d{1,4}\b/i.test(text);
}

function shouldForcePdfAccessoryCategory(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  return isPdfAccessoryImportItem(item) && hasImportedAccessorySku(item);
}

function isPdfOtherImportItem(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const detectionText = buildImportedPdfAccessoryDetectionText(item);
  return (
    detectionText.includes("pdf") &&
    (detectionText.includes("outros") || detectionText.includes("outro"))
  );
}

function hasImportedOtherSku(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const sku = String(resolveImportedCatalogSku(item) || "").trim();
  if (/^(OUT|OTR)[-\s]?\d{1,4}$/i.test(sku)) return true;

  const text = [item.title, item.rawText, ...Object.values(item.metadata ?? {})].join(" ");
  return /\b(?:OUT|OTR)[-\s]?\d{1,4}\b/i.test(text);
}

function shouldForcePdfOtherCategory(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  return isPdfOtherImportItem(item) && hasImportedOtherSku(item);
}

function shouldSkipPdfOtherNoise(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  if (!isPdfOtherImportItem(item)) return false;
  if (hasImportedOtherSku(item)) return false;
  return extractImportedCatalogPriceCents(item) == null;
}

function isPowerPointImportItem(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const rawSource = [
    extractImportedOriginalSourceFileName(item),
    item.sourceFileName,
    extractMetadataValue(item, [
      "source_file_name",
      "source_file_name_original",
      "original_source_file_name",
    ]),
    ...Object.values(item.metadata ?? {}),
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedSource = normalizeImportedLoose(rawSource);
  return (
    /\.(pptx|ppt)\b/i.test(rawSource) ||
    normalizedSource.includes("pptx") ||
    normalizedSource.includes("powerpoint") ||
    normalizedSource.includes("power point")
  );
}

function hasImportedPoolSku(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const sku = String(resolveImportedCatalogSku(item) || "").trim();
  if (/^PSC[-\s]?\d{1,4}$/i.test(sku)) return true;

  const text = [item.title, item.rawText, ...Object.values(item.metadata ?? {})].join(" ");
  return /\bPSC[-\s]?\d{1,4}\b/i.test(text);
}

function shouldKeepPowerPointPoolDestination(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  return isPowerPointImportItem(item) && hasImportedPoolSku(item);
}

function hasImportedChemicalSku(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const sku = String(resolveImportedCatalogSku(item) || "").trim();
  if (/^QMC[-\s]?\d{1,4}$/i.test(sku)) return true;

  const text = [item.title, item.rawText, ...Object.values(item.metadata ?? {})].join(" ");
  return /\bQMC[-\s]?\d{1,4}\b/i.test(text);
}

function shouldUsePowerPointChemicalCatalogRules(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  category: ImportedDestination
) {
  return category === "quimicos" && isPowerPointImportItem(item) && hasImportedChemicalSku(item);
}

function shouldUsePowerPointAccessoryCatalogRules(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  category: ImportedDestination
) {
  return category === "acessorios" && isPowerPointImportItem(item) && hasImportedAccessorySku(item);
}

function hasImportedPowerPointOtherSku(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const sku = String(resolveImportedCatalogSku(item) || "").trim();
  if (/^OUT[-\s]?\d{1,4}$/i.test(sku)) return true;

  const text = [item.title, item.rawText, ...Object.values(item.metadata ?? {})].join(" ");
  return /\bOUT[-\s]?\d{1,4}\b/i.test(text);
}

function shouldUsePowerPointOtherCatalogRules(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  category: ImportedDestination
) {
  return category === "outros" && isPowerPointImportItem(item) && hasImportedPowerPointOtherSku(item);
}

function buildPowerPointPoolItemText(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  return [item.title, item.rawText, ...Object.values(item.metadata ?? {})]
    .map((value) => String(value ?? ""))
    .filter(Boolean)
    .join("\n");
}

function extractPowerPointPoolName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = buildPowerPointPoolItemText(item);
  const line = source
    .replace(/\r/g, "\n")
    .split("\n")
    .map((value) => value.trim())
    .find((value) => /^piscina\s+\S+/i.test(value) && !/\bPSC[-\s]?\d{1,4}\b/i.test(value));

  return line ? line.slice(0, 160) : "";
}

function extractPowerPointChemicalName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const lines = buildPowerPointPoolItemText(item)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((value) => cleanupImportedDescriptionLine(value.trim()))
    .filter(Boolean);

  const line = lines.find((value) => {
    if (/^QMC[-\s]?\d{1,4}$/i.test(value)) return false;
    if (/^={2,}\s*ITEM\b/i.test(value) || /^SLIDE\s*:/i.test(value)) return false;
    if (/^(?:sku|codigo|código|preço|preco|estoque|dosagem|embalagem|categoria)\b/i.test(value)) {
      return false;
    }

    return /\blinha\s+[a-z]\s+\d{3,4}\b/i.test(value);
  });

  return line ? line.slice(0, 160) : "";
}

function extractPowerPointAccessoryName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const isValidAccessoryName = (value: string) => {
    if (!value) return false;
    if (/^ACC[-\s]?\d{1,4}$/i.test(value)) return false;
    if (/^={2,}\s*ITEM\b/i.test(value) || /^SLIDE\s*:/i.test(value)) return false;
    if (isGenericImportedTitle(value)) return false;
    if (
      /^(?:sku|codigo|código|preço|preco|estoque|dosagem|embalagem|categoria|aplica(?:c(?:ao)?|ção))\b/i.test(value)
    ) {
      return false;
    }
    if (/\b(?:catalogo de teste|catálogo de teste|slide|pagina|página|arquivo de teste|powerpoint|power point)\b/i.test(value)) {
      return false;
    }

    return /[a-zà-ú]/i.test(value);
  };

  const lines = buildPowerPointPoolItemText(item)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((value) =>
      cleanupImportedDescriptionLine(value.trim())
        .replace(/\bEstoque\b.*$/i, "")
        .replace(/[.;,\s]+$/g, "")
        .trim()
    )
    .filter(Boolean);

  const numberedLine = lines.find((value) => {
    return isValidAccessoryName(value) && /\b\d{3,4}\b/.test(value);
  });

  if (numberedLine) return numberedLine.slice(0, 160);

  const fallbackLine = lines.find((value) => isValidAccessoryName(value) && value.length >= 5);

  return fallbackLine ? fallbackLine.slice(0, 160) : "";
}

function extractPowerPointOtherName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const isValidOtherName = (value: string) => {
    if (!value) return false;
    if (/^OUT[-\s]?\d{1,4}$/i.test(value)) return false;
    if (/^={2,}\s*ITEM\b/i.test(value) || /^SLIDE\s*:/i.test(value)) return false;
    if (isGenericImportedTitle(value)) return false;
    if (
      /^(?:sku|codigo|código|preço|preco|estoque|dosagem|embalagem|categoria|aplica(?:c(?:ao)?|ção))\b/i.test(value)
    ) {
      return false;
    }
    if (/\b(?:catalogo de teste|catálogo de teste|slide|pagina|página|arquivo de teste|powerpoint|power point)\b/i.test(value)) {
      return false;
    }

    return /[a-zà-ú]/i.test(value);
  };

  const lines = buildPowerPointPoolItemText(item)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((value) =>
      cleanupImportedDescriptionLine(value.trim())
        .replace(/\bEstoque\b.*$/i, "")
        .replace(/[.;,\s]+$/g, "")
        .trim()
    )
    .filter(Boolean);

  const lineWithCatalogPattern = lines.find((value) => {
    return isValidOtherName(value) && /\blinha\s+[a-z]\s+\d{3,4}\b/i.test(value);
  });

  if (lineWithCatalogPattern) return lineWithCatalogPattern.slice(0, 160);

  const numberedLine = lines.find((value) => {
    return isValidOtherName(value) && /\b\d{3,4}\b/.test(value);
  });

  if (numberedLine) return numberedLine.slice(0, 160);

  const fallbackLine = lines.find((value) => isValidOtherName(value) && value.length >= 5);

  return fallbackLine ? fallbackLine.slice(0, 160) : "";
}

function extractPowerPointItemStockQuantity(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const lines = buildPowerPointPoolItemText(item)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inlineMatch = line.match(/^estoque(?:\s+inicial)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)/i);
    if (inlineMatch?.[1]) {
      const parsed = parseImportedDecimal(inlineMatch[1]);
      if (parsed != null) return Math.max(0, Math.round(parsed));
    }

    if (/^estoque(?:\s+inicial)?$/i.test(line)) {
      const parsed = parseImportedDecimal(lines[index + 1] || "");
      if (parsed != null) return Math.max(0, Math.round(parsed));
    }
  }

  return 0;
}

function extractPowerPointPoolStockQuantity(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  return extractPowerPointItemStockQuantity(item);
}

function shouldSkipPdfAccessoryNoise(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  if (!isPdfAccessoryImportItem(item)) return false;
  if (hasImportedAccessorySku(item)) return false;
  return extractImportedCatalogPriceCents(item) == null;
}

function shouldSkipImportedItem(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const normalizedTitle = normalizeImportedLoose(item.title);
  const normalizedRaw = normalizeImportedLoose(item.rawText);
  const normalizedType = normalizeImportedLoose(item.type);

  if (shouldSkipPdfOtherNoise(item)) {
    return true;
  }

  if (shouldSkipPdfAccessoryNoise(item)) {
    return true;
  }

  if (normalizedType === "commercial rule" || normalizedType === "commercial_rule") {
    return true;
  }
  if (normalizedType === "store info" || normalizedType === "store_info") {
    return true;
  }
  if (normalizedType === "responsible info" || normalizedType === "responsible_info") {
    return true;
  }
  if (normalizedType === "unknown" && item.confidence <= 0.35) {
    return true;
  }
  if (isGenericImportedTitle(item.title) && item.confidence <= 0.75) {
    return true;
  }
  if (
    normalizedRaw.includes("arquivo de teste") &&
    normalizedRaw.includes("validar upload inteligente") &&
    !normalizedRaw.includes("r$") &&
    !normalizedRaw.includes("capacidade") &&
    !normalizedRaw.includes("profundidade")
  ) {
    return true;
  }

if (
  normalizedRaw.includes("planilha estoque") ||
  normalizedRaw.includes("aba estoque") ||
  normalizedRaw.includes("sheet estoque")
) {
  return true;
}

  return false;
}

const IMPORTED_POOL_ACCESSORY_TERMS = [
  "capa",
  "filtro",
  "bomba",
  "escada",
  "refletor",
  "kit",
  "cloro",
  "aspirador",
  "peneira",
  "mangueira",
  "skimmer",
  "iluminacao",
  "dispositivo",
  "retorno",
  "hidromassagem",
];

function looksLikeDuplicatedSavedPoolCatalogItem(args: {
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
  itemName: string;
  metrics: ReturnType<typeof extractImportedPoolMetrics>;
  savedPoolNames: Set<string>;
}) {
  if (args.savedPoolNames.size === 0) return false;

  const normalizedItemName = normalizeImportedLoose(args.itemName);
  const normalizedText = normalizeImportedLoose(
    [
      args.itemName,
      args.item.title,
      args.item.rawText,
      ...Object.values(args.item.metadata ?? {}),
    ].join(" ")
  );

  if (!normalizedItemName || !normalizedText.includes("piscina")) return false;
  if (IMPORTED_POOL_ACCESSORY_TERMS.some((term) => normalizedText.includes(term))) return false;

  const hasPoolMetric =
    (args.metrics.width_m != null && args.metrics.length_m != null) ||
    /\b\d+[\.,]?\d*\s*x\s*\d+[\.,]?\d*\s*m?\b/i.test(String(args.itemName || args.item.rawText || ""));

  if (!hasPoolMetric) return false;

  for (const savedPoolName of args.savedPoolNames) {
    if (!savedPoolName) continue;
    if (normalizedItemName.includes(savedPoolName) || savedPoolName.includes(normalizedItemName)) {
      return true;
    }
  }

  return false;
}

function looksLikeImportedDocumentIntroCatalogItem(args: {
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
  itemName: string;
  category: ImportedCatalogCategory;
  metrics: ReturnType<typeof extractImportedPoolMetrics>;
}) {
  if (!["outros", "acessorios", "quimicos"].includes(args.category)) return false;
  if (canPersistAsPool(args.metrics)) return false;

  const rawText = String(args.item.rawText || "");
  const normalizedName = normalizeImportedLoose(args.itemName);
  const normalizedText = normalizeImportedLoose(
    [
      args.itemName,
      args.item.title,
      rawText,
      ...Object.values(args.item.metadata ?? {}),
    ].join(" ")
  );

  const hasDocumentTitleSignal =
    normalizedName === "catalogo de acessorios" ||
    normalizedName === "catalogo de produtos quimicos" ||
    normalizedName === "catalogo de teste" ||
    normalizedName === "documento de teste" ||
    normalizedName.startsWith("catalogo de teste ");
  const hasRealProductNamePattern = /\b\d{3,4}$/.test(normalizedName) && !hasDocumentTitleSignal;
  const hasPrice = extractImportedCatalogPriceCents(args.item) != null;
  const hasIntroSignal =
    normalizedText.includes("arquivo ficticio") ||
    normalizedText.includes("catalogo de teste") ||
    normalizedText.includes("documento de teste") ||
    normalizedText.includes("documento de teste com 100 itens") ||
    normalizedText.includes("objetivo") ||
    normalizedText.includes("objetivo do arquivo") ||
    normalizedText.includes("validar importacao") ||
    normalizedText.includes("100 piscinas") ||
    normalizedText.includes("total de piscinas") ||
    normalizedText.includes("fake com foto") ||
    (hasDocumentTitleSignal && normalizedText.includes("docx"));

  if (!hasIntroSignal) return false;

  if (
    (args.category === "acessorios" || args.category === "quimicos") &&
    hasDocumentTitleSignal &&
    !hasPrice &&
    !hasRealProductNamePattern
  ) {
    return true;
  }

  const hasRealProductSignal =
    Boolean(resolveImportedCatalogSku(args.item)) ||
    hasPrice ||
    Boolean(extractMetadataValue(args.item, ["embalagem", "package", "packaging", "marca", "brand"])) ||
    Boolean(extractImportedLabeledValue(rawText, ["Embalagem", "Marca", "SKU", "PreÃ§o", "Preco"])) ||
    normalizeImportedLoose(extractImportedSourceCategory(args.item)).includes("quimicos") ||
    normalizeImportedLoose(extractImportedSourceCategory(args.item)).includes("acessorios");

  return !hasRealProductSignal;
}

function resolveImportedDestination(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
): ImportedDestination {
  const explicitSku = String(resolveImportedCatalogSku(item) || "").trim().toUpperCase();
  if (/^QMC(?:-[A-Z0-9]{1,8}){1,4}$/.test(explicitSku)) {
    return "quimicos";
  }
  if (/^ACC(?:-[A-Z0-9]{1,8}){1,4}$/.test(explicitSku)) {
    return "acessorios";
  }

  if (shouldForcePdfOtherCategory(item)) {
    return "outros";
  }

  if (shouldForcePdfAccessoryCategory(item)) {
    return "acessorios";
  }

  const explicitDestination = resolveImportedExplicitDestination(item);
  if (explicitDestination) return explicitDestination;

  const inferred = inferImportedDestination(item);
  if (inferred === "pool") {
    const metrics = extractImportedPoolMetrics(item);
    if (!canPersistAsPool(metrics)) {
      return normalizeImportedCatalogCategory(
        [
          extractImportedSourceCategory(item),
          extractImportedSourceSubcategory(item),
          extractImportedSourceSheetName(item),
          item.type,
          item.title,
        ].join(" ")
      );
    }
  }

  return inferred;
}
function buildImportedPoolName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const explicitTitle = extractMetadataValue(item, ["title", "titulo", "nome", "productName"]);
  const candidate = explicitTitle || item.title || item.rawText || "Piscina importada";
  return candidate
    .replace(/^Piscina\s*:\s*/i, "")
    .replace(/^Cat[aá]logo\s*:\s*/i, "")
    .replace(/^Nome do item\s*:\s*/i, "")
    .trim()
    .slice(0, 160);
}
function buildImportedPoolDescription(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const reviewedDescription = extractMetadataValue(item, [
    "reviewed_description",
    "final_reviewed_description",
  ]);
  if (reviewedDescription) {
    return String(reviewedDescription || "").trim();
  }

  return buildImportedCleanDescription(item);
}

function extractImportedWeightOrVolume(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");

  return (
    extractMetadataValue(item, [
      "peso_volume",
      "peso volume",
      "peso",
      "volume",
      "conteudo",
      "conteúdo",
      "embalagem",
      "package",
      "packaging",
    ]) ||
    extractImportedLabeledValue(source, [
      "Peso/Volume",
      "Peso / Volume",
      "Peso",
      "Volume",
      "Conteúdo",
      "Conteudo",
      "Embalagem",
    ]) ||
    ""
  ).trim();
}

function buildImportedCatalogMetadata(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  category: ImportedCatalogCategory,
  metadataSource = "onboarding_intelligent_import"
) {
  const source = String(item.rawText || "");
  const sku =
    resolveImportedCatalogSku(item) ||
    extractMetadataValue(item, ["sku", "codigo", "código"]);
  const normalizedCatalogSku = normalizeImportedSkuPlaceholder(sku);
  const line =
    extractMetadataValue(item, ["linha", "line"]) ||
    extractImportedLabeledValue(source, ["Linha"]);
  const application =
    extractMetadataValue(item, ["aplicacao", "aplicação", "application"]) ||
    extractImportedLabeledValue(source, ["Aplicação", "Aplicacao"]);
  const packaging =
    extractMetadataValue(item, ["embalagem", "package", "packaging"]) ||
    extractImportedLabeledValue(source, ["Embalagem"]);
  const dosage =
    extractMetadataValue(item, ["dosagem", "dose", "diluição", "diluicao"]) ||
    extractImportedLabeledValue(source, ["Dosagem", "Dose"]);
  const barcode =
    extractMetadataValue(item, ["codigo_barras", "código de barras", "barcode"]) ||
    extractImportedLabeledValue(source, ["Código de barras", "Codigo de barras", "Barcode"]);
  const stockInitial = extractImportedCatalogStockQuantity(item);
  const resolvedDosage =
    dosage ||
    extractMetadataValue(item, ["dosage"]) ||
    extractImportedDosageFromText(
      [
        extractMetadataValue(item, ["clean_description", "description", "descricao", "descriÃ§Ã£o"]),
        buildImportedCatalogDescription(item) || "",
        source,
      ]
        .filter(Boolean)
        .join("\n")
    );
  const cleanedApplication = cleanImportedApplicationValue(application);
  const cleanedPackaging = cleanImportedPackagingValue(packaging);
  const cleanedDosage = cleanImportedDosageValue(resolvedDosage);
  const cleanDescription = buildImportedCatalogDescription(item) || "";
  const importedTitleOriginal =
    extractMetadataValue(item, ["imported_title_original", "imported_title"]) ||
    buildImportedCatalogName(item);
  const importedDescriptionOriginal =
    extractMetadataValue(item, ["imported_clean_description_original"]) ||
    extractMetadataValue(item, ["clean_description", "description", "descricao", "descrição"]) ||
    cleanDescription;

  return {
    categoria: category,
    source: metadataSource,
    source_file_name: item.sourceFileName,
    source_type: item.type,
    confidence: item.confidence,
    dedup_key: buildImportedSaveKey(item) || null,
    source_location_key: buildImportedSourceLocationKey(item) || null,
    source_sheet_name: extractImportedSourceSheetName(item) || null,
    source_worksheet_row_number: extractImportedWorksheetRowNumber(item) ?? null,
    source_sheet_scoped_key: extractImportedSheetScopedKey(item) || null,
    source_category: extractImportedSourceCategory(item) || null,
    source_subcategory: extractImportedSourceSubcategory(item) || null,
    imported_title: importedTitleOriginal,
    imported_title_original: importedTitleOriginal,
    imported_dimensions: extractMetadataValue(item, ["medidas", "dimensions"]),
    imported_depth: extractMetadataValue(item, ["profundidade", "depth"]),
    imported_capacity: extractMetadataValue(item, ["capacidade", "capacity"]),
    imported_material: extractMetadataValue(item, ["material"]),
    imported_shape: extractMetadataValue(item, ["formato", "shape"]),
    imported_package: cleanedPackaging,
    imported_weight_or_volume:
      extractMetadataValue(item, ["peso_volume", "peso", "volume", "conteudo", "conteúdo"]) ||
      extractImportedWeightOrVolume(item),
    imported_dosage: cleanedDosage,
    imported_barcode: barcode,
    imported_clean_description_original: importedDescriptionOriginal,
    clean_description: cleanDescription,
    description: cleanDescription,
    descricao: cleanDescription,
    reviewed_description: extractMetadataValue(item, ["reviewed_description"]) || cleanDescription,
    reviewed_name: extractMetadataValue(item, ["reviewed_name", "title", "nome", "productName"]) || "",
    reviewed_sku: normalizeImportedSkuPlaceholder(
      extractMetadataValue(item, ["reviewed_sku", "sku", "codigo", "cÃ³digo"]) || ""
    ),
    reviewed_price:
      extractMetadataValue(item, ["reviewed_price"]) ||
      extractMetadataValue(item, ["price", "preco", "preço"]) ||
      "",
    reviewed_stock_quantity:
      extractMetadataValue(item, ["reviewed_stock_quantity", "stock_quantity", "stock", "estoque"]) || "",
    reviewed_category: extractMetadataValue(item, ["reviewed_category", "categoria", "category"]) || category,
    review_required: extractMetadataValue(item, ["review_required"]) || "",
    weak_candidate: extractMetadataValue(item, ["weak_candidate"]) || "",
    review_selection_default: extractMetadataValue(item, ["review_selection_default"]) || "",
    source_review_signals: extractMetadataValue(item, ["source_review_signals"]) || "",
    structural_review_signals: extractMetadataValue(item, ["structural_review_signals"]) || "",
    human_review_confirmed: extractMetadataValue(item, ["human_review_confirmed"]) || "",
    review_confirmed_by_user: extractMetadataValue(item, ["review_confirmed_by_user"]) || "",
    review_confirmation_state: extractMetadataValue(item, ["review_confirmation_state"]) || "",
    review_confirmation_source: extractMetadataValue(item, ["review_confirmation_source"]) || "",
    sku: normalizedCatalogSku,
    line,
    application: cleanedApplication,
    embalagem: cleanedPackaging,
    dosagem: cleanedDosage,
    dosage: cleanedDosage,
    barcode,
    stock_initial: stockInitial,
  };
}

function dataUrlToBlob(dataUrl: string) {
  const [header, data] = String(dataUrl || "").split(",");
  if (!header || !data) {
    throw new Error("Data URL inválida para upload da imagem.");
  }
  const mimeMatch = header.match(/data:(.*?);base64/i);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}
function buildSafeImportedImageExtension(fileName: string, mimeType: string) {
  const byName = String(fileName || "").split(".").pop()?.toLowerCase();
  if (byName) return byName;
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}

async function uploadExtractedImageToPool(
  organizationId: string,
  storeId: string,
  poolId: string,
  image: { fileName: string; mimeType: string; dataUrl: string },
  sortOrder: number
) {
  const blob = dataUrlToBlob(image.dataUrl);
  const extension = buildSafeImportedImageExtension(image.fileName, image.mimeType);
  const filePath = `${organizationId}/${storeId}/${poolId}/${Date.now()}-${sortOrder}.${extension}`;
  const { error: uploadError } = await defaultSupabase.storage
    .from("pool-photos")
    .upload(filePath, blob, {
      upsert: false,
      contentType: image.mimeType || blob.type || "image/jpeg",
    });
  if (uploadError) throw uploadError;
  const { error: metadataError } = await defaultSupabase.from("pool_photos").insert({
    organization_id: organizationId,
    store_id: storeId,
    pool_id: poolId,
    storage_path: filePath,
    file_name: image.fileName,
    file_size_bytes: blob.size,
    sort_order: sortOrder,
  });
  if (metadataError) throw metadataError;
}
async function uploadExtractedImageToCatalog(
  organizationId: string,
  storeId: string,
  catalogItemId: string,
  image: { fileName: string; mimeType: string; dataUrl: string },
  sortOrder: number
) {
  const blob = dataUrlToBlob(image.dataUrl);
  const extension = buildSafeImportedImageExtension(image.fileName, image.mimeType);
  const filePath = `${organizationId}/${storeId}/${catalogItemId}/${Date.now()}-${sortOrder}.${extension}`;
  const { error: uploadError } = await defaultSupabase.storage
    .from("store-catalog-photos")
    .upload(filePath, blob, {
      upsert: false,
      contentType: image.mimeType || blob.type || "image/jpeg",
    });
  if (uploadError) throw uploadError;
  const { error: metadataError } = await defaultSupabase.from("store_catalog_item_photos").insert({
    catalog_item_id: catalogItemId,
    storage_path: filePath,
    file_name: image.fileName,
    file_size_bytes: blob.size,
    sort_order: sortOrder,
  });
  if (metadataError) throw metadataError;
}
async function clearCatalogItemPhotos(catalogItemId: string) {
  const { data: existingPhotos, error: existingPhotosError } = await defaultSupabase
    .from("store_catalog_item_photos")
    .select("id, storage_path")
    .eq("catalog_item_id", catalogItemId);

  if (existingPhotosError) throw existingPhotosError;

  const storagePaths = (existingPhotos ?? [])
    .map((photo) => String(photo.storage_path || "").trim())
    .filter(Boolean);

  if (storagePaths.length > 0) {
    const { error: removeStorageError } = await defaultSupabase.storage
      .from("store-catalog-photos")
      .remove(storagePaths);

    if (removeStorageError) {
      console.error("[OnboardingPage] clearCatalogItemPhotos remove storage error:", removeStorageError);
    }
  }

  const { error: deleteMetadataError } = await defaultSupabase
    .from("store_catalog_item_photos")
    .delete()
    .eq("catalog_item_id", catalogItemId);

  if (deleteMetadataError) throw deleteMetadataError;
}

async function replaceCatalogItemPhotos(
  organizationId: string,
  storeId: string,
  catalogItemId: string,
  images: Array<{ fileName: string; mimeType: string; dataUrl: string }>
) {
  const normalizedImages = images.filter((image) => Boolean(String(image?.dataUrl || "").trim()));
  if (normalizedImages.length === 0) return;

  await clearCatalogItemPhotos(catalogItemId);

  for (let index = 0; index < normalizedImages.length; index += 1) {
    await uploadExtractedImageToCatalog(
      organizationId,
      storeId,
      catalogItemId,
      normalizedImages[index],
      index
    );
  }
}
function SectionTitle({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-2">
      <h2 className="text-sm font-medium text-gray-900">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-gray-500">{hint}</p> : null}
    </div>
  );
}
function InfoBlock({
  title,
  description,
  subtle = false,
}: {
  title: string;
  description: string;
  subtle?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-xl border px-4 py-3",
        subtle
          ? "border-gray-200 bg-gray-50 text-gray-700"
          : "border-amber-300 bg-amber-50 text-amber-900"
      )}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm leading-6">{description}</p>
    </div>
  );
}
export default function IntelligentCatalogImportPanel({
  organizationId,
  storeId,
  storageKey,
  source = "onboarding_intelligent_import",
  disabled = false,
  supabaseClient = defaultSupabase,
  onError,
  onSuccess,
  onSaved,
  afterSaveBehavior,
}: IntelligentCatalogImportPanelProps) {
  const supabase = supabaseClient;
  const intelligentImportStorageKey = storageKey;

  function setParentError(message: string | null) {
    onError?.(message);
  }

  function setParentSuccess(message: string | null) {
    onSuccess?.(message);
  }

  const lastVisualPdfFileRef = useRef<File | null>(null);
  const [intelligentImportFiles, setIntelligentImportFiles] = useState<File[]>([]);
  const [intelligentImportSelectedFilesPreview, setIntelligentImportSelectedFilesPreview] = useState<
    IntelligentImportSelectedFilePreview[]
  >([]);
  const [intelligentImportLoading, setIntelligentImportLoading] = useState(false);
  const [intelligentImportError, setIntelligentImportError] = useState<string | null>(null);
  const [intelligentImportSuccess, setIntelligentImportSuccess] = useState<string | null>(null);
  const [intelligentImportRecovered, setIntelligentImportRecovered] = useState(false);
  const [intelligentImportResult, setIntelligentImportResult] =
    useState<IntelligentImportResponse | null>(null);
  const [editableStructuredCandidates, setEditableStructuredCandidates] = useState<
    EditableStructuredImportCandidate[]
  >([]);
  const [structuredReviewFilter, setStructuredReviewFilter] =
    useState<StructuredReviewListFilter>("all");
  const [structuredReviewSearchQuery, setStructuredReviewSearchQuery] = useState("");
  const [structuredReviewRevisionVersion, setStructuredReviewRevisionVersion] = useState(0);
  const [structuredReviewGlobalConfirmation, setStructuredReviewGlobalConfirmation] =
    useState<IntelligentImportGlobalReviewConfirmation | null>(null);
  const [structuredReviewPendingAction, setStructuredReviewPendingAction] =
    useState<StructuredReviewAction | null>(null);
  const [structuredCandidateDrafts, setStructuredCandidateDrafts] = useState<
    Record<string, StructuredCandidateDraft>
  >({});
  const [editingStructuredCandidateId, setEditingStructuredCandidateId] = useState<string | null>(null);
  const [structuredCandidateEditorDraft, setStructuredCandidateEditorDraft] =
    useState<StructuredCandidateDraft | null>(null);
  const [structuredDuplicateReferences, setStructuredDuplicateReferences] =
    useState<StructuredDuplicateReferenceData>(createEmptyStructuredDuplicateReferenceData);
  const [structuredDuplicateReferencesLoading, setStructuredDuplicateReferencesLoading] =
    useState(false);
  const parserDebugEnabled = useMemo(() => shouldEnableParserDebugFromLocation(), []);
  const isDebugParserMode = parserDebugEnabled;
  const [savingImportedCatalog, setSavingImportedCatalog] = useState(false);
  const [importedCatalogDryRunResult, setImportedCatalogDryRunResult] =
    useState<IntelligentImportSaveApprovedResponse | null>(null);
  const [importedCatalogDryRunPayload, setImportedCatalogDryRunPayload] =
    useState<IntelligentImportSaveApprovedRequest | null>(null);
  const [importedCatalogMediaRefDebug, setImportedCatalogMediaRefDebug] =
    useState<ImportedSelectedMediaRefDebug | null>(null);
  const [visualCatalogLoading, setVisualCatalogLoading] = useState(false);
  const [visualCatalogResult, setVisualCatalogResult] =
    useState<VisualCatalogImportResponse | null>(null);
  const [visualCatalogError, setVisualCatalogError] = useState<string | null>(null);
  const [visualCatalogPage, setVisualCatalogPage] = useState(1);
  const [visualCatalogSessionCache, setVisualCatalogSessionCache] = useState<
    Record<string, VisualCatalogImportResponse>
  >({});
  const [visualCatalogNotice, setVisualCatalogNotice] = useState<string | null>(null);
  const [editableVisualCatalogDrafts, setEditableVisualCatalogDrafts] = useState<
    EditableVisualCatalogDraft[]
  >([]);
  const visualReviewSourceSignatureRef = useRef<string | null>(null);
  const latestExtractedImagePreviewRef = useRef<VisualReviewExtractedImagePreview[]>([]);
  const [visualReviewItems, setVisualReviewItems] = useState<EditableVisualReviewItem[]>([]);
  const [visualReviewSaveResult, setVisualReviewSaveResult] = useState<VisualReviewSaveResult | null>(null);
  const [expandedVisualReviewImage, setExpandedVisualReviewImage] = useState<{
    itemId: string;
    key: string;
    dataUrl: string;
    fileName: string;
    pageNumber: number;
  } | null>(null);
  const [visualEvidencePagesInput, setVisualEvidencePagesInput] = useState("3,4,5,12");
  const visualEvidencePagesManuallyEditedRef = useRef(false);
  const [visualEvidenceLoading, setVisualEvidenceLoading] = useState(false);
  const [visualEvidenceError, setVisualEvidenceError] = useState<string | null>(null);
  const [visualEvidenceNotice, setVisualEvidenceNotice] = useState<string | null>(null);
  const [visualEvidenceResult, setVisualEvidenceResult] =
    useState<VisualCatalogDocumentScanResponse | null>(null);
  const [visualEvidenceSessionCache, setVisualEvidenceSessionCache] = useState<
    Record<string, VisualCatalogDocumentScanResponse>
  >({});
  const [visualDocumentMapLoading, setVisualDocumentMapLoading] = useState(false);
  const [visualDocumentMapError, setVisualDocumentMapError] = useState<string | null>(null);
  const [visualDocumentMapResult, setVisualDocumentMapResult] =
    useState<VisualCatalogDocumentMapResponse | null>(null);
  const [visualDocumentMapSessionCache, setVisualDocumentMapSessionCache] = useState<
    Record<string, VisualCatalogDocumentMapResponse>
  >({});
  const visualPdfFileMeta = useMemo(() => {
    const file =
      intelligentImportFiles.find((item) => String(item.name || "").toLowerCase().endsWith(".pdf")) ??
      intelligentImportSelectedFilesPreview.find((item) => String(item.name || "").toLowerCase().endsWith(".pdf"));
    return file ? getVisualAnalysisFileMeta(file) : null;
  }, [intelligentImportFiles, intelligentImportSelectedFilesPreview]);

  const visibleIntelligentImportFiles = useMemo(() => {
    if (intelligentImportFiles.length > 0) {
      return intelligentImportFiles.map((file) => ({
        name: file.name,
        type: file.type || "tipo n?o informado",
        size: file.size,
        lastModified: file.lastModified,
      }));
    }
    return intelligentImportSelectedFilesPreview;
  }, [intelligentImportFiles, intelligentImportSelectedFilesPreview]);
  const selectedImagePreviews = useMemo(() => {
    return intelligentImportFiles
      .filter((file) => isImageLikeFileType(file.type))
      .map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
      }));
  }, [intelligentImportFiles]);
  const safeExtractedPreview = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) return [];
    return Array.isArray(intelligentImportResult.extractedPreview)
      ? intelligentImportResult.extractedPreview
      : [];
  }, [intelligentImportResult]);
  const safeNormalizedPreview = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) return [];
    return Array.isArray(intelligentImportResult.normalizedPreview)
      ? intelligentImportResult.normalizedPreview
      : [];
  }, [intelligentImportResult]);
  const safeDedupedPreview = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) return [];
    return Array.isArray(intelligentImportResult.dedupedPreview)
      ? intelligentImportResult.dedupedPreview
      : [];
  }, [intelligentImportResult]);
  const safeExtractedImagePreview = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) return [];
    const candidate = intelligentImportResult.extractedImagePreview;
    return Array.isArray(candidate) ? candidate : [];
  }, [intelligentImportResult]);
  useEffect(() => {
    latestExtractedImagePreviewRef.current = safeExtractedImagePreview;
  }, [safeExtractedImagePreview]);
  const visualEvidencePageImagePreview = useMemo(
    () => buildVisualReviewImagePreviewsFromScanResult(visualEvidenceResult, visualPdfFileMeta?.name),
    [visualEvidenceResult, visualPdfFileMeta?.name]
  );
  const visualReviewImagePreview = useMemo(
    () => mergeVisualReviewImagePreviews(safeExtractedImagePreview, visualEvidencePageImagePreview),
    [safeExtractedImagePreview, visualEvidencePageImagePreview]
  );
  const blockedVisualReviewImagePages = useMemo(
    () =>
      buildBlockedVisualReviewImagePages({
        documentMap: visualDocumentMapResult,
        evidence: visualEvidenceResult,
      }),
    [visualDocumentMapResult, visualEvidenceResult]
  );
  const hasVisualPdfImportResult = useMemo(
    () => Boolean(intelligentImportResult && isVisualPdfImportResult(intelligentImportResult)),
    [intelligentImportResult]
  );
  const structuredSourceCandidates = useMemo(() => {
    if (!intelligentImportResult?.ok || hasVisualPdfImportResult) return [];

    const rawSourceItems =
      safeDedupedPreview.length > 0
        ? safeDedupedPreview
        : safeNormalizedPreview;
    const filteredSourceItems = rawSourceItems.filter((item) => !shouldSkipImportedItem(item));
    return safeDedupedPreview.length > 0
      ? filteredSourceItems
      : dedupeImportedItemsForSave(filteredSourceItems);
  }, [intelligentImportResult, hasVisualPdfImportResult, safeDedupedPreview, safeNormalizedPreview]);
  const structuredSourceCandidatesSignature = useMemo(
    () =>
      structuredSourceCandidates
        .map(
          (item, index) =>
            `${buildImportedSaveKey(item)}::${item.sourceFileName}::${item.type}::${index}`
        )
        .join("||"),
    [structuredSourceCandidates]
  );
  const structuredReviewValidation = useMemo(() => {
    const candidateItems = editableStructuredCandidates.map((candidate) =>
      buildStructuredReviewedSourceItem(candidate, structuredCandidateDrafts[candidate.id])
    );
    const validation = computeStructuredPreSaveValidation({
      items: candidateItems,
      existingReferences: structuredDuplicateReferences,
    });

    const byCandidateId = new Map<string, StructuredReviewCandidateValidation>();
    editableStructuredCandidates.forEach((candidate, index) => {
      const reviewedItem = candidateItems[index];
      const evaluatedItem = validation.evaluatedItems[index];
      byCandidateId.set(candidate.id, {
        candidateId: candidate.id,
        item: reviewedItem,
        destination: evaluatedItem?.destination ?? resolveImportedDestination(reviewedItem),
        duplicateReason: evaluatedItem?.duplicateReason ?? null,
      });
    });

    return {
      byCandidateId,
      duplicateCount: validation.blockedItems.length,
    };
  }, [editableStructuredCandidates, structuredCandidateDrafts, structuredDuplicateReferences]);
  const structuredSelectedCandidates = useMemo(
    () =>
      editableStructuredCandidates.filter((candidate) => {
        const candidateValidation = structuredReviewValidation.byCandidateId.get(candidate.id);
        return candidate.selected && !candidateValidation?.duplicateReason;
      }),
    [editableStructuredCandidates, structuredReviewValidation]
  );
  const structuredUnifiedReviewItems = useMemo<StructuredUnifiedReviewItem[]>(() => {
    const stagedMediaAssets = getStagedMediaAssetsFromResult(intelligentImportResult);
    return editableStructuredCandidates.map((candidate) => {
      const candidateValidation = structuredReviewValidation.byCandidateId.get(candidate.id) ?? null;
      const reviewedItem = candidateValidation?.item || candidate.sourceItem;
      const duplicateReason = candidateValidation?.duplicateReason ?? null;
      const photoResolution = resolveStructuredReviewPhotoResolution({
        item: reviewedItem,
        images: safeExtractedImagePreview,
        stagedMediaAssets,
        confirmedDocxImageKeys: structuredCandidateDrafts[candidate.id]?.confirmedDocxImageKeys ?? [],
      });
      const sourceFileName = String(
        extractImportedOriginalSourceFileName(reviewedItem) || reviewedItem.sourceFileName || ""
      ).trim();
      const sourceSheetName = String(extractImportedSourceSheetName(reviewedItem) || "").trim();
      const worksheetRowNumber = extractImportedWorksheetRowNumber(reviewedItem);
      const displayName =
        String(structuredCandidateDrafts[candidate.id]?.name || "").trim() ||
        buildStructuredReviewDisplayName(reviewedItem, candidate.finalCategory);
      const sku = normalizeImportedSkuPlaceholder(
        String(structuredCandidateDrafts[candidate.id]?.sku || "").trim() ||
          String(resolveImportedCatalogSku(reviewedItem) || "").trim()
      );
      const stockQuantity = extractImportedCatalogStockQuantity(reviewedItem);
      const stockLabel =
        String(structuredCandidateDrafts[candidate.id]?.stock || "").trim() ||
        (typeof stockQuantity === "number" && Number.isFinite(stockQuantity) ? String(stockQuantity) : "");
      const priceLabel =
        formatStructuredDraftPriceLabel(structuredCandidateDrafts[candidate.id]?.price || "") ||
        formatStructuredReviewPriceLabel(reviewedItem);
      const descriptionSnippet = candidateValidation?.item
        ? buildStructuredReviewDescriptionSnippet(candidateValidation.item)
        : String(structuredCandidateDrafts[candidate.id]?.description || "").trim()
          ? buildStructuredDraftDescriptionSnippet(structuredCandidateDrafts[candidate.id]?.description || "")
          : buildStructuredReviewDescriptionSnippet(reviewedItem);
      const shouldDowngradeManualReviewToWarning = isSafeStructuredManualReviewAutoApproval({
        item: reviewedItem,
        photoResolution,
        duplicateBlocked: Boolean(duplicateReason),
      });
      const rawBlockingReasons = buildStructuredReviewIgnoreReasons(reviewedItem, duplicateReason);
      const blockingReasons = rawBlockingReasons.filter((reason) => {
        const normalizedReason = normalizeImportedLoose(reason);
        if (normalizedReason.includes("sem sku") || normalizedReason.includes("sku nao informado")) {
          return false;
        }
        if (!shouldDowngradeManualReviewToWarning) return true;
        return !normalizedReason.includes("marcado para revisao na origem");
      });
      const signals = getStructuredReviewSignalList(reviewedItem);
      const warnings: string[] = [];
      if (
        rawBlockingReasons.some((reason) => {
          const normalizedReason = normalizeImportedLoose(reason);
          return normalizedReason.includes("sem sku") || normalizedReason.includes("sku nao informado");
        })
      ) {
        warnings.push("SKU nao informado.");
      }
      if (shouldDowngradeManualReviewToWarning) {
        warnings.push("Revisao recomendada pela origem.");
      } else if (
        signals.some((signal) => normalizeImportedLoose(signal).includes("weak_source_signal"))
      ) {
        warnings.push("Origem sugeriu revisao adicional deste item.");
      }
      if (photoResolution.state === "ambiguous") {
        warnings.push("Foto encontrada com associacao ambigua. Nenhuma foto foi escolhida automaticamente.");
        blockingReasons.push("Foto encontrada com associacao ambigua.");
      } else if (photoResolution.state === "evidence") {
        if (photoResolution.evidenceState === "weak_confirmed") {
          warnings.push("Fotos do DOCX confirmadas localmente para este produto.");
        } else {
          warnings.push("Fotos do DOCX encontradas como evidencia confirmavel. Confirme antes de incluir no catalogo.");
        }
      } else if (photoResolution.state === "none") {
        warnings.push("Nenhuma foto associada.");
      }
      return {
        candidate,
        candidateValidation,
        reviewedItem,
        displayName,
        sku,
        priceLabel,
        stockLabel,
        descriptionSnippet,
        originLabel: buildStructuredReviewOriginLabel(reviewedItem),
        sourceFileName,
        sourceSheetName,
        worksheetRowNumber,
        sourceLocationKey: buildImportedSourceLocationKey(reviewedItem),
        sourceKind: reviewedItem.type,
        confidencePercent: Math.round((reviewedItem.confidence || 0) * 100),
        stateLabel: duplicateReason
          ? "Nao sera salvo"
          : candidate.manuallyIgnored
            ? "Ignorado manualmente"
          : candidate.selected
            ? "Selecionado para salvar"
            : "Revisar antes de salvar",
        hasLocalEdits: Boolean(structuredCandidateDrafts[candidate.id]),
        categoryAdjusted: candidate.finalCategory !== candidate.initialCategory,
        duplicateReason,
        photoResolution,
        warnings,
        blockingReasons,
      };
    });
  }, [
    editableStructuredCandidates,
    intelligentImportResult,
    safeExtractedImagePreview,
    structuredCandidateDrafts,
    structuredReviewValidation,
  ]);
  const structuredReviewCounts = useMemo(() => {
    return structuredUnifiedReviewItems.reduce(
      (acc, item) => {
        acc.found += 1;
        const status = getStructuredReviewListStatus(item);
        if (status === "selected") acc.selected += 1;
        else if (status === "ignored") acc.ignored += 1;
        else acc.deselected += 1;
        return acc;
      },
      {
        found: 0,
        selected: 0,
        deselected: 0,
        ignored: 0,
      }
    );
  }, [structuredUnifiedReviewItems]);
  const structuredReviewSnapshot = useMemo<IntelligentImportStructuredReviewSnapshot | null>(() => {
    if (structuredUnifiedReviewItems.length === 0) return null;
    const entries = structuredUnifiedReviewItems.map((item, index) => {
      const saveItem = buildReviewedImportedSaveItem(item.reviewedItem, index, {
        duplicateBlocked: Boolean(item.duplicateReason),
        photoResolution: item.photoResolution,
      });
      return {
        candidateKey: String(saveItem.clientItemId || item.candidate.id).trim() || item.candidate.id,
        finalCategory: item.candidate.finalCategory,
        finalFingerprint: buildStructuredReviewFinalFingerprint(saveItem),
        humanReviewConfirmed: hasStructuredReviewHumanConfirmationValue(
          item.reviewedItem.metadata as Record<string, unknown> | null | undefined
        ),
        reviewRequired: Boolean(saveItem.reviewRequired),
        state: getStructuredReviewListStatus(item),
      } satisfies IntelligentImportStructuredReviewSnapshotEntry;
    });
    return {
      entries,
      kind: "structured_review_v1",
      revisionVersion: structuredReviewRevisionVersion,
    };
  }, [structuredReviewRevisionVersion, structuredUnifiedReviewItems]);
  const structuredReviewStateSignature = useMemo(
    () => buildStructuredReviewStateSignature(structuredReviewSnapshot?.entries ?? []),
    [structuredReviewSnapshot]
  );
  const structuredReviewHasGlobalConfirmation = useMemo(
    () =>
      structuredReviewCounts.selected > 0 &&
      structuredReviewGlobalConfirmation?.confirmed === true &&
      structuredReviewGlobalConfirmation.reviewStateSignature === structuredReviewStateSignature,
    [structuredReviewCounts.selected, structuredReviewGlobalConfirmation, structuredReviewStateSignature]
  );
  const normalizedStructuredReviewSearchQuery = useMemo(
    () => normalizeImportedLoose(structuredReviewSearchQuery),
    [structuredReviewSearchQuery]
  );
  const filteredStructuredUnifiedReviewItems = useMemo(
    () =>
      structuredUnifiedReviewItems.filter((item) => {
        const status = getStructuredReviewListStatus(item);
        if (structuredReviewFilter !== "all" && status !== structuredReviewFilter) {
          return false;
        }
        if (!normalizedStructuredReviewSearchQuery) return true;
        return buildStructuredReviewSearchText(item).includes(normalizedStructuredReviewSearchQuery);
      }),
    [normalizedStructuredReviewSearchQuery, structuredReviewFilter, structuredUnifiedReviewItems]
  );
  useEffect(() => {
    const stagedMediaAssets = getStagedMediaAssetsFromResult(intelligentImportResult);
    const builtCandidates = buildEditableStructuredImportCandidates(
      structuredSourceCandidates,
      safeExtractedImagePreview,
      stagedMediaAssets
    );

    emitStructuredSelectionRuntimeDebug({
      items: structuredSourceCandidates,
      builtCandidates,
      images: safeExtractedImagePreview,
      stagedMediaAssets,
    });

    if (shouldEnableParserDebugFromLocation()) {
      const before = structuredSourceCandidates
        .map((item) => {
          const photoResolution = resolveStructuredReviewPhotoResolution({
            item,
            images: safeExtractedImagePreview,
            stagedMediaAssets,
            confirmedDocxImageKeys: [],
          });
          return buildStructuredSelectionDebugSnapshot({
            item,
            photoResolution,
            selected: null,
          });
        })
        .filter(Boolean);
      const after = builtCandidates
        .map((candidate) => {
          const photoResolution = resolveStructuredReviewPhotoResolution({
            item: candidate.sourceItem,
            images: safeExtractedImagePreview,
            stagedMediaAssets,
            confirmedDocxImageKeys: [],
          });
          return buildStructuredSelectionDebugSnapshot({
            item: candidate.sourceItem,
            photoResolution,
            selected: candidate.selected,
          });
        })
        .filter(Boolean);

      if (before.length > 0 || after.length > 0) {
        console.info("[ZION P8 selection-debug]", {
          phase: "structured-candidate-init",
          before,
          after,
        });
      }
    }

    setEditableStructuredCandidates(builtCandidates);
  }, [intelligentImportResult, safeExtractedImagePreview, structuredSourceCandidatesSignature]);
  useEffect(() => {
    setStructuredCandidateDrafts({});
    setEditingStructuredCandidateId(null);
    setStructuredCandidateEditorDraft(null);
    setStructuredReviewFilter("all");
    setStructuredReviewSearchQuery("");
    setStructuredReviewRevisionVersion(0);
    setStructuredReviewGlobalConfirmation(null);
    setStructuredReviewPendingAction(null);
  }, [structuredSourceCandidatesSignature]);
  useEffect(() => {
    if (!organizationId || !storeId || hasVisualPdfImportResult || editableStructuredCandidates.length === 0) {
      setStructuredDuplicateReferences(createEmptyStructuredDuplicateReferenceData());
      setStructuredDuplicateReferencesLoading(false);
      return;
    }

    let cancelled = false;
    setStructuredDuplicateReferencesLoading(true);

    void loadStructuredDuplicateReferenceData({
      supabase,
      organizationId,
      storeId,
    })
      .then((references) => {
        if (cancelled) return;
        setStructuredDuplicateReferences(references);
      })
      .catch((error) => {
        console.error("[OnboardingPage] loadStructuredDuplicateReferenceData error:", error);
        if (cancelled) return;
        setStructuredDuplicateReferences(createEmptyStructuredDuplicateReferenceData());
      })
      .finally(() => {
        if (cancelled) return;
        setStructuredDuplicateReferencesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editableStructuredCandidates.length, hasVisualPdfImportResult, organizationId, storeId, supabase]);
  const editingStructuredCandidate = useMemo(
    () =>
      editingStructuredCandidateId
        ? editableStructuredCandidates.find((candidate) => candidate.id === editingStructuredCandidateId) ?? null
        : null,
    [editableStructuredCandidates, editingStructuredCandidateId]
  );
  const editingStructuredPhotoResolution = useMemo(
    () =>
      editingStructuredCandidateId
        ? structuredUnifiedReviewItems.find((item) => item.candidate.id === editingStructuredCandidateId)?.photoResolution ?? null
        : null,
    [editingStructuredCandidateId, structuredUnifiedReviewItems]
  );
  const visualPdfTotalPages = useMemo(() => {
    const pageNumbers = safeExtractedImagePreview
      .filter((image) => String(image.source || "").toLowerCase() === "pdf")
      .map((image) =>
        typeof image.worksheetRowNumber === "number"
          ? image.worksheetRowNumber
          : typeof image.imageOrder === "number"
            ? image.imageOrder + 1
            : 0
      )
      .filter((value) => Number.isFinite(value) && value > 0);
    return pageNumbers.length > 0 ? Math.max(...pageNumbers) : null;
  }, [safeExtractedImagePreview]);
  const visualProductCandidates = useMemo(
    () => consolidateVisualProductCandidates(visualEvidenceResult),
    [visualEvidenceResult]
  );
  const visualDocumentAnalysis = useMemo(() => {
    const selectedPages = visualEvidencePagesInput
      .split(/[,\s;]+/g)
      .map((value) => Number(String(value).replace(/[^\d]/g, "")))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.floor(value));

    return buildVisualDocumentAnalysis({
      documentMap: visualDocumentMapResult,
      pageEvidence: visualEvidenceResult,
      productCandidates: visualProductCandidates,
      totalPages: visualPdfTotalPages,
      selectedPages,
      detailedScanPages: visualEvidenceResult?.ok ? visualEvidenceResult.requestedPages : [],
    });
  }, [
    visualDocumentMapResult,
    visualEvidenceResult,
    visualProductCandidates,
    visualPdfTotalPages,
    visualEvidencePagesInput,
  ]);
  const visualLinkedEvidenceSummary = useMemo(
    () => buildVisualLinkedEvidenceSummary(visualDocumentAnalysis),
    [visualDocumentAnalysis]
  );
  const visualConsolidatedCandidateSummary = useMemo(
    () => formatVisualConsolidatedCandidateSummary(visualDocumentAnalysis),
    [visualDocumentAnalysis]
  );
  const visualReviewCandidatesSignature = useMemo(
    () => buildVisualReviewCandidatesSignature(visualDocumentAnalysis.consolidatedReviewCandidates),
    [visualDocumentAnalysis.consolidatedReviewCandidates]
  );
  const visualReviewCounts = useMemo(
    () => ({
      approved: visualReviewItems.filter((item) => item.reviewState === "approved").length,
      pending: visualReviewItems.filter((item) => item.reviewState === "pending").length,
      ignored: visualReviewItems.filter((item) => item.reviewState === "ignored").length,
    }),
    [visualReviewItems]
  );
  const visualReviewDuplicateDiagnostics = useMemo(
    () => buildVisualReviewDuplicateDiagnostics(visualReviewItems),
    [visualReviewItems]
  );
  const visualReviewSavePreview = useMemo(() => {
    const approvedItems = visualReviewItems.filter((item) => item.reviewState === "approved");
    const reviewedItems = approvedItems.map(buildVisualReviewSavePreviewItem);
    return {
      approvedItems,
      readyItems: reviewedItems.filter((entry) => entry.blockers.length === 0),
      blockedItems: reviewedItems.filter((entry) => entry.blockers.length > 0),
      reviewedItems,
    };
  }, [visualReviewItems]);
  const visualReviewSelectedImageSummary = useMemo<VisualReviewSelectedImageSummary>(() => {
    let readyToUploadItemCount = 0;
    let selectedImageCount = 0;
    let withoutPhotoCount = 0;
    let noSelectionCount = 0;
    let relatedWithoutPreviewCount = 0;

    for (const item of visualReviewSavePreview.approvedItems) {
      const selectedImageKeys = getVisualReviewSelectedImageKeys(item);
      const selectedImages = getSelectedVisualReviewImagesForUpload(
        item,
        visualReviewImagePreview,
        visualPdfFileMeta?.name,
        blockedVisualReviewImagePages
      );
      const suggestions = getVisualReviewSuggestedImages(
        item,
        visualReviewImagePreview,
        visualPdfFileMeta?.name,
        blockedVisualReviewImagePages
      );

      if (selectedImages.length > 0) {
        readyToUploadItemCount += 1;
        selectedImageCount += selectedImages.length;
      } else if (isVisualReviewMarkedWithoutPhoto(item)) {
        withoutPhotoCount += 1;
      } else if (selectedImageKeys.length === 0) {
        noSelectionCount += 1;
      }

      if (selectedImages.length === 0 && suggestions.hasPageMatchWithoutPreview) {
        relatedWithoutPreviewCount += 1;
      }
    }

    return {
      readyToUploadItemCount,
      selectedImageCount,
      withoutPhotoCount,
      noSelectionCount,
      relatedWithoutPreviewCount,
    };
  }, [blockedVisualReviewImagePages, visualReviewImagePreview, visualPdfFileMeta?.name, visualReviewSavePreview.approvedItems]);
  const visualEvidencePageSummary = useMemo(
    () => summarizeVisualEvidencePages(visualEvidenceResult),
    [visualEvidenceResult]
  );
  const analyzedVisualEvidencePages = useMemo(
    () => getAnalyzedVisualEvidencePages(visualEvidenceResult),
    [visualEvidenceResult]
  );
  const visualDetailedScanPages = useMemo(() => {
    if (!visualEvidenceResult?.ok) return [];
    return normalizeVisualAnalysisPageList(
      visualEvidenceResult.requestedPages.length > 0
        ? visualEvidenceResult.requestedPages
        : visualEvidenceResult.pageEvidence.map((page) => page.pageNumber)
    );
  }, [visualEvidenceResult]);
  const nextVisualRecommendedPagesBatch = useMemo(
    () => getNextVisualRecommendedPagesBatch(visualDocumentMapResult, visualEvidenceResult),
    [visualDocumentMapResult, visualEvidenceResult]
  );
  const intelligentImportDiagnostics = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) {
      return {
        previewItems: 0,
        saveCandidateItems: 0,
        duplicates: 0,
        imagesWithOriginClues: 0,
        destinationCounts: {
          pools: 0,
          quimicos: 0,
          acessorios: 0,
          outros: 0,
        },
        formatWarnings: [] as string[],
      };
    }

    const saveCandidates =
      safeDedupedPreview.length > 0
        ? safeDedupedPreview.filter((item) => !item.isDuplicate)
        : safeNormalizedPreview;

    const destinationCounts = {
      pools: 0,
      quimicos: 0,
      acessorios: 0,
      outros: 0,
    };

    for (const item of saveCandidates) {
      const destination = resolveImportedDestination(item);
      if (destination === "pool") destinationCounts.pools += 1;
      else if (destination === "quimicos") destinationCounts.quimicos += 1;
      else if (destination === "acessorios") destinationCounts.acessorios += 1;
      else destinationCounts.outros += 1;
    }

    const imagesWithOriginClues = safeExtractedImagePreview.filter((image) =>
      Boolean(image.sheetScopedKey || image.worksheetRowNumber || image.anchorCell || image.sheetName)
    ).length;

    return {
      previewItems: safeDedupedPreview.length || safeNormalizedPreview.length,
      saveCandidateItems: saveCandidates.length,
      duplicates: safeDedupedPreview.filter((item) => item.isDuplicate).length,
      imagesWithOriginClues,
      destinationCounts,
      formatWarnings: buildIntelligentImportFormatWarnings({
        extractedPreview: safeExtractedPreview,
        selectedFiles: visibleIntelligentImportFiles,
      }),
    };
  }, [
    intelligentImportResult,
    safeDedupedPreview,
    safeExtractedImagePreview,
    safeExtractedPreview,
    safeNormalizedPreview,
    visibleIntelligentImportFiles,
  ]);
  useEffect(() => {
    setVisualReviewItems((current) => {
      if (!visualReviewCandidatesSignature) {
        if (current.some((item) => item.dirty)) return current;
        visualReviewSourceSignatureRef.current = null;
        return [];
      }

      const hasDirtyItems = current.some((item) => item.dirty);
      const sourceChanged = visualReviewSourceSignatureRef.current !== visualReviewCandidatesSignature;
      if (hasDirtyItems && current.length > 0 && sourceChanged) {
        return current;
      }

      visualReviewSourceSignatureRef.current = visualReviewCandidatesSignature;
      if (!sourceChanged && current.length > 0) {
        return current;
      }

      return buildEditableVisualReviewItemsFromCandidates(
        visualDocumentAnalysis.consolidatedReviewCandidates
      );
    });
  }, [visualDocumentAnalysis.consolidatedReviewCandidates, visualReviewCandidatesSignature]);
  useEffect(() => {
    return () => {
      for (const preview of selectedImagePreviews) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [selectedImagePreviews]);

  function restoreVisualAnalysisCache(cache: PersistedVisualAnalysisCache) {
    if (!cache.visualEvidenceResult?.ok) {
      setVisualDocumentMapResult(cache.visualDocumentMapResult);
      setVisualDocumentMapError(null);
      setVisualEvidenceResult(null);
      setVisualEvidenceNotice(null);
      return;
    }
    const pages = normalizeVisualAnalysisPageList(cache.pages);
    const pagesInput = cache.visualEvidencePagesInput || pages.join(",");
    const previewCacheImages = readVisualAnalysisPreviewCache({
      organizationId,
      storeId,
      file: cache.file,
    });
    const restoredPagePreviews = previewCacheImages
      .map((image) => {
        const pageNumber = getVisualReviewImagePageNumber(image) ?? 0;
        const dataUrl = String(image.dataUrl || "").trim();
        if (
          String(image.source || "").toLowerCase() !== "pdf" ||
          !pageNumber ||
          !dataUrl
        ) {
          return null;
        }
        const sourceFileName = String(
          image.originalSourceFileName || image.sourceFileName || cache.file.name
        ).trim();
        return {
          pageNumber,
          dataUrl,
          mimeType: image.mimeType || "image/png",
          fileName: image.fileName || `${sourceFileName || cache.file.name}#page-${pageNumber}`,
          sourceFileName,
        };
      })
      .filter((preview): preview is NonNullable<typeof preview> => Boolean(preview));
    const restoredVisualEvidenceResult =
      restoredPagePreviews.length > 0
        ? {
            ...cache.visualEvidenceResult,
            pagePreviews: restoredPagePreviews,
          }
        : cache.visualEvidenceResult;
    setVisualEvidencePagesInputFromSystem(pagesInput, { force: true });
    setVisualDocumentMapResult(cache.visualDocumentMapResult);
    setVisualDocumentMapError(null);
    setVisualEvidenceResult(restoredVisualEvidenceResult);
    setVisualEvidenceError(null);
    setVisualEvidenceNotice(null);
    if (!intelligentImportResult?.ok) {
      const restoredImportResult = buildRestoredVisualPdfImportResult({
        file: cache.file,
        totalPages: cache.visualPdfTotalPages,
        extractedImagePreview: previewCacheImages,
      });
      latestExtractedImagePreviewRef.current = restoredImportResult.ok
        ? restoredImportResult.extractedImagePreview ?? []
        : [];
      setIntelligentImportResult(restoredImportResult);
    }
    setIntelligentImportSelectedFilesPreview((current) =>
      current.length > 0
        ? current
        : [
            {
              name: cache.file.name,
              type: "application/pdf",
              size: cache.file.size,
              lastModified: cache.file.lastModified,
            },
          ]
    );
    if (cache.visualEvidenceResult?.ok && pages.length > 0) {
      const evidenceCacheKey = `${cache.file.name}::${cache.file.size}::${pages.join(",")}`;
      setVisualEvidenceSessionCache((current) => ({
        ...current,
        [evidenceCacheKey]: restoredVisualEvidenceResult as VisualCatalogDocumentScanResponse,
      }));
    }
    if (cache.visualDocumentMapResult?.ok) {
      const mapCacheKey = `${cache.file.name}::${cache.file.size}::document-map`;
      setVisualDocumentMapSessionCache((current) => ({
        ...current,
        [mapCacheKey]: cache.visualDocumentMapResult as VisualCatalogDocumentMapResponse,
      }));
    }
  }

  function readCurrentVisualAnalysisCache(pages: number[]) {
    if (!visualPdfFileMeta) return null;
    return readVisualAnalysisCache({
      organizationId,
      storeId,
      file: visualPdfFileMeta,
      pages,
    });
  }

  function persistCurrentVisualAnalysisCache(params: {
    pages: number[];
    visualDocumentMapResult: VisualCatalogDocumentMapResponse | null;
    visualEvidenceResult: VisualCatalogDocumentScanResponse | null;
    visualEvidencePagesInput?: string;
  }) {
    if (!visualPdfFileMeta) return;
    const previewPages = new Set(normalizeVisualAnalysisPageList(params.pages));
    if (params.visualEvidenceResult?.ok) {
      for (const evidence of params.visualEvidenceResult.pageEvidence) {
        const pageNumber = Math.floor(Number(evidence.pageNumber || 0));
        if (Number.isFinite(pageNumber) && pageNumber > 0) previewPages.add(pageNumber);
      }
    }
    for (const candidate of visualDocumentAnalysis.consolidatedReviewCandidates) {
      for (const pageNumber of candidate.sourcePages) {
        const normalizedPage = Math.floor(Number(pageNumber || 0));
        if (Number.isFinite(normalizedPage) && normalizedPage > 0) previewPages.add(normalizedPage);
      }
    }
    for (const item of visualReviewItems) {
      for (const pageNumber of item.sourcePages) {
        const normalizedPage = Math.floor(Number(pageNumber || 0));
        if (Number.isFinite(normalizedPage) && normalizedPage > 0) previewPages.add(normalizedPage);
      }
    }
    const freshEvidenceImagePreview = buildVisualReviewImagePreviewsFromScanResult(
      params.visualEvidenceResult,
      visualPdfFileMeta.name
    );
    const currentExtractedImagePreview = mergeVisualReviewImagePreviews(
      mergeVisualReviewImagePreviews(visualReviewImagePreview, latestExtractedImagePreviewRef.current),
      freshEvidenceImagePreview
    );
    const extractedImagePreview = buildVisualAnalysisCacheImagePreviews({
      images: currentExtractedImagePreview,
      pages: Array.from(previewPages),
      fileName: visualPdfFileMeta.name,
    });
    writeVisualAnalysisPreviewCache(
      {
        organizationId,
        storeId,
        file: visualPdfFileMeta,
      },
      extractedImagePreview
    );
    writeVisualAnalysisCache(
      {
        organizationId,
        storeId,
        file: visualPdfFileMeta,
        pages: params.pages,
      },
      {
        visualEvidencePagesInput: params.visualEvidencePagesInput || params.pages.join(","),
        visualPdfTotalPages: visualPdfTotalPages ?? (params.visualDocumentMapResult?.ok ? params.visualDocumentMapResult.totalPages : null),
        visualDocumentMapResult: params.visualDocumentMapResult,
        visualEvidenceResult: params.visualEvidenceResult,
      }
    );
  }

  function setVisualEvidencePagesInputFromSystem(value: string, options?: { force?: boolean }) {
    if (options?.force || !visualEvidencePagesManuallyEditedRef.current) {
      setVisualEvidencePagesInput(value);
    }
  }

  function handleRedoVisualAnalysis() {
    if (visualPdfFileMeta) {
      removeVisualAnalysisCacheForFile({
        organizationId,
        storeId,
        file: visualPdfFileMeta,
      });
    }
    visualEvidencePagesManuallyEditedRef.current = true;
    setVisualEvidencePagesInput("3,4,5,12,10");
    setVisualEvidenceResult(null);
    setVisualEvidenceSessionCache({});
    setVisualDocumentMapResult(null);
    setVisualDocumentMapSessionCache({});
    setVisualDocumentMapError(null);
    setVisualEvidenceError(null);
    visualReviewSourceSignatureRef.current = null;
    setVisualReviewItems([]);
    setVisualEvidenceNotice("Analise salva removida. Para gerar uma nova analise, clique em Testar paginas.");
  }

  useEffect(() => {
    if (!visualPdfFileMeta || visualEvidenceResult || visualEvidenceLoading || visualDocumentMapLoading) return;
    const cached = readLatestVisualAnalysisCacheForFile({
      organizationId,
      storeId,
      file: visualPdfFileMeta,
    });
    if (!cached) return;
    restoreVisualAnalysisCache(cached);
  }, [
    organizationId,
    storeId,
    visualPdfFileMeta,
    visualEvidenceResult,
    visualEvidenceLoading,
    visualDocumentMapLoading,
  ]);

  function clearIntelligentImportState() {
    const pages = normalizeVisualAnalysisPages(
      visualEvidencePagesInput
        .split(/[,\s;]+/g)
        .map((value) => Number(String(value).replace(/[^\d]/g, "")))
    );
    if (visualPdfFileMeta && pages.length > 0) {
      removeVisualAnalysisCache({
        organizationId,
        storeId,
        file: visualPdfFileMeta,
        pages,
      });
      removeVisualAnalysisPreviewCacheForFile({
        organizationId,
        storeId,
        file: visualPdfFileMeta,
      });
    }
    lastVisualPdfFileRef.current = null;
    visualEvidencePagesManuallyEditedRef.current = false;
    setIntelligentImportFiles([]);
    setIntelligentImportSelectedFilesPreview([]);
    setIntelligentImportError(null);
    setIntelligentImportSuccess(null);
    setImportedCatalogDryRunResult(null);
    setImportedCatalogDryRunPayload(null);
    setImportedCatalogMediaRefDebug(null);
    latestExtractedImagePreviewRef.current = [];
    setIntelligentImportResult(null);
    setVisualCatalogResult(null);
    setVisualCatalogError(null);
    setVisualCatalogPage(1);
    setVisualCatalogSessionCache({});
    setVisualCatalogNotice(null);
    setEditableVisualCatalogDrafts([]);
    visualReviewSourceSignatureRef.current = null;
    setVisualReviewItems([]);
    setVisualEvidenceError(null);
    setVisualEvidenceNotice(null);
    setVisualEvidenceResult(null);
    setVisualEvidenceSessionCache({});
    setVisualDocumentMapError(null);
    setVisualDocumentMapResult(null);
    setVisualDocumentMapSessionCache({});
    setIntelligentImportRecovered(false);
    setStructuredReviewFilter("all");
    setStructuredReviewSearchQuery("");
    setStructuredReviewRevisionVersion(0);
    setStructuredReviewGlobalConfirmation(null);
    setStructuredReviewPendingAction(null);
    if (intelligentImportStorageKey && typeof window !== "undefined") {
      removeFromLocalStorageSafe(intelligentImportStorageKey);
    }
  }
  async function handleRunIntelligentImport() {
    if (intelligentImportFiles.length === 0) {
      setIntelligentImportError(
        `Nenhum arquivo valido para importar. Use ${INTELLIGENT_IMPORT_SUPPORTED_FORMATS_ERROR_LABEL}.`
      );
      return;
    }
    if (!organizationId || !storeId) {
      setIntelligentImportError("Não foi possível identificar a organização e a loja ativa.");
      return;
    }
    if (intelligentImportFiles.length === 0) {
      setIntelligentImportError(
        "Selecione pelo menos um arquivo para testar a importação inteligente novamente."
      );
      return;
    }
    setIntelligentImportLoading(true);
    setIntelligentImportError(null);
    setIntelligentImportSuccess(null);
    setImportedCatalogDryRunResult(null);
    setImportedCatalogDryRunPayload(null);
    setImportedCatalogMediaRefDebug(null);
    latestExtractedImagePreviewRef.current = [];
    setIntelligentImportResult(null);
    setVisualCatalogResult(null);
    setVisualCatalogError(null);
    setVisualCatalogPage(1);
    setVisualCatalogSessionCache({});
    setVisualCatalogNotice(null);
    setEditableVisualCatalogDrafts([]);
    visualReviewSourceSignatureRef.current = null;
    setVisualReviewItems([]);
    setVisualEvidenceError(null);
    setVisualEvidenceNotice(null);
    setVisualEvidenceResult(null);
    setVisualEvidenceSessionCache({});
    setVisualDocumentMapError(null);
    setVisualDocumentMapResult(null);
    setVisualDocumentMapSessionCache({});
    setIntelligentImportRecovered(false);
    try {
      const selectedFilesPreview = await buildSelectedFilePreviews(intelligentImportFiles);
      setIntelligentImportSelectedFilesPreview(selectedFilesPreview);

      const formData = new FormData();
      formData.append("organizationId", organizationId);
      formData.append("storeId", storeId);
      if (shouldEnableParserDebugFromLocation()) {
        formData.append("debugParser", "true");
      }
      for (const file of intelligentImportFiles) {
        formData.append("files", file);
      }
      const response = await fetch("/api/onboarding/intelligent-import", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as IntelligentImportResponse;
      const friendlyResultMessage = normalizeIntelligentImportErrorMessage(
        result.message || "Falha ao processar a importaÃ§Ã£o inteligente."
      );
      void friendlyResultMessage;
      if (!response.ok || !result.ok) {
        setIntelligentImportError(result.message || "Falha ao processar a importação inteligente.");
        setIntelligentImportResult(result);
        return;
      }
      const decoratedResult = decorateIntelligentImportResultWithImageFallback(result, selectedFilesPreview);
      const frontendReadyResult = normalizeIntelligentImportResultForFrontend(decoratedResult);
      latestExtractedImagePreviewRef.current = frontendReadyResult.ok
        ? frontendReadyResult.extractedImagePreview ?? []
        : [];
      setIntelligentImportResult(frontendReadyResult);
      if (isVisualPdfImportResult(frontendReadyResult)) {
        const automaticEvidencePages = selectAutomaticVisualEvidencePages(
          getVisualPdfTotalPagesFromResult(frontendReadyResult)
        );
        setVisualCatalogPage(1);
        setVisualEvidencePagesInputFromSystem(automaticEvidencePages.join(","));
        void handleRunVisualCatalogBase({ resetResult: false, page: 1 });
        await handleRunVisualDocumentMapAndEvidenceScan(automaticEvidencePages);
      }
      setIntelligentImportSuccess(
        frontendReadyResult.message || "Importação inteligente processada com sucesso."
      );
    } catch (error) {
      console.error("[OnboardingPage] handleRunIntelligentImport error:", error);
      setIntelligentImportError("Erro inesperado ao testar a importação inteligente.");
    } finally {
      setIntelligentImportLoading(false);
    }
  }

  async function handleRunVisualCatalogBase(options?: { resetResult?: boolean; page?: number }) {
    const resetResult = options?.resetResult ?? true;
    const requestedPage = Math.max(1, Math.floor(options?.page ?? visualCatalogPage));
    const pageToAnalyze = visualPdfTotalPages
      ? Math.min(requestedPage, visualPdfTotalPages)
      : requestedPage;
    const pdfFile = intelligentImportFiles.find((file) =>
      String(file.name || "").toLowerCase().endsWith(".pdf")
    );

    if (!pdfFile) {
      setVisualCatalogError("Selecione um PDF visual para analisar as primeiras paginas.");
      return;
    }

    const cacheKey = buildVisualCatalogSessionCacheKey(pdfFile, pageToAnalyze);
    const cachedResult = visualCatalogSessionCache[cacheKey];
    if (cachedResult) {
      setVisualCatalogResult(cachedResult);
      setEditableVisualCatalogDrafts(buildEditableVisualCatalogDrafts(cachedResult));
      setVisualCatalogError(null);
      setVisualCatalogNotice("Resultado reaproveitado desta sessao.");
      return;
    }

    setVisualCatalogLoading(true);
    setVisualCatalogError(null);
    setVisualCatalogNotice(null);
    if (resetResult) {
      setVisualCatalogResult(null);
      setEditableVisualCatalogDrafts([]);
    }

    try {
      const formData = new FormData();
      formData.append("file", pdfFile);
      formData.append("pageStart", String(pageToAnalyze));
      formData.append("pageLimit", "1");

      const response = await fetch("/api/onboarding/visual-catalog-import", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as VisualCatalogImportResponse;

      if (!response.ok || !result.ok) {
        setVisualCatalogError(
          !result.ok ? result.message : "Falha ao criar base visual do catalogo."
        );
        setVisualCatalogResult(result);
        setEditableVisualCatalogDrafts([]);
        return;
      }

      setVisualCatalogResult(result);
      setEditableVisualCatalogDrafts(buildEditableVisualCatalogDrafts(result));
      setVisualCatalogSessionCache((current) => ({
        ...current,
        [cacheKey]: result,
      }));
    } catch (error) {
      console.error("[OnboardingPage] handleRunVisualCatalogBase error:", error);
      setVisualCatalogError("Erro inesperado ao criar base visual do catalogo.");
      setEditableVisualCatalogDrafts([]);
    } finally {
      setVisualCatalogLoading(false);
    }
  }

  function updateEditableVisualCatalogDraft(
    draftId: string,
    patch: Partial<EditableVisualCatalogDraft>
  ) {
    setEditableVisualCatalogDrafts((current) =>
      current.map((draft) =>
        draft.id === draftId
          ? cleanupEditableVisualMissingFields({ ...draft, ...patch })
          : draft
      )
    );
  }

  function updateEditableVisualReviewItem(
    itemId: string,
    patch: Partial<EditableVisualReviewItem>
  ) {
    setVisualReviewItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? cleanupEditableVisualReviewMissingFields({ ...item, ...patch, dirty: true })
          : item
      )
    );
  }

  function updateStructuredReviewCandidate(
    candidateId: string,
    patch: Partial<EditableStructuredImportCandidate>
  ) {
    let changed = false;
    setEditableStructuredCandidates((current) =>
      current.map((candidate) =>
        candidate.id === candidateId
          ? (() => {
              const nextCandidate = { ...candidate, ...patch };
              if (JSON.stringify(nextCandidate) !== JSON.stringify(candidate)) {
                changed = true;
              }
              return nextCandidate;
            })()
          : candidate
      )
    );
    if (typeof patch.finalCategory !== "undefined") {
      const nextFinalCategory = patch.finalCategory;
      setStructuredCandidateDrafts((current) => {
        const existingDraft = current[candidateId];
        if (!existingDraft) return current;
        return {
          ...current,
          [candidateId]: {
            ...existingDraft,
            finalCategory: nextFinalCategory,
          },
        };
      });
      setStructuredCandidateEditorDraft((current) =>
        editingStructuredCandidateId === candidateId && current
          ? { ...current, finalCategory: nextFinalCategory }
          : current
      );
    }
    if (changed) {
      setStructuredReviewRevisionVersion((current) => current + 1);
      setStructuredReviewPendingAction(null);
    }
  }

  function openStructuredCandidateEditor(candidate: EditableStructuredImportCandidate) {
    const existingDraft = structuredCandidateDrafts[candidate.id];
    setEditingStructuredCandidateId(candidate.id);
    setStructuredCandidateEditorDraft(
      existingDraft
        ? {
            ...existingDraft,
            finalCategory: candidate.finalCategory,
          }
        : buildStructuredCandidateDraft(candidate.sourceItem, candidate.finalCategory)
    );
  }

  function closeStructuredCandidateEditor() {
    setEditingStructuredCandidateId(null);
    setStructuredCandidateEditorDraft(null);
  }

  function applyStructuredCandidateEditorChanges() {
    if (!editingStructuredCandidateId || !structuredCandidateEditorDraft) return;
    const currentDraft = structuredCandidateDrafts[editingStructuredCandidateId];
    const currentCandidate = editableStructuredCandidates.find(
      (candidate) => candidate.id === editingStructuredCandidateId
    );
    const changed =
      !areStructuredReviewDraftsEqual(currentDraft, structuredCandidateEditorDraft) ||
      currentCandidate?.finalCategory !== structuredCandidateEditorDraft.finalCategory;

    setStructuredCandidateDrafts((current) => ({
      ...current,
      [editingStructuredCandidateId]: structuredCandidateEditorDraft,
    }));

    setEditableStructuredCandidates((current) =>
      current.map((candidate) =>
        candidate.id === editingStructuredCandidateId
          ? { ...candidate, finalCategory: structuredCandidateEditorDraft.finalCategory }
          : candidate
      )
    );
    if (changed) {
      setStructuredReviewRevisionVersion((current) => current + 1);
      setStructuredReviewPendingAction(null);
    }

    closeStructuredCandidateEditor();
  }

  function ensureStructuredReviewGlobalConfirmation(action: StructuredReviewAction) {
    if (structuredReviewCounts.selected === 0) {
      setParentError(
        action === "dry-run" ? "Nenhum item selecionado para validar." : "Nenhum item selecionado para salvar."
      );
      return false;
    }
    if (structuredReviewHasGlobalConfirmation) {
      return true;
    }
    setStructuredReviewPendingAction(action);
    setParentError(null);
    setParentSuccess(null);
    return false;
  }

  function buildStructuredReviewGlobalConfirmationPayload() {
    if (!structuredReviewHasGlobalConfirmation || !structuredReviewGlobalConfirmation) {
      return null;
    }
    return {
      ...structuredReviewGlobalConfirmation,
      reviewStateSignature: structuredReviewStateSignature,
      revisionVersion: structuredReviewRevisionVersion,
      summary: {
        deselectedCount: structuredReviewCounts.deselected,
        foundCount: structuredReviewCounts.found,
        ignoredCount: structuredReviewCounts.ignored,
        selectedCount: structuredReviewCounts.selected,
      },
    } satisfies IntelligentImportGlobalReviewConfirmation;
  }

  async function runVisualEvidenceScanBatch(params: {
    pdfFile: File;
    pages: number[];
    mapResult: VisualCatalogDocumentMapResponse | null;
    currentResult: VisualCatalogDocumentScanResponse | null;
    notice?: string | null;
    resetResult?: boolean;
  }) {
    const requestedPages = normalizeVisualAnalysisPages(params.pages);
    if (requestedPages.length === 0) return params.currentResult?.ok ? params.currentResult : null;

    const cacheKey = buildVisualEvidenceSessionCacheKey(params.pdfFile, requestedPages);
    const cachedResult =
      visualEvidenceSessionCache[cacheKey] ??
      readVisualAnalysisCache({
        organizationId,
        storeId,
        file: getVisualAnalysisFileMeta(params.pdfFile),
        pages: requestedPages,
      })?.visualEvidenceResult;

    if (cachedResult?.ok) {
      const mergedResult = params.currentResult?.ok
        ? mergeVisualEvidenceResults(params.currentResult, cachedResult)
        : cachedResult;
      setVisualEvidenceResult(mergedResult);
      setVisualEvidencePagesInputFromSystem(mergedResult.requestedPages.join(","));
      setVisualEvidenceError(null);
      if (params.notice !== null) {
        setVisualEvidenceNotice(params.notice || "Resultado visual reaproveitado desta sessao.");
      }
      setVisualEvidenceSessionCache((current) => ({
        ...current,
        [cacheKey]: cachedResult,
        [buildVisualEvidenceSessionCacheKey(params.pdfFile, mergedResult.requestedPages)]: mergedResult,
      }));
      persistCurrentVisualAnalysisCache({
        pages: mergedResult.requestedPages,
        visualEvidencePagesInput: mergedResult.requestedPages.join(","),
        visualDocumentMapResult: params.mapResult,
        visualEvidenceResult: mergedResult,
      });
      return mergedResult;
    }

    setVisualEvidenceLoading(true);
    setVisualEvidenceError(null);
    if (params.notice !== null) {
      setVisualEvidenceNotice(params.notice || "Analisando paginas do PDF...");
    }
    if (params.resetResult) {
      setVisualEvidenceResult(null);
    }

    try {
      const formData = new FormData();
      formData.append("file", params.pdfFile);
      formData.append("pages", requestedPages.join(","));

      const response = await fetch("/api/onboarding/visual-catalog-document-scan", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as VisualCatalogDocumentScanResponse;

      if (!response.ok || !result.ok) {
        setVisualEvidenceError(
          !result.ok ? result.message : "Falha ao analisar paginas do PDF."
        );
        setVisualEvidenceNotice("A analise visual parou neste ponto. O resultado ja encontrado foi preservado.");
        return params.currentResult?.ok ? params.currentResult : null;
      }

      const mergedResult = params.currentResult?.ok
        ? mergeVisualEvidenceResults(params.currentResult, result)
        : result;
      setVisualEvidenceResult(mergedResult);
      setVisualEvidencePagesInputFromSystem(mergedResult.requestedPages.join(","));
      setVisualEvidenceSessionCache((current) => ({
        ...current,
        [cacheKey]: result,
        [buildVisualEvidenceSessionCacheKey(params.pdfFile, mergedResult.requestedPages)]: mergedResult,
      }));
      persistCurrentVisualAnalysisCache({
        pages: mergedResult.requestedPages,
        visualEvidencePagesInput: mergedResult.requestedPages.join(","),
        visualDocumentMapResult: params.mapResult,
        visualEvidenceResult: mergedResult,
      });
      return mergedResult;
    } catch (error) {
      console.error("[OnboardingPage] runVisualEvidenceScanBatch error:", error);
      setVisualEvidenceError("Erro inesperado ao analisar paginas do PDF.");
      setVisualEvidenceNotice("A analise visual parou neste ponto. O resultado ja encontrado foi preservado.");
      return params.currentResult?.ok ? params.currentResult : null;
    } finally {
      setVisualEvidenceLoading(false);
    }
  }

  async function runRemainingVisualRecommendedBatches(params: {
    pdfFile: File;
    mapResult: VisualCatalogDocumentMapSuccess;
    currentResult: VisualCatalogDocumentScanResponse | null;
    maxRecommendedPages?: number;
  }) {
    let mergedResult = params.currentResult;
    const maxRecommendedPages =
      params.maxRecommendedPages ?? VISUAL_ANALYSIS_MAIN_FLOW_MAX_RECOMMENDED_PAGES;
    const recommendedPages = normalizeVisualAnalysisPageList(params.mapResult.recommendedPages).slice(
      0,
      maxRecommendedPages
    );
    const totalRemainingBatches = Math.max(1, Math.ceil(recommendedPages.length / 5));
    let batchIndex = 0;
    let lastAnalyzedSignature = "";

    while (batchIndex < totalRemainingBatches + 1) {
      const analyzedPages = new Set(
        normalizeVisualAnalysisPageList([
          ...(mergedResult?.ok ? mergedResult.requestedPages : []),
          ...getAnalyzedVisualEvidencePages(mergedResult),
        ])
      );
      const analyzedSignature = Array.from(analyzedPages).sort((a, b) => a - b).join(",");
      if (analyzedSignature && analyzedSignature === lastAnalyzedSignature) break;
      lastAnalyzedSignature = analyzedSignature;

      const nextPages = normalizeVisualAnalysisPages(
        recommendedPages.filter((pageNumber) => !analyzedPages.has(pageNumber))
      );
      if (nextPages.length === 0) {
        break;
      }

      const displayBatch = batchIndex + 2;
      const displayTotal = Math.max(displayBatch, totalRemainingBatches + 1);
      setVisualEvidenceNotice(`Analisando lote ${displayBatch} de ${displayTotal}...`);
      const nextResult = await runVisualEvidenceScanBatch({
        pdfFile: params.pdfFile,
        pages: nextPages,
        mapResult: params.mapResult,
        currentResult: mergedResult,
        notice: `Analisando lote ${displayBatch} de ${displayTotal}...`,
        resetResult: false,
      });

      if (!nextResult?.ok || nextResult === mergedResult) {
        break;
      }

      const nextAnalyzedPages = normalizeVisualAnalysisPageList([
        ...nextResult.requestedPages,
        ...getAnalyzedVisualEvidencePages(nextResult),
      ]);
      if (nextAnalyzedPages.join(",") === analyzedSignature) {
        break;
      }

      mergedResult = nextResult;
      batchIndex += 1;
    }

    if (mergedResult?.ok) {
      const analyzedRecommendedPages = new Set(
        normalizeVisualAnalysisPageList([
          ...mergedResult.requestedPages,
          ...getAnalyzedVisualEvidencePages(mergedResult),
        ])
      );
      const pendingRecommendedPages = recommendedPages.filter((pageNumber) => !analyzedRecommendedPages.has(pageNumber));
      const hasMoreRecommendedPages =
        params.mapResult.recommendedPages.length > recommendedPages.length || pendingRecommendedPages.length > 0;
      setVisualEvidenceNotice(
        hasMoreRecommendedPages
          ? "Analise visual concluida ate o limite seguro. Algumas paginas ficaram para uma analise complementar."
          : "Analise visual concluida. Revise os itens encontrados antes de salvar."
      );
    }
    return mergedResult;
  }

  async function handleRunVisualDocumentMapAndEvidenceScan(fallbackPages: number[]) {
    const pdfFile = intelligentImportFiles.find((file) =>
      String(file.name || "").toLowerCase().endsWith(".pdf")
    );
    if (!pdfFile) {
      await handleRunVisualEvidenceScan({
        pages: fallbackPages,
        resetResult: false,
        source: "auto",
      });
      return null;
    }

    let cachedEvidenceResultForContinuation: VisualCatalogDocumentScanResponse | null = null;
    const persistedCache = readLatestVisualAnalysisCacheForFile({
      organizationId,
      storeId,
      file: getVisualAnalysisFileMeta(pdfFile),
    });
    if (persistedCache) {
      restoreVisualAnalysisCache(persistedCache);
      if (persistedCache.visualDocumentMapResult?.ok && persistedCache.visualEvidenceResult?.ok) {
        const completedResult = await runRemainingVisualRecommendedBatches({
          pdfFile,
          mapResult: persistedCache.visualDocumentMapResult,
          currentResult: persistedCache.visualEvidenceResult,
        });
        return completedResult;
      }
      cachedEvidenceResultForContinuation = persistedCache.visualEvidenceResult?.ok
        ? persistedCache.visualEvidenceResult
        : null;
    }

    const cacheKey = buildVisualDocumentMapSessionCacheKey(pdfFile);
    const cachedMap = visualDocumentMapSessionCache[cacheKey];
    if (cachedMap?.ok) {
      const mappedPages = selectBalancedVisualEvidencePages(cachedMap, fallbackPages);
      const pagesToScan = mappedPages.length > 0 ? mappedPages : fallbackPages;
      setVisualDocumentMapResult(cachedMap);
      setVisualDocumentMapError(null);
      setVisualEvidencePagesInputFromSystem(pagesToScan.join(","));
      const initialResult =
        cachedEvidenceResultForContinuation?.ok
          ? cachedEvidenceResultForContinuation
          : await runVisualEvidenceScanBatch({
              pdfFile,
              pages: pagesToScan,
              mapResult: cachedMap,
              currentResult: null,
              notice: "Analisando paginas do PDF...",
              resetResult: false,
            });
      const completedResult = await runRemainingVisualRecommendedBatches({
        pdfFile,
        mapResult: cachedMap,
        currentResult: initialResult,
      });
      return completedResult;
    }

    setVisualDocumentMapLoading(true);
    setVisualDocumentMapError(null);
    setVisualDocumentMapResult(null);
    setVisualEvidenceNotice("Mapeando paginas do catalogo...");

    try {
      const formData = new FormData();
      formData.append("file", pdfFile);
      formData.append("allPages", "true");

      const response = await fetch("/api/onboarding/visual-catalog-document-map", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as VisualCatalogDocumentMapResponse;

      if (!response.ok || !result.ok) {
        setVisualDocumentMapError(
          !result.ok ? result.message : "Falha ao mapear paginas do catalogo."
        );
        await handleRunVisualEvidenceScan({
          pages: fallbackPages,
          resetResult: false,
          source: "auto",
        });
        return null;
      }

      const mappedPages = selectBalancedVisualEvidencePages(result, fallbackPages);
      const pagesToScan = mappedPages.length > 0 ? mappedPages : fallbackPages;
      setVisualDocumentMapResult(result);
      setVisualDocumentMapSessionCache((current) => ({
        ...current,
        [cacheKey]: result,
      }));
      setVisualEvidencePagesInputFromSystem(pagesToScan.join(","));
      const initialResult =
        cachedEvidenceResultForContinuation?.ok
          ? cachedEvidenceResultForContinuation
          : await runVisualEvidenceScanBatch({
              pdfFile,
              pages: pagesToScan,
              mapResult: result,
              currentResult: null,
              notice: "Analisando paginas do PDF...",
              resetResult: false,
            });
      const completedResult = await runRemainingVisualRecommendedBatches({
        pdfFile,
        mapResult: result,
        currentResult: initialResult,
      });
      return completedResult;
    } catch (error) {
      console.error("[OnboardingPage] handleRunVisualDocumentMapAndEvidenceScan error:", error);
      setVisualDocumentMapError("Nao foi possivel mapear o documento visual. Usando amostra inicial.");
      await handleRunVisualEvidenceScan({
        pages: fallbackPages,
        resetResult: false,
        source: "auto",
      });
      return null;
    } finally {
      setVisualDocumentMapLoading(false);
    }
  }

  async function handleRunVisualEvidenceScan(options?: {
    pages?: number[];
    resetResult?: boolean;
    source?: "auto" | "manual";
    mapResultForCache?: VisualCatalogDocumentMapResponse | null;
  }) {
    const pdfFile = intelligentImportFiles.find((file) =>
      String(file.name || "").toLowerCase().endsWith(".pdf")
    );
    const resetResult = options?.resetResult ?? true;
    const source = options?.source ?? "manual";
    const requestedPages = Array.from(
      new Set(
        (options?.pages ?? visualEvidencePagesInput.split(/[,\s;]+/g))
          .map((value) => Number(String(value).replace(/[^\d]/g, "")))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value))
      )
    ).slice(0, 5);

    if (!pdfFile) {
      setVisualEvidenceError("Selecione um PDF visual para gerar evidencias.");
      return;
    }
    if (requestedPages.length === 0) {
      setVisualEvidenceError("Informe pelo menos uma pagina, por exemplo 3,4,5,12.");
      return;
    }

    const persistedCache = readVisualAnalysisCache({
      organizationId,
      storeId,
      file: getVisualAnalysisFileMeta(pdfFile),
      pages: requestedPages,
    });
    if (persistedCache?.visualEvidenceResult?.ok) {
      restoreVisualAnalysisCache(persistedCache);
      return;
    }

    const cacheKey = buildVisualEvidenceSessionCacheKey(pdfFile, requestedPages);
    const cachedResult = visualEvidenceSessionCache[cacheKey];
    if (cachedResult) {
      setVisualEvidenceResult(cachedResult);
      setVisualEvidenceError(null);
      setVisualEvidenceNotice("Resultado visual reaproveitado desta sessao.");
      persistCurrentVisualAnalysisCache({
        pages: requestedPages,
        visualEvidencePagesInput: requestedPages.join(","),
        visualDocumentMapResult: options?.mapResultForCache ?? visualDocumentMapResult,
        visualEvidenceResult: cachedResult,
      });
      return;
    }

    setVisualEvidenceLoading(true);
    setVisualEvidenceError(null);
    setVisualEvidenceNotice(
      source === "auto"
        ? "O ZION esta analisando paginas importantes para montar evidencias do catalogo."
        : null
    );
    if (resetResult) {
      setVisualEvidenceResult(null);
    }

    try {
      const formData = new FormData();
      formData.append("file", pdfFile);
      formData.append("pages", requestedPages.join(","));

      const response = await fetch("/api/onboarding/visual-catalog-document-scan", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as VisualCatalogDocumentScanResponse;

      if (!response.ok || !result.ok) {
        setVisualEvidenceError(
          !result.ok ? result.message : "Falha ao gerar evidencias visuais."
        );
        setVisualEvidenceNotice(null);
        setVisualEvidenceResult(result);
        return;
      }

      setVisualEvidenceResult(result);
      setVisualEvidenceSessionCache((current) => ({
        ...current,
        [cacheKey]: result,
      }));
      persistCurrentVisualAnalysisCache({
        pages: requestedPages,
        visualEvidencePagesInput: requestedPages.join(","),
        visualDocumentMapResult: options?.mapResultForCache ?? visualDocumentMapResult,
        visualEvidenceResult: result,
      });
      setVisualEvidenceNotice(
        source === "auto"
          ? `Analise visual automatica concluida nas paginas ${requestedPages.join(", ")}.`
          : "Evidencias visuais geradas para as paginas escolhidas."
      );
    } catch (error) {
      console.error("[OnboardingPage] handleRunVisualEvidenceScan error:", error);
      setVisualEvidenceError("Erro inesperado ao gerar evidencias visuais.");
      setVisualEvidenceNotice(null);
    } finally {
      setVisualEvidenceLoading(false);
    }
  }

  async function handleRunNextVisualRecommendedPages() {
    const currentPdfFile = intelligentImportFiles.find((file) =>
      String(file.name || "").toLowerCase().endsWith(".pdf")
    );
    const lastVisualPdfFile = lastVisualPdfFileRef.current;
    const canUseLastVisualPdfFile =
      Boolean(lastVisualPdfFile) &&
      (!visualPdfFileMeta ||
        (lastVisualPdfFile?.name === visualPdfFileMeta.name &&
          lastVisualPdfFile.size === visualPdfFileMeta.size &&
          lastVisualPdfFile.lastModified === visualPdfFileMeta.lastModified));
    const pdfFile = currentPdfFile ?? (canUseLastVisualPdfFile ? lastVisualPdfFile : null);
    const requestedPages = nextVisualRecommendedPagesBatch;

    if (requestedPages.length === 0) {
      setVisualEvidenceNotice("Nao ha novas paginas sugeridas pelo mapa para analisar agora.");
      setVisualEvidenceError(null);
      return;
    }
    if (!pdfFile) {
      setVisualEvidenceError("Selecione novamente o PDF para analisar novas paginas sugeridas.");
      return;
    }

    const cacheKey = buildVisualEvidenceSessionCacheKey(pdfFile, requestedPages);
    const cachedResult =
      visualEvidenceSessionCache[cacheKey] ??
      readVisualAnalysisCache({
        organizationId,
        storeId,
        file: getVisualAnalysisFileMeta(pdfFile),
        pages: requestedPages,
      })?.visualEvidenceResult;

    if (cachedResult?.ok) {
      const mergedResult = mergeVisualEvidenceResults(visualEvidenceResult, cachedResult);
      setVisualEvidenceResult(mergedResult);
      setVisualEvidencePagesInputFromSystem(mergedResult.requestedPages.join(","));
      setVisualEvidenceError(null);
      setVisualEvidenceNotice("Paginas sugeridas reaproveitadas do cache. Nenhuma nova chamada de API foi feita.");
      setVisualEvidenceSessionCache((current) => ({
        ...current,
        [cacheKey]: cachedResult,
        [buildVisualEvidenceSessionCacheKey(pdfFile, mergedResult.requestedPages)]: mergedResult,
      }));
      persistCurrentVisualAnalysisCache({
        pages: mergedResult.requestedPages,
        visualEvidencePagesInput: mergedResult.requestedPages.join(","),
        visualDocumentMapResult,
        visualEvidenceResult: mergedResult,
      });
      return;
    }

    setVisualEvidenceLoading(true);
    setVisualEvidenceError(null);
    setVisualEvidenceNotice(`Analisando paginas sugeridas pelo mapa: ${requestedPages.join(", ")}.`);

    try {
      const formData = new FormData();
      formData.append("file", pdfFile);
      formData.append("pages", requestedPages.join(","));

      const response = await fetch("/api/onboarding/visual-catalog-document-scan", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as VisualCatalogDocumentScanResponse;

      if (!response.ok || !result.ok) {
        setVisualEvidenceError(
          !result.ok ? result.message : "Falha ao analisar as proximas paginas sugeridas."
        );
        setVisualEvidenceNotice(null);
        return;
      }

      const mergedResult = mergeVisualEvidenceResults(visualEvidenceResult, result);
      setVisualEvidenceResult(mergedResult);
      setVisualEvidencePagesInputFromSystem(mergedResult.requestedPages.join(","));
      setVisualEvidenceSessionCache((current) => ({
        ...current,
        [cacheKey]: result,
        [buildVisualEvidenceSessionCacheKey(pdfFile, mergedResult.requestedPages)]: mergedResult,
      }));
      persistCurrentVisualAnalysisCache({
        pages: mergedResult.requestedPages,
        visualEvidencePagesInput: mergedResult.requestedPages.join(","),
        visualDocumentMapResult,
        visualEvidenceResult: mergedResult,
      });
      setVisualEvidenceNotice(
        `Paginas sugeridas analisadas: ${requestedPages.join(", ")}. Resultado anterior preservado.`
      );
    } catch (error) {
      console.error("[OnboardingPage] handleRunNextVisualRecommendedPages error:", error);
      setVisualEvidenceError("Erro inesperado ao analisar as proximas paginas sugeridas.");
      setVisualEvidenceNotice(null);
    } finally {
      setVisualEvidenceLoading(false);
    }
  }
  
  async function handleSaveApprovedVisualReviewItemsToCatalog() {
    if (isDebugParserMode) {
      setParentError(
        "Modo de diagnostico ativo: o salvamento visual esta bloqueado para proteger o catalogo."
      );
      return;
    }

    if (!organizationId || !storeId) {
      setParentError("Nao foi possivel identificar a organizacao e a loja ativa.");
      return;
    }

    const approvedReadyItems = visualReviewSavePreview.readyItems
      .map((entry) => entry.item)
      .filter((item) => item.reviewState === "approved" && item.name.trim() && item.category);

    if (approvedReadyItems.length === 0) {
      setParentError("Aprove ao menos um item completo antes de salvar no catalogo.");
      return;
    }

    setSavingImportedCatalog(true);
    setParentError(null);
    setParentSuccess(null);
    setVisualReviewSaveResult(null);

    let savedPools = 0;
    let savedAcessorios = 0;
    let savedQuimicos = 0;
    let savedOutros = 0;
    const savedItemIds = new Set<string>();
    const savedIdentityKeys = new Set<string>();
    const itemErrors: string[] = [];
    const savedItems: VisualReviewSaveResult["savedItems"] = [];
    const failedItems: VisualReviewSaveResult["failedItems"] = [];
    const photoFailures: VisualReviewSaveResult["photoFailures"] = [];
    let savedPhotoCount = 0;
    let failedPhotoCount = 0;

    try {
      for (const item of approvedReadyItems) {
        try {
          const identityKey = buildVisualReviewIdentityKey(item);
          if (savedIdentityKeys.has(identityKey)) continue;

          const itemName = item.name.trim();
          if (!itemName) throw new Error("Item aprovado sem nome.");
          const selectedImagesForUpload = getSelectedVisualReviewImagesForUpload(
            item,
            visualReviewImagePreview,
            visualPdfFileMeta?.name,
            blockedVisualReviewImagePages
          );

          if (item.category === "pool") {
            const metrics = parseVisualReviewPoolMetrics(item);
            if (!metrics.width_m || !metrics.length_m || !metrics.depth_m) {
              throw new Error("Piscina aprovada sem medidas suficientes.");
            }

            const priceInput = parseVisualReviewPriceInput(item.price);
            if (priceInput.error) throw new Error("Preco invalido ou ambiguo.");
            const stockQuantity = parseVisualReviewStockQuantity(item.stock);
            const description = [
              item.description.trim(),
              item.dimensionsText.trim() ? `Medidas revisadas: ${item.dimensionsText.trim()}` : "",
              item.sourcePages.length > 0 ? `Paginas de origem: ${item.sourcePages.join(", ")}` : "",
              "Origem: revisao visual do catalogo.",
            ].filter(Boolean).join("\n");
            const maxCapacity =
              metrics.max_capacity_l ?? Math.round(metrics.width_m * metrics.length_m * metrics.depth_m * 1000);
            const poolPayload = {
              width_m: metrics.width_m,
              length_m: metrics.length_m,
              depth_m: metrics.depth_m,
              shape: metrics.shape,
              material: metrics.material,
              max_capacity_l: maxCapacity,
              weight_kg: null,
              price: priceInput.amount,
              description: description || null,
              is_active: item.isActive,
              track_stock: true,
              stock_quantity: stockQuantity,
            };

            const { data: existingPool } = await supabase
              .from("pools")
              .select("id")
              .eq("organization_id", organizationId)
              .eq("store_id", storeId)
              .eq("name", itemName)
              .maybeSingle();

            let persistedPoolId: string | null = existingPool?.id ?? null;
            if (existingPool?.id) {
              const { error } = await supabase
                .from("pools")
                .update(poolPayload)
                .eq("id", existingPool.id)
                .eq("organization_id", organizationId)
                .eq("store_id", storeId);
              if (error) throw error;
            } else {
              const { data: createdPool, error } = await supabase
                .from("pools")
                .insert({
                  organization_id: organizationId,
                  store_id: storeId,
                  name: itemName,
                  ...poolPayload,
                })
                .select("id")
                .single();
              if (error) throw error;
              persistedPoolId = createdPool.id;
            }

            if (!persistedPoolId) throw new Error("Falha ao persistir a piscina revisada.");
            let itemPhotoSavedCount = 0;
            let itemPhotoFailedCount = 0;
            for (const [imageIndex, image] of selectedImagesForUpload.entries()) {
              try {
                await uploadExtractedImageToPool(
                  organizationId,
                  storeId,
                  persistedPoolId,
                  {
                    fileName: image.fileName,
                    mimeType: image.mimeType,
                    dataUrl: image.dataUrl,
                  },
                  imageIndex
                );
                itemPhotoSavedCount += 1;
                savedPhotoCount += 1;
              } catch (photoError) {
                console.error("[OnboardingPage] visual review pool photo upload error:", photoError);
                const reason = photoError instanceof Error ? photoError.message : "Erro ao salvar foto.";
                itemPhotoFailedCount += 1;
                failedPhotoCount += 1;
                photoFailures.push({ name: itemName, reason });
              }
            }
            savedPools += 1;
            savedIdentityKeys.add(identityKey);
            savedItemIds.add(item.id);
            savedItems.push({
              name: itemName,
              category: "Piscina",
              destination: "Piscinas",
              photoSavedCount: itemPhotoSavedCount,
              photoFailedCount: itemPhotoFailedCount,
            });
            continue;
          }

          const category = mapVisualReviewCategoryToCatalogCategory(item.category);
          if (!category) throw new Error("Categoria nao escolhida.");

          const cleanSku = String(item.sku || item.code || "").trim();
          const sku = cleanSku || null;
          const metadata = buildVisualReviewItemMetadata(item, category);
          const priceInput = parseVisualReviewPriceInput(item.price);
          if (priceInput.error) throw new Error("Preco invalido ou ambiguo.");
          const priceCents = priceInput.cents;
          const stockQuantity = parseVisualReviewStockQuantity(item.stock);
          const description = item.description.trim() || null;

          let existingCatalogItem: ExistingCatalogItemRow | null = null;
          if (sku) {
            const { data } = await supabase
              .from("store_catalog_items")
              .select("id, sku, price_cents, stock_quantity, description, metadata")
              .eq("organization_id", organizationId)
              .eq("store_id", storeId)
              .eq("sku", sku)
              .maybeSingle();
            existingCatalogItem = (data as ExistingCatalogItemRow | null) ?? null;
          }

          if (!existingCatalogItem) {
            const { data } = await supabase
              .from("store_catalog_items")
              .select("id, sku, price_cents, stock_quantity, description, metadata")
              .eq("organization_id", organizationId)
              .eq("store_id", storeId)
              .eq("name", itemName)
              .contains("metadata", { categoria: category })
              .maybeSingle();
            existingCatalogItem = (data as ExistingCatalogItemRow | null) ?? null;
          }

          let persistedCatalogItemId: string | null = existingCatalogItem?.id ?? null;
          if (existingCatalogItem?.id) {
            const mergedMetadata = {
              ...(existingCatalogItem.metadata ?? {}),
              ...metadata,
            } as Record<string, unknown>;
            const { error } = await supabase
              .from("store_catalog_items")
              .update({
                sku,
                name: itemName,
                description: description ?? existingCatalogItem.description ?? null,
                price_cents: priceCents ?? existingCatalogItem.price_cents ?? null,
                currency: "BRL",
                is_active: item.isActive,
                track_stock: true,
                stock_quantity: item.stock.trim() ? stockQuantity : existingCatalogItem.stock_quantity ?? 0,
                metadata: mergedMetadata,
              })
              .eq("id", existingCatalogItem.id)
              .eq("organization_id", organizationId)
              .eq("store_id", storeId);
            if (error) throw error;
          } else {
            const { data: createdItem, error } = await supabase
              .from("store_catalog_items")
              .insert({
                organization_id: organizationId,
                store_id: storeId,
                sku,
                name: itemName,
                description,
                price_cents: priceCents,
                currency: "BRL",
                is_active: item.isActive,
                track_stock: true,
                stock_quantity: stockQuantity,
                metadata,
              })
              .select("id")
              .single();
            if (error) throw error;
            persistedCatalogItemId = createdItem.id;
          }

          if (!persistedCatalogItemId) throw new Error("Falha ao persistir o item revisado.");
          let itemPhotoSavedCount = 0;
          let itemPhotoFailedCount = 0;
          if (selectedImagesForUpload.length > 0) {
            try {
              await replaceCatalogItemPhotos(
                organizationId,
                storeId,
                persistedCatalogItemId,
                selectedImagesForUpload.map((image) => ({
                  fileName: image.fileName,
                  mimeType: image.mimeType,
                  dataUrl: image.dataUrl,
                }))
              );
              itemPhotoSavedCount = selectedImagesForUpload.length;
              savedPhotoCount += selectedImagesForUpload.length;
            } catch (photoError) {
              console.error("[OnboardingPage] visual review catalog photo upload error:", photoError);
              const reason = photoError instanceof Error ? photoError.message : "Erro ao salvar fotos.";
              itemPhotoFailedCount = selectedImagesForUpload.length;
              failedPhotoCount += selectedImagesForUpload.length;
              photoFailures.push({ name: itemName, reason });
            }
          }
          if (category === "quimicos") savedQuimicos += 1;
          else if (category === "acessorios") savedAcessorios += 1;
          else savedOutros += 1;
          savedIdentityKeys.add(identityKey);
          savedItemIds.add(item.id);
          savedItems.push({
            name: itemName,
            category:
              category === "quimicos"
                ? "Quimico"
                : category === "acessorios"
                  ? "Acessorio"
                  : "Outro",
            destination:
              category === "quimicos"
                ? "Catalogo > Quimicos"
                : category === "acessorios"
                  ? "Catalogo > Acessorios"
                  : "Catalogo > Outros",
            photoSavedCount: itemPhotoSavedCount,
            photoFailedCount: itemPhotoFailedCount,
          });
        } catch (itemError) {
          console.error("[OnboardingPage] handleSaveApprovedVisualReviewItemsToCatalog item error:", itemError);
          const label = item.name || item.sku || item.code || "Item sem nome";
          const reason = itemError instanceof Error ? itemError.message : "Erro inesperado.";
          itemErrors.push(`${label}: ${reason}`);
          failedItems.push({ name: label, reason });
        }
      }

      const totalSaved = savedPools + savedAcessorios + savedQuimicos + savedOutros;
      const saveResult: VisualReviewSaveResult = {
        savedCount: totalSaved,
        failedCount: failedItems.length,
        savedPhotoCount,
        failedPhotoCount,
        savedItems,
        failedItems,
        photoFailures,
        savedByCategory: {
          piscinas: savedPools,
          quimicos: savedQuimicos,
          acessorios: savedAcessorios,
          outros: savedOutros,
        },
      };
      setVisualReviewSaveResult(saveResult);

      if (totalSaved === 0) {
        setParentError(
          itemErrors.length > 0
            ? `Nenhum item foi salvo. Primeiras falhas: ${itemErrors.slice(0, 5).join(" | ")}`
            : "Nenhum item aprovado ficou pronto para salvar."
        );
        return;
      }

      setVisualReviewItems((current) =>
        current.map((item) =>
          savedItemIds.has(item.id) ? { ...item, saved: true, dirty: false } : item
        )
      );
      setParentSuccess(
        `${totalSaved} item(ns) salvos. Piscinas: ${savedPools}. Quimicos: ${savedQuimicos}. Acessorios: ${savedAcessorios}. Outros: ${savedOutros}.` +
          (savedPhotoCount > 0 ? ` Fotos salvas: ${savedPhotoCount}.` : "") +
          (failedPhotoCount > 0 ? ` ${failedPhotoCount} foto(s) falharam.` : "") +
          (itemErrors.length > 0 ? ` ${itemErrors.length} falharam: ${itemErrors.slice(0, 5).join(" | ")}` : "")
      );
      await onSaved?.();
      void afterSaveBehavior?.();
    } catch (error) {
      console.error("[OnboardingPage] handleSaveApprovedVisualReviewItemsToCatalog error:", error);
      setParentError(error instanceof Error ? error.message : "Erro ao salvar itens aprovados.");
    } finally {
      setSavingImportedCatalog(false);
    }
  }

  async function handleSaveImportedItemsToCatalog(options?: {
    globalReviewConfirmationOverride?: IntelligentImportGlobalReviewConfirmation | null;
    skipGlobalConfirmation?: boolean;
  }) {
    if (!organizationId || !storeId) {
      setParentError("Nao foi possivel identificar a organizacao e a loja ativa.");
      return;
    }
    if (!intelligentImportResult || !intelligentImportResult.ok) {
      setParentError("Faca a importacao inteligente antes de salvar no sistema.");
      return;
    }
    if (!options?.skipGlobalConfirmation && !ensureStructuredReviewGlobalConfirmation("save")) {
      return;
    }

    const reviewedSourceItems =
      editableStructuredCandidates.length > 0
        ? buildStructuredSelectedReviewedSourceItems({
            candidates: editableStructuredCandidates,
            drafts: structuredCandidateDrafts,
            validationByCandidateId: structuredReviewValidation.byCandidateId,
          })
        : [];

    const rawSourceItems =
      reviewedSourceItems.length > 0
        ? reviewedSourceItems
        : intelligentImportResult.dedupedPreview.length > 0
          ? intelligentImportResult.dedupedPreview.filter((item) => !item.isDuplicate)
          : intelligentImportResult.normalizedPreview;

    const filteredSourceItems = rawSourceItems.filter((item) => !shouldSkipImportedItem(item));
    const sourceItems =
      reviewedSourceItems.length > 0
        ? filteredSourceItems
        : dedupeImportedItemsForSave(filteredSourceItems);

    if (sourceItems.length === 0) {
      setParentError(
        editableStructuredCandidates.length > 0
          ? "Nenhum item selecionado para salvar."
          : isVisualPdfImportResult(intelligentImportResult)
            ? VISUAL_PDF_IMPORT_MESSAGE
            : "A analise nao encontrou itens prontos para salvar. Tente um arquivo mais direto ou revise a importacao."
      );
      return;
    }

    const payloadItems = sourceItems.map((item, index) =>
      buildReviewedImportedSaveItem(item, index, {
        duplicateBlocked: false,
        photoResolution: resolveStructuredReviewPhotoResolution({
          item,
          images: safeExtractedImagePreview,
          stagedMediaAssets: getStagedMediaAssetsFromResult(intelligentImportResult),
          confirmedDocxImageKeys: [],
        }),
      })
    );
    const candidateIdByItemKey = new Map(
      editableStructuredCandidates.map((candidate) => [buildImportedSaveKey(candidate.sourceItem), candidate.id])
    );
    const confirmedDocxImageKeysByItemKey = Object.fromEntries(
      sourceItems.map((item) => {
        const itemKey = buildImportedSaveKey(item);
        const candidateId = candidateIdByItemKey.get(itemKey);
        return [itemKey, candidateId ? structuredCandidateDrafts[candidateId]?.confirmedDocxImageKeys ?? [] : []];
      })
    );
    const selectedMediaRefBuild = buildSelectedMediaRefsForSave({
      confirmedDocxImageKeysByItemKey,
      images: safeExtractedImagePreview,
      importedFiles: getImportedFilesFromResult(intelligentImportResult),
      items: sourceItems,
      stagedMediaAssets: getStagedMediaAssetsFromResult(intelligentImportResult),
    });
    const importedFileIds = getImportedRawFileIdsFromResult(intelligentImportResult);
    const globalReviewConfirmation =
      options?.globalReviewConfirmationOverride ?? buildStructuredReviewGlobalConfirmationPayload();
    const buildRequestBody = (
      validateOnly: boolean
    ): IntelligentImportSaveApprovedRequest => ({
      context: {
        debugParser: parserDebugEnabled,
        source: source || "intelligent_catalog_import",
      },
      importedFileIds,
      items: payloadItems,
      organizationId,
      reviewAudit: {
        globalReviewConfirmation,
        structuredReviewSnapshot,
      },
      selectedMediaRefs: selectedMediaRefBuild.selectedMediaRefs,
      storeId,
      validateOnly,
    });

    const buildIssueDetails = (result: IntelligentImportSaveApprovedResponse) =>
      result.items
        .filter((item) => item.status !== "valid" && item.status !== "saved")
        .slice(0, 5)
        .map((item) => {
          const fallbackName = payloadItems[item.inputIndex]?.name || `Item ${item.inputIndex + 1}`;
          const name = String(item.normalizedPayload?.name || fallbackName).trim() || fallbackName;
          const reason = item.reasons.join(" ").trim() || "Falha de validacao.";
          return `${name}: ${reason}`;
        })
        .join(" | ");

    const runSaveRequest = async (validateOnly: boolean) => {
      const requestBody = buildRequestBody(validateOnly);
      const response = await fetch("/api/onboarding/intelligent-import/save-approved", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const result = (await response.json()) as IntelligentImportSaveApprovedResponse;
      return {
        httpOk: response.ok,
        requestBody,
        result,
      };
    };

    if (parserDebugEnabled) {
      setParentError(
        "Salvamento real bloqueado em debugParser=true. Use o botao 'Validar salvamento sem gravar'."
      );
      return;
    }

    setSavingImportedCatalog(true);
    setParentError(null);
    setParentSuccess(null);
    setImportedCatalogDryRunResult(null);
    setImportedCatalogDryRunPayload(null);
    setImportedCatalogMediaRefDebug(selectedMediaRefBuild.debug);

    try {
      const validation = await runSaveRequest(true);
      const validationIssues = buildIssueDetails(validation.result);

      if (!validation.httpOk || !validation.result.ok) {
        setParentError(
          `${validation.result.message || "Falha ao validar os itens da importacao."}${
            validationIssues ? ` Primeiros itens: ${validationIssues}` : ""
          }`
        );
        return;
      }

      const saveAttempt = await runSaveRequest(false);
      const saveIssues = buildIssueDetails(saveAttempt.result);

      if (!saveAttempt.httpOk || !saveAttempt.result.ok) {
        setParentError(
          `${saveAttempt.result.message || "Falha ao salvar os itens da importacao."}${
            saveIssues ? ` Primeiros itens: ${saveIssues}` : ""
          }`
        );
        return;
      }

      const savedPools = saveAttempt.result.items.filter((item) => item.destination === "pool").length;
      const savedQuimicos = saveAttempt.result.items.filter(
        (item) => item.destination === "quimicos"
      ).length;
      const savedAcessorios = saveAttempt.result.items.filter(
        (item) => item.destination === "acessorios"
      ).length;
      const savedOutros = saveAttempt.result.items.filter((item) => item.destination === "outros").length;
      const promotedPhotoCount =
        saveAttempt.result.photoSaveResult?.promotedPhotos.length ??
        ((saveAttempt.result.photoSaveResult?.createdPoolPhotos ?? 0) +
          (saveAttempt.result.photoSaveResult?.createdCatalogItemPhotos ?? 0));
      const failedPhotoCount = saveAttempt.result.photoSaveResult?.failedPhotos.length ?? 0;
      const photoWarnings = saveAttempt.result.photoSaveResult?.warnings ?? [];
      const photoImportNotice =
        promotedPhotoCount > 0
          ? saveAttempt.result.photoSaveResult?.createdPoolPhotos
            ? ` Fotos de piscinas importadas: ${saveAttempt.result.photoSaveResult.createdPoolPhotos}.`
            : ` Fotos importadas: ${promotedPhotoCount}.`
          : "";
      const photoFailureNotice =
        failedPhotoCount > 0 ? ` Algumas fotos nao foram importadas: ${failedPhotoCount}.` : "";
      const photoWarningNotice =
        photoWarnings.length > 0
          ? ` Warnings de fotos: ${photoWarnings.slice(0, 2).join(" | ")}${
              photoWarnings.length > 2 ? " ..." : ""
            }`
          : "";

      setParentSuccess(
        `Importacao salva com sucesso. Piscinas: ${savedPools}. Quimicos: ${savedQuimicos}. Acessorios: ${savedAcessorios}. Outros: ${savedOutros}.${photoImportNotice}${photoFailureNotice}${photoWarningNotice}`
      );
      clearIntelligentImportState();
      await onSaved?.();
      void afterSaveBehavior?.();
    } catch (error) {
      console.error("[OnboardingPage] handleSaveImportedItemsToCatalog error:", error);
      setParentError(
        error instanceof Error ? error.message : "Erro ao salvar os itens importados no sistema."
      );
    } finally {
      setSavingImportedCatalog(false);
    }
  }

  async function handleValidateImportedItemsDryRun(options?: {
    globalReviewConfirmationOverride?: IntelligentImportGlobalReviewConfirmation | null;
    skipGlobalConfirmation?: boolean;
  }) {
    if (!organizationId || !storeId) {
      setParentError("Nao foi possivel identificar a organizacao e a loja ativa.");
      return;
    }
    if (!intelligentImportResult || !intelligentImportResult.ok) {
      setParentError("Faca a importacao inteligente antes de validar o salvamento.");
      return;
    }
    if (!options?.skipGlobalConfirmation && !ensureStructuredReviewGlobalConfirmation("dry-run")) {
      return;
    }

    const reviewedSourceItems =
      editableStructuredCandidates.length > 0
        ? buildStructuredSelectedReviewedSourceItems({
            candidates: editableStructuredCandidates,
            drafts: structuredCandidateDrafts,
            validationByCandidateId: structuredReviewValidation.byCandidateId,
          })
        : [];

    const rawSourceItems =
      reviewedSourceItems.length > 0
        ? reviewedSourceItems
        : intelligentImportResult.dedupedPreview.length > 0
          ? intelligentImportResult.dedupedPreview.filter((item) => !item.isDuplicate)
          : intelligentImportResult.normalizedPreview;

    const filteredSourceItems = rawSourceItems.filter((item) => !shouldSkipImportedItem(item));
    const sourceItems =
      reviewedSourceItems.length > 0
        ? filteredSourceItems
        : dedupeImportedItemsForSave(filteredSourceItems);

    if (sourceItems.length === 0) {
      setParentError(
        editableStructuredCandidates.length > 0
          ? "Nenhum item selecionado para validar."
          : isVisualPdfImportResult(intelligentImportResult)
            ? VISUAL_PDF_IMPORT_MESSAGE
            : "A analise nao encontrou itens prontos para validar."
      );
      return;
    }

    const payloadItems = sourceItems.map((item, index) =>
      buildReviewedImportedSaveItem(item, index, {
        duplicateBlocked: false,
        photoResolution: resolveStructuredReviewPhotoResolution({
          item,
          images: safeExtractedImagePreview,
          stagedMediaAssets: getStagedMediaAssetsFromResult(intelligentImportResult),
          confirmedDocxImageKeys: [],
        }),
      })
    );
    const candidateIdByItemKey = new Map(
      editableStructuredCandidates.map((candidate) => [buildImportedSaveKey(candidate.sourceItem), candidate.id])
    );
    const confirmedDocxImageKeysByItemKey = Object.fromEntries(
      sourceItems.map((item) => {
        const itemKey = buildImportedSaveKey(item);
        const candidateId = candidateIdByItemKey.get(itemKey);
        return [itemKey, candidateId ? structuredCandidateDrafts[candidateId]?.confirmedDocxImageKeys ?? [] : []];
      })
    );
    const selectedMediaRefBuild = buildSelectedMediaRefsForSave({
      confirmedDocxImageKeysByItemKey,
      images: safeExtractedImagePreview,
      importedFiles: getImportedFilesFromResult(intelligentImportResult),
      items: sourceItems,
      stagedMediaAssets: getStagedMediaAssetsFromResult(intelligentImportResult),
    });
    const importedFileIds = getImportedRawFileIdsFromResult(intelligentImportResult);
    const globalReviewConfirmation =
      options?.globalReviewConfirmationOverride ?? buildStructuredReviewGlobalConfirmationPayload();
    const requestBody: IntelligentImportSaveApprovedRequest = {
      context: {
        debugParser: parserDebugEnabled,
        source: source || "intelligent_catalog_import",
      },
      importedFileIds,
      items: payloadItems,
      organizationId,
      reviewAudit: {
        globalReviewConfirmation,
        structuredReviewSnapshot,
      },
      selectedMediaRefs: selectedMediaRefBuild.selectedMediaRefs,
      storeId,
      validateOnly: true,
    };

    setSavingImportedCatalog(true);
    setParentError(null);
    setParentSuccess(null);
    setImportedCatalogDryRunPayload(requestBody);
    setImportedCatalogDryRunResult(null);
    setImportedCatalogMediaRefDebug(selectedMediaRefBuild.debug);

    try {
      const response = await fetch("/api/onboarding/intelligent-import/save-approved", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const result = (await response.json()) as IntelligentImportSaveApprovedResponse;
      setImportedCatalogDryRunResult(result);

      const issueDetails = result.items
        .filter((item) => item.status !== "valid" && item.status !== "saved")
        .slice(0, 5)
        .map((item) => {
          const fallbackName = payloadItems[item.inputIndex]?.name || `Item ${item.inputIndex + 1}`;
          const name = String(item.normalizedPayload?.name || fallbackName).trim() || fallbackName;
          const reason = item.reasons.join(" ").trim() || "Falha de validacao.";
          return `${name}: ${reason}`;
        })
        .join(" | ");

      if (!response.ok || !result.ok) {
        setParentError(
          `${result.message || "Falha ao validar o salvamento sem gravar."}${
            issueDetails ? ` Primeiros itens: ${issueDetails}` : ""
          }`
        );
        return;
      }

      setParentSuccess(
        `Dry-run concluido sem gravar. Total: ${result.summary.total}. Validos: ${result.summary.valid}. Invalidos: ${result.summary.invalid}. Duplicados bloqueados: ${result.summary.blockedDuplicate}.`
      );
    } catch (error) {
      console.error("[OnboardingPage] handleValidateImportedItemsDryRun error:", error);
      setParentError(
        error instanceof Error ? error.message : "Erro ao validar o salvamento sem gravar."
      );
    } finally {
      setSavingImportedCatalog(false);
    }
  }

  useEffect(() => {
    if (!intelligentImportStorageKey || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(intelligentImportStorageKey);
    if (!raw) {
      setIntelligentImportRecovered(false);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as PersistedIntelligentImportState;
      setIntelligentImportSelectedFilesPreview(
        Array.isArray(parsed.selectedFiles) ? parsed.selectedFiles : []
      );
      latestExtractedImagePreviewRef.current = [];
      setIntelligentImportResult(null);
      setIntelligentImportSuccess(parsed.successMessage ?? null);
      setIntelligentImportError(parsed.errorMessage ?? null);
      setIntelligentImportRecovered(Boolean((parsed.selectedFiles?.length ?? 0) > 0));
    } catch (error) {
      console.error("[OnboardingPage] intelligent import restore error:", error);
      removeFromLocalStorageSafe(intelligentImportStorageKey);
      setIntelligentImportRecovered(false);
    }
  }, [intelligentImportStorageKey]);
  useEffect(() => {
    if (!intelligentImportStorageKey || typeof window === "undefined") return;
    const hasPersistedContent =
      visibleIntelligentImportFiles.length > 0 ||
      Boolean(intelligentImportSuccess) ||
      Boolean(intelligentImportError);
    if (!hasPersistedContent) {
      removeFromLocalStorageSafe(intelligentImportStorageKey);
      return;
    }
    const payload = buildLightPersistedIntelligentImportState({
      selectedFiles: visibleIntelligentImportFiles,
      successMessage: intelligentImportSuccess,
      errorMessage: intelligentImportError,
    });
    persistToLocalStorageSafe(intelligentImportStorageKey, JSON.stringify(payload));
  }, [
    intelligentImportStorageKey,
    visibleIntelligentImportFiles,
    intelligentImportSuccess,
    intelligentImportError,
  ]);
  return (
    <>
              <style>{`
                section:has([data-zion-intelligent-import-panel]) > div:first-child p {
                  display: none;
                }
              `}</style>
              <div data-zion-intelligent-import-panel className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-2.5">
                <SectionTitle
                  title="Importar catálogo, piscinas e materiais da loja"
                  hint=""
                />
                <div className="space-y-2">
                  {intelligentImportResult?.ok ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 md:flex-row md:items-center md:justify-between">
                      <p className="min-w-0 truncate">
                        <span className="font-medium text-gray-900">Arquivo analisado:</span>{" "}
                        {visibleIntelligentImportFiles[0]?.name || "catalogo importado"}
                        {visibleIntelligentImportFiles.length > 1
                          ? ` +${visibleIntelligentImportFiles.length - 1}`
                          : ""}
                      </p>
                      <button
                        type="button"
                        onClick={clearIntelligentImportState}
                        disabled={disabled || intelligentImportLoading}
                        className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-60"
                      >
                        Trocar arquivo / limpar análise
                      </button>
                    </div>
                  ) : (
                    <>
                  <input
                    type="file"
                    multiple
                    accept={INTELLIGENT_IMPORT_ACCEPT_ATTRIBUTE}
                    onChange={async (e) => {
                      const input = e.currentTarget;
                      const selectedFiles = Array.from(input.files ?? []) as File[];
                      const validFiles = selectedFiles.filter((file) =>
                        isSupportedIntelligentImportFile(file)
                      );
                      const invalidFiles = selectedFiles.filter(
                        (file) => !isSupportedIntelligentImportFile(file)
                      );
                      const selectedVisualPdfFile = validFiles.find((file) =>
                        String(file.name || "").toLowerCase().endsWith(".pdf")
                      );
                      const keepsCurrentVisualAnalysis =
                        Boolean(visualEvidenceResult?.ok || visualDocumentMapResult?.ok) &&
                        Boolean(
                          visualPdfFileMeta &&
                            selectedVisualPdfFile &&
                            selectedVisualPdfFile.name === visualPdfFileMeta.name &&
                            selectedVisualPdfFile.size === visualPdfFileMeta.size &&
                            selectedVisualPdfFile.lastModified === visualPdfFileMeta.lastModified
                      );
                      lastVisualPdfFileRef.current = selectedVisualPdfFile ?? null;
                      if (!keepsCurrentVisualAnalysis) {
                        visualEvidencePagesManuallyEditedRef.current = false;
                      }
                      setIntelligentImportFiles(validFiles);
                      setIntelligentImportSelectedFilesPreview(
                        await buildSelectedFilePreviews(validFiles)
                      );
                      setIntelligentImportRecovered(false);
                      if (invalidFiles.length > 0 && validFiles.length > 0) {
                        setIntelligentImportError(
                          formatUnsupportedIntelligentImportFiles(
                            invalidFiles.map((file) => file.name)
                          )
                        );
                      } else if (invalidFiles.length > 0) {
                        setIntelligentImportError(
                          `Nenhum arquivo valido para importar. Use ${INTELLIGENT_IMPORT_SUPPORTED_FORMATS_ERROR_LABEL}.`
                        );
                      } else {
                        setIntelligentImportError(null);
                      }
                      if (!keepsCurrentVisualAnalysis) {
                        setIntelligentImportSuccess(null);
                        latestExtractedImagePreviewRef.current = [];
                        setIntelligentImportResult(null);
                      }
                      if (input) {
                        input.value = "";
                      }
                    }}
                    className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none file:mr-3 file:rounded-md file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                  />
                  <div className="text-xs text-gray-500">
                    Formatos aceitos: {INTELLIGENT_IMPORT_SUPPORTED_FORMATS_LABEL}
                  </div>
                  <div className="hidden">
                    Você pode enviar fotos do catálogo, imagens de produtos, tabelas simples em foto, PDF, Word, Excel e PowerPoint. As imagens selecionadas aparecem em pré-visualização logo abaixo para facilitar a conferência antes do teste.
                  </div>
                  {visibleIntelligentImportFiles.length > 0 ? (
                    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 md:flex-row md:items-center md:justify-between">
                      <span className="truncate font-medium text-gray-900">
                        {visibleIntelligentImportFiles[0]?.name}
                        {visibleIntelligentImportFiles.length > 1
                          ? ` +${visibleIntelligentImportFiles.length - 1}`
                          : ""}
                      </span>
                      <span className="text-xs text-gray-500 md:text-right">
                        {visibleIntelligentImportFiles[0]?.type || "tipo não informado"} •{" "}
                        {formatFileSize(visibleIntelligentImportFiles[0]?.size ?? 0)}
                      </span>
                    </div>
                  ) : null}
                  {selectedImagePreviews.length > 0 ? (
                    <details className="rounded-lg border border-gray-200 bg-white p-2">
                      <summary className="cursor-pointer text-sm font-semibold text-gray-900">
                        Pré-visualização das fotos ({selectedImagePreviews.length})
                      </summary>
                      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                        {selectedImagePreviews.slice(0, 10).map((preview) => (
                          <div
                            key={preview.name}
                            className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                          >
                            <div className="aspect-square w-full bg-white">
                              <img
                                src={preview.url}
                                alt={preview.name}
                                className="h-full w-full object-cover"
                              />
                            </div>
                            <div className="border-t border-gray-200 px-3 py-2">
                              <p className="truncate text-xs font-medium text-gray-700">
                                {preview.name}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <button
                      type="button"
                      onClick={() => void handleRunIntelligentImport()}
                      disabled={disabled || intelligentImportLoading}
                      className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {intelligentImportLoading
                        ? "Analisando catálogo..."
                        : "Analisar catálogo"}
                    </button>
                    {visibleIntelligentImportFiles.length > 0 ? (
                      <button
                        type="button"
                        onClick={clearIntelligentImportState}
                        disabled={disabled || intelligentImportLoading}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-60"
                      >
                        Limpar arquivos e análise
                      </button>
                    ) : null}
                  </div>
                    </>
                  )}
                  {intelligentImportError ? (
                    <InfoBlock
                      title="Falha na importação inteligente"
                      description={intelligentImportError}
                    />
                  ) : null}
                  {intelligentImportSuccess ? (
                    <InfoBlock
                      title="Importação inteligente processada"
                      description={intelligentImportSuccess}
                      subtle
                    />
                  ) : null}
                  {intelligentImportResult?.ok ? (
                    <div className="space-y-3">
                      <div className="hidden">
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Arquivos enviados</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.totalFiles}
                          </p>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Arquivos lidos</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.extractedFiles}
                          </p>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Blocos normalizados</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.normalizedItems}
                          </p>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Itens deduplicados</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.dedupedItems}
                          </p>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Duplicados detectados</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.duplicateItems}
                          </p>
                        </div>
                      </div>
                      <details className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                        <summary className="cursor-pointer text-sm font-semibold text-sky-950">
                          Ferramentas avancadas e diagnostico
                        </summary>
                        <div className="mt-3">
                      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                          <div>
                            <p className="text-sm font-semibold text-sky-950">
                              Diagnostico da leitura
                            </p>
                            <p className="mt-1 text-sm leading-6 text-sky-900">
                              A tela mostra uma previa curta para ficar leve. O salvamento usa os itens validos
                              encontrados na analise, nao apenas os itens visiveis na previa.
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm md:min-w-[360px]">
                            <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                              <p className="text-xs text-sky-700">Itens na previa</p>
                              <p className="font-semibold text-sky-950">
                                {intelligentImportDiagnostics.previewItems}
                              </p>
                            </div>
                            <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                              <p className="text-xs text-sky-700">Candidatos para salvar</p>
                              <p className="font-semibold text-sky-950">
                                {intelligentImportDiagnostics.saveCandidateItems}
                              </p>
                            </div>
                            <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                              <p className="text-xs text-sky-700">Fotos encontradas</p>
                              <p className="font-semibold text-sky-950">
                                {safeExtractedImagePreview.length}
                              </p>
                            </div>
                            <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                              <p className="text-xs text-sky-700">Fotos com pista de item</p>
                              <p className="font-semibold text-sky-950">
                                {intelligentImportDiagnostics.imagesWithOriginClues}
                              </p>
                            </div>
                            <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                              <p className="text-xs text-sky-700">Arquivos brutos persistidos</p>
                              <p className="font-semibold text-sky-950">
                                {Array.isArray(intelligentImportResult.importedFileIds)
                                  ? intelligentImportResult.importedFileIds.length
                                  : 0}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                          <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                            <p className="text-xs text-sky-700">Piscinas</p>
                            <p className="font-semibold text-sky-950">
                              {intelligentImportDiagnostics.destinationCounts.pools}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                            <p className="text-xs text-sky-700">Quimicos</p>
                            <p className="font-semibold text-sky-950">
                              {intelligentImportDiagnostics.destinationCounts.quimicos}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                            <p className="text-xs text-sky-700">Acessorios</p>
                            <p className="font-semibold text-sky-950">
                              {intelligentImportDiagnostics.destinationCounts.acessorios}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-sky-100">
                            <p className="text-xs text-sky-700">Outros</p>
                            <p className="font-semibold text-sky-950">
                              {intelligentImportDiagnostics.destinationCounts.outros}
                            </p>
                          </div>
                        </div>
                        {intelligentImportDiagnostics.formatWarnings.length > 0 ? (
                          <div className="mt-3 space-y-1.5">
                            {intelligentImportDiagnostics.formatWarnings.map((warning) => (
                              <p key={warning} className="text-xs leading-5 text-sky-900">
                                {warning}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        {intelligentImportResult.rawFilePersistenceWarnings &&
                        intelligentImportResult.rawFilePersistenceWarnings.length > 0 ? (
                          <div className="mt-3 space-y-1.5">
                            {intelligentImportResult.rawFilePersistenceWarnings.map((warning) => (
                              <p key={warning} className="text-xs leading-5 text-amber-900">
                                {warning}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        {intelligentImportResult.ok && intelligentImportResult.parserDebug ? (
                          <details className="mt-3 rounded-xl border border-sky-200 bg-white/80 p-3">
                            <summary className="cursor-pointer text-sm font-semibold text-sky-950">
                              Diagnostico tecnico do parser
                            </summary>
                            <p className="mt-2 text-xs leading-5 text-sky-900">
                              Ativo via <code>debugParser=true</code> na URL. Copie o JSON abaixo para compartilhar o trace.
                            </p>
                            <pre className="mt-3 max-h-[520px] overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
                              {JSON.stringify(intelligentImportResult.parserDebug, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                      {hasVisualPdfImportResult ? (
                        <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
                          <div className="grid gap-2 md:grid-cols-[160px_auto] md:items-end">
                            <label className="block">
                              <span className="text-xs font-medium text-violet-900">
                                Pagina para analisar
                              </span>
                              <input
                                type="number"
                                min={1}
                                max={visualPdfTotalPages ?? undefined}
                                value={visualCatalogPage}
                                onChange={(event) => {
                                  const parsed = Number(event.target.value);
                                  const positivePage = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
                                  setVisualCatalogPage(
                                    visualPdfTotalPages
                                      ? Math.min(positivePage, visualPdfTotalPages)
                                      : positivePage
                                  );
                                }}
                                className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-gray-900"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => void handleRunVisualCatalogBase({ page: visualCatalogPage })}
                              disabled={disabled || visualCatalogLoading || intelligentImportLoading}
                              className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                            >
                              {visualCatalogLoading ? "Analisando..." : "Analisar esta pagina"}
                            </button>
                          </div>
                          {visualCatalogLoading ? (
                            <p className="mt-3 text-sm text-violet-900">
                              Analisando a pagina {visualCatalogPage}...
                            </p>
                          ) : null}
                          {visualCatalogError ? (
                            <p className="mt-3 text-sm text-red-700">{visualCatalogError}</p>
                          ) : null}
                          {visualCatalogNotice ? (
                            <p className="mt-3 text-sm text-violet-900">{visualCatalogNotice}</p>
                          ) : null}
                          {visualCatalogResult?.ok && editableVisualCatalogDrafts.length > 0 ? (
                            <div className="mt-3 space-y-3">
                              <p className="text-sm font-medium text-violet-950">
                                Rascunhos gerados por imagem. Revise e ajuste os dados antes de uma etapa futura de salvamento.
                              </p>
                              {editableVisualCatalogDrafts.map((draft) => (
                                <div
                                  key={draft.id}
                                  className="rounded-lg bg-white p-3 ring-1 ring-violet-100"
                                >
                                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                                    <div className="min-w-0">
                                      <p className="break-words text-sm font-semibold text-gray-900">
                                        {draft.name || "Item visual sem nome"}
                                      </p>
                                      <p className="mt-1 text-xs text-gray-600">
                                        Categoria: {draft.category || "a revisar"} - Pagina {draft.pageNumber}
                                      </p>
                                    </div>
                                    <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800 ring-1 ring-violet-100">
                                      {Math.round((draft.confidence || 0) * 100)}% confianca
                                    </span>
                                  </div>
                                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                                    <label className="block">
                                      <span className="text-xs font-medium text-gray-700">Nome</span>
                                      <input
                                        type="text"
                                        value={draft.name}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, { name: event.target.value })
                                        }
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                                      />
                                    </label>
                                    <label className="block">
                                      <span className="text-xs font-medium text-gray-700">Categoria</span>
                                      <select
                                        value={draft.category}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, {
                                            category: event.target.value as EditableVisualCatalogDraft["category"],
                                          })
                                        }
                                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
                                      >
                                        <option value="">A revisar</option>
                                        <option value="pool">Piscina</option>
                                        <option value="chemical">Produto quimico</option>
                                        <option value="accessory">Acessorio</option>
                                        <option value="other">Outro</option>
                                      </select>
                                    </label>
                                    <label className="block">
                                      <span className="text-xs font-medium text-gray-700">Medidas lidas</span>
                                      <input
                                        type="text"
                                        value={draft.visualDimensionsText}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, {
                                            visualDimensionsText: event.target.value,
                                          })
                                        }
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                                      />
                                    </label>
                                    <label className="block">
                                      <span className="text-xs font-medium text-gray-700">Material</span>
                                      <input
                                        type="text"
                                        value={draft.material}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, { material: event.target.value })
                                        }
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                                      />
                                    </label>
                                    <label className="block">
                                      <span className="text-xs font-medium text-gray-700">Preco</span>
                                      <input
                                        type="text"
                                        value={draft.price}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, { price: event.target.value })
                                        }
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                                      />
                                    </label>
                                    <label className="block">
                                      <span className="text-xs font-medium text-gray-700">Estoque</span>
                                      <input
                                        type="text"
                                        value={draft.stock}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, { stock: event.target.value })
                                        }
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                                      />
                                    </label>
                                    <label className="block md:col-span-2">
                                      <span className="text-xs font-medium text-gray-700">Descricao</span>
                                      <textarea
                                        value={draft.description}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, {
                                            description: event.target.value,
                                          })
                                        }
                                        rows={2}
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                                      />
                                    </label>
                                  </div>
                                  {draft.missingFields.length > 0 ? (
                                    <p className="mt-2 break-words text-xs leading-5 text-gray-600">
                                      Campos faltando: {draft.missingFields.map(translateVisualMissingField).join(", ")}
                                    </p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {visualCatalogResult?.ok && visualCatalogResult.drafts.length === 0 && !visualCatalogLoading ? (
                            <p className="mt-3 text-sm leading-6 text-violet-900">
                              Ainda nao encontramos itens prontos nesta pagina. Tente outra pagina.
                            </p>
                          ) : null}
                          <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50/50 p-3">
                            <p className="text-xs font-medium text-violet-900">Teste manual de evidencias</p>
                            <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                              <label className="block min-w-0">
                                <span className="text-xs font-medium text-violet-900">
                                  Paginas para testar
                                </span>
                                <input
                                  type="text"
                                  value={visualEvidencePagesInput}
                                  onChange={(event) => {
                                    visualEvidencePagesManuallyEditedRef.current = true;
                                    setVisualEvidencePagesInput(event.target.value);
                                  }}
                                  placeholder="3,4,5,12"
                                  className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-gray-900"
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => void handleRunVisualEvidenceScan()}
                                disabled={disabled || visualEvidenceLoading || intelligentImportLoading}
                                className="rounded-lg border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-950 disabled:opacity-60"
                              >
                                {visualEvidenceLoading ? "Lendo..." : "Testar paginas"}
                              </button>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-violet-900">
                              Use no maximo 5 paginas. Esta opcao existe para desenvolvimento e validacao.
                            </p>
                            <div className="mt-3 rounded-lg bg-white/80 p-2 text-xs leading-5 text-violet-900 ring-1 ring-violet-100">
                              <p className="font-medium">Cobertura interna do documento</p>
                              <p>{visualDocumentAnalysis.coverage.coverageSummary}</p>
                              <p>Entidades detectadas: {visualDocumentAnalysis.entities.length}</p>
                              <p>Evidencias ligadas: {visualDocumentAnalysis.fieldEvidence.length}</p>
                              <p>
                                Candidatos consolidados:{" "}
                                {visualDocumentAnalysis.consolidatedReviewCandidates.length}
                              </p>
                              {visualDocumentAnalysis.mapOnlyHints.length > 0 ? (
                                <p>
                                  Sugestoes do mapa ainda sem scan detalhado: {visualDocumentAnalysis.mapOnlyHints.length}
                                </p>
                              ) : null}
                              {visualDocumentAnalysis.coverage.recommendedPages.length > 0 ? (
                                <p className="break-words">
                                  Paginas recomendadas pelo mapa:{" "}
                                  {visualDocumentAnalysis.coverage.recommendedPages.join(", ")}
                                </p>
                              ) : null}
                              {visualDocumentAnalysis.coverage.pendingPages.length > 0 ? (
                                <p className="break-words">
                                  Paginas ainda sem scan detalhado:{" "}
                                  {visualDocumentAnalysis.coverage.pendingPages.slice(0, 12).join(", ")}
                                  {visualDocumentAnalysis.coverage.pendingPages.length > 12 ? "..." : ""}
                                </p>
                              ) : null}
                              {visualDocumentAnalysis.entities.length > 0 ? (
                                <p className="break-words">
                                  Amostra:{" "}
                                  {visualDocumentAnalysis.entities
                                    .slice(0, 6)
                                    .map((entity) =>
                                      `${entity.sku || entity.name || entity.modelKey} (${entity.sourcePages.join(", ")})`
                                    )
                                    .join(" | ")}
                                </p>
                              ) : null}
                              {visualDocumentAnalysis.mapOnlyHints.length > 0 ? (
                                <p className="break-words">
                                  Mapa:{" "}
                                  {visualDocumentAnalysis.mapOnlyHints
                                    .slice(0, 6)
                                    .map((entity) =>
                                      `${entity.sku || entity.name || entity.modelKey} (${entity.sourcePages.join(", ")})`
                                    )
                                    .join(" | ")}
                                </p>
                              ) : null}
                              {visualEvidencePageSummary.length > 0 ? (
                                <div className="mt-2">
                                  <p className="font-medium">Resumo por pagina analisada:</p>
                                  <div className="mt-1 space-y-1">
                                    {visualEvidencePageSummary.map((page) => (
                                      <p key={`visual-page-summary-${page.pageNumber}`} className="break-words">
                                        Pagina {page.pageNumber} - {page.pageType} - {page.itemCount}{" "}
                                        {page.itemCount === 1 ? "item" : "itens"}
                                        {page.labels.length > 0
                                          ? ` - ${page.labels.join(", ")}${page.hasMoreLabels ? "..." : ""}`
                                          : ""}
                                        {page.codes.length > 0
                                          ? ` | Codigos: ${page.codes.join(", ")}${page.hasMoreCodes ? "..." : ""}`
                                          : ""}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {visualLinkedEvidenceSummary.length > 0 ? (
                                <p className="break-words">
                                  Evidencias por entidade: {visualLinkedEvidenceSummary.join(" | ")}
                                </p>
                              ) : null}
                              {visualConsolidatedCandidateSummary.length > 0 ? (
                                <p className="break-words">
                                  Revisao visual consolidada: {visualConsolidatedCandidateSummary.join(" | ")}
                                </p>
                              ) : null}
                            </div>
                            <div className="mt-3 rounded-lg bg-white/80 p-2 text-xs leading-5 text-violet-900 ring-1 ring-violet-100">
                              <p className="font-medium">Diagnostico de possiveis duplicados</p>
                              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                <div className="rounded-md bg-violet-50 px-2 py-1 ring-1 ring-violet-100">
                                  <p className="text-violet-700">Itens analisados</p>
                                  <p className="font-semibold text-violet-950">
                                    {visualReviewDuplicateDiagnostics.totalItems}
                                  </p>
                                </div>
                                <div className="rounded-md bg-violet-50 px-2 py-1 ring-1 ring-violet-100">
                                  <p className="text-violet-700">Grupos suspeitos</p>
                                  <p className="font-semibold text-violet-950">
                                    {visualReviewDuplicateDiagnostics.suspiciousGroups.length}
                                  </p>
                                </div>
                                <div className="rounded-md bg-violet-50 px-2 py-1 ring-1 ring-violet-100">
                                  <p className="text-violet-700">Itens em grupos</p>
                                  <p className="font-semibold text-violet-950">
                                    {visualReviewDuplicateDiagnostics.suspiciousItemCount}
                                  </p>
                                </div>
                              </div>
                              {visualReviewDuplicateDiagnostics.suspiciousGroups.length === 0 ? (
                                <p className="mt-2">
                                  Nenhum possivel duplicado encontrado pelos criterios atuais.
                                </p>
                              ) : (
                                <div className="mt-2 space-y-2">
                                  {visualReviewDuplicateDiagnostics.suspiciousGroups.map((group) => (
                                    <div
                                      key={group.id}
                                      className="rounded-md border border-violet-100 bg-white p-2"
                                    >
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-800 ring-1 ring-violet-100">
                                          {group.type}
                                        </span>
                                        <span className="text-violet-800">
                                          {group.items.length} itens no grupo
                                        </span>
                                      </div>
                                      <div className="mt-1 space-y-1">
                                        {group.items.map((item) => (
                                          <p key={`${group.id}-${item.id}`} className="break-words">
                                            {item.name || "Sem nome"} | Categoria: {item.category || "a revisar"} |
                                            {" "}SKU/codigo: {item.sku || item.code || "-"} | Paginas:{" "}
                                            {item.sourcePages.join(", ") || "-"} | Status:{" "}
                                            {getVisualReviewDiagnosticStatus(item)}
                                          </p>
                                        ))}
                                      </div>
                                      <p className="mt-1 text-violet-700">
                                        O sistema nao juntou automaticamente; este grupo foi apenas sinalizado para revisao.
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      </div>
                      </details>
                      {hasVisualPdfImportResult ? (
                        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                          <div className="grid gap-3">
                            <div>
                              <p className="hidden">
                                Este PDF e visual. O sistema vai analisar a imagem das paginas para tentar encontrar
                                itens. Nada sera salvo sem revisao.
                              </p>
                            </div>
                          </div>
                          <details className="hidden">
                            <summary className="cursor-pointer text-xs font-medium text-violet-900">
                              Ferramentas de diagnostico
                            </summary>
                          <div className="mt-3 grid gap-2 md:grid-cols-[160px_auto] md:items-end">
                            <label className="block">
                              <span className="text-xs font-medium text-violet-900">
                                Pagina para analisar
                              </span>
                              <input
                                type="number"
                                min={1}
                                max={visualPdfTotalPages ?? undefined}
                                value={visualCatalogPage}
                                onChange={(event) => {
                                  const parsed = Number(event.target.value);
                                  const positivePage = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
                                  setVisualCatalogPage(
                                    visualPdfTotalPages
                                      ? Math.min(positivePage, visualPdfTotalPages)
                                      : positivePage
                                  );
                                }}
                                className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-gray-900"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => void handleRunVisualCatalogBase({ page: visualCatalogPage })}
                              disabled={disabled || visualCatalogLoading || intelligentImportLoading}
                              className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                            >
                              {visualCatalogLoading ? "Analisando..." : "Analisar esta pagina"}
                            </button>
                          </div>
                          {visualCatalogLoading ? (
                            <p className="mt-3 text-sm text-violet-900">
                              Analisando a pagina {visualCatalogPage}...
                            </p>
                          ) : null}
                          {visualCatalogError ? (
                            <p className="mt-3 text-sm text-red-700">{visualCatalogError}</p>
                          ) : null}
                          {visualCatalogNotice ? (
                            <p className="mt-3 text-sm text-violet-900">{visualCatalogNotice}</p>
                          ) : null}
                          {visualCatalogResult?.ok && editableVisualCatalogDrafts.length > 0 ? (
                            <div className="mt-3 space-y-3">
                              <p className="text-sm font-medium text-violet-950">
                                Rascunhos gerados por imagem. Revise e ajuste os dados antes de uma etapa futura de salvamento.
                              </p>
                              {editableVisualCatalogDrafts.map((draft) => (
                                <div
                                  key={draft.id}
                                  className="rounded-lg bg-white p-3 ring-1 ring-violet-100"
                                >
                                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                                    <div>
                                      <p className="text-sm font-semibold text-gray-900">
                                        {draft.name || "Item visual sem nome"}
                                      </p>
                                      <p className="mt-1 text-xs text-gray-600">
                                        Categoria: {draft.category || "a revisar"} • Pagina {draft.pageNumber}
                                      </p>
                                    </div>
                                    <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800 ring-1 ring-violet-100">
                                      {Math.round((draft.confidence || 0) * 100)}% confianca
                                    </span>
                                  </div>
                                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                                    <label className="block">
                                      <span className="text-xs font-medium text-gray-700">Nome</span>
                                      <input
                                        type="text"
                                        value={draft.name}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, { name: event.target.value })
                                        }
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                                      />
                                    </label>
                                    <label className="block">
                                      <span className="text-xs font-medium text-gray-700">Categoria</span>
                                      <select
                                        value={draft.category}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, {
                                            category: event.target.value as EditableVisualCatalogDraft["category"],
                                          })
                                        }
                                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
                                      >
                                        <option value="">A revisar</option>
                                        <option value="pool">Piscina</option>
                                        <option value="chemical">Produto quimico</option>
                                        <option value="accessory">Acessorio</option>
                                        <option value="other">Outro</option>
                                      </select>
                                    </label>
                                    <label className="block">
                                      <span className="text-xs font-medium text-gray-700">Medidas lidas</span>
                                      <input
                                        type="text"
                                        value={draft.visualDimensionsText}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, {
                                            visualDimensionsText: event.target.value,
                                          })
                                        }
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                                      />
                                    </label>
                                    <label className="block">
                                      <span className="text-xs font-medium text-gray-700">Material</span>
                                      <input
                                        type="text"
                                        value={draft.material}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, { material: event.target.value })
                                        }
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                                      />
                                    </label>
                                    <label className="block">
                                      <span className="text-xs font-medium text-gray-700">Preco</span>
                                      <input
                                        type="text"
                                        value={draft.price}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, { price: event.target.value })
                                        }
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                                      />
                                    </label>
                                    <label className="block">
                                      <span className="text-xs font-medium text-gray-700">Estoque</span>
                                      <input
                                        type="text"
                                        value={draft.stock}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, { stock: event.target.value })
                                        }
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                                      />
                                    </label>
                                    <label className="block md:col-span-2">
                                      <span className="text-xs font-medium text-gray-700">Descricao</span>
                                      <textarea
                                        value={draft.description}
                                        onChange={(event) =>
                                          updateEditableVisualCatalogDraft(draft.id, {
                                            description: event.target.value,
                                          })
                                        }
                                        rows={2}
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                                      />
                                    </label>
                                  </div>
                                  {draft.missingFields.length > 0 ? (
                                    <p className="mt-2 text-xs leading-5 text-gray-600">
                                      Campos faltando: {draft.missingFields.map(translateVisualMissingField).join(", ")}
                                    </p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {visualCatalogResult?.ok && visualCatalogResult.drafts.length === 0 && !visualCatalogLoading ? (
                            <p className="mt-3 text-sm leading-6 text-violet-900">
                              Ainda nao encontramos itens prontos nesta pagina. Tente outra pagina.
                            </p>
                          ) : null}
                          <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50/50 p-3">
                            <p className="text-xs font-medium text-violet-900">Teste manual de evidencias</p>
                            <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                              <label className="block">
                                <span className="text-xs font-medium text-violet-900">
                                  Paginas para testar
                                </span>
                                <input
                                  type="text"
                                  value={visualEvidencePagesInput}
                                  onChange={(event) => {
                                    visualEvidencePagesManuallyEditedRef.current = true;
                                    setVisualEvidencePagesInput(event.target.value);
                                  }}
                                  placeholder="3,4,5,12"
                                  className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-gray-900"
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => void handleRunVisualEvidenceScan()}
                                disabled={disabled || visualEvidenceLoading || intelligentImportLoading}
                                className="rounded-lg border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-950 disabled:opacity-60"
                              >
                                {visualEvidenceLoading ? "Lendo..." : "Testar paginas"}
                              </button>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-violet-900">
                              Use no maximo 5 paginas. Esta opcao existe para desenvolvimento e validacao.
                            </p>
                            <div className="mt-3 rounded-lg bg-white/80 p-2 text-xs leading-5 text-violet-900 ring-1 ring-violet-100">
                              <p className="font-medium">Cobertura interna do documento</p>
                              <p>{visualDocumentAnalysis.coverage.coverageSummary}</p>
                              <p>Entidades detectadas: {visualDocumentAnalysis.entities.length}</p>
                              <p>Evidencias ligadas: {visualDocumentAnalysis.fieldEvidence.length}</p>
                              <p>
                                Candidatos consolidados:{" "}
                                {visualDocumentAnalysis.consolidatedReviewCandidates.length}
                              </p>
                              {visualDocumentAnalysis.mapOnlyHints.length > 0 ? (
                                <p>
                                  Sugestoes do mapa ainda sem scan detalhado: {visualDocumentAnalysis.mapOnlyHints.length}
                                </p>
                              ) : null}
                              {visualDocumentAnalysis.coverage.recommendedPages.length > 0 ? (
                                <p>
                                  Paginas recomendadas pelo mapa:{" "}
                                  {visualDocumentAnalysis.coverage.recommendedPages.join(", ")}
                                </p>
                              ) : null}
                              {visualDocumentAnalysis.coverage.pendingPages.length > 0 ? (
                                <p>
                                  Paginas ainda sem scan detalhado:{" "}
                                  {visualDocumentAnalysis.coverage.pendingPages.slice(0, 12).join(", ")}
                                  {visualDocumentAnalysis.coverage.pendingPages.length > 12 ? "..." : ""}
                                </p>
                              ) : null}
                              {visualDocumentAnalysis.entities.length > 0 ? (
                                <p>
                                  Amostra:{" "}
                                  {visualDocumentAnalysis.entities
                                    .slice(0, 6)
                                    .map((entity) =>
                                      `${entity.sku || entity.name || entity.modelKey} (${entity.sourcePages.join(", ")})`
                                    )
                                    .join(" | ")}
                                </p>
                              ) : null}
                              {visualDocumentAnalysis.mapOnlyHints.length > 0 ? (
                                <p>
                                  Mapa:{" "}
                                  {visualDocumentAnalysis.mapOnlyHints
                                    .slice(0, 6)
                                    .map((entity) =>
                                      `${entity.sku || entity.name || entity.modelKey} (${entity.sourcePages.join(", ")})`
                                    )
                                    .join(" | ")}
                                </p>
                              ) : null}
                              {visualEvidencePageSummary.length > 0 ? (
                                <div className="mt-2">
                                  <p className="font-medium">Resumo por pagina analisada:</p>
                                  <div className="mt-1 space-y-1">
                                    {visualEvidencePageSummary.map((page) => (
                                      <p key={`visual-page-summary-${page.pageNumber}`}>
                                        Pagina {page.pageNumber} - {page.pageType} - {page.itemCount}{" "}
                                        {page.itemCount === 1 ? "item" : "itens"}
                                        {page.labels.length > 0
                                          ? ` - ${page.labels.join(", ")}${page.hasMoreLabels ? "..." : ""}`
                                          : ""}
                                        {page.codes.length > 0
                                          ? ` | Codigos: ${page.codes.join(", ")}${page.hasMoreCodes ? "..." : ""}`
                                          : ""}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {visualLinkedEvidenceSummary.length > 0 ? (
                                <p>
                                  Evidencias por entidade: {visualLinkedEvidenceSummary.join(" | ")}
                                </p>
                              ) : null}
                              {visualConsolidatedCandidateSummary.length > 0 ? (
                                <p>
                                  Revisao visual consolidada: {visualConsolidatedCandidateSummary.join(" | ")}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          </details>
                          <div className="mt-4 rounded-lg bg-white p-3 ring-1 ring-violet-100">
                            <p className="hidden">
                              Este PDF e visual. O ZION analisa automaticamente paginas importantes para montar evidencias do catalogo. Nada sera salvo sem sua revisao.
                            </p>
                            {visualEvidenceLoading ? (
                              <p className="mt-2 text-sm text-violet-900">
                                Lendo evidencias visuais...
                              </p>
                            ) : null}
                            {visualDocumentMapLoading ? (
                              <p className="mt-2 text-sm text-violet-900">
                                Mapeando paginas do catalogo...
                              </p>
                            ) : null}
                            {visualDocumentMapResult?.ok && visualDocumentMapResult.recommendedPages.length > 0 ? (
                              <p className="hidden">
                                Paginas analisadas no scan detalhado:{" "}
                                {visualDetailedScanPages.length > 0
                                  ? visualDetailedScanPages.join(", ")
                                  : visualEvidencePagesInput}
                              </p>
                            ) : null}
                            {visualDocumentMapResult?.ok && visualDocumentMapResult.recommendedPages.length > 0 ? (
                              <p className="hidden">
                                Mapa visual como apoio: recomendou {visualDocumentMapResult.recommendedPages.slice(0, 8).join(", ")}.
                              </p>
                            ) : null}
                            {visualDocumentMapResult?.ok ? (
                              <div className="hidden">
                                <p className="text-xs leading-5 text-violet-900">
                                  Paginas ja analisadas:{" "}
                                  {analyzedVisualEvidencePages.length > 0 ? analyzedVisualEvidencePages.join(", ") : "nenhuma"}
                                </p>
                                <p className="mt-1 text-xs leading-5 text-violet-900">
                                  Total de paginas analisadas: {analyzedVisualEvidencePages.length}
                                  {visualPdfTotalPages ? `/${visualPdfTotalPages}` : ""}
                                </p>
                                {nextVisualRecommendedPagesBatch.length > 0 ? (
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void handleRunNextVisualRecommendedPages()}
                                      disabled={disabled || visualEvidenceLoading || visualDocumentMapLoading || intelligentImportLoading}
                                      className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-950 disabled:opacity-60"
                                    >
                                      Analisar proximas paginas sugeridas
                                    </button>
                                    <p className="text-xs leading-5 text-violet-800">
                                      Proximas paginas: {nextVisualRecommendedPagesBatch.join(", ")}. Analisa ate mais 5 paginas recomendadas pelo mapa. Pode consumir API.
                                    </p>
                                  </div>
                                ) : (
                                  <p className="mt-2 text-xs leading-5 text-violet-800">
                                    Nao ha novas paginas sugeridas pelo mapa para analisar agora.
                                  </p>
                                )}
                              </div>
                            ) : null}
                            {visualDocumentMapError ? (
                              <p className="mt-2 text-sm text-amber-700">{visualDocumentMapError}</p>
                            ) : null}
                            {visualEvidenceNotice ? (
                              <p className="hidden">{visualEvidenceNotice}</p>
                            ) : null}
                            {visualEvidenceResult?.ok || visualDocumentMapResult?.ok ? (
                              <div className="hidden">
                                <button
                                  type="button"
                                  onClick={handleRedoVisualAnalysis}
                                  disabled={disabled || visualEvidenceLoading || visualDocumentMapLoading || intelligentImportLoading}
                                  className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-950 disabled:opacity-60"
                                >
                                  Limpar analise salva
                                </button>
                                <p className="text-xs leading-5 text-violet-800">
                                  Remove a analise salva deste arquivo. Para analisar de novo, clique em Testar paginas.
                                </p>
                              </div>
                            ) : null}
                            {visualEvidenceError ? (
                              <p className="mt-2 text-sm text-red-700">{visualEvidenceError}</p>
                            ) : null}
                            {visualEvidenceResult?.ok ? (
                              <div className="mt-3 space-y-3">
                                {visualEvidenceResult.pageEvidence.length > 0 ? (
                                  <p className="hidden">
                                    O ZION encontrou evidencias visuais no catalogo. A proxima etapa sera juntar essas informacoes em itens para revisao.
                                  </p>
                                ) : null}
                                {visualReviewItems.length > 0 ? (
                                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-2.5">
                                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                                      <div>
                                        <p className="text-sm font-semibold text-emerald-950">
                                          Itens consolidados para revisao
                                        </p>
                                        <p className="hidden">
                                          O ZION juntou informacoes encontradas em paginas diferentes. Edite e aprove os itens que deseja salvar depois. Nada foi salvo ainda.
                                        </p>
                                      </div>
                                      <div className="flex flex-wrap gap-2 text-xs">
                                        <span className="rounded-full bg-white px-3 py-1 font-medium text-emerald-900 ring-1 ring-emerald-200">
                                          {visualReviewCounts.approved} aprovados
                                        </span>
                                        <span className="rounded-full bg-white px-3 py-1 font-medium text-amber-800 ring-1 ring-amber-200">
                                          {visualReviewCounts.pending} pendentes
                                        </span>
                                        <span className="rounded-full bg-white px-3 py-1 font-medium text-gray-700 ring-1 ring-gray-200">
                                          {visualReviewCounts.ignored} ignorados
                                        </span>
                                      </div>
                                    </div>
                                    <div className="mt-2 space-y-2">
                                      {visualReviewItems.map((item) => {
                                        const foundFields = [
                                          item.name.trim() ? "Nome" : null,
                                          item.sku.trim() || item.code.trim() ? "Codigo/SKU" : null,
                                          item.category ? "Categoria" : null,
                                          item.dimensionsText.trim() ? "Medidas" : null,
                                          item.material.trim() ? "Material" : null,
                                          item.description.trim() ? "Descricao" : null,
                                          item.price.trim() ? "Preco" : null,
                                          item.stock.trim() ? "Estoque" : null,
                                        ].filter((field): field is string => Boolean(field));
                                        const missingFields = item.missingFields.map((field) => {
                                          if (field === "code" || field === "sku") return "Codigo/SKU";
                                          if (field === "price") return "Preco";
                                          return translateVisualMissingField(field);
                                        });
                                        const displayName = item.name || item.sku || item.code || "Item para revisar";
                                        const visibleDimensions = item.dimensionsList.slice(0, 3);
                                        const statusLabel =
                                          item.reviewState === "approved"
                                            ? "Aprovado"
                                            : item.reviewState === "ignored"
                                              ? "Ignorado"
                                              : "Pendente";
                                        const priceInput = parseVisualReviewPriceInput(item.price);
                                        const imageSuggestions = getVisualReviewSuggestedImages(
                                          item,
                                          visualReviewImagePreview,
                                          visualPdfFileMeta?.name,
                                          blockedVisualReviewImagePages
                                        );
                                        const selectedImageKeys = getVisualReviewSelectedImageKeys(item);
                                        const selectedImageKeySet = new Set(selectedImageKeys);
                                        const markedWithoutPhoto = isVisualReviewMarkedWithoutPhoto(item);
                                        return (
                                          <div
                                            key={item.id}
                                            className="min-w-0 rounded-lg bg-white px-2.5 py-2 ring-1 ring-emerald-100"
                                          >
                                            <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1.4fr)_minmax(180px,0.8fr)_auto] md:items-center">
                                              <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold text-gray-950">
                                                  {displayName}
                                                </p>
                                                <p className="mt-0.5 truncate text-xs text-gray-600">
                                                  {getVisualCategoryLabel(item.category)}{" "}
                                                  {item.sku || item.code ? `| ${item.sku || item.code}` : "| Sem codigo"}
                                                </p>
                                              </div>
                                              <div className="grid min-w-0 grid-cols-3 gap-1.5 text-xs text-gray-600">
                                                <span className="truncate rounded-md bg-gray-50 px-2 py-1 ring-1 ring-gray-100">
                                                  {item.price.trim() ? item.price : "Sem preço"}
                                                </span>
                                                <span className="truncate rounded-md bg-gray-50 px-2 py-1 ring-1 ring-gray-100">
                                                  {item.stock.trim() ? `Estoque ${item.stock}` : "Sem estoque"}
                                                </span>
                                                <span className="truncate rounded-md bg-emerald-50 px-2 py-1 font-medium text-emerald-800 ring-1 ring-emerald-100">
                                                  {Math.round((item.confidence || 0) * 100)}%
                                                </span>
                                              </div>
                                              <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                                                <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-100">
                                                  {item.saved ? "Salvo" : statusLabel}
                                                </span>
                                                {priceInput.error ? (
                                                  <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-red-100">
                                                    Preco invalido
                                                  </span>
                                                ) : null}
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    updateEditableVisualReviewItem(item.id, { reviewState: "approved" })
                                                  }
                                                  className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900"
                                                >
                                                  Aprovar
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    updateEditableVisualReviewItem(item.id, { reviewState: "pending" })
                                                  }
                                                  className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900"
                                                >
                                                  Deixar pendente
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    updateEditableVisualReviewItem(item.id, { reviewState: "ignored" })
                                                  }
                                                  className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700"
                                                >
                                                  Ignorar
                                                </button>
                                              </div>
                                            </div>
                                            <details className="mt-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5">
                                              <summary className="cursor-pointer text-xs font-medium text-gray-700">
                                                Editar detalhes
                                              </summary>
                                              <div className="mt-2 grid gap-2 md:grid-cols-2">
                                                <label className="block">
                                                  <span className="text-xs font-medium text-gray-700">Nome</span>
                                                  <input
                                                    type="text"
                                                    value={item.name}
                                                    onChange={(event) =>
                                                      updateEditableVisualReviewItem(item.id, { name: event.target.value })
                                                    }
                                                    className="mt-1 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                                                  />
                                                </label>
                                                <label className="block">
                                                  <span className="text-xs font-medium text-gray-700">Categoria</span>
                                                  <select
                                                    value={item.category}
                                                    onChange={(event) =>
                                                      updateEditableVisualReviewItem(item.id, {
                                                        category: event.target.value as EditableVisualReviewItem["category"],
                                                      })
                                                    }
                                                    className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900"
                                                  >
                                                    <option value="">A revisar</option>
                                                    <option value="pool">Piscina</option>
                                                    <option value="chemical">Quimico</option>
                                                    <option value="accessory">Acessorio</option>
                                                    <option value="other">Outro</option>
                                                  </select>
                                                </label>
                                                <label className="block">
                                                  <span className="text-xs font-medium text-gray-700">Codigo/SKU</span>
                                                  <input
                                                    type="text"
                                                    value={item.sku}
                                                    onChange={(event) =>
                                                      updateEditableVisualReviewItem(item.id, {
                                                        sku: event.target.value,
                                                        code: event.target.value,
                                                      })
                                                    }
                                                    className="mt-1 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                                                  />
                                                </label>
                                                <label className="block">
                                                  <span className="text-xs font-medium text-gray-700">Preco</span>
                                                  <input
                                                    type="text"
                                                    value={item.price}
                                                    onChange={(event) =>
                                                      updateEditableVisualReviewItem(item.id, { price: event.target.value })
                                                    }
                                                    placeholder="Ex.: 150.000,00"
                                                    className="mt-1 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                                                  />
                                                  <p className="mt-1 text-[11px] leading-4 text-gray-500">
                                                    Use virgula para centavos. Ex.: 129,90 ou 1.200,00
                                                  </p>
                                                  {priceInput.error ? (
                                                    <p className="mt-1 text-[11px] leading-4 text-red-700">
                                                      {priceInput.error}
                                                    </p>
                                                  ) : null}
                                                </label>
                                                <label className="block">
                                                  <span className="text-xs font-medium text-gray-700">Estoque</span>
                                                  <input
                                                    type="text"
                                                    value={item.stock}
                                                    onChange={(event) =>
                                                      updateEditableVisualReviewItem(item.id, { stock: event.target.value })
                                                    }
                                                    className="mt-1 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                                                  />
                                                </label>
                                                <label className="flex items-center gap-2 self-end text-xs font-medium text-gray-700">
                                                  <input
                                                    type="checkbox"
                                                    checked={item.isActive}
                                                    onChange={(event) =>
                                                      updateEditableVisualReviewItem(item.id, {
                                                        isActive: event.target.checked,
                                                      })
                                                    }
                                                    className="h-4 w-4 rounded border-gray-300"
                                                  />
                                                  Ativo
                                                </label>
                                                <label className="block md:col-span-2">
                                                  <span className="text-xs font-medium text-gray-700">Medidas</span>
                                                  <input
                                                    type="text"
                                                    value={item.dimensionsText}
                                                    onChange={(event) =>
                                                      updateEditableVisualReviewItem(item.id, {
                                                        dimensionsText: event.target.value,
                                                      })
                                                    }
                                                    className="mt-1 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                                                  />
                                                </label>
                                                <label className="block">
                                                  <span className="text-xs font-medium text-gray-700">Material</span>
                                                  <input
                                                    type="text"
                                                    value={item.material}
                                                    onChange={(event) =>
                                                      updateEditableVisualReviewItem(item.id, { material: event.target.value })
                                                    }
                                                    className="mt-1 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                                                  />
                                                </label>
                                                <label className="block md:col-span-2">
                                                  <span className="text-xs font-medium text-gray-700">Descricao</span>
                                                  <textarea
                                                    value={item.description}
                                                    onChange={(event) =>
                                                      updateEditableVisualReviewItem(item.id, {
                                                        description: event.target.value,
                                                      })
                                                    }
                                                    rows={2}
                                                    className="mt-1 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                                                  />
                                                </label>
                                              </div>
                                              <div className="mt-2 rounded-md bg-white p-2 text-xs leading-5 text-gray-700 ring-1 ring-gray-200">
                                                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                                                  <p className="font-medium text-gray-900">Imagem sugerida</p>
                                                  <label className="inline-flex items-center gap-1.5 text-gray-600">
                                                    <input
                                                      type="checkbox"
                                                      checked={markedWithoutPhoto}
                                                      onChange={(event) =>
                                                        updateEditableVisualReviewItem(item.id, {
                                                          selectedImageKey: event.target.checked
                                                            ? VISUAL_REVIEW_NO_IMAGE_KEY
                                                            : "",
                                                          selectedImageKeys: [],
                                                        })
                                                      }
                                                      className="h-3.5 w-3.5"
                                                    />
                                                    Sem foto
                                                  </label>
                                                </div>
                                                <p className="mt-1 break-words text-[11px] leading-4 text-gray-500">
                                                  A imagem sera salva em uma etapa posterior. Revise antes de usar.
                                                </p>
                                                {imageSuggestions.candidatesWithPreview.length === 0 &&
                                                imageSuggestions.hasPageMatchWithoutPreview ? (
                                                  <div className="mt-2 space-y-2">
                                                    <div className="flex min-w-0 flex-wrap gap-1.5">
                                                      {imageSuggestions.matchedPages.slice(0, 4).map((pageNumber) => (
                                                        <span
                                                          key={`${item.id}-visual-page-match-${pageNumber}`}
                                                          className="rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-700 ring-1 ring-gray-200"
                                                        >
                                                          Pagina {pageNumber}
                                                        </span>
                                                      ))}
                                                    </div>
                                                    <p className="break-words text-[11px] leading-4 text-gray-600">
                                                      Encontramos paginas relacionadas a este item, mas a miniatura nao esta disponivel nesta sessao.
                                                    </p>
                                                    <p className="break-words text-[11px] leading-4 text-gray-500">
                                                      Para ver previas, limpe a analise e rode o upload novamente.
                                                    </p>
                                                  </div>
                                                ) : null}
                                                {imageSuggestions.candidatesWithPreview.length === 0 &&
                                                !imageSuggestions.hasPageMatchWithoutPreview ? (
                                                  <p className="mt-2 text-[11px] leading-4 text-gray-500">
                                                    Nenhuma imagem sugerida para este item.
                                                  </p>
                                                ) : null}
                                                {imageSuggestions.candidatesWithPreview.length > 0 ? (
                                                  <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                                                    {imageSuggestions.candidatesWithPreview.map((image) => {
                                                      const inputId = `visual-review-image-${item.id}-${image.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
                                                      const imageSelected = selectedImageKeySet.has(image.key);
                                                      return (
                                                        <div
                                                          key={image.key}
                                                          className={cx(
                                                            "min-w-0 overflow-hidden rounded-md border bg-gray-50 p-1.5",
                                                            imageSelected
                                                              ? "border-emerald-300 ring-1 ring-emerald-200"
                                                              : "border-gray-200"
                                                          )}
                                                        >
                                                          <div className="flex min-w-0 items-start gap-2">
                                                            <input
                                                              id={inputId}
                                                              type="checkbox"
                                                              checked={imageSelected}
                                                              onChange={(event) => {
                                                                const nextSelectedImageKeys = event.target.checked
                                                                  ? Array.from(new Set([...selectedImageKeys, image.key]))
                                                                  : selectedImageKeys.filter((key) => key !== image.key);
                                                                updateEditableVisualReviewItem(item.id, {
                                                                  selectedImageKey: "",
                                                                  selectedImageKeys: nextSelectedImageKeys,
                                                                });
                                                              }}
                                                              className="mt-1 h-3.5 w-3.5 shrink-0"
                                                            />
                                                            <div className="min-w-0">
                                                              <button
                                                                type="button"
                                                                onClick={() =>
                                                                  setExpandedVisualReviewImage({
                                                                    itemId: item.id,
                                                                    key: image.key,
                                                                    dataUrl: image.dataUrl,
                                                                    fileName: image.fileName,
                                                                    pageNumber: image.pageNumber,
                                                                  })
                                                                }
                                                                className="block rounded text-left focus:outline-none focus:ring-2 focus:ring-emerald-300"
                                                              >
                                                                {String(image.dataUrl || "").trim() ? (
                                                                  <img
                                                                    src={image.dataUrl}
                                                                    alt={image.fileName}
                                                                    className="h-14 w-20 rounded object-cover ring-1 ring-gray-200"
                                                                  />
                                                                ) : (
                                                                  <span className="flex h-14 w-20 items-center justify-center rounded bg-white px-1 text-center text-[10px] text-gray-500 ring-1 ring-gray-200">
                                                                    Sem miniatura
                                                                  </span>
                                                                )}
                                                              </button>
                                                              <label
                                                                htmlFor={inputId}
                                                                className="mt-1 block cursor-pointer truncate text-[11px] font-medium text-gray-800"
                                                              >
                                                                Selecionar imagem
                                                              </label>
                                                              <button
                                                                type="button"
                                                                onClick={() =>
                                                                  setExpandedVisualReviewImage({
                                                                    itemId: item.id,
                                                                    key: image.key,
                                                                    dataUrl: image.dataUrl,
                                                                    fileName: image.fileName,
                                                                    pageNumber: image.pageNumber,
                                                                  })
                                                                }
                                                                className="mt-0.5 block text-[11px] font-medium text-emerald-700 hover:text-emerald-900"
                                                              >
                                                                Visualizar imagem
                                                              </button>
                                                              <p className="break-words text-[11px] text-gray-500">
                                                                Pagina {image.pageNumber}
                                                              </p>
                                                            </div>
                                                          </div>
                                                        </div>
                                                      );
                                                    })}
                                                  </div>
                                                ) : null}
                                                {expandedVisualReviewImage?.itemId === item.id ? (
                                                  <div className="mt-2 min-w-0 rounded-md bg-gray-50 p-2 ring-1 ring-gray-200">
                                                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                                                      <p className="break-words text-[11px] font-medium text-gray-800">
                                                        Visualizar imagem - Pagina {expandedVisualReviewImage.pageNumber}
                                                      </p>
                                                      <button
                                                        type="button"
                                                        onClick={() => setExpandedVisualReviewImage(null)}
                                                        className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700"
                                                      >
                                                        Fechar visualizacao
                                                      </button>
                                                    </div>
                                                    {String(expandedVisualReviewImage.dataUrl || "").trim() ? (
                                                      <img
                                                        src={expandedVisualReviewImage.dataUrl}
                                                        alt={expandedVisualReviewImage.fileName}
                                                        className="mt-2 max-h-[70vh] w-full max-w-full rounded object-contain ring-1 ring-gray-200"
                                                      />
                                                    ) : (
                                                      <div className="mt-2 flex min-h-32 w-full items-center justify-center rounded bg-white px-3 text-center text-xs text-gray-500 ring-1 ring-gray-200">
                                                        Sem miniatura disponivel.
                                                      </div>
                                                    )}
                                                  </div>
                                                ) : null}
                                              </div>
                                              <p className="mt-2 break-words text-xs leading-5 text-gray-700">
                                                Paginas usadas: {item.sourcePages.join(", ") || "A revisar"}
                                              </p>
                                              {item.dimensionsList.length > 1 ? (
                                                <div className="mt-1 text-xs leading-5 text-gray-700">
                                                  <p>{item.dimensionsList.length} medidas encontradas:</p>
                                                  <p className="break-words">{visibleDimensions.join(" | ")}</p>
                                                </div>
                                              ) : null}
                                              {foundFields.length > 0 ? (
                                                <p className="mt-2 break-words text-xs leading-5 text-gray-700">
                                                  Campos encontrados: {foundFields.join(", ")}
                                                </p>
                                              ) : null}
                                              {missingFields.length > 0 ? (
                                                <p className="mt-1 break-words text-xs leading-5 text-gray-600">
                                                  Campos faltando: {missingFields.join(", ")}
                                                </p>
                                              ) : null}
                                              {item.conflicts.length > 0 ? (
                                                <div className="mt-2 rounded-md bg-amber-50 p-2 text-xs leading-5 text-amber-800 ring-1 ring-amber-100">
                                                  <p className="font-medium">Conflitos para revisar:</p>
                                                  {item.conflicts.map((conflict) => (
                                                    <p key={`${item.id}-${conflict.field}`} className="break-words">
                                                      {translateVisualMissingField(conflict.field)}: {conflict.values.join(" / ")}
                                                    </p>
                                                  ))}
                                                </div>
                                              ) : null}
                                            </details>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <p className="mt-3 text-xs leading-5 text-emerald-900">
                                      Salvar no catalogo sera habilitado depois da revisao.
                                    </p>
                                    <div className="mt-3 rounded-lg bg-white p-3 text-xs leading-5 text-emerald-950 ring-1 ring-emerald-100">
                                      <p className="text-sm font-semibold">Resumo para salvar depois</p>
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-900 ring-1 ring-emerald-100">
                                          {visualReviewSavePreview.approvedItems.length} itens aprovados
                                        </span>
                                        <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-900 ring-1 ring-emerald-100">
                                          {visualReviewSavePreview.readyItems.length} prontos para salvar
                                        </span>
                                        <span className="rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-800 ring-1 ring-amber-100">
                                          {visualReviewSavePreview.blockedItems.length} precisam de ajuste
                                        </span>
                                      </div>
                                      <p className="mt-2 text-emerald-900">
                                        Nada foi salvo ainda.
                                      </p>
                                      <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-emerald-950 ring-1 ring-emerald-100">
                                        <p className="font-medium">Fotos selecionadas para salvar depois</p>
                                        <p className="mt-1">
                                          {visualReviewSelectedImageSummary.readyToUploadItemCount} item(ns) aprovado(s) tem foto(s) pronta(s) para salvar.
                                        </p>
                                        <p>
                                          {visualReviewSelectedImageSummary.selectedImageCount} foto(s) selecionada(s) no total.
                                        </p>
                                        <p>
                                          {visualReviewSelectedImageSummary.withoutPhotoCount} item(ns) aprovado(s) estao marcados sem foto.
                                        </p>
                                        <p>
                                          {visualReviewSelectedImageSummary.noSelectionCount} item(ns) aprovado(s) ainda nao tem foto escolhida.
                                        </p>
                                        {visualReviewSelectedImageSummary.relatedWithoutPreviewCount > 0 ? (
                                          <p>
                                            {visualReviewSelectedImageSummary.relatedWithoutPreviewCount} item(ns) aprovado(s) tem pagina relacionada, mas sem preview real nesta sessao.
                                          </p>
                                        ) : null}
                                        <p className="mt-1 text-emerald-800">
                                          Fotos selecionadas serao salvas junto com os itens aprovados.
                                        </p>
                                      </div>
                                      {visualReviewSavePreview.readyItems.length > 0 ? (
                                        <>
                                          <p className="mt-1 text-emerald-900">
                                            Estes itens aprovados ja podem ser salvos no catalogo.
                                          </p>
                                          {isDebugParserMode ? (
                                            <p className="mt-2 text-sm font-medium text-amber-800">
                                              <code>debugParser=true</code> ativo. O salvamento visual legado fica
                                              bloqueado neste modo para proteger o catalogo.
                                            </p>
                                          ) : null}
                                        </>
                                      ) : null}
                                      {visualReviewSavePreview.readyItems.length > 0 ? (
                                        <button
                                          type="button"
                                          onClick={() => void handleSaveApprovedVisualReviewItemsToCatalog()}
                                          disabled={
                                            disabled ||
                                            savingImportedCatalog ||
                                            intelligentImportLoading ||
                                            isDebugParserMode
                                          }
                                          className="mt-3 rounded-lg bg-black px-4 py-2 text-xs font-medium text-white disabled:opacity-60"
                                        >
                                          {savingImportedCatalog
                                            ? "Salvando itens aprovados..."
                                            : isDebugParserMode
                                              ? "Salvamento visual bloqueado em diagnostico"
                                              : "Salvar itens aprovados no catalogo"}
                                        </button>
                                      ) : null}
                                      {visualReviewSavePreview.blockedItems.length > 0 ? (
                                        <div className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-900 ring-1 ring-amber-100">
                                          <p className="font-medium">Itens aprovados que precisam de ajuste:</p>
                                          {visualReviewSavePreview.blockedItems.slice(0, 5).map((entry) => (
                                            <p key={`visual-review-blocked-${entry.item.id}`}>
                                              {entry.item.name || entry.item.sku || entry.item.code || "Item sem nome"}:{" "}
                                              {entry.blockers.join(", ")}
                                              {entry.warnings.length > 0 ? ` (${entry.warnings.join(", ")})` : ""}
                                            </p>
                                          ))}
                                          {visualReviewSavePreview.blockedItems.length > 5 ? (
                                            <p>
                                              Mais {visualReviewSavePreview.blockedItems.length - 5} item(ns) precisam de ajuste.
                                            </p>
                                          ) : null}
                                        </div>
                                      ) : null}
                                      {visualReviewSaveResult ? (
                                        <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-emerald-950 ring-1 ring-emerald-100">
                                          <p className="text-sm font-semibold">Resultado do salvamento</p>
                                          {visualReviewSaveResult.savedCount > 0 ? (
                                            <p className="mt-2">
                                              {visualReviewSaveResult.savedCount} item(ns) foram salvos no catalogo.
                                            </p>
                                          ) : null}
                                          {visualReviewSaveResult.savedPhotoCount > 0 ||
                                          visualReviewSaveResult.failedPhotoCount > 0 ? (
                                            <p className="mt-1 text-emerald-900">
                                              Fotos: {visualReviewSaveResult.savedPhotoCount} salva(s),{" "}
                                              {visualReviewSaveResult.failedPhotoCount} falharam.
                                            </p>
                                          ) : null}
                                          {visualReviewSaveResult.savedCount > 0 &&
                                          visualReviewSaveResult.failedCount === 0 &&
                                          visualReviewSavePreview.blockedItems.length === 0 ? (
                                            <p className="mt-1 text-emerald-900">
                                              Tudo certo. Os itens aprovados ja estao no catalogo.
                                            </p>
                                          ) : null}
                                          {visualReviewSaveResult.savedCount > 0 &&
                                          visualReviewSaveResult.failedCount === 0 &&
                                          visualReviewSavePreview.blockedItems.length > 0 ? (
                                            <p className="mt-1 text-emerald-900">
                                              Os itens prontos foram salvos. Revise os itens que ainda precisam de ajuste.
                                            </p>
                                          ) : null}
                                          {visualReviewSaveResult.savedCount > 0 ? (
                                            <div className="mt-2 flex flex-wrap gap-2">
                                              <span className="rounded-full bg-white px-3 py-1 font-medium text-emerald-900 ring-1 ring-emerald-100">
                                                Piscinas: {visualReviewSaveResult.savedByCategory.piscinas}
                                              </span>
                                              <span className="rounded-full bg-white px-3 py-1 font-medium text-emerald-900 ring-1 ring-emerald-100">
                                                Quimicos: {visualReviewSaveResult.savedByCategory.quimicos}
                                              </span>
                                              <span className="rounded-full bg-white px-3 py-1 font-medium text-emerald-900 ring-1 ring-emerald-100">
                                                Acessorios: {visualReviewSaveResult.savedByCategory.acessorios}
                                              </span>
                                              <span className="rounded-full bg-white px-3 py-1 font-medium text-emerald-900 ring-1 ring-emerald-100">
                                                Outros: {visualReviewSaveResult.savedByCategory.outros}
                                              </span>
                                            </div>
                                          ) : null}
                                          {visualReviewSaveResult.savedItems.length > 0 ? (
                                            <div className="mt-2">
                                              <p className="font-medium">Itens salvos:</p>
                                              <div className="mt-1 space-y-1">
                                                {visualReviewSaveResult.savedItems.slice(0, 8).map((savedItem, index) => (
                                                  <p
                                                    key={`visual-review-saved-result-${savedItem.name}-${index}`}
                                                    className="break-words"
                                                  >
                                                    {savedItem.name} - {savedItem.destination}
                                                    {savedItem.photoSavedCount ? ` com ${savedItem.photoSavedCount} foto(s)` : ""}
                                                    {savedItem.photoFailedCount
                                                      ? savedItem.photoSavedCount
                                                        ? `; ${savedItem.photoFailedCount} foto(s) falharam`
                                                        : "; item salvo, mas foto(s) nao foram salvas"
                                                      : ""}
                                                  </p>
                                                ))}
                                                {visualReviewSaveResult.savedItems.length > 8 ? (
                                                  <p>
                                                    Mais {visualReviewSaveResult.savedItems.length - 8} item(ns) salvos.
                                                  </p>
                                                ) : null}
                                              </div>
                                            </div>
                                          ) : null}
                                          {visualReviewSaveResult.failedCount > 0 ? (
                                            <div className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-900 ring-1 ring-amber-100">
                                              <p className="font-medium">
                                                {visualReviewSaveResult.failedCount} item(ns) nao foram salvos.
                                              </p>
                                              <div className="mt-1 space-y-1">
                                                {visualReviewSaveResult.failedItems.slice(0, 5).map((failedItem, index) => (
                                                  <p
                                                    key={`visual-review-failed-result-${failedItem.name}-${index}`}
                                                    className="break-words"
                                                  >
                                                    {failedItem.name}: {failedItem.reason}
                                                  </p>
                                                ))}
                                                {visualReviewSaveResult.failedItems.length > 5 ? (
                                                  <p>
                                                    Mais {visualReviewSaveResult.failedItems.length - 5} falha(s).
                                                  </p>
                                                ) : null}
                                              </div>
                                            </div>
                                          ) : null}
                                          {visualReviewSaveResult.photoFailures.length > 0 ? (
                                            <div className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-900 ring-1 ring-amber-100">
                                              <p className="font-medium">
                                                {visualReviewSaveResult.failedPhotoCount} foto(s) nao foram salvas.
                                              </p>
                                              <div className="mt-1 space-y-1">
                                                {visualReviewSaveResult.photoFailures.slice(0, 5).map((failedPhoto, index) => (
                                                  <p
                                                    key={`visual-review-photo-failed-result-${failedPhoto.name}-${index}`}
                                                    className="break-words"
                                                  >
                                                    {failedPhoto.name}: {failedPhoto.reason}
                                                  </p>
                                                ))}
                                                {visualReviewSaveResult.photoFailures.length > 5 ? (
                                                  <p>
                                                    Mais {visualReviewSaveResult.photoFailures.length - 5} falha(s) de foto.
                                                  </p>
                                                ) : null}
                                              </div>
                                            </div>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}
                                {visualProductCandidates.length > 0 ? (
                                  <div className="hidden">
                                    <p className="text-sm font-semibold text-violet-950">
                                      Itens sugeridos para revisao
                                    </p>
                                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                                      {visualProductCandidates.map((candidate) => {
                                        const dimensionsText = formatVisualEvidenceDimensions(candidate.dimensions);
                                        return (
                                          <div
                                            key={candidate.candidateId}
                                            className="rounded-lg bg-white p-3 ring-1 ring-violet-100"
                                          >
                                            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                                              <div>
                                                <p className="text-sm font-semibold text-gray-900">
                                                  {candidate.name || candidate.sku || "Item sugerido"}
                                                </p>
                                                <p className="mt-1 text-xs text-gray-600">
                                                  Categoria: {getVisualCategoryLabel(candidate.category)}
                                                  {candidate.sku ? ` | Codigo: ${candidate.sku}` : ""}
                                                </p>
                                              </div>
                                              <span className="text-xs font-medium text-violet-800">
                                                {Math.round((candidate.confidence || 0) * 100)}% confianca
                                              </span>
                                            </div>
                                            {dimensionsText ? (
                                              <p className="mt-2 text-xs leading-5 text-gray-700">
                                                Medidas: {dimensionsText}
                                              </p>
                                            ) : null}
                                            {candidate.material ? (
                                              <p className="mt-1 text-xs leading-5 text-gray-700">
                                                Material: {candidate.material}
                                              </p>
                                            ) : null}
                                            {candidate.description ? (
                                              <p className="mt-1 text-xs leading-5 text-gray-700">
                                                Descricao: {candidate.description}
                                              </p>
                                            ) : null}
                                            <p className="mt-2 text-xs leading-5 text-gray-600">
                                              Paginas usadas: {candidate.sourcePages.join(", ")}
                                            </p>
                                            {candidate.missingFields.length > 0 ? (
                                              <p className="mt-1 text-xs leading-5 text-gray-600">
                                                Campos faltando: {candidate.missingFields.map(translateVisualMissingField).join(", ")}
                                              </p>
                                            ) : null}
                                            {candidate.conflicts.length > 0 ? (
                                              <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs leading-5 text-amber-800 ring-1 ring-amber-100">
                                                <p className="font-medium">Conflitos para revisar:</p>
                                                {candidate.conflicts.map((conflict) => (
                                                  <p key={`${candidate.candidateId}-${conflict.field}`}>
                                                    {translateVisualMissingField(conflict.field)}: {conflict.values.join(" / ")}
                                                  </p>
                                                ))}
                                              </div>
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : null}
                                {visualEvidenceResult.warnings.length > 0 ? (
                                  <p className="hidden">
                                    Avisos: {visualEvidenceResult.warnings.join(" ")}
                                  </p>
                                ) : null}
                                {visualEvidenceResult.pageEvidence.length === 0 ? (
                                  <p className="hidden">
                                    Nenhuma evidencia visual foi encontrada nestas paginas.
                                  </p>
                                ) : null}
                                {visualEvidenceResult.pageEvidence.map((page) => (
                                  <div
                                    key={`visual-evidence-${page.pageNumber}`}
                                    className="hidden"
                                  >
                                    <div className="grid gap-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                                      <p className="text-sm font-semibold text-gray-900">
                                        Pagina {page.pageNumber}
                                      </p>
                                      <p className="text-xs text-gray-600">
                                        Tipo: {getVisualEvidenceDisplayPageType(page)}
                                      </p>
                                    </div>
                                    {page.warnings.length > 0 ? (
                                      <p className="mt-2 text-xs leading-5 text-amber-700">
                                        Avisos: {page.warnings.join(" ")}
                                      </p>
                                    ) : null}
                                    {page.items.length === 0 ? (
                                      <p className="mt-2 text-sm text-gray-600">
                                        Nenhum nome, codigo ou medida segura nesta pagina.
                                      </p>
                                    ) : (
                                      <div className="mt-2 space-y-2">
                                        {page.items.map((item) => {
                                          const dimensionsText = formatVisualEvidenceDimensions(item.dimensions);
                                          const visibleMissingFields = getVisualDisplayMissingFields(item.missingFields, {
                                            name: item.visibleName,
                                            sku: item.visibleCode,
                                            dimensions: dimensionsText,
                                            material: item.material,
                                            description: item.description,
                                            category: item.category,
                                          });
                                          return (
                                            <div
                                              key={item.evidenceId}
                                              className="rounded-lg bg-white p-2 ring-1 ring-gray-200"
                                            >
                                              <div className="grid gap-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                                                <div>
                                                  <p className="text-sm font-medium text-gray-900">
                                                    {item.visibleName || item.visibleCode || "Evidencia sem nome"}
                                                  </p>
                                                  <p className="mt-0.5 text-xs text-gray-600">
                                                    {item.visibleCode ? `Codigo: ${item.visibleCode}` : "Codigo nao visivel"}{" "}
                                                    | Categoria: {getVisualCategoryLabel(item.category)}
                                                  </p>
                                                </div>
                                                <span className="text-xs font-medium text-violet-800">
                                                  {Math.round((item.confidence || 0) * 100)}% confianca
                                                </span>
                                              </div>
                                              {dimensionsText ? (
                                                <p className="mt-1 text-xs leading-5 text-gray-700">
                                                  Medidas: {dimensionsText}
                                                </p>
                                              ) : null}
                                              {item.material ? (
                                                <p className="mt-1 text-xs leading-5 text-gray-700">
                                                  Material: {item.material}
                                                </p>
                                              ) : null}
                                              {item.description ? (
                                                <p className="mt-1 text-xs leading-5 text-gray-700">
                                                  Descricao: {item.description}
                                                </p>
                                              ) : null}
                                              {visibleMissingFields.length > 0 ? (
                                                <p className="mt-1 text-xs leading-5 text-gray-600">
                                                  Campos faltando: {visibleMissingFields.map(translateVisualMissingField).join(", ")}
                                                </p>
                                              ) : null}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      <div className="hidden">
                        <p className="text-sm font-semibold text-gray-900">Prévia dos arquivos extraídos</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Mostrando ate 10 arquivos na tela.
                        </p>
                        {safeExtractedPreview.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-500">
                            Nenhum texto foi extraído nesta tentativa.
                          </p>
                        ) : (
                          <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                            {safeExtractedPreview.slice(0, 10).map((item, index) => (
                              <div
                                key={`${item.fileName}-${item.extension}`}
                                className={cx("px-3 py-2.5", index > 0 ? "border-t border-gray-200" : "")}
                              >
                                <div className="grid gap-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-3">
                                  <p className="truncate text-sm font-semibold text-gray-900">{item.fileName}</p>
                                  <p className="text-xs text-gray-500 md:text-right">
                                    {item.extension.toUpperCase()} • {item.mimeType}
                                  </p>
                                </div>
                                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-5 text-gray-700">
                                  {item.textPreview || "Sem texto extraído nesta fase."}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="hidden">
                        <p className="text-sm font-semibold text-gray-900">
                          Fotos encontradas nos arquivos
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          Mostrando ate 10 fotos. Fotos com pista de item usam aba, linha ou celula quando
                          o arquivo fornece esses dados.
                        </p>
                        {safeExtractedImagePreview.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-500">
                            Nenhuma foto embutida foi encontrada nos arquivos desta análise.
                          </p>
                        ) : (
                          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                            {safeExtractedImagePreview.slice(0, 10).map((image, index) => (
                              <div
                                key={`${image.sourceFileName}-${image.fileName}-${index}`}
                                className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                              >
                                <div className="aspect-square w-full bg-white">
                                  {String(image.dataUrl || "").trim() ? (
                                    <img
                                      src={image.dataUrl}
                                      alt={image.fileName}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-gray-500">
                                      Sem miniatura
                                    </div>
                                  )}
                                </div>
                                <div className="border-t border-gray-200 px-3 py-2">
                                  <p className="truncate text-xs font-semibold text-gray-800">
                                    {image.fileName}
                                  </p>
                                  <p className="mt-1 truncate text-[11px] text-gray-500">
                                    Origem: {image.sourceFileName}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="hidden">
                        <p className="text-sm font-semibold text-gray-900">Prévia dos blocos classificados</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Mostrando ate 12 blocos classificados. Arquivos grandes podem ter mais itens do que esta previa.
                        </p>
                        {safeNormalizedPreview.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-500">
                            Nenhum bloco foi classificado nesta tentativa.
                          </p>
                        ) : (
                          <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                            {safeNormalizedPreview.slice(0, 12).map((item, index) => (
                              <div key={`${item.sourceFileName}-${item.title}-${index}`} className={cx("px-3 py-2.5", index > 0 ? "border-t border-gray-200" : "")}>
                                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
                                    <p className="text-xs text-gray-500">
                                      Tipo: {item.type} • Arquivo: {item.sourceFileName}
                                    </p>
                                  </div>
                                  <span className="inline-flex rounded-full bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
                                    {Math.round(item.confidence * 100)}%
                                  </span>
                                </div>
                                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm leading-5 text-gray-700">
                                  {item.rawText}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="hidden">
                        <p className="text-sm font-semibold text-gray-900">Prévia da deduplicação</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Mostrando ate 12 itens. Duplicados detectados nao entram como candidatos principais para salvar.
                        </p>
                        {safeDedupedPreview.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-500">
                            Nenhum item foi analisado na deduplicação.
                          </p>
                        ) : (
                          <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                            {safeDedupedPreview.slice(0, 12).map((item, index) => (
                              <div
                                key={`${item.dedupKey}-${index}`}
                                className={cx(
                                  "px-3 py-2.5",
                                  index > 0 ? "border-t border-gray-200" : "",
                                  item.isDuplicate ? "bg-amber-50" : "bg-white"
                                )}
                              >
                                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-3">
                                  <div>
                                    <p className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
                                    <p className="text-xs text-gray-500">
                                      Tipo: {item.type} • Arquivo: {item.sourceFileName}
                                    </p>
                                  </div>
                                  <span
                                    className={cx(
                                      "rounded-full px-3 py-1 text-xs font-medium ring-1",
                                      item.isDuplicate
                                        ? "bg-white text-amber-800 ring-amber-200"
                                        : "bg-white text-gray-700 ring-gray-200"
                                    )}
                                  >
                                    {item.isDuplicate
                                      ? `Duplicado de: ${item.duplicateOf ?? "item anterior"}`
                                      : "Único nesta análise"}
                                  </span>
                                </div>
                                <p className="mt-3 break-all text-xs text-gray-500">
                                  Chave: {item.dedupKey}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              {intelligentImportResult?.ok &&
              !hasVisualPdfImportResult &&
              structuredUnifiedReviewItems.length > 0 ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4">
                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)] md:items-start">
                    <div>
                      <p className="text-base font-semibold text-emerald-950">
                        Itens estruturados consolidados para revisao
                      </p>
                      <p className="mt-1 text-sm leading-6 text-emerald-900">
                        A leitura estruturada agora usa o mesmo card rico da revisao visual, sem mudar o salvamento seguro do backend.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 rounded-2xl border border-emerald-100 bg-white/80 p-3 md:grid-cols-[minmax(0,1fr)_320px]">
                    <label className="relative block">
                      <span className="sr-only">Buscar item na revisao</span>
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 20 20"
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <circle cx="8.5" cy="8.5" r="5.5" />
                        <path d="M13 13l4 4" strokeLinecap="round" />
                      </svg>
                      <input
                        type="search"
                        value={structuredReviewSearchQuery}
                        onChange={(event) => setStructuredReviewSearchQuery(event.target.value)}
                        placeholder="Buscar por nome, SKU, categoria, marca, linha ou modelo"
                        className="w-full rounded-xl border border-emerald-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none ring-0 placeholder:text-slate-400"
                      />
                    </label>
                    <div className="flex flex-col gap-2 md:col-span-2 md:flex-row md:items-center md:justify-between">
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["all", "Todos", structuredReviewCounts.found],
                          ["selected", "Selecionados", structuredReviewCounts.selected],
                          ["deselected", "Desmarcados", structuredReviewCounts.deselected],
                          ["ignored", "Ignorados", structuredReviewCounts.ignored],
                        ].map(([value, label, count]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setStructuredReviewFilter(value as StructuredReviewListFilter)}
                            className={cx(
                              "rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition",
                              structuredReviewFilter === value
                                ? "bg-emerald-900 text-white ring-emerald-900"
                                : "bg-white text-emerald-900 ring-emerald-200 hover:bg-emerald-50"
                            )}
                          >
                            {label} ({count})
                          </button>
                        ))}
                      </div>
                      {structuredReviewHasGlobalConfirmation ? (
                        <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                          Revisao global confirmada
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                          Confirmacao global pendente
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-emerald-100 bg-white/70 p-2 shadow-inner">
                    <div className="max-h-[min(68vh,52rem)] overflow-y-auto overscroll-contain pr-1">
                      {filteredStructuredUnifiedReviewItems.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-emerald-200 bg-white/80 px-4 py-6 text-sm text-slate-600">
                          Nenhum item corresponde ao filtro ou busca atual.
                        </div>
                      ) : (
                      <div className="space-y-2">
                    {filteredStructuredUnifiedReviewItems.map((item) => {
                      const primaryPhoto = item.photoResolution.primary;
                      const photoAmbiguous = item.photoResolution.state === "ambiguous";
                      const photoEvidence = item.photoResolution.state === "evidence";
                      const photoEvidenceCount =
                        item.photoResolution.state === "evidence" ? item.photoResolution.candidates.length : 0;
                      const confirmedEvidenceCount =
                        item.photoResolution.state === "evidence"
                          ? item.photoResolution.confirmedCandidateKeys.length
                          : 0;
                      const compactStatus = getStructuredCompactStatus(item);
                      return (
                        <div
                          key={item.candidate.id}
                          className="rounded-xl bg-white p-2.5 shadow-sm ring-1 ring-emerald-100"
                        >
                          <div className="grid gap-3 md:grid-cols-[88px_minmax(0,1fr)] xl:grid-cols-[88px_minmax(0,1fr)_220px] xl:items-start">
                            <div className="min-w-0">
                              {primaryPhoto?.dataUrl ? (
                                <div className="space-y-2">
                                  <img
                                    src={primaryPhoto.dataUrl}
                                    alt={primaryPhoto.fileName}
                                    className="h-20 w-20 rounded-lg object-cover ring-1 ring-gray-200 md:h-24 md:w-24"
                                  />
                                  {photoEvidence && item.photoResolution.candidates.length > 1 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {item.photoResolution.candidates.slice(1, 4).map((candidate) => (
                                        <img
                                          key={candidate.key}
                                          src={candidate.dataUrl}
                                          alt={candidate.fileName}
                                          className="h-8 w-8 rounded-md object-cover ring-1 ring-gray-200"
                                        />
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                    <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-gray-100 p-2 text-center text-[11px] leading-4 text-gray-500 ring-1 ring-gray-200 md:h-24 md:w-24">
                                  {photoAmbiguous
                                    ? `${item.photoResolution.candidates.length} fotos encontradas, associacao ambigua`
                                    : "Nenhuma foto associada"}
                                </div>
                              )}
                              {false ? <div className="mt-2 space-y-1 text-[11px] leading-4 text-gray-600">
                                <p className="font-medium text-gray-700">Origem da foto</p>
                                <p>
                                  {primaryPhoto
                                    ? `${primaryPhoto?.fileName || ""} • ${primaryPhoto?.association || ""}`
                                    : item.photoResolution.message}
                                </p>
                                {primaryPhoto?.sourceFileName ? <p>Arquivo: {primaryPhoto!.sourceFileName}</p> : null}
                                {primaryPhoto ? (
                                  <p>
                                    Midia: {primaryPhoto!.id} • Forca: {primaryPhoto!.associationStrength}
                                  </p>
                                ) : null}
                              </div> : null}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={cx(
                                    "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                                    item.duplicateReason
                                      ? "bg-rose-100 text-rose-800 ring-rose-200"
                                      : item.candidate.manuallyIgnored
                                        ? "bg-slate-100 text-slate-700 ring-slate-200"
                                      : item.candidate.selected
                                        ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                                        : "bg-amber-100 text-amber-800 ring-amber-200"
                                  )}
                                >
                                  {item.stateLabel}
                                </span>
                                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
                                  {getStructuredReviewCategoryLabel(item.candidate.finalCategory)}
                                </span>
                                {item.hasLocalEdits ? (
                                  <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800 ring-1 ring-violet-200">
                                    Editado
                                  </span>
                                ) : null}
                                {item.categoryAdjusted ? (
                                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800 ring-1 ring-sky-200">
                                    Categoria ajustada
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-2 text-sm font-semibold leading-5 text-gray-950">
                                {item.displayName || "Item estruturado"}
                              </p>
                              <p className="mt-1 text-xs leading-5 text-gray-600">
                                {item.sku ? `SKU ${item.sku}` : "SKU nao informado"}{" "}
                                {" • "}
                                {item.priceLabel || "Sem preco"}{" "}
                                {" • "}
                                {item.stockLabel ? `Estoque ${item.stockLabel}` : "Sem estoque"}
                              </p>
                              {false ? <div className="mt-2 text-xs leading-5 text-gray-700">
                                Tipo final: {item.sourceKind} • Origem: {item.originLabel || "Leitura estruturada"}
                              <p className="mt-1 text-xs leading-5 text-gray-600">
                                Arquivo: {item.sourceFileName || "Nao informado"}
                                {item.sourceSheetName ? ` • Aba: ${item.sourceSheetName}` : ""}
                                {item.worksheetRowNumber != null ? ` • Linha: ${item.worksheetRowNumber}` : ""}
                              </p>
                              {item.sourceLocationKey ? (
                                <p className="mt-1 break-all text-[11px] leading-5 text-gray-500">
                                  sourceLocationKey: {item.sourceLocationKey}
                                </p>
                              ) : null}
                              </div> : null}
                              <div
                                className={cx(
                                  "mt-2 inline-flex max-w-full rounded-lg px-2.5 py-1 text-xs font-medium ring-1",
                                  compactStatus.tone === "blocked"
                                    ? "bg-rose-50 text-rose-800 ring-rose-200"
                                    : compactStatus.tone === "warning"
                                      ? "bg-amber-50 text-amber-900 ring-amber-200"
                                      : "bg-emerald-50 text-emerald-900 ring-emerald-200"
                                )}
                              >
                                <span className="truncate">{compactStatus.label}</span>
                              </div>
                              {photoEvidence ? (
                                <p className="mt-2 text-xs leading-5 text-amber-900">
                                  {confirmedEvidenceCount > 0
                                    ? `${confirmedEvidenceCount} foto(s) do documento confirmada(s) para este produto.`
                                    : `${photoEvidenceCount} foto(s) encontradas neste bloco - confirme para incluir no catalogo.`}
                                </p>
                              ) : null}
                              {false ? <>
                              {item.descriptionSnippet ? (
                                <p className="mt-2 text-sm leading-6 text-gray-700">
                                  {item.descriptionSnippet}
                                </p>
                              ) : null}
                              </> : null}
                              {false ? <>
                              {item.warnings.length > 0 ? (
                                <div className="mt-2 space-y-1 rounded-md bg-amber-50 p-2 text-xs leading-5 text-amber-900 ring-1 ring-amber-100">
                                  {item.warnings.map((warning, index) => (
                                    <p key={`${item.candidate.id}-warning-${index}`}>{warning}</p>
                                  ))}
                                </div>
                              ) : null}
                              </> : null}
                              {false ? <>
                              {item.blockingReasons.length > 0 ? (
                                <div className="mt-2 space-y-1 rounded-md bg-rose-50 p-2 text-xs leading-5 text-rose-900 ring-1 ring-rose-100">
                                  {item.blockingReasons.map((reason, index) => (
                                    <p key={`${item.candidate.id}-blocking-${index}`}>{reason}</p>
                                  ))}
                                </div>
                              ) : null}
                              </> : null}
                            </div>
                            <div className="flex min-w-0 flex-col gap-2 md:col-span-2 xl:col-span-1 xl:w-[220px]">
                              <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-600">Categoria</label>
                              <select
                                value={item.candidate.finalCategory}
                                onChange={(event) =>
                                  updateStructuredReviewCandidate(item.candidate.id, {
                                    finalCategory: event.target.value as StructuredReviewCategory,
                                  })
                                }
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none"
                              >
                                <option value="pool">Piscina</option>
                                <option value="quimicos">Quimico</option>
                                <option value="acessorios">Acessorio</option>
                                <option value="outros">Outro</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => openStructuredCandidateEditor(item.candidate)}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
                              >
                                Editar detalhes
                              </button>
                              {!item.duplicateReason ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateStructuredReviewCandidate(item.candidate.id, {
                                      selected: !item.candidate.selected,
                                      manuallyIgnored: item.candidate.selected,
                                      humanReviewConfirmed: item.candidate.selected
                                        ? item.candidate.humanReviewConfirmed
                                        : true,
                                    })
                                  }
                                  className={cx(
                                    "rounded-lg border px-3 py-2 text-sm font-medium transition",
                                    item.candidate.selected
                                      ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                                      : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                  )}
                                >
                                  {item.candidate.selected ? "Ignorar item" : "Selecionar novamente"}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                      </div>
                      )}
                    </div>
                  </div>
                </div>
                ) : null}
              {intelligentImportResult?.ok &&
              !hasVisualPdfImportResult &&
              editableStructuredCandidates.length > 0 &&
              structuredUnifiedReviewItems.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-base font-semibold text-slate-900">
                        Revisar itens encontrados
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        Nada foi salvo ainda. Confira os itens detectados e escolha o que deve entrar no catalogo.
                      </p>
                      {structuredDuplicateReferencesLoading ? (
                        <p className="mt-2 text-xs font-medium text-slate-500">
                          Verificando duplicidades da loja...
                        </p>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="font-semibold text-slate-900">{structuredReviewCounts.found}</p>
                        <p className="mt-1 text-slate-600">Encontrados</p>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                        <p className="font-semibold text-emerald-900">{structuredReviewCounts.selected}</p>
                        <p className="mt-1 text-emerald-700">Selecionados</p>
                      </div>
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                        <p className="font-semibold text-amber-900">{structuredReviewCounts.deselected}</p>
                        <p className="mt-1 text-amber-700">Desmarcados</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 max-h-[30rem] space-y-3 overflow-y-auto pr-1">
                    {editableStructuredCandidates.map((candidate) => {
                      const item = candidate.sourceItem;
                      const candidateDraft = structuredCandidateDrafts[candidate.id];
                      const candidateValidation = structuredReviewValidation.byCandidateId.get(candidate.id);
                      const isDuplicate = Boolean(candidateValidation?.duplicateReason);
                      const displayName =
                        String(candidateDraft?.name || "").trim() ||
                        buildStructuredReviewDisplayName(item, candidate.finalCategory);
                      const sku =
                        String(candidateDraft?.sku || "").trim() ||
                        String(resolveImportedCatalogSku(item) || "").trim();
                      const priceLabel =
                        formatStructuredDraftPriceLabel(candidateDraft?.price || "") ||
                        formatStructuredReviewPriceLabel(item);
                      const descriptionSnippet = candidateValidation?.item
                        ? buildStructuredReviewDescriptionSnippet(candidateValidation.item)
                        : String(candidateDraft?.description || "").trim()
                          ? buildStructuredDraftDescriptionSnippet(candidateDraft?.description || "")
                          : buildStructuredReviewDescriptionSnippet(item);
                      const ignoreReasons = buildStructuredReviewIgnoreReasons(
                        candidateValidation?.item || item,
                        candidateValidation?.duplicateReason
                      );
                      const originLabel = buildStructuredReviewOriginLabel(item);
                      const categoryAdjusted = candidate.finalCategory !== candidate.initialCategory;
                      const hasLocalEdits = Boolean(candidateDraft);
                      const stateLabel = isDuplicate
                        ? "Nao sera salvo"
                        : candidate.manuallyIgnored
                          ? "Ignorado manualmente"
                        : candidate.selected
                          ? "Selecionado para salvar"
                          : "Revisar antes de salvar";

                      return (
                        <div
                          key={candidate.id}
                          className={cx(
                            "rounded-2xl border p-4 transition",
                            isDuplicate
                              ? "border-rose-200 bg-rose-50/70"
                              : candidate.selected
                                ? "border-slate-200 bg-slate-50"
                              : "border-amber-200 bg-amber-50/60"
                          )}
                        >
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={cx(
                                    "rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
                                    isDuplicate
                                      ? "bg-rose-100 text-rose-800 ring-rose-200"
                                      : candidate.manuallyIgnored
                                        ? "bg-slate-100 text-slate-700 ring-slate-200"
                                      : candidate.selected
                                        ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                                      : "bg-amber-100 text-amber-800 ring-amber-200"
                                  )}
                                >
                                  {stateLabel}
                                </span>
                                {isDuplicate ? (
                                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-rose-700 ring-1 ring-rose-200">
                                    Duplicado
                                  </span>
                                ) : null}
                                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
                                  Categoria: {getStructuredReviewCategoryLabel(candidate.finalCategory)}
                                </span>
                                {hasLocalEdits ? (
                                  <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-800 ring-1 ring-violet-200">
                                    Editado
                                  </span>
                                ) : null}
                                {categoryAdjusted ? (
                                  <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-800 ring-1 ring-sky-200">
                                    Categoria ajustada
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-3 truncate text-sm font-semibold text-slate-900">
                                {displayName || "Item detectado"}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                                {sku ? <span>SKU: {sku}</span> : null}
                                {priceLabel ? <span>Preco: {priceLabel}</span> : null}
                                {originLabel ? <span>Origem: {originLabel}</span> : null}
                              </div>
                              {candidateValidation?.duplicateReason ? (
                                <p className="mt-2 text-sm font-medium text-rose-700">
                                  {candidateValidation.duplicateReason}
                                </p>
                              ) : null}
                              {!candidate.selected && !candidateValidation?.duplicateReason && ignoreReasons[0] ? (
                                <p className="mt-2 text-sm font-medium text-amber-700">
                                  {ignoreReasons.join(" ")}
                                </p>
                              ) : null}
                              {descriptionSnippet ? (
                                <p className="mt-2 text-sm leading-6 text-slate-600">
                                  {descriptionSnippet}
                                </p>
                              ) : null}
                            </div>

                            <div className="flex w-full flex-col gap-2 lg:w-56">
                              <label className="text-xs font-medium text-slate-700">Salvar como</label>
                              <select
                                value={candidate.finalCategory}
                                onChange={(event) =>
                                  updateStructuredReviewCandidate(candidate.id, {
                                    finalCategory: event.target.value as StructuredReviewCategory,
                                  })
                                }
                                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none"
                              >
                                <option value="pool">Piscina</option>
                                <option value="quimicos">Quimico</option>
                                <option value="acessorios">Acessorio</option>
                                <option value="outros">Outro</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => openStructuredCandidateEditor(candidate)}
                                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
                              >
                                Editar
                              </button>
                              {!isDuplicate ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                  updateStructuredReviewCandidate(candidate.id, {
                                    selected: !candidate.selected,
                                    manuallyIgnored: candidate.selected,
                                    humanReviewConfirmed: candidate.selected
                                      ? candidate.humanReviewConfirmed
                                      : true,
                                    })
                                  }
                                  className={cx(
                                    "rounded-xl border px-3 py-2 text-sm font-medium transition",
                                    candidate.selected
                                      ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                                      : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                  )}
                                >
                                  {candidate.selected ? "Ignorar item" : "Selecionar novamente"}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {intelligentImportResult?.ok && !hasVisualPdfImportResult ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-base font-semibold text-emerald-900">
                        Salvar itens aprovados no catálogo
                      </p>
                      <p className="mt-1 text-sm leading-6 text-emerald-900">
                        Só os itens selecionados na revisão acima serão salvos. Piscinas continuam indo para
                        Piscinas, produtos químicos para Químicos, acessórios para Acessórios e o restante para
                        Outros.
                      </p>
                      {editableStructuredCandidates.length > 0 &&
                      structuredSelectedCandidates.length === 0 ? (
                        <p className="mt-2 text-sm font-medium text-amber-700">
                          Nenhum item valido selecionado para salvar.
                        </p>
                      ) : null}
                      {editableStructuredCandidates.length > 0 && structuredSelectedCandidates.length > 0 ? (
                        <p className="mt-2 text-sm font-medium text-slate-700">
                          {structuredReviewHasGlobalConfirmation
                            ? "A revisao global atual ja foi confirmada."
                            : "Antes da acao final, confirme globalmente a revisao dos itens selecionados."}
                        </p>
                      ) : null}
                      {structuredDuplicateReferencesLoading ? (
                        <p className="mt-2 text-xs font-medium text-slate-600">
                          Aguarde a validacao de duplicidades para liberar o salvamento.
                        </p>
                      ) : null}
                      {parserDebugEnabled ? (
                        <p className="mt-2 text-sm font-medium text-amber-800">
                          <code>debugParser=true</code> ativo. O salvamento real fica bloqueado neste modo e o teste
                          deve usar apenas a validacao sem gravar.
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2 md:items-end">
                      {parserDebugEnabled ? (
                        <button
                          type="button"
                          onClick={() => void handleValidateImportedItemsDryRun()}
                          disabled={
                            disabled ||
                            savingImportedCatalog ||
                            intelligentImportLoading ||
                            structuredDuplicateReferencesLoading ||
                            (editableStructuredCandidates.length > 0 &&
                              structuredSelectedCandidates.length === 0)
                          }
                          className="rounded-xl bg-sky-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
                        >
                          {savingImportedCatalog
                            ? "Validando sem gravar..."
                            : "Validar salvamento sem gravar"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleSaveImportedItemsToCatalog()}
                        disabled={
                          disabled ||
                          parserDebugEnabled ||
                          savingImportedCatalog ||
                          intelligentImportLoading ||
                          structuredDuplicateReferencesLoading ||
                          (editableStructuredCandidates.length > 0 &&
                            structuredSelectedCandidates.length === 0)
                        }
                        className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
                      >
                        {parserDebugEnabled
                          ? "Salvar itens aprovados bloqueado em debug"
                          : savingImportedCatalog
                            ? "Salvando no sistema..."
                            : "Salvar itens aprovados"}
                      </button>
                    </div>
                  </div>
                  {parserDebugEnabled && importedCatalogDryRunResult ? (
                    <div className="mt-4 rounded-2xl border border-sky-200 bg-white p-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-sky-950">
                            Resultado da validacao sem gravar
                          </p>
                          <p className="text-xs leading-5 text-sky-900">
                            O payload abaixo foi enviado com <code>validateOnly=true</code>. Nenhum item foi gravado.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs font-medium">
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-800">
                            total {importedCatalogDryRunResult.summary.total}
                          </span>
                          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
                            valid {importedCatalogDryRunResult.summary.valid}
                          </span>
                          <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-800">
                            invalid {importedCatalogDryRunResult.summary.invalid}
                          </span>
                          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
                            blockedDuplicate {importedCatalogDryRunResult.summary.blockedDuplicate}
                          </span>
                          <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">
                            saved {importedCatalogDryRunResult.summary.saved}
                          </span>
                        </div>
                      </div>
                      <p className="mt-3 text-sm text-slate-700">{importedCatalogDryRunResult.message}</p>
                      {importedCatalogDryRunResult.importFileLinkPlan ? (
                        <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950">
                          <p className="font-semibold">Plano de vinculos de arquivo bruto</p>
                          <p className="mt-1">
                            importedFileIds recebidos:{" "}
                            {importedCatalogDryRunResult.importFileLinkPlan.importedFileIdsReceived.length}
                            {" • "}
                            arquivos validados:{" "}
                            {importedCatalogDryRunResult.importFileLinkPlan.importFilesValidated.length}
                            {" • "}
                            itens vinculaveis:{" "}
                            {importedCatalogDryRunResult.importFileLinkPlan.linkableItems.length}
                            {" • "}
                            vinculos que seriam criados:{" "}
                            {importedCatalogDryRunResult.importFileLinkPlan.wouldCreateImportFileItemLinks}
                          </p>
                          {importedCatalogDryRunResult.importFileLinkPlan.warnings.length > 0 ? (
                            <div className="mt-2 space-y-1 text-xs leading-5 text-indigo-900">
                              {importedCatalogDryRunResult.importFileLinkPlan.warnings.map((warning, index) => (
                                <p key={`dry-run-import-plan-warning-${index}`}>{warning}</p>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {importedCatalogDryRunResult.photoPlan ? (
                        <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-950">
                          <p className="font-semibold">Plano de fotos / midias</p>
                          <p className="mt-1">
                            midias recebidas: {importedCatalogDryRunResult.photoPlan.receivedMediaRefs.length}
                            {" • "}
                            fotos finais planejaveis: {importedCatalogDryRunResult.photoPlan.plannedFinalPhotos.length}
                            {" • "}
                            bloqueadas: {importedCatalogDryRunResult.photoPlan.blockedMediaRefs.length}
                            {" • "}
                            uploads finais: {importedCatalogDryRunResult.photoPlan.wouldUploadFinalPhotoObjects}
                          </p>
                          <p className="mt-1">
                            wouldCreatePoolPhotos: {importedCatalogDryRunResult.photoPlan.wouldCreatePoolPhotos}
                            {" • "}
                            wouldCreateCatalogItemPhotos:{" "}
                            {importedCatalogDryRunResult.photoPlan.wouldCreateCatalogItemPhotos}
                          </p>
                          {importedCatalogDryRunResult.photoPlan.receivedMediaRefs.length === 0 ? (
                            <p className="mt-2 text-xs leading-5 text-cyan-900">
                              Nenhuma midia selecionada/planejada para foto final neste dry-run.
                            </p>
                          ) : null}
                          {importedCatalogDryRunResult.photoPlan.warnings.length > 0 ? (
                            <div className="mt-2 space-y-1 text-xs leading-5 text-cyan-900">
                              {importedCatalogDryRunResult.photoPlan.warnings.map((warning, index) => (
                                <p key={`dry-run-photo-plan-warning-${index}`}>{warning}</p>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {parserDebugEnabled && importedCatalogMediaRefDebug ? (
                        <div className="mt-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm text-fuchsia-950">
                          <p className="font-semibold">Debug selectedMediaRefs / staging</p>
                          <p className="mt-1">
                            stagedMediaAssets disponiveis: {importedCatalogMediaRefDebug.stagedMediaAssetsAvailable}
                            {" • "}
                            selectedMediaRefs montados: {importedCatalogMediaRefDebug.selectedMediaRefsCount}
                          </p>
                          {importedCatalogMediaRefDebug.matchedSamples.length > 0 ? (
                            <div className="mt-2 space-y-1 text-xs leading-5 text-fuchsia-900">
                              {importedCatalogMediaRefDebug.matchedSamples.map((sample, index) => (
                                <p key={`media-ref-match-${index}`}>
                                  match {index + 1}: item {sample.clientItemId} {"->"} {sample.stagedAssetId} | row{" "}
                                  {sample.worksheetRowNumber ?? "-"} | file {sample.sourceFileName || "-"}
                                </p>
                              ))}
                            </div>
                          ) : null}
                          {importedCatalogMediaRefDebug.unmatchedSamples.length > 0 ? (
                            <div className="mt-2 space-y-1 text-xs leading-5 text-fuchsia-900">
                              {importedCatalogMediaRefDebug.unmatchedSamples.map((sample, index) => (
                                <p key={`media-ref-unmatched-${index}`}>
                                  sem match {index + 1}: item {sample.clientItemId} | row{" "}
                                  {sample.worksheetRowNumber ?? "-"} | motivos: {sample.reasons.join(" ; ")}
                                </p>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                          Payload enviado no dry-run
                        </summary>
                        <pre className="mt-3 max-h-[360px] overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
                          {JSON.stringify(importedCatalogDryRunPayload, null, 2)}
                        </pre>
                      </details>
                      {importedCatalogDryRunResult.importFileLinkPlan ? (
                        <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                            Plano detalhado de vinculos/import files
                          </summary>
                          <pre className="mt-3 max-h-[320px] overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
                            {JSON.stringify(importedCatalogDryRunResult.importFileLinkPlan, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                      {importedCatalogDryRunResult.photoPlan ? (
                        <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                            Plano detalhado de fotos/midias
                          </summary>
                          <pre className="mt-3 max-h-[320px] overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
                            {JSON.stringify(importedCatalogDryRunResult.photoPlan, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                      {parserDebugEnabled && importedCatalogMediaRefDebug ? (
                        <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                            Debug detalhado de selectedMediaRefs / staging
                          </summary>
                          <pre className="mt-3 max-h-[320px] overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
                            {JSON.stringify(importedCatalogMediaRefDebug, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                      <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                          Resultado detalhado da validacao
                        </summary>
                        <pre className="mt-3 max-h-[420px] overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
                          {JSON.stringify(importedCatalogDryRunResult, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {structuredReviewPendingAction ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
                  <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
                    <p className="text-sm font-medium text-slate-500">Confirmacao global da revisao</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">
                      {structuredReviewPendingAction === "dry-run"
                        ? `Validar revisao de ${structuredReviewCounts.selected} item(ns)`
                        : `Salvar revisao de ${structuredReviewCounts.selected} item(ns)`}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-700">
                      Esta etapa confirma que os itens auto-selecionados tambem foram revisados por humano antes da acao final.
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-slate-500">Encontrados</p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">{structuredReviewCounts.found}</p>
                      </div>
                      <div className="rounded-xl bg-emerald-50 p-3">
                        <p className="text-emerald-700">Selecionados</p>
                        <p className="mt-1 text-lg font-semibold text-emerald-900">{structuredReviewCounts.selected}</p>
                      </div>
                      <div className="rounded-xl bg-amber-50 p-3">
                        <p className="text-amber-700">Desmarcados</p>
                        <p className="mt-1 text-lg font-semibold text-amber-900">{structuredReviewCounts.deselected}</p>
                      </div>
                      <div className="rounded-xl bg-slate-100 p-3">
                        <p className="text-slate-600">Ignorados</p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">{structuredReviewCounts.ignored}</p>
                      </div>
                    </div>
                    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        onClick={() => setStructuredReviewPendingAction(null)}
                        className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        Voltar para revisar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const pendingAction = structuredReviewPendingAction;
                          const confirmation = {
                            confirmed: true,
                            confirmedAt: new Date().toISOString(),
                            reviewStateSignature: structuredReviewStateSignature,
                            revisionVersion: structuredReviewRevisionVersion,
                            summary: {
                              deselectedCount: structuredReviewCounts.deselected,
                              foundCount: structuredReviewCounts.found,
                              ignoredCount: structuredReviewCounts.ignored,
                              selectedCount: structuredReviewCounts.selected,
                            },
                          } satisfies IntelligentImportGlobalReviewConfirmation;
                          setStructuredReviewGlobalConfirmation(confirmation);
                          setStructuredReviewPendingAction(null);
                          if (pendingAction === "dry-run") {
                            void handleValidateImportedItemsDryRun({
                              globalReviewConfirmationOverride: confirmation,
                              skipGlobalConfirmation: true,
                            });
                            return;
                          }
                          void handleSaveImportedItemsToCatalog({
                            globalReviewConfirmationOverride: confirmation,
                            skipGlobalConfirmation: true,
                          });
                        }}
                        className="rounded-xl bg-emerald-900 px-4 py-2 text-sm font-medium text-white"
                      >
                        {structuredReviewPendingAction === "dry-run"
                          ? `Confirmar revisao e validar ${structuredReviewCounts.selected} itens`
                          : `Confirmar revisao e salvar ${structuredReviewCounts.selected} itens`}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              {editingStructuredCandidate && structuredCandidateEditorDraft ? (
                <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35">
                  <div className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
                    <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
                      <div>
                        <p className="text-sm font-medium text-slate-500">Editar candidato</p>
                        <h3 className="mt-1 text-lg font-semibold text-slate-900">
                          {structuredCandidateEditorDraft.name || "Item em revisão"}
                        </h3>
                        <p className="mt-1 text-sm text-slate-600">
                          Ajuste os dados localmente antes do salvamento final.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={closeStructuredCandidateEditor}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        Fechar
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-6 py-5">
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Salvar como</span>
                          <select
                            value={structuredCandidateEditorDraft.finalCategory}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      finalCategory: event.target.value as StructuredReviewCategory,
                                    }
                                  : current
                              )
                            }
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                          >
                            <option value="pool">Piscina</option>
                            <option value="quimicos">Quimico</option>
                            <option value="acessorios">Acessorio</option>
                            <option value="outros">Outro</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Nome</span>
                          <input
                            value={structuredCandidateEditorDraft.name}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, name: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        {editingStructuredPhotoResolution?.state === "evidence" ? (
                          <div className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-amber-950">Fotos encontradas no documento</p>
                                <p className="mt-1 text-sm text-amber-900">
                                  {editingStructuredPhotoResolution.confirmedCandidateKeys.length > 0
                                    ? `${editingStructuredPhotoResolution.confirmedCandidateKeys.length} foto(s) confirmada(s) neste produto.`
                                    : `${editingStructuredPhotoResolution.candidates.length} foto(s) encontradas neste bloco - confirme para incluir no catalogo.`}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setStructuredCandidateEditorDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            confirmedDocxImageKeys: editingStructuredPhotoResolution.candidates.map(
                                              (candidate) => candidate.key
                                            ),
                                          }
                                        : current
                                    )
                                  }
                                  className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900"
                                >
                                  Confirmar todas
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setStructuredCandidateEditorDraft((current) =>
                                      current ? { ...current, confirmedDocxImageKeys: [] } : current
                                    )
                                  }
                                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                                >
                                  Desmarcar todas
                                </button>
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              {editingStructuredPhotoResolution.candidates.map((candidate) => {
                                const checked = structuredCandidateEditorDraft.confirmedDocxImageKeys.includes(candidate.key);
                                return (
                                  <label
                                    key={candidate.key}
                                    className={cx(
                                      "overflow-hidden rounded-2xl border bg-white",
                                      checked ? "border-emerald-300 ring-2 ring-emerald-200" : "border-slate-200"
                                    )}
                                  >
                                    <img
                                      src={candidate.dataUrl}
                                      alt={candidate.fileName}
                                      className="h-28 w-full object-cover"
                                    />
                                    <div className="space-y-2 p-3">
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(event) =>
                                            setStructuredCandidateEditorDraft((current) => {
                                              if (!current) return current;
                                              const nextKeys = event.target.checked
                                                ? Array.from(new Set([...current.confirmedDocxImageKeys, candidate.key]))
                                                : current.confirmedDocxImageKeys.filter((key) => key !== candidate.key);
                                              return {
                                                ...current,
                                                confirmedDocxImageKeys: nextKeys,
                                              };
                                            })
                                          }
                                          className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                                        />
                                        <span className="text-sm font-medium text-slate-900">
                                          {checked ? "Confirmada" : "Evidencia do documento"}
                                        </span>
                                      </div>
                                      <p className="truncate text-xs text-slate-600">{candidate.fileName}</p>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">SKU</span>
                          <input
                            value={structuredCandidateEditorDraft.sku}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, sku: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Marca</span>
                          <input
                            value={structuredCandidateEditorDraft.brand}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, brand: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Preço</span>
                          <input
                            value={structuredCandidateEditorDraft.price}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, price: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Estoque</span>
                          <input
                            value={structuredCandidateEditorDraft.stock}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, stock: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Linha / Modelo</span>
                          <input
                            value={structuredCandidateEditorDraft.modelLine}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, modelLine: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Unidade</span>
                          <input
                            value={structuredCandidateEditorDraft.unit}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, unit: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Tamanho / Variação</span>
                          <input
                            value={structuredCandidateEditorDraft.variantSize}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, variantSize: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Material</span>
                          <input
                            value={structuredCandidateEditorDraft.material}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, material: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Formato</span>
                          <input
                            value={structuredCandidateEditorDraft.shape}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, shape: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Cor</span>
                          <input
                            value={structuredCandidateEditorDraft.color}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, color: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Acabamento / Linha</span>
                          <input
                            value={structuredCandidateEditorDraft.finishLine}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, finishLine: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Largura</span>
                          <input
                            value={structuredCandidateEditorDraft.width}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, width: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Altura</span>
                          <input
                            value={structuredCandidateEditorDraft.height}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, height: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Comprimento</span>
                          <input
                            value={structuredCandidateEditorDraft.length}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, length: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Profundidade</span>
                          <input
                            value={structuredCandidateEditorDraft.depth}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, depth: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Peso</span>
                          <input
                            value={structuredCandidateEditorDraft.weight}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, weight: event.target.value } : current
                              )
                            }
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                      </div>

                      <div className="mt-4 grid gap-4">
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Descrição</span>
                          <textarea
                            value={structuredCandidateEditorDraft.description}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      description: event.target.value,
                                      descriptionEdited: true,
                                    }
                                  : current
                              )
                            }
                            rows={5}
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Aplicação / Uso recomendado</span>
                          <textarea
                            value={structuredCandidateEditorDraft.application}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, application: event.target.value } : current
                              )
                            }
                            rows={3}
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Itens inclusos</span>
                          <textarea
                            value={structuredCandidateEditorDraft.includedItems}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, includedItems: event.target.value } : current
                              )
                            }
                            rows={3}
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Observações de instalação</span>
                          <textarea
                            value={structuredCandidateEditorDraft.installationNotes}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, installationNotes: event.target.value } : current
                              )
                            }
                            rows={3}
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-slate-700">
                          <span className="font-medium">Observações técnicas</span>
                          <textarea
                            value={structuredCandidateEditorDraft.technicalNotes}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, technicalNotes: event.target.value } : current
                              )
                            }
                            rows={3}
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </label>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={structuredCandidateEditorDraft.isActive}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, isActive: event.target.checked } : current
                              )
                            }
                          />
                          Ativo / vendível
                        </label>
                        <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={structuredCandidateEditorDraft.trackStock}
                            onChange={(event) =>
                              setStructuredCandidateEditorDraft((current) =>
                                current ? { ...current, trackStock: event.target.checked } : current
                              )
                            }
                          />
                          Controlar estoque
                        </label>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
                      <button
                        type="button"
                        onClick={closeStructuredCandidateEditor}
                        className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={applyStructuredCandidateEditorChanges}
                        className="rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
                      >
                        Aplicar alterações
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
    </>
  );
}
