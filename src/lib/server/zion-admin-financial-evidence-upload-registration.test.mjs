import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("./zion-admin-financial-evidence-upload-registration.ts", import.meta.url),
  "utf8",
);

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const sha = "a".repeat(64);
const actor = "11111111-2222-4333-8444-555555555555";

function input() {
  return {
    validated: {
      month: "2026-10-01",
      preclosureRevision: 1,
      source: "fixed_costs",
      sha256: sha,
      mimeType: "application/pdf",
      sizeBytes: 615,
    },
    storagePath:
      "unverified/2026-10-01/1/fixed_costs/" +
      `aaaaaaaa-2222-4333-8444-555555555555-${sha}.pdf`,
    sessionUserId: actor,
  };
}

function setup(options = {}) {
  const calls = {
    clients: [],
    rpc: [],
  };

  const response = options.response ?? {
    data: {
      ok: true,
      uploadId: 7,
      status: "uploaded_unverified",
      verified: false,
    },
    error: null,
  };

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "FAKE_KEY_FOR_UNIT_TEST_ONLY",
    ...options.env,
  };

  const context = {
    exports: {},
    Error,
    process: { env },
    require(name) {
      if (name !== "@supabase/supabase-js") {
        throw new Error(`UNEXPECTED_MODULE: ${name}`);
      }

      return {
        createClient(url, key, config) {
          calls.clients.push({ url, key, config });

          return {
            async rpc(rpcName, params) {
              calls.rpc.push({ rpcName, params });

              if (options.transportError) {
                throw new Error("SIMULATED_NETWORK_FAILURE");
              }

              return response;
            },
          };
        },
      };
    },
  };

  runInNewContext(compiled.outputText, context);

  return {
    service: context.exports,
    calls,
  };
}

async function expectError(ctx, expectedOutcome, expectedCode) {
  await assert.rejects(
    ctx.service.registerFinancialEvidenceUpload(input()),
    (error) => {
      assert.ok(
        error instanceof ctx.service.FinancialEvidenceRegistrationError,
      );
      assert.equal(error.outcome, expectedOutcome);
      assert.equal(error.reasonCode, expectedCode);
      return true;
    },
  );
}

function rpcError(message) {
  return {
    data: null,
    error: { message },
  };
}

test("01 - registro confirmado retorna ID", async () => {
  const ctx = setup();
  const result = await ctx.service.registerFinancialEvidenceUpload(input());

  assert.equal(result.uploadId, 7);
  assert.equal(result.status, "uploaded_unverified");
  assert.equal(result.verified, false);
});

test("02 - utiliza a RPC sistemica correta", async () => {
  const ctx = setup();

  await ctx.service.registerFinancialEvidenceUpload(input());

  assert.equal(ctx.calls.rpc.length, 1);
  assert.equal(
    ctx.calls.rpc[0].rpcName,
    "zion_admin_register_financial_evidence_upload_by_system",
  );
});

test("03 - parametros preservam os metadados reais", async () => {
  const ctx = setup();

  await ctx.service.registerFinancialEvidenceUpload(input());

  assert.deepEqual(
    JSON.parse(JSON.stringify(ctx.calls.rpc[0].params)),
    {
      p_month: "2026-10-01",
      p_preclosure_revision: 1,
      p_source: "fixed_costs",
      p_storage_path: input().storagePath,
      p_document_sha256: sha,
      p_mime_type: "application/pdf",
      p_size_bytes: 615,
      p_uploaded_by_user_id: actor,
    },
  );
});

test("04 - cliente sem sessao persistente", async () => {
  const ctx = setup();

  await ctx.service.registerFinancialEvidenceUpload(input());

  assert.equal(ctx.calls.clients.length, 1);
  assert.equal(ctx.calls.clients[0].config.auth.persistSession, false);
  assert.equal(ctx.calls.clients[0].config.auth.autoRefreshToken, false);
});

