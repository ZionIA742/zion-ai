import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const nativeRequire = createRequire(import.meta.url);
const ts = nativeRequire("typescript");

function loadTs(filename, resolver) {
  const source = readFileSync(
    new URL(filename, import.meta.url),
    "utf8",
  );

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const context = {
    exports: {},
    require: resolver,
    Response,
    Buffer,
    URL,
  };

  runInNewContext(compiled.outputText, context);
  return context.exports;
}

const reviewAccess = loadTs(
  "./zion-admin-financial-evidence-review-access.ts",
  (name) => {
    throw new Error(`UNEXPECTED_ACCESS_IMPORT: ${name}`);
  },
);

const handlerModule = loadTs(
  "./zion-admin-financial-evidence-review-prepare-handler.ts",
  (name) => {
    if (name === "./zion-admin-api-access") {
      return {
        resolveZionAdminApiAccess: async () => ({
          ok: false,
        }),
      };
    }

    if (name === "./zion-admin-api-response") {
      return {
        createZionAdminApiDeniedResponse: () =>
          Response.json(
            {
              ok: false,
              error: "AUTH_DENIED",
            },
            { status: 401 },
          ),
      };
    }

    if (name === "./zion-account-provisioning") {
      return {
        createServiceSupabaseClient() {
          throw new Error("REAL_DB_FORBIDDEN");
        },
      };
    }

    if (
      name ===
      "./zion-admin-financial-evidence-review-access"
    ) {
      return reviewAccess;
    }

    if (
      name ===
      "./zion-admin-financial-evidence-review-preparation"
    ) {
      return {
        buildFinancialEvidenceReviewPreparation() {
          throw new Error("REAL_PREPARATION_FORBIDDEN");
        },
      };
    }

    throw new Error(`UNEXPECTED_IMPORT: ${name}`);
  },
);

const createHandler =
  handlerModule.createFinancialEvidenceReviewPrepareHandler;

const ACTOR =
  "11111111-2222-4333-8444-555555555555";

const OTHER =
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const SHA = "a".repeat(64);
const FINGERPRINT = "b".repeat(64);

const URL_VALUE =
  "https://zionapi.com.br/api/zion-admin/" +
  "financial-evidence/review/prepare";

function access(role = "owner") {
  return {
    ok: true,
    sessionUserId: ACTOR,
    resolution: {
      status: "zion_admin_allowed",
      sessionUserId: ACTOR,
      role,
      capabilities: ["manage_accounts"],
    },
  };
}

function requestBody(overrides = {}) {
  return {
    month: "2026-10-01",
    uploadId: 7,
    proofDraft: {
      source: "fixed_costs",
      proofType: "supplier_invoice",
      amountBrlCents: 0,
      amountUsd: null,
    },
    ...overrides,
  };
}

function prepared() {
  return {
    ok: true,
    status: "prepared_unverified",
    reviewFingerprint: FINGERPRINT,
    context: {
      actorUserId: ACTOR,
      month: "2026-10-01",
      preclosureRevision: 1,
      uploadId: 7,
      source: "fixed_costs",
      proofType: "supplier_invoice",
      amountBrlCents: 0,
      amountUsd: null,
      documentSha256: SHA,
      sizeBytes: 52,
      storagePath:
        "unverified/2026-10-01/1/fixed_costs/" +
        `${ACTOR}-${SHA}.pdf`,
    },
  };
}

function makeRequest(
  body = requestBody(),
  options = {},
) {
  const headers = {
    origin: "https://zionapi.com.br",
    "content-type": "application/json",
    ...options.headers,
  };

  for (const [key, value] of Object.entries(headers)) {
    if (value === null) delete headers[key];
  }

  const raw = Object.hasOwn(options, "raw")
    ? options.raw
    : JSON.stringify(body);

  return new Request(URL_VALUE, {
    method: "POST",
    headers,
    body: raw,
  });
}

function setup(overrides = {}) {
  const counts = {
    auth: 0,
    db: 0,
    prepare: 0,
  };

  const defaults = {
    authorize: async () => {
      counts.auth++;
      return access();
    },
    createDb: () => {
      counts.db++;
      return { from() {}, storage: {} };
    },
    prepare: async () => {
      counts.prepare++;
      return prepared();
    },
  };

  return {
    counts,
    post: createHandler({
      ...defaults,
      ...overrides,
    }),
  };
}

async function execute(
  options = {},
  overrides = {},
) {
  const instance = setup(overrides);
  const response = await instance.post(
    makeRequest(
      options.body ?? requestBody(),
      options,
    ),
  );

  return {
    response,
    payload: await response.json(),
    counts: instance.counts,
  };
}

