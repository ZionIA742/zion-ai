import { randomUUID } from "node:crypto";

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

function buildContractStoragePath(args: {
  organizationId: string;
  storeId: string;
  contractId: string;
  contentFingerprint: string;
}) {
  const now = new Date();
  const dateKey = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const random = randomUUID().replace(/-/g, "").slice(0, 12);
  const fingerprint = sanitizeFilePart(args.contentFingerprint).slice(0, 12);

  return [
    args.organizationId,
    args.storeId,
    "sales-contracts",
    args.contractId,
    `${dateKey}-${fingerprint || "content"}-${random}.pdf`,
  ].join("/");
}

function buildPdfFileName(
  contractNumber: string | null | undefined,
  contractId: string,
  contentFingerprint: string,
) {
  const base =
    sanitizeFilePart(contractNumber || "") ||
    `contrato-${sanitizeFilePart(String(contractId || "").slice(0, 8) || "sem-numero")}`;

  const fingerprint = sanitizeFilePart(contentFingerprint).slice(0, 12) || "content";
  return `${base}-${fingerprint}.pdf`;
}

export async function storeContractPdfFile(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  contractId: string;
  contractNumber: string | null;
  contentFingerprint: string;
  pdfBytes: Uint8Array;
}) {
  const storagePath = buildContractStoragePath(args);
  const originalFilename = buildPdfFileName(
    args.contractNumber,
    args.contractId,
    args.contentFingerprint,
  );

  const { error: uploadError } = await args.supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, args.pdfBytes, {
      upsert: false,
      contentType: "application/pdf",
    });

  if (uploadError) {
    throw new Error(`Falha ao salvar PDF do contrato no storage: ${uploadError.message}`);
  }

  const { data: fileRow, error: fileError } = await args.supabase
    .from("store_files")
    .insert({
      organization_id: args.organizationId,
      store_id: args.storeId,
      file_kind: "sales_contract_pdf",
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      original_filename: originalFilename,
      mime_type: "application/pdf",
      size_bytes: args.pdfBytes.byteLength,
      uploaded_by: "system",
    })
    .select("*")
    .maybeSingle();

  if (fileError || !fileRow?.id) {
    try {
      await args.supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    } catch {
      // best effort cleanup of the object that has no durable store_file row
    }
    throw new Error(fileError?.message || "Falha ao registrar o PDF do contrato em store_files.");
  }

  return {
    storeFileId: String(fileRow.id),
    storageBucket: STORAGE_BUCKET,
    storagePath,
    originalFilename,
    sizeBytes: args.pdfBytes.byteLength,
  };
}
