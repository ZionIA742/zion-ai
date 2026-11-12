export type MonthlyFinalCloseEligibilityInput = {
  month: string;
  preclosure: {
    month: string;
    revision: number;
    pendingSources: string[];
  };
  fixed: {
    availability: "available" | "unavailable";
    brlCents: number | null;
  };
  manual: {
    availability: "available" | "unavailable";
    brlCents: number | null;
    usdCents: number | null;
  };
  manualRevenue: {
    status: "confirmed" | "not_reported";
    amountBrlCents: number | null;
    revision: number | null;
  };

  openAi: {
    availability: "complete" | "partial" | "unavailable";
    confirmedDays: number;
    officialUsd: string | null;
  };
  ptax: {
    availability: "complete" | "unavailable";
    estimatedBrlCents: number | null;
  };
  meta: {
    status: "verified_amount" | "verified_not_applicable" | "unknown";
    brlCents: number | null;
    authorityKey: string | null;
  };
};

export type MonthlyFinalCloseEligibilityResult = {
  eligible: boolean;
  blockers: string[];
};

function validCents(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

function validUsd(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d+(?:\.\d{1,8})?$/.test(value) &&
    Number.isFinite(Number(value));
}

function expectedDays(month: string): number | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) {
    return null;
  }

  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));

  if (year < 2020 || year > 2100) return null;

  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

/**
 * Avaliacao pura, sem banco, rede ou mutacoes.
 *
 * Nao comprova origem de dados: os leitores e a futura RPC
 * transacional devem verificar as autoridades novamente.
 *
 * Elegibilidade refere-se ao fechamento dos custos registrados,
 * nao a confirmacao de pagamentos bancarios.
 */
export function evaluateMonthlyFinalCloseEligibility(
  input: MonthlyFinalCloseEligibilityInput,
): MonthlyFinalCloseEligibilityResult {
  const blockers: string[] = [];
  const days = expectedDays(input.month);

  if (days === null) {
    blockers.push("invalid_month");
  }

  if (
    input.preclosure.month !== input.month ||
    !Number.isSafeInteger(input.preclosure.revision) ||
    input.preclosure.revision < 1
  ) {
    blockers.push("invalid_preclosure_revision");
  }

  if (
    !Array.isArray(input.preclosure.pendingSources) ||
    input.preclosure.pendingSources.length > 0
  ) {
    blockers.push("pending_preclosure_sources");
  }

  if (
    input.fixed.availability !== "available" ||
    !validCents(input.fixed.brlCents)
  ) {
    blockers.push("fixed_costs_unavailable");
  }

  if (
    input.manual.availability !== "available" ||
    !validCents(input.manual.brlCents) ||
    !validCents(input.manual.usdCents)
  ) {
    blockers.push("manual_expenses_unavailable");
  } else if (input.manual.usdCents > 0) {
    blockers.push("manual_usd_conversion_undefined");
  }

  // Receita ausente nao equivale a receita zero.
  // A autoridade da receita sera conferida novamente
  // pelo futuro executor transacional.
  if (
    !input.manualRevenue ||
    input.manualRevenue.status !== "confirmed" ||
    !validCents(input.manualRevenue.amountBrlCents) ||
    typeof input.manualRevenue.revision !== "number" ||
    !Number.isSafeInteger(input.manualRevenue.revision) ||
    input.manualRevenue.revision < 1
  ) {
    blockers.push("manual_revenue_unconfirmed");
  }

  const openAiComplete =
    input.openAi.availability === "complete" &&
    days !== null &&
    input.openAi.confirmedDays === days &&
    validUsd(input.openAi.officialUsd);

  if (!openAiComplete) {
    blockers.push("openai_official_incomplete");
  }

  // USD oficial zero confirmado nao exige cotacao para
  // produzir uma conversao zero. USD desconhecido nao e zero.
  const confirmedZeroUsd =
    openAiComplete && Number(input.openAi.officialUsd) === 0;

  if (
    !confirmedZeroUsd &&
    (
      input.ptax.availability !== "complete" ||
      !validCents(input.ptax.estimatedBrlCents)
    )
  ) {
    blockers.push("ptax_incomplete");
  }

  const validMetaAuthority =
    typeof input.meta.authorityKey === "string" &&
    input.meta.authorityKey.trim().length > 0;

  if (
    input.meta.status === "verified_amount" &&
    (!validMetaAuthority || !validCents(input.meta.brlCents))
  ) {
    blockers.push("meta_unverified");
  } else if (
    input.meta.status === "verified_not_applicable" &&
    (!validMetaAuthority || input.meta.brlCents !== 0)
  ) {
    blockers.push("meta_unverified");
  } else if (
    input.meta.status !== "verified_amount" &&
    input.meta.status !== "verified_not_applicable"
  ) {
    blockers.push("meta_unverified");
  }

  return {
    eligible: blockers.length === 0,
    blockers,
  };
}