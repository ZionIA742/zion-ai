/**
 * ZION-ADM - Revisao conjunta de documentos Meta.
 *
 * Reutiliza a verificacao privada de bytes e o
 * fingerprint administrativo para cada documento.
 *
 * Nao autentica a conta financeira informada.
 * Nao comprova o valor faturado pela Meta.
 * Nao persiste aprovacao ou libera fechamento.
 */
import {
  resolveZionAdminApiAccess,
} from "./zion-admin-api-access";
import {
  createZionAdminApiDeniedResponse,
} from "./zion-admin-api-response";
import {
  createServiceSupabaseClient,
} from "./zion-account-provisioning";
import {
  assessFinancialEvidenceReviewAccess,
} from "./zion-admin-financial-evidence-review-access";
import {
  buildFinancialEvidenceReviewPreparation,
} from "./zion-admin-financial-evidence-review-preparation";
import {
  assessFinancialEvidenceReviewConfirmation,
} from "./zion-admin-financial-evidence-review-confirmation";

import {
  readMetaCandidateAccounts,
} from "./zion-admin-meta-candidate-account-reader";

import {
  assessMetaCandidateMonthlyCoverage,
} from "./zion-admin-meta-candidate-monthly-coverage-adapter";

type Dependencies = {
  authorize: typeof resolveZionAdminApiAccess;
  createDb: typeof createServiceSupabaseClient;
  prepare: typeof buildFinancialEvidenceReviewPreparation;
  confirm: typeof assessFinancialEvidenceReviewConfirmation;
  readCandidateAccounts: typeof readMetaCandidateAccounts;
  assessCandidateCoverage: typeof assessMetaCandidateMonthlyCoverage;
};

const MAX_BYTES = 32768;
const MAX_DOCUMENTS = 20;
const MAX_CENTS = 100000000000;
const MONTH = /^(?:20[2-9]\d|2100)-(?:0[1-9]|1[0-2])-01$/;
const ACCOUNT = /^[A-Za-z0-9:_-]{1,128}$/;
const SHA = /^[0-9a-f]{64}$/;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function exact(
  value: unknown,
  names: readonly string[],
): value is Record<string, unknown> {
  return isRecord(value) &&
    Object.keys(value).length === names.length &&
    names.every((name) =>
      Object.prototype.hasOwnProperty.call(value, name)
    );
}

type ReviewItem = {
  financialAccountType: "messaging_account" | "business_portfolio";
  financialAccountId: string;
  documentReference: string;
  recordKind: "amount_record" | "not_applicable_record";
  uploadId: number;
  proofDraft: {
    source: "meta_invoice";
    proofType: "supplier_invoice" | "supplier_statement";
    amountBrlCents: number;
    amountUsd: null;
  };
  confirmation: {
    confirmed: true;
    reviewFingerprint: string;
  };
};

function validItem(value: unknown): value is ReviewItem {
  if (!exact(value, [
    "financialAccountType",
    "financialAccountId",
    "documentReference",
    "recordKind",
    "uploadId",
    "proofDraft",
    "confirmation",
  ])) {
    return false;
  }

  const draft = value.proofDraft;
  const confirmation = value.confirmation;

  if (
    !exact(draft, [
      "source",
      "proofType",
      "amountBrlCents",
      "amountUsd",
    ]) ||
    !exact(confirmation, [
      "confirmed",
      "reviewFingerprint",
    ])
  ) {
    return false;
  }

  return (
    (
      value.financialAccountType === "messaging_account" ||
      value.financialAccountType === "business_portfolio"
    ) &&
    typeof value.financialAccountId === "string" &&
    ACCOUNT.test(value.financialAccountId) &&
    typeof value.documentReference === "string" &&
    value.documentReference.length >= 3 &&
    value.documentReference.length <= 512 &&
    value.documentReference.trim() === value.documentReference &&
    !/[\x00-\x1f\x7f]/.test(value.documentReference) &&
    (
      value.recordKind === "amount_record" ||
      value.recordKind === "not_applicable_record"
    ) &&
    typeof value.uploadId === "number" &&
    Number.isSafeInteger(value.uploadId) &&
    value.uploadId > 0 &&
    draft.source === "meta_invoice" &&
    (
      draft.proofType === "supplier_invoice" ||
      draft.proofType === "supplier_statement"
    ) &&
    typeof draft.amountBrlCents === "number" &&
    Number.isSafeInteger(draft.amountBrlCents) &&
    draft.amountBrlCents >= 0 &&
    draft.amountBrlCents <= MAX_CENTS &&
    draft.amountUsd === null &&
    (
      value.recordKind !== "not_applicable_record" ||
      (
        draft.amountBrlCents === 0 &&
        draft.proofType === "supplier_statement"
      )
    ) &&
    confirmation.confirmed === true &&
    typeof confirmation.reviewFingerprint === "string" &&
    SHA.test(confirmation.reviewFingerprint)
  );
}

