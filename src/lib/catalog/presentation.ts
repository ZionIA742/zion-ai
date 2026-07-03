export type CatalogPriceStatus =
  | "valid"
  | "missing"
  | "invalid"
  | "on_request"
  | "unknown_legacy";

export type CatalogStockStatus =
  | "available"
  | "zero"
  | "unknown"
  | "unknown_legacy"
  | "not_tracked";

type PriceStatusInput = string | null | undefined;
type StockStatusInput = string | null | undefined;

type PriceSemanticsInput = {
  priceStatus?: PriceStatusInput;
  priceCents?: number | null;
};

type StockSemanticsInput = {
  stockStatus?: StockStatusInput;
  stockQuantity?: number | null;
  trackStock?: boolean | null;
};

export function formatCurrencyBRLFromCents(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value / 100);
}

export function priceNumberToCents(value: number | string | null | undefined): number | null {
  const numericValue = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numericValue)) return null;
  return Math.round(Number(numericValue) * 100);
}

export function normalizeCatalogPriceStatus(
  status: PriceStatusInput,
  priceCents?: number | null
): CatalogPriceStatus {
  if (status === "valid") return "valid";
  if (status === "missing") return "missing";
  if (status === "invalid") return "invalid";
  if (status === "on_request") return "on_request";
  if (status === "unknown_legacy") return "unknown_legacy";

  return typeof priceCents === "number" ? "valid" : "missing";
}

export function getCatalogPriceSemantics(input: PriceSemanticsInput) {
  const resolvedStatus = normalizeCatalogPriceStatus(input.priceStatus, input.priceCents);
  const hasNumericPrice = typeof input.priceCents === "number" && Number.isFinite(input.priceCents);

  if (resolvedStatus === "valid" && hasNumericPrice) {
    return {
      resolvedStatus,
      hasNumericPrice: true,
      priceCents: input.priceCents as number,
      label: formatCurrencyBRLFromCents(input.priceCents as number),
    };
  }

  if (resolvedStatus === "on_request") {
    return {
      resolvedStatus,
      hasNumericPrice: false,
      priceCents: null,
      label: "Sob consulta",
    };
  }

  if (resolvedStatus === "unknown_legacy") {
    return {
      resolvedStatus,
      hasNumericPrice: false,
      priceCents: null,
      label: "Preço não confirmado",
    };
  }

  if (resolvedStatus === "missing") {
    return {
      resolvedStatus,
      hasNumericPrice: false,
      priceCents: null,
      label: "Sem preço",
    };
  }

  return {
    resolvedStatus: "invalid" as const,
    hasNumericPrice: false,
    priceCents: null,
    label: "Preço inválido",
  };
}

export function getCatalogPriceSemanticsFromNumber(input: {
  priceStatus?: PriceStatusInput;
  price?: number | string | null;
}) {
  return getCatalogPriceSemantics({
    priceStatus: input.priceStatus,
    priceCents: priceNumberToCents(input.price),
  });
}

export function normalizeCatalogStockStatus(input: StockSemanticsInput): CatalogStockStatus {
  if (input.stockStatus === "available") return "available";
  if (input.stockStatus === "zero") return "zero";
  if (input.stockStatus === "unknown") return "unknown";
  if (input.stockStatus === "unknown_legacy") return "unknown_legacy";
  if (input.stockStatus === "not_tracked") return "not_tracked";

  if (input.trackStock === false) return "not_tracked";

  const hasNumericQuantity =
    typeof input.stockQuantity === "number" && Number.isFinite(input.stockQuantity);
  if (hasNumericQuantity) {
    return (input.stockQuantity as number) > 0 ? "available" : "zero";
  }

  return "unknown";
}

export function getCatalogStockSemantics(input: StockSemanticsInput) {
  const resolvedStatus = normalizeCatalogStockStatus(input);
  const hasNumericQuantity =
    typeof input.stockQuantity === "number" && Number.isFinite(input.stockQuantity);
  const normalizedQuantity = hasNumericQuantity
    ? Math.max(0, Math.round(input.stockQuantity as number))
    : null;

  if (resolvedStatus === "available" && normalizedQuantity != null && normalizedQuantity > 0) {
    return {
      resolvedStatus,
      quantity: normalizedQuantity,
      label: `Estoque: ${normalizedQuantity}`,
      valueLabel: String(normalizedQuantity),
      isAvailable: true,
      isZero: false,
      isUnknown: false,
      isNotTracked: false,
    };
  }

  if (resolvedStatus === "zero") {
    return {
      resolvedStatus,
      quantity: 0,
      label: "Estoque: 0",
      valueLabel: "0",
      isAvailable: false,
      isZero: true,
      isUnknown: false,
      isNotTracked: false,
    };
  }

  if (resolvedStatus === "not_tracked") {
    return {
      resolvedStatus,
      quantity: null,
      label: "Estoque não controlado",
      valueLabel: "Não controlado",
      isAvailable: false,
      isZero: false,
      isUnknown: false,
      isNotTracked: true,
    };
  }

  return {
    resolvedStatus: resolvedStatus === "available" ? ("unknown" as const) : resolvedStatus,
    quantity: normalizedQuantity,
    label: "Estoque não informado",
    valueLabel: "Não informado",
    isAvailable: false,
    isZero: false,
    isUnknown: true,
    isNotTracked: false,
  };
}
