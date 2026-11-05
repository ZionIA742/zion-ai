/**
 * ZION-ADM — Vinculacao mensal de contas Meta.
 *
 * Confere correspondencia estrutural entre WABAs e
 * contas financeiras candidatas da mesma competencia.
 *
 * Uma conta financeira pode atender varias WABAs.
 *
 * NAO autentica a origem das vinculacoes.
 * NAO prova faturamento, custo zero ou isencao.
 * NAO autoriza fechamento financeiro.
 * NAO acessa banco ou APIs externas.
 */

export type MetaMonthlyBindingInput = {
  month: string;
  wabaCensus: {
    complete: boolean;
    wabaIds: string[];
  };
  bindings: Array<{
    month: string;
    wabaId: string;
    billingAccountId: string;
  }>;
  candidateBillingAccountIds: string[];
};

export type MetaMonthlyBindingResult = {
  status: "candidate_bound" | "unknown";
  expectedWabas: number;
  boundWabas: number;
  candidateBillingAccounts: string[];
  blockers: string[];
};

function validMonth(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(20\d{2}|2100)-(0[1-9]|1[0-2])-01$/.test(value)
  );
}

function validWaba(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{5,25}$/.test(value)
  );
}

function validAccount(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9:_-]{1,128}$/.test(value)
  );
}

export function assessMetaMonthlyBinding(
  input: MetaMonthlyBindingInput,
): MetaMonthlyBindingResult {
  const blockers: string[] = [];

  const block = (reason: string) => {
    if (!blockers.includes(reason)) blockers.push(reason);
  };

  if (!input || !validMonth(input.month)) {
    block("invalid_month");
  }

  const census = input?.wabaCensus;
  const wabas = Array.isArray(census?.wabaIds)
    ? census.wabaIds
    : [];

  if (
    census?.complete !== true ||
    !Array.isArray(census?.wabaIds)
  ) {
    block("waba_census_unverified");
  }

  if (wabas.length === 0) {
    block("empty_waba_census_requires_proof");
  }

  const expected = new Set<string>();

  for (const waba of wabas) {
    if (!validWaba(waba)) {
      block("invalid_waba_id");
      continue;
    }

    if (expected.has(waba)) {
      block("duplicate_waba_in_census");
    }

    expected.add(waba);
  }

  if (!Array.isArray(input?.bindings)) {
    block("invalid_binding_collection");
  }

  const bindings = Array.isArray(input?.bindings)
    ? input.bindings
    : [];

  const bound = new Set<string>();
  const linkedAccounts = new Set<string>();

  for (const binding of bindings) {
    if (!binding || !validWaba(binding.wabaId)) {
      block("invalid_binding_waba");
      continue;
    }

    if (bound.has(binding.wabaId)) {
      block("duplicate_waba_binding");
    }

    bound.add(binding.wabaId);

    if (!expected.has(binding.wabaId)) {
      block("unexpected_waba_binding");
    }

    if (binding.month !== input.month) {
      block("binding_month_mismatch");
    }

    if (!validAccount(binding.billingAccountId)) {
      block("invalid_binding_account");
      continue;
    }

    linkedAccounts.add(binding.billingAccountId);
  }

  for (const waba of expected) {
    if (!bound.has(waba)) {
      block("missing_waba_binding");
    }
  }

  if (!Array.isArray(input?.candidateBillingAccountIds)) {
    block("invalid_candidate_account_collection");
  }

  const candidates = Array.isArray(
    input?.candidateBillingAccountIds,
  ) ? input.candidateBillingAccountIds : [];

  const candidateSet = new Set<string>();

  for (const account of candidates) {
    if (!validAccount(account)) {
      block("invalid_candidate_account");
      continue;
    }

    if (candidateSet.has(account)) {
      block("duplicate_candidate_account");
    }

    candidateSet.add(account);
  }

  if (candidateSet.size === 0) {
    block("empty_candidate_account_census");
  }

  for (const account of linkedAccounts) {
    if (!candidateSet.has(account)) {
      block("missing_candidate_billing_account");
    }
  }

  for (const account of candidateSet) {
    if (!linkedAccounts.has(account)) {
      block("unexpected_candidate_billing_account");
    }
  }

  const complete = blockers.length === 0;

  return {
    status: complete ? "candidate_bound" : "unknown",
    expectedWabas: expected.size,
    boundWabas: bound.size,
    candidateBillingAccounts: complete
      ? [...linkedAccounts].sort()
      : [],
    blockers,
  };
}