import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const nativeRequire = createRequire(import.meta.url);
const ts = nativeRequire("typescript");

const source = readFileSync(
  new URL(
    "./zion-admin-financial-evidence-private-bytes.ts",
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
  Buffer,
  require(name) {
    if (name === "node:crypto") {
      return nativeRequire(name);
    }

    throw new Error(`UNEXPECTED_IMPORT: ${name}`);
  },
};

runInNewContext(compiled.outputText, context);

const read =
  context.exports.readVerifiedPrivateFinancialBytes;

const ID = "11111111-2222-4333-8444-555555555555";
const ORIGINAL = Buffer.from(
  "%PDF-financial-evidence-test",
  "utf8",
);

const HASH = createHash("sha256")
  .update(ORIGINAL)
  .digest("hex");

function path(
  extension = "pdf",
  hash = HASH,
) {
  return [
    "unverified",
    "2026-10-01",
    "1",
    "fixed_costs",
    `${ID}-${hash}.${extension}`,
  ].join("/");
}

function input(overrides = {}) {
  return {
    bucket: "zion-admin-financial-evidence",
    path: path(),
    expectedSha256: HASH,
    expectedSizeBytes: ORIGINAL.length,
    expectedMimeType: "application/pdf",
    ...overrides,
  };
}

function storage(options = {}) {
  const calls = {
    downloads: 0,
    reads: 0,
  };

  const reader = {
    from(bucket) {
      assert.equal(
        bucket,
        "zion-admin-financial-evidence",
      );

      return {
        async download(requestedPath) {
          calls.downloads++;

          assert.equal(
            typeof requestedPath,
            "string",
          );

          if (options.throwDownload) {
            throw new Error("STORAGE_FAILED");
          }

          if (options.error) {
            return {
              data: null,
              error: new Error("STORAGE_ERROR"),
            };
          }

          if (options.missing) {
            return { data: null, error: null };
          }

          const bytes =
            options.bytes ?? ORIGINAL;

          return {
            error: null,
            data: {
              size:
                options.declaredSize ??
                bytes.length,
              async arrayBuffer() {
                calls.reads++;

                return bytes.buffer.slice(
                  bytes.byteOffset,
                  bytes.byteOffset + bytes.byteLength,
                );
              },
            },
          };
        },
      };
    },
  };

  return { reader, calls };
}

async function execute(
  value = input(),
  options = {},
) {
  const holder = storage(options);
  const result = await read(value, holder.reader);

  return {
    result,
    calls: holder.calls,
  };
}

test("01 - PDF integro retorna os mesmos bytes", async () => {
  const { result, calls } = await execute();

  assert.equal(result.ok, true);
  assert.equal(
    result.status,
    "integrity_confirmed_unverified",
  );
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.sha256, HASH);
  assert.deepEqual(result.bytes, ORIGINAL);
  assert.equal(calls.downloads, 1);
  assert.equal(calls.reads, 1);
});

test("02 - PNG permitido", async () => {
  const value = input({
    path: path("png"),
    expectedMimeType: "image/png",
  });

  const { result } = await execute(value);

  assert.equal(result.ok, true);
  assert.equal(result.mimeType, "image/png");
});

test("03 - JPEG permitido", async () => {
  const value = input({
    path: path("jpg"),
    expectedMimeType: "image/jpeg",
  });

  const { result } = await execute(value);

  assert.equal(result.ok, true);
  assert.equal(result.mimeType, "image/jpeg");
});

test("04 - o retorno nao cria URL publica", async () => {
  const { result } = await execute();

  assert.equal(result.ok, true);
  assert.equal(
    Object.hasOwn(result, "signedUrl"),
    false,
  );
  assert.equal(
    Object.hasOwn(result, "storagePath"),
    false,
  );
});

test("05 - integridade nao significa aprovacao", async () => {
  const { result } = await execute();

  assert.equal(result.ok, true);
  assert.equal(
    Object.hasOwn(result, "approved"),
    false,
  );
  assert.equal(
    Object.hasOwn(result, "verified"),
    false,
  );
  assert.equal(
    Object.hasOwn(result, "evidenceId"),
    false,
  );
});

