/**
 * ZION-ADM / 8-E.11-D.2-C.3-F
 *
 * Registro de uploads financeiros nao verificados.
 *
 * Este servico:
 * - chama somente a RPC sistemica autorizada;
 * - distingue rejeicao explicita de resultado incerto;
 * - nao aprova comprovantes;
 * - nao executa fechamento financeiro;
 * - nao remove arquivos do Storage.
 *
 * O sessionUserId deve vir exclusivamente da
 * autenticacao administrativa do servidor.
 */

import { createClient } from "@supabase/supabase-js";

import type {
  ValidatedFinancialEvidenceUpload,
} from "./zion-admin-financial-evidence-upload-validation";

const RPC_NAME =
  "zion_admin_register_financial_evidence_upload_by_system";

const DETERMINISTIC_REJECTIONS = new Set([
  "ZION_ADMIN_UPLOAD_INVALID_MONTH",
  "ZION_ADMIN_UPLOAD_INVALID_REVISION",
  "ZION_ADMIN_UPLOAD_ACTOR_REQUIRED",
  "ZION_ADMIN_UPLOAD_INVALID_SOURCE",
  "ZION_ADMIN_UPLOAD_INVALID_SHA256",
  "ZION_ADMIN_UPLOAD_INVALID_SIZE",
  "ZION_ADMIN_UPLOAD_INVALID_MIME",
  "ZION_ADMIN_UPLOAD_INVALID_PATH",
  "ZION_ADMIN_UPLOAD_ACTOR_FORBIDDEN",
  "ZION_ADMIN_UPLOAD_PRECLOSURE_NOT_FOUND",
  "ZION_ADMIN_UPLOAD_STALE_REVISION",
  "ZION_ADMIN_UPLOAD_AUDIT_NOT_FOUND",
  "ZION_ADMIN_UPLOAD_MONTH_CLOSED",
  "ZION_ADMIN_UPLOAD_STORAGE_OBJECT_NOT_FOUND",
  "ZION_ADMIN_UPLOAD_STORAGE_SIZE_INVALID",
  "ZION_ADMIN_UPLOAD_STORAGE_SIZE_MISMATCH",
  "ZION_ADMIN_UPLOAD_STORAGE_MIME_MISMATCH",
  "ZION_ADMIN_UPLOAD_PATH_CONFLICT",
]);

export type FinancialEvidenceRegistrationOutcome =
  | "rejected"
  | "uncertain";

export class FinancialEvidenceRegistrationError extends Error {
  readonly outcome: FinancialEvidenceRegistrationOutcome;
  readonly reasonCode: string;

  constructor(
    outcome: FinancialEvidenceRegistrationOutcome,
    reasonCode: string,
  ) {
    super(reasonCode);
    this.name = "FinancialEvidenceRegistrationError";
    this.outcome = outcome;
    this.reasonCode = reasonCode;
  }
}

export type FinancialEvidenceRegistrationInput = {
  validated: ValidatedFinancialEvidenceUpload;
  storagePath: string;
  sessionUserId: string;
};

export type FinancialEvidenceRegistrationResult = {
  uploadId: number;
  status: "uploaded_unverified";
  verified: false;
};

function createSystemClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new FinancialEvidenceRegistrationError(
      "uncertain",
      "FINANCIAL_REGISTRATION_CONFIGURATION_UNAVAILABLE",
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function registerFinancialEvidenceUpload(
  input: FinancialEvidenceRegistrationInput,
): Promise<FinancialEvidenceRegistrationResult> {
  const client = createSystemClient();

  let response: Awaited<
    ReturnType<typeof client.rpc>
  >;

  try {
    response = await client.rpc(RPC_NAME, {
      p_month: input.validated.month,
      p_preclosure_revision:
        input.validated.preclosureRevision,
      p_source: input.validated.source,
      p_storage_path: input.storagePath,
      p_document_sha256: input.validated.sha256,
      p_mime_type: input.validated.mimeType,
      p_size_bytes: input.validated.sizeBytes,
      p_uploaded_by_user_id: input.sessionUserId,
    });
  } catch {
    // Falha de transporte: nao sabemos se houve commit.
    throw new FinancialEvidenceRegistrationError(
      "uncertain",
      "FINANCIAL_REGISTRATION_OUTCOME_UNKNOWN",
    );
  }

  if (response.error) {
    const message = response.error.message.trim();

    if (DETERMINISTIC_REJECTIONS.has(message)) {
      throw new FinancialEvidenceRegistrationError(
        "rejected",
        message,
      );
    }

    // Erros desconhecidos nao autorizam exclusao.
    throw new FinancialEvidenceRegistrationError(
      "uncertain",
      "FINANCIAL_REGISTRATION_OUTCOME_UNKNOWN",
    );
  }

  const data: unknown = response.data;

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    throw new FinancialEvidenceRegistrationError(
      "uncertain",
      "FINANCIAL_REGISTRATION_INVALID_RESPONSE",
    );
  }

  const result = data as Record<string, unknown>;

  if (
    result.ok !== true ||
    result.status !== "uploaded_unverified" ||
    result.verified !== false ||
    typeof result.uploadId !== "number" ||
    !Number.isSafeInteger(result.uploadId) ||
    result.uploadId < 1
  ) {
    throw new FinancialEvidenceRegistrationError(
      "uncertain",
      "FINANCIAL_REGISTRATION_INVALID_RESPONSE",
    );
  }

  return {
    uploadId: result.uploadId,
    status: "uploaded_unverified",
    verified: false,
  };
}