/**
 * Confirmacao administrativa de revisao financeira Meta.
 *
 * Rele dados canonicos e integridade do documento antes de
 * comparar a confirmacao explicita com o contexto atual.
 *
 * NAO autentica faturamento Meta.
 * NAO grava evidencias nem executa fechamento.
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

type Dependencies = {
  authorize: typeof resolveZionAdminApiAccess;
  createDb: typeof createServiceSupabaseClient;
  prepare: typeof buildFinancialEvidenceReviewPreparation;
  confirm: typeof assessFinancialEvidenceReviewConfirmation;
};

const MAX_BODY_BYTES = 4096;
const SHA = /^[0-9a-f]{64}$/;

function response(status: number, error: string): Response {
  return Response.json(
    { ok: false, error },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function record(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function keys(
  value: unknown,
  required: readonly string[],
): value is Record<string, unknown> {
  return record(value) &&
    Object.keys(value).length === required.length &&
    required.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key)
    );
}

type ConfirmRequest = {
  month: string;
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

function validBody(
  value: unknown,
): value is ConfirmRequest {
  if (!keys(value, [
    "month",
    "uploadId",
    "proofDraft",
    "confirmation",
  ])) {
    return false;
  }

  if (
    typeof value.month !== "string" ||
    !/^(?:20[2-9]\d|2100)-(?:0[1-9]|1[0-2])-01$/.test(
      value.month,
    ) ||
    typeof value.uploadId !== "number" ||
    !Number.isSafeInteger(value.uploadId) ||
    value.uploadId < 1
  ) {
    return false;
  }

  const draft = value.proofDraft;
  const confirmation = value.confirmation;

  return keys(draft, [
    "source",
    "proofType",
    "amountBrlCents",
    "amountUsd",
  ]) &&
    draft.source === "meta_invoice" &&
    (
      draft.proofType === "supplier_invoice" ||
      draft.proofType === "supplier_statement"
    ) &&
    typeof draft.amountBrlCents === "number" &&
    Number.isSafeInteger(draft.amountBrlCents) &&
    draft.amountBrlCents >= 0 &&
    draft.amountUsd === null &&
    keys(confirmation, [
      "confirmed",
      "reviewFingerprint",
    ]) &&
    confirmation.confirmed === true &&
    typeof confirmation.reviewFingerprint === "string" &&
    SHA.test(confirmation.reviewFingerprint);
}

async function boundedJson(
  request: Request,
): Promise<unknown> {
  const length = request.headers.get("content-length");

  if (
    length !== null &&
    (!/^\d+$/.test(length) ||
      Number(length) > MAX_BODY_BYTES)
  ) {
    throw new Error("INVALID_LENGTH");
  }

  if (!request.body) {
    throw new Error("INVALID_BODY");
  }

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    while (true) {
      const step = await reader.read();
      if (step.done) break;

      total += step.value.byteLength;

      if (total > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error("BODY_TOO_LARGE");
      }

      chunks.push(Buffer.from(step.value));
    }

    return JSON.parse(
      Buffer.concat(chunks).toString("utf8"),
    ) as unknown;
  } finally {
    reader.releaseLock();
  }
}

export function createFinancialEvidenceReviewConfirmHandler(
  overrides: Partial<Dependencies> = {},
) {
  const deps: Dependencies = {
    authorize:
      overrides.authorize ?? resolveZionAdminApiAccess,
    createDb:
      overrides.createDb ?? createServiceSupabaseClient,
    prepare:
      overrides.prepare ??
      buildFinancialEvidenceReviewPreparation,
    confirm:
      overrides.confirm ??
      assessFinancialEvidenceReviewConfirmation,
  };

  return async function POST(
    request: Request,
  ): Promise<Response> {
    let access: Awaited<ReturnType<
      typeof resolveZionAdminApiAccess
    >>;

    try {
      access = await deps.authorize();
    } catch {
      return response(503, "FINANCIAL_CONFIRM_UNAVAILABLE");
    }

    if (!access.ok) {
      const denied =
        createZionAdminApiDeniedResponse(access);

      denied.headers.set("Cache-Control", "no-store");
      return denied;
    }

    if (!assessFinancialEvidenceReviewAccess(access).ok) {
      return response(
        403,
        "FINANCIAL_CONFIRM_OWNER_REQUIRED",
      );
    }

    let origin: string;

    try {
      origin = new URL(request.url).origin;
    } catch {
      return response(403, "FINANCIAL_CONFIRM_ORIGIN_DENIED");
    }

    if (
      request.headers.get("origin") !== origin ||
      (
        request.headers.get("sec-fetch-site") !== null &&
        request.headers.get("sec-fetch-site") !== "same-origin"
      )
    ) {
      return response(403, "FINANCIAL_CONFIRM_ORIGIN_DENIED");
    }

    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers.get("content-type") ?? "",
    )) {
      return response(415, "FINANCIAL_CONFIRM_JSON_REQUIRED");
    }

    let body: unknown;

    try {
      body = await boundedJson(request);
    } catch {
      return response(400, "FINANCIAL_CONFIRM_INVALID_BODY");
    }

    if (!validBody(body)) {
      return response(400, "FINANCIAL_CONFIRM_INVALID_REQUEST");
    }

    try {
      // A leitura atual confere upload, revisao e SHA.
      // Nenhum contexto financeiro do navegador e confiado.
      const prepared = await deps.prepare(
        access,
        {
          month: body.month,
          uploadId: body.uploadId,
          proofDraft: body.proofDraft,
        },
        deps.createDb(),
      );

      if (!prepared.ok) {
        return response(
          prepared.reason === "PREPARATION_UNAVAILABLE"
            ? 503
            : 409,
          "FINANCIAL_CONFIRM_REVIEW_STALE",
        );
      }

      if (
        prepared.context.source !== "meta_invoice" ||
        prepared.context.amountUsd !== null ||
        prepared.context.amountBrlCents !==
          body.proofDraft.amountBrlCents
      ) {
        return response(
          409,
          "FINANCIAL_CONFIRM_REVIEW_MISMATCH",
        );
      }

      const confirmed = deps.confirm(
        prepared.context,
        body.confirmation,
      );

      if (!confirmed.ok) {
        return response(
          409,
          "FINANCIAL_CONFIRM_REVIEW_MISMATCH",
        );
      }

      // Confirmacao vinculada, mas NAO financeira.
      // Nenhuma chamada de escrita ocorre aqui.
      return Response.json(
        {
          ok: true,
          status: "confirmation_bound_unverified",
          reviewFingerprint: confirmed.fingerprint,
          financialAuthority: "unverified",
          finalClosureAuthorized: false,
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    } catch {
      return response(503, "FINANCIAL_CONFIRM_UNAVAILABLE");
    }
  };
}