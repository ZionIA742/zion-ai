/**
 * ZION-ADM / 8-E.11-D.2-B.2
 *
 * Upload administrativo de documentos financeiros.
 *
 * Armazena apenas arquivos NAO VERIFICADOS.
 * Nao registra evidencia financeira como aprovada.
 * Nao atualiza pre-fechamento.
 * Nao executa fechamento definitivo.
 * Nao gera URL publica.
 */

import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import {
  resolveZionAdminApiAccess,
} from "@/lib/server/zion-admin-api-access";

import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";

import {
  FINANCIAL_EVIDENCE_BUCKET,
  validateFinancialEvidenceUpload,
} from "@/lib/server/zion-admin-financial-evidence-upload-validation";

import {
  FinancialEvidenceRegistrationError,
  registerFinancialEvidenceUpload,
} from "@/lib/server/zion-admin-financial-evidence-upload-registration";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Limite para upload direto pela Vercel.
// O bucket do Storage possui limite independente de 10 MiB.
const MAX_DIRECT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4_400_000;

type PeriodState =
  | "ready"
  | "missing"
  | "stale"
  | "closed";

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("FINANCIAL_STORAGE_UNAVAILABLE");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function checkPeriod(
  month: string,
  revision: number,
): Promise<PeriodState> {
  const db = createAdminClient();

  const current = await db
    .from("zion_admin_monthly_preclosures")
    .select("revision")
    .eq("month", month)
    .maybeSingle();

  if (current.error) {
    throw new Error("PRECLOSURE_READ_FAILED");
  }

  if (!current.data) {
    return "missing";
  }

  if (current.data.revision !== revision) {
    return "stale";
  }

  const audit = await db
    .from("zion_admin_monthly_preclosure_audit")
    .select("revision")
    .eq("month", month)
    .eq("revision", revision)
    .maybeSingle();

  if (audit.error) {
    throw new Error("PRECLOSURE_AUDIT_READ_FAILED");
  }

  if (!audit.data) {
    return "missing";
  }

  const finalClosure = await db
    .from("zion_admin_monthly_final_closures")
    .select("month")
    .eq("month", month)
    .maybeSingle();

  if (finalClosure.error) {
    throw new Error("FINAL_CLOSURE_READ_FAILED");
  }

  if (finalClosure.data) {
    return "closed";
  }

  const legacyClosure = await db
    .from("zion_admin_monthly_closures")
    .select("month")
    .eq("month", month)
    .maybeSingle();

  if (legacyClosure.error) {
    throw new Error("LEGACY_CLOSURE_READ_FAILED");
  }

  if (legacyClosure.data) {
    return "closed";
  }

  return "ready";
}

async function uploadUnverifiedFile(
  path: string,
  bytes: Buffer,
  mimeType: string,
): Promise<void> {
  const db = createAdminClient();

  const { error } = await db.storage
    .from(FINANCIAL_EVIDENCE_BUCKET)
    .upload(path, bytes, {
      contentType: mimeType,
      upsert: false,
      cacheControl: "0",
    });

  if (error) {
    throw new Error("FINANCIAL_EVIDENCE_STORAGE_FAILED");
  }
}

async function verifyStoredUpload(
  path: string,
  expectedSha256: string,
  expectedSize: number,
): Promise<boolean> {
  const db = createAdminClient();

  // Download privado usando credenciais do servidor.
  // Nenhuma URL publica ou assinada e criada.
  const { data, error } = await db.storage
    .from(FINANCIAL_EVIDENCE_BUCKET)
    .download(path);

  if (error || !data) {
    return false;
  }

  const storedBytes = Buffer.from(
    await data.arrayBuffer(),
  );

  if (storedBytes.length !== expectedSize) {
    return false;
  }

  const actualSha256 = createHash("sha256")
    .update(storedBytes)
    .digest("hex");

  return actualSha256 === expectedSha256;
}
export type FinancialEvidenceUploadDependencies = {
  authorize: typeof resolveZionAdminApiAccess;
  getPeriodState: typeof checkPeriod;
  upload: typeof uploadUnverifiedFile;
  verifyStoredUpload: typeof verifyStoredUpload;
  register: typeof registerFinancialEvidenceUpload;
  generateId: () => string;
};

