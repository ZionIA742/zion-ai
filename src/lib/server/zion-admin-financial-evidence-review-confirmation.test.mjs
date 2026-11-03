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

const validator = loadTs(
  "./zion-admin-financial-evidence-verification-draft.ts",
  (name) => {
    throw new Error(`UNEXPECTED_VALIDATOR_IMPORT: ${name}`);
  },
);

const review = loadTs(
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
      return validator;
    }

    throw new Error(`UNEXPECTED_REVIEW_IMPORT: ${name}`);
  },
);

const prepare = review.prepareFinancialEvidenceReview;
const confirm =
  review.assessFinancialEvidenceReviewConfirmation;

const ACTOR = "11111111-2222-4333-8444-555555555555";
const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const HASH = "a".repeat(64);

function path(
  month = "2026-10-01",
  revision = 1,
  source = "fixed_costs",
  hash = HASH,
  uuid = ACTOR,
) {
  return [
    "unverified",
    month,
    String(revision),
    source,
    `${uuid}-${hash}.pdf`,
  ].join("/");
}

function context(overrides = {}) {
  return {
    actorUserId: ACTOR,
    month: "2026-10-01",
    preclosureRevision: 1,
    uploadId: 7,
    source: "fixed_costs",
    proofType: "supplier_invoice",
    amountBrlCents: 0,
    amountUsd: null,
    documentSha256: HASH,
    sizeBytes: 52,
    storagePath: path(),
    ...overrides,
  };
}

function fingerprint(input = context()) {
  const result = prepare(input);
  assert.equal(result.ok, true);
  return result.fingerprint;
}

test("01 - prepara fingerprint sem aprovar", () => {
  const result = prepare(context());

  assert.equal(result.ok, true);
  assert.equal(
    result.status,
    "awaiting_manual_confirmation",
  );
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(result, "verified"), false);
});

test("02 - mesma revisao produz mesmo fingerprint", () => {
  assert.equal(fingerprint(), fingerprint());
});

test("03 - valor financeiro zero e valido", () => {
  assert.equal(prepare(context()).ok, true);
});

const changes = [
  [
    "ator",
    () => context({ actorUserId: OTHER }),
  ],
  [
    "competencia",
    () => context({
      month: "2026-11-01",
      storagePath: path("2026-11-01"),
    }),
  ],
  [
    "revisao",
    () => context({
      preclosureRevision: 2,
      storagePath: path("2026-10-01", 2),
    }),
  ],
  [
    "upload",
    () => context({ uploadId: 8 }),
  ],
  [
    "fonte",
    () => context({
      source: "manual_expenses",
      proofType: "expense_receipt",
      storagePath: path(
        "2026-10-01",
        1,
        "manual_expenses",
      ),
    }),
  ],
  [
    "tipo",
    () => context({ proofType: "supplier_statement" }),
  ],
  [
    "valor BRL",
    () => context({ amountBrlCents: 100 }),
  ],
  [
    "valor USD",
    () => context({ amountUsd: "0.00" }),
  ],
  [
    "SHA256",
    () => context({
      documentSha256: "b".repeat(64),
      storagePath: path(
        "2026-10-01",
        1,
        "fixed_costs",
        "b".repeat(64),
      ),
    }),
  ],
  [
    "tamanho",
    () => context({ sizeBytes: 53 }),
  ],
  [
    "caminho privado",
    () => context({
      storagePath: path(
        "2026-10-01",
        1,
        "fixed_costs",
        HASH,
        OTHER,
      ),
    }),
  ],
];

for (const [name, makeChanged] of changes) {
  test(`fingerprint muda ao alterar ${name}`, () => {
    assert.notEqual(
      fingerprint(makeChanged()),
      fingerprint(),
    );
  });
}

test("15 - confirmacao especifica e vinculada", () => {
  const result = confirm(context(), {
    confirmed: true,
    reviewFingerprint: fingerprint(),
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.status,
    "confirmation_bound_unverified",
  );
  assert.equal(Object.hasOwn(result, "approved"), false);
});

test("16 - confirmacao falsa bloqueia", () => {
  assert.equal(
    confirm(context(), {
      confirmed: false,
      reviewFingerprint: fingerprint(),
    }).reason,
    "EXPLICIT_CONFIRMATION_REQUIRED",
  );
});

test("17 - confirmacao ausente bloqueia", () => {
  assert.equal(
    confirm(context(), null).reason,
    "EXPLICIT_CONFIRMATION_REQUIRED",
  );
});

test("18 - fingerprint diferente bloqueia", () => {
  assert.equal(
    confirm(context(), {
      confirmed: true,
      reviewFingerprint: "b".repeat(64),
    }).reason,
    "FINGERPRINT_MISMATCH",
  );
});

test("19 - campos adicionais bloqueiam", () => {
  assert.equal(
    confirm(context(), {
      confirmed: true,
      reviewFingerprint: fingerprint(),
      verified: true,
    }).reason,
    "EXPLICIT_CONFIRMATION_REQUIRED",
  );
});

test("20 - hash malformado bloqueia", () => {
  assert.equal(
    confirm(context(), {
      confirmed: true,
      reviewFingerprint: "invalid",
    }).reason,
    "FINGERPRINT_MISMATCH",
  );
});

test("21 - valor alterado invalida confirmacao", () => {
  assert.equal(
    confirm(context({ amountBrlCents: 100 }), {
      confirmed: true,
      reviewFingerprint: fingerprint(),
    }).reason,
    "FINGERPRINT_MISMATCH",
  );
});

test("22 - identidade injetada bloqueia", () => {
  assert.equal(
    confirm(context(), {
      confirmed: true,
      reviewFingerprint: fingerprint(),
      actorUserId: OTHER,
    }).reason,
    "EXPLICIT_CONFIRMATION_REQUIRED",
  );
});

const invalidContexts = [
  [
    "23 - ator invalido",
    () => context({ actorUserId: "invalid" }),
  ],
  [
    "24 - caminho nao canonico",
    () => context({ storagePath: "other/file.pdf" }),
  ],
  [
    "25 - tipo de prova invalido",
    () => context({ proofType: "unsupported" }),
  ],
  [
    "26 - dois valores desconhecidos",
    () => context({
      amountBrlCents: null,
      amountUsd: null,
    }),
  ],
  [
    "27 - campos extras",
    () => ({
      ...context(),
      verified: true,
    }),
  ],
  [
    "28 - revisao invalida",
    () => context({ preclosureRevision: 0 }),
  ],
  [
    "29 - arquivo maior que limite",
    () => context({ sizeBytes: 10485761 }),
  ],
];

for (const [name, makeInvalid] of invalidContexts) {
  test(name, () => {
    const result = prepare(makeInvalid());

    assert.equal(result.ok, false);
    assert.equal(result.reason, "INVALID_CONTEXT");
  });
}