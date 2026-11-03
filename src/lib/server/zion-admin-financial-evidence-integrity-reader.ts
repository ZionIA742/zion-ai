/**
 * ZION-ADM / 8-E.11-D.3-B.2-C.2
 *
 * Integra:
 * 1. Leitura canonica do upload e revisao corrente.
 * 2. Vinculo estrutural com a proposta financeira.
 * 3. Integridade dos bytes do documento privado.
 *
 * Nao abre rota, nao autentica o administrador,
 * nao reconcilia cobrancas, nao aprova documentos
 * e nao autoriza fechamento financeiro.
 *
 * O chamador devera autenticar o administrador.
 * A futura RPC de aprovacao devera revalidar os
 * dados na mesma transacao de escrita.
 */

import type {
  createServiceSupabaseClient,
} from "@/lib/server/zion-account-provisioning";

import {
  readFinancialEvidenceBinding,
} from "./zion-admin-financial-evidence-binding-reader";

import {
  verifyPrivateFinancialEvidence,
} from "./zion-admin-financial-evidence-storage-integrity";

type EvidenceDb = Pick<
  ReturnType<typeof createServiceSupabaseClient>,
  "from" | "storage"
>;

export async function inspectRegisteredFinancialEvidence(
  input: {
    month: unknown;
    uploadId: unknown;
    proofDraft: unknown;
  },
  db: EvidenceDb,
) {
  const linked = await readFinancialEvidenceBinding(
    input,
    db,
  );

  if (!linked.ok) {
    return {
      ok: false as const,
      phase: "binding" as const,
      error: linked.error,
      reason: linked.reason ?? null,
    };
  }

  const binding = linked.binding;

  // Caminho, SHA e tamanho sao provenientes do
  // registro canonico conferido pelo leitor.
  const integrity = await verifyPrivateFinancialEvidence(
    {
      bucket: "zion-admin-financial-evidence",
      path: binding.storagePath,
      expectedSha256: binding.documentSha256,
      expectedSizeBytes: binding.sizeBytes,
    },
    db.storage,
  );

  if (!integrity.ok) {
    return {
      ok: false as const,
      phase: "storage" as const,
      error: integrity.reason,
    };
  }

  return {
    ok: true as const,
    status: "integrity_confirmed_unverified" as const,
    uploadId: binding.uploadId,
    source: binding.source,
    documentSha256: integrity.sha256,
    sizeBytes: integrity.sizeBytes,
    candidate: binding.candidate,
  };
}