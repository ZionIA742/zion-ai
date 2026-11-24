"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const test = require("node:test");

const srcRoot = path.resolve(__dirname, "../../../../..");
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;

Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(
    this,
    request.startsWith("@/")
      ? path.join(srcRoot, request.slice(2))
      : request,
    ...args,
  );
};

class QuoteAccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const quoteId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";

const stamp = "2026-11-24T10:00:00.123456Z";
const nextStamp = "2026-11-24T10:00:00.123457Z";

let state;

Module._load = function (request, ...args) {
  if (request === "next/server") {
    return {
      NextResponse: {
        json: (body, init) => Response.json(body, init),
      },
    };
  }

  if (
    request === "./quote-auth" ||
    request === "@/lib/server/sales-quotes/quote-auth"
  ) {
    return {
      QuoteAccessError,
      resolveAuthorizedExistingQuote: async (id) => {
        state.calls.push(["auth", id]);
        if (state.authError) throw state.authError;
        return state.scope;
      },
    };
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

const { PATCH } = require("./route.ts");

function setup() {
  state = {
    calls: [],
    authError: null,
    rpcError: null,
    itemsError: null,
    invalidResult: false,
  };

  const quote = {
    id: quoteId,
    organization_id: "org-test",
    store_id: "store-test",
    status: "draft",
    title: "Orcamento original",
    created_at: "2026-11-24T12:00:00Z",
    updated_at: stamp,
    current_version_id: null,
    metadata: {
      created_via: "api_sales_quotes_create",
      creation_actor_kind: "user",
      creation_actor_user_id: actorId,
    },
  };

  const items = [{
    id: itemId,
    quote_id: quoteId,
    organization_id: "org-test",
    store_id: "store-test",
    item_type: "custom",
    name: "Instalacao",
    quantity: 1,
    unit_price_cents: 10000,
    discount_cents: 0,
    subtotal_cents: 10000,
    total_cents: 10000,
    sort_order: 1,
    metadata: {},
  }];

  const query = {
    select() {
      return this;
    },
    eq(key, value) {
      state.calls.push(["eq", key, value]);
      return this;
    },
    order() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve({
        data: items,
        error: state.itemsError,
      }).then(resolve, reject);
    },
  };

  state.scope = {
    quote,
    organizationId: "org-test",
    store: { id: "store-test" },
    supabase: {
      from(table) {
        state.calls.push(["from", table]);
        return query;
      },
      async rpc(name, args) {
        state.calls.push(["rpc", name, args]);

        if (state.rpcError) {
          return { data: null, error: state.rpcError };
        }

        return {
          error: null,
          data: [{
            quote_id: state.invalidResult
              ? "unexpected-id"
              : quoteId,
            quote_status: "draft",
            current_version_id: null,
            updated_at: nextStamp,
            item_count: args.p_items.length,
            subtotal_cents: args.p_subtotal_cents,
            discount_cents: args.p_discount_cents,
            total_cents: args.p_total_cents,
          }],
        };
      },
    },
  };
}

function rpcCalls() {
  return state.calls.filter((call) => call[0] === "rpc");
}

async function send(overrides = {}, id = quoteId) {
  const request = new Request("http://localhost/edit-human", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expected_updated_at: stamp,
      expected_current_version_id: null,
      title: "Titulo editado",
      ...overrides,
    }),
  });

  return PATCH(request, {
    params: Promise.resolve({ quoteId: id }),
  });
}

test("salva usando somente a autoridade SQL humana", async () => {
  setup();

  const response = await send();

  assert.equal(response.status, 200);
  const result = await response.json();

  assert.equal(result.ok, true);
  assert.equal(result.quote.status, "draft");
  assert.equal(result.quote.updated_at, nextStamp);
  assert.equal(result.quote.total_cents, 10000);

  assert.deepEqual(state.calls[0], ["auth", quoteId]);
  assert.equal(rpcCalls().length, 1);

  const [, name, args] = rpcCalls()[0];

  assert.equal(name, "apply_human_sales_quote_draft_edit_by_system");
  assert.equal(args.p_title, "Titulo editado");
  assert.equal(args.p_expected_updated_at, stamp);
  assert.equal(args.p_organization_id, "org-test");
  assert.equal(args.p_store_id, "store-test");
  assert.equal(args.p_quote_id, quoteId);
  assert.equal("p_status" in args, false);
});