test("05 - resultado idempotente confirmado", async () => {
  const ctx = setup({
    response: {
      data: {
        ok: true,
        uploadId: 36,
        status: "uploaded_unverified",
        verified: false,
      },
      error: null,
    },
  });

  const result = await ctx.service.registerFinancialEvidenceUpload(input());
  assert.equal(result.uploadId, 36);
});

test("06 - revisao desatualizada rejeitada", async () => {
  const ctx = setup({
    response: rpcError("ZION_ADMIN_UPLOAD_STALE_REVISION"),
  });

  await expectError(
    ctx,
    "rejected",
    "ZION_ADMIN_UPLOAD_STALE_REVISION",
  );
});

test("07 - administrador proibido rejeitado", async () => {
  const ctx = setup({
    response: rpcError("ZION_ADMIN_UPLOAD_ACTOR_FORBIDDEN"),
  });

  await expectError(
    ctx,
    "rejected",
    "ZION_ADMIN_UPLOAD_ACTOR_FORBIDDEN",
  );
});

test("08 - objeto inexistente rejeitado", async () => {
  const ctx = setup({
    response: rpcError(
      "ZION_ADMIN_UPLOAD_STORAGE_OBJECT_NOT_FOUND",
    ),
  });

  await expectError(
    ctx,
    "rejected",
    "ZION_ADMIN_UPLOAD_STORAGE_OBJECT_NOT_FOUND",
  );
});

test("09 - conflito de caminho rejeitado", async () => {
  const ctx = setup({
    response: rpcError("ZION_ADMIN_UPLOAD_PATH_CONFLICT"),
  });

  await expectError(
    ctx,
    "rejected",
    "ZION_ADMIN_UPLOAD_PATH_CONFLICT",
  );
});

test("10 - erro desconhecido gera resultado incerto", async () => {
  const ctx = setup({
    response: rpcError("DATABASE_ERROR_UNKNOWN"),
  });

  await expectError(
    ctx,
    "uncertain",
    "FINANCIAL_REGISTRATION_OUTCOME_UNKNOWN",
  );
});

test("11 - falha de transporte gera resultado incerto", async () => {
  const ctx = setup({ transportError: true });

  await expectError(
    ctx,
    "uncertain",
    "FINANCIAL_REGISTRATION_OUTCOME_UNKNOWN",
  );
});

test("12 - resposta nula gera resultado incerto", async () => {
  const ctx = setup({
    response: { data: null, error: null },
  });

  await expectError(
    ctx,
    "uncertain",
    "FINANCIAL_REGISTRATION_INVALID_RESPONSE",
  );
});

test("13 - resposta nao pode aprovar documento", async () => {
  const ctx = setup({
    response: {
      data: {
        ok: true,
        uploadId: 7,
        status: "uploaded_unverified",
        verified: true,
      },
      error: null,
    },
  });

  await expectError(
    ctx,
    "uncertain",
    "FINANCIAL_REGISTRATION_INVALID_RESPONSE",
  );
});

test("14 - ID ausente gera resultado incerto", async () => {
  const ctx = setup({
    response: {
      data: {
        ok: true,
        status: "uploaded_unverified",
        verified: false,
      },
      error: null,
    },
  });

  await expectError(
    ctx,
    "uncertain",
    "FINANCIAL_REGISTRATION_INVALID_RESPONSE",
  );
});

test("15 - ID fracionario gera resultado incerto", async () => {
  const ctx = setup({
    response: {
      data: {
        ok: true,
        uploadId: 1.5,
        status: "uploaded_unverified",
        verified: false,
      },
      error: null,
    },
  });

  await expectError(
    ctx,
    "uncertain",
    "FINANCIAL_REGISTRATION_INVALID_RESPONSE",
  );
});

test("16 - ausencia de chave bloqueia chamada RPC", async () => {
  const ctx = setup({
    env: { SUPABASE_SERVICE_ROLE_KEY: "" },
  });

  await expectError(
    ctx,
    "uncertain",
    "FINANCIAL_REGISTRATION_CONFIGURATION_UNAVAILABLE",
  );

  assert.equal(ctx.calls.rpc.length, 0);
  assert.equal(ctx.calls.clients.length, 0);
});