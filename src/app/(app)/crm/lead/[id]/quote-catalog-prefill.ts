export type QuoteCatalogPrefillItemType =
  | "pool_installation"
  | "custom"
  | "service";

export type QuoteCatalogSourceKind =
  | "pool"
  | "catalog_item"
  | "service";

export type QuoteCatalogCategory =
  | "quimicos"
  | "acessorios"
  | "outros";

export type QuoteTechnicalServicesPolicy = {
  service_types: string[];
  services_other?: string;
  equipment_types: string[];
  equipment_other?: string;
  equipment_installation_origin_policy?:
    | "somente_loja"
    | "tambem_cliente"
    | "depende";
  equipment_installation_origin_rule?: string;
  equipment_replacement_existing?: "sim" | "nao" | "caso_a_caso";
  equipment_replacement_existing_rule?: string;
  notes?: string;
};

export type QuoteCatalogPrefillItem = {
  id: string;
  source_kind: QuoteCatalogSourceKind;
  category: QuoteCatalogCategory | null;
  name: string | null;
  sku: string | null;
  description: string | null;
  price_cents: number | null;
  price_status: string | null;
  currency: string | null;
  is_active: boolean | null;
};

export type QuoteCatalogItemRow = {
  id: string;
  name: string | null;
  sku: string | null;
  description: string | null;
  price_cents: number | null;
  price_status: string | null;
  currency: string | null;
  is_active: boolean | null;
  metadata: Record<string, unknown> | null;
};

export type QuotePoolPrefillRow = {
  id: string;
  name: string | null;
  description: string | null;
  price: number | null;
  price_status: string | null;
  is_active: boolean | null;
};

export type QuoteCatalogPrefillValues = {
  name: string;
  description: string;
  unitPriceReais: string;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function humanizeCanonicalToken(value: string): string {
  const normalized = cleanText(value).replace(/_/g, " ");
  if (!normalized) return "";

  return normalized.charAt(0).toLocaleUpperCase("pt-BR") + normalized.slice(1);
}

export function normalizeQuoteCatalogCategory(
  value: unknown,
): QuoteCatalogCategory {
  const normalized = cleanText(value).toLocaleLowerCase("pt-BR");

  if (normalized === "quimicos") return "quimicos";
  if (normalized === "acessorios") return "acessorios";

  return "outros";
}

export function quoteCatalogCategoryLabel(
  category: QuoteCatalogCategory | null,
): string {
  if (category === "quimicos") return "Produtos químicos";
  if (category === "acessorios") return "Acessórios";
  if (category === "outros") return "Outros";

  return "";
}

export function buildQuoteCatalogPrefillItemFromCatalog(
  row: QuoteCatalogItemRow,
): QuoteCatalogPrefillItem | null {
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? row.metadata
      : null;

  const item: QuoteCatalogPrefillItem = {
    id: `catalog:${cleanText(row.id)}`,
    source_kind: "catalog_item",
    category: normalizeQuoteCatalogCategory(metadata?.categoria),
    name: row.name,
    sku: row.sku,
    description: row.description,
    price_cents: row.price_cents,
    price_status: row.price_status,
    currency: row.currency,
    is_active: row.is_active,
  };

  return isQuoteCatalogPrefillItemEligible(item) ? item : null;
}

export function buildQuoteCatalogPrefillItemFromPool(
  pool: QuotePoolPrefillRow,
): QuoteCatalogPrefillItem | null {
  const id = cleanText(pool.id);
  const name = cleanText(pool.name);
  const priceReais = pool.price;

  if (
    !id ||
    !name ||
    pool.is_active !== true ||
    cleanText(pool.price_status).toLowerCase() !== "valid" ||
    typeof priceReais !== "number" ||
    !Number.isFinite(priceReais) ||
    priceReais <= 0
  ) {
    return null;
  }

  const priceCents = Math.round(priceReais * 100);

  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) {
    return null;
  }

  return {
    id: `pool:${id}`,
    source_kind: "pool",
    category: null,
    name,
    sku: null,
    description: pool.description,
    price_cents: priceCents,
    price_status: "valid",
    currency: "BRL",
    is_active: true,
  };
}

const TECHNICAL_SERVICE_LABELS: Record<string, string> = {
  limpeza: "Limpeza / manutenção de piscina",
  agua: "Tratamento da água",
  diagnostico: "Diagnóstico técnico",
  reparo: "Reparo de equipamentos",
  instalacao_equipamento: "Instalação de equipamento novo",
  troca_equipamento: "Substituição de equipamento existente",
};

const TECHNICAL_EQUIPMENT_LABELS: Record<string, string> = {
  bombas: "Bombas",
  filtros: "Filtros",
  aquecedores: "Aquecedores",
  iluminacao: "Iluminação",
  automacao: "Automação",
  cascata_hidro: "Cascatas / hidromassagem",
};

function technicalEquipmentLabel(
  equipmentType: string,
  policy: QuoteTechnicalServicesPolicy,
): string {
  if (equipmentType === "outros") {
    return cleanText(policy.equipment_other) || "Outros equipamentos";
  }

  return (
    TECHNICAL_EQUIPMENT_LABELS[equipmentType] ||
    humanizeCanonicalToken(equipmentType)
  );
}

