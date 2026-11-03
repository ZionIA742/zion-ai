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
    Request,
    Buffer,
    URL,
    Uint8Array,
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
  "./zion-admin-financial-evidence-private-view-handler.ts",
  (name) => {
    if (name === "node:crypto") {
      return nativeRequire(name);
    }

    if (
      name ===
      "./zion-admin-financial-evidence-review-confirmation"
    ) {
      return {
        prepareFinancialEvidenceReview() {
          throw new Error("REAL_FINGERPRINT_FORBIDDEN");
        },
      };
    }
    if (name === "./zion-admin-api-access") {
      return {
        resolveZionAdminApiAccess() {
          throw new Error("REAL_AUTH_FORBIDDEN");
        },
      };
    }

    if (name === "./zion-admin-api-response") {
      return {
        createZionAdminApiDeniedResponse: () =>
          Response.json(
            { ok: false, error: "AUTH_DENIED" },
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
      "./zion-admin-financial-evidence-binding-reader"
    ) {
      return {
        readFinancialEvidenceBinding() {
          throw new Error("REAL_BINDING_FORBIDDEN");
        },
      };
    }

    if (
      name ===
      "./zion-admin-financial-evidence-private-bytes"
    ) {
      return {
        readVerifiedPrivateFinancialBytes() {
          throw new Error("REAL_STORAGE_FORBIDDEN");
        },
      };
    }

    throw new Error(`UNEXPECTED_IMPORT: ${name}`);
  },
);

const createHandler =
  handlerModule.createFinancialEvidencePrivateViewHandler;

const ACTOR =
  "11111111-2222-4333-8444-555555555555";

const OTHER =
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const SHA = "a".repeat(64);
const BYTES = Buffer.from(
  "%PDF-financial-preview",
  "utf8",
);

const ENDPOINT =
  "https://zionapi.com.br/api/zion-admin/" +
  "financial-evidence/review/document";

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

function body(overrides = {}) {
  return {
    month: "2026-10-01",
    uploadId: 7,
    reviewFingerprint: SHA,
    proofDraft: {
      source: "fixed_costs",
      proofType: "supplier_invoice",
      amountBrlCents: 0,
      amountUsd: null,
    },
    ...overrides,
  };
}

function binding(extension = "pdf") {
  return {
    uploadId: 7,
    source: "fixed_costs",
    storagePath:
      `unverified/2026-10-01/1/fixed_costs/` +
      `${ACTOR}-${SHA}.${extension}`,
    documentSha256: SHA,
    sizeBytes: BYTES.length,
    candidate: body().proofDraft,
  };
}

function verified(mimeType = "application/pdf") {
  return {
    ok: true,
    status: "integrity_confirmed_unverified",
    sha256: SHA,
    sizeBytes: BYTES.length,
    mimeType,
    bytes: BYTES,
  };
}

function makeRequest(
  value = body(),
  options = {},
) {
  const headers = new Headers({
    origin: "https://zionapi.com.br",
    "content-type": "application/json",
  });

  for (
    const [key, item]
    of Object.entries(options.headers ?? {})
  ) {
    if (item === null) {
      headers.delete(key);
    } else {
      headers.set(key, item);
    }
  }

  const raw = Object.hasOwn(options, "raw")
    ? options.raw
    : JSON.stringify(value);

  return new Request(ENDPOINT, {
    method: "POST",
    headers,
    body: raw,
  });
}

function setup(overrides = {}) {
  const calls = {
    auth: 0,
    db: 0,
    binding: 0,
    bytes: 0,
    lastReadInput: null,
    fingerprints: 0,
    lastFingerprintContext: null,
  };

  const dependencies = {
    authorize: async () => {
      calls.auth++;
      return access();
    },
    createDb: () => {
      calls.db++;

      return {
        from() {
          throw new Error("UNEXPECTED_DIRECT_QUERY");
        },
        storage: {},
      };
    },
    readBinding: async () => {
      calls.binding++;

      return {
        ok: true,
        binding: binding(),
      };
    },
    createFingerprint: (trustedContext) => {
      calls.fingerprints++;
      calls.lastFingerprintContext = trustedContext;

      return {
        ok: true,
        status: "awaiting_manual_confirmation",
        fingerprint: SHA,
      };
    },
    readBytes: async (input) => {
      calls.bytes++;
      calls.lastReadInput = input;
      return verified();
    },
    ...overrides,
  };

  return {
    calls,
    post: createHandler(dependencies),
  };
}

async function run(
  options = {},
  overrides = {},
) {
  const instance = setup(overrides);

  const response = await instance.post(
    makeRequest(
      options.body ?? body(),
      options,
    ),
  );

  return {
    response,
    calls: instance.calls,
  };
}

test("01 - PDF devolve bytes verificados", async () => {
  const { response } = await run();

  assert.equal(response.status, 200);
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    BYTES,
  );
});

