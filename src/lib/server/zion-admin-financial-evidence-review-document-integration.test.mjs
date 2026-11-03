import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const nativeRequire = createRequire(import.meta.url);
const ts = nativeRequire("typescript");

const ACTOR = "11111111-2222-4333-8444-555555555555";
const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BUCKET = "zion-admin-financial-evidence";

const BASE =
  "https://zionapi.com.br/api/zion-admin/" +
  "financial-evidence/review/";

const modules = new Map();

// Importacoes reais dos modulos financeiros.
// Apenas autenticacao e cliente Supabase sao simulados.
function loadFinancialModule(name) {
  if (modules.has(name)) return modules.get(name);

  if (
    !/^\.\/zion-admin-financial-evidence-[a-z-]+$/.test(name)
  ) {
    throw new Error(`MODULE_NOT_ALLOWED: ${name}`);
  }

  const source = readFileSync(
    new URL(`${name}.ts`, import.meta.url),
    "utf8",
  );

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const exported = {};
  modules.set(name, exported);

  function resolveImport(dependency) {
    if (dependency === "node:crypto") {
      return nativeRequire(dependency);
    }

    if (dependency === "./zion-admin-api-access") {
      return {
        resolveZionAdminApiAccess() {
          throw new Error("REAL_AUTH_FORBIDDEN");
        },
      };
    }

    if (dependency === "./zion-admin-api-response") {
      return {
        createZionAdminApiDeniedResponse() {
          return Response.json(
            { ok: false, error: "AUTH_DENIED" },
            { status: 401 },
          );
        },
      };
    }

    if (dependency === "./zion-account-provisioning") {
      return {
        createServiceSupabaseClient() {
          throw new Error("REAL_DB_FORBIDDEN");
        },
      };
    }

    if (
      dependency.startsWith(
        "./zion-admin-financial-evidence-",
      )
    ) {
      return loadFinancialModule(dependency);
    }

    throw new Error(
      `UNEXPECTED_IMPORT: ${name} -> ${dependency}`,
    );
  }

  runInNewContext(compiled.outputText, {
    exports: exported,
    require: resolveImport,
    Request,
    Response,
    Headers,
    Buffer,
    Blob,
    URL,
    Uint8Array,
  });

  return exported;
}

const prepareModule = loadFinancialModule(
  "./zion-admin-financial-evidence-review-prepare-handler",
);

const viewModule = loadFinancialModule(
  "./zion-admin-financial-evidence-private-view-handler",
);

const makePrepareHandler =
  prepareModule.createFinancialEvidenceReviewPrepareHandler;

const makeViewHandler =
  viewModule.createFinancialEvidencePrivateViewHandler;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pdf(text) {
  return Buffer.from(
    `%PDF-1.4\n${text}\n%%EOF\n`,
    "utf8",
  );
}

function stateFixture() {
  const bytes = pdf("ZION TESTE FINANCEIRO");
  const sha = sha256(bytes);
  const month = "2026-10-01";

  return {
    month,
    currentRevision: 1,
    actor: ACTOR,
    role: "owner",
    bytes,
    upload: {
      id: 7,
      month,
      preclosure_revision: 1,
      source: "fixed_costs",
      storage_bucket: BUCKET,
      storage_path:
        `unverified/${month}/1/fixed_costs/` +
        `${ACTOR}-${sha}.pdf`,
      document_sha256: sha,
      mime_type: "application/pdf",
      size_bytes: bytes.length,
      uploaded_by_user_id: ACTOR,
      uploaded_at: "2026-10-29T12:00:00.000Z",
    },
    downloads: [],
    dbReads: [],
  };
}

function session(state) {
  return {
    ok: true,
    sessionUserId: state.actor,
    resolution: {
      status: "zion_admin_allowed",
      sessionUserId: state.actor,
      role: state.role,
      capabilities: ["manage_accounts"],
    },
  };
}

function fakeDb(state) {
  return {
    from(table) {
      const filters = {};

      return {
        select() {
          return this;
        },
        eq(field, value) {
          filters[field] = value;
          return this;
        },
        async maybeSingle() {
          state.dbReads.push(table);

          if (
            table === "zion_admin_financial_evidence_uploads"
          ) {
            const data =
              filters.id === state.upload.id
                ? { ...state.upload }
                : null;

            return { data, error: null };
          }

          if (
            table === "zion_admin_monthly_preclosures"
          ) {
            const data =
              filters.month === state.month
                ? {
                    month: state.month,
                    revision: state.currentRevision,
                  }
                : null;

            return { data, error: null };
          }

          throw new Error(`UNEXPECTED_TABLE: ${table}`);
        },
      };
    },

    storage: {
      from(bucket) {
        if (bucket !== BUCKET) {
          throw new Error("UNEXPECTED_STORAGE_BUCKET");
        }

        return {
          async download(path) {
            state.downloads.push(path);

            if (path !== state.upload.storage_path) {
              return {
                data: null,
                error: new Error("STORAGE_PATH_NOT_FOUND"),
              };
            }

            return {
              data: new Blob([state.bytes], {
                type: "application/pdf",
              }),
              error: null,
            };
          },
        };
      },
    },
  };
}

function handlers(state) {
  const db = fakeDb(state);

  const dependencies = {
    authorize: async () => session(state),
    createDb: () => db,
  };

  return {
    prepare: makePrepareHandler(dependencies),
    view: makeViewHandler(dependencies),
  };
}

