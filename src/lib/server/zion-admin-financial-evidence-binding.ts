/**
 * ZION-ADM / 8-E.11-D.3-B.2-A
 *
 * Vinculo estrutural, SOMENTE LEITURA, entre proposta
 * e upload registrado.
 *
 * Os campos do upload e a revisao corrente devem vir
 * de leitura confiavel no servidor, nunca do navegador.
 *
 * NAO consulta Storage, nao recalcula SHA-256,
 * nao reconcilia faturas e NAO aprova comprovantes.
 */

import {
  assessFinancialProofDraft,
  type FinancialProofDraft,
  type FinancialProofSource,
} from "./zion-admin-financial-evidence-verification-draft";

const BUCKET = "zion-admin-financial-evidence";
const MAX_BYTES = 10 * 1024 * 1024;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MIME_EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
};

type FailureReason =
  | "INVALID_INPUT"
  | "INVALID_MONTH"
  | "INVALID_CURRENT_REVISION"
  | "INVALID_DRAFT"
  | "INVALID_UPLOAD_RECORD"
  | "INVALID_UPLOAD_ID"
  | "MONTH_MISMATCH"
  | "REVISION_MISMATCH"
  | "SOURCE_MISMATCH"
  | "INVALID_STORAGE_METADATA"
  | "INVALID_UPLOAD_PROVENANCE";

export type FinancialEvidenceBindingAssessment =
  | {
      ok: true;
      status: "linked_unverified";
      uploadId: number;
      source: FinancialProofSource;
      storagePath: string;
      documentSha256: string;
      sizeBytes: number;
      candidate: FinancialProofDraft;
    }
  | {
      ok: false;
      reason: FailureReason;
    };

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isMonth(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])-01$/.test(value) &&
    Number(value.slice(0, 4)) >= 2020 &&
    Number(value.slice(0, 4)) <= 2100
  );
}

function positiveInteger(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1
  );
}

/**
 * Verifica SOMENTE a correspondencia estrutural.
 *
 * O retorno nao comprova bytes, fatura, valor,
 * permissao administrativa ou fechamento.
 */
export function assessFinancialEvidenceUploadBinding(
  input: {
    month: unknown;
    currentPreclosureRevision: unknown;
    proofDraft: unknown;
    uploadRecord: unknown;
  },
): FinancialEvidenceBindingAssessment {
  if (!isRecord(input)) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  if (!isMonth(input.month)) {
    return { ok: false, reason: "INVALID_MONTH" };
  }

  if (!positiveInteger(input.currentPreclosureRevision)) {
    return {
      ok: false,
      reason: "INVALID_CURRENT_REVISION",
    };
  }

  const draft = assessFinancialProofDraft(
    input.proofDraft,
  );

  if (!draft.ok) {
    return { ok: false, reason: "INVALID_DRAFT" };
  }

  const upload = input.uploadRecord;

  if (!isRecord(upload)) {
    return {
      ok: false,
      reason: "INVALID_UPLOAD_RECORD",
    };
  }

  if (!positiveInteger(upload.id)) {
    return {
      ok: false,
      reason: "INVALID_UPLOAD_ID",
    };
  }

  if (upload.month !== input.month) {
    return { ok: false, reason: "MONTH_MISMATCH" };
  }

  if (
    upload.preclosure_revision !==
    input.currentPreclosureRevision
  ) {
    return {
      ok: false,
      reason: "REVISION_MISMATCH",
    };
  }

  if (upload.source !== draft.candidate.source) {
    return {
      ok: false,
      reason: "SOURCE_MISMATCH",
    };
  }

  const sha = upload.document_sha256;
  const path = upload.storage_path;
  const mime = upload.mime_type;
  const size = upload.size_bytes;

  const ext =
    typeof mime === "string"
      ? MIME_EXTENSION[mime]
      : undefined;

  if (
    upload.storage_bucket !== BUCKET ||
    typeof sha !== "string" ||
    !HEX_SHA256.test(sha) ||
    typeof path !== "string" ||
    path.length > 512 ||
    !ext ||
    !positiveInteger(size) ||
    size > MAX_BYTES
  ) {
    return {
      ok: false,
      reason: "INVALID_STORAGE_METADATA",
    };
  }

  const expectedPrefix =
    `unverified/${input.month}/` +
    `${input.currentPreclosureRevision}/` +
    `${draft.candidate.source}/`;

  const tail = path.slice(expectedPrefix.length);

  const expectedTail = new RegExp(
    `^${UUID.source.slice(1, -1)}-${sha}\\.${ext}$`,
  );

  if (
    !path.startsWith(expectedPrefix) ||
    !expectedTail.test(tail)
  ) {
    return {
      ok: false,
      reason: "INVALID_STORAGE_METADATA",
    };
  }

  if (
    typeof upload.uploaded_by_user_id !== "string" ||
    !UUID.test(upload.uploaded_by_user_id) ||
    typeof upload.uploaded_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(upload.uploaded_at) ||
    !Number.isFinite(Date.parse(upload.uploaded_at))
  ) {
    return {
      ok: false,
      reason: "INVALID_UPLOAD_PROVENANCE",
    };
  }

  return {
    ok: true,
    status: "linked_unverified",
    uploadId: upload.id,
    source: draft.candidate.source,
    storagePath: path,
    documentSha256: sha,
    sizeBytes: size,
    candidate: draft.candidate,
  };
}