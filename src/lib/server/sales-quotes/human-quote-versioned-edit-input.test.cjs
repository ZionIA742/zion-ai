const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const Module = require("node:module");
const path = require("node:path");

const originalLoad = Module._load;
const moneyPath = path.resolve(__dirname, "money.ts");
const srcRoot = path.resolve(__dirname, "../../..");

class TestQuoteAccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "QuoteAccessError";
    this.status = status;
    this.code = code;
  }
}

Module._load = function(request, parent, isMain) {
  // Isola somente a dependencia HTTP de autenticacao.
  // As funcoes financeiras continuam sendo reais.
  if (
    request === "@/lib/server/sales-quotes/quote-auth" &&
    parent?.filename &&
    path.resolve(parent.filename) === moneyPath
  ) {
    return { QuoteAccessError: TestQuoteAccessError };
  }

  if (request.startsWith("@/")) {
    request = path.join(srcRoot, request.slice(2));
  }

  return originalLoad.call(this, request, parent, isMain);
};

const previousLoader = require.extensions[".ts"];

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};

let buildDraft;
let buildVersioned;
let prepareSnapshot;

try {
  const input = require("./human-quote-draft-edit-input.ts");
  buildDraft = input.buildHumanQuoteDraftEditRpcArgs;
  buildVersioned = input.buildHumanQuoteVersionedEditRpcArgs;
  prepareSnapshot = require("./human-quote-versioned-edit-snapshot.ts").prepareHumanQuoteVersionedSnapshot;
} finally {
  Module._load = originalLoad;
  if (previousLoader) {
    require.extensions[".ts"] = previousLoader;
  } else {
    delete require.extensions[".ts"];
  }
}

const ids = {
  quote: "11111111-1111-4111-8111-111111111111",
  org: "22222222-2222-4222-8222-222222222222",
  store: "33333333-3333-4333-8333-333333333333",
  version: "44444444-4444-4444-8444-444444444444",
  actor: "55555555-5555-4555-8555-555555555555",
  operation: "66666666-6666-4666-8666-666666666666",
  item: "77777777-7777-4777-8777-777777777777",
  other: "88888888-8888-4888-8888-888888888888",
};

function fixture() {
  const stamp = "2026-11-24T12:00:00.123456+00:00";

  return {
    operationId: ids.operation,
    quote: {
      id: ids.quote,
      organization_id: ids.org,
      store_id: ids.store,
      status: "sent",
      title: "Piscina",
      quote_number: "100",
      conversation_id: null,
      lead_id: null,
      customer_notes: null,
      internal_notes: null,
      payment_terms: null,
      delivery_terms: null,
      warranty_terms: null,
      valid_until: null,
      subtotal_cents: 200000,
      discount_cents: 0,
      total_cents: 200000,
      current_version_id: ids.version,
      created_at: stamp,
      updated_at: stamp,
      metadata: {
        created_via: "api_sales_quotes_create",
        creation_actor_kind: "user",
        creation_actor_user_id: ids.actor,
      },
    },
    currentItems: [{
      id: ids.item,
      quote_id: ids.quote,
      organization_id: ids.org,
      store_id: ids.store,
      item_type: "custom",
      name: "Piscina",
      description: null,
      quantity: 1,
      unit_price_cents: 200000,
      discount_cents: 0,
      subtotal_cents: 200000,
      total_cents: 200000,
      sort_order: 1,
      sku: "P-01",
      metadata: { preserved: true },
    }],
    body: {
      expected_updated_at: stamp,
      expected_current_version_id: ids.version,
    },
  };
}

test("permite edicao versionada de orcamento enviado", () => {
  const f = fixture();
  const result = buildVersioned(f);
  assert.equal(result.p_operation_id, ids.operation);
  assert.equal(result.p_expected_current_version_id, ids.version);
  assert.equal(result.p_total_cents, 200000);
});

test("permite diferentes estados sem depender do envio", () => {
  for (const status of [
    "draft", "approved", "pending_review",
    "sent", "expired", "changes_requested", "cancelled",
  ]) {
    const f = fixture();
    f.quote.status = status;
    assert.equal(buildVersioned(f).p_total_cents, 200000);
  }
});

