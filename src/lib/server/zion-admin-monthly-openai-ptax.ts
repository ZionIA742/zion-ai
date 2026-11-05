export type MonthlyOfficialDay = {
  date: string;
  status: "available" | "confirmed_empty" | "not_collected" | "unavailable";
  totalUsd: string | null;
  operationIds?: string[];
  snapshotIds?: string[];
};

export type MonthlyPtaxDay = {
  date: string;
  quotationDate: string | null;
  rate: string | null;
  status: "same_day" | "previous_available" | "unavailable";
};

export type MonthlyOpenAiPtaxResult = {
  complete: boolean;
  confirmedDays: number;
  expectedDays: number;
  knownBrlCents: number;
  totalBrlCents: number | null;
  missingOfficialDays: string[];
  missingPtaxDays: string[];
  daily: Array<{
    date: string;
    usd: string | null;
    brlCents: number | null;
    quotationDate: string | null;
    rate: string | null;
    operationIds: string[];
    snapshotIds: string[];
  }>;
};

function monthDates(month: string): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) {
    throw new Error("INVALID_MONTH");
  }

  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));

  if (year < 2020 || year > 2100) {
    throw new Error("INVALID_MONTH");
  }

  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();

  return Array.from(
    { length: count },
    (_, index) =>
      `${month.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`,
  );
}

function indexedDays<T extends { date: string }>(
  rows: readonly T[],
  expected: readonly string[],
): Map<string, T> {
  if (!Array.isArray(rows) || rows.length !== expected.length) {
    throw new Error("INVALID_DAILY_COVERAGE");
  }

  const allowed = new Set(expected);
  const result = new Map<string, T>();

  for (const row of rows) {
    if (!row || !allowed.has(row.date) || result.has(row.date)) {
      throw new Error("INVALID_DAILY_COVERAGE");
    }

    result.set(row.date, row);
  }

  return result;
}

function decimalCents(value: string): number {
  if (!/^\d+\.\d{2}$/.test(value)) {
    throw new Error("INVALID_BRL_CONVERSION");
  }

  const cents = BigInt(value.replace(".", ""));

  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("BRL_CONVERSION_OVERFLOW");
  }

  return Number(cents);
}

function validQuotation(day: string, quote: MonthlyPtaxDay): boolean {
  if (
    quote.status === "unavailable" ||
    typeof quote.rate !== "string" ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(quote.rate) ||
    !Number.isFinite(Number(quote.rate)) ||
    Number(quote.rate) <= 0 ||
    typeof quote.quotationDate !== "string"
  ) {
    return false;
  }

  const difference =
    (Date.parse(`${day}T00:00:00Z`) -
      Date.parse(`${quote.quotationDate}T00:00:00Z`)) / 86400000;

  return Number.isInteger(difference) &&
    difference >= 0 &&
    difference <= 10 &&
    (
      (difference === 0 && quote.status === "same_day") ||
      (difference > 0 && quote.status === "previous_available")
    );
}

/**
 * Calculo puro da conversao OpenAI oficial por dia UTC.
 *
 * O conversor e a funcao canonica convertOfficialUsdToBrl.
 * Nenhuma fonte e consultada e nenhum dado e gravado.
 *
 * A origem financeira continua sujeita a verificacao
 * pelo leitor servidor e pela futura autoridade SQL.
 */
export function summarizeMonthlyOpenAiPtax(
  month: string,
  officialDays: readonly MonthlyOfficialDay[],
  ptaxDays: readonly MonthlyPtaxDay[],
  convert: (usd: string, rate: string) => string,
): MonthlyOpenAiPtaxResult {
  const expected = monthDates(month);
  const official = indexedDays(officialDays, expected);
  const quotations = indexedDays(ptaxDays, expected);

  const missingOfficialDays: string[] = [];
  const missingPtaxDays: string[] = [];
  const daily: MonthlyOpenAiPtaxResult["daily"] = [];

  let confirmedDays = 0;
  let knownBrlCents = 0;

  for (const date of expected) {
    const source = official.get(date)!;
    const quotation = quotations.get(date)!;

    const confirmed =
      source.status === "available" ||
      source.status === "confirmed_empty";

    let usd: string | null = null;
    let brlCents: number | null = null;
    let quotationDate: string | null = null;
    let rate: string | null = null;

    if (!confirmed) {
      missingOfficialDays.push(date);
    } else {
      confirmedDays++;

      if (
        source.status === "confirmed_empty" &&
        source.totalUsd !== "0"
      ) {
        throw new Error("INVALID_CONFIRMED_EMPTY");
      }

      if (
        typeof source.totalUsd !== "string" ||
        !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(source.totalUsd)
      ) {
        throw new Error("INVALID_OFFICIAL_USD");
      }

      usd = source.totalUsd;

      if (Number(usd) === 0) {
        brlCents = 0;
      } else if (!validQuotation(date, quotation)) {
        missingPtaxDays.push(date);
      } else {
        brlCents = decimalCents(convert(usd, quotation.rate!));
        quotationDate = quotation.quotationDate;
        rate = quotation.rate;
      }

      if (brlCents !== null) {
        knownBrlCents += brlCents;

        if (!Number.isSafeInteger(knownBrlCents)) {
          throw new Error("BRL_TOTAL_OVERFLOW");
        }
      }
    }

    daily.push({
      date,
      usd,
      brlCents,
      quotationDate,
      rate,
      operationIds: [...(source.operationIds ?? [])],
      snapshotIds: [...(source.snapshotIds ?? [])],
    });
  }

  const complete =
    missingOfficialDays.length === 0 &&
    missingPtaxDays.length === 0;

  return {
    complete,
    confirmedDays,
    expectedDays: expected.length,
    knownBrlCents,
    totalBrlCents: complete ? knownBrlCents : null,
    missingOfficialDays,
    missingPtaxDays,
    daily,
  };
}