const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.join(
  __dirname,
  "catalog-commercial-message.ts",
);

globalThis.fetch = async () => {
  throw new Error("REAL_NETWORK_REQUEST_BLOCKED");
};

const compiled = ts.transpileModule(
  fs.readFileSync(filename, "utf8"),
  {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
);

const mod = new Module(filename, module);
mod.filename = filename;
mod.paths = module.paths;
mod._compile(compiled.outputText, filename);

const { buildCatalogCommercialMessage: build } = mod.exports;

const LIMIT = 1024;

console.log("COMMERCIAL_TEST_FILE_EXECUTED");

function pool(extra = {}) {
  return {
    sourceKind: "pool",
    category: "piscinas",
    name: "Piscina Teste",
    description: null,
    price: null,
    priceStatus: null,
    characteristics: {},
    ...extra,
  };
}

function item(category, extra = {}) {
  return {
    sourceKind: "catalog_item",
    category,
    name: "Produto Teste",
    description: null,
    price: null,
    priceStatus: null,
    characteristics: {},
    ...extra,
  };
}

test("01 - pool uses registered dimensions and price", () => {
  const message = build(pool({
    priceStatus: "valid",
    price: { amount: 19900, currency: "BRL" },
    characteristics: {
      length_m: 6,
      width_m: 3,
      depth_m: 1.4,
      max_capacity_l: 25000,
      material: "Fibra",
    },
  }), LIMIT);

  for (const expected of [
    "Modelo: Piscina Teste",
    "Medidas: 6 x 3 m",
    "Profundidade: 1,4 m",
    "Capacidade: 25.000 litros",
    "Material: Fibra",
    "Valor: R$ 19.900,00",
    "\n\n",
  ]) {
    assert.ok(message.includes(expected), expected);
  }
});

test("02 - chemical uses registered commercial fields", () => {
  const message = build(item("quimicos", {
    name: "Cloro Teste",
    characteristics: {
      packaging: "10 kg",
      composition: "Composicao cadastrada",
      application: "Tratamento de piscina",
      dosage: "PRIVATE_DOSAGE",
    },
  }), LIMIT);

  assert.ok(message.includes("Produto: Cloro Teste"));
  assert.ok(message.includes("Embalagem: 10 kg"));
  assert.ok(message.includes("Tratamento de piscina"));
  assert.doesNotMatch(message, /Dosagem:|PRIVATE_DOSAGE/);
});

test("03 - accessory uses registered characteristics", () => {
  const message = build(item("acessorios", {
    name: "Escada Teste",
    characteristics: {
      material: "Inox",
      model: "3 degraus",
      compatibility: "Modelo cadastrado",
    },
  }), LIMIT);

  assert.ok(message.includes("Material: Inox"));
  assert.ok(message.includes("Modelo: 3 degraus"));
  assert.ok(message.includes("Compatibilidade: Modelo cadastrado"));
});

test("04 - other product includes description and valid price", () => {
  const message = build(item("outros", {
    name: "Banco Teste",
    description: "Produto para area molhada.",
    priceStatus: "valid",
    price: { amount: 189.8, currency: "BRL" },
  }), LIMIT);

  assert.ok(message.includes("Produto: Banco Teste"));
  assert.ok(message.includes("Produto para area molhada."));
  assert.ok(message.includes("Valor: R$ 189,80"));
});

test("05 - invalid or unconfirmed prices are omitted", () => {
  const prices = [
    ["missing", 100, "BRL"],
    ["invalid", 100, "BRL"],
    ["on_request", 100, "BRL"],
    ["unknown_legacy", 100, "BRL"],
    ["valid", 0, "BRL"],
    ["valid", -10, "BRL"],
    ["valid", NaN, "BRL"],
    ["valid", 100, null],
    ["valid", 100, "ZZZ"],
    ["valid", 0.001, "BRL"],
  ];

  for (const [priceStatus, amount, currency] of prices) {
    assert.doesNotMatch(
      build(pool({
        priceStatus,
        price: { amount, currency },
      }), LIMIT),
      /Valor:/,
    );
  }
});

test("06 - absent characteristics are not invented", () => {
  const message = build(pool({
    characteristics: {
      width_m: null,
      length_m: 0,
      depth_m: -1,
      material: "N/A",
      shape: "   ",
    },
  }), LIMIT);

  assert.ok(message.includes("Piscina Teste"));
  assert.doesNotMatch(
    message,
    /Medidas:|Largura:|Comprimento:|Profundidade:|Material:|Formato:|Valor:|Fibra/,
  );
});

test("07 - internal fields are excluded", () => {
  const message = build(item("outros", {
    sku: "PRIVATE_SKU",
    stockQuantity: 51,
    stockStatus: "available",
    organizationId: "PRIVATE_ORG",
    storeId: "PRIVATE_STORE",
    characteristics: {
      imported_note: "PRIVATE_IMPORT",
      reviewed_category: "PRIVATE_REVIEW",
      barcode: "PRIVATE_BARCODE",
      application: "Aplicacao publica",
    },
  }), LIMIT);

  assert.ok(message.includes("Aplicacao publica"));
  assert.doesNotMatch(message, /PRIVATE_|Estoque:|51 unidades/);
});

test("08 - deterministic output without input mutation", () => {
  const product = Object.freeze(pool({
    characteristics: Object.freeze({
      length_m: 6,
      width_m: 3,
    }),
  }));

  const before = JSON.stringify(product);

  assert.equal(build(product, LIMIT), build(product, LIMIT));
  assert.equal(JSON.stringify(product), before);
});

test("09 - message budget preserves complete name and price", () => {
  const message = build(pool({
    description: "X".repeat(5000),
    priceStatus: "valid",
    price: { amount: 15000, currency: "BRL" },
  }), 200);

  assert.ok(message.length <= 200);
  assert.ok(message.includes("Piscina Teste"));
  assert.ok(message.includes("Valor: R$ 15.000,00"));
  assert.doesNotMatch(message, /X{10}/);
});

test("10 - invalid inputs and insufficient budget fail safely", () => {
  assert.throws(
    () => build(pool({ name: "  " }), LIMIT),
    /INVALID_COMMERCIAL_PRODUCT_NAME/,
  );

  assert.throws(
    () => build(pool({ category: "outros" }), LIMIT),
    /INVALID_COMMERCIAL_PRODUCT_CATEGORY/,
  );

  assert.throws(
    () => build(pool(), 10),
    /COMMERCIAL_MESSAGE_LIMIT_EXCEEDED/,
  );

  assert.throws(
    () => build(pool(), 0),
    /INVALID_COMMERCIAL_MESSAGE_LIMIT/,
  );
});