test("recalcula valores com o financeiro existente", () => {
  const f = fixture();

  f.body.items = [{
    id: ids.item,
    item_type: "custom",
    name: "Piscina",
    quantity: 2,
    unit_price_cents: 100000,
    discount_cents: 10000,
  }];

  const result = buildVersioned(f);

  assert.equal(result.p_subtotal_cents, 200000);
  assert.equal(result.p_discount_cents, 10000);
  assert.equal(result.p_total_cents, 190000);
});

test("preserva identidade e metadata dos itens existentes", () => {
  const result = buildVersioned(fixture());

  assert.equal(result.p_items[0].id, ids.item);
  assert.equal(result.p_items[0].sku, "P-01");
  assert.deepEqual(
    result.p_items[0].metadata,
    { preserved: true },
  );
});

test("novos itens recebem UUID estavel por operacao", () => {
  const f = fixture();

  f.body.items = [
    { item_type: "custom", name: "A", quantity: 1,
      unit_price_cents: 10000 },
    { item_type: "custom", name: "B", quantity: 1,
      unit_price_cents: 10000 },
  ];

  const first = buildVersioned(f);
  const replay = buildVersioned(f);

  assert.deepEqual(first, replay);
  assert.match(first.p_items[0].id,
    /^[0-9a-f-]{36}$/);
  assert.notEqual(
    first.p_items[0].id,
    first.p_items[1].id,
  );

  f.operationId = ids.other;

  assert.notEqual(
    buildVersioned(f).p_items[0].id,
    first.p_items[0].id,
  );
});

test("recusa operacao invalida", () => {
  const f = fixture();
  f.operationId = "invalid";
  assert.throws(() => buildVersioned(f));
});

test("recusa ausencia de versao anterior", () => {
  const f = fixture();
  f.quote.status = "draft";
  f.quote.current_version_id = null;
  f.body.expected_current_version_id = null;
  assert.throws(() => buildVersioned(f));
});

test("recusa edicao obsoleta", () => {
  const f = fixture();
  f.body.expected_current_version_id = ids.other;
  assert.throws(() => buildVersioned(f));
});

test("recusa tentativa de manipular status ou PDF", () => {
  for (const field of [
    "status", "approved_by", "sent_at",
    "store_file_id", "quote_snapshot",
    "organization_id", "generated_by",
  ]) {
    const f = fixture();
    f.body[field] = "forbidden";
    assert.throws(() => buildVersioned(f));
  }
});

test("recusa item persistido de outra loja", () => {
  const f = fixture();
  f.currentItems[0].store_id = ids.other;
  assert.throws(() => buildVersioned(f));
});

test("preserva fluxo independente de rascunho", () => {
  const f = fixture();
  assert.throws(() => buildDraft(f));

  f.quote.status = "draft";
  f.quote.current_version_id = null;
  f.body.expected_current_version_id = null;

  const result = buildDraft(f);

  assert.equal(result.p_expected_current_version_id, null);
  assert.equal(result.p_total_cents, 200000);
  assert.equal("p_operation_id" in result, false);
});

test("nao modifica os objetos de entrada", () => {
  const f = fixture();
  const before = JSON.stringify(f);
  buildVersioned(f);
  assert.equal(JSON.stringify(f), before);
});

function snapshotFixture() {
  const f = fixture();
  return {
    ...f,
    previousVersion: {
      id: ids.version, quote_id: ids.quote,
      organization_id: ids.org, store_id: ids.store,
      quote_kind: "definitive",
    },
    store: { id: ids.store, name: "Loja teste" },
    lead: null,
    settings: {},
    generatedAt: "2026-11-24T12:01:00.000Z",
  };
}

