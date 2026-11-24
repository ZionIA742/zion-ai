"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const test = require("node:test");

const srcRoot = path.resolve(__dirname, "../../..");

const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;

Module._resolveFilename = function (request, ...args) {
  const resolved = request.startsWith("@/")
    ? path.join(srcRoot, request.slice(2))
    : request;

  return originalResolve.call(this, resolved, ...args);
};

// Isola apenas a dependencia de autenticacao.
// Os calculos financeiros e validade sao os modulos reais.
class QuoteAccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

Module._load = function (request, ...args) {
  if (
    request === "./quote-auth" ||
    request === "@/lib/server/sales-quotes/quote-auth"
  ) {
    return { QuoteAccessError };
  }

  return originalLoad.call(this, request, ...args);
};

Module._extensions[".ts"] = function (mod, filename) {
  const result = ts.transpileModule(
    fs.readFileSync(filename, "utf8"),
    {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  );

  mod._compile(result.outputText, filename);
};

const { buildHumanQuoteDraftEditRpcArgs: build } =
  require("./human-quote-draft-edit-input.ts");

const actor = "11111111-2222-4333-8444-555555555555";
const itemId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const timestamp = "2026-11-24T10:00:00.123456Z";

function quote() {
  return {
    id: "quote-test",
    organization_id: "org-test",
    store_id: "store-test",
    title: "Orcamento original",
    status: "draft",
    created_at: "2026-11-24T12:00:00Z",
    updated_at: timestamp,
    current_version_id: null,
    customer_notes: "Observacao original",
    internal_notes: "Nota interna",
    payment_terms: "30 dias",
    valid_until: "2026-12-09",
    metadata: {
      created_via: "api_sales_quotes_create",
      creation_actor_kind: "user",
      creation_actor_user_id: actor,
      validity_days: "15",
    },
  };
}

function item() {
  return {
    id: itemId,
    quote_id: "quote-test",
    organization_id: "org-test",
    store_id: "store-test",
    item_type: "custom",
    name: "Instalacao",
    description: null,
    quantity: 2,
    unit_price_cents: 10000,
    discount_cents: 1000,
    subtotal_cents: 20000,
    total_cents: 19000,
    sort_order: 1,
    sku: "SKU-01",
    metadata: { source: "preservado" },
  };
}

function input(overrides = {}) {
  return {
    expected_updated_at: timestamp,
    expected_current_version_id: null,
    ...overrides,
  };
}

function prepare(body = {}, q = quote(), items = [item()]) {
  return build({
    quote: q,
    currentItems: items,
    body: input(body),
  });
}

function editableItem(overrides = {}) {
  return {
    id: itemId,
    item_type: "custom",
    name: "Instalacao",
    quantity: 2,
    unit_price_cents: 10000,
    discount_cents: 1000,
    ...overrides,
  };
}

function rejectsCode(fn, code) {
  assert.throws(fn, (error) => error.code === code);
}

test("recalcula valores usando o modulo financeiro real", () => {
  const result = prepare({
    items: [editableItem({ quantity: 3 })],
  });

  assert.equal(result.p_subtotal_cents, 30000);
  assert.equal(result.p_discount_cents, 1000);
  assert.equal(result.p_total_cents, 29000);
});

test("preserva os campos omitidos e timestamp completo", () => {
  const result = prepare({ title: "Novo titulo" });

  assert.equal(result.p_title, "Novo titulo");
  assert.equal(result.p_internal_notes, "Nota interna");
  assert.equal(result.p_payment_terms, "30 dias");
  assert.equal(result.p_expected_updated_at, timestamp);
  assert.equal(result.p_valid_until, "2026-12-09");
  assert.equal(result.p_validity_days, 15);
});

test("preserva metadata e SKU dos itens mantidos", () => {
  const result = prepare({
    items: [editableItem({ name: "Novo nome" })],
  });

  assert.equal(result.p_items[0].id, itemId);
  assert.equal(result.p_items[0].sku, "SKU-01");
  assert.deepEqual(result.p_items[0].metadata, {
    source: "preservado",
  });
});

test("permite adicionar item manual sem ID", () => {
  const result = prepare({
    items: [
      editableItem(),
      editableItem({ id: null, name: "Novo servico" }),
    ],
  });

  assert.equal(result.p_items.length, 2);
  assert.equal(result.p_items[1].id, null);
  assert.equal(result.p_total_cents, 38000);
});

test("bloqueia campos comerciais protegidos", () => {
  for (const field of [
    "status", "organization_id", "store_id",
    "metadata", "total_cents", "conversation_id",
    "commercial_opportunity_id",
  ]) {
    rejectsCode(
      () => prepare({ [field]: "falsificado" }),
      "FORBIDDEN_EDIT_FIELD",
    );
  }
});

test("rejeita ID de outro orcamento", () => {
  rejectsCode(
    () => prepare({
      items: [editableItem({
        id: "12345678-1234-1234-1234-123456789abc",
      })],
    }),
    "INVALID_ITEM_ID",
  );
});

test("rejeita IDs de itens duplicados", () => {
  rejectsCode(
    () => prepare({
      items: [editableItem(), editableItem()],
    }),
    "DUPLICATE_ITEM_ID",
  );
});

test("rejeita item persistido fora da loja", () => {
  rejectsCode(
    () => prepare({}, quote(), [
      { ...item(), store_id: "outra-loja" },
    ]),
    "INVALID_CURRENT_ITEM_SCOPE",
  );
});

test("rejeita valores financeiros invalidos", () => {
  assert.throws(() => prepare({
    items: [editableItem({ unit_price_cents: -1 })],
  }));

  assert.throws(() => prepare({
    discount_cents: 999999,
  }));
});

test("rejeita edicao desatualizada", () => {
  rejectsCode(
    () => prepare({
      expected_updated_at: "2026-11-23T10:00:00Z",
    }),
    "HUMAN_QUOTE_EDIT_STALE",
  );
});

test("rejeita orcamento sem procedencia", () => {
  rejectsCode(
    () => prepare({}, { ...quote(), metadata: {} }),
    "HUMAN_QUOTE_EDIT_PROVENANCE_REQUIRED",
  );
});

test("rejeita orcamento fora do fluxo de rascunho", () => {
  rejectsCode(
    () => prepare({}, { ...quote(), status: "sent" }),
    "HUMAN_QUOTE_EDIT_VERSIONED_FLOW_REQUIRED",
  );
});

test("rejeita lista vazia de itens", () => {
  rejectsCode(
    () => prepare({ items: [] }),
    "INVALID_ITEMS",
  );
});

test("permite limpar observacoes explicitamente", () => {
  const result = prepare({ customer_notes: null });

  assert.equal(result.p_customer_notes, null);
  assert.equal(result.p_internal_notes, "Nota interna");
});

test("rejeita validade zero conforme contrato SQL atual", () => {
  rejectsCode(
    () => prepare({ validity_days: "0" }),
    "INVALID_VALIDITY_DAYS",
  );
});

test("nao modifica os objetos originais", () => {
  const q = quote();
  const items = [item()];
  const before = JSON.stringify({ q, items });

  prepare({ title: "Alterado" }, q, items);

  assert.equal(JSON.stringify({ q, items }), before);
});
