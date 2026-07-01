export type IntelligentImportReviewedDestination =
  | "pool"
  | "quimicos"
  | "acessorios"
  | "outros";

export const INTELLIGENT_IMPORT_PRICE_STATUS_VALUES = [
  "valid",
  "missing",
  "invalid",
  "on_request",
  "unknown_legacy",
] as const;
export type IntelligentImportPriceStatus =
  (typeof INTELLIGENT_IMPORT_PRICE_STATUS_VALUES)[number];
export type IntelligentImportWritablePriceStatus = Exclude<
  IntelligentImportPriceStatus,
  "unknown_legacy"
>;

export const INTELLIGENT_IMPORT_STOCK_STATUS_VALUES = [
  "available",
  "zero",
  "unknown",
  "unknown_legacy",
  "not_tracked",
] as const;
export type IntelligentImportStockStatus =
  (typeof INTELLIGENT_IMPORT_STOCK_STATUS_VALUES)[number];
export type IntelligentImportWritableStockStatus = Exclude<
  IntelligentImportStockStatus,
  "unknown_legacy"
>;

export type IntelligentImportReviewedItemStatus =
  | "valid"
  | "invalid"
  | "blocked_duplicate"
  | "saved";

export type IntelligentImportReviewedPoolPayload = {
  depth_m: number | null;
  length_m: number | null;
  material: string | null;
  max_capacity_l: number | null;
  price: number | null;
  shape: string | null;
  weight_kg: number | null;
  width_m: number | null;
};

export type IntelligentImportReviewedSaveItem = {
  clientItemId: string;
  description: string | null;
  destination: IntelligentImportReviewedDestination;
  duplicateBlocked?: boolean;
  isActive: boolean;
  metadata: Record<string, unknown>;
  name: string;
  poolPayload?: IntelligentImportReviewedPoolPayload | null;
  priceCents?: number | null;
  priceStatus: IntelligentImportWritablePriceStatus;
  reviewRequired?: boolean;
  reviewState: "approved" | "ignored" | "pending";
  selected: boolean;
  sku?: string | null;
  sourceFileName?: string | null;
  sourceType?: string | null;
  stockQuantity: number | null;
  stockStatus: IntelligentImportWritableStockStatus;
  trackStock: boolean;
};

export type IntelligentImportSelectedMediaSourceKind =
  | "xlsx_row_image"
  | "docx_media"
  | "pptx_media"
  | "pdf_page_render"
  | "image_file"
  | "unknown";

export type IntelligentImportSelectedMediaAssociationMode =
  | "strong_auto"
  | "weak_confirmed"
  | "manual_upload"
  | "visual_evidence"
  | "none"
  | "unknown";

export type IntelligentImportSelectedMediaRef = {
  associationMode: IntelligentImportSelectedMediaAssociationMode;
  clientItemId: string;
  confirmedByUser?: boolean;
  fileName?: string | null;
  importBatchId?: string | null;
  importFileId?: string | null;
  mediaRefId: string;
  mimeType?: string | null;
  notes?: string[];
  pageNumber?: number | null;
  sheetScopedKey?: string | null;
  sizeBytes?: number | null;
  sourceFileName?: string | null;
  sourceImageId?: string | null;
  sourceKind: IntelligentImportSelectedMediaSourceKind;
  sourceLocationKey?: string | null;
  stagingAssetId?: string | null;
  stagingStorageRef?: string | null;
  warnings?: string[];
  worksheetRowNumber?: number | null;
};

export type IntelligentImportGlobalReviewConfirmationSummary = {
  deselectedCount: number;
  foundCount: number;
  ignoredCount: number;
  selectedCount: number;
};

export type IntelligentImportGlobalReviewConfirmation = {
  confirmed: true;
  confirmedAt: string;
  reviewStateSignature?: string | null;
  revisionVersion?: number | null;
  summary: IntelligentImportGlobalReviewConfirmationSummary;
};

