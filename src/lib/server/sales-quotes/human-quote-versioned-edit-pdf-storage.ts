import { createHash } from "node:crypto";
import { storeQuotePdfFile } from "./quote-storage";
import type { prepareHumanQuoteVersionedSnapshot } from "./human-quote-versioned-edit-snapshot";

type Prepared = ReturnType<typeof prepareHumanQuoteVersionedSnapshot>;
type StorageClient = Parameters<typeof storeQuotePdfFile>[0]["supabase"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "zion-store-files";

// Called only after server-side authorization and rendering. Never from raw HTTP JSON.
export async function storeHumanQuoteRevisionPdf(args: {
  supabase: StorageClient;
  prepared: Prepared;
  pdfBytes: Uint8Array;
}) {
  const { quote, rpc } = args.prepared;
  const ids = [quote.organization_id, quote.store_id, quote.id, rpc.p_operation_id];
  if (ids.some((id) => typeof id !== "string" || !UUID_RE.test(id)) ||
      rpc.p_organization_id !== quote.organization_id ||
      rpc.p_store_id !== quote.store_id || rpc.p_quote_id !== quote.id ||
      quote.current_version_id !== rpc.p_operation_id) {
    throw new Error("HUMAN_REVISION_PDF_SCOPE_MISMATCH");
  }
  // Copy bytes once to prevent mutation during asynchronous storage operations.
  const pdfBytes = Uint8Array.from(args.pdfBytes);
  if (pdfBytes.length < 8 || Buffer.from(pdfBytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
    throw new Error("HUMAN_REVISION_PDF_INVALID_BYTES");
  }
  const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");
  const [org, store, quoteId, operation] = ids;
  const storagePath = `${org}/${store}/sales-quotes/${quoteId}/human-revision-${operation}-${pdfSha256}.pdf`;
  const result = await storeQuotePdfFile({
    supabase: args.supabase,
    organizationId: org,
    storeId: store,
    quoteId,
    quoteNumber: quote.quote_number || quoteId,
    storagePath,
    expectedPdfSha256: pdfSha256,
    pdfBytes,
  });
  if (!UUID_RE.test(result.storeFileId) || result.storageBucket !== BUCKET ||
      result.storagePath !== storagePath || result.sizeBytes !== pdfBytes.length ||
      result.pdfSha256 !== pdfSha256) {
    throw new Error("HUMAN_REVISION_PDF_STORAGE_RESULT_INVALID");
  }
  // Verify the persisted bytes even for a newly uploaded object.
  const { data, error } = await args.supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) throw new Error("HUMAN_REVISION_PDF_READBACK_FAILED");
  const actual = new Uint8Array(await data.arrayBuffer());
  if (actual.length !== pdfBytes.length || actual.some((byte, i) => byte !== pdfBytes[i])) {
    throw new Error("HUMAN_REVISION_PDF_READBACK_MISMATCH");
  }
  return result;
}