test("snapshot corresponde ao writer e nao carrega status enviado", () => {
  const f = snapshotFixture();
  f.body.title = "Novo titulo";
  f.body.items = [{
    id: ids.item, item_type: "custom", name: "Piscina",
    quantity: 1, unit_price_cents: 200000, discount_cents: 10000,
  }];
  f.body.discount_cents = 10000;
  const r = prepareSnapshot(f);
  assert.equal(r.rpc.p_subtotal_cents, 200000);
  assert.equal(r.rpc.p_discount_cents, 10000);
  assert.equal(r.rpc.p_total_cents, 190000);
  assert.equal(r.snapshot.quote.title, r.rpc.p_title);
  assert.equal(r.snapshot.quote.totalCents, r.rpc.p_total_cents);
  assert.equal(r.snapshot.quote.subtotalCents, r.rpc.p_subtotal_cents);
  assert.equal(r.snapshot.quote.discountCents, r.rpc.p_discount_cents);
  assert.equal(r.snapshot.quote.status, "draft");
  assert.equal(r.snapshot.quote.quoteKind, "definitive");
  assert.equal(r.quote.current_version_id, ids.operation);
  assert.equal(r.rpc.p_quote_snapshot, r.snapshot);
  assert.equal(f.quote.status, "sent");
});

test("snapshot reproduz exatamente a projecao SQL dos itens", () => {
  const f = snapshotFixture();
  f.currentItems[0].sku = " P-01 ";
  f.body.items = [
    { id: ids.item, item_type: "custom", name: "Piscina", quantity: 2, unit_price_cents: 100000 },
    { item_type: "custom", name: "Instalacao", quantity: 1, unit_price_cents: 50000 },
  ];
  const r = prepareSnapshot(f);
  assert.deepEqual(r.snapshot.items, r.rpc.p_items.map(i => ({
    id: i.id, name: i.name, description: i.description, quantity: i.quantity,
    unitPriceCents: i.unit_price_cents, discountCents: i.discount_cents,
    subtotalCents: i.subtotal_cents, totalCents: i.total_cents,
    sku: i.sku, sortOrder: i.sort_order, metadata: i.metadata,
  })));
  assert.equal(r.snapshot.items[0].sku, "P-01");
  assert.equal(r.snapshot.items[1].id, r.items[1].id);
});

test("limpeza de termos nao recupera metadata antiga", () => {
  const f = snapshotFixture();
  f.quote.metadata.payment_terms = "Antigo";
  f.quote.metadata.delivery_terms = "Antigo";
  f.quote.metadata.warranty_terms = "Antigo";
  f.quote.metadata.valid_until = "2026-12-31";
  Object.assign(f.body, {
    payment_terms: null, delivery_terms: null,
    warranty_terms: null, validity_days: null,
  });
  const r = prepareSnapshot(f);
  for (const key of ["paymentTerms", "deliveryTerms", "warrantyTerms", "validUntil"]) {
    assert.equal(r.snapshot.quote[key], null);
  }
});

test("mantem classificacao preliminar ou ausente", () => {
  for (const kind of ["preliminary", null]) {
    const f = snapshotFixture();
    f.previousVersion.quote_kind = kind;
    const r = prepareSnapshot(f);
    assert.equal(r.snapshot.quote.quoteKind, kind);
    assert.equal(Boolean(r.snapshot.quote.quoteKindNotice), kind === "preliminary");
  }
});

test("mantem dados do lead e recusa escopo divergente", () => {
  const f = snapshotFixture();
  f.quote.lead_id = ids.other;
  f.lead = { id: ids.other, name: "Cliente teste", phone: null };
  assert.equal(prepareSnapshot(f).snapshot.lead.id, ids.other);
  f.lead = null;
  assert.throws(() => prepareSnapshot(f), /SCOPE_MISMATCH/);
});

test("recusa versao ou loja fora do escopo", () => {
  for (const field of ["id", "quote_id", "organization_id", "store_id"]) {
    const f = snapshotFixture();
    f.previousVersion[field] = ids.other;
    assert.throws(() => prepareSnapshot(f), /SCOPE_MISMATCH/);
  }
  const f = snapshotFixture();
  f.store.id = ids.other;
  assert.throws(() => prepareSnapshot(f), /SCOPE_MISMATCH/);
});