export type IntelligentImportStructuredReviewSnapshotEntry = {
  candidateKey: string;
  finalCategory: IntelligentImportReviewedDestination;
  finalFingerprint: string;
  humanReviewConfirmed: boolean;
  reviewRequired: boolean;
  state: "selected" | "deselected" | "ignored";
};

export type IntelligentImportStructuredReviewSnapshot = {
  entries: IntelligentImportStructuredReviewSnapshotEntry[];
  kind: "structured_review_v1";
  revisionVersion?: number | null;
};

export type IntelligentImportStagedMediaAsset = {
  id: string;
  associationStrength: IntelligentImportSelectedMediaAssociationMode;
  fileName: string;
  importBatchId?: string | null;
  importFileId?: string | null;
  mimeType: string | null;
  requiresUserConfirmation: boolean;
  sheetScopedKey?: string | null;
  sizeBytes: number;
  sourceFileName: string | null;
  sourceKind: IntelligentImportSelectedMediaSourceKind;
  sourceLocationKey?: string | null;
  stagingStorageRef: string;
  storageBucket: string;
  storagePath: string;
  worksheetRowNumber?: number | null;
};

export type IntelligentImportSaveApprovedRequest = {
  context?: {
    debugParser?: boolean;
    source?: string;
  };
  importedFileIds?: string[];
  items: IntelligentImportReviewedSaveItem[];
  organizationId: string;
  reviewAudit?: {
    globalReviewConfirmation?: IntelligentImportGlobalReviewConfirmation | null;
    structuredReviewSnapshot?: IntelligentImportStructuredReviewSnapshot | null;
  };
  selectedMediaRefs?: IntelligentImportSelectedMediaRef[];
  storeId: string;
  validateOnly: boolean;
};

export type IntelligentImportSaveApprovedConflict = {
  existingId: string;
  existingName: string;
  type: "sku" | "name" | "pool_name" | "internal_duplicate";
};

export type IntelligentImportSaveApprovedNormalizedPayload =
  | {
      category: "quimicos" | "acessorios" | "outros";
      currency: "BRL";
      description: string | null;
      destination: "quimicos" | "acessorios" | "outros";
      is_active: boolean;
      metadata: Record<string, unknown>;
      name: string;
      price_cents: number | null;
      price_status: IntelligentImportWritablePriceStatus;
      sku: string | null;
      stock_quantity: number | null;
      stock_status: IntelligentImportWritableStockStatus;
      track_stock: boolean;
      type: "catalog_item";
    }
  | {
      depth_m: number | null;
      description: string | null;
      destination: "pool";
      is_active: boolean;
      length_m: number | null;
      material: string | null;
      max_capacity_l: number | null;
      name: string;
      price: number | null;
      price_status: IntelligentImportWritablePriceStatus;
      shape: string | null;
      stock_quantity: number | null;
      stock_status: IntelligentImportWritableStockStatus;
      track_stock: boolean;
      type: "pool";
      weight_kg: number | null;
      width_m: number | null;
    };

export type IntelligentImportSaveApprovedResultItem = {
  clientItemId: string;
  conflict?: IntelligentImportSaveApprovedConflict | null;
  destination: IntelligentImportReviewedDestination;
  inputIndex: number;
  normalizedPayload: IntelligentImportSaveApprovedNormalizedPayload | null;
  persistedId?: string | null;
  reasons: string[];
  status: IntelligentImportReviewedItemStatus;
};

export type IntelligentImportSaveApprovedImportFilePlan = {
  importedFileIdsReceived: string[];
  importFilesValidated: Array<{
    id: string;
    originalFileName: string;
    status: string | null;
  }>;
  importFilesMissing: string[];
  invalidImportedFileIds: string[];
  linkableItems: Array<{
    clientItemId: string;
    destination: IntelligentImportReviewedDestination;
    importFileId: string;
    inputIndex: number;
    sourceFileName: string | null;
  }>;
  unlinkedItems: Array<{
    clientItemId: string;
    inputIndex: number;
    reason: string;
    sourceFileName: string | null;
  }>;
  warnings: string[];
  wouldCreateImportFileItemLinks: number;
};

