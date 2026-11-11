/**
 * Pure arithmetic for a candidate monthly final close.
 * Does not authenticate evidence or authorize writes.
 */

export const FINAL_CLOSE_REQUIRED_EXPENSE_SOURCES = [
  "fixed_costs",
  "manual_expenses",
  "openai_invoice",
  "meta_invoice",
] as const;

export type MonthlyFinalExpense = Readonly<{
  source: string;
  amountBrlCents: number | null;
}>;

export type MonthlyFinalTotalsInput = Readonly<{
  revenueBrlCents: number | null;
  expenses: readonly MonthlyFinalExpense[];
}>;

export type MonthlyFinalTotals = Readonly<{
  revenueBrlCents: number;
  expensesBrlCents: number;
  resultBrlCents: number;
  breakdown: readonly Readonly<{
    source: string;
    amountBrlCents: number;
  }>[];
}>;

function checkedCents(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error("FINAL_TOTALS_INVALID_CENTS");
  }

  return value;
}

export function calculateMonthlyFinalCloseTotalsCandidate(
  input: MonthlyFinalTotalsInput,
): MonthlyFinalTotals {
  if (
    !input ||
    typeof input !== "object" ||
    !Array.isArray(input.expenses)
  ) {
    throw new Error("FINAL_TOTALS_INVALID_INPUT");
  }

  const revenue = checkedCents(input.revenueBrlCents);
  const required = FINAL_CLOSE_REQUIRED_EXPENSE_SOURCES;
  const allowed = new Set<string>(required);
  const amounts = new Map<string, number>();

  for (const item of input.expenses) {
    if (
      !item ||
      typeof item.source !== "string" ||
      !allowed.has(item.source)
    ) {
      throw new Error("FINAL_TOTALS_UNEXPECTED_SOURCE");
    }

    if (amounts.has(item.source)) {
      throw new Error("FINAL_TOTALS_DUPLICATE_SOURCE");
    }

    amounts.set(
      item.source,
      checkedCents(item.amountBrlCents),
    );
  }

  if (amounts.size !== required.length) {
    throw new Error("FINAL_TOTALS_MISSING_SOURCE");
  }

  const breakdown = Object.freeze(
    required.map((source) => {
      const amountBrlCents = amounts.get(source);

      if (amountBrlCents === undefined) {
        throw new Error("FINAL_TOTALS_MISSING_SOURCE");
      }

      return Object.freeze({
        source,
        amountBrlCents,
      });
    }),
  );

  const expenseTotal = breakdown.reduce(
    (sum, item) => sum + BigInt(item.amountBrlCents),
    BigInt(0),
  );

  const result = BigInt(revenue) - expenseTotal;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = BigInt(Number.MIN_SAFE_INTEGER);

  if (
    expenseTotal > max ||
    result > max ||
    result < min
  ) {
    throw new Error("FINAL_TOTALS_OVERFLOW");
  }

  return Object.freeze({
    revenueBrlCents: revenue,
    expensesBrlCents: Number(expenseTotal),
    resultBrlCents: Number(result),
    breakdown,
  });
}