test("snapshot reproduzivel com mesmas entradas e data", () => {
  const f = snapshotFixture();
  const before = JSON.stringify(f);
  assert.deepEqual(prepareSnapshot(f), prepareSnapshot(f));
  assert.equal(JSON.stringify(f), before);
  assert.equal(prepareSnapshot(f).snapshot.generatedAt, f.generatedAt);
});

test("preserva referencias de fotos de itens existentes na projecao", () => {
  const f = snapshotFixture();
  f.currentItems[0].source_photo_storage_path = "foto-existente.png";
  const r = prepareSnapshot(f);
  assert.equal(r.items[0].source_photo_storage_path, "foto-existente.png");
  assert.equal("source_photo_storage_path" in r.rpc.p_items[0], false);
});

test("snapshot rejeita desconto global divergente dos itens", () => {
  const f = snapshotFixture();
  f.body.discount_cents = 10000;
  assert.throws(() => prepareSnapshot(f), { code: "INVALID_DISCOUNT_CENTS" });
});

function globalDiscountFixture() {
  const f = snapshotFixture();
  Object.assign(f.quote, { subtotal_cents: 1430000, discount_cents: 70000, total_cents: 1360000 });
  Object.assign(f.currentItems[0], { unit_price_cents: 1430000, discount_cents: 50000, subtotal_cents: 1430000, total_cents: 1380000 });
  f.previousVersion.quote_snapshot = { quote: { subtotalCents: 1430000, discountCents: 70000, totalCents: 1360000 } };
  return f;
}
test("preserva desconto global historico em edicao textual", () => {
  const f = globalDiscountFixture(); f.body.title = "Novo titulo";
  const r = prepareSnapshot(f);
  assert.equal(r.rpc.p_discount_cents, 70000); assert.equal(r.rpc.p_total_cents, 1360000);
  assert.equal(r.snapshot.quote.discountCents, 70000); assert.equal(r.snapshot.quote.totalCents, 1360000);
  assert.equal(r.snapshot.items[0].discountCents, 50000); assert.equal(r.snapshot.items[0].totalCents, 1380000);
});
test("preserva desconto global ao incluir novo item", () => {
  const f = globalDiscountFixture();
  f.body.items = [{ id: ids.item, item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1430000, discount_cents: 50000 }, { item_type: "custom", name: "Servico", quantity: 1, unit_price_cents: 10000, discount_cents: 1000 }];
  const r = prepareSnapshot(f); assert.equal(r.rpc.p_discount_cents, 71000); assert.equal(r.rpc.p_total_cents, 1369000);
});
test("recusa reduzir ou aumentar desconto global por JSON", () => {
  for (const value of [50000, 90000]) { const f = globalDiscountFixture(); f.body.discount_cents = value; assert.throws(() => prepareSnapshot(f), {code:"INVALID_DISCOUNT_CENTS"}); }
  const f = globalDiscountFixture(); f.body.discount_cents = 70000; assert.equal(prepareSnapshot(f).rpc.p_discount_cents,70000);
});
test("recusa subtotal insuficiente para desconto preservado", () => {
  const f = globalDiscountFixture(); f.body.items = [{item_type:"custom",name:"Item",quantity:1,unit_price_cents:10000}];
  assert.throws(() => prepareSnapshot(f), {code:"INVALID_DISCOUNT_CENTS"});
});
test("recusa historico financeiro ou snapshot divergente antes do PDF", () => {
  const f = globalDiscountFixture(); f.quote.total_cents++; assert.throws(() => prepareSnapshot(f), {code:"INVALID_DISCOUNT_CENTS"});
  const g = globalDiscountFixture(); g.previousVersion.quote_snapshot.quote.totalCents++; assert.throws(() => prepareSnapshot(g), /GLOBAL_DISCOUNT_HISTORY_INVALID/);
});
test("aceita snapshot historico com campos legados no nivel superior", () => {
  const f = globalDiscountFixture(); f.previousVersion.quote_snapshot = {subtotal_cents:1430000,discount_cents:70000,total_cents:1360000};
  assert.equal(prepareSnapshot(f).snapshot.quote.totalCents,1360000);
});
