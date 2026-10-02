import assert from "node:assert/strict";

import {
  buildQuoteCatalogPrefillItemFromCatalog,
  buildQuoteCatalogPrefillItemFromPool,
  buildQuoteCatalogPrefillValues,
  buildQuoteTechnicalServicePrefillItems,
  isQuoteTechnicalServicesPolicyAvailable,
  matchesQuoteCatalogPrefillSearch,
  normalizeQuoteCatalogCategory,
  type QuoteCatalogItemRow,
  type QuotePoolPrefillRow,
  type QuoteTechnicalServicesPolicy,
} from "./quote-catalog-prefill";

const pool: QuotePoolPrefillRow = {
  id: "pool-1",
  name: "Piscina Vinil 007",
  description: "Piscina oval",
  price: 24730,
  price_status: "valid",
  is_active: true,
};

const normalizedPool = buildQuoteCatalogPrefillItemFromPool(pool);

assert.deepEqual(normalizedPool, {
  id: "pool:pool-1",
  source_kind: "pool",
  category: null,
  name: "Piscina Vinil 007",
  sku: null,
  description: "Piscina oval",
  price_cents: 2473000,
  price_status: "valid",
  currency: "BRL",
  is_active: true,
});

assert.deepEqual(
  normalizedPool
    ? buildQuoteCatalogPrefillValues(normalizedPool)
    : null,
  {
    name: "Piscina Vinil 007",
    description: "Piscina oval",
    unitPriceReais: "24730,00",
  },
);

const catalogRow: QuoteCatalogItemRow = {
  id: "catalog-1",
  name: "Cloro Premium",
  sku: "CL-001",
  description: "Cloro granulado",
  price_cents: 8990,
  price_status: "valid",
  currency: "BRL",
  is_active: true,
  metadata: {
    categoria: "quimicos",
  },
};

const normalizedCatalog =
  buildQuoteCatalogPrefillItemFromCatalog(catalogRow);

assert.equal(normalizedCatalog?.source_kind, "catalog_item");
assert.equal(normalizedCatalog?.category, "quimicos");
assert.equal(normalizedCatalog?.id, "catalog:catalog-1");

assert.equal(normalizeQuoteCatalogCategory("quimicos"), "quimicos");
assert.equal(normalizeQuoteCatalogCategory("acessorios"), "acessorios");
assert.equal(normalizeQuoteCatalogCategory("qualquer_coisa"), "outros");
assert.equal(normalizeQuoteCatalogCategory(null), "outros");

const servicePolicy: QuoteTechnicalServicesPolicy = {
  service_types: [
    "limpeza",
    "troca_equipamento",
    "outro",
  ],
  services_other: "Limpeza de borda especial",
  equipment_types: ["bombas", "filtros"],
  equipment_replacement_existing: "caso_a_caso",
  equipment_replacement_existing_rule:
    "Depende do estado e da compatibilidade do equipamento.",
  notes: "Confirmar condições antes da execução.",
};

assert.equal(
  isQuoteTechnicalServicesPolicyAvailable(servicePolicy),
  true,
);

const services =
  buildQuoteTechnicalServicePrefillItems(servicePolicy);

assert.equal(services.length, 3);
assert.equal(
  services[0]?.name,
  "Limpeza / manutenção de piscina",
);

const replacement = services.find(
  (item) => item.id === "service:troca_equipamento",
);

assert.equal(
  replacement?.name,
  "Substituição de equipamento existente",
);

assert.equal(
  replacement?.description?.includes(
    "Equipamentos atendidos: Bombas, Filtros.",
  ),
  true,
);

assert.equal(
  replacement?.description?.includes(
    "Depende do estado e da compatibilidade do equipamento.",
  ),
  true,
);

assert.deepEqual(
  replacement
    ? buildQuoteCatalogPrefillValues(replacement)
    : null,
  {
    name: "Substituição de equipamento existente",
    description:
      "Equipamentos atendidos: Bombas, Filtros.\n" +
      "Substituição de equipamento existente: Depende do estado e da compatibilidade do equipamento.\n" +
      "Observações: Confirmar condições antes da execução.",
    unitPriceReais: "",
  },
);

const otherService = services.find(
  (item) => item.id === "service:outro",
);

assert.equal(
  otherService?.name,
  "Limpeza de borda especial",
);

assert.equal(
  isQuoteTechnicalServicesPolicyAvailable(null),
  false,
);

assert.equal(
  isQuoteTechnicalServicesPolicyAvailable({
    service_types: [],
    equipment_types: ["bombas"],
  }),
  false,
);

assert.equal(
  buildQuoteTechnicalServicePrefillItems(null).length,
  0,
);

assert.equal(
  normalizedPool
    ? matchesQuoteCatalogPrefillSearch(
        normalizedPool,
        "vinil 007",
      )
    : false,
  true,
);

assert.equal(
  normalizedCatalog
    ? matchesQuoteCatalogPrefillSearch(
        normalizedCatalog,
        "CL-001",
      )
    : false,
  true,
);

console.log(
  "ok - quote catalog prefill type-aware contract",
);
