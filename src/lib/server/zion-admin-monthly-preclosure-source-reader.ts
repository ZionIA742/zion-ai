/**
 * ZION-ADM / 8-E.4
 * Leitor mensal somente no servidor.
 * Sem chamadas a APIs externas de cobrança e sem escrita.
 */
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";
import { applicableFixedCosts, type CostVersion } from "@/lib/server/zion-admin-costs";
import { buildOfficialOpenAiCostReport } from "@/lib/server/zion-admin-openai-official-cost-report";
import type {
  MonthlyPreclosureSources,
  RegisteredBrlSource,
  RegisteredManualSource,
  OfficialOpenAiSource,
} from "@/lib/server/zion-admin-monthly-preclosure-preparation";

type Db = ReturnType<typeof createServiceSupabaseClient>;

const UNKNOWN_FIXED: RegisteredBrlSource = {
  availability: "unavailable",
  amountBrlCents: null,
};

const UNKNOWN_MANUAL: RegisteredManualSource = {
  availability: "unavailable",
  amountBrlCents: null,
  amountUsdCents: null,
};

const UNKNOWN_OPENAI: OfficialOpenAiSource = {
  availability: "unavailable",
  confirmedDays: 0,
  totalUsd: null,
};

function validMinor(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !/^\d+$/.test(value))
  ) {
    return null;
  }

  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0
    ? amount
    : null;
}

function lastDay(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) {
    throw new Error("INVALID_PRECLOSURE_MONTH");
  }

  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));

  if (year < 2020 || year > 2100) {
    throw new Error("INVALID_PRECLOSURE_MONTH");
  }

  const day = new Date(
    Date.UTC(year, number, 0),
  ).getUTCDate();

  return `${month.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

async function readFixed(
  db: Db,
  month: string,
  monthEnd: string,
): Promise<RegisteredBrlSource> {
  try {
    const [versionsResult, itemsResult] = await Promise.all([
      db.from("zion_admin_fixed_cost_versions")
        .select("item_id,effective_month,name,amount_cents,frequency,enabled")
        .order("item_id", { ascending: true })
        .order("effective_month", { ascending: true })
        .range(0, 999),

      db.from("zion_admin_fixed_cost_items")
        .select("id,starts_on")
        .order("id", { ascending: true })
        .range(0, 999),
    ]);

    if (
      versionsResult.error ||
      itemsResult.error ||
      !versionsResult.data ||
      !itemsResult.data ||
      versionsResult.data.length === 1000 ||
      itemsResult.data.length === 1000
    ) {
      return UNKNOWN_FIXED;
    }

    const startsOn = new Map<string, string>();

    for (const item of itemsResult.data) {
      if (
        typeof item.id !== "string" ||
        typeof item.starts_on !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.starts_on)
      ) {
        return UNKNOWN_FIXED;
      }

      startsOn.set(item.id, item.starts_on);
    }

    const versions: CostVersion[] = [];

    for (const row of versionsResult.data) {
      const cents = validMinor(row.amount_cents);

      if (
        typeof row.item_id !== "string" ||
        typeof row.effective_month !== "string" ||
        !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(row.effective_month) ||
        typeof row.name !== "string" ||
        (row.frequency !== "monthly" && row.frequency !== "annual") ||
        typeof row.enabled !== "boolean" ||
        cents === null
      ) {
        return UNKNOWN_FIXED;
      }

      versions.push({
        cost_id: row.item_id,
        effective_month: row.effective_month,
        name: row.name,
        amount_cents: cents,
        frequency: row.frequency,
        enabled: row.enabled,
      });
    }

    let total = 0;

    for (const item of applicableFixedCosts(versions, month)) {
      const began = startsOn.get(item.cost_id);

      if (!began) return UNKNOWN_FIXED;
      if (began > monthEnd) continue;

      total += item.monthly_cents;

      if (!Number.isSafeInteger(total)) {
        return UNKNOWN_FIXED;
      }
    }

    return {
      availability: "available",
      amountBrlCents: total,
    };
  } catch {
    return UNKNOWN_FIXED;
  }
}

async function readManual(
  db: Db,
  month: string,
): Promise<RegisteredManualSource> {
  try {
    const pageSize = 500;
    const limit = 100000;

    let brl = 0;
    let usd = 0;

    for (
      let offset = 0;
      offset < limit;
      offset += pageSize
    ) {
      const { data, error } = await db
        .from("zion_admin_variable_expenses")
        .select("id,competence_month,status,currency,amount_minor")
        .eq("competence_month", month)
        .eq("status", "active")
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error || !data) return UNKNOWN_MANUAL;

      for (const row of data) {
        const cents = validMinor(row.amount_minor);

        if (
          row.competence_month !== month ||
          row.status !== "active" ||
          cents === null
        ) {
          return UNKNOWN_MANUAL;
        }

        if (row.currency === "BRL") {
          brl += cents;
        } else if (row.currency === "USD") {
          usd += cents;
        } else {
          return UNKNOWN_MANUAL;
        }

        if (
          !Number.isSafeInteger(brl) ||
          !Number.isSafeInteger(usd)
        ) {
          return UNKNOWN_MANUAL;
        }
      }

      if (data.length < pageSize) {
        return {
          availability: "available",
          amountBrlCents: brl,
          amountUsdCents: usd,
        };
      }
    }

    return UNKNOWN_MANUAL;
  } catch {
    return UNKNOWN_MANUAL;
  }
}

async function readOpenAi(
  db: Db,
  month: string,
  monthEnd: string,
): Promise<OfficialOpenAiSource> {
  try {
    const report = await buildOfficialOpenAiCostReport(
      db,
      month,
      monthEnd,
    );

    const expected = Number(monthEnd.slice(8, 10));

    if (
      report.source !== "openai_organization_costs" ||
      report.period.from !== month ||
      report.period.to !== monthEnd ||
      report.period.timezone !== "UTC" ||
      !Array.isArray(report.daily) ||
      report.daily.length !== expected
    ) {
      return UNKNOWN_OPENAI;
    }

    const confirmedDays = report.daily.filter(
      (day) =>
        day.status === "available" ||
        day.status === "confirmed_empty",
    ).length;

    if (report.availability === "complete") {
      if (
        confirmedDays !== expected ||
        typeof report.totalUsd !== "string" ||
        !/^\d+(?:\.\d{1,8})?$/.test(report.totalUsd)
      ) {
        return UNKNOWN_OPENAI;
      }

      return {
        availability: "complete",
        confirmedDays,
        totalUsd: report.totalUsd,
      };
    }

    if (
      report.availability === "partial" ||
      report.availability === "unavailable"
    ) {
      return {
        availability: report.availability,
        confirmedDays,
        totalUsd: null,
      };
    }

    return UNKNOWN_OPENAI;
  } catch {
    return UNKNOWN_OPENAI;
  }
}

export async function readMonthlyPreclosureSources(
  month: string,
): Promise<MonthlyPreclosureSources> {
  const monthEnd = lastDay(month);
  const db = createServiceSupabaseClient();

  const [fixed, manual, openAi] = await Promise.all([
    readFixed(db, month, monthEnd),
    readManual(db, month),
    readOpenAi(db, month, monthEnd),
  ]);

  return { fixed, manual, openAi };
}