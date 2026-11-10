import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";

const path =
  "src/lib/server/zion-admin-meta-document-batch-review-handler.ts";

const source = readFileSync(path, "utf8");

const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const fp = "a".repeat(64);

const imports = {
  "./zion-admin-api-access": {
    resolveZionAdminApiAccess: async () => {
      throw new Error("Default authentication forbidden");
    },
  },
  "./zion-admin-api-response": {
    createZionAdminApiDeniedResponse: (access) =>
      Response.json(
        { ok: false },
        { status: access.httpStatus },
      ),
  },
  "./zion-account-provisioning": {
    createServiceSupabaseClient: () => {
      throw new Error("Default DB forbidden");
    },
  },
  "./zion-admin-financial-evidence-review-access": {
    assessFinancialEvidenceReviewAccess: (access) => ({
      ok: access.resolution.role === "owner",
    }),
  },
  "./zion-admin-financial-evidence-review-preparation": {
    buildFinancialEvidenceReviewPreparation: async () => {
      throw new Error("Default preparation forbidden");
    },
  },
  "./zion-admin-meta-candidate-account-reader": {
    readMetaCandidateAccounts: async () => {
      throw new Error("Default candidate reader forbidden");
    },
  },
  "./zion-admin-financial-evidence-review-confirmation": {
    assessFinancialEvidenceReviewConfirmation: () => {
      throw new Error("Default confirmation forbidden");
    },
  },
};

const mod = { exports: {} };

vm.runInNewContext(js, {
  module: mod,
  exports: mod.exports,
  require: (name) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(imports, name),
      `Unexpected import: ${name}`,
    );
    return imports[name];
  },
  URL,
  Buffer,
  Response,
});

const { createMetaDocumentBatchReviewHandler } = mod.exports;

const owner = {
  ok: true,
  sessionUserId: "11111111-1111-4111-8111-111111111111",
  resolution: { role: "owner" },
};

function item(id, cents) {
  return {
    financialAccountType: "messaging_account",
    financialAccountId: `CONTA_${id}`,
    documentReference: `DOC_${id}`,
    recordKind: "amount_record",
    uploadId: id,
    proofDraft: {
      source: "meta_invoice",
      proofType: "supplier_statement",
      amountBrlCents: cents,
      amountUsd: null,
    },
    confirmation: {
      confirmed: true,
      reviewFingerprint: fp,
    },
  };
}

