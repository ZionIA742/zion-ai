/**
 * ZION-ADM / 8-E.11-D.3-C.3-E.1
 *
 * Vincula uma confirmacao explicita aos dados exatos
 * apresentados na revisao financeira.
 *
 * IMPORTANTE:
 * - O contexto deve ser montado no servidor a partir
 *   da sessao e dos registros canonicos.
 * - Nunca utilizar contexto enviado pelo navegador.
 * - O fingerprint nao e assinatura nem permissao.
 * - Esta funcao nao comprova revisao humana.
 * - Nao acessa Storage nem banco.
 * - Nao registra aprovacao ou fechamento financeiro.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import {
  assessFinancialProofDraft,
} from "./zion-admin-financial-evidence-verification-draft";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MONTH =
  /^(?:20[2-9]\d|2100)-(?:0[1-9]|1[0-2])-01$/;

const SHA256 = /^[0-9a-f]{64}$/;

const FILE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-([0-9a-f]{64})\.(?:pdf|png|jpg)$/;

const CONTEXT_KEYS = [
  "actorUserId",
  "month",
  "preclosureRevision",
  "uploadId",
  "source",
  "proofType",
  "amountBrlCents",
  "amountUsd",
  "documentSha256",
  "sizeBytes",
  "storagePath",
] as const;

function isRecord(
  input: unknown,
): input is Record<string, unknown> {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input)
  );
}

export type PreparedFinancialReview =
  | {
      ok: true;
      status: "awaiting_manual_confirmation";
      fingerprint: string;
    }
  | {
      ok: false;
      reason: "INVALID_CONTEXT";
    };

export function prepareFinancialEvidenceReview(
  trustedContext: unknown,
): PreparedFinancialReview {
  if (!isRecord(trustedContext)) {
    return { ok: false, reason: "INVALID_CONTEXT" };
  }

  const keys = Object.keys(trustedContext);

  if (
    keys.length !== CONTEXT_KEYS.length ||
    !CONTEXT_KEYS.every((key) =>
      Object.prototype.hasOwnProperty.call(
        trustedContext,
        key,
      )
    )
  ) {
    return { ok: false, reason: "INVALID_CONTEXT" };
  }

  const {
    actorUserId,
    month,
    preclosureRevision,
    uploadId,
    source,
    proofType,
    amountBrlCents,
    amountUsd,
    documentSha256,
    sizeBytes,
    storagePath,
  } = trustedContext;

  if (
    typeof actorUserId !== "string" ||
    !UUID.test(actorUserId) ||
    typeof month !== "string" ||
    !MONTH.test(month) ||
    typeof preclosureRevision !== "number" ||
    !Number.isSafeInteger(preclosureRevision) ||
    preclosureRevision < 1 ||
    typeof uploadId !== "number" ||
    !Number.isSafeInteger(uploadId) ||
    uploadId < 1 ||
    typeof documentSha256 !== "string" ||
    !SHA256.test(documentSha256) ||
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 1 ||
    sizeBytes > 10485760 ||
    typeof storagePath !== "string" ||
    storagePath.length > 512
  ) {
    return { ok: false, reason: "INVALID_CONTEXT" };
  }

  const draft = assessFinancialProofDraft({
    source,
    proofType,
    amountBrlCents,
    amountUsd,
  });

  if (!draft.ok) {
    return { ok: false, reason: "INVALID_CONTEXT" };
  }

  const prefix = [
    "unverified",
    month,
    String(preclosureRevision),
    draft.candidate.source,
  ].join("/") + "/";

  if (!storagePath.startsWith(prefix)) {
    return { ok: false, reason: "INVALID_CONTEXT" };
  }

  const filename = storagePath.slice(prefix.length);
  const matched = FILE_NAME.exec(filename);

  if (!matched || matched[1] !== documentSha256) {
    return { ok: false, reason: "INVALID_CONTEXT" };
  }

  // Ordem fixa e versao explicita evitam colisoes de
  // significado entre diferentes tipos de operacao.
  const canonical = JSON.stringify([
    "zion-admin-financial-review-v1",
    actorUserId,
    month,
    preclosureRevision,
    uploadId,
    draft.candidate.source,
    draft.candidate.proofType,
    draft.candidate.amountBrlCents,
    draft.candidate.amountUsd,
    "zion-admin-financial-evidence",
    storagePath,
    documentSha256,
    sizeBytes,
    "manual_document_review",
  ]);

  const fingerprint = createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex");

  return {
    ok: true,
    status: "awaiting_manual_confirmation",
    fingerprint,
  };
}

export type FinancialReviewConfirmationResult =
  | {
      ok: true;
      status: "confirmation_bound_unverified";
      fingerprint: string;
    }
  | {
      ok: false;
      reason:
        | "INVALID_CONTEXT"
        | "EXPLICIT_CONFIRMATION_REQUIRED"
        | "FINGERPRINT_MISMATCH";
    };

export function assessFinancialEvidenceReviewConfirmation(
  trustedContext: unknown,
  submittedConfirmation: unknown,
): FinancialReviewConfirmationResult {
  const prepared = prepareFinancialEvidenceReview(
    trustedContext,
  );

  if (!prepared.ok) {
    return {
      ok: false,
      reason: "INVALID_CONTEXT",
    };
  }

  if (!isRecord(submittedConfirmation)) {
    return {
      ok: false,
      reason: "EXPLICIT_CONFIRMATION_REQUIRED",
    };
  }

  const keys = Object.keys(submittedConfirmation);

  if (
    keys.length !== 2 ||
    !Object.prototype.hasOwnProperty.call(
      submittedConfirmation,
      "confirmed",
    ) ||
    !Object.prototype.hasOwnProperty.call(
      submittedConfirmation,
      "reviewFingerprint",
    ) ||
    submittedConfirmation.confirmed !== true
  ) {
    return {
      ok: false,
      reason: "EXPLICIT_CONFIRMATION_REQUIRED",
    };
  }

  const supplied = submittedConfirmation.reviewFingerprint;

  if (
    typeof supplied !== "string" ||
    !SHA256.test(supplied)
  ) {
    return {
      ok: false,
      reason: "FINGERPRINT_MISMATCH",
    };
  }

  const expectedBytes = Buffer.from(
    prepared.fingerprint,
    "hex",
  );

  const suppliedBytes = Buffer.from(supplied, "hex");

  if (!timingSafeEqual(expectedBytes, suppliedBytes)) {
    return {
      ok: false,
      reason: "FINGERPRINT_MISMATCH",
    };
  }

  return {
    ok: true,
    status: "confirmation_bound_unverified",
    fingerprint: prepared.fingerprint,
  };
}