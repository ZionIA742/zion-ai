/**
 * ZION-ADM / 8-E.11-D.3-B.2-B
 *
 * Leitura das autoridades canonicas de upload
 * e revisao corrente de pre-fechamento.
 *
 * USO EXCLUSIVO NO SERVIDOR, apos autenticacao
 * administrativa pelo chamador.
 *
 * Nao cria credenciais, nao abre endpoint,
 * nao verifica bytes nem aprova comprovantes.
 *
 * Estas leituras nao sao transacionais.
 * A futura RPC deve revalidar todas as autoridades.
 */

import type {
  createServiceSupabaseClient,
} from "@/lib/server/zion-account-provisioning";

import {
  assessFinancialProofDraft,
} from "./zion-admin-financial-evidence-verification-draft";

import {
  assessFinancialEvidenceUploadBinding,
  type FinancialEvidenceBindingAssessment,
} from "./zion-admin-financial-evidence-binding";

type ReaderDb = Pick<
  ReturnType<typeof createServiceSupabaseClient>,
  "from"
>;

type ConfirmedBinding = Extract<
  FinancialEvidenceBindingAssessment,
  { ok: true }
>;

export type FinancialEvidenceBindingReadResult =
  | {
      ok: true;
      binding: ConfirmedBinding;
    }
  | {
      ok: false;
      error:
        | "INVALID_REQUEST"
        | "UPLOAD_NOT_FOUND"
        | "PRECLOSURE_NOT_FOUND"
        | "READ_UNAVAILABLE"
        | "BINDING_REJECTED";
      reason?: string;
    };

export async function readFinancialEvidenceBinding(
  input: {
    month: unknown;
    uploadId: unknown;
    proofDraft: unknown;
  },
  db: ReaderDb,
): Promise<FinancialEvidenceBindingReadResult> {
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.month !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(input.month) ||
    Number(input.month.slice(0, 4)) < 2020 ||
    Number(input.month.slice(0, 4)) > 2100 ||
    typeof input.uploadId !== "number" ||
    !Number.isSafeInteger(input.uploadId) ||
    input.uploadId < 1
  ) {
    return { ok: false, error: "INVALID_REQUEST" };
  }

  const draft = assessFinancialProofDraft(
    input.proofDraft,
  );

  if (!draft.ok) {
    return { ok: false, error: "INVALID_REQUEST" };
  }

  try {
    // Identidade do upload: registro persistido,
    // nunca objeto montado a partir do formulario.
    const uploaded = await db
      .from("zion_admin_financial_evidence_uploads")
      .select(
        "id,month,preclosure_revision,source," +
        "storage_bucket,storage_path,document_sha256," +
        "mime_type,size_bytes,uploaded_by_user_id,uploaded_at",
      )
      .eq("id", input.uploadId)
      .maybeSingle();

    if (uploaded.error) {
      return { ok: false, error: "READ_UNAVAILABLE" };
    }

    if (!uploaded.data) {
      return { ok: false, error: "UPLOAD_NOT_FOUND" };
    }

    // A revisao corrente e lida da projecao atual.
    // Nao utilizar max(revision) do historico.
    const period = await db
      .from("zion_admin_monthly_preclosures")
      .select("month,revision")
      .eq("month", input.month)
      .maybeSingle();

    if (period.error) {
      return { ok: false, error: "READ_UNAVAILABLE" };
    }

    if (!period.data) {
      return {
        ok: false,
        error: "PRECLOSURE_NOT_FOUND",
      };
    }

    if (period.data.month !== input.month) {
      return {
        ok: false,
        error: "BINDING_REJECTED",
        reason: "PRECLOSURE_MONTH_MISMATCH",
      };
    }

    const binding = assessFinancialEvidenceUploadBinding({
      month: input.month,
      currentPreclosureRevision:
        period.data.revision,
      proofDraft: input.proofDraft,
      uploadRecord: uploaded.data,
    });

    if (!binding.ok) {
      return {
        ok: false,
        error: "BINDING_REJECTED",
        reason: binding.reason,
      };
    }

    return { ok: true, binding };
  } catch {
    // Erros inesperados nao confirmam um documento.
    return { ok: false, error: "READ_UNAVAILABLE" };
  }
}