export type IntelligentImportSaveApprovedPhotoPlan = {
  debug?: {
    acceptedByClientItemId: number;
    acceptedByFallback: number;
    blockedByReason: Record<string, number>;
    blockedSamples: Array<{
      clientItemId: string;
      compared: Record<string, unknown>;
      mediaRefId: string;
      reason: string;
      stagingAssetId?: string | null;
    }>;
    plannedSamples: Array<{
      clientItemId: string;
      destination: IntelligentImportReviewedDestination;
      mediaRefId: string;
      matchMode: "clientItemId" | "fallback";
      stagingAssetId?: string | null;
    }>;
  };
  blockedMediaRefs: Array<{
    associationMode: IntelligentImportSelectedMediaAssociationMode;
    clientItemId: string;
    compared?: Record<string, unknown>;
    mediaRefId: string;
    reason: string;
    sourceKind: IntelligentImportSelectedMediaSourceKind;
    stagingAssetId?: string | null;
    warnings: string[];
  }>;
  plannedFinalPhotos: Array<{
    associationMode: IntelligentImportSelectedMediaAssociationMode;
    clientItemId: string;
    destination: IntelligentImportReviewedDestination;
    inputIndex: number;
    matchMode?: "clientItemId" | "fallback";
    mediaRefId: string;
    stagingAssetId?: string | null;
    sourceFileName: string | null;
    sourceImageId: string | null;
    sourceKind: IntelligentImportSelectedMediaSourceKind;
    sourceLocationKey: string | null;
  }>;
  receivedMediaRefs: Array<{
    associationMode: IntelligentImportSelectedMediaAssociationMode;
    clientItemId: string;
    confirmedByUser: boolean;
    fileName: string | null;
    mediaRefId: string;
    stagingAssetId?: string | null;
    sourceFileName: string | null;
    sourceImageId: string | null;
    sourceKind: IntelligentImportSelectedMediaSourceKind;
    sourceLocationKey: string | null;
  }>;
  unlinkedMediaRefs: Array<{
    clientItemId: string;
    mediaRefId: string;
    reason: string;
    sourceKind: IntelligentImportSelectedMediaSourceKind;
  }>;
  warnings: string[];
  wouldCreateCatalogItemPhotos: number;
  wouldCreatePoolPhotos: number;
  wouldUploadFinalPhotoObjects: number;
};

export type IntelligentImportSaveApprovedPhotoSaveResult = {
  createdCatalogItemPhotos: number;
  createdPoolPhotos: number;
  failedPhotos: Array<{
    clientItemId: string;
    destination: IntelligentImportReviewedDestination;
    error: string;
    mediaRefId: string;
    stagingAssetId?: string | null;
  }>;
  promotedPhotos: Array<{
    clientItemId: string;
    destination: IntelligentImportReviewedDestination;
    finalBucket: "pool-photos" | "store-catalog-photos";
    finalPath: string;
    finalPhotoRowId: string;
    mediaRefId: string;
    promotedStagingAssetId?: string | null;
  }>;
  promotedStagingAssets: number;
  uploadedFinalPhotoObjects: number;
  warnings: string[];
};

export type IntelligentImportSaveApprovedResponse = {
  importFileLinkPlan?: IntelligentImportSaveApprovedImportFilePlan;
  items: IntelligentImportSaveApprovedResultItem[];
  message: string;
  ok: boolean;
  photoPlan?: IntelligentImportSaveApprovedPhotoPlan;
  photoSaveResult?: IntelligentImportSaveApprovedPhotoSaveResult;
  reviewAudit?: {
    importFileAudit?: {
      attempted: boolean;
      error?: string | null;
      persisted: boolean;
      skippedReason?: string | null;
      updatedImportFileIds: string[];
      validateOnly: boolean;
    };
    globalReviewConfirmation?: IntelligentImportGlobalReviewConfirmation | null;
    structuredReviewSnapshot?: IntelligentImportStructuredReviewSnapshot | null;
  };
  summary: {
    blockedDuplicate: number;
    invalid: number;
    saved: number;
    total: number;
    valid: number;
  };
  validateOnly: boolean;
};
