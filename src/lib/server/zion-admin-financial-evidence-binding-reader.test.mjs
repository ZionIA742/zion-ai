import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const nativeRequire = createRequire(import.meta.url);
const ts = nativeRequire("typescript");

function load(file, resolve) {
  const compiled = ts.transpileModule(
    readFileSync(new URL(file, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  );

  const context = {
    exports: {},
    require: resolve,
  };

  runInNewContext(compiled.outputText, context);
  return context.exports;
}

const draftModule = load(
  "./zion-admin-financial-evidence-verification-draft.ts",
  () => {
    throw new Error("UNEXPECTED_DRAFT_DEPENDENCY");
  },
);

const bindingModule = load(
  "./zion-admin-financial-evidence-binding.ts",
  (name) => {
    if (
      name ===
      "./zion-admin-financial-evidence-verification-draft"
    ) {
      return draftModule;
    }
    throw new Error(`UNEXPECTED_BINDING_IMPORT: ${name}`);
  },
);

const readerModule = load(
  "./zion-admin-financial-evidence-binding-reader.ts",
  (name) => {
    if (
      name ===
      "./zion-admin-financial-evidence-verification-draft"
    ) {
      return draftModule;
    }
    if (
      name === "./zion-admin-financial-evidence-binding"
    ) {
      return bindingModule;
    }
    throw new Error(`UNEXPECTED_READER_IMPORT: ${name}`);
  },
);

const read = readerModule.readFinancialEvidenceBinding;
assert.equal(typeof read, "function");

const UUID = "11111111-2222-4333-8444-555555555555";
const SHA = "a".repeat(64);

function upload() {
  return {
    id: 2,
    month: "2026-10-01",
    preclosure_revision: 1,
    source: "fixed_costs",
    storage_bucket: "zion-admin-financial-evidence",
    storage_path:
      `unverified/2026-10-01/1/fixed_costs/` +
      `${UUID}-${SHA}.pdf`,
    document_sha256: SHA,
    mime_type: "application/pdf",
    size_bytes: 651,
    uploaded_by_user_id: UUID,
    uploaded_at: "2026-11-03T13:00:00.000Z",
  };
}

function draft() {
  return {
    source: "fixed_costs",
    proofType: "supplier_invoice",
    amountBrlCents: 0,
    amountUsd: null,
  };
}

function mockDb(options = {}) {
  const calls = [];
  const uploadTable =
    "zion_admin_financial_evidence_uploads";
  const periodTable = "zion_admin_monthly_preclosures";

  const db = {
    from(table) {
      return {
        select(columns) {
          return {
            eq(field, value) {
              calls.push({
                table,
                columns,
                field,
                value,
              });

              return {
                async maybeSingle() {
                  if (options.throwTable === table) {
                    throw new Error("SIMULATED_READ_FAILURE");
                  }

                  if (options.errorTable === table) {
                    return {
                      data: null,
                      error: { message: "DB_ERROR" },
                    };
                  }

                  if (table === uploadTable) {
                    return {
                      data:
                        options.upload === undefined
                          ? upload()
                          : options.upload,
                      error: null,
                    };
                  }

                  if (table === periodTable) {
                    return {
                      data:
                        options.period === undefined
                          ? {
                              month: "2026-10-01",
                              revision: 1,
                            }
                          : options.period,
                      error: null,
                    };
                  }

                  throw new Error(
                    `UNEXPECTED_TABLE: ${table}`,
                  );
                },
              };
            },
          };
        },
      };
    },
  };

  return { db, calls };
}

async function execute(options = {}, overrides = {}) {
  const ctx = mockDb(options);

  const result = await read(
    {
      month: "2026-10-01",
      uploadId: 2,
      proofDraft: draft(),
      ...overrides,
    },
    ctx.db,
  );

  return { result, calls: ctx.calls };
}

test("01 - registro e revisao atuais produzem vinculo", async () => {
  const { result, calls } = await execute();

  assert.equal(result.ok, true);
  assert.equal(result.binding.status, "linked_unverified");
  assert.equal(result.binding.uploadId, 2);
  assert.equal(result.binding.documentSha256, SHA);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].field, "id");
  assert.equal(calls[0].value, 2);
  assert.equal(calls[1].field, "month");
  assert.equal(calls[1].value, "2026-10-01");
});

