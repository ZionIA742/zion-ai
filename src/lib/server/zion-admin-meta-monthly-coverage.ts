/**
 * ZION-ADM — cobertura financeira mensal Meta.
 *
 * Valida somente estrutura e cobertura.
 *
 * NAO autentica fontes, fornecedores, contas ou valores.
 * NAO autoriza fechamento financeiro.
 * NAO consulta Meta ou Supabase.
 */

export type MetaMonthlyCoverageInput = {
  month: string;
  census: {
    complete: boolean;
    billingAccountIds: string[];
  };
  records: Array<{
    billingAccountId: string;
    month: string;
    kind: "amount_record" | "not_applicable_record";
    amountBrlCents: number | null;
  }>;
};

export type MetaMonthlyCoverageResult = {
  status: "candidate_complete" | "unknown";
  candidateBrlCents: number | null;
  candidateNotApplicable: boolean;
  expectedAccounts: number;
  coveredAccounts: number;
  blockers: string[];
};

function validMonth(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^(20\d{2}|2100)-(0[1-9]|1[0-2])-01$/.test(value)
  ) {
    return false;
  }

  return true;
}

function validAccountId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9:_-]{1,128}$/.test(value)
  );
}

function validCents(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

export function assessMetaMonthlyCoverage(
  input: MetaMonthlyCoverageInput,
): MetaMonthlyCoverageResult {
  const blockers: string[] = [];

  const addBlocker = (code: string) => {
    if (!blockers.includes(code)) blockers.push(code);
  };

  if (!input || !validMonth(input.month)) {
    addBlocker("invalid_month");
  }

  const census = input?.census;
  const ids = Array.isArray(census?.billingAccountIds)
    ? census.billingAccountIds
    : [];

  if (
    census?.complete !== true ||
    !Array.isArray(census.billingAccountIds)
  ) {
    addBlocker("account_census_unverified");
  }

  if (ids.length === 0) {
    addBlocker("empty_account_census_requires_proof");
  }

  const expected = new Set<string>();

  for (const id of ids) {
    if (!validAccountId(id)) {
      addBlocker("invalid_billing_account");
      continue;
    }

    if (expected.has(id)) {
      addBlocker("duplicate_billing_account");
    }

    expected.add(id);
  }

  if (!Array.isArray(input?.records)) {
    addBlocker("invalid_record_collection");
  }

  const records = Array.isArray(input?.records)
    ? input.records
    : [];

  const covered = new Set<string>();
  let total = 0;
  let hasAmount = false;

  for (const record of records) {
    if (
      !record ||
      !validAccountId(record.billingAccountId)
    ) {
      addBlocker("invalid_record_account");
      continue;
    }

    const id = record.billingAccountId;

    if (!expected.has(id)) {
      addBlocker("unexpected_billing_account");
    }

    if (covered.has(id)) {
      addBlocker("duplicate_account_record");
    }

    covered.add(id);

    if (record.month !== input.month) {
      addBlocker("record_month_mismatch");
    }

    if (record.kind === "amount_record") {
      if (!validCents(record.amountBrlCents)) {
        addBlocker("invalid_amount_record");
      } else {
        hasAmount = true;
        total += record.amountBrlCents;

        if (!Number.isSafeInteger(total)) {
          addBlocker("amount_overflow");
        }
      }
    } else if (record.kind === "not_applicable_record") {
      if (record.amountBrlCents !== null) {
        addBlocker("invalid_not_applicable_record");
      }
    } else {
      addBlocker("invalid_record_kind");
    }
  }

  for (const id of expected) {
    if (!covered.has(id)) {
      addBlocker("missing_billing_account");
    }
  }

  const complete = blockers.length === 0;

  return {
    status: complete ? "candidate_complete" : "unknown",
    candidateBrlCents: complete && hasAmount ? total : null,
    candidateNotApplicable: complete && !hasAmount,
    expectedAccounts: expected.size,
    coveredAccounts: covered.size,
    blockers,
  };
}