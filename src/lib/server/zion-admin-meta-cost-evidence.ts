export type MetaCostEvidenceRow = {
  id: string;
  store_id: string | null;
  delivered_at: string | null;
  metadata: unknown;
};

export type MetaCostEvidenceCounts = {
  delivered: number;
  billableEvidence: number;
  freeEvidence: number;
  unknownPricing: number;
  categories: Record<string, number>;
};

export type MetaCostEvidenceSummary = MetaCostEvidenceCounts & {
  stores: Record<string, MetaCostEvidenceCounts>;
  usd: null;
  brl: null;
  amountStatus: "not_verified";
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
}

function emptyCounts(): MetaCostEvidenceCounts {
  return {
    delivered: 0,
    billableEvidence: 0,
    freeEvidence: 0,
    unknownPricing: 0,
    categories: {},
  };
}

function classify(row: MetaCostEvidenceRow) {
  const metadata = record(row.metadata);
  const pricing = record(metadata?.whatsapp_pricing);

  if (!pricing) {
    return { kind: "unknown" as const, category: null };
  }

  if (pricing.billable === false) {
    return { kind: "free" as const, category: null };
  }

  if (pricing.billable !== true) {
    return { kind: "unknown" as const, category: null };
  }

  const category =
    typeof pricing.category === "string"
      ? pricing.category.toLowerCase().trim()
      : "";

  const known = [
    "marketing",
    "utility",
    "authentication",
    "authentication_international",
    "service",
  ];

  return {
    kind: "billable" as const,
    category: known.includes(category)
      ? category
      : "unclassified",
  };
}

function add(
  counts: MetaCostEvidenceCounts,
  classification: ReturnType<typeof classify>,
) {
  counts.delivered++;

  if (classification.kind === "billable") {
    counts.billableEvidence++;

    const category = classification.category ?? "unclassified";
    counts.categories[category] =
      (counts.categories[category] ?? 0) + 1;
  } else if (classification.kind === "free") {
    counts.freeEvidence++;
  } else {
    counts.unknownPricing++;
  }
}

/**
 * Read-only classification of delivered WhatsApp messages.
 *
 * Webhook pricing is evidence, not a confirmed monetary charge.
 * No Meta tariff, FX estimate or invoice amount is inferred.
 */
export function summarizeMetaCostEvidence(
  rows: MetaCostEvidenceRow[],
): MetaCostEvidenceSummary {
  const summary: MetaCostEvidenceSummary = {
    ...emptyCounts(),
    stores: {},
    usd: null,
    brl: null,
    amountStatus: "not_verified",
  };

  const seen = new Set<string>();

  for (const row of rows) {
    if (
      typeof row.id !== "string" ||
      !row.id ||
      !row.delivered_at ||
      seen.has(row.id)
    ) {
      continue;
    }

    seen.add(row.id);

    const classification = classify(row);
    add(summary, classification);

    const store = row.store_id || "unassigned";
    summary.stores[store] ??= emptyCounts();
    add(summary.stores[store], classification);
  }

  return summary;
}