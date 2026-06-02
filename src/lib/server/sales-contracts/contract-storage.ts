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
    "sales-contracts",
    args.contractId,
    `${dateKey}-v${String(args.versionNumber).padStart(4, "0")}-${random}.pdf`,
  ].join("/");
}

function buildPdfFileName(contractNumber: string | null | undefined, contractId: string, versionNumber: number) {
  const base =
    sanitizeFilePart(contractNumber || "") ||
    `contrato-${sanitizeFilePart(String(contractId || "").slice(0, 8) || "sem-numero")}`;

  return `${base}-v${String(versionNumber).padStart(4, "0")}.pdf`;
}

export async function storeContractPdfFile(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  contractId: string;
  contractNumber: string | null;
  versionNumber: number;
  pdfBytes: Uint8Array;
}) {
  const storagePath = buildContractStoragePath(args);
  const originalFilename = buildPdfFileName(
    args.contractNumber,
    args.contractId,
    args.versionNumber
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
