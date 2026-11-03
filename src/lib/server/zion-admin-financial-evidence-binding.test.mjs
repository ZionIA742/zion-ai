import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const nativeRequire = createRequire(import.meta.url);
const ts = nativeRequire("typescript");

function transpile(file, resolve) {
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
    require: resolve,
  };

  runInNewContext(compiled.outputText, context);

  return context.exports;
}

const drafts = transpile(
  "./zion-admin-financial-evidence-verification-draft.ts",
  () => {
    throw new Error("NO_DEPENDENCIES_EXPECTED");
  },
);

const binding = transpile(
  "./zion-admin-financial-evidence-binding.ts",
  (name) => {
    if (
      name ===
      "./zion-admin-financial-evidence-verification-draft"
    ) {
      return drafts;
    }

    throw new Error(`UNEXPECTED_DEPENDENCY: ${name}`);
  },
);

const assess =
  binding.assessFinancialEvidenceUploadBinding;

assert.equal(typeof assess, "function");

const SHA = "a".repeat(64);
const UUID =
  "11111111-2222-4333-8444-555555555555";

const PATH =
  `unverified/2026-10-01/1/fixed_costs/` +
  `${UUID}-${SHA}.pdf`;

function base() {
  return {
    month: "2026-10-01",
    currentPreclosureRevision: 1,
    proofDraft: {
      source: "fixed_costs",
      proofType: "supplier_invoice",
      amountBrlCents: 0,
      amountUsd: null,
    },
    uploadRecord: {
      id: 2,
      month: "2026-10-01",
      preclosure_revision: 1,
      source: "fixed_costs",
      storage_bucket: "zion-admin-financial-evidence",
      storage_path: PATH,
      document_sha256: SHA,
      mime_type: "application/pdf",
      size_bytes: 651,
      uploaded_by_user_id: UUID,
      uploaded_at: "2026-11-03T10:25:00.000Z",
    },
  };
}

function mutate(update) {
  const value = base();
  update(value);
  return value;
}

const accepts = [
  [
    "01 - PDF vinculado permanece nao verificado",
    base(),
  ],
  [
    "02 - zero declarado permanece zero",
    base(),
  ],
  [
    "03 - outro autor nao implica aprovacao",
    mutate((x) => {
      x.uploadRecord.uploaded_by_user_id =
        "00000000-0000-4000-8000-000000000001";
    }),
  ],
  [
    "04 - PNG com metadados coerentes",
    mutate((x) => {
      x.uploadRecord.storage_path =
        PATH.replace(/\.pdf$/, ".png");
      x.uploadRecord.mime_type = "image/png";
    }),
  ],
  [
    "05 - JPEG com metadados coerentes",
    mutate((x) => {
      x.uploadRecord.storage_path =
        PATH.replace(/\.pdf$/, ".jpg");
      x.uploadRecord.mime_type = "image/jpeg";
    }),
  ],
  [
    "06 - USD declarado na proposta",
    mutate((x) => {
      x.proofDraft.amountUsd = "1.23";
    }),
  ],
];

for (const [name, data] of accepts) {
  test(name, () => {
    const result = assess(data);

    assert.equal(result.ok, true);
    assert.equal(result.status, "linked_unverified");
    assert.equal(result.uploadId, 2);
    assert.equal(result.documentSha256, SHA);

    assert.equal(
      Object.hasOwn(result, "verified"),
      false,
    );
  });
}

const rejects = [
  [
    "07 - entrada nula",
    null,
    "INVALID_INPUT",
  ],
  [
    "08 - competencia invalida",
    mutate((x) => {
      x.month = "2026-10-02";
    }),
    "INVALID_MONTH",
  ],
  [
    "09 - revisao atual invalida",
    mutate((x) => {
      x.currentPreclosureRevision = 0;
    }),
    "INVALID_CURRENT_REVISION",
  ],
  [
    "10 - proposta nula",
    mutate((x) => {
      x.proofDraft = null;
    }),
    "INVALID_DRAFT",
  ],
  [
    "11 - proposta tenta enviar verified",
    mutate((x) => {
      x.proofDraft.verified = true;
    }),
    "INVALID_DRAFT",
  ],
  [
    "12 - upload ausente",
    mutate((x) => {
      x.uploadRecord = null;
    }),
    "INVALID_UPLOAD_RECORD",
  ],
  [
    "13 - ID de upload inseguro",
    mutate((x) => {
      x.uploadRecord.id =
        Number.MAX_SAFE_INTEGER + 1;
    }),
    "INVALID_UPLOAD_ID",
  ],
  [
    "14 - competencia cruzada",
    mutate((x) => {
      x.uploadRecord.month = "2026-09-01";
    }),
    "MONTH_MISMATCH",
  ],
  [
    "15 - revisao antiga",
    mutate((x) => {
      x.currentPreclosureRevision = 2;
    }),
    "REVISION_MISMATCH",
  ],
  [
    "16 - fonte divergente",
    mutate((x) => {
      x.uploadRecord.source = "meta_invoice";
    }),
    "SOURCE_MISMATCH",
  ],
  [
    "17 - bucket incorreto",
    mutate((x) => {
      x.uploadRecord.storage_bucket = "public";
    }),
    "INVALID_STORAGE_METADATA",
  ],
  [
    "18 - caminho fora do prefixo",
    mutate((x) => {
      x.uploadRecord.storage_path =
        "verified/" + PATH;
    }),
    "INVALID_STORAGE_METADATA",
  ],
  [
    "19 - SHA divergente no nome",
    mutate((x) => {
      x.uploadRecord.storage_path =
        PATH.replace(SHA, "b".repeat(64));
    }),
    "INVALID_STORAGE_METADATA",
  ],
  [
    "20 - MIME divergente",
    mutate((x) => {
      x.uploadRecord.mime_type = "image/png";
    }),
    "INVALID_STORAGE_METADATA",
  ],
  [
    "21 - tamanho acima do permitido",
    mutate((x) => {
      x.uploadRecord.size_bytes =
        10 * 1024 * 1024 + 1;
    }),
    "INVALID_STORAGE_METADATA",
  ],
  [
    "22 - SHA invalido",
    mutate((x) => {
      x.uploadRecord.document_sha256 = "xyz";
    }),
    "INVALID_STORAGE_METADATA",
  ],
  [
    "23 - UUID de autor invalido",
    mutate((x) => {
      x.uploadRecord.uploaded_by_user_id = "user";
    }),
    "INVALID_UPLOAD_PROVENANCE",
  ],
  [
    "24 - timestamp invalido",
    mutate((x) => {
      x.uploadRecord.uploaded_at = "not-a-time";
    }),
    "INVALID_UPLOAD_PROVENANCE",
  ],
  [
    "25 - valores da proposta ausentes",
    mutate((x) => {
      x.proofDraft.amountBrlCents = null;
      x.proofDraft.amountUsd = null;
    }),
    "INVALID_DRAFT",
  ],
  [
    "26 - arquivo de tamanho zero",
    mutate((x) => {
      x.uploadRecord.size_bytes = 0;
    }),
    "INVALID_STORAGE_METADATA",
  ],
];

for (const [name, data, reason] of rejects) {
  test(name, () => {
    const result = assess(data);

    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  });
}