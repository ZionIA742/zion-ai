import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(relativePath, imports = {}) {
  const source = readFileSync(relativePath, "utf8");

  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const loadedModule = { exports: {} };

  vm.runInNewContext(code, {
    module: loadedModule,
    exports: loadedModule.exports,
    require(name) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(imports, name),
        `Unexpected import: ${name}`,
      );
      return imports[name];
    },
  });

  return loadedModule.exports;
}

const existing = load(
  "src/lib/server/zion-admin-meta-monthly-coverage.ts",
);

const { assessMetaCandidateMonthlyCoverage: assess } = load(
  "src/lib/server/zion-admin-meta-candidate-monthly-coverage-adapter.ts",
  {
    "./zion-admin-meta-monthly-coverage": existing,
  },
);

const month = "2026-10-01";

function account(id, type = "messaging_account") {
  return {
    financialAccountType: type,
    financialAccountId: id,
  };
}

function line(id, amount, kind = "amount_record") {
  return {
    ...account(id),
    recordKind: kind,
    amountBrlCents: amount,
  };
}

function input(accounts, lines) {
  return {
    month,
    census: { ok: true, accounts },
    lines,
  };
}

test("consolida dois documentos da mesma conta", () => {
  const result = assess(input(
    [account("A")],
    [line("A", 100), line("A", 200)],
  ));

  assert.equal(
    result.status,
    "candidate_complete_unverified",
  );
  assert.equal(result.candidateBrlCents, 300);
  assert.equal(result.expectedAccounts, 1);
  assert.equal(result.coveredAccounts, 1);
  assert.equal(result.registrationAuthorized, false);
  assert.equal(result.finalClosureAuthorized, false);
});

test("transforma nao aplicavel zero em null interno", () => {
  const result = assess(input(
    [account("A")],
    [line("A", 0, "not_applicable_record")],
  ));

  assert.equal(
    result.status,
    "candidate_complete_unverified",
  );
  assert.equal(result.candidateNotApplicable, true);
  assert.equal(result.candidateBrlCents, null);
  assert.equal(result.financialAuthority, "unverified");
});

test("bloqueia conta sem documento", () => {
  const result = assess(input(
    [account("A"), account("B")],
    [line("A", 100)],
  ));

  assert.equal(result.status, "unknown");
  assert.ok(
    result.blockers.includes("missing_billing_account"),
  );
});

test("bloqueia conta desconhecida", () => {
  const result = assess(input(
    [account("A")],
    [line("A", 100), line("B", 200)],
  ));

  assert.equal(result.status, "unknown");
  assert.ok(
    result.blockers.includes("unexpected_document_account"),
  );
});

test("bloqueia mistura de valor e nao aplicavel", () => {
  const result = assess(input(
    [account("A")],
    [
      line("A", 100),
      line("A", 0, "not_applicable_record"),
    ],
  ));

  assert.equal(result.status, "unknown");
  assert.ok(
    result.blockers.includes("mixed_account_record_kinds"),
  );
});

test("bloqueia colisao entre tipos de conta", () => {
  const result = assess(input(
    [
      account("123", "messaging_account"),
      account("123", "business_portfolio"),
    ],
    [line("123", 100)],
  ));

  assert.equal(result.status, "unknown");
  assert.ok(
    result.blockers.includes("ambiguous_account_identity"),
  );
});

test("bloqueia censo indisponivel", () => {
  const result = assess({
    month,
    census: { ok: false },
    lines: [line("A", 100)],
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.registrationAuthorized, false);
});

test("bloqueia soma acima do limite", () => {
  const result = assess(input(
    [account("A")],
    [line("A", 100000000000), line("A", 1)],
  ));

  assert.equal(result.status, "unknown");
  assert.ok(
    result.blockers.includes("account_amount_overflow"),
  );
});

test("nunca libera aprovacao ou fechamento", () => {
  const result = assess(input(
    [account("A")],
    [line("A", 500)],
  ));

  assert.equal(result.financialAuthority, "unverified");
  assert.equal(result.registrationAuthorized, false);
  assert.equal(result.finalClosureAuthorized, false);
});