/**
 * ZION-ADM / 8-E.11-D.3-C.3-E.2-C.3-A
 *
 * Entrega privada de documento financeiro.
 *
 * - Owner autenticado obrigatorio.
 * - Upload e revisao lidos do banco.
 * - Um download privado, com SHA-256 conferido.
 * - Resposta binaria sem cache ou URL assinada.
 *
 * NAO registra leitura humana.
 * NAO aprova valores ou comprovantes.
 * NAO escreve no Supabase.
 * NAO executa fechamento financeiro.
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
  readFinancialEvidenceBinding,
} from "./zion-admin-financial-evidence-binding-reader";

import {
  readVerifiedPrivateFinancialBytes,
} from "./zion-admin-financial-evidence-private-bytes";

type Dependencies = {
  authorize: typeof resolveZionAdminApiAccess;
  createDb: typeof createServiceSupabaseClient;
  readBinding: typeof readFinancialEvidenceBinding;
  readBytes: typeof readVerifiedPrivateFinancialBytes;
};

const BUCKET = "zion-admin-financial-evidence";
const MAX_BODY_BYTES = 4096;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const MIME = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
} as const;

function errorResponse(
  status: number,
  code: string,
): Response {
  return Response.json(
    { ok: false, error: code },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
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
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;

  const actual = Object.keys(value);

  return (
    actual.length === keys.length &&
    keys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key)
    )
  );
}

function validInput(
  value: unknown,
): value is {
  month: string;
  uploadId: number;
  proofDraft: Record<string, unknown>;
} {
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

type BodyResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      status: number;
      code: string;
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
      code: "FINANCIAL_DOCUMENT_JSON_REQUIRED",
    };
  }

  const contentLength =
    request.headers.get("content-length");

  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      return {
        ok: false,
        status: 400,
        code: "FINANCIAL_DOCUMENT_INVALID_LENGTH",
      };
    }

    if (Number(contentLength) > MAX_BODY_BYTES) {
      return {
        ok: false,
        status: 413,
        code: "FINANCIAL_DOCUMENT_BODY_TOO_LARGE",
      };
    }
  }

  if (!request.body) {
    return {
      ok: false,
      status: 400,
      code: "FINANCIAL_DOCUMENT_INVALID_JSON",
    };
  }

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;

  try {
    while (true) {
      const current = await reader.read();

      if (current.done) break;

      size += current.value.byteLength;

      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);

        return {
          ok: false,
          status: 413,
          code: "FINANCIAL_DOCUMENT_BODY_TOO_LARGE",
        };
      }

      chunks.push(Buffer.from(current.value));
    }

    return {
      ok: true,
      value: JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      ) as unknown,
    };
  } catch {
    return {
      ok: false,
      status: 400,
      code: "FINANCIAL_DOCUMENT_INVALID_JSON",
    };
  }
}

function allowedExtension(
  path: string,
): keyof typeof MIME | null {
  const matched = /\.(pdf|png|jpg)$/.exec(path);

  if (!matched) return null;

  return matched[1] as keyof typeof MIME;
}

export function createFinancialEvidencePrivateViewHandler(
  overrides: Partial<Dependencies> = {},
) {
  const deps: Dependencies = {
    authorize:
      overrides.authorize ?? resolveZionAdminApiAccess,
    createDb:
      overrides.createDb ?? createServiceSupabaseClient,
    readBinding:
      overrides.readBinding ?? readFinancialEvidenceBinding,
    readBytes:
      overrides.readBytes ?? readVerifiedPrivateFinancialBytes,
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
      return errorResponse(
        503,
        "FINANCIAL_DOCUMENT_UNAVAILABLE",
      );
    }

    if (!access.ok) {
      const denied =
        createZionAdminApiDeniedResponse(access);

      denied.headers.set(
        "Cache-Control",
        "private, no-store, max-age=0",
      );

      denied.headers.set(
        "X-Content-Type-Options",
        "nosniff",
      );

      denied.headers.set(
        "Cross-Origin-Resource-Policy",
        "same-origin",
      );

      return denied;
    }

    // Apenas o proprietario tem autoridade
    // para consultar esses comprovantes.
    const authority =
      assessFinancialEvidenceReviewAccess(access);

    if (!authority.ok) {
      return errorResponse(
        403,
        "FINANCIAL_DOCUMENT_OWNER_REQUIRED",
      );
    }

    // Rejeitar requisicoes sem Origin de navegador
    // ou provenientes de outra origem.
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");

    let expectedOrigin: string;

    try {
      expectedOrigin = new URL(request.url).origin;
    } catch {
      return errorResponse(
        403,
        "FINANCIAL_DOCUMENT_ORIGIN_DENIED",
      );
    }

    if (
      !origin ||
      origin !== expectedOrigin ||
      (site !== null && site !== "same-origin")
    ) {
      return errorResponse(
        403,
        "FINANCIAL_DOCUMENT_ORIGIN_DENIED",
      );
    }

    const body = await readBoundedJson(request);

    if (!body.ok) {
      return errorResponse(
        body.status,
        body.code,
      );
    }

    if (!validInput(body.value)) {
      return errorResponse(
        400,
        "FINANCIAL_DOCUMENT_INVALID_REQUEST",
      );
    }

    try {
      const db = deps.createDb();

      // Nunca receber storagePath, hash ou revisao
      // do navegador.
      const linked = await deps.readBinding(
        {
          month: body.value.month,
          uploadId: body.value.uploadId,
          proofDraft: body.value.proofDraft,
        },
        db,
      );

      if (!linked.ok) {
        return errorResponse(
          409,
          "FINANCIAL_DOCUMENT_NOT_READY",
        );
      }

      const binding = linked.binding;

      if (
        binding.uploadId !== body.value.uploadId ||
        binding.source !==
          body.value.proofDraft.source
      ) {
        return errorResponse(
          409,
          "FINANCIAL_DOCUMENT_NOT_READY",
        );
      }

      // Rejeitar arquivos grandes antes de
      // qualquer download para visualizacao.
      if (binding.sizeBytes > MAX_RESPONSE_BYTES) {
        return errorResponse(
          413,
          "FINANCIAL_DOCUMENT_PREVIEW_TOO_LARGE",
        );
      }

      const extension =
        allowedExtension(binding.storagePath);

      if (!extension) {
        return errorResponse(
          409,
          "FINANCIAL_DOCUMENT_NOT_READY",
        );
      }

      const mimeType = MIME[extension];

      // O novo leitor devolve exatamente o Buffer
      // que acabou de passar na verificacao SHA-256.
      const verified = await deps.readBytes(
        {
          bucket: BUCKET,
          path: binding.storagePath,
          expectedSha256: binding.documentSha256,
          expectedSizeBytes: binding.sizeBytes,
          expectedMimeType: mimeType,
        },
        db.storage,
      );

      if (
        !verified.ok ||
        !Buffer.isBuffer(verified.bytes) ||
        verified.sha256 !== binding.documentSha256 ||
        verified.sizeBytes !== binding.sizeBytes ||
        verified.bytes.length !== binding.sizeBytes ||
        verified.bytes.length > MAX_RESPONSE_BYTES ||
        verified.mimeType !== mimeType
      ) {
        return errorResponse(
          409,
          "FINANCIAL_DOCUMENT_INTEGRITY_REJECTED",
        );
      }

      // Copia em memoria para Response. Nenhum
      // segundo download e efetuado.
      const responseBytes = new Uint8Array(
        verified.bytes,
      );

      return new Response(responseBytes, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(responseBytes.byteLength),
          "Content-Disposition":
            `inline; filename="zion-comprovante-${binding.uploadId}.${extension}"`,
          "Cache-Control":
            "private, no-store, max-age=0",
          "Pragma": "no-cache",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
          "Referrer-Policy": "no-referrer",
          "X-Frame-Options": "SAMEORIGIN",
          "Content-Security-Policy":
            "frame-ancestors 'self'",
          "X-ZION-Document-SHA256": verified.sha256,
          "X-ZION-Upload-ID": String(binding.uploadId),
          "Vary": "Cookie",
        },
      });
    } catch {
      return errorResponse(
        503,
        "FINANCIAL_DOCUMENT_UNAVAILABLE",
      );
    }
  };
}