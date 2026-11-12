/**
 * ZION-ADM | D.13-A
 * Leitor puro do historico financeiro.
 *
 * Nao mistura receita atual com evidencia historica.
 * Nao presume zero para valores ausentes.
 * Nunca autoriza fechamento definitivo.
 */
type Row = Record<string, unknown>;

type HistoryInput = {
  months: string[];
  preclosures: unknown;
  preclosureAudits: unknown;
  revenues: unknown;
  revenueAudits: unknown;
};

function object(value: unknown): Row {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("FINANCIAL_HISTORY_INVALID_RECORD");
  }
  return value as Row;
}

function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) {
    throw new Error("FINANCIAL_HISTORY_INVALID_COLLECTION");
  }
  return value.map(object);
}

function revision(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new Error("FINANCIAL_HISTORY_INVALID_REVISION");
  }
  return value;
}

function cents(value: unknown): number {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !/^\d+$/.test(value))
  ) {
    throw new Error("FINANCIAL_HISTORY_INVALID_AMOUNT");
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("FINANCIAL_HISTORY_INVALID_AMOUNT");
  }

  return number;
}

function optionalCents(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : cents(value);
}

function mapCurrent(items: unknown, months: Set<string>): Map<string, Row> {
  const result = new Map<string, Row>();

  for (const item of rows(items)) {
    const month = item.month;

    if (
      typeof month !== "string" ||
      !months.has(month) ||
      result.has(month)
    ) {
      throw new Error("FINANCIAL_HISTORY_INVALID_CURRENT_ROW");
    }

    result.set(month, item);
  }

  return result;
}

function auditMap(
  items: unknown,
  months: Set<string>,
): Map<string, Row> {
  const result = new Map<string, Row>();

  for (const item of rows(items)) {
    const month = item.month;
    const rev = revision(item.revision);

    if (typeof month !== "string" || !months.has(month)) {
      throw new Error("FINANCIAL_HISTORY_INVALID_AUDIT");
    }

    const key = `${month}:${rev}`;

    if (result.has(key)) {
      throw new Error("FINANCIAL_HISTORY_DUPLICATE_AUDIT");
    }

    result.set(key, item);
  }

  return result;
}

function recordedCost(
  source: Row,
  field: string,
): number | null {
  return source.status === "registered"
    ? cents(source[field])
    : null;
}

