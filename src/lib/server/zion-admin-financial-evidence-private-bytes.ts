/**
 * ZION-ADM / 8-E.11-D.3-C.3-E.2-C.1
 *
 * Leitura privada dos MESMOS bytes verificados.
 *
 * Recebe exclusivamente metadados canonicos
 * recuperados pelo backend.
 *
 * NAO autentica o administrador.
 * NAO abre endpoint ou gera URL assinada.
 * NAO aprova comprovantes ou cobrancas.
 * NAO grava em banco e NAO fecha competencias.
 *
 * O chamador deve autenticar o owner e conferir
 * upload, competencia e revisao corrente.
 *
 * Os bytes retornados devem permanecer no servidor,
 * exceto na resposta privada e autenticada de
 * visualizacao implementada posteriormente.
 */

import { createHash } from "node:crypto";

const BUCKET = "zion-admin-financial-evidence";
const MAX_BYTES = 10 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;

const PATH =
  /^unverified\/(?:20[2-9]\d|2100)-(?:0[1-9]|1[0-2])-01\/([1-9][0-9]{0,9})\/(?:fixed_costs|manual_expenses|openai_invoice|meta_invoice)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-([0-9a-f]{64})\.(pdf|png|jpg)$/;

const MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
} as const;

type FinancialMime =
  (typeof MIME_BY_EXTENSION)[keyof typeof MIME_BY_EXTENSION];

type StoredBlob = {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type PrivateFinancialBytesStorage = {
  from(bucket: string): {
    download(path: string): Promise<{
      data: StoredBlob | null;
      error: unknown;
    }>;
  };
};

export type VerifiedPrivateFinancialBytes =
  | {
      ok: true;
      status: "integrity_confirmed_unverified";
      bytes: Buffer;
      sha256: string;
      sizeBytes: number;
      mimeType: FinancialMime;
    }
  | {
      ok: false;
      reason:
        | "INVALID_INPUT"
        | "STORAGE_UNAVAILABLE"
        | "SIZE_MISMATCH"
        | "SHA256_MISMATCH";
    };

const REQUIRED_KEYS = [
  "bucket",
  "path",
  "expectedSha256",
  "expectedSizeBytes",
  "expectedMimeType",
] as const;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export async function readVerifiedPrivateFinancialBytes(
  input: unknown,
  storage: PrivateFinancialBytesStorage,
): Promise<VerifiedPrivateFinancialBytes> {
  if (!isRecord(input)) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  const keys = Object.keys(input);

  if (
    keys.length !== REQUIRED_KEYS.length ||
    !REQUIRED_KEYS.every((key) =>
      Object.prototype.hasOwnProperty.call(input, key)
    )
  ) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  const {
    bucket,
    path,
    expectedSha256,
    expectedSizeBytes,
    expectedMimeType,
  } = input;

  if (
    bucket !== BUCKET ||
    typeof path !== "string" ||
    path.length > 512 ||
    typeof expectedSha256 !== "string" ||
    !SHA256.test(expectedSha256) ||
    typeof expectedSizeBytes !== "number" ||
    !Number.isSafeInteger(expectedSizeBytes) ||
    expectedSizeBytes < 1 ||
    expectedSizeBytes > MAX_BYTES ||
    typeof expectedMimeType !== "string"
  ) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  const matched = PATH.exec(path);

  if (!matched || matched[2] !== expectedSha256) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  const revision = Number(matched[1]);

  if (
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision > 2147483647
  ) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  const extension =
    matched[3] as keyof typeof MIME_BY_EXTENSION;

  const canonicalMime = MIME_BY_EXTENSION[extension];

  if (canonicalMime !== expectedMimeType) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  try {
    // Um unico download para estes bytes.
    const result = await storage
      .from(BUCKET)
      .download(path);

    if (result.error || !result.data) {
      return {
        ok: false,
        reason: "STORAGE_UNAVAILABLE",
      };
    }

    const blob = result.data;

    // Verificar tamanho informado antes da alocacao.
    if (
      typeof blob.size !== "number" ||
      !Number.isSafeInteger(blob.size) ||
      blob.size !== expectedSizeBytes
    ) {
      return {
        ok: false,
        reason: "SIZE_MISMATCH",
      };
    }

    const bytes = Buffer.from(
      await blob.arrayBuffer(),
    );

    // Verificar tamanho real apos a leitura.
    if (bytes.length !== expectedSizeBytes) {
      return {
        ok: false,
        reason: "SIZE_MISMATCH",
      };
    }

    const actualSha256 = createHash("sha256")
      .update(bytes)
      .digest("hex");

    if (actualSha256 !== expectedSha256) {
      return {
        ok: false,
        reason: "SHA256_MISMATCH",
      };
    }

    // O mesmo Buffer conferido sera entregue ao
    // futuro handler privado, sem segundo download.
    return {
      ok: true,
      status: "integrity_confirmed_unverified",
      bytes,
      sha256: actualSha256,
      sizeBytes: bytes.length,
      mimeType: canonicalMime,
    };
  } catch {
    return {
      ok: false,
      reason: "STORAGE_UNAVAILABLE",
    };
  }
}