test("02 - entrega somente uma leitura de bytes", async () => {
  const { calls } = await run();

  assert.equal(calls.binding, 1);
  assert.equal(calls.bytes, 1);
});

test("03 - origem do Storage vem do vinculo", async () => {
  const { calls } = await run();

  assert.equal(
    calls.lastReadInput.bucket,
    "zion-admin-financial-evidence",
  );
  assert.equal(
    calls.lastReadInput.expectedSha256,
    SHA,
  );
  assert.equal(
    calls.lastReadInput.expectedSizeBytes,
    BYTES.length,
  );
});

test("04 - resposta sem cache", async () => {
  const { response } = await run();

  assert.match(
    response.headers.get("cache-control"),
    /no-store/,
  );
  assert.equal(
    response.headers.get("pragma"),
    "no-cache",
  );
});

test("05 - resposta nao permite sniffing", async () => {
  const { response } = await run();

  assert.equal(
    response.headers.get("x-content-type-options"),
    "nosniff",
  );
  assert.equal(
    response.headers.get(
      "cross-origin-resource-policy",
    ),
    "same-origin",
  );
});

test("06 - PDF somente inline", async () => {
  const { response } = await run();

  assert.equal(
    response.headers.get("content-type"),
    "application/pdf",
  );
  assert.match(
    response.headers.get("content-disposition"),
    /^inline; filename="zion-comprovante-7\.pdf"$/,
  );
});

test("07 - SHA informado para vinculo visual", async () => {
  const { response } = await run();

  assert.equal(
    response.headers.get("x-zion-document-sha256"),
    SHA,
  );
  assert.equal(
    response.headers.get("x-zion-upload-id"),
    "7",
  );
});

test("08 - resposta nao entrega URL assinada", async () => {
  const { response } = await run();

  assert.equal(response.headers.get("location"), null);
  assert.equal(
    response.headers.get("x-storage-path"),
    null,
  );
});

