/**
 * Compatibilidade estrutural da comprovacao financeira Meta.
 *
 * Este modulo NAO autentica documentos, nao confirma cobranças
 * e NAO autoriza fechamento. O servidor devera obter os dados
 * de fontes canonicas e a RPC transacional devera revalidar tudo.
 *
 * A categoria meta_invoice tambem admite supplier_statement.
 * Um demonstrativo oficial de ausencia de cobranca deve
 * comprovar zero; ausencia de documento nunca significa zero.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SHA256 = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function validCents(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

function validUploadId(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0;
  }

  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,18}$/.test(value)
  ) {
    return false;
  }

  const maxBigint = "9223372036854775807";

  return value.length < maxBigint.length ||
    value <= maxBigint;
}
export type MetaFinancialProofContractResult = {
  structurallyCompatible: boolean;
  blockers: string[];
  documentCategory: "meta_invoice";
};

export function assessMetaFinancialProofContract(
  input: unknown,
  month: string,
  preclosureRevision: number,
): MetaFinancialProofContractResult {
  const blockers: string[] = [];

  if (!isRecord(input)) {
    return {
      structurallyCompatible: false,
      blockers: ["meta_proof_missing"],
      documentCategory: "meta_invoice",
    };
  }

  if (
    !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month) ||
    Number(month.slice(0, 4)) < 2020 ||
    Number(month.slice(0, 4)) > 2100 ||
    !Number.isSafeInteger(preclosureRevision) ||
    preclosureRevision < 1 ||
    input.month !== month ||
    input.preclosureRevision !== preclosureRevision
  ) {
    blockers.push("meta_proof_period_mismatch");
  }

  if (
    input.source !== "meta_invoice" ||
    !validUploadId(input.uploadId) ||
    typeof input.documentSha256 !== "string" ||
    !SHA256.test(input.documentSha256) ||
    typeof input.authorityKey !== "string" ||
    !UUID.test(input.authorityKey)
  ) {
    blockers.push("meta_proof_authority_missing");
  }

  if (input.status === "verified_amount") {
    if (
      !validCents(input.amountBrlCents) ||
      !validCents(input.proofAmountBrlCents) ||
      input.amountBrlCents !== input.proofAmountBrlCents ||
      (
        input.proofType !== "supplier_invoice" &&
        input.proofType !== "supplier_statement"
      )
    ) {
      blockers.push("meta_amount_evidence_mismatch");
    }
  } else if (input.status === "verified_not_applicable") {
    if (
      input.amountBrlCents !== 0 ||
      input.proofAmountBrlCents !== 0 ||
      input.proofType !== "supplier_statement"
    ) {
      blockers.push("meta_no_bill_evidence_missing");
    }
  } else {
    blockers.push("meta_financial_status_unverified");
  }

  return {
    structurallyCompatible: blockers.length === 0,
    blockers,
    documentCategory: "meta_invoice",
  };
}