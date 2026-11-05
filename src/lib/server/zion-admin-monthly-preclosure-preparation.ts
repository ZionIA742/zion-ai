import type { MonthlyOpenAiPtaxResult } from "@/lib/server/zion-admin-monthly-openai-ptax";

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
  conversion?: MonthlyOpenAiPtaxResult;
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

function toUsdUnits(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100000000) +
    BigInt(fraction.padEnd(8, "0"));
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

  const conversion = openAi.conversion;
  const confirmedZeroUsd =
    openAiComplete && Number(openAi.totalUsd) === 0;

  if (conversion !== undefined) {
    const invalid =
      typeof conversion.complete !== "boolean" ||
      conversion.expectedDays !== expectedDays ||
      conversion.confirmedDays !== openAi.confirmedDays ||
      !isValidCents(conversion.knownBrlCents) ||
      !Array.isArray(conversion.daily) ||
      conversion.daily.length !== expectedDays ||
      !Array.isArray(conversion.missingOfficialDays) ||
      !Array.isArray(conversion.missingPtaxDays) ||
      conversion.missingOfficialDays.length !==
        expectedDays - conversion.confirmedDays ||
      (conversion.complete &&
        (!openAiComplete ||
          !isValidCents(conversion.totalBrlCents) ||
          conversion.totalBrlCents !== conversion.knownBrlCents ||
          conversion.missingOfficialDays.length > 0 ||
          conversion.missingPtaxDays.length > 0)) ||
      (!conversion.complete && conversion.totalBrlCents !== null) ||
      (confirmedZeroUsd &&
        (!conversion.complete ||
          conversion.knownBrlCents !== 0 ||
          conversion.totalBrlCents !== 0));

    if (invalid) {
      throw new Error("INVALID_OPENAI_PTAX_CONVERSION");
    }

    let knownSum = 0;
    let dailyUsdUnits = BigInt(0);
    let observedConfirmedDays = 0;
    const observedMissingOfficialDays: string[] = [];
    const observedMissingPtaxDays: string[] = [];

    for (let index = 0; index < expectedDays; index++) {
      const day = conversion.daily[index];
      const expectedDate =
        `${month.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`;

      if (
        !day ||
        day.date !== expectedDate ||
        (day.brlCents !== null && !isValidCents(day.brlCents)) ||
        !Array.isArray(day.operationIds) ||
        !Array.isArray(day.snapshotIds)
      ) {
        throw new Error("INVALID_OPENAI_PTAX_CONVERSION");
      }

      if (day.usd === null) {
        if (day.brlCents !== null) {
          throw new Error("INVALID_OPENAI_PTAX_CONVERSION");
        }
        observedMissingOfficialDays.push(expectedDate);
      } else {
        if (!isValidUsd(day.usd)) {
          throw new Error("INVALID_OPENAI_PTAX_CONVERSION");
        }

        observedConfirmedDays++;
        dailyUsdUnits += toUsdUnits(day.usd);

        if (Number(day.usd) === 0 && day.brlCents !== 0) {
          throw new Error("INVALID_OPENAI_PTAX_CONVERSION");
        }

        if (Number(day.usd) > 0 && day.brlCents === null) {
          observedMissingPtaxDays.push(expectedDate);
        }
      }

      knownSum += day.brlCents ?? 0;
      if (!Number.isSafeInteger(knownSum)) {
        throw new Error("INVALID_OPENAI_PTAX_CONVERSION");
      }
    }

    if (
      knownSum !== conversion.knownBrlCents ||
      observedConfirmedDays !== conversion.confirmedDays ||
      JSON.stringify(observedMissingOfficialDays) !==
        JSON.stringify(conversion.missingOfficialDays) ||
      JSON.stringify(observedMissingPtaxDays) !==
        JSON.stringify(conversion.missingPtaxDays) ||
      (openAiComplete &&
        dailyUsdUnits !== toUsdUnits(openAi.totalUsd!))
    ) {
      throw new Error("INVALID_OPENAI_PTAX_CONVERSION");
    }
  }

  const fxComplete =
    confirmedZeroUsd ||
    (openAiComplete && conversion?.complete === true);

  const estimatedBrlCents = fxComplete
    ? (conversion?.totalBrlCents ?? 0)
    : null;

  const knownBrlCents = conversion?.knownBrlCents ??
    (confirmedZeroUsd ? 0 : null);

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

  if (
    !fxComplete &&
    (openAiComplete || (conversion?.missingPtaxDays.length ?? 0) > 0)
  ) {
    pendingSources.push("openai_ptax");
  }

  // A autoridade financeira mensal da Meta ainda nao foi
  // comprovada. Nao transformar estimativas em custos confirmados.
  pendingSources.push("meta_financial_authority");

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
        estimatedBrlCents,
        knownBrlCents,
        fxStatus: confirmedZeroUsd
          ? "not_required_zero"
          : fxComplete
            ? "complete"
            : conversion
              ? "partial"
              : "unavailable",
        missingPtaxDays: [...(conversion?.missingPtaxDays ?? [])],
        dailyEvidence: conversion?.daily.map((day) => ({
          date: day.date,
          usd: day.usd,
          estimatedBrlCents: day.brlCents,
          quotationDate: day.quotationDate,
          rate: day.rate,
          operationIds: [...day.operationIds],
          snapshotIds: [...day.snapshotIds],
        })) ?? [],
        note: "Uso oficial OpenAI nao equivale a fatura ou cartao",
      },
      meta: {
        status: "financial_authority_unknown",
        billedBrlCents: null,
      },
    },
    pendingSources,
    readyForFinalClose: false as const,
  };
}