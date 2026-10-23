/** Shared, side-effect-free accounting rules for the ZION Administrator ledger. */
export type CostFrequency = "monthly" | "annual";
export type CostVersion = {
  cost_id: string;
  effective_month: string;
  name: string;
  amount_cents: number;
  frequency: CostFrequency;
  enabled: boolean;
};

/** Pro-rates annual cents exactly, without losing cents over a 12-month year. */
export function monthlyAllocation(amountCents: number, frequency: CostFrequency, month: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || month < 1 || month > 12 || !Number.isInteger(month)) {
    throw new Error("Invalid fixed expense allocation");
  }
  if (frequency === "monthly") return amountCents;
  if (frequency !== "annual") throw new Error("Invalid frequency");
  return Math.floor((month * amountCents) / 12) - Math.floor(((month - 1) * amountCents) / 12);
}

/** Future versions supersede previous versions, while past periods remain unchanged. */
export function applicableFixedCosts(versions: CostVersion[], month: string) {
  const picked = new Map<string, CostVersion>();
  for (const item of versions) {
    if (item.effective_month > month) continue;
    const previous = picked.get(item.cost_id);
    if (!previous || previous.effective_month < item.effective_month) picked.set(item.cost_id, item);
  }
  return [...picked.values()].filter((value) => value.enabled).map((item) => ({
    ...item,
    monthly_cents: monthlyAllocation(item.amount_cents, item.frequency, Number(month.slice(5, 7))),
  }));
}

export function parseCostPeriod(period: string, anchor: string) {
  if (!/^(day|week|month|year)$/.test(period) || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
    throw new Error("Período inválido");
  }
  const date = new Date(`${anchor}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== anchor) throw new Error("Data inválida");
  if (date.getUTCFullYear() < 2020 || date.getUTCFullYear() > 2100) throw new Error("Ano inválido");
  const midnight = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  let start = midnight;
  let end = new Date(midnight);
  if (period === "week") {
    start = new Date(midnight);
    start.setUTCDate(midnight.getUTCDate() - ((midnight.getUTCDay() + 6) % 7));
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
  } else if (period === "month") {
    start = new Date(Date.UTC(midnight.getUTCFullYear(), midnight.getUTCMonth(), 1));
    end = new Date(Date.UTC(midnight.getUTCFullYear(), midnight.getUTCMonth() + 1, 1));
  } else if (period === "year") {
    start = new Date(Date.UTC(midnight.getUTCFullYear(), 0, 1));
    end = new Date(Date.UTC(midnight.getUTCFullYear() + 1, 0, 1));
  } else {
    end.setUTCDate(end.getUTCDate() + 1);
  }
  // Sao Paulo has remained UTC−3 since Brazil discontinued DST in 2019.
  // The accounting period is based on the local wall clock, not the server timezone.
  return {
    start: new Date(start.getTime() + 3 * 3600_000).toISOString(),
    end: new Date(end.getTime() + 3 * 3600_000).toISOString(),
    startMonth: start.toISOString().slice(0, 7) + "-01",
    // Include every month intersected by the half-open [start, end) range.
    endMonthExclusive: (() => {
      const lastIncluded = new Date(end.getTime() - 1);
      return new Date(Date.UTC(lastIncluded.getUTCFullYear(), lastIncluded.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    })(),
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export type AiCostCategory = "sales" | "assistant" | "images" | "catalog" | "unclassified";
export type CostSourceAvailability = "available" | "partial" | "unavailable";
export type CostCompleteness = "complete" | "incomplete" | "no_runs";

export function normalizeCostSourceAvailability(value: unknown): CostSourceAvailability {
  return value === "available" || value === "partial" || value === "unavailable" ? value : "unavailable";
}

/** Converts only finite, non-negative accounting values; blank strings never become zero. */
export function toKnownCostNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

export function classifyCostCompleteness(
  runCount: number,
  sourceAvailability: CostSourceAvailability,
  allValuesKnown: boolean,
): CostCompleteness {
  if (runCount === 0) return "no_runs";
  return sourceAvailability === "available" && allValuesKnown ? "complete" : "incomplete";
}

export function formatCostMetric(
  value: number | null | undefined,
  availability: CostSourceAvailability | unknown,
  completeness: CostCompleteness | unknown,
  format: (value: number) => string,
): string {
  const source = normalizeCostSourceAvailability(availability);
  if (source === "unavailable") return "Indisponível";
  if (source === "partial") return "Parcial";
  if (completeness === "no_runs") return "Sem execuções";
  if (completeness !== "complete" || value == null || !Number.isFinite(value)) return "Incompleto";
  return format(value);
}

export function classifyCostRun(row: { input?: unknown; output?: unknown; conversation_id?: string | null; lead_id?: string | null }): AiCostCategory {
  const value = JSON.stringify([row.input ?? null, row.output ?? null]).toLowerCase();
  if (["pool_image_generation", "image_generation", "geracao_imagem", "geração de imagem", "montagem", "piscina instalada"].some((v) => value.includes(v))) return "images";
  if (["visual_catalog", "visual-catalog", "catalog_document", "catalogo_visual", "catálogo visual"].some((v) => value.includes(v))) return "catalog";
  if (["assistant_chat", "assistant_operational", "operational_assistant", "store_assistant", "ia_assistente", "assistant/reply"].some((v) => value.includes(v))) return "assistant";
  if (["ai_sales", "sales_reply", "generate-and-save-ai-sales-reply", "internal_ai_sales_reply_bridge"].some((v) => value.includes(v)) || (row.conversation_id && row.lead_id)) return "sales";
  return "unclassified";
}

/**
 * Distribute the FULL monthly expense over days since it actually began.
 * The initial ZION expenses start on 2026-11-23, so their November amount is
 * allocated across Nov 23–30, not prorated to only 8/30 of the monthly amount.
 * Subsequent months use all their calendar days. `untilDate` is exclusive.
 */
export function monthlyAccrual(
  monthlyCents: number,
  month: string,
  fromDate: string,
  untilDate: string,
  startsOn: string,
): number {
  const [year, m] = month.slice(0, 7).split("-").map(Number);
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const lastOfMonth = `${month.slice(0, 7)}-${String(days).padStart(2, "0")}`;
  if (startsOn > lastOfMonth) return 0;
  const firstDay = startsOn.slice(0, 7) === month.slice(0, 7) ? Number(startsOn.slice(8, 10)) : 1;
  const countOfChargeableDays = days - firstDay + 1;
  let sum = 0;
  for (let day = firstDay; day <= days; day++) {
    const date = `${month.slice(0, 7)}-${String(day).padStart(2, "0")}`;
    if (date >= fromDate && date < untilDate) {
      const elapsed = day - firstDay;
      sum += Math.floor(((elapsed + 1) * monthlyCents) / countOfChargeableDays)
        - Math.floor((elapsed * monthlyCents) / countOfChargeableDays);
    }
  }
  return sum;
}

export function monthlyFixedSum(versions: CostVersion[], month: string): number {
  return applicableFixedCosts(versions, month).reduce((sum, item) => sum + item.monthly_cents, 0);
}
