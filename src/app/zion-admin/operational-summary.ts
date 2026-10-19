import {
  getOverviewDiagnosticsAvailability,
  getOverviewOperationalAvailability,
  getOverviewQueueAvailability,
  type OverviewAvailabilityPair,
  type OverviewDataAvailability,
} from "./overview-availability";

export type OperationalSummaryInput = {
  id?: string | null;
  name?: string | null;
  aiRunQueueErrors?: number | string | null;
  whatsappErrors?: number | string | null;
  salesActionErrors?: number | string | null;
  pendingAiRuns?: number | string | null;
  pendingSalesActions?: number | string | null;
  pendingWhatsappEvents?: number | string | null;
  dataAvailability?: {
    ai?: OverviewAvailabilityPair | null;
    commercial?: OverviewAvailabilityPair | null;
  } | null;
};

export type OperationalSummary = {
  observedTotal: number;
  confirmedTotal: number | null;
  displayTotal: string;
  availability: OverviewDataAvailability;
  hasPotentialPending: boolean;
  label: string;
  details: string;
};

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function getAvailability(input: OperationalSummaryInput) {
  const ai = input.dataAvailability?.ai;
  const commercial = input.dataAvailability?.commercial;
  const aiQueue = getOverviewQueueAvailability(ai);
  const commercialQueue = getOverviewQueueAvailability(commercial);
  const aiDiagnostics = getOverviewDiagnosticsAvailability(ai);
  const commercialDiagnostics = getOverviewDiagnosticsAvailability(commercial);

  return {
    aiQueue,
    commercialQueue,
    aiDiagnostics,
    commercialDiagnostics,
    overall: getOverviewOperationalAvailability({
      ai,
      commercial,
      hasUnverifiedOtherAreas: true,
    }),
  };
}

export function getOperationalSummary(
  input: OperationalSummaryInput,
): OperationalSummary {
  const aiErrors = numberValue(input.aiRunQueueErrors);
  const whatsappErrors = numberValue(input.whatsappErrors);
  const salesErrors = numberValue(input.salesActionErrors);
  const pendingAi = numberValue(input.pendingAiRuns);
  const pendingSales = numberValue(input.pendingSalesActions);
  const pendingWhatsapp = numberValue(input.pendingWhatsappEvents);
  const observedTotal =
    aiErrors + whatsappErrors + salesErrors + pendingAi + pendingSales + pendingWhatsapp;
  const availability = getAvailability(input);

  const details = [
    availability.aiQueue === "available" && aiErrors > 0
      ? `${aiErrors} erro(s) na fila de IA`
      : availability.aiQueue === "partial"
        ? "Fila de IA parcial"
        : availability.aiQueue === "unavailable"
          ? "Fila de IA indisponível"
          : null,
    whatsappErrors > 0 ? `${whatsappErrors} erro(s) no WhatsApp de entrada` : null,
    availability.commercialDiagnostics === "available" && salesErrors > 0
      ? `${salesErrors} erro(s) em ações comerciais`
      : availability.commercialDiagnostics === "partial"
        ? "Diagnóstico comercial parcial"
        : availability.commercialDiagnostics === "unavailable"
          ? "Diagnóstico comercial indisponível"
          : null,
    availability.aiQueue === "available" && pendingAi > 0
      ? `${pendingAi} IA pendente`
      : availability.aiQueue === "partial"
        ? "Fila de IA parcial"
        : availability.aiQueue === "unavailable"
          ? "Fila de IA indisponível"
          : null,
    availability.commercialQueue === "available" && pendingSales > 0
      ? `${pendingSales} ação comercial pendente`
      : availability.commercialQueue === "partial"
        ? "Fila comercial parcial"
        : availability.commercialQueue === "unavailable"
          ? "Fila comercial indisponível"
          : null,
    pendingWhatsapp > 0 ? `${pendingWhatsapp} evento WhatsApp pendente` : null,
  ].filter(Boolean) as string[];

  if (availability.overall === "available") {
    return {
      observedTotal,
      confirmedTotal: observedTotal,
      displayTotal: String(observedTotal),
      availability: "available",
      hasPotentialPending: observedTotal > 0,
      label:
        observedTotal > 0
          ? `${observedTotal} ocorrência(s)`
          : "Sem pendências operacionais críticas",
      details:
        details.join(" · ") ||
        "Nenhuma pendência operacional crítica encontrada nas filas monitoradas.",
    };
  }

  return {
    observedTotal,
    confirmedTotal: null,
    displayTotal: availability.overall === "unavailable" ? "Indisponível" : "Parcial",
    availability: availability.overall,
    hasPotentialPending: true,
    label:
      availability.overall === "unavailable"
        ? "Dados operacionais indisponíveis"
        : "Dados operacionais parciais",
    details: `${details.join(" · ") || "Há fontes operacionais sem confirmação completa."} · O total não é definitivo enquanto houver fontes indisponíveis, parciais ou sem disponibilidade individual explícita.`,
  };
}

export function getOperationalDetails(input: OperationalSummaryInput): string[] {
  const summary = getOperationalSummary(input);
  return summary.details.split(" · ").filter(Boolean);
}

function availabilityRank(value: OverviewDataAvailability): number {
  return value === "available" ? 0 : value === "partial" ? 1 : 2;
}

export function compareOperationalStores(
  left: OperationalSummaryInput,
  right: OperationalSummaryInput,
): number {
  const leftSummary = getOperationalSummary(left);
  const rightSummary = getOperationalSummary(right);

  if (
    leftSummary.availability === "available" &&
    rightSummary.availability === "available" &&
    leftSummary.observedTotal !== rightSummary.observedTotal
  ) {
    return rightSummary.observedTotal - leftSummary.observedTotal;
  }

  const availabilityDifference =
    availabilityRank(leftSummary.availability) -
    availabilityRank(rightSummary.availability);
  if (availabilityDifference !== 0) return availabilityDifference;

  const nameDifference = String(left.name ?? "").localeCompare(
    String(right.name ?? ""),
    "pt-BR",
  );
  if (nameDifference !== 0) return nameDifference;
  return String(left.id ?? "").localeCompare(String(right.id ?? ""));
}
