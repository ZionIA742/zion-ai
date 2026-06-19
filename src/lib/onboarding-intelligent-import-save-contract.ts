export type IntelligentImportReviewedDestination =
  | "pool"
  | "quimicos"
  | "acessorios"
  | "outros";

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
  reviewRequired?: boolean;
  reviewState: "approved" | "ignored" | "pending";
  selected: boolean;
  sku?: string | null;
  sourceFileName?: string | null;
  sourceType?: string | null;
  stockQuantity: number;
  trackStock: boolean;
};

export type IntelligentImportSaveApprovedRequest = {
  context?: {
    debugParser?: boolean;
    source?: string;
  };
  importedFileIds?: string[];
  items: IntelligentImportReviewedSaveItem[];
  organizationId: string;
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
      sku: string | null;
      stock_quantity: number;
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
      shape: string | null;
      stock_quantity: number;
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

export type IntelligentImportSaveApprovedResponse = {
  items: IntelligentImportSaveApprovedResultItem[];
  message: string;
  ok: boolean;
  summary: {
    blockedDuplicate: number;
    invalid: number;
    saved: number;
    total: number;
    valid: number;
  };
  validateOnly: boolean;
};