const invalidCases = [
  [
    "06 - bucket incorreto",
    input({ bucket: "another-bucket" }),
  ],
  [
    "07 - fonte invalida no caminho",
    input({
      path: path().replace(
        "/fixed_costs/",
        "/other_source/",
      ),
    }),
  ],
  [
    "08 - hash divergente no nome",
    input({
      expectedSha256: "b".repeat(64),
    }),
  ],
  [
    "09 - mime divergente da extensao",
    input({
      expectedMimeType: "image/png",
    }),
  ],
  [
    "10 - mime nao permitido",
    input({
      expectedMimeType: "text/html",
    }),
  ],
  [
    "11 - arquivo vazio",
    input({
      expectedSizeBytes: 0,
    }),
  ],
  [
    "12 - arquivo maior que limite",
    input({
      expectedSizeBytes: 10485761,
    }),
  ],
  [
    "13 - SHA256 malformado",
    input({
      expectedSha256: "invalid",
    }),
  ],
  [
    "14 - traversal bloqueado",
    input({
      path: "../" + path(),
    }),
  ],
  [
    "15 - revisao zero",
    input({
      path: path().replace(
        "/2026-10-01/1/",
        "/2026-10-01/0/",
      ),
    }),
  ],
  [
    "16 - revisao acima do inteiro SQL",
    input({
      path: path().replace(
        "/2026-10-01/1/",
        "/2026-10-01/2147483648/",
      ),
    }),
  ],
  [
    "17 - competencia fora do contrato",
    input({
      path: path().replace(
        "/2026-10-01/",
        "/2019-10-01/",
      ),
    }),
  ],
  [
    "18 - campos adicionais rejeitados",
    {
      ...input(),
      verified: true,
    },
  ],
  [
    "19 - campo obrigatorio ausente",
    (() => {
      const value = input();
      delete value.expectedMimeType;
      return value;
    })(),
  ],
  [
    "20 - SHA256 maiusculo rejeitado",
    input({
      expectedSha256: HASH.toUpperCase(),
    }),
  ],
  [
    "21 - caminho absoluto rejeitado",
    input({
      path: "/" + path(),
    }),
  ],
];

for (const [name, value] of invalidCases) {
  test(name, async () => {
    const { result, calls } = await execute(value);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "INVALID_INPUT");
    assert.equal(calls.downloads, 0);
  });
}

test("22 - erro do Storage falha fechado", async () => {
  const { result } = await execute(
    input(),
    { error: true },
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.reason,
    "STORAGE_UNAVAILABLE",
  );
});

test("23 - arquivo ausente falha fechado", async () => {
  const { result } = await execute(
    input(),
    { missing: true },
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.reason,
    "STORAGE_UNAVAILABLE",
  );
});

test("24 - excecao do Storage falha fechado", async () => {
  const { result } = await execute(
    input(),
    { throwDownload: true },
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.reason,
    "STORAGE_UNAVAILABLE",
  );
});

test("25 - tamanho informado incorreto nao le bytes", async () => {
  const { result, calls } = await execute(
    input(),
    { declaredSize: ORIGINAL.length + 1 },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "SIZE_MISMATCH");
  assert.equal(calls.reads, 0);
});

test("26 - tamanho real divergente bloqueia", async () => {
  const changed = Buffer.concat([
    ORIGINAL,
    Buffer.from("x"),
  ]);

  const { result } = await execute(
    input(),
    {
      bytes: changed,
      declaredSize: ORIGINAL.length,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "SIZE_MISMATCH");
});

test("27 - bytes adulterados bloqueiam por SHA256", async () => {
  const changed = Buffer.from(ORIGINAL);
  changed[0] = changed[0] ^ 1;

  const { result } = await execute(
    input(),
    { bytes: changed },
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.reason,
    "SHA256_MISMATCH",
  );
});