test("01 - prepara sem aprovar", async () => {
  const result = await execute();

  assert.equal(result.response.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(
    result.payload.status,
    "prepared_unverified",
  );
  assert.equal(
    result.payload.reviewFingerprint,
    FINGERPRINT,
  );
});

test("02 - nao divulga caminho privado", async () => {
  const result = await execute();
  const serialized = JSON.stringify(result.payload);

  assert.equal(serialized.includes("storagePath"), false);
  assert.equal(serialized.includes("actorUserId"), false);
  assert.equal(serialized.includes("service_role"), false);
  assert.equal(
    Object.hasOwn(result.payload, "verified"),
    false,
  );
});

test("03 - zero registrado permanece zero", async () => {
  const result = await execute();

  assert.equal(result.payload.review.amountBrlCents, 0);
  assert.equal(result.payload.review.amountUsd, null);
});

test("04 - usuario nao autenticado bloqueado", async () => {
  const result = await execute({}, {
    authorize: async () => ({ ok: false }),
  });

  assert.equal(result.response.status, 401);
  assert.equal(result.counts.db, 0);
  assert.equal(result.counts.prepare, 0);
});

test("05 - admin sem autoridade financeira", async () => {
  const result = await execute({}, {
    authorize: async () => access("admin"),
  });

  assert.equal(result.response.status, 403);
  assert.equal(result.counts.db, 0);
});

test("06 - super_admin tambem bloqueado", async () => {
  const result = await execute({}, {
    authorize: async () => access("super_admin"),
  });

  assert.equal(result.response.status, 403);
  assert.equal(result.counts.db, 0);
});

test("07 - sessao divergente bloqueada", async () => {
  const altered = access();
  altered.resolution.sessionUserId = OTHER;

  const result = await execute({}, {
    authorize: async () => altered,
  });

  assert.equal(result.response.status, 403);
});

test("08 - origin ausente e rejeitado", async () => {
  const result = await execute({
    headers: { origin: null },
  });

  assert.equal(result.response.status, 403);
  assert.equal(result.counts.db, 0);
});

test("09 - origin de outro dominio e rejeitado", async () => {
  const result = await execute({
    headers: {
      origin: "https://outra-origem.example",
    },
  });

  assert.equal(result.response.status, 403);
});

test("10 - sec-fetch-site cross-site rejeitado", async () => {
  const result = await execute({
    headers: {
      "sec-fetch-site": "cross-site",
    },
  });

  assert.equal(result.response.status, 403);
});

test("11 - Content-Type invalido bloqueado", async () => {
  const result = await execute({
    headers: {
      "content-type": "text/plain",
    },
  });

  assert.equal(result.response.status, 415);
});

test("12 - JSON malformado bloqueado", async () => {
  const result = await execute({
    raw: "{invalid",
  });

  assert.equal(result.response.status, 400);
  assert.equal(result.counts.db, 0);
});

test("13 - Content-Length acima do limite", async () => {
  const result = await execute({
    headers: {
      "content-length": "5000",
    },
  });

  assert.equal(result.response.status, 413);
  assert.equal(result.counts.db, 0);
});

test("14 - corpo grande sem Content-Length", async () => {
  const result = await execute({
    raw: "X".repeat(5000),
  });

  assert.equal(result.response.status, 413);
  assert.equal(result.counts.db, 0);
});

test("15 - Content-Length malformado", async () => {
  const result = await execute({
    headers: {
      "content-length": "NaN",
    },
  });

  assert.equal(result.response.status, 400);
});

test("16 - identidade injetada no body", async () => {
  const result = await execute({
    body: requestBody({
      actorUserId: OTHER,
    }),
  });

  assert.equal(result.response.status, 400);
  assert.equal(result.counts.db, 0);
});

test("17 - flag verified injetada bloqueada", async () => {
  const body = requestBody();
  body.proofDraft.verified = true;

  const result = await execute({ body });

  assert.equal(result.response.status, 400);
});

test("18 - uploadId invalido bloqueado", async () => {
  const result = await execute({
    body: requestBody({ uploadId: -1 }),
  });

  assert.equal(result.response.status, 400);
});

test("19 - proofDraft ausente bloqueado", async () => {
  const body = requestBody();
  delete body.proofDraft;

  const result = await execute({ body });

  assert.equal(result.response.status, 400);
});

test("20 - vinculo invalido nao prepara", async () => {
  const result = await execute({}, {
    prepare: async () => ({
      ok: false,
      reason: "BINDING_REJECTED",
    }),
  });

  assert.equal(result.response.status, 409);
  assert.equal(result.payload.ok, false);
});

test("21 - Storage divergente nao prepara", async () => {
  const result = await execute({}, {
    prepare: async () => ({
      ok: false,
      reason: "INTEGRITY_REJECTED",
    }),
  });

  assert.equal(result.response.status, 409);
});

test("22 - contexto invalido nao prepara", async () => {
  const result = await execute({}, {
    prepare: async () => ({
      ok: false,
      reason: "CONTEXT_REJECTED",
    }),
  });

  assert.equal(result.response.status, 409);
});

test("23 - indisponibilidade falha fechada", async () => {
  const result = await execute({}, {
    prepare: async () => ({
      ok: false,
      reason: "PREPARATION_UNAVAILABLE",
    }),
  });

  assert.equal(result.response.status, 503);
});

test("24 - excecao de autenticacao falha fechada", async () => {
  const result = await execute({}, {
    authorize: async () => {
      throw new Error("AUTH_FAILED");
    },
  });

  assert.equal(result.response.status, 503);
  assert.equal(result.counts.db, 0);
});

test("25 - excecao na criacao do client", async () => {
  const result = await execute({}, {
    createDb: () => {
      throw new Error("DB_FAILED");
    },
  });

  assert.equal(result.response.status, 503);
});

test("26 - excecao de preparacao falha fechada", async () => {
  const result = await execute({}, {
    prepare: async () => {
      throw new Error("PREPARE_FAILED");
    },
  });

  assert.equal(result.response.status, 503);
});

test("27 - resposta nao pode ser armazenada", async () => {
  const result = await execute();

  assert.equal(
    result.response.headers.get("cache-control"),
    "no-store",
  );
});

test("28 - bloqueio posterior de acesso", async () => {
  const result = await execute({}, {
    prepare: async () => ({
      ok: false,
      reason: "ACCESS_DENIED",
    }),
  });

  assert.equal(result.response.status, 403);
});