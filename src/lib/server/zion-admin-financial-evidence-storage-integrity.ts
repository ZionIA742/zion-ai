/**
 * ZION-ADM / 8-E.11-D.3-B.2-C.1
 *
 * Conferencia dos bytes reais de um comprovante
 * financeiro armazenado em bucket privado.
 *
 * Esta funcao:
 * - usa Storage fornecido pelo servidor;
 * - confere tamanho e SHA-256;
 * - nao cria credenciais ou URLs publicas;
 * - nao altera ou remove arquivos;
 * - nao autentica faturas;
 * - nao aprova comprovantes;
 * - nao autoriza fechamento.
 *
 * O chamador deve autenticar o administrador e obter
 * caminho, tamanho e SHA do banco confiavel.
 *
 * A futura RPC de aprovacao deve revalidar competencia,
 * revisao, ator e demais autoridades na transacao.
 */

import { createHash } from "node:crypto";

const BUCKET = "zion-admin-financial-evidence";
const MAX_BYTES = 10485760;

const SHA256 = /^[0-9a-f]{64}$/;

const PATH =
  /^unverified\/(?:20[2-9]\d|2100)-(?:0[1-9]|1[0-2])-01\/[1-9]\d*\/(?:fixed_costs|manual_expenses|openai_invoice|meta_invoice)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-([0-9a-f]{64})\.(?:pdf|png|jpg)$/;

type StoredBlob = {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type PrivateFinancialStorageReader = {
  from(bucket: string): {
    download(path: string): Promise<{
      data: StoredBlob | null;
      error: unknown;
    }>;
  };
};

export type FinancialStorageIntegrityResult =
  | {
      ok: true;
      status: "integrity_confirmed_unverified";
      sha256: string;
      sizeBytes: number;
    }
  | {
      ok: false;
      reason:
        | "INVALID_INPUT"
        | "STORAGE_UNAVAILABLE"
        | "SIZE_MISMATCH"
        | "SHA256_MISMATCH";
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

/**
 * Verificacao privada somente de leitura.
 *
 * Confirmar integridade NAO significa confirmar
 * valor, cobranca, competencia ou autorizacao.
 */
export async function verifyPrivateFinancialEvidence(
  input: unknown,
  storage: PrivateFinancialStorageReader,
): Promise<FinancialStorageIntegrityResult> {
  if (!isRecord(input)) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  const bucket = input.bucket;
  const path = input.path;
  const expectedSha256 = input.expectedSha256;
  const expectedSizeBytes = input.expectedSizeBytes;

  if (
    bucket !== BUCKET ||
    typeof path !== "string" ||
    path.length > 512 ||
    typeof expectedSha256 !== "string" ||
    !SHA256.test(expectedSha256) ||
    typeof expectedSizeBytes !== "number" ||
    !Number.isSafeInteger(expectedSizeBytes) ||
    expectedSizeBytes < 1 ||
    expectedSizeBytes > MAX_BYTES
  ) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  const match = PATH.exec(path);

  if (!match || match[1] !== expectedSha256) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  try {
    // O cliente deve ser criado pelo backend autorizado.
    // Nenhum acesso direto do navegador e permitido.
    const response = await storage
      .from(BUCKET)
      .download(path);

    if (response.error || !response.data) {
      return {
        ok: false,
        reason: "STORAGE_UNAVAILABLE",
      };
    }

    const blob = response.data;

    // Rejeitar tamanho divergente antes de alocar bytes.
    if (
      typeof blob.size !== "number" ||
      !Number.isSafeInteger(blob.size) ||
      blob.size !== expectedSizeBytes
    ) {
      return { ok: false, reason: "SIZE_MISMATCH" };
    }

    const bytes = Buffer.from(
      await blob.arrayBuffer(),
    );

    // Conferencia independente do tamanho real.
    if (bytes.length !== expectedSizeBytes) {
      return { ok: false, reason: "SIZE_MISMATCH" };
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

    return {
      ok: true,
      status: "integrity_confirmed_unverified",
      sha256: actualSha256,
      sizeBytes: bytes.length,
    };
  } catch {
    // Falha de rede ou leitura nunca confirma integridade.
    return {
      ok: false,
      reason: "STORAGE_UNAVAILABLE",
    };
  }
}