import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";

const nativeRequire = createRequire(import.meta.url);
const ts = nativeRequire("typescript");

const source = readFileSync(
  new URL(
    "./zion-admin-financial-evidence-storage-integrity.ts",
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

const privateBytesSource = readFileSync(
  new URL(
    "./zion-admin-financial-evidence-private-bytes.ts",
    import.meta.url,
  ),
  "utf8",
);

const privateBytesCompiled = ts.transpileModule(
  privateBytesSource,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
);

const privateBytesModule = {
  exports: {},
  Buffer,
  require(name) {
    if (name === "node:crypto") {
      return nativeRequire(name);
    }

    throw new Error(`UNEXPECTED_PRIVATE_BYTES_IMPORT: ${name}`);
  },
};

runInNewContext(
  privateBytesCompiled.outputText,
  privateBytesModule,
);
const context = {
  exports: {},
  Buffer,
  require(name) {
    if (name === "node:crypto") {
      return nativeRequire(name);
    }
    if (
      name ===
      "./zion-admin-financial-evidence-private-bytes"
    ) {
      return privateBytesModule.exports;
    }

    throw new Error(`UNEXPECTED_IMPORT: ${name}`);
  },
};

runInNewContext(compiled.outputText, context);

const verify = context.exports.verifyPrivateFinancialEvidence;

assert.equal(typeof verify, "function");

const BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  "ascii",
);

const SHA = createHash("sha256")
  .update(BYTES)
  .digest("hex");

const UUID = "11111111-2222-4333-8444-555555555555";

const PATH =
  "unverified/2026-10-01/1/fixed_costs/" +
  `${UUID}-${SHA}.pdf`;

function input(changes = {}) {
  return {
    bucket: "zion-admin-financial-evidence",
    path: PATH,
    expectedSha256: SHA,
    expectedSizeBytes: BYTES.length,
    ...changes,
  };
}

function setup(options = {}) {
  const calls = {
    buckets: [],
    downloads: [],
    arrayBufferReads: 0,
  };

  const storage = {
    from(bucket) {
      calls.buckets.push(bucket);

      return {
        async download(path) {
          calls.downloads.push(path);

          if (options.throwDownload) {
            throw new Error("SIMULATED_TRANSPORT_ERROR");
          }

          if (options.storageError) {
            return {
              data: null,
              error: new Error("SIMULATED_STORAGE_ERROR"),
            };
          }

          if (options.noData) {
            return { data: null, error: null };
          }

          if (options.customBlob) {
            return {
              data: options.customBlob,
              error: null,
            };
          }

          const bytes = options.bytes ?? BYTES;

          return {
            data: {
              size: bytes.length,
              async arrayBuffer() {
                calls.arrayBufferReads++;

                if (options.throwRead) {
                  throw new Error("SIMULATED_READ_ERROR");
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
  };

  return { storage, calls };
}

test("01 - PDF integro", async () => {
  const ctx = setup();
  const result = await verify(input(), ctx.storage);

  assert.equal(result.ok, true);
  assert.equal(
    result.status,
    "integrity_confirmed_unverified",
  );
  assert.equal(result.sha256, SHA);
  assert.equal(result.sizeBytes, BYTES.length);
  assert.deepEqual(
    ctx.calls.buckets,
    ["zion-admin-financial-evidence"],
  );
  assert.deepEqual(ctx.calls.downloads, [PATH]);
  assert.equal(ctx.calls.arrayBufferReads, 1);
  assert.equal(Object.hasOwn(result, "verified"), false);
});

test("02 - PNG com caminho coerente", async () => {
  const ctx = setup();

  const result = await verify(
    input({ path: PATH.replace(/\.pdf$/, ".png") }),
    ctx.storage,
  );

  assert.equal(result.ok, true);
});

test("03 - JPEG com caminho coerente", async () => {
  const ctx = setup();

  const result = await verify(
    input({ path: PATH.replace(/\.pdf$/, ".jpg") }),
    ctx.storage,
  );

  assert.equal(result.ok, true);
});

test("04 - bytes adulterados com mesmo tamanho", async () => {
  const tampered = Buffer.from(BYTES);
  tampered[0] ^= 1;

  const ctx = setup({ bytes: tampered });
  const result = await verify(input(), ctx.storage);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "SHA256_MISMATCH");
});

test("05 - arquivo maior que o registrado", async () => {
  const ctx = setup({
    bytes: Buffer.concat([BYTES, Buffer.from([0])]),
  });

  const result = await verify(input(), ctx.storage);

  assert.equal(result.reason, "SIZE_MISMATCH");
  assert.equal(ctx.calls.arrayBufferReads, 0);
});

test("06 - metadado de tamanho divergente", async () => {
  let reads = 0;

  const ctx = setup({
    customBlob: {
      size: BYTES.length - 1,
      async arrayBuffer() {
        reads++;
        return BYTES.buffer;
      },
    },
  });

  const result = await verify(input(), ctx.storage);

  assert.equal(result.reason, "SIZE_MISMATCH");
  assert.equal(reads, 0);
});

test("07 - objeto inexistente", async () => {
  const result = await verify(
    input(),
    setup({ noData: true }).storage,
  );

  assert.equal(result.reason, "STORAGE_UNAVAILABLE");
});

test("08 - erro retornado pelo Storage", async () => {
  const result = await verify(
    input(),
    setup({ storageError: true }).storage,
  );

  assert.equal(result.reason, "STORAGE_UNAVAILABLE");
});

test("09 - erro de transporte", async () => {
  const result = await verify(
    input(),
    setup({ throwDownload: true }).storage,
  );

  assert.equal(result.reason, "STORAGE_UNAVAILABLE");
});

test("10 - falha ao ler bytes", async () => {
  const result = await verify(
    input(),
    setup({ throwRead: true }).storage,
  );

  assert.equal(result.reason, "STORAGE_UNAVAILABLE");
});

const invalidCases = [
  [
    "11 - bucket diferente",
    input({ bucket: "public" }),
  ],
  [
    "12 - caminho publico",
    input({ path: PATH.replace("unverified/", "public/") }),
  ],
  [
    "13 - hash divergente no caminho",
    input({ path: PATH.replace(SHA, "a".repeat(64)) }),
  ],
  [
    "14 - hash declarado invalido",
    input({ expectedSha256: "invalido" }),
  ],
  [
    "15 - tamanho zero",
    input({ expectedSizeBytes: 0 }),
  ],
  [
    "16 - tamanho acima de 10 MiB",
    input({ expectedSizeBytes: 10485761 }),
  ],
  [
    "17 - tamanho fracionario",
    input({ expectedSizeBytes: 1.5 }),
  ],
  [
    "18 - UUID invalido no caminho",
    input({ path: PATH.replace(UUID, "invalid-uuid") }),
  ],
  [
    "19 - extensao nao permitida",
    input({ path: PATH.replace(/\.pdf$/, ".webp") }),
  ],
];

for (const [name, invalidInput] of invalidCases) {
  test(name, async () => {
    const ctx = setup();
    const result = await verify(invalidInput, ctx.storage);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "INVALID_INPUT");
    assert.equal(ctx.calls.downloads.length, 0);
  });
}

test("20 - retorno de Storage malformado", async () => {
  const ctx = setup({
    customBlob: {
      arrayBuffer: async () => BYTES.buffer,
    },
  });

  const result = await verify(input(), ctx.storage);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "SIZE_MISMATCH");
});