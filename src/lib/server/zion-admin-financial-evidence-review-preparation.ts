/**
 * ZION-ADM / 8-E.11-D.3-C.3-E.2-A
 *
 * Prepara uma revisao financeira SOMENTE LEITURA.
 *
 * Reutiliza:
 * - autenticacao administrativa ja resolvida;
 * - vinculacao canonica com upload e pre-fechamento;
 * - conferencia SHA-256 dos bytes privados;
 * - fingerprint do contexto exato.
 *
 * NAO:
 * - abre endpoint;
 * - confirma acao humana;
 * - aprova documento;
 * - escreve em banco;
 * - executa fechamento.
 *
 * O resultado pode ficar obsoleto. Uma futura
 * confirmacao devera reler tudo e revalidar
 * suas autoridades antes de qualquer escrita.
 */

import type {
  createServiceSupabaseClient,
} from "./zion-account-provisioning";

import type {
  ZionAdminApiAccessResult,
} from "./zion-admin-api-access";

import {
  assessFinancialEvidenceReviewAccess,
} from "./zion-admin-financial-evidence-review-access";

import {
  readFinancialEvidenceBinding,
} from "./zion-admin-financial-evidence-binding-reader";

import {
  verifyPrivateFinancialEvidence,
} from "./zion-admin-financial-evidence-storage-integrity";

import {
  prepareFinancialEvidenceReview,
} from "./zion-admin-financial-evidence-review-confirmation";

type EvidenceDb = Pick<
  ReturnType<typeof createServiceSupabaseClient>,
  "from" | "storage"
>;

type Dependencies = {
  readBinding: typeof readFinancialEvidenceBinding;
  verifyStorage: typeof verifyPrivateFinancialEvidence;
  createFingerprint: typeof prepareFinancialEvidenceReview;
};

const BUCKET = "zion-admin-financial-evidence";

const INPUT_KEYS = [
  "month",
  "uploadId",
  "proofDraft",
] as const;

type ReviewContext = {
  actorUserId: string;
  month: string;
  preclosureRevision: number;
  uploadId: number;
  source: string;
  proofType: string;
  amountBrlCents: number | null;
  amountUsd: string | null;
  documentSha256: string;
  sizeBytes: number;
  storagePath: string;
};

export type FinancialReviewPreparationResult =
  | {
      ok: true;
      status: "prepared_unverified";
      reviewFingerprint: string;
      context: ReviewContext;
    }
  | {
      ok: false;
      reason:
        | "ACCESS_DENIED"
        | "BINDING_REJECTED"
        | "INTEGRITY_REJECTED"
        | "CONTEXT_REJECTED"
        | "PREPARATION_UNAVAILABLE";
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

export async function buildFinancialEvidenceReviewPreparation(
  access: ZionAdminApiAccessResult,
  input: unknown,
  db: EvidenceDb,
  overrides: Partial<Dependencies> = {},
): Promise<FinancialReviewPreparationResult> {
  // Nunca confiar em identidade passada no input.
  const actor = assessFinancialEvidenceReviewAccess(access);

  if (!actor.ok) {
    return { ok: false, reason: "ACCESS_DENIED" };
  }

  if (!isRecord(input)) {
    return { ok: false, reason: "BINDING_REJECTED" };
  }

  const keys = Object.keys(input);

  if (
    keys.length !== INPUT_KEYS.length ||
    !INPUT_KEYS.every((key) =>
      Object.prototype.hasOwnProperty.call(input, key)
    )
  ) {
    return { ok: false, reason: "BINDING_REJECTED" };
  }

  const deps: Dependencies = {
    readBinding:
      overrides.readBinding ?? readFinancialEvidenceBinding,
    verifyStorage:
      overrides.verifyStorage ?? verifyPrivateFinancialEvidence,
    createFingerprint:
      overrides.createFingerprint ?? prepareFinancialEvidenceReview,
  };

  try {
    const linked = await deps.readBinding(
      {
        month: input.month,
        uploadId: input.uploadId,
        proofDraft: input.proofDraft,
      },
      db,
    );

    if (!linked.ok) {
      return {
        ok: false,
        reason: "BINDING_REJECTED",
      };
    }

    const binding = linked.binding;

    // O binding ja validou a revisao corrente contra
    // o registro canonico. Extraimos a revisao do
    // caminho validado, sem confiar em campo do browser.
    const segments = binding.storagePath.split("/");

    if (
      typeof input.month !== "string" ||
      segments.length !== 5 ||
      segments[0] !== "unverified" ||
      segments[1] !== input.month ||
      segments[3] !== binding.source ||
      !/^[1-9][0-9]{0,9}$/.test(segments[2]) ||
      binding.candidate.source !== binding.source
    ) {
      return {
        ok: false,
        reason: "CONTEXT_REJECTED",
      };
    }

    const revision = Number(segments[2]);

    if (
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      revision > 2147483647
    ) {
      return {
        ok: false,
        reason: "CONTEXT_REJECTED",
      };
    }

    const integrity = await deps.verifyStorage(
      {
        bucket: BUCKET,
        path: binding.storagePath,
        expectedSha256: binding.documentSha256,
        expectedSizeBytes: binding.sizeBytes,
      },
      db.storage,
    );

    if (
      !integrity.ok ||
      integrity.sha256 !== binding.documentSha256 ||
      integrity.sizeBytes !== binding.sizeBytes
    ) {
      return {
        ok: false,
        reason: "INTEGRITY_REJECTED",
      };
    }

    const context: ReviewContext = {
      actorUserId: actor.actorUserId,
      month: input.month,
      preclosureRevision: revision,
      uploadId: binding.uploadId,
      source: binding.source,
      proofType: binding.candidate.proofType,
      amountBrlCents: binding.candidate.amountBrlCents,
      amountUsd: binding.candidate.amountUsd,
      documentSha256: integrity.sha256,
      sizeBytes: integrity.sizeBytes,
      storagePath: binding.storagePath,
    };

    const prepared = deps.createFingerprint(context);

    if (!prepared.ok) {
      return {
        ok: false,
        reason: "CONTEXT_REJECTED",
      };
    }

    return {
      ok: true,
      status: "prepared_unverified",
      reviewFingerprint: prepared.fingerprint,
      context,
    };
  } catch {
    // Nenhuma excecao pode converter falha em aprovacao.
    return {
      ok: false,
      reason: "PREPARATION_UNAVAILABLE",
    };
  }
}