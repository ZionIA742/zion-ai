const STORAGE_BUCKET = "zion-store-files";

export function buildContractPdfMessageMetadata(args: {
  contractId: string;
  versionId: string;
  contractNumber: string;
  quoteId?: string | null;
  quoteVersionId?: string | null;
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
    file_kind: "sales_contract_pdf",
    contract_id: args.contractId,
    contract_version_id: args.versionId,
    contract_number: args.contractNumber,
    quote_id: args.quoteId || null,
    quote_version_id: args.quoteVersionId || null,
    private: true,
    generated_by: "system",
  };
}

export function extractInsertMessageId(data: unknown) {
  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === "object" && "id" in first) {
      return String((first as { id?: string | null }).id || "").trim() || null;
    }
    if (typeof first === "string") {
      return first.trim() || null;
    }
  }

  if (data && typeof data === "object" && "id" in data) {
    return String((data as { id?: string | null }).id || "").trim() || null;
  }

  if (typeof data === "string") {
    return data.trim() || null;
  }

  return null;
}
