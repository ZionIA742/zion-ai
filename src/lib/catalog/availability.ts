export type InventoryAvailabilityReason =
  | "inactive"
  | "out_of_stock"
  | "in_stock"
  | "stock_not_tracked";

export type InventoryAvailabilityResult = {
  isSellable: boolean;
  hasConfirmedStock: boolean;
  reason: InventoryAvailabilityReason;
};

type InventoryAvailabilityInput = {
  isActive: boolean | null | undefined;
  trackStock: boolean | null | undefined;
  stockQuantity: number | null | undefined;
};

export function isSellableInventoryState(input: InventoryAvailabilityInput): InventoryAvailabilityResult {
  if (input.isActive !== true) {
    return {
      isSellable: false,
      hasConfirmedStock: false,
      reason: "inactive",
    };
  }

  if (input.trackStock === true) {
    const quantity = input.stockQuantity ?? 0;
    if (quantity <= 0) {
      return {
        isSellable: false,
        hasConfirmedStock: false,
        reason: "out_of_stock",
      };
    }

    return {
      isSellable: true,
      hasConfirmedStock: true,
      reason: "in_stock",
    };
  }

  return {
    isSellable: true,
    hasConfirmedStock: false,
    reason: "stock_not_tracked",
  };
}