test("09 - PNG usa MIME coerente", async () => {
  const { response } = await run({}, {
    readBinding: async () => ({
      ok: true,
      binding: binding("png"),
    }),
    readBytes: async () =>
      verified("image/png"),
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "image/png",
  );
});

test("10 - JPEG usa MIME coerente", async () => {
  const { response } = await run({}, {
    readBinding: async () => ({
      ok: true,
      binding: binding("jpg"),
    }),
    readBytes: async () =>
      verified("image/jpeg"),
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "image/jpeg",
  );
});

test("11 - nao autenticado bloqueado", async () => {
  const { response, calls } = await run({}, {
    authorize: async () => ({ ok: false }),
  });

  assert.equal(response.status, 401);
  assert.equal(calls.db, 0);
});

test("12 - admin bloqueado", async () => {
  const { response, calls } = await run({}, {
    authorize: async () => access("admin"),
  });

  assert.equal(response.status, 403);
  assert.equal(calls.db, 0);
});

test("13 - super_admin bloqueado", async () => {
  const { response } = await run({}, {
    authorize: async () => access("super_admin"),
  });

  assert.equal(response.status, 403);
});

test("14 - owner sem capacidade bloqueado", async () => {
  const a = access();
  a.resolution.capabilities = [];

  const { response } = await run({}, {
    authorize: async () => a,
  });

  assert.equal(response.status, 403);
});

test("15 - identidade divergente bloqueada", async () => {
  const a = access();
  a.resolution.sessionUserId = OTHER;

  const { response } = await run({}, {
    authorize: async () => a,
  });

  assert.equal(response.status, 403);
});

test("16 - Origin ausente bloqueado", async () => {
  const { response, calls } = await run({
    headers: { origin: null },
  });

  assert.equal(response.status, 403);
  assert.equal(calls.db, 0);
});

test("17 - Origin externo bloqueado", async () => {
  const { response } = await run({
    headers: {
      origin: "https://example.com",
    },
  });

  assert.equal(response.status, 403);
});

test("18 - fetch-site externo bloqueado", async () => {
  const { response } = await run({
    headers: {
      "sec-fetch-site": "cross-site",
    },
  });

  assert.equal(response.status, 403);
});

test("19 - Content-Type incorreto bloqueado", async () => {
  const { response } = await run({
    headers: {
      "content-type": "text/plain",
    },
  });

  assert.equal(response.status, 415);
});

test("20 - JSON malformado bloqueado", async () => {
  const { response } = await run({
    raw: "{invalid",
  });

  assert.equal(response.status, 400);
});

test("21 - Content-Length invalido bloqueado", async () => {
  const { response } = await run({
    headers: {
      "content-length": "invalid",
    },
  });

  assert.equal(response.status, 400);
});

test("22 - Content-Length grande bloqueado", async () => {
  const { response } = await run({
    headers: {
      "content-length": "9000",
    },
  });

  assert.equal(response.status, 413);
});

test("23 - corpo grande sem Content-Length", async () => {
  const { response } = await run({
    raw: "x".repeat(5000),
  });

  assert.equal(response.status, 413);
});

test("24 - identidade injetada bloqueada", async () => {
  const { response } = await run({
    body: body({ actorUserId: OTHER }),
  });

  assert.equal(response.status, 400);
});

test("25 - aprovacao injetada bloqueada", async () => {
  const value = body();

  value.proofDraft.verified = true;

  const { response } = await run({
    body: value,
  });

  assert.equal(response.status, 400);
});

test("26 - uploadId invalido bloqueado", async () => {
  const { response } = await run({
    body: body({ uploadId: 0 }),
  });

  assert.equal(response.status, 400);
});

test("27 - vinculo inexistente bloqueado", async () => {
  const { response, calls } = await run({}, {
    readBinding: async () => ({
      ok: false,
      error: "UPLOAD_NOT_FOUND",
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(calls.bytes, 0);
});

test("28 - arquivo acima de 4 MiB rejeitado", async () => {
  const big = binding();
  big.sizeBytes = 4 * 1024 * 1024 + 1;

  const { response, calls } = await run({}, {
    readBinding: async () => ({
      ok: true,
      binding: big,
    }),
  });

  assert.equal(response.status, 413);
  assert.equal(calls.bytes, 0);
});

test("29 - extensao invalida bloqueada", async () => {
  const bad = binding("svg");

  const { response, calls } = await run({}, {
    readBinding: async () => ({
      ok: true,
      binding: bad,
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(calls.bytes, 0);
});

test("30 - erro de integridade bloqueia", async () => {
  const { response } = await run({}, {
    readBytes: async () => ({
      ok: false,
      reason: "SHA256_MISMATCH",
    }),
  });

  assert.equal(response.status, 409);
});

test("31 - hash devolvido divergente bloqueia", async () => {
  const { response } = await run({}, {
    readBytes: async () => ({
      ...verified(),
      sha256: "b".repeat(64),
    }),
  });

  assert.equal(response.status, 409);
});

test("32 - tamanho devolvido divergente", async () => {
  const { response } = await run({}, {
    readBytes: async () => ({
      ...verified(),
      sizeBytes: BYTES.length + 1,
    }),
  });

  assert.equal(response.status, 409);
});

test("33 - MIME divergente bloqueia", async () => {
  const { response } = await run({}, {
    readBytes: async () =>
      verified("image/png"),
  });

  assert.equal(response.status, 409);
});

test("34 - bytes invalidos bloqueiam", async () => {
  const { response } = await run({}, {
    readBytes: async () => ({
      ...verified(),
      bytes: "not-a-buffer",
    }),
  });

  assert.equal(response.status, 409);
});

test("35 - autenticacao indisponivel falha fechada", async () => {
  const { response } = await run({}, {
    authorize: async () => {
      throw new Error("AUTH_UNAVAILABLE");
    },
  });

  assert.equal(response.status, 503);
});

test("36 - banco indisponivel falha fechado", async () => {
  const { response } = await run({}, {
    createDb: () => {
      throw new Error("DB_UNAVAILABLE");
    },
  });

  assert.equal(response.status, 503);
});

test("37 - excecao na leitura canonica", async () => {
  const { response } = await run({}, {
    readBinding: async () => {
      throw new Error("READ_UNAVAILABLE");
    },
  });

  assert.equal(response.status, 503);
});

test("38 - excecao no Storage falha fechada", async () => {
  const { response } = await run({}, {
    readBytes: async () => {
      throw new Error("STORAGE_UNAVAILABLE");
    },
  });

  assert.equal(response.status, 503);
});

test("39 - visualizacao nao registra aprovacao", async () => {
  const { response } = await run();

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("x-zion-approved"),
    null,
  );
  assert.equal(
    response.headers.get("x-zion-verified"),
    null,
  );
});


test("40 - resposta identifica a revisao preparada", async () => {
  const { response } = await run();

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("x-zion-review-fingerprint"),
    SHA,
  );
  assert.equal(
    response.headers.get("x-zion-preclosure-revision"),
    "1",
  );
});

test("41 - fingerprint malformado bloqueado", async () => {
  const { response, calls } = await run({
    body: body({ reviewFingerprint: "invalid" }),
  });

  assert.equal(response.status, 400);
  assert.equal(calls.db, 0);
  assert.equal(calls.bytes, 0);
});

test("42 - fingerprint diferente bloqueia antes do Storage", async () => {
  const { response, calls } = await run({
    body: body({ reviewFingerprint: "b".repeat(64) }),
  });

  assert.equal(response.status, 409);
  assert.equal(calls.fingerprints, 1);
  assert.equal(calls.bytes, 0);
});

test("43 - contexto usa ator autenticado", async () => {
  const { response, calls } = await run();

  assert.equal(response.status, 200);
  assert.equal(
    calls.lastFingerprintContext.actorUserId,
    ACTOR,
  );
  assert.equal(
    calls.lastFingerprintContext.preclosureRevision,
    1,
  );
});

test("44 - revisao alterada invalida a correspondencia", async () => {
  const changed = binding();
  changed.storagePath = changed.storagePath.replace(
    "/2026-10-01/1/",
    "/2026-10-01/2/",
  );

  const { response, calls } = await run({}, {
    readBinding: async () => ({
      ok: true,
      binding: changed,
    }),
    createFingerprint: (ctx) => ({
      ok: true,
      fingerprint:
        ctx.preclosureRevision === 1
          ? SHA
          : "b".repeat(64),
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(calls.bytes, 0);
});

test("45 - valor alterado invalida a correspondencia", async () => {
  const changed = binding();
  changed.candidate = {
    ...changed.candidate,
    amountBrlCents: 1500,
  };

  const { response, calls } = await run({}, {
    readBinding: async () => ({
      ok: true,
      binding: changed,
    }),
    createFingerprint: (ctx) => ({
      ok: true,
      fingerprint:
        ctx.amountBrlCents === 0
          ? SHA
          : "b".repeat(64),
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(calls.bytes, 0);
});

test("46 - contexto de documento vem do banco", async () => {
  const { response, calls } = await run();
  const trusted = calls.lastFingerprintContext;

  assert.equal(response.status, 200);
  assert.equal(trusted.uploadId, 7);
  assert.equal(trusted.source, "fixed_costs");
  assert.equal(trusted.proofType, "supplier_invoice");
  assert.equal(trusted.documentSha256, SHA);
  assert.equal(trusted.sizeBytes, BYTES.length);
  assert.equal(
    trusted.storagePath,
    binding().storagePath,
  );
});

test("47 - geracao de fingerprint rejeitada falha fechada", async () => {
  const { response, calls } = await run({}, {
    createFingerprint: () => ({
      ok: false,
      reason: "INVALID_CONTEXT",
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(calls.bytes, 0);
});

test("48 - erro ao montar contexto falha fechado", async () => {
  const { response, calls } = await run({}, {
    createFingerprint: () => {
      throw new Error("CONTEXT_UNAVAILABLE");
    },
  });

  assert.equal(response.status, 503);
  assert.equal(calls.bytes, 0);
});
