import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  "src/lib/server/zion-admin-financial-evidence-review-confirm-handler.ts",
  "utf8",
);

const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const imports = {
  "./zion-admin-api-access": {
    resolveZionAdminApiAccess: async () => {
      throw new Error("No default auth in tests");
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
      throw new Error("No default DB in tests");
    },
  },
  "./zion-admin-financial-evidence-review-access": {
    assessFinancialEvidenceReviewAccess: (access) => ({
      ok: access.resolution.role === "owner",
    }),
  },
  "./zion-admin-financial-evidence-review-preparation": {
    buildFinancialEvidenceReviewPreparation: async () => {
      throw new Error("No default preparation in tests");
    },
  },
  "./zion-admin-financial-evidence-review-confirmation": {
    assessFinancialEvidenceReviewConfirmation: () => {
      throw new Error("No default confirmation in tests");
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
  Buffer,
  URL,
  Response,
});

const {
  createFinancialEvidenceReviewConfirmHandler,
} = mod.exports;

const fingerprint = "a".repeat(64);

const owner = {
  ok: true,
  sessionUserId: "11111111-1111-4111-8111-111111111111",
  resolution: { role: "owner" },
};

function payload() {
  return {
    month: "2026-11-01",
    uploadId: 42,
    proofDraft: {
      source: "meta_invoice",
      proofType: "supplier_statement",
      amountBrlCents: 0,
      amountUsd: null,
    },
    confirmation: {
      confirmed: true,
      reviewFingerprint: fingerprint,
    },
  };
}

function request(body = payload(), headers = {}) {
  return new Request(
    "https://zion.example/api/zion-admin/financial-evidence/review/confirm",
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
  const calls = { prepared: 0, confirmed: 0, db: 0 };

  const handler =
    createFinancialEvidenceReviewConfirmHandler({
      authorize: async () => options.access ?? owner,
      createDb: () => {
        calls.db++;
        return {};
      },
      prepare: async (_access, input) => {
        calls.prepared++;

        return options.prepared ?? {
          ok: true,
          context: {
            source: "meta_invoice",
            amountUsd: null,
            amountBrlCents:
              input.proofDraft.amountBrlCents,
            month: input.month,
            uploadId: input.uploadId,
          },
        };
      },
      confirm: (_context, input) => {
        calls.confirmed++;
        assert.equal(input.confirmed, true);

        return options.confirmed ?? {
          ok: true,
          fingerprint,
        };
      },
    });

  return { handler, calls };
}

test("autenticacao antecede leitura financeira", async () => {
  const { handler, calls } = harness({
    access: { ok: false, httpStatus: 401 },
  });

  assert.equal((await handler(request())).status, 401);
  assert.equal(calls.db, 0);
});

test("somente proprietario pode confirmar", async () => {
  const { handler, calls } = harness({
    access: {
      ok: true,
      resolution: { role: "admin" },
    },
  });

  assert.equal((await handler(request())).status, 403);
  assert.equal(calls.prepared, 0);
});

test("origem ausente ou divergente e rejeitada", async () => {
  const { handler } = harness();

  assert.equal(
    (await handler(request(payload(), { Origin: "" }))).status,
    403,
  );
  assert.equal(
    (await handler(request(payload(), {
      Origin: "https://evil.example",
    }))).status,
    403,
  );
});

test("campos arbitrarios nao sao aceitos", async () => {
  const { handler, calls } = harness();

  assert.equal(
    (await handler(request({
      ...payload(),
      storagePath: "arbitrary",
    }))).status,
    400,
  );

  assert.equal(calls.prepared, 0);
});

test("confirmacao continua sem autoridade financeira", async () => {
  const { handler, calls } = harness();

  const result = await handler(request());
  const body = await result.json();

  assert.equal(result.status, 200);
  assert.equal(
    body.status,
    "confirmation_bound_unverified",
  );
  assert.equal(body.financialAuthority, "unverified");
  assert.equal(body.finalClosureAuthorized, false);
  assert.equal(calls.prepared, 1);
  assert.equal(calls.confirmed, 1);
});

test("revisao antiga bloqueia confirmacao", async () => {
  const { handler, calls } = harness({
    prepared: {
      ok: false,
      reason: "BINDING_REJECTED",
    },
  });

  assert.equal((await handler(request())).status, 409);
  assert.equal(calls.confirmed, 0);
});

test("fingerprint divergente bloqueia", async () => {
  const { handler } = harness({
    confirmed: {
      ok: false,
      reason: "FINGERPRINT_MISMATCH",
    },
  });

  assert.equal((await handler(request())).status, 409);
});

test("nao existe chamada de escrita ou fechamento", () => {
  assert.doesNotMatch(
    source,
    /\.rpc\(|\.insert\(|\.update\(|\.delete\(/,
  );
});

test("rota publica apenas o handler de confirmacao", () => {
  const route = readFileSync(
    "src/app/api/zion-admin/financial-evidence/review/confirm/route.ts",
    "utf8",
  );

  assert.match(
    route,
    /createFinancialEvidenceReviewConfirmHandler/,
  );
  assert.match(route, /export const POST/);
});