export function buildMonthlyFinancialHistory(input: HistoryInput) {
  if (
    !Array.isArray(input.months) ||
    input.months.length < 1 ||
    input.months.length > 24 ||
    new Set(input.months).size !== input.months.length ||
    input.months.some(
      (month) =>
        typeof month !== "string" ||
        !/^20\d{2}-(0[1-9]|1[0-2])-01$/.test(month),
    )
  ) {
    throw new Error("FINANCIAL_HISTORY_INVALID_MONTHS");
  }

  const months = new Set(input.months);
  const preclosures = mapCurrent(input.preclosures, months);
  const revenues = mapCurrent(input.revenues, months);
  const preAudits = auditMap(input.preclosureAudits, months);
  const revenueAudits = auditMap(input.revenueAudits, months);

  return input.months.map((month) => {
    const pre = preclosures.get(month) ?? null;
    const revenueRow = revenues.get(month) ?? null;

    let revenueAmount: number | null = null;
    let revenueRevision: number | null = null;

    if (revenueRow !== null) {
      revenueAmount = cents(revenueRow.amount_brl_cents);
      revenueRevision = revision(revenueRow.revision);

      if (revenueAmount > 100000000000) {
        throw new Error("FINANCIAL_HISTORY_REVENUE_OVERFLOW");
      }

      const audit = revenueAudits.get(`${month}:${revenueRevision}`);

      if (
        !audit ||
        cents(audit.amount_brl_cents) !== revenueAmount
      ) {
        throw new Error("FINANCIAL_HISTORY_REVENUE_AUDIT_MISMATCH");
      }
    }

    let preclosureRevision: number | null = null;
    let pendingSources: string[] = [];
    let fixedCents: number | null = null;
    let manualCents: number | null = null;
    let openAiCents: number | null = null;

    let snapshotRevenueStatus:
      "no_preclosure" | "legacy_not_recorded" |
      "confirmed" | "not_reported" = "no_preclosure";

    let snapshotRevenueCents: number | null = null;
    let snapshotRevenueRevision: number | null = null;

    if (pre !== null) {
      preclosureRevision = revision(pre.revision);

      const audit = preAudits.get(`${month}:${preclosureRevision}`);

      if (!audit) {
        throw new Error("FINANCIAL_HISTORY_PRECLOSURE_AUDIT_MISMATCH");
      }

      if (
        !Array.isArray(pre.pending_sources) ||
        pre.pending_sources.some(
          (value: unknown) => typeof value !== "string",
        )
      ) {
        throw new Error("FINANCIAL_HISTORY_INVALID_PENDING_SOURCES");
      }

      pendingSources = [...pre.pending_sources] as string[];

      const envelope = object(pre.source_snapshot);
      const sources = object(envelope.sources);

      if (
        envelope.schema_version !== 1 ||
        envelope.financial_status !== "preliminary"
      ) {
        throw new Error("FINANCIAL_HISTORY_INVALID_SNAPSHOT");
      }

      if (sources.month !== month) {
        throw new Error("FINANCIAL_HISTORY_MONTH_MISMATCH");
      }

      const fixed = object(sources.fixed);
      const manual = object(sources.manual);
      const openAi = object(sources.openai);

      fixedCents = recordedCost(fixed, "registeredBrlCents");
      manualCents = recordedCost(manual, "registeredBrlCents");
      openAiCents = optionalCents(openAi.knownBrlCents);

      if (sources.manualRevenue === undefined) {
        snapshotRevenueStatus = "legacy_not_recorded";
      } else {
        const snapshotRevenue = object(sources.manualRevenue);

        if (snapshotRevenue.status === "confirmed") {
          snapshotRevenueStatus = "confirmed";
          snapshotRevenueCents = cents(
            snapshotRevenue.amountBrlCents,
          );
          snapshotRevenueRevision = revision(
            snapshotRevenue.revision,
          );
        } else if (
          snapshotRevenue.status === "not_reported" &&
          snapshotRevenue.amountBrlCents === null &&
          snapshotRevenue.revision === null
        ) {
          snapshotRevenueStatus = "not_reported";
        } else {
          throw new Error("FINANCIAL_HISTORY_INVALID_SNAPSHOT_REVENUE");
        }
      }
    }

    const known = [fixedCents, manualCents, openAiCents]
      .filter((value): value is number => value !== null);

    const knownExpenses = known.length === 0
      ? null
      : known.reduce((sum, value) => sum + value, 0);

    if (
      knownExpenses !== null &&
      !Number.isSafeInteger(knownExpenses)
    ) {
      throw new Error("FINANCIAL_HISTORY_COST_OVERFLOW");
    }

    // Receita atual comparada ao ultimo custo registrado no
    // pre-fechamento. Nao equivale ao resultado definitivo.
    const net = revenueAmount !== null && knownExpenses !== null
      ? revenueAmount - knownExpenses
      : null;

    if (net !== null && !Number.isSafeInteger(net)) {
      throw new Error("FINANCIAL_HISTORY_RESULT_OVERFLOW");
    }

    const snapshotMatchesCurrent =
      snapshotRevenueStatus === "confirmed" &&
      revenueAmount !== null
        ? snapshotRevenueCents === revenueAmount &&
          snapshotRevenueRevision === revenueRevision
        : null;

    return {
      month,
      preclosure: {
        status: pre === null ? "not_generated" : "preliminary",
        revision: preclosureRevision,
        pendingSources,
        auditVerified: pre !== null,
      },
      revenue: {
        status: revenueRow === null ? "not_reported" : "confirmed",
        amountBrlCents: revenueAmount,
        revision: revenueRevision,
        updatedAt: typeof revenueRow?.updated_at === "string"
          ? revenueRow.updated_at
          : null,
      },
      snapshotRevenue: {
        status: snapshotRevenueStatus,
        amountBrlCents: snapshotRevenueCents,
        revision: snapshotRevenueRevision,
        matchesCurrent: snapshotMatchesCurrent,
      },
      costs: {
        fixedRegisteredBrlCents: fixedCents,
        manualRegisteredBrlCents: manualCents,
        openAiKnownBrlCents: openAiCents,
        knownSubtotalBrlCents: knownExpenses,
        complete: false,
      },
      result: {
        status: net === null ? "unavailable" : "partial",
        netBrlCents: net,
        definitive: false,
        basis: "current_revenue_and_latest_preclosure_known_costs",
      },
    };
  });
}

