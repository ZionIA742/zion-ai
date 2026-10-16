import assert from "node:assert/strict";
import { test } from "node:test";
import { storeQuotePdfFile } from "./quote-storage";

function fakeSupabase(existingBytes: Uint8Array) {
  const fileQuery = {
    select() { return fileQuery; },
    eq() { return fileQuery; },
    async maybeSingle() {
      return {
        data: {
          id: "file-1",
          storage_bucket: "zion-store-files",
          storage_path: "org-1/store-1/sales-quotes/quote-1/accepted-revision-key.pdf",
          original_filename: "quote.pdf",
          mime_type: "application/pdf",
          size_bytes: existingBytes.byteLength,
        },
        error: null,
      };
    },
  };

  return {
    from() { return fileQuery; },
    storage: {
      from() {
        return {
          async download() {
            return {
              data: { arrayBuffer: async () => existingBytes },
              error: null,
            };
          },
        };
      },
    },
  };
}

const args = (supabase: unknown, pdfBytes: Uint8Array) => ({
  supabase,
  organizationId: "org-1",
  storeId: "store-1",
  quoteId: "quote-1",
  quoteNumber: "QUOTE-1",
  operationKey: "key",
  pdfBytes,
});

test("reuses deterministic PDF evidence only when content is identical", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const result = await storeQuotePdfFile(args(fakeSupabase(bytes), bytes));
  assert.equal(result.storeFileId, "file-1");
});

test("rejects a different PDF with the same size", async () => {
  const existingBytes = new Uint8Array([1, 2, 3, 4]);
  const requestedBytes = new Uint8Array([4, 3, 2, 1]);

  await assert.rejects(
    storeQuotePdfFile(args(fakeSupabase(existingBytes), requestedBytes)),
    /POST_ACCEPTANCE_REVISION_PDF_EVIDENCE_CONFLICT/,
  );
});
