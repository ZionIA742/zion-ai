const STORAGE_BUCKET = "zion-store-files";

function sanitizeFilePart(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function buildQuoteStoragePath(args: {
  organizationId: string;
  storeId: string;
  quoteId: string;
  versionNumber: number;
}) {
  const now = new Date();
  const dateKey = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const random = Math.random().toString(36).slice(2, 8);

  return [
    args.organizationId,
    args.storeId,
    "sales-quotes",
    args.quoteId,
    `${dateKey}-v${String(args.versionNumber).padStart(4, "0")}-${random}.pdf`,
  ].join("/");
}

function buildPdfFileName(quoteNumber: string, versionNumber: number) {
  const safeQuoteNumber = sanitizeFilePart(quoteNumber || "orcamento");
  return `${safeQuoteNumber}-v${String(versionNumber).padStart(4, "0")}.pdf`;
}

export async function storeQuotePdfFile(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  quoteId: string;
  quoteNumber: string;
  versionNumber: number;
  pdfBytes: Uint8Array;
}) {
  const storagePath = buildQuoteStoragePath(args);
  const originalFilename = buildPdfFileName(args.quoteNumber, args.versionNumber);

  const { error: uploadError } = await args.supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, args.pdfBytes, {
      upsert: false,
      contentType: "application/pdf",
    });

  if (uploadError) {
    throw new Error(`Falha ao salvar PDF no storage: ${uploadError.message}`);
  }

  const { data: fileRow, error: fileError } = await args.supabase
    .from("store_files")
    .insert({
      organization_id: args.organizationId,
      store_id: args.storeId,
      file_kind: "sales_quote_pdf",
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      original_filename: originalFilename,
      mime_type: "application/pdf",
      size_bytes: args.pdfBytes.byteLength,
      uploaded_by: "system",
    })
    .select(
      "id, organization_id, store_id, file_kind, storage_bucket, storage_path, original_filename, mime_type, size_bytes, uploaded_by, created_at, updated_at"
    )
    .maybeSingle();

  if (fileError || !fileRow?.id) {
    throw new Error(
      fileError?.message || "Falha ao registrar o PDF em store_files."
    );
  }

  return {
    storeFileId: String(fileRow.id),
    storageBucket: STORAGE_BUCKET,
    storagePath,
    originalFilename,
    sizeBytes: args.pdfBytes.byteLength,
  };
}

export function buildQuotePdfMessageMetadata(args: {
  quoteId: string;
  versionId: string;
  quoteNumber: string;
  storagePath: string;
  originalFilename: string;
  sizeBytes: number;
}) {
  return {
    attachment_kind: "file",
    storage_bucket: STORAGE_BUCKET,
    storage_path: args.storagePath,
    mime_type: "application/pdf",
    original_file_name: args.originalFilename,
    size_bytes: args.sizeBytes,
    file_kind: "sales_quote_pdf",
    quote_id: args.quoteId,
    quote_version_id: args.versionId,
    quote_number: args.quoteNumber,
    generated_by: "system",
  };
}

