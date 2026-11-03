import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const nativeRequire = createRequire(import.meta.url);
const ts = nativeRequire("typescript");

const source = readFileSync(
  new URL(
    "./zion-admin-financial-evidence-review-access.ts",
    import.meta.url,
  ),
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
  require(name) {
    throw new Error(`UNEXPECTED_IMPORT: ${name}`);
  },
};

runInNewContext(compiled.outputText, context);

const assess =
  context.exports.assessFinancialEvidenceReviewAccess;

assert.equal(typeof assess, "function");

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function granted() {
  return {
    ok: true,
    sessionUserId: ID,
    resolution: {
      status: "zion_admin_allowed",
      sessionUserId: ID,
      role: "owner",
      capabilities: ["manage_accounts"],
    },
  };
}

test("01 - owner autenticado e elegivel", () => {
  const result = assess(granted());

  assert.equal(result.ok, true);
  assert.equal(
    result.status,
    "eligible_for_manual_review",
  );
  assert.equal(result.actorUserId, ID);
});

test("02 - nao autoriza comprovante automaticamente", () => {
  const result = assess(granted());

  assert.equal(Object.hasOwn(result, "approved"), false);
  assert.equal(Object.hasOwn(result, "verified"), false);
  assert.equal(Object.hasOwn(result, "evidenceId"), false);
});

test("03 - acesso negado permanece negado", () => {
  const result = assess({ ok: false });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "ACCESS_DENIED");
});

test("04 - acesso nulo falha fechado", () => {
  const result = assess(null);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "ACCESS_DENIED");
});

test("05 - admin nao possui autoridade financeira", () => {
  const access = granted();
  access.resolution.role = "admin";

  const result = assess(access);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "OWNER_REQUIRED");
});

test("06 - super_admin nao recebe excecao", () => {
  const access = granted();
  access.resolution.role = "super_admin";

  const result = assess(access);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "OWNER_REQUIRED");
});

test("07 - role ausente e rejeitada", () => {
  const access = granted();
  delete access.resolution.role;

  assert.equal(
    assess(access).reason,
    "OWNER_REQUIRED",
  );
});

test("08 - capacidade ausente bloqueia", () => {
  const access = granted();
  access.resolution.capabilities = [];

  assert.equal(
    assess(access).reason,
    "CAPABILITY_REQUIRED",
  );
});

test("09 - capacidade de WhatsApp nao substitui financeira", () => {
  const access = granted();
  access.resolution.capabilities = [
    "manage_whatsapp_pins",
  ];

  assert.equal(
    assess(access).reason,
    "CAPABILITY_REQUIRED",
  );
});

test("10 - capacidade nao estruturada bloqueia", () => {
  const access = granted();
  access.resolution.capabilities = "manage_accounts";

  assert.equal(
    assess(access).reason,
    "CAPABILITY_REQUIRED",
  );
});

test("11 - UUID divergente da resolucao bloqueia", () => {
  const access = granted();
  access.resolution.sessionUserId = OTHER_ID;

  assert.equal(
    assess(access).reason,
    "SESSION_IDENTITY_MISMATCH",
  );
});

test("12 - UUID de sessao invalido bloqueia", () => {
  const access = granted();
  access.sessionUserId = "not-an-actor-id";
  access.resolution.sessionUserId = "not-an-actor-id";

  assert.equal(
    assess(access).reason,
    "SESSION_IDENTITY_MISMATCH",
  );
});

test("13 - identidade da resolucao ausente bloqueia", () => {
  const access = granted();
  delete access.resolution.sessionUserId;

  assert.equal(
    assess(access).reason,
    "SESSION_IDENTITY_MISMATCH",
  );
});

test("14 - status administrativo incorreto bloqueia", () => {
  const access = granted();
  access.resolution.status = "anonymous";

  assert.equal(
    assess(access).reason,
    "ACCESS_DENIED",
  );
});

test("15 - actorUserId injetado nao altera identidade", () => {
  const access = granted();
  access.actorUserId = OTHER_ID;

  const result = assess(access);

  assert.equal(result.ok, true);
  assert.equal(result.actorUserId, ID);
});