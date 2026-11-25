const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadModule(source) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    reportDiagnostics: true,
  });

  const errors = (compiled.diagnostics || [])
    .filter(d => d.category === ts.DiagnosticCategory.Error);

  assert.equal(errors.length, 0);

  const m = { exports: {} };

  new Function(
    "require", "module", "exports",
    compiled.outputText
  )(require, m, m.exports);

  return m.exports;
}

function run(source) {
  const {
    validateHumanQuoteSendPdf: validate,
    HumanQuoteSendPdfError,
  } = loadModule(source);

  const id = n =>
    "10000000-0000-4000-8000-" +
    String(n).padStart(12, "0");

  const organizationId = id(1);
  const storeId = id(2);
  const quoteId = id(3);
  const quoteVersionId = id(4);
  const storeFileId = id(5);

  const prefix = [
    organizationId,
    storeId,
    "sales-quotes",
    quoteId,
    "",
  ].join("/");

  function fixture() {
    const storagePath = prefix + "20261125-v0001-abc123.pdf";

    const common = {
      organization_id: organizationId,
      store_id: storeId,
      storage_bucket: "zion-store-files",
      storage_path: storagePath,
      original_filename: "orc-000062-v0001.pdf",
      mime_type: "application/pdf",
      size_bytes: 131072,
    };

    return {
      organizationId,
      storeId,
      quoteId,
      quoteVersionId,

      quote: {
        id: quoteId,
        organization_id: organizationId,
        store_id: storeId,
        current_version_id: quoteVersionId,
      },

      version: {
        ...common,
        id: quoteVersionId,
        quote_id: quoteId,
        store_file_id: storeFileId,
      },

      storeFile: {
        ...common,
        id: storeFileId,
        file_kind: "sales_quote_pdf",
      },
    };
  }

  let count = 0;

  function check(name, fn) {
    fn();
    count++;
    console.log("ok - " + name);
  }

  function denied(change, code) {
    const value = fixture();

    change(value);

    assert.throws(
      () => validate(value),
      error =>
        error instanceof HumanQuoteSendPdfError &&
        error.code === code
    );
  }

  check("canonical PDF identity", () => {
    const input = fixture();

    assert.deepEqual(validate(input), {
      organizationId,
      storeId,
      quoteId,
      quoteVersionId,
      storeFileId,
      storageBucket: "zion-store-files",
      storagePath: input.version.storage_path,
      originalFilename: input.version.original_filename,
      mimeType: "application/pdf",
      sizeBytes: 131072,
    });
  });

  check("human revision PDF remains eligible", () => {
    const input = fixture();

    input.version.storage_path =
      prefix + "human-revision-abc123.pdf";

    input.storeFile.storage_path =
      input.version.storage_path;

    assert.equal(
      validate(input).storagePath,
      input.version.storage_path
    );
  });

  check("lead and opportunity are not required for PDF identity", () => {
    const input = fixture();

    assert.equal("lead_id" in input.quote, false);
    assert.equal("conversation_id" in input.quote, false);
    assert.equal("commercial_opportunity_id" in input.quote, false);

    assert.equal(validate(input).quoteId, quoteId);
  });

  check("invalid authority scope is rejected", () => {
    for (const key of [
      "organizationId", "storeId",
      "quoteId", "quoteVersionId",
    ]) {
      denied(
        x => { x[key] = "invalid"; },
        "HUMAN_QUOTE_SEND_PDF_SCOPE_INVALID"
      );
    }
  });

  check("missing or foreign quote is rejected", () => {
    denied(
      x => { x.quote = null; },
      "HUMAN_QUOTE_SEND_PDF_QUOTE_SCOPE_MISMATCH"
    );

    for (const key of [
      "id", "organization_id", "store_id",
    ]) {
      denied(
        x => { x.quote[key] = id(9); },
        "HUMAN_QUOTE_SEND_PDF_QUOTE_SCOPE_MISMATCH"
      );
    }
  });

  check("missing current version is rejected", () => {
    denied(
      x => { x.quote.current_version_id = null; },
      "HUMAN_QUOTE_SEND_PDF_VERSION_STALE"
    );
  });

  check("stale requested version is rejected", () => {
    denied(
      x => { x.quote.current_version_id = id(9); },
      "HUMAN_QUOTE_SEND_PDF_VERSION_STALE"
    );
  });

  check("missing or different version is rejected", () => {
    denied(
      x => { x.version = null; },
      "HUMAN_QUOTE_SEND_PDF_VERSION_SCOPE_MISMATCH"
    );

    denied(
      x => { x.version.id = id(9); },
      "HUMAN_QUOTE_SEND_PDF_VERSION_SCOPE_MISMATCH"
    );
  });

  check("version belonging to another quote is rejected", () => {
    denied(
      x => { x.version.quote_id = id(9); },
      "HUMAN_QUOTE_SEND_PDF_VERSION_SCOPE_MISMATCH"
    );
  });

  check("foreign version tenant is rejected", () => {
    for (const key of ["organization_id", "store_id"]) {
      denied(
        x => { x.version[key] = id(9); },
        "HUMAN_QUOTE_SEND_PDF_VERSION_SCOPE_MISMATCH"
      );
    }
  });

  check("missing canonical store file is rejected", () => {
    denied(
      x => { x.version.store_file_id = null; },
      "HUMAN_QUOTE_SEND_PDF_FILE_SCOPE_MISMATCH"
    );

    denied(
      x => { x.storeFile = null; },
      "HUMAN_QUOTE_SEND_PDF_FILE_SCOPE_MISMATCH"
    );
  });

  check("foreign or mismatched store file is rejected", () => {
    for (const key of [
      "id", "organization_id", "store_id",
    ]) {
      denied(
        x => { x.storeFile[key] = id(9); },
        "HUMAN_QUOTE_SEND_PDF_FILE_SCOPE_MISMATCH"
      );
    }
  });

  check("another document kind cannot be used", () => {
    denied(
      x => { x.storeFile.file_kind = "sales_contract_pdf"; },
      "HUMAN_QUOTE_SEND_PDF_FILE_KIND_INVALID"
    );
  });

  check("noncanonical storage bucket is rejected", () => {
    for (const key of ["version", "storeFile"]) {
      denied(
        x => { x[key].storage_bucket = "other-bucket"; },
        "HUMAN_QUOTE_SEND_PDF_BUCKET_INVALID"
      );
    }
  });

  check("mismatched storage paths are rejected", () => {
    denied(
      x => { x.storeFile.storage_path = prefix + "other.pdf"; },
      "HUMAN_QUOTE_SEND_PDF_PATH_MISMATCH"
    );
  });

  check("foreign paths external URLs and traversal are rejected", () => {
    for (const value of [
      "https://example.com/file.pdf",
      id(9) + "/" + storeId + "/sales-quotes/" + quoteId + "/a.pdf",
      prefix + "../a.pdf",
      prefix + "%2e%2e.pdf",
      prefix + "nested/a.pdf",
      prefix + "a.pdf?token=secret",
      prefix + "a.exe",
      prefix + "..\\a.pdf",
    ]) {
      denied(
        x => {
          x.version.storage_path = value;
          x.storeFile.storage_path = value;
        },
        "HUMAN_QUOTE_SEND_PDF_PATH_INVALID"
      );
    }
  });

  check("unsafe or mismatched filename is rejected", () => {
    for (const value of [
      null, "", "../document.pdf",
      "document.pdf.exe", "document\n.pdf",
    ]) {
      denied(
        x => {
          x.version.original_filename = value;
          x.storeFile.original_filename = value;
        },
        "HUMAN_QUOTE_SEND_PDF_FILENAME_INVALID"
      );
    }

    denied(
      x => { x.storeFile.original_filename = "other.pdf"; },
      "HUMAN_QUOTE_SEND_PDF_FILENAME_INVALID"
    );
  });

  check("non PDF mime type is rejected", () => {
    for (const key of ["version", "storeFile"]) {
      denied(
        x => { x[key].mime_type = "image/png"; },
        "HUMAN_QUOTE_SEND_PDF_MIME_INVALID"
      );
    }
  });

  check("missing invalid or inconsistent file sizes are rejected", () => {
    for (const value of [
      null, 0, -1, 1.5, NaN,
      Infinity, "131072",
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      denied(
        x => {
          x.version.size_bytes = value;
          x.storeFile.size_bytes = value;
        },
        "HUMAN_QUOTE_SEND_PDF_SIZE_INVALID"
      );
    }

    denied(
      x => { x.storeFile.size_bytes = 999; },
      "HUMAN_QUOTE_SEND_PDF_SIZE_INVALID"
    );
  });

  check("validation does not mutate source records", () => {
    const input = fixture();
    const before = JSON.stringify(input);

    validate(input);

    assert.equal(JSON.stringify(input), before);
  });


  check("canonical generation operation PDF is accepted", () => {
    const input = fixture();

    input.version.storage_path =
      prefix + "operations/" + id(10) + ".pdf";

    input.storeFile.storage_path =
      input.version.storage_path;

    assert.equal(
      validate(input).storagePath,
      input.version.storage_path
    );
  });

  check("invalid operation identifiers are rejected", () => {
    for (const value of [
      "invalid",
      "00000000-0000-0000-0000-000000000000",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "10000000-0000-4000-8000-00000000000Z",
      "AAAAAAAA-0000-4000-8000-000000000001",
    ]) {
      denied(
        x => {
          x.version.storage_path =
            prefix + "operations/" + value + ".pdf";

          x.storeFile.storage_path =
            x.version.storage_path;
        },
        "HUMAN_QUOTE_SEND_PDF_PATH_INVALID"
      );
    }
  });

  check("operation path cannot escape the canonical directory", () => {
    for (const value of [
      "operations/../" + id(10) + ".pdf",
      "operations/nested/" + id(10) + ".pdf",
      "operations//" + id(10) + ".pdf",
      "operations/" + id(10) + ".pdf?token=x",
      "operations/" + id(10) + ".pdf\n",
      "operations/" + id(10) + ".exe",
      "operations\\" + id(10) + ".pdf",
      "operations/" + id(10) + ".PDF",
    ]) {
      denied(
        x => {
          x.version.storage_path = prefix + value;
          x.storeFile.storage_path =
            x.version.storage_path;
        },
        "HUMAN_QUOTE_SEND_PDF_PATH_INVALID"
      );
    }
  });

  check("operation PDF remains bound to the quote and tenant", () => {
    for (const foreignPrefix of [
      id(99) + "/" + storeId + "/sales-quotes/" + quoteId + "/",
      organizationId + "/" + id(99) + "/sales-quotes/" + quoteId + "/",
      organizationId + "/" + storeId + "/sales-quotes/" + id(99) + "/",
    ]) {
      denied(
        x => {
          x.version.storage_path =
            foreignPrefix + "operations/" + id(10) + ".pdf";

          x.storeFile.storage_path =
            x.version.storage_path;
        },
        "HUMAN_QUOTE_SEND_PDF_PATH_INVALID"
      );
    }

    denied(
      x => {
        x.version.storage_path =
          prefix + "operations/" + id(10) + ".pdf";

        x.storeFile.storage_path =
          prefix + "operations/" + id(11) + ".pdf";
      },
      "HUMAN_QUOTE_SEND_PDF_PATH_MISMATCH"
    );
  });

  assert.equal(count, 24);


  console.log("HUMAN_QUOTE_SEND_PDF: 24/24 PASS");
}

module.exports = run;

if (require.main === module) {
  run(fs.readFileSync(
    path.join(__dirname, "human-quote-send-pdf.ts"),
    "utf8"
  ));
}
