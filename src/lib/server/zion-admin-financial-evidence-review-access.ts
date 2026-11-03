/**
 * ZION-ADM / 8-E.11-D.3-C.3-D
 *
 * Verifica exclusivamente a elegibilidade do
 * administrador para iniciar revisao financeira.
 *
 * NAO comprova leitura humana do documento.
 * NAO aprova comprovante.
 * NAO registra evidencia.
 * NAO chama o Supabase.
 * NAO autoriza fechamento financeiro.
 *
 * O endpoint futuro devera:
 * - obter access pelo resolver autenticado;
 * - vincular confirmacao explicita ao documento
 *   e aos valores realmente apresentados;
 * - validar os bytes privados novamente;
 * - revalidar o ator e a revisao pela RPC.
 */

import type {
  ZionAdminApiAccessResult,
} from "./zion-admin-api-access";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FinancialReviewAccessResult =
  | {
      ok: true;
      status: "eligible_for_manual_review";
      actorUserId: string;
    }
  | {
      ok: false;
      reason:
        | "ACCESS_DENIED"
        | "OWNER_REQUIRED"
        | "CAPABILITY_REQUIRED"
        | "SESSION_IDENTITY_MISMATCH";
    };

export function assessFinancialEvidenceReviewAccess(
  access: ZionAdminApiAccessResult,
): FinancialReviewAccessResult {
  if (!access || access.ok !== true) {
    return {
      ok: false,
      reason: "ACCESS_DENIED",
    };
  }

  const resolution = access.resolution;

  if (
    !resolution ||
    resolution.status !== "zion_admin_allowed"
  ) {
    return {
      ok: false,
      reason: "ACCESS_DENIED",
    };
  }

  // A capacidade geral manage_accounts nao concede
  // por si so autoridade financeira.
  if (resolution.role !== "owner") {
    return {
      ok: false,
      reason: "OWNER_REQUIRED",
    };
  }

  if (
    !Array.isArray(resolution.capabilities) ||
    !resolution.capabilities.includes("manage_accounts")
  ) {
    return {
      ok: false,
      reason: "CAPABILITY_REQUIRED",
    };
  }

  // Nunca utilizar um actorUserId recebido do body.
  // O UUID precisa vir da sessao autenticada.
  const sessionUserId = access.sessionUserId;

  if (
    typeof sessionUserId !== "string" ||
    !UUID.test(sessionUserId) ||
    typeof resolution.sessionUserId !== "string" ||
    resolution.sessionUserId !== sessionUserId
  ) {
    return {
      ok: false,
      reason: "SESSION_IDENTITY_MISMATCH",
    };
  }

  return {
    ok: true,
    status: "eligible_for_manual_review",
    actorUserId: sessionUserId,
  };
}