test("02 - zero declarado nao vira aprovacao", async () => {
  const { result } = await execute();

  assert.equal(result.ok, true);
  assert.equal(result.binding.candidate.amountBrlCents, 0);
  assert.equal(Object.hasOwn(result, "verified"), false);
  assert.equal(Object.hasOwn(result, "approved"), false);
});

const invalidRequests = [
  ["03 - ID zero", { uploadId: 0 }],
  ["04 - ID fracionario", { uploadId: 2.5 }],
  ["05 - ID como texto", { uploadId: "2" }],
  [
    "06 - ID numerico inseguro",
    { uploadId: Number.MAX_SAFE_INTEGER + 1 },
  ],
  ["07 - competencia invalida", { month: "2026-10-02" }],
  ["08 - proposta invalida", { proofDraft: null }],
];

for (const [name, overrides] of invalidRequests) {
  test(name, async () => {
    const { result, calls } = await execute(
      {},
      overrides,
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, "INVALID_REQUEST");
    assert.equal(calls.length, 0);
  });
}

test("09 - upload inexistente bloqueia", async () => {
  const { result, calls } = await execute({
    upload: null,
  });

  assert.equal(result.error, "UPLOAD_NOT_FOUND");
  assert.equal(calls.length, 1);
});

test("10 - erro da consulta de upload bloqueia", async () => {
  const { result } = await execute({
    errorTable: "zion_admin_financial_evidence_uploads",
  });

  assert.equal(result.error, "READ_UNAVAILABLE");
});

test("11 - excecao de consulta bloqueia", async () => {
  const { result } = await execute({
    throwTable: "zion_admin_financial_evidence_uploads",
  });

  assert.equal(result.error, "READ_UNAVAILABLE");
});

test("12 - pre-fechamento inexistente bloqueia", async () => {
  const { result } = await execute({
    period: null,
  });

  assert.equal(result.error, "PRECLOSURE_NOT_FOUND");
});

test("13 - erro de leitura do pre-fechamento bloqueia", async () => {
  const { result } = await execute({
    errorTable: "zion_admin_monthly_preclosures",
  });

  assert.equal(result.error, "READ_UNAVAILABLE");
});

test("14 - excecao do pre-fechamento bloqueia", async () => {
  const { result } = await execute({
    throwTable: "zion_admin_monthly_preclosures",
  });

  assert.equal(result.error, "READ_UNAVAILABLE");
});

test("15 - revisao antiga bloqueia o vinculo", async () => {
  const { result } = await execute({
    period: {
      month: "2026-10-01",
      revision: 2,
    },
  });

  assert.equal(result.error, "BINDING_REJECTED");
  assert.equal(result.reason, "REVISION_MISMATCH");
});

test("16 - competencia do upload divergente bloqueia", async () => {
  const row = upload();
  row.month = "2026-09-01";

  const { result } = await execute({ upload: row });

  assert.equal(result.error, "BINDING_REJECTED");
  assert.equal(result.reason, "MONTH_MISMATCH");
});

test("17 - fonte do upload divergente bloqueia", async () => {
  const row = upload();
  row.source = "meta_invoice";

  const { result } = await execute({ upload: row });

  assert.equal(result.error, "BINDING_REJECTED");
  assert.equal(result.reason, "SOURCE_MISMATCH");
});

test("18 - metadados adulterados bloqueiam", async () => {
  const row = upload();
  row.document_sha256 = "b".repeat(64);

  const { result } = await execute({ upload: row });

  assert.equal(result.error, "BINDING_REJECTED");
  assert.equal(result.reason, "INVALID_STORAGE_METADATA");
});