export function createFinancialEvidenceUploadHandler(
  overrides: Partial<FinancialEvidenceUploadDependencies> = {},
) {
  const deps: FinancialEvidenceUploadDependencies = {
    authorize: overrides.authorize ?? resolveZionAdminApiAccess,
    getPeriodState: overrides.getPeriodState ?? checkPeriod,
    upload: overrides.upload ?? uploadUnverifiedFile,
    verifyStoredUpload: overrides.verifyStoredUpload ?? verifyStoredUpload,
    register: overrides.register ?? registerFinancialEvidenceUpload,
    generateId: overrides.generateId ?? randomUUID,
  };

  return async function POST(request: Request) {
    // Nao ler o arquivo antes da autorizacao.
    const access = await deps.authorize();

    if (!access.ok) {
      return createZionAdminApiDeniedResponse(access);
    }

    if (
      !access.resolution.capabilities.includes(
        "manage_accounts",
      )
    ) {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          error: "FINANCIAL_EVIDENCE_FORBIDDEN",
        },
        403,
      );
    }

    // Defesa adicional para requisicoes de navegador.
    const origin = request.headers.get("origin");

    if (origin) {
      try {
        if (
          new URL(origin).origin !==
          new URL(request.url).origin
        ) {
          return createZionAdminApiJsonResponse(
            {
              ok: false,
              error: "FINANCIAL_EVIDENCE_ORIGIN_DENIED",
            },
            403,
          );
        }
      } catch {
        return createZionAdminApiJsonResponse(
          {
            ok: false,
            error: "FINANCIAL_EVIDENCE_ORIGIN_DENIED",
          },
          403,
        );
      }
    }

    const contentType =
      request.headers.get("content-type") ?? "";

    if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          error: "FINANCIAL_EVIDENCE_MULTIPART_REQUIRED",
        },
        415,
      );
    }

    const contentLength =
      request.headers.get("content-length");

    if (contentLength !== null) {
      const parsedLength = Number(contentLength);

      if (
        !/^\d+$/.test(contentLength) ||
        !Number.isSafeInteger(parsedLength)
      ) {
        return createZionAdminApiJsonResponse(
          {
            ok: false,
            error: "FINANCIAL_EVIDENCE_INVALID_LENGTH",
          },
          400,
        );
      }

      if (parsedLength > MAX_REQUEST_BYTES) {
        return createZionAdminApiJsonResponse(
          {
            ok: false,
            error: "FINANCIAL_EVIDENCE_REQUEST_TOO_LARGE",
          },
          413,
        );
      }
    }

    let form: FormData;

    try {
      form = await request.formData();
    } catch {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          error: "FINANCIAL_EVIDENCE_INVALID_FORM",
        },
        400,
      );
    }

    const entry = form.get("file");

    if (!(entry instanceof File)) {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          error: "FINANCIAL_EVIDENCE_FILE_REQUIRED",
        },
        400,
      );
    }

    if (
      entry.size === 0 ||
      entry.size > MAX_DIRECT_FILE_BYTES
    ) {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          error: "FINANCIAL_EVIDENCE_FILE_TOO_LARGE",
        },
        413,
      );
    }

    const revisionInput = form.get("preclosureRevision");

    const revision =
      typeof revisionInput === "string" &&
      /^[1-9]\d{0,8}$/.test(revisionInput)
        ? Number(revisionInput)
        : Number.NaN;

    let validated: ReturnType<
      typeof validateFinancialEvidenceUpload
    >;

    let bytes: Buffer;

    try {
      bytes = Buffer.from(await entry.arrayBuffer());

      validated = validateFinancialEvidenceUpload({
        month: form.get("month"),
        preclosureRevision: revision,
        source: form.get("source"),
        filename: entry.name,
        mimeType: entry.type,
        bytes,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "";

      const code = message.startsWith(
        "FINANCIAL_EVIDENCE_",
      )
        ? message
        : "FINANCIAL_EVIDENCE_INVALID_FILE";

      return createZionAdminApiJsonResponse(
        { ok: false, error: code },
        400,
      );
    }

    try {
      const periodState = await deps.getPeriodState(
        validated.month,
        validated.preclosureRevision,
      );

      if (periodState !== "ready") {
        const unavailable = periodState === "missing";
        const status = unavailable ? 404 : 409;

        return createZionAdminApiJsonResponse(
          {
            ok: false,
            error:
              periodState === "stale"
                ? "FINANCIAL_EVIDENCE_STALE_PRECLOSURE"
                : periodState === "closed"
                  ? "FINANCIAL_EVIDENCE_MONTH_CLOSED"
                  : "FINANCIAL_EVIDENCE_PRECLOSURE_NOT_FOUND",
          },
          status,
        );
      }

      // Nome e caminho gerados exclusivamente no servidor.
      // Nenhum nome fornecido pelo usuario vira caminho.
      const path = [
        "unverified",
        validated.month,
        String(validated.preclosureRevision),
        validated.source,
        `${deps.generateId()}-${validated.sha256}.${validated.extension}`,
      ].join("/");

      try {
        await deps.upload(
          path,
          bytes,
          validated.mimeType,
        );
      } catch {
        // O Storage pode ter persistido o arquivo
        // antes de a resposta da rede falhar.
        // Nunca presumir que ele nao existe.
        let confirmed = false;

        try {
          confirmed = await deps.verifyStoredUpload(
            path,
            validated.sha256,
            validated.sizeBytes,
          );
        } catch {
          // Erro na verificacao nao comprova integridade.
          // Preservar o caminho para reconciliacao.
          confirmed = false;
        }

        if (!confirmed) {
          return createZionAdminApiJsonResponse(
            {
              ok: false,
              error: "FINANCIAL_EVIDENCE_UPLOAD_UNAVAILABLE",
              status: "uploaded_unverified_requires_reconciliation",
              bucket: FINANCIAL_EVIDENCE_BUCKET,
              path,
              sha256: validated.sha256,
              verified: false,
            },
            503,
          );
        }
      }

      // O Storage confirmou o upload normalmente
      // ou o conteudo foi recuperado e validado.
      // O registro ainda depende da RPC protegida.
      let registration: Awaited<
        ReturnType<typeof registerFinancialEvidenceUpload>
      >;

      try {
        registration = await deps.register({
          validated,
          storagePath: path,
          sessionUserId: access.sessionUserId,
        });
      } catch (error) {
        const knownRejection =
          error instanceof FinancialEvidenceRegistrationError &&
          error.outcome === "rejected";

        // Nenhuma rejeicao autoriza exclusao automatica.
        // O arquivo pode possuir registro anterior ou
        // estar envolvido em uma operacao concorrente.
        // Preservar para reconciliacao administrativa.
        return createZionAdminApiJsonResponse(
          {
            ok: false,
            error: knownRejection
              ? "FINANCIAL_EVIDENCE_REGISTRATION_REJECTED"
              : "FINANCIAL_EVIDENCE_REGISTRATION_UNCERTAIN",
            status: "uploaded_unverified_requires_reconciliation",
            cleanupStatus: "not_attempted",
            bucket: FINANCIAL_EVIDENCE_BUCKET,
            path,
            sha256: validated.sha256,
            verified: false,
          },
          503,
        );
      }

      return createZionAdminApiJsonResponse(
        {
          ok: true,
          uploadId: registration.uploadId,
          status: "uploaded_unverified",
          bucket: FINANCIAL_EVIDENCE_BUCKET,
          path,
          month: validated.month,
          preclosureRevision:
            validated.preclosureRevision,
          source: validated.source,
          sha256: validated.sha256,
          sizeBytes: validated.sizeBytes,
          mimeType: validated.mimeType,
          verified: false,
        },
        201,
      );
    } catch {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          error: "FINANCIAL_EVIDENCE_UPLOAD_UNAVAILABLE",
        },
        503,
      );
    }
  };
}

export const POST = createFinancialEvidenceUploadHandler();