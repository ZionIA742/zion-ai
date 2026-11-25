// Shared quote editor model. Existing CRM behavior preserved.

export type QuoteFormItem = {
  id: string;
  // TODO Bloco 3: mapear "pool_installation" para um tipo aceito pela API
  // (provavelmente "custom") ou ampliar a API para aceitar esse novo valor.
  itemType: "pool_installation" | "custom" | "service";
  name: string;
  description: string;
  quantity: string;
  unitPriceReais: string;
  discountReais: string;
};

export function createQuoteFormItemId() {
  return Math.random().toString(36).slice(2, 10);
}

export function createEmptyQuoteFormItem(): QuoteFormItem {
  return {
    id: createQuoteFormItemId(),
    itemType: "pool_installation",
    name: "",
    description: "",
    quantity: "1",
    unitPriceReais: "",
    discountReais: "",
  };
}

export function getQuoteItemTypeLabel(value: QuoteFormItem["itemType"]) {
  if (value === "pool_installation") {
    return "Piscina + instala\u00e7\u00e3o";
  }

  if (value === "service") {
    return "Servi\u00e7o";
  }

  return "Produto / item personalizado";
}

export function parseQuoteMoneyValue(value: string) {
  const normalized = String(value || "").trim().replace(",", ".");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

export function convertReaisToCents(value: string) {
  return Math.round(parseQuoteMoneyValue(value) * 100);
}

export function parseQuoteQuantityValue(value: string) {
  const normalized = String(value || "").trim().replace(",", ".");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return parsed;
}

export function formatCurrencyBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}
