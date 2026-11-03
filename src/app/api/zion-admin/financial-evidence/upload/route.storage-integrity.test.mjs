import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);

const original = readFileSync(
  new URL("./route.ts", import.meta.url),
  "utf8",
);

if (!original.includes("async function verifyStoredUpload(")) {
  throw new Error("VERIFIER_NOT_FOUND");
}

// Exportacao somente em memoria para testar a funcao real.
// Nao modifica route.ts.
const executable = original + "\nexport { verifyStoredUpload };\n";

const compiled = ts.transpileModule(executable, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const pdfBytes = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  "ascii",
);

const expectedHash = createHash("sha256")
  .update(pdfBytes)
  .digest("hex");

const expectedPath =
  "unverified/2026-10-01/1/fixed_costs/integrity-test.pdf";

function setup(options = {}) {
  const calls = {
    clients: 0,
    buckets: [],
    downloads: [],
  };

  const context = {
    exports: {},
    Buffer,
    Blob,
    Error,
    Request,
    Response,
    process: {
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://unit-test.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "SYNTHETIC_TEST_KEY",
      },
    },
    require(name) {
      if (name === "node:crypto") {
        return nativeRequire(name);
      }

      if (name === "@supabase/supabase-js") {
        return {
          createClient() {
            calls.clients++;

            return {
              storage: {
                from(bucket) {
                  calls.buckets.push(bucket);

                  return {
                    async download(path) {
                      calls.downloads.push(path);

                      if (options.transportError) {
                        throw new Error("SIMULATED_TRANSPORT_FAILURE");
                      }

                      if (options.storageError) {
                        return {
                          data: null,
                          error: new Error("NOT_FOUND"),
                        };
                      }

                      if (options.nullData) {
                        return {
                          data: null,
                          error: null,
                        };
                      }

                      if (options.readError) {
                        return {
                          data: {
                            async arrayBuffer() {
                              throw new Error("SIMULATED_READ_FAILURE");
                            },
                          },
                          error: null,
                        };
                      }

                      return {
                        data: new Blob([
                          options.bytes ?? pdfBytes,
                        ]),
                        error: null,
                      };
                    },
                  };
                },
              },
            };
          },
        };
      }

      if (name.endsWith("/zion-admin-api-access")) {
        return {
          resolveZionAdminApiAccess() {
            throw new Error("REAL_AUTH_FORBIDDEN");
          },
        };
      }

      if (name.endsWith("/zion-admin-api-response")) {
        return {
          createZionAdminApiDeniedResponse() {
            throw new Error("REAL_RESPONSE_FORBIDDEN");
          },
          createZionAdminApiJsonResponse() {
            throw new Error("REAL_RESPONSE_FORBIDDEN");
          },
        };
      }

      if (
        name.endsWith(
          "/zion-admin-financial-evidence-upload-validation"
        )
      ) {
        return {
          FINANCIAL_EVIDENCE_BUCKET:
            "zion-admin-financial-evidence",
          validateFinancialEvidenceUpload() {
            throw new Error("REAL_VALIDATION_FORBIDDEN");
          },
        };
      }

      if (
        name.endsWith(
          "/zion-admin-financial-evidence-upload-registration"
        )
      ) {
        return {
          FinancialEvidenceRegistrationError: Error,
          registerFinancialEvidenceUpload() {
            throw new Error("REAL_REGISTRATION_FORBIDDEN");
          },
        };
      }

      throw new Error(`UNEXPECTED_IMPORT: ${name}`);
    },
  };

  runInNewContext(compiled.outputText, context);

  assert.equal(
    typeof context.exports.verifyStoredUpload,
    "function",
  );

  return {
    verify: context.exports.verifyStoredUpload,
    calls,
  };
}

test("39 - conteudo identico confirma integridade", async () => {
  const ctx = setup();

  const result = await ctx.verify(
    expectedPath,
    expectedHash,
    pdfBytes.length,
  );

  assert.equal(result, true);
  assert.equal(ctx.calls.clients, 1);
  assert.equal(
    ctx.calls.buckets[0],
    "zion-admin-financial-evidence",
  );
  assert.equal(ctx.calls.downloads[0], expectedPath);
});

test("40 - conteudo diferente com mesmo tamanho rejeitado", async () => {
  const changed = Buffer.from(pdfBytes);
  changed[12] = changed[12] === 65 ? 66 : 65;

  const ctx = setup({ bytes: changed });

  const result = await ctx.verify(
    expectedPath,
    expectedHash,
    pdfBytes.length,
  );

  assert.equal(changed.length, pdfBytes.length);
  assert.equal(result, false);
});

test("41 - tamanho divergente rejeitado", async () => {
  const ctx = setup({
    bytes: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });

  const result = await ctx.verify(
    expectedPath,
    expectedHash,
    pdfBytes.length,
  );

  assert.equal(result, false);
});

test("42 - erro do Storage nao confirma arquivo", async () => {
  const ctx = setup({ storageError: true });

  const result = await ctx.verify(
    expectedPath,
    expectedHash,
    pdfBytes.length,
  );

  assert.equal(result, false);
});

test("43 - resposta sem dados nao confirma arquivo", async () => {
  const ctx = setup({ nullData: true });

  const result = await ctx.verify(
    expectedPath,
    expectedHash,
    pdfBytes.length,
  );

  assert.equal(result, false);
});

test("44 - falha de transporte nao produz confirmacao", async () => {
  const ctx = setup({ transportError: true });

  await assert.rejects(
    ctx.verify(expectedPath, expectedHash, pdfBytes.length),
    /SIMULATED_TRANSPORT_FAILURE/,
  );
});

test("45 - SHA256 esperado incorreto rejeitado", async () => {
  const ctx = setup();

  const result = await ctx.verify(
    expectedPath,
    "f".repeat(64),
    pdfBytes.length,
  );

  assert.equal(result, false);
});

test("46 - falha ao ler bytes nao confirma integridade", async () => {
  const ctx = setup({ readError: true });

  await assert.rejects(
    ctx.verify(expectedPath, expectedHash, pdfBytes.length),
    /SIMULATED_READ_FAILURE/,
  );
});