test("le itens com isolamento de organizacao e loja", async () => {
  setup();

  await send();

  assert.ok(state.calls.some((c) =>
    c[0] === "eq" && c[1] === "quote_id" && c[2] === quoteId,
  ));

  assert.ok(state.calls.some((c) =>
    c[0] === "eq" && c[1] === "organization_id" &&
    c[2] === "org-test",
  ));

  assert.ok(state.calls.some((c) =>
    c[0] === "eq" && c[1] === "store_id" &&
    c[2] === "store-test",
  ));
});

test("bloqueia usuario nao autenticado antes da leitura", async () => {
  setup();

  state.authError = new QuoteAccessError(
    401, "UNAUTHORIZED", "Nao autenticado.",
  );

  const response = await send();

  assert.equal(response.status, 401);
  assert.equal(state.calls.length, 1);
  assert.equal(rpcCalls().length, 0);
});

test("respeita negativa de acesso a loja", async () => {
  setup();

  state.authError = new QuoteAccessError(
    403, "STORE_FORBIDDEN", "Acesso negado.",
  );

  assert.equal((await send()).status, 403);
  assert.equal(rpcCalls().length, 0);
});

test("rejeita identificador invalido", async () => {
  setup();

  assert.equal((await send({}, "invalido")).status, 400);
  assert.equal(state.calls.length, 0);
});

test("bloqueia ausencia de procedencia antes dos itens", async () => {
  setup();

  state.scope.quote.metadata = {};

  const response = await send();

  assert.equal(response.status, 403);
  assert.equal(state.calls.length, 1);
});

test("bloqueia timestamp obsoleto antes da escrita", async () => {
  setup();

  const response = await send({
    expected_updated_at: "2026-11-23T12:00:00Z",
  });

  assert.equal(response.status, 409);
  assert.equal(rpcCalls().length, 0);
});

test("rejeita ausencia da precondicao de versao", async () => {
  setup();

  const response = await send({
    expected_current_version_id: undefined,
  });

  assert.equal(response.status, 428);
  assert.equal(rpcCalls().length, 0);
});

test("nao altera orcamento enviado", async () => {
  setup();

  state.scope.quote.status = "sent";

  const response = await send();

  assert.equal(response.status, 409);
  assert.equal(rpcCalls().length, 0);
});

test("bloqueia falsificacao de status", async () => {
  setup();

  const response = await send({ status: "approved" });

  assert.equal(response.status, 400);
  assert.equal(rpcCalls().length, 0);
});

test("traduz conflito SQL de concorrencia", async () => {
  setup();

  state.rpcError = {
    code: "40001",
    message: "ZION_HUMAN_QUOTE_EDIT_STALE",
  };

  const response = await send();

  assert.equal(response.status, 409);
  assert.equal(
    (await response.json()).error,
    "HUMAN_QUOTE_EDIT_STALE",
  );
});

test("traduz exigencia SQL de fluxo versionado", async () => {
  setup();

  state.rpcError = {
    code: "23514",
    message: "ZION_HUMAN_QUOTE_EDIT_VERSIONED_FLOW_REQUIRED",
  };

  assert.equal((await send()).status, 409);
});

test("nao chama writer quando leitura de itens falha", async () => {
  setup();

  state.itemsError = { message: "Database unavailable" };

  assert.equal((await send()).status, 500);
  assert.equal(rpcCalls().length, 0);
});

test("nao expoe mensagens internas do banco", async () => {
  setup();

  state.rpcError = {
    code: "XX000",
    message: "internal database diagnostic",
  };

  const response = await send();

  assert.equal(response.status, 500);
  assert.doesNotMatch(
    await response.text(),
    /internal database diagnostic/,
  );
});

test("rejeita retorno divergente do writer", async () => {
  setup();

  state.invalidResult = true;

  const response = await send();

  assert.equal(response.status, 500);
  assert.equal((await response.json()).ok, false);
});

test("rejeita JSON malformado sem chamar writer", async () => {
  setup();

  const request = new Request("http://localhost/edit-human", {
    method: "PATCH",
    body: "{invalid-json",
  });

  const response = await PATCH(request, {
    params: Promise.resolve({ quoteId }),
  });

  assert.equal(response.status, 400);
  assert.equal(rpcCalls().length, 0);
});
