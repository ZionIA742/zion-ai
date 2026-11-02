import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("./zion-admin-financial-evidence-upload-validation.ts", import.meta.url),
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
  require: createRequire(import.meta.url),
  Buffer,
};

runInNewContext(compiled.outputText, context);

const {
  validateFinancialEvidenceUpload: validate,
  FINANCIAL_EVIDENCE_MAX_BYTES: MAX_BYTES,
  FINANCIAL_EVIDENCE_BUCKET: BUCKET,
} = context.exports;

function pdf() {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF",
    "ascii",
  );
}

function png() {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    .copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  return bytes;
}

function jpeg() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0,
    0x00, 0x10, 0x4a, 0x46,
    0x49, 0x46, 0xff, 0xd9,
  ]);
}

function input(changes = {}) {
  return {
    month: "2026-10-01",
    preclosureRevision: 1,
    source: "meta_invoice",
    filename: "fatura.pdf",
    mimeType: "application/pdf",
    bytes: pdf(),
    ...changes,
  };
}

function rejects(changes, code) {
  assert.throws(
    () => validate(input(changes)),
    { message: code },
  );
}

test("01 - bucket financeiro correto", () => {
  assert.equal(BUCKET, "zion-admin-financial-evidence");
});

test("02 - PDF com assinatura basica aceita", () => {
  const result = validate(input());

  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.extension, "pdf");
  assert.equal(result.month, "2026-10-01");
});

test("03 - PNG com assinatura basica aceita", () => {
  const result = validate(input({
    bytes: png(),
    filename: "comprovante.png",
    mimeType: "image/png",
  }));

  assert.equal(result.extension, "png");
});

test("04 - JPEG com assinatura basica aceita", () => {
  const result = validate(input({
    bytes: jpeg(),
    filename: "comprovante.jpg",
    mimeType: "image/jpeg",
  }));

  assert.equal(result.extension, "jpg");
});

test("05 - extensao JPEG alternativa aceita", () => {
  const result = validate(input({
    bytes: jpeg(),
    filename: "comprovante.jpeg",
    mimeType: "image/jpeg",
  }));

  assert.equal(result.extension, "jpg");
});

test("06 - SHA256 calculado pelos bytes reais", () => {
  const bytes = pdf();
  const result = validate(input({ bytes }));

  assert.equal(
    result.sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
});

test("07 - limite exato de 10 MB e aceito", () => {
  const bytes = Buffer.alloc(MAX_BYTES, 32);
  bytes.write("%PDF-", 0, "ascii");
  bytes.write("%%EOF", bytes.length - 5, "ascii");

  const result = validate(input({ bytes }));

  assert.equal(result.sizeBytes, MAX_BYTES);
});

test("08 - arquivo acima de 10 MB rejeitado", () => {
  rejects(
    { bytes: Buffer.alloc(MAX_BYTES + 1) },
    "FINANCIAL_EVIDENCE_INVALID_SIZE",
  );
});

test("09 - arquivo vazio rejeitado", () => {
  rejects(
    { bytes: Buffer.alloc(0) },
    "FINANCIAL_EVIDENCE_INVALID_SIZE",
  );
});

test("10 - entrada que nao e Buffer rejeitada", () => {
  rejects(
    { bytes: "arquivo-falso" },
    "FINANCIAL_EVIDENCE_INVALID_BYTES",
  );
});

test("11 - competencia invalida rejeitada", () => {
  rejects(
    { month: "2026-13-01" },
    "FINANCIAL_EVIDENCE_INVALID_MONTH",
  );
});

test("12 - revisao zero rejeitada", () => {
  rejects(
    { preclosureRevision: 0 },
    "FINANCIAL_EVIDENCE_INVALID_REVISION",
  );
});

test("13 - revisao fracionaria rejeitada", () => {
  rejects(
    { preclosureRevision: 1.5 },
    "FINANCIAL_EVIDENCE_INVALID_REVISION",
  );
});

test("14 - fonte financeira desconhecida rejeitada", () => {
  rejects(
    { source: "unknown_provider" },
    "FINANCIAL_EVIDENCE_INVALID_SOURCE",
  );
});

test("15 - nome com caminho rejeitado", () => {
  rejects(
    { filename: "../fatura.pdf" },
    "FINANCIAL_EVIDENCE_INVALID_FILENAME",
  );
});

test("16 - nome ausente rejeitado", () => {
  rejects(
    { filename: null },
    "FINANCIAL_EVIDENCE_INVALID_FILENAME",
  );
});

test("17 - MIME declarado incorreto rejeitado", () => {
  rejects(
    { mimeType: "image/png" },
    "FINANCIAL_EVIDENCE_MIME_MISMATCH",
  );
});

test("18 - extensao incompatível rejeitada", () => {
  rejects(
    { filename: "fatura.jpg" },
    "FINANCIAL_EVIDENCE_EXTENSION_MISMATCH",
  );
});

test("19 - PDF sem marcador EOF rejeitado", () => {
  rejects(
    { bytes: Buffer.from("%PDF-1.4\nconteudo incompleto") },
    "FINANCIAL_EVIDENCE_INVALID_SIGNATURE",
  );
});

test("20 - PNG sem IHDR rejeitado", () => {
  const bytes = png();
  bytes.write("FAKE", 12, "ascii");

  rejects(
    {
      bytes,
      filename: "comprovante.png",
      mimeType: "image/png",
    },
    "FINANCIAL_EVIDENCE_INVALID_SIGNATURE",
  );
});

test("21 - JPEG sem marcador final rejeitado", () => {
  const bytes = jpeg();
  bytes[bytes.length - 1] = 0;

  rejects(
    {
      bytes,
      filename: "comprovante.jpg",
      mimeType: "image/jpeg",
    },
    "FINANCIAL_EVIDENCE_INVALID_SIGNATURE",
  );
});