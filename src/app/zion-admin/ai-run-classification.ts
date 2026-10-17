import type { RecentAiErrorEvent } from "./recent-ai-errors";

export type AiRunObservedSituation =
  | "failure_recorded"
  | "completed"
  | "status_missing"
  | "status_unrecognized"
  | "status_error_incompatible";

export type AiRunCauseClassification = "not_identified";

export type AiRunClassification = {
  observedSituation: AiRunObservedSituation;
  situationLabel: string;
  cause: AiRunCauseClassification;
  causeLabel: string;
};

export type AiRunSourceAvailability = "available" | "partial" | "unavailable";

export type AiRunEvidenceScope = {
  availability: AiRunSourceAvailability;
  isComplete: boolean;
  statement: string;
};

export type AiRunGuidance = {
  availability: AiRunSourceAvailability;
  statement: string;
};

export function shouldShowAiRunCause(classification: AiRunClassification) {
  return classification.observedSituation !== "completed";
}

function normalizedStatus(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function hasSanitizedError(value: string | null | undefined) {
  return String(value || "").trim().length > 0;
}

export function classifyAiRunEvent(event: Partial<Pick<RecentAiErrorEvent, "status" | "error">>): AiRunClassification {
  const status = normalizedStatus(event.status);
  const hasError = hasSanitizedError(event.error);

  if (!status) {
    return {
      observedSituation: "status_missing",
      situationLabel: hasError
        ? "Erro registrado, mas o status está ausente."
        : "Status ausente; a situação não pode ser confirmada.",
      cause: "not_identified",
      causeLabel: "Causa não identificada.",
    };
  }

  if (status === "succeeded") {
    return {
      observedSituation: hasError ? "status_error_incompatible" : "completed",
      situationLabel: hasError
        ? "Status concluído, mas há erro sanitizado registrado."
        : "Execução concluída.",
      cause: "not_identified",
      causeLabel: "Causa não identificada.",
    };
  }

  if (status === "failed") {
    return {
      observedSituation: "failure_recorded",
      situationLabel: hasError
        ? "Falha registrada."
        : "Falha registrada sem detalhe sanitizado.",
      cause: "not_identified",
      causeLabel: "Causa não identificada.",
    };
  }

  return {
    observedSituation: "status_unrecognized",
    situationLabel: hasError
      ? "Erro registrado com status não reconhecido."
      : "Status não reconhecido; a situação não pode ser confirmada.",
    cause: "not_identified",
    causeLabel: "Causa não identificada.",
  };
}

export function classifyAiRunEvidenceScope(value: unknown): AiRunEvidenceScope {
  const availability: AiRunSourceAvailability =
    value === "available" || value === "partial" || value === "unavailable"
      ? value
      : "unavailable";

  if (availability === "available") {
    return {
      availability,
      isComplete: true,
      statement: "Situação observada na fonte disponível; o recorte é completo.",
    };
  }

  if (availability === "partial") {
    return {
      availability,
      isComplete: false,
      statement: "Situação observada nos eventos carregados; a fonte é parcial.",
    };
  }

  return {
    availability,
    isComplete: false,
    statement: "Fonte de execuções indisponível; não é possível confirmar ausência de falhas.",
  };
}

export function getAiRunGuidance(
  classification: AiRunClassification,
  availabilityValue: unknown,
): AiRunGuidance {
  const scope = classifyAiRunEvidenceScope(availabilityValue);

  if (scope.availability === "unavailable") {
    return {
      availability: scope.availability,
      statement: "A fonte de execuções está indisponível; não é possível oferecer um diagnóstico conclusivo.",
    };
  }

  const statementBySituation: Record<AiRunObservedSituation, string> = {
    failure_recorded:
      "Confira o impacto operacional desta falha e encaminhe para investigação técnica se necessário.",
    status_missing:
      "Verifique a integridade deste registro; não é possível confirmar falha ou sucesso.",
    status_unrecognized:
      "Verifique o estado registrado e encaminhe o caso para análise técnica.",
    status_error_incompatible:
      "Investigue a inconsistência entre o status de sucesso e o erro registrado; não considere esta execução saudável automaticamente.",
    completed:
      "Esta execução foi concluída; esta ocorrência, por si só, não exige intervenção corretiva.",
  };

  const statement = statementBySituation[classification.observedSituation];

  return {
    availability: scope.availability,
    statement: scope.availability === "partial"
      ? `${statement} A fonte está parcial; outras ocorrências podem não estar nesta lista.`
      : statement,
  };
}
