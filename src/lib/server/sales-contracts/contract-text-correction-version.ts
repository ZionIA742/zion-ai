import { createHash } from "node:crypto";
import { buildContractTextDraftPdf } from "./build-contract-text-draft-pdf";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function prepareContractTextCorrectionVersion(args: {
  previousSnapshot: RecordValue;
  previousVersionId: string;
  previousPdfSha256: string;
  actorUserId: string;
  originalText: string;
  correctedText: string;
}) {
  if (!isRecord(args.previousSnapshot) || typeof args.originalText !== "string" || typeof args.correctedText !== "string") {
    throw new Error("O texto historico ou o snapshot do contrato sao invalidos.");
  }

  const previousProvenance = args.previousSnapshot.text_provenance;
  if (!isRecord(previousProvenance) || typeof previousProvenance.text_sha256 !== "string" ||
      sha256(args.originalText) !== previousProvenance.text_sha256 ||
      previousProvenance.pdf_sha256 !== args.previousPdfSha256) {
    throw new Error("O texto historico nao corresponde a versao enviada.");
  }

  if (sha256(args.correctedText) === previousProvenance.text_sha256) {
    throw new Error("Nenhuma alteracao textual foi realizada.");
  }

  const pdfBytes = await buildContractTextDraftPdf({ text: args.correctedText });
  const correctedTextSha256 = sha256(args.correctedText);
  const pdfSha256 = sha256(pdfBytes);
  const provenance = {
    ...previousProvenance,
    text_sha256: correctedTextSha256,
    pdf_sha256: pdfSha256,
    text_representation: "manual_contract_corrected_text_utf8_exact",
    rendered_text_representation: "line_endings_normalized_to_lf",
  };
  const correction = {
    previous_version_id: args.previousVersionId,
    actor_user_id: args.actorUserId,
    previous_text_sha256: previousProvenance.text_sha256,
    corrected_text_sha256: correctedTextSha256,
    kind: "full_text",
  };
  const correctedSnapshot = {
    ...structuredClone(args.previousSnapshot),
    text_provenance: provenance,
    text_correction: correction,
    content_fingerprint: sha256(stableSerialize({
      base_content_fingerprint: args.previousSnapshot.content_fingerprint,
      text_sha256: correctedTextSha256,
      pdf_sha256: pdfSha256,
    })),
    materialized_at: new Date().toISOString(),
  };

  return {
    pdfBytes,
    pdfSha256,
    correctedTextSha256,
    correctedSnapshot,
    contentFingerprint: correctedSnapshot.content_fingerprint as string,
    requestFingerprint: sha256(stableSerialize({
      operation: "zion.sales_contract_text_correction.v1",
      previousVersionId: args.previousVersionId,
      actorUserId: args.actorUserId,
      previousTextSha256: previousProvenance.text_sha256,
      correctedTextSha256,
      contentFingerprint: correctedSnapshot.content_fingerprint,
    })),
  };
}
