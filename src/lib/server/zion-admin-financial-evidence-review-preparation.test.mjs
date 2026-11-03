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
    Buffer,
    require: resolver,
  };

  runInNewContext(compiled.outputText, context);
  return context.exports;
}

function noImports(name) {
  throw new Error(`UNEXPECTED_IMPORT: ${name}`);
}

const draftValidator = loadTs(
  "./zion-admin-financial-evidence-verification-draft.ts",
  noImports,
);

const reviewAccess = loadTs(
  "./zion-admin-financial-evidence-review-access.ts",
  noImports,
);

const confirmation = loadTs(
  "./zion-admin-financial-evidence-review-confirmation.ts",
  (name) => {
    if (name === "node:crypto") {
      return nativeRequire(name);
    }

    if (
      name.endsWith(
        "/zion-admin-financial-evidence-verification-draft",
      )
    ) {
      return draftValidator;
    }

    return noImports(name);
  },
);

const preparation = loadTs(
  "./zion-admin-financial-evidence-review-preparation.ts",
  (name) => {
    if (
      name.endsWith(
        "/zion-admin-financial-evidence-review-access",
      )
    ) {
      return reviewAccess;
    }

    if (
      name.endsWith(
        "/zion-admin-financial-evidence-review-confirmation",
      )
    ) {
      return confirmation;
    }

    if (
      name.endsWith(
        "/zion-admin-financial-evidence-binding-reader",
      )
    ) {
      return {
        readFinancialEvidenceBinding() {
          throw new Error("UNEXPECTED_REAL_DB_READ");
        },
      };
    }

    if (
      name.endsWith(
        "/zion-admin-financial-evidence-storage-integrity",
      )
    ) {
      return {
        verifyPrivateFinancialEvidence() {
          throw new Error("UNEXPECTED_REAL_STORAGE_READ");
        },
      };
    }

    return noImports(name);
  },
);

const build =
  preparation.buildFinancialEvidenceReviewPreparation;

const ACTOR = "11111111-2222-4333-8444-555555555555";
const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SHA = "a".repeat(64);

function path(revision = 1, month = "2026-10-01") {
  return [
    "unverified",
    month,
    String(revision),
    "fixed_costs",
    `${ACTOR}-${SHA}.pdf`,
  ].join("/");
}

function access(overrides = {}) {
  return {
    ok: true,
    sessionUserId: ACTOR,
    resolution: {
      status: "zion_admin_allowed",
      sessionUserId: ACTOR,
      role: "owner",
      capabilities: ["manage_accounts"],
    },
    ...overrides,
  };
}