function request(
  body = {
    month: "2026-10-01",
    items: [item(1, 100), item(2, 200)],
  },
  headers = {},
) {
  return new Request(
    "https://zion.example/api/zion-admin/financial-evidence/review/meta-batch",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://zion.example",
        "Sec-Fetch-Site": "same-origin",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

function harness(options = {}) {
  const calls = {
    prepare: 0,
    confirm: 0,
    db: 0,
  };

  const handler =
    createMetaDocumentBatchReviewHandler({
      authorize: async () => options.access ?? owner,
      createDb: () => {
        calls.db++;
        return {};
      },
      prepare: async (_access, input) => {
        calls.prepare++;

        if (options.failPrepare) {
          return {
            ok: false,
            reason: "BINDING_REJECTED",
          };
        }

        return {
          ok: true,
          reviewFingerprint: fp,
          context: {
            month: input.month,
            uploadId: input.uploadId,
            preclosureRevision: 1,
            source: "meta_invoice",
            proofType: input.proofDraft.proofType,
            amountBrlCents:
              input.proofDraft.amountBrlCents,
            amountUsd: null,
            documentSha256: String(input.uploadId)
              .padStart(64, "0"),
          },
        };
      },
      readCandidateAccounts: async () =>
        options.candidateResult ?? {
          ok: true,
          status: "candidate_only",
          scope: "current_active_integrations",
          accounts: [
            {
              financialAccountType: "messaging_account",
              financialAccountId: "CONTA_1",
            },
            {
              financialAccountType: "messaging_account",
              financialAccountId: "CONTA_2",
            },
          ],
        },
      confirm: (_context, confirmation) => {
        calls.confirm++;

        if (
          options.failConfirm ||
          confirmation.reviewFingerprint !== fp
        ) {
          return {
            ok: false,
            reason: "FINGERPRINT_MISMATCH",
          };
        }

        return {
          ok: true,
          status: "confirmation_bound_unverified",
          fingerprint: fp,
        };
      },
    });

  return { handler, calls };
}

test("nega acesso antes de consultar dados", async () => {
  const { handler, calls } = harness({
    access: { ok: false, httpStatus: 401 },
  });

  assert.equal((await handler(request())).status, 401);
  assert.equal(calls.db, 0);
});

test("exige proprietario", async () => {
  const { handler, calls } = harness({
    access: {
      ok: true,
      resolution: { role: "admin" },
    },
  });

  assert.equal((await handler(request())).status, 403);
  assert.equal(calls.prepare, 0);
});

test("rejeita origem externa", async () => {
  const { handler } = harness();

  assert.equal(
    (await handler(request(undefined, {
      Origin: "https://evil.example",
    }))).status,
    403,
  );
});

test("confere dois documentos sem aprovar cobranca", async () => {
  const { handler, calls } = harness();

  const result = await handler(request());
  const body = await result.json();

  assert.equal(result.status, 200);
  assert.equal(body.candidateTotalBrlCents, 300);
  assert.equal(body.lines.length, 2);
  assert.equal(
    body.status,
    "administrative_confirmation_unverified",
  );
  assert.equal(body.accountAuthority, "unverified");
  assert.equal(body.financialAuthority, "unverified");
  assert.equal(body.registrationAuthorized, false);
  assert.equal(body.finalClosureAuthorized, false);
  assert.equal(calls.prepare, 2);
  assert.equal(calls.confirm, 2);
});

test("rejeita a mesma conta e documento duplicados", async () => {
  const { handler } = harness();

  const same = item(1, 100);
  const result = await handler(request({
    month: "2026-10-01",
    items: [same, { ...same, uploadId: 2 }],
  }));

  assert.equal(result.status, 409);
});

test("rejeita fingerprint divergente", async () => {
  const { handler } = harness({ failConfirm: true });
  assert.equal((await handler(request())).status, 409);
});

test("rejeita comprovante desatualizado", async () => {
  const { handler } = harness({ failPrepare: true });
  assert.equal((await handler(request())).status, 409);
});

test("nao executa escrita financeira", () => {
  assert.doesNotMatch(
    source,
    /\.rpc\(|\.insert\(|\.update\(|\.delete\(/,
  );
});

test("rota publica apenas a revisao conjunta", () => {
  const route = readFileSync(
    "src/app/api/zion-admin/financial-evidence/review/meta-batch/route.ts",
    "utf8",
  );

  assert.match(route, /createMetaDocumentBatchReviewHandler/);
  assert.match(route, /export const POST/);
});

test("cobertura candidata completa nao libera aprovacao", async () => {
  const { handler } = harness();
  const result = await handler(request());
  const body = await result.json();

  assert.equal(result.status, 200);
  assert.equal(
    body.accountCoverage.status,
    "candidate_covered_unverified",
  );
  assert.equal(body.accountCoverage.expectedAccounts, 2);
  assert.equal(body.accountCoverage.reviewedAccounts, 2);
  assert.equal(body.registrationAuthorized, false);
  assert.equal(body.finalClosureAuthorized, false);
});

test("conta candidata ausente impede cobertura completa", async () => {
  const { handler } = harness();
  const body = await (
    await handler(request({
      month: "2026-10-01",
      items: [item(1, 100)],
    }))
  ).json();

  assert.equal(body.accountCoverage.status, "unknown");
  assert.equal(body.accountCoverage.missingCandidateAccounts, 1);
  assert.equal(body.registrationAuthorized, false);
});

test("conta desconhecida nao vira autoridade", async () => {
  const { handler } = harness({
    candidateResult: {
      ok: true,
      scope: "current_active_integrations",
      status: "candidate_only",
      accounts: [{
        financialAccountType: "messaging_account",
        financialAccountId: "CONTA_1",
      }],
    },
  });

  const body = await (await handler(request())).json();

  assert.equal(body.accountCoverage.status, "unknown");
  assert.equal(body.accountCoverage.unmatchedCandidateAccounts, 1);
  assert.equal(body.financialAuthority, "unverified");
});

test("falha na leitura das contas nao autoriza cobertura", async () => {
  const { handler } = harness({
    candidateResult: {
      ok: false,
      reason: "CENSUS_UNAVAILABLE",
    },
  });

  const result = await handler(request());
  const body = await result.json();

  assert.equal(result.status, 200);
  assert.equal(body.accountCoverage.status, "unknown");
  assert.equal(body.accountCoverage.expectedAccounts, null);
  assert.equal(body.registrationAuthorized, false);
});