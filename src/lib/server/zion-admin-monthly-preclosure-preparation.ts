/**
 * ZION-ADM / 8-E.3
 *
 * Preparacao pura do snapshot financeiro mensal.
 *
 * Nao acessa banco, fornecedores ou rede.
 * Nao grava pre-fechamento nem fechamento definitivo.
 * Nao transforma custo desconhecido em zero.
 *
 * Os adaptadores de leitura deverao fornecer informacoes
 * verificadas a partir das respectivas fontes.
 */

export type RegisteredBrlSource = {
  availability: "available" | "unavailable";
  amountBrlCents: number | null;
};

export type RegisteredManualSource = {
  availability: "available" | "unavailable";
  amountBrlCents: number | null;
  amountUsdCents: number | null;
};

export type OfficialOpenAiSource = {
  availability: "complete" | "partial" | "unavailable";
  confirmedDays: number;
  totalUsd: string | null;
};

export type MonthlyPreclosureSources = {
  fixed: RegisteredBrlSource;
  manual: RegisteredManualSource;
  openAi: OfficialOpenAiSource;
};

function isValidCents(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isValidUsd(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d+(?:\.\d{1,8})?$/.test(value)
  );
}

function daysInMonth(month: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) {
    throw new Error("INVALID_PRECLOSURE_MONTH");
  }

  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));

  if (year < 2020 || year > 9999) {
    throw new Error("INVALID_PRECLOSURE_MONTH");
  }

  return new Date(Date.UTC(year, monthNumber, 0))
    .getUTCDate();
}

function validateRegisteredSources(
  sources: MonthlyPreclosureSources,
): void {
  const fixedValid =
    sources.fixed.availability === "available"
      ? isValidCents(sources.fixed.amountBrlCents)
      : sources.fixed.availability === "unavailable" &&
        sources.fixed.amountBrlCents === null;

  const manualValid =
    sources.manual.availability === "available"
      ? isValidCents(sources.manual.amountBrlCents) &&
        isValidCents(sources.manual.amountUsdCents)
      : sources.manual.availability === "unavailable" &&
        sources.manual.amountBrlCents === null &&
        sources.manual.amountUsdCents === null;

  if (!fixedValid || !manualValid) {
    throw new Error("INVALID_REGISTERED_FINANCIAL_SOURCE");
  }
}

export function prepareMonthlyPreclosureSnapshot(
  month: string,
  sources: MonthlyPreclosureSources,
) {
  const expectedDays = daysInMonth(month);
  validateRegisteredSources(sources);

  const openAi = sources.openAi;

  if (
    !Number.isInteger(openAi.confirmedDays) ||
    openAi.confirmedDays < 0 ||
    openAi.confirmedDays > expectedDays
  ) {
    throw new Error("INVALID_OPENAI_DAY_COVERAGE");
  }

  const openAiComplete =
    openAi.availability === "complete" &&
    openAi.confirmedDays === expectedDays &&
    isValidUsd(openAi.totalUsd);

  if (openAi.availability === "complete" && !openAiComplete) {
    throw new Error("INVALID_OFFICIAL_OPENAI_TOTAL");
  }

  if (
    openAi.availability !== "complete" &&
    openAi.availability !== "partial" &&
    openAi.availability !== "unavailable"
  ) {
    throw new Error("INVALID_OFFICIAL_OPENAI_AVAILABILITY");
  }

  const pendingSources: string[] = [];

  if (sources.fixed.availability !== "available") {
    pendingSources.push("fixed_costs");
  }

  if (sources.manual.availability !== "available") {
    pendingSources.push("manual_expenses");
  }

  if (!openAiComplete) {
    pendingSources.push("openai_official");
  }

  // A integracao de comprovantes reais Meta ainda nao foi
  // implementada. Nao aceitar estimativas como fatura.
  pendingSources.push("meta_invoice");

  return {
    sourceSnapshot: {
      month,
      timezone: "America/Sao_Paulo",
      fixed: {
        status: sources.fixed.availability === "available"
          ? "registered"
          : "not_verified",
        registeredBrlCents: sources.fixed.amountBrlCents,
        note: "Valor fixo cadastrado; nao comprova pagamento",
      },
      manual: {
        status: sources.manual.availability === "available"
          ? "registered"
          : "not_verified",
        registeredBrlCents: sources.manual.amountBrlCents,
        registeredUsdCents: sources.manual.amountUsdCents,
      },
      openai: {
        status: openAiComplete
          ? "official_period_complete"
          : "official_period_incomplete",
        confirmedDays: openAi.confirmedDays,
        expectedDays,
        officialUsd: openAiComplete ? openAi.totalUsd : null,
        note: "Uso oficial OpenAI nao equivale a fatura ou cartao",
      },
      meta: {
        status: "invoice_not_verified",
        billedBrlCents: null,
      },
    },
    pendingSources,
    readyForFinalClose: false as const,
  };
}