function proofDraft() {
  return {
    source: "fixed_costs",
    proofType: "supplier_invoice",
    amountBrlCents: 0,
    amountUsd: null,
  };
}

function input() {
  return {
    month: "2026-10-01",
    uploadId: 7,
    proofDraft: proofDraft(),
  };
}

function request(action, value) {
  return new Request(BASE + action, {
    method: "POST",
    headers: {
      origin: "https://zionapi.com.br",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(value),
  });
}

async function prepare(available, value = input()) {
  const response = await available.prepare(
    request("prepare", value),
  );

  const result = await response.json();

  assert.equal(
    response.status,
    200,
    JSON.stringify(result),
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "prepared_unverified");
  assert.match(
    result.reviewFingerprint,
    /^[0-9a-f]{64}$/,
  );

  return result;
}

async function view(available, prepared, value = input()) {
  return available.view(
    request("document", {
      ...value,
      reviewFingerprint: prepared.reviewFingerprint,
    }),
  );
}

function changeRegisteredDocument(state, bytes) {
  state.bytes = bytes;

  const sha = sha256(bytes);

  state.upload.document_sha256 = sha;
  state.upload.size_bytes = bytes.length;
  state.upload.storage_path =
    `unverified/${state.month}/` +
    `${state.upload.preclosure_revision}/fixed_costs/` +
    `${ACTOR}-${sha}.pdf`;
}

test("01 - preparacao e visualizacao do mesmo PDF", async () => {
  const state = stateFixture();
  const available = handlers(state);

  const prepared = await prepare(available);
  const response = await view(available, prepared);

  assert.equal(response.status, 200);
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    state.bytes,
  );
  assert.equal(
    response.headers.get("x-zion-review-fingerprint"),
    prepared.reviewFingerprint,
  );
  assert.equal(
    response.headers.get("x-zion-document-sha256"),
    state.upload.document_sha256,
  );
  assert.equal(
    response.headers.get("x-zion-preclosure-revision"),
    "1",
  );

  // Um download na preparacao e outro na visualizacao.
  assert.equal(state.downloads.length, 2);
  assert.match(
    response.headers.get("cache-control"),
    /no-store/,
  );
});

test("02 - documento registrado mudou apos preparar", async () => {
  const state = stateFixture();
  const available = handlers(state);
  const prepared = await prepare(available);

  changeRegisteredDocument(
    state,
    pdf("OUTRO COMPROVANTE"),
  );

  const response = await view(available, prepared);

  assert.equal(response.status, 409);
  assert.equal(state.downloads.length, 1);
});

test("03 - revisao corrente mudou apos preparar", async () => {
  const state = stateFixture();
  const available = handlers(state);
  const prepared = await prepare(available);

  state.currentRevision = 2;

  const response = await view(available, prepared);

  assert.equal(response.status, 409);
  assert.equal(state.downloads.length, 1);
});

test("04 - documento foi associado a nova revisao", async () => {
  const state = stateFixture();
  const available = handlers(state);
  const prepared = await prepare(available);

  state.currentRevision = 2;
  state.upload.preclosure_revision = 2;
  state.upload.storage_path =
    state.upload.storage_path.replace(
      "/2026-10-01/1/",
      "/2026-10-01/2/",
    );

  const response = await view(available, prepared);

  assert.equal(response.status, 409);
  assert.equal(state.downloads.length, 1);
});

test("05 - valor financeiro mudou entre chamadas", async () => {
  const state = stateFixture();
  const available = handlers(state);
  const prepared = await prepare(available);

  const changed = input();
  changed.proofDraft.amountBrlCents = 1500;

  const response = await view(
    available,
    prepared,
    changed,
  );

  assert.equal(response.status, 409);
  assert.equal(state.downloads.length, 1);
});

test("06 - identidade autenticada mudou", async () => {
  const state = stateFixture();
  const available = handlers(state);
  const prepared = await prepare(available);

  state.actor = OTHER;

  const response = await view(available, prepared);

  assert.equal(response.status, 409);
  assert.equal(state.downloads.length, 1);
});

test("07 - bytes adulterados sao rejeitados", async () => {
  const state = stateFixture();
  const available = handlers(state);
  const prepared = await prepare(available);

  // Registro permanece igual; apenas Storage mudou.
  state.bytes = pdf("ARQUIVO ADULTERADO");

  const response = await view(available, prepared);

  assert.equal(response.status, 409);
  assert.equal(state.downloads.length, 2);
});

test("08 - perda da autoridade owner bloqueia", async () => {
  const state = stateFixture();
  const available = handlers(state);
  const prepared = await prepare(available);

  state.role = "admin";

  const readsBefore = state.dbReads.length;
  const response = await view(available, prepared);

  assert.equal(response.status, 403);
  assert.equal(state.downloads.length, 1);
  assert.equal(state.dbReads.length, readsBefore);
});

test("09 - upload diferente nao reutiliza revisao", async () => {
  const state = stateFixture();
  const available = handlers(state);
  const prepared = await prepare(available);

  const changed = input();
  changed.uploadId = 8;

  const response = await view(
    available,
    prepared,
    changed,
  );

  assert.equal(response.status, 409);
  assert.equal(state.downloads.length, 1);
});