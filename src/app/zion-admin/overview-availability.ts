export type OverviewDataAvailability = "available" | "unavailable" | "partial";

export type OverviewAvailabilityPair = {
  queue?: unknown;
  diagnostics?: unknown;
};

export function normalizeOverviewDataAvailability(
  value: unknown,
): OverviewDataAvailability {
  return value === "available" || value === "partial" || value === "unavailable"
    ? value
    : "unavailable";
}

export function formatAvailableOverviewValue(
  value: unknown,
  availability: unknown,
  format: (value: unknown) => string,
): string {
  const state = normalizeOverviewDataAvailability(availability);

  if (state === "available") return format(value);
  if (state === "partial") return "Parcial";
  return "Indisponível";
}

export function getOverviewAvailabilityLabel(value: unknown): string {
  const state = normalizeOverviewDataAvailability(value);
  if (state === "available") return "Fonte disponível; zero significa zero confirmado.";
  if (state === "partial") return "Consulta parcial; a contagem não é definitiva.";
  return "Fonte indisponível; contagem não confirmada.";
}

export function combineOverviewAvailability(
  ...values: unknown[]
): OverviewDataAvailability {
  const normalized = values.map(normalizeOverviewDataAvailability);
  if (normalized.length > 0 && normalized.every((value) => value === "available")) {
    return "available";
  }
  if (normalized.length > 0 && normalized.every((value) => value === "unavailable")) {
    return "unavailable";
  }
  return "partial";
}

export function getOverviewQueueAvailability(
  source: OverviewAvailabilityPair | null | undefined,
): OverviewDataAvailability {
  return normalizeOverviewDataAvailability(source?.queue);
}

export function getOverviewDiagnosticsAvailability(
  source: OverviewAvailabilityPair | null | undefined,
): OverviewDataAvailability {
  return normalizeOverviewDataAvailability(source?.diagnostics);
}

export function getOverviewOperationalAvailability(args: {
  ai: OverviewAvailabilityPair | null | undefined;
  commercial: OverviewAvailabilityPair | null | undefined;
  hasOtherAreaEvidence?: boolean;
}): OverviewDataAvailability {
  const combined = combineOverviewAvailability(
    args.ai?.queue,
    args.ai?.diagnostics,
    args.commercial?.queue,
    args.commercial?.diagnostics,
  );

  if (combined === "unavailable" && args.hasOtherAreaEvidence) {
    return "partial";
  }

  return combined;
}
