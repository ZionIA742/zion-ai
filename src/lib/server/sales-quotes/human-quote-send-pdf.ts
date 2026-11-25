import type {
  SalesQuoteRow,
  SalesQuoteVersionRow,
  StoreFileRow,
} from "./types";

const PDF_BUCKET = "zion-store-files";
const PDF_MIME_TYPE = "application/pdf";
const PDF_FILE_KIND = "sales_quote_pdf";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class HumanQuoteSendPdfError extends Error {
  readonly status = 409;

  constructor(readonly code: string) {
    super(code);
    this.name = "HumanQuoteSendPdfError";
  }
}

export type HumanQuoteSendPdfInput = {
  organizationId: string;
  storeId: string;
  quoteId: string;
  quoteVersionId: string;

  quote: Pick<
    SalesQuoteRow,
    "id" |
    "organization_id" |
    "store_id" |
    "current_version_id"
  > | null;

  version: Pick<
    SalesQuoteVersionRow,
    "id" |
    "quote_id" |
    "organization_id" |
    "store_id" |
    "store_file_id" |
    "storage_bucket" |
    "storage_path" |
    "original_filename" |
    "mime_type" |
    "size_bytes"
  > | null;

  storeFile: Pick<
    StoreFileRow,
    "id" |
    "organization_id" |
    "store_id" |
    "file_kind" |
    "storage_bucket" |
    "storage_path" |
    "original_filename" |
    "mime_type" |
    "size_bytes"
  > | null;
};

export type HumanQuoteSendPdfIdentity = {
  organizationId: string;
  storeId: string;
  quoteId: string;
  quoteVersionId: string;
  storeFileId: string;
  storageBucket: typeof PDF_BUCKET;
  storagePath: string;
  originalFilename: string;
  mimeType: typeof PDF_MIME_TYPE;
  sizeBytes: number;
};

function fail(code: string): never {
  throw new HumanQuoteSendPdfError(code);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UUID_PATTERN.test(value) &&
    value !== "00000000-0000-0000-0000-000000000000"
  );
}

function isSafePdfFilename(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 255 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/i.test(value) &&
    !value.includes("..")
  );
}

function isValidSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

export function validateHumanQuoteSendPdf(
  input: HumanQuoteSendPdfInput,
): HumanQuoteSendPdfIdentity {
  const {
    organizationId,
    storeId,
    quoteId,
    quoteVersionId,
    quote,
    version,
    storeFile,
  } = input;

  if (
    !isUuid(organizationId) ||
    !isUuid(storeId) ||
    !isUuid(quoteId) ||
    !isUuid(quoteVersionId)
  ) {
    return fail("HUMAN_QUOTE_SEND_PDF_SCOPE_INVALID");
  }

  if (
    !quote ||
    quote.id !== quoteId ||
    quote.organization_id !== organizationId ||
    quote.store_id !== storeId
  ) {
    return fail("HUMAN_QUOTE_SEND_PDF_QUOTE_SCOPE_MISMATCH");
  }

  if (
    !quote.current_version_id ||
    quote.current_version_id !== quoteVersionId
  ) {
    return fail("HUMAN_QUOTE_SEND_PDF_VERSION_STALE");
  }

  if (
    !version ||
    version.id !== quoteVersionId ||
    version.quote_id !== quoteId ||
    version.organization_id !== organizationId ||
    version.store_id !== storeId
  ) {
    return fail("HUMAN_QUOTE_SEND_PDF_VERSION_SCOPE_MISMATCH");
  }

  if (
    !isUuid(version.store_file_id) ||
    !storeFile ||
    storeFile.id !== version.store_file_id ||
    storeFile.organization_id !== organizationId ||
    storeFile.store_id !== storeId
  ) {
    return fail("HUMAN_QUOTE_SEND_PDF_FILE_SCOPE_MISMATCH");
  }

  if (storeFile.file_kind !== PDF_FILE_KIND) {
    return fail("HUMAN_QUOTE_SEND_PDF_FILE_KIND_INVALID");
  }

  if (
    version.storage_bucket !== PDF_BUCKET ||
    storeFile.storage_bucket !== PDF_BUCKET
  ) {
    return fail("HUMAN_QUOTE_SEND_PDF_BUCKET_INVALID");
  }

  const storagePath = version.storage_path;

  if (
    typeof storagePath !== "string" ||
    storagePath !== storeFile.storage_path
  ) {
    return fail("HUMAN_QUOTE_SEND_PDF_PATH_MISMATCH");
  }

  const prefix = [
    organizationId,
    storeId,
    "sales-quotes",
    quoteId,
    "",
  ].join("/");

  if (!storagePath.startsWith(prefix)) {
    return fail("HUMAN_QUOTE_SEND_PDF_PATH_INVALID");
  }

  const relativePath = storagePath.slice(prefix.length);

  // Legacy PDFs and human revisions are stored directly
  // under the canonical quote directory.
  const directPdf = isSafePdfFilename(relativePath);

  // The canonical PDF generation operation stores its
  // immutable artifact under operations/<operation_id>.pdf.
  const operationMatch =
    /^operations\/([0-9a-f-]{36})\.pdf$/.exec(relativePath);

  const operationPdf =
    operationMatch !== null &&
    isUuid(operationMatch[1]) &&
    relativePath === "operations/" + operationMatch[1] + ".pdf";

  if (!directPdf && !operationPdf) {
    return fail("HUMAN_QUOTE_SEND_PDF_PATH_INVALID");
  }

  const originalFilename = version.original_filename;

  if (
    !isSafePdfFilename(originalFilename) ||
    originalFilename !== storeFile.original_filename
  ) {
    return fail("HUMAN_QUOTE_SEND_PDF_FILENAME_INVALID");
  }

  if (
    version.mime_type !== PDF_MIME_TYPE ||
    storeFile.mime_type !== PDF_MIME_TYPE
  ) {
    return fail("HUMAN_QUOTE_SEND_PDF_MIME_INVALID");
  }

  const sizeBytes = version.size_bytes;

  if (
    !isValidSize(sizeBytes) ||
    !isValidSize(storeFile.size_bytes) ||
    sizeBytes !== storeFile.size_bytes
  ) {
    return fail("HUMAN_QUOTE_SEND_PDF_SIZE_INVALID");
  }

  return {
    organizationId,
    storeId,
    quoteId,
    quoteVersionId,
    storeFileId: storeFile.id,
    storageBucket: PDF_BUCKET,
    storagePath,
    originalFilename,
    mimeType: PDF_MIME_TYPE,
    sizeBytes,
  };
}
