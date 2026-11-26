export type CatalogCommercialCategory =
  | "piscinas"
  | "quimicos"
  | "acessorios"
  | "outros";

export type CatalogCommercialProduct = {
  sourceKind: "pool" | "catalog_item";
  category: CatalogCommercialCategory;
  name: string;
  description: string | null;
  price: {
    amount: number;
    currency: string | null;
  } | null;
  priceStatus: string | null;
  characteristics: Record<string, string | number | null>;
};

const INTRO: Record<CatalogCommercialCategory, string> = {
  piscinas: "Conhe\u00e7a esta op\u00e7\u00e3o de piscina do nosso cat\u00e1logo:",
  quimicos: "Conhe\u00e7a este produto para sua piscina:",
  acessorios: "Conhe\u00e7a esta op\u00e7\u00e3o de acess\u00f3rio para piscina:",
  outros: "Conhe\u00e7a esta op\u00e7\u00e3o do nosso cat\u00e1logo:",
};

const CLOSING: Record<CatalogCommercialCategory, string> = {
  piscinas: "O que achou desse modelo?",
  quimicos: "Gostaria de mais informa\u00e7\u00f5es sobre esse produto?",
  acessorios: "O que achou dessa op\u00e7\u00e3o?",
  outros: "Gostaria de mais detalhes?",
};

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const text = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if ([
    "-",
    "n/a",
    "null",
    "undefined",
    "nao informado",
    "nao confirmado",
    "desconhecido",
  ].includes(normalized)) {
    return null;
  }

  return text;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 20,
  }).format(value);
}

function formatPrice(
  product: CatalogCommercialProduct,
): string | null {
  if (product.priceStatus !== "valid") return null;

  const amount = positiveNumber(product.price?.amount);
  const currency = product.price?.currency;

  if (
    amount === null ||
    typeof currency !== "string" ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return null;
  }

  try {
    if (!Intl.supportedValuesOf("currency").includes(currency)) {
      return null;
    }

    const formatter = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
    });

    const positiveDisplayedValue = formatter
      .formatToParts(amount)
      .some(part =>
        ["integer", "fraction"].includes(part.type) &&
        /[1-9]/.test(part.value),
      );

    if (!positiveDisplayedValue) return null;

    return formatter.format(amount).replace(/\u00a0/g, " ");
  } catch {
    return null;
  }
}

export function buildCatalogCommercialMessage(
  product: CatalogCommercialProduct,
  maxLength: number,
): string {
  if (!Number.isSafeInteger(maxLength) || maxLength <= 0) {
    throw new Error("INVALID_COMMERCIAL_MESSAGE_LIMIT");
  }

  const name = cleanText(product.name);

  if (!name) {
    throw new Error("INVALID_COMMERCIAL_PRODUCT_NAME");
  }

  const category = product.category;

  if (
    !Object.prototype.hasOwnProperty.call(INTRO, category) ||
    !["pool", "catalog_item"].includes(product.sourceKind) ||
    (category === "piscinas") !==
      (product.sourceKind === "pool")
  ) {
    throw new Error("INVALID_COMMERCIAL_PRODUCT_CATEGORY");
  }

  const characteristics = product.characteristics || {};
  const optionalLines: string[] = [];

  function addText(label: string, value: unknown) {
    const text = cleanText(value);
    const number = positiveNumber(value);

    const display =
      text ?? (number !== null ? formatNumber(number) : null);

    if (display) {
      optionalLines.push(`${label}: ${display}`);
    }
  }

  function addMeasure(
    label: string,
    value: unknown,
    unit: string,
  ) {
    const number = positiveNumber(value);

    if (number !== null) {
      optionalLines.push(
        `${label}: ${formatNumber(number)} ${unit}`,
      );
    }
  }

  if (category === "piscinas") {
    const length = positiveNumber(characteristics.length_m);
    const width = positiveNumber(characteristics.width_m);

    if (length !== null && width !== null) {
      optionalLines.push(
        `Medidas: ${formatNumber(length)} x ${formatNumber(width)} m`,
      );
    } else {
      addMeasure("Comprimento", length, "m");
      addMeasure("Largura", width, "m");
    }

    addMeasure("Profundidade", characteristics.depth_m, "m");
    addMeasure("Capacidade", characteristics.max_capacity_l, "litros");
    addText("Material", characteristics.material);
    addText("Formato", characteristics.shape);
    addMeasure("Peso", characteristics.weight_kg, "kg");
  } else {
    addText("Marca", characteristics.brand);
    addText("Modelo", characteristics.model);

    if (category === "quimicos") {
      addText(
        "Embalagem",
        cleanText(characteristics.packaging) ??
          characteristics.embalagem,
      );

      addText("Composi\u00e7\u00e3o", characteristics.composition);
      addText("Aplica\u00e7\u00e3o", characteristics.application);
      addText("Peso", characteristics.weight);
      addMeasure("Peso", characteristics.weight_kg, "kg");
    } else {
      addText("Material", characteristics.material);
      addText("Cor", characteristics.color);
      addText("Dimens\u00f5es", characteristics.dimensions);
      addText("Tamanho", characteristics.size);
      addMeasure("Comprimento", characteristics.length_cm, "cm");
      addMeasure("Largura", characteristics.width_cm, "cm");
      addMeasure("Altura", characteristics.height_cm, "cm");
      addText("Compatibilidade", characteristics.compatibility);
      addText("Aplica\u00e7\u00e3o", characteristics.application);
      addText("Capacidade", characteristics.capacity);
      addMeasure("Peso", characteristics.weight_kg, "kg");
    }
  }

  addText("Descri\u00e7\u00e3o", product.description);

  const nameLine =
    `${category === "piscinas" ? "Modelo" : "Produto"}: ${name}`;

  const price = formatPrice(product);
  const priceLine = price ? `Valor: ${price}` : null;

  function render(lines: string[]) {
    return [
      INTRO[category],
      "",
      nameLine,
      ...lines,
      ...(priceLine ? [priceLine] : []),
      "",
      CLOSING[category],
    ].join("\n");
  }

  const accepted: string[] = [];

  if (render(accepted).length > maxLength) {
    throw new Error("COMMERCIAL_MESSAGE_LIMIT_EXCEEDED");
  }

  for (const line of new Set(optionalLines)) {
    const candidate = [...accepted, line];

    if (render(candidate).length <= maxLength) {
      accepted.push(line);
    }
  }

  return render(accepted);
}
