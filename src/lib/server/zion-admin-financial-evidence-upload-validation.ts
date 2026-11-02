/**
 * ZION-ADM / 8-E.11-D.2-B.1
 *
 * Valida arquivos antes do upload financeiro.
 *
 * Nao autoriza usuarios.
 * Nao acessa Storage ou banco.
 * Nao verifica autenticidade de faturas.
 * Nao registra despesas como comprovadas.
 * Nao autoriza fechamento definitivo.
 */

import { createHash } from "node:crypto";

export const FINANCIAL_EVIDENCE_BUCKET =
  "zion-admin-financial-evidence";

export const FINANCIAL_EVIDENCE_MAX_BYTES =
  10 * 1024 * 1024;

const REQUIRED_SOURCES = [
  "fixed_costs",
  "manual_expenses",
  "openai_invoice",
  "meta_invoice",
] as const;

export type FinancialEvidenceSource =
  (typeof REQUIRED_SOURCES)[number];

type AllowedFileType = {
  mime: "application/pdf" | "image/png" | "image/jpeg";
  extension: "pdf" | "png" | "jpg";
};

export type FinancialEvidenceUploadInput = {
  month: unknown;
  preclosureRevision: unknown;
  source: unknown;
  filename: unknown;
  mimeType: unknown;
  bytes: unknown;
};

export type ValidatedFinancialEvidenceUpload = {
  month: string;
  preclosureRevision: number;
  source: FinancialEvidenceSource;
  mimeType: AllowedFileType["mime"];
  extension: AllowedFileType["extension"];
  sizeBytes: number;
  sha256: string;
};

function fail(code: string): never {
  throw new Error(code);
}

function validMonth(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^20\d{2}-(0[1-9]|1[0-2])-01$/.test(value)
  );
}

function validSource(
  value: unknown,
): value is FinancialEvidenceSource {
  return (
    typeof value === "string" &&
    REQUIRED_SOURCES.some((source) => source === value)
  );
}

function identifyFileType(
  bytes: Buffer,
): AllowedFileType | null {
  if (
    bytes.length >= 20 &&
    bytes.subarray(0, 5).toString("ascii") === "%PDF-" &&
    bytes.subarray(-2048).toString("latin1").includes("%%EOF")
  ) {
    return {
      mime: "application/pdf",
      extension: "pdf",
    };
  }

  const pngSignature = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);

  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(pngSignature) &&
    bytes.subarray(12, 16).toString("ascii") === "IHDR"
  ) {
    return {
      mime: "image/png",
      extension: "png",
    };
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  ) {
    return {
      mime: "image/jpeg",
      extension: "jpg",
    };
  }

  return null;
}

export function validateFinancialEvidenceUpload(
  input: FinancialEvidenceUploadInput,
): ValidatedFinancialEvidenceUpload {
  if (!validMonth(input.month)) {
    fail("FINANCIAL_EVIDENCE_INVALID_MONTH");
  }

  if (
    typeof input.preclosureRevision !== "number" ||
    !Number.isSafeInteger(input.preclosureRevision) ||
    input.preclosureRevision < 1
  ) {
    fail("FINANCIAL_EVIDENCE_INVALID_REVISION");
  }

  if (!validSource(input.source)) {
    fail("FINANCIAL_EVIDENCE_INVALID_SOURCE");
  }

  if (
    typeof input.filename !== "string" ||
    input.filename.length < 5 ||
    input.filename.length > 255 ||
    /[/\\\0]/.test(input.filename)
  ) {
    fail("FINANCIAL_EVIDENCE_INVALID_FILENAME");
  }

  if (!Buffer.isBuffer(input.bytes)) {
    fail("FINANCIAL_EVIDENCE_INVALID_BYTES");
  }

  const bytes = input.bytes;

  if (
    bytes.length === 0 ||
    bytes.length > FINANCIAL_EVIDENCE_MAX_BYTES
  ) {
    fail("FINANCIAL_EVIDENCE_INVALID_SIZE");
  }

  const identified = identifyFileType(bytes);

  if (!identified) {
    fail("FINANCIAL_EVIDENCE_INVALID_SIGNATURE");
  }

  if (input.mimeType !== identified.mime) {
    fail("FINANCIAL_EVIDENCE_MIME_MISMATCH");
  }

  const name = input.filename.toLowerCase();
  const extension = name.split(".").pop();

  const extensionAllowed =
    identified.extension === "jpg"
      ? extension === "jpg" || extension === "jpeg"
      : extension === identified.extension;

  if (!extensionAllowed) {
    fail("FINANCIAL_EVIDENCE_EXTENSION_MISMATCH");
  }

  const sha256 = createHash("sha256")
    .update(bytes)
    .digest("hex");

  return {
    month: input.month,
    preclosureRevision: input.preclosureRevision,
    source: input.source,
    mimeType: identified.mime,
    extension: identified.extension,
    sizeBytes: bytes.length,
    sha256,
  };
}