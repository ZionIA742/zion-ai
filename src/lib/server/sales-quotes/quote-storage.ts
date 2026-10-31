import { createHash } from "node:crypto";

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
  versionNumber?: number | null;
  operationKey?: string | null;
}) {
  const stableOperationKey = sanitizeFilePart(args.operationKey || "");
  if (stableOperationKey) {
    return [
      args.organizationId,
      args.storeId,
      "sales-quotes",
      args.quoteId,
      `accepted-revision-${stableOperationKey}.pdf`,
    ].join("/");
  }

  const now = new Date();
  const dateKey = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const random = Math.random().toString(36).slice(2, 8);

  const versionKey = args.versionNumber
    ? `v${String(args.versionNumber).padStart(4, "0")}`
    : "pending";

  return [
    args.organizationId,
    args.storeId,
    "sales-quotes",
    args.quoteId,
    `${dateKey}-${versionKey}-${random}.pdf`,
  ].join("/");
}

export function buildQuotePdfFileName(quoteNumber: string, versionNumber?: number | null) {
  const safeQuoteNumber = sanitizeFilePart(quoteNumber || "orcamento");
  if (!versionNumber) {
    return `${safeQuoteNumber}.pdf`;
  }
  return `${safeQuoteNumber}-v${String(versionNumber).padStart(4, "0")}.pdf`;
}

export async function storeQuotePdfFile(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  quoteId: string;
  quoteNumber: string;
  versionNumber?: number | null;
  operationKey?: string | null;
  storagePath?: string;
  originalFilename?: string;
  expectedPdfSha256?: string;
  pdfBytes: Uint8Array;
}) {
  const storagePath = args.storagePath || buildQuoteStoragePath(args);
  const originalFilename = args.originalFilename || buildQuotePdfFileName(args.quoteNumber, args.versionNumber);
  const expectedPdfSha256 =
    args.expectedPdfSha256 || createHash("sha256").update(args.pdfBytes).digest("hex");

  if (!/^[0-9a-f]{64}$/.test(expectedPdfSha256)) {
    throw new Error("PDF_SHA256_INVALID");
  }

  async function loadExistingFile() {
    const { data: existingFile, error: existingFileError } = await args.supabase
      .from("store_files")
      .select("id, organization_id, store_id, file_kind, storage_bucket, storage_path, original_filename, mime_type, size_bytes")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("file_kind", "sales_quote_pdf")
      .eq("storage_bucket", STORAGE_BUCKET)
      .eq("storage_path", storagePath)
      .maybeSingle();

    if (existingFileError) {
      throw new Error(`Falha ao verificar PDF deterministico no storage: ${existingFileError.message}`);
    }

    if (!existingFile?.id) return null;

    if (
      existingFile.mime_type !== "application/pdf" ||
      Number(existingFile.size_bytes) !== args.pdfBytes.byteLength ||
      (args.originalFilename && existingFile.original_filename !== originalFilename)
    ) {
      throw new Error("PDF_STORAGE_IDENTITY_CONFLICT");
    }

    const { data: existingPdf, error: existingPdfError } = await args.supabase.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);

    if (existingPdfError || !existingPdf) {
      throw new Error("PDF_STORAGE_OBJECT_MISSING");
    }

    const existingPdfBytes = new Uint8Array(await existingPdf.arrayBuffer());
    const existingPdfSha256 = createHash("sha256").update(existingPdfBytes).digest("hex");
    if (
      existingPdfBytes.byteLength !== args.pdfBytes.byteLength ||
      existingPdfSha256 !== expectedPdfSha256 ||
      existingPdfBytes.some((value, index) => value !== args.pdfBytes[index])
    ) {
      throw new Error("PDF_STORAGE_BYTES_CONFLICT");
    }

    return {
      storeFileId: String(existingFile.id),
      storageBucket: STORAGE_BUCKET,
      storagePath,
      originalFilename: String(existingFile.original_filename || originalFilename),
      sizeBytes: Number(existingFile.size_bytes),
      pdfSha256: expectedPdfSha256,
    };
  }

  async function registerFileRow() {
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
      const reconciled = await loadExistingFile();
      if (reconciled) return reconciled;
      throw new Error(fileError?.message || "Falha ao registrar o PDF em store_files.");
    }

    return {
      storeFileId: String(fileRow.id),
      storageBucket: STORAGE_BUCKET,
      storagePath,
      originalFilename,
      sizeBytes: args.pdfBytes.byteLength,
      pdfSha256: expectedPdfSha256,
    };
  }

  async function reconcileOrphanStorageObject() {
    const { data: existingPdf, error: existingPdfError } = await args.supabase.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);
    if (existingPdfError || !existingPdf) return null;

    const existingPdfBytes = new Uint8Array(await existingPdf.arrayBuffer());
    const existingPdfSha256 = createHash("sha256").update(existingPdfBytes).digest("hex");
    if (
      existingPdfBytes.byteLength !== args.pdfBytes.byteLength ||
      existingPdfSha256 !== expectedPdfSha256 ||
      existingPdfBytes.some((value, index) => value !== args.pdfBytes[index])
    ) {
      throw new Error("PDF_STORAGE_BYTES_CONFLICT");
    }

    return registerFileRow();
  }

  const existing = await loadExistingFile();
  if (existing) {
    return existing;
  }

  const { error: uploadError } = await args.supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, args.pdfBytes, {
      upsert: false,
      contentType: "application/pdf",
    });

  if (uploadError) {
    const reconciled = await loadExistingFile();
    if (reconciled) return reconciled;
    const orphanReconciled = await reconcileOrphanStorageObject();
    if (orphanReconciled) return orphanReconciled;
    throw new Error(`Falha ao salvar PDF no storage: ${uploadError.message}`);
  }

  return registerFileRow();
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
