/**
 * ZION-ADM / 8-E.11-D.3-C.3-E.2-B
 *
 * Endpoint de PREPARACAO, exclusivamente leitura.
 *
 * Nao aprova documentos, nao registra evidencia
 * financeira, nao chama RPC de escrita e nao fecha
 * competencias.
 *
 * O fingerprint identifica uma proposta, mas nao
 * comprova visualizacao ou revisao humana.
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

type Dependencies = {
  authorize: typeof resolveZionAdminApiAccess;
  createDb: typeof createServiceSupabaseClient;
  prepare: typeof buildFinancialEvidenceReviewPreparation;
};

const MAX_BODY_BYTES = 4096;

function json(
  payload: unknown,
  status: number,
): Response {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function exactKeys(
  value: unknown,
  required: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;

  const keys = Object.keys(value);

  return (
    keys.length === required.length &&
    required.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key)
    )
  );
}

type BodyResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      status: number;
      error: string;
    };

async function readBoundedJson(
  request: Request,
): Promise<BodyResult> {
  const contentType =
    request.headers.get("content-type") ?? "";

  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      contentType,
    )
  ) {
    return {
      ok: false,
      status: 415,
      error: "FINANCIAL_REVIEW_JSON_REQUIRED",
    };
  }

  const contentLength =
    request.headers.get("content-length");

  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      return {
        ok: false,
        status: 400,
        error: "FINANCIAL_REVIEW_INVALID_LENGTH",
      };
    }

    if (Number(contentLength) > MAX_BODY_BYTES) {
      return {
        ok: false,
        status: 413,
        error: "FINANCIAL_REVIEW_BODY_TOO_LARGE",
      };
    }
  }

  if (!request.body) {
    return {
      ok: false,
      status: 400,
      error: "FINANCIAL_REVIEW_INVALID_JSON",
    };
  }

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) break;

      total += chunk.value.byteLength;

      if (total > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);

        return {
          ok: false,
          status: 413,
          error: "FINANCIAL_REVIEW_BODY_TOO_LARGE",
        };
      }

      chunks.push(Buffer.from(chunk.value));
    }

    const raw = Buffer.concat(chunks).toString("utf8");

    return {
      ok: true,
      value: JSON.parse(raw) as unknown,
    };
  } catch {
    return {
      ok: false,
      status: 400,
      error: "FINANCIAL_REVIEW_INVALID_JSON",
    };
  }
}

function validRequestShape(value: unknown): boolean {
  if (
    !exactKeys(value, [
      "month",
      "uploadId",
      "proofDraft",
    ])
  ) {
    return false;
  }

  if (
    typeof value.month !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(value.month) ||
    typeof value.uploadId !== "number" ||
    !Number.isSafeInteger(value.uploadId) ||
    value.uploadId < 1
  ) {
    return false;
  }

  return exactKeys(value.proofDraft, [
    "source",
    "proofType",
    "amountBrlCents",
    "amountUsd",
  ]);
}

export function createFinancialEvidenceReviewPrepareHandler(
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
  };

  return async function POST(
    request: Request,
  ): Promise<Response> {
    // Autenticar antes de ler qualquer dado financeiro.
    let access: Awaited<ReturnType<
      typeof resolveZionAdminApiAccess
    >>;

    try {
      access = await deps.authorize();
    } catch {
      return json(
        {
          ok: false,
          error: "FINANCIAL_REVIEW_UNAVAILABLE",
        },
        503,
      );
    }

    if (!access.ok) {
      const denied =
        createZionAdminApiDeniedResponse(access);

      denied.headers.set("Cache-Control", "no-store");
      return denied;
    }

    const authority =
      assessFinancialEvidenceReviewAccess(access);

    if (!authority.ok) {
      return json(
        {
          ok: false,
          error: "FINANCIAL_REVIEW_OWNER_REQUIRED",
        },
        403,
      );
    }

    // Operacao administrativa iniciada no navegador.
    // Origin ausente ou divergente e rejeitado.
    const origin = request.headers.get("origin");
    const fetchSite =
      request.headers.get("sec-fetch-site");

    let expectedOrigin: string;

    try {
      expectedOrigin = new URL(request.url).origin;
    } catch {
      return json(
        {
          ok: false,
          error: "FINANCIAL_REVIEW_ORIGIN_DENIED",
        },
        403,
      );
    }

    if (
      !origin ||
      origin !== expectedOrigin ||
      (fetchSite !== null &&
        fetchSite !== "same-origin")
    ) {
      return json(
        {
          ok: false,
          error: "FINANCIAL_REVIEW_ORIGIN_DENIED",
        },
        403,
      );
    }

    const body = await readBoundedJson(request);

    if (!body.ok) {
      return json(
        {
          ok: false,
          error: body.error,
        },
        body.status,
      );
    }

    // Identidade, caminho e hash do documento nao
    // podem ser fornecidos pelo cliente.
    if (!validRequestShape(body.value)) {
      return json(
        {
          ok: false,
          error: "FINANCIAL_REVIEW_INVALID_REQUEST",
        },
        400,
      );
    }

    try {
      const db = deps.createDb();

      const prepared = await deps.prepare(
        access,
        body.value,
        db,
      );

      if (!prepared.ok) {
        const unavailable =
          prepared.reason === "PREPARATION_UNAVAILABLE";

        const forbidden =
          prepared.reason === "ACCESS_DENIED";

        return json(
          {
            ok: false,
            error: unavailable
              ? "FINANCIAL_REVIEW_UNAVAILABLE"
              : forbidden
                ? "FINANCIAL_REVIEW_OWNER_REQUIRED"
                : "FINANCIAL_REVIEW_NOT_READY",
          },
          unavailable ? 503 : forbidden ? 403 : 409,
        );
      }

      // Nunca enviar storagePath ou credenciais.
      // Nenhum documento foi aprovado neste retorno.
      return json(
        {
          ok: true,
          status: "prepared_unverified",
          reviewFingerprint: prepared.reviewFingerprint,
          review: {
            month: prepared.context.month,
            preclosureRevision:
              prepared.context.preclosureRevision,
            uploadId: prepared.context.uploadId,
            source: prepared.context.source,
            proofType: prepared.context.proofType,
            amountBrlCents:
              prepared.context.amountBrlCents,
            amountUsd: prepared.context.amountUsd,
            documentSha256:
              prepared.context.documentSha256,
            sizeBytes: prepared.context.sizeBytes,
          },
        },
        200,
      );
    } catch {
      return json(
        {
          ok: false,
          error: "FINANCIAL_REVIEW_UNAVAILABLE",
        },
        503,
      );
    }
  };
}