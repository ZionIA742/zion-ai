const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { createHash, randomUUID } = require("node:crypto");
const previousLoader = require.extensions[".ts"];
require.extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};
let store;
try {
  store = require("./human-quote-versioned-edit-pdf-storage.ts").storeHumanQuoteRevisionPdf;
} finally {
  if (previousLoader) require.extensions[".ts"] = previousLoader;
  else delete require.extensions[".ts"];
}
function fixture() {
  const org = randomUUID(), shop = randomUUID(), quoteId = randomUUID(), operation = randomUUID();
  const quote = { id: quoteId, organization_id: org, store_id: shop, current_version_id: operation, quote_number: "100" };
  const rpc = { p_organization_id: org, p_store_id: shop, p_quote_id: quoteId, p_operation_id: operation };
  const files = new Map(), rows = new Map(), uploads = [], downloads = [];
  const fault = { corruptUpload: false, failDownload: false, failInsert: false };
  const supabase = {
    from(table) {
      assert.equal(table, "store_files");
      const filters = {};
      let payload;
      const builder = {
        select() { return builder; },
        eq(k, v) { filters[k] = v; return builder; },
        insert(v) { payload = v; return builder; },
        async maybeSingle() {
          if (payload) {
            if (fault.failInsert) return { data: null, error: { message: "insert failure" } };
            if (rows.has(payload.storage_path)) return { data: null, error: { message: "duplicate" } };
            const row = { id: randomUUID(), ...payload };
            rows.set(payload.storage_path, row);
            return { data: row, error: null };
          }
          const row = [...rows.values()].find(r => Object.entries(filters).every(([k,v]) => r[k] === v));
          return { data: row || null, error: null };
        },
      };
      return builder;
    },
    storage: { from(bucket) {
      assert.equal(bucket, "zion-store-files");
      return {
        async upload(path, bytes, options) {
          uploads.push({ path, options });
          assert.equal(options.upsert, false);
          assert.equal(options.contentType, "application/pdf");
          if (files.has(path)) return { error: { message: "duplicate" } };
          files.set(path, fault.corruptUpload ? Buffer.from("corrupt") : Buffer.from(bytes));
          return { error: null };
        },
        async download(path) {
          downloads.push(path);
          if (fault.failDownload || !files.has(path)) return { data: null, error: { message: "missing" } };
          return { data: new Blob([files.get(path)]), error: null };
        },
      };
    } },
  };
  // Synthetic bytes only: the real renderer is exercised in the next microstep.
  const args = { supabase, prepared: { quote, rpc }, pdfBytes: Buffer.from("%PDF-1.7\nfixture\n%%EOF") };
  return { args, files, rows, uploads, downloads, fault };
}
test("stores exact bytes with scoped content-addressed path and readback", async () => {
  const f = fixture(), r = await store(f.args), { quote, rpc } = f.args.prepared;
  const sha = createHash("sha256").update(f.args.pdfBytes).digest("hex");
  assert.equal(r.storagePath, `${quote.organization_id}/${quote.store_id}/sales-quotes/${quote.id}/human-revision-${rpc.p_operation_id}-${sha}.pdf`);
  assert.equal(r.pdfSha256, sha);
  assert.deepEqual(f.files.get(r.storagePath), f.args.pdfBytes);
  assert.equal(f.rows.get(r.storagePath).id, r.storeFileId);
  assert.equal(f.downloads.length, 1);
});
test("reuses same operation and identical bytes without uploading again", async () => {
  const f = fixture();
  assert.deepEqual(await store(f.args), await store(f.args));
  assert.equal(f.uploads.length, 1);
  assert.equal(f.rows.size, 1);
});
test("different operations never overwrite previous PDF", async () => {
  const f = fixture(), a = await store(f.args);
  const next = randomUUID();
  f.args.prepared.quote.current_version_id = next;
  f.args.prepared.rpc.p_operation_id = next;
  const b = await store(f.args);
  assert.notEqual(a.storagePath, b.storagePath);
  assert.notEqual(a.storeFileId, b.storeFileId);
  assert.equal(f.files.size, 2);
});
test("different bytes are isolated even for the same operation", async () => {
  const f = fixture(), a = await store(f.args), old = Buffer.from(f.args.pdfBytes);
  f.args.pdfBytes = Buffer.from("%PDF-1.7\nchanged\n%%EOF");
  const b = await store(f.args);
  assert.notEqual(a.storagePath, b.storagePath);
  assert.deepEqual(f.files.get(a.storagePath), old);
});
test("rejects invalid scope before storage", async () => {
  const f = fixture();
  f.args.prepared.rpc.p_store_id = randomUUID();
  await assert.rejects(store(f.args), /SCOPE_MISMATCH/);
  assert.equal(f.uploads.length, 0);
});
test("rejects invalid PDF signature before storage", async () => {
  const f = fixture(); f.args.pdfBytes = Buffer.from("invalid data");
  await assert.rejects(store(f.args), /INVALID_BYTES/);
  assert.equal(f.uploads.length, 0);
});
test("refuses corruption on new upload readback", async () => {
  const f = fixture(); f.fault.corruptUpload = true;
  await assert.rejects(store(f.args), /READBACK_MISMATCH/);
});
test("refuses unavailable object on readback", async () => {
  const f = fixture(); f.fault.failDownload = true;
  await assert.rejects(store(f.args), /READBACK_FAILED/);
});
test("recovers orphan object with identical bytes using existing helper", async () => {
  const f = fixture(); f.fault.failInsert = true;
  await assert.rejects(store(f.args), /insert failure/);
  assert.equal(f.files.size, 1); assert.equal(f.rows.size, 0);
  f.fault.failInsert = false;
  const result = await store(f.args);
  assert.equal(f.rows.size, 1); assert.equal(f.files.size, 1);
  assert.equal(result.storagePath, [...f.files.keys()][0]);
});
test("refuses preexisting object with different bytes without overwriting", async () => {
  const f = fixture(), a = await store(f.args);
  f.files.set(a.storagePath, Buffer.alloc(f.args.pdfBytes.length, 65));
  await assert.rejects(store(f.args), /PDF_STORAGE_BYTES_CONFLICT/);
  assert.equal(f.uploads.length, 1);
});