async function readJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");

  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)
  ) {
    throw new Error("INVALID_SIZE");
  }

  if (!request.body) throw new Error("EMPTY_BODY");

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;

  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;

      size += part.value.byteLength;

      if (size > MAX_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error("BODY_TOO_LARGE");
      }

      chunks.push(Buffer.from(part.value));
    }

    return JSON.parse(
      Buffer.concat(chunks).toString("utf8"),
    ) as unknown;
  } finally {
    reader.releaseLock();
  }
}

function reply(status: number, payload: unknown): Response {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function denied(status: number, error: string): Response {
  return reply(status, { ok: false, error });
}

export function createMetaDocumentBatchReviewHandler(
  overrides: Partial<Dependencies> = {},
) {
  const deps: Dependencies = {
    authorize: overrides.authorize ?? resolveZionAdminApiAccess,
    createDb: overrides.createDb ?? createServiceSupabaseClient,
    prepare: overrides.prepare ??
      buildFinancialEvidenceReviewPreparation,
    confirm: overrides.confirm ??
      assessFinancialEvidenceReviewConfirmation,
    readCandidateAccounts:
      overrides.readCandidateAccounts ??
      readMetaCandidateAccounts,
    assessCandidateCoverage:
      overrides.assessCandidateCoverage ??
      assessMetaCandidateMonthlyCoverage,
  };

  return async function POST(request: Request): Promise<Response> {
    let access: Awaited<
      ReturnType<typeof resolveZionAdminApiAccess>
    >;

    try {
      access = await deps.authorize();
    } catch {
      return denied(503, "META_BATCH_UNAVAILABLE");
    }

    if (!access.ok) {
      const result = createZionAdminApiDeniedResponse(access);
      result.headers.set("Cache-Control", "no-store");
      return result;
    }

    if (!assessFinancialEvidenceReviewAccess(access).ok) {
      return denied(403, "META_BATCH_OWNER_REQUIRED");
    }

    let origin: string;

    try {
      origin = new URL(request.url).origin;
    } catch {
      return denied(403, "META_BATCH_ORIGIN_DENIED");
    }

    if (
      request.headers.get("origin") !== origin ||
      (
        request.headers.get("sec-fetch-site") !== null &&
        request.headers.get("sec-fetch-site") !== "same-origin"
      )
    ) {
      return denied(403, "META_BATCH_ORIGIN_DENIED");
    }

    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers.get("content-type") ?? "",
    )) {
      return denied(415, "META_BATCH_JSON_REQUIRED");
    }

    let input: unknown;

    try {
      input = await readJson(request);
    } catch {
      return denied(400, "META_BATCH_INVALID_JSON");
    }

    if (
      !exact(input, ["month", "items"]) ||
      typeof input.month !== "string" ||
      !MONTH.test(input.month) ||
      !Array.isArray(input.items) ||
      input.items.length < 1 ||
      input.items.length > MAX_DOCUMENTS ||
      !input.items.every(validItem)
    ) {
      return denied(400, "META_BATCH_INVALID_REQUEST");
    }

    const month = input.month;
    const items: ReviewItem[] = input.items;

    const uploadIds = new Set<number>();
    const documentKeys = new Set<string>();

    let total = 0;
    let revision: number | null = null;

    const lines: Array<{
      financialAccountType: string;
      financialAccountId: string;
      documentReference: string;
      documentUploadId: number;
      documentSha256: string;
      reviewFingerprint: string;
      recordKind: string;
      amountBrlCents: number;
    }> = [];

    try {
      const db = deps.createDb();

      for (const item of items) {
        const documentKey = JSON.stringify([
          item.financialAccountType,
          item.financialAccountId,
          item.documentReference,
        ]);

        if (
          uploadIds.has(item.uploadId) ||
          documentKeys.has(documentKey)
        ) {
          return denied(409, "META_BATCH_DUPLICATE_DOCUMENT");
        }

        uploadIds.add(item.uploadId);
        documentKeys.add(documentKey);

        const prepared = await deps.prepare(
          access,
          {
            month,
            uploadId: item.uploadId,
            proofDraft: item.proofDraft,
          },
          db,
        );

        if (!prepared.ok) {
          return denied(
            prepared.reason === "PREPARATION_UNAVAILABLE"
              ? 503
              : 409,
            "META_BATCH_REVIEW_NOT_READY",
          );
        }

        const context = prepared.context;

        if (
          context.source !== "meta_invoice" ||
          context.month !== month ||
          context.uploadId !== item.uploadId ||
          context.amountBrlCents !==
            item.proofDraft.amountBrlCents ||
          context.amountUsd !== null ||
          context.proofType !== item.proofDraft.proofType ||
          (
            revision !== null &&
            context.preclosureRevision !== revision
          )
        ) {
          return denied(409, "META_BATCH_CONTEXT_MISMATCH");
        }

        const confirmed = deps.confirm(
          context,
          item.confirmation,
        );

        if (
          !confirmed.ok ||
          confirmed.fingerprint !== prepared.reviewFingerprint
        ) {
          return denied(409, "META_BATCH_FINGERPRINT_MISMATCH");
        }

        revision = context.preclosureRevision;

        total += context.amountBrlCents;

        if (
          !Number.isSafeInteger(total) ||
          total > MAX_CENTS
        ) {
          return denied(409, "META_BATCH_TOTAL_OVERFLOW");
        }

        lines.push({
          financialAccountType: item.financialAccountType,
          financialAccountId: item.financialAccountId,
          documentReference: item.documentReference,
          documentUploadId: context.uploadId,
          documentSha256: context.documentSha256,
          reviewFingerprint: confirmed.fingerprint,
          recordKind: item.recordKind,
          amountBrlCents: context.amountBrlCents,
        });
      }

      // Cobertura candidata, lida exclusivamente do banco.
      // Nao e prova de faturamento ou cobertura oficial.
      const census = await deps.readCandidateAccounts(db);

      const reviewed = new Set(
        lines.map((line) =>
          JSON.stringify([
            line.financialAccountType,
            line.financialAccountId,
          ])
        ),
      );

      let accountCoverage: {
        status: "candidate_covered_unverified" | "unknown";
        scope: "current_active_integrations";
        expectedAccounts: number | null;
        reviewedAccounts: number;
        missingCandidateAccounts: number | null;
        unmatchedCandidateAccounts: number | null;
      } = {
        status: "unknown",
        scope: "current_active_integrations",
        expectedAccounts: null,
        reviewedAccounts: reviewed.size,
        missingCandidateAccounts: null,
        unmatchedCandidateAccounts: null,
      };

      if (census.ok) {
        const expected = new Set(
          census.accounts.map((account) =>
            JSON.stringify([
              account.financialAccountType,
              account.financialAccountId,
            ])
          ),
        );

        const missing = [...expected].filter(
          (account) => !reviewed.has(account),
        );

        const unmatched = [...reviewed].filter(
          (account) => !expected.has(account),
        );

        accountCoverage = {
          status: missing.length === 0 &&
            unmatched.length === 0
            ? "candidate_covered_unverified"
            : "unknown",
          scope: census.scope,
          expectedAccounts: expected.size,
          reviewedAccounts: reviewed.size,
          missingCandidateAccounts: missing.length,
          unmatchedCandidateAccounts: unmatched.length,
        };
      }

      const monthlyCandidateCoverage = deps.assessCandidateCoverage({
        month,
        census: census.ok
          ? {
              ok: true,
              accounts: census.accounts,
            }
          : {
              ok: false,
            },
        lines: lines.map((line) => ({
          financialAccountType: line.financialAccountType,
          financialAccountId: line.financialAccountId,
          recordKind: line.recordKind,
          amountBrlCents: line.amountBrlCents,
        })),
      });

      return reply(200, {
        ok: true,
        status: "administrative_confirmation_unverified",
        month,
        preclosureRevision: revision,
        candidateTotalBrlCents: total,
        accountAuthority: "unverified",
        accountCoverage,
        monthlyCandidateCoverage: {
          ...monthlyCandidateCoverage,
          accountCensusScope: "current_active_integrations",
          historicalCoverageVerified: false,
          registrationAuthorized: false,
          finalClosureAuthorized: false,
        },
        financialAuthority: "unverified",
        registrationAuthorized: false,
        finalClosureAuthorized: false,
        lines,
      });
    } catch {
      return denied(503, "META_BATCH_UNAVAILABLE");
    }
  };
}