/**
 * Acumula apenas receitas confirmadas e custos conhecidos.
 * Meses sem dados comparaveis sao identificados e excluidos.
 * Nunca representa fechamento financeiro definitivo.
 */
export function buildAccumulatedFinancialHistory(
  history: ReturnType<typeof buildMonthlyFinancialHistory>,
) {
  if (
    !Array.isArray(history) ||
    history.length < 1 ||
    history.length > 24
  ) {
    throw new Error("FINANCIAL_HISTORY_ACCUMULATED_INVALID_INPUT");
  }

  const seen = new Set<string>();
  const includedMonths: string[] = [];
  const excludedMonths: string[] = [];

  let revenueTotal = 0;
  let costsTotal = 0;
  let netTotal = 0;

  for (const row of history) {
    if (
      !row ||
      typeof row.month !== "string" ||
      !/^20\d{2}-(0[1-9]|1[0-2])-01$/.test(row.month) ||
      seen.has(row.month)
    ) {
      throw new Error("FINANCIAL_HISTORY_ACCUMULATED_INVALID_MONTHS");
    }

    seen.add(row.month);

    if (
      row.result.definitive !== false ||
      row.costs.complete !== false
    ) {
      throw new Error(
        "FINANCIAL_HISTORY_ACCUMULATED_UNEXPECTED_FINALIZED",
      );
    }

    const revenue = row.revenue.amountBrlCents;
    const costs = row.costs.knownSubtotalBrlCents;
    const net = row.result.netBrlCents;

    if (
      row.revenue.status !== "confirmed" ||
      revenue === null ||
      costs === null ||
      row.result.status !== "partial" ||
      net === null
    ) {
      excludedMonths.push(row.month);
      continue;
    }

    if (
      !Number.isSafeInteger(revenue) ||
      revenue < 0 ||
      !Number.isSafeInteger(costs) ||
      costs < 0 ||
      !Number.isSafeInteger(net) ||
      revenue - costs !== net
    ) {
      throw new Error(
        "FINANCIAL_HISTORY_ACCUMULATED_INVALID_RESULT",
      );
    }

    const nextRevenue = revenueTotal + revenue;
    const nextCosts = costsTotal + costs;
    const nextNet = netTotal + net;

    if (
      !Number.isSafeInteger(nextRevenue) ||
      !Number.isSafeInteger(nextCosts) ||
      !Number.isSafeInteger(nextNet)
    ) {
      throw new Error(
        "FINANCIAL_HISTORY_ACCUMULATED_OVERFLOW",
      );
    }

    revenueTotal = nextRevenue;
    costsTotal = nextCosts;
    netTotal = nextNet;

    includedMonths.push(row.month);
  }

  const available = includedMonths.length > 0;

  return {
    status: available
      ? "partial" as const
      : "unavailable" as const,
    definitive: false as const,
    evaluatedMonths: history.length,
    includedMonths,
    excludedMonths,
    revenueBrlCents: available ? revenueTotal : null,
    knownCostsBrlCents: available ? costsTotal : null,
    netBrlCents: available ? netTotal : null,
    basis:
      "confirmed_revenues_and_latest_preclosure_known_costs" as const,
  };
}
