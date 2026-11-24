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

try {
  const input = require("./human-quote-draft-edit-input.ts");
  buildDraft = input.buildHumanQuoteDraftEditRpcArgs;
  buildVersioned = input.buildHumanQuoteVersionedEditRpcArgs;
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
