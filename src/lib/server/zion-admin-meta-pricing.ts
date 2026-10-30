export type MetaPricingPoint = {
  category: string;
  pricingType: string;
  volume: number;
  approximateCost: number | null;
};

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject : null;
}

function costNumber(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** Meta's pricing analytics is approximate, never a reconciled invoice. */
export function summarizeMetaPricingAnalytics(payload: unknown, expectedWabaId: string) {
  const root = object(payload);
  if (!root || root.id !== expectedWabaId) throw new Error("META_PRICING_WABA_MISMATCH");

  const analytics = object(root.pricing_analytics);
  if (!analytics || !Array.isArray(analytics.data)) {
    throw new Error("META_PRICING_INVALID_RESPONSE");
  }

  const currency = typeof root.currency === "string" && /^[A-Z]{3}$/.test(root.currency)
    ? root.currency : null;
  const points: MetaPricingPoint[] = [];
  let missingCost = false;

  for (const entry of analytics.data) {
    const bucket = object(entry);
    if (!bucket || !Array.isArray(bucket.data_points)) {
      throw new Error("META_PRICING_INVALID_RESPONSE");
    }
    for (const rawPoint of bucket.data_points) {
      const point = object(rawPoint);
      if (!point || !Number.isSafeInteger(point.volume) || (point.volume as number) < 0) {
        throw new Error("META_PRICING_INVALID_POINT");
      }
      const amount = costNumber(point.cost);
      if (amount === null) missingCost = true;
      const category = typeof point.pricing_category === "string" && point.pricing_category.trim()
        ? point.pricing_category.trim().toUpperCase() : "UNCLASSIFIED";
      const pricingType = typeof point.pricing_type === "string" && point.pricing_type.trim()
        ? point.pricing_type.trim().toUpperCase() : "UNCLASSIFIED";
      points.push({ category, pricingType, volume: point.volume as number, approximateCost: amount });
      if (points.length > 5000) throw new Error("META_PRICING_TOO_MANY_POINTS");
    }
  }

  const totalVolume = points.reduce((sum, point) => sum + point.volume, 0);
  if (!Number.isSafeInteger(totalVolume)) throw new Error("META_PRICING_INVALID_TOTAL");
  const amountStatus = points.length === 0 ? "no_data"
    : !currency ? "currency_unavailable"
    : missingCost ? "cost_unavailable" : "approximate";
  const approximateCost = amountStatus === "approximate"
    ? Math.round(points.reduce((sum, point) => sum + (point.approximateCost ?? 0), 0) * 1e6) / 1e6
    : null;
  if (approximateCost !== null && !Number.isFinite(approximateCost)) {
    throw new Error("META_PRICING_INVALID_TOTAL");
  }

  return {
    currency,
    totalVolume,
    approximateCost,
    amountStatus,
    invoiceConfirmed: false as const,
    points: points.map(point => ({
      category: point.category,
      pricingType: point.pricingType,
      volume: point.volume,
      approximateCost: currency ? point.approximateCost : null,
    })),
  };
}