function request(overrides = {}) {
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

function binding(overrides = {}) {
  return {
    uploadId: 7,
    source: "fixed_costs",
    storagePath: path(),
    documentSha256: SHA,
    sizeBytes: 52,
    candidate: {
      source: "fixed_costs",
      proofType: "supplier_invoice",
      amountBrlCents: 0,
      amountUsd: null,
    },
    ...overrides,
  };
}

function deps(overrides = {}) {
  return {
    readBinding: async () => ({
      ok: true,
      binding: binding(),
    }),
    verifyStorage: async () => ({
      ok: true,
      sha256: SHA,
      sizeBytes: 52,
    }),
    createFingerprint:
      confirmation.prepareFinancialEvidenceReview,
    ...overrides,
  };
}

const db = {
  from() {
    throw new Error("NO_REAL_DATABASE");
  },
  storage: {
    from() {
      throw new Error("NO_REAL_STORAGE");
    },
  },
};

async function run(
  accessValue = access(),
  requestValue = request(),
  dependencies = deps(),
) {
  return build(
    accessValue,
    requestValue,
    db,
    dependencies,
  );
}

test("01 - prepara revisao sem aprovar", async () => {
  const result = await run();

  assert.equal(result.ok, true);
  assert.equal(result.status, "prepared_unverified");
  assert.match(result.reviewFingerprint, /^[0-9a-f]{64}$/);
});

test("02 - contexto usa identidade autenticada", async () => {
  const result = await run();

  assert.equal(result.context.actorUserId, ACTOR);
  assert.equal(result.context.uploadId, 7);
  assert.equal(result.context.preclosureRevision, 1);
  assert.equal(result.context.documentSha256, SHA);
});

test("03 - nao devolve aprovacao", async () => {
  const result = await run();

  assert.equal(Object.hasOwn(result, "approved"), false);
  assert.equal(Object.hasOwn(result, "verified"), false);
  assert.equal(Object.hasOwn(result, "evidenceId"), false);
});

test("04 - acesso negado bloqueia antes das leituras", async () => {
  let called = false;

  const result = await run(
    { ok: false },
    request(),
    deps({
      readBinding: async () => {
        called = true;
        throw new Error("SHOULD_NOT_RUN");
      },
    }),
  );

  assert.equal(result.reason, "ACCESS_DENIED");
  assert.equal(called, false);
});

test("05 - admin bloqueado", async () => {
  const a = access();
  a.resolution.role = "admin";

  assert.equal(
    (await run(a)).reason,
    "ACCESS_DENIED",
  );
});

test("06 - super_admin bloqueado", async () => {
  const a = access();
  a.resolution.role = "super_admin";

  assert.equal(
    (await run(a)).reason,
    "ACCESS_DENIED",
  );
});

test("07 - capacidade ausente bloqueia", async () => {
  const a = access();
  a.resolution.capabilities = [];

  assert.equal(
    (await run(a)).reason,
    "ACCESS_DENIED",
  );
});

test("08 - identidade da sessao divergente bloqueia", async () => {
  const a = access();
  a.resolution.sessionUserId = OTHER;

  assert.equal(
    (await run(a)).reason,
    "ACCESS_DENIED",
  );
});

test("09 - entrada malformada bloqueia", async () => {
  assert.equal(
    (await run(access(), null)).reason,
    "BINDING_REJECTED",
  );
});

test("10 - campos de autoridade injetados bloqueiam", async () => {
  const result = await run(
    access(),
    request({ actorUserId: OTHER }),
  );

  assert.equal(result.reason, "BINDING_REJECTED");
});

test("11 - falha no binding bloqueia", async () => {
  let storageCalled = false;

  const result = await run(
    access(),
    request(),
    deps({
      readBinding: async () => ({
        ok: false,
        error: "BINDING_REJECTED",
      }),
      verifyStorage: async () => {
        storageCalled = true;
        throw new Error("SHOULD_NOT_RUN");
      },
    }),
  );

  assert.equal(result.reason, "BINDING_REJECTED");
  assert.equal(storageCalled, false);
});

test("12 - excecao no banco falha fechado", async () => {
  const result = await run(
    access(),
    request(),
    deps({
      readBinding: async () => {
        throw new Error("DB_UNAVAILABLE");
      },
    }),
  );

  assert.equal(result.reason, "PREPARATION_UNAVAILABLE");
});

test("13 - Storage indisponivel bloqueia", async () => {
  const result = await run(
    access(),
    request(),
    deps({
      verifyStorage: async () => ({
        ok: false,
        reason: "STORAGE_UNAVAILABLE",
      }),
    }),
  );

  assert.equal(result.reason, "INTEGRITY_REJECTED");
});

test("14 - excecao no Storage falha fechado", async () => {
  const result = await run(
    access(),
    request(),
    deps({
      verifyStorage: async () => {
        throw new Error("STORAGE_FAILED");
      },
    }),
  );

  assert.equal(result.reason, "PREPARATION_UNAVAILABLE");
});

test("15 - SHA divergente bloqueia", async () => {
  const result = await run(
    access(),
    request(),
    deps({
      verifyStorage: async () => ({
        ok: true,
        sha256: "b".repeat(64),
        sizeBytes: 52,
      }),
    }),
  );

  assert.equal(result.reason, "INTEGRITY_REJECTED");
});

test("16 - tamanho divergente bloqueia", async () => {
  const result = await run(
    access(),
    request(),
    deps({
      verifyStorage: async () => ({
        ok: true,
        sha256: SHA,
        sizeBytes: 53,
      }),
    }),
  );

  assert.equal(result.reason, "INTEGRITY_REJECTED");
});

test("17 - revisao nao canonica bloqueia", async () => {
  const result = await run(
    access(),
    request(),
    deps({
      readBinding: async () => ({
        ok: true,
        binding: binding({
          storagePath: path(0),
        }),
      }),
    }),
  );

  assert.equal(result.reason, "CONTEXT_REJECTED");
});

test("18 - competencia divergente bloqueia", async () => {
  const result = await run(
    access(),
    request(),
    deps({
      readBinding: async () => ({
        ok: true,
        binding: binding({
          storagePath: path(1, "2026-11-01"),
        }),
      }),
    }),
  );

  assert.equal(result.reason, "CONTEXT_REJECTED");
});

test("19 - fonte da proposta divergente bloqueia", async () => {
  const result = await run(
    access(),
    request(),
    deps({
      readBinding: async () => ({
        ok: true,
        binding: binding({
          candidate: {
            source: "manual_expenses",
            proofType: "expense_receipt",
            amountBrlCents: 0,
            amountUsd: null,
          },
        }),
      }),
    }),
  );

  assert.equal(result.reason, "CONTEXT_REJECTED");
});

test("20 - fingerprint invalido bloqueia", async () => {
  const result = await run(
    access(),
    request(),
    deps({
      createFingerprint: () => ({
        ok: false,
        reason: "INVALID_CONTEXT",
      }),
    }),
  );

  assert.equal(result.reason, "CONTEXT_REJECTED");
});

test("21 - valor zero permanece valido, nao aprovado", async () => {
  const result = await run();

  assert.equal(result.ok, true);
  assert.equal(result.context.amountBrlCents, 0);
  assert.equal(result.status, "prepared_unverified");
});

test("22 - valor diferente produz fingerprint diferente", async () => {
  const original = await run();

  const changed = await run(
    access(),
    request(),
    deps({
      readBinding: async () => ({
        ok: true,
        binding: binding({
          candidate: {
            source: "fixed_costs",
            proofType: "supplier_invoice",
            amountBrlCents: 100,
            amountUsd: null,
          },
        }),
      }),
    }),
  );

  assert.equal(original.ok, true);
  assert.equal(changed.ok, true);
  assert.notEqual(
    original.reviewFingerprint,
    changed.reviewFingerprint,
  );
});