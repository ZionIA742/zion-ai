/**
 * Cobertura mensal candidata de documentos Meta.
 *
 * Consolida multiplos documentos por conta antes
 * de reutilizar assessMetaMonthlyCoverage.
 *
 * Nao comprova autenticidade das contas ou faturas.
 * Nao habilita escrita financeira nem fechamento.
 */
import {
  assessMetaMonthlyCoverage,
} from "./zion-admin-meta-monthly-coverage";

type Account = {
  financialAccountType: string;
  financialAccountId: string;
};

type Line = Account & {
  recordKind: string;
  amountBrlCents: number;
};

export type MetaCandidateCoverageInput = {
  month: string;
  census: {
    ok: boolean;
    accounts?: Account[];
  };
  lines: Line[];
};

export type MetaCandidateCoverageResult = {
  status: "candidate_complete_unverified" | "unknown";
  blockers: string[];
  expectedAccounts: number;
  coveredAccounts: number;
  candidateBrlCents: number | null;
  candidateNotApplicable: boolean;
  financialAuthority: "unverified";
  registrationAuthorized: false;
  finalClosureAuthorized: false;
};

type Group = {
  accountId: string;
  kind: "amount_record" | "not_applicable_record";
  amount: number;
};

const ACCOUNT = /^[A-Za-z0-9:_-]{1,128}$/;
const MONTH = /^(20\d{2}|2100)-(0[1-9]|1[0-2])-01$/;
const MAX_CENTS = 100000000000;

function validAccount(account: Account): boolean {
  return (
    (account.financialAccountType === "messaging_account" ||
      account.financialAccountType === "business_portfolio") &&
    typeof account.financialAccountId === "string" &&
    ACCOUNT.test(account.financialAccountId)
  );
}

function key(account: Account): string {
  return JSON.stringify([
    account.financialAccountType,
    account.financialAccountId,
  ]);
}

export function assessMetaCandidateMonthlyCoverage(
  input: MetaCandidateCoverageInput,
): MetaCandidateCoverageResult {
  const blockers = new Set<string>();
  const block = (reason: string) => {
    blockers.add(reason);
  };

  if (!MONTH.test(input.month)) {
    block("invalid_month");
  }

  if (!input.census?.ok) {
    block("candidate_census_unavailable");
  }

  const candidates = Array.isArray(input.census?.accounts)
    ? input.census.accounts
    : [];

  if (candidates.length === 0) {
    block("empty_candidate_census");
  }

  const expected = new Map<string, Account>();
  const typesById = new Map<string, string>();

  for (const account of candidates) {
    if (!account || !validAccount(account)) {
      block("invalid_candidate_account");
      continue;
    }

    const accountKey = key(account);

    if (expected.has(accountKey)) {
      block("duplicate_candidate_account");
    }

    expected.set(accountKey, account);

    const previousType = typesById.get(
      account.financialAccountId,
    );

    // A validacao mensal existente identifica contas
    // somente pelo ID. Dois tipos com o mesmo ID
    // seriam ambiguos e devem bloquear o resultado.
    if (
      previousType !== undefined &&
      previousType !== account.financialAccountType
    ) {
      block("ambiguous_account_identity");
    }

    typesById.set(
      account.financialAccountId,
      account.financialAccountType,
    );
  }

  if (!Array.isArray(input.lines)) {
    block("invalid_line_collection");
  }

  const lines = Array.isArray(input.lines)
    ? input.lines
    : [];

  const grouped = new Map<string, Group>();

  for (const line of lines) {
    if (!line || !validAccount(line)) {
      block("invalid_document_account");
      continue;
    }

    const accountKey = key(line);

    if (!expected.has(accountKey)) {
      block("unexpected_document_account");
    }

    if (
      line.recordKind !== "amount_record" &&
      line.recordKind !== "not_applicable_record"
    ) {
      block("invalid_record_kind");
      continue;
    }

    if (
      !Number.isSafeInteger(line.amountBrlCents) ||
      line.amountBrlCents < 0 ||
      line.amountBrlCents > MAX_CENTS
    ) {
      block("invalid_record_amount");
      continue;
    }

    if (
      line.recordKind === "not_applicable_record" &&
      line.amountBrlCents !== 0
    ) {
      block("not_applicable_requires_zero");
      continue;
    }

    const previous = grouped.get(accountKey);

    if (!previous) {
      grouped.set(accountKey, {
        accountId: line.financialAccountId,
        kind: line.recordKind,
        amount: line.amountBrlCents,
      });
      continue;
    }

    if (previous.kind !== line.recordKind) {
      block("mixed_account_record_kinds");
      continue;
    }

    if (line.recordKind === "not_applicable_record") {
      block("duplicate_not_applicable_record");
      continue;
    }

    const newAmount =
      previous.amount + line.amountBrlCents;

    if (
      !Number.isSafeInteger(newAmount) ||
      newAmount > MAX_CENTS
    ) {
      block("account_amount_overflow");
      continue;
    }

    previous.amount = newAmount;
  }

  const normalizedRecords = [...grouped.values()].map(
    (group) => ({
      billingAccountId: group.accountId,
      month: input.month,
      kind: group.kind,
      // O banco representa nao aplicavel com 0.
      // O contrato mensal existente exige null.
      amountBrlCents:
        group.kind === "not_applicable_record"
          ? null
          : group.amount,
    }),
  );

  const structural = assessMetaMonthlyCoverage({
    month: input.month,
    census: {
      complete: input.census?.ok === true &&
        blockers.size === 0,
      billingAccountIds: [...expected.values()].map(
        (account) => account.financialAccountId,
      ),
    },
    records: normalizedRecords,
  });

  for (const reason of structural.blockers) {
    block(reason);
  }

  const complete =
    blockers.size === 0 &&
    structural.status === "candidate_complete";

  return {
    status: complete
      ? "candidate_complete_unverified"
      : "unknown",
    blockers: [...blockers],
    expectedAccounts: expected.size,
    coveredAccounts: grouped.size,
    candidateBrlCents: complete
      ? structural.candidateBrlCents
      : null,
    candidateNotApplicable: complete &&
      structural.candidateNotApplicable,
    financialAuthority: "unverified",
    registrationAuthorized: false,
    finalClosureAuthorized: false,
  };
}