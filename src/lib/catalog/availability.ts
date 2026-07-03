import { getCatalogStockSemantics } from "@/lib/catalog/presentation";

export type InventoryAvailabilityReason =
  | "inactive"
  | "out_of_stock"
  | "in_stock"
  | "stock_not_tracked"
  | "stock_unknown";

export type InventoryAvailabilityResult = {
  isSellable: boolean;
  hasConfirmedStock: boolean;
  reason: InventoryAvailabilityReason;
};

type InventoryAvailabilityInput = {
  isActive: boolean | null | undefined;
  trackStock: boolean | null | undefined;
  stockQuantity: number | null | undefined;
  stockStatus?: string | null | undefined;
};

export function isSellableInventoryState(input: InventoryAvailabilityInput): InventoryAvailabilityResult {
  if (input.isActive !== true) {
    return {
      isSellable: false,
      hasConfirmedStock: false,
      reason: "inactive",
    };
  }

  const stock = getCatalogStockSemantics({
    stockStatus: input.stockStatus,
    stockQuantity: input.stockQuantity,
    trackStock: input.trackStock,
  });

  if (stock.isAvailable) {
    return {
      isSellable: true,
      hasConfirmedStock: true,
      reason: "in_stock",
    };
  }

  if (stock.isZero) {
    return {
      isSellable: false,
      hasConfirmedStock: false,
      reason: "out_of_stock",
    };
  }

  if (stock.isNotTracked) {
    return {
      isSellable: true,
      hasConfirmedStock: false,
      reason: "stock_not_tracked",
    };
  }

  return {
    isSellable: true,
    hasConfirmedStock: false,
    reason: "stock_unknown",
  };
}