function buildTechnicalServiceDescription(
  serviceType: string,
  policy: QuoteTechnicalServicesPolicy,
): string {
  const parts: string[] = [];

  const equipmentLabels = Array.from(
    new Set(
      (Array.isArray(policy.equipment_types) ? policy.equipment_types : [])
        .map((equipmentType) =>
          technicalEquipmentLabel(cleanText(equipmentType), policy),
        )
        .filter(Boolean),
    ),
  );

  if (equipmentLabels.length > 0) {
    parts.push(`Equipamentos atendidos: ${equipmentLabels.join(", ")}.`);
  }

  if (serviceType === "instalacao_equipamento") {
    if (policy.equipment_installation_origin_policy === "somente_loja") {
      parts.push("Apenas equipamentos vendidos pela própria loja.");
    } else if (
      policy.equipment_installation_origin_policy === "tambem_cliente"
    ) {
      parts.push("Também aceita equipamentos comprados pelo cliente.");
    } else if (
      policy.equipment_installation_origin_policy === "depende"
    ) {
      const rule = cleanText(policy.equipment_installation_origin_rule);
      if (rule) {
        parts.push(`Origem do equipamento: ${rule}`);
      }
    }
  }

  if (serviceType === "troca_equipamento") {
    if (policy.equipment_replacement_existing === "sim") {
      parts.push("A loja substitui equipamentos existentes.");
    } else if (policy.equipment_replacement_existing === "nao") {
      parts.push(
        "A substituição de equipamento existente não está disponível para equipamentos já utilizados.",
      );
    } else if (
      policy.equipment_replacement_existing === "caso_a_caso"
    ) {
      const rule = cleanText(
        policy.equipment_replacement_existing_rule,
      );

      if (rule) {
        parts.push(`Substituição de equipamento existente: ${rule}`);
      }
    }
  }

  const notes = cleanText(policy.notes);
  if (notes) {
    parts.push(`Observações: ${notes}`);
  }

  return parts.join("\n");
}

export function isQuoteTechnicalServicesPolicyAvailable(
  policy: QuoteTechnicalServicesPolicy | null | undefined,
): boolean {
  return Boolean(
    policy &&
      Array.isArray(policy.service_types) &&
      policy.service_types.some((value) => cleanText(value)) &&
      Array.isArray(policy.equipment_types) &&
      policy.equipment_types.some((value) => cleanText(value)),
  );
}

export function buildQuoteTechnicalServicePrefillItems(
  policy: QuoteTechnicalServicesPolicy | null | undefined,
): QuoteCatalogPrefillItem[] {
  if (!isQuoteTechnicalServicesPolicyAvailable(policy)) {
    return [];
  }

  const safePolicy = policy as QuoteTechnicalServicesPolicy;

  return Array.from(
    new Set(
      safePolicy.service_types
        .map((serviceType) => cleanText(serviceType))
        .filter(Boolean),
    ),
  )
    .map((serviceType) => {
      const name =
        serviceType === "outro"
          ? cleanText(safePolicy.services_other) || "Outro serviço"
          : TECHNICAL_SERVICE_LABELS[serviceType] ||
            humanizeCanonicalToken(serviceType);

      return {
        id: `service:${serviceType}`,
        source_kind: "service" as const,
        category: null,
        name,
        sku: null,
        description: buildTechnicalServiceDescription(
          serviceType,
          safePolicy,
        ),
        price_cents: null,
        price_status: null,
        currency: "BRL",
        is_active: true,
      };
    })
    .filter(isQuoteCatalogPrefillItemEligible);
}

export function isQuoteCatalogPrefillItemEligible(
  item: QuoteCatalogPrefillItem,
): boolean {
  const id = cleanText(item.id);
  const name = cleanText(item.name);

  if (!id || !name || item.is_active !== true) {
    return false;
  }

  if (item.source_kind === "service") {
    return true;
  }

  return (
    cleanText(item.price_status).toLowerCase() === "valid" &&
    item.currency === "BRL" &&
    typeof item.price_cents === "number" &&
    Number.isSafeInteger(item.price_cents) &&
    item.price_cents > 0
  );
}

export function buildQuoteCatalogPrefillValues(
  item: QuoteCatalogPrefillItem,
): QuoteCatalogPrefillValues | null {
  if (!isQuoteCatalogPrefillItemEligible(item)) {
    return null;
  }

  return {
    name: cleanText(item.name),
    description: cleanText(item.description),
    unitPriceReais:
      item.source_kind === "service"
        ? ""
        : (item.price_cents! / 100).toFixed(2).replace(".", ","),
  };
}

export function matchesQuoteCatalogPrefillSearch(
  item: Pick<QuoteCatalogPrefillItem, "name" | "sku">,
  search: string,
): boolean {
  const normalizedSearch = cleanText(search).toLocaleLowerCase("pt-BR");

  if (!normalizedSearch) {
    return true;
  }

  const name = cleanText(item.name).toLocaleLowerCase("pt-BR");
  const sku = cleanText(item.sku).toLocaleLowerCase("pt-BR");

  return name.includes(normalizedSearch) || sku.includes(normalizedSearch);
}
