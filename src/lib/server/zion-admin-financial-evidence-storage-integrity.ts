/**
 * ZION-ADM / 8-E.11-D.3-C.3-E.2-C.2
 *
 * Interface legada de integridade financeira.
 *
 * A verificacao de bytes e realizada exclusivamente
 * pelo leitor canonico private-bytes.
 *
 * Mantem o contrato dos chamadores anteriores:
 * - mesmo nome de funcao;
 * - mesmas entradas;
 * - mesmos estados de retorno;
 * - nenhum Buffer na resposta.
 *
 * Nao autentica administrador.
 * Nao aprova comprovante.
 * Nao executa fechamento financeiro.
 */

import {
  readVerifiedPrivateFinancialBytes,
  type PrivateFinancialBytesStorage,
} from "./zion-admin-financial-evidence-private-bytes";

export type PrivateFinancialStorageReader =
  PrivateFinancialBytesStorage;

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

const MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
} as const;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export async function verifyPrivateFinancialEvidence(
  input: unknown,
  storage: PrivateFinancialStorageReader,
): Promise<FinancialStorageIntegrityResult> {
  if (!isRecord(input)) {
    return {
      ok: false,
      reason: "INVALID_INPUT",
    };
  }

  if (typeof input.path !== "string") {
    return {
      ok: false,
      reason: "INVALID_INPUT",
    };
  }

  // Derivar MIME do caminho canonico. O leitor central
  // verifica que a extensao realmente e permitida.
  const extensionMatch =
    /\.([a-z]+)$/.exec(input.path);

  if (!extensionMatch) {
    return {
      ok: false,
      reason: "INVALID_INPUT",
    };
  }

  const extension = extensionMatch[1];

  if (
    !Object.prototype.hasOwnProperty.call(
      MIME_BY_EXTENSION,
      extension,
    )
  ) {
    return {
      ok: false,
      reason: "INVALID_INPUT",
    };
  }

  const expectedMimeType =
    MIME_BY_EXTENSION[
      extension as keyof typeof MIME_BY_EXTENSION
    ];

  // Unico mecanismo que baixa, dimensiona e
  // verifica o SHA-256 dos bytes privados.
  const result = await readVerifiedPrivateFinancialBytes(
    {
      bucket: input.bucket,
      path: input.path,
      expectedSha256: input.expectedSha256,
      expectedSizeBytes: input.expectedSizeBytes,
      expectedMimeType,
    },
    storage,
  );

  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
    };
  }

  // A interface legada nunca expoe bytes.
  return {
    ok: true,
    status: "integrity_confirmed_unverified",
    sha256: result.sha256,
    sizeBytes: result.sizeBytes,
  };
}