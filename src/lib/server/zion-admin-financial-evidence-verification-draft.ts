/**
 * ZION-ADM / 8-E.11-D.3-B.1
 *
 * Validacao estrutural de uma PROPOSTA de evidencia.
 *
 * NAO:
 * - verifica documentos;
 * - consulta fontes oficiais;
 * - autentica administradores;
 * - aprova comprovantes;
 * - escreve no banco;
 * - autoriza fechamento financeiro.
 *
 * Os dados do upload e do administrador deverao ser
 * obtidos pelo servidor, independentemente desta funcao.
 */

export const FINANCIAL_PROOF_TYPES = {
  fixed_costs: [
    "supplier_invoice",
    "supplier_statement",
    "expense_receipt",
    "internal_reconciliation",
  ],
  manual_expenses: [
    "expense_receipt",
    "internal_reconciliation",
  ],
  openai_invoice: [
    "supplier_invoice",
    "supplier_statement",
  ],
  meta_invoice: [
    "supplier_invoice",
    "supplier_statement",
  ],
} as const;

export type FinancialProofSource =
  keyof typeof FINANCIAL_PROOF_TYPES;

export type FinancialProofDraft = {
  source: FinancialProofSource;
  proofType: string;
  amountBrlCents: number | null;
  amountUsd: string | null;
};

export type FinancialProofDraftAssessment =
  | {
      ok: true;
      candidate: FinancialProofDraft;
    }
  | {
      ok: false;
      reason:
        | "INVALID_INPUT"
        | "INVALID_SHAPE"
        | "INVALID_SOURCE"
        | "INVALID_PROOF_TYPE"
        | "INVALID_BRL_AMOUNT"
        | "INVALID_USD_AMOUNT"
        | "AMOUNT_REQUIRED";
    };

const REQUIRED_KEYS = [
  "source",
  "proofType",
  "amountBrlCents",
  "amountUsd",
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

function isSource(
  value: unknown,
): value is FinancialProofSource {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(
      FINANCIAL_PROOF_TYPES,
      value,
    )
  );
}

function isValidBrl(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

// Compativel com numeric(20,8):
// ate 12 digitos inteiros e 8 casas decimais.
// Nao converte valores nem aceita notacao cientifica.
function isValidUsd(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,8})?$/.test(
      value,
    )
  );
}

export function assessFinancialProofDraft(
  input: unknown,
): FinancialProofDraftAssessment {
  if (!isRecord(input)) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  // Nao permitir que o solicitante envie estados como
  // verified, status, verifiedBy ou documentSha256.
  // Estes campos pertencem as autoridades do servidor.
  const keys = Object.keys(input);

  if (
    keys.length !== REQUIRED_KEYS.length ||
    !REQUIRED_KEYS.every((key) =>
      Object.prototype.hasOwnProperty.call(input, key)
    ) ||
    keys.some(
      (key) =>
        !REQUIRED_KEYS.some((allowed) => allowed === key),
    )
  ) {
    return { ok: false, reason: "INVALID_SHAPE" };
  }

  const source = input.source;
  const proofType = input.proofType;
  const amountBrlCents = input.amountBrlCents;
  const amountUsd = input.amountUsd;

  if (!isSource(source)) {
    return { ok: false, reason: "INVALID_SOURCE" };
  }

  const allowed: readonly string[] =
    FINANCIAL_PROOF_TYPES[source];

  if (
    typeof proofType !== "string" ||
    !allowed.includes(proofType)
  ) {
    return {
      ok: false,
      reason: "INVALID_PROOF_TYPE",
    };
  }

  if (
    amountBrlCents !== null &&
    !isValidBrl(amountBrlCents)
  ) {
    return {
      ok: false,
      reason: "INVALID_BRL_AMOUNT",
    };
  }

  if (
    amountUsd !== null &&
    !isValidUsd(amountUsd)
  ) {
    return {
      ok: false,
      reason: "INVALID_USD_AMOUNT",
    };
  }

  if (
    amountBrlCents === null &&
    amountUsd === null
  ) {
    return {
      ok: false,
      reason: "AMOUNT_REQUIRED",
    };
  }

  return {
    ok: true,
    candidate: {
      source,
      proofType,
      amountBrlCents,
      amountUsd,
    },
  };
}