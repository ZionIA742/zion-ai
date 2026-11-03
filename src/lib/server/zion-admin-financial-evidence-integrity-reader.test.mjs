import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";

const nativeRequire = createRequire(import.meta.url);
const ts = nativeRequire("typescript");

function load(file, resolve) {
  const compiled = ts.transpileModule(
    readFileSync(
      new URL(file, import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  );

  const context = {
    exports: {},
    Buffer,
    require: resolve,
  };

  runInNewContext(compiled.outputText, context);
  return context.exports;
}

const drafts = load(
  "./zion-admin-financial-evidence-verification-draft.ts",
  (name) => {
    throw new Error(`UNEXPECTED_DRAFT_IMPORT: ${name}`);
  },
);

const binding = load(
  "./zion-admin-financial-evidence-binding.ts",
  (name) => {
    if (
      name ===
      "./zion-admin-financial-evidence-verification-draft"
    ) {
      return drafts;
    }

    throw new Error(`UNEXPECTED_BINDING_IMPORT: ${name}`);
  },
);

const reader = load(
  "./zion-admin-financial-evidence-binding-reader.ts",
  (name) => {
    if (
      name ===
      "./zion-admin-financial-evidence-verification-draft"
    ) {
      return drafts;
    }

    if (
      name === "./zion-admin-financial-evidence-binding"
    ) {
      return binding;
    }

    throw new Error(`UNEXPECTED_READER_IMPORT: ${name}`);
  },
);

const integrity = load(
  "./zion-admin-financial-evidence-storage-integrity.ts",
  (name) => {
    if (name === "node:crypto") {
      return nativeRequire(name);
    }

    throw new Error(`UNEXPECTED_INTEGRITY_IMPORT: ${name}`);
  },
);

const integrated = load(
  "./zion-admin-financial-evidence-integrity-reader.ts",
  (name) => {
    if (
      name ===
      "./zion-admin-financial-evidence-binding-reader"
    ) {
      return reader;
    }

    if (
      name ===
      "./zion-admin-financial-evidence-storage-integrity"
    ) {
      return integrity;
    }

    throw new Error(`UNEXPECTED_INTEGRATION_IMPORT: ${name}`);
  },
);

const inspect =
  integrated.inspectRegisteredFinancialEvidence;

assert.equal(typeof inspect, "function");

const BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  "ascii",
);

const SHA = createHash("sha256")
  .update(BYTES)
  .digest("hex");

const UUID =
  "11111111-2222-4333-8444-555555555555";

const PATH =
  `unverified/2026-10-01/1/fixed_costs/` +
  `${UUID}-${SHA}.pdf`;

function upload() {
  return {
    id: 2,
    month: "2026-10-01",
    preclosure_revision: 1,
    source: "fixed_costs",
    storage_bucket: "zion-admin-financial-evidence",
    storage_path: PATH,
    document_sha256: SHA,
    mime_type: "application/pdf",
    size_bytes: BYTES.length,
    uploaded_by_user_id: UUID,
    uploaded_at: "2026-11-03T13:00:00.000Z",
  };
}

function proposal() {
  return {
    source: "fixed_costs",
    proofType: "supplier_invoice",
    amountBrlCents: 0,
    amountUsd: null,
  };
}

function setup(options = {}) {
  const calls = {
    queries: [],
    downloads: [],
    buckets: [],
  };

  const uploadTable =
    "zion_admin_financial_evidence_uploads";

  const periodTable =
    "zion_admin_monthly_preclosures";

  const db = {
    from(table) {
      return {
        select(columns) {
          return {
            eq(field, value) {
              calls.queries.push({
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
                      error: new Error("DB_ERROR"),
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

    storage: {
      from(bucket) {
        calls.buckets.push(bucket);

        return {
          async download(path) {
            calls.downloads.push(path);

            if (options.throwDownload) {
              throw new Error("SIMULATED_TRANSPORT_FAILURE");
            }

            if (options.storageMissing) {
              return {
                data: null,
                error: null,
              };
            }

            if (options.storageError) {
              return {
                data: null,
                error: new Error("STORAGE_ERROR"),
              };
            }

            const bytes = options.bytes ?? BYTES;

            return {
              data: {
                size:
                  options.reportedSize ?? bytes.length,
                async arrayBuffer() {
                  if (options.throwRead) {
                    throw new Error("SIMULATED_BYTE_READ");
                  }

                  return bytes.buffer.slice(
                    bytes.byteOffset,
                    bytes.byteOffset + bytes.byteLength,
                  );
                },
              },
              error: null,
            };
          },
        };
      },
    },
  };

  return { db, calls };
}

async function execute(options = {}, changes = {}) {
  const ctx = setup(options);

  const result = await inspect(
    {
      month: "2026-10-01",
      uploadId: 2,
      proofDraft: proposal(),
      ...changes,
    },
    ctx.db,
  );

  return { result, calls: ctx.calls };
}

test("01 - documento integro passa pelas duas verificacoes", async () => {
  const { result, calls } = await execute();

  assert.equal(result.ok, true);
  assert.equal(result.status, "integrity_confirmed_unverified");
  assert.equal(result.uploadId, 2);
  assert.equal(result.documentSha256, SHA);
  assert.equal(result.sizeBytes, BYTES.length);
  assert.equal(calls.queries.length, 2);
  assert.deepEqual(calls.downloads, [PATH]);
  assert.deepEqual(
    calls.buckets,
    ["zion-admin-financial-evidence"],
  );
});

test("02 - zero declarado nao se torna comprovado", async () => {
  const { result } = await execute();

  assert.equal(result.ok, true);
  assert.equal(result.candidate.amountBrlCents, 0);
  assert.equal(Object.hasOwn(result, "verified"), false);
  assert.equal(Object.hasOwn(result, "approved"), false);
  assert.equal(Object.hasOwn(result, "finalized"), false);
});

test("03 - bytes adulterados bloqueiam", async () => {
  const bytes = Buffer.from(BYTES);
  bytes[0] ^= 1;

  const { result } = await execute({ bytes });

  assert.equal(result.ok, false);
  assert.equal(result.phase, "storage");
  assert.equal(result.error, "SHA256_MISMATCH");
});

test("04 - tamanho diferente bloqueia", async () => {
  const { result } = await execute({
    bytes: Buffer.concat([BYTES, Buffer.from([0])]),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "SIZE_MISMATCH");
});

test("05 - Storage indisponivel bloqueia", async () => {
  const { result } = await execute({
    storageError: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "STORAGE_UNAVAILABLE");
});

test("06 - falha de transporte bloqueia", async () => {
  const { result } = await execute({
    throwDownload: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "STORAGE_UNAVAILABLE");
});

test("07 - objeto ausente bloqueia", async () => {
  const { result } = await execute({
    storageMissing: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "STORAGE_UNAVAILABLE");
});

test("08 - revisao obsoleta bloqueia antes do Storage", async () => {
  const { result, calls } = await execute({
    period: {
      month: "2026-10-01",
      revision: 2,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.phase, "binding");
  assert.equal(result.reason, "REVISION_MISMATCH");
  assert.equal(calls.downloads.length, 0);
});

test("09 - fonte divergente bloqueia antes do Storage", async () => {
  const record = upload();
  record.source = "meta_invoice";

  const { result, calls } = await execute({
    upload: record,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "SOURCE_MISMATCH");
  assert.equal(calls.downloads.length, 0);
});

test("10 - upload inexistente bloqueia", async () => {
  const { result, calls } = await execute({
    upload: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "UPLOAD_NOT_FOUND");
  assert.equal(calls.downloads.length, 0);
});

test("11 - entrada invalida nao consulta banco", async () => {
  const { result, calls } = await execute(
    {},
    { uploadId: 0 },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "INVALID_REQUEST");
  assert.equal(calls.queries.length, 0);
  assert.equal(calls.downloads.length, 0);
});

test("12 - hash divergente no registro bloqueia", async () => {
  const record = upload();
  record.document_sha256 = "b".repeat(64);

  const { result, calls } = await execute({
    upload: record,
  });

  assert.equal(result.ok, false);
  assert.equal(result.phase, "binding");
  assert.equal(result.reason, "INVALID_STORAGE_METADATA");
  assert.equal(calls.downloads.length, 0);
});