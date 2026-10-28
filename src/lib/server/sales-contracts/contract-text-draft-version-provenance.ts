import { createHash } from "node:crypto";
import {
  MAX_CONTRACT_TEXT_DRAFT_CHARS,
  type ContractTextDraftSource,
} from "./contract-text-draft-source";

export const TEXT_DRAFT_PROVENANCE_MODE = "saved_text_draft" as const;
export const PERSISTED_TEXT_REPRESENTATION = "persisted_text_utf8_exact" as const;
export const RENDERED_TEXT_REPRESENTATION = "line_endings_normalized_to_lf" as const;

export type ContractTextDraftVersionProvenance = {
  mode: typeof TEXT_DRAFT_PROVENANCE_MODE;
  draft_id: string;
  organization_id: string;
  store_id: string;
  commercial_opportunity_id: string;
  template_version_id: string;
  revision: number;
  text_sha256: string;
  pdf_sha256: string;
  text_representation: typeof PERSISTED_TEXT_REPRESENTATION;
  rendered_text_representation: typeof RENDERED_TEXT_REPRESENTATION;
};

export type ContractTextDraftVersionProvenanceResult = {
  provenance: ContractTextDraftVersionProvenance;
  text_sha256: string;
  pdf_sha256: string;
};

export type ContractTextDraftVersionProvenanceErrorCode =
  | "INVALID_DRAFT_SOURCE"
  | "DRAFT_TEXT_INVALID"
  | "DRAFT_TEXT_HASH_MISMATCH"
  | "PDF_BYTES_INVALID";

export class ContractTextDraftVersionProvenanceError extends Error {
  constructor(
    public readonly code: ContractTextDraftVersionProvenanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContractTextDraftVersionProvenanceError";
  }
}

function fail(
  code: ContractTextDraftVersionProvenanceErrorCode,
  message: string,
): never {
  throw new ContractTextDraftVersionProvenanceError(code, message);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function hashText(text: string): string {
  // Exact persisted JavaScript text encoded as UTF-8. No trimming, line-ending
  // conversion, Unicode normalization, or replacement is performed here.
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function hashPdf(pdfBytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(pdfBytes)).digest("hex");
}

function validateDraftSource(source: ContractTextDraftSource): void {
  const identityValues = [
    source?.draftId,
    source?.organizationId,
    source?.storeId,
    source?.commercialOpportunityId,
    source?.templateVersionId,
  ];

  if (
    identityValues.some((value) => !isNonEmptyString(value)) ||
    !Number.isSafeInteger(source?.revision) ||
    source.revision < 1 ||
    typeof source?.text !== "string" ||
    source.text.trim().length === 0 ||
    source.text.length > MAX_CONTRACT_TEXT_DRAFT_CHARS ||
    !isSha256(source?.sha256)
  ) {
    fail("INVALID_DRAFT_SOURCE", "A origem tipada do rascunho e invalida.");
  }
}

/**
 * Prepares read-only provenance for a textual contract version.
 *
 * The persisted text hash and effective PDF-byte hash are independent. The
 * textual renderer normalizes CRLF/CR to LF before rendering, so this result
 * records both representations without claiming their bytes are identical.
 */
export function prepareContractTextDraftVersionProvenance(args: {
  draft: ContractTextDraftSource;
  pdfBytes: Uint8Array;
}): ContractTextDraftVersionProvenanceResult {
  validateDraftSource(args?.draft);

  if (!(args?.pdfBytes instanceof Uint8Array) || args.pdfBytes.byteLength === 0) {
    fail("PDF_BYTES_INVALID", "Os bytes efetivos do PDF estao vazios ou invalidos.");
  }

  const textSha256 = hashText(args.draft.text);
  if (textSha256 !== args.draft.sha256) {
    fail(
      "DRAFT_TEXT_HASH_MISMATCH",
      "O hash do texto persistido nao corresponde ao hash recebido do resolver.",
    );
  }

  const pdfSha256 = hashPdf(args.pdfBytes);
  const provenance: ContractTextDraftVersionProvenance = {
    mode: TEXT_DRAFT_PROVENANCE_MODE,
    draft_id: args.draft.draftId,
    organization_id: args.draft.organizationId,
    store_id: args.draft.storeId,
    commercial_opportunity_id: args.draft.commercialOpportunityId,
    template_version_id: args.draft.templateVersionId,
    revision: args.draft.revision,
    text_sha256: textSha256,
    pdf_sha256: pdfSha256,
    text_representation: PERSISTED_TEXT_REPRESENTATION,
    rendered_text_representation: RENDERED_TEXT_REPRESENTATION,
  };

  return {
    provenance,
    text_sha256: textSha256,
    pdf_sha256: pdfSha256,
  };
}
