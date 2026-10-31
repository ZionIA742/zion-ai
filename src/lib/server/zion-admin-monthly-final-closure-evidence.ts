/**
 * ZION-ADM / 8-E.11-C
 *
 * Validacao estrutural das evidencias do fechamento definitivo.
 *
 * NAO autentica documentos ou usuarios.
 * NAO autoriza fechamento financeiro.
 * NAO consulta nem modifica o banco.
 *
 * As evidencias deverao ser carregadas e verificadas por
 * componentes confiaveis do servidor. A futura RPC devera
 * aplicar novamente as restricoes de seguranca.
 */

export const REQUIRED_MONTHLY_FINAL_SOURCES = [
  "fixed_costs",
  "manual_expenses",
  "openai_invoice",
  "meta_invoice",
] as const;

export type MonthlyFinalSource =
  (typeof REQUIRED_MONTHLY_FINAL_SOURCES)[number];

export type MonthlyFinalEvidenceAssessment = {
  structurallyComplete: boolean;
  missingSources: MonthlyFinalSource[];
  invalidSources: string[];
};

const allowedProofTypes: Record<MonthlyFinalSource, readonly string[]> = {
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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNonemptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 3 &&
    value.trim().length <= 512
  );
}

function isNonnegativeCents(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isNonnegativeUsd(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d+(?:\.\d{1,8})?$/.test(value)
  );
}

function isValidMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(value)) {
    return false;
  }

  return Number(value.slice(0, 4)) >= 2020;
}

function isValidTimestamp(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isRequiredSource(
  value: unknown,
): value is MonthlyFinalSource {
  return (
    typeof value === "string" &&
    REQUIRED_MONTHLY_FINAL_SOURCES.some(
      (source) => source === value,
    )
  );
}

function validEvidence(
  evidence: Record<string, unknown>,
  month: string,
  source: MonthlyFinalSource,
): boolean {
  if (
    evidence.month !== month ||
    evidence.status !== "verified" ||
    !allowedProofTypes[source].includes(
      String(evidence.proofType ?? ""),
    ) ||
    !isNonemptyString(evidence.documentReference) ||
    !isNonemptyString(evidence.verifiedBy) ||
    !isValidTimestamp(evidence.verifiedAt)
  ) {
    return false;
  }

  const brl = evidence.amountBrlCents;
  const usd = evidence.amountUsd;

  const validBrl =
    brl === null || isNonnegativeCents(brl);

  const validUsd =
    usd === null || isNonnegativeUsd(usd);

  return (
    validBrl &&
    validUsd &&
    (brl !== null || usd !== null) &&
    brl !== undefined &&
    usd !== undefined
  );
}

/**
 * Verifica apenas se o conjunto fornecido possui uma
 * evidencia estruturalmente valida para cada fonte.
 *
 * "structurallyComplete" NAO significa que as faturas
 * foram autenticadas nem que o mes pode ser fechado.
 */
export function assessMonthlyFinalClosureEvidence(input: {
  month: unknown;
  preclosureRevision: unknown;
  evidence: unknown;
}): MonthlyFinalEvidenceAssessment {
  const invalidSources: string[] = [];
  const missingSources: MonthlyFinalSource[] = [];

  if (!isValidMonth(input.month)) {
    invalidSources.push("invalid_month");
  }

  if (
    typeof input.preclosureRevision !== "number" ||
    !Number.isSafeInteger(input.preclosureRevision) ||
    input.preclosureRevision < 1
  ) {
    invalidSources.push("invalid_preclosure_revision");
  }

  if (!Array.isArray(input.evidence)) {
    return {
      structurallyComplete: false,
      missingSources: [...REQUIRED_MONTHLY_FINAL_SOURCES],
      invalidSources: [...invalidSources, "invalid_evidence_collection"],
    };
  }

  const grouped = new Map<string, unknown[]>();

  for (const item of input.evidence) {
    if (!isRecord(item) || !isRequiredSource(item.source)) {
      invalidSources.push("unknown_evidence_source");
      continue;
    }

    const existing = grouped.get(item.source) ?? [];
    existing.push(item);
    grouped.set(item.source, existing);
  }

  for (const source of REQUIRED_MONTHLY_FINAL_SOURCES) {
    const entries = grouped.get(source) ?? [];

    if (entries.length === 0) {
      missingSources.push(source);
      continue;
    }

    if (
      entries.length !== 1 ||
      !isValidMonth(input.month) ||
      !isRecord(entries[0]) ||
      !validEvidence(entries[0], input.month, source)
    ) {
      invalidSources.push(source);
    }
  }

  return {
    structurallyComplete:
      missingSources.length === 0 &&
      invalidSources.length === 0,
    missingSources,
    invalidSources,
  };
}